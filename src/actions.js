import { HttpError } from 'wasp/server'
import { parseDataModelSchema } from './lib/modelParser'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient();

export const createDataModel = async ({ name, version, description }, context) => {
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
    where: { id: dataModelId }
  });
  if (!dataModel) { throw new HttpError(404, 'DataModel not found') };
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) };

  return context.entities.DataModel.update({
    where: { id: dataModelId },
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

export const sendChatMessage = async ({ dataModelId, content }, context) => {
  if (!context.user) { throw new HttpError(401) }

  // Check if user has access to this data model
  const dataModel = await context.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) }

  // Save user's message
  const userMessage = await context.entities.ChatMessage.create({
    data: {
      content,
      sender: 'user',
      dataModelId: parseInt(dataModelId)
    }
  });

  // Get AI response
  try {
    const openaiResponse = await getAIResponse(content);
    
    // Save AI's response
    const aiMessage = await context.entities.ChatMessage.create({
      data: {
        content: openaiResponse,
        sender: 'ai',
        dataModelId: parseInt(dataModelId)
      }
    });

    return { userMessage, aiMessage };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new HttpError(500, 'Failed to get AI response');
  }
}

async function getAIResponse(userMessage) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful AI assistant for data modeling.' },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
}
