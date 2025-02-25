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
🔹 **What type of application are you building?** (e.g., SaaS, e-commerce, fintech, IoT, social platform).  
🔹 **Give me a brief project description** (main features, business goals, what problem it solves).  
🔹 **Which industry does it serve?** (e.g., healthcare, logistics, finance, gaming).  
🔹 **Who is your target audience?** (e.g., consumers, businesses, enterprise users).  
🔹 **Do you have any security or compliance requirements?** (e.g., GDPR, HIPAA, SOC 2, encryption).  

Let's gather these details so we can create an optimal data model!`;

    case 'functionalRequirements':
      return `📌 Now, let's define **how your system operates** so we can structure the data model effectively.  

Tell me about:  
🔹 **User roles & permissions** (e.g., Admin, Moderator, Regular User, API Client).  
🔹 **Key features & workflows** (e.g., user signup, checkout, content posting).  
🔹 **Business processes** (e.g., order fulfillment, fraud detection, recommendation systems).  
🔹 **External integrations** (e.g., Stripe for payments, Salesforce for CRM).  
🔹 **Data access patterns:**  
  - Will users frequently search/filter data?  
  - Will you have complex queries with joins?  
  - Do you need relationship-based queries (e.g., social graphs)?  
🔹 **Reporting & analytics needs:**  
  - What kind of reports or dashboards will be needed?  
  - How often will they be updated?  

This will help structure the database to support your application's core logic.`;

    case 'nonFunctionalRequirements':
      return `⚙️ Now, let's refine the **technical constraints & scalability** of your data model.  

Provide details on:  
🔹 **Read vs. Write Operations:**  
  - Will your system be **read-heavy**, **write-heavy**, or **balanced**?  
  - Which data entities will experience the most frequent operations?  
🔹 **Traffic expectations:**  
  - Estimated daily active users?  
  - Peak concurrent users?  
  - Expected API request rate (e.g., 1000 requests/sec)?  
🔹 **Data volume & growth:**  
  - Initial database size?  
  - Expected growth rate over time?  
  - Any historical data to import?  
🔹 **Performance requirements:**  
  - Target query response times?  
  - Any latency-sensitive operations?  
  - Caching needs?  
🔹 **Geographic distribution:**  
  - Will your system require **multi-region** deployment?  
  - Should data be **replicated across locations**?  
🔹 **Data retention & archival:**  
  - How long should data be kept?  
  - Do you need automated archival strategies?  
🔹 **Availability & disaster recovery:**  
  - Required uptime (99.9%, 99.99%, etc.)?  
  - Backup & recovery strategy?  
  - Multi-region failover considerations?  
🔹 **Compliance & security:**  
  - Do you need **encryption at rest** or **in transit**?  
  - Are there industry-specific compliance needs?  
  - Should data be **anonymized or tokenized** for privacy?  

Understanding these constraints will help us build a **scalable and efficient** data model.`;

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
DO ask specific questions like "What is your expected peak concurrent user count?" or "Which entities will require the most frequent read operations?"

