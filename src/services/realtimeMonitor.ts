/**
 * Real-time prompt monitoring and analysis coordination
 * 
 * This module manages the real-time suggestion feature by:
 * 1. Monitoring text input on supported LLM platforms
 * 2. Triggering prompt analysis based on user-configured frequency settings
 * 3. Dispatching events for the suggestion bubble UI
 * 4. Tracking performance metrics and handling errors gracefully
 */

import { 
  detectCurrentPlatform, 
  findMainInputElement, 
  addInputListener, 
  getInputText,
  shouldActivateRealtimeSuggestions 
} from './platformDetection';
import { analyzePromptRealtime, initClaudeAI } from './claude';
import { getRealtimeSettings, RealtimeSettings, getApiKey } from './storage';

export interface RealtimeMonitor {
  start: () => void;
  stop: () => void;
  isActive: () => boolean;
}

interface MonitorState {
  isActive: boolean;
  currentInputElement: Element | null;
  cleanup: (() => void) | null;
  settings: RealtimeSettings | null;
  lastAnalyzedText: string;
  characterCount: number;
  wordCount: number;
  // Performance tracking
  totalAnalyses: number;
  successfulAnalyses: number;
  averageResponseTime: number;
  lastAnalysisTime: number;
}

let monitorState: MonitorState = {
  isActive: false,
  currentInputElement: null,
  cleanup: null,
  settings: null,
  lastAnalyzedText: '',
  characterCount: 0,
  wordCount: 0,
  // Performance tracking
  totalAnalyses: 0,
  successfulAnalyses: 0,
  averageResponseTime: 0,
  lastAnalysisTime: 0
};

/**
 * Calculate debounce delay based on user frequency settings
 * @param settings Real-time settings from storage
 * @returns Debounce delay in milliseconds
 */
const calculateDebounceDelay = (settings: RealtimeSettings): number => {
  switch (settings.frequencyType) {
    case 'time':
      return settings.timeDelay;
    case 'smart':
      return 1500; // Default for smart pause detection
    default:
      return 1000; // Default for character/word based
  }
};

/**
 * Check if analysis should be triggered based on user frequency settings
 * @param text Current input text
 * @param settings Real-time settings from storage
 * @returns True if analysis should be triggered
 */
const shouldTriggerAnalysis = (text: string, settings: RealtimeSettings): boolean => {
  const trimmedText = text.trim();
  
  // Don't analyze empty text
  if (!trimmedText) return false;
  
  // Don't re-analyze the same text
  if (trimmedText === monitorState.lastAnalyzedText) return false;

  switch (settings.frequencyType) {
    case 'characters':
      const newCharCount = trimmedText.length;
      const charDiff = newCharCount - monitorState.characterCount;
      if (charDiff >= settings.characterThreshold) {
        monitorState.characterCount = newCharCount;
        return true;
      }
      return false;

    case 'words':
      const newWordCount = trimmedText.split(/\s+/).filter(w => w.length > 0).length;
      const wordDiff = newWordCount - monitorState.wordCount;
      if (wordDiff >= settings.wordThreshold) {
        monitorState.wordCount = newWordCount;
        return true;
      }
      return false;

    case 'time':
    case 'smart':
      // For time-based and smart, we rely on debouncing
      return true;

    default:
      return true;
  }
};

/**
 * Handle input changes and trigger Claude AI analysis when appropriate
 * Includes edge case handling, performance tracking, and event dispatching
 * @param text Current input text from the monitored element
 */
const handleInputChange = async (text: string): Promise<void> => {
  if (!monitorState.settings || !monitorState.isActive) {
    return;
  }

  // Handle edge cases
  try {
    // Skip empty or whitespace-only text
    const trimmedText = text.trim();
    if (!trimmedText) {
      return;
    }

    // Skip very short text (less than 10 characters)
    if (trimmedText.length < 10) {
      return;
    }

    // Skip very long text (over 5000 characters to prevent API overload)
    if (trimmedText.length > 5000) {
      console.warn('Real-time suggestions: Text too long, skipping analysis');
      return;
    }

    // Skip if text contains only special characters or numbers
    const hasLetters = /[a-zA-Z]/.test(trimmedText);
    if (!hasLetters) {
      return;
    }

    if (shouldTriggerAnalysis(text, monitorState.settings)) {
      monitorState.lastAnalyzedText = trimmedText;
      
      // Dispatch analysis start event for loading state
      window.dispatchEvent(new CustomEvent('promptAnalysisStart'));
      
      // Performance tracking
      const startTime = performance.now();
      monitorState.totalAnalyses++;
      
      // Add timeout for API calls (10 seconds max)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout')), 10000);
      });

      const response = await Promise.race([
        analyzePromptRealtime(text),
        timeoutPromise
      ]);
      
      // Dispatch analysis end event
      window.dispatchEvent(new CustomEvent('promptAnalysisEnd'));
      
      // Track successful analysis
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      monitorState.successfulAnalyses++;
      monitorState.lastAnalysisTime = responseTime;
      
      // Update average response time
      monitorState.averageResponseTime = 
        (monitorState.averageResponseTime * (monitorState.successfulAnalyses - 1) + responseTime) / 
        monitorState.successfulAnalyses;
      
      // Log performance if response is slow
      if (responseTime > 3000) {
        console.warn(`Real-time analysis took ${responseTime.toFixed(0)}ms - consider optimization`);
      }
      
      if (response.content && response.content !== 'NO_CHANGE') {
        // Validate suggestion before showing
        const suggestion = response.content.trim();
        if (suggestion && suggestion.length > 0 && suggestion.length <= 50) {
          // Track successful suggestion
          try {
            if (chrome && chrome.runtime && chrome.runtime.id) {
              const { realtimeSuggestionCount = 0 } = await chrome.storage.local.get(['realtimeSuggestionCount']);
              await chrome.storage.local.set({ 
                realtimeSuggestionCount: realtimeSuggestionCount + 1 
              });
            }
          } catch (error) {
            // Don't fail suggestion display if storage fails
            console.warn('Failed to track suggestion count:', error);
          }

          // Dispatch custom event for bubble component
          window.dispatchEvent(new CustomEvent('promptSuggestion', {
            detail: {
              suggestion: suggestion,
              originalText: text,
              platform: detectCurrentPlatform()?.name || 'Unknown'
            }
          }));
        }
      }
    }
      } catch (error) {
    // Dispatch analysis end event even on error
    window.dispatchEvent(new CustomEvent('promptAnalysisEnd'));
    
    // Handle different error types gracefully
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        console.warn('Real-time suggestions: Analysis timed out');
      } else if (error.message.includes('API key')) {
        console.warn('Real-time suggestions: API key issue');
      } else if (error.message.includes('rate limit')) {
        console.warn('Real-time suggestions: Rate limited');
      } else {
        console.error('Real-time analysis error:', error.message);
      }
    } else {
      console.error('Unknown error in real-time analysis:', error);
    }
  }
};

