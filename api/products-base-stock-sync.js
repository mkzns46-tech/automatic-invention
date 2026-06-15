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

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(line => {
    const quantity = Math.abs(Number(line.quantity || line.qty || 0));
    return {
      productId: String(line.productId || line.smaregiProductId || line.smaregi_product_id || "").trim(),
      barcode: String(line.barcode || line.productCode || "").trim(),
      productCode: String(line.productCode || line.barcode || "").trim(),
      name: String(line.name || line.productName || "").trim(),
      quantity
    };
  }).filter(line => line.quantity > 0 && (line.barcode || line.productId || line.productCode));
}

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        apikey: SUPABASE_API_KEY,
        Authorization: `Bearer ${SUPABASE_API_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`Supabase fetch failed: ${url}: ${error?.message || error}`);
  }
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

async function syncLine(line) {
  const found = await findProduct(line);
  if (!found) {
    return { ...line, ok: false, error: "products row not found" };
  }
  const before = Number(found.row.base_stock || 0);
  const mode = String(line.mode || "").trim() === "restore" ? "restore" : "decrement";
  const quantity = Number(line.quantity || 0);
  const after = mode === "restore" ? before + quantity : before - quantity;
  await supabaseFetch(`products?${found.filter}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ base_stock: after })
  });
  return {
    ...line,
    ok: true,
    before,
    after,
    quantity,
    mode,
    matchedBy: found.filter.startsWith("barcode=") ? "barcode" : "smaregi_product_id",
    note: mode === "decrement" && after < 0 ? "base_stock is negative; display should show 取寄せ" : ""
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
    step = "normalize_lines";
    const mode = String(body.mode || "").trim() === "restore" ? "restore" : "decrement";
    const lines = normalizeLines(body.lines).map(line => ({ ...line, mode }));
    if (!lines.length) {
      return sendJson(res, 200, {
        ok: false,
        step,
        status: 200,
        error: "No products.base_stock sync lines were provided.",
        results: []
      });
    }

    step = "products_base_stock_sync";
    const results = [];
    for (const line of lines) {
      results.push(await syncLine(line));
    }
    const ok = results.every(result => result.ok);
    return sendJson(res, 200, { ok, step, status: 200, results });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[products-base-stock-sync] failed", {
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
