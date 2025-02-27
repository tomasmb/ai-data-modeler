import { HttpError } from 'wasp/server'
import { parseDataModelSchema } from './lib/modelParser'
import { PrismaClient } from '@prisma/client'
import OpenAI from 'openai'
import { getDataModelSchema } from 'wasp/src/queries';

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

function getDefaultStepQuestion(step, modelInfo = {}) {
  const { name = '', description = '' } = modelInfo;
  
  switch (step) {
    case 'projectDetails':
      // Check if we have a sufficiently detailed description (more than 100 characters)
      const hasDetailedDescription = description && description.length > 100;
      
      return `🚀 ${name ? `Welcome to "${name}"! ` : "Let's start by understanding your project! "}
      
${hasDetailedDescription ? `I see you've provided a detailed description:

"${description}"

To continue, I just need one more detail:
🔹 **Industry**: Which industry does your project serve? (e.g., healthcare, logistics, finance, gaming)` 
: `${description ? `I see you've provided an initial description:

"${description}"

To create the best data model, I'll need a bit more detail about your project:` : `To generate the best data model, I need some key details:`}

🔹 **Detailed project description**: Please provide a ${description ? 'more detailed ' : ''}description of your project, including:
   - Main features and functionalities
   - Business goals and objectives
   - Problems it solves
   - Key entities and their relationships

For example:
"This is an e-commerce platform focusing on handmade artisanal products. It connects artisans with customers, handles order processing, inventory management, and includes a review system. The platform needs to track artisan profiles, product listings, customer orders, and support a recommendation engine based on customer preferences."

🔹 **Industry**: Which industry does your project serve? (e.g., healthcare, logistics, finance, gaming)`}

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
}

export const sendChatMessage = async ({ dataModelId, content, context }, ctx) => {
  if (!ctx.user) { throw new HttpError(401) }

  const dataModel = await ctx.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== ctx.user.id) { throw new HttpError(403) }

  // If this is a new step initialization, create AI message with default question
  if (context.isNewStep) {
    const defaultQuestion = getDefaultStepQuestion(context.step, { name: dataModel.name, description: dataModel.description });
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
      previousQuestion: context.previousQuestion,
      // Pass through tracking information for repeated questions
      previouslyAskedFields: context.previouslyAskedFields || {},
      attemptCounts: context.attemptCounts || {}
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
      missingFields: identifyMissingFields(aiResponse.updatedInfo),
      // Pass through tracking information for the next interaction
      previouslyAskedFields: aiResponse.previouslyAskedFields || {},
      attemptCounts: aiResponse.attemptCounts || {}
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
        if(!currentInfo.userTypes || !Array.isArray(currentInfo.userTypes) || !currentInfo.userTypes.length) {
          missingFields.push({
            field: 'userTypes',
            explanation: 'Different types of users in your system and their roles',
            importance: 'This affects user entity design and permission structures'
          });
        }
        if(!currentInfo.keyFeatures || !Array.isArray(currentInfo.keyFeatures) || !currentInfo.keyFeatures.length) {
          missingFields.push({
            field: 'keyFeatures',
            explanation: 'The main features your application provides',
            importance: 'Each feature typically requires specific entities and relationships'
          });
        }
        if(!currentInfo.dataAccess || !currentInfo.dataAccess.accessPatterns || !Array.isArray(currentInfo.dataAccess.accessPatterns) || !currentInfo.dataAccess.accessPatterns.length) {
          missingFields.push({
            field: 'dataAccess.accessPatterns',
            explanation: 'How users will access and interact with data in your system',
            importance: 'Access patterns heavily influence indexing and relationship design'
          });
        }
        if(!currentInfo.dataAccess || currentInfo.dataAccess.queryPattern === null || currentInfo.dataAccess.queryPattern === undefined) {
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
        break;
    }
    
    return missingFields;
  };

  // Get missing fields with explanations
  const missingFields = getMissingFieldsWithExplanations(context.currentStepInfo || {}, context.step);
  
  // Add tracking for repeated insufficient answers
  const previouslyAskedFields = context.previouslyAskedFields || {};
  const attemptCounts = context.attemptCounts || {};
  
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
    `- ${field.field}: ${field.explanation}
  WHY IT'S IMPORTANT: ${field.importance}
  PREVIOUSLY ASKED: ${previouslyAskedFields[field.field] ? 'Yes, ' + attemptCounts[field.field] + ' times' : 'No'}`
  ).join('\n') : 
  'All required fields have been collected for this step.'}

Information already collected for this step:
${JSON.stringify(context.currentStepInfo, null, 2)}

Complete collected information from all steps:
${JSON.stringify(context.allCollectedInfo, null, 2)}

CONVERSATION HISTORY (MAINTAIN CONTINUITY):
${context.previousMessages ? context.previousMessages.map(msg => 
  `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
).join('\n') : 'No previous messages'}

