import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

interface ThemeContextType {
  theme: Theme;
  resolved: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize theme from localStorage or default to system
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('ui.theme') as Theme;
        return stored || 'system';
      }
    } catch (error) {
      // Handle localStorage access errors gracefully
    }
    return 'system';
  });

  // Track system preference
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch (error) {
      // Handle matchMedia errors gracefully
    }
    return true; // Default to dark for extension
  });

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        setSystemDark(e.matches);
      };

      // Modern browsers
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      } 
      // Legacy browsers
      else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
      }
    } catch (error) {
      // Handle matchMedia errors gracefully
    }
  }, []);

  // Apply theme to document and persist to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const root = document.documentElement;
      const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
      
      // Apply theme class
      root.classList.toggle('dark', resolvedTheme === 'dark');
      
      // Persist to localStorage
      localStorage.setItem('ui.theme', theme);
    } catch (error) {
      // Handle DOM or localStorage errors gracefully
    }
  }, [theme, systemDark]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const contextValue = useMemo<ThemeContextType>(() => ({
    theme,
    resolved: theme === 'system' ? (systemDark ? 'dark' : 'light') : theme,
    setTheme,
  }), [theme, systemDark]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Utility function to initialize theme before React mounts (FOUC prevention)
export const initializeTheme = (): void => {
  try {
    if (typeof window === 'undefined') return;
    
    const key = 'ui.theme';
    const saved = localStorage.getItem(key) as Theme | null;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const resolvedTheme = saved === 'dark' || saved === 'light' 
      ? saved 
      : (systemDark ? 'dark' : 'light');
      
    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (error) {
    // Fallback to dark theme for extension context
    document.documentElement.classList.add('dark');
  }
};