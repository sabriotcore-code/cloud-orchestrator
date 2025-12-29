import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const migrations = [
  // Conversations table - stores chat history and context
  `CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Tasks table - task queue for async processing
  `CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    input JSONB NOT NULL,
    output JSONB,
    error TEXT,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
  )`,

  // AI Responses table - stores individual AI responses for consensus
  `CREATE TABLE IF NOT EXISTS ai_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('claude', 'gpt', 'gemini')),
    response TEXT,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    latency_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Consensus results table - stores the final consensus decision
  `CREATE TABLE IF NOT EXISTS consensus_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    method VARCHAR(30) NOT NULL CHECK (method IN ('majority', 'weighted', 'best_of')),
    winner VARCHAR(20),
    final_response TEXT,
    scores JSONB,
    reasoning TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Memory table - persistent key-value store for context
  `CREATE TABLE IF NOT EXISTS memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    category VARCHAR(50) DEFAULT 'general',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Usage logs table - tracks API usage and costs
  `CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    endpoint VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Health checks table - system health monitoring
  `CREATE TABLE IF NOT EXISTS health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'warning', 'critical')),
    message TEXT,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Change history table - tracks all bot code changes for rollback
  `CREATE TABLE IF NOT EXISTS change_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo VARCHAR(255) NOT NULL,
    path VARCHAR(500) NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    old_content TEXT,
    new_content TEXT,
    message TEXT,
    user_id VARCHAR(100),
    commit_sha VARCHAR(40),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`,

  // Create indexes for performance
  `CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_responses_task ON ai_responses(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON usage_logs(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_change_history_repo ON change_history(repo)`,
  `CREATE INDEX IF NOT EXISTS idx_change_history_path ON change_history(repo, path)`,
  `CREATE INDEX IF NOT EXISTS idx_change_history_created ON change_history(created_at DESC)`
];

async function migrate() {
  console.log('Starting database migration...\n');

  const client = await pool.connect();

  try {
    for (const sql of migrations) {
      const tableName = sql.match(/(?:TABLE|INDEX)(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/i)?.[1] || 'unknown';
      process.stdout.write(`  Creating ${tableName}... `);
      await client.query(sql);
      console.log('OK');
    }

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('\nMigration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
