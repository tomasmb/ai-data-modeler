import React, { useState } from 'react';

const SuggestionsModal = ({ isOpen, onClose, suggestions, onApplyChanges }) => {
  const [isApplying, setIsApplying] = useState(false);
  const [editingSuggestions, setEditingSuggestions] = useState([]);
  const [newSuggestion, setNewSuggestion] = useState('');
  const [editIndex, setEditIndex] = useState(null);
  
  // Initialize editing suggestions when modal opens or suggestions change
  React.useEffect(() => {
    if (isOpen) {
      setEditingSuggestions([...suggestions]);
    }
  }, [isOpen, suggestions]);
  
  if (!isOpen) return null;
  
  const handleApplyChanges = () => {
    setIsApplying(true);
    // Pass the edited suggestions back to the parent component
    onApplyChanges(editingSuggestions);
  };
  
  const handleAddSuggestion = () => {
    if (newSuggestion.trim()) {
      setEditingSuggestions([...editingSuggestions, newSuggestion.trim()]);
      setNewSuggestion('');
    }
  };
  
  const handleDeleteSuggestion = (index) => {
    const updatedSuggestions = [...editingSuggestions];
    updatedSuggestions.splice(index, 1);
    setEditingSuggestions(updatedSuggestions);
  };
  
  const handleEditSuggestion = (index) => {
    setEditIndex(index);
    setNewSuggestion(editingSuggestions[index]);
  };
  
  const handleSaveEdit = () => {
    if (editIndex !== null && newSuggestion.trim()) {
      const updatedSuggestions = [...editingSuggestions];
      updatedSuggestions[editIndex] = newSuggestion.trim();
      setEditingSuggestions(updatedSuggestions);
      setEditIndex(null);
      setNewSuggestion('');
    }
  };
  
  const handleCancelEdit = () => {
    setEditIndex(null);
    setNewSuggestion('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Data Model Suggestions</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
            disabled={isApplying}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {editingSuggestions.length === 0 && !newSuggestion ? (
            <div className="text-center py-8 text-gray-500">
              <p>No suggestions available. The AI will provide suggestions as you discuss your data model.</p>
              <p className="mt-2">You can also add your own suggestions below.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-gray-700 mb-4">
                The AI has analyzed your data model and conversation and suggests the following improvements.
                You can add, edit, or delete suggestions before applying them.
                Click "Apply Changes" to regenerate your data model with these suggestions:
              </p>
              <ul className="space-y-4">
                {editingSuggestions.map((suggestion, index) => (
                  <li key={index} className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start flex-1">
                        <div className="bg-blue-100 text-blue-800 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0">
                          {index + 1}
                        </div>
                        <p className="text-gray-800">{suggestion}</p>
                      </div>
                      <div className="flex space-x-2 ml-4">
                        <button 
                          onClick={() => handleEditSuggestion(index)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Edit suggestion"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button 
                          onClick={() => handleDeleteSuggestion(index)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete suggestion"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="mt-6 border-t pt-4">
            <h3 className="text-lg font-semibold mb-2">
              {editIndex !== null ? 'Edit Suggestion' : 'Add New Suggestion'}
            </h3>
            <div className="flex items-start">
              <textarea
                value={newSuggestion}
                onChange={(e) => setNewSuggestion(e.target.value)}
                placeholder="Enter a new suggestion..."
                className="flex-1 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[80px]"
              />
              <div className="ml-2 space-y-2">
                {editIndex !== null ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      disabled={!newSuggestion.trim()}
                      className={`w-full px-3 py-2 rounded ${
                        !newSuggestion.trim() 
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                          : 'bg-green-500 text-white hover:bg-green-600'
                      }`}
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="w-full px-3 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleAddSuggestion}
                    disabled={!newSuggestion.trim()}
                    className={`w-full px-3 py-2 rounded ${
                      !newSuggestion.trim() 
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="p-6 border-t border-gray-200 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
            disabled={isApplying}
          >
            Close
          </button>
          <button
            onClick={handleApplyChanges}
            disabled={editingSuggestions.length === 0 || isApplying}
            className={`px-4 py-2 rounded transition-colors ${
              editingSuggestions.length === 0 || isApplying
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            {isApplying ? 'Applying Changes...' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuggestionsModal; 