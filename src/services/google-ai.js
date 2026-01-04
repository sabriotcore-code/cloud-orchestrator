// ============================================================================
// GOOGLE AI SERVICES
// Advanced ML/AI capabilities from Google Cloud
// ============================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';
import { LRUCache } from '../utils/lru-cache.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_CLOUD_API_KEY = process.env.GOOGLE_CLOUD_API_KEY || GEMINI_API_KEY;
const GOOGLE_PROJECT_ID = process.env.GOOGLE_PROJECT_ID;

// Initialize Gemini
let genAI = null;
let visionModel = null;
let textModel = null;
let embeddingModel = null;

function initGemini() {
  if (!GEMINI_API_KEY) return false;
  if (genAI) return true;

  try {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    visionModel = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    textModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    console.log('[Google AI] Gemini models initialized');
    return true;
  } catch (e) {
    console.error('[Google AI] Failed to initialize:', e.message);
    return false;
  }
}

// ============================================================================
// STATUS
// ============================================================================

export function isConfigured() {
  return !!GEMINI_API_KEY;
}

export function getStatus() {
  return {
    gemini: !!GEMINI_API_KEY,
    vision: !!visionModel,
    embeddings: !!embeddingModel,
    cloudNLP: !!GOOGLE_CLOUD_API_KEY,
    projectId: GOOGLE_PROJECT_ID || 'not set'
  };
}

// ============================================================================
// GEMINI VISION - Analyze images, screenshots, diagrams
// ============================================================================

/**
 * Analyze an image using Gemini Pro Vision
 * @param {string} imageBase64 - Base64 encoded image
 * @param {string} mimeType - Image MIME type (image/png, image/jpeg, etc.)
 * @param {string} prompt - What to analyze about the image
 * @returns {Promise<string>} Analysis result
 */
export async function analyzeImage(imageBase64, mimeType = 'image/png', prompt = 'Describe this image in detail') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const imagePart = {
    inlineData: {
      data: imageBase64,
      mimeType: mimeType
    }
  };

  const result = await visionModel.generateContent([prompt, imagePart]);
  return result.response.text();
}

/**
 * Analyze a screenshot and identify UI issues or code errors
 */
export async function analyzeScreenshot(imageBase64, context = '') {
  const prompt = `You are a software debugging expert. Analyze this screenshot.

${context ? `Context: ${context}\n\n` : ''}

Identify:
1. Any error messages visible
2. UI/UX issues
3. What the user is likely trying to do
4. Suggested fixes

Respond in JSON format:
{
  "errors": ["list of errors"],
  "issues": ["list of UI/UX issues"],
  "userIntent": "what user is trying to do",
  "suggestedFixes": ["list of fixes"],
  "codeChanges": [{"file": "path", "description": "what to change"}]
}`;

  return await analyzeImage(imageBase64, 'image/png', prompt);
}

/**
 * Analyze a code file screenshot or diagram
 */
export async function analyzeCodeImage(imageBase64, context = '') {
  const prompt = `You are a senior software engineer. Analyze this code or architecture diagram.

${context ? `Context: ${context}\n\n` : ''}

Identify:
1. What programming language/framework is shown
2. The purpose of this code/diagram
3. Any bugs, issues, or improvements
4. How it connects to other parts of a system

Respond with a clear technical explanation.`;

  return await analyzeImage(imageBase64, 'image/png', prompt);
}

// ============================================================================
// EMBEDDINGS - Semantic search and similarity
// ============================================================================

// In-memory embedding cache for fast semantic search (LRU with size limit)
const embeddingCache = new LRUCache(500, 3600000); // 500 embeddings, 1 hour TTL

/**
 * Get embeddings for text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
export async function getEmbedding(text) {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  // Check cache first
  const cacheKey = text.substring(0, 100);
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }

  const result = await embeddingModel.embedContent(text);
  const embedding = result.embedding.values;

  // Cache it
  embeddingCache.set(cacheKey, embedding);

  return embedding;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic search across a list of items
 * @param {string} query - Search query
 * @param {Array<{id: string, text: string, metadata?: object}>} items - Items to search
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array<{id: string, score: number, text: string, metadata?: object}>>}
 */
