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

export const generateDataModel = async ({ requirements }, ctx) => {
  if (!ctx.user) { throw new HttpError(401) }

  const messages = [];
  
  const systemPrompt = `You are an expert data modeler tasked with generating a precise data model schema.
You will analyze the provided requirements and create a schema that follows our specific syntax.

Schema Syntax Rules:
1. Entity declarations use the 'entity' keyword followed by PascalCase name
2. Fields are declared with camelCase names followed by their type
3. Available built-in types: string, number, boolean, datetime, ID, int, float, decimal, date, time, json, text, email, url, uuid, bigint, binary, enum
4. Field modifiers: @unique, @index, @primary, @nullable, @default
5. Relations are expressed through field types referencing other entities
6. Array relations use [] suffix

Example Valid Schema:
entity User {
  id: ID @primary
  email: string @unique
  profile: Profile  // 1:1 relation
  posts: Post[]     // 1:n relation
}

entity Profile {
  id: ID @primary
  userId: ID @unique
  bio: text @nullable
  avatar: string @nullable
}

entity Post {
  id: ID @primary
  title: string
  content: text
  status: enum(draft,published,archived)
  authorId: ID
  author: User
  createdAt: datetime
}

Design Principles:
1. Every entity must have an ID field as primary key
2. Use appropriate indexes for frequently queried fields
3. Consider query patterns when designing relations
4. Add proper constraints (unique, nullable) based on business rules
5. Use enum types for fields with fixed value sets
6. Consider data validation and integrity requirements

Your response must be a JSON object with:
1. A detailed explanation of the model design decisions
2. The complete schema string following our syntax
3. A list of key features the schema supports`;

  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      explanation: {
        type: 'string',
        description: 'Detailed explanation of the data model design decisions'
      },
      schema: {
        type: 'string',
        description: 'The complete data model schema following the specified syntax'
      },
      supportedFeatures: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of key features this schema supports'
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
5. Security and compliance needs`
  });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      temperature: 0.7,
      response_format: { 
        type: "json_schema",
        schema: jsonSchema
      }
    });

    const response = JSON.parse(completion.choices[0].message.content);
    
    // Validate the generated schema using modelParser
    const parsedSchema = parseDataModelSchema(response.schema);
    if (!parsedSchema.isValid) {
      throw new HttpError(400, {
        message: 'Generated schema is invalid',
        details: parsedSchema.errors
      });
    }

    return {
      explanation: response.explanation,
      schema: response.schema,
      supportedFeatures: response.supportedFeatures,
      entities: parsedSchema.entities,
      relations: parsedSchema.relations
    };
  } catch (error) {
    console.error('Error generating schema:', error);
    throw new HttpError(500, 'Failed to generate data model schema');
  }
};
