// Platform detection and input monitoring for real-time suggestions

export interface PlatformConfig {
  name: string;
  hostnames: string[];
  inputSelectors: string[];
  inputType: 'textarea' | 'contenteditable' | 'input';
  debounceDelay?: number; // Platform-specific override
}

// Platform-specific configurations
export const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    name: 'ChatGPT',
    hostnames: ['chatgpt.com', 'chat.openai.com'],
    inputSelectors: [
      '#prompt-textarea',
      '[data-testid="prompt-textarea"]',
      'textarea[placeholder*="message"]',
      'div[contenteditable="true"][data-testid*="composer"]',
      'div[contenteditable="true"]'
    ],
    inputType: 'contenteditable'
  },
  {
    name: 'Claude',
    hostnames: ['claude.ai', 'chat.anthropic.com'],
    inputSelectors: [
      'div[contenteditable="true"][data-testid="chat-input"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="Talk to Claude"]',
      '[data-testid="chat-input"]'
    ],
    inputType: 'contenteditable'
  },
  {
    name: 'Gemini',
    hostnames: ['gemini.google.com', 'bard.google.com'],
    inputSelectors: [
      'div[contenteditable="true"][data-testid="input-area"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="Enter a prompt"]',
      '.ql-editor'
    ],
    inputType: 'contenteditable'
  },
  {
    name: 'Perplexity',
    hostnames: ['perplexity.ai', 'www.perplexity.ai'],
    inputSelectors: [
      'textarea[placeholder*="Ask anything"]',
      'textarea[data-testid="search-input"]',
      'textarea',
      'div[contenteditable="true"]'
    ],
    inputType: 'textarea'
  }
];

/**
 * Detect current platform based on hostname
 */
export const detectCurrentPlatform = (): PlatformConfig | null => {
  const hostname = window.location.hostname;
  
  const platform = PLATFORM_CONFIGS.find(config => {
    return config.hostnames.some(platformHostname => {
      return hostname === platformHostname || hostname.endsWith('.' + platformHostname);
    });
  }) || null;
  
  return platform;
};

/**
 * Find the main input element for the current platform
 */
export const findMainInputElement = (platform?: PlatformConfig): Element | null => {
  const currentPlatform = platform || detectCurrentPlatform();
  
  if (!currentPlatform) {
    return null;
  }

  // Try each selector in order of preference
  for (const selector of currentPlatform.inputSelectors) {
    try {
      const element = document.querySelector(selector);
      
      if (element && isValidInputElement(element, currentPlatform.inputType)) {
        return element;
      }
    } catch (error) {
      // Continue to next selector
    }
  }

  return null;
};

/**
 * Validate if an element is a valid input for the expected type
 */
const isValidInputElement = (element: Element, expectedType: string): boolean => {
  switch (expectedType) {
    case 'textarea':
      return element instanceof HTMLTextAreaElement;
    case 'contenteditable':
      return element.getAttribute('contenteditable') === 'true' ||
             !!element.closest('[contenteditable="true"]');
    case 'input':
      return element instanceof HTMLInputElement;
    default:
      return false;
  }
};

/**
 * Get text content from an input element
 */
export const getInputText = (element: Element): string => {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }
  if (element.getAttribute('contenteditable') === 'true' || element.closest('[contenteditable="true"]')) {
    return element.textContent || '';
  }
  return '';
};

/**
 * Monitor input changes on an element
 */
export const addInputListener = (
  element: Element,
  callback: (text: string) => void,
  options: { debounceMs?: number } = {}
): (() => void) => {
  const { debounceMs = 1000 } = options;
  let timeoutId: NodeJS.Timeout | null = null;

  const handleInput = () => {
    if (timeoutId) clearTimeout(timeoutId);
    
    timeoutId = setTimeout(() => {
      const text = getInputText(element);
      callback(text);
    }, debounceMs);
  };

  // Add appropriate event listeners based on element type
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.addEventListener('input', handleInput);
    element.addEventListener('paste', handleInput);
    element.addEventListener('change', handleInput);
  } else {
    // ContentEditable elements
    element.addEventListener('input', handleInput);
    element.addEventListener('paste', handleInput);
    element.addEventListener('keyup', handleInput);
    element.addEventListener('keydown', handleInput);
    element.addEventListener('change', handleInput);
  }

  // Return cleanup function
  return () => {
    if (timeoutId) clearTimeout(timeoutId);
    
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      element.removeEventListener('input', handleInput);
      element.removeEventListener('paste', handleInput);
      element.removeEventListener('change', handleInput);
    } else {
      element.removeEventListener('input', handleInput);
      element.removeEventListener('paste', handleInput);
      element.removeEventListener('keyup', handleInput);
      element.removeEventListener('keydown', handleInput);
      element.removeEventListener('change', handleInput);
    }
  };
};

/**
 * Check if real-time suggestions should be active on current page
 */
export const shouldActivateRealtimeSuggestions = (): boolean => {
  const platform = detectCurrentPlatform();
  if (!platform) return false;

  const inputElement = findMainInputElement(platform);
  return !!inputElement;
}; 