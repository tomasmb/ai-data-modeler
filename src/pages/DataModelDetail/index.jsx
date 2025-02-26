import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, getDataModel, getDataModelSchema, updateDataModel, createDataModel } from 'wasp/client/operations';
import { NewModelModal } from './NewModelModal';
import AIAssistant from './AIAssistant';
import CodeEditor from './CodeEditor';
import ModelVisualization from './ModelVisualization';
import { ExampleSchemaModal } from './ExampleSchemaModal';

const DataModelPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNewModel = id === 'new';
  const [isCreating, setIsCreating] = useState(false);

  // For new models only
  const handleCreateNewModel = async (newModelData) => {
    try {
      setIsCreating(true);
      const createdModel = await createDataModel({
        name: newModelData.name,
        description: newModelData.description,
        definition: {}
      });
      if (createdModel?.id) {
        // Add a small delay to ensure server processing is complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        window.location.replace(`/data-model/${createdModel.id}`);
      } else {
        console.error('Created model missing ID');
      }
    } catch (error) {
      console.error('Error creating model:', error);
    } finally {
      setIsCreating(false);
    }
  };

  // Early return for new model
  if (isNewModel) {
    return (
      <NewModelModal 
        onSubmit={handleCreateNewModel} 
        onCancel={() => navigate('/data-models')}
        isLoading={isCreating}
      />
    );
  }

  // Add refetch function from useQuery
  const { data: modelData, isLoadingSchema, errorSchema, refetch: refetchSchema } = useQuery(
    getDataModelSchema, 
    { dataModelId: id },
    { enabled: !isNewModel && !!id }
  );

  const { data: model, isLoading, error } = useQuery(
    getDataModel,
    { id },
    { enabled: !isNewModel && !!id }
  );

  const [formData, setFormData] = useState({
    name: '',
    description: ''
  });
  const [jsonEditor, setJsonEditor] = useState('{}');
  const [hasChanges, setHasChanges] = useState(false);
  const [isExampleModalOpen, setIsExampleModalOpen] = useState(false);

  useEffect(() => {
    if (model) {
      setFormData({
        name: model.name || '',
        description: model.description || ''
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
    try {
      await updateDataModel({
        dataModelId: id,
        name: formData.name,
        description: formData.description,
      });
      setHasChanges(false);
    } catch (error) {
      console.error('Error saving changes:', error);
    }
  };

  const handleSchemaGenerated = async (schema) => {
    // Update the local state
    if (modelData) {
      modelData.schema = schema;
    }
    
    // Refetch the schema data to ensure we have the latest version
    await refetchSchema();
  };

  if (isLoading || isLoadingSchema) return 'Loading...';
  if (error || errorSchema) return 'Error: ' + (error || errorSchema);

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
          <div className='flex-none'>
            <label className='block text-sm font-medium text-gray-700'>Version</label>
            <span className='mt-1 block text-lg'>{model?.version}</span>
          </div>
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

      <div className='flex gap-4 mb-6'>
        <AIAssistant 
          dataModelId={id} 
          onSchemaGenerated={handleSchemaGenerated}
          modelData={model}
          modelDataSchema={modelData.schema}
        />
        <CodeEditor
          dataModelId={id}
          modelData={modelData}
          value={jsonEditor}
          onChange={setJsonEditor}
          onSave={handleSaveChanges}
        />
      </div>

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