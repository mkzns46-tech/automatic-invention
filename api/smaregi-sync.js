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
  const localLabels = { tokyo: "東京", aichi: "愛知", nagano: "長野" };
  const storeId = env(
    `SMAREGI_${storePrefix}_STORE_ID`,
    storeCode === "tokyo" ? "SMAREGI_STORE_ID" : ""
  );
  if (!storeId) throw new Error(`Smaregi store id is not configured for ${labels[storeCode] || storeCode}.`);
  return { storeCode, storeName: labels[storeCode] || storeCode, storeLabel: localLabels[storeCode] || labels[storeCode] || storeCode, storeId: String(storeId) };
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
  if (debugContext.apiStats) {
    debugContext.apiStats.total += 1;
    if (path === "/stock") debugContext.apiStats.stock += 1;
    else if (path.startsWith("/stock/changes/")) debugContext.apiStats.stockChanges += 1;
    else if (path.startsWith("/products/")) debugContext.apiStats.products += 1;
    else debugContext.apiStats.other += 1;
  }
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

function getChangeTimeValue(change) {
  return change?.targetDateTime || change?.updDateTime || "";
}

async function fetchChanges(base, token, productId, storeId, since, until, apiStats) {
  const rows = [];
  const sinceTime = new Date(since).getTime();
  const untilTime = new Date(until).getTime();
  for (let page = 1; page <= 100; page++) {
    const part = await smaregiFetch(base, token, `/stock/changes/${encodeURIComponent(productId)}/${encodeURIComponent(storeId)}`, {
      sort: "updDateTime:desc",
      limit: 1000,
      page
    }, { apiStats });
    if (!Array.isArray(part)) break;
    const current = part.filter(row => {
      const rowStoreId = String(row.storeId || row.store_id || storeId);
      if (rowStoreId !== String(storeId)) return false;
      const changedTime = new Date(getChangeTimeValue(row)).getTime();
      return Number.isFinite(changedTime) && changedTime > sinceTime && changedTime <= untilTime;
    });
    rows.push(...current);
    const pageHasNewerRows = part.some(row => {
      const changedTime = new Date(getChangeTimeValue(row)).getTime();
      return Number.isFinite(changedTime) && changedTime > sinceTime;
    });
    if (part.length < 1000 || !pageHasNewerRows) break;
  }
  return rows;
}

function buildStoreCheckpointTokens(storeContext) {
  return [...new Set([
    storeContext.storeCode,
    storeContext.storeName,
    storeContext.storeLabel,
    storeContext.storeCode === "tokyo" ? "東京" : "",
    storeContext.storeCode === "aichi" ? "愛知" : "",
    storeContext.storeCode === "nagano" ? "長野" : ""
  ].map(value => String(value || "").trim()).filter(Boolean))];
}

