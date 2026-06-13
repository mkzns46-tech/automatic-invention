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

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function findProductPrice(product) {
  const directKeys = [
    "price",
    "productPrice",
    "product_price",
    "sellingPrice",
    "selling_price",
    "salesPrice",
    "sales_price",
    "unitPrice",
    "unit_price",
    "taxIncludedPrice",
    "tax_included_price",
    "taxIncludedUnitPrice",
    "tax_included_unit_price",
    "displayPrice",
    "display_price",
    "storePrice",
    "store_price"
  ];
  for (const key of directKeys) {
    if (Object.prototype.hasOwnProperty.call(product, key)) {
      const price = parseNumber(product[key]);
      if (price !== null) return price;
    }
  }

  const seen = new Set();
  const stack = [product];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (
        /(price|amount|unitprice)/.test(lowerKey) &&
        !/(cost|stock|taxamount|discount|point)/.test(lowerKey)
      ) {
        const price = parseNumber(child);
        if (price !== null) return price;
      }
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return null;
}

function getProductIds(row) {
  return {
    productId: firstString(row.productId, row.product_id, row.id),
    productCode: firstString(row.productCode, row.product_code, row.barcode, row.code)
  };
}

function addPriceIndex(index, prefix, value, price) {
  const key = String(value || "").trim();
  if (!key || price === null || price === undefined) return;
  index.set(`${prefix}:${key}`, price);
}

function buildStorePriceIndex(priceRows) {
  const index = new Map();
  for (const row of priceRows) {
    if (!row || typeof row !== "object") continue;
    const price = findProductPrice(row);
    if (price === null) continue;
    const { productId, productCode } = getProductIds(row);
    addPriceIndex(index, "productId", productId, price);
    addPriceIndex(index, "productCode", productCode, price);
  }
  return index;
}

function findStorePrice(index, product) {
  const { productId, productCode } = getProductIds(product);
  if (index.has(`productId:${productId}`)) return index.get(`productId:${productId}`);
  if (index.has(`productCode:${productCode}`)) return index.get(`productCode:${productCode}`);
  return null;
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

  return {
    accountKey: "new",
    accountName: "new Smaregi",
    storeCode: "common",
    storeName: "common",
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

async function fetchStoreProductPrices(apiBase, storeId, token) {
  const path = storeId ? `/stores/${encodeURIComponent(storeId)}/product_prices` : "";
  const result = {
    attempted: Boolean(path),
    ok: false,
    path: path || null,
    count: 0,
    priceCount: 0,
    error: ""
  };
  if (!path) {
    result.error = "storeId is not configured";
    return { rows: [], result };
  }
  try {
    const rows = await fetchAll(apiBase, path, token);
    result.ok = true;
    result.count = rows.length;
    result.priceCount = rows.filter(row => findProductPrice(row) !== null).length;
    return { rows, result };
  } catch (error) {
    result.error = error.message || String(error);
    return { rows: [], result };
  }
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret } = context;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error(`Smaregi OAuth settings are missing: ${context.accountName} / ${context.storeName}`);
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
    throw new Error(`Smaregi OAuth error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    parseBody(req);
    const context = resolveSmaregiContext();
    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    const products = await fetchAll(apiBase, "/products", token);
    const { rows: storePriceRows, result: priceApi } = await fetchStoreProductPrices(apiBase, context.storeId, token);
    const storePriceIndex = buildStorePriceIndex(storePriceRows);

    let inlinePriceCount = 0;
    let storePriceMatchCount = 0;
    const normalized = products.map(product => {
      const barcode = String(product.productCode ?? product.product_code ?? "").trim();
      const name = String(product.productName ?? product.product_name ?? "").trim();
      const smaregi_product_id = String(product.productId ?? product.product_id ?? "").trim() || null;
      if (!barcode || !name) return null;
      const row = { barcode, name, smaregi_product_id };
      const category = String(product.categoryName ?? product.category_name ?? "").trim();
      const genre = String(product.genreName ?? product.genre_name ?? "").trim();
      const department = String(product.departmentName ?? product.department_name ?? "").trim();
      const inlinePrice = findProductPrice(product);
      const storePrice = findStorePrice(storePriceIndex, product);
      const price = storePrice !== null ? storePrice : inlinePrice;
      if (inlinePrice !== null) inlinePriceCount += 1;
      if (storePrice !== null) storePriceMatchCount += 1;
      if (category) row.category = category;
      if (genre) row.genre = genre;
      if (department) row.department = department;
      if (price !== null) row.price = price;
      return row;
    }).filter(Boolean);

    return res.status(200).json({
      products: normalized,
      count: normalized.length,
      priceCount: normalized.filter(row => Object.prototype.hasOwnProperty.call(row, "price")).length,
      priceSource: {
        inlineProductCount: inlinePriceCount,
        storeProductPriceCount: storePriceMatchCount
      },
      priceApi,
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
