// ============================================================================
// NEW SERVICE ENDPOINTS - Add to server.js
// ============================================================================

// Input validation helpers
const MAX_CODE_LENGTH = 50000; // 50KB max code
const MAX_TIMEOUT = 120000;    // 2 minutes max
const DANGEROUS_PATTERNS = [
  /import\s+os/i,
  /subprocess/i,
  /eval\s*\(/,
  /exec\s*\(/,
  /__import__/,
  /system\s*\(/,
  /rm\s+-rf/,
  /curl\s+.*\|.*sh/,
  /wget\s+.*\|.*sh/
];

function validateCode(code, language) {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Code must be a non-empty string' };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Code too long (max ${MAX_CODE_LENGTH} chars)` };
  }

  // Check for dangerous patterns (basic protection, E2B sandbox provides real security)
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      console.log(`[E2B] Potentially dangerous pattern detected: ${pattern}`);
      // Log but don't block - E2B sandbox handles security
    }
  }

  return { valid: true };
}

function validateTimeout(timeout) {
  if (timeout === undefined) return 30000; // Default 30s
  const t = parseInt(timeout);
  if (isNaN(t) || t < 1000 || t > MAX_TIMEOUT) {
    return 30000; // Invalid, use default
  }
  return t;
}

function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http or https protocol' };
    }
    return { valid: true, url: parsed.href };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

export function registerNewServiceEndpoints(app, neo4j, e2b, firecrawl, mem0) {
  // NEO4J KNOWLEDGE GRAPH
  app.get('/neo4j/status', (req, res) => {
    res.json(neo4j.getNeo4jStatus());
  });

  app.post('/neo4j/entity', async (req, res) => {
    try {
      const { label, properties, uniqueKey } = req.body;
      const result = await neo4j.upsertEntity(label, properties, uniqueKey);
      res.json({ success: true, entity: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/neo4j/relationship', async (req, res) => {
    try {
      const { fromLabel, fromId, toLabel, toId, relType, properties } = req.body;
      const result = await neo4j.createRelationship(fromLabel, fromId, toLabel, toId, relType, properties);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/neo4j/entity/:label/:id', async (req, res) => {
    try {
      const { label, id } = req.params;
      const depth = parseInt(req.query.depth) || 1;
      const result = await neo4j.getEntityWithRelations(label, id, depth);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/neo4j/query', async (req, res) => {
    try {
      const { query, labels } = req.body;
      const result = await neo4j.queryKnowledge(query, labels);
      res.json({ results: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // E2B CODE EXECUTION
  app.get('/e2b/status', (req, res) => {
    res.json(e2b.getE2BStatus());
  });

  app.post('/e2b/python', async (req, res) => {
    try {
      const { code, timeout } = req.body;

      // Validate input
      const codeValidation = validateCode(code, 'python');
      if (!codeValidation.valid) {
        return res.status(400).json({ error: codeValidation.error });
      }

      const safeTimeout = validateTimeout(timeout);
      const result = await e2b.executePython(code, safeTimeout);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/e2b/javascript', async (req, res) => {
    try {
      const { code, timeout } = req.body;

      // Validate input
      const codeValidation = validateCode(code, 'javascript');
      if (!codeValidation.valid) {
        return res.status(400).json({ error: codeValidation.error });
      }

      const safeTimeout = validateTimeout(timeout);
      const result = await e2b.executeJavaScript(code, safeTimeout);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/e2b/validate', async (req, res) => {
    try {
      const { code, language, testCases } = req.body;

      // Validate input
      const codeValidation = validateCode(code, language || 'python');
      if (!codeValidation.valid) {
        return res.status(400).json({ error: codeValidation.error });
      }

      // Validate language
      const validLanguages = ['python', 'javascript'];
      const safeLang = validLanguages.includes(language) ? language : 'python';

      const result = await e2b.validateCode(code, safeLang, testCases || []);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // FIRECRAWL WEB SCRAPING
  app.get('/firecrawl/status', (req, res) => {
    res.json(firecrawl.getFirecrawlStatus());
  });

  app.post('/firecrawl/scrape', async (req, res) => {
    try {
      const { url, options } = req.body;

      // Validate URL
      const urlValidation = validateUrl(url);
      if (!urlValidation.valid) {
        return res.status(400).json({ error: urlValidation.error });
      }

      const result = await firecrawl.scrapeUrl(urlValidation.url, options);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/firecrawl/clean', async (req, res) => {
    try {
      const { url } = req.body;

      // Validate URL
      const urlValidation = validateUrl(url);
      if (!urlValidation.valid) {
        return res.status(400).json({ error: urlValidation.error });
      }

      const result = await firecrawl.getCleanContent(urlValidation.url);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/firecrawl/extract', async (req, res) => {
    try {
      const { url, schema } = req.body;

      // Validate URL
      const urlValidation = validateUrl(url);
      if (!urlValidation.valid) {
        return res.status(400).json({ error: urlValidation.error });
      }

      const result = await firecrawl.extractData(urlValidation.url, schema);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // MEM0 LONG-TERM MEMORY
  app.get('/mem0/status', (req, res) => {
    res.json(mem0.getMem0Status());
  });

  app.post('/mem0/add', async (req, res) => {
    try {
      const { userId, content, metadata } = req.body;
      const result = await mem0.addMemory(userId, content, metadata);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/mem0/search', async (req, res) => {
    try {
      const { userId, query, options } = req.body;
      const result = await mem0.searchMemories(userId, query, options);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/mem0/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const result = await mem0.getMemories(userId, req.query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/mem0/context', async (req, res) => {
    try {
      const { userId, message, options } = req.body;
      const result = await mem0.getContext(userId, message, options);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
