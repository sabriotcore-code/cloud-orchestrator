// ============================================================================
// DOCUMENT INTELLIGENCE SERVICE
// PDF parsing, document analysis, multi-format processing
// ============================================================================

import fetch from 'node-fetch';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// CONFIGURATION
// ============================================================================

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ============================================================================
// STATUS
// ============================================================================

export function getStatus() {
  return {
    openai: !!openai,
    anthropic: !!anthropic,
    ready: !!(openai || anthropic)
  };
}

// ============================================================================
// DOCUMENT PARSING
// ============================================================================

/**
 * Parse PDF document from URL or base64
 * Uses Claude's native PDF support
 * @param {string} pdfSource - URL or base64 of PDF
 * @param {string} prompt - What to extract/analyze
 */
export async function parsePDF(pdfSource, prompt = "Extract all text and structure from this document") {
  if (!anthropic) throw new Error('Anthropic API not configured');

  let pdfData;
  let mediaType = 'application/pdf';

  if (pdfSource.startsWith('http')) {
    const response = await fetch(pdfSource);
    const buffer = await response.buffer();
    pdfData = buffer.toString('base64');
  } else {
    pdfData = pdfSource.replace(/^data:application\/pdf;base64,/, '');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: pdfData
          }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  return {
    success: true,
    provider: 'claude',
    content: response.content[0].text,
    usage: response.usage
  };
}

/**
 * Extract structured data from document
 */
export async function extractStructuredData(pdfSource, schema = null) {
  const schemaPrompt = schema
    ? `Extract data matching this schema: ${JSON.stringify(schema)}`
    : `Extract all structured data (tables, forms, key-value pairs) as JSON`;

  const prompt = `${schemaPrompt}

Return a valid JSON object with all extracted data. Include:
- Tables as arrays of objects
- Form fields as key-value pairs
- Dates in ISO format
- Numbers as numbers (not strings)
- Nested structures where appropriate`;

  const result = await parsePDF(pdfSource, prompt);

  // Try to parse the JSON from the response
  try {
    const jsonMatch = result.content.match(/```json\n?([\s\S]*?)\n?```/) ||
                      result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return { success: true, data: parsed, raw: result.content };
    }
  } catch (e) {
    // Return raw if JSON parsing fails
  }

  return { success: true, data: null, raw: result.content };
}

/**
 * Analyze contract/legal document
 */
export async function analyzeContract(pdfSource) {
  const prompt = `Analyze this legal document/contract:

1. **Document Type**: What kind of document is this?
2. **Parties Involved**: Who are the parties to this agreement?
3. **Key Terms**:
   - Duration/Term
   - Payment/Consideration
   - Deliverables/Obligations
4. **Important Dates**: All significant dates mentioned
5. **Critical Clauses**:
   - Termination conditions
   - Liability limitations
   - Indemnification
   - Confidentiality
   - Non-compete/Non-solicit
6. **Red Flags**: Any concerning terms or unusual provisions
7. **Summary**: Brief plain-language summary

Format clearly with headers.`;

  return parsePDF(pdfSource, prompt);
}

/**
 * Analyze financial document
 */
export async function analyzeFinancial(pdfSource) {
  const prompt = `Analyze this financial document:

1. **Document Type**: (invoice, statement, report, tax form, etc.)
2. **Key Figures**:
   - All monetary amounts
   - Percentages
   - Dates
3. **Financial Summary**:
   - Total amounts
   - Subtotals
   - Taxes
   - Discounts
4. **Account/Reference Numbers**: All IDs and reference numbers
5. **Payment Information**: Terms, due dates, methods
6. **Anomalies**: Any unusual entries or discrepancies

Return numbers and amounts precisely as shown.`;

  return parsePDF(pdfSource, prompt);
}

/**
 * Extract tables from document
 */
export async function extractTables(pdfSource) {
  const prompt = `Extract ALL tables from this document.

For each table:
1. Table title/context
2. Column headers
3. All rows as JSON array of objects
4. Any footnotes or notes

Return as JSON:
{
  "tables": [
    {
      "title": "...",
      "headers": ["col1", "col2"],
      "rows": [{"col1": "val", "col2": "val"}],
      "notes": "..."
    }
  ]
}`;

  return extractStructuredData(pdfSource, { tables: [] });
}

