// Issues a client-upload token so the browser can upload the recorded audio
// directly to Blob storage (bypassing the function body-size limit). The admin
// password is passed in clientPayload and validated here before a token is given.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { handleUpload } = await import("@vercel/blob/client");
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // NOTE: auth temporarily removed — a proper user login is planned to gate
        // settings/recording. Until then uploads are open (limited by type/size).
        return {
          allowedContentTypes: ["audio/wav", "audio/mpeg", "audio/mp3"],
          addRandomSuffix: true,
          maximumSizeInBytes: 30 * 1024 * 1024,
          tokenPayload: JSON.stringify({}),
        };
      },
      onUploadCompleted: async () => { /* nothing extra to do */ },
    });

    res.status(200).json(jsonResponse);
  } catch (error) {
    console.error("blob upload token error:", error);
    res.status(400).json({ error: String((error && error.message) || error) });
  }
};
