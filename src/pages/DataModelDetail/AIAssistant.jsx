import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, getDataModelChatHistory, sendChatMessage, saveDataModelRequirements } from 'wasp/client/operations';

const AIAssistant = ({ dataModelId }) => {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [phase, setPhase] = useState('structured'); // 'structured' or 'free'
  const [currentStep, setCurrentStep] = useState('projectDetails'); // 'projectDetails', 'functionalRequirements', 'nonFunctionalRequirements'
  const [chatMode, setChatMode] = useState('questions'); // 'questions' or 'modifications'
  const [collectedInfo, setCollectedInfo] = useState(() => {
    const saved = localStorage.getItem(`collectedInfo-${dataModelId}`);
    return saved ? JSON.parse(saved) : {
      projectDetails: {
        type: null, // e.g., "saas", "ecommerce", "social platform"
        description: null,
        industry: null,
        targetMarket: null, // e.g., "B2B", "B2C", "Enterprise"
        securityRequirements: null, // e.g., "HIPAA", "GDPR", "SOC2"
        completed: false
      },
      functionalRequirements: {
        userStories: [], // high-level business capabilities
        userTypes: [], // types of users and their roles
        keyFeatures: [], // main features and capabilities
        businessProcesses: [], // key workflows in the system
        integrations: [], // external systems to integrate with
        dataAccess: {
          accessPatterns: [], // how data will be accessed/queried
          searchRequirements: [], // what needs to be searchable
          filteringNeeds: [], // common filtering scenarios
        },
        reportingNeeds: [], // business intelligence requirements
        completed: false
      },
      nonFunctionalRequirements: {
        dataOperations: {
          heavyRead: {
            entities: [],
            frequency: null,
            patterns: [], // e.g., "batch reads", "real-time queries"
          },
          heavyWrite: {
            entities: [],
            frequency: null,
            patterns: [], // e.g., "bulk uploads", "streaming updates"
          },
          readWriteRatio: null,
          consistencyRequirements: [], // which entities need strong consistency
        },
        traffic: {
          peakConcurrentUsers: null,
          averageDailyUsers: null,
          growthProjection: null,
          geographicDistribution: null,
          peakHours: null,
          seasonality: null,
        },
        dataVolume: {
          initialSize: null,
          growthRate: null,
          recordSizeLimits: null,
          dataRetentionRequirements: null,
          archivalNeeds: null,
        },
        performance: {
          expectedLatency: null,
          criticalOperations: [],
          slaRequirements: null,
          cacheableEntities: [], // entities that can be cached
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
        },
        completed: false
      }
    };
  });
  
  const { data: chatHistory = [] } = useQuery(getDataModelChatHistory, { dataModelId });
  const [previousQuestion, setPreviousQuestion] = useState(null);
  const [initializedSteps, setInitializedSteps] = useState(() => {
    const saved = localStorage.getItem(`initializedSteps-${dataModelId}`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

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
  }, [collectedInfo, dataModelId]);

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

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage(''); // Clear input immediately
    setIsLoading(true);
    
    // Add immediate scroll after setting loading state
    setTimeout(() => {
      const messagesContainer = messagesEndRef.current?.parentElement;
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 0);
    
    try {
      const response = await sendChatMessage({ 
        dataModelId, 
        content: userMessage, // Use saved message instead of message.trim()
        context: {
          phase,
          step: currentStep,
          currentStepInfo: collectedInfo[currentStep],
          previousQuestion: previousQuestion,
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
                return null; // Move to free phase
              default:
                return null;
            }
          })();

          if (nextStep) {
            setCurrentStep(nextStep);
            await initializeStep(nextStep); // Initialize the next step
          } else {
            // Save requirements to database when structured phase is complete
            try {
              await saveDataModelRequirements({
                dataModelId,
                requirements: collectedInfo
              });
            } catch (error) {
              console.error('Error saving requirements:', error);
            }
            
            setPhase('free');
            setChatMode('questions');
          }
          setPreviousQuestion(null);
        }
      }
      
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

  return (
    <div className='w-full md:w-1/2 bg-white rounded-lg shadow-lg p-4 flex flex-col'>
      <div className='flex items-center justify-between mb-4'>
        <h2 className='text-xl font-semibold'>AI Assistant</h2>
        <div className='flex-shrink-0'>
          {phase === 'structured' && (
            <div className='flex items-center gap-2'>
              <div className='h-2 w-24 bg-gray-200 rounded-full overflow-hidden'>
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
                <p className='whitespace-pre-wrap'>{msg.content}</p>
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

      <div className='flex gap-2 items-end mt-4'>
        <textarea
          ref={inputRef}
          className='flex-1 rounded-lg border-2 border-gray-300 p-2 focus:border-blue-500 focus:ring focus:ring-blue-200 focus:ring-opacity-50 resize-none'
          placeholder={getStepDescription()}
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