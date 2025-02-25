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
                isRequired: true,
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
      return `Let's gather information about your project. Please tell me about:
1. The type of application you're building (e.g., SaaS, e-commerce, social platform)
2. A detailed description of your project
3. The industry sector it serves
4. Your target market
5. Any specific security requirements

Answer these questions so we can get started.`;

    case 'functionalRequirements':
      return `I'll help you define your functional requirements. We'll need to cover:
1. Different types of users (e.g., admin, regular users, moderators)
2. Key features
3. Main business processes
4. Required integrations with other systems
5. Data access patterns and search requirements
6. Reporting needs

With these requirements, we can start building your data model.`;

    case 'nonFunctionalRequirements':
      return `Let's define your technical requirements. We'll need to discuss:
1. Data operations (heavy read/write patterns)
2. Traffic expectations (peak users, daily average)
3. Data volume (initial size, growth rate)
4. Performance requirements
5. Geographic distribution needs
6. Data retention and archival requirements

With this information we can optimize the data model.`;

    default:
      return "How can I help you with your data model?";
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

Your mission is to help users think deeper and broader about their system requirements.
Always analyze the complete context of previously collected information to ask insightful follow-up questions.

Core Principles:
1. Never accept surface-level answers - dig deeper with specific follow-up questions
2. Use the context from previous answers to identify gaps and potential oversights
3. Help users think through implications of their requirements
4. Challenge assumptions and probe for edge cases
5. Identify missing dependencies between features

Question Strategy:
- Start broad, then systematically drill down into details
- When a feature is mentioned, explore its complete ecosystem of related features
- Use previously collected information to inform follow-up questions
- Help users think through the full lifecycle of their features

For example:
If user mentions "user profiles":
- DON'T just accept it and move on
- DO ask about: profile data structure, privacy settings, update workflows, 
  verification needs, integration with other features mentioned earlier

If discussing technical requirements:
- DON'T accept vague metrics like "high performance"
- DO ask for specific numbers, patterns, and scenarios based on previously 
  described features and user base

Remember: You have the complete context of all previously collected information.
Use this context to:
1. Identify gaps between different aspects of the system
2. Spot missing requirements that would be needed to support previously mentioned features
3. Help users think through how different parts of their system will interact
4. Challenge inconsistencies between different requirements

