const DEFAULT_LIMIT = 1000;

function env(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const contractId = env("SMAREGI_CONTRACT_ID", "SMAREGI_CONTRACTID");
    const token = env("SMAREGI_ACCESS_TOKEN", "SMAREGI_APP_ACCESS_TOKEN", "SMAREGI_TOKEN");
    if (!contractId || !token) {
      throw new Error("SMAREGI_CONTRACT_ID and SMAREGI_ACCESS_TOKEN are required");
    }

    const apiBase = env("SMAREGI_POS_API_BASE_URL") || `https://api.smaregi.jp/${contractId}/pos`;
    const storeId = env("SMAREGI_STORE_ID");
    const [products, stockRows] = await Promise.all([
      fetchAll(apiBase, "/products", token),
      fetchAll(apiBase, "/stock", token)
    ]);

    const stocks = new Map();
    stockRows.forEach(stock => {
      if (storeId && String(stock.storeId ?? stock.store_id ?? "") !== String(storeId)) return;
      const productId = String(stock.productId ?? stock.product_id ?? "");
      const amount = Number(stock.stockAmount ?? stock.stock_amount);
      if (!productId || !Number.isFinite(amount)) return;
      stocks.set(productId, (stocks.get(productId) || 0) + amount);
    });

    const normalized = products.map(product => {
      const productId = String(product.productId ?? product.product_id ?? "");
      const barcode = String(product.productCode ?? product.product_code ?? "").trim();
      const name = String(product.productName ?? product.product_name ?? "").trim();
      if (!barcode || !name) return null;
      const row = { barcode, name };
      if (stocks.has(productId)) row.base_stock = stocks.get(productId);
      return row;
    }).filter(Boolean);

    return res.status(200).json({ products: normalized, count: normalized.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
