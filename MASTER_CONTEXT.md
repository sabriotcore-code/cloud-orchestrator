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

### REI Realty Business Model: SELLER-FINANCED NOTE PORTFOLIO
REI Realty is NOT a traditional landlord or property flipper. They operate a **seller-financed receivables business**:

1. **Acquire** properties (purchase, foreclosure, tax sales)
2. **Sell** on installment contracts (land contracts / contracts for deed)
3. **Act as THE LENDER** - collect monthly payments from buyers
4. **Retain some as rentals** (RNT properties)

### Portfolio Breakdown (235 properties)
| Category | Count | % | Description |
|----------|-------|---|-------------|
| CURRENT | 106 | 45% | Buyers paying on schedule |
| CURRENT! | 30 | 13% | Current with notation |
| LATE_* | 41 | 17% | Behind on payments (14-59 days) |
| RNT ACT | 26 | 11% | Active rentals |
| RNT VAC | 10 | 4% | Vacant rentals |
| MAN.REV | 13 | 6% | Need manual review |
| Other | 9 | 4% | PRE PAY, PAID OFF, etc. |

### Loan ID = Contract Portfolio Groups
The "loan" field is an INTERNAL CONTRACT ID, not a bank loan:
- **1980**: 60 properties (largest segment)
- **3409**: 39 properties
- **F&C**: 24 properties (Free & Clear - owned outright)
- **7346, 5656, 3294**: 12 each
- Numbers likely represent funding sources, acquisition batches, or servicer groups

### Status Codes Decoded
| Code | Meaning |
|------|---------|
| CURRENT | Buyer paying on schedule |
| CURRENT! | Current with flag/note |
| LATE_XX | XX days behind on payment |
| RNT ACT | Active rental (retained) |
| RNT VAC | Vacant rental |
| RNT HLD | Rental on hold |
| MAN.REV | Manual review needed |
| PRE PAY | About to pay off contract |
| PAID OFF | Contract fulfilled |
| F&C | Free & Clear |

### Key Metrics to Track
- **Collection Rate**: % of payments received on time
- **Days Late Aging**: 14 → 30 → 59 → foreclosure
- **Portfolio by Loan ID**: Grouping for lender/funding source tracking
- **Rental Occupancy**: RNT ACT vs RNT VAC
- **Pipeline**: MAN.REV → resolution tracking

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
