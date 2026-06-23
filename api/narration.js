// Public read: returns the ACTIVE narration version for a language:
// { script: string[], audioUrl, updatedAt, versionId, segments }.
// Visitors only use script + audioUrl; the settings screen also uses versionId
// and segments (to know which chunks already have audio, for partial recording).

const { getDb } = require("./_db");

function parseJson(v, fallback) {
  try { return JSON.parse(v || ""); } catch { return fallback; }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const lang = ((req.query && req.query.lang) === "en") ? "en" : "he";
    const db = await getDb();
    const r = await db.query(
      `SELECT id, script, segments, audio_url, created_at
         FROM narration_versions
        WHERE lang = $1 AND active = true
        ORDER BY id DESC LIMIT 1`,
      [lang]
    );
    if (!r.rows.length) {
      res.status(200).json({ script: null, audioUrl: null, versionId: null, segments: [] });
      return;
    }
    const row = r.rows[0];
    res.status(200).json({
      script: parseJson(row.script, []),
      audioUrl: row.audio_url || null,
      updatedAt: row.created_at || null,
      versionId: row.id,
      segments: parseJson(row.segments, []),
    });
  } catch (error) {
    console.error("narration read error:", error);
    res.status(200).json({ script: null, audioUrl: null, versionId: null, segments: [] });
  }
};
