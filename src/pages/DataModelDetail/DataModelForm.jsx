import React from 'react';

export const DataModelForm = ({ formData, onChange, onSave, hasChanges, version }) => {
  return (
    <div className='bg-white p-4 rounded-lg shadow mb-6'>
      <div className='flex gap-4'>
        <div className='flex-1'>
          <label className='block text-sm font-medium text-gray-700'>Name</label>
          <input
            type='text'
            name='name'
            className='mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500'
            value={formData.name}
            onChange={onChange}
          />
        </div>
        <div className='flex-1'>
          <label className='block text-sm font-medium text-gray-700'>Description</label>
          <input
            type='text'
            name='description'
            className='mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500'
            value={formData.description}
            onChange={onChange}
          />
        </div>
        {version !== undefined && (
          <div className='flex-none'>
            <label className='block text-sm font-medium text-gray-700'>Version</label>
            <span className='mt-1 block text-lg'>{version}</span>
          </div>
        )}
        <div className='flex items-end gap-2'>
          <button
            className='px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300'
            onClick={onSave}
            disabled={!hasChanges}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}; 