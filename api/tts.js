// Vercel serverless function — high-quality Text-to-Speech via Google Cloud
// Text-to-Speech (excellent Hebrew + English neural voices). Returns base64 MP3
// that the browser plays directly. The API key is read from the server-side
// environment and never exposed to the client.

const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > MAX_PER_WINDOW;
}

// Hebrew has no vowel marks, so TTS mispronounces words. Dicta Nakdan adds
// context-aware niqqud, which dramatically improves Cloud TTS pronunciation.
async function addNiqqud(text) {
  try {
    const r = await fetch("https://nakdan-2-0.loadbalancer.dicta.org.il/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "nakdan", data: text, genre: "modern" }),
    });
    if (!r.ok) return text;
    const arr = await r.json();
    if (!Array.isArray(arr)) return text;
    const out = arr
      .map((it) =>
        it.sep ? it.word : ((it.options && it.options[0]) || it.word).replace(/\|/g, "")
      )
      .join("");
    return out || text;
  } catch {
    return text; // on any failure, fall back to the un-vocalized text
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (rateLimited(ip)) {
      res.status(429).json({ error: "יותר מדי בקשות. נסה שוב בעוד דקה." });
      return;
    }

    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    let { text, lang } = body;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required and must be a string." });
      return;
    }
    text = text.slice(0, 4800); // Cloud TTS allows up to ~5000 chars per request

    // Dedicated TTS key (Cloud Text-to-Speech), falling back to the Gemini key.
    const apiKey = process.env.GOOGLE_TTS_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "API key is not configured on the server." });
      return;
    }

    const isEn = lang === "en";
    // Chirp3-HD: Google's newest, most natural voices (the AI Studio ones).
    const voice = isEn
      ? { languageCode: "en-US", name: "en-US-Chirp3-HD-Charon" }
      : { languageCode: "he-IL", name: "he-IL-Chirp3-HD-Charon" };

    // Vocalize Hebrew first so the voice pronounces it correctly.
    if (!isEn) text = await addNiqqud(text);

    const r = await fetch(
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice,
          audioConfig: { audioEncoding: "MP3" },
        }),
      }
    );
    const j = await r.json();
    if (!r.ok || !j.audioContent) {
      res.status(502).json({
        error: "שגיאה בהפקת ההקראה.",
        details: (j && j.error && j.error.message) || ("HTTP " + r.status),
      });
      return;
    }

    res.status(200).json({ audio: j.audioContent, mime: "audio/mpeg" });
  } catch (error) {
    console.error("Cloud TTS Error:", error);
    res.status(500).json({
      error: "שגיאה בהפקת ההקראה.",
      details: String((error && error.message) || error),
    });
  }
};
