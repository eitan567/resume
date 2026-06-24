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
  // Narration versions. A version = a script + its recording (per-chunk audio
  // segments + a stitched merged file). Up to 6 live versions per language; older
  // ones move to the archive table.
  await db.query(`CREATE TABLE IF NOT EXISTS narration_versions (
    id SERIAL PRIMARY KEY,
    lang TEXT NOT NULL,
    version_no INTEGER,
    name TEXT,
    script TEXT NOT NULL DEFAULT '[]',
    segments TEXT NOT NULL DEFAULT '[]',
    audio_url TEXT,
    active BOOLEAN NOT NULL DEFAULT false,
    created_at TEXT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS narration_versions_archive (
    id SERIAL PRIMARY KEY,
    lang TEXT NOT NULL,
    version_no INTEGER,
    name TEXT,
    script TEXT NOT NULL DEFAULT '[]',
    segments TEXT NOT NULL DEFAULT '[]',
    audio_url TEXT,
    created_at TEXT NOT NULL
  )`);
  // Add the version_no/name columns to pre-existing tables, then backfill numbers.
  for (const t of ["narration_versions", "narration_versions_archive"]) {
    await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS version_no INTEGER`);
    await db.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS name TEXT`);
  }
  await db.query(`UPDATE narration_versions v SET version_no = s.rn
    FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY lang ORDER BY id) rn
            FROM narration_versions WHERE version_no IS NULL) s
   WHERE v.id = s.id AND v.version_no IS NULL`);
  // Generic key/value store for small persisted settings (e.g. the per-language
  // AI script-generation instruction).
  await db.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT
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

// Merge paragraphs into the fewest chunks under maxChars (one chunk = one Live
// turn = one audio segment). MUST match the client's mergeChunks exactly so that
// segment boundaries (and audio reuse) line up. The cap is driven by the Live
// model's per-turn audio limit, NOT by the paragraph count — keep it as large as
// the engine reliably handles so the recording has as few seams as possible.
const REC_CHUNK_MAX = 1800;
function mergeChunks(paragraphs, maxChars) {
  maxChars = maxChars || REC_CHUNK_MAX;
  const out = [];
  let cur = "";
  for (const p of paragraphs) {
    const joined = cur ? cur + "\n" + p : p;
    if (cur && joined.length > maxChars) { out.push(cur); cur = p; }
    else cur = joined;
  }
  if (cur) out.push(cur);
  return out;
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

module.exports = { getDb, safe, mergeChunks, REC_CHUNK_MAX };