Important: Your role is to be a thought partner who helps users think through 
ALL implications of their requirements. Use your expertise to help them consider 
aspects they might not have thought about.`;

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
        - Clear project type classification
        - Detailed project description
        - Specific industry sector
        - Well-defined target market
        - Comprehensive security requirements

        Ask focused questions until all these aspects are clearly understood.
      `;
      jsonSchema = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          updatedInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: ['string', 'null'] },
              description: { type: ['string', 'null'] },
              industry: { type: ['string', 'null'] },
              targetMarket: { type: ['string', 'null'] },
              securityRequirements: { type: ['string', 'null'] }
            },
            required: ['type', 'description', 'industry', 'targetMarket', 'securityRequirements']
          }
        }
      };
      break;

    case 'functionalRequirements':
      systemPrompt += `
        You are gathering high-level user stories and business requirements. 
        Focus on core business functionality and main user interactions. 
        Ask about different user types and their main goals. 
        Guide the conversation to understand the key features and business processes.
        Example: "Instructors can create and publish courses" rather than "Users can reset passwords".
      `;
      jsonSchema = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          updatedInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              userStories: { 
                type: 'array',
                items: { type: 'string' }
              },
              userTypes: {
                type: 'array',
                items: { type: 'string' }
              },
              keyFeatures: {
                type: 'array',
                items: { type: 'string' }
              },
              businessProcesses: {
                type: 'array',
                items: { type: 'string' }
              },
              integrations: {
                type: 'array',
                items: { type: 'string' }
              },
              dataAccess: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  accessPatterns: { type: 'array', items: { type: 'string' } },
                  searchRequirements: { type: 'array', items: { type: 'string' } },
                  filteringNeeds: { type: 'array', items: { type: 'string' } }
                },
                required: ['accessPatterns', 'searchRequirements', 'filteringNeeds']
              },
              reportingNeeds: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['userStories', 'userTypes', 'keyFeatures', 'businessProcesses', 'integrations', 'dataAccess', 'reportingNeeds']
          }
        }
      };
      break;

    case 'nonFunctionalRequirements':
      systemPrompt += `
        You are gathering specific data operation patterns and scalability requirements.
        Ask about:
        - Which entities will have heavy read operations
        - Which entities will have heavy write operations
        - Expected read/write ratio
        - Peak concurrent users and average daily usage
        - Data volume expectations and growth
        - Performance requirements for critical operations
        - Geographic distribution needs
        Guide the user to provide specific numbers and metrics where possible.
      `;
      jsonSchema = {
        ...baseSchema,
        properties: {
          ...baseSchema.properties,
          updatedInfo: {
            type: 'object',
            additionalProperties: false,
            properties: {
              dataOperations: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  heavyRead: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      entities: { type: 'array', items: { type: 'string' } },
                      frequency: { type: ['string', 'null'] },
                      patterns: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['entities', 'frequency', 'patterns']
                  },
                  heavyWrite: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      entities: { type: 'array', items: { type: 'string' } },
                      frequency: { type: ['string', 'null'] },
                      patterns: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['entities', 'frequency', 'patterns']
                  },
                  readWriteRatio: { type: ['string', 'null'] },
                  consistencyRequirements: { type: 'array', items: { type: 'string' } }
                },
                required: ['heavyRead', 'heavyWrite', 'readWriteRatio', 'consistencyRequirements']
              },
              traffic: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  peakConcurrentUsers: { type: ['string', 'null'] },
                  averageDailyUsers: { type: ['string', 'null'] },
                  growthProjection: { type: ['string', 'null'] },
                  geographicDistribution: { type: ['string', 'null'] },
                  peakHours: { type: ['string', 'null'] },
                  seasonality: { type: ['string', 'null'] }
                },
                required: ['peakConcurrentUsers', 'averageDailyUsers', 'growthProjection', 'geographicDistribution', 'peakHours', 'seasonality']
              },
              dataVolume: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  initialSize: { type: ['string', 'null'] },
                  growthRate: { type: ['string', 'null'] },
                  recordSizeLimits: { type: ['string', 'null'] },
                  dataRetentionRequirements: { type: ['string', 'null'] },
                  archivalNeeds: { type: ['string', 'null'] }
                },
                required: ['initialSize', 'growthRate', 'recordSizeLimits', 'dataRetentionRequirements', 'archivalNeeds']
              },
              performance: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  expectedLatency: { type: ['string', 'null'] },
                  criticalOperations: { type: 'array', items: { type: 'string' } },
                  slaRequirements: { type: ['string', 'null'] },
                  cacheableEntities: { type: 'array', items: { type: 'string' } }
                },
                required: ['expectedLatency', 'criticalOperations', 'slaRequirements', 'cacheableEntities']
              }
            },
            required: ['dataOperations', 'traffic', 'dataVolume', 'performance']
          }
        }
      };
      break;
  }

  // Add conversation context
  const conversationContext = {
    currentStep: context.step,
    currentProgress: context.currentStepInfo,
    previousQuestion: context.previousQuestion,
    userResponse: userMessage
  };

  messages.push({ 
    role: 'system', 
    content: `${systemPrompt}

Current Context:
Previous question: ${context.previousQuestion || 'None'}
Current step: ${context.step}

Complete collected information so far:
${JSON.stringify(context.allCollectedInfo, null, 2)}

User's latest response: ${userMessage}

Use this context to:
1. Cross-reference with previous answers
2. Identify gaps or inconsistencies
3. Ask about missing dependencies
4. Challenge vague or incomplete responses
5. Help user think through implications`
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
  response.completed = validateStepCompletion(response.updatedInfo, context.step);
  
  return response;
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

// Helper function to validate step completion
function validateStepCompletion(info, step) {
  switch(step) {
    case 'projectDetails':
      return !!(info.type && info.description && info.industry && 
               info.targetMarket && info.securityRequirements);
    
    case 'functionalRequirements':
      return !!(info.userStories?.length && info.userTypes?.length && 
               info.keyFeatures?.length && info.businessProcesses?.length);
    
    case 'nonFunctionalRequirements':
      return !!(info.dataOperations?.heavyRead?.entities?.length && 
               info.traffic?.peakConcurrentUsers && 
               info.dataVolume?.initialSize);
    
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
