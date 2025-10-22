import React, { useState, useRef, useEffect, useMemo, CSSProperties } from 'react';
import Logo from './Logo';

interface RefineButtonProps {
  onRefineClick: () => void;
  onClose: () => void;
}

interface Position {
  x: number;
  y: number;
}

const RefineButton: React.FC<RefineButtonProps> = ({ onRefineClick, onClose }) => {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const spawnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Position the button near the current text selection
  useEffect(() => {
    const positionButton = () => {
      try {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        
        // Get position at the actual end of the text
        const endRange = document.createRange();
        endRange.setStart(range.endContainer, range.endOffset);
        endRange.collapse(true);
        
        // Get overall selection bounds for bottom position
        const selectionRect = range.getBoundingClientRect();
        const endRect = endRange.getBoundingClientRect();
        
        if (selectionRect.width === 0 && selectionRect.height === 0) return;

        // Position right next to where text ends, at bottom of selection
        const buttonWidth = 32;
        const buttonHeight = 32;
        const offsetX = 3;
        const offsetY = 0;

        let x = endRect.left + offsetX; // Right next to where text ends
        let y = selectionRect.bottom + offsetY; // Bottom of selection

        // Keep within viewport bounds
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        if (x + buttonWidth > scrollX + viewportWidth - 10) {
          x = scrollX + viewportWidth - buttonWidth - 10;
        }
        if (x < scrollX + 10) {
          x = scrollX + 10;
        }
        if (y + buttonHeight > scrollY + viewportHeight - 10) {
          y = scrollY + viewportHeight - buttonHeight - 10;
        }
        if (y < scrollY + 10) {
          y = scrollY + 10;
        }

        setPosition({ x, y });
      } catch (error) {
        console.error('Error positioning refine button:', error);
      }
    };

    // Position immediately and show after delay
    positionButton();
    
    // Clear any existing timeout
    if (spawnTimeoutRef.current) {
      clearTimeout(spawnTimeoutRef.current);
    }
    
    // Show button after 300ms delay
    spawnTimeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, 120);

    // Reposition on scroll or resize
    const handleReposition = () => {
      setTimeout(positionButton, 10);
    };

    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      if (spawnTimeoutRef.current) {
        clearTimeout(spawnTimeoutRef.current);
      }
    };
  }, []);

  // Auto-hide the button after a delay if not hovered
  useEffect(() => {
    if (isHovered || !isVisible) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 150); // Wait for fade out animation
    }, 5000);

    return () => clearTimeout(timer);
  }, [isHovered, isVisible, onClose]);

  // Close button if clicked outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        // Small delay to allow for button clicks
        setTimeout(() => {
          const selection = window.getSelection();
          if (!selection || selection.toString().trim() === '') {
            setIsVisible(false);
            setTimeout(onClose, 150);
          }
        }, 100);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const containerStyle = useMemo((): CSSProperties => ({
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 2147483646, // Just below the main widget
    backgroundColor: 'transparent',
    pointerEvents: 'auto',
    isolation: 'isolate',
    willChange: 'transform',
    animation: isVisible ? 'fadeIn 0.15s ease-out' : 'fadeOut 0.15s ease-out',
    opacity: isVisible ? 1 : 0,
    cursor: 'pointer',
    userSelect: 'none'
  }), [position.x, position.y, isVisible]);

  const logoStyle = useMemo((): CSSProperties => ({
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
    boxShadow: isHovered ? '0 0 12px rgba(212, 212, 212, 0.6)' : 'none',
    borderRadius: '50%'
  }), [isHovered]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRefineClick();
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  // Don't render if not visible
  if (!isVisible) {
    return null;
  }

  return (
    <>
      {/* Add CSS keyframes */}
      <style>
        {`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(-6px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes fadeOut {
            from {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
            to {
              opacity: 0;
              transform: translateY(-6px) scale(0.95);
            }
          }
        `}
      </style>
      
      <div 
        ref={buttonRef}
        style={containerStyle}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="button"
        aria-label="Refine selected prompt"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRefineClick();
          }
        }}
      >
        <div style={logoStyle}>
          <Logo size={24} animated={true} />
        </div>
      </div>
    </>
  );
};

export default RefineButton; 