import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, getDataModelChatHistory, sendChatMessage, saveDataModelRequirements, generateDataModel, saveDataModelSchema, askDataModelQuestion } from 'wasp/client/operations';
import ModelInfoModal from './ModelInfoModal';

const AIAssistant = ({ dataModelId, onSchemaGenerated, modelData }) => {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [phase, setPhase] = useState('structured'); // 'structured' or 'free'
  const [currentStep, setCurrentStep] = useState('projectDetails'); // 'projectDetails', 'functionalRequirements', 'nonFunctionalRequirements'
  const [chatMode, setChatMode] = useState('questions'); // 'questions' or 'modifications'
  const [generationExplanation, setGenerationExplanation] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [collectedInfo, setCollectedInfo] = useState(() => {
    const saved = localStorage.getItem(`collectedInfo-${dataModelId}`);
    return saved ? JSON.parse(saved) : {
      projectDetails: {
        type: null, 
        description: null,
        industry: null,
        targetMarket: null,
        securityRequirements: null, 
        suggestedDataModel: null, // AI-driven recommendation (SQL, NoSQL, GraphDB)
        completed: false
      },
      functionalRequirements: {
        userStories: [],
        userTypes: [],
        keyFeatures: [],
        businessProcesses: [],
        integrations: [],
        dataAccess: {
          accessPatterns: [],
          searchRequirements: [],
          filteringNeeds: [],
          queryPattern: null, // Updated: "simple lookups", "heavy joins", "graph traversal"
        },
        reportingNeeds: [],
        completed: false
      },
      nonFunctionalRequirements: {
        dataOperations: {
          heavyRead: {
            entities: [],
            frequency: null,
            patterns: [],
          },
          heavyWrite: {
            entities: [],
            frequency: null,
            patterns: [],
          },
          readWriteRatio: null,
          consistencyRequirements: [], // e.g., "strong", "eventual", "custom"
          schemaFlexibility: null, // "low", "medium", "high"
        },
        traffic: {
          peakConcurrentUsers: null,
          averageDailyUsers: null,
          growthProjection: null,
          expectedApiRequestsPerSecond: null, // Added: API request scaling estimates
          geographicDistribution: null,
          peakHours: null,
          seasonality: null, // Added: Handling spikes due to seasonal trends
        },
        dataVolume: {
          initialSize: null,
          growthRate: null,
          maxRecordSize: null, // Updated: Clarified as maximum size per record
          dataRetentionRequirements: null,
          archivalNeeds: null,
          estimatedHistoricalData: null, // Added: Useful for ML-based forecasting
          storageType: null, // Added: Structured (RDBMS) vs. Unstructured (Object Storage)
        },
        performance: {
          expectedLatency: null,
          criticalOperations: [],
          slaRequirements: null,
          cacheableEntities: [],
        },
        availability: {
          upTimeRequirements: null,
          backupRequirements: null,
          disasterRecovery: null,
          multiRegion: null,
        },
        compliance: {
          dataResidency: null,
          auditRequirements: null,
          dataPrivacy: null,
          encryptionAtRest: null, // Ensuring database security compliance
          encryptionInTransit: null, // Security for API calls
        },
        completed: false
      }
    };
  });
  
  // Add local chat history state that will be updated immediately for UI purposes
  const [localChatHistory, setChatHistory] = useState([]);
  
  // Get the server chat history
  const { data: serverChatHistory = [] } = useQuery(getDataModelChatHistory, { dataModelId });
  
  // Combine server and local chat history
  const chatHistory = useMemo(() => {
    // If we have server data, use it as the base, otherwise use local state
    if (serverChatHistory.length > 0) {
      return serverChatHistory;
    }
    return localChatHistory;
  }, [serverChatHistory, localChatHistory]);

  const [previousQuestion, setPreviousQuestion] = useState(null);
  const [initializedSteps, setInitializedSteps] = useState(() => {
    const saved = localStorage.getItem(`initializedSteps-${dataModelId}`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  // Add effect to save initializedSteps to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(
      `initializedSteps-${dataModelId}`,
      JSON.stringify([...initializedSteps])
    );
  }, [initializedSteps, dataModelId]);

  // Add effect to save collectedInfo to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(
      `collectedInfo-${dataModelId}`,
      JSON.stringify(collectedInfo)
    );
    
    // Save to database whenever collectedInfo changes
    const saveRequirements = async () => {
      try {
        await saveDataModelRequirements({
          dataModelId,
          requirements: collectedInfo
        });
      } catch (error) {
        console.error('Error saving requirements to database:', error);
      }
    };
    
    saveRequirements();
  }, [collectedInfo, dataModelId]);

  // Add persistence for phase and chatMode
  useEffect(() => {
    const savedPhase = localStorage.getItem(`phase-${dataModelId}`);
    const savedChatMode = localStorage.getItem(`chatMode-${dataModelId}`);
    if (savedPhase) setPhase(savedPhase);
    if (savedChatMode) setChatMode(savedChatMode);
  }, [dataModelId]);

  // Save phase and chatMode when they change
  useEffect(() => {
    localStorage.setItem(`phase-${dataModelId}`, phase);
  }, [phase, dataModelId]);

  useEffect(() => {
    localStorage.setItem(`chatMode-${dataModelId}`, chatMode);
  }, [chatMode, dataModelId]);

  // Calculate progress based on completed steps
  const calculateProgress = useCallback(() => {
    const steps = Object.values(collectedInfo);
    const completedSteps = steps.filter(step => step.completed).length;
    return Math.round((completedSteps / steps.length) * 100);
  }, [collectedInfo]);

  useEffect(() => {
    if (chatHistory.length > 0) {
      const messagesContainer = messagesEndRef.current?.parentElement;
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }
  }, [chatHistory]);

  // Add a mounting ref to prevent multiple initializations
  const isMounted = useRef(false);

  // Handle step initialization
  const initializeStep = async (step) => {
    // Check if step is already initialized
    if (initializedSteps.has(step)) {
      return;
    }

    // Check if there are any AI messages for this step in chat history
    const stepHasMessages = chatHistory.some(msg => 
      msg.sender === 'ai' && 
      msg.metadata?.isInitialMessage && 
      msg.metadata?.step === step
    );

    if (stepHasMessages) {
      setInitializedSteps(prev => new Set([...prev, step]));
      return;
    }

    setIsLoading(true);
    try {
      const response = await sendChatMessage({
        dataModelId,
        content: '',
        context: {
          phase,
          step,
          currentStepInfo: collectedInfo[step],
          previousQuestion: null,
          isNewStep: true,
          isInitialMessage: true
        }
      });

      if (response.followUpQuestion) {
        setPreviousQuestion(response.followUpQuestion);
      }
      
      setInitializedSteps(prev => new Set([...prev, step]));
    } catch (error) {
      console.error('Error initializing step:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Initialize first step on component mount
  useEffect(() => {
    if (!isMounted.current && chatHistory.length === 0 && !initializedSteps.has('projectDetails')) {
      isMounted.current = true;
      initializeStep('projectDetails');
    }
  }, [chatHistory]);

  // Modify the handlePhaseTransition function
  const handlePhaseTransition = async () => {
    setIsGenerating(true);
    try {
      // Generate the schema
      const result = await generateDataModel({
        requirements: collectedInfo
      });

      // Save the generated schema to the database
      await saveDataModelSchema({
        dataModelId,
        schema: result.schema
      });

      // Update the CodeEditor via parent component
      onSchemaGenerated(result.schema);

      // Add the explanation as a system message in the chat
      const explanationMessage = {
        sender: 'ai',
        content: `Data Model Generated Successfully\n\n${result.explanation}`,
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, explanationMessage]);
      
      // Move to free phase
      setPhase('free');
      setChatMode('questions');

      // Force a refresh of the page to get the latest schema
      window.location.reload();
    } catch (error) {
      console.error('Error generating schema:', error);
      
      // Add error message to chat
      const errorMessage = {
        sender: 'ai',
        content: `❌ Error generating schema: ${error.message || 'An unknown error occurred'}`,
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Similarly update the handleTestGeneration function
  const handleTestGeneration = async () => {
    setIsGenerating(true);
    try {
      // Generate the schema
      const result = await generateDataModel({
        requirements: collectedInfo
      });

      // Save the generated schema to the database
      await saveDataModelSchema({
        dataModelId,
        schema: result.schema
      });

      // Update the CodeEditor via parent component
      onSchemaGenerated(result.schema);
      
      // Add the explanation as a system message in the chat
      const explanationMessage = {
        sender: 'ai',
        content: `Data Model Generated Successfully\n\n${result.explanation}`,
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, explanationMessage]);
      
    } catch (error) {
      console.error('Error generating schema:', error);
      
      // Add error message to chat
      const errorMessage = {
        sender: 'ai',
        content: `❌ Error generating schema: ${error.message || 'An unknown error occurred'}`,
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Modify the handleSend function to show loading state during modifications
  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage('');
    setIsLoading(true);
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = '56px';
    }

    // Add user message to chat history immediately
    const userMessageObj = {
      sender: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    };
    
    // Create a new array with the user message added
    const updatedChatHistory = [...chatHistory, userMessageObj];
    
    // Update local chat history state
    setChatHistory(updatedChatHistory);
    
    // Add immediate scroll after adding message
    setTimeout(() => {
      const messagesContainer = messagesEndRef.current?.parentElement;
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 0);

    try {
      // Use different actions based on the phase
      if (phase === 'structured') {
        const response = await sendChatMessage({ 
          dataModelId, 
          content: userMessage,
          context: {
            phase,
            step: currentStep,
            allCollectedInfo: collectedInfo,
            currentStepInfo: collectedInfo[currentStep],
            previousQuestion,
            isNewStep: false
          }
        });
        
        // Update collected info with AI's response
        if (response.updatedInfo) {
          setCollectedInfo(prev => ({
            ...prev,
            [currentStep]: {
              ...response.updatedInfo,
              completed: response.completed
            }
          }));

          // Store the follow-up question for next context
          setPreviousQuestion(response.followUpQuestion);

          // Handle step completion and phase transition
          if (response.completed) {
            const nextStep = (() => {
              switch (currentStep) {
                case 'projectDetails':
                  return 'functionalRequirements';
                case 'functionalRequirements':
                  return 'nonFunctionalRequirements';
                case 'nonFunctionalRequirements':
                  return null;
                default:
                  return null;
              }
            })();

            if (nextStep) {
              setCurrentStep(nextStep);
              await initializeStep(nextStep);
            } else {
              // No need to save requirements again, just transition to the next phase
              try {
                await handlePhaseTransition();
              } catch (error) {
                console.error('Error in phase transition:', error);
              }
            }
            setPreviousQuestion(null);
          }
        }
      } else {
        // Free phase - use the askDataModelQuestion action
        if (chatMode === 'modifications') {
          // For modifications, show the generating overlay
          setIsGenerating(true);
          
          // For modifications, we need to handle the schema update
          const response = await askDataModelQuestion({
            dataModelId,
            content: userMessage,
            chatMode
          });
          
          // The response should include the schema if modification was successful
          if (response.schema) {
            // Update the schema in the editor
            onSchemaGenerated(response.schema);
            
            // Add a system message to indicate the schema was updated
            const systemMessage = {
              sender: 'ai',
              content: '✅ Schema has been updated successfully!',
              timestamp: new Date().toISOString()
            };
            
            // Update local chat history with the system message
            setChatHistory(prev => [...prev, systemMessage]);
          }
          
          // Hide the generating overlay
          setIsGenerating(false);
        } else {
          // For questions, just send the message and get a response
          await askDataModelQuestion({
            dataModelId,
            content: userMessage,
            chatMode
          });
        }
      }
      
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Add error message to chat
      const errorMessage = {
        sender: 'ai',
        content: `❌ Error: ${error.message || 'Failed to process your request'}`,
        timestamp: new Date().toISOString()
      };
      
      // Update local chat history with the error message
      setChatHistory(prev => [...prev, errorMessage]);
      
      // Make sure to hide the generating overlay if there was an error
      if (chatMode === 'modifications') {
        setIsGenerating(false);
      }
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

  // Get step description for the placeholder
  const getStepDescription = () => {
    switch (currentStep) {
      case 'projectDetails':
        return 'Share details about your project...';
      case 'functionalRequirements':
        return 'Describe what your system needs to do...';
      case 'nonFunctionalRequirements':
        return 'Tell me about your technical requirements...';
      default:
        return phase === 'structured' 
          ? 'Type your response...'
          : chatMode === 'questions'
            ? 'Ask a question about the data model...'
            : 'Describe the changes you want to make...';
    }
  };

  // Add this new function for auto-resizing
  const autoResize = (e) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`; // Max height of 200px
  };

  // Add this function to convert markdown-style bold to HTML
  const formatMessage = (content) => {
    return content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  };

  // Modify the handleInfoUpdate function to also save to database
  const handleInfoUpdate = async (updatedInfo) => {
    setCollectedInfo(updatedInfo);
    // Note: We don't need to explicitly save to database here since the useEffect will handle it
  };

  // Replace the existing useEffect for loading from localStorage with this:
  useEffect(() => {
    if (modelData?.requirements) {
      setCollectedInfo(modelData.requirements);
    } else {
      // Fallback to localStorage if no requirements in model data
      const savedInfo = localStorage.getItem(`collectedInfo-${dataModelId}`);
      if (savedInfo) {
        try {
          setCollectedInfo(JSON.parse(savedInfo));
        } catch (e) {
          console.error('Error parsing saved info:', e);
        }
      }
    }
  }, [dataModelId, modelData]);

  // Add the generating overlay
  if (isGenerating) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-8 rounded-lg shadow-xl text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold mb-2">Generating Data Model</h3>
          <p className="text-gray-600">
            Using AI to create the optimal data model based on your requirements...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='w-full md:w-1/2 bg-white rounded-lg shadow-lg p-4 flex flex-col'>
      <div className='flex items-center justify-between mb-4'>
        <h2 className='text-xl font-semibold'>AI Assistant</h2>
        <div className='flex-shrink-0'>
          {phase === 'structured' && (
            <div className='flex items-center gap-2'>
              <button
                onClick={() => setShowInfoModal(true)}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors text-sm border border-gray-200 mr-2"
              >
                View Requirements
              </button>
              <button
                onClick={handleTestGeneration}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors text-sm border border-gray-200"
                disabled={isGenerating}
              >
                {isGenerating ? 'Generating...' : 'Test Generate'}
              </button>
              <div className='h-2 w-24 bg-gray-200 rounded-full overflow-hidden ml-2'>
                <div 
                  className='h-full bg-blue-500 transition-all duration-300'
                  style={{ width: `${calculateProgress()}%` }}
                />
              </div>
              <span className='text-sm text-gray-600'>{calculateProgress()}%</span>
            </div>
          )}
          {phase === 'free' && (
            <div className='flex gap-2'>
              <button
                onClick={() => setShowInfoModal(true)}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors text-sm border border-gray-200 mr-2"
              >
                View Requirements
              </button>
              <button
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  chatMode === 'questions'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setChatMode('questions')}
              >
                Ask Questions
              </button>
              <button
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  chatMode === 'modifications'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => setChatMode('modifications')}
              >
                Request Changes
              </button>
            </div>
          )}
        </div>
      </div>
      
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
                <p 
                  className='whitespace-pre-wrap'
                  dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                />
                <span className='text-xs opacity-70 mt-1 block'>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className='flex justify-start'>
              <div className='bg-gray-100 rounded-lg p-2 rounded-bl-none'>
                <div className='flex space-x-1'>
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

      <div className='flex mt-4 relative items-end border rounded-xl bg-gray-50 shadow-sm'>
        <textarea
          ref={inputRef}
          className='flex-1 max-h-[200px] overflow-y-auto bg-transparent py-4 pl-4 pr-12 focus:outline-none focus:ring-0 focus:border-transparent resize-none'
          placeholder={getStepDescription()}
          rows={1}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            autoResize(e);
          }}
          onKeyPress={handleKeyPress}
          style={{ minHeight: '56px' }}
        />
        <button
          className={`absolute right-2 bottom-3 p-1 rounded-lg ${
            isLoading || !message.trim()
              ? 'text-gray-400 cursor-not-allowed'
              : 'text-blue-500 hover:bg-blue-50 active:bg-blue-100'
          } transition-colors`}
          onClick={handleSend}
          disabled={isLoading || !message.trim()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6 rotate-90"
          >
            <path
              d="M5.636 5.636a1 1 0 0 1 1.414 0L12 10.586l4.95-4.95a1 1 0 1 1 1.414 1.414L13.414 12l4.95 4.95a1 1 0 0 1-1.414 1.414L12 13.414l-4.95 4.95a1 1 0 0 1-1.414-1.414L10.586 12 5.636 7.05a1 1 0 0 1 0-1.414z"
            />
          </svg>
        </button>
      </div>

      {/* Add the modal component */}
      <ModelInfoModal 
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        collectedInfo={collectedInfo}
        onUpdate={handleInfoUpdate}
      />
    </div>
  );
};

export default AIAssistant;