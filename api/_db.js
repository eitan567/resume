// Shared Vercel Postgres (Neon) connection + schema. Files prefixed with "_" are
// NOT routed by Vercel, so this is a plain module imported by the API functions.
//
// Add the Postgres/Neon integration from the Vercel dashboard — it injects the
// connection string env var automatically (POSTGRES_URL). No manual setup beyond
// connecting the database.
//
// getDb() returns a pool whose .query(text, params) uses $1, $2 placeholders.

let _poolPromise = null;
let _schemaReady = false;

function connectionString() {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

async function ensureSchema(db) {
  if (_schemaReady) return;
  await db.query(`CREATE TABLE IF NOT EXISTS narration (
    lang TEXT PRIMARY KEY,
    script TEXT NOT NULL DEFAULT '[]',
    audio_url TEXT,
    updated_at TEXT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS chat_logs (
    id SERIAL PRIMARY KEY,
    ip TEXT,
    lang TEXT,
    question TEXT,
    answer TEXT,
    created_at TEXT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS contact_submissions (
    id SERIAL PRIMARY KEY,
    name TEXT,
    email TEXT,
    phone TEXT,
    message TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS usage_events (
    id SERIAL PRIMARY KEY,
    event TEXT NOT NULL,
    lang TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  )`);
  _schemaReady = true;
}

async function getDb() {
  const cs = connectionString();
  if (!cs) throw new Error("POSTGRES_URL is not configured");
  if (!_poolPromise) {
    _poolPromise = (async () => {
      const { createPool } = await import("@vercel/postgres");
      const pool = createPool({ connectionString: cs });
      await ensureSchema(pool);
      return pool;
    })().catch((e) => {
      _poolPromise = null; // allow retry on next request
      throw e;
    });
  }
  return _poolPromise;
}

// Best-effort: never let logging/analytics break the main request.
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error("db (non-fatal):", (e && e.message) || e);
    return null;
  }
}

module.exports = { getDb, safe };
