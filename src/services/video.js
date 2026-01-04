// ============================================================================
// VIDEO INTELLIGENCE SERVICE
// Video analysis using Gemini and frame extraction
// ============================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// CONFIGURATION
// ============================================================================

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    geminiVideo: !!genAI,
    gpt4Vision: !!openai,
    ready: !!(genAI || openai)
  };
}

// ============================================================================
// VIDEO ANALYSIS WITH GEMINI
// ============================================================================

/**
 * Analyze video content with Gemini
 * @param {string} videoUrl - URL or base64 of video
 * @param {string} prompt - Analysis prompt
 */
export async function analyzeVideo(videoUrl, prompt = "Describe what happens in this video") {
  if (!genAI) throw new Error('Gemini API not configured');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

  // Fetch video if URL
  let videoData;
  let mimeType = 'video/mp4';

  if (videoUrl.startsWith('http')) {
    const response = await fetch(videoUrl);
    const buffer = await response.buffer();
    videoData = buffer.toString('base64');

    // Detect mime type from URL
    if (videoUrl.includes('.webm')) mimeType = 'video/webm';
    else if (videoUrl.includes('.mov')) mimeType = 'video/quicktime';
    else if (videoUrl.includes('.avi')) mimeType = 'video/x-msvideo';
  } else {
    videoData = videoUrl.replace(/^data:video\/\w+;base64,/, '');
  }

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: videoData } }
  ]);

  return {
    provider: 'gemini',
    model: 'gemini-1.5-pro',
    analysis: result.response.text(),
    success: true
  };
}

/**
 * Extract key frames and analyze each
 * @param {string} videoUrl - Video URL
 * @param {number} frameCount - Number of frames to extract
 * @param {string} prompt - Analysis prompt
 */
export async function analyzeKeyFrames(videoUrl, frameCount = 5, prompt = "Describe this frame") {
  if (!genAI) throw new Error('Gemini API not configured');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // Use Gemini to analyze video and describe frames
  const analysisPrompt = `Analyze this video and describe ${frameCount} key moments/frames. For each frame:
1. Timestamp (approximate)
2. What's happening
3. Key objects/people visible
4. Any text visible
5. Scene description

${prompt}`;

  const response = await fetch(videoUrl);
  const buffer = await response.buffer();
  const videoData = buffer.toString('base64');

  const result = await model.generateContent([
    analysisPrompt,
    { inlineData: { mimeType: 'video/mp4', data: videoData } }
  ]);

  return {
    provider: 'gemini',
    analysis: result.response.text(),
    frameCount,
    success: true
  };
}

// ============================================================================
// SPECIALIZED VIDEO ANALYSIS
// ============================================================================

/**
 * Summarize video content
 */
export async function summarizeVideo(videoUrl, length = 'medium') {
  const lengthInstructions = {
    short: 'Provide a 2-3 sentence summary',
    medium: 'Provide a detailed paragraph summary',
    long: 'Provide a comprehensive summary with all key points'
  };

  return analyzeVideo(videoUrl, `
${lengthInstructions[length] || lengthInstructions.medium} of this video.
Include:
- Main topic/subject
- Key events or points
- Important visuals or demonstrations
- Conclusion or outcome
`);
}

/**
 * Extract action items from video (meetings, tutorials)
 */
export async function extractActionItems(videoUrl) {
  return analyzeVideo(videoUrl, `
Watch this video and extract all action items, tasks, or to-dos mentioned.
Format as a numbered list with:
- The action item
- Who should do it (if mentioned)
- When/deadline (if mentioned)
- Context/notes
`);
}

/**
 * Analyze video for specific content
 */
export async function searchInVideo(videoUrl, searchQuery) {
  return analyzeVideo(videoUrl, `
Search this video for: "${searchQuery}"

Report:
1. Is the searched content present? (yes/no)
2. If yes, describe when/where it appears
3. Context around the appearance
4. Any related content
`);
}

/**
 * Compare two videos
 */
export async function compareVideos(videoUrl1, videoUrl2, aspect = "content and style") {
  if (!genAI) throw new Error('Gemini API not configured');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

  const [video1, video2] = await Promise.all([
    fetch(videoUrl1).then(r => r.buffer()),
    fetch(videoUrl2).then(r => r.buffer())
  ]);

  const result = await model.generateContent([
    `Compare these two videos focusing on ${aspect}. Describe:
1. Similarities
2. Differences
3. Which is better for what purpose
4. Key observations`,
    { inlineData: { mimeType: 'video/mp4', data: video1.toString('base64') } },
    { inlineData: { mimeType: 'video/mp4', data: video2.toString('base64') } }
  ]);

  return {
    comparison: result.response.text(),
    success: true
  };
}

/**
 * Generate video transcript (combine audio + visual)
 */
export async function generateTranscript(videoUrl) {
  return analyzeVideo(videoUrl, `
Generate a detailed transcript of this video that includes:
1. All spoken words (with timestamps if possible)
2. [Description of visual actions in brackets]
3. [On-screen text in brackets]
4. [Scene changes noted]

Format like a screenplay or detailed video transcript.
`);
}

/**
 * Analyze video for tutorial/educational content
 */
export async function analyzeTutorial(videoUrl) {
  return analyzeVideo(videoUrl, `
Analyze this tutorial/educational video:

1. **Topic**: What is being taught?
2. **Prerequisites**: What should viewers know beforehand?
3. **Steps**: Break down the tutorial into numbered steps
4. **Key Tips**: Important tips or warnings mentioned
5. **Resources**: Any tools, links, or materials mentioned
6. **Summary**: What viewers will learn

Format as clear documentation.
`);
}

/**
 * Extract data/charts from video
 */
export async function extractVisualData(videoUrl) {
  return analyzeVideo(videoUrl, `
Extract all data, charts, graphs, and statistics shown in this video:

1. For each chart/graph:
   - Type (bar, line, pie, etc.)
   - Title/subject
   - Key data points
   - Trends or insights

2. For statistics/numbers:
   - The statistic
   - Context
   - Source if mentioned

3. For tables:
   - Recreate the table data

Return in structured format.
`);
}

/**
 * Detect objects/people throughout video
 */
export async function detectEntities(videoUrl) {
  return analyzeVideo(videoUrl, `
Identify all entities in this video:

**People**:
- Names (if mentioned/shown)
- Descriptions
- Roles/relationships
- When they appear

**Objects**:
- Key objects
- Brands/products
- Tools/equipment

**Locations**:
- Settings/environments
- Text on signs/buildings
- Geographic indicators

**Organizations**:
- Companies mentioned
- Logos visible
- Affiliations
`);
}

/**
 * Analyze video sentiment and tone
 */
export async function analyzeSentiment(videoUrl) {
  return analyzeVideo(videoUrl, `
Analyze the sentiment and tone of this video:

1. **Overall Tone**: (positive, negative, neutral, mixed)
2. **Emotional Journey**: How does the mood change throughout?
3. **Key Emotional Moments**: Highlight significant emotional points
4. **Audience Reaction**: What response is this trying to evoke?
5. **Communication Style**: (formal, casual, urgent, educational, etc.)
6. **Confidence Score**: How certain are you about this analysis?
`);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  analyzeVideo,
  analyzeKeyFrames,
  summarizeVideo,
  extractActionItems,
  searchInVideo,
  compareVideos,
  generateTranscript,
  analyzeTutorial,
  extractVisualData,
  detectEntities,
  analyzeSentiment
};
