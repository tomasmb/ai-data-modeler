import { HttpError } from 'wasp/server'
import { parseDataModelSchema } from './lib/modelParser'
import { PrismaClient } from '@prisma/client'
import OpenAI from 'openai'

const prisma = new PrismaClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const createDataModel = async ({ name, version = '1', description }, context) => {
  if (!context.user) { throw new HttpError(401) };
  const newDataModel = await context.entities.DataModel.create({
    data: {
      name,
      version,
      description,
      userId: context.user.id
    }
  });
  return newDataModel;
}

export const updateDataModel = async ({ dataModelId, name, version, description }, context) => {
  if (!context.user) { throw new HttpError(401) };

  const dataModel = await context.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });
  if (!dataModel) { throw new HttpError(404, 'DataModel not found') };
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) };

  return context.entities.DataModel.update({
    where: { id: parseInt(dataModelId) },
    data: { name, version, description }
  });
}

export const saveDataModelSchema = async ({ dataModelId, schema }, context) => {
  if (!context.user) { throw new HttpError(401, 'Authentication required') };
  const parsedSchema = parseDataModelSchema(schema);

  if (!parsedSchema || !parsedSchema.isValid) {
    console.error('Schema validation failed:', parsedSchema?.errors);
    throw new HttpError(400, {
      message: 'Invalid schema',
      details: parsedSchema?.errors || ['Schema parsing failed']
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      try {
        const dataModel = await tx.dataModel.findUnique({
          where: { id: parseInt(dataModelId) },
          include: {
            entities: {
              include: {
                fields: true,
                fromRelations: true,
                toRelations: true
              }
            }
          }
        });

        if (!dataModel) { throw new HttpError(404, 'DataModel not found') };
        if (dataModel.userId !== context.user.id) { 
          throw new HttpError(403, 'User not authorized to modify this DataModel') 
        };

        // Delete existing relations and fields first
        await tx.Relation.deleteMany({
          where: { dataModelId: parseInt(dataModelId) }
        });
        await tx.Field.deleteMany({
          where: { entity: { dataModelId: parseInt(dataModelId) } }
        });
        await tx.ModelEntity.deleteMany({
          where: { dataModelId: parseInt(dataModelId) }
        });

        // Create entities and their fields
        const entityFieldMap = new Map();
        for (const [entityName, entityData] of Object.entries(parsedSchema.entities)) {
          const createdEntity = await tx.ModelEntity.create({
            data: {
              name: entityName,
              dataModelId: parseInt(dataModelId),
            }
          });

          // Create fields and store them in the map
          const fieldMap = new Map();
          for (const [fieldName, fieldType] of Object.entries(entityData.fields)) {            
            let processedFieldType;
            if (typeof fieldType === 'string') {
              processedFieldType = fieldType.replace('[]', '').split('.')[0]; // Remove array notation and get base type
            } else if (fieldType && typeof fieldType === 'object' && fieldType.type) {
              processedFieldType = fieldType.type.replace('[]', '').split('.')[0];
            } else {
              console.error('Invalid field type:', fieldType);
              throw new HttpError(400, `Invalid field type for ${fieldName}`);
            }

            const createdField = await tx.Field.create({
              data: {
                name: fieldName,
                fieldType: processedFieldType,
                isRequired: !fieldType.isNullable,
                isUnique: fieldType.isUnique,
                isIndex: fieldType.isIndex,
                isPrimary: fieldType.isPrimary,
                defaultValue: fieldType.defaultValue,
                enumValues: fieldType.enumValues ? JSON.stringify(fieldType.enumValues) : null,
                entityId: createdEntity.id
              }
            });
            fieldMap.set(fieldName, createdField);
          }
          entityFieldMap.set(entityName, { entity: createdEntity, fields: fieldMap });
        }

        // Create relations with field references
        for (const [relationKey, relation] of Object.entries(parsedSchema.relations)) {
          const fromEntityData = entityFieldMap.get(relation.fromEntity);
          const toEntityData = entityFieldMap.get(relation.toEntity);
          
          if (!fromEntityData || !toEntityData) {
            console.error('Missing entity data:', { fromEntity: relation.fromEntity, toEntity: relation.toEntity });
            continue;
          }

          const fromField = fromEntityData.fields.get(relation.fieldName);
          const toField = relation.referencedField 
            ? toEntityData.fields.get(relation.referencedField)
            : toEntityData.fields.get('id');

          if (!fromField || !toField) {
            console.error('Missing field data:', { 
              fromField: relation.fieldName, 
              toField: relation.referencedField || 'id',
              fromEntityFields: Array.from(fromEntityData.fields.keys()),
              toEntityFields: Array.from(toEntityData.fields.keys())
            });
            continue;
          }

          await tx.Relation.create({
            data: {
              name: `${relation.fromEntity}_${relation.fieldName}_${relation.toEntity}`,
              relationType: 'FOREIGN_KEY',
              fromEntityId: fromEntityData.entity.id,
              toEntityId: toEntityData.entity.id,
              fromFieldId: fromField.id,
              toFieldId: toField.id,
              cardinality: relation.cardinality,
              dataModelId: parseInt(dataModelId)
            }
          });
        }

        return dataModel;
      } catch (txError) {
        console.error('Transaction failed:', txError);
        throw new HttpError(500, 'Failed to save data model schema');
      }
    });
  } catch (error) {
    console.error('Error in saveDataModelSchema:', error);
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'Internal server error while saving schema');
  }
};

