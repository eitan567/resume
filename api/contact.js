// Stores a contact-form submission in Postgres. Runs alongside Web3Forms (which
// delivers the email); this keeps a queryable record for the admin.

const { getDb } = require("./_db");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const name = String(body.name || "").slice(0, 200);
    const email = String(body.email || "").slice(0, 200);
    const phone = String(body.phone || "").slice(0, 60);
    const message = String(body.message || "").slice(0, 4000);
    if (!message && !email && !name) {
      res.status(400).json({ error: "Empty submission." });
      return;
    }
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const now = new Date().toISOString();

    const db = await getDb();
    await db.query(
      "INSERT INTO contact_submissions (name, email, phone, message, ip, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [name, email, phone, message, ip, now]
    );
    await db.query(
      "INSERT INTO usage_events (event, lang, ip, created_at) VALUES ($1, $2, $3, $4)",
      ["contact_submit", null, ip, now]
    );

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("contact store error:", error);
    res.status(500).json({ error: "שגיאה בשמירת הפנייה.", details: String((error && error.message) || error) });
  }
};
