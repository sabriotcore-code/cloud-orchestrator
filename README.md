# Cloud Orchestrator

Multi-AI orchestration system with PostgreSQL persistence. Runs 24/7 on Railway.

## Quick Deploy to Railway

### Option 1: GitHub Integration (Recommended)

1. Go to [Railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `sabriotcore-code/cloud-orchestrator`
4. Add a PostgreSQL database:
   - Click "New" → "Database" → "PostgreSQL"
5. Set environment variables (in Settings → Variables):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-proj-...
   GEMINI_API_KEY=AIza...
   NODE_ENV=production
   ```
6. Railway auto-deploys on every git push

### Option 2: Railway CLI

```bash
railway login
railway init
railway add --database postgres
railway up
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health check |
| POST | `/ai/claude` | Query Claude only |
| POST | `/ai/gpt` | Query GPT-4o only |
| POST | `/ai/gemini` | Query Gemini only |
| POST | `/ai/all` | Query all 3 AIs in parallel |
| POST | `/ai/consensus` | Multi-AI with consensus |
| POST | `/review` | Code review (like original orchestrator) |
| POST | `/chat` | Chat with memory |
| GET | `/chat/:sessionId` | Get conversation history |
| POST | `/memory` | Store key-value |
| GET | `/memory/:key` | Retrieve value |
| GET | `/usage` | Usage statistics |

## Example Requests

### Multi-AI Review
```bash
curl -X POST https://your-app.railway.app/review \
  -H "Content-Type: application/json" \
  -d '{"content": "Your code or plan here", "mode": "review"}'
```

### Chat with Memory
```bash
curl -X POST https://your-app.railway.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!", "sessionId": "my-session"}'
```

### Consensus Query
```bash
curl -X POST https://your-app.railway.app/ai/consensus \
  -H "Content-Type: application/json" \
  -d '{"content": "What is the best database for this use case?", "consensusMethod": "weighted"}'
```

## Local Development

```bash
# Install dependencies
npm install

# Create .env with your API keys
cp .env.example .env

# Run PostgreSQL locally (Docker)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15

# Set DATABASE_URL
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres

# Run migrations
npm run db:migrate

# Start server
npm start
```

## Database Schema

- `conversations` - Chat history with session support
- `tasks` - Async task queue
- `ai_responses` - Individual AI responses
- `consensus_results` - Consensus decisions
- `memory` - Key-value persistent storage
- `usage_logs` - API usage tracking
- `health_checks` - System health monitoring

## Cost Tracking

Automatic cost tracking per provider:
- Claude Sonnet: $3/1M input, $15/1M output
- GPT-4o: $2.50/1M input, $10/1M output
- Gemini Flash: $0.10/1M input, $0.40/1M output
