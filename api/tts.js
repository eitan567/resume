// Vercel serverless function — high-quality Text-to-Speech via Gemini TTS.
// Receives a short text chunk and returns base64 PCM audio (16-bit, mono).
// The browser wraps it in a WAV header and plays it. GEMINI_API_KEY is read
// from the server-side environment (never exposed to the client).

const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 40; // a full narration issues several chunk calls
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > MAX_PER_WINDOW;
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
    let { text, voice } = body;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "text is required and must be a string." });
      return;
    }
    text = text.slice(0, 1400);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      return;
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice || "Kore" },
          },
        },
      },
    });

    const part =
      response &&
      response.candidates &&
      response.candidates[0] &&
      response.candidates[0].content &&
      response.candidates[0].content.parts &&
      response.candidates[0].content.parts[0];
    const data = part && part.inlineData && part.inlineData.data;
    const mime = (part && part.inlineData && part.inlineData.mimeType) || "audio/L16;rate=24000";
    if (!data) {
      res.status(502).json({
        error: "No audio returned from TTS.",
        debug: {
          finishReason: response && response.candidates && response.candidates[0] && response.candidates[0].finishReason,
          candCount: response && response.candidates && response.candidates.length,
          partKeys: part ? Object.keys(part) : null,
          text: (response && response.text) ? String(response.text).slice(0, 300) : null,
        },
      });
      return;
    }
    const m = /rate=(\d+)/.exec(mime);
    const sampleRate = m ? parseInt(m[1], 10) : 24000;

    res.status(200).json({ audio: data, sampleRate });
  } catch (error) {
    console.error("Gemini TTS Error:", error);
    res.status(500).json({
      error: "שגיאה בהפקת ההקראה.",
      details: String((error && error.message) || error),
    });
  }
};