User's latest response: ${userMessage}

YOUR TASK:
1. FIRST, determine if the user is asking a specific question (not about missing information). If so, answer it directly and then continue with information gathering.
2. SECOND, carefully analyze the user's response to extract ANY information for the missing fields.
3. UPDATE the currentStepInfo with ALL information you can extract from the user's response.
4. NEVER discard information the user has already provided - only add or update.
5. For ALL remaining missing fields, create a STRUCTURED, NUMBERED LIST of specific questions.
6. For EACH missing field:
   - Explain what the information means in simple terms
   - Provide 2-3 CONCRETE EXAMPLES of possible answers
   - Explain why this information matters for their data model
   - IF this field has been asked before and received insufficient answers, provide MORE DETAILED guidance and examples
7. Format your response with clear headings and bullet points for readability.
8. End with a summary of what information is still needed.

IMPORTANT RULES:
- ONLY mention the CURRENT step. NEVER discuss next steps until the current step is completed.
- NEVER say "Thank you for providing all the necessary information" unless the current step is actually completed.
- NEVER say "We'll now continue with the next step" unless the current step is completed.
- ONLY list missing fields from the CURRENT step, not from future steps.
- Keep your response focused ONLY on the current step (${context.step}).
- Remove any extra line breaks in your formatting.`
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
  
  // Update attempt counts for tracking repeated questions
  const updatedAttemptCounts = {...attemptCounts};
  const updatedPreviouslyAskedFields = {...previouslyAskedFields};
  
  if (!response.completed) {
    // If not completed, make sure the follow-up question focuses on ALL missing fields
    const remainingMissingFields = getMissingFieldsWithExplanations(response.updatedInfo, context.step);
    
    remainingMissingFields.forEach(field => {
      updatedPreviouslyAskedFields[field.field] = true;
      updatedAttemptCounts[field.field] = (updatedAttemptCounts[field.field] || 0) + 1;
    });
    
    // Store these for the next interaction
    response.attemptCounts = updatedAttemptCounts;
    response.previouslyAskedFields = updatedPreviouslyAskedFields;
    
    if (remainingMissingFields.length > 0) {
      // Create a comprehensive follow-up question covering ALL missing fields
      let followUpQuestion = "## Information Still Needed\nTo complete your data model, I need information about the following:";
      
      remainingMissingFields.forEach((field, index) => {
        const attemptCount = updatedAttemptCounts[field.field] || 1;
        followUpQuestion += `\n### ${index + 1}. ${field.field.split('.').pop()}`;
        followUpQuestion += `\n**What it is**: ${field.explanation}`;
        followUpQuestion += `\n**Why it matters**: ${field.importance}`;
        
        // Add examples based on field type - with increasing detail for repeated questions
        followUpQuestion += `\n**Examples**:`;
        
        // Provide more detailed guidance for fields that have been asked multiple times
        if (attemptCount > 1) {
          followUpQuestion += `\n*I notice we're still working on this information. Let me provide more specific guidance:*`;
        }
        
        switch(field.field) {
          case 'description':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease include:`;
              followUpQuestion += `\n- The main purpose of your application`;
              followUpQuestion += `\n- 2-3 key features that make it unique`;
              followUpQuestion += `\n- The problem it solves for users`;
              followUpQuestion += `\n\nFor example:`;
            }
            followUpQuestion += `\n- "An e-commerce platform for selling handmade crafts with user ratings and reviews. It connects artisans directly with buyers and handles secure payments and shipping logistics."`;
            followUpQuestion += `\n- "A patient management system for dental clinics with appointment scheduling, treatment history tracking, and insurance claim processing."`;
            break;
          case 'industry':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease be specific about:`;
              followUpQuestion += `\n- The primary industry sector`;
              followUpQuestion += `\n- Any specialized sub-sector`;
              followUpQuestion += `\n- Whether it's B2B, B2C, or both`;
              followUpQuestion += `\n\nFor example:`;
            }
            followUpQuestion += `\n- "Healthcare - specifically outpatient dental services with insurance integration"`;
            followUpQuestion += `\n- "E-commerce - focusing on B2C marketplace for handcrafted goods"`;
            followUpQuestion += `\n- "FinTech - personal budgeting and investment tracking for retail consumers"`;
            break;
          case 'userTypes':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease list all user types and their roles in your system.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Admin, Customer, Vendor, Support Staff"`;
            followUpQuestion += `\n- "Doctor, Patient, Receptionist, Insurance Agent"`;
            break;
          case 'keyFeatures':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe the main features and workflows of your application.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "User authentication, product catalog, shopping cart, payment processing"`;
            followUpQuestion += `\n- "Appointment scheduling, medical records, billing, prescription management"`;
            break;
          case 'dataAccess.accessPatterns':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe how users will access and interact with data in your system.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Users frequently search products by category, price range, and ratings"`;
            followUpQuestion += `\n- "Doctors need to access patient history sorted by date and condition"`;
            break;
          case 'dataAccess.queryPattern':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe the type of queries your system will primarily use.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Simple lookups - mostly retrieving individual records by ID"`;
            followUpQuestion += `\n- "Heavy joins - frequently combining data from multiple entities"`;
            followUpQuestion += `\n- "Graph traversal - following complex relationships between entities"`;
            break;
          case 'frequentQueries':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe common data retrieval patterns in your application.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Find all orders for a specific customer within a date range"`;
            followUpQuestion += `\n- "Retrieve all products in a category with stock below threshold"`;
            break;
          case 'criticalJoins':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe joins that happen often or with large datasets.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Orders joined with OrderItems, Products, and Customer data"`;
            followUpQuestion += `\n- "Patient records joined with appointments, treatments, and billing"`;
            break;
          case 'writeOperations':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe important create/update/delete operations in your system.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Creating new orders, updating inventory levels"`;
            followUpQuestion += `\n- "Adding patient notes, updating appointment status"`;
            break;
          case 'readWriteRatio':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe whether your system is read-heavy, write-heavy, or balanced.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Read-heavy (90% reads, 10% writes)"`;
            followUpQuestion += `\n- "Balanced (50% reads, 50% writes)"`;
            followUpQuestion += `\n- "Write-heavy (30% reads, 70% writes)"`;
            break;
          case 'growthExpectations':
            if (attemptCount > 1) {
              followUpQuestion += `\nPlease describe how you expect your data volume to increase over time.`;
              followUpQuestion += `\nFor example:`;
            }
            followUpQuestion += `\n- "Steady growth to 10,000 users and 1 million records within a year"`;
            followUpQuestion += `\n- "Rapid scaling to handle 100,000+ users and 10+ million records"`;
            break;
          default:
            if (attemptCount > 1) {
              followUpQuestion += `\n- Please provide more specific details for this field. Even partial information helps.`;
            } else {
              followUpQuestion += `\n- Please provide specific details for this field`;
            }
        }
      });
      
      // Add more encouragement for repeated attempts
      if (Object.values(updatedAttemptCounts).some(count => count > 1)) {
        followUpQuestion += `\n**Tip:** Even partial or approximate information is valuable. If you're unsure about exact details, feel free to provide your best estimate or current thinking.`;
      }
      
      followUpQuestion += `\nYou can answer for multiple items at once. Every piece of information helps build a better data model for your needs.`;
      
      response.followUpQuestion = followUpQuestion;
    }
  } else {
    // If completed, add completion message with next step or final message
    const nextStep = getNextStep(context.step);
    
    // For nonFunctionalRequirements step, determine the suggested data model
    if (context.step === 'nonFunctionalRequirements' && !response.updatedInfo.suggestedDataModel) {
      // Determine the suggested data model based on collected information
      response.updatedInfo.suggestedDataModel = determineSuggestedDataModel(
        response.updatedInfo,
        context.allCollectedInfo
      );
      
      // Add explanation about the suggested data model to the message
      response.message = `Based on your requirements, I recommend using a **${response.updatedInfo.suggestedDataModel}** database for your project. ${response.message}`;
    }
    
    response.message = `Thank you for providing all the necessary information for the ${formatStepName(context.step)} step!${
      nextStep ? ` We'll now continue with the ${formatStepName(nextStep)} step.` : 
      " We've completed all the required information gathering steps!"
    } ${response.message}`;
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
  if (!stepInfo) return [];
  
  const missingFields = [];
  
  // Check fields based on the step structure
  if (stepInfo.hasOwnProperty('description') && (!stepInfo.description || stepInfo.description === null)) {
    missingFields.push('project description');
  }
  
  if (stepInfo.hasOwnProperty('industry') && (!stepInfo.industry || stepInfo.industry === null)) {
    missingFields.push('industry');
  }
  
  if (stepInfo.hasOwnProperty('userTypes') && (!stepInfo.userTypes || !stepInfo.userTypes.length)) {
    missingFields.push('user types');
  }
  
  if (stepInfo.hasOwnProperty('keyFeatures') && (!stepInfo.keyFeatures || !stepInfo.keyFeatures.length)) {
    missingFields.push('key features');
  }
  
  // Handle nested dataAccess fields with user-friendly names
  if (stepInfo.hasOwnProperty('dataAccess')) {
    if (!stepInfo.dataAccess || !stepInfo.dataAccess.accessPatterns || !stepInfo.dataAccess.accessPatterns.length) {
      missingFields.push('access patterns'); // User-friendly name
    }
    
    if (!stepInfo.dataAccess || stepInfo.dataAccess.queryPattern === null || stepInfo.dataAccess.queryPattern === undefined) {
      missingFields.push('query pattern');
    }
  }
  
  if (stepInfo.hasOwnProperty('frequentQueries') && (!stepInfo.frequentQueries || !stepInfo.frequentQueries.length)) {
    missingFields.push('frequent queries');
  }
  
  if (stepInfo.hasOwnProperty('criticalJoins') && (!stepInfo.criticalJoins || !stepInfo.criticalJoins.length)) {
    missingFields.push('critical joins');
  }
  
  if (stepInfo.hasOwnProperty('writeOperations') && (!stepInfo.writeOperations || !stepInfo.writeOperations.length)) {
    missingFields.push('write operations');
  }
  
  if (stepInfo.hasOwnProperty('readWriteRatio') && (!stepInfo.readWriteRatio || stepInfo.readWriteRatio === null)) {
    missingFields.push('read/write ratio');
  }
  
  if (stepInfo.hasOwnProperty('growthExpectations') && (!stepInfo.growthExpectations || stepInfo.growthExpectations === null)) {
    missingFields.push('growth expectations');
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
      // Check if all non-functional requirement fields are filled (except suggestedDataModel)
      return stepInfo.frequentQueries && 
             stepInfo.frequentQueries.length > 0 && 
             stepInfo.criticalJoins && 
             stepInfo.criticalJoins.length > 0 && 
             stepInfo.writeOperations && 
             stepInfo.writeOperations.length > 0 && 
             stepInfo.readWriteRatio !== null && 
             stepInfo.growthExpectations !== null;
      
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

export const generateDataModel = async ({ requirements, suggestions = [] }, ctx) => {
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

  // Add suggestions if available
  if (suggestions && suggestions.length > 0) {
    messages.push({
      role: 'system',
      content: `IMPORTANT: The user has approved the following suggestions for improving the data model. 
