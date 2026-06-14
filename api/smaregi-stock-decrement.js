const DEFAULT_STOCK_SCOPE = "pos.stock:write";
const DEFAULT_STOCK_PATH = "/stock/{product_id}/add";

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
  const clientId = env("SMAREGI_NEW_CLIENT_ID", "NEW_SMAREGI_CLIENT_ID");
  const clientSecret = env("SMAREGI_NEW_CLIENT_SECRET", "NEW_SMAREGI_CLIENT_SECRET");
  const contractId = env(
    "SMAREGI_NEW_CONTRACT_ID",
    "SMAREGI_NEW_CONTRACTID",
    "NEW_SMAREGI_CONTRACT_ID",
    "NEW_SMAREGI_CONTRACTID"
  );
  const apiBase = env("SMAREGI_NEW_POS_API_BASE_URL", "NEW_SMAREGI_POS_API_BASE_URL");
  const storeId = env(
    "SMAREGI_NEW_TOKYO_STORE_ID",
    "NEW_SMAREGI_TOKYO_STORE_ID",
    "SMAREGI_TOKYO_STORE_ID"
  );
  const stockPath = env(
    "SMAREGI_NEW_TOKYO_STOCK_DECREMENT_PATH",
    "NEW_SMAREGI_TOKYO_STOCK_DECREMENT_PATH"
  );
  const stockUrl = env(
    "SMAREGI_NEW_TOKYO_STOCK_DECREMENT_URL",
    "NEW_SMAREGI_TOKYO_STOCK_DECREMENT_URL"
  );
  const stockMethod = env(
    "SMAREGI_NEW_TOKYO_STOCK_DECREMENT_METHOD",
    "NEW_SMAREGI_TOKYO_STOCK_DECREMENT_METHOD"
  ) || "POST";
  const stockScope = env(
    "SMAREGI_NEW_TOKYO_STOCK_SCOPE",
    "NEW_SMAREGI_TOKYO_STOCK_SCOPE"
  ) || DEFAULT_STOCK_SCOPE;
  return {
    accountKey: "new",
    accountName: "new Smaregi",
    storeCode: "tokyo",
    storeName: "Tokyo",
    storeId,
    clientId,
    clientSecret,
    contractId,
    apiBase,
    stockUrl,
    stockPath,
    stockMethod,
    stockScope
  };
}

function resolveStockPath(path, context) {
  return (path || DEFAULT_STOCK_PATH)
    .replaceAll("{store_id}", encodeURIComponent(context.storeId || ""))
    .replaceAll("{storeId}", encodeURIComponent(context.storeId || ""));
}

function resolveStockUrl(context, apiBase, line) {
  const productId = encodeURIComponent(line.productId || line.smaregiProductId || "");
  if (context.stockUrl) {
    return context.stockUrl
      .replaceAll("{store_id}", encodeURIComponent(context.storeId || ""))
      .replaceAll("{storeId}", encodeURIComponent(context.storeId || ""))
      .replaceAll("{product_id}", productId)
      .replaceAll("{productId}", productId);
  }
  return apiBase + resolveStockPath(context.stockPath, context)
    .replaceAll("{product_id}", productId)
    .replaceAll("{productId}", productId);
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

function groupLinesByProduct(lines) {
  const grouped = new Map();
  for (const line of lines) {
    if (!line.productId) {
      throw new Error(
        `Missing smaregi_product_id for stock decrement: ${line.name || line.barcode || line.productCode || "unknown"}`
      );
    }
    const key = line.productId;
    const current = grouped.get(key) || {
      productId: line.productId,
      productCode: line.productCode,
      barcode: line.barcode,
      name: line.name,
      quantity: 0,
      changeQuantity: 0
    };
    current.quantity += Number(line.quantity || 0);
    current.changeQuantity = -Math.abs(current.quantity);
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .map(line => ({
      ...line,
      quantity: Math.abs(Number(line.quantity || 0)),
      changeQuantity: -Math.abs(Number(line.quantity || 0))
    }))
    .filter(line => line.quantity > 0);
}

function buildStockPayload(context, line, body) {
  const memoBase = [
    "ARICO sales",
    body.invoiceNo || "",
    body.originNumber || ""
  ].filter(Boolean).join(" ");
  return {
    storeId: String(context.storeId || ""),
    stockAmount: String(-Math.abs(Number(line.quantity || 0))),
    stockHistory: {
      memo: memoBase.slice(0, 100)
    }
  };
}

function findMovementId(body) {
  if (!body || typeof body !== "object") return "";
  return String(
    body.stockHistory?.id ||
    body.stock_history?.id ||
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
    if (!context.storeId) {
      throw new Error("New Smaregi Tokyo store ID is not configured. Set SMAREGI_NEW_TOKYO_STORE_ID.");
    }
    const stockLines = groupLinesByProduct(lines);
    step = "oauth_token";
    const token = await getAccessToken(context);
    step = "stock_decrement";
    console.log("[smaregi-stock-decrement] request", {
      invoiceNo: body.invoiceNo || "",
      originNumber: body.originNumber || "",
      storeName: context.storeName,
      storeId: context.storeId,
      stockMethod: context.stockMethod,
      stockPath: context.stockPath || DEFAULT_STOCK_PATH,
      lineCount: stockLines.length
    });

    const results = [];
    for (const line of stockLines) {
      const stockUrl = resolveStockUrl(context, apiBase, line);
      const payload = buildStockPayload(context, line, body);
      const response = await fetch(stockUrl, {
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
        throw new Error(
          `Smaregi stock decrement JSON parse failed ${response.status} productId=${line.productId}: ${responseText.slice(0, 500)}`
        );
      }
      if (!response.ok) {
        throw new Error(
          `Smaregi stock decrement error ${response.status} productId=${line.productId}: ${JSON.stringify(responseBody)}`
        );
      }
      results.push({
        productId: line.productId,
        productCode: line.productCode,
        barcode: line.barcode,
        name: line.name,
        quantity: line.quantity,
        changeQuantity: line.changeQuantity,
        stockUrl,
        response: responseBody,
        smaregiStockMovementId: findMovementId(responseBody)
      });
    }
    return sendJson(res, 200, {
      ok: true,
      step,
      status: 200,
      smaregiStockMovementId: results.map(result => result.smaregiStockMovementId).filter(Boolean).join(","),
      lines: stockLines,
      results,
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        storeId: context.storeId || null,
        stockPath: context.stockPath || DEFAULT_STOCK_PATH,
        stockUrl: context.stockUrl || null,
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
