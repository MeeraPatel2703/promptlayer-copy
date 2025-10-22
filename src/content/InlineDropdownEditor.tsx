import React, { useState, useEffect, useRef, useCallback } from 'react';

// Add CSS keyframes for blinking cursor animation
const cursorStyles = `
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
`;

// Inject styles into the document head if not already present
if (typeof document !== 'undefined' && !document.getElementById('inline-dropdown-editor-styles')) {
  const styleElement = document.createElement('style');
  styleElement.id = 'inline-dropdown-editor-styles';
  styleElement.textContent = cursorStyles;
  document.head.appendChild(styleElement);
}

// ============================================================================
// STANDALONE TYPE DEFINITIONS AND UTILITIES
// ============================================================================

interface BaseSegment {
  id: string;
}

interface TextSegment extends BaseSegment {
  type: 'text';
  value: string;
}

interface DropdownSegment extends BaseSegment {
  type: 'dropdown';
  options: string[];
  selected: string;
  /** Whether the dropdown is in custom input mode */
  isCustomMode?: boolean;
}

type Segment = TextSegment | DropdownSegment;

interface SegmentPosition {
  /** Index of the segment in the segments array */
  segmentIndex: number;
  /** Character offset within the segment (0-based) */
  offsetInSegment: number;
}

interface EditorSelection {
  /** Start position of selection */
  start: SegmentPosition;
  /** End position of selection */
  end: SegmentPosition;
}

interface EditorState {
  /** Array of content segments */
  segments: Segment[];
  /** Current selection/cursor position */
  selection: EditorSelection;
  /** Scroll position (for future use) */
  scrollPosition?: { x: number; y: number };
  /** Currently highlighted chip (for navigation) */
  highlightedChip?: string | null;
}

interface InsertTextPayload {
  segmentId: string;
  offsetInSegment: number;
  text: string;
}

interface DeleteRangePayload {
  start: SegmentPosition;
  end: SegmentPosition;
}

interface ReplaceRangePayload {
  range: { start: SegmentPosition; end: SegmentPosition };
  newSegments: Segment[];
}

interface ChangeDropdownPayload {
  segmentId: string;
  newSelection: string;
}

interface DeleteDropdownPayload {
  segmentId: string;
}

interface ConvertDropdownToTextPayload {
  segmentId: string;
  textValue: string;
}

interface AddCustomOptionPayload {
  segmentId: string;
  customValue: string;
}

type EditorAction = 
  | { type: 'INSERT_TEXT'; payload: InsertTextPayload }
  | { type: 'DELETE_RANGE'; payload: DeleteRangePayload }
  | { type: 'REPLACE_RANGE'; payload: ReplaceRangePayload }
  | { type: 'CHANGE_DROPDOWN'; payload: ChangeDropdownPayload }
  | { type: 'DELETE_DROPDOWN'; payload: DeleteDropdownPayload }
  | { type: 'CONVERT_DROPDOWN_TO_TEXT'; payload: ConvertDropdownToTextPayload }
  | { type: 'ADD_CUSTOM_OPTION'; payload: AddCustomOptionPayload };

interface EditorActionWithMetadata {
  /** The action type and payload */
  action: EditorAction;
  /** Timestamp when action was created */
  timestamp: number;
  /** Editor state before the action (for undo) */
  beforeState?: EditorState;
  /** Editor state after the action (for redo) */
  afterState?: EditorState;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const generateSegmentId = (): string => {
  return 'seg_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
};

const parseDropdownOptions = (content: string): string[] => {
  const trimmed = content.slice(2, -2).trim();
  return trimmed.split('|').map(option => option.trim().replace(/^'|'$/g, ''));
};

// Real-time dropdown pattern detection and conversion
const detectAndCreateDropdowns = (segments: Segment[]): { segments: Segment[], hasChanges: boolean } => {
  const newSegments: Segment[] = [];
  let hasChanges = false;
  
  for (const segment of segments) {
    if (segment.type !== 'text') {
      newSegments.push(segment);
      continue;
    }
    
    const text = segment.value;
    const dropdownRegex = /\[\[([^\]]+)\]\]/g;
    let lastIndex = 0;
    let match;
    let foundPatterns = false;
    
    while ((match = dropdownRegex.exec(text)) !== null) {
      foundPatterns = true;
      hasChanges = true;
      
      // Add text before the pattern (if any)
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index);
        if (beforeText) {
          newSegments.push({
            id: generateSegmentId(),
            type: 'text',
            value: beforeText
          });
        }
      }
      
      // Parse and validate the dropdown pattern
      const optionsText = match[1].trim();
      if (optionsText) {
        const options = optionsText.split('|').map(option => option.trim().replace(/^'|'$/g, '')).filter(opt => opt.length > 0);
        
        if (options.length > 0) {
          // Add 'custom...' option to all dropdowns automatically
          const optionsWithCustom = [...options];
          if (!optionsWithCustom.includes('custom...')) {
            optionsWithCustom.push('custom...');
          }
          
          // Create dropdown segment
          newSegments.push({
            id: generateSegmentId(),
            type: 'dropdown',
            options: optionsWithCustom,
            selected: options[0]
          });
        } else {
          // Invalid pattern - keep as text
          newSegments.push({
            id: generateSegmentId(),
            type: 'text',
            value: match[0]
          });
        }
      } else {
        // Empty pattern - keep as text
        newSegments.push({
          id: generateSegmentId(),
          type: 'text',
          value: match[0]
        });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    if (foundPatterns) {
      // Add remaining text after the last pattern (if any)
      if (lastIndex < text.length) {
        const afterText = text.slice(lastIndex);
        if (afterText) {
          newSegments.push({
            id: generateSegmentId(),
            type: 'text',
            value: afterText
          });
        }
      }
      
      // CRITICAL FIX: Always ensure there's a text segment after the last dropdown
      // Check if the last segment is a dropdown and there's no text segment after it
      if (newSegments.length > 0 && newSegments[newSegments.length - 1].type === 'dropdown') {
        newSegments.push({
          id: generateSegmentId(),
          type: 'text',
          value: ''
        });
      }
    } else {
      // No patterns found - keep original segment
      newSegments.push(segment);
    }
  }
  
  return { segments: newSegments, hasChanges };
};

