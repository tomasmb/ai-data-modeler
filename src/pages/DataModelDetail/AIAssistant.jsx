import React, { useState } from 'react';

const AIAssistant = ({ jsonData, onUpdateJson }) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    // TODO: Implement AI chat logic
    setMessage('');
  };

  return (
    <div className='w-1/2 bg-white rounded-lg shadow p-4'>
      <h2 className='text-lg font-semibold mb-4'>AI Assistant</h2>
      <div className='h-[400px] overflow-y-auto border rounded p-4 mb-4'>
        {/* Chat messages will go here */}
      </div>
      <div className='flex gap-2'>
        <input
          type='text'
          className='flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500'
          placeholder='Type your message...'
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button 
          className='bg-blue-500 text-white px-4 py-2 rounded'
          onClick={handleSend}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default AIAssistant;