const BUILT_IN_TYPES = ['string', 'number', 'boolean', 'datetime', 'ID'];

export const parseDataModelSchema = (schema) => {
  const entities = new Map();
  const relations = new Map();
  const errors = [];
  let currentEntity = null;

  // First pass: collect all entity names
  const lines = schema.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;

    if (line.startsWith('entity')) {
      const match = line.match(/entity\s+(\w+)\s*{/);
      if (!match) {
        errors.push(`Line ${i + 1}: Invalid entity declaration`);
        continue;
      }
      currentEntity = match[1];
      entities.set(currentEntity, { fields: {} });
    }
  }

  // Second pass: process fields and relations
  currentEntity = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;

    if (line.startsWith('entity')) {
      const match = line.match(/entity\s+(\w+)\s*{/);
      currentEntity = match[1];
    } else if (line.includes(':') && currentEntity) {
      const [fieldName, fieldType] = line.split(':').map(s => s.trim());
      
      // Validate field name
      if (!fieldName.match(/^\w+$/)) {
        errors.push(`Line ${i + 1}: Invalid field name "${fieldName}"`);
        continue;
      }

      // Handle array type notation and field references
      const isArray = fieldType.endsWith('[]');
      const baseType = fieldType.replace('[]', '');
      const [entityType, referencedField] = baseType.split('.');

      // Validate the type
      const isBuiltInType = BUILT_IN_TYPES.includes(entityType);
      const isEntityType = entities.has(entityType);

      if (!isBuiltInType && !isEntityType) {
        errors.push(`Line ${i + 1}: Unknown type "${entityType}"`);
        continue;
      }

      // Add field to entity
      entities.get(currentEntity).fields[fieldName] = fieldType;

      // Track relations for entity types
      if (!isBuiltInType) {
        relations.set(`${currentEntity}.${fieldName}`, {
          fromEntity: currentEntity,
          toEntity: entityType,
          fieldName,
          referencedField: referencedField || 'id',
          cardinality: isArray ? '1:n' : '1:1'
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    entities: Object.fromEntries(entities),
    relations: Object.fromEntries(relations)
  };
}; 