/**
 * OCR and extract text from scanned document
 */
export async function ocrDocument(imageSource) {
  if (!openai) throw new Error('OpenAI API not configured');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Perform OCR on this document image. Extract ALL text exactly as it appears, preserving:
- Layout and structure
- Headers and sections
- Tables (format as markdown tables)
- Lists
- Any handwritten text (note if unclear)

Return the extracted text with proper formatting.`
        },
        { type: 'image_url', image_url: { url: imageSource, detail: 'high' } }
      ]
    }]
  });

  return {
    success: true,
    text: response.choices[0].message.content,
    provider: 'gpt4v'
  };
}

/**
 * Compare two documents
 */
export async function compareDocuments(doc1Source, doc2Source) {
  // Parse both documents
  const [doc1, doc2] = await Promise.all([
    parsePDF(doc1Source, "Extract the full content and structure of this document"),
    parsePDF(doc2Source, "Extract the full content and structure of this document")
  ]);

  // Compare using AI
  const comparison = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are an expert document analyst. Compare documents precisely and identify all differences.'
      },
      {
        role: 'user',
        content: `Compare these two documents and identify:

1. **Added Content**: What's in Doc2 but not Doc1
2. **Removed Content**: What's in Doc1 but not Doc2
3. **Modified Content**: What changed between versions
4. **Structural Changes**: Layout or formatting differences
5. **Significance**: Rate importance of changes (high/medium/low)

DOCUMENT 1:
${doc1.content}

DOCUMENT 2:
${doc2.content}`
      }
    ]
  });

  return {
    success: true,
    comparison: comparison.choices[0].message.content,
    doc1Length: doc1.content.length,
    doc2Length: doc2.content.length
  };
}

/**
 * Generate document summary
 */
export async function summarizeDocument(pdfSource, options = {}) {
  const {
    length = 'medium',  // short, medium, long
    focus = null,       // specific aspect to focus on
    format = 'prose'    // prose, bullets, outline
  } = options;

  const lengthGuide = {
    short: '2-3 sentences',
    medium: '1-2 paragraphs',
    long: 'comprehensive summary with all key points'
  };

  const formatGuide = {
    prose: 'as flowing paragraphs',
    bullets: 'as bullet points',
    outline: 'as a hierarchical outline'
  };

  const focusText = focus ? `Focus especially on: ${focus}` : '';

  const prompt = `Summarize this document in ${lengthGuide[length]} ${formatGuide[format]}.
${focusText}

Include:
- Main purpose/topic
- Key points and findings
- Important numbers/dates
- Conclusions/recommendations`;

  return parsePDF(pdfSource, prompt);
}

/**
 * Translate document
 */
export async function translateDocument(pdfSource, targetLanguage = 'Spanish') {
  const prompt = `Translate this entire document to ${targetLanguage}.
Preserve:
- All formatting and structure
- Table layouts
- Lists and numbering
- Technical terms (with original in parentheses if needed)

Provide a complete, professional translation.`;

  return parsePDF(pdfSource, prompt);
}

/**
 * Answer questions about document
 */
export async function askDocument(pdfSource, question) {
  const prompt = `Based on this document, answer the following question:

${question}

Instructions:
- Answer based ONLY on information in the document
- Quote relevant sections when possible
- If the answer isn't in the document, say so
- Be precise and specific`;

  return parsePDF(pdfSource, prompt);
}

/**
 * Classify document type
 */
export async function classifyDocument(pdfSource) {
  const prompt = `Classify this document:

1. **Document Type**: (contract, invoice, report, letter, form, etc.)
2. **Industry/Domain**: (legal, financial, medical, real estate, etc.)
3. **Purpose**: What is this document for?
4. **Formality Level**: (formal, semi-formal, informal)
5. **Language**: Primary language
6. **Date Context**: When was this likely created/relevant?
7. **Confidence**: How certain are you? (high/medium/low)

Return as JSON.`;

  return extractStructuredData(pdfSource);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getStatus,
  parsePDF,
  extractStructuredData,
  analyzeContract,
  analyzeFinancial,
  extractTables,
  ocrDocument,
  compareDocuments,
  summarizeDocument,
  translateDocument,
  askDocument,
  classifyDocument
};
