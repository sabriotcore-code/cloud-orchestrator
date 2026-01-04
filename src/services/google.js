import dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// GOOGLE SHEETS SERVICE
// Simple read-only access using API key for public sheets
// ============================================================================

/**
 * Check if Google API is configured
 */
export function isConfigured() {
  return !!process.env.GEMINI_API_KEY || !!process.env.GOOGLE_API_KEY;
}

/**
 * Read data from a public Google Sheet
 * Works for publicly accessible sheets using just an API key
 */
export async function quickReadSheet(spreadsheetId, range = 'Sheet1!A1:Z100') {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return { success: false, error: 'No API key available' };
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      success: true,
      spreadsheetId,
      range: data.range,
      values: data.values || [],
      rowCount: (data.values || []).length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  isConfigured,
  quickReadSheet
};
