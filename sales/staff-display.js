(function () {
  const STAFF_MAP_KEY = "arico_sales_staff_display_map_v1";
  const STAFF_OVERRIDE_KEY = "arico_sales_staff_display_overrides_v1";
  const SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
  const SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
  let staffDisplayLoadPromise = null;

  function normalize(value) {
    return String(value || "").trim();
  }

  function staffKeyVariants(value) {
    const text = normalize(value);
    if (!text) return [];
    const variants = new Set([text]);
    variants.add(text.replace(/（/g, "(").replace(/）/g, ")"));
    variants.add(text.replace(/\(/g, "（").replace(/\)/g, "）"));
    variants.add(text.replace(/\s+\(/g, " (").replace(/\s+（/g, "（"));
    variants.add(text.replace(/\s+\(/g, "(").replace(/\s+（/g, "（"));
    return Array.from(variants).filter(Boolean);
  }

  function internalName(row) {
    const name = normalize(row?.name);
    const store = normalize(row?.store_name);
    return store ? `${name}\uFF08${store}\uFF09` : name;
  }

  function displayName(row) {
    return normalize(
      row?.sales_display_name ||
      row?.salesDisplayName ||
      row?.sales_full_name ||
      row?.salesFullName ||
      row?.display_name ||
      row?.displayName ||
      row?.full_name ||
      row?.fullName ||
      row?.name
    );
  }

  function readMap() {
    try {
      return JSON.parse(localStorage.getItem(STAFF_MAP_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function readOverrides() {
    try {
      return JSON.parse(localStorage.getItem(STAFF_OVERRIDE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function writeOverrides(map) {
    try {
      localStorage.setItem(STAFF_OVERRIDE_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function writeMap(map) {
    try {
      localStorage.setItem(STAFF_MAP_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function buildMap(rows) {
    const map = {};
    const overrides = readOverrides();
    (rows || []).forEach(row => {
      const key = internalName(row);
      const shortKey = normalize(row?.name);
      const halfWidthStoreKey = normalize(row?.store_name) && shortKey ? `${shortKey} (${normalize(row.store_name)})` : "";
      const label = overrides[key] || overrides[shortKey] || displayName(row);
      if (label) {
        [key, halfWidthStoreKey, shortKey].forEach(candidate => {
          staffKeyVariants(candidate).forEach(variant => {
            map[variant] = label;
          });
        });
      }
    });
    writeMap(map);
    return map;
  }

  async function fetchStaffRows() {
    const url = `${SUPABASE_URL}/rest/v1/staff_members?select=*&order=name.asc`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_API_KEY,
        Authorization: `Bearer ${SUPABASE_API_KEY}`
      }
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async function loadStaffDisplays() {
    try {
      const rows = await fetchStaffRows();
      buildMap(rows);
      return rows;
    } catch (_) {
      return [];
    }
  }

  async function ensureStaffDisplaysLoaded(options = {}) {
    const force = !!options.force;
    if (!force && Object.keys(readMap()).length) return readMap();
    if (!force && staffDisplayLoadPromise) {
      await staffDisplayLoadPromise;
      return readMap();
    }
    staffDisplayLoadPromise = loadStaffDisplays().finally(() => {
      staffDisplayLoadPromise = null;
    });
    await staffDisplayLoadPromise;
    return readMap();
  }

  function formatStaffName(value) {
    const text = normalize(value);
    if (!text) return "";
    const map = readMap();
    const foundKey = staffKeyVariants(text).find(key => map[key]);
    if (foundKey) return map[foundKey];
    const overrides = readOverrides();
    const overrideKey = staffKeyVariants(text).find(key => overrides[key]);
    return overrideKey ? overrides[overrideKey] : text;
  }

  function storageStaffName(value) {
    const text = normalize(value);
    if (!text) return "";
    const map = readMap();
    const found = Object.entries(map).find(([, label]) => normalize(label) === text);
    if (found) return found[0];
    const overrides = readOverrides();
    const overrideFound = Object.entries(overrides).find(([, label]) => normalize(label) === text);
    return overrideFound ? overrideFound[0] : text;
  }

  function getStaffDisplayOverride(row) {
    const overrides = readOverrides();
    const key = typeof row === "string" ? normalize(row) : internalName(row);
    const shortKey = typeof row === "string" ? "" : normalize(row?.name);
    const foundKey = staffKeyVariants(key).find(candidate => Object.prototype.hasOwnProperty.call(overrides, candidate));
    if (foundKey) return overrides[foundKey];
    if (shortKey && Object.prototype.hasOwnProperty.call(overrides, shortKey)) return overrides[shortKey];
    return undefined;
  }

  function saveStaffDisplayOverrides(rows, valuesByKey) {
    const overrides = readOverrides();
    (rows || []).forEach(row => {
      const key = internalName(row);
      const shortKey = normalize(row?.name);
      if (!key) return;
      const value = normalize(valuesByKey?.[key]);
      if (value) {
        staffKeyVariants(key).forEach(variant => { overrides[variant] = value; });
        if (shortKey) overrides[shortKey] = value;
      } else {
        staffKeyVariants(key).forEach(variant => { delete overrides[variant]; });
        if (shortKey) delete overrides[shortKey];
      }
    });
    writeOverrides(overrides);
    buildMap(rows || []);
    return overrides;
  }

  function staffOptionValue(row) {
    return internalName(row);
  }

  function staffOptionLabel(row) {
    return getStaffDisplayOverride(row) || displayName(row) || internalName(row);
  }

  function refreshSalesStaffDisplays() {
    [
      "customerStaff",
      "invoiceStaff",
      "paymentStaff",
      "deliveryStaff",
      "shippingStaff",
      "receiptStaff"
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value) el.value = formatStaffName(el.value);
    });
    [
      "renderQuoteList",
      "renderInvoiceList",
      "renderPaymentInvoiceList",
      "renderDeliveryList",
      "renderReceiptLists",
      "renderCustomerList",
      "renderProgressSections"
    ].forEach(name => {
      try {
        if (typeof window[name] === "function") window[name]();
      } catch (_) {}
    });
  }

  window.SalesStaffDisplay = {
    loadStaffDisplays,
    ensureStaffDisplaysLoaded,
    formatStaffName,
    staffOptionValue,
    staffOptionLabel,
    storageStaffName,
    getStaffDisplayOverride,
    saveStaffDisplayOverrides,
    buildMap,
    refreshSalesStaffDisplays
  };

  window.formatSalesStaffName = formatStaffName;
  window.getSalesStaffDisplayName = formatStaffName;
  window.storageSalesStaffName = storageStaffName;

  document.addEventListener("DOMContentLoaded", () => {
    ensureStaffDisplaysLoaded({ force: true }).then(refreshSalesStaffDisplays).catch(() => {});
  });
})();
