// Save a narration SCRIPT for a language. If the script differs from the active
// version, a NEW version is created and made active — inheriting per-chunk audio
// from the previous active version for any chunk whose text is unchanged (so a
// later "record" only needs to synthesize the changed chunks). The merged audio
// is cleared on a script change (it must be re-stitched by recording).
//
// Recording itself does NOT create a version (see narration-versions saveAudio).
//
// Up to 6 live versions per language; creating a 7th archives the oldest.

const { getDb, mergeChunks } = require("./_db");

const MAX_VERSIONS = 6;

function parseJson(v, fallback) {
  try { return JSON.parse(v || ""); } catch { return fallback; }
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
    const now = new Date().toISOString();
    const db = await getDb();

    // Current active version (if any).
    const cur = await db.query(
      `SELECT id, script, segments, audio_url FROM narration_versions
        WHERE lang = $1 AND active = true ORDER BY id DESC LIMIT 1`,
      [code]
    );
    const active = cur.rows[0] || null;
    const activeScript = active ? parseJson(active.script, []) : [];

    // Unchanged script → no new version.
    if (active && JSON.stringify(activeScript) === JSON.stringify(scriptArr)) {
      res.status(200).json({
        ok: true,
        unchanged: true,
        version: {
          id: active.id,
          script: activeScript,
          segments: parseJson(active.segments, []),
          audioUrl: active.audio_url || null,
        },
      });
      return;
    }

    // Build new segments, inheriting audio for chunks whose text is unchanged.
    const prevSegments = active ? parseJson(active.segments, []) : [];
    const prevByText = new Map(prevSegments.map((s) => [s.text, s.url || null]));
    const newChunks = mergeChunks(scriptArr);
    const newSegments = newChunks.map((text) => ({
      text,
      url: prevByText.has(text) ? prevByText.get(text) : null,
    }));
    // Merged audio is only valid if EVERY chunk is inherited AND the chunk set is
    // identical to before (same order). A changed script almost always means a
    // re-record is needed, so clear it unless nothing about the chunks changed.
    const allInherited = newSegments.every((s) => s.url);
    const sameChunks =
      prevSegments.length === newSegments.length &&
      prevSegments.every((s, i) => s.text === newSegments[i].text);
    const mergedAudioUrl = active && allInherited && sameChunks ? active.audio_url || null : null;

    // Deactivate previous, insert the new active version.
    await db.query(`UPDATE narration_versions SET active = false WHERE lang = $1`, [code]);
    const ins = await db.query(
      `INSERT INTO narration_versions (lang, script, segments, audio_url, active, created_at)
       VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
      [code, JSON.stringify(scriptArr), JSON.stringify(newSegments), mergedAudioUrl, now]
    );
    const newId = ins.rows[0].id;

    // Enforce max live versions: archive the oldest beyond the cap.
    const all = await db.query(
      `SELECT id FROM narration_versions WHERE lang = $1 ORDER BY id ASC`,
      [code]
    );
    const overflow = all.rows.length - MAX_VERSIONS;
    if (overflow > 0) {
      const oldIds = all.rows.slice(0, overflow).map((r) => r.id);
      await db.query(
        `INSERT INTO narration_versions_archive (lang, script, segments, audio_url, created_at)
         SELECT lang, script, segments, audio_url, created_at FROM narration_versions
          WHERE id = ANY($1::int[])`,
        [oldIds]
      );
      await db.query(`DELETE FROM narration_versions WHERE id = ANY($1::int[])`, [oldIds]);
    }

    res.status(200).json({
      ok: true,
      version: { id: newId, script: scriptArr, segments: newSegments, audioUrl: mergedAudioUrl },
    });
  } catch (error) {
    console.error("narration save error:", error);
    res.status(500).json({ error: "שגיאה בשמירה.", details: String((error && error.message) || error) });
  }
};