function getDefaultStepQuestion(step) {
  switch (step) {
    case 'projectDetails':
      return `🚀 Let's start by understanding your project!  
      
To generate the best data model, I need some key details:  
🔹 **Project description**: Please provide a brief description of your project (main features, business goals, what problem it solves).  
🔹 **Industry**: Which industry does your project serve? (e.g., healthcare, logistics, finance, gaming).  

This information will help me create an optimal data model for your needs!`;

    case 'functionalRequirements':
      return `📌 Now, let's define the functional requirements for your data model.  

Please tell me about:  
🔹 **User types**: What different types of users will interact with your system? (e.g., Admin, Customer, Vendor)  
🔹 **Key features**: What are the main features and workflows of your application?  
🔹 **Data access patterns**: 
  - How will users typically access data in your system?
  - What query pattern do you expect? ("simple lookups", "heavy joins", or "graph traversal")

This will help structure the database to support your application's core functionality.`;

    case 'nonFunctionalRequirements':
      return `⚙️ Let's define the technical requirements for your data model.  

Please provide details on:  
🔹 **Frequent queries**: What are the most common data retrieval patterns in your application?  
🔹 **Critical joins**: Are there any joins that will happen often or with large datasets?  
🔹 **Write operations**: What are the important create/update/delete operations in your system?  
🔹 **Read-write ratio**: Will your system be "read-heavy", "write-heavy", or "balanced"?  
🔹 **Growth expectations**: How do you expect your data volume to increase over time?  

Based on this information, I'll suggest the most appropriate data model type (SQL, NoSQL, GraphDB) for your needs.`;

    default:
      return "🤖 How can I assist you with your data model today?";
  }
};

export const sendChatMessage = async ({ dataModelId, content, context }, ctx) => {
  if (!ctx.user) { throw new HttpError(401) }

  const dataModel = await ctx.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== ctx.user.id) { throw new HttpError(403) }

  // If this is a new step initialization, create AI message with default question
  if (context.isNewStep) {
    const defaultQuestion = getDefaultStepQuestion(context.step);
    await ctx.entities.ChatMessage.create({
      data: {
        content: defaultQuestion,
        sender: 'ai',
        dataModelId: parseInt(dataModelId)
      }
    });
    // Return early with just the default question
    return {
      message: defaultQuestion,
      followUpQuestion: defaultQuestion,
      updatedInfo: context.currentStepInfo,
      completed: false
    };
  }

  // Regular message flow continues here...
  const userMessage = await ctx.entities.ChatMessage.create({
    data: {
      content,
      sender: 'user',
      dataModelId: parseInt(dataModelId)
    }
  });

  try {
    // Get AI response with enhanced context
    const aiResponse = await getAIResponse(content, {
      step: context.step,
      currentStepInfo: context.currentStepInfo,
      previousMessage: userMessage.content, // Add previous message for context
      phase: context.phase,
      allCollectedInfo: context.allCollectedInfo,
      previousQuestion: context.previousQuestion
    });

    // Save AI's response
    const aiMessage = await ctx.entities.ChatMessage.create({
      data: {
        content: aiResponse.message,
        sender: 'ai',
        dataModelId: parseInt(dataModelId)
      }
    });

    // Return complete response for frontend state update
    return {
      userMessage,
      aiMessage,
      updatedInfo: aiResponse.updatedInfo,
      completed: aiResponse.completed,
      missingFields: identifyMissingFields(aiResponse.updatedInfo)
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new HttpError(500, 'Failed to get AI response');
  }
}

