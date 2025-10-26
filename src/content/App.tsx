import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo, useRef } from 'react';
import Widget from './Widget';
import RefineButton from './RefineButton';
import SuggestionBubble from './SuggestionBubble';
import ErrorBoundary from '../components/ErrorBoundary';
import './styles.css';

interface AppProps {
  isChatGPT: boolean;
}

interface AppHandle {
  setIsVisible: (visible: boolean) => void;
}

interface Position {
  x: number;
  y: number;
}

interface SelectionInfo {
  element: Element;
  text: string;
  startIndex?: number;
  endIndex?: number;
  isFullSelection: boolean;
}

interface SelectionIndices {
  start: number;
  end: number;
}

const ALLOWED_HOSTNAMES = [
  'chatgpt.com',         // ChatGPT
  'claude.ai',           // Claude
  'www.perplexity.ai',   // Perplexity
  'perplexity.ai',       // Perplexity
  'gemini.google.com',   // Gemini
  'chat.anthropic.com',  // Claude (alternative URL)
  'poe.com',            // Poe
  'bard.google.com'     // Bard
] as const;

/**
 * Sanitizes text input to prevent XSS attacks
 */
const sanitizeText = (text: string): string => {
  return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
             .replace(/javascript:/gi, '')
             .replace(/on\w+\s*=/gi, '')
             .trim();
};

/**
 * Checks if an element is an input field that can be edited
 */
const isEditableInput = (element: Element | null): boolean => {
  if (!element) return false;
  
  return element instanceof HTMLInputElement ||
         element instanceof HTMLTextAreaElement ||
         element.getAttribute('contenteditable') === 'true' ||
         !!element.closest('[contenteditable="true"]');
};

/**
 * Gets text content from an element safely
 */
const getElementText = (element: Element): string => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  return element.textContent || '';
};

/**
 * Gets the editable element (either the element itself or closest contenteditable)
 */
const getEditableElement = (element: Element | null): Element | null => {
  if (!element) return null;
  
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element;
  }
  
  if (element.getAttribute('contenteditable') === 'true') {
    return element;
  }
  
  return element.closest('[contenteditable="true"]');
};

/**
 * Gets selection indices in an input element
 */
const getSelectionIndices = (element: Element): SelectionIndices | null => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return {
      start: element.selectionStart || 0,
      end: element.selectionEnd || 0
    };
  } else if (element.getAttribute('contenteditable') === 'true' || element.closest('[contenteditable="true"]')) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    
    const range = selection.getRangeAt(0);
    const fullText = element.textContent || '';
    
    // This is a simplified approach and might not work for all complex contenteditable scenarios
    // For more complex scenarios, we'd need to use Range.startOffset and Range.endOffset
    // and potentially traverse the DOM to find the exact text indices
    const selectedText = range.toString();
    const startIndex = fullText.indexOf(selectedText);
    
    if (startIndex === -1) return null;
    
    return {
      start: startIndex,
      end: startIndex + selectedText.length
    };
  }
  
  return null;
};

