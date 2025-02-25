import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, getDataModel, getDataModelSchema } from 'wasp/client/operations';
import AIAssistant from './AIAssistant';
import CodeEditor from './CodeEditor';
import ModelVisualization from './ModelVisualization';
import { ExampleSchemaModal } from './ExampleSchemaModal';

const DataModelPage = () => {
  const { id } = useParams();
  const { data: modelData, isLoadingSchema, errorSchema } = useQuery(getDataModelSchema, { dataModelId: id });
  const isNewModel = id === 'new';
  const { data: model, isLoading, error } = useQuery(
    getDataModel,
    isNewModel ? null : { id }
  );

  // State for form fields and editor
  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });
  const [jsonEditor, setJsonEditor] = useState('{}');
  const [hasChanges, setHasChanges] = useState(false);
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false);

  // Update form data when model is loaded
  useEffect(() => {
    if (model) {
      setFormData({
        name: model.name,
        description: model.description
      });
      setJsonEditor(JSON.stringify(model.definition || {}, null, 2));
    }
  }, [model]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setHasChanges(true);
  };

  const handleSaveChanges = async () => {
    // TODO: Implement save logic
    try {
      // await updateDataModel({ ...formData, id, definition: JSON.parse(jsonEditor) });
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving changes:', error);
    }
  };

  if (!isNewModel && (isLoading || isLoadingSchema)) return 'Loading...';
  if (!isNewModel && (error || errorSchema)) return 'Error: ' + (error || errorSchema);

  return (
    <div className='p-4 bg-gray-50 min-h-screen'>
      {/* Header Info */}
      <div className='bg-white p-4 rounded-lg shadow mb-6'>
        <div className='flex gap-4'>
          <div className='flex-1'>
            <label className='block text-sm font-medium text-gray-700'>Name</label>
            <input
              type='text'
              name='name'
              className='mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500'
              value={formData.name}
              onChange={handleInputChange}
            />
          </div>
          <div className='flex-1'>
            <label className='block text-sm font-medium text-gray-700'>Description</label>
            <input
              type='text'
              name='description'
              className='mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500'
              value={formData.description}
              onChange={handleInputChange}
            />
          </div>
          {!isNewModel && (
            <div className='flex-none'>
              <label className='block text-sm font-medium text-gray-700'>Version</label>
              <span className='mt-1 block text-lg'>{model.version}</span>
            </div>
          )}
          <div className='flex items-end gap-2'>
            <button
              className='bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-300'
              onClick={handleSaveChanges}
              disabled={!hasChanges}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className='flex gap-4 mb-6'>
        <AIAssistant dataModelId={id} />
        <CodeEditor
          dataModelId={id}
          modelData={modelData}
          value={jsonEditor}
          onChange={setJsonEditor}
          onSave={handleSaveChanges}
        />
      </div>

      {/* Graph Visualization */}
      {modelData && <ModelVisualization modelData={modelData.dataModel} />}

      <ExampleSchemaModal
        isOpen={isExampleModalOpen}
        onClose={() => setIsExampleModalOpen(false)}
        onApply={(exampleSchema) => {
          setJsonEditor(exampleSchema);
          setHasChanges(true);
        }}
      />
    </div>
  );
};

export default DataModelPage;