async function getAIResponse(userMessage, context) {
  const messages = [];
  
  let systemPrompt = `You are an expert AI assistant helping to gather comprehensive information for data model creation.
You have deep knowledge of various system architectures, industry patterns, and technical requirements.

Your mission is to efficiently collect ALL missing information to complete the data model requirements.

IMPORTANT INSTRUCTIONS:
1. Focus on collecting ALL missing information from the required fields
2. Ask DIRECT, SPECIFIC questions about ALL missing fields
3. Provide clear context about what information you need and why it's important
4. Acknowledge information the user has already provided and don't ask for it again
5. Structure your response to clearly separate different missing fields

DO NOT ask open-ended, vague questions like "Let's explore more about these features."
DO ask specific questions like "What is your expected read/write ratio?" or "What are your key data access patterns?"`;

  // Base JSON schema structure that all steps will extend
  const baseSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      message: { 
        type: 'string',
        description: 'Response message to show to the user'
      },
      followUpQuestion: {
        type: 'string',
        description: 'The next question to ask the user to gather missing information'
      },
      updatedInfo: { type: 'object' }, // Will be extended per step
      completed: { 
        type: 'boolean',
        description: 'Whether all required information has been gathered'
      }
    },
    required: ['message', 'followUpQuestion', 'updatedInfo', 'completed']
  };

  let jsonSchema;
  
  // Add step-specific instructions and schema
  switch (context.step) {
    case 'projectDetails':
      systemPrompt += `
        For project details, ensure you have:
        - Detailed project description
        - Specific industry sector
        
        Ask focused questions until these aspects are clearly understood.
      `;
      jsonSchema = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          updatedInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              description: { type: ['string', 'null'] },
              industry: { type: ['string', 'null'] },
              completed: { type: 'boolean' }
            },
            required: ['description', 'industry', 'completed']
          }
        }
      };
      break;

    case 'functionalRequirements':
      systemPrompt += `
        You are gathering information about user types, key features, and data access patterns.
        Focus on understanding:
        - Different types of users in the system
        - Key features and workflows
        - How data will be accessed and queried
      `;
      jsonSchema = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          updatedInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              userTypes: { type: 'array', items: { type: 'string' } },
              keyFeatures: { type: 'array', items: { type: 'string' } },
              dataAccess: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  accessPatterns: { type: 'array', items: { type: 'string' } },
                  queryPattern: { type: ['string', 'null'] }
                },
                required: ['accessPatterns', 'queryPattern']
              },
              completed: { type: 'boolean' }
            },
            required: ['userTypes', 'keyFeatures', 'dataAccess', 'completed']
          }
        }
      };
      break;

    case 'nonFunctionalRequirements':
      systemPrompt += `
        You are gathering specific data operation patterns and scalability requirements.
        Ask about:
        - Common data retrieval patterns (frequent queries)
        - Critical joins that happen often or with large datasets
        - Important write operations
        - Expected read/write ratio
        - Data volume growth expectations
        - Suggested data model type (SQL, NoSQL, GraphDB)
      `;
      jsonSchema = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          updatedInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              frequentQueries: { type: 'array', items: { type: 'string' } },
              criticalJoins: { type: 'array', items: { type: 'string' } },
              writeOperations: { type: 'array', items: { type: 'string' } },
              readWriteRatio: { type: ['string', 'null'] },
              growthExpectations: { type: ['string', 'null'] },
              suggestedDataModel: { type: ['string', 'null'] },
              completed: { type: 'boolean' }
            },
            required: ['frequentQueries', 'criticalJoins', 'writeOperations', 'readWriteRatio', 'growthExpectations', 'suggestedDataModel', 'completed']
          }
        }
      };
      break;
  }

  // Add a new function to identify missing fields with detailed explanations
  const getMissingFieldsWithExplanations = (currentInfo, step) => {
    const missingFields = [];
    
    switch(step) {
      case 'projectDetails':
        if(!currentInfo.description || currentInfo.description === null) {
          missingFields.push({
            field: 'description',
            explanation: 'A detailed description of your project including main features and business goals',
            importance: 'This provides context for the overall data model structure and priorities'
          });
        }
        if(!currentInfo.industry || currentInfo.industry === null) {
          missingFields.push({
            field: 'industry',
            explanation: 'The specific industry your application serves (e.g., healthcare, logistics, finance)',
            importance: 'Different industries have different data modeling patterns and compliance requirements'
          });
        }
        break;
        
      case 'functionalRequirements':
        if(!currentInfo.userTypes || !currentInfo.userTypes.length) {
          missingFields.push({
            field: 'userTypes',
            explanation: 'Different types of users in your system and their roles',
            importance: 'This affects user entity design and permission structures'
          });
        }
        if(!currentInfo.keyFeatures || !currentInfo.keyFeatures.length) {
          missingFields.push({
            field: 'keyFeatures',
            explanation: 'The main features your application provides',
            importance: 'Each feature typically requires specific entities and relationships'
          });
        }
        if(!currentInfo.dataAccess || !currentInfo.dataAccess.accessPatterns || !currentInfo.dataAccess.accessPatterns.length) {
          missingFields.push({
            field: 'dataAccess.accessPatterns',
            explanation: 'How users will access and interact with data in your system',
            importance: 'Access patterns heavily influence indexing and relationship design'
          });
        }
        if(!currentInfo.dataAccess || currentInfo.dataAccess.queryPattern === null) {
          missingFields.push({
            field: 'dataAccess.queryPattern',
            explanation: 'The type of queries your system will primarily use (simple lookups, heavy joins, graph traversal)',
            importance: 'This helps determine the most appropriate database structure'
          });
        }
        break;
        
      case 'nonFunctionalRequirements':
        if(!currentInfo.frequentQueries || !currentInfo.frequentQueries.length) {
          missingFields.push({
            field: 'frequentQueries',
            explanation: 'Common data retrieval patterns in your application',
            importance: 'Frequent queries need optimization through indexing and data structure design'
          });
        }
        if(!currentInfo.criticalJoins || !currentInfo.criticalJoins.length) {
          missingFields.push({
            field: 'criticalJoins',
            explanation: 'Joins that happen often or with large datasets',
            importance: 'Critical joins may require denormalization or special indexing strategies'
          });
        }
        if(!currentInfo.writeOperations || !currentInfo.writeOperations.length) {
          missingFields.push({
            field: 'writeOperations',
            explanation: 'Important create/update/delete operations in your system',
            importance: 'Write-heavy operations may require special consideration for performance'
          });
        }
        if(!currentInfo.readWriteRatio || currentInfo.readWriteRatio === null) {
          missingFields.push({
            field: 'readWriteRatio',
            explanation: 'Whether your system is read-heavy, write-heavy, or balanced',
            importance: 'This ratio influences database choice and optimization strategies'
          });
        }
        if(!currentInfo.growthExpectations || currentInfo.growthExpectations === null) {
          missingFields.push({
            field: 'growthExpectations',
            explanation: 'How you expect your data volume to increase over time',
            importance: 'Growth expectations affect scaling strategies and infrastructure planning'
          });
        }
        if(!currentInfo.suggestedDataModel || currentInfo.suggestedDataModel === null) {
          missingFields.push({
            field: 'suggestedDataModel',
            explanation: 'The most appropriate data model type for your needs (SQL, NoSQL, GraphDB)',
            importance: 'This fundamental choice affects the entire structure of your data model'
          });
        }
        break;
    }
    
    return missingFields;
  };

  // Get missing fields with explanations
  const missingFields = getMissingFieldsWithExplanations(context.currentStepInfo || {}, context.step);
  
  // Add conversation context with focus on ALL missing fields
  messages.push({ 
    role: 'system', 
    content: `${systemPrompt}

Current Context:
Current step: ${context.step}
Previous question: ${context.previousQuestion || 'None'}

MISSING INFORMATION (COLLECT ALL):
${missingFields.length > 0 ? 
  missingFields.map(field => 
    `- ${field.field}: ${field.explanation}\n  WHY IT'S IMPORTANT: ${field.importance}`
  ).join('\n\n') : 
  'All required fields have been collected for this step.'}

