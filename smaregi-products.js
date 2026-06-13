const DEFAULT_LIMIT = 1000;

function env(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(String(value ?? "").replace(/,/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
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

async function getAccessToken(contractId) {
  const clientId = env("SMAREGI_CLIENT_ID");
  const clientSecret = env("SMAREGI_CLIENT_SECRET");
  if (!contractId || !clientId || !clientSecret) {
    throw new Error("スマレジ変動商品チェックと同じOAuth認証設定を読み込めません。/api/smaregi-sync.js と同じ環境変数設定を確認してください。");
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
    throw new Error(`スマレジOAuth認証エラー ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const contractId = env("SMAREGI_CONTRACT_ID", "SMAREGI_CONTRACTID");
    const token = await getAccessToken(contractId);

    const apiBase = env("SMAREGI_POS_API_BASE_URL") || `https://api.smaregi.jp/${contractId}/pos`;
    const products = await fetchAll(apiBase, "/products", token);

    const normalized = products.map(product => {
      const barcode = String(product.productCode ?? product.product_code ?? "").trim();
      const name = String(product.productName ?? product.product_name ?? "").trim();
      const smaregi_product_id = String(product.productId ?? product.product_id ?? "").trim() || null;
      if (!barcode || !name) return null;
      const row = { barcode, name, smaregi_product_id };
      const category = String(product.categoryName ?? product.category_name ?? "").trim();
      const genre = String(product.genreName ?? product.genre_name ?? "").trim();
      const department = String(product.departmentName ?? product.department_name ?? "").trim();
      const price = firstNumber(
        product.price,
        product.productPrice,
        product.product_price,
        product.sellingPrice,
        product.selling_price,
        product.salesPrice,
        product.sales_price,
        product.unitPrice,
        product.unit_price
      );
      if (category) row.category = category;
      if (genre) row.genre = genre;
      if (department) row.department = department;
      if (price) row.price = price;
      return row;
    }).filter(Boolean);

    return res.status(200).json({ products: normalized, count: normalized.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
