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
  const targetRegisterCode = normalizeKey(body.targetRegisterCode || body.registerCode, "event");
  const targetRegisterId = String(body.targetRegisterId || body.registerId || "").trim();
  const targetTerminalId = String(body.targetTerminalId || body.terminalId || targetRegisterId || "").trim();
  const targetRegisterName = String(body.targetRegisterName || body.registerName || `${storeName}イベントレジ`).trim();
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
    targetRegisterCode: targetRegisterCode === "event" ? "event" : targetRegisterCode,
    targetRegisterName,
    targetRegisterId,
    targetTerminalId,
    clientId: env("SMAREGI_CLIENT_ID"),
    clientSecret: env("SMAREGI_CLIENT_SECRET"),
    contractId: env("SMAREGI_CONTRACT_ID", "SMAREGI_CONTRACTID"),
    apiBase: env("SMAREGI_POS_API_BASE_URL"),
    accessToken: env("SMAREGI_ACCESS_TOKEN"),
    refreshToken: env("SMAREGI_REFRESH_TOKEN")
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

function toPositiveInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(Math.abs(n));
}

function isCancelledTransaction(row) {
  const cancelDivision = String(pick(row, ["cancelDivision", "cancel_division"], "0") || "0").toLowerCase();
  const transactionDivision = String(pick(row, [
    "transactionHeadDivision",
    "transaction_head_division",
    "transactionDivision",
    "transaction_division"
  ], "1") || "1").toLowerCase();
  const status = String(pick(row, ["status", "transactionStatus", "transaction_status"], "") || "").toLowerCase();
  if (cancelDivision === "1" || cancelDivision.includes("cancel")) return true;
  if (status.includes("cancel") || status.includes("return")) return true;
  return transactionDivision && transactionDivision !== "1";
}

function isCancelledDetail(row) {
  const cancelDivision = String(pick(row, ["cancelDivision", "cancel_division"], "0") || "0").toLowerCase();
  const status = String(pick(row, ["status", "detailStatus", "detail_status"], "") || "").toLowerCase();
  return cancelDivision === "1" || cancelDivision.includes("cancel") || status.includes("cancel") || status.includes("return");
}

function getDetails(row) {
  const details = pick(row, ["details", "transactionDetails", "transaction_details", "detailsList"], []);
  return Array.isArray(details) ? details : [];
}

function normalizeSales(transactions, productIdSet, targetTerminalId) {
  const sales = [];
  for (const transaction of transactions) {
    if (!transaction || isCancelledTransaction(transaction)) continue;
    const terminalId = String(pick(transaction, ["terminalId", "terminal_id"], "") || "").trim();
    if (String(targetTerminalId || "").trim() && terminalId !== String(targetTerminalId || "").trim()) continue;
    const transactionId = String(pick(transaction, [
      "transactionHeadId",
      "transaction_head_id",
      "transactionId",
      "transaction_id"
    ]) || "").trim();
    const soldAt = pick(transaction, [
      "terminalTranDateTime",
      "terminal_tran_date_time",
      "transactionDateTime",
      "transaction_date_time",
      "salesDateTime",
      "sales_date_time"
    ]) || null;
    if (!transactionId) continue;

    getDetails(transaction).forEach((detail, index) => {
      if (!detail || isCancelledDetail(detail)) return;
      const productId = String(pick(detail, ["productId", "product_id"]) || "").trim();
      if (!productId || (productIdSet.size && !productIdSet.has(productId))) return;
      const quantity = toPositiveInteger(pick(detail, ["quantity", "salesQuantity", "sales_quantity", "unitSalesQuantity", "unit_sales_quantity"], 0));
      if (!quantity) return;
      const detailId = String(pick(detail, [
        "transactionDetailId",
        "transaction_detail_id",
        "detailId",
        "detail_id"
      ], `${transactionId}-${index + 1}`)).trim();
      sales.push({
        smaregi_transaction_id: transactionId,
        smaregi_detail_id: detailId,
        smaregi_product_id: productId,
        smaregi_terminal_id: terminalId,
        quantity,
        sold_at: soldAt,
        product_name: String(pick(detail, ["productName", "product_name"], "") || "").trim()
      });
    });
  }
  return sales;
}

async function fetchTransactions(apiBase, token, context, fromDate, toDate, productIds) {
  const rows = [];
  for (let page = 1; page <= 100; page += 1) {
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
    const toDate = String(body.toDate || "").trim();
    const productIds = Array.isArray(body.smaregiProductIds)
      ? body.smaregiProductIds.map(value => String(value || "").trim()).filter(Boolean)
      : [];

    if (!fromDate || !toDate) throw new Error("対象期間を指定してください。");
    if (fromDate > toDate) throw new Error("終了日は開始日以降の日付を入力してください。");

    const context = resolveSmaregiContext(body);
    if (!context.storeId) throw new Error(`店舗IDが未設定です。${context.storeName} の環境変数を確認してください。`);
    if (!context.targetTerminalId) throw new Error("イベント販売用レジIDが未設定です");
    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const transactions = await fetchTransactions(apiBase, token, context, fromDate, toDate, productIds);
    const productIdSet = new Set(productIds);
    const sales = normalizeSales(transactions, productIdSet, context.targetTerminalId);

    return res.status(200).json({
      sales,
      count: sales.length,
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId,
        targetRegisterCode: context.targetRegisterCode,
        targetRegisterName: context.targetRegisterName,
        targetRegisterId: context.targetRegisterId,
        targetTerminalId: context.targetTerminalId,
        contractId: context.contractId
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