Information already collected for this step:
${JSON.stringify(context.currentStepInfo, null, 2)}

Complete collected information from all steps:
${JSON.stringify(context.allCollectedInfo, null, 2)}

User's latest response: ${userMessage}

YOUR TASK:
1. FIRST, carefully analyze the user's response to extract ANY information for the missing fields
2. UPDATE the currentStepInfo with ALL information you can extract from the user's response
3. NEVER discard information the user has already provided - only add or update
4. Ask DIRECT questions about ALL remaining missing fields
5. For each question, explain what the information means and why it's important
6. Provide examples of possible answers to guide the user
7. DO NOT ask open-ended exploratory questions - focus on collecting specific missing data
8. Structure your response with clear headings for each missing field`
  });

  messages.push({ role: 'user', content: userMessage });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: 'data_model_assistant',
        strict: true,
        schema: jsonSchema
      },
    }
  });

  const response = JSON.parse(completion.choices[0].message.content);
  
  // Check if all required fields are completed
  response.completed = validateStepCompletion(response.updatedInfo, context.step) === true;
  
  console.log('response', response);
  // Add completion message if the step is now completed
  if (response.completed) {
    const nextStep = getNextStep(context.step);
    response.message = `Thank you for providing all the necessary information for this step! ${
      nextStep ? `We'll now continue with the ${formatStepName(nextStep)} step.` : 
      "We've completed all the required information gathering steps!"
    }
    
