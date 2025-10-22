/**
 * Real-time suggestion bubble component
 * 
 * Displays AI-generated prompt suggestions in a floating bubble near input fields.
 * Listens for global events from the real-time monitor and provides accessible,
 * mobile-responsive UI with smooth animations.
 */

import React, { useState, useEffect, useRef } from 'react';
import { detectCurrentPlatform, findMainInputElement } from '../services/platformDetection';

interface SuggestionData {
  suggestion: string;
  originalText: string;
  platform: string;
}

interface SuggestionBubbleProps {
  // No props needed - listens to global events from realtimeMonitor
}

const SuggestionBubble: React.FC<SuggestionBubbleProps> = () => {
  const [suggestion, setSuggestion] = useState<SuggestionData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate bubble position relative to input element
  const calculatePosition = (): { top: number; left: number } => {
    const inputElement = findMainInputElement();
    if (!inputElement) {
      return { top: 100, left: 100 };
    }

    const rect = inputElement.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;
    const bubbleWidth = isMobile ? Math.min(280, window.innerWidth - 32) : 300;
    const bubbleHeight = 80;
    const padding = isMobile ? 16 : 12;

    // Position above the input field by default
    let top = rect.top - bubbleHeight - padding;
    let left = rect.left;

    // If not enough space above, position below
    if (top < padding) {
      top = rect.bottom + padding;
    }

    // Mobile: center horizontally if input is small
    if (isMobile && rect.width < bubbleWidth) {
      left = Math.max(padding, (window.innerWidth - bubbleWidth) / 2);
    } else {
      // Keep bubble within viewport horizontally
      const maxLeft = window.innerWidth - bubbleWidth - padding;
      if (left > maxLeft) {
        left = maxLeft;
      }
      if (left < padding) {
        left = padding;
      }
    }

    // Keep bubble within viewport vertically
    if (top < padding) {
      top = padding;
    }
    if (top > window.innerHeight - bubbleHeight - padding) {
      top = window.innerHeight - bubbleHeight - padding;
    }

    return { top, left };
  };

  // Show suggestion with animation
  const showSuggestion = (data: SuggestionData) => {
    setSuggestion(data);
    setPosition(calculatePosition());
    setIsVisible(true);

    // Auto-hide after 8 seconds
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      hideSuggestion();
    }, 8000);
  };

  // Hide suggestion with animation
  const hideSuggestion = () => {
    setIsVisible(false);
    
    // Clear suggestion after fade out animation
    setTimeout(() => {
      setSuggestion(null);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    }, 300);
  };

  // Listen for suggestion events
  useEffect(() => {
    const handleSuggestion = (event: Event) => {
      const customEvent = event as CustomEvent<SuggestionData>;
      if (customEvent.detail && customEvent.detail.suggestion) {
        showSuggestion(customEvent.detail);
      }
    };

    const handleAnalysisStart = () => {
      // Show loading state after 500ms delay to avoid flicker for fast responses
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoading(true);
        setPosition(calculatePosition());
        setIsVisible(true);
      }, 500);
    };

    const handleAnalysisEnd = () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setIsLoading(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isVisible) return;
      
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSuggestion();
      } else if (event.key === 'Enter' && event.ctrlKey) {
        // Ctrl+Enter to dismiss (accessibility alternative)
        event.preventDefault();
        hideSuggestion();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(event.target as Node) && isVisible) {
        hideSuggestion();
      }
    };

    // Add event listeners
    window.addEventListener('promptSuggestion', handleSuggestion);
    window.addEventListener('promptAnalysisStart', handleAnalysisStart);
    window.addEventListener('promptAnalysisEnd', handleAnalysisEnd);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClickOutside);

    // Cleanup
    return () => {
      window.removeEventListener('promptSuggestion', handleSuggestion);
      window.removeEventListener('promptAnalysisStart', handleAnalysisStart);
      window.removeEventListener('promptAnalysisEnd', handleAnalysisEnd);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [isVisible]);

  // Update position when window resizes
  useEffect(() => {
    const handleResize = () => {
      if (isVisible) {
        setPosition(calculatePosition());
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isVisible]);

  if (!suggestion && !isLoading) {
    return null;
  }

  return (
    <>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    <div
      ref={bubbleRef}
      role="dialog"
      aria-live="polite"
      aria-label={isLoading ? "Analyzing prompt for suggestions" : "Prompt suggestion"}
      tabIndex={isVisible ? 0 : -1}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 2147483647,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(-12px) scale(0.9)',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        willChange: 'transform, opacity',
        pointerEvents: isVisible ? 'auto' : 'none',
        maxWidth: window.innerWidth <= 768 ? 'calc(100vw - 32px)' : '300px',
        fontFamily: '"SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          background: 'rgba(28, 28, 30, 0.65)',
          color: 'white',
          padding: '18px 22px',
          borderRadius: '20px',
          fontSize: '15px',
          lineHeight: '1.5',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          position: 'relative',
          fontFamily: '"SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        {/* Close button */}
        <button
          onClick={hideSuggestion}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '4px',
            lineHeight: '1',
            borderRadius: '10px',
            transition: 'all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            fontFamily: '"SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
            e.currentTarget.style.backgroundColor = 'rgba(255, 69, 58, 0.12)';
            e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 69, 58, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.boxShadow = 'none';
          }}
          title="Dismiss (ESC)"
        >
          ×
        </button>

        {/* Suggestion content */}
        <div style={{ paddingRight: '20px' }}>
          <div
            style={{
              fontSize: '13px',
              color: 'rgba(255, 255, 255, 0.7)',
              marginBottom: '8px',
              fontWeight: '600',
              fontFamily: '"SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
              letterSpacing: '-0.1px',
            }}
          >
            {isLoading ? 'Analyzing...' : 'Suggestion'}
          </div>
          <div
            style={{
              fontSize: '15px',
              color: 'white',
              fontWeight: '500',
              minHeight: '22px',
              display: 'flex',
              alignItems: 'center',
              fontFamily: '"SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
              lineHeight: '1.4',
              letterSpacing: '-0.1px',
            }}
          >
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    border: '2px solid rgba(255, 255, 255, 0.3)',
                    borderTop: '2px solid white',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  Getting suggestions...
                </span>
              </div>
            ) : (
              suggestion?.suggestion || ''
            )}
          </div>
        </div>

        {/* Subtle arrow pointing to input */}
        <div
          style={{
            position: 'absolute',
            bottom: '-6px',
            left: '28px',
            width: '12px',
            height: '12px',
            background: 'rgba(28, 28, 30, 0.65)',
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            transform: 'rotate(45deg)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        />
      </div>
    </div>
    </>
  );
};

export default SuggestionBubble; 