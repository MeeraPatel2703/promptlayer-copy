/**
 * PromptLayer Background Script
 * Handles extension lifecycle events and cross-tab communication
 */
import { getApiKey } from '../services/storage';
import { initClaudeAI } from '../services/claude';

interface ExtensionState {
  isEnabled: boolean;
  usageCount: number;
  lastUsed: number;
}

const DEFAULT_STATE: ExtensionState = {
  isEnabled: true,
  usageCount: 0,
  lastUsed: 0
};

/**
 * Check if the extension context is valid
 */
const isExtensionContextValid = (): boolean => {
  return !!(chrome && chrome.runtime && chrome.runtime.id);
};

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
 * Get error message safely
 */
function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Initialize extension state on installation
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalidated during installation');
      return;
    }

    if (details.reason === 'install') {
      // Set default state for new installations
      await chrome.storage.local.set(DEFAULT_STATE);
      
      // Set default badge text
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#a3a3a3' });
    } else if (details.reason === 'update') {
      // Handle extension updates
      const currentVersion = chrome.runtime.getManifest().version;
      const { lastVersion } = await chrome.storage.local.get(['lastVersion']);
      
      if (lastVersion !== currentVersion) {
        await chrome.storage.local.set({ lastVersion: currentVersion });
        // Could trigger migration logic here if needed
      }
    }
    
    // Initialize Claude AI with stored API key only if context is valid
    if (isExtensionContextValid()) {
      const apiKey = await getApiKey();
      if (apiKey) {
        initClaudeAI(apiKey);
      }
    }
  } catch (error) {
    console.error('Error during extension initialization:', getErrorMessage(error));
  }
});

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(async () => {
  try {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalidated during startup');
      return;
    }

    // Reset badge on startup
    await chrome.action.setBadgeText({ text: '' });
    
    // Initialize Claude AI with stored API key only if context is valid
    const apiKey = await getApiKey();
    if (apiKey) {
      initClaudeAI(apiKey);
    }
  } catch (error) {
    console.error('Error during extension startup:', getErrorMessage(error));
  }
});

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.action) {
      case 'GET_EXTENSION_STATE':
        handleGetExtensionState(sendResponse);
        return true; // Indicate async response
        
      case 'UPDATE_USAGE_STATS':
        handleUpdateUsageStats(message.data);
        break;
        
      case 'TOGGLE_EXTENSION':
        handleToggleExtension(message.enabled, sendResponse);
        return true; // Indicate async response

      case 'EXTRACT_CONTEXT':
        handleExtractContext(sender, sendResponse);
        return true; // Indicate async response
        
      default:
        break;
    }
  } catch (error) {
    console.error('Error handling message:', getErrorMessage(error));
    sendResponse({ error: getErrorMessage(error) });
  }
});

/**
 * Get current extension state
 */
async function handleGetExtensionState(sendResponse: (response: any) => void): Promise<void> {
  try {
    const state = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
    const mergedState = { ...DEFAULT_STATE, ...state };
    sendResponse({ success: true, data: mergedState });
  } catch (error) {
    console.error('Error getting extension state:', getErrorMessage(error));
    sendResponse({ success: false, error: getErrorMessage(error) });
  }
}

/**
 * Update usage statistics
 */
async function handleUpdateUsageStats(data: { increment?: number }): Promise<void> {
  try {
    const { usageCount = 0 } = await chrome.storage.local.get(['usageCount']);
    const newCount = usageCount + (data.increment || 1);
    
    await chrome.storage.local.set({
      usageCount: newCount,
      lastUsed: Date.now()
    });
    
    // Update badge with usage count (optional)
    if (newCount > 0 && newCount < 100) {
      await chrome.action.setBadgeText({ text: newCount.toString() });
    }
  } catch (error) {
    console.error('Error updating usage stats:', getErrorMessage(error));
  }
}

/**
 * Toggle extension enabled state
 */
async function handleToggleExtension(enabled: boolean, sendResponse: (response: any) => void): Promise<void> {
  try {
    await chrome.storage.local.set({ isEnabled: enabled });
    
    // Update icon based on state
    const iconPath = enabled ? 'icons/icon.svg' : 'icons/icon-disabled.svg';
    await chrome.action.setIcon({ path: iconPath });
    
    sendResponse({ success: true, enabled });
  } catch (error) {
    console.error('Error toggling extension:', getErrorMessage(error));
    sendResponse({ success: false, error: getErrorMessage(error) });
  }
}

/**
 * Handle context extraction request from popup
 */
async function handleExtractContext(sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): Promise<void> {
  try {
    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab?.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    // Inject content script if not already present, then extract content
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_PAGE_CONTENT' });
      sendResponse({ success: true, data: response });
    } catch (messageError) {
      // Content script not loaded, inject it first
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content.js']
        });

        // Wait briefly for script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Try extracting again
        const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_PAGE_CONTENT' });
        sendResponse({ success: true, data: response });
      } catch (injectionError) {
        console.error('Failed to inject content script:', injectionError);
        sendResponse({ success: false, error: 'Failed to access page content' });
      }
    }
  } catch (error) {
    console.error('Error extracting context:', getErrorMessage(error));
    sendResponse({ success: false, error: getErrorMessage(error) });
  }
}

/**
 * Handle extension icon click when no popup is defined
 * Currently not used since we have a popup
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id) return;
    
    // This will only be called if no popup is defined
    await chrome.tabs.sendMessage(tab.id, { 
      action: 'TOGGLE_WIDGET',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error handling action click:', getErrorMessage(error));
  }
});

/**
 * Handle tab updates to potentially re-inject content scripts
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      // Check if this is a supported site
      const supportedHosts = [
        'chatgpt.com',
        'claude.ai', 
        'perplexity.ai',
        'www.perplexity.ai',
        'gemini.google.com',
        'chat.anthropic.com',
        'poe.com',
        'bard.google.com'
      ];
      
      const hostname = new URL(tab.url).hostname;
      const isSupported = supportedHosts.some(host => 
        hostname === host || hostname.endsWith('.' + host)
      );
      
      if (isSupported) {
        // Optional: Pre-inject content script for better performance
        // This is handled by manifest content_scripts but could be useful for dynamic injection
      }
    } catch (error) {
      // Ignore URL parsing errors for non-http(s) URLs
    }
  }
});

/**
 * Handle extension uninstall (cleanup)
 */
chrome.runtime.setUninstallURL('https://forms.gle/feedback', () => {
  if (chrome.runtime.lastError) {
    console.error('Error setting uninstall URL:', chrome.runtime.lastError);
  }
});

// Optional: Add context menu items in the future
// chrome.contextMenus.create({
//   id: "promptlayer-enhance",
//   title: "Enhance with PromptLayer",
//   contexts: ["selection"]
// }); 