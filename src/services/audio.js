// ============================================================================
// AUDIO PROCESSING SERVICE
// Speech-to-text with Whisper, audio analysis
// ============================================================================

import OpenAI from 'openai';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    whisper: !!openai,
    elevenlabs: !!ELEVENLABS_API_KEY,
    ready: !!openai
  };
}

// ============================================================================
// SPEECH TO TEXT (Whisper)
// ============================================================================

/**
 * Transcribe audio file to text
 * @param {string} audioPath - Path to audio file or URL
 * @param {object} options - Transcription options
 */
export async function transcribe(audioPath, options = {}) {
  if (!openai) throw new Error('OpenAI API not configured');

  const {
    language = null,        // ISO language code (e.g., 'en', 'es')
    prompt = null,          // Context to guide transcription
    responseFormat = 'json', // json, text, srt, verbose_json, vtt
    temperature = 0,        // 0-1, lower = more deterministic
    timestamps = false      // Include word-level timestamps
  } = options;

  let audioFile;
  let tempPath = null;

  // Handle URL input
  if (audioPath.startsWith('http')) {
    const response = await fetch(audioPath);
    const buffer = await response.buffer();
    tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, buffer);
    audioFile = fs.createReadStream(tempPath);
  } else {
    audioFile = fs.createReadStream(audioPath);
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language,
      prompt,
      response_format: timestamps ? 'verbose_json' : responseFormat,
      temperature
    });

    return {
      success: true,
      text: transcription.text || transcription,
      language: transcription.language,
      duration: transcription.duration,
      segments: transcription.segments,
      words: transcription.words
    };
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

/**
 * Translate audio to English
 * @param {string} audioPath - Path to audio file
 */
export async function translateToEnglish(audioPath) {
  if (!openai) throw new Error('OpenAI API not configured');

  let audioFile;
  let tempPath = null;

  if (audioPath.startsWith('http')) {
    const response = await fetch(audioPath);
    const buffer = await response.buffer();
    tempPath = path.join(os.tmpdir(), `audio_${Date.now()}.mp3`);
    fs.writeFileSync(tempPath, buffer);
    audioFile = fs.createReadStream(tempPath);
  } else {
    audioFile = fs.createReadStream(audioPath);
  }

  try {
    const translation = await openai.audio.translations.create({
      file: audioFile,
      model: 'whisper-1'
    });

    return {
      success: true,
      text: translation.text,
      originalLanguage: 'auto-detected',
      targetLanguage: 'en'
    };
  } finally {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

// ============================================================================
// TEXT TO SPEECH (ElevenLabs - when configured)
// ============================================================================

/**
 * Convert text to speech
 * @param {string} text - Text to convert
 * @param {object} options - Voice options
 */
export async function textToSpeech(text, options = {}) {
  if (!ELEVENLABS_API_KEY) {
    return {
      success: false,
      error: 'ElevenLabs API not configured',
      suggestion: 'Add ELEVENLABS_API_KEY to environment variables'
    };
  }

  const {
    voiceId = '21m00Tcm4TlvDq8ikWAM', // Rachel - default
    modelId = 'eleven_monolingual_v1',
    stability = 0.5,
    similarityBoost = 0.75
  } = options;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': ELEVENLABS_API_KEY
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail?.message || 'TTS failed');
  }

  const audioBuffer = await response.buffer();

  return {
    success: true,
    audio: audioBuffer,
    contentType: 'audio/mpeg',
    size: audioBuffer.length
  };
}

/**
 * List available ElevenLabs voices
 */
export async function listVoices() {
  if (!ELEVENLABS_API_KEY) {
    return { success: false, error: 'ElevenLabs not configured' };
  }

  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY }
  });

  const data = await response.json();
  return {
    success: true,
    voices: data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels
    }))
  };
}

// ============================================================================
// AUDIO ANALYSIS
// ============================================================================

/**
 * Analyze audio content (transcribe + analyze)
 * @param {string} audioPath - Path to audio
 * @param {string} analysisType - Type of analysis
 */
export async function analyzeAudio(audioPath, analysisType = 'summary') {
  // First transcribe
  const transcription = await transcribe(audioPath, { timestamps: true });

  if (!transcription.success) {
    return transcription;
  }

  // Then analyze the text with AI
  const analysisPrompts = {
    summary: 'Provide a concise summary of this audio transcript:',
    sentiment: 'Analyze the sentiment and emotional tone of this transcript:',
    keyPoints: 'Extract the key points and main ideas from this transcript:',
    speakers: 'Identify different speakers and summarize what each person said:',
    actionItems: 'Extract any action items, tasks, or commitments mentioned:',
    questions: 'List all questions asked in this transcript:',
    decisions: 'Identify any decisions made in this conversation:'
  };

  const prompt = analysisPrompts[analysisType] || analysisPrompts.summary;

  // Use OpenAI for analysis
  const analysis = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are an expert audio content analyst.' },
      { role: 'user', content: `${prompt}\n\nTranscript:\n${transcription.text}` }
    ]
  });

  return {
    success: true,
    transcription: transcription.text,
    duration: transcription.duration,
    analysis: analysis.choices[0].message.content,
    analysisType,
    segments: transcription.segments
  };
}

/**
 * Detect language from audio
 */
export async function detectLanguage(audioPath) {
  const transcription = await transcribe(audioPath, {
    responseFormat: 'verbose_json'
  });

  return {
    success: true,
    language: transcription.language,
    text: transcription.text?.substring(0, 200)
  };
}

/**
 * Generate meeting notes from audio
 */
export async function generateMeetingNotes(audioPath) {
  const transcription = await transcribe(audioPath, { timestamps: true });

  const analysis = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert meeting notes generator. Create comprehensive meeting notes from transcripts.`
      },
      {
        role: 'user',
        content: `Generate professional meeting notes from this transcript. Include:
1. Meeting Summary (2-3 sentences)
2. Key Discussion Points
3. Decisions Made
4. Action Items (with owners if mentioned)
5. Follow-up Items
6. Next Steps

Transcript:
${transcription.text}`
      }
    ]
  });

  return {
    success: true,
    duration: transcription.duration,
    notes: analysis.choices[0].message.content,
    fullTranscript: transcription.text
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  transcribe,
  translateToEnglish,
  textToSpeech,
  listVoices,
  analyzeAudio,
  detectLanguage,
  generateMeetingNotes
};
