// ============================================================================
// COGNITIVE ORCHESTRATOR - Unified Intelligence Router
// Single entry point that automatically orchestrates all cognitive systems
// PLUGIN ARCHITECTURE: New services auto-register and auto-integrate
// ============================================================================

import * as ai from './ai.js';

// ============================================================================
// PLUGIN REGISTRY - All cognitive systems register here
// Future services just need to call registerPlugin() to auto-integrate
// ============================================================================

const pluginRegistry = {
  // Memory systems
  memory: {},
  // Reasoning systems
  reasoning: {},
  // Agent systems
  agents: {},
  // Grounding systems
  grounding: {},
  // Execution systems
  execution: {},
  // Analysis systems
  analysis: {}
};

// Intent patterns that trigger each capability
const intentPatterns = {};

// Capability handlers
const capabilityHandlers = {};

/**
 * Register a cognitive plugin - CALL THIS TO AUTO-INTEGRATE NEW SERVICES
 * @param {string} name - Unique plugin name
 * @param {object} config - Plugin configuration
 */
export function registerPlugin(name, config) {
  const {
    category,           // memory, reasoning, agents, grounding, execution, analysis
    capabilities = [],  // ['web_search', 'fact_check', 'code_run', etc.]
    intents = [],       // Regex patterns that trigger this plugin
    priority = 50,      // 0-100, higher = runs first
    handler,            // async function(input, context) => result
    module              // The actual module reference
  } = config;

  if (!category || !handler) {
    throw new Error(`Plugin ${name} requires category and handler`);
  }

  // Register in category
  if (!pluginRegistry[category]) {
    pluginRegistry[category] = {};
  }

  pluginRegistry[category][name] = {
    name,
    capabilities,
    priority,
    handler,
    module,
    intents
  };

  // Register intent patterns
  intents.forEach(pattern => {
    if (!intentPatterns[name]) intentPatterns[name] = [];
    intentPatterns[name].push(pattern);
  });

  // Register capability handlers
  capabilities.forEach(cap => {
    if (!capabilityHandlers[cap]) capabilityHandlers[cap] = [];
    capabilityHandlers[cap].push({ name, handler, priority });
    // Sort by priority (highest first)
    capabilityHandlers[cap].sort((a, b) => b.priority - a.priority);
  });

  console.log(`[Orchestrator] Registered plugin: ${name} (${category}) with capabilities: ${capabilities.join(', ')}`);
}

// ============================================================================
// AUTO-REGISTER EXISTING SERVICES
// ============================================================================

