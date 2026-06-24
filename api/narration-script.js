// Vercel serverless function — turns the résumé into a polished spoken-narration
// script: only the meaningful professional content, split into short paragraphs
// for smooth paragraph-by-paragraph TTS. Uses Gemini (server-side key).

const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > MAX_PER_WINDOW;
}

const SYSTEM = `You write a spoken-narration script for a résumé, to be read aloud by a professional voice-over narrator.

From the résumé text, produce a warm, professional, flowing narration that a polished narrator would speak.

INCLUDE (as natural prose, not a list): a short opening with the candidate's name and headline, the professional summary, the work experience (company, role, years and the key achievements/projects), the main skills and technologies grouped naturally, and education highlights, then a brief professional closing.

EXCLUDE entirely: email addresses, phone numbers, physical address, URLs/links, GitHub/website handles, page numbers, raw section-title labels (like "Professional Summary"), and the references' names/contact details.

STYLE: speak it like a human narrator — smooth, pleasant, confident, in third person. Keep it faithful to the résumé (do not invent facts). Write in the SAME language as the résumé.

Split the narration into short paragraphs (about 2-4 sentences each) so it can be synthesized paragraph by paragraph. Return JSON: { "paragraphs": ["...", "..."] }.`;

const NIQQUD_SYSTEM = `You help edit Hebrew narration-script text.

Given a selected word or phrase, return 3-5 useful niqqud variants for the exact selected text.
Preserve the original words, order, spacing and punctuation. Add Hebrew niqqud marks only where helpful.
If the selected text is not Hebrew or niqqud is not applicable, return the original text as the only suggestion.
Return JSON: { "suggestions": ["...", "..."] }.`;

const REWRITE_SYSTEM = `You help rewrite a selected snippet inside a professional narration script.

Rewrite only the selected text according to the user's guidance. Preserve truthful résumé facts, the original language, and the surrounding style. Do not invent details and do not rewrite the whole script.
Return 3 concise alternatives as JSON: { "suggestions": ["...", "..."] }.`;

function parseSuggestions(text) {
  try {
    const data = JSON.parse(text || "{}");
    if (!Array.isArray(data.suggestions)) return [];
    const seen = new Set();
    return data.suggestions
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .filter((s) => {
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      })
      .slice(0, 5);
  } catch {
    return [];
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
    let { text, lang, instruction, action, selectedText, context } = body;
    action = String(action || "script");
    selectedText = (typeof selectedText === "string" ? selectedText : "").slice(0, 1200).trim();
    context = (typeof context === "string" ? context : "").slice(0, 8000);
    instruction = (typeof instruction === "string" ? instruction : "").slice(0, 1000).trim();

    if (action === "niqqud" || action === "rewrite") {
      if (!selectedText) {
        res.status(400).json({ error: "selectedText is required." });
        return;
      }
      if (action === "rewrite" && !instruction) {
        res.status(400).json({ error: "instruction is required." });
        return;
      }
    } else {
      if (!text || typeof text !== "string") {
        res.status(400).json({ error: "text is required." });
        return;
      }
      text = text.slice(0, 8000);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
      return;
    }

    const { GoogleGenAI, Type } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const langName = lang === "en" ? "English" : "Hebrew";

    if (action === "niqqud" || action === "rewrite") {
      const systemInstruction = action === "niqqud" ? NIQQUD_SYSTEM : REWRITE_SYSTEM;
      const contents = action === "niqqud"
        ? `Language: ${langName}\n\nSelected text:\n"""\n${selectedText}\n"""\n\nScript context for disambiguation:\n"""\n${context}\n"""`
        : `Language: ${langName}\n\nUser rewrite guidance:\n"""\n${instruction}\n"""\n\nSelected text to rewrite:\n"""\n${selectedText}\n"""\n\nScript context:\n"""\n${context}\n"""`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          temperature: action === "niqqud" ? 0.25 : 0.75,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["suggestions"],
          },
        },
      });

      let suggestions = parseSuggestions(response.text);
      if (!suggestions.length) suggestions = [selectedText];
      res.status(200).json({ suggestions });
      return;
    }

    const extra = instruction
      ? `\n\nADDITIONAL INSTRUCTIONS FROM THE USER (follow these closely, as long as they don't conflict with excluding contact details / inventing facts):\n"""\n${instruction}\n"""`
      : "";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Language of the narration: ${langName}.${extra}\n\nRésumé text:\n"""\n${text}\n"""`,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.6,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["paragraphs"],
        },
      },
    });

    let paragraphs = [];
    try {
      const data = JSON.parse(response.text || "{}");
      if (Array.isArray(data.paragraphs)) {
        paragraphs = data.paragraphs.map((p) => String(p || "").trim()).filter(Boolean);
      }
    } catch { /* fall through */ }

    if (!paragraphs.length) {
      res.status(502).json({ error: "Failed to build narration script." });
      return;
    }
    res.status(200).json({ paragraphs });
  } catch (error) {
    console.error("Narration script error:", error);
    res.status(500).json({
      error: "שגיאה ביצירת תסריט ההקראה.",
      details: String((error && error.message) || error),
    });
  }
};
