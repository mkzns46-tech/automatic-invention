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
  const storeName = storeCode === "aichi" ? "Aichi" : "Tokyo";
  const targetRegisterCode = normalizeKey(body.targetRegisterCode || body.registerCode, "event");
  const targetRegisterId = String(body.targetRegisterId || body.registerId || "").trim();
  const targetTerminalId = String(body.targetTerminalId || body.terminalId || targetRegisterId || "").trim();
  const targetRegisterName = String(body.targetRegisterName || body.registerName || `${storeName} event register`).trim();
  const storeId = env(
    `SMAREGI_${storePrefix}_STORE_ID`,
    storeCode === "tokyo" ? "SMAREGI_STORE_ID" : ""
  );

  return {
    accountKey: "production",
    accountName: env("SMAREGI_ACCOUNT_NAME") || "Smaregi production",
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
    throw new Error(`Smaregi OAuth settings are missing. ${context.accountName} / ${context.storeName}`);
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
    throw new Error(`Smaregi OAuth error ${response.status}: ${JSON.stringify(body)}`);
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

function toSignedInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pickNumberWithKey(obj, keys) {
  for (const key of keys) {
    if (!obj || obj[key] === undefined || obj[key] === null || obj[key] === "") continue;
    return { key, value: toNumber(obj[key]) };
  }
  return { key: "", value: 0 };
}

function getDetailAmountInfo(detail, quantity) {
  const direct = pickNumberWithKey(detail, [
    "unitDiscountedSum",
    "unit_discounted_sum",
    "salesAmount",
    "sales_amount",
    "detailAmount",
    "detail_amount",
    "subtotal",
    "amount",
    "total"
  ]);
  if (direct.key) return { amount: direct.value, source: direct.key };

  const nonDiscount = pickNumberWithKey(detail, ["unitNonDiscountSum", "unit_non_discount_sum"]);
  if (nonDiscount.key) {
    const discount = pickNumberWithKey(detail, ["unitDiscountSum", "unit_discount_sum"]);
    return {
      amount: nonDiscount.value - discount.value,
      source: discount.key ? `${nonDiscount.key}-${discount.key}` : nonDiscount.key
    };
  }

  const salesPrice = pickNumberWithKey(detail, ["salesPrice", "sales_price"]);
  if (salesPrice.key) {
    const unitDiscount = pickNumberWithKey(detail, ["unitDiscountPrice", "unit_discount_price"]);
    return {
      amount: (salesPrice.value - unitDiscount.value) * Math.abs(quantity),
      source: unitDiscount.key ? `${salesPrice.key}-${unitDiscount.key}*quantity` : `${salesPrice.key}*quantity`
    };
  }

  return { amount: 0, source: "" };
}

function normalizeJstDateTime(value, fallbackDate, edge) {
  const raw = String(value || "").trim();
  if (raw) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      return /([+-]\d{2}:\d{2}|Z)$/.test(raw) ? raw : `${raw}+09:00`;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) {
      return `${raw.replace(" ", "T")}+09:00`;
    }
  }
  const date = String(fallbackDate || "").slice(0, 10);
  if (!date) return "";
  return edge === "end" ? `${date}T23:59:59+09:00` : `${date}T00:00:00+09:00`;
}

function isCancelledTransaction(row) {
  const cancelDivision = String(pick(row, ["cancelDivision", "cancel_division"], "0") || "0").toLowerCase();
  const status = String(pick(row, ["status", "transactionStatus", "transaction_status"], "") || "").toLowerCase();
  if (cancelDivision === "1" || cancelDivision.includes("cancel")) return true;
  if (status.includes("cancel")) return true;
  return false;
}

function isCancelledDetail(row) {
  const cancelDivision = String(pick(row, ["cancelDivision", "cancel_division"], "0") || "0").toLowerCase();
  const status = String(pick(row, ["status", "detailStatus", "detail_status"], "") || "").toLowerCase();
  return cancelDivision === "1" || cancelDivision.includes("cancel") || status.includes("cancel");
}

function isReturnTransaction(row) {
  const transactionDivision = String(pick(row, [
    "transactionHeadDivision",
    "transaction_head_division",
    "transactionDivision",
    "transaction_division"
  ], "1") || "1").toLowerCase();
  const status = String(pick(row, ["status", "transactionStatus", "transaction_status"], "") || "").toLowerCase();
  return status.includes("return") || status.includes("refund") || transactionDivision === "2" || transactionDivision === "return" || transactionDivision === "refund";
}

function isReturnDetail(row) {
  const division = String(pick(row, ["transactionDetailDivision", "transaction_detail_division", "detailDivision", "detail_division"], "") || "").toLowerCase();
  const status = String(pick(row, ["status", "detailStatus", "detail_status"], "") || "").toLowerCase();
  return status.includes("return") || status.includes("refund") || division === "2" || division === "return" || division === "refund";
}