async function initializePlugins() {
  try {
    // --- PHASE 1: Core Reasoning ---
    const memgpt = await import('./memgpt.js');
    registerPlugin('memgpt', {
      category: 'memory',
      capabilities: ['context_recall', 'memory_store', 'user_facts'],
      intents: [
        /\b(remember|recall|last time|previously|earlier)\b/i,
        /\b(my |our |the )(project|preference|history)\b/i
      ],
      priority: 90,
      handler: async (input, ctx) => {
        const core = memgpt.getCore();
        const working = memgpt.getWorking();
        await memgpt.addToWorking({ type: 'query', content: input, timestamp: new Date().toISOString() });
        return { core, working, stored: true };
      },
      module: memgpt
    });

    const reflexion = await import('./reflexion.js');
    registerPlugin('reflexion', {
      category: 'reasoning',
      capabilities: ['self_critique', 'iterative_improvement', 'quality_check'],
      intents: [
        /\b(improve|refine|better|critique|review)\b/i
      ],
      priority: 70,
      handler: async (input, ctx) => reflexion.generate(input, ctx),
      module: reflexion
    });

    const tot = await import('./tree-of-thought.js');
    registerPlugin('tree-of-thought', {
      category: 'reasoning',
      capabilities: ['parallel_reasoning', 'multi_path', 'complex_analysis'],
      intents: [
        /\b(analyze|compare|evaluate|consider|pros and cons)\b/i,
        /\b(step by step|break down|explain)\b/i
      ],
      priority: 60,
      handler: async (input, ctx) => tot.explore(input, ctx),
      module: tot
    });

    // --- PHASE 2: Agent Systems ---
    const crewAI = await import('./crew-ai.js');
    registerPlugin('crew-ai', {
      category: 'agents',
      capabilities: ['multi_agent', 'collaboration', 'deep_research'],
      intents: [
        /\b(research|investigate|deep dive|comprehensive)\b/i,
        /\b(team|collaborate|multiple perspectives)\b/i
      ],
      priority: 50,
      handler: async (input, ctx) => {
        const crew = crewAI.createCrew({
          agents: ['researcher', 'analyst', 'writer'],
          task: input,
          context: ctx.memoryContext
        });
        return crewAI.kickoff(crew);
      },
      module: crewAI
    });

    const taskRouter = await import('./task-router.js');
    registerPlugin('task-router', {
      category: 'agents',
      capabilities: ['intent_classification', 'complexity_assessment', 'routing'],
      priority: 95, // High priority - runs early
      handler: async (input, ctx) => taskRouter.route(input, ctx),
      module: taskRouter
    });

    const toolMaster = await import('./tool-master.js');
    registerPlugin('tool-master', {
      category: 'execution',
      capabilities: ['tool_selection', 'tool_chaining', 'action_execution'],
      intents: [
        /\b(use|execute|run|call|invoke)\b/i
      ],
      priority: 55,
      handler: async (input, ctx) => {
        const tools = await toolMaster.selectTools(input);
        if (tools.length > 0) {
          const chain = toolMaster.createChain(tools, input);
          return toolMaster.executeChain(chain);
        }
        return { tools: [], executed: false };
      },
      module: toolMaster
    });

    // --- PHASE 3: Grounding Systems ---
    const perplexity = await import('./perplexity.js');
    registerPlugin('perplexity', {
      category: 'grounding',
      capabilities: ['web_search', 'real_time_info', 'citations', 'news'],
      intents: [
        /\b(latest|recent|current|today|news|happening)\b/i,
        /\b(search|look up|find out|what is|who is)\b/i,
        /\b(2024|2025|2026)\b/i
      ],
      priority: 80,
      handler: async (input, ctx) => perplexity.groundedAnswer(input),
      module: perplexity
    });

    const verify = await import('./multi-source-verify.js');
    registerPlugin('multi-source-verify', {
      category: 'grounding',
      capabilities: ['fact_check', 'claim_verification', 'consensus'],
      intents: [
        /\b(true|false|fact|accurate|verify|check|confirm)\b/i,
        /\b(is it true|really|actually|myth|rumor)\b/i
      ],
      priority: 75,
      handler: async (input, ctx) => {
        const claim = extractClaim(input);
        return verify.verify(claim);
      },
      module: verify
    });

    const sandbox = await import('./code-sandbox.js');
    registerPlugin('code-sandbox', {
      category: 'execution',
      capabilities: ['code_execution', 'code_generation', 'code_testing'],
      intents: [
        /\b(code|function|script|program|implement)\b/i,
        /\b(python|javascript|js|bash)\b/i,
        /\b(run|execute|test)\s+(this|the|my)?\s*(code|script)/i,
        /```[\s\S]*```/
      ],
      priority: 70,
      handler: async (input, ctx) => {
        const hasCode = /```[\s\S]*```/.test(input);
        if (hasCode) {
          const match = input.match(/```(\w+)?\n?([\s\S]*?)```/);
          const lang = match?.[1] || 'javascript';
          const code = match?.[2] || input;
          return sandbox.execute(code, lang, { validate: true, verifyOutput: true });
        } else {
          const lang = detectLanguage(input);
          return sandbox.generateAndRun(input, lang);
        }
      },
      module: sandbox
    });

    // =========================================
    // EXISTING CORE SERVICES
    // =========================================

    // GitHub Integration
    const github = await import('./github.js');
    registerPlugin('github', {
      category: 'execution',
      capabilities: ['repo_access', 'code_read', 'issue_create', 'commit', 'pr'],
      intents: [
        /\b(github|repo|repository|commit|pr|pull request|issue)\b/i,
        /\b(push|merge|branch|fork)\b/i
      ],
      priority: 65,
      handler: async (input, ctx) => {
        // Parse GitHub commands
        if (/list.*repos/i.test(input)) return github.listRepos();
        if (/issues/i.test(input)) {
          const match = input.match(/(\w+)\/(\w+)/);
          if (match) return github.getIssues(match[1], match[2]);
        }
        return { info: 'GitHub ready', repos: await github.listRepos() };
      },
      module: github
    });

    // Web Scraping
    const web = await import('./web.js');
    registerPlugin('web', {
      category: 'grounding',
      capabilities: ['web_fetch', 'scraping', 'url_content'],
      intents: [
        /\b(fetch|scrape|get|read)\s+(from\s+)?(url|website|page|site)\b/i,
        /https?:\/\//i
      ],
      priority: 60,
      handler: async (input, ctx) => {
        const urlMatch = input.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          return web.fetchUrl(urlMatch[0]);
        }
        return { error: 'No URL found' };
      },
      module: web
    });

    // Firecrawl - Advanced Web Crawling
    const firecrawl = await import('./firecrawl.js');
    registerPlugin('firecrawl', {
      category: 'grounding',
      capabilities: ['web_crawl', 'site_map', 'deep_scrape'],
      intents: [
        /\b(crawl|spider|map)\s+(the\s+)?(website|site|domain)\b/i,
        /\b(extract|pull)\s+(all|every)\s+(page|link)\b/i
      ],
      priority: 55,
      handler: async (input, ctx) => {
        const urlMatch = input.match(/https?:\/\/[^\s]+/);
        if (urlMatch && firecrawl.crawl) {
          return firecrawl.crawl(urlMatch[0]);
        }
        return firecrawl.getStatus();
      },
      module: firecrawl
    });

    // Neo4j Knowledge Graph
    const neo4j = await import('./neo4j.js');
    registerPlugin('neo4j', {
      category: 'memory',
      capabilities: ['knowledge_graph', 'relationships', 'entity_store'],
      intents: [
        /\b(graph|relationship|connect|link|entity)\b/i,
        /\b(related to|connected to|associated with)\b/i
      ],
      priority: 50,
      handler: async (input, ctx) => {
        // Query knowledge graph
        if (neo4j.query) {
          return neo4j.query(input);
        }
        return neo4j.getStatus ? neo4j.getStatus() : { ready: true };
      },
      module: neo4j
    });

    // Mem0 Long-term Memory
    const mem0 = await import('./mem0.js');
    registerPlugin('mem0', {
      category: 'memory',
      capabilities: ['long_term_memory', 'semantic_recall', 'learning'],
      intents: [
        /\b(long term|permanent|persist|save for later)\b/i,
        /\b(you learned|you know|we discussed)\b/i
      ],
      priority: 85,
      handler: async (input, ctx) => {
        if (mem0.search) {
          return mem0.search(input, ctx.userId);
        }
        return mem0.getStatus ? mem0.getStatus() : { ready: true };
      },
      module: mem0
    });

    // E2B Cloud Code Execution
    const e2b = await import('./e2b.js');
    registerPlugin('e2b', {
      category: 'execution',
      capabilities: ['cloud_sandbox', 'isolated_execution', 'data_analysis'],
      intents: [
        /\b(cloud|sandbox|isolated|secure)\s+(run|execute|code)\b/i,
        /\b(data analysis|pandas|numpy|matplotlib)\b/i
      ],
      priority: 60,
      handler: async (input, ctx) => {
        if (e2b.runCode) {
          const lang = detectLanguage(input);
          return e2b.runCode(input, lang);
        }
        return e2b.getStatus ? e2b.getStatus() : { ready: true };
      },
      module: e2b
    });

    // DevOps - CI/CD Integration
    const devops = await import('./devops.js');
    registerPlugin('devops', {
      category: 'execution',
      capabilities: ['deploy', 'ci_cd', 'workflows', 'monitoring'],
      intents: [
        /\b(deploy|build|pipeline|workflow|ci|cd)\b/i,
        /\b(vercel|netlify|railway|github actions)\b/i
      ],
      priority: 45,
      handler: async (input, ctx) => {
        if (/deploy/i.test(input) && devops.deploy) {
          return devops.deploy(input);
        }
        return devops.getStatus ? devops.getStatus() : { ready: true };
      },
      module: devops
    });

    // Security Scanning
    const security = await import('./security.js');
    registerPlugin('security', {
      category: 'analysis',
      capabilities: ['vulnerability_scan', 'code_security', 'secret_detection'],
      intents: [
        /\b(security|vulnerability|vuln|cve|secret|leak)\b/i,
        /\b(scan|audit|check)\s+(for\s+)?(security|issues)\b/i
      ],
      priority: 40,
      handler: async (input, ctx) => {
        if (security.scan) {
          return security.scan(input);
        }
        return security.getStatus ? security.getStatus() : { ready: true };
      },
      module: security
    });

    // Business Tools (Notion, Linear, Jira, etc.)
    const business = await import('./business.js');
    registerPlugin('business', {
      category: 'execution',
      capabilities: ['notion', 'linear', 'jira', 'project_management'],
      intents: [
        /\b(notion|linear|jira|airtable|monday)\b/i,
        /\b(task|ticket|project|sprint|board)\b/i
      ],
      priority: 35,
      handler: async (input, ctx) => {
        return business.getStatus ? business.getStatus() : { ready: true };
      },
      module: business
    });

    // =========================================
    // INTELLIGENCE LAYER SERVICES
    // =========================================

    // Vision - Image Analysis
    const vision = await import('./vision.js');
    registerPlugin('vision', {
      category: 'analysis',
      capabilities: ['image_analysis', 'ocr', 'object_detection'],
      intents: [
        /\b(image|picture|photo|screenshot|diagram)\b/i,
        /\b(see|look at|analyze|describe)\s+(this|the)\s+(image|picture)\b/i
      ],
      priority: 65,
      handler: async (input, ctx) => {
        if (vision.analyze) {
          return vision.analyze(input, ctx.imageUrl);
        }
        return vision.getStatus ? vision.getStatus() : { ready: true };
      },
      module: vision
    });

    // Audio Processing
    const audio = await import('./audio.js');
    registerPlugin('audio', {
      category: 'analysis',
      capabilities: ['transcription', 'speech_to_text', 'audio_analysis'],
      intents: [
        /\b(audio|sound|voice|speech|transcribe|podcast)\b/i,
        /\b(listen to|hear|play)\b/i
      ],
      priority: 50,
      handler: async (input, ctx) => {
        if (audio.transcribe && ctx.audioUrl) {
          return audio.transcribe(ctx.audioUrl);
        }
        return audio.getStatus ? audio.getStatus() : { ready: true };
      },
      module: audio
    });

    // Document Processing
    const documents = await import('./documents.js');
    registerPlugin('documents', {
      category: 'analysis',
      capabilities: ['pdf_parse', 'document_analysis', 'text_extraction'],
      intents: [
        /\b(pdf|document|doc|file|spreadsheet|excel)\b/i,
        /\b(read|parse|extract from)\s+(the\s+)?(pdf|document|file)\b/i
      ],
      priority: 55,
      handler: async (input, ctx) => {
        if (documents.parse && ctx.documentUrl) {
          return documents.parse(ctx.documentUrl);
        }
        return documents.getStatus ? documents.getStatus() : { ready: true };
      },
      module: documents
    });

    // Code Generation
    const codegen = await import('./codegen.js');
    registerPlugin('codegen', {
      category: 'execution',
      capabilities: ['code_generation', 'refactoring', 'code_completion'],
      intents: [
        /\b(generate|create|write)\s+(the\s+)?(code|function|class|component)\b/i,
        /\b(refactor|optimize|clean up)\s+(the\s+)?(code)\b/i
      ],
      priority: 68,
      handler: async (input, ctx) => {
        if (codegen.generate) {
          return codegen.generate(input);
        }
        return codegen.getStatus ? codegen.getStatus() : { ready: true };
      },
      module: codegen
    });

    // Sentiment Analysis
    const sentiment = await import('./sentiment.js');
    registerPlugin('sentiment', {
      category: 'analysis',
      capabilities: ['sentiment_analysis', 'emotion_detection', 'tone_analysis'],
      intents: [
        /\b(sentiment|emotion|tone|feeling|mood)\b/i,
        /\b(how do(es)? .* feel|positive|negative)\b/i
      ],
      priority: 40,
      handler: async (input, ctx) => {
        if (sentiment.analyze) {
          return sentiment.analyze(input);
        }
        return sentiment.getStatus ? sentiment.getStatus() : { ready: true };
      },
      module: sentiment
    });

    // Anomaly Detection
    const anomaly = await import('./anomaly.js');
    registerPlugin('anomaly', {
      category: 'analysis',
      capabilities: ['anomaly_detection', 'outlier_detection', 'pattern_breaking'],
      intents: [
        /\b(anomaly|anomalies|outlier|unusual|abnormal)\b/i,
        /\b(detect|find|spot)\s+(anything\s+)?(unusual|strange|odd)\b/i
      ],
      priority: 35,
      handler: async (input, ctx) => {
        if (anomaly.detect) {
          return anomaly.detect(input, ctx.data);
        }
        return anomaly.getStatus ? anomaly.getStatus() : { ready: true };
      },
      module: anomaly
    });

    // Planner
    const planner = await import('./planner.js');
    registerPlugin('planner', {
      category: 'reasoning',
      capabilities: ['planning', 'task_decomposition', 'scheduling'],
      intents: [
        /\b(plan|schedule|organize|roadmap|timeline)\b/i,
        /\b(break down|decompose|steps to)\b/i
      ],
      priority: 55,
      handler: async (input, ctx) => {
        if (planner.createPlan) {
          return planner.createPlan(input);
        }
        return planner.getStatus ? planner.getStatus() : { ready: true };
      },
      module: planner
    });

    // Causal Reasoning
    const causal = await import('./causal.js');
    registerPlugin('causal', {
      category: 'reasoning',
      capabilities: ['causal_analysis', 'root_cause', 'impact_analysis'],
      intents: [
        /\b(why|cause|because|reason|root cause)\b/i,
        /\b(what caused|led to|resulted in)\b/i
      ],
      priority: 45,
      handler: async (input, ctx) => {
        if (causal.analyze) {
          return causal.analyze(input);
        }
        return causal.getStatus ? causal.getStatus() : { ready: true };
      },
      module: causal
    });

    // Metacognition
    const metacognition = await import('./metacognition.js');
    registerPlugin('metacognition', {
      category: 'reasoning',
      capabilities: ['self_awareness', 'confidence_calibration', 'uncertainty'],
      intents: [
        /\b(how confident|how sure|certainty|uncertainty)\b/i,
        /\b(do you know|are you sure|can you)\b/i
      ],
      priority: 30,
      handler: async (input, ctx) => {
        if (metacognition.assess) {
          return metacognition.assess(input);
        }
        return metacognition.getStatus ? metacognition.getStatus() : { ready: true };
      },
      module: metacognition
    });

    // Explainability
    const explainability = await import('./explainability.js');
    registerPlugin('explainability', {
      category: 'reasoning',
      capabilities: ['explanation', 'reasoning_trace', 'decision_justification'],
      intents: [
        /\b(explain|why did you|how did you|justify)\b/i,
        /\b(reasoning|logic|thought process)\b/i
      ],
      priority: 35,
      handler: async (input, ctx) => {
        if (explainability.explain) {
          return explainability.explain(input, ctx.decision);
        }
        return explainability.getStatus ? explainability.getStatus() : { ready: true };
      },
      module: explainability
    });

    console.log('[Orchestrator] All plugins initialized - Total:',
      Object.values(pluginRegistry).reduce((sum, cat) => sum + Object.keys(cat).length, 0));

  } catch (error) {
    console.error('[Orchestrator] Plugin init error:', error.message);
  }
}

