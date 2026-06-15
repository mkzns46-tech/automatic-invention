const REQUIRED_STOCK_SCOPES = ["pos.stock:read"];
const DEFAULT_STOCK_SCOPE = REQUIRED_STOCK_SCOPES.join(" ");
const DEFAULT_STOCK_READ_PATH = "/stock/{product_id}";
const SUPABASE_URL = process.env.ARICO_SUPABASE_URL || process.env.SUPABASE_URL || "https://ihsbkknysozkstvylqff.supabase.co";
const SUPABASE_API_KEY = process.env.ARICO_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.ARICO_SUPABASE_API_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

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
  REQUIRED_STOCK_SCOPES.forEach(scope => scopes.add(scope));
  return Array.from(scopes).join(" ");
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  const unique = new Map();
  for (const line of lines) {
    const manual = Boolean(line?.manualProduct) || (!firstString(line?.smaregiProductId, line?.smaregi_product_id, line?.productId) && !firstString(line?.barcode, line?.productCode));
    if (manual) continue;
    const productId = firstString(line.smaregiProductId, line.smaregi_product_id, line.productId);
    const barcode = firstString(line.barcode, line.productCode);
    if (!productId && !barcode) continue;
    unique.set(`${productId}|${barcode}`, {
      productId,
      barcode,
      productCode: barcode,
      name: firstString(line.name, line.productName, line.itemName)
    });
  }
  return Array.from(unique.values());
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
  const stockReadPath = env("SMAREGI_NEW_TOKYO_STOCK_READ_PATH", "NEW_SMAREGI_TOKYO_STOCK_READ_PATH") || DEFAULT_STOCK_READ_PATH;
  const stockReadUrl = env("SMAREGI_NEW_TOKYO_STOCK_READ_URL", "NEW_SMAREGI_TOKYO_STOCK_READ_URL");
  const stockScope = env("SMAREGI_NEW_TOKYO_STOCK_SCOPE", "NEW_SMAREGI_TOKYO_STOCK_SCOPE");
  return {
    accountName: "new Smaregi",
    storeName: "Tokyo",
    clientId,
    clientSecret,
    contractId,
    apiBase,
    storeId,
    stockReadPath,
    stockReadUrl,
    stockScope: ensureRequiredScopes(stockScope || DEFAULT_STOCK_SCOPE)
  };
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret, stockScope } = context;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error("Smaregi OAuth settings are missing: new Smaregi / stock refresh.");
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
      scope: stockScope
    }).toString()
  });
  const text = await response.text().catch(() => "");
  const body = text ? JSON.parse(text) : null;
  if (!response.ok || !body?.access_token) {
    throw new Error(`Smaregi OAuth error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_API_KEY,
      Authorization: `Bearer ${SUPABASE_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Supabase API ${response.status}: ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findProduct(line) {
  if (line.barcode) {
    const filter = `barcode=eq.${encodeURIComponent(line.barcode)}`;
    const rows = await supabaseFetch(`products?select=barcode,base_stock,smaregi_product_id&${filter}&limit=1`);
    if (Array.isArray(rows) && rows[0]) return { row: rows[0], filter };
  }
  if (line.productId) {
    const filter = `smaregi_product_id=eq.${encodeURIComponent(line.productId)}`;
    const rows = await supabaseFetch(`products?select=barcode,base_stock,smaregi_product_id&${filter}&limit=1`);
    if (Array.isArray(rows) && rows[0]) return { row: rows[0], filter };
  }
  return null;
}

function resolveStockUrl(context, apiBase, productId) {
  const encodedProductId = encodeURIComponent(productId);
  const replacements = value => String(value || "")
    .replaceAll("{store_id}", encodeURIComponent(context.storeId || ""))
    .replaceAll("{storeId}", encodeURIComponent(context.storeId || ""))
    .replaceAll("{product_id}", encodedProductId)
    .replaceAll("{productId}", encodedProductId);
  if (context.stockReadUrl) return replacements(context.stockReadUrl);
  return apiBase + replacements(context.stockReadPath || DEFAULT_STOCK_READ_PATH);
}

function extractStockValue(body, storeId) {
  const candidates = [];
  const visit = value => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const sameStore = !storeId || !value.storeId || String(value.storeId) === String(storeId);
    for (const key of ["stockAmount", "stock_amount", "baseStock", "base_stock", "currentStock", "current_stock", "stock", "quantity", "qty"]) {
      if (Object.prototype.hasOwnProperty.call(value, key) && sameStore) {
        const number = Number(value[key]);
        if (Number.isFinite(number)) candidates.push(number);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(body);
  return candidates.length ? candidates[0] : null;
}

async function fetchSmaregiStock(context, apiBase, token, productId) {
  const url = resolveStockUrl(context, apiBase, productId);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });
  const text = await response.text().catch(() => "");
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    throw new Error(`Smaregi stock refresh JSON parse failed ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`Smaregi stock refresh API error ${response.status}: ${JSON.stringify(body)}`);
  }
  const stock = extractStockValue(body, context.storeId);
  if (stock === null) throw new Error(`Smaregi stock value was not found for productId=${productId}`);
  return { stock, response: body, url };
}

async function refreshLine(context, apiBase, token, line) {
  const found = await findProduct(line);
  if (!found) return { ...line, ok: false, skipped: true, reason: "products row not found" };
  const productId = firstString(line.productId, found.row.smaregi_product_id);
  if (!productId) return { ...line, ok: false, skipped: true, reason: "smaregi_product_id not found" };
  const stockResult = await fetchSmaregiStock(context, apiBase, token, productId);
  await supabaseFetch(`products?${found.filter}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ base_stock: stockResult.stock })
  });
  return {
    ...line,
    ok: true,
    productId,
    barcode: found.row.barcode || line.barcode || "",
    base_stock: stockResult.stock,
    stock: stockResult.stock,
    matchedBy: found.filter.startsWith("barcode=") ? "barcode" : "smaregi_product_id",
    stockUrl: stockResult.url
  };
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
    const lines = normalizeLines(body.lines);
    if (!lines.length) {
      return sendJson(res, 200, { ok: true, step: "no_target_lines", status: 200, results: [] });
    }
    step = "resolve_context";
    const context = resolveSmaregiContext();
    if (!context.storeId) throw new Error("New Smaregi Tokyo store ID is not configured. Set SMAREGI_NEW_TOKYO_STORE_ID.");
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    step = "oauth_token";
    const token = await getAccessToken(context);
    step = "stock_refresh";
    const results = [];
    for (const line of lines) {
      try {
        results.push(await refreshLine(context, apiBase, token, line));
      } catch (error) {
        results.push({ ...line, ok: false, error: error?.message || String(error) });
      }
    }
    return sendJson(res, 200, {
      ok: true,
      hasFailures: results.some(row => !row.ok && !row.skipped),
      step,
      status: 200,
      results,
      context: {
        accountName: context.accountName,
        storeName: context.storeName,
        storeId: context.storeId,
        stockReadPath: context.stockReadPath,
        stockReadUrl: context.stockReadUrl || null
      }
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[smaregi-stock-refresh] failed", {
      message,
      stack: error?.stack || "",
      method: req.method,
      step
    });
    return sendJson(res, 500, {
      ok: false,
      error: message,
      step,
      status: 500
    });
  }
};
