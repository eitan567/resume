// Save a narration SCRIPT into the ACTIVE version, IN PLACE. Saving never creates
// a version — versions are created explicitly via narration-versions "create".
// Per-chunk audio is inherited (by chunk text) from the version's own current
// segments, so editing only invalidates the chunks that actually changed. The
// merged audio is cleared whenever the chunk set changes (a re-record stitches it).

const { getDb, mergeChunks } = require("./_db");

function parseJson(v, fallback) {
  try { return JSON.parse(v || ""); } catch { return fallback; }
}
function full(row) {
  return {
    id: row.id,
    versionNo: row.version_no || null,
    name: row.name || null,
    script: parseJson(row.script, []),
    segments: parseJson(row.segments, []),
    audioUrl: row.audio_url || null,
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { lang, script } = body;

    const code = lang === "en" ? "en" : "he";
    const scriptArr = Array.isArray(script)
      ? script.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    if (!scriptArr.length) {
      res.status(400).json({ error: "אין תסריט לשמירה." });
      return;
    }
    const db = await getDb();

    const cur = await db.query(
      `SELECT id, version_no, name, script, segments, audio_url FROM narration_versions
        WHERE lang = $1 AND active = true ORDER BY id DESC LIMIT 1`,
      [code]
    );
    const active = cur.rows[0] || null;
    if (!active) {
      res.status(400).json({ error: 'אין גרסה פעילה — צור גרסה חדשה תחילה.' });
      return;
    }

    const activeScript = parseJson(active.script, []);
    if (JSON.stringify(activeScript) === JSON.stringify(scriptArr)) {
      res.status(200).json({ ok: true, unchanged: true, version: full(active) });
      return;
    }

    // Recompute segments, inheriting audio (by chunk text) from this version's own
    // current segments — unchanged chunks keep their audio; changed ones don't.
    const prevSeg = parseJson(active.segments, []);
    const byText = new Map(prevSeg.map((s) => [s.text, s.url || null]));
    const newSegments = mergeChunks(scriptArr).map((t) => ({ text: t, url: byText.has(t) ? byText.get(t) : null }));
    const sameChunks = prevSeg.length === newSegments.length &&
      prevSeg.every((s, i) => s.text === newSegments[i].text);
    const merged = (newSegments.every((s) => s.url) && sameChunks) ? (active.audio_url || null) : null;

    const upd = await db.query(
      `UPDATE narration_versions SET script = $1, segments = $2, audio_url = $3
        WHERE id = $4
      RETURNING id, version_no, name, script, segments, audio_url`,
      [JSON.stringify(scriptArr), JSON.stringify(newSegments), merged, active.id]
    );
    res.status(200).json({ ok: true, version: full(upd.rows[0]) });
  } catch (error) {
    console.error("narration save error:", error);
    res.status(500).json({ error: "שגיאה בשמירה.", details: String((error && error.message) || error) });
  }
};
