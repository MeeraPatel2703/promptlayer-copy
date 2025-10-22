import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { extractPageContent } from './contextExtractor';
import { createRealtimeMonitor } from '../services/realtimeMonitor';
import { initUniversalRefineButton, destroyUniversalRefineButton } from './UniversalRefineButtonManager';

interface AppInstance {
  setIsVisible: (visible: boolean) => void;
}

interface ChromeMessage {
  action: string;
  timestamp?: number;
  data?: any;
}

/**
 * Type guard to check if error has message property
 */
function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Extract error message safely
 */
function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

const WIDGET_CONTAINER_ID = 'promptlayer-widget-container';

let appInstance: AppInstance | null = null;
let rootInstance: any = null;
let realtimeMonitor: any = null;
let universalRefineInitialized = false;

// Initialize real-time monitoring
const initializeRealtimeMonitoring = () => {
  if (!realtimeMonitor) {
    realtimeMonitor = createRealtimeMonitor();
    realtimeMonitor.start();
  }
};

// Initialize universal refine button
const initializeUniversalRefine = () => {
  if (!universalRefineInitialized) {
    initUniversalRefineButton();
    universalRefineInitialized = true;
  }
};

// Create and manage the widget container
const createWidgetContainer = (): HTMLDivElement => {
  let container = document.getElementById(WIDGET_CONTAINER_ID) as HTMLDivElement;
  
  if (!container) {
    container = document.createElement('div');
    container.id = WIDGET_CONTAINER_ID;
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    `;
    document.body.appendChild(container);
  }
  
  return container;
};

/**
 * Handle messages from popup and background script
 */
chrome.runtime.onMessage.addListener((message: ChromeMessage, _sender, sendResponse) => {
  try {
    switch (message.action) {
      case 'SPAWN_WIDGET':
      case 'TOGGLE_WIDGET':
        if (appInstance) {
          appInstance.setIsVisible(true);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'App not initialized' });
        }
        break;
        
      case 'HIDE_WIDGET':
        if (appInstance) {
          appInstance.setIsVisible(false);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'App not initialized' });
        }
        break;

      case 'EXTRACT_PAGE_CONTENT':
        try {
          const extractedContent = extractPageContent();
          sendResponse({ success: true, data: extractedContent });
        } catch (error) {
          console.error('Error extracting page content:', getErrorMessage(error));
          sendResponse({ success: false, error: getErrorMessage(error) });
        }
        break;
        
      default:
        sendResponse({ success: false, error: 'Unknown action' });
        break;
    }
  } catch (error) {
    console.error('Error handling message in content script:', getErrorMessage(error));
    sendResponse({ success: false, error: getErrorMessage(error) });
  }
  
  return true; // Indicate async response
});

/**
 * Initialize the React application
 */
function initializeApp(): void {
  const container = createWidgetContainer();
  
  if (!rootInstance) {
    rootInstance = createRoot(container);
    
    const isChatGPT = window.location.hostname.includes('chatgpt.com') || 
                     window.location.hostname.includes('chat.openai.com');
    
    rootInstance.render(<App ref={(ref: any) => { appInstance = ref; }} isChatGPT={isChatGPT} />);
  }
  
  // Initialize real-time monitoring
  initializeRealtimeMonitoring();
  
  // Initialize universal refine button
  initializeUniversalRefine();
}

/**
 * Wait for DOM to be ready before initialization
 */
function waitForDOMReady(): Promise<void> {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve());
    } else {
      resolve();
    }
  });
}

/**
 * Initialize when DOM is ready
 */
waitForDOMReady().then(() => {
  // Add a small delay to ensure the page has fully loaded
  setTimeout(initializeApp, 100);
});

/**
 * Handle page navigation (for SPAs)
 */
const observer = new MutationObserver((mutations) => {
  let shouldReinitialize = false;
  
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Check if significant DOM changes occurred (new input fields, etc.)
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element && (
          node.querySelector('textarea') || 
          node.querySelector('[contenteditable="true"]') ||
          node.matches('textarea') ||
          node.matches('[contenteditable="true"]')
        )) {
          shouldReinitialize = true;
        }
      });
    }
  });
  
  if (shouldReinitialize && realtimeMonitor) {
    // Restart monitoring to detect new input fields
    setTimeout(() => {
      realtimeMonitor.stop();
      realtimeMonitor.start();
    }, 1000);
  }
});

// Start observing URL changes
observer.observe(document.body, { childList: true, subtree: true });

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
  observer.disconnect();
  if (universalRefineInitialized) {
    destroyUniversalRefineButton();
    universalRefineInitialized = false;
  }
  realtimeMonitor = null;
  appInstance = null;
  rootInstance = null;
});

 