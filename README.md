# PromptLayer Chrome Extension

> **Enterprise-grade prompt optimization with intelligent context extraction**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://chrome.google.com/webstore)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2+-blue.svg)](https://reactjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

PromptLayer is a sophisticated Chrome extension that revolutionizes AI interactions by providing intelligent prompt optimization with context-aware content extraction and real-time suggestions. Built for professionals who demand precision and efficiency in their AI workflows.

---

## 📥 **Installation**

### **Development Installation**

1. **Clone Repository**
   ```bash
   git clone https://github.com/MeeraPatel2703/promptlayer-copy.git
   cd promptlayer-copy
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build Extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `public` directory

### **Configuration**
1. Click the PromptLayer icon in your Chrome toolbar
2. Enter your Claude API key in the settings
3. Enable real-time suggestions and configure frequency
4. Navigate to any supported AI platform
5. Start optimizing your prompts!

## **✨ Features**

### **🚀 Real-Time Prompt Suggestions**
Get instant AI-powered suggestions as you type on supported platforms:
- **ChatGPT** (`chatgpt.com`)
- **Claude** (`claude.ai`)
- **Gemini** (`gemini.google.com`) 
- **Perplexity** (`perplexity.ai`)

**Smart Triggering Options:**
- Character count thresholds (50, 100, 200 chars)
- Word count thresholds (10, 20, 50 words)
- Time-based delays (500ms, 1s, 2s)
- Smart pause detection

### **🎯 Intelligent Context Extraction**
- Extract and analyze webpage content
- Provide context-aware prompt optimization
- Support for complex content structures

### **⚡ Performance Optimized**
- Fast Claude 3.5 Haiku integration
- Comprehensive error handling
- Network resilience and timeout protection
- Performance monitoring and optimization

---

## 🔧 **Development**

### **Available Scripts**
```bash
# Development build with watch mode
npm run dev

# Production build
npm run build

# Watch mode for active development
npm run watch
```

### **Project Structure**
```
src/
├── background/          # Service worker and extension lifecycle
├── content/            # Content scripts and widget components
├── popup/              # Extension popup interface
├── services/           # API integrations and storage
└── test/               # Testing utilities and components
```

---

## 📄 **License**

MIT License - see [LICENSE](LICENSE) file for details.

---

*Built with precision for professionals who demand excellence in AI interactions.* 