const REQUIRED_TRANSACTION_SCOPES = ["pos.transactions:read", "pos.transactions:write"];
const DEFAULT_TRANSACTION_SCOPE = REQUIRED_TRANSACTION_SCOPES.join(" ");
const DEFAULT_TRANSACTION_PATH = "/transactions";
const DEFAULT_PAYMENT_METHOD_NAME = "請求書";
const MANUAL_PRODUCT_ID = 2953;
const MANUAL_PRODUCT_CODE = "9900000000073";
const MANUAL_PRODUCT_NAME = "事務手数料";

function sendJson(res, status, payload) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
  } catch (_) {}
  return res.status(status).json(payload);
}

function env(...names) {
  for (const name of names) {
    if (name && process.env[name]) return process.env[name];
  }
  return "";
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

function ensureRequiredScopes(value) {
  const scopes = new Set(String(value || "").split(/\s+/).map(scope => scope.trim()).filter(Boolean));
  REQUIRED_TRANSACTION_SCOPES.forEach(scope => scopes.add(scope));
  return Array.from(scopes).join(" ");
}

function toInt(value) {
  const number = Math.round(Number(value || 0));
  return Number.isFinite(number) ? number : 0;
}

function toPositiveInteger(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return 0;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function smaregiDateTime(value) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const jst = new Date(safe.getTime() + 9 * 60 * 60 * 1000);
  const pad = number => String(number).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;
}

function resolveSmaregiContext() {
  const clientId = env("SMAREGI_NEW_CLIENT_ID", "NEW_SMAREGI_CLIENT_ID", "SMAREGI_CLIENT_ID");
  const clientSecret = env("SMAREGI_NEW_CLIENT_SECRET", "NEW_SMAREGI_CLIENT_SECRET", "SMAREGI_CLIENT_SECRET");
  const contractId = env(
    "SMAREGI_NEW_CONTRACT_ID",
    "SMAREGI_NEW_CONTRACTID",
    "NEW_SMAREGI_CONTRACT_ID",
    "NEW_SMAREGI_CONTRACTID",
    "SMAREGI_CONTRACT_ID",
    "SMAREGI_CONTRACTID"
  );
  const apiBase = env("SMAREGI_NEW_POS_API_BASE_URL", "NEW_SMAREGI_POS_API_BASE_URL", "SMAREGI_POS_API_BASE_URL");
  const storeId = env("SMAREGI_NEW_TOKYO_STORE_ID", "NEW_SMAREGI_TOKYO_STORE_ID", "SMAREGI_TOKYO_STORE_ID");
  const terminalId = env(
    "SMAREGI_NEW_TOKYO_TERMINAL_ID",
    "NEW_SMAREGI_TOKYO_TERMINAL_ID",
    "SMAREGI_TOKYO_TERMINAL_ID",
    "SMAREGI_TERMINAL_ID"
  ) || "4";
  const transactionPath = env("SMAREGI_NEW_TOKYO_TRANSACTION_PATH", "NEW_SMAREGI_TOKYO_TRANSACTION_PATH") || DEFAULT_TRANSACTION_PATH;
  const transactionScope = ensureRequiredScopes(env("SMAREGI_NEW_TOKYO_TRANSACTION_SCOPE", "NEW_SMAREGI_TOKYO_TRANSACTION_SCOPE") || DEFAULT_TRANSACTION_SCOPE);
  const paymentMethodId = env(
    "SMAREGI_NEW_TOKYO_INVOICE_PAYMENT_METHOD_ID",
    "NEW_SMAREGI_TOKYO_INVOICE_PAYMENT_METHOD_ID",
    "SMAREGI_INVOICE_PAYMENT_METHOD_ID"
  ) || "1";
  const paymentMethodName = env(
    "SMAREGI_NEW_TOKYO_INVOICE_PAYMENT_METHOD_NAME",
    "NEW_SMAREGI_TOKYO_INVOICE_PAYMENT_METHOD_NAME",
    "SMAREGI_INVOICE_PAYMENT_METHOD_NAME"
  ) || DEFAULT_PAYMENT_METHOD_NAME;
  return { contractId, clientId, clientSecret, apiBase, storeId, terminalId, transactionPath, transactionScope, paymentMethodId, paymentMethodName };
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret, transactionScope } = context;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error("Smaregi OAuth settings are missing: new Smaregi / sales cancel.");
  }
  const response = await fetch(`https://id.smaregi.jp/app/${contractId}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: transactionScope
    }).toString()
  });
  const text = await response.text().catch(() => "");
  const body = text ? JSON.parse(text) : null;
  if (!response.ok || !body?.access_token) {
    throw new Error(`Smaregi OAuth error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function fetchJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text().catch(() => "");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    throw new Error(`Smaregi cancel JSON parse failed ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`Smaregi cancel API error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line, index) => {
    const qty = Math.abs(Number(line.qty ?? line.quantity ?? 0));
    const unitPrice = toInt(line.unitPrice ?? line.price ?? line.salesPrice ?? 0);
    const amount = Math.abs(toInt(line.amount));
    const isManualProduct = Boolean(line.manualProduct) || (!firstString(line.smaregiProductId, line.smaregi_product_id, line.productId) && !firstString(line.productCode, line.barcode));
    const productId = isManualProduct ? MANUAL_PRODUCT_ID : toPositiveInteger(firstString(line.smaregiProductId, line.smaregi_product_id, line.productId));
    if (!productId) {
      throw new Error(`Invalid Smaregi productId for cancel line: ${firstString(line.name, line.productName, line.itemName, line.barcode) || index + 1}`);
    }
    return {
      transactionDetailId: String(index + 1),
      transactionDetailDivision: "1",
      productId,
      productCode: isManualProduct ? MANUAL_PRODUCT_CODE : firstString(line.productCode, line.barcode),
      productName: isManualProduct ? MANUAL_PRODUCT_NAME : firstString(line.name, line.productName, line.itemName),
      taxDivision: "0",
      price: String(unitPrice),
      salesPrice: String(unitPrice),
      unitDiscountPrice: String(toInt(line.discountAmount ?? line.discountAmountInput ?? 0)),
      unitDiscountRate: String(toInt(line.discountRate ?? line.discountValue ?? 0)),
      quantity: String(qty),
      salesDivision: "0",
      productDivision: "0",
      memo: firstString(line.memo, line.note),
      aricoAmount: amount,
      aricoQuantity: qty
    };
  }).filter(line => Number(line.aricoQuantity) > 0 && (line.productId || line.productCode || line.productName));
}

