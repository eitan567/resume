// Shared Turso (libSQL) client + schema. Files prefixed with "_" are NOT routed
// by Vercel, so this is a plain module imported by the API functions.
//
// Turso is SQLite hosted in the cloud, so unlike a local .db file it persists
// across Vercel's stateless serverless invocations. Configure two env vars:
//   TURSO_DATABASE_URL  (e.g. libsql://your-db.turso.io)
//   TURSO_AUTH_TOKEN    (the database token)
//
// We use the "/web" client (pure JS over HTTP) — no native bindings, which is
// the safe choice on serverless.

let _clientPromise = null;
let _schemaReady = false;

async function ensureSchema(db) {
  if (_schemaReady) return;
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS narration (
        lang TEXT PRIMARY KEY,
        script TEXT NOT NULL DEFAULT '[]',
        audio_url TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT,
        lang TEXT,
        question TEXT,
        answer TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS contact_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        phone TEXT,
        message TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        lang TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      )`,
    ],
    "write"
  );
  _schemaReady = true;
}

async function getDb() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL is not configured");
  }
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const { createClient } = await import("@libsql/client/web");
      const db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      await ensureSchema(db);
      return db;
    })().catch((e) => {
      _clientPromise = null; // allow retry on next request
      throw e;
    });
  }
  return _clientPromise;
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
