/**
 * Universal Input Detector for PromptLayer
 * Detects text input fields across all websites and platforms
 */

export interface DetectedInput {
  element: Element;
  type: 'textarea' | 'input' | 'contenteditable' | 'textbox';
  site?: string;
  confidence: number; // 0-1 rating of how likely this is a relevant LLM input
}

export interface InputDetectionOptions {
  debounceMs?: number;
  minLength?: number;
  excludePasswordFields?: boolean;
}

/**
 * Site-specific selector registry for major LLM platforms
 */
const SITE_SPECIFIC_SELECTORS = new Map<string, string[]>([
  ['chatgpt.com', [
    'textarea[placeholder*="Message"]',
    'textarea[data-id="root"]',
    '#prompt-textarea',
    'textarea[id*="prompt"]',
    'div[contenteditable="true"][data-testid*="prompt"]'
  ]],
  ['claude.ai', [
    'div[contenteditable="true"][data-testid="composer-input"]',
    'div[contenteditable="true"][data-testid*="composer"]',
    'div[contenteditable="true"][role="textbox"]'
  ]],
  ['gemini.google.com', [
    'textarea[placeholder*="Enter a prompt"]',
    'textarea[placeholder*="prompt"]',
    'div[contenteditable="true"][aria-label*="prompt"]'
  ]],
  ['perplexity.ai', [
    'textarea[placeholder*="Ask anything"]',
    'textarea[placeholder*="Ask"]',
    'textarea[data-testid*="search"]'
  ]],
  ['poe.com', [
    'textarea[placeholder*="Message"]',
    'div[contenteditable="true"]',
    '[class*="ChatMessageInput"]'
  ]],
  ['copilot.microsoft.com', [
    'textarea[placeholder*="Ask me anything"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[aria-label*="Message"]'
  ]],
  ['meta.ai', [
    'textarea[placeholder*="Ask Meta AI"]',
    'div[contenteditable="true"]',
    'textarea[data-testid*="composer"]'
  ]]
]);

/**
 * Generic selectors for any website
 */
const GENERIC_SELECTORS = [
  'textarea:not([readonly]):not([disabled]):not([type="password"])',
  'input[type="text"]:not([readonly]):not([disabled])',
  'input[type="search"]:not([readonly]):not([disabled])',
  'div[contenteditable="true"]:not([readonly])',
  '[role="textbox"]:not([readonly])',
  'textarea[rows]',
  'textarea[cols]'
];

/**
 * High-confidence keywords that indicate LLM/AI inputs
 */
const LLM_KEYWORDS = [
  'prompt', 'message', 'chat', 'ask', 'query', 'search', 'tell', 'write',
  'generate', 'create', 'help', 'assistant', 'ai', 'gpt', 'claude',
  'gemini', 'copilot', 'meta', 'perplexity'
];

/**
 * Calculates confidence score for an input element
 */
function calculateConfidence(element: Element, site: string): number {
  let score = 0.5; // Base score

  // Site-specific boost
  if (SITE_SPECIFIC_SELECTORS.has(site)) {
    score += 0.3;
  }

  // Size heuristics
  const rect = element.getBoundingClientRect();
  if (rect.width > 200 && rect.height > 30) {
    score += 0.2;
  }

  // Attribute analysis
  const placeholder = element.getAttribute('placeholder')?.toLowerCase() || '';
  const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
  const className = element.className?.toLowerCase() || '';
  const id = element.id?.toLowerCase() || '';
  
  const allText = `${placeholder} ${ariaLabel} ${className} ${id}`;
  
  // Check for LLM keywords
  const keywordMatches = LLM_KEYWORDS.filter(keyword => 
    allText.includes(keyword)
  ).length;
  
  score += Math.min(keywordMatches * 0.1, 0.3);

  // Penalty for obvious non-LLM inputs
  if (allText.includes('password') || allText.includes('email') || 
      allText.includes('username') || allText.includes('login')) {
    score -= 0.4;
  }

  // Visibility check
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || 
      style.opacity === '0') {
    score -= 0.5;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Checks if element is visible and interactable
 */
function isElementInteractable(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 15) return false;
  
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || 
      style.opacity === '0') return false;
  
  // Check if element is actually in viewport
  if (rect.bottom < 0 || rect.top > window.innerHeight ||
      rect.right < 0 || rect.left > window.innerWidth) return false;

  return true;
}

/**
 * Searches for input elements in the given context
 */
