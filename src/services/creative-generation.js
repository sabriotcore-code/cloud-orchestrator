// ============================================================================
// CREATIVE GENERATION - Images, Audio, Video, Creative Writing
// AI-powered creative content generation
// ============================================================================

import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// ============================================================================
// IMAGE GENERATION
// ============================================================================

/**
 * Generate image with DALL-E
 */
export async function generateImageDallE(prompt, options = {}) {
  if (!openai) throw new Error('OpenAI required for DALL-E');

  const {
    size = '1024x1024',
    quality = 'standard',
    style = 'vivid',
    n = 1
  } = options;

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n,
    size,
    quality,
    style
  });

  return {
    images: response.data.map(img => ({
      url: img.url,
      revisedPrompt: img.revised_prompt
    })),
    prompt,
    options: { size, quality, style }
  };
}

/**
 * Generate image with Stability AI
 */
export async function generateImageStability(prompt, options = {}) {
  if (!STABILITY_API_KEY) throw new Error('Stability API key not configured');

  const {
    width = 1024,
    height = 1024,
    steps = 30,
    cfg_scale = 7,
    style_preset = 'photographic'
  } = options;

  const response = await fetch(
    'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STABILITY_API_KEY}`
      },
      body: JSON.stringify({
        text_prompts: [{ text: prompt, weight: 1 }],
        cfg_scale,
        width,
        height,
        steps,
        style_preset
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Stability API error');
  }

  const result = await response.json();

  return {
    images: result.artifacts.map(img => ({
      base64: img.base64,
      seed: img.seed
    })),
    prompt,
    options: { width, height, steps, cfg_scale, style_preset }
  };
}

/**
 * Edit image (inpainting)
 */
export async function editImage(imageUrl, prompt, mask = null, options = {}) {
  if (!openai) throw new Error('OpenAI required for image editing');

  // Download image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();

  const params = {
    model: 'dall-e-2',
    image: new File([imageBuffer], 'image.png', { type: 'image/png' }),
    prompt,
    n: 1,
    size: options.size || '1024x1024'
  };

  if (mask) {
    const maskResponse = await fetch(mask);
    const maskBuffer = await maskResponse.arrayBuffer();
    params.mask = new File([maskBuffer], 'mask.png', { type: 'image/png' });
  }

  const response = await openai.images.edit(params);

  return {
    images: response.data.map(img => ({ url: img.url })),
    prompt
  };
}

/**
 * Analyze image and describe
 */
export async function analyzeImage(imageUrl, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { detail = 'high', question = 'Describe this image in detail.' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: imageUrl, detail } }
        ]
      }
    ],
    max_tokens: 1500
  });

  return {
    description: response.choices[0].message.content,
    imageUrl,
    question
  };
}

/**
 * Generate image variations
 */
export async function generateVariations(imageUrl, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { n = 4 } = options;

  // Download image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();

  const response = await openai.images.createVariation({
    image: new File([imageBuffer], 'image.png', { type: 'image/png' }),
    n,
    size: options.size || '1024x1024'
  });

  return {
    variations: response.data.map(img => ({ url: img.url })),
    original: imageUrl
  };
}

// ============================================================================
// AUDIO GENERATION
// ============================================================================

/**
 * Generate speech from text (Text-to-Speech)
 */
export async function generateSpeech(text, options = {}) {
  if (!openai) throw new Error('OpenAI required for TTS');

  const {
    voice = 'alloy', // alloy, echo, fable, onyx, nova, shimmer
    model = 'tts-1',
    speed = 1.0,
    response_format = 'mp3'
  } = options;

  const response = await openai.audio.speech.create({
    model,
    voice,
    input: text,
    speed,
    response_format
  });

  const buffer = await response.arrayBuffer();

  return {
    audio: Buffer.from(buffer).toString('base64'),
    format: response_format,
    voice,
    text
  };
}

/**
 * Generate speech with ElevenLabs (more natural voices)
 */
