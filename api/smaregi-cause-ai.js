function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function compact(value, limit = 14000) {
  return String(value ?? "").slice(0, limit);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: "AI原因分析には OPENAI_API_KEY の設定が必要です。VercelのEnvironment Variablesに設定してください。"
    });
  }
  try {
    const body = readBody(req);
    const prompt = [
      "ARICO在庫管理のスマレジ在庫差異について、原因候補を日本語で分析してください。",
      "AIは分析のみです。在庫変更、スマレジ変更、原因カテゴリ確定、確認済み変更、履歴削除は絶対に行いません。",
      "前回チェック締め以降のARICO履歴とスマレジ履歴を優先し、直前履歴は参考として扱ってください。",
      "出力は必ず JSON で、keys は cause, confidence, evidence, recommended_check としてください。",
      "",
      compact(JSON.stringify({
        summary: body.summary || {},
        arico_logs: body.arico_logs || [],
        smaregi_changes: body.smaregi_changes || []
      }, null, 2))
    ].join("\n");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are an inventory discrepancy analyst. Return concise Japanese JSON only." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || "OpenAI API request failed." });
    }
    const content = data?.choices?.[0]?.message?.content || "{}";
    let analysis = {};
    try {
      analysis = JSON.parse(content);
    } catch (_) {
      analysis = { cause: content, confidence: "低", evidence: "", recommended_check: "" };
    }
    return res.status(200).json({
      cause: compact(analysis.cause, 2000),
      confidence: compact(analysis.confidence || "中", 100),
      evidence: compact(analysis.evidence, 4000),
      recommended_check: compact(analysis.recommended_check, 4000)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
