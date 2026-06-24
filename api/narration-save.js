// Save a narration SCRIPT for a language.
//
//  - newVersion = true  (a fresh AI generation): create a NEW active version,
//    inheriting per-chunk audio from the previous active version for unchanged
//    chunks. Up to 6 live versions/lang; a 7th archives the oldest.
//  - newVersion = false (a manual edit of the loaded version): update the ACTIVE
//    version IN PLACE — no new version is created.
//
// The merged audio is cleared whenever the chunk set changes (a re-record stitches
// it again). Recording itself never creates a version (see narration-versions).

const { getDb, mergeChunks } = require("./_db");

const MAX_VERSIONS = 6;

function parseJson(v, fallback) {
  try { return JSON.parse(v || ""); } catch { return fallback; }
}
function full(row) {
  return {
    id: row.id,
    versionNo: row.version_no || null,
    name: row.name || null,
    script: parseJson(row.script, []),
    segments: parseJson(row.segments, []),
    audioUrl: row.audio_url || null,
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { lang, script, newVersion } = body;

    const code = lang === "en" ? "en" : "he";
    const scriptArr = Array.isArray(script)
      ? script.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    if (!scriptArr.length) {
      res.status(400).json({ error: "אין תסריט לשמירה." });
      return;
    }
    const now = new Date().toISOString();
    const db = await getDb();

    const cur = await db.query(
      `SELECT id, version_no, name, script, segments, audio_url FROM narration_versions
        WHERE lang = $1 AND active = true ORDER BY id DESC LIMIT 1`,
      [code]
    );
    const active = cur.rows[0] || null;
    const activeScript = active ? parseJson(active.script, []) : [];

    // Compute segments for the new script, inheriting audio (by chunk text) from
    // a baseline segment list.
    const computeSegments = (baseline) => {
      const byText = new Map((baseline || []).map((s) => [s.text, s.url || null]));
      return mergeChunks(scriptArr).map((t) => ({ text: t, url: byText.has(t) ? byText.get(t) : null }));
    };

    // Unchanged script → no-op.
    if (active && JSON.stringify(activeScript) === JSON.stringify(scriptArr)) {
      res.status(200).json({ ok: true, unchanged: true, version: full(active) });
      return;
    }

    // Manual edit → update the active version in place.
    if (active && !newVersion) {
      const prevSeg = parseJson(active.segments, []);
      const newSegments = computeSegments(prevSeg);
      const sameChunks = prevSeg.length === newSegments.length &&
        prevSeg.every((s, i) => s.text === newSegments[i].text);
      const merged = (newSegments.every((s) => s.url) && sameChunks) ? (active.audio_url || null) : null;
      const upd = await db.query(
        `UPDATE narration_versions SET script = $1, segments = $2, audio_url = $3
          WHERE id = $4
        RETURNING id, version_no, name, script, segments, audio_url`,
        [JSON.stringify(scriptArr), JSON.stringify(newSegments), merged, active.id]
      );
      res.status(200).json({ ok: true, created: false, version: full(upd.rows[0]) });
      return;
    }

    // New version (fresh generation, or no active version yet).
    const newSegments = computeSegments(active ? parseJson(active.segments, []) : []);
    const mx = await db.query(
      `SELECT COALESCE(MAX(version_no), 0) m FROM (
         SELECT version_no FROM narration_versions WHERE lang = $1
         UNION ALL SELECT version_no FROM narration_versions_archive WHERE lang = $1
       ) t`,
      [code]
    );
    const versionNo = (mx.rows[0].m || 0) + 1;
    await db.query(`UPDATE narration_versions SET active = false WHERE lang = $1`, [code]);
    const ins = await db.query(
      `INSERT INTO narration_versions (lang, version_no, name, script, segments, audio_url, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING id, version_no, name, script, segments, audio_url`,
      [code, versionNo, null, JSON.stringify(scriptArr), JSON.stringify(newSegments), null, now]
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

    res.status(200).json({ ok: true, created: true, version: full(ins.rows[0]) });
  } catch (error) {
    console.error("narration save error:", error);
    res.status(500).json({ error: "שגיאה בשמירה.", details: String((error && error.message) || error) });
  }
};