export async function semanticSearch(query, items, topK = 5) {
  if (!items || items.length === 0) return [];

  const queryEmbedding = await getEmbedding(query);

  // Get embeddings for all items (with caching)
  const results = await Promise.all(
    items.map(async (item) => {
      const itemEmbedding = await getEmbedding(item.text);
      const score = cosineSimilarity(queryEmbedding, itemEmbedding);
      return { ...item, score };
    })
  );

  // Sort by similarity and return top K
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Index code files for semantic search
 * @param {Array<{path: string, content: string}>} files - Files to index
 */
export async function indexCodeFiles(files) {
  const indexedFiles = [];

  for (const file of files) {
    // Split code into chunks (functions, classes, etc.)
    const chunks = splitCodeIntoChunks(file.content, file.path);

    for (const chunk of chunks) {
      try {
        const embedding = await getEmbedding(chunk.text);
        indexedFiles.push({
          id: `${file.path}:${chunk.startLine}`,
          path: file.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          embedding
        });
      } catch (e) {
        console.error(`Failed to index ${file.path}:${chunk.startLine}:`, e.message);
      }
    }
  }

  return indexedFiles;
}

/**
 * Split code into semantic chunks
 */
function splitCodeIntoChunks(content, path) {
  const chunks = [];
  const lines = content.split('\n');
  const ext = path.split('.').pop();

  // Simple chunking by function/class patterns
  const patterns = {
    js: /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(|^(export\s+)?class\s+\w+/,
    ts: /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(|^(export\s+)?class\s+\w+|^(export\s+)?interface\s+\w+/,
    py: /^(async\s+)?def\s+\w+|^class\s+\w+/
  };

  const pattern = patterns[ext] || patterns.js;
  let currentChunk = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line starts a new chunk
    if (pattern.test(line.trim()) && currentChunk.length > 0) {
      chunks.push({
        startLine,
        endLine: i,
        text: currentChunk.join('\n').trim()
      });
      currentChunk = [line];
      startLine = i + 1;
    } else {
      currentChunk.push(line);
    }
  }

  // Add the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      startLine,
      endLine: lines.length,
      text: currentChunk.join('\n').trim()
    });
  }

  // If file is small, return as single chunk
  if (chunks.length === 1 && content.length < 3000) {
    return [{ startLine: 1, endLine: lines.length, text: content }];
  }

  return chunks.filter(c => c.text.length > 50); // Filter tiny chunks
}

// ============================================================================
// NATURAL LANGUAGE PROCESSING - Intent, sentiment, entities
// ============================================================================

/**
 * Classify intent from user message
 * @param {string} text - User message
 * @returns {Promise<{intent: string, confidence: number, entities: object}>}
 */
export async function classifyIntent(text) {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const prompt = `Classify the intent of this message and extract entities.

Message: "${text}"

Respond in JSON only:
{
  "intent": "one of: FIX_BUG, ADD_FEATURE, EXPLAIN_CODE, SEARCH_CODE, DEPLOY, CREATE_FILE, UPDATE_FILE, DELETE_FILE, ASK_QUESTION, ANALYZE_IMAGE, RUN_COMMAND, STATUS_CHECK, OTHER",
  "confidence": 0.0-1.0,
  "entities": {
    "repo": "repository name if mentioned",
    "file": "file path if mentioned",
    "action": "specific action if mentioned",
    "target": "what to act on"
  },
  "summary": "brief description of what user wants"
}`;

  const result = await textModel.generateContent(prompt);
  const responseText = result.response.text();

  // Extract JSON from response
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[Intent] Failed to parse:', e.message);
  }

  return {
    intent: 'OTHER',
    confidence: 0.5,
    entities: {},
    summary: text
  };
}

/**
 * Analyze sentiment of text
 * @param {string} text - Text to analyze
 * @returns {Promise<{score: number, magnitude: number, label: string}>}
 */
export async function analyzeSentiment(text) {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const prompt = `Analyze the sentiment of this text.

Text: "${text}"

Respond in JSON only:
{
  "score": -1.0 to 1.0 (negative to positive),
  "magnitude": 0.0 to 1.0 (strength of emotion),
  "label": "POSITIVE", "NEGATIVE", "NEUTRAL", or "MIXED"
}`;

  const result = await textModel.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[Sentiment] Failed to parse:', e.message);
  }

  return { score: 0, magnitude: 0, label: 'NEUTRAL' };
}

/**
 * Extract entities from text
 * @param {string} text - Text to analyze
 * @returns {Promise<Array<{name: string, type: string, salience: number}>>}
 */
export async function extractEntities(text) {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const prompt = `Extract all named entities from this text.

Text: "${text}"

Respond in JSON array only:
[
  {"name": "entity name", "type": "PERSON|ORGANIZATION|LOCATION|EVENT|WORK_OF_ART|CONSUMER_GOOD|OTHER", "salience": 0.0-1.0}
]`;

  const result = await textModel.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[Entities] Failed to parse:', e.message);
  }

  return [];
}

