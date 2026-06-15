(function () {
  const STAFF_MAP_KEY = "arico_sales_staff_display_map_v1";
  const STAFF_OVERRIDE_KEY = "arico_sales_staff_display_overrides_v1";
  const SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
  const SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

  function normalize(value) {
    return String(value || "").trim();
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
      const label = overrides[key] || overrides[shortKey] || displayName(row);
      if (key && label) map[key] = label;
      if (shortKey && label) map[shortKey] = label;
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

  function formatStaffName(value) {
    const text = normalize(value);
    if (!text) return "";
    const map = readMap();
    return map[text] || text;
  }

  function storageStaffName(value) {
    const text = normalize(value);
    if (!text) return "";
    const map = readMap();
    const found = Object.entries(map).find(([, label]) => normalize(label) === text);
    return found ? found[0] : text;
  }

  function getStaffDisplayOverride(row) {
    const overrides = readOverrides();
    const key = typeof row === "string" ? normalize(row) : internalName(row);
    const shortKey = typeof row === "string" ? "" : normalize(row?.name);
    if (key && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
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
        overrides[key] = value;
        if (shortKey) overrides[shortKey] = value;
      } else {
        delete overrides[key];
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
    return displayName(row) || internalName(row);
  }

  function refreshSalesStaffDisplays() {
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
  window.storageSalesStaffName = storageStaffName;

  document.addEventListener("DOMContentLoaded", () => {
    loadStaffDisplays().then(refreshSalesStaffDisplays).catch(() => {});
  });
})();