/**
 * Initialize real-time monitoring on the current platform's input element
 * Handles platform detection, settings validation, API key setup, and input listener attachment
 * @returns Promise<boolean> - True if monitoring was successfully initialized
 */
const initializeMonitoring = async (): Promise<boolean> => {
  try {
    // Check platform compatibility
    const platform = detectCurrentPlatform();
    if (!platform) {
      return false;
    }

    if (!shouldActivateRealtimeSuggestions()) {
      return false;
    }

    // Load settings with error handling
    let settings;
    try {
      settings = await getRealtimeSettings();
    } catch (error) {
      console.error('Failed to load real-time settings:', error);
      return false;
    }

    if (!settings.enabled) {
      return false;
    }

    // Initialize Claude client with retry
    let apiKey;
    try {
      apiKey = await getApiKey();
    } catch (error) {
      console.error('Failed to load API key:', error);
      return false;
    }

    if (!apiKey) {
      return false;
    }

    try {
      initClaudeAI(apiKey);
    } catch (error) {
      console.error('Failed to initialize Claude client:', error);
      return false;
    }

    // Find input element with retries
    let inputElement = findMainInputElement();
    if (!inputElement) {
      // Try again after a short delay (page might still be loading)
      await new Promise(resolve => setTimeout(resolve, 1000));
      inputElement = findMainInputElement();
      
      if (!inputElement) {
        return false;
      }
    }

    // Validate input element is still in DOM and visible
    if (!document.contains(inputElement)) {
      return false;
    }

    const rect = inputElement.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }

    // Set up monitoring
    monitorState.settings = settings;
    monitorState.currentInputElement = inputElement;
    monitorState.lastAnalyzedText = '';
    
    // Initialize counters with current content
    const currentText = getInputText(inputElement);
    monitorState.characterCount = currentText.length;
    monitorState.wordCount = currentText.split(/\s+/).filter(w => w.length > 0).length;

    // Add input listener with appropriate debounce
    const debounceDelay = calculateDebounceDelay(settings);
    
    try {
      monitorState.cleanup = addInputListener(inputElement, handleInputChange, {
        debounceMs: debounceDelay
      });
    } catch (error) {
      console.error('Failed to add input listener:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to initialize monitoring:', error);
    return false;
  }
};

/**
 * Clean up current monitoring
 */
const cleanupMonitoring = (): void => {
  if (monitorState.cleanup) {
    monitorState.cleanup();
    monitorState.cleanup = null;
  }
  
  monitorState.currentInputElement = null;
  monitorState.settings = null;
  monitorState.lastAnalyzedText = '';
  monitorState.characterCount = 0;
  monitorState.wordCount = 0;
};

/**
 * Create and return a real-time monitor instance
 * The monitor handles platform detection, input monitoring, and Claude AI integration
 * @returns RealtimeMonitor instance with start/stop/isActive methods
 */
export const createRealtimeMonitor = (): RealtimeMonitor => {
  return {
    start: async () => {
      if (monitorState.isActive) {

        return;
      }
      
      monitorState.isActive = true;
      
      // Try to initialize immediately
      const success = await initializeMonitoring();
      
      if (!success) {
        // If failed, retry periodically (page might still be loading)
        const retryInterval = setInterval(async () => {
          if (!monitorState.isActive) {
            clearInterval(retryInterval);
            return;
          }
          
          const retrySuccess = await initializeMonitoring();
          if (retrySuccess) {
            clearInterval(retryInterval);
          }
        }, 2000);

        // Stop retrying after 30 seconds
        setTimeout(() => {
          clearInterval(retryInterval);
        }, 30000);
      }
    },

    stop: () => {
      monitorState.isActive = false;
      cleanupMonitoring();
    },

    isActive: () => monitorState.isActive
  };
}; 