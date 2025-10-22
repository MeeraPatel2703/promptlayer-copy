import Anthropic from '@anthropic-ai/sdk';
import { loadSystemPrompt } from './systemPromptLoader';

export interface ClaudeAIResponse {
  content: string;
  error?: string;
}

export interface ContextItem {
  id: string;
  url: string;
  title: string;
  content: string;
  timestamp: number;
}

// Create Claude client instance
let claudeInstance: Anthropic | null = null;

/**
 * Initialize the Claude AI client with an API key
 */
export const initClaudeAI = (apiKey: string): void => {
  try {
    claudeInstance = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true
    });
  } catch (error) {
    console.error('Error initializing Claude AI client:', error);
  }
};

/**
 * Basic token estimation (roughly 3.5 characters per token for Claude)
 */
const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 3.5);
};

/**
 * Truncate content to fit within token limits
 */
const truncateContent = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) return content;
  
  // Try to cut at sentence boundary
  const truncated = content.substring(0, maxChars);
  const lastSentence = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  
  // Cut at the last sentence or newline if available, otherwise at character limit
  const cutPoint = Math.max(lastSentence, lastNewline);
  return cutPoint > maxChars * 0.8 ? truncated.substring(0, cutPoint + 1) : truncated + '...';
};

/**
 * Format contexts for inclusion in the prompt
 */
const formatContexts = (contexts: ContextItem[]): string => {
  if (!contexts || contexts.length === 0) return '';
  
  const maxContextLength = 2000; // Reserve space for user prompt and system prompt
  const contextSections: string[] = [];
  let totalLength = 0;
  
  // Add contexts in reverse order (newest first) until we hit the limit
  for (const context of contexts.slice().reverse()) {
    const contextSection = `Context from ${context.url} - ${context.title}:\n${context.content}\n\n---\n\n`;
    
    if (totalLength + contextSection.length > maxContextLength) {
      // If this context would exceed the limit, truncate it
      const remainingSpace = maxContextLength - totalLength;
      if (remainingSpace > 200) { // Only add if we have reasonable space left
        const truncatedContent = truncateContent(context.content, remainingSpace - 100);
        const truncatedSection = `Context from ${context.url} - ${context.title}:\n${truncatedContent}\n\n---\n\n`;
        contextSections.push(truncatedSection);
      }
      break;
    }
    
    contextSections.push(contextSection);
    totalLength += contextSection.length;
  }
  
  return contextSections.join('');
};

/**
 * Send text to Claude AI and get a response
 */
