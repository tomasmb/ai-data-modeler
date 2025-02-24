import { HttpError } from 'wasp/server'

export const getDataModels = async (args, context) => {
  if (!context.user) { throw new HttpError(401) }

  return context.entities.DataModel.findMany({
    where: {
      userId: context.user.id
    }
  });
}

export const getDataModel = async ({ id }, context) => {
  if (!context.user) { throw new HttpError(401) }
  if (!id) { throw new HttpError(400, 'Data model ID is required') }

  const dataModel = await context.entities.DataModel.findUnique({
    where: {
      id: parseInt(id)
    }
  });
  
  if (!dataModel) throw new HttpError(404, 'Data model not found');
  
  return dataModel;
}

export const getDataModelSchema = async ({ dataModelId }, context) => {
  if (!context.user) { throw new HttpError(401) };

  const dataModel = await context.entities.DataModel.findUnique({
    where: { 
      id: parseInt(dataModelId) 
    },
    include: {
      entities: {
        include: {
          fields: {
            include: {
              fromRelations: true,
              toRelations: true
            }
          },
          fromRelations: {
            include: {
              fromField: true,
              toField: true,
              toEntity: true
            }
          },
          toRelations: {
            include: {
              fromField: true,
              toField: true,
              fromEntity: true
            }
          }
        }
      }
    }
  });

  if (!dataModel) { throw new HttpError(404, 'DataModel not found') };
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) };

  // Convert the database model back to DSL format
  let schema = '';
  
  for (const entity of dataModel.entities) {
    schema += `entity ${entity.name} {\n`;
    
    // Add regular fields
    for (const field of entity.fields) {
      // Skip fields that are part of relations as they'll be handled separately
      if (!field.fromRelations || field.fromRelations.length === 0) {
        schema += `  ${field.name}: ${field.fieldType}\n`;
      }
    }

    // Add relation fields
    for (const relation of entity.fromRelations) {
      const baseType = relation.toEntity.name;
      const referencedField = relation.toField.name !== 'id' 
        ? `.${relation.toField.name}` 
        : '';
      const fieldType = baseType + referencedField + (relation.cardinality === '1:n' ? '[]' : '');
      schema += `  ${relation.fromField.name}: ${fieldType}\n`;
    }
    
    schema += '}\n\n';
  }

  return {
    schema: schema.trim(),
    dataModel
  };
};

export const getDataModelChatHistory = async ({ dataModelId }, context) => {
  if (!context.user) { throw new HttpError(401) }

  const dataModel = await context.entities.DataModel.findUnique({
    where: { id: parseInt(dataModelId) },
    include: {
      chatMessages: {
        orderBy: { timestamp: 'asc' }
      }
    }
  });

  if (!dataModel) { throw new HttpError(404, 'Data model not found') }
  if (dataModel.userId !== context.user.id) { throw new HttpError(403) }

  return dataModel.chatMessages;
}
