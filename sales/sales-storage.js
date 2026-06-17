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
  const memoryCache = {};
  const CONFIG = {
    customers: {
      table: "sales_customers",
      localKey: "arico_sales_customers_v1",
      backupKey: "arico_sales_local_backup_v1_customers",
      conflictKey: "customer_code",
      documentKey: "customer_code",
      getDocumentNo: row => row.customerCode || row.customer_code || row.code || ""
    },
    quotes: {
      table: "sales_quotes",
      localKey: "arico_sales_quotes_v1",
      backupKey: "arico_sales_local_backup_v1_quotes",
      conflictKey: "document_no",
      documentKey: "document_no",
      getDocumentNo: row => row.quoteNo || row.quoteNumber || row.document_no || row.documentNo || ""
    },
    invoices: {
      table: "sales_invoices",
      localKey: "arico_sales_invoices_v1",
      backupKey: "arico_sales_local_backup_v1_invoices",
      conflictKey: "document_no",
      documentKey: "document_no",
      getDocumentNo: row => row.invoiceNo || row.invoiceNumber || row.document_no || row.documentNo || row.originNumber || ""
    },
    deliveries: {
      table: "sales_deliveries",
      localKey: "arico_sales_deliveries_v1",
      backupKey: "arico_sales_local_backup_v1_deliveries",
      conflictKey: "document_no",
      documentKey: "document_no",
      getDocumentNo: row => row.deliveryNo || row.deliveryNumber || row.document_no || row.documentNo || row.originNumber || ""
    },
    receipts: {
      table: "sales_receipts",
      localKey: "arico_sales_receipts_v1",
      backupKey: "arico_sales_local_backup_v1_receipts",
      conflictKey: "document_no",
      documentKey: "document_no",
      getDocumentNo: row => row.receiptNo || row.receiptNumber || row.document_no || row.documentNo || row.originNumber || ""
    }
  };
  const SETTINGS_BACKUP_KEY = "arico_sales_local_backup_v1_settings";
  const PAYMENTS_BACKUP_KEY = "arico_sales_local_backup_v1_payments";
  const SETTINGS_LOCAL_KEYS = [
    "arico_sales_pdf_logo",
    "arico_sales_pdf_stamp",
    "arico_sales_staff_display_map_v1",
    "arico_sales_staff_display_overrides_v1"
  ];

  function readLocalJson(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(memoryCache, key)) {
      const value = memoryCache[key];
      return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value && typeof value === "object" ? value : fallback);
    }
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : (value && typeof value === "object" ? value : fallback);
    } catch (_) {
      return fallback;
    }
  }

  function writeLocalJson(key, value) {
    memoryCache[key] = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`[SalesStorage] localStorage write skipped: ${key}`, error);
    }
  }

  function backupLocalValue(sourceKey, backupKey) {
    if (localStorage.getItem(backupKey) !== null) return;
    const value = localStorage.getItem(sourceKey);
    if (value !== null) localStorage.setItem(backupKey, value);
  }

  function backupPaymentsFromInvoices() {
    if (localStorage.getItem(PAYMENTS_BACKUP_KEY) !== null) return;
    const invoices = readLocalJson("arico_sales_invoices_v1", []);
    const payments = [];
    invoices.forEach(invoice => {
      (Array.isArray(invoice?.payments) ? invoice.payments : []).forEach(payment => {
        payments.push({
          ...payment,
          invoice_document_no: invoice.invoiceNo || invoice.invoiceNumber || invoice.document_no || invoice.documentNo || "",
          invoice_id: invoice.id || ""
        });
      });
    });
    try {
      localStorage.setItem(PAYMENTS_BACKUP_KEY, JSON.stringify(payments));
    } catch (error) {
      memoryCache[PAYMENTS_BACKUP_KEY] = payments;
      console.warn("[SalesStorage] payments backup kept in memory", error);
    }
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
      created_at: row?.created_at || row?.createdAt || row?.savedAt || row?.issuedAt || row?.invoiceDate || row?.quoteDate || row?.deliveryDate || row?.receiptDate || new Date().toISOString(),
      updated_at: row?.updated_at || row?.updatedAt || new Date().toISOString()
    };
    if (["deliveries", "receipts"].includes(type)) {
      dbRow.invoice_document_no = row?.invoiceNo || row?.invoiceNumber || row?.originNumber || row?.invoice_document_no || null;
    }
    if (type === "invoices") {
      dbRow.quote_document_no = row?.quoteNo || row?.quoteNumber || row?.sourceQuoteNo || row?.quote_document_no || null;
    }
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
    if (row?.invoice_document_no && !data.invoice_document_no) data.invoice_document_no = row.invoice_document_no;
    if (row?.quote_document_no && !data.quote_document_no) data.quote_document_no = row.quote_document_no;
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

  function getRecordKey(type, row) {
    const config = CONFIG[type];
    return String(config.getDocumentNo(row) || "").trim();
  }

  function createMigrationStats(label, localCount = 0) {
    return {
      label,
      localCount,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      errorMessages: []
    };
  }

  function addMigrationError(stats, error) {
    stats.errors += 1;
    const message = error?.message || String(error);
    if (message && stats.errorMessages.length < 5) stats.errorMessages.push(message);
  }

  async function listSalesRecords(type) {
    const config = CONFIG[type];
    const rows = await salesFetchAll(`${config.table}?select=*&order=created_at.desc`);
    return Array.isArray(rows) ? rows.map(fromDbRow) : [];
  }

  async function salesFetchAll(path, pageSize = 1000) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const separator = path.includes("?") ? "&" : "?";
      const page = await salesFetch(`${path}${separator}limit=${pageSize}&offset=${offset}`);
      const pageRows = Array.isArray(page) ? page : [];
      rows.push(...pageRows);
      if (pageRows.length < pageSize) break;
    }
    return rows;
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
    backupLocalValue(config.localKey, config.backupKey);
    if (type === "invoices") backupPaymentsFromInvoices();
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

  async function remigrateLocalCollectionToSupabase(type) {
    const config = CONFIG[type];
    backupLocalValue(config.localKey, config.backupKey);
    if (type === "invoices") backupPaymentsFromInvoices();
    const localRows = readLocalJson(config.localKey, []);
    const stats = createMigrationStats(type, localRows.length);
    const remoteRows = await listSalesRecords(type).catch(error => {
      addMigrationError(stats, error);
      return [];
    });
    const remoteKeys = new Set(remoteRows.map(row => getRecordKey(type, row)).filter(Boolean));
    const seenLocalKeys = new Set();

    for (const row of localRows) {
      const key = getRecordKey(type, row);
      if (!key || seenLocalKeys.has(key)) {
        stats.skipped += 1;
        continue;
      }
      seenLocalKeys.add(key);
      try {
        await upsertSalesRecord(type, row);
        if (remoteKeys.has(key)) stats.updated += 1;
        else stats.inserted += 1;
        remoteKeys.add(key);
      } catch (error) {
        addMigrationError(stats, error);
      }
    }

    localStorage.setItem(migrationKey(type), "true");
    return stats;
  }

  async function initSalesCollection(type) {
    const config = CONFIG[type];
    await migrateLocalToSupabase(type);
    const rows = await listSalesRecords(type);
    writeLocalJson(config.localKey, rows);
    if (type === "invoices") {
      saveSalesPaymentsForInvoices(rows).catch(error => {
        console.warn("[SalesStorage] payment summary init failed", error);
      });
    }
    return rows;
  }

  async function initSalesCollections(types) {
    const result = {};
    for (const type of types || []) {
      result[type] = await initSalesCollection(type);
    }
    return result;
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
    if (type === "invoices") {
      saveSalesPaymentsForInvoices(rows || []).catch(error => {
        console.warn("[SalesStorage] payment summary save failed", error);
      });
    }
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
    if (type === "invoices") {
      await saveSalesPaymentsForInvoices(rows).catch(error => {
        console.warn("[SalesStorage] payment summary record save failed", error);
      });
    }
    return row;
  }

  async function saveSalesPaymentsForInvoices(invoices) {
    const targets = (invoices || []).filter(invoice => Array.isArray(invoice?.payments) && invoice.payments.length);
    for (const invoice of targets) {
      const invoiceNo = invoice.invoiceNo || invoice.invoiceNumber || invoice.document_no || invoice.documentNo || "";
      if (!invoiceNo) continue;
      const payload = {
        invoice_document_no: invoiceNo,
        data: {
          invoiceId: invoice.id || "",
          invoiceNo,
          customerName: invoice.customerName || "",
          payments: invoice.payments || []
        },
        status: invoice.status || "",
        updated_at: invoice.updated_at || invoice.updatedAt || new Date().toISOString()
      };
      const existing = await salesFetch(`sales_payments?select=id&invoice_document_no=eq.${encodeURIComponent(invoiceNo)}&limit=1`).catch(() => []);
      const id = Array.isArray(existing) && existing[0]?.id;
      if (id) {
        await salesFetch(`sales_payments?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        }).catch(error => console.warn(`[SalesStorage] payment summary update failed: ${invoiceNo}`, error));
      } else {
        await salesFetch("sales_payments", {
          method: "POST",
          body: JSON.stringify(payload)
        }).catch(error => console.warn(`[SalesStorage] payment summary insert failed: ${invoiceNo}`, error));
      }
    }
  }

  function readLocalPaymentsForMigration() {
    const directPayments = readLocalJson("arico_sales_payments_v1", []);
    const invoiceRows = readLocalJson("arico_sales_invoices_v1", []);
    const invoicePayments = [];
    invoiceRows.forEach(invoice => {
      const invoiceNo = invoice?.invoiceNo || invoice?.invoiceNumber || invoice?.document_no || invoice?.documentNo || "";
      (Array.isArray(invoice?.payments) ? invoice.payments : []).forEach(payment => {
        invoicePayments.push({
          ...payment,
          invoice_document_no: payment?.invoice_document_no || invoiceNo,
          invoice_id: payment?.invoice_id || invoice?.id || ""
        });
      });
    });
    return [...directPayments, ...invoicePayments];
  }

  function paymentDocumentNo(payment) {
    return String(payment?.invoice_document_no || payment?.invoiceNo || payment?.invoiceNumber || payment?.document_no || payment?.documentNo || "").trim();
  }

  async function remigrateLocalPaymentsToSupabase() {
    backupPaymentsFromInvoices();
    const payments = readLocalPaymentsForMigration();
    const stats = createMigrationStats("payments", payments.length);
    const remoteRows = await salesFetchAll("sales_payments?select=invoice_document_no").catch(error => {
      addMigrationError(stats, error);
      return [];
    });
    const remoteKeys = new Set((Array.isArray(remoteRows) ? remoteRows : []).map(row => String(row?.invoice_document_no || "").trim()).filter(Boolean));
    const seenLocalKeys = new Set();

    for (const payment of payments) {
      const invoiceNo = paymentDocumentNo(payment);
      if (!invoiceNo || seenLocalKeys.has(invoiceNo)) {
        stats.skipped += 1;
        continue;
      }
      seenLocalKeys.add(invoiceNo);
      const payload = {
        invoice_document_no: invoiceNo,
        data: payment || {},
        status: payment?.status || "",
        updated_at: payment?.updated_at || payment?.updatedAt || new Date().toISOString()
      };
      try {
        const existing = await salesFetch(`sales_payments?select=id&invoice_document_no=eq.${encodeURIComponent(invoiceNo)}&limit=1`).catch(() => []);
        const id = Array.isArray(existing) && existing[0]?.id;
        if (id) {
          await salesFetch(`sales_payments?id=eq.${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
          stats.updated += 1;
        } else {
          await salesFetch("sales_payments", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          stats.inserted += 1;
        }
        remoteKeys.add(invoiceNo);
      } catch (error) {
        addMigrationError(stats, error);
      }
    }

    return stats;
  }

  async function listSalesSettings() {
    const rows = await salesFetch("sales_settings?select=*");
    return Array.isArray(rows) ? rows : [];
  }

  async function saveSalesSetting(key, value) {
    if (!key) return null;
    return salesFetch("sales_settings?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key, value })
    });
  }

  async function initSalesSettings(options = {}) {
    const migrateLocal = options.migrateLocal !== false;
    if (localStorage.getItem(SETTINGS_BACKUP_KEY) === null) {
      const backup = {};
      SETTINGS_LOCAL_KEYS.forEach(key => {
        backup[key] = localStorage.getItem(key);
      });
      localStorage.setItem(SETTINGS_BACKUP_KEY, JSON.stringify(backup));
    }
    if (migrateLocal) {
      for (const key of SETTINGS_LOCAL_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) {
          const remoteKey = key.replace(/^arico_sales_/, "");
          await saveSalesSetting(remoteKey, value).catch(error => {
            console.warn(`[SalesStorage] settings migration failed: ${remoteKey}`, error);
          });
        }
      }
    }
    const settings = await listSalesSettings().catch(() => []);
    settings.forEach(row => {
      const localKey = row.key?.startsWith("arico_sales_") ? row.key : `arico_sales_${row.key}`;
      const value = row.value;
      if (typeof value === "string") localStorage.setItem(localKey, value);
      else if (value !== undefined && value !== null) localStorage.setItem(localKey, JSON.stringify(value));
    });
    return settings;
  }

  async function remigrateLocalSettingsToSupabase() {
    const entries = [];
    SETTINGS_LOCAL_KEYS.forEach(key => {
      if (localStorage.getItem(key) !== null) entries.push([key.replace(/^arico_sales_/, ""), localStorage.getItem(key)]);
    });
    const settingsObject = readLocalJson("arico_sales_settings_v1", {});
    Object.entries(settingsObject || {}).forEach(([key, value]) => {
      if (!key) return;
      entries.push([key.replace(/^arico_sales_/, ""), typeof value === "string" ? value : JSON.stringify(value)]);
    });

    const uniqueEntries = [];
    const seen = new Set();
    entries.forEach(([key, value]) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniqueEntries.push([key, value]);
    });

    const stats = createMigrationStats("settings", uniqueEntries.length);
    const remoteRows = await listSalesSettings().catch(error => {
      addMigrationError(stats, error);
      return [];
    });
    const remoteKeys = new Set((Array.isArray(remoteRows) ? remoteRows : []).map(row => String(row?.key || "").trim()).filter(Boolean));

    for (const [key, value] of uniqueEntries) {
      try {
        await saveSalesSetting(key, value);
        if (remoteKeys.has(key)) stats.updated += 1;
        else stats.inserted += 1;
        remoteKeys.add(key);
      } catch (error) {
        addMigrationError(stats, error);
      }
    }
    return stats;
  }

  async function remigrateAllLocalSalesData() {
    const result = {};
    for (const type of Object.keys(CONFIG)) {
      result[type] = await remigrateLocalCollectionToSupabase(type);
    }
    result.payments = await remigrateLocalPaymentsToSupabase();
    result.settings = await remigrateLocalSettingsToSupabase();
    return result;
  }

  async function migrateAllLocalSalesData(options = {}) {
    if (options.force) return remigrateAllLocalSalesData();
    const result = await initSalesCollections(Object.keys(CONFIG));
    await initSalesSettings();
    return result;
  }

  window.SalesStorage = {
    initSalesCollection,
    initSalesCollections,
    readCachedSalesCollection,
    writeCachedSalesCollection,
    saveSalesRecord,
    upsertSalesRecords,
    saveSalesPaymentsForInvoices,
    listSalesRecords,
    initSalesSettings,
    saveSalesSetting,
    listSalesSettings,
    migrateAllLocalSalesData,
    remigrateAllLocalSalesData
  };

  initSalesSettings({ migrateLocal: false }).catch(error => {
    console.warn("[SalesStorage] settings preload failed", error);
  });
})();
