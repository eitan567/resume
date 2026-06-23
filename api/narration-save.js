// Admin-only: saves the narration manifest (script + audio URL) for a language
// to Vercel Postgres. Protected by ADMIN_PASSWORD.

const { getDb } = require("./_db");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { lang, script, audioUrl } = body;

    // NOTE: auth temporarily removed — a proper user login is planned to gate
    // settings/recording. Until then these admin actions are open.
    const code = lang === "en" ? "en" : "he";
    const scriptArr = Array.isArray(script)
      ? script.map((s) => String(s || "")).filter(Boolean)
      : [];
    const updatedAt = new Date().toISOString();

    const db = await getDb();
    await db.query(
      `INSERT INTO narration (lang, script, audio_url, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lang) DO UPDATE SET
         script = EXCLUDED.script,
         audio_url = EXCLUDED.audio_url,
         updated_at = EXCLUDED.updated_at`,
      [code, JSON.stringify(scriptArr), audioUrl ? String(audioUrl) : null, updatedAt]
    );

    res.status(200).json({
      ok: true,
      manifest: { script: scriptArr, audioUrl: audioUrl || null, updatedAt },
    });
  } catch (error) {
    console.error("narration save error:", error);
    res.status(500).json({ error: "שגיאה בשמירה.", details: String((error && error.message) || error) });
  }
};