function findTransactionId(body) {
  if (!body || typeof body !== "object") return "";
  return String(body.transactionHeadId || body.transaction_head_id || body.id || "").trim();
}

function buildCancelPayload(context, body) {
  const sourceTransactionId = firstString(body.smaregiTransactionId, body.transactionHeadId, body.transactionId);
  if (!sourceTransactionId) throw new Error("Smaregi transaction ID is required for sale cancel.");
  const lines = normalizeLines(body.lines);
  if (!lines.length) throw new Error("No Smaregi cancel lines were provided.");
  const total = lines.reduce((sum, line) => sum + toInt(line.aricoAmount), 0);
  const taxInclude = toInt(body.tax ?? Math.floor(total * 10 / 110));
  const terminalTranIdSource = `${body.invoiceNo || ""}${Date.now()}`.replace(/\D/g, "");
  return {
    transactionHeadDivision: "2",
    cancelDivision: "0",
    subtotal: String(total),
    total: String(total),
    taxInclude: String(taxInclude),
    taxExclude: "0",
    storeId: String(context.storeId),
    terminalId: String(context.terminalId),
    terminalTranId: terminalTranIdSource.slice(-10).padStart(1, "1"),
    terminalTranDateTime: smaregiDateTime(body.cancelledAt || body.canceledAt || new Date().toISOString()),
    memo: [
      "販売管理キャンセル",
      `元取引:${firstString(body.smaregiTransactionId) || "-"}`,
      `伝票:${firstString(body.invoiceNo, body.originNumber) || "-"}`,
      `理由:${firstString(body.cancelReason) || "-"}`
    ].join(" ").slice(0, 100),
    sellDivision: "0",
    taxRate: "10",
    details: lines.map(({ aricoAmount, aricoQuantity, aricoManualProduct, aricoOverallDiscountLine, ...line }) => line),
    payments: [
      {
        paymentMethodId: context.paymentMethodId,
        paymentMethodName: context.paymentMethodName,
        paidAmount: total
      }
    ]
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "POST only", step: "method_check", status: 405 });
  }

  let step = "init";
  let requestJson = null;
  try {
    step = "parse_body";
    const body = parseBody(req);
    step = "resolve_context";
    const context = resolveSmaregiContext();
    if (!context.storeId) throw new Error("New Smaregi Tokyo store ID is not configured. Set SMAREGI_NEW_TOKYO_STORE_ID.");
    if (!context.terminalId) throw new Error("New Smaregi Tokyo terminal ID is not configured. Set SMAREGI_NEW_TOKYO_TERMINAL_ID.");
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    step = "oauth_token";
    const token = await getAccessToken(context);
    step = "cancel_payload";
    const payload = buildCancelPayload(context, body);
    requestJson = payload;
    console.log("[smaregi-sales-cancel] request_json", JSON.stringify(payload));
    step = "cancel_register";
    const responseBody = await fetchJson(apiBase + context.transactionPath, token, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return sendJson(res, 200, {
      ok: true,
      step,
      status: 200,
      smaregiCancelTransactionId: findTransactionId(responseBody),
      requestJson,
      response: responseBody
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[smaregi-sales-cancel] failed", {
      message,
      stack: error?.stack || "",
      method: req.method,
      step
    });
    return sendJson(res, 500, {
      ok: false,
      error: message,
      step,
      status: 500,
      requestJson
    });
  }
};