export async function generateSpeechElevenLabs(text, options = {}) {
  if (!ELEVENLABS_API_KEY) throw new Error('ElevenLabs API key not configured');

  const {
    voice_id = '21m00Tcm4TlvDq8ikWAM', // Rachel voice
    model_id = 'eleven_monolingual_v1',
    stability = 0.5,
    similarity_boost = 0.5
  } = options;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: { stability, similarity_boost }
      })
    }
  );

  if (!response.ok) {
    throw new Error('ElevenLabs API error');
  }

  const buffer = await response.arrayBuffer();

  return {
    audio: Buffer.from(buffer).toString('base64'),
    format: 'mp3',
    voice_id,
    text
  };
}

/**
 * Transcribe audio to text (Speech-to-Text)
 */
export async function transcribeAudio(audioUrl, options = {}) {
  if (!openai) throw new Error('OpenAI required for transcription');

  const { language, prompt } = options;

  // Download audio
  const audioResponse = await fetch(audioUrl);
  const audioBuffer = await audioResponse.arrayBuffer();

  const params = {
    file: new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' }),
    model: 'whisper-1'
  };

  if (language) params.language = language;
  if (prompt) params.prompt = prompt;

  const response = await openai.audio.transcriptions.create(params);

  return {
    text: response.text,
    audioUrl
  };
}

// ============================================================================
// CREATIVE WRITING
// ============================================================================

/**
 * Generate creative writing
 */
export async function generateWriting(prompt, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const {
    style = 'descriptive',
    length = 'medium',
    tone = 'neutral',
    genre = null
  } = options;

  const lengths = { short: 150, medium: 500, long: 1500 };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a creative writer. Write in a ${style} style with a ${tone} tone.${genre ? ` Genre: ${genre}.` : ''} Aim for about ${lengths[length] || 500} words.`
      },
      { role: 'user', content: prompt }
    ],
    max_tokens: 2000
  });

  return {
    content: response.choices[0].message.content,
    prompt,
    style: { style, length, tone, genre }
  };
}

/**
 * Generate story
 */
export async function generateStory(premise, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const {
    genre = 'fiction',
    length = 'short',
    elements = {}
  } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a master storyteller. Create compelling ${genre} stories.
Return JSON:
{
  "title": "story title",
  "story": "the complete story",
  "characters": [{"name": "...", "description": "..."}],
  "themes": ["theme 1"],
  "summary": "one-sentence summary"
}`
      },
      {
        role: 'user',
        content: `Premise: ${premise}
Length: ${length}
${Object.keys(elements).length > 0 ? `Elements to include: ${JSON.stringify(elements)}` : ''}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Generate poetry
 */
export async function generatePoetry(theme, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const {
    style = 'free_verse',
    mood = 'contemplative',
    length = 'medium'
  } = options;

  const styles = {
    free_verse: 'free verse without strict rhyme or meter',
    sonnet: 'a 14-line sonnet with traditional rhyme scheme',
    haiku: 'a haiku with 5-7-5 syllable structure',
    limerick: 'a humorous limerick with AABBA rhyme',
    ballad: 'a narrative ballad with regular meter'
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a poet. Write ${styles[style] || style} poetry with a ${mood} mood.
Return JSON:
{
  "title": "poem title",
  "poem": "the poem with line breaks",
  "analysis": "brief analysis of the poem",
  "literaryDevices": ["devices used"]
}`
      },
      { role: 'user', content: `Theme: ${theme}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Generate dialogue
 */
export async function generateDialogue(scenario, characters, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { style = 'natural', length = 'medium' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Write ${style} dialogue between characters.
Return JSON:
{
  "dialogue": [
    {"character": "name", "line": "what they say", "direction": "optional stage direction"}
  ],
  "subtext": "what's happening beneath the surface",
  "conflict": "the central tension"
}`
      },
      {
        role: 'user',
        content: `Scenario: ${scenario}
Characters: ${JSON.stringify(characters)}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// CONTENT TRANSFORMATION
// ============================================================================

/**
 * Rewrite content in different style
 */
export async function rewriteContent(content, targetStyle, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Rewrite the content in a ${targetStyle} style while preserving the core meaning.
Return JSON:
{
  "rewritten": "the rewritten content",
  "changes": ["what was changed"],
  "preservedElements": ["what was kept"]
}`
      },
      { role: 'user', content }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Expand or compress content
 */
