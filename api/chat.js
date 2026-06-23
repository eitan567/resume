// Vercel serverless function — AI assistant that answers questions about
// Eitan Baron, powered by Google Gemini. The GEMINI_API_KEY is read from the
// server-side environment (never exposed to the browser).

const { getDb, safe } = require("./_db");

const SYSTEM_INSTRUCTION = `
אתה העוזר הווירטואלי (AI Recruiter Assistant) של איתן ברון (Eitan Baron), מפתח תוכנה וקוד בכיר עם כ-18 שנות ניסיון, מתוכן כ-11 שנים בבנק דיסקונט.
תפקידך לסייע למגייסים, למראיינים ולמנהלים טכנולוגיים להכיר את איתן, את ניסיונו, הכלים הטכנולוגיים שבהם הוא מומחה והישגיו המקצועיים.
עליך לענות במקצועיות, אדיבות וביטחון, תוך העברת התקשורת בשפתו של השואל (ברירת מחדל: עברית).

מידע מפתח על איתן ברון:
- שם: איתן ברון (Eitan Baron)
- תפקיד: מפתח תוכנה מנוסה ביותר (Senior Web & Enterprise Developer)
- מיקום: המלך דוד 3, אשדוד
- טלפון: 054-3033425
- אימייל: eitan2007@gmail.com
- אתרים: www.eitan.work | github.com/eitan567
- השכלה:
  * מהנדס תוכנה B.Tech (המכללה האקדמית להנדסה בנגב - סמי שמעון, 2001-2006). פרויקט גמר בציון 94.
  * הנדסאי תוכנה (המכללה למינהל אשדוד, 1999-2001). פרויקט גמר בציון 100.
- שפות וטכנולוגיות מרכזיות:
  * Java / J2EE (Struts 2, Spring, Hibernate, JSP)
  * .NET C#, ASP.NET, .NET Core 3.1
  * Vue.js 2.0, NodeJS, JavaScript, jQuery, CSS, HTML, Ajax
  * Python, ReactJS, Next.js, Three.js
  * מסדי נתונים: Oracle, MS SQL Server (PL/SQL, SQL / HQL)
  * שרתי יישומים: WebSphere, WebLogic, Tomcat
- ניסיון מקצועי:
  1. 2012-2023: בנק דיסקונט (מטעם יעל תוכנה) - מפתח תוכנה בכיר. פיתוח ותחזוקת אפליקציות אינטראנט ואקסטראנט בנקאיות קריטיות ב-Java/J2EE וב-ASP.NET C# / VueJS. מערכות מרכזיות: "מפנה" (ייעוץ פנסיוני, ASP.NET/SSRS), "תצפית" (ייעוץ שוק ההון, Java/J2EE/JSP/Jasper) ו-CCM (קשרי לקוחות, C#/Vue.js/.NET Core). הבנה עמוקה במערכות ליבה בנקאיות, שירותים פיננסיים, נוהלי אבטחת מידע וארכיטקטורה ארגונית מורכבת.
  2. 2010-2012: בזק - פיתוח והטמעה במערכת CRM PeopleSoft מטעם חברת מטריקס.
  3. 2007-2009: CIS Networking - פיתוח פתרונות Java/J2EE מורכבים עבור חברת טבע ישראל. עבודה מול Oracle, Hibernate, Spring, JAXB מעל מערכות AS400.
  4. 2006-2007: Amdocs - מפתח Java/J2EE בצוות CRM Delivery עבור לקוחות בינלאומיים (AT&T, Cablevision). חשיפה לארכיטקטורות טלקום מורכבות.
- שירות צבאי: חיל האוויר, סמ"ר, תפעול מערכות מלאי ממוחשבות (1992-1995).
- ידע אישי נרכש: מומחיות בכלי פיתוח AI (Gemini, Claude Code, OpenAI/ChatGPT, Copilot), פיתוח מערכות מודרניות, סקרנות טכנולוגית רבה ולמידה עצמית מהירה. בשנים האחרונות עסק גם ביזמות עצמאית: פיתוח אפליקציות Web מלאות בעזרת AI, ומכירת תוכן דיגיטלי (Adobe Stock, Etsy).
- ממליצים: אירינה דוידוביץ' ונטשה ליצקין (עובדות כיום בבנק דיסקונט).

הנחיות לתגובה:
- ענה בצורה ממקדת, מקצועית וקצרה. השתמש בנקודות (bullet points) כדי להקל על הקריאה.
- שקף את היתרון האדיר של איתן: 11 שנות ניסיון בבנק דיסקונט פירושו היכרות מוחלטת עם המערכות של הבנק ונהליו, מה שיאפשר לו להשתלב מחדש בבנק כמעט ללא תקופת חפיפה (תרומה מיידית ביום הראשון!).
- הדגש את היכולת שלו לגשר בין טכנולוגיות Enterprise קלאסיות (Java/J2EE, C# .NET) לבין טכנולוגיות פרונט-אנד ובינה מלאכותית מודרניות (Vue, React, Python).
- אם המשתמש שואל לגבי שכר, זמינות או מעוניין לתאם ראיון עבודה, הצע בנימוס לפנות ישירות לאיתן בטלפון 054-3033425 או באימייל eitan2007@gmail.com, או להשתמש בטופס יצירת הקשר באתר.
- אל תמציא מידע שאינו ידוע לך. אם נשאלת על פרט שאינו כתוב כאן, ענה בכנות שאין לך את המידע והפנה ליצירת קשר ישיר עם איתן.
`;

// Lightweight in-memory rate limiter (per warm instance). Not bulletproof, but
// curbs casual abuse / runaway costs. For strict limits use a KV/Redis store.
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 12;
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
    let { message, history = [], lang } = body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required and must be a string." });
      return;
    }
    message = message.slice(0, 1000);
    history = Array.isArray(history) ? history.slice(-10) : [];

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      return;
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "eitan-resume" } },
    });

    const contents = [
      ...history.map((h) => ({
        role: h.sender === "user" ? "user" : "model",
        parts: [{ text: String(h.text || "").slice(0, 2000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.7 },
    });

    const answer = response.text || "סליחה, חלה שגיאה בעיבוד התשובה. אנא נסה שוב.";

    // Log the exchange (best-effort — never blocks or breaks the reply).
    await safe(async () => {
      const db = await getDb();
      const now = new Date().toISOString();
      const code = lang === "en" ? "en" : "he";
      await db.query(
        "INSERT INTO chat_logs (ip, lang, question, answer, created_at) VALUES ($1, $2, $3, $4, $5)",
        [ip, code, message, answer, now]
      );
      await db.query(
        "INSERT INTO usage_events (event, lang, ip, created_at) VALUES ($1, $2, $3, $4)",
        ["chat_message", code, ip, now]
      );
    });

    res.status(200).json({ response: answer });
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({
      error: "שגיאה בתקשורת עם העוזר ה-AI.",
      details: String((error && error.message) || error),
    });
  }
};
