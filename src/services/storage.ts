// Storage keys
const STORAGE_KEYS = {
  API_KEY: 'promptlayer_claude_api_key',
  REALTIME_SETTINGS: 'promptlayer_realtime_settings'
};

// Real-time suggestions settings interface
export interface RealtimeSettings {
  enabled: boolean;
  frequencyType: 'characters' | 'words' | 'time' | 'smart';
  characterThreshold: 50 | 100 | 200;
  wordThreshold: 10 | 20 | 50;
  timeDelay: 500 | 1000 | 2000;
}

// Default settings
const DEFAULT_REALTIME_SETTINGS: RealtimeSettings = {
  enabled: false,
  frequencyType: 'time',
  characterThreshold: 100,
  wordThreshold: 20,
  timeDelay: 1000
};

/**
 * Check if the extension context is valid
 */
const isExtensionContextValid = (): boolean => {
  return !!(chrome && chrome.runtime && chrome.runtime.id);
};

/**
 * Get the stored Claude AI API key
 */
export const getApiKey = async (): Promise<string> => {
  try {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalidated, cannot access storage');
      return '';
    }

    const result = await chrome.storage.sync.get(STORAGE_KEYS.API_KEY);
    return result[STORAGE_KEYS.API_KEY] || '';
  } catch (error) {
    console.error('Error getting API key from storage:', error);
    return '';
  }
};

/**
 * Store the API key
 */
export const setApiKey = async (apiKey: string): Promise<void> => {
  try {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalidated, cannot access storage');
      return;
    }

    await chrome.storage.sync.set({ [STORAGE_KEYS.API_KEY]: apiKey });
  } catch (error) {
    console.error('Error saving API key to storage:', error);
  }
};

// Context extraction types and storage
export interface ContextItem {
  id: string;
  url: string;
  title: string;
  content: string;
  timestamp: number;
}

// Context storage functions
export const saveContext = async (context: Omit<ContextItem, 'id'>): Promise<string> => {
  const id = `context_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const contextItem: ContextItem = {
    ...context,
    id
  };
  
  const { contexts = [] } = await chrome.storage.local.get(['contexts']);
  const updatedContexts = [...contexts, contextItem];
  
  // Keep only the latest 5 contexts to prevent storage bloat
  const limitedContexts = updatedContexts.slice(-5);
  
  await chrome.storage.local.set({ contexts: limitedContexts });
  return id;
};

export const getContexts = async (): Promise<ContextItem[]> => {
  const { contexts = [] } = await chrome.storage.local.get(['contexts']);
  return contexts;
};

export const removeContext = async (id: string): Promise<void> => {
  const { contexts = [] } = await chrome.storage.local.get(['contexts']);
  const filteredContexts = contexts.filter((context: ContextItem) => context.id !== id);
  await chrome.storage.local.set({ contexts: filteredContexts });
};

export const clearAllContexts = async (): Promise<void> => {
  await chrome.storage.local.set({ contexts: [] });
};

/**
 * Get real-time suggestions settings
 */
export const getRealtimeSettings = async (): Promise<RealtimeSettings> => {
  try {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalidated, cannot access storage');
      return DEFAULT_REALTIME_SETTINGS;
    }

    const result = await chrome.storage.sync.get(STORAGE_KEYS.REALTIME_SETTINGS);
    return result[STORAGE_KEYS.REALTIME_SETTINGS] || DEFAULT_REALTIME_SETTINGS;
  } catch (error) {
    console.error('Error getting realtime settings from storage:', error);
    return DEFAULT_REALTIME_SETTINGS;
  }
};

/**
 * Store real-time suggestions settings
 */
export const setRealtimeSettings = async (settings: RealtimeSettings): Promise<void> => {
  try {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalidated, cannot access storage');
      return;
    }

    await chrome.storage.sync.set({ [STORAGE_KEYS.REALTIME_SETTINGS]: settings });
  } catch (error) {
    console.error('Error saving realtime settings to storage:', error);
  }
}; 