export async function transformLength(content, targetLength, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const action = targetLength === 'expand' ? 'expand' : 'compress';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `${action === 'expand' ? 'Expand' : 'Compress'} the content${typeof targetLength === 'number' ? ` to approximately ${targetLength} words` : ''}.
Return JSON:
{
  "transformed": "the transformed content",
  "originalWordCount": number,
  "newWordCount": number,
  "ratio": number
}`
      },
      { role: 'user', content }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 3000
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// IDEA GENERATION
// ============================================================================

/**
 * Generate creative ideas
 */
export async function generateIdeas(topic, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const {
    count = 10,
    type = 'diverse',
    constraints = []
  } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate ${count} creative ${type} ideas.
Return JSON:
{
  "ideas": [
    {
      "title": "idea title",
      "description": "brief description",
      "uniqueness": 0-10,
      "feasibility": 0-10,
      "potential": "potential impact or use"
    }
  ],
  "themes": ["common themes across ideas"],
  "bestIdea": "which idea stands out and why"
}`
      },
      {
        role: 'user',
        content: `Topic: ${topic}
${constraints.length > 0 ? `Constraints: ${constraints.join(', ')}` : ''}`
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Brainstorm solutions
 */
export async function brainstormSolutions(problem, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { approaches = ['creative', 'practical', 'unconventional'] } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Brainstorm solutions using ${approaches.join(', ')} approaches.
Return JSON:
{
  "solutions": [
    {
      "approach": "which approach",
      "solution": "the solution",
      "pros": ["advantages"],
      "cons": ["disadvantages"],
      "resources": "what's needed"
    }
  ],
  "recommendation": "best solution and why",
  "hybridSolution": "combination of multiple approaches"
}`
      },
      { role: 'user', content: `Problem: ${problem}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// NAME & TITLE GENERATION
// ============================================================================

/**
 * Generate names
 */
export async function generateNames(type, context, options = {}) {
  if (!openai) throw new Error('OpenAI required');

  const { count = 10, style = 'diverse' } = options;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Generate ${count} ${style} names for ${type}.
Return JSON:
{
  "names": [
    {"name": "the name", "meaning": "meaning or rationale", "style": "style category"}
  ],
  "topPick": "best name and why"
}`
      },
      { role: 'user', content: `Context: ${context}` }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500
  });

  return JSON.parse(response.choices[0].message.content);
}

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    imageGeneration: {
      dalle: !!openai,
      stability: !!STABILITY_API_KEY,
      replicate: !!REPLICATE_API_TOKEN
    },
    audioGeneration: {
      openai: !!openai,
      elevenlabs: !!ELEVENLABS_API_KEY
    },
    creativeWriting: !!openai,
    capabilities: [
      'image_generation_dalle', 'image_generation_stability',
      'image_editing', 'image_analysis', 'image_variations',
      'speech_synthesis', 'speech_synthesis_elevenlabs', 'transcription',
      'creative_writing', 'story_generation', 'poetry_generation',
      'dialogue_generation', 'content_rewriting', 'length_transformation',
      'idea_generation', 'brainstorming', 'name_generation'
    ],
    ready: !!openai
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  // Images
  generateImageDallE, generateImageStability, editImage, analyzeImage, generateVariations,
  // Audio
  generateSpeech, generateSpeechElevenLabs, transcribeAudio,
  // Writing
  generateWriting, generateStory, generatePoetry, generateDialogue,
  // Transformation
  rewriteContent, transformLength,
  // Ideas
  generateIdeas, brainstormSolutions, generateNames
};
