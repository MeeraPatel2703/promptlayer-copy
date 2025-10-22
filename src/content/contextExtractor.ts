// Context extraction utility for PromptLayer with Readability-inspired algorithm
export interface ExtractedContent {
  title: string;
  content: string;
  url: string;
}

interface ContentBlock {
  element: Element;
  text: string;
  score: number;
  wordCount: number;
  linkDensity: number;
  tagName: string;
}

/**
 * Get selected text from the page
 */
const getSelectedText = (): string => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return '';
  }
  
  const selectedText = selection.toString().trim();
  return selectedText;
};

/**
 * Extracts readable text content using Readability-inspired algorithm
 * Scores content blocks and extracts only the highest quality content
 * Prioritizes user-selected text if any exists
 */
export const extractPageContent = (): ExtractedContent => {
  const title = document.title || 'Untitled Page';
  const url = window.location.href;
  
  // First, check if user has selected text
  const selectedText = getSelectedText();
  if (selectedText && selectedText.length > 10) {
    return { 
      title, 
      content: selectedText.slice(0, 2000), // Limit selection length too
      url 
    };
  }
  
  try {
    // If no selection, try advanced extraction
    const content = extractWithReadabilityAlgorithm();
    if (content && content.length > 100) {
      return {
        title,
        content: content.slice(0, 2000), // Optimized for LLM tokens
        url
      };
    }
  } catch (error) {
    console.warn('Advanced extraction failed, falling back to basic:', error);
  }
  
  // Fallback to basic extraction
  return extractBasicContent(title, url);
};

/**
 * Advanced Readability-inspired content extraction
 */
const extractWithReadabilityAlgorithm = (): string => {
  // Step 1: Clean up the DOM by removing unwanted elements
  const cleanDocument = prepareDocument();
  
  // Step 2: Find and score all potential content blocks
  const contentBlocks = findAndScoreContentBlocks(cleanDocument);
  
  // Step 3: Filter blocks with poor scores
  const goodBlocks = contentBlocks.filter(block => block.score >= 0);
  
  if (goodBlocks.length === 0) {
    throw new Error('No good content blocks found');
  }
  
  // Step 4: Find the best continuous content area
  const bestContentArea = findBestContentArea(goodBlocks);
  
  // Step 5: Extract and clean the final content
  return extractFinalContent(bestContentArea);
};

/**
 * Prepare document by removing unwanted elements and normalizing
 */
