import React, { useState, useEffect } from 'react';
import { analyzePromptRealtime, initClaudeAI } from '../services/claude';
import { getApiKey } from '../services/storage';

const RealtimeTest: React.FC = () => {
  const [testPrompt, setTestPrompt] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

  // Initialize Claude on component mount
  useEffect(() => {
    const initializeClaude = async () => {
      try {
        const apiKey = await getApiKey();
        if (apiKey) {
          initClaudeAI(apiKey);
          setIsInitialized(true);
        } else {
          setError('No API key found. Please set your Claude API key in the extension popup first.');
        }
      } catch (err) {
        setError('Failed to load API key from storage.');
      }
    };

    initializeClaude();
  }, []);

  // Test prompts - some good, some that need improvement
  const testPrompts = [
    "Write me something", // Should suggest improvement
    "Write me a detailed blog post about sustainable energy solutions, focusing on solar and wind power, including current market trends, cost analysis, and implementation challenges for residential users", // Should be NO_CHANGE or suggest format
    "Help me", // Should suggest improvement
    "Create a comprehensive marketing strategy for a new eco-friendly product launch targeting millennials, including social media campaigns, influencer partnerships, budget allocation of $50k, timeline of 6 months, and specific KPIs for measuring success", // Should be NO_CHANGE (good prompt)
    "", // Should be NO_CHANGE (too short)
    "hi"  // Should be NO_CHANGE (too short)
  ];

  const handleAnalyze = async () => {
    if (!testPrompt.trim()) return;
    
    setIsLoading(true);
    setError('');
    setResult('');

    try {
      const response = await analyzePromptRealtime(testPrompt);
      
      if (response.error) {
        setError(response.error);
      } else {
        setResult(response.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const runTestPrompt = (prompt: string) => {
    setTestPrompt(prompt);
    setResult('');
    setError('');
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>Real-Time Claude Analysis Test</h2>
      
      {!isInitialized && !error && (
        <div style={{ 
          background: '#f5f5f5', 
          border: '1px solid #e5e5e5', 
          padding: '10px', 
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          Loading Claude API client...
        </div>
      )}
      
      {isInitialized && (
        <div style={{ 
          background: '#f5f5f5', 
          border: '1px solid #e5e5e5', 
          padding: '10px', 
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          ✅ Claude API client initialized successfully
        </div>
      )}
      
      <div style={{ marginBottom: '20px' }}>
        <h3>Quick Tests:</h3>
        {testPrompts.map((prompt, index) => (
          <button
            key={index}
            onClick={() => runTestPrompt(prompt)}
            style={{
              margin: '5px',
              padding: '8px 12px',
              background: '#a3a3a3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Test {index + 1}: "{prompt.substring(0, 20)}{prompt.length > 20 ? '...' : ''}"
          </button>
        ))}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Custom Test:</h3>
        <textarea
          value={testPrompt}
          onChange={(e) => setTestPrompt(e.target.value)}
          placeholder="Enter a prompt to analyze..."
          style={{
            width: '100%',
            height: '100px',
            padding: '10px',
            fontSize: '14px',
            fontFamily: 'monospace'
          }}
        />
        <br />
        <button
          onClick={handleAnalyze}
          disabled={isLoading || !testPrompt.trim() || !isInitialized}
          style={{
            marginTop: '10px',
            padding: '10px 20px',
            background: (isLoading || !isInitialized) ? '#666' : '#a3a3a3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: (isLoading || !isInitialized) ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? 'Analyzing...' : !isInitialized ? 'Initializing...' : 'Analyze Prompt'}
        </button>
      </div>

      {result && (
        <div style={{
          background: '#f5f5f5',
          border: '1px solid #a3a3a3',
          padding: '15px',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          <h4>Claude Response:</h4>
          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
            "{result}"
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Word count: {result.split(' ').length} | Characters: {result.length}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          background: '#f5f5f5',
          border: '1px solid #a3a3a3',
          padding: '15px',
          borderRadius: '4px'
        }}>
          <h4>Error:</h4>
          <div style={{ color: '#a3a3a3' }}>{error}</div>
        </div>
      )}

      <div style={{ marginTop: '30px', fontSize: '12px', color: '#666' }}>
        <h4>Expected Results:</h4>
        <ul>
          <li>Short/vague prompts → Should get improvement suggestions (≤7 words)</li>
          <li>Good detailed prompts → Should get "NO_CHANGE"</li>
          <li>Very short prompts → Should get "NO_CHANGE" (too short to analyze)</li>
          <li>All suggestions should be actionable and specific</li>
        </ul>
      </div>
    </div>
  );
};

export default RealtimeTest; 