// ============================================================================
// DOCUMENT PARSING - Extract structure from documents
// ============================================================================

/**
 * Parse structured data from document text (PDFs, contracts, etc.)
 * @param {string} documentText - Document content
 * @param {string} schema - What to extract (e.g., "invoice fields", "contract terms")
 * @returns {Promise<object>} Extracted data
 */
export async function parseDocument(documentText, schema = 'key fields') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const prompt = `You are a document parsing expert. Extract structured data from this document.

Document:
---
${documentText.substring(0, 10000)}
---

Extract: ${schema}

Respond in JSON format with the extracted fields. Include confidence scores where applicable.`;

  const result = await textModel.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[Document] Failed to parse:', e.message);
  }

  return { raw: responseText };
}

/**
 * Summarize a document
 * @param {string} documentText - Document content
 * @param {string} style - Summary style (brief, detailed, bullets)
 */
export async function summarizeDocument(documentText, style = 'brief') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const styleGuide = {
    brief: 'Provide a 2-3 sentence summary.',
    detailed: 'Provide a comprehensive summary covering all main points.',
    bullets: 'Provide a bulleted list of key points.'
  };

  const prompt = `Summarize this document.

${styleGuide[style] || styleGuide.brief}

Document:
---
${documentText.substring(0, 15000)}
---`;

  const result = await textModel.generateContent(prompt);
  return result.response.text();
}

// ============================================================================
// CODE INTELLIGENCE - Smarter code operations
// ============================================================================

/**
 * Generate code based on description
 * @param {string} description - What to generate
 * @param {string} language - Programming language
 * @param {string} context - Existing code context
 */
export async function generateCode(description, language = 'javascript', context = '') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const prompt = `You are an expert ${language} developer. Generate code based on this description.

Description: ${description}

${context ? `Existing code context:\n\`\`\`${language}\n${context}\n\`\`\`\n\n` : ''}

Requirements:
1. Write clean, production-ready code
2. Follow best practices for ${language}
3. Include necessary imports
4. Add brief comments for complex logic

Respond with ONLY the code, wrapped in markdown code blocks.`;

  const result = await textModel.generateContent(prompt);
  return result.response.text();
}

/**
 * Review code for issues
 * @param {string} code - Code to review
 * @param {string} language - Programming language
 */
export async function reviewCode(code, language = 'javascript') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const prompt = `You are a senior ${language} code reviewer. Review this code for:

1. Bugs and potential errors
2. Security vulnerabilities
3. Performance issues
4. Code style and best practices
5. Suggested improvements

Code:
\`\`\`${language}
${code}
\`\`\`

Respond in JSON:
{
  "overallScore": 1-10,
  "bugs": [{"line": N, "severity": "high|medium|low", "description": "..."}],
  "security": [{"line": N, "type": "...", "description": "..."}],
  "performance": [{"line": N, "description": "..."}],
  "style": [{"line": N, "description": "..."}],
  "improvements": ["..."]
}`;

  const result = await textModel.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[Review] Failed to parse:', e.message);
  }

  return { overallScore: 0, raw: responseText };
}

/**
 * Explain code in plain English
 * @param {string} code - Code to explain
 * @param {string} audience - Who is the explanation for (beginner, developer, expert)
 */
export async function explainCode(code, audience = 'developer') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const audienceGuide = {
    beginner: 'Explain like I\'m a complete beginner learning to code. Use simple analogies.',
    developer: 'Explain for a developer who knows programming but not this specific codebase.',
    expert: 'Give a technical deep-dive including edge cases, performance characteristics, and design decisions.'
  };

  const prompt = `${audienceGuide[audience] || audienceGuide.developer}

Code:
\`\`\`
${code}
\`\`\`

Explain what this code does, how it works, and why it's designed this way.`;

  const result = await textModel.generateContent(prompt);
  return result.response.text();
}

// ============================================================================
// MULTI-MODAL ANALYSIS - Combine image + text
// ============================================================================

/**
 * Analyze image with text context
 * @param {string} imageBase64 - Base64 image
 * @param {string} mimeType - Image type
 * @param {string} textContext - Related text (error logs, description, etc.)
 * @param {string} question - What to answer about the image
 */
export async function multiModalAnalysis(imageBase64, mimeType, textContext, question) {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  const imagePart = {
    inlineData: {
      data: imageBase64,
      mimeType: mimeType
    }
  };

  const prompt = `Analyze this image along with the provided context.

Context:
${textContext}

Question: ${question}

Provide a detailed answer based on both the image and the context.`;

  const result = await visionModel.generateContent([prompt, imagePart]);
  return result.response.text();
}

