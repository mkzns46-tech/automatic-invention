const REQUIRED_TRANSACTION_SCOPES = ["pos.transactions:read", "pos.transactions:write"];
const DEFAULT_TRANSACTION_SCOPE = REQUIRED_TRANSACTION_SCOPES.join(" ");
const DEFAULT_TRANSACTION_PATH = "/transactions";
const DEFAULT_PAYMENT_METHOD_NAME = "請求書";

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

function ensureRequiredScopes(value) {
  const scopes = new Set(String(value || "").split(/\s+/).map(scope => scope.trim()).filter(Boolean));
  REQUIRED_TRANSACTION_SCOPES.forEach(scope => scopes.add(scope));
  return Array.from(scopes).join(" ");
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

function toInt(value) {
  const number = Math.round(Number(value || 0));
  return Number.isFinite(number) ? number : 0;
}

function toPositiveIntegerString(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return "";
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0) return "";
  return String(number);
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
  const pad = number => String(number).padStart(2, "0");
  const yyyy = safe.getFullYear();
  const mm = pad(safe.getMonth() + 1);
  const dd = pad(safe.getDate());
  const hh = pad(safe.getHours());
  const mi = pad(safe.getMinutes());
  const ss = pad(safe.getSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
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

  return {
    accountKey: "new",
    accountName: "new Smaregi",
    storeCode: "tokyo",
    storeName: "Tokyo",
    storeId,
    terminalId,
    clientId,
    clientSecret,
    contractId,
    apiBase,
    transactionPath,
    transactionScope,
    paymentMethodId,
    paymentMethodName
  };
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret, transactionScope } = context;
  if (!contractId || !clientId || !clientSecret) {
    const missing = [
      !contractId ? "contractId(SMAREGI_NEW_CONTRACT_ID or SMAREGI_CONTRACT_ID)" : "",
      !clientId ? "clientId(SMAREGI_NEW_CLIENT_ID or SMAREGI_CLIENT_ID)" : "",
      !clientSecret ? "clientSecret(SMAREGI_NEW_CLIENT_SECRET or SMAREGI_CLIENT_SECRET)" : ""
    ].filter(Boolean).join(", ");
    throw new Error(`Smaregi OAuth settings are missing: ${context.accountName} / sales register. Missing: ${missing}`);
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
      scope: transactionScope
    }).toString()
  });
  const responseText = await response.text().catch(() => "");
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    throw new Error(`Smaregi OAuth JSON parse failed ${response.status}: ${responseText.slice(0, 500)}`);
  }
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
  const responseText = await response.text().catch(() => "");
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    throw new Error(`Smaregi API JSON parse failed ${response.status}: ${responseText.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`Smaregi API error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function resolveInvoicePaymentMethod(context, apiBase, token) {
  if (context.paymentMethodId) {
    return { paymentMethodId: context.paymentMethodId, paymentMethodName: context.paymentMethodName, source: "env" };
  }
  const url = `${apiBase}/stores/${encodeURIComponent(context.storeId)}/payment_methods?limit=1000`;
  const rows = await fetchJson(url, token);
  const found = Array.isArray(rows)
    ? rows.find(row => String(row.paymentMethodName || "").trim() === context.paymentMethodName)
    : null;
  if (!found?.paymentMethodId) {
    throw new Error(`Smaregi payment method "${context.paymentMethodName}" was not found for Tokyo store. Set SMAREGI_NEW_TOKYO_INVOICE_PAYMENT_METHOD_ID.`);
  }
  return {
    paymentMethodId: String(found.paymentMethodId),
    paymentMethodName: String(found.paymentMethodName || context.paymentMethodName),
    source: "store_payment_methods"
  };
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map((line, index) => {
    const qty = Math.abs(Number(line.qty ?? line.quantity ?? 0));
    const unitPrice = toInt(line.unitPrice ?? line.price ?? line.salesPrice ?? 0);
    const amount = toInt(line.amount);
    const gross = Math.max(0, Math.round(qty * Math.abs(unitPrice)));
    const discountAmount = Math.max(0, Math.min(gross, toInt(line.discountAmount ?? line.discountAmountInput ?? 0)));
    return {
      transactionDetailId: String(index + 1),
      transactionDetailDivision: "1",
      productId: firstString(line.smaregiProductId, line.smaregi_product_id, line.productId),
      productCode: firstString(line.productCode, line.barcode),
      productName: firstString(line.name, line.productName, line.itemName),
      taxDivision: "0",
      price: String(unitPrice),
      salesPrice: String(unitPrice),
      unitDiscountPrice: String(discountAmount),
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

function buildTransactionPayload(context, body, paymentMethod) {
  const lines = normalizeLines(body.lines);
  if (!lines.length) throw new Error("No Smaregi sale lines were provided.");
  const subtotal = lines.reduce((sum, line) => sum + toInt(line.aricoAmount), 0);
  const total = toInt(body.total ?? subtotal);
  const taxInclude = toInt(body.tax ?? Math.floor(total * 10 / 110));
  const terminalTranIdSource = String(body.invoiceNo || body.invoiceId || Date.now()).replace(/\D/g, "");
  const terminalTranId = terminalTranIdSource.slice(-10).padStart(1, "1");
  const smaregiCustomerId = toPositiveIntegerString(body.smaregiCustomerId);
  const smaregiCustomerCode = firstString(body.smaregiCustomerCode);
  const payload = {
    transactionHeadDivision: "1",
    cancelDivision: "0",
    subtotal: String(total),
    total: String(total),
    taxInclude: String(taxInclude),
    taxExclude: "0",
    deposit: String(total),
    change: "0",
    storeId: String(context.storeId),
    terminalId: String(context.terminalId),
    terminalTranId,
    terminalTranDateTime: smaregiDateTime(body.issuedAt || body.invoiceDate || body.updatedAt),
    sumDivision: "0",
    memo: ["ARICO", body.invoiceNo || "", body.originNumber || "", body.transactionType || ""].filter(Boolean).join(" ").slice(0, 100),
    sellDivision: "0",
    taxRate: "10",
    details: lines.map(({ aricoAmount, aricoQuantity, ...line }) => line),
    payments: [
      {
        no: 1,
        paymentMethodId: paymentMethod.paymentMethodId,
        paymentMethodName: paymentMethod.paymentMethodName,
        receivedAmount: total,
        changeAmount: 0,
        paidAmount: total
      }
    ]
  };
  if (smaregiCustomerId) payload.customerId = smaregiCustomerId;
  if (smaregiCustomerCode) payload.customerCode = smaregiCustomerCode;
  return payload;
}

function findTransactionId(body) {
  if (!body || typeof body !== "object") return "";
  return String(body.transactionHeadId || body.transaction_head_id || body.id || "").trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "POST only", step: "method_check", status: 405 });
  }

  let step = "init";
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
    step = "payment_method";
    const paymentMethod = await resolveInvoicePaymentMethod(context, apiBase, token);
    step = "transaction_payload";
    const payload = buildTransactionPayload(context, body, paymentMethod);
    step = "transaction_register";
    const responseBody = await fetchJson(apiBase + context.transactionPath, token, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return sendJson(res, 200, {
      ok: true,
      step,
      status: 200,
      smaregiTransactionId: findTransactionId(responseBody),
      paymentMethod,
      lines: body.lines || [],
      response: responseBody,
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId,
        terminalId: context.terminalId,
        transactionPath: context.transactionPath,
        transactionScope: context.transactionScope
      }
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[smaregi-sales-register] failed", {
      message,
      stack: error?.stack || "",
      method: req.method,
      step
    });
    return sendJson(res, 500, {
      ok: false,
      error: message,
      errorType: message.includes("OAuth") ? "smaregi_auth_failed" : "smaregi_sales_register_failed",
      step,
      status: 500
    });
  }
};
