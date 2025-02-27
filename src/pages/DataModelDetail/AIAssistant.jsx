import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, getDataModelChatHistory, sendChatMessage, saveDataModelRequirements, generateDataModel, saveDataModelSchema, askDataModelQuestion } from 'wasp/client/operations';
import ModelInfoModal from './ModelInfoModal';
import SuggestionsModal from './SuggestionsModal';
import { XMarkIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, CogIcon } from '@heroicons/react/24/outline';

const AIAssistant = ({ dataModelId, onSchemaGenerated, modelData, modelDataSchema }) => {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [phase, setPhase] = useState(() => {
    const savedPhase = localStorage.getItem(`phase-${dataModelId}`);
    return savedPhase || (modelDataSchema ? 'free' : 'structured');
  });
  const [currentStep, setCurrentStep] = useState(() => {
    const savedStep = localStorage.getItem(`currentStep-${dataModelId}`);
    return savedStep || 'projectDetails';
  });
  const [chatMode, setChatMode] = useState(() => {
    const savedChatMode = localStorage.getItem(`chatMode-${dataModelId}`);
    return savedChatMode || 'questions';
  });
  const [collectedInfo, setCollectedInfo] = useState(() => {
    const saved = localStorage.getItem(`collectedInfo-${dataModelId}`);
    return saved ? JSON.parse(saved) : {
      projectDetails: {
        description: modelData?.description || null,
        industry: null,
        completed: false
      },
      functionalRequirements: {
        userTypes: [],
        keyFeatures: [],
        dataAccess: {
          accessPatterns: [],
          queryPattern: null, // "simple lookups", "heavy joins", "graph traversal"
        },
        completed: false
      },
      nonFunctionalRequirements: {
        frequentQueries: [], // Common data retrieval patterns
        criticalJoins: [], // Joins that happen often or with large datasets
        writeOperations: [], // Important create/update/delete operations
        readWriteRatio: null, // "read-heavy", "write-heavy", "balanced"
        growthExpectations: null, // How data volume will increase over time
        suggestedDataModel: null, // AI recommendation (SQL, NoSQL, GraphDB)
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

  // Add new state for tracking repeated questions
  const [previouslyAskedFields, setPreviouslyAskedFields] = useState({});
  const [attemptCounts, setAttemptCounts] = useState({});

  // Add new state for fullscreen mode
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Add new state for suggestions
  const [suggestions, setSuggestions] = useState(() => {
    const savedSuggestions = localStorage.getItem(`suggestions-${dataModelId}`);
    return savedSuggestions ? JSON.parse(savedSuggestions) : [];
  });
  
  // Add state for suggestions modal
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);

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

  // Save phase and chatMode when they change
  useEffect(() => {
    localStorage.setItem(`phase-${dataModelId}`, phase);
  }, [phase, dataModelId]);

  useEffect(() => {
    localStorage.setItem(`chatMode-${dataModelId}`, chatMode);
  }, [chatMode, dataModelId]);

  // Save currentStep when it changes
  useEffect(() => {
    localStorage.setItem(`currentStep-${dataModelId}`, currentStep);
  }, [currentStep, dataModelId]);

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

    // Reset tracking for the new step
    setPreviouslyAskedFields({});
    setAttemptCounts({});
    
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
          isInitialMessage: true,
          previouslyAskedFields,
          attemptCounts
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

  // Simplify the initialization logic to ensure it works reliably
  useEffect(() => {
    // This effect should only run once on mount
    if (isMounted.current) return;
    
    const loadSavedState = async () => {
      // Load requirements data
      if (modelData?.requirements) {
        setCollectedInfo(modelData.requirements);
      } else {
        const savedInfo = localStorage.getItem(`collectedInfo-${dataModelId}`);
        if (savedInfo) {
          try {
            setCollectedInfo(JSON.parse(savedInfo));
          } catch (e) {
            console.error('Error parsing saved info:', e);
          }
        }
      }
      
      // Mark as mounted immediately to prevent re-initialization
      isMounted.current = true;
      
      // Initialize the step if needed
      setTimeout(() => {
        if (!initializedSteps.has(currentStep) && chatHistory.length === 0) {
          initializeStep(currentStep);
        }
      }, 100);
    };
    
    loadSavedState();
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataModelId]);

  // Make sure we save currentStep changes to localStorage
  useEffect(() => {
    if (!isMounted.current) return;
    localStorage.setItem(`currentStep-${dataModelId}`, currentStep);
  }, [currentStep, dataModelId]);

  // Make sure we save phase changes to localStorage
  useEffect(() => {
    if (!isMounted.current) return;
    localStorage.setItem(`phase-${dataModelId}`, phase);
  }, [phase, dataModelId]);

  // Make sure we save chatMode changes to localStorage
  useEffect(() => {
    if (!isMounted.current) return;
    localStorage.setItem(`chatMode-${dataModelId}`, chatMode);
  }, [chatMode, dataModelId]);

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
      
      // Move to free phase and save it to localStorage BEFORE reloading
      setPhase('free');
      localStorage.setItem(`phase-${dataModelId}`, 'free');
      setChatMode('questions');
      localStorage.setItem(`chatMode-${dataModelId}`, 'questions');

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

  // Modify the handleSend function to show loading state during modifications
  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = {
      content: message,
      sender: 'user',
      timestamp: new Date().toISOString()
    };

    setChatHistory(prev => [...prev, userMessage]);
    setMessage('');
    setIsLoading(true);
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = '56px';
    }

    // Add user message to chat history immediately
    const updatedChatHistory = [...chatHistory, userMessage];
    
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
      // Use different API call based on phase
      if (phase === 'free') {
        // Use askDataModelQuestion for free phase
        const response = await askDataModelQuestion({
          content: userMessage.content,
          dataModelId,
          dataModelSchema: modelDataSchema,
          suggestions, // Pass current suggestions
        });
        
        // Add AI response to chat history
        if (response.aiMessage) {
          const aiMessage = {
            content: response.aiMessage.content,
            sender: 'ai',
            timestamp: response.aiMessage.timestamp || new Date().toISOString()
          };
          
          // Update local chat history with AI response
          setChatHistory(prev => [...prev, aiMessage]);
        }
        
        // Update suggestions if they've changed
        if (response.suggestions) {
          setSuggestions(response.suggestions);
        }
        
        // No need to update collected info or handle step transitions in free phase
        inputRef.current?.focus();
      } else {
        // Use sendChatMessage for structured phase
        const response = await sendChatMessage({
          dataModelId,
          content: message,
          context: {
            phase,
            step: currentStep,
            currentStepInfo: collectedInfo[currentStep] || {},
            allCollectedInfo: collectedInfo,
            previousQuestion,
            // Pass the tracking information
            previouslyAskedFields,
            attemptCounts
          }
        });

        // Update the tracking information from the response
        if (response.previouslyAskedFields) {
          setPreviouslyAskedFields(response.previouslyAskedFields);
        }
        
        if (response.attemptCounts) {
          setAttemptCounts(response.attemptCounts);
        }

        // Update collected info with AI's response
        if (response.updatedInfo) {          
          setCollectedInfo(prevState => {
            // Create a deep copy of the entire state
            const newState = JSON.parse(JSON.stringify(prevState));
            
            // Create the updated step info
            const updatedStepInfo = { ...newState[currentStep] };
            
            // Only update properties that aren't null
            Object.entries(response.updatedInfo).forEach(([key, value]) => {
              if (value !== null) {
                updatedStepInfo[key] = value;
              }
            });
            
            // Always update the completed flag
            updatedStepInfo.completed = response.completed;
            
            // Replace the step in the new state
            newState[currentStep] = updatedStepInfo;
            
            // Return a completely new object
            return { ...newState };
          });
          
          // Store the follow-up question for next context
          setPreviousQuestion(response.followUpQuestion);

          // Handle step completion and phase transition
          if (response.completed === true) {
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
        
        inputRef.current?.focus();
      }
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
    if (phase === 'free') {
      return 'Ask a question about the data model...';
    } else {
      switch (currentStep) {
        case 'projectDetails':
          return 'Share details about your project...';
        case 'functionalRequirements':
          return 'Describe what your system needs to do...';
        case 'nonFunctionalRequirements':
          return 'Tell me about your technical requirements...';
        default:
          return 'Type your response...';
      }
    }
  };

  // Add this new function for auto-resizing
  const autoResize = (e) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`; // Max height of 200px
  };

  // Replace the simple formatMessage function with a more comprehensive markdown parser
  const formatMessage = (content) => {
    // Process markdown headings (### Heading)
    content = content.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, text) => {
      const level = hashes.length;
      return `<h${level} class="font-bold text-lg my-2">${text}</h${level}>`;
    });

    // Process bold text (**bold**)
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Process italic text (*italic*)
    content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Process inline code (`code`)
    content = content.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-sm font-mono">$1</code>');
    
    // First identify list blocks to avoid processing them multiple times
    let listBlocks = [];
    let nonListContent = content.replace(/(?:^|\n)((?:(?:- |\d+\. ).+\n?)+)/g, (match, listBlock, index) => {
      listBlocks.push({ index, content: listBlock });
      return `\n{{LIST_BLOCK_${listBlocks.length - 1}}}\n`;
    });
    
    // Process each list block separately
    listBlocks.forEach((block, blockIndex) => {
      let listContent = block.content;
      
      // Check if this is an unordered list (starts with -)
      if (listContent.trim().startsWith('- ')) {
        // Process unordered lists
        listContent = listContent.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>');
        listContent = `<ul class="list-disc my-2">${listContent}</ul>`;
      } else {
        // Process ordered lists
        listContent = listContent.replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4">$1</li>');
        listContent = `<ol class="list-decimal my-2">${listContent}</ol>`;
      }
      
      // Replace the placeholder with the processed list
      nonListContent = nonListContent.replace(`{{LIST_BLOCK_${blockIndex}}}`, listContent);
    });
    
    content = nonListContent;
    
    // Process code blocks
    content = content.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 p-2 rounded my-2 overflow-x-auto font-mono text-sm">$1</pre>');
    
    // Process horizontal rules
    content = content.replace(/^---$/gm, '<hr class="my-4 border-t border-gray-300">');
    
    // Process links
    content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Convert newlines to <br> tags
    content = content.replace(/\n/g, '<br>');
    
    return content;
  };

  // Modify the handleInfoUpdate function to also save to database
  const handleInfoUpdate = async (updatedInfo) => {
    setCollectedInfo(updatedInfo);
    // Note: We don't need to explicitly save to database here since the useEffect will handle it
  };

  // Toggle fullscreen mode
  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
  };

  // Add effect to save suggestions to localStorage when they change
  useEffect(() => {
    localStorage.setItem(`suggestions-${dataModelId}`, JSON.stringify(suggestions));
  }, [suggestions, dataModelId]);

  // Add function to handle applying suggestions
  const handleApplySuggestions = async () => {
    // Close the suggestions modal first
    setShowSuggestionsModal(false);
    
    // Then show the generating overlay
    setIsGenerating(true);
    
    try {
      // Generate a new schema based on the current requirements and suggestions
      const result = await generateDataModel({
        requirements: collectedInfo,
        suggestions: suggestions // Pass the suggestions to the generateDataModel function
      });

      // Save the generated schema to the database
      await saveDataModelSchema({
        dataModelId,
        schema: result.schema
      });

      // Update the CodeEditor via parent component
      onSchemaGenerated(result.schema);

      // Add a system message about the applied changes
      const systemMessage = {
        sender: 'ai',
        content: `✅ Applied ${suggestions.length} suggested changes to the data model.\n\n${result.explanation}`,
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, systemMessage]);
      
      // Clear suggestions after applying them
      setSuggestions([]);
      
      // Force a refresh of the page to get the latest schema
      window.location.reload();
    } catch (error) {
      console.error('Error applying suggestions:', error);
      
      // Add error message to chat
      const errorMessage = {
        sender: 'ai',
        content: `❌ Error applying suggestions: ${error.message || 'An unknown error occurred'}`,
        timestamp: new Date().toISOString()
      };
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={`bg-white rounded-lg shadow-lg p-4 flex flex-col ${
      isFullScreen ? 'fixed inset-0 z-50' : 'w-full'
    }`}>
      {/* Add the generating overlay as a conditional element inside the component */}
      {isGenerating && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white p-8 rounded-lg shadow-xl text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <h3 className="text-xl font-semibold mb-2">Generating Data Model</h3>
            <p className="text-gray-600">
              Using AI to create the optimal data model based on your requirements...
            </p>
          </div>
        </div>
      )}
      
      <div className='flex items-center justify-between mb-4'>
        <h2 className='text-xl font-semibold'>AI Assistant</h2>
        <div className='flex-shrink-0 flex items-center'>
          {/* Add fullscreen toggle button */}
          <button
            onClick={toggleFullScreen}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors mr-2"
            title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
          >
            {isFullScreen ? (
              <ArrowsPointingInIcon className="h-5 w-5" />
            ) : (
              <ArrowsPointingOutIcon className="h-5 w-5" />
            )}
          </button>
          
          {/* Close button only shown in fullscreen mode */}
          {isFullScreen && (
            <button
              onClick={toggleFullScreen}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors mr-2"
              title="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )}
          
          {phase === 'structured' && (
            <div className='flex items-center gap-2'>
              <button
                onClick={() => setShowInfoModal(true)}
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors text-sm border border-gray-200 mr-2"
              >
                View Requirements
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
                className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors text-sm border border-gray-200"
              >
                View Requirements
              </button>
              <button
                onClick={() => setShowSuggestionsModal(true)}
                className="relative p-1.5 rounded-full transition-colors"
                title="Model Suggestions"
              >
                <CogIcon 
                  className={`h-5 w-5 ${suggestions.length > 0 ? 'text-yellow-500' : 'text-gray-500 hover:text-gray-700'}`} 
                />
                {suggestions.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-yellow-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                    {suggestions.length}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div className={`flex-1 overflow-hidden relative ${isFullScreen ? 'h-[calc(100vh-180px)]' : ''}`}>
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
                  className='whitespace-pre-wrap markdown-content'
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

      {/* Add the suggestions modal component */}
      <SuggestionsModal
        isOpen={showSuggestionsModal}
        onClose={() => setShowSuggestionsModal(false)}
        suggestions={suggestions}
        onApplyChanges={handleApplySuggestions}
      />
    </div>
  );
};

export default AIAssistant;