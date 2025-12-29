import dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// WEB SEARCH SERVICE
// Uses DuckDuckGo Instant Answer API (free, no key needed)
// ============================================================================

const DDG_API = 'https://api.duckduckgo.com';

// Search the web using DuckDuckGo
export async function search(query, maxResults = 5) {
  try {
    // DuckDuckGo Instant Answer API
    const url = `${DDG_API}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const data = await response.json();

    const results = [];

    // Add abstract if available
    if (data.Abstract) {
      results.push({
        title: data.Heading || 'Summary',
        snippet: data.Abstract,
        url: data.AbstractURL || '',
        source: data.AbstractSource || 'DuckDuckGo'
      });
    }

    // Add related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.substring(0, 100),
            snippet: topic.Text,
            url: topic.FirstURL,
            source: 'DuckDuckGo'
          });
        }
      }
    }

    // Add answer if available
    if (data.Answer) {
      results.unshift({
        title: 'Direct Answer',
        snippet: data.Answer,
        url: '',
        source: 'DuckDuckGo'
      });
    }

    return {
      success: true,
      query,
      results,
      totalResults: results.length
    };
  } catch (error) {
    return {
      success: false,
      query,
      error: error.message,
      results: []
    };
  }
}

// Fetch and summarize a webpage
export async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CloudOrchestrator/1.0)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();

    // Basic HTML to text conversion
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 5000);

    return {
      success: true,
      url,
      content: text
    };
  } catch (error) {
    return {
      success: false,
      url,
      error: error.message
    };
  }
}

export function isConfigured() {
  return true; // DuckDuckGo doesn't need API key
}
