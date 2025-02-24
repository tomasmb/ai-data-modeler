import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { saveDataModelSchema } from 'wasp/client/operations';
import { ExampleSchemaModal } from './ExampleSchemaModal';

const CodeEditor = ({ dataModelId, modelData }) => {
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false);

  // Initialize editor with data from the server
  useEffect(() => {
    if (modelData?.schema) {
      setEditorValue(modelData.schema);
      setHasLocalChanges(false);
    }
  }, [modelData]);

  // Memoize the editor options
  const editorOptions = React.useMemo(() => ({
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    roundedSelection: false,
    scrollBeyondLastLine: false,
    readOnly: false,
    theme: 'vs-light',
    wordWrap: 'on',
    automaticLayout: true,
    suggestOnTriggerCharacters: true,
    tabSize: 2,
    scrollbar: {
      vertical: 'visible',
      horizontal: 'visible',
    },
  }), []);

  const handleChange = React.useCallback((newValue) => {
    setEditorValue(newValue);
    setHasLocalChanges(true);
    validateSchema(newValue);
  }, []);

  const handleEditorWillMount = React.useCallback((monaco) => {
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });

    monaco.languages.register({ id: 'datamodel' });
    monaco.languages.setMonarchTokensProvider('datamodel', {
      keywords: ['entity'],
      typeKeywords: ['string', 'number', 'boolean', 'datetime', 'ID'],
      tokenizer: {
        root: [
          [/entity/, 'keyword'],
          [/string|number|boolean|datetime|ID/, 'type'],
          [/\/\/.*$/, 'comment'],
          [/[a-zA-Z_]\w*/, 'identifier'],
          [/[{}[\]]/, 'delimiter'],
          [/:/, 'delimiter'],
        ],
      },
    });

    // Add a reference to monaco for use in validation
    window.monaco = monaco;
  }, []);

  // Create a memoized Editor wrapper component without value dependency
  const MemoizedEditor = React.useMemo(() => {
    return function EditorWrapper({ value }) {  // Accept value as a prop
      return (
        <Editor
          height={isFullScreen ? "85vh" : "400px"}
          defaultLanguage="datamodel"
          value={value}
          onChange={handleChange}
          beforeMount={handleEditorWillMount}
          options={editorOptions}
        />
      );
    };
  }, [isFullScreen, handleChange, handleEditorWillMount, editorOptions]); // Remove editorValue from dependencies

  const validateSchema = (schema) => {
    try {
      const lines = schema.split('\n');
      let entities = new Map();
      let entityFields = new Map();
      let currentEntity = null;
      let currentFields = new Map();
      let lineNumber = 0;

      // Clear existing markers first
      const monaco = window.monaco;
      const model = monaco?.editor?.getModels()[0];
      if (model) {
        monaco.editor.setModelMarkers(model, 'owner', []);
      }

      // First pass: collect all entity names
      for (const line of lines) {
        lineNumber++;
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('//') || !trimmedLine) continue;

        if (trimmedLine.startsWith('entity')) {
          const match = trimmedLine.match(/entity\s+(\w+)\s*{/);
          if (!match) {
            throw {
              message: `Invalid entity declaration`,
              lineNumber,
              line: trimmedLine
            };
          }
          const entityName = match[1];
          if (entities.has(entityName)) {
            throw {
              message: `Duplicate entity name: ${entityName}`,
              lineNumber,
              line: trimmedLine
            };
          }
          currentEntity = entityName;
          currentFields = new Map();
          entities.set(entityName, { 
            fields: currentFields,
            relationFields: new Map()
          });
        } 
        else if (currentEntity && trimmedLine.includes(':')) {
          const [fieldName, fieldType] = trimmedLine.split(':').map(s => s.trim());
          if (!fieldName || !fieldType || !fieldName.match(/^\w+$/)) {
            throw {
              message: `Invalid field declaration`,
              lineNumber,
              line: trimmedLine
            };
          }

          entityFields.set(`${currentEntity}.${fieldName}`, {
            fieldType,
            lineNumber,
            line: trimmedLine
          });

          if (currentFields.has(fieldName)) {
            throw {
              message: `Duplicate field name "${fieldName}" in entity "${currentEntity}"`,
              lineNumber,
              line: trimmedLine
            };
          }

          currentFields.set(fieldName, fieldType);
        }
      }

      // Second pass: validate all entity references and their fields
      for (const [fieldKey, fieldInfo] of entityFields) {
        const { fieldType, lineNumber, line } = fieldInfo;
        const isArray = fieldType.endsWith('[]');
        const baseType = fieldType.replace('[]', '');
        const [entityType, referencedField] = baseType.split('.');
        
        const basicTypes = ['string', 'number', 'boolean', 'datetime', 'ID'];
        
        // If it's not a basic type, validate the entity and field reference
        if (!basicTypes.includes(entityType)) {
          if (!entities.has(entityType)) {
            throw {
              message: `Referenced entity "${entityType}" is not defined in the schema`,
              lineNumber,
              line
            };
          }

          // If there's a field reference (Entity.field format), validate the field exists
          if (referencedField) {
            const referencedEntity = entities.get(entityType);
            if (!referencedEntity.fields.has(referencedField)) {
              throw {
                message: `Referenced field "${referencedField}" does not exist in entity "${entityType}"`,
                lineNumber,
                line
              };
            }
          }
        }
      }

      setParseError(null);
      return { 
        entities: Object.fromEntries([...entities].map(([name, data]) => [
          name, 
          { fields: Object.fromEntries(data.fields) }
        ])),
        relations: []
      };
    } catch (error) {
      console.error('Validation error:', error);
      
      // Add error marker to the editor
      const monaco = window.monaco;
      const model = monaco?.editor?.getModels()[0];
      
      if (model && error.lineNumber) {
        const lineContent = model.getLineContent(error.lineNumber);
        monaco.editor.setModelMarkers(model, 'owner', [{
          severity: monaco.MarkerSeverity.Error,
          message: error.message,
          startLineNumber: error.lineNumber,
          startColumn: 1,
          endLineNumber: error.lineNumber,
          endColumn: lineContent.length + 1
        }]);
      }

      setParseError(error.message || 'Invalid schema format');
      return null;
    }
  };

  const handleSave = async () => {
    if (!parseError) {
      try {
        await saveDataModelSchema({
          dataModelId,
          schema: editorValue
        });
        setHasLocalChanges(false);
      } catch (error) {
        // Ensure we get the deepest error message possible
        const errorMessage = 
          error?.response?.data?.message || // API error message
          error?.message || // Error object message
          error?.toString() || // Stringified error
          'An error occurred while saving'; // Fallback
        setParseError(errorMessage);
      }
    }
  };

  const handleRevert = () => {
    if (modelData?.schema) {
      setEditorValue(modelData.schema);
      setHasLocalChanges(false);
      setParseError(null);
    }
  };

  const handleApplyExample = (exampleSchema) => {
    setEditorValue(exampleSchema);
    setHasLocalChanges(true);
    validateSchema(exampleSchema);
  };

  return (
    <>
      <div className='w-1/2 bg-white rounded-lg shadow p-4'>
        <div className='flex justify-between mb-4'>
          <div>
            <h2 className='text-lg font-semibold'>Data Model Definition</h2>
            {parseError && (
              <p className='text-red-500 text-sm mt-1' role="alert">{parseError}</p>
            )}
          </div>
          <div className='flex gap-2'>
            <button
              className='text-gray-600 px-4 py-2 rounded hover:bg-gray-100'
              onClick={() => setIsExampleModalOpen(true)}
            >
              Load Example
            </button>
            <button
              className='text-gray-600 px-4 py-2 rounded hover:bg-gray-100'
              onClick={() => setIsFullScreen(true)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              className='text-gray-600 px-4 py-2 rounded hover:bg-gray-100 cursor-pointer'
              onClick={handleRevert}
              disabled={!hasLocalChanges}
            >
              Revert Changes
            </button>
            <button
              className='bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300'
              onClick={handleSave}
              disabled={!hasLocalChanges || parseError}
            >
              Save Changes
            </button>
          </div>
        </div>
        <MemoizedEditor value={editorValue} />
        <div className='mt-4 text-sm text-gray-600'>
          <h3 className='font-semibold mb-2'>Quick Reference:</h3>
          <ul className='list-disc pl-4 space-y-1'>
            <li>Use <code className='bg-gray-100 px-1'>entity EntityName {'{'}</code> to define a new entity</li>
            <li>Basic types: <code className='bg-gray-100 px-1'>string</code>, <code className='bg-gray-100 px-1'>number</code>, <code className='bg-gray-100 px-1'>boolean</code>, <code className='bg-gray-100 px-1'>datetime</code>, <code className='bg-gray-100 px-1'>ID</code></li>
            <li>Relations: Use entity names as types (e.g., <code className='bg-gray-100 px-1'>user: User</code>)</li>
            <li>Arrays: Add <code className='bg-gray-100 px-1'>[]</code> for multiple relations (e.g., <code className='bg-gray-100 px-1'>posts: Post[]</code>)</li>
          </ul>
        </div>
      </div>

      <ExampleSchemaModal
        isOpen={isExampleModalOpen}
        onClose={() => setIsExampleModalOpen(false)}
        onApply={handleApplyExample}
      />

      {/* Full Screen Modal */}
      {isFullScreen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-7xl h-[95vh] flex flex-col mt-4">
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h2 className="text-xl font-semibold">Data Model Definition</h2>
                {parseError && (
                  <p className='text-red-500 text-sm mt-1' role="alert">{parseError}</p>
                )}
              </div>
              <div className='flex gap-2'>
                <button
                  className='text-gray-600 px-4 py-2 rounded hover:bg-gray-100 cursor-pointer'
                  onClick={handleRevert}
                  disabled={!hasLocalChanges}
                >
                  Revert Changes
                </button>
                <button
                  className='bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300'
                  onClick={() => {
                    handleSave();
                    setIsFullScreen(false);
                  }}
                  disabled={!hasLocalChanges || parseError}
                >
                  Save Changes
                </button>
                <button
                  className='text-gray-600 px-4 py-2 rounded hover:bg-gray-100'
                  onClick={() => setIsFullScreen(false)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 overflow-hidden">
              <MemoizedEditor value={editorValue} />
            </div>
            <div className="p-4 border-t">
              {parseError && (
                <p className='text-red-500 text-sm'>{parseError}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default React.memo(CodeEditor); 