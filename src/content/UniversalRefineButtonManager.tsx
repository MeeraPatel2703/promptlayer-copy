/**
 * Universal Refine Button Manager
 * Manages the display and positioning of RefineButton across all websites
 */

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import RefineButton from './RefineButton';
import { UniversalInputDetector, DetectedInput } from './universalInputDetector';
import { sendToClaudeAI } from '../services/claude';

interface ActiveInput {
  element: Element;
  type: DetectedInput['type'];
  confidence: number;
  lastActivity: number;
}

interface ButtonPosition {
  x: number;
  y: number;
  visible: boolean;
}

/**
 * Gets text content from any input element type
 */
function getInputText(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || '';
  }
  if (element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox') {
    return element.textContent || element.innerText || '';
  }
  return '';
}

/**
 * Gets selected text from input element
 */
function getSelectedText(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart || 0;
    const end = element.selectionEnd || 0;
    return element.value.substring(start, end) || '';
  }
  
  // For contenteditable elements, use window selection
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (element.contains(range.commonAncestorContainer)) {
      return selection.toString();
    }
  }
  
  return '';
}

/**
 * Sets text content in any input element type
 */
function setInputText(element: Element, text: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, text);
      
      // Trigger input events to notify React and other frameworks
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox') {
    element.textContent = text;
    
    // Trigger input events for contenteditable
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Calculates optimal button position for an input element
 */
function calculateButtonPosition(element: Element): ButtonPosition {
  try {
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    // Position at bottom-right of input field with small offset
    const buttonSize = 32;
    const offset = 8;
    
    let x = rect.right + scrollX + offset;
    let y = rect.bottom + scrollY - buttonSize - offset;
    
    // Keep within viewport bounds
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust if too far right
    if (x + buttonSize > scrollX + viewportWidth - 10) {
      x = rect.left + scrollX - buttonSize - offset;
    }
    
    // Adjust if too far down
    if (y + buttonSize > scrollY + viewportHeight - 10) {
      y = rect.top + scrollY - buttonSize - offset;
    }
    
    // Ensure minimum distance from edges
    x = Math.max(scrollX + 10, Math.min(x, scrollX + viewportWidth - buttonSize - 10));
    y = Math.max(scrollY + 10, Math.min(y, scrollY + viewportHeight - buttonSize - 10));
    
    return { x, y, visible: true };
  } catch (error) {
    return { x: 0, y: 0, visible: false };
  }
}

/**
 * Universal Refine Button Manager Class
 */
export class UniversalRefineButtonManager {
  private detector: UniversalInputDetector;
  private activeInput: ActiveInput | null = null;
  private buttonContainer: HTMLDivElement | null = null;
  private buttonRoot: Root | null = null;
  private buttonPosition: ButtonPosition = { x: 0, y: 0, visible: false };
  private repositionTimer?: number;
  private hideTimer?: number;
  private typingTimer?: number;
  private focusListener?: () => void;
  private blurListener?: () => void;
  private selectionListener?: () => void;
  private keyListener?: (e: KeyboardEvent) => void;

  constructor() {
    this.detector = new UniversalInputDetector({
      debounceMs: 300,
      minLength: 0,
      excludePasswordFields: true
    });
  }

  /**
   * Initialize the manager
   */
  init(): void {
    this.createButtonContainer();
    this.detector.onInputsDetected(this.handleInputsDetected.bind(this));
    this.detector.start();
    
    // Set up global listeners
    this.setupGlobalListeners();
  }

  /**
   * Cleanup the manager
   */
  destroy(): void {
    this.detector.stop();
    this.hideButton();
    this.removeGlobalListeners();
    
    if (this.buttonContainer && this.buttonContainer.parentNode) {
      this.buttonContainer.parentNode.removeChild(this.buttonContainer);
    }
    
    this.buttonRoot?.unmount();
    this.buttonContainer = null;
    this.buttonRoot = null;
  }

