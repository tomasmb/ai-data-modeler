import React, { useState } from 'react';

const ModelInfoModal = ({ isOpen, onClose, collectedInfo, onUpdate }) => {
  const [editingSection, setEditingSection] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');

  if (!isOpen) return null;

  const handleEdit = (section, field, value) => {
    setEditingSection(section);
    setEditingField(field);
    setEditValue(value !== null ? value : '');
  };

  const handleSave = () => {
    const updatedInfo = { ...collectedInfo };
    
    // Handle nested paths (e.g., "dataAccess.accessPatterns")
    if (editingField.includes('.')) {
      const parts = editingField.split('.');
      let current = updatedInfo[editingSection];
      
      // Navigate to the nested object
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
      }
      
      // Update the value
      const lastPart = parts[parts.length - 1];
      if (Array.isArray(current[lastPart])) {
        current[lastPart] = editValue
          .split(',')
          .map(item => item.trim())
          .filter(item => item !== '');
      } else {
        current[lastPart] = editValue;
      }
    } else {
      // Handle top-level fields
      if (Array.isArray(updatedInfo[editingSection][editingField])) {
        updatedInfo[editingSection][editingField] = editValue
          .split(',')
          .map(item => item.trim())
          .filter(item => item !== '');
      } else {
        updatedInfo[editingSection][editingField] = editValue;
      }
    }
    
    onUpdate(updatedInfo);
    setEditingSection(null);
    setEditingField(null);
  };

  const renderValue = (value) => {
    if (value === null) return <span className="text-gray-400 italic">Not specified</span>;
    if (Array.isArray(value)) {
      return value.length > 0 
        ? value.map((item, i) => (
            <span key={i} className="inline-block bg-blue-100 text-blue-800 rounded-full px-2 py-1 text-xs mr-1 mb-1">
              {item}
            </span>
          ))
        : <span className="text-gray-400 italic">None</span>;
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return value;
  };

  const renderEditableField = (section, field, value) => {
    const isEditing = editingSection === section && editingField === field;
    
    // Extract just the field name for display (not the full path)
    const displayFieldName = field.includes('.') 
      ? field.split('.').pop() 
      : field;
    
    return (
      <div className="flex items-start justify-between group py-2">
        <div className="flex-1">
          <div className="font-medium text-gray-700">{formatFieldName(displayFieldName)}</div>
          <div className="mt-1">
            {isEditing ? (
              Array.isArray(value) ? (
                <textarea
                  className="w-full p-2 border rounded focus:ring-blue-500 focus:border-blue-500"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Enter values separated by commas"
                  rows={3}
                />
              ) : (
                <input
                  type="text"
                  className="w-full p-2 border rounded focus:ring-blue-500 focus:border-blue-500"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              )
            ) : (
              renderValue(value)
            )}
          </div>
        </div>
        <div className="ml-4 flex-shrink-0">
          {isEditing ? (
            <div className="flex space-x-2">
              <button
                onClick={handleSave}
                className="text-green-600 hover:text-green-800"
              >
                Save
              </button>
              <button
                onClick={() => setEditingSection(null)}
                className="text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleEdit(section, field, value)}
              className="opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-800 transition-opacity"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    );
  };

  const formatFieldName = (field) => {
    return field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  };

  const formatSectionName = (section) => {
    return section
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase());
  };

  const renderNestedObject = (section, obj, path = '') => {
    return Object.entries(obj).map(([key, value]) => {
      // Skip the 'completed' flag
      if (key === 'completed') return null;
      
      // If it's an object but not an array, render it as a nested section
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return (
          <div key={key} className="mt-4 pl-4 border-l-2 border-gray-200">
            <h4 className="font-medium text-gray-800 mb-2">{formatFieldName(key)}</h4>
            {renderNestedObject(section, value, path ? `${path}.${key}` : key)}
          </div>
        );
      }
      
      // Otherwise render as an editable field
      return (
        <div key={key} className="border-b border-gray-100 last:border-0">
          {renderEditableField(section, path ? `${path}.${key}` : key, value)}
        </div>
      );
    });
  };

  const renderSection = (section, sectionData) => {
    return (
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          {formatSectionName(section)}
          {sectionData.completed && (
            <span className="ml-2 text-sm bg-green-100 text-green-800 py-1 px-2 rounded-full">
              Completed
            </span>
          )}
        </h3>
        
        <div className="space-y-2">
          {Object.entries(sectionData).map(([key, value]) => {
            // Skip the 'completed' flag in the main rendering
            if (key === 'completed') return null;
            
            // If it's an object but not an array, render it as a nested section
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              return (
                <div key={key} className="mt-4">
                  <h4 className="font-medium text-gray-800 mb-2">{formatFieldName(key)}</h4>
                  <div className="pl-4 border-l-2 border-gray-200">
                    {renderNestedObject(section, value, key)}
                  </div>
                </div>
              );
            }
            
            // Otherwise render as an editable field
            return (
              <div key={key} className="border-b border-gray-100 last:border-0">
                {renderEditableField(section, key, value)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Data Model Information</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-8">
            {collectedInfo.projectDetails?.suggestedDataModel && (
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-md mb-6">
                <h3 className="text-xl font-semibold text-blue-800 mb-2">Suggested Data Model</h3>
                <div className="prose max-w-none">
                  <pre className="bg-white p-3 rounded shadow-sm overflow-x-auto">
                    {collectedInfo.projectDetails.suggestedDataModel}
                  </pre>
                </div>
              </div>
            )}
            
            {Object.entries(collectedInfo).map(([section, sectionData]) => (
              <div key={section}>
                {renderSection(section, sectionData)}
              </div>
            ))}
          </div>
        </div>
        
        <div className="p-6 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelInfoModal; 