// Records a lightweight usage event (page view, narration play, chat open…).
// No auth — only an allow-listed set of event names is accepted.

const { getDb } = require("./_db");

const ALLOWED = new Set([
  "page_view",
  "narrate_play",
  "narrate_saved_play",
  "chat_open",
  "contact_open",
  "export",
]);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const event = String(body.event || "");
    if (!ALLOWED.has(event)) {
      res.status(400).json({ error: "Unknown event." });
      return;
    }
    const lang = body.lang === "en" ? "en" : body.lang === "he" ? "he" : null;
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";

    const db = await getDb();
    await db.query(
      "INSERT INTO usage_events (event, lang, ip, created_at) VALUES ($1, $2, $3, $4)",
      [event, lang, ip, new Date().toISOString()]
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("track error:", error);
    res.status(200).json({ ok: false });
  }
};