// Initialize on module load
initializePlugins();

// ============================================================================
// MAIN ORCHESTRATOR - Routes through registered plugins
// ============================================================================

/**
 * Main entry point - automatically routes through all registered systems
 * @param {string} input - User's natural language input
 * @param {object} context - Optional context (userId, history, etc.)
 */
export async function think(input, context = {}) {
  const startTime = Date.now();
  const {
    userId = 'default',
    verbose = false,
    maxPlugins = 5
  } = context;

  const trace = [];
  const results = {};
  const log = (step, data) => {
    trace.push({ step, data, time: Date.now() - startTime });
    if (verbose) console.log(`[Think] ${step}:`, data);
  };

  try {
    // ========================================
    // STEP 1: Detect which plugins to activate
    // ========================================
    const activePlugins = detectActivePlugins(input);
    log('active_plugins', activePlugins.map(p => p.name));

    // ========================================
    // STEP 2: Run memory plugin first (always)
    // ========================================
    let memoryContext = '';
    const memoryPlugin = pluginRegistry.memory?.memgpt;
    if (memoryPlugin) {
      try {
        const memResult = await memoryPlugin.handler(input, context);
        if (memResult.core?.facts?.length > 0) {
          memoryContext = `\n[Memory]\nFacts: ${memResult.core.facts.slice(0, 5).join('; ')}`;
        }
        results.memory = memResult;
        log('memory', 'loaded');
      } catch (e) {
        log('memory_error', e.message);
      }
    }

    // ========================================
    // STEP 3: Run grounding plugins (web, verify)
    // ========================================
    let groundedData = null;
    let verificationData = null;

    for (const plugin of activePlugins.filter(p => p.category === 'grounding')) {
      try {
        log('grounding', plugin.name);
        const result = await plugin.handler(input, { ...context, memoryContext });
        results[plugin.name] = result;

        if (plugin.capabilities.includes('web_search')) {
          groundedData = result;
        }
        if (plugin.capabilities.includes('fact_check')) {
          verificationData = result;
        }
      } catch (e) {
        log(`${plugin.name}_error`, e.message);
      }
    }

    // ========================================
    // STEP 4: Run execution plugins (code)
    // ========================================
    let codeResult = null;
    for (const plugin of activePlugins.filter(p => p.category === 'execution')) {
      try {
        log('execution', plugin.name);
        const result = await plugin.handler(input, { ...context, memoryContext });
        results[plugin.name] = result;

        if (plugin.capabilities.includes('code_execution')) {
          codeResult = result;
        }
      } catch (e) {
        log(`${plugin.name}_error`, e.message);
      }
    }

    // ========================================
    // STEP 5: Run reasoning/agent plugins
    // ========================================
    let reasoningResult = null;
    const reasoningPlugins = activePlugins.filter(p =>
      p.category === 'reasoning' || p.category === 'agents'
    ).slice(0, 2); // Max 2 reasoning systems

    for (const plugin of reasoningPlugins) {
      try {
        log('reasoning', plugin.name);
        const result = await plugin.handler(input, {
          ...context,
          memoryContext,
          groundedData: groundedData?.answer,
          verificationData
        });
        results[plugin.name] = result;
        reasoningResult = result;
      } catch (e) {
        log(`${plugin.name}_error`, e.message);
      }
    }

    // ========================================
    // STEP 6: Generate unified response
    // ========================================
    let response = null;

    // Use reasoning result if available
    if (reasoningResult?.final) {
      response = reasoningResult.final;
    } else if (reasoningResult?.result) {
      response = reasoningResult.result;
    } else if (reasoningResult?.bestPath?.conclusion) {
      response = reasoningResult.bestPath.conclusion;
    }

    // If no reasoning result, synthesize from grounding/execution
    if (!response) {
      let enhancedPrompt = input;

      if (groundedData?.answer) {
        enhancedPrompt += `\n\n[Web Research]\n${groundedData.answer}`;
        if (groundedData.citations?.length > 0) {
          enhancedPrompt += `\nSources: ${groundedData.citations.slice(0, 3).join(', ')}`;
        }
      }

      if (verificationData?.verdict) {
        enhancedPrompt += `\n\n[Verification]\n${verificationData.verdict} (${Math.round((verificationData.confidence || 0) * 100)}% confidence)`;
      }

      if (codeResult) {
        enhancedPrompt += `\n\n[Code]\n${codeResult.success ? 'Success' : 'Failed'}: ${codeResult.output || codeResult.error || 'No output'}`;
        if (codeResult.generatedCode) {
          enhancedPrompt += `\n\`\`\`${codeResult.language || 'javascript'}\n${codeResult.generatedCode}\n\`\`\``;
        }
      }

      if (memoryContext) {
        enhancedPrompt += memoryContext;
      }

      response = await ai.askClaude(enhancedPrompt, {
        system: 'You are a helpful AI. Use the provided context (research, verification, code, memory) to give accurate responses. Be concise.'
      });
    }

    // ========================================
    // STEP 7: Store in memory
    // ========================================
    if (memoryPlugin?.module?.addToWorking) {
      try {
        await memoryPlugin.module.addToWorking({
          type: 'response',
          query: input.substring(0, 200),
          plugins: activePlugins.map(p => p.name),
          timestamp: new Date().toISOString()
        });
      } catch (e) {}
    }

    // ========================================
    // RETURN UNIFIED RESULT
    // ========================================
    return {
      response,
      meta: {
        pluginsUsed: activePlugins.map(p => p.name),
        grounded: !!groundedData,
        verified: !!verificationData,
        codeExecuted: !!codeResult,
        timeMs: Date.now() - startTime
      },
      data: {
        grounding: groundedData ? {
          answer: groundedData.answer,
          citations: groundedData.citations
        } : null,
        verification: verificationData ? {
          verdict: verificationData.verdict,
          confidence: verificationData.confidence
        } : null,
        code: codeResult ? {
          success: codeResult.success,
          output: codeResult.output,
          generatedCode: codeResult.generatedCode
        } : null
      },
      trace: verbose ? trace : undefined
    };

  } catch (error) {
    return {
      response: null,
      error: error.message,
      meta: { timeMs: Date.now() - startTime },
      trace: verbose ? trace : undefined
    };
  }
}

