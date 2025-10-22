import React, { useState, useRef, useCallback, useMemo, CSSProperties, useEffect } from 'react';
import { sendToClaudeAI, initClaudeAI } from '../services/claude';
import { getApiKey, getContexts, removeContext, ContextItem } from '../services/storage';
import InlineDropdownEditor from './InlineDropdownEditor';
import Logo from './Logo';

interface WidgetProps {
  isChatGPT: boolean;
  selectedText: string;
  onClose: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onReplaceText: (newText: string) => void;
  onUpdateTargetSelection?: () => boolean;
}

interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

// Constants for better maintainability
const WIDGET_CONSTANTS = {
  WIDTH: 400,
  HEIGHT: 320,
  MIN_WIDTH: 300,
  MIN_HEIGHT: 250,
  MAX_WIDTH: 800,
  MAX_HEIGHT: 600,
  INITIAL_OFFSET: 20,
  CHATGPT_Y_OFFSET: 80,
  Z_INDEX: 2147483647,
} as const;

const ANIMATION_CONSTANTS = {
  FADE_DURATION: 225,
  SHIMMER_DURATION: 2000,
  PROCESSING_DURATION: 1500,
  PROCESSING_DELAY: 300,
} as const;

const FONT_FAMILY = '"SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// Grayscale Design System Colors
const GRAYSCALE_COLORS = {
  WHITE: '#FFFFFF',
  GRAY_LIGHT: 'rgba(255, 255, 255, 0.6)',
  GRAY_MEDIUM: 'rgba(255, 255, 255, 0.4)',
  BACKGROUND_GLASS: 'rgba(28, 28, 30, 0.65)',
  BACKGROUND_OVERLAY: 'rgba(0, 0, 0, 0.3)',
  BORDER: 'rgba(255, 255, 255, 0.1)',
  NEUTRAL: '#a3a3a3',
  SUCCESS: '#d4d4d4',
  ERROR: '#a3a3a3'
} as const;

// CSS animations as constants for better maintainability
const CSS_ANIMATIONS = `
  @keyframes shimmer {
    0% { 
      background-position: 200% 0;
    }
    100% { 
      background-position: -200% 0;
    }
  }
  @keyframes processingPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .processing-dot-1 { animation: processingPulse ${ANIMATION_CONSTANTS.PROCESSING_DURATION}ms ease-in-out 0s infinite; }
  .processing-dot-2 { animation: processingPulse ${ANIMATION_CONSTANTS.PROCESSING_DURATION}ms ease-in-out ${ANIMATION_CONSTANTS.PROCESSING_DELAY}ms infinite; }
  .processing-dot-3 { animation: processingPulse ${ANIMATION_CONSTANTS.PROCESSING_DURATION}ms ease-in-out ${ANIMATION_CONSTANTS.PROCESSING_DELAY * 2}ms infinite; }
`;