// ============================================================================
// SMART ROUTING - Decide which AI/tool to use
// ============================================================================

/**
 * Route a query to the best handler
 * @param {string} query - User query
 * @param {object} context - Available context
 * @returns {Promise<{handler: string, confidence: number, params: object}>}
 */
export async function routeQuery(query, context = {}) {
  const intent = await classifyIntent(query);

  const routing = {
    FIX_BUG: { handler: 'github_investigate', params: { repo: intent.entities.repo } },
    ADD_FEATURE: { handler: 'github_plan', params: { repo: intent.entities.repo } },
    EXPLAIN_CODE: { handler: 'code_explain', params: { file: intent.entities.file } },
    SEARCH_CODE: { handler: 'semantic_search', params: { query } },
    DEPLOY: { handler: 'deploy', params: { repo: intent.entities.repo } },
    CREATE_FILE: { handler: 'github_create', params: { path: intent.entities.file } },
    UPDATE_FILE: { handler: 'github_update', params: { path: intent.entities.file } },
    ANALYZE_IMAGE: { handler: 'vision_analyze', params: {} },
    STATUS_CHECK: { handler: 'status', params: {} },
    ASK_QUESTION: { handler: 'ai_ask', params: {} }
  };

  return {
    intent: intent.intent,
    confidence: intent.confidence,
    ...(routing[intent.intent] || { handler: 'ai_ask', params: {} })
  };
}

// ============================================================================
// WEB INTELLIGENCE - Smart web fetching
// ============================================================================

/**
 * Fetch and summarize web content
 * @param {string} url - URL to fetch
 * @param {string} question - What to extract from the page
 */
export async function fetchAndAnalyze(url, question = 'Summarize this page') {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIBot/1.0)' }
    });
    const html = await response.text();

    // Strip HTML to get text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 15000);

    if (!initGemini()) {
      return { url, text: text.substring(0, 500) };
    }

    const prompt = `Analyze this web page content and answer the question.

URL: ${url}

Content:
${text}

Question: ${question}`;

    const result = await textModel.generateContent(prompt);
    return {
      url,
      answer: result.response.text()
    };
  } catch (e) {
    return { url, error: e.message };
  }
}

// ============================================================================
// CONVERSATION MEMORY - Smarter context (LRU with user limit)
// ============================================================================

// Limit to 200 users, 24 hour TTL - prevents unbounded memory growth
const conversationHistory = new LRUCache(200, 86400000);

/**
 * Add to conversation memory
 * @param {string} userId - User ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 */
export function addToConversation(userId, role, content) {
  let history = conversationHistory.get(userId);
  if (!history) {
    history = [];
  }

  history.push({ role, content, timestamp: Date.now() });

  // Keep last 50 messages per user
  if (history.length > 50) {
    history.shift();
  }

  conversationHistory.set(userId, history);
}

/**
 * Get conversation history
 * @param {string} userId - User ID
 * @param {number} limit - Max messages to return
 */
export function getConversationHistory(userId, limit = 10) {
  const history = conversationHistory.get(userId) || [];
  return history.slice(-limit);
}

/**
 * Clear conversation history
 * @param {string} userId - User ID
 */
export function clearConversation(userId) {
  conversationHistory.delete(userId);
}

/**
 * Generate response with conversation context
 * @param {string} userId - User ID
 * @param {string} message - New message
 * @param {string} systemPrompt - System instructions
 */
export async function chatWithContext(userId, message, systemPrompt = '') {
  if (!initGemini()) {
    throw new Error('Gemini not configured');
  }

  addToConversation(userId, 'user', message);
  const history = getConversationHistory(userId, 20);

  const prompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}Conversation history:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

Respond to the latest message.`;

  const result = await textModel.generateContent(prompt);
  const response = result.response.text();

  addToConversation(userId, 'assistant', response);

  return response;
}

export default {
  isConfigured,
  getStatus,
  // Vision
  analyzeImage,
  analyzeScreenshot,
  analyzeCodeImage,
  multiModalAnalysis,
  // Embeddings
  getEmbedding,
  semanticSearch,
  indexCodeFiles,
  cosineSimilarity,
  // NLP
  classifyIntent,
  analyzeSentiment,
  extractEntities,
  // Documents
  parseDocument,
  summarizeDocument,
  // Code
  generateCode,
  reviewCode,
  explainCode,
  // Routing
  routeQuery,
  // Web
  fetchAndAnalyze,
  // Conversation
  addToConversation,
  getConversationHistory,
  clearConversation,
  chatWithContext
};
