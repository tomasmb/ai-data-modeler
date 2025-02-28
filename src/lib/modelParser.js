const BUILT_IN_TYPES = [
  'string', 'number', 'boolean', 'datetime', 'ID',
  'int', 'float', 'decimal', 'date', 'time',
  'json', 'text', 'email', 'url', 'uuid',
  'bigint', 'binary', 'enum'
];

const FIELD_MODIFIERS = ['unique', 'index', 'primary', 'nullable', 'default'];

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
      // Split line into field definition parts, handling possible modifiers
      const [fieldDef, ...modifiers] = line.split('@').map(s => s.trim());
      const [fieldName, fieldType] = fieldDef.split(':').map(s => s.trim());
      
      // Validate field name
      if (!fieldName.match(/^\w+$/)) {
        errors.push(`Line ${i + 1}: Invalid field name "${fieldName}"`);
        continue;
      }

      // Parse field modifiers
      const fieldConfig = {
        type: fieldType,
        isArray: fieldType.endsWith('[]'),
        isUnique: false,
        isIndex: false,
        isPrimary: false,
        isNullable: true,
        defaultValue: undefined
      };

      // Process modifiers
      modifiers.forEach(modifier => {
        // Extract modifier name and any parameters
        const modifierMatch = modifier.match(/(\w+)(?:\((.*)\))?/);
        if (!modifierMatch) {
          errors.push(`Line ${i + 1}: Invalid modifier format "${modifier}"`);
          return;
        }
        
        const [, mod, value] = modifierMatch;
        if (!FIELD_MODIFIERS.includes(mod)) {
          errors.push(`Line ${i + 1}: Unknown modifier "${mod}"`);
          return;
        }
        
        switch (mod) {
          case 'unique':
            fieldConfig.isUnique = true;
            break;
          case 'index':
            fieldConfig.isIndex = true;
            break;
          case 'primary':
            fieldConfig.isPrimary = true;
            fieldConfig.isNullable = false;
            break;
          case 'nullable':
            fieldConfig.isNullable = value === 'true';
            break;
          case 'default':
            fieldConfig.defaultValue = value;
            break;
        }
      });

      // Handle array type notation and field references
      const baseType = fieldConfig.type.replace('[]', '');
      const [entityType, referencedField] = baseType.split('.');

      // Extract the base type for enums (e.g., "enum" from "enum(active,archived,draft)")
      const enumMatch = baseType.match(/^enum\((.*)\)$/);
      const isEnumType = enumMatch !== null;
      const baseEntityType = isEnumType ? 'enum' : entityType;

      // Validate the type
      const isBuiltInType = BUILT_IN_TYPES.includes(baseEntityType);
      const isEntityType = entities.has(baseEntityType);

      if (!isBuiltInType && !isEntityType) {
        errors.push(`Line ${i + 1}: Unknown type "${entityType}"`);
        continue;
      }

      // Parse enum values if type is enum
      if (isEnumType) {
        fieldConfig.enumValues = enumMatch[1].split(',').map(v => v.trim());
      }

      // Add field to entity
      entities.get(currentEntity).fields[fieldName] = fieldConfig;

      // Track relations for entity types
      if (!isBuiltInType && !isEnumType) {
        relations.set(`${currentEntity}.${fieldName}`, {
          fromEntity: currentEntity,
          toEntity: entityType,
          fieldName,
          referencedField: referencedField || 'id',
          cardinality: fieldConfig.isArray ? '1:n' : '1:1',
          isNullable: fieldConfig.isNullable
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