Make sure to incorporate ALL of these suggestions into your generated schema:

${suggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`).join('\n')}

CRITICAL INSTRUCTION: 
1. DO NOT delete or remove any entities that are not specifically mentioned for removal.
2. Preserve all existing entities and their relationships that are not directly affected by these suggestions.
3. If a suggestion involves adding a new field or relationship to an existing entity, keep all other fields and relationships of that entity intact.
4. If you're unsure whether a change would affect an entity not mentioned in the suggestions, err on the side of preservation.

These suggestions should take priority over any conflicting aspects of the requirements.
Ensure your explanation clearly describes how you've incorporated each suggestion.`
    });
  }

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

export const askDataModelQuestion = async ({ dataModelId, content, dataModelSchema, suggestions = [] }, context) => {
  if (!context.user) { throw new HttpError(401) }

  const dataModel = await context.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) }

  // Get the last 10 chat messages for context
  const recentMessages = await context.entities.ChatMessage.findMany({
    where: { dataModelId: parseInt(dataModelId) },
    orderBy: { timestamp: 'desc' },
    take: 10
  });

  // Save the user message
  const userMessage = await context.entities.ChatMessage.create({
    data: {
      content,
      sender: 'user',
      dataModelId: parseInt(dataModelId),
      timestamp: new Date().toISOString()
    }
  });

  try {
    const aiResponse = await getDataModelAnswer(content, {
      schema: dataModelSchema,
      dataModel,
      recentMessages: recentMessages.reverse(), // Reverse to get chronological order
      suggestions // Pass the current suggestions
    });

    // Save AI's response
    const aiMessage = await context.entities.ChatMessage.create({
      data: {
        content: aiResponse.content, // Only save the content part to the chat
        sender: 'ai',
        dataModelId: parseInt(dataModelId)
      }
    });

    return {
      userMessage,
      aiMessage,
      suggestions: aiResponse.suggestions // Return the updated suggestions
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
5. If the user asks about performance, suggest best practices
6. IMPORTANT: Analyze the conversation and identify potential improvements to the data model
7. For each improvement suggestion, provide a clear, concise explanation of what should be changed and why

Your response must be in JSON format with:
1. A 'content' field containing your natural language response to the user
2. A 'suggestions' array containing strings with specific data model improvement suggestions`;

  // Define JSON schema for the response
  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: {
        type: 'string',
        description: 'Natural language response to the user\'s question'
      },
      suggestions: {
        type: 'array',
        description: 'List of data model improvement suggestions',
        items: {
          type: 'string'
        }
      }
    },
    required: ['content', 'suggestions']
  };

  messages.push({ role: 'system', content: systemPrompt });
  
  // Add existing suggestions if available
  if (context.suggestions && Array.isArray(context.suggestions)) {
    messages.push({ 
      role: 'system', 
      content: `Current improvement suggestions:
${context.suggestions.map((s, i) => `${i+1}. ${s}`).join('\n')}

You can keep these suggestions if still relevant, modify them, or add new ones based on the conversation.`
    });
  }
  
  messages.push({ role: 'user', content: userMessage });

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
  return response;
}

// Add a new function to determine the suggested data model
function determineSuggestedDataModel(nonFunctionalRequirements, allCollectedInfo) {
  // Default to SQL as a safe choice
  let suggestedModel = "SQL";
  let score = {
    sql: 0,
    nosql: 0,
    graphdb: 0
  };
  
  // Analyze read/write ratio
  if (nonFunctionalRequirements.readWriteRatio) {
    const ratio = nonFunctionalRequirements.readWriteRatio.toLowerCase();
    if (ratio.includes('read-heavy')) {
      score.sql += 1;
      score.nosql += 1;
    } else if (ratio.includes('write-heavy')) {
      score.nosql += 2;
    }
  }
  
  // Analyze critical joins
  if (nonFunctionalRequirements.criticalJoins && nonFunctionalRequirements.criticalJoins.length > 0) {
    const joinCount = nonFunctionalRequirements.criticalJoins.length;
    if (joinCount >= 3) {
      score.sql += 2;
      score.graphdb += 1;
    }
  }
  
  // Analyze growth expectations
  if (nonFunctionalRequirements.growthExpectations) {
    const growth = nonFunctionalRequirements.growthExpectations.toLowerCase();
    if (growth.includes('rapid') || growth.includes('high') || 
        growth.includes('million') || growth.includes('scale')) {
      score.nosql += 2;
    }
  }
  
  // Analyze query patterns from functional requirements
  if (allCollectedInfo && allCollectedInfo.functionalRequirements && 
      allCollectedInfo.functionalRequirements.dataAccess && 
      allCollectedInfo.functionalRequirements.dataAccess.queryPattern) {
    
    const queryPattern = allCollectedInfo.functionalRequirements.dataAccess.queryPattern.toLowerCase();
    
    if (queryPattern.includes('simple lookup')) {
      score.nosql += 1;
    } else if (queryPattern.includes('heavy join')) {
      score.sql += 2;
    } else if (queryPattern.includes('graph') || queryPattern.includes('traversal')) {
      score.graphdb += 3;
    }
  }
  
  // Determine the highest score
  if (score.nosql > score.sql && score.nosql > score.graphdb) {
    suggestedModel = "NoSQL";
  } else if (score.graphdb > score.sql && score.graphdb > score.nosql) {
    suggestedModel = "GraphDB";
  } else {
    suggestedModel = "SQL";
  }
  
  return suggestedModel;
}