const parseTextToSegments = (text: string): Segment[] => {
  if (!text) return [];
  
  const segments: Segment[] = [];
  // Simple regex to match [[...]] patterns without nested bracket support
  const dropdownRegex = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match;

  while ((match = dropdownRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const innerContent = match[1];

    // Add text before the pattern (if any)
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      if (beforeText) {
        segments.push({
          id: generateSegmentId(),
          type: 'text',
          value: beforeText
        });
      }
    }

    // Enhanced option parsing with edge case handling
    const options = parseDropdownOptionsRobust(fullMatch, innerContent);
    
    if (options.length > 0) {
      // Add 'custom...' option to all dropdowns automatically
      const optionsWithCustom = [...options];
      if (!optionsWithCustom.includes('custom...')) {
        optionsWithCustom.push('custom...');
      }
      
      segments.push({
        id: generateSegmentId(),
        type: 'dropdown',
        options: optionsWithCustom,
        selected: options[0]
      });
    } else {
      // If parsing failed, treat as text
      segments.push({
        id: generateSegmentId(),
        type: 'text',
        value: fullMatch
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text after the last pattern (if any)
  if (lastIndex < text.length) {
    const afterText = text.slice(lastIndex);
    if (afterText) {
      segments.push({
        id: generateSegmentId(),
        type: 'text',
        value: afterText
      });
    }
  }

  return segments;
};

// Simple dropdown option parsing without nested bracket support
const parseDropdownOptionsRobust = (fullMatch: string, innerContent: string): string[] => {
  // Handle empty patterns
  if (!innerContent || innerContent.trim() === '') {
    return [];
  }

  // Split by pipe character and clean each option
  const rawOptions = innerContent.split('|');
  const cleanOptions: string[] = [];
  
  for (const rawOption of rawOptions) {
    let option = rawOption.trim();
    
    // Remove surrounding quotes if present
    if ((option.startsWith('"') && option.endsWith('"')) || 
        (option.startsWith("'") && option.endsWith("'"))) {
      option = option.slice(1, -1);
    }
    
    // Skip empty options
    if (option === '') {
      continue;
    }
    
    // Clean option content: remove any brackets and trim
    option = option.replace(/[\[\]]/g, '').trim();
    
    if (option.length > 0) {
      cleanOptions.push(option);
    }
  }
  
  // Require at least one valid option
  return cleanOptions.length > 0 ? cleanOptions : [];
};

const segmentsToText = (segments: Segment[]): string => {
  return segments.map(segment => {
    if (segment.type === 'text') {
      return segment.value;
    } else {
      // For dropdown segments, put the selected option first and include all options
      const selectedOption = segment.selected;
      const otherOptions = segment.options.filter(opt => opt !== selectedOption);
      const allOptions = [selectedOption, ...otherOptions].map(opt => `'${opt}'`).join(' | ');
      return `[[${allOptions}]]`;
    }
  }).join('');
};

// Convert segments to flat text with dropdowns resolved to their selected values
export const segmentsToFlatText = (segments: Segment[]): string => {
  return segments.map(segment => {
    if (segment.type === 'text') {
      return segment.value;
    } else {
      // For dropdown segments, use only the selected option
      return segment.selected;
    }
  }).join('');
};

function isSelectionCollapsed(selection: EditorSelection): boolean {
  return selection.start.segmentIndex === selection.end.segmentIndex &&
         selection.start.offsetInSegment === selection.end.offsetInSegment;
}

function createCursorSelection(position: SegmentPosition): EditorSelection {
  return {
    start: position,
    end: position
  };
}

function createAction<T extends EditorAction['type']>(
  type: T,
  payload: Extract<EditorAction, { type: T }>['payload'],
  beforeState?: EditorState
): EditorActionWithMetadata {
  return {
    action: { type, payload } as EditorAction,
    timestamp: Date.now(),
    beforeState
  };
}

// ============================================================================
// DISPATCH EDIT SYSTEM
// ============================================================================

function dispatchEdit(currentState: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'INSERT_TEXT':
      return handleInsertText(currentState, action.payload);
    case 'DELETE_RANGE':
      return handleDeleteRange(currentState, action.payload);
    case 'CHANGE_DROPDOWN':
      return handleChangeDropdown(currentState, action.payload);
    case 'DELETE_DROPDOWN':
      return handleDeleteDropdown(currentState, action.payload);
    case 'CONVERT_DROPDOWN_TO_TEXT':
      return handleConvertDropdownToText(currentState, action.payload);
    case 'ADD_CUSTOM_OPTION':
      return handleAddCustomOption(currentState, action.payload);
    default:
      console.warn('Unhandled action type:', action.type);
      return currentState;
  }
}

function handleInsertText(
  state: EditorState,
  payload: InsertTextPayload
): EditorState {
  const newSegments = [...state.segments];
  const segmentIndex = newSegments.findIndex(s => s.id === payload.segmentId);
  
  if (segmentIndex === -1) {
    console.warn('Segment not found for text insertion');
    return state;
  }
  
  const segment = newSegments[segmentIndex];
  if (segment.type !== 'text') {
    console.warn('Cannot insert text into non-text segment');
    return state;
  }
  
  const newSegment = { ...segment };
  const before = newSegment.value.substring(0, payload.offsetInSegment);
  const after = newSegment.value.substring(payload.offsetInSegment);
  newSegment.value = before + payload.text + after;
  newSegments[segmentIndex] = newSegment;
  
  return {
    ...state,
    segments: newSegments,
    selection: {
      start: { segmentIndex, offsetInSegment: payload.offsetInSegment + payload.text.length },
      end: { segmentIndex, offsetInSegment: payload.offsetInSegment + payload.text.length }
    }
  };
}

function handleDeleteRange(
  state: EditorState,
  payload: DeleteRangePayload
): EditorState {
  // TODO: Implement range deletion logic
  return state;
}

function handleChangeDropdown(
  state: EditorState, 
  payload: ChangeDropdownPayload
): EditorState {
  const newSegments = state.segments.map(segment => {
    if (segment.id === payload.segmentId && segment.type === 'dropdown') {
      return { ...segment, selected: payload.newSelection };
    }
    return segment;
  });

  return {
    ...state,
    segments: newSegments
  };
}

function handleDeleteDropdown(
  state: EditorState, 
  payload: DeleteDropdownPayload
): EditorState {
  const newSegments = state.segments.filter(segment => segment.id !== payload.segmentId);
  
  return {
    ...state,
    segments: newSegments
  };
}

function handleConvertDropdownToText(
  state: EditorState,
  payload: ConvertDropdownToTextPayload
): EditorState {
  const newSegments = state.segments.map(segment => {
    if (segment.id === payload.segmentId && segment.type === 'dropdown') {
      // Convert dropdown to text segment
      return {
        id: generateSegmentId(),
        type: 'text' as const,
        value: payload.textValue
      };
    }
    return segment;
  });

  return {
    ...state,
    segments: newSegments
  };
}

function handleAddCustomOption(
  state: EditorState,
  payload: AddCustomOptionPayload
): EditorState {
  const newSegments = state.segments.map(segment => {
    if (segment.id === payload.segmentId && segment.type === 'dropdown') {
      // Add custom value to options (if not already present) and select it
      const existingOptions = segment.options.filter(opt => opt !== 'custom...');
      const customValue = payload.customValue;
      
      // Check if custom value already exists in options
      const optionsWithCustom = existingOptions.includes(customValue) 
        ? [...existingOptions, 'custom...']
        : [...existingOptions, customValue, 'custom...'];
      
      return {
        ...segment,
        options: optionsWithCustom,
        selected: customValue
      };
    }
    return segment;
  });

  return {
    ...state,
    segments: newSegments
  };
}

// ============================================================================
// DROPDOWN CHIP COMPONENT
// ============================================================================

interface DropdownChipProps {
  /** Unique identifier */
  id: string;
  /** Available options */
  options: string[];
  /** Currently selected option */
  selected: string;
  /** Callback when selection changes */
  onChange: (newSelection: string) => void;
  /** Callback when chip should be deleted */
  onDelete: () => void;
  /** Callback when custom option should be added */
  onAddCustomOption?: (customValue: string) => void;
  /** Text metrics for dynamic styling */
  textMetrics: {
    lineHeight: number;
    fontSize: number;
    fontFamily: string;
  } | null;
  /** Whether this chip is currently highlighted */
  highlighted?: boolean;
}

const DropdownChip: React.FC<DropdownChipProps> = ({
  id,
  options,
  selected,
  onChange,
  onDelete,
  onAddCustomOption,
  textMetrics,
  highlighted = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const chipRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chipRef.current && !chipRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Also exit custom mode if clicking outside while in custom mode
        if (isCustomMode) {
          setIsCustomMode(false);
          setCustomValue('');
        }
      }
    };

    if (isOpen || isCustomMode) {
      document.addEventListener('mousedown', handleClickOutside, true); // Use capture phase for better detection
      return () => document.removeEventListener('mousedown', handleClickOutside, true);
    }
  }, [isOpen, isCustomMode]);

  const handleChipClick = useCallback(() => {
    setIsOpen(!isOpen);
  }, [isOpen]);

  const handleOptionSelect = useCallback((option: string) => {
    if (option === 'custom...') {
      setIsCustomMode(true);
      setIsOpen(false);
      setCustomValue('');
      // Focus the input field after state update
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } else {
      onChange(option);
      setIsOpen(false);
    }
  }, [onChange]);

  const handleCustomInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomValue(e.target.value);
  }, []);

  const handleCustomInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (customValue.trim() && onAddCustomOption) {
        onAddCustomOption(customValue.trim());
        setIsCustomMode(false);
        setCustomValue('');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsCustomMode(false);
      setCustomValue('');
    }
  }, [customValue, onAddCustomOption]);

  const handleCustomInputBlur = useCallback(() => {
    if (customValue.trim() && onAddCustomOption) {
      onAddCustomOption(customValue.trim());
      setIsCustomMode(false);
      setCustomValue('');
    } else {
      setIsCustomMode(false);
      setCustomValue('');
    }
  }, [customValue, onAddCustomOption]);

  // Modern, refined chip styling that integrates seamlessly with the editor
  const getChipStyle = useCallback((): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      background: highlighted 
        ? 'linear-gradient(135deg, rgba(100, 116, 139, 0.2) 0%, rgba(100, 116, 139, 0.3) 100%)' 
        : (isHovered 
          ? 'linear-gradient(135deg, rgba(71, 85, 105, 0.15) 0%, rgba(71, 85, 105, 0.22) 100%)'
          : 'linear-gradient(135deg, rgba(51, 65, 85, 0.12) 0%, rgba(51, 65, 85, 0.18) 100%)'),
      border: highlighted 
        ? '1px solid rgba(100, 116, 139, 0.45)' 
        : (isHovered
          ? '1px solid rgba(71, 85, 105, 0.3)'
          : '1px solid rgba(51, 65, 85, 0.25)'),
      margin: '0 2px',
      color: highlighted 
        ? 'rgba(226, 232, 240, 1)' 
        : (isHovered ? 'rgba(241, 245, 249, 0.95)' : 'rgba(226, 232, 240, 0.9)'),
      cursor: 'pointer',
      userSelect: 'none',
      position: 'relative',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      fontFamily: 'inherit',
      maxWidth: '200px',
      overflow: 'visible',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      zIndex: isOpen ? 2000 : 'auto',
      verticalAlign: 'baseline',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)', // Safari support
      boxShadow: highlighted 
        ? '0 0 0 2px rgba(100, 116, 139, 0.25), 0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.12)' 
        : (isHovered 
          ? '0 2px 6px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.08)' 
          : '0 1px 3px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.05)'),
    };

    if (textMetrics) {
      const { fontSize, lineHeight } = textMetrics;
      
      // Refined proportions that blend naturally with text
      const chipHeight = Math.max(fontSize * 1.3, 20); // More modest height
      const chipPadding = Math.max(fontSize * 0.6, 8); // Refined padding
      const chipFontSize = Math.max(fontSize * 0.9, 12); // Slightly smaller for elegance
      const chipBorderRadius = Math.min(chipHeight * 0.25, 6); // Subtle rounding
      
      return {
        ...baseStyle,
        height: `${chipHeight}px`,
        padding: `0 ${chipPadding}px`,
        fontSize: `${chipFontSize}px`,
        lineHeight: `${chipHeight}px`,
        fontWeight: '500', // Medium weight for refinement
        borderRadius: `${chipBorderRadius}px`,
        minHeight: '20px',
        transform: 'translateY(0px)', // No offset for natural flow
      };
    } else {
      // Refined fallback styles
      return {
        ...baseStyle,
        height: '22px',
        padding: '0 10px',
        fontSize: '13px',
        lineHeight: '22px',
        fontWeight: '500',
        borderRadius: '5px',
        minHeight: '20px',
        transform: 'translateY(0px)',
      };
    }
  }, [isHovered, isOpen, textMetrics, highlighted]);

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: '0',
    background: 'linear-gradient(135deg, rgba(30, 30, 35, 0.95) 0%, rgba(20, 20, 25, 0.98) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '6px',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    zIndex: 2001,
    marginTop: '6px',
    opacity: isOpen ? 1 : 0,
    visibility: isOpen ? 'visible' : 'hidden',
    transform: isOpen ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.96)',
    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    minWidth: '120px',
    maxWidth: '200px',
    maxHeight: '160px',
    overflowY: 'auto',
    overflowX: 'hidden',
    pointerEvents: isOpen ? 'auto' : 'none'
  };

  // If in custom mode, render a text input instead of the dropdown chip
  if (isCustomMode) {
    const inputStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      background: 'linear-gradient(135deg, rgba(107, 114, 128, 0.12) 0%, rgba(107, 114, 128, 0.18) 100%)',
      border: '1px solid rgba(107, 114, 128, 0.3)',
      borderRadius: textMetrics ? `${Math.min((textMetrics.fontSize * 1.3) * 0.25, 6)}px` : '5px',
      padding: textMetrics ? `0 ${Math.max(textMetrics.fontSize * 0.6, 8)}px` : '0 10px',
      height: textMetrics ? `${Math.max(textMetrics.fontSize * 1.3, 20)}px` : '22px',
      color: 'rgba(255, 255, 255, 0.95)',
      outline: 'none',
      fontFamily: 'inherit',
      fontSize: textMetrics ? `${Math.max(textMetrics.fontSize * 0.9, 12)}px` : '13px',
      fontWeight: '500',
      minWidth: '100px',
      maxWidth: '200px',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      boxShadow: '0 0 0 2px rgba(71, 85, 105, 0.2), 0 2px 8px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      verticalAlign: 'baseline'
    };

    return (
      <input
        ref={inputRef}
        type="text"
        value={customValue}
        onChange={handleCustomInputChange}
        onKeyDown={handleCustomInputKeyDown}
        onBlur={handleCustomInputBlur}
        placeholder="Type custom value..."
        style={inputStyle}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      ref={chipRef}
      style={getChipStyle()}
      onClick={handleChipClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      tabIndex={0}
      role="button"
      aria-label={`Dropdown: ${selected}, options: ${options.join(', ')}`}
      aria-expanded={isOpen}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {selected}
      </span>
      <span 
        style={{ 
          marginLeft: '6px', 
          fontSize: textMetrics ? `${Math.max(textMetrics.fontSize * 0.85, 12)}px` : '12px',
          opacity: highlighted ? 0.9 : (isHovered ? 0.8 : 0.7),
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          lineHeight: '1',
          fontWeight: '500',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '12px'
        }}
      >
        ▼
      </span>
      
      {isOpen && (
        <div style={dropdownStyle}>
          {options.map((option) => (
            <div
              key={option}
              style={{
                padding: '6px 10px',
                fontSize: textMetrics ? `${Math.max(textMetrics.fontSize - 1, 11)}px` : '12px',
                color: option === selected ? 'rgba(226, 232, 240, 1)' : 'rgba(255, 255, 255, 0.85)',
                backgroundColor: option === selected ? 'rgba(71, 85, 105, 0.2)' : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                fontFamily: 'inherit',
                borderRadius: '3px',
                margin: '1px 2px',
                fontWeight: option === selected ? '500' : '400',
                position: 'relative',
                overflow: 'hidden'
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleOptionSelect(option);
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLElement;
                if (option !== selected) {
                  target.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                  target.style.color = 'rgba(255, 255, 255, 0.95)';
                } else {
                  target.style.backgroundColor = 'rgba(71, 85, 105, 0.25)';
                }
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLElement;
                if (option !== selected) {
                  target.style.backgroundColor = 'transparent';
                  target.style.color = 'rgba(255, 255, 255, 0.85)';
                } else {
                  target.style.backgroundColor = 'rgba(71, 85, 105, 0.2)';
                }
              }}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN INLINE DROPDOWN EDITOR COMPONENT
  // 
  // Performance Optimizations Applied:
  // 1. Binary search for click positioning (O(log n) vs O(n))
  // 2. Early termination for close matches 
  // 3. Cached Range objects to avoid repeated DOM creation
  // 4. RequestAnimationFrame for smooth cursor updates
  // 5. Reduced debouncing for better responsiveness
  // 6. Early validation checks to avoid unnecessary work
// ============================================================================

interface InlineDropdownEditorProps {
  /** Initial text content to parse */
  value: string;
  /** Callback when content changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Custom styling */
  style?: React.CSSProperties;
  /** CSS class name */
  className?: string;
  /** Editor ID for debugging */
  editorId?: string | number;

}

const InlineDropdownEditor = React.forwardRef<
  { getFlatText: () => string },
  InlineDropdownEditorProps
>(({
  value,
  onChange,
  placeholder = 'Type here...',
  style,
  className,
  editorId = 'default'
}, ref) => {
  // Main editor state using the EditorState pattern
  const [editorState, setEditorState] = useState<EditorState>(() => ({
    segments: parseTextToSegments(value || ''),
    selection: {
      start: { segmentIndex: 0, offsetInSegment: 0 },
      end: { segmentIndex: 0, offsetInSegment: 0 }
    },
    highlightedChip: null
  }));
  
  const [isFocused, setIsFocused] = useState(false);
  const [cursorCoordinates, setCursorCoordinates] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Derived values from editor state
  const segments = editorState.segments;
  const cursorPosition = editorState.selection.start; // Using collapsed selection as cursor
  
  // Log every single cursor position change
  useEffect(() => {
    // This effect runs to track cursor position changes for debugging if needed
  }, [cursorPosition, segments, isFocused, cursorCoordinates]);
  

  const highlightedChip = editorState.highlightedChip;
  
  // Expose getFlatText method via ref
  React.useImperativeHandle(ref, () => ({
    getFlatText: () => segmentsToFlatText(segments)
  }), [segments]);
  
  // Dispatch function for state changes
  const dispatch = useCallback((action: EditorAction) => {
    setEditorState(prevState => dispatchEdit(prevState, action));
  }, []);
  
  // Helper to update cursor position with automatic chip highlighting
  const setCursorPosition = useCallback((position: SegmentPosition) => {
    setEditorState(prevState => {
      const newSegment = prevState.segments[position.segmentIndex];
      const shouldHighlight = newSegment && newSegment.type === 'dropdown';
      
      return {
        ...prevState,
        selection: {
          start: position,
          end: position
        },
        highlightedChip: shouldHighlight ? newSegment.id : null
      };
    });
  }, []);


  
  // Cache for dynamic styling calculations
  const [textMetrics, setTextMetrics] = useState<{
    lineHeight: number;
    fontSize: number;
    fontFamily: string;
  } | null>(null);
  
  // Update text metrics when container mounts or font changes
  useEffect(() => {
    if (containerRef.current) {
      const computedStyle = window.getComputedStyle(containerRef.current);
      const fontSize = parseFloat(computedStyle.fontSize);
      const lineHeight = parseFloat(computedStyle.lineHeight) || fontSize * 1.5; // fallback to 1.5x if lineHeight is 'normal'
      const fontFamily = computedStyle.fontFamily;
      
      setTextMetrics({ lineHeight, fontSize, fontFamily });
    }
  }, [style?.fontSize, style?.fontFamily, style?.lineHeight]);
  
  // Track the last value sent to parent to prevent redundant onChange calls
  const lastSentValueRef = useRef<string>(value || '');
  
  // Update parent when segments change
  useEffect(() => {
    const newValue = segmentsToText(segments);
    
    // CRITICAL FIX: Only call onChange if the value actually changed
    if (newValue !== lastSentValueRef.current) {
      lastSentValueRef.current = newValue;
      onChange(newValue);
    }
  }, [segments, onChange]);
  
  // Update segments when external value changes
  useEffect(() => {
    const currentValue = segmentsToText(segments);
    
    if (value !== currentValue) {
      setEditorState(prevState => {
        const newSegments = parseTextToSegments(value || '');
        
        // IMPROVED: Smart cursor positioning for external value changes
        let smartCursorPosition = prevState.selection.start;
        
        // Check if the new segments contain dropdowns that weren't there before
        const hasNewDropdowns = newSegments.some(s => s.type === 'dropdown');
        const hadDropdowns = prevState.segments.some(s => s.type === 'dropdown');
        
        if (hasNewDropdowns && !hadDropdowns) {
          // New dropdowns were created - position cursor after the last dropdown
          let lastDropdownIndex = -1;
          for (let i = newSegments.length - 1; i >= 0; i--) {
            if (newSegments[i].type === 'dropdown') {
              lastDropdownIndex = i;
              break;
            }
          }
          
          if (lastDropdownIndex !== -1 && lastDropdownIndex + 1 < newSegments.length) {
            // Position cursor in the text segment after the last dropdown
            smartCursorPosition = { segmentIndex: lastDropdownIndex + 1, offsetInSegment: 0 };
          } else {
            // Position at end of content
            const lastSegmentIndex = Math.max(0, newSegments.length - 1);
            const lastSegment = newSegments[lastSegmentIndex];
            smartCursorPosition = {
              segmentIndex: lastSegmentIndex,
              offsetInSegment: lastSegment?.type === 'text' ? lastSegment.value.length : 0
            };
          }
        } else if (newSegments.length === 0) {
          // Empty content
          smartCursorPosition = { segmentIndex: 0, offsetInSegment: 0 };
        } else {
          // Validate that the preserved cursor position is still valid
          const maxSegmentIndex = Math.max(0, newSegments.length - 1);
          const targetSegment = newSegments[Math.min(smartCursorPosition.segmentIndex, maxSegmentIndex)];
          
          if (targetSegment) {
            const maxOffset = targetSegment.type === 'text' ? targetSegment.value.length : 0;
            smartCursorPosition = {
              segmentIndex: Math.min(smartCursorPosition.segmentIndex, maxSegmentIndex),
              offsetInSegment: Math.min(smartCursorPosition.offsetInSegment, maxOffset)
            };
          }
        }
        
        const result = {
          ...prevState,
          segments: newSegments,
          selection: {
            start: smartCursorPosition,
            end: smartCursorPosition
          }
        };
        
        return result;
      });
    }
  }, [value]); // FIXED: Removed 'segments' from dependency array to prevent infinite loop
  
  const handleFocus = () => {
    setIsFocused(true);
    updateCursorPosition();
  };
  
  const handleBlur = (event: React.FocusEvent) => {
    // Check if focus is moving to a child element (should not blur)
    if (event.relatedTarget && containerRef.current?.contains(event.relatedTarget as Node)) {
      return;
    }
    
    // IMPROVED: Add small delay to prevent premature blur during state updates
    setTimeout(() => {
      // Verify that focus is still lost after state updates settle
      if (document.activeElement !== containerRef.current) {
        setIsFocused(false);
        setCursorCoordinates(null);
      }
    }, 50); // Small delay to allow for state settling
  };
  
  const handleDropdownChange = useCallback((segmentId: string, newSelection: string) => {
    dispatch({
      type: 'CHANGE_DROPDOWN',
      payload: { segmentId, newSelection }
    });
  }, [dispatch]);

  const handleDropdownAddCustomOption = useCallback((segmentId: string, customValue: string) => {
    dispatch({
      type: 'ADD_CUSTOM_OPTION',
      payload: { segmentId, customValue }
    });
  }, [dispatch]);


  
  // Validate and clamp cursor position to valid bounds
  const validateCursorPosition = useCallback((position: SegmentPosition): SegmentPosition => {
    // Handle empty segments array
    if (segments.length === 0) {
      return { segmentIndex: 0, offsetInSegment: 0 };
    }
    
    // Clamp segment index to valid range
    const clampedIndex = Math.max(0, Math.min(position.segmentIndex, segments.length - 1));
    const segment = segments[clampedIndex];
    
    if (!segment) {
      return { segmentIndex: 0, offsetInSegment: 0 };
    }
    
    // Clamp offset based on segment type
    let maxOffset = 0;
    if (segment.type === 'text') {
      maxOffset = segment.value.length;
    } else if (segment.type === 'dropdown') {
      maxOffset = 0; // Dropdowns only allow position 0
    }
    
    const clampedOffset = Math.max(0, Math.min(position.offsetInSegment, maxOffset));
    
    return { segmentIndex: clampedIndex, offsetInSegment: clampedOffset };
  }, [segments]);
  
  // Enhanced cursor position setter with validation
  const setCursorPositionSafe = useCallback((position: SegmentPosition) => {
    const validatedPosition = validateCursorPosition(position);
    setCursorPosition(validatedPosition);
  }, [validateCursorPosition]);
  
  // Debounced click handler to prevent rapid-fire positioning
  const lastClickTimeRef = useRef<number>(0);
  const CLICK_DEBOUNCE_MS = 30;
  
  const handleClickDebounced = useCallback((segmentIndex: number, offset: number = 0) => {
    const now = Date.now();
    if (now - lastClickTimeRef.current < CLICK_DEBOUNCE_MS) return;
    lastClickTimeRef.current = now;
    
    setCursorPositionSafe({ segmentIndex, offsetInSegment: offset });
  }, [setCursorPositionSafe]);
  
  // Insert text at current cursor position
  const handleInsertTextSafe = useCallback((text: string) => {
    if (!text || text.length === 0) return;
    
    const validPosition = validateCursorPosition(cursorPosition);
    const segment = segments[validPosition.segmentIndex];
    
    // Handle empty editor - create first text segment
    if (!segment) {
      const newSegment: TextSegment = {
        id: generateSegmentId(),
        type: 'text',
        value: text
      };
      
      // Check for dropdown patterns in the new text
      const detectionResult = detectAndCreateDropdowns([newSegment]);
      let finalSegments = detectionResult.segments;
      let finalCursorPosition = { segmentIndex: 0, offsetInSegment: text.length };
      
      if (detectionResult.hasChanges) {
        // Find the last dropdown and position cursor after it
        let lastDropdownIndex = -1;
        for (let i = finalSegments.length - 1; i >= 0; i--) {
          if (finalSegments[i].type === 'dropdown') {
            lastDropdownIndex = i;
            break;
          }
        }
        
        if (lastDropdownIndex !== -1) {
          // Text segment after dropdown is guaranteed to exist now
          const afterDropdownIndex = lastDropdownIndex + 1;
          finalCursorPosition = { segmentIndex: afterDropdownIndex, offsetInSegment: 0 };
        } else {
          // No dropdown found, position at end
          const lastSegmentIndex = Math.max(0, finalSegments.length - 1);
          const lastSegment = finalSegments[lastSegmentIndex];
          finalCursorPosition = {
            segmentIndex: lastSegmentIndex,
            offsetInSegment: lastSegment?.type === 'text' ? lastSegment.value.length : 0
          };
        }
      }
      
      setEditorState(prevState => ({
        ...prevState,
        segments: finalSegments,
        selection: {
          start: finalCursorPosition,
          end: finalCursorPosition
        }
      }));
      
      return;
    }
    
    if (segment.type !== 'text') {
      // Create new text segment after current dropdown
      const newSegment: TextSegment = {
        id: generateSegmentId(),
        type: 'text',
        value: text
      };
      
      const newSegments = [...segments];
      newSegments.splice(validPosition.segmentIndex + 1, 0, newSegment);
      
      // Check for dropdown patterns in the new segments
      const detectionResult = detectAndCreateDropdowns(newSegments);
      let finalSegments = detectionResult.segments;
      let finalCursorPosition = { segmentIndex: validPosition.segmentIndex + 1, offsetInSegment: text.length };
      
      if (detectionResult.hasChanges) {
        // Find the last dropdown and position cursor after it
        let lastDropdownIndex = -1;
        for (let i = finalSegments.length - 1; i >= 0; i--) {
          if (finalSegments[i].type === 'dropdown') {
            lastDropdownIndex = i;
            break;
          }
        }
        
        if (lastDropdownIndex !== -1) {
          // Text segment after dropdown is guaranteed to exist now
          const afterDropdownIndex = lastDropdownIndex + 1;
          finalCursorPosition = { segmentIndex: afterDropdownIndex, offsetInSegment: 0 };
        } else {
          // No dropdown found, use original position
          finalCursorPosition = { segmentIndex: validPosition.segmentIndex + 1, offsetInSegment: text.length };
        }
      }
      
      setEditorState(prevState => ({
        ...prevState,
        segments: finalSegments,
        selection: {
          start: finalCursorPosition,
          end: finalCursorPosition
        }
      }));
      
      return;
    }
    
    // Insert text into current text segment
    const newSegments = [...segments];
    const targetSegment = { ...segment } as TextSegment;
    const before = targetSegment.value.substring(0, validPosition.offsetInSegment);
    const after = targetSegment.value.substring(validPosition.offsetInSegment);
    
    targetSegment.value = before + text + after;
    newSegments[validPosition.segmentIndex] = targetSegment;
    
    // Check for dropdown patterns after text insertion
    const detectionResult = detectAndCreateDropdowns(newSegments);
    let finalSegments = detectionResult.segments;
    let finalCursorPosition = { segmentIndex: validPosition.segmentIndex, offsetInSegment: validPosition.offsetInSegment + text.length };
    
    if (detectionResult.hasChanges) {
      // SIMPLIFIED CURSOR POSITIONING: Position cursor after the last dropdown created
      // Find the last dropdown segment in the final segments
      let lastDropdownIndex = -1;
      for (let i = finalSegments.length - 1; i >= 0; i--) {
        if (finalSegments[i].type === 'dropdown') {
          lastDropdownIndex = i;
          break;
        }
      }
      
      if (lastDropdownIndex !== -1) {
        // Position cursor after the last dropdown
        const afterDropdownIndex = lastDropdownIndex + 1;
        
        // Text segment after dropdown is guaranteed to exist now
        finalCursorPosition = { segmentIndex: afterDropdownIndex, offsetInSegment: 0 };
      } else {
        // No dropdown found (shouldn't happen), position at end
        const lastSegmentIndex = Math.max(0, finalSegments.length - 1);
        const lastSegment = finalSegments[lastSegmentIndex];
        finalCursorPosition = {
          segmentIndex: lastSegmentIndex,
          offsetInSegment: lastSegment?.type === 'text' ? lastSegment.value.length : 0
        };
      }
    }
    
    setEditorState(prevState => ({
      ...prevState,
      segments: finalSegments,
      selection: {
        start: finalCursorPosition,
        end: finalCursorPosition
      }
    }));
  }, [segments, cursorPosition, validateCursorPosition]);
  
  // Move cursor to a new position with validation
  const moveCursor = useCallback((newPosition: SegmentPosition, extendSelection: boolean = false) => {
    const validatedPosition = validateCursorPosition(newPosition);
    
    if (extendSelection) {
      // TODO: Implement selection extension for Shift+Arrow keys
      setCursorPosition(validatedPosition);
    } else {
      setCursorPosition(validatedPosition);
    }
  }, [validateCursorPosition, setCursorPosition]);
  
  // Handle backspace key
  const handleBackspaceSafe = useCallback(() => {
    const validPosition = validateCursorPosition(cursorPosition);
    
    // Case 1: Cursor is in the middle of a text segment - delete character before cursor
    if (validPosition.offsetInSegment > 0) {
      const segment = segments[validPosition.segmentIndex];
      if (segment && segment.type === 'text') {
        const newSegments = [...segments];
        const targetSegment = { ...segment } as TextSegment;
        const before = targetSegment.value.substring(0, validPosition.offsetInSegment - 1);
        const after = targetSegment.value.substring(validPosition.offsetInSegment);
        targetSegment.value = before + after;
        newSegments[validPosition.segmentIndex] = targetSegment;
        
        // If segment becomes empty, remove it
        if (targetSegment.value === '') {
          newSegments.splice(validPosition.segmentIndex, 1);
          
          // Position cursor at end of previous segment or beginning of next
          let newCursorPosition: SegmentPosition;
          if (validPosition.segmentIndex > 0) {
            // Position at end of previous segment
            const prevSegment = newSegments[validPosition.segmentIndex - 1];
            if (prevSegment.type === 'text') {
              // Position at end of previous text segment
              newCursorPosition = {
                segmentIndex: validPosition.segmentIndex - 1,
                offsetInSegment: prevSegment.value.length
              };
            } else {
              // Previous segment is a dropdown - position AFTER it (not at its beginning)
              // This allows the next backspace to delete the dropdown
              if (validPosition.segmentIndex < newSegments.length) {
                // There's a segment after the dropdown, position at its beginning
                newCursorPosition = { segmentIndex: validPosition.segmentIndex, offsetInSegment: 0 };
              } else {
                // Dropdown is the last segment, position at a virtual position after it
                // But since we removed virtual positioning, we'll position at the dropdown with offset 0
                // and handle this case specially in the backspace logic
                newCursorPosition = { segmentIndex: validPosition.segmentIndex - 1, offsetInSegment: 0 };
              }
            }
          } else if (newSegments.length > 0) {
            // Position at beginning of next segment (which is now at index 0)
            newCursorPosition = { segmentIndex: 0, offsetInSegment: 0 };
          } else {
            // No segments left
            newCursorPosition = { segmentIndex: 0, offsetInSegment: 0 };
          }
          
          setEditorState(prevState => ({
            ...prevState,
            segments: newSegments,
            selection: {
              start: newCursorPosition,
              end: newCursorPosition
            }
          }));
        } else {
          // Normal character deletion - move cursor back by 1
          const newCursorPosition = { segmentIndex: validPosition.segmentIndex, offsetInSegment: validPosition.offsetInSegment - 1 };
          
          setEditorState(prevState => ({
            ...prevState,
            segments: newSegments,
            selection: {
              start: newCursorPosition,
              end: newCursorPosition
            }
          }));
        }
        
        return;
      }
    }
    
    // Case 2: Cursor is at the beginning of a segment - need to look at previous segment
    if (validPosition.offsetInSegment === 0) {
      const currentSegment = segments[validPosition.segmentIndex];
      
      // Special case: If we're at the beginning of a dropdown segment, delete the dropdown itself
      if (currentSegment && currentSegment.type === 'dropdown') {
        const newSegments = [...segments];
        newSegments.splice(validPosition.segmentIndex, 1);
        
        // Position cursor at end of previous segment or beginning of next
        let newCursorPosition: SegmentPosition;
        if (validPosition.segmentIndex > 0) {
          // Position at end of previous segment
          const prevSegment = newSegments[validPosition.segmentIndex - 1];
          newCursorPosition = {
            segmentIndex: validPosition.segmentIndex - 1,
            offsetInSegment: prevSegment.type === 'text' ? prevSegment.value.length : 0
          };
        } else if (newSegments.length > 0) {
          // Position at beginning of next segment (which is now at index 0)
          newCursorPosition = { segmentIndex: 0, offsetInSegment: 0 };
        } else {
          // No segments left
          newCursorPosition = { segmentIndex: 0, offsetInSegment: 0 };
        }
        
        setEditorState(prevState => ({
          ...prevState,
          segments: newSegments,
          selection: {
            start: newCursorPosition,
            end: newCursorPosition
          }
        }));
        
        return;
      }
      
      // If we're at the very beginning of the editor, nothing to delete
      if (validPosition.segmentIndex === 0) {
        return;
      }
      
      const prevSegment = segments[validPosition.segmentIndex - 1];
      
      if (!prevSegment) {
        return;
      }
      
      if (prevSegment.type === 'dropdown') {
        // Delete the dropdown segment
        const newSegments = [...segments];
        newSegments.splice(validPosition.segmentIndex - 1, 1);
        
        // Position cursor where the dropdown used to be
        let newCursorPosition: SegmentPosition;
        if (validPosition.segmentIndex - 1 > 0) {
          // Position at end of segment before the deleted dropdown
          const segmentBeforeDropdown = newSegments[validPosition.segmentIndex - 2];
          newCursorPosition = {
            segmentIndex: validPosition.segmentIndex - 2,
            offsetInSegment: segmentBeforeDropdown.type === 'text' ? segmentBeforeDropdown.value.length : 0
          };
        } else {
          // Deleted dropdown was first segment, position at beginning of what's now first
          newCursorPosition = { segmentIndex: 0, offsetInSegment: 0 };
        }
        
        setEditorState(prevState => ({
          ...prevState,
          segments: newSegments,
          selection: {
            start: newCursorPosition,
            end: newCursorPosition
          }
        }));
        
        return;
      } else if (prevSegment.type === 'text') {
        if (prevSegment.value.length === 0) {
          // Remove empty text segment
          const newSegments = [...segments];
          newSegments.splice(validPosition.segmentIndex - 1, 1);
          
          // Position cursor at beginning of current segment (which moved down by 1 index)
          const newCursorPosition = { segmentIndex: validPosition.segmentIndex - 1, offsetInSegment: 0 };
          
          setEditorState(prevState => ({
            ...prevState,
            segments: newSegments,
            selection: {
              start: newCursorPosition,
              end: newCursorPosition
            }
          }));
        } else {
          // Delete last character from previous text segment
          const newSegments = [...segments];
          const targetSegment = { ...prevSegment } as TextSegment;
          targetSegment.value = targetSegment.value.slice(0, -1);
          newSegments[validPosition.segmentIndex - 1] = targetSegment;
          
          // Position cursor at end of modified previous segment
          const newCursorPosition = {
            segmentIndex: validPosition.segmentIndex - 1,
            offsetInSegment: targetSegment.value.length
          };
          
          // If previous segment becomes empty after deletion, remove it
          if (targetSegment.value === '') {
            newSegments.splice(validPosition.segmentIndex - 1, 1);
            
            // Adjust cursor position after removal
            const adjustedCursorPosition = { segmentIndex: validPosition.segmentIndex - 1, offsetInSegment: 0 };
            
            setEditorState(prevState => ({
              ...prevState,
              segments: newSegments,
              selection: {
                start: adjustedCursorPosition,
                end: adjustedCursorPosition
              }
            }));
          } else {
            setEditorState(prevState => ({
              ...prevState,
              segments: newSegments,
              selection: {
                start: newCursorPosition,
                end: newCursorPosition
              }
            }));
          }
        }
        
        return;
      }
    }
  }, [segments, cursorPosition, validateCursorPosition]);
  
  // Handle enter key - create new line and position cursor properly
  const handleEnter = useCallback(() => {
    // Use current cursor position directly to avoid validation race conditions
    const currentPosition = cursorPosition;
    const segment = segments[currentPosition.segmentIndex];
    
    if (!segment) {
      return;
    }
    
    if (segment.type !== 'text') {
      // Create new text segment after current dropdown with newline
      const newSegment: TextSegment = {
        id: generateSegmentId(),
        type: 'text',
        value: '\n'
      };
      
      const newSegments = [...segments];
      newSegments.splice(currentPosition.segmentIndex + 1, 0, newSegment);
      
      const newCursorPos = { segmentIndex: currentPosition.segmentIndex + 1, offsetInSegment: 1 };
      
      setEditorState(prevState => ({
        ...prevState,
        segments: newSegments,
        selection: {
          start: newCursorPos,
          end: newCursorPos
        }
      }));
      
      return;
    }
    
    // Insert newline into current text segment and position cursor at start of new line
    const newSegments = [...segments];
    const targetSegment = { ...segment } as TextSegment;
    const safeOffset = Math.max(0, Math.min(currentPosition.offsetInSegment, targetSegment.value.length));
    
    const before = targetSegment.value.substring(0, safeOffset);
    const after = targetSegment.value.substring(safeOffset);
    
    targetSegment.value = before + '\n' + after;
    newSegments[currentPosition.segmentIndex] = targetSegment;
    
    const newCursorPos = { segmentIndex: currentPosition.segmentIndex, offsetInSegment: safeOffset + 1 };
    
    setEditorState(prevState => ({
      ...prevState,
      segments: newSegments,
      selection: {
        start: newCursorPos,
        end: newCursorPos
      }
    }));
  }, [segments, cursorPosition]);

  // Move to beginning of editor
  const moveToBeginning = useCallback((extendSelection: boolean = false) => {
    if (segments.length > 0) {
      moveCursor({ segmentIndex: 0, offsetInSegment: 0 }, extendSelection);
    }
  }, [segments, moveCursor]);

  // Move to end of editor  
  const moveToEnd = useCallback((extendSelection: boolean = false) => {
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      const lastOffset = lastSegment.type === 'text' ? lastSegment.value.length : 0;
      moveCursor({ segmentIndex: segments.length - 1, offsetInSegment: lastOffset }, extendSelection);
    }
  }, [segments, moveCursor]);

    // Note: Arrow key handlers defined after navigateToChip function
  
  // Handle forward delete (Delete key)
  const handleDelete = useCallback(() => {
    const validPosition = validateCursorPosition(cursorPosition);
    const segment = segments[validPosition.segmentIndex];
    
    if (!segment) return;
    
    if (segment.type === 'text') {
      const textSegment = segment as TextSegment;
      
      // If at end of text segment, try to delete next segment if it's a dropdown
      if (validPosition.offsetInSegment >= textSegment.value.length) {
        if (validPosition.segmentIndex < segments.length - 1) {
          const nextSegment = segments[validPosition.segmentIndex + 1];
          if (nextSegment?.type === 'dropdown') {
            // Delete the dropdown segment
            const newSegments = [...segments];
            newSegments.splice(validPosition.segmentIndex + 1, 1);
            setEditorState(prevState => ({
              ...prevState,
              segments: newSegments
            }));
                       }
         }
         return;
       }
       
       // Delete character after cursor
       const newSegments = [...segments];
       const targetSegment = { ...textSegment };
       const before = targetSegment.value.substring(0, validPosition.offsetInSegment);
       const after = targetSegment.value.substring(validPosition.offsetInSegment + 1);
       
       targetSegment.value = before + after;
       newSegments[validPosition.segmentIndex] = targetSegment;
       
       setEditorState(prevState => ({
         ...prevState,
         segments: newSegments
       }));
     } else {
       // In dropdown segment, delete the dropdown
       const newSegments = [...segments];
       newSegments.splice(validPosition.segmentIndex, 1);
       
       // Move cursor to previous position or beginning
       const newIndex = Math.max(0, validPosition.segmentIndex - 1);
       const newSegment = newSegments[newIndex];
       const newOffset = newSegment?.type === 'text' ? newSegment.value.length : 0;
       
       setEditorState(prevState => ({
         ...prevState,
         segments: newSegments,
         selection: {
           start: { segmentIndex: newIndex, offsetInSegment: newOffset },
           end: { segmentIndex: newIndex, offsetInSegment: newOffset }
         }
       }));
    }
  }, [segments, cursorPosition, validateCursorPosition]);


  
  

  // Performance optimization caches
  const fontStyleCacheRef = useRef<string>('');
  const segmentElementsCacheRef = useRef<HTMLElement[]>([]);
  const lastSegmentCountRef = useRef<number>(0);
  const cursorUpdateFrameRef = useRef<number | null>(null);

  // Cache segment DOM elements to avoid repeated querySelectorAll
  const getSegmentElements = useCallback(() => {
    if (!containerRef.current) return [];
    
    // Rebuild cache if segment count changed
    if (segments.length !== lastSegmentCountRef.current) {
      segmentElementsCacheRef.current = Array.from(
        containerRef.current.querySelectorAll('[data-segment-index]')
      ) as HTMLElement[];
      lastSegmentCountRef.current = segments.length;
    }
    
    return segmentElementsCacheRef.current;
  }, [segments.length]);



  // Find cursor position for vertical movement (up/down arrows)
  const findVerticalCursorPosition = useCallback((lineOffset: number): SegmentPosition | null => {
    if (!containerRef.current || !textMetrics) return null;
    
    const segmentElements = getSegmentElements();
    const currentSegmentElement = segmentElements[cursorPosition.segmentIndex];
    if (!currentSegmentElement) return null;
    
    // Get current cursor's X coordinate and Y position
    let currentCursorX = 0;
    let currentY = 0;
    
    const currentSegment = segments[cursorPosition.segmentIndex];
    if (currentSegment?.type === 'text') {
      const textNode = currentSegmentElement.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        try {
          const range = document.createRange();
          const offset = Math.min(cursorPosition.offsetInSegment, textNode.textContent?.length || 0);
          range.setStart(textNode, offset);
          range.setEnd(textNode, offset);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            currentCursorX = rects[0].left;
            currentY = rects[0].top;
          }
        } catch (e) {
          const rect = currentSegmentElement.getBoundingClientRect();
          currentCursorX = rect.left;
          currentY = rect.top;
        }
      }
    } else {
      // For dropdown segments, use center for consistent navigation
      const rect = currentSegmentElement.getBoundingClientRect();
      currentCursorX = rect.left + (rect.width / 2);
      currentY = rect.top;
    }
    
    const targetY = currentY + (lineOffset * textMetrics.lineHeight);
    const lineThreshold = textMetrics.lineHeight * 0.6;
    
    // Find closest position on the target line
    let bestPosition: SegmentPosition | null = null;
    let bestDistance = Infinity;
    
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex];
      const segmentElement = segmentElements[segmentIndex];
      if (!segmentElement || !segment) continue;
      
      if (segment.type === 'text') {
        const textNode = segmentElement.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const text = textNode.textContent || '';
          for (let offset = 0; offset <= text.length; offset++) {
            try {
              const range = document.createRange();
              range.setStart(textNode, offset);
              range.setEnd(textNode, offset);
              const rects = range.getClientRects();
              if (rects.length > 0) {
                const rect = rects[0];
                const yDistance = Math.abs(rect.top - targetY);
                if (yDistance < lineThreshold) {
                  const xDistance = Math.abs(rect.left - currentCursorX);
                  if (bestPosition === null || xDistance < bestDistance) {
                    bestPosition = { segmentIndex, offsetInSegment: offset };
                    bestDistance = xDistance;
                  }
                }
              }
            } catch (e) {
              // Skip invalid ranges
              continue;
            }
          }
        }
      } else if (segment.type === 'dropdown') {
        const rect = segmentElement.getBoundingClientRect();
        const yDistance = Math.abs(rect.top - targetY);
        if (yDistance < lineThreshold) {
          // Prioritize dropdown if cursor is within its horizontal bounds
          let xDistance;
          if (currentCursorX >= rect.left && currentCursorX <= rect.right) {
            xDistance = 0; // Perfect alignment
          } else {
            xDistance = Math.min(Math.abs(rect.left - currentCursorX), Math.abs(rect.right - currentCursorX));
          }
          
          if (bestPosition === null || xDistance < bestDistance) {
            bestPosition = { segmentIndex, offsetInSegment: 0 };
            bestDistance = xDistance;
          }
        }
      }
    }
    
    return bestPosition;
  }, [cursorPosition, segments, getSegmentElements, textMetrics]);

  

   // Arrow key handlers with automatic chip highlighting
   const handleArrowLeft = useCallback((shiftKey: boolean) => {
     const currentPos = cursorPosition;
     
     // Normal left movement
     if (currentPos.offsetInSegment === 0) {
       if (currentPos.segmentIndex > 0) {
         const prevSegment = segments[currentPos.segmentIndex - 1];
         let newOffset = 0;
         
         if (prevSegment.type === 'text') {
           newOffset = prevSegment.value.length;
         } else {
           newOffset = 0;
         }
         
         moveCursor({ segmentIndex: currentPos.segmentIndex - 1, offsetInSegment: newOffset }, shiftKey);
       }
     } else {
       const segment = segments[currentPos.segmentIndex];
       if (segment && segment.type === 'text') {
         moveCursor({ segmentIndex: currentPos.segmentIndex, offsetInSegment: currentPos.offsetInSegment - 1 }, shiftKey);
       }
     }
   }, [cursorPosition, segments, moveCursor]);
   
   const handleArrowRight = useCallback((shiftKey: boolean) => {
     const currentPos = cursorPosition;
     const currentSegment = segments[currentPos.segmentIndex];
     
     if (!currentSegment) return;
     
     let isAtEndOfSegment = false;
     if (currentSegment.type === 'text') {
       isAtEndOfSegment = currentPos.offsetInSegment >= currentSegment.value.length;
     } else {
       isAtEndOfSegment = true;
     }
     
     if (isAtEndOfSegment) {
       if (currentPos.segmentIndex < segments.length - 1) {
         moveCursor({ segmentIndex: currentPos.segmentIndex + 1, offsetInSegment: 0 }, shiftKey);
       }
     } else {
       if (currentSegment.type === 'text') {
         moveCursor({ segmentIndex: currentPos.segmentIndex, offsetInSegment: currentPos.offsetInSegment + 1 }, shiftKey);
       }
     }
   }, [cursorPosition, segments, moveCursor]);

  // Vertical arrow key handlers
  const handleArrowDownLineAware = useCallback((shiftKey: boolean) => {
    const newPosition = findVerticalCursorPosition(1); // 1 = down
    if (newPosition) {
      moveCursor(newPosition, shiftKey);
    }
  }, [findVerticalCursorPosition, moveCursor]);
  
  const handleArrowUpLineAware = useCallback((shiftKey: boolean) => {
    const newPosition = findVerticalCursorPosition(-1); // -1 = up
    if (newPosition) {
      moveCursor(newPosition, shiftKey);
    }
  }, [findVerticalCursorPosition, moveCursor]);

  // Updated keyboard event handler using line-aware arrow functions
  const handleKeyDownLineAware = useCallback((event: React.KeyboardEvent) => {
    // Don't intercept events from custom input fields (let them handle their own typing)
    if ((event.target as HTMLElement).tagName === 'INPUT') {
      return;
    }
    
    // Prevent all default browser behavior for editing
    event.preventDefault();
    
    const key = event.key;
    
    // Handle different types of keys
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Printable character
      // Use DOM focus state instead of React state to avoid async issues
      const isDOMFocused = document.activeElement === containerRef.current;
      if (!isDOMFocused) {
        return;
      }
      
      handleInsertTextSafe(key);
      
      // Ensure focus is retained after typing
      setTimeout(() => {
        if (containerRef.current && !isFocused) {
          containerRef.current.focus();
        }
      }, 0);
    } else if (key === 'Backspace') {
      handleBackspaceSafe();
    } else if (key === 'Delete') {
      handleDelete();
    } else if (key === 'Enter') {
      handleEnter();
    } else if (key === 'ArrowLeft') {
      handleArrowLeft(event.shiftKey);
    } else if (key === 'ArrowRight') {
      handleArrowRight(event.shiftKey);
    } else if (key === 'ArrowUp') {
      handleArrowUpLineAware(event.shiftKey);
    } else if (key === 'ArrowDown') {
      handleArrowDownLineAware(event.shiftKey);
    } else if (key === 'Home') {
      moveToBeginning(event.shiftKey);
    } else if (key === 'End') {
      moveToEnd(event.shiftKey);
    }
  }, [editorId, handleInsertTextSafe, handleBackspaceSafe, handleDelete, handleEnter, handleArrowLeft, handleArrowRight, handleArrowUpLineAware, handleArrowDownLineAware, moveToBeginning, moveToEnd]);

  // Cleanup caches on unmount
  useEffect(() => {
    return () => {
      fontStyleCacheRef.current = '';
      segmentElementsCacheRef.current = [];
      if (cursorUpdateFrameRef.current) {
        cancelAnimationFrame(cursorUpdateFrameRef.current);
      }
    };
  }, []);

    // Calculate absolute cursor position using DOM Range methods (optimized)
  const updateCursorPosition = useCallback(() => {
    // Use DOM focus state instead of React state to avoid async issues
    const isDOMFocused = containerRef.current && document.activeElement === containerRef.current;
    
    if (!containerRef.current || !isDOMFocused) {
      setCursorCoordinates(null);
      return;
    }
    
    // Handle empty editor case - show cursor at reasonable position
    if (segments.length === 0) {
      // Get container's computed padding to position cursor where text would start
      const containerStyle = window.getComputedStyle(containerRef.current);
      const paddingLeft = parseFloat(containerStyle.paddingLeft) || 0;
      const paddingTop = parseFloat(containerStyle.paddingTop) || 0;
      
      // Show cursor at start of editor (where text would begin, accounting for padding)
      const coords = {
        x: paddingLeft, // Start of text area (after padding)
        y: paddingTop + (textMetrics ? textMetrics.lineHeight * 0.5 : 12) // Center of first line (after padding)
      };
      setCursorCoordinates(coords);
      return;
    }

    // Early validation to avoid unnecessary work
    if (cursorPosition.segmentIndex < 0 || cursorPosition.segmentIndex >= segments.length) {
      setCursorCoordinates(null);
      return;
    }
    
    // Step 1: Use cached segment elements instead of querySelectorAll
    const segmentElements = getSegmentElements();
    const targetSegment = segmentElements[cursorPosition.segmentIndex];
    
    if (!targetSegment) {
      setCursorCoordinates(null);
      return;
    }

    const segment = segments[cursorPosition.segmentIndex];
    if (!segment) {
      setCursorCoordinates(null);
      return;
    }

    // Handle dropdown segments (atomic) - position cursor AFTER the dropdown
    if (segment.type === 'dropdown') {
      const segmentRect = targetSegment.getBoundingClientRect();
      const containerRect = containerRef.current!.getBoundingClientRect();
      
      // CRITICAL FIX: Account for container's internal scroll offset
      const coords = { 
        x: segmentRect.right - containerRect.left + containerRef.current!.scrollLeft + 2, // 2px gap after dropdown
        y: segmentRect.top - containerRect.top + containerRef.current!.scrollTop + (segmentRect.height / 2)
      };
      setCursorCoordinates(coords);
      return;
    }

    // Handle text segments
    const textNode = targetSegment.firstChild;
    
    // If no text node exists (empty segment), use span fallback
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      const segmentRect = targetSegment.getBoundingClientRect();
      const containerRect = containerRef.current!.getBoundingClientRect();
      const coords = { 
        x: segmentRect.left - containerRect.left + containerRef.current!.scrollLeft, 
        y: segmentRect.top - containerRect.top + containerRef.current!.scrollTop + (segmentRect.height / 2)
      };
      setCursorCoordinates(coords);
      return;
    }

    // Step 2: Create a Range at the offset
    const range = document.createRange();
    const textContent = textNode.textContent || '';
    const clampedOffset = Math.max(0, Math.min(cursorPosition.offsetInSegment, textContent.length));
    
    try {
      range.setStart(textNode, clampedOffset);
      range.setEnd(textNode, clampedOffset);
      
      // Step 3: Use range.getClientRects() and choose last rect for wrapped lines
      const rects = range.getClientRects();
      
      if (rects.length > 0) {
        // Take the last rect - this handles wrapped lines correctly
        const rect = rects[rects.length - 1];
        
        // Get container bounds to convert from viewport coordinates to container-relative coordinates
        const containerRect = containerRef.current!.getBoundingClientRect();
        
        // CRITICAL FIX: Use Range rect center for accurate line positioning + account for scroll
        const coords = { 
          x: rect.left - containerRect.left + containerRef.current!.scrollLeft, // Convert to container-relative X + scroll offset
          y: rect.top - containerRect.top + containerRef.current!.scrollTop + (rect.height * 0.5) // Use Range rect center + scroll offset
        };
        setCursorCoordinates(coords);
      } else {
        // Fallback: getClientRects() returned empty - this happens when cursor is after newline
        // Check if cursor is positioned right after a newline character
        const charBeforeCursor = clampedOffset > 0 ? textContent[clampedOffset - 1] : null;
        const isAfterNewline = charBeforeCursor === '\n';
        
        if (isAfterNewline) {
          // Position cursor at beginning of new line
          // Find the newline position to calculate the new line's Y coordinate
          try {
            const newlineRange = document.createRange();
            newlineRange.setStart(textNode, clampedOffset - 1);
            newlineRange.setEnd(textNode, clampedOffset - 1);
            const newlineRects = newlineRange.getClientRects();
            
            if (newlineRects.length > 0) {
              const newlineRect = newlineRects[newlineRects.length - 1];
              
              // Get container bounds for coordinate conversion
              const containerRect = containerRef.current!.getBoundingClientRect();
              
              // Find the X position of the first character in the first segment
              // to align the new line cursor with the beginning of the text
              let firstCharX = 8; // Default fallback (container-relative)
              
              const firstSegmentElement = getSegmentElements()[0];
              if (firstSegmentElement && segments[0]?.type === 'text') {
                const firstSegmentRect = firstSegmentElement.getBoundingClientRect();
                firstCharX = firstSegmentRect.left - containerRect.left; // Convert to container-relative
              }
              
              const coords = {
                x: firstCharX + containerRef.current!.scrollLeft, // Align with first character of the editor + scroll offset
                y: newlineRect.top - containerRect.top + containerRef.current!.scrollTop + newlineRect.height + (newlineRect.height / 2) // Next line down + scroll offset
              };
              setCursorCoordinates(coords);
            } else {
              // Fallback to segment positioning
              const containerRect = containerRef.current!.getBoundingClientRect();
              const segmentRect = targetSegment.getBoundingClientRect();
              const coords = { 
                x: segmentRect.left - containerRect.left + containerRef.current!.scrollLeft, 
                y: segmentRect.top - containerRect.top + containerRef.current!.scrollTop + (segmentRect.height / 2)
              };
              setCursorCoordinates(coords);
            }
          } catch (error) {
            const containerRect = containerRef.current!.getBoundingClientRect();
            const segmentRect = targetSegment.getBoundingClientRect();
            const coords = { 
              x: segmentRect.left - containerRect.left + containerRef.current!.scrollLeft, 
              y: segmentRect.top - containerRect.top + containerRef.current!.scrollTop + (segmentRect.height / 2)
            };
            setCursorCoordinates(coords);
          }
        } else {
          // Normal fallback for other cases
          const containerRect = containerRef.current!.getBoundingClientRect();
          const segmentRect = targetSegment.getBoundingClientRect();
          const coords = { 
            x: segmentRect.left - containerRect.left + containerRef.current!.scrollLeft, 
            y: segmentRect.top - containerRect.top + containerRef.current!.scrollTop + (segmentRect.height / 2)
          };
          setCursorCoordinates(coords);
        }
      }
    } catch (error) {
      // Edge case: Range creation failed (offset out of bounds, etc.)
      const containerRect = containerRef.current!.getBoundingClientRect();
      const segmentRect = targetSegment.getBoundingClientRect();
      const coords = { 
        x: segmentRect.left - containerRect.left + containerRef.current!.scrollLeft, 
        y: segmentRect.top - containerRect.top + containerRef.current!.scrollTop + (segmentRect.height / 2)
      };
      setCursorCoordinates(coords);
    }
  }, [cursorPosition, segments, isFocused, getSegmentElements]);

  // Throttled cursor position update using RAF for smooth performance
  const updateCursorPositionThrottled = useCallback(() => {
    // Cancel any pending update
    if (cursorUpdateFrameRef.current) {
      cancelAnimationFrame(cursorUpdateFrameRef.current);
    }
    
    // Schedule update for next frame
    cursorUpdateFrameRef.current = requestAnimationFrame(() => {
      updateCursorPosition();
      cursorUpdateFrameRef.current = null;
    });
  }, [updateCursorPosition]);

  // Update cursor position when position or segments change
  useEffect(() => {
    updateCursorPosition();
  }, [updateCursorPosition, cursorPosition, segments]);

  // Update cursor position on scroll or resize (throttled)
  useEffect(() => {
    let scrollTimeout: number | null = null;
    
    const handleScrollOrResize = () => {
      if (isFocused) {
        // Throttle scroll/resize updates to avoid excessive calls
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }
        scrollTimeout = window.setTimeout(() => {
          updateCursorPositionThrottled();
          scrollTimeout = null;
        }, 16); // ~60fps
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize);
    
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
    };
  }, [isFocused, updateCursorPositionThrottled]);

  const handleTextClick = useCallback((event: React.MouseEvent, segmentIndex: number, segmentValue: string) => {
    const span = event.currentTarget as HTMLSpanElement;
    const rect = span.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    // Get the text node
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      // No text node, position at start
      handleClickDebounced(segmentIndex, 0);
      return;
    }
    
    const textContent = textNode.textContent || '';
    if (textContent.length === 0) {
      // Empty text, position at start
      handleClickDebounced(segmentIndex, 0);
      return;
    }
    
    // Optimized click positioning with reduced Range creation
    let bestOffset = 0;
    let bestDistance = Infinity;
    const DISTANCE_THRESHOLD = 3; // Early termination threshold
    
    // Pre-find newline positions for line boundaries
    const newlinePositions: number[] = [];
    for (let i = 0; i < textContent.length; i++) {
      if (textContent[i] === '\n') {
        newlinePositions.push(i);
      }
    }
    
    // Reusable range for efficiency
    const range = document.createRange();
    
    // Helper function to get position info for an offset (reuses range)
    const getOffsetInfo = (offset: number) => {
      try {
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset);
        
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const testRect = rects[rects.length - 1];
          const testX = testRect.left - rect.left;
          const testY = testRect.top - rect.top;
          const distance = Math.sqrt(Math.pow(testX - clickX, 2) + Math.pow(testY - clickY, 2));
          return { distance, x: testX, y: testY };
        }
      } catch (error) {
        // Range creation failed
      }
      return null;
    };
    
    // For short text (≤50 chars), use simple linear search
    if (textContent.length <= 50) {
      for (let offset = 0; offset <= textContent.length; offset++) {
        const result = getOffsetInfo(offset);
        if (result && result.distance < bestDistance) {
          bestDistance = result.distance;
          bestOffset = offset;
          
          // Early termination for very close matches
          if (bestDistance < DISTANCE_THRESHOLD) {
            break;
          }
        }
      }
    } else {
      // For longer text, use binary search within line boundaries
      
      // First, find which line we're clicking on with sparse sampling
      let targetLineStart = 0;
      let targetLineEnd = textContent.length;
      
      // Sample every 10th character to find the approximate line
      for (let offset = 0; offset <= textContent.length; offset += 10) {
        const info = getOffsetInfo(offset);
        if (info && Math.abs(info.y - clickY) < 15) {
          // Found approximate line, now find exact boundaries
          for (const newlinePos of newlinePositions) {
            if (newlinePos < offset) {
              targetLineStart = newlinePos + 1;
            }
            if (newlinePos >= offset && targetLineEnd === textContent.length) {
              targetLineEnd = newlinePos;
            }
          }
          break;
        }
      }
      
      // Binary search within the line boundaries for efficiency
      let left = targetLineStart;
      let right = targetLineEnd;
      
      while (right - left > 3) { // Switch to linear when range is small
        const mid = Math.floor((left + right) / 2);
        const midInfo = getOffsetInfo(mid);
        
        if (midInfo) {
          if (midInfo.x < clickX) {
            left = mid;
          } else {
            right = mid;
          }
        } else {
          break; // Fallback if range fails
        }
      }
      
      // Linear search in the small remaining range
      for (let offset = left; offset <= right; offset++) {
        const info = getOffsetInfo(offset);
        if (info && info.distance < bestDistance) {
          bestDistance = info.distance;
          bestOffset = offset;
          
          if (bestDistance < DISTANCE_THRESHOLD) {
            break;
          }
        }
      }
    }
    
    moveCursor({ segmentIndex, offsetInSegment: bestOffset });
  }, [moveCursor]);
   
   // Enhanced click handler for dropdown chips with edge case protection
   const handleDropdownClick = useCallback((event: React.MouseEvent, segmentIndex: number) => {
     // Prevent event bubbling to text handlers
     event.stopPropagation();
     
     // Position cursor at the beginning of dropdown (dropdown-aware rule)
     moveCursor({ segmentIndex, offsetInSegment: 0 });
   }, [moveCursor]);
   
   // Enhanced container click handler for empty areas
   const handleContainerClick = useCallback((event: React.MouseEvent) => {
     // Only handle clicks on the container itself, not on child elements
     if (event.target === event.currentTarget) {
       if (segments.length === 0) {
         // Empty editor - position cursor at click location
         const rect = containerRef.current!.getBoundingClientRect();
         const clickX = event.clientX - rect.left;
         const clickY = event.clientY - rect.top;
         
         setCursorCoordinates({ x: clickX, y: clickY });
         
         // Also update the cursor position state to match the click location
         setCursorPosition({ segmentIndex: 0, offsetInSegment: 0 });
         return;
       }
       
       moveToEnd(); // Use consistent cursor movement
     }
   }, [moveToEnd]);
  
  // Cursor style for absolutely positioned overlay
  const getCursorStyle = useCallback((): React.CSSProperties => {
    // Debug cursor style calculation
    
    if (!cursorCoordinates) {
      // No cursor coordinates available
      return { display: 'none' };
    }
    
    // Use lineHeight-based height for better alignment
    const height = textMetrics ? `${textMetrics.lineHeight * 0.8}px` : '16px';
    
    const cursorStyle = {
      position: 'absolute' as const,
      left: `${cursorCoordinates.x}px`,
      top: `${cursorCoordinates.y}px`,
      width: '0.8px',
      height: height,
      backgroundColor: '#a3a3a3',
      animation: 'blink 1s infinite',
      pointerEvents: 'none' as const,
      zIndex: 1000,
      transform: 'translateY(-50%)',
    };
    
    // Cursor style calculated
    return cursorStyle;
  }, [cursorCoordinates, textMetrics]);
  
  const renderSegments = () => {
    if (segments.length === 0 && !isFocused) {
      return (
        <span
          style={{
            color: 'rgba(255, 255, 255, 0.5)',
            fontStyle: 'italic',
            pointerEvents: 'none'
          }}
        >
          {placeholder}
        </span>
      );
    }
    
    return segments.map((segment, index) => {
      if (segment.type === 'text') {
        return (
          <span
            key={segment.id}
            data-segment-index={index}
            style={{ whiteSpace: 'pre-wrap' }}
            onClick={(e) => handleTextClick(e, index, segment.value)}
          >
            {segment.value || '\u200B'}
          </span>
        );
      } else {
        return (
          <span
            key={segment.id}
            data-segment-index={index}
            onClick={(e) => handleDropdownClick(e, index)}
            style={{ display: 'inline-block' }}
          >
            <DropdownChip
              id={segment.id}
              options={segment.options}
              selected={segment.selected}
              onChange={(newSelection) => handleDropdownChange(segment.id, newSelection)}
              onDelete={() => {}}
              onAddCustomOption={(customValue) => handleDropdownAddCustomOption(segment.id, customValue)}
              textMetrics={textMetrics}
              highlighted={highlightedChip === segment.id}
            />
          </span>
        );
      }
    });
  };
  
  const editorStyle: React.CSSProperties = {
    border: isFocused ? '2px solid #a3a3a3' : '2px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    minHeight: '40px',
    fontFamily: 'inherit',
    fontSize: '14px',
    color: 'white',
    cursor: 'text',
    outline: 'none',
    transition: 'border-color 0.2s ease',
    position: 'relative',
    lineHeight: '1.5',
    ...style
  };
  

  
  return (
    <>
      <style>
        {`
          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
        `}
      </style>
    <div
      ref={containerRef}
      style={editorStyle}
      className={className}
      tabIndex={0}
      onFocus={handleFocus}
      onBlur={handleBlur}
        onClick={handleContainerClick}

        onKeyDown={handleKeyDownLineAware}
    >
      {renderSegments()}
        
        {/* Absolutely positioned cursor overlay - hidden when chip is highlighted */}
        {(() => {
          const shouldShowCursor = isFocused && cursorCoordinates && !highlightedChip;
          // Cursor render check
          return shouldShowCursor ? <div style={getCursorStyle()} /> : null;
        })()}
    </div>
    </>
  );
});

export default InlineDropdownEditor; 