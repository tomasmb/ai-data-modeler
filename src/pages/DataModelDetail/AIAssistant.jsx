import React, { useState, useEffect, useRef } from 'react';
import { useQuery, getDataModelChatHistory, sendChatMessage } from 'wasp/client/operations';

const AIAssistant = ({ dataModelId }) => {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  const { data: chatHistory = [] } = useQuery(getDataModelChatHistory, { dataModelId });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ 
      behavior: "smooth",
      block: "end"
    });
  };

  useEffect(() => {
    if (chatHistory.length > 0) {
      const messagesContainer = messagesEndRef.current?.parentElement;
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }, [chatHistory]);

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    setIsLoading(true);
    try {
      await sendChatMessage({ dataModelId, content: message.trim() });
      setMessage('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className='w-full md:w-1/2 bg-white rounded-lg shadow-lg p-4 flex flex-col'>
      <h2 className='text-xl font-semibold mb-4'>AI Assistant</h2>
      
      <div className='flex-1 overflow-hidden relative'>
        <div className='absolute inset-0 overflow-y-auto space-y-4 p-2'>
          {chatHistory.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  msg.sender === 'user'
                    ? 'bg-blue-500 text-white rounded-br-none'
                    : 'bg-gray-100 text-gray-800 rounded-bl-none'
                }`}
              >
                <p className='whitespace-pre-wrap'>{msg.content}</p>
                <span className='text-xs opacity-70 mt-1 block'>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className='flex justify-start'>
              <div className='bg-gray-100 rounded-lg p-4 rounded-bl-none'>
                <div className='flex space-x-2 items-center'>
                  <div className='w-2 h-2 bg-gray-400 rounded-full animate-bounce' style={{ animationDelay: '0ms' }}></div>
                  <div className='w-2 h-2 bg-gray-400 rounded-full animate-bounce' style={{ animationDelay: '150ms' }}></div>
                  <div className='w-2 h-2 bg-gray-400 rounded-full animate-bounce' style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className='flex gap-2 items-end'>
        <textarea
          ref={inputRef}
          className='flex-1 rounded-lg border-2 border-gray-300 p-2 focus:border-blue-500 focus:ring focus:ring-blue-200 focus:ring-opacity-50 resize-none'
          placeholder='Type your message...'
          rows={1}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          style={{ minHeight: '44px', maxHeight: '120px' }}
        />
        <button
          className={`px-4 py-2 rounded-lg font-medium ${
            isLoading || !message.trim()
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700'
          } text-white transition-colors`}
          onClick={handleSend}
          disabled={isLoading || !message.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default AIAssistant;