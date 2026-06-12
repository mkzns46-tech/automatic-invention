module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const expected = process.env.SALES_ADMIN_PASSWORD || "";
  if (!expected) {
    res.status(500).json({ error: "SALES_ADMIN_PASSWORD is not configured" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const password = String(body.password || "");
  if (password !== expected) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  res.status(200).json({
    ok: true,
    token: "sales_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2),
    expiresInMs: 2 * 60 * 60 * 1000
  });
};
