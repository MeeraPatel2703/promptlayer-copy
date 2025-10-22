import React, { useState, useCallback, useEffect } from 'react';
import { getApiKey, setApiKey, saveContext, getContexts, ContextItem, removeContext, clearAllContexts, getRealtimeSettings, setRealtimeSettings, RealtimeSettings } from '../services/storage';
import { initClaudeAI } from '../services/claude';
import Logo from '../content/Logo';
import ThemeToggle from '../components/ThemeToggle';
import './styles.css';

// Removed unused TabInfo interface

interface ChromeApiError {
  message: string;
  stack?: string;
}

interface UsageStats {
  widgetSpawns: number;
  contextsExtracted: number;
  lastUsed: number;
  realtimeSuggestions: number;
}

type SetupStep = 'apiKey' | 'complete';
type ActiveTab = 'dashboard' | 'contexts' | 'settings';

const Popup: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKeyState] = useState<string>('');
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [isExtractingContext, setIsExtractingContext] = useState<boolean>(false);
  const [extractedContexts, setExtractedContexts] = useState<ContextItem[]>([]);
  const [expandedContextId, setExpandedContextId] = useState<string | null>(null);
  const [realtimeSettings, setRealtimeSettingsState] = useState<RealtimeSettings>({
    enabled: false,
    frequencyType: 'time',
    characterThreshold: 100,
    wordThreshold: 20,
    timeDelay: 1000
  });
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);
  const [usageStats, setUsageStats] = useState<UsageStats>({
    widgetSpawns: 0,
    contextsExtracted: 0,
    lastUsed: 0,
    realtimeSuggestions: 0
  });
  const [, setCurrentSetupStep] = useState<SetupStep>('apiKey');
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isApiKeyValid, setIsApiKeyValid] = useState<boolean>(false);

  // Load saved settings and stats on initial render
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Check if extension context is valid
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          console.warn('Extension context invalidated, cannot load settings');
          return;
        }

        const [savedApiKey, savedRealtimeSettings, contexts, storageStats] = await Promise.all([
          getApiKey(),
          getRealtimeSettings(),
          getContexts(),
          chrome.storage.local.get(['usage', 'lastUsed', 'realtimeSuggestionCount'])
        ]);
        
        setApiKeyState(savedApiKey);
        setRealtimeSettingsState(savedRealtimeSettings);
        setExtractedContexts(contexts);
        
        // Set usage stats
        setUsageStats({
          widgetSpawns: storageStats.usage || 0,
          contextsExtracted: contexts.length,
          lastUsed: storageStats.lastUsed || 0,
          realtimeSuggestions: storageStats.realtimeSuggestionCount || 0
        });

        // Determine setup state
        const hasValidApiKey = savedApiKey && savedApiKey.length > 0;
        setIsApiKeyValid(Boolean(hasValidApiKey));
        setCurrentSetupStep(hasValidApiKey ? 'complete' : 'apiKey');
        
        // Initialize Claude AI with the saved API key if available and context is valid
        if (hasValidApiKey) {
          initClaudeAI(savedApiKey);
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };
    
    loadSettings();
  }, []);

  // Auto-detect current platform for quick stats
  const [currentPlatform, setCurrentPlatform] = useState<string>('');
  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (activeTab?.url) {
          if (activeTab.url.includes('chatgpt.com')) setCurrentPlatform('ChatGPT');
          else if (activeTab.url.includes('claude.ai')) setCurrentPlatform('Claude');
          else if (activeTab.url.includes('gemini.google.com')) setCurrentPlatform('Gemini');
          else if (activeTab.url.includes('perplexity.ai')) setCurrentPlatform('Perplexity');
          else if (activeTab.url.includes('poe.com')) setCurrentPlatform('Poe');
          else setCurrentPlatform('');
        }
      } catch (error) {
        // Ignore detection errors
      }
    };
    detectPlatform();
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyState(e.target.value);
  };

  const handleSave = async () => {
    try {
      // Check if extension context is valid
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        setError('Extension context invalidated. Please reload the extension.');
        return;
      }

      await setApiKey(apiKey);
      
      // Initialize Claude AI with the new API key
      initClaudeAI(apiKey);
      
      // Update setup state
      const hasValidApiKey = apiKey && apiKey.length > 0;
      setIsApiKeyValid(Boolean(hasValidApiKey));
      setCurrentSetupStep(hasValidApiKey ? 'complete' : 'apiKey');
      
      // Show saved message
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);

      // Switch to dashboard if setup is complete
      if (hasValidApiKey && activeTab !== 'dashboard') {
        setActiveTab('dashboard');
      }
    } catch (error) {
      console.error('Error saving API key:', error);
      setError('Failed to save API key. Please try again.');
    }
  };

  const handleSpawnWidget = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // Query for the active tab with proper error handling
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        throw new Error('No active tab found');
      }

      if (!activeTab.url) {
        throw new Error('Unable to access tab URL');
      }

      // Check if the tab URL is accessible (not chrome:// or other restricted URLs)
      if (activeTab.url.startsWith('chrome://') || 
          activeTab.url.startsWith('chrome-extension://') ||
          activeTab.url.startsWith('edge://') ||
          activeTab.url.startsWith('about:')) {
        throw new Error('Cannot inject into this type of page');
      }

      try {
        // First attempt to send message to existing content script
        await chrome.tabs.sendMessage(activeTab.id, { 
          action: 'SPAWN_WIDGET',
          timestamp: Date.now()
        });
      } catch (messageError) {
        // If content script isn't loaded, inject it first
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          });

          // Wait briefly for script to initialize
          await new Promise(resolve => setTimeout(resolve, 100));

          // Try sending message again after script injection
          await chrome.tabs.sendMessage(activeTab.id, { 
            action: 'SPAWN_WIDGET',
            timestamp: Date.now()
          });
        } catch (injectionError) {
          console.error('Script injection failed:', injectionError);
          throw new Error('Failed to inject content script. Please refresh the page and try again.');
        }
      }

      // Update usage statistics
      try {
        const { usage = 0 } = await chrome.storage.local.get(['usage']);
        const newUsage = usage + 1;
        await chrome.storage.local.set({ 
          usage: newUsage,
          lastUsed: Date.now()
        });
        
        // Update local state
        setUsageStats(prev => ({
          ...prev,
          widgetSpawns: newUsage,
          lastUsed: Date.now()
        }));
      } catch (storageError) {
        // Don't fail the main operation if storage fails
        console.warn('Failed to update usage statistics:', storageError);
      }

    } catch (err) {
      const error = err as ChromeApiError;
      console.error('Error spawning widget:', error);
      
      let errorMessage = 'Failed to show widget. ';
      
      if (error.message.includes('Cannot access')) {
        errorMessage += 'This page cannot be accessed by extensions.';
      } else if (error.message.includes('inject into this type')) {
        errorMessage += 'Extensions cannot run on this type of page.';
      } else if (error.message.includes('refresh the page')) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Please try again or refresh the page.';
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const handleExtractContext = useCallback(async (): Promise<void> => {
    setIsExtractingContext(true);
    setError(null);

    try {
      const response = await chrome.runtime.sendMessage({ action: 'EXTRACT_CONTEXT' });
      
      if (response.success) {
        const extractedContent = response.data.data;
        
        // Save the context
        await saveContext({
          url: extractedContent.url,
          title: extractedContent.title,
          content: extractedContent.content,
          timestamp: Date.now()
        });

        // Reload contexts to show the new one
        const updatedContexts = await getContexts();
        setExtractedContexts(updatedContexts);
        
        // Update stats
        setUsageStats(prev => ({
          ...prev,
          contextsExtracted: updatedContexts.length
        }));
      } else {
        throw new Error(response.error || 'Failed to extract context');
      }
    } catch (error) {
      console.error('Error extracting context:', error);
      setError('Failed to extract context from this page. Please try again.');
    } finally {
      setIsExtractingContext(false);
    }
  }, []);

  const handleDeleteContext = useCallback(async (contextId: string): Promise<void> => {
    try {
      await removeContext(contextId);
      const updatedContexts = await getContexts();
      setExtractedContexts(updatedContexts);
      
      // Update stats
      setUsageStats(prev => ({
        ...prev,
        contextsExtracted: updatedContexts.length
      }));
      
      // Close expanded view if the deleted item was expanded
      if (expandedContextId === contextId) {
        setExpandedContextId(null);
      }
    } catch (error) {
      console.error('Error deleting context:', error);
      setError('Failed to delete context. Please try again.');
    }
  }, [expandedContextId]);

  const handleClearAllContexts = useCallback(async (): Promise<void> => {
    try {
      await clearAllContexts();
      setExtractedContexts([]);
      setExpandedContextId(null);
      
      // Update stats
      setUsageStats(prev => ({
        ...prev,
        contextsExtracted: 0
      }));
    } catch (error) {
      console.error('Error clearing all contexts:', error);
      setError('Failed to clear contexts. Please try again.');
    }
  }, []);

  const toggleExpandContext = useCallback((contextId: string): void => {
    setExpandedContextId(expandedContextId === contextId ? null : contextId);
  }, [expandedContextId]);

  const handleRealtimeSettingChange = useCallback(async (
    key: keyof RealtimeSettings,
    value: any
  ): Promise<void> => {
    const newSettings = {
      ...realtimeSettings,
      [key]: value
    };
    
    setRealtimeSettingsState(newSettings);
    
    // Auto-save with visual feedback
    try {
      setIsAutoSaving(true);
      
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        setError('Extension context invalidated. Please reload the extension.');
        return;
      }

      await setRealtimeSettings(newSettings);
      
      // Brief visual feedback
      setTimeout(() => setIsAutoSaving(false), 800);
    } catch (error) {
      console.error('Error auto-saving realtime settings:', error);
      setError('Failed to save settings. Please try again.');
      setIsAutoSaving(false);
    }
  }, [realtimeSettings]);

  const formatTimeAgo = (timestamp: number): string => {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const renderDashboard = () => (
    <div className="dashboard-redesigned">
      {/* Status Card - Primary */}
      <div className="status-card-primary">
        <div className="status-icon-container">
          <div className={`status-check-icon ${isApiKeyValid ? 'ready' : 'setup-needed'}`}>
            {isApiKeyValid ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M16.5 6.5L7.5 15.5L3.5 11.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 6V10M10 14H10.01M19 10C19 14.9706 14.9706 19 10 19C5.02944 19 1 14.9706 1 10C1 5.02944 5.02944 1 10 1C14.9706 1 19 5.02944 19 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>
        <div className="status-content">
          <div className="status-title-redesigned">
            {isApiKeyValid ? 'Ready to Use' : 'Setup Required'}
          </div>
          <div className="status-subtitle-redesigned">
            {isApiKeyValid 
              ? 'All features active' 
              : 'Claude API key required'
            }
          </div>
        </div>
      </div>

      {/* Primary Actions - Side by Side */}
      <div className="actions-row">
        <button 
          className="action-primary-redesigned"
          onClick={handleSpawnWidget}
          disabled={isLoading || !isApiKeyValid}
          type="button"
          role="button"
          tabIndex={0}
        >
          <div className="action-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span>{isLoading ? 'Loading...' : 'Show Widget'}</span>
        </button>

        <button 
          className="action-secondary-redesigned"
          onClick={handleExtractContext}
          disabled={isExtractingContext || !isApiKeyValid}
          type="button"
          role="button"
          tabIndex={0}
        >
          <div className="action-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 7H20M4 12H20M4 17H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span>{isExtractingContext ? 'Extracting...' : 'Add Context'}</span>
        </button>
      </div>

      {/* Current Platform Banner */}
      {currentPlatform && (
        <div className="platform-banner">
          <div className="platform-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M2 12H6M18 12H22M12 2V6M12 18V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="platform-info">
            <span className="platform-label">Active on</span>
            <span className="platform-name">{currentPlatform}</span>
          </div>
          <div className={`realtime-badge ${realtimeSettings.enabled ? 'active' : 'inactive'}`}>
            {realtimeSettings.enabled ? 'Live' : 'Off'}
          </div>
        </div>
      )}

      {/* Stats Grid - 2x2 */}
      <div className="stats-grid-redesigned">
        <div className="stat-item">
          <div className="stat-number-redesigned">{usageStats.widgetSpawns}</div>
          <div className="stat-label-redesigned">Widget Uses</div>
        </div>
        <div className="stat-item">
          <div className="stat-number-redesigned">{usageStats.contextsExtracted}</div>
          <div className="stat-label-redesigned">Contexts</div>
        </div>
        <div className="stat-item">
          <div className="stat-number-redesigned">{usageStats.realtimeSuggestions}</div>
          <div className="stat-label-redesigned">Suggestions</div>
        </div>
        <div className="stat-item">
          <div className="stat-number-redesigned">{formatTimeAgo(usageStats.lastUsed)}</div>
          <div className="stat-label-redesigned">Last Used</div>
        </div>
      </div>

      {/* Real-time Toggle - Bottom */}
      <div className="realtime-section">
        <div className="realtime-info">
          <div className="realtime-title">Real-time Suggestions</div>
          <div className="realtime-subtitle">
            {realtimeSettings.enabled 
              ? `Active · ${realtimeSettings.frequencyType} mode`
              : 'Get AI suggestions while typing'
            }
          </div>
        </div>
        <div className={`realtime-toggle-switch ${realtimeSettings.enabled ? 'enabled' : 'disabled'}`}
             onClick={() => handleRealtimeSettingChange('enabled', !realtimeSettings.enabled)}
             role="button"
             tabIndex={0}
             onKeyDown={(e) => {
               if (e.key === 'Enter' || e.key === ' ') {
                 e.preventDefault();
                 handleRealtimeSettingChange('enabled', !realtimeSettings.enabled);
               }
             }}
        >
          <div className="toggle-indicator"></div>
        </div>
      </div>
    </div>
  );

  const renderContexts = () => (
    <div className="contexts-tab">
      {extractedContexts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <div className="empty-title">No Contexts Yet</div>
          <div className="empty-subtitle">
            Extract page content to use as context in your prompts
          </div>
          <button 
            className="empty-action"
            onClick={handleExtractContext}
            disabled={isExtractingContext || !isApiKeyValid}
          >
            {isExtractingContext ? 'Extracting...' : 'Extract from Current Page'}
          </button>
        </div>
      ) : (
        <div className="context-management">
          <div className="context-header">
            <div className="context-count">{extractedContexts.length} contexts saved</div>
            <button 
              className="clear-all-button"
              onClick={handleClearAllContexts}
              title="Clear all contexts"
            >
              Clear All
            </button>
          </div>
          <div className="context-list">
            {extractedContexts.map((context) => {
              const isExpanded = expandedContextId === context.id;
              const displayContent = isExpanded 
                ? context.content 
                : context.content.slice(0, 150) + (context.content.length > 150 ? '...' : '');

              return (
                <div key={context.id} className="context-item">
                  <div className="context-item-header">
                    <div className="context-title-section">
                      <div className="context-title">{context.title}</div>
                      <div className="context-url">{new URL(context.url).hostname}</div>
                    </div>
                    <button 
                      className="delete-context-button"
                      onClick={() => handleDeleteContext(context.id)}
                      title="Delete this context"
                      aria-label={`Delete context: ${context.title}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="context-content">
                    <div className="context-text">{displayContent}</div>
                    {context.content.length > 150 && (
                      <button 
                        className="expand-button"
                        onClick={() => toggleExpandContext(context.id)}
                      >
                        {isExpanded ? 'Show Less' : 'Show More'}
                      </button>
                    )}
                  </div>
                  <div className="context-meta">
                    <span className="context-word-count">
                      {context.content.split(/\s+/).length} words
                    </span>
                    <span className="context-timestamp">
                      {new Date(context.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderSettings = () => (
    <div className="settings-tab">
      {/* API Key Setup */}
      <div className="settings-section">
        <h3>Claude AI Setup</h3>
        <div className="form-group">
          <label htmlFor="api-key">API Key</label>
          <div className="input-with-status">
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={handleApiKeyChange}
              placeholder="sk-ant-..."
            />
            <div className={`key-status ${isApiKeyValid ? 'valid' : 'invalid'}`}>
              {isApiKeyValid ? '✓' : '○'}
            </div>
          </div>
          <div className="help-text">
            Get your API key from <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>
          </div>
        </div>
        
        <button 
          className="save-button" 
          onClick={handleSave}
          disabled={!apiKey || apiKey === ''}
        >
          {isSaved ? 'Saved!' : 'Save API Key'}
        </button>
      </div>

      {/* Real-Time Suggestions */}
      {isApiKeyValid && (
        <div className="settings-section">
          <h3>Real-Time Suggestions</h3>
          
          <div className="form-group">
            <label className="toggle-label">
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={realtimeSettings.enabled}
                  onChange={(e) => handleRealtimeSettingChange('enabled', e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </div>
              Enable prompt suggestions as you type
            </label>
            <div className="help-text">Get AI-powered suggestions to improve your prompts on supported platforms.</div>
          </div>

          {realtimeSettings.enabled && (
            <>
              <div className="form-group">
                <label htmlFor="frequency-type">Trigger Mode</label>
                <select
                  id="frequency-type"
                  value={realtimeSettings.frequencyType}
                  onChange={(e) => handleRealtimeSettingChange('frequencyType', e.target.value)}
                >
                  <option value="time">Time Delay</option>
                  <option value="characters">Character Count</option>
                  <option value="words">Word Count</option>
                  <option value="smart">Smart Pause</option>
                </select>
              </div>

              {realtimeSettings.frequencyType === 'characters' && (
                <div className="form-group">
                  <label htmlFor="character-threshold">Character Threshold</label>
                  <select
                    id="character-threshold"
                    value={realtimeSettings.characterThreshold}
                    onChange={(e) => handleRealtimeSettingChange('characterThreshold', parseInt(e.target.value))}
                  >
                    <option value={50}>Every 50 characters</option>
                    <option value={100}>Every 100 characters</option>
                    <option value={200}>Every 200 characters</option>
                  </select>
                </div>
              )}

              {realtimeSettings.frequencyType === 'words' && (
                <div className="form-group">
                  <label htmlFor="word-threshold">Word Threshold</label>
                  <select
                    id="word-threshold"
                    value={realtimeSettings.wordThreshold}
                    onChange={(e) => handleRealtimeSettingChange('wordThreshold', parseInt(e.target.value))}
                  >
                    <option value={10}>Every 10 words</option>
                    <option value={20}>Every 20 words</option>
                    <option value={50}>Every 50 words</option>
                  </select>
                </div>
              )}

              {realtimeSettings.frequencyType === 'time' && (
                <div className="form-group">
                  <label htmlFor="time-delay">Time Delay</label>
                  <select
                    id="time-delay"
                    value={realtimeSettings.timeDelay}
                    onChange={(e) => handleRealtimeSettingChange('timeDelay', parseInt(e.target.value))}
                  >
                    <option value={500}>500ms after pausing</option>
                    <option value={1000}>1 second after pausing</option>
                    <option value={2000}>2 seconds after pausing</option>
                  </select>
                </div>
              )}

              {realtimeSettings.frequencyType === 'smart' && (
                <div className="form-group">
                  <div className="help-text">AI detects natural typing pauses for optimal timing.</div>
                </div>
              )}

              {isAutoSaving && (
                <div className="auto-save-indicator">
                  <span>Saving...</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Theme Settings */}
      <div className="settings-section">
        <h3>Theme</h3>
        <ThemeToggle />
      </div>

      {/* Supported Platforms */}
      <div className="settings-section">
        <h3>Supported Platforms</h3>
        <div className="platform-list">
          <div className="platform-item">ChatGPT</div>
          <div className="platform-item">Claude</div>
          <div className="platform-item">Gemini</div>
          <div className="platform-item">Perplexity</div>
          <div className="platform-item">Poe</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="header">
        <div className="header-content">
          <div className="header-logo">
            <Logo size={56} animated={true} />
          </div>
          <div className="version">v2.0</div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-container" role="alert">
          <div className="error-message">{error}</div>
          <button 
            className="error-dismiss"
            onClick={clearError}
            type="button"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Setup Flow for New Users */}
      {!isApiKeyValid && (
        <div className="setup-flow">
          <div className="setup-header">
            <div className="setup-icon">🚀</div>
            <div className="setup-title">Welcome</div>
            <div className="setup-subtitle">Let's get you set up in under a minute</div>
          </div>
          
          <div className="setup-steps">
            <div className="setup-step active">
              <div className="step-number">1</div>
              <div className="step-content">
                <div className="step-title">Add Your Claude API Key</div>
                <div className="form-group">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    placeholder="sk-ant-..."
                    className="setup-input"
                  />
                  <div className="help-text">
                    Get your free API key from <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a>
                  </div>
                </div>
                <button 
                  className="setup-button" 
                  onClick={handleSave}
                  disabled={!apiKey || apiKey === ''}
                >
                  {isSaved ? 'Saved! ✓' : 'Save & Continue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Interface for Set Up Users */}
      {isApiKeyValid && (
        <>
          {/* Tab Navigation - Redesigned Segmented Control */}
          <div className="tab-nav-redesigned">
            <div className="tab-container">
              <div className="tab-background"></div>
              <button 
                className={`tab-button-redesigned ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
                role="tab"
                tabIndex={0}
              >
                <span>Dashboard</span>
              </button>
              <button 
                className={`tab-button-redesigned ${activeTab === 'contexts' ? 'active' : ''}`}
                onClick={() => setActiveTab('contexts')}
                role="tab"
                tabIndex={0}
              >
                <span>Contexts</span>
              </button>
              <button 
                className={`tab-button-redesigned ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
                role="tab"
                tabIndex={0}
              >
                <span>Settings</span>
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'contexts' && renderContexts()}
            {activeTab === 'settings' && renderSettings()}
          </div>
        </>
      )}
    </div>
  );
};

export default Popup; 