// ============================================================================
// HELPER UTILITIES
// Common functions used across the bot
// ============================================================================

// Convert username to consistent ID format
export function usernameToId(username) {
  if (!username) return 'default';
  return username.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// Retry wrapper with exponential backoff
export async function withRetry(fn, options = {}) {
  const { maxRetries = 3, delayMs = 1000, backoff = 2, onRetry = null } = options;
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = delayMs * Math.pow(backoff, i);
        if (onRetry) onRetry(error, i + 1, delay);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// Sleep helper
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Timeout wrapper
export function withTimeout(promise, ms, errorMessage = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms))
  ]);
}

// Safe JSON parse
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

// Extract JSON from text (handles preamble, code blocks, etc.)
export function extractJson(text) {
  if (!text) return null;

  // Method 1: Extract from ```json code block
  const codeBlockMatch = text.match(/```json?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    const parsed = safeJsonParse(codeBlockMatch[1].trim());
    if (parsed) return parsed;
  }

  // Method 2: Find balanced JSON object
  const startIdx = text.indexOf('{"');
  if (startIdx !== -1) {
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      if (depth === 0) { endIdx = i; break; }
    }
    const jsonStr = text.substring(startIdx, endIdx + 1);
    const parsed = safeJsonParse(jsonStr);
    if (parsed) return parsed;
  }

  // Method 3: Try parsing entire string
  return safeJsonParse(text.trim());
}

// Truncate text with ellipsis
export function truncate(text, maxLength, suffix = '...') {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}

// Split text into chunks for Slack (max ~3000 chars per message)
export function splitForSlack(text, maxLength = 2800) {
  if (!text || text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf('\n', maxLength);
    if (splitIdx < maxLength / 2) {
      // No good newline, split at space
      splitIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIdx < maxLength / 2) {
      // No good space, force split
      splitIdx = maxLength;
    }

    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trim();
  }

  return chunks;
}

// Format bytes to human readable
export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Format milliseconds to human readable
export function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

// Check if string looks like code
export function looksLikeCode(text) {
  const codeIndicators = [
    /function\s+\w+/,
    /const\s+\w+\s*=/,
    /let\s+\w+\s*=/,
    /var\s+\w+\s*=/,
    /=>\s*{/,
    /import\s+.*from/,
    /export\s+(default\s+)?(function|class|const)/,
    /<\/?[a-z]+[^>]*>/i,
    /\{\s*"[^"]+"\s*:/,
  ];
  return codeIndicators.some(pattern => pattern.test(text));
}

// Detect risky file patterns
export function isRiskyFile(path) {
  const riskyPatterns = [
    /package\.json$/,
    /\.env$/,
    /config\.(js|ts|json)$/,
    /server\.(js|ts)$/,
    /index\.(js|ts)$/,
    /database\.(js|ts)$/,
    /migrate\.(js|ts)$/,
    /\.lock$/,
    /secret/i,
    /credential/i,
    /password/i,
  ];
  return riskyPatterns.some(pattern => pattern.test(path));
}

// Calculate similarity between two strings (0-1)
export function similarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// Rate limiter
const rateLimits = new Map();

export function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (!rateLimits.has(key)) {
    rateLimits.set(key, []);
  }

  const requests = rateLimits.get(key).filter(time => time > windowStart);
  rateLimits.set(key, requests);

  if (requests.length >= maxRequests) {
    return { allowed: false, remaining: 0, resetIn: requests[0] + windowMs - now };
  }

  requests.push(now);
  return { allowed: true, remaining: maxRequests - requests.length, resetIn: windowMs };
}

// Simple in-memory cache with TTL
const cache = new Map();

export function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs = 300000) { // Default 5 min TTL
  cache.set(key, {
    value,
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
  });
}

export function cacheClear(pattern = null) {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
}

// Debounce function
export function debounce(fn, delayMs) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

// Sanitize for Slack markdown
export function sanitizeForSlack(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
