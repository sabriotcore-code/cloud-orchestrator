# AI Orchestrator System Architecture

## ONE-PAGE OVERVIEW

```
                                    MATT'S AI ECOSYSTEM
    ============================================================================

                                      [SLACK]
                                         |
                           /ask /review /do /repos /files
                                         |
                                         v
    ============================================================================
    |                        CLOUD ORCHESTRATOR (Railway)                       |
    |                     https://web-production-bdfb4.up.railway.app           |
    |---------------------------------------------------------------------------|
    |                                                                           |
    |   +-------------+     +-------------+     +-------------+                 |
    |   |   CLAUDE    |     |   GPT-4o    |     |   GEMINI    |                 |
    |   | (Anthropic) |     |  (OpenAI)   |     |  (Google)   |                 |
    |   +------+------+     +------+------+     +------+------+                 |
    |          |                   |                   |                        |
    |          +-------------------+-------------------+                        |
    |                              |                                            |
    |                     [CONSENSUS ENGINE]                                    |
    |                     Weighted | Fastest | Priority                         |
    |                                                                           |
    |---------------------------------------------------------------------------|
    |                                                                           |
    |   +-------------+     +-------------+     +-------------+                 |
    |   |   GITHUB    |     | WEB SEARCH  |     |   GOOGLE    |                 |
    |   |  Read/Write |     | DuckDuckGo  |     |   Sheets    |                 |
    |   +-------------+     +-------------+     +-------------+                 |
    |                                                                           |
    |   +-------------+     +-------------+                                     |
    |   |   MEMORY    |     | POSTGRESQL  |                                     |
    |   | Key-Value   |     | Persistence |                                     |
    |   +-------------+     +-------------+                                     |
    |                                                                           |
    ============================================================================
                                         |
              +--------------------------+---------------------------+
              |                          |                           |
              v                          v                           v
    +------------------+      +-------------------+      +-------------------+
    |     GITHUB       |      |   GOOGLE CLOUD    |      |    LOCAL (PC)     |
    |  Repositories    |      |     Services      |      |   Claude Code     |
    +------------------+      +-------------------+      +-------------------+
    | cloud-orchestr.. |      | Sheets API        |      | MCP: gdrive       |
    | rei-dashboard    |      | Drive API         |      | MCP: gmail        |
    | ai-orchestrator  |      | Calendar API      |      | MCP: calendar     |
    | rei-automation   |      | Docs API          |      | Git operations    |
    +------------------+      +-------------------+      +-------------------+
```

---

## COMPONENT BREAKDOWN

### 1. ENTRY POINTS

| Entry Point | Type | Description |
|-------------|------|-------------|
| Slack | User Interface | Commands via /do, /ask, /repos, etc. |
| Railway API | HTTP REST | Direct API calls to endpoints |
| Claude Code | Local CLI | Full dev access with MCP tools |

---

### 2. CLOUD ORCHESTRATOR (Railway)

**URL:** `https://web-production-bdfb4.up.railway.app`
**Repo:** `sabriotcore-code/cloud-orchestrator`

#### API Endpoints:
```
GET  /health              - System status
POST /ai/:provider        - Single AI query (claude, gpt, gemini)
POST /ai/all              - Query all 3 AIs in parallel
POST /ai/consensus        - Multi-AI with consensus
POST /review              - Code review panel
POST /chat                - Chat with memory
GET  /github/repos        - List repositories
GET  /github/search       - Search code
POST /slack/commands      - Slack slash commands
```

#### Slack Commands:
```
AI Commands:
  /ask <question>         - Ask all 3 AIs
  /review <code>          - Code review
  /challenge <approach>   - Challenge mode
  /consensus <question>   - Build consensus
  /health                 - System status
  /usage                  - Usage stats

GitHub Commands:
  /repos                  - List all repos
  /commits owner/repo     - Recent commits
  /files owner/repo       - List files
  /readfile owner/repo path - Read file
  /issues owner/repo      - Open issues
  /codesearch <query>     - Search code

Master Command:
  /do <natural language>  - AI routes to correct action
```

---

### 3. AI LAYER

```
+------------------------------------------------------------------+
|                         AI SERVICES                               |
+------------------------------------------------------------------+
|                                                                  |
|  CLAUDE (Anthropic)          GPT-4o (OpenAI)      GEMINI (Google)|
|  Model: claude-sonnet-4      Model: gpt-4o        Model: gemini-2.0-flash
|  Cost: $3/$15 per 1M         Cost: $2.5/$10      Cost: $0.10/$0.40
|  Strength: Reasoning         Strength: General   Strength: Speed
|                                                                  |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                      CONSENSUS ENGINE                             |
+------------------------------------------------------------------+
| Methods:                                                          |
|   - WEIGHTED: Claude synthesizes all responses                   |
|   - FASTEST: Return quickest response                            |
|   - PRIORITY: Claude > GPT > Gemini fallback                     |
+------------------------------------------------------------------+
```

---

### 4. DATA LAYER

```
+------------------------------------------------------------------+
|                      POSTGRESQL (Railway)                         |
+------------------------------------------------------------------+
| Tables:                                                           |
|   - conversations    : Chat history per session                   |
|   - messages         : Individual messages                        |
|   - tasks            : Async task queue                           |
|   - memory           : Key-value store                            |
|   - usage_logs       : API usage tracking                         |
|   - ai_responses     : Cached AI responses                        |
+------------------------------------------------------------------+
```

---

### 5. INTEGRATIONS

#### GitHub Integration:
```
Token: GITHUB_TOKEN (ghp_...)
Capabilities:
  READ:
    - List repos
    - List files
    - Read file contents
    - Get commits
    - List issues/PRs
    - Search code
  WRITE:
    - Create issues
    - Create/update files
    - Commit changes
```

#### Google Integration:
```
Service Account: orchestrator-bot@ai-orchestrator-482702.iam.gserviceaccount.com

APIs Enabled:
  - Google Sheets API    : Read/write spreadsheets
  - Google Drive API     : File management
  - Google Docs API      : Document editing
  - Google Calendar API  : Event management
  - Gmail API            : Email access
  - Google Slides API    : Presentations
  - Tasks API            : Task management
  - People API           : Contacts
  - Places API           : Location data
  - Geocoding API        : Address lookup
  - Cloud Vision API     : Image analysis
  - Vertex AI API        : Google AI models
```

#### Web Search:
```
Service: DuckDuckGo Instant Answer API
Features:
  - No API key required
  - Free unlimited queries
  - Returns summaries and related topics
```

---

### 6. ENVIRONMENT VARIABLES (Railway)

```
# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIzaSy...

# Database
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# GitHub
GITHUB_TOKEN=ghp_...

# Google
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Server
NODE_ENV=production
```

---

### 7. LOCAL DEVELOPMENT (Claude Code)

```
+------------------------------------------------------------------+
|                    CLAUDE CODE (Local PC)                         |
+------------------------------------------------------------------+
| Location: C:\Users\matt\                                          |
|                                                                   |
| MCP Servers:                                                      |
|   - gdrive   : Google Drive access                               |
|   - gmail    : Email management                                   |
|   - calendar : Calendar events                                    |
|                                                                   |
| Capabilities:                                                     |
|   - Full file system access                                       |
|   - Git operations                                                |
|   - Bash commands                                                 |
|   - Code editing                                                  |
|   - Web search/fetch                                              |
|                                                                   |
| Projects:                                                         |
|   - C:\Users\matt\cloud-orchestrator                              |
|   - C:\Users\matt\rei-dashboard                                   |
|   - C:\Users\matt\ai-orchestrator                                 |
+------------------------------------------------------------------+
```

---

### 8. DATA FLOW

```
User Request Flow:
==================

[User types /do show my repos in Slack]
              |
              v
[Slack sends POST to /slack/commands]
              |
              v
[Server receives command + user info]
              |
              v
[handleMasterCommand() invoked]
              |
              v
[Claude analyzes intent → returns JSON]
  {"action": "REPOS", "params": {}}
              |
              v
[github.listRepos() called]
              |
              v
[GitHub API returns repo list]
              |
              v
[formatSlackResponse() formats output]
              |
              v
[Response sent to Slack response_url]
              |
              v
[User sees formatted repo list]


AI Consensus Flow:
==================

[User asks question via /ask]
              |
              v
[askAll() queries 3 AIs in parallel]
              |
    +---------+---------+
    |         |         |
    v         v         v
[Claude]  [GPT-4o]  [Gemini]
    |         |         |
    +---------+---------+
              |
              v
[buildConsensus() synthesizes]
              |
              v
[Claude creates unified answer]
              |
              v
[Response returned to user]
```

---

### 9. REPOSITORY STRUCTURE

```
cloud-orchestrator/
├── src/
│   ├── server.js           # Main Express server
│   ├── db/
│   │   ├── index.js        # Database functions
│   │   └── migrate.js      # Schema migrations
│   └── services/
│       ├── ai.js           # AI providers (Claude, GPT, Gemini)
│       ├── github.js       # GitHub API integration
│       ├── google.js       # Google services
│       ├── web.js          # Web search
│       ├── memory.js       # Conversation memory
│       └── slack.js        # Slack bot handlers
├── package.json
├── railway.json            # Railway config
├── Procfile               # Process file
├── .env.example           # Environment template
├── DEPLOY.md              # Deployment guide
└── ARCHITECTURE.md        # This file
```

---

### 10. CAPABILITIES MATRIX

| Capability | Slack Bot | Claude Code | API |
|------------|-----------|-------------|-----|
| Query 3 AIs | ✅ | ✅ | ✅ |
| Build Consensus | ✅ | ✅ | ✅ |
| Read GitHub | ✅ | ✅ | ✅ |
| Write GitHub | ✅ | ✅ | ✅ |
| Web Search | ✅ | ✅ | ✅ |
| Memory/History | ✅ | ✅ | ✅ |
| Read Sheets | ✅ | ✅ | ✅ |
| Write Sheets | ⏳ | ✅ | ⏳ |
| Read Drive | ⏳ | ✅ | ⏳ |
| Send Email | ❌ | ✅ | ❌ |
| Manage Calendar | ❌ | ✅ | ❌ |
| Edit Local Files | ❌ | ✅ | ❌ |
| Run Commands | ❌ | ✅ | ❌ |

Legend: ✅ = Available, ⏳ = Partial, ❌ = Not Available

---

## NEXT STEPS

1. **Enhance Google Integration** - Full Drive/Sheets write access via service account
2. **Add More /do Actions** - Calendar, Drive operations
3. **Build Webhooks** - Receive GitHub/Google notifications
4. **Create Dashboard** - Web UI for monitoring
5. **Add Authentication** - Secure API endpoints