// ============================================================================
// PLUGIN DETECTION
// ============================================================================

/**
 * Detect which plugins should be activated for this input
 */
function detectActivePlugins(input) {
  const active = [];
  const seen = new Set();

  // Check each registered plugin's intent patterns
  for (const category of Object.values(pluginRegistry)) {
    for (const plugin of Object.values(category)) {
      if (seen.has(plugin.name)) continue;

      // Check if any intent pattern matches
      const patterns = intentPatterns[plugin.name] || [];
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          active.push(plugin);
          seen.add(plugin.name);
          break;
        }
      }
    }
  }

  // Sort by priority (highest first)
  active.sort((a, b) => b.priority - a.priority);

  return active;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractClaim(input) {
  return input
    .replace(/^(is it true that|can you verify|fact check:?)\s*/i, '')
    .replace(/\?+$/, '')
    .trim() || input;
}

function detectLanguage(input) {
  const lower = input.toLowerCase();
  if (/\b(python|py|pandas|numpy)\b/.test(lower)) return 'python';
  if (/\b(bash|shell|sh|terminal)\b/.test(lower)) return 'bash';
  return 'javascript';
}

// ============================================================================
// QUICK METHODS
// ============================================================================

export async function groundedThink(input, context = {}) {
  const perp = pluginRegistry.grounding?.perplexity;
  if (!perp) throw new Error('Perplexity not registered');

  const grounded = await perp.handler(input, context);
  const response = await ai.askClaude(
    `Based on this research:\n${grounded.answer}\n\nAnswer: ${input}`
  );

  return { response, citations: grounded.citations, grounded: grounded.grounded };
}

