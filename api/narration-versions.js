// Narration version management (single endpoint, POST { action, lang, ... }):
//   list            → live versions for a language
//   listArchive     → archived versions
//   activate        → make a live version active
//   activateArchive → bring an archived version back as active (oldest live
//                     version is moved to the archive to keep within the cap)
//   saveAudio       → store the recording (segments + merged url) on the active
//                     version (recording does NOT create a new version)

const { getDb } = require("./_db");

const MAX_VERSIONS = 6;

function parseJson(v, fallback) {
  try { return JSON.parse(v || ""); } catch { return fallback; }
}
function summarize(row) {
  const seg = parseJson(row.segments, []);
  const script = parseJson(row.script, []);
  return {
    id: row.id,
    versionNo: row.version_no || null,
    name: row.name || null,
    createdAt: row.created_at,
    active: !!row.active,
    hasAudio: !!row.audio_url,
    chunks: seg.length,
    recordedChunks: seg.filter((s) => s.url).length,
    preview: (script[0] || "").slice(0, 80),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const action = String(body.action || "");
    const code = body.lang === "en" ? "en" : "he";
    const db = await getDb();

    if (action === "getPrompt") {
      const r = await db.query("SELECT value FROM app_settings WHERE key = $1", ["script_prompt_" + code]);
      res.status(200).json({ ok: true, prompt: r.rows.length ? (r.rows[0].value || "") : "" });
      return;
    }

    if (action === "setPrompt") {
      const prompt = String(body.prompt || "").slice(0, 2000);
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        ["script_prompt_" + code, prompt]
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "list") {
      const r = await db.query(
        `SELECT id, version_no, name, script, segments, audio_url, active, created_at
           FROM narration_versions WHERE lang = $1 ORDER BY id DESC`,
        [code]
      );
      res.status(200).json({ ok: true, versions: r.rows.map(summarize) });
      return;
    }

    if (action === "listArchive") {
      const r = await db.query(
        `SELECT id, version_no, name, script, segments, audio_url, false AS active, created_at
           FROM narration_versions_archive WHERE lang = $1 ORDER BY id DESC`,
        [code]
      );
      res.status(200).json({ ok: true, versions: r.rows.map(summarize) });
      return;
    }

    if (action === "create") {
      const name = String(body.name || "").slice(0, 80).trim();
      if (!name) { res.status(400).json({ error: "חובה להזין שם לגרסה." }); return; }
      const mx = await db.query(
        `SELECT COALESCE(MAX(version_no), 0) m FROM (
           SELECT version_no FROM narration_versions WHERE lang = $1
           UNION ALL SELECT version_no FROM narration_versions_archive WHERE lang = $1
         ) t`,
        [code]
      );
      const versionNo = (mx.rows[0].m || 0) + 1;
      const now = new Date().toISOString();
      await db.query(`UPDATE narration_versions SET active = false WHERE lang = $1`, [code]);
      const ins = await db.query(
        `INSERT INTO narration_versions (lang, version_no, name, script, segments, audio_url, active, created_at)
         VALUES ($1, $2, $3, '[]', '[]', NULL, true, $4)
         RETURNING id, version_no, name, script, segments, audio_url`,
        [code, versionNo, name, now]
      );
      // Enforce the live-version cap: archive the oldest beyond it.
      const all = await db.query(`SELECT id FROM narration_versions WHERE lang = $1 ORDER BY id ASC`, [code]);
      const overflow = all.rows.length - MAX_VERSIONS;
      if (overflow > 0) {
        const oldIds = all.rows.slice(0, overflow).map((r) => r.id);
        await db.query(
          `INSERT INTO narration_versions_archive (lang, version_no, name, script, segments, audio_url, created_at)
           SELECT lang, version_no, name, script, segments, audio_url, created_at FROM narration_versions
            WHERE id = ANY($1::int[])`,
          [oldIds]
        );
        await db.query(`DELETE FROM narration_versions WHERE id = ANY($1::int[])`, [oldIds]);
      }
      const row = ins.rows[0];
      res.status(200).json({
        ok: true,
        version: { id: row.id, versionNo: row.version_no, name: row.name, script: [], segments: [], audioUrl: null },
      });
      return;
    }

    if (action === "activate") {
      const id = parseInt(body.id, 10);
      if (!id) { res.status(400).json({ error: "missing id" }); return; }
      await db.query(`UPDATE narration_versions SET active = false WHERE lang = $1`, [code]);
      await db.query(`UPDATE narration_versions SET active = true WHERE id = $1 AND lang = $2`, [id, code]);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "saveAudio") {
      const id = parseInt(body.id, 10);
      if (!id) { res.status(400).json({ error: "missing id" }); return; }
      const segments = Array.isArray(body.segments) ? body.segments : [];
      const audioUrl = body.audioUrl ? String(body.audioUrl) : null;
      const r = await db.query(
        `UPDATE narration_versions SET segments = $1, audio_url = $2
          WHERE id = $3 AND lang = $4
        RETURNING id, script, segments, audio_url`,
        [JSON.stringify(segments), audioUrl, id, code]
      );
      if (!r.rows.length) { res.status(404).json({ error: "version not found" }); return; }
      const row = r.rows[0];
      res.status(200).json({
        ok: true,
        version: {
          id: row.id,
          script: parseJson(row.script, []),
          segments: parseJson(row.segments, []),
          audioUrl: row.audio_url || null,
        },
      });
      return;
    }

    if (action === "activateArchive") {
      const id = parseInt(body.id, 10);
      if (!id) { res.status(400).json({ error: "missing id" }); return; }
      const a = await db.query(
        `SELECT lang, version_no, name, script, segments, audio_url, created_at
           FROM narration_versions_archive WHERE id = $1 AND lang = $2`,
        [id, code]
      );
      if (!a.rows.length) { res.status(404).json({ error: "archived version not found" }); return; }
      const av = a.rows[0];

      // Make room: if live versions are at the cap, move the oldest live one to
      // the archive (it takes the activated version's place).
      const live = await db.query(
        `SELECT id, lang, version_no, name, script, segments, audio_url, created_at
           FROM narration_versions WHERE lang = $1 ORDER BY id ASC`,
        [code]
      );
      if (live.rows.length >= MAX_VERSIONS) {
        const oldest = live.rows[0];
        await db.query(
          `INSERT INTO narration_versions_archive (lang, version_no, name, script, segments, audio_url, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [oldest.lang, oldest.version_no, oldest.name, oldest.script, oldest.segments, oldest.audio_url, oldest.created_at]
        );
        await db.query(`DELETE FROM narration_versions WHERE id = $1`, [oldest.id]);
      }

      // Move the archived version into the live table as the active one.
      await db.query(`UPDATE narration_versions SET active = false WHERE lang = $1`, [code]);
      await db.query(
        `INSERT INTO narration_versions (lang, version_no, name, script, segments, audio_url, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
        [av.lang, av.version_no, av.name, av.script, av.segments, av.audio_url, av.created_at]
      );
      await db.query(`DELETE FROM narration_versions_archive WHERE id = $1`, [id]);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "unknown action" });
  } catch (error) {
    console.error("narration versions error:", error);
    res.status(500).json({ error: "שגיאה בניהול גרסאות.", details: String((error && error.message) || error) });
  }
};
