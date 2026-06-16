const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

async function salesFetch(path, options = {}) {
  const url = `${ARICO_SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: ARICO_SUPABASE_API_KEY,
      Authorization: `Bearer ${ARICO_SUPABASE_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text().catch(() => "");
  console.log("[Sales Supabase response]", {
    url,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    empty: !text,
    body: text
  });

  if (!response.ok) {
    throw new Error(text || `Supabase API error ${response.status}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error?.message || String(error);
    throw new Error(`Supabase JSON parse failed ${response.status}: ${message}: ${text.slice(0, 500)}`);
  }
}

(function () {
  const MIGRATION_PREFIX = "arico_sales_supabase_migrated_v1_";
  const CONFIG = {
    customers: {
      table: "sales_customers",
      localKey: "arico_sales_customers_v1",
      conflictKey: "customer_code",
      documentKey: "customer_code",
      getDocumentNo: row => row.customerCode || row.customer_code || row.code || ""
    },
    quotes: {
      table: "sales_quotes",
      localKey: "arico_sales_quotes_v1",
      conflictKey: "document_no",
      documentKey: "document_no",
      getDocumentNo: row => row.quoteNo || row.quoteNumber || row.document_no || row.documentNo || ""
    }
  };

  function readLocalJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value && typeof value === "object" ? value : fallback);
    } catch (_) {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function migrationKey(type) {
    return `${MIGRATION_PREFIX}${type}`;
  }

  function toDbRow(type, row) {
    const config = CONFIG[type];
    const documentNo = String(config.getDocumentNo(row) || "").trim();
    const dbRow = {
      data: row || {},
      status: row?.status || "",
      created_at: row?.created_at || row?.createdAt || undefined,
      updated_at: row?.updated_at || row?.updatedAt || new Date().toISOString()
    };
    if (config.documentKey === "customer_code") dbRow.customer_code = documentNo;
    else dbRow.document_no = documentNo;
    return dbRow;
  }

  function fromDbRow(row) {
    const data = row?.data && typeof row.data === "object" ? { ...row.data } : {};
    if (row?.id && !data.id) data.id = row.id;
    if (row?.id && !data.supabaseId) data.supabaseId = row.id;
    if (row?.created_at && !data.created_at) data.created_at = row.created_at;
    if (row?.updated_at) data.updated_at = row.updated_at;
    if (row?.status && !data.status) data.status = row.status;
    if (row?.document_no && !data.document_no) data.document_no = row.document_no;
    if (row?.document_no && !data.quoteNo) data.quoteNo = row.document_no;
    if (row?.document_no && !data.quoteNumber) data.quoteNumber = row.document_no;
    if (row?.customer_code && !data.customer_code) data.customer_code = row.customer_code;
    if (row?.customer_code && !data.customerCode) data.customerCode = row.customer_code;
    if (!data.customerName && data.customer_name) data.customerName = data.customer_name;
    if (!data.organizationName && data.organization_name) data.organizationName = data.organization_name;
    if (!data.customerType && data.customer_type) data.customerType = data.customer_type;
    if (!data.smaregiMemberId && data.smaregi_member_id) data.smaregiMemberId = data.smaregi_member_id;
    if (!data.smaregiMemberCode && data.smaregi_member_code) data.smaregiMemberCode = data.smaregi_member_code;
    if (!data.smaregiCustomerId && data.smaregi_customer_id) data.smaregiCustomerId = data.smaregi_customer_id;
    if (!data.smaregiCustomerCode && data.smaregi_customer_code) data.smaregiCustomerCode = data.smaregi_customer_code;
    return data;
  }

  function uniqueByDocument(type, rows) {
    const config = CONFIG[type];
    const seen = new Set();
    return (rows || []).filter(row => {
      const key = String(config.getDocumentNo(row) || row.id || "").trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function listSalesRecords(type) {
    const config = CONFIG[type];
    const rows = await salesFetch(`${config.table}?select=*&order=created_at.desc`);
    return Array.isArray(rows) ? rows.map(fromDbRow) : [];
  }

  async function upsertSalesRecord(type, row) {
    const config = CONFIG[type];
    const dbRow = toDbRow(type, row);
    if (!dbRow[config.documentKey]) return null;
    return salesFetch(`${config.table}?on_conflict=${config.conflictKey}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(dbRow)
    });
  }

  async function upsertSalesRecords(type, rows) {
    const config = CONFIG[type];
    const dbRows = uniqueByDocument(type, rows)
      .map(row => toDbRow(type, row))
      .filter(row => row[config.documentKey]);
    if (!dbRows.length) return [];
    return salesFetch(`${config.table}?on_conflict=${config.conflictKey}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(dbRows)
    });
  }

  async function migrateLocalToSupabase(type) {
    const config = CONFIG[type];
    if (localStorage.getItem(migrationKey(type)) === "true") return;
    const localRows = readLocalJson(config.localKey, []);
    if (localRows.length) {
      const remoteRows = await listSalesRecords(type).catch(() => []);
      const remoteKeys = new Set(remoteRows.map(row => String(config.getDocumentNo(row) || "").trim()).filter(Boolean));
      const missingRows = localRows.filter(row => {
        const key = String(config.getDocumentNo(row) || "").trim();
        return key && !remoteKeys.has(key);
      });
      if (missingRows.length) await upsertSalesRecords(type, missingRows);
    }
    localStorage.setItem(migrationKey(type), "true");
  }

  async function initSalesCollection(type) {
    const config = CONFIG[type];
    await migrateLocalToSupabase(type);
    const rows = await listSalesRecords(type);
    writeLocalJson(config.localKey, rows);
    return rows;
  }

  function readCachedSalesCollection(type) {
    const config = CONFIG[type];
    return readLocalJson(config.localKey, []);
  }

  function writeCachedSalesCollection(type, rows) {
    const config = CONFIG[type];
    writeLocalJson(config.localKey, rows || []);
    upsertSalesRecords(type, rows || []).catch(error => {
      console.error(`[SalesStorage] Supabase save failed: ${type}`, error);
    });
  }

  async function saveSalesRecord(type, row) {
    const config = CONFIG[type];
    const rows = readCachedSalesCollection(type);
    const targetKey = String(config.getDocumentNo(row) || row.id || "").trim();
    const index = rows.findIndex(existing => {
      const existingKey = String(config.getDocumentNo(existing) || existing.id || "").trim();
      return targetKey && existingKey === targetKey;
    });
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    writeLocalJson(config.localKey, rows);
    await upsertSalesRecord(type, row);
    return row;
  }

  window.SalesStorage = {
    initSalesCollection,
    readCachedSalesCollection,
    writeCachedSalesCollection,
    saveSalesRecord,
    upsertSalesRecords,
    listSalesRecords
  };
})();