export const sendToClaudeAI = async (
  text: string,
  context?: ContextItem[],
  customSystemPrompt?: string
): Promise<ClaudeAIResponse> => {
  if (!claudeInstance) {
    return {
      content: '',
      error: 'Claude AI client is not initialized. Please set your API key in settings.'
    };
  }

  try {
    // Load system prompt from YAML file or use custom one
    const systemPrompt = customSystemPrompt || await loadSystemPrompt();
    
    // Validate system prompt
    if (!systemPrompt.includes('PROMPT OPTIMIZER, not a prompt executor')) {
      console.error('Critical instruction missing from system prompt');
    }

    // Format the user prompt with context if provided
    let userPrompt = `Optimize this prompt: ${text}`;
    if (context && context.length > 0) {
      const formattedContext = formatContexts(context);
      userPrompt = `${formattedContext}${userPrompt}`;
    }
    
    // Token management - using 20k token limit as requested
    const systemTokens = estimateTokens(systemPrompt);
    const userTokens = estimateTokens(userPrompt);
    const totalTokens = systemTokens + userTokens;
    
    // Use 20k token limit, leave 2k for response
    const maxInputTokens = 18000;
    
    if (totalTokens > maxInputTokens) {
      // The system prompt is critical, so truncate user context if needed
      if (systemTokens < maxInputTokens - 1000) { // Ensure we have room for basic user prompt
        const maxUserChars = (maxInputTokens - systemTokens - 500) * 3.5; // Convert back to chars
        const basicPrompt = `Optimize this prompt: ${text}`;
        if (context && context.length > 0 && userPrompt.length > basicPrompt.length) {
          userPrompt = basicPrompt; // Remove context if needed
        }
      }
    }

    const response = await claudeInstance.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    // Extract the content from the response
    let content = '';
    if (response.content && response.content.length > 0) {
      // Claude returns an array of content blocks
      const textContent = response.content.find((block: any) => block.type === 'text');
      if (textContent && 'text' in textContent) {
        content = textContent.text;
      }
    }
    
    // Remove surrounding quotes if they exist
    content = content.trim();
    if ((content.startsWith('"') && content.endsWith('"')) || 
        (content.startsWith("'") && content.endsWith("'"))) {
      content = content.slice(1, -1);
    }
    
    return { content };
  } catch (error) {
    console.error('Error sending to Claude AI:', error);
    return {
      content: '',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

/**
 * Analyze a prompt for real-time suggestions
 * Returns either "NO_CHANGE" or a concise suggestion (7 words max)
 */
export const analyzePromptRealtime = async (
  promptText: string
): Promise<ClaudeAIResponse> => {
  if (!claudeInstance) {
    return {
      content: 'NO_CHANGE',
      error: 'Claude AI client is not initialized. Please set your API key in settings.'
    };
  }

  try {
    // Load the real-time suggestion system prompt
    const realtimeSystemPrompt = `You are a prompt optimization expert. Analyze the user's prompt and suggest ONE specific improvement, or return "NO_CHANGE" if it's already good.

RESPONSE FORMAT:
- If prompt needs improvement: Return exactly ONE suggestion in 7 words or less
- If prompt is already good: Return exactly "NO_CHANGE"

ANALYSIS CRITERIA:
1. Missing context or background information
2. Unclear desired output format
3. Too vague or broad requests
4. Missing examples or constraints
5. Unclear instructions or goals

SUGGESTION EXAMPLES:
- "Add specific output format requirements"
- "Include relevant context or background"  
- "Provide concrete examples"
- "Break into smaller specific tasks"
- "Clarify your main objective"

RULES:
- NEVER explain why - just give the suggestion
- MAXIMUM 7 words per suggestion
- Only ONE suggestion at a time
- Return "NO_CHANGE" for good prompts
- Be specific and actionable`;

    const userPrompt = `Analyze this prompt for improvement opportunities:

${promptText}

Return either "NO_CHANGE" or one 7-word suggestion.`;

    const response = await claudeInstance.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 50, // Very short response expected
      temperature: 0.3, // Lower temperature for consistency
      system: realtimeSystemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    // Extract content
    let content = '';
    if (response.content && response.content.length > 0) {
      const textContent = response.content.find((block: any) => block.type === 'text');
      if (textContent && 'text' in textContent) {
        content = textContent.text.trim();
      }
    }

    // Clean up the response
    if (content) {
      // Remove quotes if present
      if ((content.startsWith('"') && content.endsWith('"')) || 
          (content.startsWith("'") && content.endsWith("'"))) {
        content = content.slice(1, -1);
      }
      
      // Ensure the response is either "NO_CHANGE" or under 7 words
      if (content !== 'NO_CHANGE') {
        const words = content.split(' ').filter(w => w.length > 0);
        if (words.length > 7) {
          content = words.slice(0, 7).join(' ');
        }
      }
    }

    return { content: content || 'NO_CHANGE' };
  } catch (error) {
    // Enhanced error handling for network issues
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      
      if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        console.warn('Real-time analysis: Network error, will retry later');
        return { 
          content: 'NO_CHANGE', 
          error: 'Network error - suggestions temporarily unavailable' 
        };
      }
      
      if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        console.warn('Real-time analysis: Rate limited');
        return { 
          content: 'NO_CHANGE', 
          error: 'Rate limited - please slow down' 
        };
      }
      
      if (errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
        console.error('Real-time analysis: Authentication failed');
        return { 
          content: 'NO_CHANGE', 
          error: 'API key invalid or expired' 
        };
      }
      
      if (errorMessage.includes('timeout')) {
        console.warn('Real-time analysis: Request timed out');
        return { 
          content: 'NO_CHANGE', 
          error: 'Request timed out' 
        };
      }
    }
    
    console.error('Error analyzing prompt in real-time:', error);
    // Return NO_CHANGE on error to avoid disrupting user flow
    return { content: 'NO_CHANGE' };
  }
}; 