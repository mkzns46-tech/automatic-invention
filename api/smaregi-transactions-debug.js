const DEFAULT_LIMIT = 100;

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
      scope: "pos.transactions:read"
    }).toString()
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new Error(`スマレジOAuth認証エラー ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

function pick(obj, keys, fallback = "") {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return fallback;
}

function getDetails(row) {
  const details = pick(row, ["details", "transactionDetails", "transaction_details", "detailsList"], []);
  return Array.isArray(details) ? details : [];
}

function normalizeTransactions(rows) {
  return rows.map(row => {
    const details = getDetails(row).map(detail => ({
      detailId: String(pick(detail, ["transactionDetailId", "transaction_detail_id", "detailId", "detail_id"], "") || ""),
      productId: String(pick(detail, ["productId", "product_id"], "") || ""),
      productName: String(pick(detail, ["productName", "product_name"], "") || ""),
      quantity: Number(pick(detail, ["quantity", "salesQuantity", "sales_quantity", "unitSalesQuantity", "unit_sales_quantity"], 0) || 0)
    }));
    return {
      transactionHeadId: String(pick(row, ["transactionHeadId", "transaction_head_id", "transactionId", "transaction_id"], "") || ""),
      terminalTranDateTime: pick(row, ["terminalTranDateTime", "terminal_tran_date_time", "transactionDateTime", "transaction_date_time"], null),
      storeId: String(pick(row, ["storeId", "store_id"], "") || ""),
      terminalId: String(pick(row, ["terminalId", "terminal_id"], "") || ""),
      terminalName: String(pick(row, ["terminalName", "terminal_name"], "") || ""),
      cancelDivision: String(pick(row, ["cancelDivision", "cancel_division"], "") || ""),
      transactionHeadDivision: String(pick(row, ["transactionHeadDivision", "transaction_head_division", "transactionDivision", "transaction_division"], "") || ""),
      details
    };
  });
}

async function fetchTransactions(apiBase, token, context, fromDate, toDate) {
  const rows = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(apiBase + "/transactions");
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
    url.searchParams.set("page", String(page));
    url.searchParams.set("with_details", "all");
    url.searchParams.set("store_id", context.storeId);
    url.searchParams.set("terminal_tran_date_time-from", `${fromDate}T00:00:00+09:00`);
    url.searchParams.set("terminal_tran_date_time-to", `${toDate}T23:59:59+09:00`);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`/transactions API ${response.status}: ${JSON.stringify(body)}`);
    }
    if (!Array.isArray(body)) throw new Error("/transactions API response is not an array");
    rows.push(...body);
    if (body.length < DEFAULT_LIMIT) break;
  }
  return rows;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const body = parseBody(req);
    const fromDate = String(body.fromDate || "").trim();
    const toDate = String(body.toDate || fromDate || "").trim();
    if (!fromDate || !toDate) throw new Error("対象期間を指定してください。");
    if (fromDate > toDate) throw new Error("終了日は開始日以降の日付を入力してください。");

    const context = resolveSmaregiContext(body);
    if (!context.storeId) throw new Error(`店舗IDが未設定です。${context.storeName} の環境変数を確認してください。`);
    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const transactions = await fetchTransactions(apiBase, token, context, fromDate, toDate);

    return res.status(200).json({
      count: transactions.length,
      context: {
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId,
        contractId: context.contractId
      },
      transactions: normalizeTransactions(transactions)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
