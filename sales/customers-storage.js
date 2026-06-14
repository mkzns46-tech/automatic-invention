var ARICO_CUSTOMER_TYPES = ["個人", "学校", "協会", "企業", "ショップ", "卸", "その他"];

(function () {
  const CUSTOMERS_KEY = "arico_sales_customers_v1";

  function nowIso() {
    return new Date().toISOString();
  }

  function makeCustomerId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `customer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function readCustomers() {
    try {
      const rows = JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function writeCustomers(customers) {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
  }

  function normalizeCustomerType(value) {
    return ARICO_CUSTOMER_TYPES.includes(value) ? value : "個人";
  }

  function normalizeKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function searchCustomers(query, limit = 20) {
    const text = normalizeKey(query);
    if (!text) return [];
    return readCustomers().filter(customer => {
      const haystack = [
        customer.customerName,
        customer.kana,
        customer.phone,
        customer.email,
        customer.customerType,
        customer.staff,
        customer.smaregiMemberCode,
        customer.smaregiMemberId,
        customer.customerCode
      ].map(value => normalizeKey(value)).join(" ");
      return haystack.includes(text);
    }).slice(0, limit);
  }

  function nextCustomerCode(customers) {
    const max = customers.reduce((number, customer) => {
      const match = String(customer.customerCode || "").match(/^C-(\d+)$/);
      return match ? Math.max(number, Number(match[1])) : number;
    }, 0);
    return `C-${String(max + 1).padStart(6, "0")}`;
  }

  function findExistingIndex(customers, incoming) {
    const memberId = normalizeKey(incoming.smaregiMemberId);
    const memberCode = normalizeKey(incoming.smaregiMemberCode);
    return customers.findIndex(customer => {
      if (memberId && normalizeKey(customer.smaregiMemberId) === memberId) return true;
      if (memberCode && normalizeKey(customer.smaregiMemberCode) === memberCode) return true;
      return false;
    });
  }

  function createCustomerFromSmaregi(incoming, customerCode, timestamp) {
    return {
      id: makeCustomerId(),
      customerCode,
      customerName: String(incoming.customerName || "").trim(),
      kana: String(incoming.kana || "").trim(),
      customerType: "個人",
      staff: "",
      postalCode: String(incoming.postalCode || "").trim(),
      address: String(incoming.address || "").trim(),
      phone: String(incoming.phone || "").trim(),
      email: String(incoming.email || "").trim(),
      memo: String(incoming.memo || "").trim(),
      smaregiMemberId: String(incoming.smaregiMemberId || "").trim(),
      smaregiMemberCode: String(incoming.smaregiMemberCode || "").trim(),
      gender: String(incoming.gender || "").trim(),
      birthDate: String(incoming.birthDate || "").trim(),
      smaregiRegisteredAt: String(incoming.registeredAt || "").trim(),
      smaregiUpdatedAt: String(incoming.updatedAt || "").trim(),
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function mergeSmaregiCustomer(existing, incoming, timestamp) {
    return {
      ...existing,
      customerName: String(incoming.customerName || existing.customerName || "").trim(),
      kana: String(incoming.kana || existing.kana || "").trim(),
      customerType: normalizeCustomerType(existing.customerType),
      postalCode: String(incoming.postalCode || existing.postalCode || "").trim(),
      address: String(incoming.address || existing.address || "").trim(),
      phone: String(incoming.phone || existing.phone || "").trim(),
      email: String(incoming.email || existing.email || "").trim(),
      smaregiMemberId: String(incoming.smaregiMemberId || existing.smaregiMemberId || "").trim(),
      smaregiMemberCode: String(incoming.smaregiMemberCode || existing.smaregiMemberCode || "").trim(),
      gender: String(incoming.gender || existing.gender || "").trim(),
      birthDate: String(incoming.birthDate || existing.birthDate || "").trim(),
      smaregiRegisteredAt: String(incoming.registeredAt || existing.smaregiRegisteredAt || "").trim(),
      smaregiUpdatedAt: String(incoming.updatedAt || existing.smaregiUpdatedAt || "").trim(),
      updatedAt: timestamp
    };
  }

  function upsertSmaregiCustomers(incomingRows) {
    const timestamp = nowIso();
    const customers = readCustomers();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const incoming of incomingRows || []) {
      if (!String(incoming?.customerName || "").trim()) {
        skipped += 1;
        continue;
      }
      const index = findExistingIndex(customers, incoming);
      if (index >= 0) {
        customers[index] = mergeSmaregiCustomer(customers[index], incoming, timestamp);
        updated += 1;
      } else {
        customers.push(createCustomerFromSmaregi(incoming, nextCustomerCode(customers), timestamp));
        created += 1;
      }
    }

    writeCustomers(customers);
    return {
      imported: created + updated,
      created,
      updated,
      skipped,
      total: customers.length
    };
  }

  window.ARICO_CUSTOMER_TYPES = ARICO_CUSTOMER_TYPES;
  window.SalesCustomerStorage = {
    readCustomers,
    writeCustomers,
    normalizeCustomerType,
    nextCustomerCode,
    searchCustomers,
    upsertSmaregiCustomers
  };
})();