function findInputElements(context: Document | DocumentFragment | Element = document): DetectedInput[] {
  const site = window.location.hostname.replace('www.', '');
  const inputs: DetectedInput[] = [];
  
  // Site-specific selectors first
  const siteSelectors = SITE_SPECIFIC_SELECTORS.get(site) || [];
  const allSelectors = [...siteSelectors, ...GENERIC_SELECTORS];

  for (const selector of allSelectors) {
    try {
      const elements = context.querySelectorAll(selector);
      
      for (const element of elements) {
        if (!isElementInteractable(element)) continue;
        
        const confidence = calculateConfidence(element, site);
        if (confidence < 0.3) continue; // Skip low-confidence elements
        
        let type: DetectedInput['type'];
        if (element.tagName === 'TEXTAREA') {
          type = 'textarea';
        } else if (element.tagName === 'INPUT') {
          type = 'input';
        } else if (element.getAttribute('contenteditable') === 'true') {
          type = 'contenteditable';
        } else if (element.getAttribute('role') === 'textbox') {
          type = 'textbox';
        } else {
          continue;
        }

        inputs.push({
          element,
          type,
          site,
          confidence
        });
      }
    } catch (error) {
      // Skip invalid selectors
      continue;
    }
  }

  // Sort by confidence descending
  return inputs.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Searches for inputs in Shadow DOM
 */
function findInputsInShadowDOM(root: Element): DetectedInput[] {
  const inputs: DetectedInput[] = [];
  
  if (root.shadowRoot && root.shadowRoot.mode === 'open') {
    try {
      inputs.push(...findInputElements(root.shadowRoot));
      
      // Recursively search nested shadow roots
      const shadowElements = root.shadowRoot.querySelectorAll('*');
      for (const element of shadowElements) {
        inputs.push(...findInputsInShadowDOM(element));
      }
    } catch (error) {
      // Handle shadow DOM access errors
    }
  }
  
  return inputs;
}

/**
 * Universal Input Detector Class
 */
export class UniversalInputDetector {
  private mutationObserver?: MutationObserver;
  private intersectionObserver?: IntersectionObserver;
  private detectedInputs = new Set<Element>();
  private debounceTimer?: number;
  private callbacks = new Set<(inputs: DetectedInput[]) => void>();
  
  constructor(private options: InputDetectionOptions = {}) {
    this.options = {
      debounceMs: 300,
      minLength: 0,
      excludePasswordFields: true,
      ...options
    };
  }

  /**
   * Start detecting inputs
   */
  start(): void {
    this.setupMutationObserver();
    this.setupIntersectionObserver();
    this.performInitialScan();
  }

  /**
   * Stop detecting inputs
   */
  stop(): void {
    this.mutationObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  /**
   * Subscribe to input detection events
   */
  onInputsDetected(callback: (inputs: DetectedInput[]) => void): void {
    this.callbacks.add(callback);
  }

  /**
   * Unsubscribe from input detection events
   */
  offInputsDetected(callback: (inputs: DetectedInput[]) => void): void {
    this.callbacks.delete(callback);
  }

  /**
   * Manually scan for inputs
   */
  scanForInputs(): DetectedInput[] {
    const inputs = findInputElements(document);
    
    // Also scan shadow DOM
    const shadowHosts = document.querySelectorAll('*');
    for (const host of shadowHosts) {
      inputs.push(...findInputsInShadowDOM(host));
    }
    
    return inputs;
  }

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      let shouldScan = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if any added nodes are or contain input elements
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (this.isInputElement(element) || 
                  element.querySelector('input, textarea, [contenteditable], [role="textbox"]')) {
                shouldScan = true;
                break;
              }
            }
          }
        } else if (mutation.type === 'attributes' && 
                   (mutation.attributeName === 'contenteditable' ||
                    mutation.attributeName === 'role' ||
                    mutation.attributeName === 'placeholder')) {
          shouldScan = true;
        }
        
        if (shouldScan) break;
      }
      
      if (shouldScan) {
        this.debouncedScan();
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['contenteditable', 'role', 'placeholder', 'aria-label']
    });
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver((entries) => {
      let shouldScan = false;
      
      for (const entry of entries) {
        if (entry.isIntersecting && this.isInputElement(entry.target)) {
          shouldScan = true;
          break;
        }
      }
      
      if (shouldScan) {
        this.debouncedScan();
      }
    }, {
      threshold: 0.1,
      rootMargin: '50px'
    });
  }

  private performInitialScan(): void {
    // Initial scan after a short delay to let the page load
    setTimeout(() => {
      this.debouncedScan();
    }, 100);
  }

  private debouncedScan(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = window.setTimeout(() => {
      const inputs = this.scanForInputs();
      
      // Filter out inputs we've already detected
      const newInputs = inputs.filter(input => !this.detectedInputs.has(input.element));
      
      if (newInputs.length > 0) {
        // Update detected inputs set
        newInputs.forEach(input => this.detectedInputs.add(input.element));
        
        // Start observing new inputs with intersection observer
        newInputs.forEach(input => {
          this.intersectionObserver?.observe(input.element);
        });
        
        // Notify callbacks
        this.callbacks.forEach(callback => {
          try {
            callback(newInputs);
          } catch (error) {
            // Handle callback errors gracefully
            console.warn('Universal input detector callback error:', error);
          }
        });
      }
    }, this.options.debounceMs);
  }

  private isInputElement(element: Element): boolean {
    return element.tagName === 'INPUT' ||
           element.tagName === 'TEXTAREA' ||
           element.getAttribute('contenteditable') === 'true' ||
           element.getAttribute('role') === 'textbox';
  }
}