${response.message}`;
  } else {
    // If not completed, make sure the follow-up question focuses on ALL missing fields
    const remainingMissingFields = getMissingFieldsWithExplanations(response.updatedInfo, context.step);
    
    if (remainingMissingFields.length > 0) {
      // Create a comprehensive follow-up question covering ALL missing fields
      let followUpQuestion = "To complete your data model, I need information about ALL of the following:\n\n";
      
      remainingMissingFields.forEach((field, index) => {
        followUpQuestion += `### ${index + 1}. ${field.field.split('.').pop()}\n`;
        followUpQuestion += `**What it is**: ${field.explanation}\n`;
        followUpQuestion += `**Why it matters**: ${field.importance}\n\n`;
      });
      
      followUpQuestion += "Please provide information for as many of these items as possible. Even partial information helps build your data model.";
      
      response.followUpQuestion = followUpQuestion;
    }
  }
  
  return response;
}

// Helper function to get the next step
function getNextStep(currentStep) {
  const steps = ['projectDetails', 'functionalRequirements', 'nonFunctionalRequirements'];
  const currentIndex = steps.indexOf(currentStep);
  
  if (currentIndex >= 0 && currentIndex < steps.length - 1) {
    return steps[currentIndex + 1];
  }
  
  return null;
}

// Helper function to format step name for display
function formatStepName(step) {
  switch (step) {
    case 'projectDetails':
      return 'Project Details';
    case 'functionalRequirements':
      return 'Functional Requirements';
    case 'nonFunctionalRequirements':
      return 'Non-Functional Requirements';
    default:
      return step;
  }
}

// Helper function to identify missing or incomplete fields
function identifyMissingFields(stepInfo) {
  const missingFields = [];
  
  switch(true) {
    case !stepInfo.type || stepInfo.type === null:
      missingFields.push('project type');
      break;
    case !stepInfo.description || stepInfo.description === null:
      missingFields.push('project description');
      break;
    // Add more cases based on the step
  }
  
  return missingFields;
}

// Update or add this function to properly validate step completion
function validateStepCompletion(stepInfo, step) {
  if (!stepInfo) return false;
  
  switch (step) {
    case 'projectDetails':
      // Check if both description and industry are filled
      return stepInfo.description !== null && 
             stepInfo.industry !== null;
      
    case 'functionalRequirements':
      // Check if userTypes, keyFeatures, and dataAccess fields are filled
      return stepInfo.userTypes && 
             stepInfo.userTypes.length > 0 && 
             stepInfo.keyFeatures && 
             stepInfo.keyFeatures.length > 0 && 
             stepInfo.dataAccess && 
             stepInfo.dataAccess.accessPatterns && 
             stepInfo.dataAccess.accessPatterns.length > 0 && 
             stepInfo.dataAccess.queryPattern !== null;
      
    case 'nonFunctionalRequirements':
      // Check if all non-functional requirement fields are filled
      return stepInfo.frequentQueries && 
             stepInfo.frequentQueries.length > 0 && 
             stepInfo.criticalJoins && 
             stepInfo.criticalJoins.length > 0 && 
             stepInfo.writeOperations && 
             stepInfo.writeOperations.length > 0 && 
             stepInfo.readWriteRatio !== null && 
             stepInfo.growthExpectations !== null && 
             stepInfo.suggestedDataModel !== null;
      
    default:
      return false;
  }
}

export const saveDataModelRequirements = async (args, context) => {
  const { dataModelId, requirements } = args;
  
  // You might want to create a new entity for requirements or add them to your DataModel entity
  return await context.entities.DataModel.update({
    where: { id: parseInt(dataModelId) },
    data: {
      requirements: requirements // Assuming you have a JSON field for requirements
    }
  });
}