async function getLastCompletedAtForStore(storeContext) {
  const storeId = String(storeContext.storeId || "");
  const storeCode = String(storeContext.storeCode || "");
  const noteFilter = encodeURIComponent(`*store_id:${storeId}*`);
  const storeSnapshots = await supabase(`smaregi_stock_snapshots?select=id,completed_at,source,note&source=eq.api&note=ilike.${noteFilter}&completed_at=not.is.null&order=completed_at.desc&limit=1`);
  if (Array.isArray(storeSnapshots) && storeSnapshots[0]?.completed_at) return { completedAt: storeSnapshots[0].completed_at, source: "api_note_store_id", snapshotId: storeSnapshots[0].id || "" };
  const codeFilter = encodeURIComponent(`*store_code:${storeCode}*`);
  const codeSnapshots = await supabase(`smaregi_stock_snapshots?select=id,completed_at,source,note&source=eq.api&note=ilike.${codeFilter}&completed_at=not.is.null&order=completed_at.desc&limit=1`);
  if (Array.isArray(codeSnapshots) && codeSnapshots[0]?.completed_at) return { completedAt: codeSnapshots[0].completed_at, source: "api_note_store_code", snapshotId: codeSnapshots[0].id || "" };
  const itemRows = await supabase(`smaregi_stock_items?select=snapshot_id&store_id=eq.${encodeURIComponent(storeId)}&snapshot_id=not.is.null&limit=10000`);
  const snapshotIds = [...new Set((Array.isArray(itemRows) ? itemRows : [])
    .map(row => String(row.snapshot_id || "").trim())
    .filter(Boolean))];
  if (snapshotIds.length) {
    const idFilter = snapshotIds.map(id => id.replace(/[(),]/g, "")).join(",");
    if (idFilter) {
      const snapshots = await supabase(`smaregi_stock_snapshots?select=id,completed_at,source,note&id=in.(${idFilter})&completed_at=not.is.null&order=completed_at.desc&limit=1`);
      if (Array.isArray(snapshots) && snapshots[0]?.completed_at) return { completedAt: snapshots[0].completed_at, source: "api_items_store_id", snapshotId: snapshots[0].id || "" };
    }
  }

  const tokens = buildStoreCheckpointTokens(storeContext);
  const completedSnapshots = await supabase("smaregi_stock_snapshots?select=id,completed_at,source,note&completed_at=not.is.null&order=completed_at.desc&limit=50");
  for (const snapshot of Array.isArray(completedSnapshots) ? completedSnapshots : []) {
    if (!snapshot?.id || snapshot.source === "api") continue;
    const checks = await supabase(`smaregi_stock_checks?select=checked_by&snapshot_id=eq.${encodeURIComponent(snapshot.id)}&limit=1000`).catch(() => []);
    const names = (Array.isArray(checks) ? checks : []).map(row => String(row.checked_by || ""));
    if (names.some(name => tokens.some(token => name.includes(token)))) {
      return { completedAt: snapshot.completed_at, source: "legacy_csv_checked_by_store_label", snapshotId: snapshot.id || "" };
    }
  }

  return { completedAt: "", source: "not_found", snapshotId: "" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let authDebug = null;
  try {
    const body = parseBody(req);
    const storeContext = resolveStoreContext(body);
    const contractId = env("SMAREGI_CONTRACT_ID", "SMAREGI_CONTRACTID");
    const clientId = env("SMAREGI_CLIENT_ID");
    const clientSecret = env("SMAREGI_CLIENT_SECRET");
    const accessToken = env("SMAREGI_ACCESS_TOKEN");
    const configuredApiBase = env("SMAREGI_POS_API_BASE_URL");
    const configuredTokenUrl = env("SMAREGI_TOKEN_URL", "SMAREGI_OAUTH_TOKEN_URL");
    if (!accessToken && (!contractId || !clientId || !clientSecret)) {
      throw new Error("Smaregi OAuth settings are incomplete. Set SMAREGI_CONTRACT_ID, SMAREGI_CLIENT_ID and SMAREGI_CLIENT_SECRET, or set SMAREGI_ACCESS_TOKEN.");
    }
    if (!contractId && !configuredApiBase) {
      throw new Error("Smaregi API base is incomplete. Set SMAREGI_CONTRACT_ID or SMAREGI_POS_API_BASE_URL.");
    }
    const configuredEnv = cleanEnv(process.env.SMAREGI_ENV).toLowerCase();
    if (configuredEnv && !["sandbox", "production"].includes(configuredEnv)) {
      throw new Error("SMAREGI_ENV must be sandbox or production.");
    }

    const isSandboxContract = contractId.startsWith("sb_");
    const sandbox = isSandboxContract || configuredEnv === "sandbox";
    const idBase = sandbox ? "https://id.smaregi.dev" : "https://id.smaregi.jp";
    const defaultApiBase = `${sandbox ? "https://api.smaregi.dev" : "https://api.smaregi.jp"}/${encodeURIComponent(contractId)}/pos`;
    const defaultTokenUrl = `${idBase}/app/${encodeURIComponent(contractId)}/token`;
    const apiBase = isSandboxContract ? defaultApiBase : (configuredApiBase || defaultApiBase);
    const tokenUrl = isSandboxContract ? defaultTokenUrl : (configuredTokenUrl || defaultTokenUrl);
    const scope = "pos.stock:read pos.products:read pos.stock-changes:read";
    authDebug = {
      environment: sandbox ? "sandbox" : "production",
      token_url: tokenUrl,
      api_base: apiBase,
      contract_id_prefix: prefix(contractId),
      client_id_prefix: prefix(clientId),
      store_code: storeContext.storeCode,
      store_id: storeContext.storeId,
      auth_mode: accessToken ? "access_token" : "client_credentials",
      configured_env: configuredEnv || "",
      sandbox_contract: isSandboxContract
    };
    console.info("[smaregi-auth]", authDebug);

    let token = accessToken;
    if (!token) {
      const tokenData = await readJson(await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString()
      }), "Smaregi OAuth");
      token = tokenData.access_token;
    }
    if (!token) throw new Error("Smaregi OAuth did not return an access token.");

    const syncStartedAt = new Date();
    const checkpoint = await getLastCompletedAtForStore(storeContext);
    const lastCompletedAt = checkpoint.completedAt || "";
    const initialLookbackDays = Math.max(1, Math.min(30, Number(env("SMAREGI_INITIAL_LOOKBACK_DAYS")) || 7));
    const since = lastCompletedAt || new Date(syncStartedAt.getTime() - initialLookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const changed = [];
    const apiStats = { total: 0, stock: 0, stockChanges: 0, products: 0, other: 0, stockPages: 0, stockChangePages: 0 };
    for (const [from, to] of splitDateRanges(since, syncStartedAt.toISOString())) {
      changed.push(...await fetchAll(apiBase, token, "/stock", {
        store_id: storeContext.storeId,
        "upd_date_time-from": formatSmaregiDate(from),
        "upd_date_time-to": formatSmaregiDate(to)
      }, {
        SMAREGI_ENV: sandbox ? "sandbox" : "production",
        token_url: tokenUrl,
        store_code: storeContext.storeCode,
        apiStats
      }));
    }
    apiStats.stockPages = apiStats.stock;

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
    const stockCandidates = [...latestByStoreProduct.values()];
    const changeResults = stockCandidates.length
      ? await mapLimit(stockCandidates, 4, async row => ({
        stock: row,
        rows: await fetchChanges(apiBase, token, row.productId, storeContext.storeId, since, syncStartedAt.toISOString(), apiStats)
      }))
      : [];
    apiStats.stockChangePages = apiStats.stockChanges;
    const activeResults = changeResults
      .map(result => {
        const unique = new Map();
        result.rows.forEach(change => {
          const changeId = String(change.id || `${result.stock.productId}-${getChangeTimeValue(change)}`);
          if (!unique.has(changeId)) unique.set(changeId, change);
        });
        return { ...result, rows: [...unique.values()] };
      })
      .filter(result => result.rows.length > 0);
    const stockRows = activeResults.map(result => result.stock);
    const changes = activeResults.map(result => result.rows);
    const products = await mapLimit(stockRows, 8, row => smaregiFetch(apiBase, token, `/products/${encodeURIComponent(row.productId)}`, {
      fields: "productId,productCode,productName"
    }, { apiStats }));

    const items = stockRows.map((stock, index) => ({
      barcode: String(products[index]?.productCode || products[index]?.productId || stock.productId),
      product_name: String(products[index]?.productName || ""),
      smaregi_stock: Math.trunc(Number(stock.stockAmount || 0)),
      product_id: String(stock.productId),
      store_id: String(storeContext.storeId),
      latest_change_at: changes[index].reduce((latest, change) => {
        const value = getChangeTimeValue(change);
        return !latest || new Date(value) > new Date(latest) ? value : latest;
      }, ""),
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
          `checkpoint:${checkpoint.source || "not_found"}`,
          `candidates:${stockCandidates.length}`
        ].filter(Boolean).join(" / "),
        range_from: new Date(since).toISOString(),
        range_to: syncStartedAt.toISOString()
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
        changed_at: getChangeTimeValue(change) || null,
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
      candidate_count: stockCandidates.length,
      history_available: true,
      warning: "",
      range_from: new Date(since).toISOString(),
      range_to: syncStartedAt.toISOString(),
      store_code: storeContext.storeCode,
      store_name: storeContext.storeName,
      store_id: storeContext.storeId,
      auth_mode: accessToken ? "access_token" : "client_credentials",
      initial_sync: !lastCompletedAt,
      checkpoint_source: checkpoint.source || "not_found",
      checkpoint_snapshot_id: checkpoint.snapshotId || "",
      api_request_count: apiStats
    });
  } catch (error) {
    const debug = authDebug ? {
      environment: authDebug.environment,
      token_host: (() => { try { return new URL(authDebug.token_url).host; } catch (_) { return ""; } })(),
      api_host: (() => { try { return new URL(authDebug.api_base).host; } catch (_) { return ""; } })(),
      contract_id_prefix: authDebug.contract_id_prefix,
      client_id_prefix: authDebug.client_id_prefix,
      store_code: authDebug.store_code,
      store_id: authDebug.store_id,
      auth_mode: authDebug.auth_mode,
      configured_env: authDebug.configured_env,
      sandbox_contract: authDebug.sandbox_contract
    } : null;
    return res.status(500).json({ error: error.message || String(error), debug });
  }
};
