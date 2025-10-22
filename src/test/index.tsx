import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import EditorTest from './EditorTest';
import RealtimeTest from './RealtimeTest';

const TestApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'editor' | 'realtime'>('realtime');

  return (
    <div>
      <div style={{ 
        borderBottom: '1px solid #ccc', 
        marginBottom: '20px',
        background: '#f5f5f5',
        padding: '10px'
      }}>
        <button
          onClick={() => setActiveTab('realtime')}
          style={{
            padding: '10px 20px',
            marginRight: '10px',
            background: activeTab === 'realtime' ? '#a3a3a3' : '#ddd',
            color: activeTab === 'realtime' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Real-Time Analysis Test
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          style={{
            padding: '10px 20px',
            background: activeTab === 'editor' ? '#a3a3a3' : '#ddd',
            color: activeTab === 'editor' ? 'white' : 'black',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Editor Test
        </button>
      </div>
      
      {activeTab === 'realtime' && <RealtimeTest />}
      {activeTab === 'editor' && <EditorTest />}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<TestApp />);
} else {
  console.error('Root container not found');
} 