For each missing field, provide:
1. A clear explanation of what the field means
2. Why this information is important for the data model
3. Examples of possible values or responses`;

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

        IMPORTANT: Once you have sufficient information about the project, you MUST suggest an appropriate data model type:
        - SQL/Relational: For structured data with complex relationships and ACID requirements
        - NoSQL/Document: For semi-structured data, flexible schema, and horizontal scaling
        - Graph: For highly connected data with complex relationships
        - Time-series: For time-ordered data with high write throughput
        - Columnar: For analytical workloads and data warehousing
        
        Explain your recommendation based on the project's specific needs, access patterns, and scale requirements.
        
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
              securityRequirements: { type: ['string', 'null'] },
              suggestedDataModel: { type: ['string', 'null'] },
              completed: { type: 'boolean' }
            },
            required: ['type', 'description', 'industry', 'targetMarket', 'securityRequirements', 'suggestedDataModel', 'completed']
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
              userStories: { type: 'array', items: { type: 'string' } },
              userTypes: { type: 'array', items: { type: 'string' } },
              keyFeatures: { type: 'array', items: { type: 'string' } },
              businessProcesses: { type: 'array', items: { type: 'string' } },
              integrations: { type: 'array', items: { type: 'string' } },
              dataAccess: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  accessPatterns: { type: 'array', items: { type: 'string' } },
                  searchRequirements: { type: 'array', items: { type: 'string' } },
                  filteringNeeds: { type: 'array', items: { type: 'string' } },
                  queryPattern: { type: ['string', 'null'] }
                },
                required: ['accessPatterns', 'searchRequirements', 'filteringNeeds', 'queryPattern']
              },
              reportingNeeds: { type: 'array', items: { type: 'string' } },
              completed: { type: 'boolean' }
            },
            required: ['userStories', 'userTypes', 'keyFeatures', 'businessProcesses', 'integrations', 'dataAccess', 'reportingNeeds', 'completed']
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
                  consistencyRequirements: { type: 'array', items: { type: 'string' } },
                  schemaFlexibility: { type: ['string', 'null'] }
                },
                required: ['heavyRead', 'heavyWrite', 'readWriteRatio', 'consistencyRequirements', 'schemaFlexibility']
              },
              traffic: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  peakConcurrentUsers: { type: ['string', 'null'] },
                  averageDailyUsers: { type: ['string', 'null'] },
                  growthProjection: { type: ['string', 'null'] },
                  expectedApiRequestsPerSecond: { type: ['string', 'null'] },
                  geographicDistribution: { type: ['string', 'null'] },
                  peakHours: { type: ['string', 'null'] },
                  seasonality: { type: ['string', 'null'] }
                },
                required: ['peakConcurrentUsers', 'averageDailyUsers', 'growthProjection', 'expectedApiRequestsPerSecond', 
                          'geographicDistribution', 'peakHours', 'seasonality']
              },
              dataVolume: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  initialSize: { type: ['string', 'null'] },
                  growthRate: { type: ['string', 'null'] },
                  maxRecordSize: { type: ['string', 'null'] },
                  dataRetentionRequirements: { type: ['string', 'null'] },
                  archivalNeeds: { type: ['string', 'null'] },
                  estimatedHistoricalData: { type: ['string', 'null'] },
                  storageType: { type: ['string', 'null'] }
                },
                required: ['initialSize', 'growthRate', 'maxRecordSize', 'dataRetentionRequirements', 
                          'archivalNeeds', 'estimatedHistoricalData', 'storageType']
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
              },
              availability: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  upTimeRequirements: { type: ['string', 'null'] },
                  backupRequirements: { type: ['string', 'null'] },
                  disasterRecovery: { type: ['string', 'null'] },
                  multiRegion: { type: ['string', 'null'] }
                },
                required: ['upTimeRequirements', 'backupRequirements', 'disasterRecovery', 'multiRegion']
              },
              compliance: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  dataResidency: { type: ['string', 'null'] },
                  auditRequirements: { type: ['string', 'null'] },
                  dataPrivacy: { type: ['string', 'null'] },
                  encryptionAtRest: { type: ['string', 'null'] },
                  encryptionInTransit: { type: ['string', 'null'] }
                },
                required: ['dataResidency', 'auditRequirements', 'dataPrivacy', 'encryptionAtRest', 'encryptionInTransit']
              },
              completed: { type: 'boolean' }
            },
            required: ['dataOperations', 'traffic', 'dataVolume', 'performance', 'availability', 'compliance', 'completed']
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
        if(!currentInfo.type || currentInfo.type === null) {
          missingFields.push({
            field: 'type',
            explanation: 'The type of application youre building (e.g., SaaS, e-commerce, fintech, IoT, social platform)',
            importance: 'This helps determine the core entities and relationships in your data model'
          });
        }
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
        if(!currentInfo.targetMarket || currentInfo.targetMarket === null) {
          missingFields.push({
            field: 'targetMarket',
            explanation: 'Your target audience (e.g., consumers, businesses, enterprise users)',
            importance: 'This affects user entity design and access patterns'
          });
        }
        if(!currentInfo.securityRequirements || currentInfo.securityRequirements === null) {
          missingFields.push({
            field: 'securityRequirements',
            explanation: 'Security or compliance requirements (e.g., GDPR, HIPAA, SOC 2, encryption needs)',
            importance: 'This impacts data storage, encryption, and access control in your model'
          });
        }
        if(!currentInfo.suggestedDataModel || currentInfo.suggestedDataModel === null && 
           currentInfo.type && currentInfo.description && currentInfo.industry) {
          missingFields.push({
            field: 'suggestedDataModel',
            explanation: 'Based on your project details, what database type would be most appropriate (SQL/Relational, NoSQL/Document, Graph, Time-series, etc.)',
            importance: 'This fundamental choice affects the entire structure of your data model'
          });
        }
        break;
        
      case 'functionalRequirements':
        if(!currentInfo.userStories || !currentInfo.userStories.length) {
          missingFields.push({
            field: 'userStories',
            explanation: 'Key user stories that describe what users can do in your system',
            importance: 'These translate directly to data entities and relationships'
          });
        }
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
        if(!currentInfo.businessProcesses || !currentInfo.businessProcesses.length) {
          missingFields.push({
            field: 'businessProcesses',
            explanation: 'Key business workflows and processes your system supports',
            importance: 'These often require specific data structures and state tracking'
          });
        }
        if(!currentInfo.integrations || !currentInfo.integrations.length) {
          missingFields.push({
            field: 'integrations',
            explanation: 'External systems or services your application will integrate with',
            importance: 'Integrations often require specific data structures for compatibility'
          });
        }
        if(!currentInfo.dataAccess || !currentInfo.dataAccess.accessPatterns || !currentInfo.dataAccess.accessPatterns.length) {
          missingFields.push({
            field: 'dataAccess.accessPatterns',
            explanation: 'How users will access and interact with data in your system',
            importance: 'Access patterns heavily influence indexing and relationship design'
          });
        }
        if(!currentInfo.reportingNeeds || !currentInfo.reportingNeeds.length) {
          missingFields.push({
            field: 'reportingNeeds',
            explanation: 'Reports or analytics your system needs to generate',
            importance: 'Reporting requirements often influence denormalization and indexing strategies'
          });
        }
        break;
        
      case 'nonFunctionalRequirements':
        if(!currentInfo.dataOperations?.heavyRead?.entities || !currentInfo.dataOperations.heavyRead.entities.length) {
          missingFields.push({
            field: 'dataOperations.heavyRead.entities',
            explanation: 'Which entities will experience the most read operations',
            importance: 'High-read entities often need special indexing and caching strategies'
          });
        }
        if(!currentInfo.dataOperations?.heavyWrite?.entities || !currentInfo.dataOperations.heavyWrite.entities.length) {
          missingFields.push({
            field: 'dataOperations.heavyWrite.entities',
            explanation: 'Which entities will experience the most write operations',
            importance: 'High-write entities may need special considerations for performance and concurrency'
          });
        }
        if(!currentInfo.traffic?.peakConcurrentUsers || currentInfo.traffic.peakConcurrentUsers === null) {
          missingFields.push({
            field: 'traffic.peakConcurrentUsers',
            explanation: 'Maximum number of users expected to use the system simultaneously',
            importance: 'This affects database connection pooling and scaling strategies'
          });
        }
        if(!currentInfo.dataVolume?.initialSize || currentInfo.dataVolume.initialSize === null) {
          missingFields.push({
            field: 'dataVolume.initialSize',
            explanation: 'Expected initial size of your database (e.g., number of records, GB)',
            importance: 'This helps determine initial provisioning and indexing strategies'
          });
        }
        if(!currentInfo.dataVolume?.growthRate || currentInfo.dataVolume.growthRate === null) {
          missingFields.push({
            field: 'dataVolume.growthRate',
            explanation: 'Expected growth rate of your data over time',
            importance: 'This affects partitioning strategies and long-term storage planning'
          });
        }
        if(!currentInfo.performance?.expectedLatency || currentInfo.performance.expectedLatency === null) {
          missingFields.push({
            field: 'performance.expectedLatency',
            explanation: 'Maximum acceptable response time for critical operations',
            importance: 'This influences indexing, caching, and query optimization strategies'
          });
        }
        if(!currentInfo.availability?.upTimeRequirements || currentInfo.availability.upTimeRequirements === null) {
          missingFields.push({
            field: 'availability.upTimeRequirements',
            explanation: 'Required system uptime (e.g., 99.9%, 99.99%)',
            importance: 'This affects replication, failover, and backup strategies'
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
1. Analyze the user's response to extract any information for the missing fields
2. Ask DIRECT questions about ALL remaining missing fields
3. For each question, explain what the information means and why it's important
4. Provide examples of possible answers to guide the user
5. DO NOT ask open-ended exploratory questions - focus on collecting specific missing data
6. Structure your response with clear headings for each missing field`
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
  return currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null;
}

// Helper function to format step name for display
function formatStepName(step) {
  switch(step) {
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
