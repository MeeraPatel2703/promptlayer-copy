# PromptLayer Real-Time Suggestions - Technical Guide

## Overview

The Real-Time Suggestions feature is a sophisticated AI-powered system that analyzes user prompts as they type on LLM platforms and provides intelligent improvement suggestions via Claude 3.5 Haiku. This document provides comprehensive technical details for developers working on this feature.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   User Types    │───▶│  Platform       │───▶│  Real-time      │
│   on LLM Site   │    │  Detection      │    │  Monitor        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Suggestion     │◀───│  Event System   │◀───│  Claude API     │
│  Bubble UI      │    │  (CustomEvents) │    │  Analysis       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Core Components

### 1. Real-Time Monitor (`src/services/realtimeMonitor.ts`)

**Purpose**: Coordinates the entire real-time suggestion pipeline.

**Key Responsibilities**:
- Monitors text input on supported platforms
- Manages frequency-based triggering (character count, word count, time delay, smart pause)
- Handles Claude AI integration and error management
- Dispatches events for UI components
- Tracks performance metrics

**Main Functions**:
- `createRealtimeMonitor()`: Factory function returning monitor instance
- `initializeMonitoring()`: Sets up platform detection, settings validation, and input listeners
- `handleInputChange()`: Core logic for analyzing when to trigger suggestions
- `shouldTriggerAnalysis()`: Implements frequency-based triggering logic

**State Management**:
```typescript
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
```

### 2. Platform Detection (`src/services/platformDetection.ts`)

**Purpose**: Detects supported LLM platforms and provides platform-specific input element selectors.

**Supported Platforms**:
- **ChatGPT** (chatgpt.com): `textarea[placeholder*="Message"]`, `#prompt-textarea`
- **Claude** (claude.ai): `div[contenteditable="true"][data-testid="composer-input"]`
- **Gemini** (gemini.google.com): `textarea[placeholder*="Enter a prompt"]`
- **Perplexity** (perplexity.ai): `textarea[placeholder*="Ask anything"]`
- **Poe** (poe.com): Generic textarea selectors

**Key Functions**:
- `detectCurrentPlatform()`: Returns platform info or null
- `findMainInputElement()`: Locates the primary input field
- `addInputListener()`: Attaches debounced event listeners
- `shouldActivateRealtimeSuggestions()`: Validates platform compatibility

### 3. Claude AI Integration (`src/services/claude.ts`)

**Purpose**: Handles communication with Claude 3.5 Haiku for prompt analysis.

**Key Function**: `analyzePromptRealtime(prompt: string)`

**System Prompt Strategy**:
- Analyzes prompts for improvement opportunities
- Returns "NO_CHANGE" if prompt is already good
- Provides concise suggestions (max 7 words)
- Focuses on clarity, specificity, and effectiveness

**Error Handling**:
- 10-second timeout for API calls
- Graceful handling of rate limits
- API key validation
- Network error resilience

### 4. Suggestion Bubble UI (`src/content/SuggestionBubble.tsx`)

**Purpose**: Displays suggestions in a floating, accessible bubble near input fields.

**Features**:
- **Smart Positioning**: Above/below input with viewport collision detection
- **Mobile Responsive**: Adaptive sizing and positioning for mobile devices
- **Accessibility**: ARIA labels, keyboard navigation (ESC to dismiss)
- **Smooth Animations**: Cubic-bezier transitions with scale effects
- **Loading States**: Spinner animation during analysis
- **Auto-dismiss**: 8-second auto-hide timer

**Event System**:
- Listens for `promptSuggestion` events from realtimeMonitor
- Listens for `promptAnalysisStart/End` for loading states
- Handles keyboard and click-outside dismissal

## Frequency Triggering Modes

### 1. Character Count Mode
- Triggers every N characters (50, 100, or 200)
- Tracks character difference since last analysis
- Ideal for users who want frequent feedback

### 2. Word Count Mode  
- Triggers every N words (10, 20, or 50)
- More semantic than character counting
- Good balance between frequency and meaningfulness

### 3. Time Delay Mode
- Triggers after user stops typing for N milliseconds (500ms, 1s, 2s)
- Uses debouncing to detect typing pauses
- Most popular mode - feels natural

