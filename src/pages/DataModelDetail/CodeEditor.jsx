import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { saveDataModelSchema } from 'wasp/client/operations';
import { ExampleSchemaModal } from './ExampleSchemaModal';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';

const SchemaHintsModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-semibold">Data Model Schema Guide</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Basic Syntax Section */}
          <div>
            <h3 className="text-lg font-semibold mb-3 text-gray-800">Basic Entity Syntax</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <pre className="text-sm text-gray-700">
{`entity User {
  id: ID
  name: string
  age: number
  isActive: boolean
  createdAt: datetime
}`}</pre>
            </div>
          </div>

          {/* Field Types Section */}
          <div>
            <h3 className="text-lg font-semibold mb-3 text-gray-800">Available Field Types</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium mb-2 text-gray-700">Basic Types</h4>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li><code className="text-blue-600">string</code> - Text values</li>
                  <li><code className="text-blue-600">number</code> - Numeric values</li>
                  <li><code className="text-blue-600">boolean</code> - True/false values</li>
                  <li><code className="text-blue-600">datetime</code> - Date and time</li>
                  <li><code className="text-blue-600">ID</code> - Unique identifier</li>
                </ul>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <h4 className="font-medium mb-2 text-gray-700">Relation Types</h4>
                <ul className="space-y-1 text-sm text-gray-600">
                  <li><code className="text-blue-600">Entity</code> - Single relation</li>
                  <li><code className="text-blue-600">Entity[]</code> - Array relation</li>
                  <li><code className="text-blue-600">Entity.field</code> - Field reference</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Relations Example Section */}
          <div>
            <h3 className="text-lg font-semibold mb-3 text-gray-800">Relations Example</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <pre className="text-sm text-gray-700">
{`entity User {
  id: ID
  posts: Post[]      // One-to-many relation
  profile: Profile   // One-to-one relation
}

entity Post {
  id: ID
  author: User       // Reference to User
  title: string
  authorName: User.name  // Field reference
}`}</pre>
            </div>
          </div>

          {/* Rules and Tips Section */}
          <div>
            <h3 className="text-lg font-semibold mb-3 text-gray-800">Important Rules</h3>
            <ul className="space-y-2 text-sm text-gray-600 list-disc pl-5">
              <li>Field names must contain only letters, numbers, and underscores</li>
              <li>Entity names should start with a capital letter</li>
              <li>Comments are supported using <code className="text-blue-600">//</code></li>
              <li>Each field must have a type declaration after the colon</li>
              <li>Referenced entities must be defined in the schema</li>
            </ul>
          </div>
        </div>

        <div className="border-t p-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const CodeEditor = ({ dataModelId, modelData }) => {
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false);
  const [isHintVisible, setIsHintVisible] = useState(false);

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
          <button
            className='inline-flex items-center text-gray-600 hover:text-gray-800'
            aria-label="Show schema hints"
            onClick={() => setIsHintVisible(true)}
          >
            <QuestionMarkCircleIcon className="h-5 w-5" />
            <span className='ml-2'>Schema Hints</span>
          </button>
          
          <SchemaHintsModal
            isOpen={isHintVisible}
            onClose={() => setIsHintVisible(false)}
          />
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