export async function verifiedThink(claim, context = {}) {
  const verify = pluginRegistry.grounding?.['multi-source-verify'];
  if (!verify) throw new Error('Multi-source verify not registered');

  return verify.handler(claim, context);
}

export async function codeThink(description, language = 'javascript', context = {}) {
  const sandbox = pluginRegistry.execution?.['code-sandbox'];
  if (!sandbox) throw new Error('Code sandbox not registered');

  return sandbox.module.generateAndRun(description, language);
}

export async function deepThink(task, context = {}) {
  const crew = pluginRegistry.agents?.['crew-ai'];
  if (!crew) throw new Error('CrewAI not registered');

  return crew.handler(task, context);
}

// ============================================================================
// STATUS & REGISTRY ACCESS
// ============================================================================

export function getStatus() {
  const categories = {};
  for (const [cat, plugins] of Object.entries(pluginRegistry)) {
    categories[cat] = Object.keys(plugins);
  }

  return {
    orchestrator: true,
    autoRouting: true,
    pluginArchitecture: true,
    categories,
    totalPlugins: Object.values(pluginRegistry).reduce((sum, cat) => sum + Object.keys(cat).length, 0),
    capabilities: Object.keys(capabilityHandlers),
    ready: true
  };
}

export function getRegisteredPlugins() {
  return pluginRegistry;
}

export function getCapabilities() {
  return Object.keys(capabilityHandlers);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  think,
  groundedThink,
  verifiedThink,
  codeThink,
  deepThink,
  registerPlugin,
  getStatus,
  getRegisteredPlugins,
  getCapabilities
};