  private createButtonContainer(): void {
    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'prompt-layer-universal-button-container';
    this.buttonContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      z-index: 2147483646;
      pointer-events: none;
    `;
    
    // Try to append to body, fallback to documentElement
    const targetParent = document.body || document.documentElement;
    targetParent.appendChild(this.buttonContainer);
    
    this.buttonRoot = createRoot(this.buttonContainer);
  }

  private setupGlobalListeners(): void {
    // Document-level listeners for better event handling
    this.focusListener = (e: Event) => {
      const target = e.target as Element;
      if (this.isRelevantInput(target)) {
        this.handleInputFocus(target);
      }
    };

    this.blurListener = (e: Event) => {
      const target = e.target as Element;
      if (this.activeInput?.element === target) {
        this.handleInputBlur();
      }
    };

    this.selectionListener = () => {
      if (this.activeInput) {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          this.showButton();
        }
      }
    };

    this.keyListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.buttonPosition.visible) {
        this.hideButton();
      }
      
      // Show button after typing pause
      if (this.activeInput && this.isTypingKey(e.key)) {
        this.handleTyping();
      }
    };

    document.addEventListener('focusin', this.focusListener, true);
    document.addEventListener('focusout', this.blurListener, true);
    document.addEventListener('selectionchange', this.selectionListener);
    document.addEventListener('keydown', this.keyListener);
  }

  private removeGlobalListeners(): void {
    if (this.focusListener) {
      document.removeEventListener('focusin', this.focusListener, true);
    }
    if (this.blurListener) {
      document.removeEventListener('focusout', this.blurListener, true);
    }
    if (this.selectionListener) {
      document.removeEventListener('selectionchange', this.selectionListener);
    }
    if (this.keyListener) {
      document.removeEventListener('keydown', this.keyListener);
    }
  }

  private handleInputsDetected(inputs: DetectedInput[]): void {
    // For now, we'll handle focus-based activation
    // The mutation observer helps us discover new inputs as they appear
  }

  private isRelevantInput(element: Element): boolean {
    // Quick check if this is a text input element
    return element instanceof HTMLInputElement ||
           element instanceof HTMLTextAreaElement ||
           element.getAttribute('contenteditable') === 'true' ||
           element.getAttribute('role') === 'textbox';
  }

  private handleInputFocus(element: Element): void {
    this.activeInput = {
      element,
      type: this.getInputType(element),
      confidence: 1.0, // Focused elements get high confidence
      lastActivity: Date.now()
    };

    // Show button after short delay if there's content or after typing
    const text = getInputText(element);
    if (text.length > 3) {
      setTimeout(() => this.showButton(), 100);
    }
  }

  private handleInputBlur(): void {
    // Hide button with delay to allow for button clicks
    this.hideTimer = window.setTimeout(() => {
      this.hideButton();
      this.activeInput = null;
    }, 150);
  }

  private handleTyping(): void {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
    }

    // Show button after typing pause
    this.typingTimer = window.setTimeout(() => {
      if (this.activeInput) {
        const text = getInputText(this.activeInput.element);
        if (text.length > 3) {
          this.showButton();
        }
      }
    }, 600); // 600ms pause after typing
  }

  private isTypingKey(key: string): boolean {
    // Ignore modifier keys, arrow keys, etc.
    return key.length === 1 || key === 'Backspace' || key === 'Delete';
  }

  private getInputType(element: Element): DetectedInput['type'] {
    if (element.tagName === 'TEXTAREA') return 'textarea';
    if (element.tagName === 'INPUT') return 'input';
    if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
    if (element.getAttribute('role') === 'textbox') return 'textbox';
    return 'textarea'; // fallback
  }

  private showButton(): void {
    if (!this.activeInput || !this.buttonRoot) return;

    const position = calculateButtonPosition(this.activeInput.element);
    this.buttonPosition = position;

    if (position.visible) {
      // Clear any existing hide timer
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = undefined;
      }

      // Update container position
      if (this.buttonContainer) {
        this.buttonContainer.style.left = `${position.x}px`;
        this.buttonContainer.style.top = `${position.y}px`;
        this.buttonContainer.style.pointerEvents = 'auto';
      }

      // Render the button
      this.buttonRoot.render(
        <RefineButton
          onRefineClick={this.handleRefineClick.bind(this)}
          onClose={this.handleButtonClose.bind(this)}
        />
      );

      // Set up repositioning on scroll/resize
      this.setupRepositioning();
    }
  }

  private hideButton(): void {
    this.buttonPosition = { x: 0, y: 0, visible: false };
    
    if (this.buttonContainer) {
      this.buttonContainer.style.pointerEvents = 'none';
    }

    if (this.buttonRoot) {
      this.buttonRoot.render(null);
    }

    this.removeRepositioning();
  }

  private setupRepositioning(): void {
    const reposition = () => {
      if (this.activeInput && this.buttonPosition.visible) {
        const newPosition = calculateButtonPosition(this.activeInput.element);
        if (newPosition.visible) {
          this.buttonPosition = newPosition;
          if (this.buttonContainer) {
            this.buttonContainer.style.left = `${newPosition.x}px`;
            this.buttonContainer.style.top = `${newPosition.y}px`;
          }
        } else {
          this.hideButton();
        }
      }
    };

    const throttledReposition = this.throttle(reposition, 16); // ~60fps

    window.addEventListener('scroll', throttledReposition, { passive: true });
    window.addEventListener('resize', throttledReposition, { passive: true });

    // Store reference for cleanup
    this.repositionTimer = throttledReposition as any;
  }

  private removeRepositioning(): void {
    if (this.repositionTimer) {
      window.removeEventListener('scroll', this.repositionTimer, { passive: true } as any);
      window.removeEventListener('resize', this.repositionTimer, { passive: true } as any);
      this.repositionTimer = undefined;
    }
  }

  private throttle(func: Function, delay: number): () => void {
    let timeoutId: number | undefined;
    let lastExecTime = 0;
    
    return () => {
      const currentTime = Date.now();
      
      if (currentTime - lastExecTime > delay) {
        func();
        lastExecTime = currentTime;
      } else {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          func();
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  }

  private async handleRefineClick(): Promise<void> {
    if (!this.activeInput) return;

    try {
      const element = this.activeInput.element;
      const selectedText = getSelectedText(element);
      const fullText = getInputText(element);
      const textToRefine = selectedText || fullText;

      if (!textToRefine.trim()) return;

      // Use the existing Claude AI service to refine the text
      const response = await sendToClaudeAI(textToRefine, []);

      if (response.content && !response.error) {
        if (selectedText) {
          // Replace selected text
          this.replaceSelectedText(element, response.content);
        } else {
          // Replace full text
          setInputText(element, response.content);
        }
      }
    } catch (error) {
      // Handle errors gracefully
      console.warn('Universal refine button error:', error);
    } finally {
      this.hideButton();
    }
  }

  private replaceSelectedText(element: Element, newText: string): void {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const start = element.selectionStart || 0;
      const end = element.selectionEnd || 0;
      const currentValue = element.value;
      
      const newValue = currentValue.substring(0, start) + newText + currentValue.substring(end);
      setInputText(element, newValue);
      
      // Set cursor position after replaced text
      const newCursorPos = start + newText.length;
      element.setSelectionRange(newCursorPos, newCursorPos);
    } else {
      // For contenteditable elements, use Selection API
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (element.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          const textNode = document.createTextNode(newText);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  }

  private handleButtonClose(): void {
    this.hideButton();
  }
}

// Global instance
let globalManager: UniversalRefineButtonManager | null = null;

/**
 * Initialize the universal refine button system
 */
export function initUniversalRefineButton(): void {
  if (!globalManager) {
    globalManager = new UniversalRefineButtonManager();
    globalManager.init();
  }
}

/**
 * Cleanup the universal refine button system
 */
export function destroyUniversalRefineButton(): void {
  if (globalManager) {
    globalManager.destroy();
    globalManager = null;
  }
}