const App = forwardRef<AppHandle, AppProps>(({ isChatGPT }, ref) => {
  const [selectedText, setSelectedText] = useState<string>('');
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [showRefineButton, setShowRefineButton] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const lastSelectionRef = useRef<SelectionInfo | null>(null);
  const originalSelectionRangeRef = useRef<Range | null>(null);
  const selectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectionTextRef = useRef<string>('');

  const allowedHostnamesSet = useMemo(() => new Set(ALLOWED_HOSTNAMES), []);

  const isAllowedHostname = useCallback((): boolean => {
    const hostname = window.location.hostname;
    return Array.from(allowedHostnamesSet).some(allowedHostname => 
      hostname === allowedHostname || hostname.endsWith('.' + allowedHostname)
    );
  }, [allowedHostnamesSet]);

  const processSelectedText = useCallback((text: string, inputElement: Element | null, selectionIndices?: SelectionIndices): void => {
    const sanitizedText = sanitizeText(text);
    if (sanitizedText && inputElement) {
      // Check if this is the same text as before to prevent duplicate processing
      if (lastSelectionTextRef.current === sanitizedText) {
        return;
      }
      
      // Always update selection info and selectedText for new selections
      lastSelectionTextRef.current = sanitizedText;
      setSelectedText(sanitizedText);
      
      const fullText = getElementText(inputElement);
      const isFullSelection = sanitizedText === fullText;
      
      lastSelectionRef.current = {
        element: inputElement,
        text: sanitizedText,
        startIndex: selectionIndices?.start,
        endIndex: selectionIndices?.end,
        isFullSelection
      };

      // Store the current selection range for later restoration
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        originalSelectionRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
      
      // Only show refine button if widget is not visible
      if (!isVisible) {
        setShowRefineButton(false);
        setTimeout(() => {
          setShowRefineButton(true);
        }, 50);
      }
    }
  }, [isVisible]);

  const checkCurrentSelection = useCallback((): void => {
    if (!isAllowedHostname()) return;

    try {
      const selection = window.getSelection();
      if (!selection) return;

      const text = selection.toString().trim();
      if (!text) return;

      const activeElement = document.activeElement;
      const editableElement = getEditableElement(activeElement);
      
      if (editableElement) {
        const indices = getSelectionIndices(editableElement);
        processSelectedText(text, editableElement, indices || undefined);
      }
    } catch (error) {
      console.error('Error checking selection:', error);
    }
  }, [isAllowedHostname, processSelectedText]);

  useImperativeHandle(ref, () => ({
    setIsVisible: (visible: boolean) => {
      if (visible && isAllowedHostname()) {
        checkCurrentSelection();
      }
      setIsVisible(visible && isAllowedHostname());
    }
  }), [isAllowedHostname, checkCurrentSelection]);

  const handleClose = useCallback((): void => {
    setIsVisible(false);
  }, []);

  const handleRefineButtonClose = useCallback((): void => {
    setShowRefineButton(false);
    lastSelectionTextRef.current = '';
  }, []);

  const handleRefineClick = useCallback((): void => {
    // If widget is already visible, do nothing
    if (isVisible) {
      setShowRefineButton(false);
      return;
    }

    // Open widget
    setShowRefineButton(false);
    setIsVisible(true);
  }, [isVisible]);

  const checkForPrefilledText = useCallback((): void => {
    if (!isAllowedHostname()) return;

    try {
      const activeElement = document.activeElement;
      const editableElement = getEditableElement(activeElement);
      
      if (!editableElement) return;

      const text = getElementText(editableElement);
      if (text.trim()) {
        processSelectedText(text, editableElement);
      }
    } catch (error) {
      console.error('Error checking prefilled text:', error);
    }
  }, [isAllowedHostname, processSelectedText]);

  const handleSelection = useCallback((e: Event): void => {
    if (!isAllowedHostname()) return;

    // Ignore events from the widget or refine button to prevent interference
    if (e.target instanceof HTMLElement && 
        (e.target.closest('.prompt-layer-container') || 
         e.target.closest('#prompt-layer-root'))) {
      return;
    }

    if (isDragging) return;

    // Clear existing timeout
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
    }

    // Debounce selection changes to prevent multiple triggers
    selectionTimeoutRef.current = setTimeout(() => {
      try {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        
        if (text) {
          // We have actual text selected
          const activeElement = document.activeElement;
          const editableElement = getEditableElement(activeElement);
          
          if (editableElement) {
            const indices = getSelectionIndices(editableElement);
            processSelectedText(text, editableElement, indices || undefined);
          }
        } else {
          // No text selected - only clear refine button if widget is closed
          if (!isVisible) {
            setShowRefineButton(false);
            lastSelectionTextRef.current = '';
          }
          // Don't clear selectedText - let it persist for widget
        }
      } catch (error) {
        console.error('Error handling selection:', error);
      }
    }, 150);
  }, [isAllowedHostname, isDragging, processSelectedText, isVisible]);

  useEffect(() => {
    // Add event listeners for text selection
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('keyup', handleSelection);
    document.addEventListener('selectionchange', handleSelection);
    window.addEventListener('load', checkForPrefilledText);

    // Cleanup function to remove event listeners
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('keyup', handleSelection);
      document.removeEventListener('selectionchange', handleSelection);
      window.removeEventListener('load', checkForPrefilledText);
      
      // Clean up timeout
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
    };
  }, [handleSelection, checkForPrefilledText]);

  const handleDragStart = useCallback((): void => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback((): void => {
    setIsDragging(false);
  }, []);
  
  const handleReplaceText = useCallback((newText: string): void => {
    if (!lastSelectionRef.current) {
      return;
    }
    
    const selectionInfo = lastSelectionRef.current;
    const element = selectionInfo.element;
    
    try {
      // For standard input and textarea elements
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (selectionInfo.isFullSelection || selectionInfo.startIndex === undefined || selectionInfo.endIndex === undefined) {
          element.value = newText;
        } else {
          const originalText = element.value;
          const start = selectionInfo.startIndex;
          const end = selectionInfo.endIndex;
          
          const newFullText = originalText.substring(0, start) + newText + originalText.substring(end);
          element.value = newFullText;
          
          // Restore cursor position to the end of the replaced text
          element.selectionStart = start + newText.length;
          element.selectionEnd = start + newText.length;
        }
        
        // Trigger events to ensure the change is detected (but don't trigger Enter)
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      
      // For contenteditable elements (most LLM websites)
      const contentEditableElement = element.getAttribute('contenteditable') === 'true' 
        ? element 
        : element.closest('[contenteditable="true"]');
        
      if (contentEditableElement) {
        // Focus the element first
        if (contentEditableElement instanceof HTMLElement) {
          contentEditableElement.focus();
        }
        
        // Method 1: Try using execCommand (legacy but widely supported)
        try {
          // Select all content if it was a full selection
          if (selectionInfo.isFullSelection) {
            document.execCommand('selectAll', false);
          }
          
          // Insert the new text
          const success = document.execCommand('insertText', false, newText);
          
          if (success) {
            // Trigger events for the contenteditable element (but don't trigger Enter)
            contentEditableElement.dispatchEvent(new Event('input', { bubbles: true }));
            contentEditableElement.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        } catch (execCommandError) {
          // execCommand failed, trying manual approach
        }
        
        // Method 2: Manual approach using Selection API
        const selection = window.getSelection();
        if (selection) {
          // Clear current selection
          selection.removeAllRanges();
          
          // Create a new range
          const range = document.createRange();
          
          if (selectionInfo.isFullSelection) {
            // Select all content
            range.selectNodeContents(contentEditableElement);
          } else if (originalSelectionRangeRef.current) {
            // Use the stored range
            range.setStart(originalSelectionRangeRef.current.startContainer, originalSelectionRangeRef.current.startOffset);
            range.setEnd(originalSelectionRangeRef.current.endContainer, originalSelectionRangeRef.current.endOffset);
          } else {
            // Fallback: select all content
            range.selectNodeContents(contentEditableElement);
          }
          
          // Select the range
          selection.addRange(range);
          
          // Delete the selected content
          range.deleteContents();
          
          // Insert the new text as text nodes (preserving line breaks)
          const lines = newText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              // Insert a line break
              const br = document.createElement('br');
              range.insertNode(br);
              range.setStartAfter(br);
            }
            
            if (lines[i]) {
              // Insert the text
              const textNode = document.createTextNode(lines[i]);
              range.insertNode(textNode);
              range.setStartAfter(textNode);
            }
          }
          
          // Collapse the range to the end
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          
          // Trigger events (but don't trigger Enter)
          contentEditableElement.dispatchEvent(new Event('input', { bubbles: true }));
          contentEditableElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        // Fallback for other elements
        if (selectionInfo.isFullSelection) {
          element.textContent = newText;
        } else {
          const originalText = element.textContent || '';
          const start = selectionInfo.startIndex || 0;
          const end = selectionInfo.endIndex || originalText.length;
          
          const newFullText = originalText.substring(0, start) + newText + originalText.substring(end);
          element.textContent = newFullText;
        }
        
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (error) {
      console.error('Error replacing text:', error);
    }
  }, []);

  const handleUpdateTargetSelection = useCallback((): boolean => {
    // If we already have valid selection info, don't override it
    if (lastSelectionRef.current?.element) {
      try {
        const storedElement = lastSelectionRef.current.element;
        const rect = storedElement.getBoundingClientRect();
        const style = window.getComputedStyle(storedElement);
        
        if (rect.width > 0 && rect.height > 0 && 
            style.display !== 'none' && 
            style.visibility !== 'hidden' && 
            style.opacity !== '0') {
          
          // Element is still valid, restore the ORIGINAL selection (don't force full selection)
          if (storedElement instanceof HTMLInputElement || storedElement instanceof HTMLTextAreaElement) {
            storedElement.focus();
            
            // If we have partial selection info, restore it; otherwise select all
            if (!lastSelectionRef.current.isFullSelection && 
                lastSelectionRef.current.startIndex !== undefined && 
                lastSelectionRef.current.endIndex !== undefined) {
              storedElement.setSelectionRange(lastSelectionRef.current.startIndex, lastSelectionRef.current.endIndex);
            } else {
              storedElement.select();
              storedElement.setSelectionRange(0, storedElement.value.length);
            }
          } else if (storedElement.hasAttribute('contenteditable')) {
            const selection = window.getSelection();
            
            (storedElement as HTMLElement).focus();
            
            if (!lastSelectionRef.current.isFullSelection && originalSelectionRangeRef.current) {
              // Restore the original partial selection
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(originalSelectionRangeRef.current);
              }
            } else {
              // Full selection
              const range = document.createRange();
              range.selectNodeContents(storedElement);
              
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
              }
            }
          }
          
          // DON'T override the selection info - keep it as it was originally
          return true;
        }
      } catch (error) {
        // Stored element is no longer valid
      }
    }

    // Try to find and update the target selection
    const selectors = [
      // ChatGPT - multiple variations
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="message"]',
      'textarea[data-id="root"]',
      '#prompt-textarea',
      'textarea[id*="prompt"]',
      'div[contenteditable="true"][data-testid*="prompt"]',
      
      // Claude - multiple variations
      'div[contenteditable="true"][data-testid="composer-input"]',
      'div[contenteditable="true"][data-testid*="composer"]',
      'div[contenteditable="true"][role="textbox"]',
      
      // Gemini and Google AI
      'textarea[placeholder*="Enter a prompt"]',
      'textarea[placeholder*="prompt"]',
      'div[contenteditable="true"][aria-label*="prompt"]',
      
      // Perplexity
      'textarea[placeholder*="Ask anything"]',
      'textarea[placeholder*="Ask"]',
      
      // Generic fallbacks - broader search
      'textarea:not([readonly]):not([disabled]):not([type="password"])',
      'div[contenteditable="true"]:not([readonly])',
      '[role="textbox"]:not([readonly])',
      'textarea[rows]',
      'textarea[cols]'
    ];

    // If no valid stored element, try to find a new target element
    let foundElement: Element | null = null;
    
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        
        for (const element of elements) {
          // Skip if element is not visible or too small
          const rect = element.getBoundingClientRect();
          if (rect.width < 50 || rect.height < 20) continue;
          
          // Skip if element is not in viewport or hidden
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          
          foundElement = element;
          break;
        }
        if (foundElement) break;
      } catch (e) {
        console.warn('Error with selector:', selector, e);
        continue;
      }
    }

    if (foundElement) {
      try {
        // Select all text in the found element (fallback behavior)
        if (foundElement instanceof HTMLInputElement || foundElement instanceof HTMLTextAreaElement) {
          foundElement.focus();
          foundElement.select();
          foundElement.setSelectionRange(0, foundElement.value.length);
        } else if (foundElement.hasAttribute('contenteditable')) {
          const range = document.createRange();
          const selection = window.getSelection();
          
          (foundElement as HTMLElement).focus();
          range.selectNodeContents(foundElement);
          
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
            originalSelectionRangeRef.current = range.cloneRange();
          }
        }
        
        // Update lastSelectionRef with the new element (full selection as fallback)
        lastSelectionRef.current = {
          element: foundElement,
          text: getElementText(foundElement),
          isFullSelection: true,
          startIndex: undefined,
          endIndex: undefined
        };
        
        // Updated target selection
        return true;
      } catch (selectionError) {
        console.warn('Could not select target element:', selectionError);
      }
    }
    
    return false;
  }, []);

  // Early return if not on allowed hostname
  if (!isAllowedHostname()) {
    return null;
  }

  return (
    <ErrorBoundary>
      <div className="prompt-layer-container">
        {showRefineButton && (
          <RefineButton
            onRefineClick={handleRefineClick}
            onClose={handleRefineButtonClose}
          />
        )}
        
        {isVisible && (
          <Widget
            isChatGPT={isChatGPT}
            selectedText={selectedText}
            onClose={handleClose}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onReplaceText={handleReplaceText}
            onUpdateTargetSelection={handleUpdateTargetSelection}
          />
        )}
        
        <SuggestionBubble />
      </div>
    </ErrorBoundary>
  );
});

App.displayName = 'App';

export default App; 