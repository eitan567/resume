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
      `SELECT id, version_no, name, script, segments, audio_url, created_at
         FROM narration_versions
        WHERE lang = $1 AND active = true
        ORDER BY id DESC LIMIT 1`,
      [lang]
    );
    if (!r.rows.length) {
      res.status(200).json({ script: null, audioUrl: null, playUrl: null, versionId: null, segments: [] });
      return;
    }
    const row = r.rows[0];
    // Visitor playback URL: the active version's own audio if it has one; else
    // fall back to the most recent version that DOES have audio — so a half-built
    // (empty) active draft never silences the live narration.
    let playUrl = row.audio_url || null;
    if (!playUrl) {
      const f = await db.query(
        `SELECT audio_url FROM narration_versions
          WHERE lang = $1 AND audio_url IS NOT NULL
          ORDER BY id DESC LIMIT 1`,
        [lang]
      );
      if (f.rows.length) playUrl = f.rows[0].audio_url;
    }
    res.status(200).json({
      script: parseJson(row.script, []),
      audioUrl: row.audio_url || null,
      playUrl,
      updatedAt: row.created_at || null,
      versionId: row.id,
      versionNo: row.version_no || null,
      name: row.name || null,
      segments: parseJson(row.segments, []),
    });
  } catch (error) {
    console.error("narration read error:", error);
    res.status(200).json({ script: null, audioUrl: null, versionId: null, segments: [] });
  }
};
