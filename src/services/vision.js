// ============================================================================
// VISION-LANGUAGE INTEGRATION SERVICE
// Multi-modal image analysis with GPT-4V, Claude Vision, and Gemini
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

// ============================================================================
// CONFIGURATION
// ============================================================================

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    claudeVision: !!anthropic,
    gpt4Vision: !!openai,
    geminiVision: !!genAI,
    ready: !!(anthropic || openai || genAI)
  };
}

// ============================================================================
// IMAGE ANALYSIS
// ============================================================================

/**
 * Analyze an image with Claude Vision
 * @param {string} imageUrl - URL or base64 of the image
 * @param {string} prompt - What to analyze
 * @param {string} mediaType - MIME type (image/jpeg, image/png, etc.)
 */
export async function analyzeWithClaude(imageUrl, prompt = "Describe this image in detail", mediaType = "image/jpeg") {
  if (!anthropic) throw new Error('Anthropic API not configured');

  const imageContent = imageUrl.startsWith('data:') || imageUrl.startsWith('http')
    ? { type: 'url', url: imageUrl }
    : { type: 'base64', media_type: mediaType, data: imageUrl };

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: imageContent.type === 'url'
          ? { type: 'url', url: imageContent.url }
          : { type: 'base64', media_type: imageContent.media_type, data: imageContent.data }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  return {
    provider: 'claude',
    model: 'claude-sonnet-4-20250514',
    analysis: response.content[0].text,
    usage: response.usage
  };
}

/**
 * Analyze an image with GPT-4 Vision
 * @param {string} imageUrl - URL of the image
 * @param {string} prompt - What to analyze
 */
export async function analyzeWithGPT4V(imageUrl, prompt = "Describe this image in detail") {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]
    }]
  });

  return {
    provider: 'gpt4v',
    model: 'gpt-4o',
    analysis: response.choices[0].message.content,
    usage: response.usage
  };
}

/**
 * Analyze an image with Gemini Vision
 * @param {string} imageUrl - URL or base64 of the image
 * @param {string} prompt - What to analyze
 */
export async function analyzeWithGemini(imageUrl, prompt = "Describe this image in detail") {
  if (!genAI) throw new Error('Gemini API not configured');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // Fetch image if URL
  let imageData;
  if (imageUrl.startsWith('http')) {
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();
    imageData = buffer.toString('base64');
  } else {
    imageData = imageUrl.replace(/^data:image\/\w+;base64,/, '');
  }

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: 'image/jpeg', data: imageData } }
  ]);

  return {
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    analysis: result.response.text(),
    usage: null
  };
}

/**
 * Multi-provider vision analysis with consensus
 * @param {string} imageUrl - Image to analyze
 * @param {string} prompt - Analysis prompt
 * @param {string[]} providers - Which providers to use
 */
export async function analyzeMultiProvider(imageUrl, prompt, providers = ['claude', 'gpt4v', 'gemini']) {
  const results = {};
  const errors = {};

  const tasks = providers.map(async (provider) => {
    try {
      switch (provider) {
        case 'claude':
          results.claude = await analyzeWithClaude(imageUrl, prompt);
          break;
        case 'gpt4v':
          results.gpt4v = await analyzeWithGPT4V(imageUrl, prompt);
          break;
        case 'gemini':
          results.gemini = await analyzeWithGemini(imageUrl, prompt);
          break;
      }
    } catch (err) {
      errors[provider] = err.message;
    }
  });

  await Promise.allSettled(tasks);

  return {
    results,
    errors,
    providerCount: Object.keys(results).length
  };
}

// ============================================================================
// SPECIALIZED ANALYSIS
// ============================================================================

/**
 * Extract text from image (OCR)
 */
export async function extractText(imageUrl) {
  const prompt = `Extract ALL text visible in this image. Return it exactly as written, preserving:
- Line breaks and spacing
- Headers and sections
- Any structured data (tables, lists)
Format the output clearly.`;

  return analyzeWithGPT4V(imageUrl, prompt);
}

/**
 * Analyze document/form
 */
export async function analyzeDocument(imageUrl) {
  const prompt = `Analyze this document image:
1. Document type (invoice, contract, form, etc.)
2. Key fields and their values
3. Important dates, numbers, names
4. Any signatures or stamps
5. Overall document summary
Return as structured JSON.`;

  return analyzeWithClaude(imageUrl, prompt);
}

/**
 * Describe scene for accessibility
 */
export async function describeForAccessibility(imageUrl) {
  const prompt = `Provide a detailed accessibility description of this image for someone who cannot see it:
1. Main subject and action
2. People (appearance, expressions, positions)
3. Setting and environment
4. Colors and lighting
5. Text visible
6. Emotional tone or mood
Be thorough but concise.`;

  return analyzeWithClaude(imageUrl, prompt);
}

/**
 * Compare two images
 */
export async function compareImages(imageUrl1, imageUrl2, aspect = "all differences") {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Compare these two images and describe ${aspect}. Be specific about what changed.` },
        { type: 'image_url', image_url: { url: imageUrl1 } },
        { type: 'image_url', image_url: { url: imageUrl2 } }
      ]
    }]
  });

  return {
    provider: 'gpt4v',
    comparison: response.choices[0].message.content,
    usage: response.usage
  };
}

/**
 * Visual question answering
 */
export async function visualQA(imageUrl, question) {
  return analyzeWithGPT4V(imageUrl, question);
}

/**
 * Detect objects and their locations
 */
export async function detectObjects(imageUrl) {
  const prompt = `Identify all distinct objects in this image. For each object, provide:
1. Object name
2. Approximate location (top-left, center, bottom-right, etc.)
3. Size relative to image (small, medium, large)
4. Confidence (high, medium, low)
Return as JSON array.`;

  return analyzeWithClaude(imageUrl, prompt);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  analyzeWithClaude,
  analyzeWithGPT4V,
  analyzeWithGemini,
  analyzeMultiProvider,
  extractText,
  analyzeDocument,
  describeForAccessibility,
  compareImages,
  visualQA,
  detectObjects
};
