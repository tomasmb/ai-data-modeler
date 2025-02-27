import React, { useState } from 'react';

const SuggestionsModal = ({ isOpen, onClose, suggestions, onApplyChanges }) => {
  const [isApplying, setIsApplying] = useState(false);
  
  if (!isOpen) return null;
  
  const handleApplyChanges = () => {
    setIsApplying(true);
    onApplyChanges();
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
          {suggestions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No suggestions available. The AI will provide suggestions as you discuss your data model.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-gray-700 mb-4">
                The AI has analyzed your data model and conversation and suggests the following improvements.
                Click "Apply Changes" to regenerate your data model with these suggestions:
              </p>
              <ul className="space-y-4">
                {suggestions.map((suggestion, index) => (
                  <li key={index} className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                    <div className="flex items-start">
                      <div className="bg-blue-100 text-blue-800 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0">
                        {index + 1}
                      </div>
                      <p className="text-gray-800">{suggestion}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
            disabled={suggestions.length === 0 || isApplying}
            className={`px-4 py-2 rounded transition-colors ${
              suggestions.length === 0 || isApplying
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