function getDetails(row) {
  const details = pick(row, ["details", "transactionDetails", "transaction_details", "detailsList"], []);
  return Array.isArray(details) ? details : [];
}

function normalizeSales(transactions, productIdSet, targetTerminalId) {
  const sales = [];
  for (const transaction of transactions) {
    if (!transaction || isCancelledTransaction(transaction)) continue;
    const transactionSign = isReturnTransaction(transaction) ? -1 : 1;
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
      const sign = transactionSign * (isReturnDetail(detail) ? -1 : 1);
      const productId = String(pick(detail, ["productId", "product_id"]) || "").trim();
      if (!productId || (productIdSet.size && !productIdSet.has(productId))) return;
      const rawQuantity = toSignedInteger(pick(detail, ["quantity", "salesQuantity", "sales_quantity", "unitSalesQuantity", "unit_sales_quantity"], 0));
      // Smaregi can represent a cancellation/return either with a return
      // division or as a separately returned negative detail. Preserve the
      // latter's sign instead of turning it back into a positive sale.
      const quantitySign = rawQuantity < 0 ? -1 : sign;
      const quantity = Math.abs(rawQuantity) * quantitySign;
      if (!quantity) return;
      const unitPrice = toNumber(pick(detail, ["unitPrice", "unit_price", "salesPrice", "sales_price", "price"], 0));
      const amountInfo = getDetailAmountInfo(detail, quantity);
      const amount = Math.abs(amountInfo.amount) * quantitySign;
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
        unit_price: unitPrice,
        amount,
        amount_source: amountInfo.source,
        smaregi_amount_fields: {
          price: pick(detail, ["price"], ""),
          salesPrice: pick(detail, ["salesPrice", "sales_price"], ""),
          unitDiscountPrice: pick(detail, ["unitDiscountPrice", "unit_discount_price"], ""),
          unitDiscountSum: pick(detail, ["unitDiscountSum", "unit_discount_sum"], ""),
          unitNonDiscountSum: pick(detail, ["unitNonDiscountSum", "unit_non_discount_sum"], ""),
          unitDiscountedSum: pick(detail, ["unitDiscountedSum", "unit_discounted_sum"], "")
        },
        sold_at: soldAt,
        product_name: String(pick(detail, ["productName", "product_name"], "") || "").trim()
      });
    });
  }
  return sales;
}

function dedupeSales(sales) {
  const latestByDetail = new Map();
  (sales || []).forEach(sale => {
    const key = `${String(sale.smaregi_transaction_id || "").trim()}::${String(sale.smaregi_detail_id || "").trim()}`;
    if (key !== "::") latestByDetail.set(key, sale);
  });
  return [...latestByDetail.values()];
}

async function fetchTransactions(apiBase, token, context, fromDateTime, toDateTime) {
  const rows = [];
  let pageCount = 0;
  for (let page = 1; page <= 100; page += 1) {
    pageCount = page;
    const url = new URL(apiBase + "/transactions");
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
    url.searchParams.set("page", String(page));
    url.searchParams.set("with_details", "all");
    url.searchParams.set("store_id", context.storeId);
    url.searchParams.set("terminal_tran_date_time-from", fromDateTime);
    url.searchParams.set("terminal_tran_date_time-to", toDateTime);
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
  return { rows, pageCount };
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
    const fromDateTime = normalizeJstDateTime(body.fromDateTime, fromDate, "start");
    const toDateTime = normalizeJstDateTime(body.toDateTime, toDate, "end");
    const productIds = Array.isArray(body.smaregiProductIds)
      ? body.smaregiProductIds.map(value => String(value || "").trim()).filter(Boolean)
      : [];

    if (!fromDateTime || !toDateTime) throw new Error("Target period is required.");
    if (fromDateTime > toDateTime) throw new Error("Target period end must be after start.");

    const context = resolveSmaregiContext(body);
    if (!context.storeId) throw new Error(`Smaregi store id is not configured for ${context.storeName}.`);
    if (!context.targetTerminalId) throw new Error("Target booth terminal id is required.");
    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const fetchedAt = new Date().toISOString();
    const result = await fetchTransactions(apiBase, token, context, fromDateTime, toDateTime);
    const transactions = result.rows;
    const productIdSet = new Set(productIds);
    const sales = dedupeSales(normalizeSales(transactions, productIdSet, context.targetTerminalId));

    return res.status(200).json({
      sales,
      count: sales.length,
      fetchedAt,
      fromDateTime,
      toDateTime,
      transactionsCount: transactions.length,
      pages: result.pageCount,
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
