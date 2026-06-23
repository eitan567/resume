// Public read: returns the saved narration manifest for a language
// ({ script: string[], audioUrl, updatedAt }) or empty if none saved yet.
// Backed by Turso (libSQL). The audio file itself lives in Blob; audio_url
// points to it.

const { getDb } = require("./_db");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const lang = ((req.query && req.query.lang) === "en") ? "en" : "he";
    const db = await getDb();
    const r = await db.execute({
      sql: "SELECT script, audio_url, updated_at FROM narration WHERE lang = ?",
      args: [lang],
    });
    if (!r.rows.length) {
      res.status(200).json({ script: null, audioUrl: null });
      return;
    }
    const row = r.rows[0];
    let script = [];
    try { script = JSON.parse(row.script || "[]"); } catch { script = []; }
    res.status(200).json({
      script,
      audioUrl: row.audio_url || null,
      updatedAt: row.updated_at || null,
    });
  } catch (error) {
    console.error("narration read error:", error);
    res.status(200).json({ script: null, audioUrl: null });
  }
};
