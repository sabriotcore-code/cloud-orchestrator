// ============================================================================
// NEW SERVICE ENDPOINTS - Add to server.js
// ============================================================================

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
      const result = await e2b.executePython(code, timeout);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/e2b/javascript', async (req, res) => {
    try {
      const { code, timeout } = req.body;
      const result = await e2b.executeJavaScript(code, timeout);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/e2b/validate', async (req, res) => {
    try {
      const { code, language, testCases } = req.body;
      const result = await e2b.validateCode(code, language, testCases);
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
      const result = await firecrawl.scrapeUrl(url, options);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/firecrawl/clean', async (req, res) => {
    try {
      const { url } = req.body;
      const result = await firecrawl.getCleanContent(url);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/firecrawl/extract', async (req, res) => {
    try {
      const { url, schema } = req.body;
      const result = await firecrawl.extractData(url, schema);
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
