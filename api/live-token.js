// Mints a short-lived, single-use ephemeral token so the browser can open a
// Gemini Live session for narration WITHOUT ever exposing the API key.

const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 15;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > MAX_PER_WINDOW;
}

module.exports = async (req, res) => {
  try {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (rateLimited(ip)) {
      res.status(429).json({ error: "יותר מדי בקשות. נסה שוב בעוד דקה." });
      return;
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      return;
    }
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
    res.status(200).json({ token: token.name });
  } catch (error) {
    console.error("Auth token error:", error);
    res.status(500).json({
      error: "שגיאה ביצירת אסימון הקראה.",
      details: String((error && error.message) || error),
    });
  }
};
