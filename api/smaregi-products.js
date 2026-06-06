const DEFAULT_LIMIT = 1000;

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
  const requestedAccountKey = normalizeKey(body.accountKey || body.currentSmaregiAccount, "old");
  const requestedStoreCode = normalizeKey(body.storeCode || body.currentStore, "tokyo");
  const accountKey = requestedAccountKey === "new" ? "new" : "old";
  const storeCode = requestedStoreCode === "aichi" ? "aichi" : "tokyo";
  const accountPrefix = accountKey === "new" ? "NEW" : "OLD";
  const storePrefix = storeCode === "aichi" ? "AICHI" : "TOKYO";

  const clientId = accountKey === "new"
    ? env("SMAREGI_NEW_CLIENT_ID", "NEW_SMAREGI_CLIENT_ID")
    : env("SMAREGI_OLD_CLIENT_ID", "OLD_SMAREGI_CLIENT_ID", "SMAREGI_CLIENT_ID");
  const clientSecret = accountKey === "new"
    ? env("SMAREGI_NEW_CLIENT_SECRET", "NEW_SMAREGI_CLIENT_SECRET")
    : env("SMAREGI_OLD_CLIENT_SECRET", "OLD_SMAREGI_CLIENT_SECRET", "SMAREGI_CLIENT_SECRET");
  const contractId = accountKey === "new"
    ? env("SMAREGI_NEW_CONTRACT_ID", "SMAREGI_NEW_CONTRACTID", "NEW_SMAREGI_CONTRACT_ID", "NEW_SMAREGI_CONTRACTID")
    : env("SMAREGI_OLD_CONTRACT_ID", "SMAREGI_OLD_CONTRACTID", "OLD_SMAREGI_CONTRACT_ID", "OLD_SMAREGI_CONTRACTID", "SMAREGI_CONTRACT_ID", "SMAREGI_CONTRACTID");
  const apiBase = accountKey === "new"
    ? env("SMAREGI_NEW_POS_API_BASE_URL", "NEW_SMAREGI_POS_API_BASE_URL")
    : env("SMAREGI_OLD_POS_API_BASE_URL", "OLD_SMAREGI_POS_API_BASE_URL", "SMAREGI_POS_API_BASE_URL");
  const storeId = env(
    `SMAREGI_${accountPrefix}_${storePrefix}_STORE_ID`,
    `${accountPrefix}_SMAREGI_${storePrefix}_STORE_ID`,
    `SMAREGI_${storePrefix}_STORE_ID`,
    storeCode === "tokyo" ? "SMAREGI_STORE_ID" : ""
  );

  return {
    accountKey,
    accountName: accountKey === "new" ? "新スマレジ" : "旧スマレジ",
    storeCode,
    storeName: storeCode === "aichi" ? "愛知" : "東京",
    storeId,
    clientId,
    clientSecret,
    contractId,
    apiBase
  };
}

async function fetchAll(baseUrl, path, token) {
  const rows = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(baseUrl + path);
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`${path} API ${response.status}: ${JSON.stringify(body)}`);
    }
    if (!Array.isArray(body)) throw new Error(`${path} API response is not an array`);
    rows.push(...body);
    if (body.length < DEFAULT_LIMIT) break;
  }
  return rows;
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret } = context;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error(`スマレジOAuth設定が不足しています: ${context.accountName} / ${context.storeName}`);
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
      scope: "pos.products:read"
    }).toString()
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new Error(`スマレジOAuth認証エラー ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const context = resolveSmaregiContext(parseBody(req));
    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const products = await fetchAll(apiBase, "/products", token);

    const normalized = products.map(product => {
      const barcode = String(product.productCode ?? product.product_code ?? "").trim();
      const name = String(product.productName ?? product.product_name ?? "").trim();
      const smaregi_product_id = String(product.productId ?? product.product_id ?? "").trim() || null;
      if (!barcode || !name) return null;
      const row = { barcode, name, smaregi_product_id };
      const category = String(product.categoryName ?? product.category_name ?? "").trim();
      const genre = String(product.genreName ?? product.genre_name ?? "").trim();
      const department = String(product.departmentName ?? product.department_name ?? "").trim();
      if (category) row.category = category;
      if (genre) row.genre = genre;
      if (department) row.department = department;
      return row;
    }).filter(Boolean);

    return res.status(200).json({
      products: normalized,
      count: normalized.length,
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId || null,
        contractId: context.contractId
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
