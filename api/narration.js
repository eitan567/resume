// Public read: returns the saved narration manifest for a language
// ({ script: string[], audioUrl, updatedAt }) or empty if none saved yet.

module.exports = async (req, res) => {
  try {
    const lang = ((req.query && req.query.lang) === "en") ? "en" : "he";
    const pathname = `narration/${lang}.json`;
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: pathname });
    const manifest = blobs.find((b) => b.pathname === pathname);
    res.setHeader("Cache-Control", "no-store");
    if (!manifest) {
      res.status(200).json({ script: null, audioUrl: null });
      return;
    }
    const r = await fetch(manifest.url, { cache: "no-store" });
    const data = await r.json();
    res.status(200).json(data || { script: null, audioUrl: null });
  } catch (error) {
    console.error("narration read error:", error);
    res.status(200).json({ script: null, audioUrl: null });
  }
};
