// Admin-only: saves the narration manifest (script + audio URL) for a language
// to Turso. Protected by ADMIN_PASSWORD.

const { getDb } = require("./_db");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { password, lang, script, audioUrl } = body;

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: "סיסמת מנהל שגויה." });
      return;
    }

    const code = lang === "en" ? "en" : "he";
    const scriptArr = Array.isArray(script)
      ? script.map((s) => String(s || "")).filter(Boolean)
      : [];
    const updatedAt = new Date().toISOString();

    const db = await getDb();
    await db.execute({
      sql: `INSERT INTO narration (lang, script, audio_url, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(lang) DO UPDATE SET
              script = excluded.script,
              audio_url = excluded.audio_url,
              updated_at = excluded.updated_at`,
      args: [code, JSON.stringify(scriptArr), audioUrl ? String(audioUrl) : null, updatedAt],
    });

    res.status(200).json({
      ok: true,
      manifest: { script: scriptArr, audioUrl: audioUrl || null, updatedAt },
    });
  } catch (error) {
    console.error("narration save error:", error);
    res.status(500).json({ error: "שגיאה בשמירה.", details: String((error && error.message) || error) });
  }
};
