import yaml from 'js-yaml';

interface SystemPromptConfig {
  system_prompt?: string; // Direct system prompt field
  critical_instruction?: string; // Critical instruction that goes at the very beginning
  role?: string;
  description?: string;
  output_constraints?: string[];
  rewriting_goals?: (string | object)[];
  advanced_techniques?: {
    [key: string]: any; // Flexible structure for nested techniques
  };
  dropdown_fill_in_the_blank_support?: {
    purpose?: string;
    formatting?: {
      syntax?: string;
      default_behavior?: string[];
      constraints?: string[];
      usage_conditions?: (string | object)[];
    };
    examples?: {
      high_certainty?: {
        user_input?: string;
        optimized_prompt?: string;
      };
      low_certainty?: {
        user_input?: string;
        optimized_prompt?: string;
      };
    };
  };
  processing_algorithm?: string; // Replaces pseudocode_logic
  output_standards?: string[];
  final_instruction?: string;
}

/**
 * Helper function to format mixed content (strings and objects) as readable text
 */
const formatMixedContent = (items: (string | object)[], indent = ''): string => {
  let result = '';
  items.forEach(item => {
    if (typeof item === 'string') {
      result += `${indent}• ${item}\n`;
    } else if (typeof item === 'object' && item !== null) {
      // Handle nested objects/arrays
      Object.entries(item).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          result += `${indent}• ${key.replace(/_/g, ' ')}:\n`;
          value.forEach(subItem => {
            if (typeof subItem === 'string') {
              result += `${indent}  - ${subItem}\n`;
            } else if (typeof subItem === 'object' && subItem !== null) {
              Object.entries(subItem).forEach(([subKey, subValue]) => {
                result += `${indent}  - ${subKey.replace(/_/g, ' ')}: ${subValue}\n`;
              });
            }
          });
        } else {
          result += `${indent}• ${key.replace(/_/g, ' ')}: ${value}\n`;
        }
      });
    }
  });
  return result;
};

/**
 * Helper function to format advanced techniques nested structure
 */
const formatAdvancedTechniques = (techniques: { [key: string]: any }): string => {
  let result = '';
  
  Object.entries(techniques).forEach(([sectionKey, sectionValue]) => {
    result += `${sectionKey.replace(/_/g, ' ')}:\n`;
    
    if (Array.isArray(sectionValue)) {
      sectionValue.forEach(item => {
        result += `  - ${item}\n`;
      });
    } else if (typeof sectionValue === 'object' && sectionValue !== null) {
      Object.entries(sectionValue).forEach(([subKey, subValue]) => {
        if (Array.isArray(subValue)) {
          result += `  ${subKey.replace(/_/g, ' ')}:\n`;
          subValue.forEach(item => {
            result += `    - ${item}\n`;
          });
        } else if (typeof subValue === 'object' && subValue !== null) {
          result += `  ${subKey.replace(/_/g, ' ')}:\n`;
          Object.entries(subValue).forEach(([subSubKey, subSubValue]) => {
            if (Array.isArray(subSubValue)) {
              result += `    ${subSubKey.replace(/_/g, ' ')}:\n`;
              subSubValue.forEach(item => {
                result += `      - ${item}\n`;
              });
            } else {
              result += `    ${subSubKey.replace(/_/g, ' ')}: ${subSubValue}\n`;
            }
          });
        } else {
          result += `  ${subKey.replace(/_/g, ' ')}: ${subValue}\n`;
        }
      });
    } else {
      result += `  ${sectionValue}\n`;
    }
    result += '\n';
  });
  
  return result.trim();
};

// Cache variables
let cachedSystemPrompt: string | null = null;
let cachedTimestamp: number = 0;

/**
 * Loads and parses the system prompt from the YAML configuration file
 */