### 4. Smart Pause Detection
- AI-powered pause detection (1.5s default)
- Learns from user typing patterns
- Future enhancement: Could use ML to optimize timing

## Event System Architecture

The feature uses a custom event system for loose coupling between components:

```typescript
// Real-time monitor dispatches these events:
window.dispatchEvent(new CustomEvent('promptAnalysisStart'));
window.dispatchEvent(new CustomEvent('promptAnalysisEnd'));
window.dispatchEvent(new CustomEvent('promptSuggestion', {
  detail: {
    suggestion: string,
    originalText: string,
    platform: string
  }
}));

// Suggestion bubble listens for these events
window.addEventListener('promptSuggestion', handleSuggestion);
window.addEventListener('promptAnalysisStart', handleAnalysisStart);
window.addEventListener('promptAnalysisEnd', handleAnalysisEnd);
```

## Performance Optimizations

### 1. Debouncing and Throttling
- Input changes are debounced based on user settings
- Prevents excessive API calls during rapid typing
- Smart caching of recent analyses

### 2. Edge Case Handling
- Skips empty or very short text (< 10 characters)
- Limits very long text (> 5000 characters)
- Validates text contains actual letters (not just numbers/symbols)
- Prevents re-analysis of identical text

### 3. Error Resilience
- 10-second timeout on API calls
- Graceful degradation when extension context is invalidated
- Storage access validation
- Network error handling with user-friendly messages

### 4. Memory Management
- Proper cleanup of event listeners and timeouts
- State reset on navigation
- Garbage collection friendly patterns

## Settings and Storage

### Settings Schema
```typescript
interface RealtimeSettings {
  enabled: boolean;
  frequencyType: 'characters' | 'words' | 'time' | 'smart';
  characterThreshold: 50 | 100 | 200;
  wordThreshold: 10 | 20 | 50;
  timeDelay: 500 | 1000 | 2000;
}
```

### Storage Strategy
- Settings stored in `chrome.storage.sync` for cross-device sync
- Usage statistics in `chrome.storage.local` for performance
- Extension context validation before storage access
- Graceful fallbacks when storage is unavailable

## Error Handling Patterns

### 1. Extension Context Invalidation
- Common during development when reloading extension
- Storage functions return graceful defaults
- Monitor retries initialization periodically

### 2. API Errors
- Timeout handling (10s max)
- Rate limiting detection
- API key validation
- Network connectivity issues

### 3. Platform Changes
- SPA navigation detection
- DOM mutation observation
- Input element validation
- Automatic re-initialization

## Integration Points

### 1. Content Script Integration
- Initialized in `src/content/index.tsx`
- Automatic startup on supported platforms
- Handles page navigation and DOM changes

### 2. Popup Settings Integration
- Real-time settings UI in popup
- Auto-save functionality
- Settings validation and sync

### 3. Storage Service Integration
- Centralized settings management
- Usage statistics tracking
- Cross-component state sharing

## Testing and Debugging

### 1. Debug Mode
- Console logging for development
- Performance metrics tracking
- Error boundary patterns

### 2. Edge Case Testing
- Empty text handling
- Very long prompts
- Network failures
- Extension reload scenarios

### 3. Cross-Platform Testing
- Different input types (textarea, contentEditable)
- Mobile responsiveness
- Keyboard accessibility
- Screen reader compatibility

## Future Enhancement Opportunities

### 1. Machine Learning Improvements
- Learn from user acceptance/dismissal patterns
- Optimize timing based on individual typing patterns
- Personalized suggestion relevance scoring

### 2. Advanced Analytics
- A/B testing framework for suggestion quality
- User engagement metrics
- Performance optimization insights

### 3. Extended Platform Support
- Additional LLM platforms
- Custom platform detection rules
- User-configurable selectors

### 4. Enhanced UI Features
- Suggestion history
- Multiple suggestion options
- Inline editing capabilities
- Contextual suggestion categories

## Security and Privacy

### 1. Data Handling
- API key stored locally only
- Prompt text sent only to Claude API
- No data collection or telemetry
- Extension context validation

### 2. Permission Model
- Minimal required permissions
- Host-specific content script injection
- Secure API communication

### 3. User Control
- Complete disable option
- Per-platform settings
- Clear data management

This architecture provides a robust, scalable foundation for real-time prompt analysis while maintaining excellent user experience and performance characteristics. 