export const generateDataModel = async ({ requirements }, ctx) => {
  if (!ctx.user) { throw new HttpError(401) }

  const messages = [];
  
  const systemPrompt = `You are an expert data modeler tasked with generating a precise data model schema in JSON format.
You will analyze the provided requirements and create a comprehensive data model.

Your output must follow this JSON schema structure exactly:
- entities: An object where keys are entity names (PascalCase) and values contain their field definitions
- Each entity has a "fields" object where keys are field names (camelCase) and values define field properties
- Field properties include type, constraints, and relationship information

For field types:
- Use standard types: string, number, boolean, datetime, ID, int, float, decimal, date, time, json, text, email, url, uuid, bigint, binary
- For enum fields, provide the possible values in the "enumValues" array
- For relationships to other entities, use the entity name as the type
- For relationships that reference a specific field, use "EntityName.fieldName" format
- For array/collection relationships, set "isArray" to true

Design Principles:
1. Every entity must have an ID field as primary key
2. Use appropriate indexes for frequently queried fields
3. Consider query patterns when designing relations
4. Add proper constraints based on business rules
5. Use enum types for fields with fixed value sets
6. Add default values where appropriate
7. Consider data validation and integrity requirements`;

  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      explanation: {
        type: 'string',
        description: 'Detailed explanation of the data model design decisions'
      },
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entities: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fields: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      type: { type: 'string' },
                      isArray: { type: 'boolean' },
                      isUnique: { type: 'boolean' },
                      isIndex: { type: 'boolean' },
                      isPrimary: { type: 'boolean' },
                      isNullable: { type: 'boolean' },
                      defaultValue: { type: ['string', 'null'] },
                      enumValues: {
                        type: ['array', 'null'],
                        items: { type: 'string' }
                      }
                    },
                    required: [
                      'type',
                      'isArray',
                      'isUnique',
                      'isIndex',
                      'isPrimary',
                      'isNullable',
                      'defaultValue',
                      'enumValues'
                    ]
                  }
                }
              }
            }
          },
          relations: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fromEntity: { type: 'string' },
                toEntity: { type: 'string' },
                fieldName: { type: 'string' },
                referencedField: { type: 'string' },
                cardinality: { type: 'string' },
                isNullable: { type: 'boolean' }
              },
              required: [
                'fromEntity',
                'toEntity',
                'fieldName',
                'referencedField',
                'cardinality',
                'isNullable'
              ]
            }
          }
        },
      },
      supportedFeatures: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['explanation', 'schema', 'supportedFeatures']
  };

  // Add detailed requirements analysis
  messages.push({
    role: 'system',
    content: `${systemPrompt}

Analyze these detailed requirements to create an optimal schema:
Project Details:
${JSON.stringify(requirements.projectDetails, null, 2)}

Functional Requirements:
${JSON.stringify(requirements.functionalRequirements, null, 2)}

Non-Functional Requirements:
${JSON.stringify(requirements.nonFunctionalRequirements, null, 2)}

Consider:
1. Access patterns from dataAccess requirements
2. Heavy read/write entities from dataOperations
3. Performance requirements for critical operations
4. Data volume and growth expectations
5. Security and compliance needs

IMPORTANT: For entity relationships, when an entity field references another entity:
- Set the "type" to the entity name (e.g., "User") for basic references
- For specific field references, use dot notation: "EntityName.fieldName" (e.g., "User.id")
- Set "isArray" to true for one-to-many or many-to-many relationships`
  });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.7,
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: 'data_model_assistant',
          strict: true,
          schema: jsonSchema
        },
      }
    });

    const response = JSON.parse(completion.choices[0].message.content);
    
    // Convert the JSON schema format to DSL string format
    const schemaString = Object.entries(response.schema.entities)
      .map(([entityName, entityData]) => {
        const fields = Object.entries(entityData.fields)
          .map(([fieldName, fieldConfig]) => {
            let fieldLine = `  ${fieldName}: `;
            
            // Handle enum type
            if (fieldConfig.enumValues && fieldConfig.enumValues.length > 0) {
              fieldLine += `enum(${fieldConfig.enumValues.join(',')})`;
            } else {
              // Use the type directly - it should already include any entity.field references
              fieldLine += fieldConfig.type + (fieldConfig.isArray ? '[]' : '');
            }

            // Add modifiers
            const modifiers = [];
            if (fieldConfig.isPrimary) modifiers.push('@primary');
            if (fieldConfig.isUnique) modifiers.push('@unique');
            if (fieldConfig.isIndex) modifiers.push('@index');
            if (fieldConfig.isNullable) modifiers.push('@nullable(true)');
            if (fieldConfig.defaultValue) modifiers.push(`@default(${fieldConfig.defaultValue})`);

            if (modifiers.length > 0) {
              fieldLine += ' ' + modifiers.join(' ');
            }

            return fieldLine;
          })
          .join('\n');

        return `entity ${entityName} {\n${fields}\n}`;
      })
      .join('\n\n');

    // Now validate the converted schema string
    const parsedSchema = parseDataModelSchema(schemaString);
    if (!parsedSchema.isValid) {
      throw new HttpError(400, {
        message: 'Generated schema is invalid',
        details: parsedSchema.errors
      });
    }

    return {
      explanation: response.explanation,
      schema: schemaString,
      supportedFeatures: response.supportedFeatures,
      entities: parsedSchema.entities,
      relations: parsedSchema.relations
    };
  } catch (error) {
    console.error('Error generating schema:', error);
    throw new HttpError(500, 'Failed to generate data model schema');
  }
};

