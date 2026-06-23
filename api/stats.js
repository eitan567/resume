// Admin-only dashboard data: usage-event counts, chat-log and contact counts,
// plus the most recent chat questions and contact submissions. Protected by
// ADMIN_PASSWORD (sent in the POST body).

const { getDb } = require("./_db");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!process.env.ADMIN_PASSWORD || body.password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: "סיסמת מנהל שגויה." });
      return;
    }

    const db = await getDb();
    const [events, chatCount, contactCount, recentChats, recentContacts] = await Promise.all([
      db.query("SELECT event, COUNT(*) AS n FROM usage_events GROUP BY event"),
      db.query("SELECT COUNT(*) AS n FROM chat_logs"),
      db.query("SELECT COUNT(*) AS n FROM contact_submissions"),
      db.query("SELECT question, lang, created_at FROM chat_logs ORDER BY id DESC LIMIT 8"),
      db.query("SELECT name, email, phone, message, created_at FROM contact_submissions ORDER BY id DESC LIMIT 8"),
    ]);

    const eventCounts = {};
    for (const r of events.rows) eventCounts[r.event] = Number(r.n);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      ok: true,
      events: eventCounts,
      chatCount: Number(chatCount.rows[0].n),
      contactCount: Number(contactCount.rows[0].n),
      recentChats: recentChats.rows,
      recentContacts: recentContacts.rows,
    });
  } catch (error) {
    console.error("stats error:", error);
    res.status(500).json({ error: "שגיאה בטעינת הסטטיסטיקות.", details: String((error && error.message) || error) });
  }
};
