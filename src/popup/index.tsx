import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './Popup';
import { ThemeProvider, initializeTheme } from '../theme/ThemeProvider';
import ErrorBoundary from '../components/ErrorBoundary';
import './styles.css';

// Initialize theme before React mounts to prevent FOUC
initializeTheme();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Failed to find the root element');
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <Popup />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
); 