export const askDataModelQuestion = async ({ dataModelId, content, chatMode }, context) => {
  if (!context.user) { throw new HttpError(401) }

  const dataModel = await context.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) }

  // Get the last 10 chat messages for context
  const recentMessages = await context.entities.ChatMessage.findMany({
    where: { dataModelId: parseInt(dataModelId) },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  // Save the user message
  const userMessage = await context.entities.ChatMessage.create({
    data: {
      content,
      sender: 'user',
      dataModelId: parseInt(dataModelId)
    }
  });

  try {
    // Get the schema in DSL format
    const { schema } = await context.entities.getDataModelSchema({ dataModelId });

    // Get AI response based on chat mode
    const aiResponse = await getDataModelAnswer(content, {
      schema,
      dataModel,
      recentMessages: recentMessages.reverse(), // Reverse to get chronological order
      chatMode // 'questions' or 'modifications'
    });

    // Save AI's response
    const aiMessage = await context.entities.ChatMessage.create({
      data: {
        content: aiResponse,
        sender: 'ai',
        dataModelId: parseInt(dataModelId)
      }
    });

    return {
      userMessage,
      aiMessage
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new HttpError(500, 'Failed to get AI response');
  }
}

async function getDataModelAnswer(userMessage, context) {
  const messages = [];
  
  // Create different system prompts based on chat mode
  let systemPrompt = '';
  
  if (context.chatMode === 'questions') {
    systemPrompt = `You are an expert data modeling assistant helping a user understand their data model.
Your goal is to answer questions about the data model, explain design decisions, and provide insights.

The user's data model has the following structure:
${context.schema || 'No schema available yet'}

Recent conversation context:
${context.recentMessages.map(msg => `${msg.sender}: ${msg.content}`).join('\n')}

When answering:
1. Be specific and reference actual entities and fields in the data model
2. Explain the reasoning behind design decisions when relevant
3. If asked about something not in the model, suggest how it could be implemented
4. Use examples to illustrate your explanations
5. If the user asks about performance, suggest best practices`;
  } else if (context.chatMode === 'modifications') {
    systemPrompt = `You are an expert data modeling assistant helping a user modify their data model.
Your goal is to suggest specific changes to the data model based on the user's requirements.

The user's current data model has the following structure:
${context.schema || 'No schema available yet'}

Recent conversation context:
${context.recentMessages.map(msg => `${msg.sender}: ${msg.content}`).join('\n')}

When suggesting modifications:
1. Provide specific code changes that could be made to the model
2. Explain the reasoning behind your suggested changes
3. Consider the impact on existing data and relationships
4. Suggest alternatives when appropriate
5. If the change would impact performance, mention potential considerations`;
  }

  messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userMessage });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.7
  });

  return completion.choices[0].message.content;
}

