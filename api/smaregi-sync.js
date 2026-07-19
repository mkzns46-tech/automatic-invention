const SUPABASE_URL = process.env.SUPABASE_URL || "https://ihsbkknysozkstvylqff.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_API_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

function cleanEnv(value) {
  let cleaned = String(value || "").replace(/^\uFEFF/, "").trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function env(...names) {
  for (const name of names) {
    const value = cleanEnv(process.env[name]);
    if (value) return value;
  }
  return "";
}

function required(name) {
  const value = cleanEnv(process.env[name]);
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`);
  return value;
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

function normalizeStoreCode(value) {
  const text = cleanEnv(value).toLowerCase();
  if (text === "aichi") return "aichi";
  if (text === "nagano") return "nagano";
  return "tokyo";
}

function resolveStoreContext(body = {}) {
  const storeCode = normalizeStoreCode(body.storeCode || body.currentStore || body.store);
  const storePrefix = storeCode.toUpperCase();
  const labels = { tokyo: "Tokyo", aichi: "Aichi", nagano: "Nagano" };
  const storeId = env(
    `SMAREGI_${storePrefix}_STORE_ID`,
    storeCode === "tokyo" ? "SMAREGI_STORE_ID" : ""
  );
  if (!storeId) throw new Error(`Smaregi store id is not configured for ${labels[storeCode] || storeCode}.`);
  return { storeCode, storeName: labels[storeCode] || storeCode, storeId: String(storeId) };
}

function prefix(value, length = 6) {
  return value ? `${value.slice(0, length)}...` : "(empty)";
}

async function readJson(res, label) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label} failed (${res.status}) ${detail || ""}`);
  }
  return body;
}

async function supabase(path, opt = {}) {
  return readJson(await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${path}`, {
    ...opt,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opt.headers || {})
    }
  }), "Supabase request");
}

async function smaregiFetch(base, token, path, params = {}, debugContext = {}) {
  const url = new URL(`${base}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  if (path === "/stock") {
    console.log("[smaregi-stock-request]", {
      request_url: url.toString(),
      "upd_date_time-from": url.searchParams.get("upd_date_time-from"),
      "upd_date_time-to": url.searchParams.get("upd_date_time-to"),
      store_id: url.searchParams.get("store_id"),
      store_code: debugContext.store_code || "",
      SMAREGI_ENV: debugContext.SMAREGI_ENV || "",
      token_url: debugContext.token_url || ""
    });
  }
  return readJson(await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  }), `Smaregi API ${path}`);
}

async function fetchAll(base, token, path, params = {}, debugContext = {}) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await smaregiFetch(base, token, path, { ...params, limit: 1000, page }, debugContext);
    if (!Array.isArray(rows)) throw new Error(`Unexpected Smaregi API response for ${path}.`);
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

function formatSmaregiDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date for Smaregi API: ${date}`);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;
}

function splitDateRanges(from, to) {
  const ranges = [];
  let start = new Date(from);
  const end = new Date(to);
  while (start < end) {
    const next = new Date(Math.min(end.getTime(), start.getTime() + 30 * 24 * 60 * 60 * 1000));
    ranges.push([start.toISOString(), next.toISOString()]);
    start = next;
  }
  return ranges;
}

async function mapLimit(rows, limit, fn) {
  const results = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      results[index] = await fn(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return results;
}

async function fetchChanges(base, token, productId, storeId, since) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const part = await smaregiFetch(base, token, `/stock/changes/${encodeURIComponent(productId)}/${encodeURIComponent(storeId)}`, {
      sort: "updDateTime:desc",
      limit: 1000,
      page
    });
    if (!Array.isArray(part)) break;
    const current = part.filter(row => new Date(row.updDateTime) >= new Date(since));
    rows.push(...current);
    if (part.length < 1000 || current.length < part.length) break;
  }
  return rows;
}

async function fetchChangesSafely(base, token, productId, storeId, since) {
  try {
    return { rows: await fetchChanges(base, token, productId, storeId, since), warning: "" };
  } catch (error) {
    return { rows: [], warning: `stock changes API failed: ${error.message || String(error)}` };
  }
}

async function getLastCompletedAtForStore(storeContext) {
  const storeId = String(storeContext.storeId || "");
  const storeCode = String(storeContext.storeCode || "");
  const noteFilter = encodeURIComponent(`*store_id:${storeId}*`);
  const storeSnapshots = await supabase(`smaregi_stock_snapshots?select=completed_at&source=eq.api&note=ilike.${noteFilter}&completed_at=not.is.null&order=completed_at.desc&limit=1`);
  if (Array.isArray(storeSnapshots) && storeSnapshots[0]?.completed_at) return storeSnapshots[0].completed_at;
  const codeFilter = encodeURIComponent(`*store_code:${storeCode}*`);
  const codeSnapshots = await supabase(`smaregi_stock_snapshots?select=completed_at&source=eq.api&note=ilike.${codeFilter}&completed_at=not.is.null&order=completed_at.desc&limit=1`);
  if (Array.isArray(codeSnapshots) && codeSnapshots[0]?.completed_at) return codeSnapshots[0].completed_at;
  const itemRows = await supabase(`smaregi_stock_items?select=snapshot_id&store_id=eq.${encodeURIComponent(storeId)}&snapshot_id=not.is.null&limit=10000`);
  const snapshotIds = [...new Set((Array.isArray(itemRows) ? itemRows : [])
    .map(row => String(row.snapshot_id || "").trim())
    .filter(Boolean))];
  if (!snapshotIds.length) return "";
  const idFilter = snapshotIds.map(id => id.replace(/[(),]/g, "")).join(",");
  if (!idFilter) return "";
  const snapshots = await supabase(`smaregi_stock_snapshots?select=completed_at&id=in.(${idFilter})&completed_at=not.is.null&order=completed_at.desc&limit=1`);
  return Array.isArray(snapshots) && snapshots[0]?.completed_at ? snapshots[0].completed_at : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = parseBody(req);
    const storeContext = resolveStoreContext(body);
    const contractId = required("SMAREGI_CONTRACT_ID");
    const clientId = required("SMAREGI_CLIENT_ID");
    const clientSecret = required("SMAREGI_CLIENT_SECRET");
    const configuredEnv = cleanEnv(process.env.SMAREGI_ENV).toLowerCase();
    if (configuredEnv && !["sandbox", "production"].includes(configuredEnv)) {
      throw new Error("SMAREGI_ENV must be sandbox or production.");
    }

    const sandbox = configuredEnv ? configuredEnv === "sandbox" : contractId.startsWith("sb_");
    const idBase = sandbox ? "https://id.smaregi.dev" : "https://id.smaregi.jp";
    const apiBase = `${sandbox ? "https://api.smaregi.dev" : "https://api.smaregi.jp"}/${encodeURIComponent(contractId)}/pos`;
    const tokenUrl = `${idBase}/app/${encodeURIComponent(contractId)}/token`;
    const scope = "pos.stock:read pos.products:read pos.stock-changes:read";
    console.info("[smaregi-auth]", {
      environment: sandbox ? "sandbox" : "production",
      token_url: tokenUrl,
      contract_id_prefix: prefix(contractId),
      client_id_prefix: prefix(clientId),
      store_code: storeContext.storeCode,
      store_id: storeContext.storeId
    });

    const tokenData = await readJson(await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString()
    }), "Smaregi OAuth");
    const token = tokenData.access_token;
    if (!token) throw new Error("Smaregi OAuth did not return an access token.");

    const now = new Date();
    const lastCompletedAt = await getLastCompletedAtForStore(storeContext);
    const since = lastCompletedAt || new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const changed = [];
    for (const [from, to] of splitDateRanges(since, now.toISOString())) {
      changed.push(...await fetchAll(apiBase, token, "/stock", {
        store_id: storeContext.storeId,
        "upd_date_time-from": formatSmaregiDate(from),
        "upd_date_time-to": formatSmaregiDate(to)
      }, {
        SMAREGI_ENV: sandbox ? "sandbox" : "production",
        token_url: tokenUrl,
        store_code: storeContext.storeCode
      }));
    }

    const latestByStoreProduct = new Map();
    changed.forEach(row => {
      const rowStoreId = String(row.storeId || row.store_id || storeContext.storeId);
      if (rowStoreId !== String(storeContext.storeId)) return;
      const productId = String(row.productId || "");
      if (!productId) return;
      const key = `${storeContext.storeId}|${productId}`;
      const old = latestByStoreProduct.get(key);
      if (!old || new Date(row.updDateTime) > new Date(old.updDateTime)) latestByStoreProduct.set(key, row);
    });
    const stockRows = [...latestByStoreProduct.values()];
    const products = await mapLimit(stockRows, 8, row => smaregiFetch(apiBase, token, `/products/${encodeURIComponent(row.productId)}`, {
      fields: "productId,productCode,productName"
    }));

    let changeResults = [];
    if (stockRows.length) {
      const first = await fetchChangesSafely(apiBase, token, stockRows[0].productId, storeContext.storeId, since);
      if (first.warning) {
        changeResults = stockRows.map(() => ({ rows: [], warning: first.warning }));
      } else {
        const remaining = await mapLimit(stockRows.slice(1), 4, row => fetchChangesSafely(apiBase, token, row.productId, storeContext.storeId, since));
        changeResults = [first, ...remaining];
      }
    }
    const changes = changeResults.map(result => result.rows);
    const historyWarnings = [...new Set(changeResults.map(result => result.warning).filter(Boolean))];

    const items = stockRows.map((stock, index) => ({
      barcode: String(products[index]?.productCode || products[index]?.productId || stock.productId),
      product_name: String(products[index]?.productName || ""),
      smaregi_stock: Math.trunc(Number(stock.stockAmount || 0)),
      product_id: String(stock.productId),
      store_id: String(storeContext.storeId),
      latest_change_at: stock.updDateTime,
      change_count: changes[index]?.length || 0
    }));

    const snapshots = await supabase("smaregi_stock_snapshots", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{
        source: "api",
        note: [
          "smaregi-api-sync",
          `store_code:${storeContext.storeCode}`,
          `store_id:${storeContext.storeId}`,
          historyWarnings[0] || ""
        ].filter(Boolean).join(" / "),
        range_from: new Date(since).toISOString(),
        range_to: now.toISOString()
      }])
    });
    const snapshot = snapshots[0];
    if (!snapshot) throw new Error("Could not create smaregi_stock_snapshots row.");

    for (let index = 0; index < items.length; index += 500) {
      await supabase("smaregi_stock_items", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(items.slice(index, index + 500).map(item => ({ ...item, snapshot_id: snapshot.id })))
      });
    }

    const changeRows = [];
    changes.forEach((rows, index) => {
      rows.forEach(change => changeRows.push({
        snapshot_id: snapshot.id,
        smaregi_change_id: String(change.id || `${stockRows[index].productId}-${change.updDateTime || change.targetDateTime || index}`),
        product_id: String(stockRows[index].productId),
        store_id: String(storeContext.storeId),
        barcode: items[index].barcode,
        changed_at: change.updDateTime || change.targetDateTime || null,
        amount: Math.trunc(Number(change.amount || 0)),
        stock_amount: Math.trunc(Number(change.stockAmount || 0)),
        stock_division: String(change.stockDivision || ""),
        memo: String(change.memo || "")
      }));
    });
    for (let index = 0; index < changeRows.length; index += 500) {
      await supabase("smaregi_stock_changes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(changeRows.slice(index, index + 500))
      });
    }

    return res.status(200).json({
      snapshot_id: snapshot.id,
      item_count: items.length,
      change_count: changes.reduce((sum, rows) => sum + rows.length, 0),
      history_available: historyWarnings.length === 0,
      warning: historyWarnings[0] || "",
      range_from: new Date(since).toISOString(),
      range_to: now.toISOString(),
      store_code: storeContext.storeCode,
      store_name: storeContext.storeName,
      store_id: storeContext.storeId,
      initial_sync: !lastCompletedAt
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};
