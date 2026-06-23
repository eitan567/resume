// Admin-only: saves the narration manifest (script + audio URL) for a language
// to Blob storage. Protected by ADMIN_PASSWORD.

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
    const manifest = {
      script: Array.isArray(script) ? script.map((s) => String(s || "")).filter(Boolean) : [],
      audioUrl: audioUrl ? String(audioUrl) : null,
      updatedAt: new Date().toISOString(),
    };

    const { put } = await import("@vercel/blob");
    const blob = await put(`narration/${code}.json`, JSON.stringify(manifest), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });

    res.status(200).json({ ok: true, url: blob.url, manifest });
  } catch (error) {
    console.error("narration save error:", error);
    res.status(500).json({ error: "שגיאה בשמירה.", details: String((error && error.message) || error) });
  }
};