export const modifyDataModelSchema = async ({ dataModelId, content }, context) => {
  if (!context.user) { throw new HttpError(401) }

  const dataModel = await context.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) }

  try {
    // Get the current schema in DSL format
    const { schema: currentSchema } = await context.entities.getDataModelSchema({ dataModelId });
    
    const messages = [];
    
    const systemPrompt = `You are an expert data modeler tasked with modifying an existing data model schema based on specific user instructions.
Your job is to carefully apply the requested changes to the current schema while maintaining its integrity.

IMPORTANT INSTRUCTIONS:
1. Start with the EXACT current schema provided
2. ONLY make the specific changes requested by the user
3. Do NOT add or remove entities or fields unless explicitly requested
4. Preserve all existing relationships unless specifically asked to modify them
5. Maintain the same naming conventions used in the current schema
6. Ensure all changes are consistent with the rest of the model

Your output must follow this JSON schema structure exactly:
- entities: An object where keys are entity names (PascalCase) and values contain their field definitions
- Each entity has a "fields" object where keys are field names (camelCase) and values define field properties
- Field properties include type, constraints, and relationship information

For field types:
- Use standard types: string, number, boolean, datetime, ID, int, float, decimal, date, time, json, text, email, url, uuid, bigint, binary
- For enum fields, provide the possible values in the "enumValues" array
- For relationships to other entities, use the entity name as the type
- For relationships that reference a specific field, use "EntityName.fieldName" format
- For array/collection relationships, set "isArray" to true`;

    const jsonSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        explanation: {
          type: 'string',
          description: 'Detailed explanation of the specific changes made to the schema'
        },
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entities: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  fields: {
                    type: 'object',
                    additionalProperties: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        type: { type: 'string' },
                        isArray: { type: 'boolean' },
                        isUnique: { type: 'boolean' },
                        isIndex: { type: 'boolean' },
                        isPrimary: { type: 'boolean' },
                        isNullable: { type: 'boolean' },
                        defaultValue: { type: ['string', 'null'] },
                        enumValues: {
                          type: ['array', 'null'],
                          items: { type: 'string' }
                        }
                      },
                      required: [
                        'type',
                        'isArray',
                        'isUnique',
                        'isIndex',
                        'isPrimary',
                        'isNullable',
                        'defaultValue',
                        'enumValues'
                      ]
                    }
                  }
                }
              }
            },
            relations: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  fromEntity: { type: 'string' },
                  toEntity: { type: 'string' },
                  fieldName: { type: 'string' },
                  referencedField: { type: 'string' },
                  cardinality: { type: 'string' },
                  isNullable: { type: 'boolean' }
                },
                required: [
                  'fromEntity',
                  'toEntity',
                  'fieldName',
                  'referencedField',
                  'cardinality',
                  'isNullable'
                ]
              }
            }
          },
        },
        supportedFeatures: {
          type: 'array',
          items: { type: 'string' }
        },
        changesApplied: {
          type: 'array',
          description: 'List of specific changes that were applied to the schema',
          items: { type: 'string' }
        }
      },
      required: ['explanation', 'schema', 'supportedFeatures', 'changesApplied']
    };

    messages.push({
      role: 'system',
      content: `${systemPrompt}

CURRENT SCHEMA (DO NOT CHANGE UNLESS SPECIFICALLY REQUESTED):
\`\`\`
${currentSchema}
\`\`\`

USER'S MODIFICATION REQUEST:
${content}

Your task is to apply ONLY the specific changes requested by the user to the current schema.
In your explanation, clearly list each change you made and why.
If a requested change would break the model's integrity, explain why and suggest alternatives.

IMPORTANT: For entity relationships, when an entity field references another entity:
- Set the "type" to the entity name (e.g., "User") for basic references
- For specific field references, use dot notation: "EntityName.fieldName" (e.g., "User.id")
- Set "isArray" to true for one-to-many or many-to-many relationships`
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.5, // Lower temperature for more precise modifications
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: 'data_model_assistant',
          strict: true,
          schema: jsonSchema
        },
      }
    });

    const response = JSON.parse(completion.choices[0].message.content);
    
    // Convert the JSON schema format to DSL string format - same as in generateDataModel
    const schemaString = Object.entries(response.schema.entities)
      .map(([entityName, entityData]) => {
        const fields = Object.entries(entityData.fields)
          .map(([fieldName, fieldConfig]) => {
            let fieldLine = `  ${fieldName}: `;
            
            // Handle enum type
            if (fieldConfig.enumValues && fieldConfig.enumValues.length > 0) {
              fieldLine += `enum(${fieldConfig.enumValues.join(',')})`;
            } else {
              // Use the type directly - it should already include any entity.field references
              fieldLine += fieldConfig.type + (fieldConfig.isArray ? '[]' : '');
            }

            // Add modifiers
            const modifiers = [];
            if (fieldConfig.isPrimary) modifiers.push('@primary');
            if (fieldConfig.isUnique) modifiers.push('@unique');
            if (fieldConfig.isIndex) modifiers.push('@index');
            if (fieldConfig.isNullable) modifiers.push('@nullable(true)');
            if (fieldConfig.defaultValue) modifiers.push(`@default(${fieldConfig.defaultValue})`);

            if (modifiers.length > 0) {
              fieldLine += ' ' + modifiers.join(' ');
            }

            return fieldLine;
          })
          .join('\n');

        return `entity ${entityName} {\n${fields}\n}`;
      })
      .join('\n\n');

    // Now validate the converted schema string
    const parsedSchema = parseDataModelSchema(schemaString);
    if (!parsedSchema.isValid) {
      throw new HttpError(400, {
        message: 'Modified schema is invalid',
        details: parsedSchema.errors
      });
    }

    // Save the modified schema
    await saveDataModelSchema({
      dataModelId,
      schema: schemaString
    });

    // Create a detailed explanation with the list of changes
    const detailedExplanation = `
## Schema Modifications Applied

${response.explanation}

### Specific Changes:
${response.changesApplied.map(change => `- ${change}`).join('\n')}
`;

    // Save AI's explanation as a chat message
    const aiMessage = await context.entities.ChatMessage.create({
      data: {
        content: detailedExplanation,
        sender: 'ai',
        dataModelId: parseInt(dataModelId)
      }
    });

    return {
      explanation: detailedExplanation,
      schema: schemaString,
      supportedFeatures: response.supportedFeatures,
      entities: parsedSchema.entities,
      relations: parsedSchema.relations,
      changesApplied: response.changesApplied
    };
  } catch (error) {
    console.error('Error modifying schema:', error);
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, 'Failed to modify data model schema');
  }
}