const Widget: React.FC<WidgetProps> = ({ 
  isChatGPT, 
  selectedText, 
  onClose, 
  onDragStart, 
  onDragEnd,
  onReplaceText,
  onUpdateTargetSelection,
}) => {
  const [position, setPosition] = useState<Position>({ 
    x: WIDGET_CONSTANTS.INITIAL_OFFSET, 
    y: isChatGPT ? WIDGET_CONSTANTS.CHATGPT_Y_OFFSET : WIDGET_CONSTANTS.INITIAL_OFFSET 
  });
  const [size, setSize] = useState<Size>({
    width: WIDGET_CONSTANTS.WIDTH,
    height: WIDGET_CONSTANTS.HEIGHT
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isCloseHovered, setIsCloseHovered] = useState<boolean>(false);
  const [isReplaceHovered, setIsReplaceHovered] = useState<boolean>(false);
  const [isSendHovered, setIsSendHovered] = useState<boolean>(false);
  const [isImportHovered, setIsImportHovered] = useState<boolean>(false);
  const [editableText, setEditableText] = useState<string>(selectedText);
  const [isUserEdited, setIsUserEdited] = useState<boolean>(false);
  const [userHasClearedText, setUserHasClearedText] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasBeenImproved, setHasBeenImproved] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isFadingOut, setIsFadingOut] = useState<boolean>(false);
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const widgetRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ getFlatText: () => string }>(null);
  
  // Store the original selection to restore it if needed
  const originalSelectionRef = useRef<{
    range?: Range;
    selection?: Selection;
  }>({});

  // Load saved size from storage
  useEffect(() => {
    const loadSavedSize = async () => {
      try {
        // Check if extension context is still valid before accessing storage
        if (!chrome?.runtime?.id) {
          return; // Silently fail if extension context is invalidated
        }
        
        if (chrome?.storage?.local) {
          const result = await chrome.storage.local.get(['widgetSize']);
          if (result.widgetSize) {
            setSize(result.widgetSize);
          }
        }
      } catch (error) {
        // Only log warning if it's not an extension context error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('Extension context invalidated')) {
          console.warn('Could not load saved widget size:', error);
        }
      }
    };
    loadSavedSize();
  }, []);

  // Save size to storage when it changes
  useEffect(() => {
    const saveSize = async () => {
      try {
        // Check if extension context is still valid before accessing storage
        if (!chrome?.runtime?.id) {
          return; // Silently fail if extension context is invalidated
        }
        
        if (chrome?.storage?.local) {
          await chrome.storage.local.set({ widgetSize: size });
        }
      } catch (error) {
        // Only log warning if it's not an extension context error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('Extension context invalidated')) {
          console.warn('Could not save widget size:', error);
        }
      }
    };
    saveSize();
  }, [size]);

  // Set initial editable text when widget first opens
  useEffect(() => {
    setEditableText(selectedText);
    setIsUserEdited(false);
    setHasBeenImproved(false);
    
    // Store the current selection when the widget appears
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0).cloneRange();
      originalSelectionRef.current = {
        range,
        selection
      };
    }
  }, []); // Only run once when widget mounts

  // Handle new selections updating widget content (only if user hasn't edited or widget is empty)
  useEffect(() => {
    // FIXED: Add guard to prevent infinite loop during import
    // Don't update if the selectedText is empty (which happens during import process)
    // Don't update if user has explicitly cleared the text
    // CRITICAL FIX: Don't update if we're in loading state (AI improvement in progress)
    // CRITICAL FIX: Don't update if text has been improved by AI (to prevent overwriting AI response)
    if (selectedText && selectedText.trim() !== '' && !userHasClearedText && !isLoading && !hasBeenImproved && (!isUserEdited || editableText.trim() === '')) {
      setEditableText(selectedText);
      // If we updated because widget was empty, reset isUserEdited for future selections
      if (editableText.trim() === '') {
        setIsUserEdited(false);
      }
    }
  }, [selectedText, isUserEdited, editableText, userHasClearedText, isLoading, hasBeenImproved]); // Added isLoading and hasBeenImproved to dependencies

  // Initialize Claude AI client when widget loads
  useEffect(() => {
    const initializeClaudeAI = async () => {
      try {
        // Check if extension context is still valid
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
          console.warn('Extension context invalidated, cannot initialize Claude AI');
          return;
        }

        const apiKey = await getApiKey();
        if (apiKey) {
          initClaudeAI(apiKey);
        }
      } catch (error) {
        console.error('Error initializing Claude AI in widget:', error);
      }
    };
    
    initializeClaudeAI();
  }, []);

  // Load stored contexts when widget opens
  useEffect(() => {
    const loadContexts = async () => {
      try {
        if (!chrome?.runtime?.id) {
          return; // Silently fail if extension context is invalidated
        }
        
        const storedContexts = await getContexts();
        setContexts(storedContexts);
      } catch (error) {
        console.warn('Could not load stored contexts:', error);
      }
    };
    
    loadContexts();
  }, []);
  
  // Handle context removal
  const handleRemoveContext = useCallback(async (contextId: string) => {
    try {
      await removeContext(contextId);
      setContexts(prev => prev.filter(context => context.id !== contextId));
    } catch (error) {
      console.warn('Could not remove context:', error);
    }
  }, []);

  // Handle mouse events to prevent selection clearing
  const preventSelectionClear = useCallback((e: React.MouseEvent): void => {
    // Stop propagation to prevent the browser from clearing the selection
    e.stopPropagation();
  }, []);

  // Glassmorphism container style
  const containerStyle = useMemo((): CSSProperties => ({
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: WIDGET_CONSTANTS.Z_INDEX,
    background: 
      `linear-gradient(145deg, rgba(26, 26, 26, 0.85) 0%, rgba(42, 42, 42, 0.75) 100%), linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.3) 100%)`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${GRAYSCALE_COLORS.BORDER}`,
    borderRadius: '20px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(255, 255, 255, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
    fontFamily: FONT_FAMILY,
    pointerEvents: 'auto',
    isolation: 'isolate',
    willChange: 'transform',
    color: GRAYSCALE_COLORS.WHITE,
    width: `${size.width}px`,
    height: `${size.height}px`,
    display: 'flex',
    flexDirection: 'column',
    userSelect: 'none',
    overflow: 'hidden',
    opacity: isFadingOut ? 0 : 1,
    transition: isFadingOut ? `opacity ${ANIMATION_CONSTANTS.FADE_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform ${ANIMATION_CONSTANTS.FADE_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)` : 'none',
    transform: isFadingOut ? 'translateZ(0) scale(0.96)' : 'translateZ(0) scale(1)',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale'
  }), [position.x, position.y, size.width, size.height, isFadingOut]);

  const loadingOverlayStyle = useMemo((): CSSProperties => ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    opacity: isLoading ? 1 : 0,
    visibility: isLoading ? 'visible' : 'hidden',
    transition: 'opacity 0.3s ease, visibility 0.3s ease'
  }), [isLoading]);

  const shimmerTextStyle = useMemo((): CSSProperties => ({
    fontSize: '16px',
    fontWeight: '600',
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    marginBottom: '20px',
    background: `linear-gradient(90deg, rgba(255, 255, 255, 0.6) 0%, #a3a3a3 25%, #d4d4d4 50%, #a3a3a3 75%, rgba(255, 255, 255, 0.6) 100%)`,
    backgroundSize: '200% 100%',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
    animation: `shimmer ${ANIMATION_CONSTANTS.SHIMMER_DURATION}ms ease-in-out infinite`
  }), []);

  const processingDotsStyle = useMemo((): CSSProperties => ({
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center'
  }), []);

  const processingDotStyle = useMemo((): CSSProperties => ({
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    backgroundColor: 'rgba(163, 163, 163, 0.7)'
  }), []);

  const headerStyle = useMemo((): CSSProperties => ({ 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    padding: '20px 20px 16px 24px',
    borderBottom: `1px solid rgba(255, 255, 255, 0.1)`,
    flexShrink: 0,
    cursor: isDragging ? 'grabbing' : 'grab',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)'
  }), [isDragging]);


  const closeButtonStyle = useMemo((): CSSProperties => ({
    background: 'none',
    border: 'none',
    color: isCloseHovered ? '#a3a3a3' : 'rgba(255, 255, 255, 0.6)',
    cursor: 'pointer',
    padding: '8px',
    fontSize: '20px',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: '18px',
    transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    backgroundColor: isCloseHovered ? 'rgba(163, 163, 163, 0.12)' : 'transparent',
    fontFamily: FONT_FAMILY,
    transform: isCloseHovered ? 'scale(1.1)' : 'scale(1)'
  }), [isCloseHovered]);

  const editorStyle = useMemo((): CSSProperties => ({
    flex: 1,
    background: 'rgba(255, 255, 255, 0.02)',
    color: '#FFFFFF',
    border: 'none',
    padding: '20px',
    margin: '0',
    fontSize: '15px',
    lineHeight: '1.6',
    fontFamily: FONT_FAMILY,
    width: '100%',
    height: '100%',
    outline: 'none',
    boxSizing: 'border-box',
    overflow: 'auto',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)'
  }), []);

  const buttonContainerStyle = useMemo((): CSSProperties => ({
    display: 'flex',
    flexDirection: 'row',
    padding: '0',
    gap: '0',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    alignItems: 'center',
    borderTop: `1px solid rgba(255, 255, 255, 0.1)`,
    height: '64px',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)'
  }), []);

  const buttonBaseStyle = useMemo((): CSSProperties => ({
    padding: '20px 16px',
    borderRadius: '0',
    fontSize: '24px', 
    fontWeight: '600',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    fontFamily: FONT_FAMILY,
    textAlign: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    letterSpacing: '-0.2px',
    height: '100%',
    position: 'relative',
    backgroundColor: 'transparent',
    color: 'rgba(255, 255, 255, 0.8)',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale'
  }), []);

  const improveButtonStyle = useMemo((): CSSProperties => ({
    ...buttonBaseStyle,
    backgroundColor: isSendHovered ? `rgba(163, 163, 163, 0.15)` : 'transparent',
    color: isSendHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.9)',
    opacity: isLoading ? 0.6 : 1,
    cursor: isLoading ? 'wait' : 'pointer',
    flex: 3,
    position: 'relative',
    transform: isSendHovered ? 'translateY(-1px)' : 'translateY(0)',
    boxShadow: isSendHovered ? '0 0 20px rgba(163, 163, 163, 0.2)' : 'none'
  }), [buttonBaseStyle, isSendHovered, isLoading]);

  const importButtonStyle = useMemo((): CSSProperties => ({
    ...buttonBaseStyle,
    backgroundColor: isImportHovered ? `rgba(163, 163, 163, 0.12)` : 'transparent',
    color: isImportHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
    flex: 1,
    transform: isImportHovered ? 'translateY(-1px)' : 'translateY(0)'
  }), [buttonBaseStyle, isImportHovered]);

  const replaceButtonStyle = useMemo((): CSSProperties => ({
    ...buttonBaseStyle,
    backgroundColor: isReplaceHovered ? `rgba(163, 163, 163, 0.12)` : 'transparent',
    color: isReplaceHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
    flex: 1,
    transform: isReplaceHovered ? 'translateY(-1px)' : 'translateY(0)'
  }), [buttonBaseStyle, isReplaceHovered]);
  
  const errorMessageStyle = useMemo((): CSSProperties => ({
    color: '#a3a3a3',
    fontSize: '13px',
    margin: '0 24px 20px 24px',
    padding: '16px 20px',
    textAlign: 'left',
    minHeight: errorMessage ? 'auto' : '0',
    maxHeight: errorMessage ? '100px' : '0',
    overflow: errorMessage ? 'auto' : 'hidden',
    transition: 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    backgroundColor: 'rgba(163, 163, 163, 0.08)',
    border: `1px solid rgba(163, 163, 163, 0.15)`,
    borderRadius: '18px',
    lineHeight: '1.5',
    wordWrap: 'break-word',
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
    fontFamily: FONT_FAMILY,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    fontWeight: '400',
    boxShadow: '0 4px 12px rgba(163, 163, 163, 0.1)'
  }), [errorMessage]);

  const tooltipStyle = useMemo((): CSSProperties => ({
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    color: '#FFFFFF',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
    zIndex: 1000,
    transition: 'opacity 0.2s ease, visibility 0.2s ease',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    marginBottom: '8px',
    pointerEvents: 'none',
    maxWidth: '140px',
    textAlign: 'center',
    fontFamily: FONT_FAMILY
  }), []);

  const leftTooltipStyle = useMemo((): CSSProperties => ({
    ...tooltipStyle,
    left: '0',
    transform: 'translateX(0)'
  }), [tooltipStyle]);

  const rightTooltipStyle = useMemo((): CSSProperties => ({
    ...tooltipStyle,
    left: 'auto',
    right: '0',
    transform: 'translateX(0)'
  }), [tooltipStyle]);


  // Context section styles
  const contextSectionStyle = useMemo((): CSSProperties => ({
    borderTop: `1px solid rgba(255, 255, 255, 0.1)`,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    maxHeight: '150px',
    overflowY: 'auto',
    flexShrink: 0,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)'
  }), []);

  const contextItemStyle = useMemo((): CSSProperties => ({
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  }), []);

  const contextSourceStyle = useMemo((): CSSProperties => ({
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: FONT_FAMILY,
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }), []);

  const contextPreviewStyle = useMemo((): CSSProperties => ({
    fontSize: '12px',
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: '1.4',
    fontFamily: FONT_FAMILY,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }), []);

  const contextRemoveStyle = useMemo((): CSSProperties => ({
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.4)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px',
    borderRadius: '4px',
    transition: 'all 0.2s ease',
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  }), []);


  // Update position bounds checking
  const updatePosition = useCallback((newX: number, newY: number): void => {
    const maxX = window.innerWidth - size.width;
    const maxY = window.innerHeight - size.height;

    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    });
  }, [size]);

  const handleMouseDown = useCallback((e: React.MouseEvent): void => {
    // Check if the click is in the header area (either on the header itself or any of its children)
    const target = e.target as HTMLElement;
    const headerElement = target.closest('[data-header="true"]');
    
    // Don't handle drag if clicking on the close button
    if (target.closest('button')) {
      return;
    }
    
    // Only handle drag if we're in the header area
    if (!headerElement) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    onDragStart();

    const startX = e.clientX - position.x;
    const startY = e.clientY - position.y;

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const newX = moveEvent.clientX - startX;
      const newY = moveEvent.clientY - startY;
      updatePosition(newX, newY);
    };

    const handleMouseUp = (): void => {
      setIsDragging(false);
      onDragEnd();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position.x, position.y, onDragStart, onDragEnd, updatePosition]);

  const handleCloseClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const handleCloseMouseDown = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
  }, []);

  const handleCloseHover = useCallback((): void => {
    setIsCloseHovered(true);
  }, []);

  const handleCloseLeave = useCallback((): void => {
    setIsCloseHovered(false);
  }, []);

  const handleReplaceClick = useCallback((): void => {
    // Helper function to find and select the target element
    const findAndSelectTargetElement = (): boolean => {
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

      let foundElement: Element | null = null;
      
      // Try each selector
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
          // Select all text in the found element
          if (foundElement.tagName === 'TEXTAREA' || foundElement.tagName === 'INPUT') {
            const textareaElement = foundElement as HTMLInputElement | HTMLTextAreaElement;
            textareaElement.focus();
            textareaElement.select();
            textareaElement.setSelectionRange(0, textareaElement.value.length);
          } else if (foundElement.hasAttribute('contenteditable')) {
            const range = document.createRange();
            const selection = window.getSelection();
            
            (foundElement as HTMLElement).focus();
            range.selectNodeContents(foundElement);
            
            if (selection) {
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
          
          // Found and selected target element
          return true;
        } catch (selectionError) {
          console.warn('Could not select target element:', selectionError);
          return false;
        }
      }
      
      return false;
    };

    // First, try to use the parent's target selection updater if available
    let hasValidTarget = false;
    if (onUpdateTargetSelection) {
      hasValidTarget = onUpdateTargetSelection();
    }

    // If no valid target from parent, try to find and select the target element ourselves
    if (!hasValidTarget) {
      hasValidTarget = findAndSelectTargetElement();
      
      if (!hasValidTarget) {
        setErrorMessage('Could not find the chat input field to replace text. Please make sure you\'re on a supported chat interface.');
        setTimeout(() => setErrorMessage(''), 4000);
        return;
      }
    }

    // Perform the replace operation with flat text (dropdowns converted to selected values)
    const flatText = editorRef.current?.getFlatText() || editableText;
    onReplaceText(flatText);
    
            // Start the fade-out animation
        setIsFadingOut(true);
        
        // Close the widget after the animation completes
        setTimeout(() => {
          onClose();
        }, ANIMATION_CONSTANTS.FADE_DURATION);
  }, [editableText, onReplaceText, onUpdateTargetSelection, onClose]);

  const handleReplaceHover = useCallback((): void => {
    setIsReplaceHovered(true);
  }, []);

  const handleReplaceLeave = useCallback((): void => {
    setIsReplaceHovered(false);
  }, []);

  // Handle sending text to Claude AI
  const handleImproveClick = useCallback(async (): Promise<void> => {
    if (!editableText.trim()) return;
    
    setIsLoading(true);
    setErrorMessage('');
    
    try {
      // Check if extension context is still valid
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        setErrorMessage('Extension was reloaded. Please refresh the page to use PromptLayer.');
        setIsLoading(false);
        return;
      }

      const apiKey = await getApiKey();
      
      if (!apiKey) {
        setErrorMessage('Claude AI API key not set. Please set it in the extension settings.');
        setIsLoading(false);
        return;
      }
      
      // Initialize Claude AI client with the API key in the content script context
      initClaudeAI(apiKey);
      
      // Get the latest contexts for this request
      const currentContexts = await getContexts();
      
      // Pass contexts to the Claude AI service
      const response = await sendToClaudeAI(editableText, currentContexts);
      
      if (response.error) {
        setErrorMessage(response.error);
      } else if (response.content) {
        setEditableText(response.content);
        setIsUserEdited(false); // Reset edit state after AI improvement to allow future selections
        setHasBeenImproved(true); // Mark that text has been improved to prevent overwriting
      } else {
        setErrorMessage('No improved content received from AI');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      
      // Handle specific extension context errors
      if (errorMessage.includes('Extension context invalidated')) {
        setErrorMessage('Extension was reloaded. Please refresh the page to use PromptLayer.');
      } else {
        setErrorMessage(errorMessage);
      }
      
      console.error('Error in handleImproveClick:', error);
    } finally {
      setIsLoading(false);
    }
  }, [editableText]);
  
  const handleImproveHover = useCallback((): void => {
    setIsSendHovered(true);
  }, []);
  
  const handleImproveLeave = useCallback((): void => {
    setIsSendHovered(false);
  }, []);

  const handleImport = useCallback((): void => {
    try {
      // Simplified selectors - just find the main input field
      const selectors = [
        // ChatGPT
        'textarea[placeholder*="Message"]',
        'textarea[data-id="root"]',
        '#prompt-textarea',
        
        // Claude
        'div[contenteditable="true"][data-testid="composer-input"]',
        
        // Gemini 
        'textarea[placeholder*="Enter a prompt"]',
        
        // Perplexity
        'textarea[placeholder*="Ask anything"]',
        
        // Generic fallback
        'textarea:not([readonly]):not([disabled])',
        'div[contenteditable="true"]:not([readonly])'
      ];

      let foundElement = null;
      
      // Try each selector and take the first visible one
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          
          for (const element of elements) {
            const rect = element.getBoundingClientRect();
            if (rect.width < 50 || rect.height < 20) continue;
            
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
        // Get the text (empty is fine)
        let text = '';
        if (foundElement.tagName === 'TEXTAREA' || foundElement.tagName === 'INPUT') {
          text = (foundElement as HTMLInputElement | HTMLTextAreaElement).value;
        } else if (foundElement.hasAttribute('contenteditable')) {
          text = foundElement.textContent || '';
        }
        
        // Import whatever text we found (even if empty)
        setEditableText(text);
        setIsUserEdited(false);
        setUserHasClearedText(false); // Reset the flag when importing new text
        setHasBeenImproved(false); // Reset the improvement flag when importing new text
        
        // Successfully imported text
        
        // Select the text in the original element
        try {
          if (foundElement.tagName === 'TEXTAREA' || foundElement.tagName === 'INPUT') {
            const textareaElement = foundElement as HTMLInputElement | HTMLTextAreaElement;
            textareaElement.focus();
            textareaElement.select();
            textareaElement.setSelectionRange(0, text.length);
          } else if (foundElement.hasAttribute('contenteditable')) {
            const range = document.createRange();
            const selection = window.getSelection();
            
            (foundElement as HTMLElement).focus();
            range.selectNodeContents(foundElement);
            
            if (selection) {
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        } catch (selectionError) {
          console.warn('Could not select text, but import was successful:', selectionError);
        }
        
      } else {
        // No input field found
        setErrorMessage('Could not find chat input field. Make sure you are on a supported LLM website.');
        setTimeout(() => setErrorMessage(''), 4000);
      }
    } catch (error) {
      console.error('Error importing text:', error);
      setErrorMessage('Failed to import text from chat field.');
      setTimeout(() => setErrorMessage(''), 4000);
    }
  }, []);

  const handleImportHover = useCallback((): void => {
    setIsImportHovered(true);
  }, []);

  const handleImportLeave = useCallback((): void => {
    setIsImportHovered(false);
  }, []);

  return (
    <div 
      ref={widgetRef}
      style={containerStyle}
      role="dialog"
      aria-label="PromptLayer Widget"
      aria-modal="false"
      onMouseDown={preventSelectionClear}
      onClick={preventSelectionClear}
    >
      {/* Add CSS animation keyframes */}
      <style>
        {CSS_ANIMATIONS}
      </style>

      {/* Loading Overlay */}
      {isLoading && (
        <div style={loadingOverlayStyle}>
          <div style={shimmerTextStyle}>Improving your prompt</div>
          <div style={processingDotsStyle}>
            <div style={processingDotStyle} className="processing-dot-1" />
            <div style={processingDotStyle} className="processing-dot-2" />
            <div style={processingDotStyle} className="processing-dot-3" />
          </div>
        </div>
      )}


      <div 
        data-header="true"
        style={headerStyle}
        onMouseDown={handleMouseDown}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Logo size={42} animated={true} />
        </div>
        <button
          onClick={handleCloseClick}
          onMouseDown={handleCloseMouseDown}
          onMouseEnter={handleCloseHover}
          onMouseLeave={handleCloseLeave}
          style={closeButtonStyle}
          aria-label="Close widget"
          type="button"
        >
          ×
        </button>
      </div>

      {/* Primary editor with inline dropdown support - fills entire middle area */}
      <InlineDropdownEditor
        ref={editorRef}
        value={editableText}
        onChange={(newValue: string) => {
          setEditableText(newValue);
          setIsUserEdited(true);
          setHasBeenImproved(false); // Reset improvement flag when user edits
          
          // Track if user has explicitly cleared all text
          if (newValue.trim() === '' && editableText.trim() !== '') {
            setUserHasClearedText(true);
          } else if (newValue.trim() !== '') {
            // Reset the flag when user starts typing again
            setUserHasClearedText(false);
          }
        }}
        placeholder="Type or edit text here..."
        style={{
          ...editorStyle,
          // Override InlineDropdownEditor's internal styling to blend with widget
          border: 'none',
          borderRadius: '0',
          backgroundColor: 'transparent',
          color: 'inherit'
        }}
      />
      
      {errorMessage && (
        <div style={errorMessageStyle}>{errorMessage}</div>
      )}

      {/* Context Section - only show when contexts exist */}
      {contexts.length > 0 && (
        <div style={contextSectionStyle}>
          {contexts.map((context) => (
            <div key={context.id} style={contextItemStyle}>
              <div style={contextSourceStyle}>
                <span title={context.url}>
                  Context from: {context.title || new URL(context.url).hostname}
                </span>
                <button
                  onClick={() => handleRemoveContext(context.id)}
                  style={contextRemoveStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#a3a3a3';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  aria-label="Remove context"
                  type="button"
                >
                  ×
                </button>
              </div>
              <div style={contextPreviewStyle} title={context.content}>
                {context.content.slice(0, 100)}
                {context.content.length > 100 ? '...' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={buttonContainerStyle}>
        <button
          onClick={handleImport}
          onMouseEnter={handleImportHover}
          onMouseLeave={handleImportLeave}
          style={importButtonStyle}
          aria-label="Import text from chat input field"
          type="button"
        >
          <span style={{ fontSize: '24px' }}>＋</span>
          {isImportHovered && (
            <div style={leftTooltipStyle}>
              Import from Chat
            </div>
          )}
        </button>
        
        <button
          onClick={handleImproveClick}
          onMouseEnter={handleImproveHover}
          onMouseLeave={handleImproveLeave}
          style={improveButtonStyle}
          aria-label={contexts.length > 0 ? `Improve the prompt using AI with ${contexts.length} context${contexts.length > 1 ? 's' : ''}` : "Improve the prompt using AI"}
          type="button"
          disabled={isLoading}
        >
          <span style={{ fontSize: '24px' }}>{isLoading ? '⟳' : '➤'}</span>
          {/* Context indicator */}
          {contexts.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#a3a3a3',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              fontSize: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 'bold',
              pointerEvents: 'none'
            }}>
              {contexts.length}
            </div>
          )}
          {isSendHovered && (
            <div style={tooltipStyle}>
              {contexts.length > 0 ? `Improve with ${contexts.length} context${contexts.length > 1 ? 's' : ''}` : 'Improve Prompt'}
            </div>
          )}
          <div style={{
            position: 'absolute',
            left: 0,
            top: '20%',
            bottom: '20%',
            width: '1px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            pointerEvents: 'none'
          }} />
          <div style={{
            position: 'absolute',
            right: 0,
            top: '20%',
            bottom: '20%',
            width: '1px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            pointerEvents: 'none'
          }} />
        </button>
        
        <button
          onClick={handleReplaceClick}
          onMouseEnter={handleReplaceHover}
          onMouseLeave={handleReplaceLeave}
          style={replaceButtonStyle}
          aria-label="Replace the original text with the improved version"
          type="button"
        >
          <span style={{ fontSize: '24px' }}>↻</span>
          {isReplaceHovered && (
            <div style={rightTooltipStyle}>
              Replace Original
            </div>
          )}
        </button>
      </div>
    </div>
  );
};

export default Widget; 