import React, { useState } from 'react';
import InlineDropdownEditor from '../content/InlineDropdownEditor';

const EditorTest: React.FC = () => {
  const [editorValue, setEditorValue] = useState<string>("I want to [['buy' | 'sell']] some [['stocks' | 'crypto' | 'bonds']] today.");

  const handleEditorChange = (newValue: string) => {
    console.log('Editor value changed:', newValue);
    setEditorValue(newValue);
  };

  const testCases = [
    { name: "Empty", value: "" },
    { name: "Simple Text", value: "Just regular text without any dropdowns" },
    { name: "Single Dropdown", value: "I want to [['buy' | 'sell']] stocks" },
    { name: "Multiple Dropdowns", value: "I [['buy' | 'sell']] [['stocks' | 'crypto']] today" },
    { name: "Text + Dropdown + Text", value: "Before [['option1' | 'option2']] after" },
    { name: "Adjacent Dropdowns", value: "[['first' | 'second']][['third' | 'fourth']]" },
    { name: "Complex Example", value: "I want to [['buy' | 'sell']] some [['stocks' | 'crypto' | 'bonds']] for my [['retirement' | 'savings' | 'emergency']] fund." }
  ];

  return (
    <div style={{
      fontFamily: 'Arial, sans-serif',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '20px',
      backgroundColor: '#1a1a1a',
      color: 'white',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#a3a3a3', marginBottom: '30px' }}>
        🧪 Inline Dropdown Editor - Isolated Testing
      </h1>
      
      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '30px'
      }}>
        <h2 style={{ marginTop: 0, color: '#e5e5e5' }}>Main Test Editor</h2>
        <p style={{ color: '#a3a3a3', marginBottom: '20px' }}>
          This is the primary editor for testing all functionality. Current value updates in real-time.
        </p>
        
        <InlineDropdownEditor
          value={editorValue}
          onChange={handleEditorChange}
          placeholder="Type here or load a test case..."
          style={{
            marginBottom: '20px'
          }}
          editorId="main-test"
        />
        
        <div style={{
          backgroundColor: '#3a3a3a',
          padding: '15px',
          borderRadius: '6px',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e5e5e5'
        }}>
          <strong>Current Value:</strong><br />
          {editorValue || '(empty)'}
        </div>
      </div>

      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '30px'
      }}>
        <h2 style={{ marginTop: 0, color: '#e5e5e5' }}>Test Cases</h2>
        <p style={{ color: '#a3a3a3', marginBottom: '20px' }}>
          Click any test case to load it into the main editor above.
        </p>
        
        <div style={{
          display: 'grid',
          gap: '10px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))'
        }}>
          {testCases.map((testCase, index) => (
            <button
              key={index}
              onClick={() => setEditorValue(testCase.value)}
              style={{
                backgroundColor: '#4a4a4a',
                border: '1px solid #5a5a5a',
                borderRadius: '6px',
                padding: '12px',
                color: 'white',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#5a5a5a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#4a4a4a';
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                {testCase.name}
              </div>
              <div style={{ 
                fontSize: '12px', 
                color: '#a3a3a3',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {testCase.value || '(empty)'}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px'
      }}>
        <h2 style={{ marginTop: 0, color: '#e5e5e5' }}>Testing Instructions</h2>
        <div style={{ color: '#a3a3a3', lineHeight: '1.6' }}>
          <h3 style={{ color: '#e5e5e5' }}>Phase 1 & 2 Testing Checklist:</h3>
          <ol>
            <li><strong>Basic Rendering:</strong> Verify dropdowns render as interactive chips</li>
            <li><strong>Dropdown Interaction:</strong> Click dropdowns to open/close, select options</li>
            <li><strong>Cursor Positioning:</strong> Check if cursor appears and blinks correctly</li>
            <li><strong>Text Parsing:</strong> Load different test cases and verify parsing</li>
            <li><strong>State Management:</strong> Verify value updates propagate correctly</li>
          </ol>
          
          <h3 style={{ color: '#e5e5e5' }}>What to Report Back:</h3>
          <ul>
            <li>✅ What works correctly</li>
            <li>❌ What doesn't work or behaves unexpectedly</li>
            <li>🐛 Specific bugs with steps to reproduce</li>
            <li>💡 Any UX issues or improvements needed</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default EditorTest; 