export const loadSystemPrompt = async (): Promise<string> => {
  const now = Date.now();
  const cacheExpired = now - cachedTimestamp > 5 * 60 * 1000; // 5 minutes

  // Return cached prompt if available and not expired
  if (cachedSystemPrompt && !cacheExpired) {
    return cachedSystemPrompt;
  }

  try {
    // Fetch the YAML file from the extension's directory with cache busting
    const response = await fetch(chrome.runtime.getURL('system-prompt.yaml'), {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch system-prompt.yaml: ${response.status}`);
    }

    const yamlContent = await response.text();
    
    // Parse the YAML content
    const config = yaml.load(yamlContent) as SystemPromptConfig;
    
    let systemPrompt = '';

    // Check if there's a direct system_prompt field first
    if (config.system_prompt) {
      systemPrompt = config.system_prompt.trim();
    } else {
      // Build the final system prompt by concatenating the specified sections
      const parts: string[] = [];

      // Add critical instruction first if present
      if (config.critical_instruction) {
        parts.push(config.critical_instruction);
      }

      // Add role if present
      if (config.role) {
        parts.push(`Role: ${config.role}`);
      }

      // Add description
      if (config.description) {
        parts.push(config.description.trim());
      }

      // Add output constraints as bullet points
      if (config.output_constraints && config.output_constraints.length > 0) {
        let constraintsSection = 'Output Constraints:\n';
        config.output_constraints.forEach(constraint => {
          constraintsSection += `• ${constraint}\n`;
        });
        parts.push(constraintsSection.trim());
      }

      // Add rewriting goals with mixed content support
      if (config.rewriting_goals && config.rewriting_goals.length > 0) {
        let goalsSection = 'Rewriting Goals:\n';
        goalsSection += formatMixedContent(config.rewriting_goals);
        parts.push(goalsSection.trim());
      }

      // Add advanced techniques section
      if (config.advanced_techniques) {
        let techniquesSection = '**Advanced Techniques**\n\n';
        techniquesSection += formatAdvancedTechniques(config.advanced_techniques);
        parts.push(techniquesSection.trim());
      }

      // Add dropdown fill-in-the-blank support section
      if (config.dropdown_fill_in_the_blank_support) {
        const support = config.dropdown_fill_in_the_blank_support;
        let supportSection = '**Dropdown Fill-in-the-Blank Support**\n\n';
        
        if (support.purpose) {
          supportSection += `Purpose: ${support.purpose}\n\n`;
        }

        if (support.formatting) {
          supportSection += 'Formatting:\n';
          if (support.formatting.syntax) {
            supportSection += `• Syntax: ${support.formatting.syntax}\n`;
          }
          if (support.formatting.default_behavior && support.formatting.default_behavior.length > 0) {
            supportSection += '• Default Behavior:\n';
            support.formatting.default_behavior.forEach(behavior => {
              supportSection += `  - ${behavior}\n`;
            });
          }
          if (support.formatting.constraints && support.formatting.constraints.length > 0) {
            supportSection += '• Constraints:\n';
            support.formatting.constraints.forEach(constraint => {
              supportSection += `  - ${constraint}\n`;
            });
          }
          if (support.formatting.usage_conditions && support.formatting.usage_conditions.length > 0) {
            supportSection += '• Usage Conditions:\n';
            support.formatting.usage_conditions.forEach(condition => {
              if (typeof condition === 'string') {
                supportSection += `  - ${condition}\n`;
              } else if (typeof condition === 'object' && condition !== null) {
                // Handle nested objects in usage conditions
                Object.entries(condition).forEach(([key, value]) => {
                  if (Array.isArray(value)) {
                    supportSection += `  - ${key.replace(/_/g, ' ')}:\n`;
                    value.forEach(item => {
                      supportSection += `      - ${item}\n`;
                    });
                  } else {
                    supportSection += `  - ${key.replace(/_/g, ' ')}: ${value}\n`;
                  }
                });
              }
            });
          }
          supportSection += '\n';
        }

        if (support.examples) {
          supportSection += 'Examples:\n';
          if (support.examples.high_certainty) {
            const hc = support.examples.high_certainty;
            supportSection += '• High Certainty:\n';
            if (hc.user_input) supportSection += `  - User Input: "${hc.user_input}"\n`;
            if (hc.optimized_prompt) supportSection += `  - Optimized: "${hc.optimized_prompt}"\n`;
          }
          if (support.examples.low_certainty) {
            const lc = support.examples.low_certainty;
            supportSection += '• Low Certainty:\n';
            if (lc.user_input) supportSection += `  - User Input: "${lc.user_input}"\n`;
            if (lc.optimized_prompt) supportSection += `  - Optimized: "${lc.optimized_prompt}"\n`;
          }
        }

        parts.push(supportSection.trim());
      }

      // Add processing algorithm (replaces pseudocode logic)
      if (config.processing_algorithm) {
        parts.push(`Processing Algorithm:\n${config.processing_algorithm.trim()}`);
      }

      // Add output standards
      if (config.output_standards && config.output_standards.length > 0) {
        let standardsSection = 'Output Standards:\n';
        config.output_standards.forEach(standard => {
          standardsSection += `• ${standard}\n`;
        });
        parts.push(standardsSection.trim());
      }

      // Add final instruction
      if (config.final_instruction) {
        parts.push(`Final Instruction:\n${config.final_instruction.trim()}`);
      }

      systemPrompt = parts.join('\n\n').trim();
    }

    if (!systemPrompt) {
      throw new Error('Could not parse prompt from YAML - no content found');
    }

    // Cache the result
    cachedSystemPrompt = systemPrompt;
    cachedTimestamp = now;

    return systemPrompt;
    
  } catch (error) {
    console.error('Error loading system prompt from YAML:', error);
    
    // Fallback to a basic system prompt if YAML loading fails
    const fallbackPrompt = `You are PromptLayer, an advanced prompt-improvement assistant. 
Your role is to receive raw user input prompts and automatically enhance them using best prompt-engineering practices.

ONLY RETURN THE OPTIMIZED PROMPT, NO OTHER TEXT.

When a user prompt is given, improve it to be as clear, specific, and effective as possible while preserving the original intent.`;

    // Cache the fallback prompt too to avoid repeated failures
    cachedSystemPrompt = fallbackPrompt;
    cachedTimestamp = now;

    return fallbackPrompt;
  }
};