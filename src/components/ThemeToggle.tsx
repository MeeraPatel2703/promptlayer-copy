import React, { useState } from 'react';
import { useTheme, Theme } from '../theme/ThemeProvider';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: React.ReactNode;
}

const themeOptions: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    )
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  }
];

const ThemeToggle: React.FC = () => {
  const { theme, resolved, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const currentOption = themeOptions.find(option => option.value === theme) || themeOptions[2];

  const handleOptionClick = (newTheme: Theme) => {
    setTheme(newTheme);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent, newTheme?: Theme) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (newTheme) {
        handleOptionClick(newTheme);
      } else {
        setIsOpen(!isOpen);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="theme-toggle-container">
      <div className="theme-toggle-header">
        <div className="theme-toggle-label">
          <span className="theme-label-text">Appearance</span>
          <span className="theme-status" aria-live="polite">
            ({resolved} active)
          </span>
        </div>
        
        <button
          className="theme-toggle-button"
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          aria-label={`Current theme: ${currentOption.label}. Click to change theme.`}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          type="button"
        >
          <div className="theme-toggle-current">
            <span className="theme-toggle-icon">{currentOption.icon}</span>
            <span className="theme-toggle-text">{currentOption.label}</span>
          </div>
          <svg 
            className={`theme-toggle-chevron ${isOpen ? 'open' : ''}`}
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
          >
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div 
          className="theme-toggle-dropdown"
          role="listbox"
          aria-label="Select theme"
        >
          {themeOptions.map((option) => (
            <button
              key={option.value}
              role="option"
              aria-selected={theme === option.value}
              className={`theme-option ${theme === option.value ? 'selected' : ''}`}
              onClick={() => handleOptionClick(option.value)}
              onKeyDown={(e) => handleKeyDown(e, option.value)}
              tabIndex={0}
              type="button"
            >
              <span className="theme-option-icon">{option.icon}</span>
              <span className="theme-option-label">{option.label}</span>
              {theme === option.value && (
                <svg className="theme-option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20,6 9,17 4,12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThemeToggle;