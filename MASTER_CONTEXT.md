# MASTER CONTEXT - AI Orchestrator Knowledge Base
# Last Updated: 2025-12-29
# This file is loaded by the AI on startup and referenced during all conversations

## ARCHITECTURE MODE: BOT OWNS CODE

**All code changes flow through the bot.** No local file editing needed.

```
Matt (Slack/Web/Mobile) ──> Bot ──> GitHub ──> Auto-Deploy
                            │
                   ┌────────┴────────┐
                   │                 │
              Change Log        Rollback
              (History)         (Undo)
```

**Key Principles:**
1. Bot always fetches latest SHA before editing (prevents conflicts)
2. All changes are logged with full history
3. Risky changes require confirmation
4. Rollback available for any change
5. No local files needed - everything via Slack

**New Commands:**
- `/history owner/repo` - View bot's change history
- `/rollback owner/repo file [changeId]` - Undo changes

---

## OWNER
- Name: Matt
- Email: matt@rei-realty.com
- Business: REI Realty (Real Estate Investment)
- GitHub: sabriotcore-code

## CURRENT PROJECTS

### 1. Cloud Orchestrator (ACTIVE)
- **Repo:** sabriotcore-code/cloud-orchestrator
- **URL:** https://web-production-bdfb4.up.railway.app
- **Purpose:** Multi-AI orchestration system - queries Claude, GPT-4o, and Gemini in parallel, builds consensus
- **Stack:** Node.js, Express, PostgreSQL, Railway
- **Status:** LIVE - All features operational
- **Slack Bot:** AI Orchestrator in #all-sabr
- **Key Features:**
  - /do master command with natural language routing
  - GitHub read/write integration
  - Web search
  - Conversation memory
  - Google Sheets access

### 2. REI Dashboard
- **Repo:** sabriotcore-code/rei-dashboard
- **URL:** https://rei-dashboard-15rrr.netlify.app (or similar)
- **Purpose:** Real estate investment dashboard for tracking properties, deals, metrics
- **Stack:** HTML/JS, Netlify hosting
- **Status:** In development
- **Known Issues:** Label Data dropdown not populating

### 3. AI Orchestrator (Local/Legacy)
- **Repo:** sabriotcore-code/ai-orchestrator
- **Location:** C:\Users\matt\ai-orchestrator
- **Purpose:** Original local orchestrator - predecessor to cloud version
- **Status:** Archived - replaced by cloud-orchestrator

### 4. REI Automation
- **Repo:** sabriotcore-code/rei-automation
- **Purpose:** Automation scripts for real estate workflows
- **Status:** Active

## GOOGLE WORKSPACE

### Service Account
- **Email:** orchestrator-bot@ai-orchestrator-482702.iam.gserviceaccount.com
- **Project:** AI-Orchestrator (ai-orchestrator-482702)
- **APIs Enabled:** Sheets, Drive, Gmail, Calendar, Docs, Slides, Tasks, People, Places, Geocoding, Vision, Vertex AI

### Key Spreadsheets
- (Add spreadsheet IDs here as they're used)

## SLACK WORKSPACE

### Bot: AI Orchestrator
- **Commands Available:**
  - /do <natural language> - Master command (Bot Owns Code mode)
  - /ask, /review, /challenge, /consensus - AI queries
  - /repos, /commits, /files, /readfile, /issues, /codesearch - GitHub read
  - /history owner/repo - View bot's change history
  - /rollback owner/repo file [changeId] - Undo changes
  - /health - System status

## CURRENT WORK / RECENT HISTORY

### Session: 2025-12-28
- Built and deployed cloud-orchestrator to Railway
- Set up Slack bot with full command set
- Added GitHub integration (read/write)
- Added web search via DuckDuckGo
- Added conversation memory
- Added Google service account integration
- Created architecture documentation
- Made AI routing smarter (questions vs file listings)

- 2025-12-29: Fixed 1 issues in rei-dashboard
### Pending Tasks
- Enhance Google Drive/Sheets write access
- Add more /do actions for calendar, drive
- Build webhooks for notifications
- Create web dashboard for monitoring
- Add authentication to API

## BUSINESS CONTEXT

### REI Realty Focus Areas
- Property acquisition and analysis
- Deal tracking and pipeline management
- Investment metrics and reporting
- Automation of repetitive tasks
- Multi-AI analysis for decision support

### Key Metrics to Track
- (Add as defined)

## CODING PREFERENCES

- **Language:** JavaScript/Node.js (ES modules)
- **Style:** Clean, documented, error-handled
- **Deployment:** Railway for backend, Netlify for frontend
- **Version Control:** GitHub
- **AI Models:** Claude (primary), GPT-4o, Gemini 2.0 Flash

## INTEGRATIONS MAP

```
Slack ←→ Cloud Orchestrator ←→ GitHub
                ↓
         ┌──────┴──────┐
         ↓             ↓
    PostgreSQL    Google APIs
         ↓             ↓
      Memory      Sheets/Drive
```

## UPDATE LOG

| Date | Update | By |
|------|--------|-----|
| 2025-12-28 | Initial creation | Claude Code |
| | | |

---
*This file is automatically referenced by the AI Orchestrator for context.*
