// ============================================================================
// LANGUAGE UNDERSTANDING - Deep NLP Analysis
// Entity extraction, sentiment, summarization, translation, etc.
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// ENTITY EXTRACTION
// ============================================================================

/**
 * Extract named entities from text
 */
export async function extractEntities(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { entityTypes = ['person', 'organization', 'location', 'date', 'money', 'product', 'event'] } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Extract named entities from text. Return JSON:
{
  "entities": [
    {"text": "entity text", "type": "person/org/location/date/money/product/event/other", "start": 0, "end": 10, "confidence": 0.95}
  ],
  "summary": {"person": 2, "organization": 1, ...}
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Extract relationships between entities
 */
export async function extractRelationships(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Extract relationships between entities in text. Return JSON:
{
  "entities": [{"id": 1, "text": "...", "type": "..."}],
  "relationships": [
    {"subject": 1, "predicate": "works_for", "object": 2, "confidence": 0.9, "evidence": "quote from text"}
  ]
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// SENTIMENT & EMOTION
// ============================================================================

/**
 * Analyze sentiment of text
 */
export async function analyzeSentiment(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { granularity = 'sentence' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze sentiment at ${granularity} level. Return JSON:
{
  "overall": {"sentiment": "positive/negative/neutral/mixed", "score": -1 to 1, "confidence": 0-1},
  "aspects": [{"aspect": "topic", "sentiment": "...", "score": ...}],
  "emotions": {"joy": 0-1, "sadness": 0-1, "anger": 0-1, "fear": 0-1, "surprise": 0-1},
  "subjectivity": 0-1,
  "analysis": "explanation"
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Detect emotions in text
 */
export async function detectEmotions(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Detect emotions in text. Return JSON:
{
  "primaryEmotion": {"emotion": "...", "intensity": 0-1},
  "emotions": {
    "joy": 0-1, "trust": 0-1, "fear": 0-1, "surprise": 0-1,
    "sadness": 0-1, "disgust": 0-1, "anger": 0-1, "anticipation": 0-1
  },
  "emotionalArc": [{"position": "start/middle/end", "emotion": "..."}],
  "tone": "formal/informal/serious/humorous/etc"
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// SUMMARIZATION
// ============================================================================

/**
 * Summarize text at various levels
 */
export async function summarize(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { length = 'medium', style = 'paragraph', focus = null } = options;

  const lengths = { short: '1-2 sentences', medium: '3-5 sentences', long: '2-3 paragraphs' };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Summarize text in ${lengths[length] || length}. ${focus ? `Focus on: ${focus}` : ''}
Return JSON:
{
  "summary": "the summary",
  "keyPoints": ["point1", "point2"],
  "mainTopics": ["topic1"],
  "originalLength": number,
  "compressionRatio": number
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Extract key facts from text
 */
export async function extractFacts(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Extract key facts from text. Return JSON:
{
  "facts": [
    {"fact": "statement", "type": "claim/statistic/quote/event", "confidence": 0-1, "verifiable": true/false}
  ],
  "claims": ["claims that need verification"],
  "statistics": [{"value": "...", "context": "..."}],
  "quotes": [{"quote": "...", "speaker": "..."}]
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// QUESTION ANSWERING
// ============================================================================

/**
 * Answer questions about text
 */
export async function answerQuestion(text, question, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Answer questions based on the given text. Return JSON:
{
  "answer": "direct answer",
  "confidence": 0-1,
  "evidence": "quote from text supporting answer",
  "answerable": true/false,
  "reasoning": "how answer was derived"
}`
      },
      { role: 'user', content: `Text:\n${text}\n\nQuestion: ${question}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Generate questions about text
 */
export async function generateQuestions(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { count = 5, types = ['factual', 'inferential', 'analytical'] } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate ${count} questions about this text. Include ${types.join(', ')} questions.
Return JSON:
{
  "questions": [
    {"question": "...", "type": "factual/inferential/analytical", "difficulty": "easy/medium/hard", "answer": "..."}
  ]
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// TRANSLATION & LANGUAGE DETECTION
// ============================================================================

/**
 * Translate text
 */
export async function translate(text, targetLang, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { sourceLang = 'auto', style = 'natural', preserveFormatting = true } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Translate to ${targetLang}. Use ${style} style.${preserveFormatting ? ' Preserve formatting.' : ''}
Return JSON:
{
  "translation": "translated text",
  "sourceLanguage": "detected source language",
  "targetLanguage": "${targetLang}",
  "confidence": 0-1,
  "alternatives": ["alternative translations for ambiguous phrases"]
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Detect language
 */
export async function detectLanguage(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Detect the language of this text. Return JSON:
{
  "language": "language name",
  "languageCode": "ISO 639-1 code",
  "confidence": 0-1,
  "alternativeCandidates": [{"language": "...", "confidence": ...}],
  "script": "Latin/Cyrillic/Arabic/etc",
  "isMultilingual": true/false
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// TEXT CLASSIFICATION
// ============================================================================

/**
 * Classify text into categories
 */
export async function classifyText(text, categories = [], options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const categoryList = categories.length > 0
    ? `Categories: ${categories.join(', ')}`
    : 'Determine appropriate categories';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Classify text. ${categoryList}
Return JSON:
{
  "primaryCategory": {"category": "...", "confidence": 0-1},
  "categories": [{"category": "...", "confidence": 0-1}],
  "reasoning": "why this classification"
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Detect intent from text
 */
export async function detectIntent(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Detect the intent/purpose of this text. Return JSON:
{
  "primaryIntent": {"intent": "...", "confidence": 0-1},
  "intents": [{"intent": "...", "confidence": 0-1}],
  "entities": [{"entity": "...", "type": "...", "role": "..."}],
  "action": "what action is requested",
  "target": "what/who is the target"
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// TEXT ANALYSIS
// ============================================================================

/**
 * Analyze writing style
 */
export async function analyzeStyle(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze writing style. Return JSON:
{
  "formality": 0-1,
  "complexity": "simple/moderate/complex",
  "readabilityGrade": number,
  "tone": ["professional", "casual", etc],
  "voice": "active/passive/mixed",
  "characteristics": ["concise", "verbose", etc],
  "vocabulary": {"level": "basic/intermediate/advanced", "diversity": 0-1},
  "sentenceStructure": "simple/varied/complex"
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Compare two texts
 */
export async function compareTexts(text1, text2, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Compare these two texts. Return JSON:
{
  "similarity": 0-1,
  "differences": ["key difference 1", "key difference 2"],
  "commonThemes": ["shared theme"],
  "uniqueToText1": ["unique to first text"],
  "uniqueToText2": ["unique to second text"],
  "styleDifferences": ["style difference"],
  "analysis": "overall comparison"
}`
      },
      { role: 'user', content: `Text 1:\n${text1}\n\nText 2:\n${text2}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// SEMANTIC ANALYSIS
// ============================================================================

/**
 * Extract semantic structure
 */
export async function semanticAnalysis(text, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Analyze semantic structure. Return JSON:
{
  "mainConcepts": [{"concept": "...", "importance": 0-1}],
  "arguments": [{"claim": "...", "support": [...], "strength": 0-1}],
  "themes": ["theme1", "theme2"],
  "topicHierarchy": {"main": "...", "sub": [...]},
  "coherence": 0-1,
  "logicalFlow": "description of argument flow"
}`
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    entityExtraction: !!openai,
    sentimentAnalysis: !!openai,
    summarization: !!openai,
    questionAnswering: !!openai,
    translation: !!openai,
    classification: !!openai,
    styleAnalysis: !!openai,
    capabilities: [
      'entity_extraction', 'relationship_extraction',
      'sentiment_analysis', 'emotion_detection',
      'summarization', 'fact_extraction',
      'question_answering', 'question_generation',
      'translation', 'language_detection',
      'text_classification', 'intent_detection',
      'style_analysis', 'semantic_analysis'
    ],
    ready: !!openai
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Entities
  extractEntities, extractRelationships,
  // Sentiment
  analyzeSentiment, detectEmotions,
  // Summarization
  summarize, extractFacts,
  // QA
  answerQuestion, generateQuestions,
  // Translation
  translate, detectLanguage,
  // Classification
  classifyText, detectIntent,
  // Analysis
  analyzeStyle, compareTexts, semanticAnalysis
};