const prepareDocument = (): Document => {
  const doc = document.cloneNode(true) as Document;
  
  // Remove unwanted elements that add noise
  const unwantedSelectors = [
    'script', 'style', 'noscript', 'iframe', 'embed', 'object',
    'nav', 'header', 'footer', 'aside',
    '.navigation', '.nav', '.menu', '.sidebar',
    '.ad', '.ads', '.advertisement', '.banner',
    '.social', '.share', '.sharing', '.comments', '.comment',
    '.popup', '.modal', '.overlay',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.cookie', '.newsletter', '.subscription'
  ];
  
  unwantedSelectors.forEach(selector => {
    const elements = doc.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  return doc;
};

/**
 * Find and score potential content blocks
 */
const findAndScoreContentBlocks = (doc: Document): ContentBlock[] => {
  const contentTags = ['p', 'div', 'article', 'section', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const blocks: ContentBlock[] = [];
  
  contentTags.forEach(tagName => {
    const elements = doc.querySelectorAll(tagName);
    elements.forEach(element => {
      const text = getElementText(element);
      if (text.length < 25) return; // Skip very short blocks
      
      const wordCount = countWords(text);
      if (wordCount < 3) return; // Skip blocks with too few words
      
      const linkDensity = calculateLinkDensity(element);
      const score = calculateContentScore(element, text, wordCount, linkDensity);
      
      blocks.push({
        element,
        text,
        score,
        wordCount,
        linkDensity,
        tagName: tagName.toLowerCase()
      });
    });
  });
  
  return blocks.sort((a, b) => b.score - a.score);
};

/**
 * Calculate content score using Readability-inspired heuristics
 */
const calculateContentScore = (element: Element, text: string, wordCount: number, linkDensity: number): number => {
  let score = 0;
  
  // Check for UI noise and navigation gibberish first
  const noiseScore = calculateNoiseScore(text);
  if (noiseScore > 15) {
    return -30; // Penalty for obvious UI noise (reduced from -50)
  }
  
  // Base score from word count (more words = better, but with diminishing returns)
  score += Math.min(wordCount / 5, 50);
  
  // Penalty for high link density (likely navigation or ads)
  if (linkDensity > 0.5) {
    score -= 25;
  } else if (linkDensity > 0.25) {
    score -= 10;
  }
  
  // Bonus for semantic HTML tags
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'article') score += 25;
  else if (tagName === 'main') score += 20;
  else if (tagName === 'section') score += 10;
  else if (tagName === 'p') score += 5;
  else if (['h1', 'h2', 'h3'].includes(tagName)) score += 3;
  
  // Bonus for content-indicating class names and IDs
  const className = (element.className || '').toLowerCase();
  const id = (element.id || '').toLowerCase();
  const identifiers = className + ' ' + id;
  
  if (identifiers.includes('content') || identifiers.includes('article') || identifiers.includes('post')) {
    score += 15;
  }
  if (identifiers.includes('main')) score += 10;
  
  // Heavy penalty for UI-indicating class names
  if (identifiers.includes('sidebar') || identifiers.includes('comment') || 
      identifiers.includes('ad') || identifiers.includes('widget') ||
      identifiers.includes('nav') || identifiers.includes('menu') ||
      identifiers.includes('breadcrumb') || identifiers.includes('outline') ||
      identifiers.includes('tabs') || identifiers.includes('toolbar')) {
    score -= 25;
  }
  
  // Text quality indicators
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length > 3) score += 5;
  
  // Penalty for very short or very long paragraphs (likely not main content)
  if (wordCount < 10) score -= 10;
  if (wordCount > 500) score -= 5;
  
  // Bonus for appropriate text patterns
  const commaCount = (text.match(/,/g) || []).length;
  if (commaCount > 2 && commaCount < wordCount / 10) score += 3;
  
  // Apply noise penalty to final score
  score -= noiseScore;
  
  return score;
};

/**
 * Calculate noise score for UI elements and navigation gibberish
 */
const calculateNoiseScore = (text: string): number => {
  let noiseScore = 0;
  const lowerText = text.toLowerCase();
  
  // Detect repeated number sequences (like pagination: 1234567891011121314...)
  const numberSequences = text.match(/\d{15,}/g); // 15+ consecutive digits (more specific)
  if (numberSequences) {
    noiseScore += numberSequences.length * 8;
  }
  
  // Detect common UI phrases
  const uiPhrases = [
    'drag image to reposition', 'document tabs', 'tab ', 'outline',
    'created these notes', 'can contain errors', 'should be double-checked',
    'how gemini takes notes', 'headings that you add', 'will appear here',
    'open in app', 'sign up', 'sign in', 'menu', 'toggle navigation',
    'skip to content', 'accessibility', 'screen reader'
  ];
  
  uiPhrases.forEach(phrase => {
    if (lowerText.includes(phrase)) {
      noiseScore += 2; // Reduced penalty for UI phrases
    }
  });
  
  // Detect breadcrumb-like patterns (short words separated by special chars)
  const breadcrumbPattern = /[\>\|\/\-\·]\s*\w{1,8}\s*[\>\|\/\-\·]/g;
  const breadcrumbs = text.match(breadcrumbPattern);
  if (breadcrumbs && breadcrumbs.length > 2) {
    noiseScore += 4;
  }
  
  // Detect very high density of numbers compared to text
  const numbers = text.match(/\d/g) || [];
  const letters = text.match(/[a-zA-Z]/g) || [];
  if (numbers.length > letters.length * 2 && text.length > 100) {
    noiseScore += 4; // Reduced penalty, more specific criteria
  }
  
  // Detect excessive short words (likely navigation)
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const shortWords = words.filter(w => w.length <= 2);
  if (shortWords.length > words.length * 0.8 && words.length > 15) {
    noiseScore += 3; // Less penalty, more specific criteria
  }
  
  // Detect lack of sentence structure (no periods, questions, exclamations)
  const sentences = text.match(/[.!?]+/g);
  if (!sentences && text.length > 100) {
    noiseScore += 4;
  }
  
  return noiseScore;
};

/**
 * Calculate link density (ratio of link text to total text)
 */
const calculateLinkDensity = (element: Element): number => {
  const totalText = getElementText(element);
  const links = element.querySelectorAll('a');
  
  let linkText = '';
  links.forEach(link => {
    linkText += getElementText(link) + ' ';
  });
  
  if (totalText.length === 0) return 1;
  return linkText.length / totalText.length;
};

/**
 * Find the best continuous content area from scored blocks
 */
const findBestContentArea = (blocks: ContentBlock[]): ContentBlock[] => {
  if (blocks.length === 0) return [];
  
  // Take top scoring blocks that are likely to be main content
  const topBlocks = blocks
    .filter(block => block.score > 0)
    .slice(0, 10); // Limit to top 10 blocks
  
  // If we have article or main tags with good scores, prioritize them
  const semanticBlocks = topBlocks.filter(block => 
    ['article', 'main', 'section'].includes(block.tagName) && block.score > 15
  );
  
  if (semanticBlocks.length > 0) {
    return semanticBlocks.slice(0, 3); // Take top 3 semantic blocks
  }
  
  // Otherwise, take the highest scoring paragraph-like content
  return topBlocks
    .filter(block => ['p', 'div'].includes(block.tagName))
    .slice(0, 5); // Take top 5 paragraph blocks
};

/**
 * Extract and clean final content from selected blocks
 */
const extractFinalContent = (blocks: ContentBlock[]): string => {
  if (blocks.length === 0) return '';
  
  let content = '';
  let wordCount = 0;
  const maxWords = 300; // Target ~300 words for optimal LLM usage
  
  // Sort blocks by their DOM order (not score) for natural reading flow
  const sortedBlocks = blocks.sort((a, b) => {
    const position = a.element.compareDocumentPosition(b.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  
  for (const block of sortedBlocks) {
    if (wordCount >= maxWords) break;
    
    const blockText = cleanText(block.text);
    const blockWords = countWords(blockText);
    
    // Additional noise check for individual blocks
    const blockNoiseScore = calculateNoiseScore(blockText);
    if (blockNoiseScore > 8) {
      continue; // Skip very noisy blocks (raised threshold)
    }
    
    if (blockWords > 5) { // Skip very short blocks
      content += blockText + '\n\n';
      wordCount += blockWords;
    }
  }
  
  // Final noise cleanup on the complete content
  return removeUIGibberish(content.trim());
};

/**
 * Get clean text content from an element
 */
const getElementText = (element: Element): string => {
  return element.textContent?.trim() || '';
};

/**
 * Count words in text (handles multiple languages better than split by space)
 */
const countWords = (text: string): number => {
  // Remove extra whitespace and count non-empty segments
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
};

/**
 * Clean and normalize text
 */
const cleanText = (text: string): string => {
  return text
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/\n\s*\n\s*\n/g, '\n\n')  // Remove excessive line breaks
    .trim();
};

/**
 * Remove UI gibberish and navigation noise from final content
 */
const removeUIGibberish = (text: string): string => {
  let cleaned = text;
  
  // Remove very long sequences of repeated numbers (pagination)
  cleaned = cleaned.replace(/\d{20,}/g, ''); // Only remove very long sequences
  
  // Remove common UI phrases at the beginning
  const uiPhrasesToRemove = [
    /^[\d\s]+(?:Gemini created these notes|created these notes)/i,
    /^[\d\s]+(?:They can contain errors so should be double-checked)/i,
    /^[\d\s]+(?:How Gemini takes notes)/i,
    /^[\d\s]+(?:Drag image to reposition)/i,
    /^[\d\s]+(?:OutlineOutline|Outline)/i,
    /^[\d\s]+(?:Document tabs Tab \d+)/i,
    /^[\d\s]+(?:Headings that you add to the document will appear here)/i,
    /^[\d\s]+(?:Toggle navigation|Menu|Skip to content)/i
  ];
  
  uiPhrasesToRemove.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove lines that are overwhelmingly numbers and spaces
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter(line => {
    const numbers = (line.match(/\d/g) || []).length;
    const letters = (line.match(/[a-zA-Z]/g) || []).length;
    const totalChars = line.replace(/\s/g, '').length;
    
    // Keep lines unless they're mostly numbers AND long enough to matter
    return totalChars < 20 || letters > numbers * 0.3; // More lenient filtering
  });
  
  cleaned = filteredLines.join('\n');
  
  // Remove standalone UI words at the beginning
  cleaned = cleaned.replace(/^(?:Outline|Menu|Tab|Navigation|Breadcrumb|Home)\s*\n*/i, '');
  
  // Clean up extra whitespace
  cleaned = cleaned
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+/, '')
    .trim();
  
  return cleaned;
};

/**
 * Basic fallback extraction for when advanced algorithm fails
 */
const extractBasicContent = (title: string, url: string): ExtractedContent => {
  // Try semantic elements first
  const semanticSelectors = ['main', 'article', '[role="main"]'];
  
  for (const selector of semanticSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent && element.textContent.trim().length > 100) {
      return {
        title,
        content: cleanText(element.textContent).slice(0, 2000),
        url
      };
    }
  }
  
  // Final fallback to body content with basic cleaning
  const bodyText = document.body.textContent || 'No content found';
  return {
    title,
    content: cleanText(bodyText).slice(0, 2000),
    url
  };
};

/**
 * Simple fallback extraction using just document.body.textContent
 */
export const extractSimpleContent = (): ExtractedContent => {
  return {
    title: document.title || 'Untitled Page',
    content: document.body.textContent?.slice(0, 2000) || 'No content found',
    url: window.location.href
  };
}; 