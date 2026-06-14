const DEFAULT_STOCK_SCOPE = "pos.stocks:write";

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
  const storeId = env("SMAREGI_NEW_STORE_ID", "NEW_SMAREGI_STORE_ID", "SMAREGI_STORE_ID");
  const stockPath = env("SMAREGI_STOCK_DECREMENT_PATH", "SMAREGI_NEW_STOCK_DECREMENT_PATH");
  const stockMethod = env("SMAREGI_STOCK_DECREMENT_METHOD", "SMAREGI_NEW_STOCK_DECREMENT_METHOD") || "POST";
  const stockScope = env("SMAREGI_STOCK_SCOPE", "SMAREGI_NEW_STOCK_SCOPE") || DEFAULT_STOCK_SCOPE;
  return {
    accountKey: "new",
    accountName: "new Smaregi",
    storeCode: "common",
    storeName: "common",
    storeId,
    clientId,
    clientSecret,
    contractId,
    apiBase,
    stockPath,
    stockMethod,
    stockScope
  };
}

function resolveStockPath(path, context) {
  if (!path) {
    throw new Error("SMAREGI_STOCK_DECREMENT_PATH is not configured");
  }
  return path
    .replaceAll("{store_id}", encodeURIComponent(context.storeId || ""))
    .replaceAll("{storeId}", encodeURIComponent(context.storeId || ""));
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret, stockScope } = context;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error(`Smaregi OAuth settings are missing: ${context.accountName} / stock decrement`);
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
      scope: stockScope
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

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(line => {
    const quantity = Math.abs(Number(line.quantity || line.qty || 0));
    return {
      productId: String(line.productId || line.smaregiProductId || "").trim(),
      productCode: String(line.productCode || line.barcode || "").trim(),
      barcode: String(line.barcode || line.productCode || "").trim(),
      name: String(line.name || "").trim(),
      quantity,
      changeQuantity: -quantity
    };
  }).filter(line => line.quantity > 0 && (line.productId || line.productCode || line.barcode));
}

function findMovementId(body) {
  if (!body || typeof body !== "object") return "";
  return String(
    body.stockMovementId ||
    body.stock_movement_id ||
    body.movementId ||
    body.id ||
    body.transactionId ||
    body.transaction_id ||
    ""
  ).trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      error: "POST only",
      step: "method_check",
      status: 405
    });
  }

  let step = "init";
  try {
    step = "parse_body";
    const body = parseBody(req);
    const lines = normalizeLines(body.lines);
    if (!lines.length) {
      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: "no_stock_lines",
        lines: [],
        status: 200
      });
    }

    step = "resolve_context";
    const context = resolveSmaregiContext();
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const stockPath = resolveStockPath(context.stockPath, context);
    step = "oauth_token";
    const token = await getAccessToken(context);
    step = "stock_decrement";
    const payload = {
      storeId: context.storeId || body.storeId || "",
      reason: "sales_invoice_issue",
      invoiceNo: body.invoiceNo || "",
      originNumber: body.originNumber || "",
      idempotencyKey: body.idempotencyKey || body.invoiceId || body.invoiceNo || "",
      lines
    };
    const response = await fetch(apiBase + stockPath, {
      method: context.stockMethod,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text().catch(() => "");
    let responseBody = null;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
      throw new Error(`Smaregi stock decrement JSON parse failed ${response.status}: ${responseText.slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(`Smaregi stock decrement error ${response.status}: ${JSON.stringify(responseBody)}`);
    }
    return sendJson(res, 200, {
      ok: true,
      step,
      status: 200,
      smaregiStockMovementId: findMovementId(responseBody),
      lines,
      response: responseBody,
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId || null,
        stockPath,
        stockMethod: context.stockMethod,
        stockScope: context.stockScope
      }
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[smaregi-stock-decrement] failed", {
      message,
      stack: error?.stack || "",
      method: req.method,
      step
    });
    return sendJson(res, 500, {
      ok: false,
      error: message,
      errorType: message.includes("OAuth") ? "smaregi_auth_failed" : "smaregi_stock_decrement_failed",
      step,
      status: 500
    });
  }
};
