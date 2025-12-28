# Railway Deployment Guide

## Quick Deploy (5 minutes)

### Step 1: Go to Railway
Open: https://railway.app/new

### Step 2: Deploy from GitHub
1. Click **"Deploy from GitHub repo"**
2. Authorize Railway to access your GitHub (if not already)
3. Search for and select: `sabriotcore-code/cloud-orchestrator`
4. Click **"Deploy Now"**

### Step 3: Add PostgreSQL Database
1. In your new project, click **"+ New"** button
2. Select **"Database"** → **"Add PostgreSQL"**
3. Wait for database to provision (~30 seconds)

### Step 4: Configure Environment Variables
1. Click on your **cloud-orchestrator** service
2. Go to **"Variables"** tab
3. Add these variables (get keys from your .env file or password manager):
   ```
   ANTHROPIC_API_KEY = your-anthropic-key
   OPENAI_API_KEY = your-openai-key
   GEMINI_API_KEY = your-gemini-key
   NODE_ENV = production
   ```

### Step 5: Link Database
Railway should auto-link the DATABASE_URL, but verify:
1. Go to **Variables** → **Reference Variables**
2. Ensure `DATABASE_URL` references the PostgreSQL database

### Step 6: Get Your URL
1. Go to **Settings** → **Networking**
2. Click **"Generate Domain"** to get a public URL
3. Your API will be at: `https://your-app.railway.app`

### Step 7: Run Database Migrations
Option A (Railway Shell):
1. Go to your service → **"Deployments"** tab
2. Click **"View Logs"** → **"Shell"**
3. Run: `npm run db:migrate`

Option B (Redeploy with migration):
Add to package.json start script: `"start": "node src/db/migrate.js && node src/server.js"`

---

## Test Your Deployment

```bash
# Health check
curl https://your-app.railway.app/health

# Test review endpoint
curl -X POST https://your-app.railway.app/review \
  -H "Content-Type: application/json" \
  -d '{"content": "function add(a,b){return a+b}", "mode": "review"}'
```

---

## Troubleshooting

### "Build Failed"
- Check Railway logs for errors
- Ensure package.json has correct start command

### "Database Connection Error"
- Verify DATABASE_URL is set in Variables
- Make sure PostgreSQL addon is running

### "API Key Error"
- Double-check all 3 API keys are set correctly
- No quotes needed in Railway variables

---

## Cost Estimate

Railway Free Tier:
- $5/month credit (sufficient for testing)
- 512MB RAM, shared CPU

For production:
- Hobby plan: $5/month
- PostgreSQL: $5/month
- **Total: ~$10/month**
