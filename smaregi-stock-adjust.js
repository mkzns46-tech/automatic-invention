function env(...names) {
  for (const name of names) {
    if (name && process.env[name]) return process.env[name];
  }
  return "";
}

function normalizeKey(value, fallback) {
  return String(value || fallback || "").trim().toLowerCase();
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function resolveSmaregiContext(body = {}) {
  const requestedStoreCode = normalizeKey(body.storeCode || body.currentStore, "tokyo");
  const storeCode = requestedStoreCode === "aichi" ? "aichi" : "tokyo";
  const storePrefix = storeCode === "aichi" ? "AICHI" : "TOKYO";
  const storeName = storeCode === "aichi" ? "愛知" : "東京";
  const storeId = env(
    `SMAREGI_${storePrefix}_STORE_ID`,
    storeCode === "tokyo" ? "SMAREGI_STORE_ID" : ""
  );

  return {
    accountKey: "production",
    accountName: env("SMAREGI_ACCOUNT_NAME") || "スマレジ本番接続",
    storeCode,
    storeName,
    storeId,
    clientId: env("SMAREGI_CLIENT_ID"),
    clientSecret: env("SMAREGI_CLIENT_SECRET"),
    contractId: env("SMAREGI_CONTRACT_ID", "SMAREGI_CONTRACTID"),
    apiBase: env("SMAREGI_POS_API_BASE_URL"),
    accessToken: env("SMAREGI_ACCESS_TOKEN")
  };
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret, accessToken } = context;
  if (accessToken) return accessToken;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error(`スマレジOAuth設定が不足しています。${context.accountName} / ${context.storeName}`);
  }

  const tokenUrl = `https://id.smaregi.jp/app/${contractId}/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "pos.stock:read pos.stock:write"
    }).toString()
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new Error(`スマレジOAuth認証エラー ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

function toInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const body = parseBody(req);
    const context = resolveSmaregiContext(body);
    const productId = String(body.smaregiProductId || body.productId || "").trim();
    const delta = toInteger(body.delta ?? body.stockAmount);
    const memo = String(body.memo || "ARICOイベント管理 ガチャ在庫更新").slice(0, 100);

    if (!context.storeId) throw new Error(`${context.storeName}の店舗IDが未設定です。`);
    if (!productId) throw new Error("スマレジ商品IDが未設定です。");
    if (!delta) throw new Error("在庫増減数が0です。");

    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const url = `${apiBase}/stock/${encodeURIComponent(productId)}/add`;
    const payload = {
      storeId: String(context.storeId),
      stockAmount: String(delta),
      stockHistory: { memo }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`/stock/${productId}/add API ${response.status}: ${JSON.stringify(result)}`);
    }

    return res.status(200).json({
      ok: true,
      result,
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId,
        contractId: context.contractId
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
