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
    const products = await fetchAll(apiBase, "/products", token);

    const normalized = products.map(product => {
      const barcode = String(product.productCode ?? product.product_code ?? "").trim();
      const name = String(product.productName ?? product.product_name ?? "").trim();
      if (!barcode || !name) return null;
      const row = { barcode, name };
      const category = String(product.categoryName ?? product.category_name ?? "").trim();
      const genre = String(product.genreName ?? product.genre_name ?? "").trim();
      const department = String(product.departmentName ?? product.department_name ?? "").trim();
      if (category) row.category = category;
      if (genre) row.genre = genre;
      if (department) row.department = department;
      return row;
    }).filter(Boolean);

    return res.status(200).json({ products: normalized, count: normalized.length });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
