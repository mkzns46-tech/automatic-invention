(function () {
  const PREFIX_BY_TYPE = {
    quote: "Q",
    invoice: "I",
    delivery: "D",
    receipt: "R"
  };

  const FIELD_BY_TYPE = {
    quote: ["quoteNo", "quoteNumber", "documentNo", "document_no"],
    invoice: ["invoiceNo", "invoiceNumber", "documentNo", "document_no"],
    delivery: ["deliveryNo", "deliveryNumber", "documentNo", "document_no"],
    receipt: ["receiptNo", "receiptNumber", "documentNo", "document_no"]
  };

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDateKey(value) {
    const raw = value || new Date();
    if (raw instanceof Date) {
      return `${raw.getFullYear()}${pad2(raw.getMonth() + 1)}${pad2(raw.getDate())}`;
    }
    const text = String(raw || "").trim();
    const match = text.match(/^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
    if (match) return `${match[1]}${pad2(match[2])}${pad2(match[3])}`;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}${pad2(parsed.getMonth() + 1)}${pad2(parsed.getDate())}`;
    }
    const today = new Date();
    return `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`;
  }

  function getRecordNo(type, record) {
    const fields = FIELD_BY_TYPE[type] || [];
    for (const field of fields) {
      const value = record?.[field];
      if (value) return String(value).trim();
    }
    return "";
  }

  function buildDocumentNo(type, dateValue, serial) {
    const prefix = PREFIX_BY_TYPE[type] || "X";
    return `${prefix}-${formatDateKey(dateValue)}-${pad2(serial)}`;
  }

  function parseSerial(type, documentNo, dateValue) {
    const prefix = PREFIX_BY_TYPE[type] || "X";
    const dateKey = formatDateKey(dateValue);
    const match = String(documentNo || "").trim().match(new RegExp(`^${prefix}-${dateKey}-(\\d+)$`));
    return match ? Number(match[1]) : 0;
  }

  function nextDocumentNo(type, records, dateValue) {
    const list = Array.isArray(records) ? records : [];
    const max = list.reduce((currentMax, record) => {
      return Math.max(currentMax, parseSerial(type, getRecordNo(type, record), dateValue));
    }, 0);
    return buildDocumentNo(type, dateValue, max + 1);
  }

  function ensureUniqueDocumentNo(type, records, candidate, dateValue) {
    const list = Array.isArray(records) ? records : [];
    const used = new Set(list.map(record => getRecordNo(type, record)).filter(Boolean));
    let serial = parseSerial(type, candidate, dateValue) || 1;
    let next = candidate || buildDocumentNo(type, dateValue, serial);
    while (used.has(next)) {
      serial += 1;
      next = buildDocumentNo(type, dateValue, serial);
    }
    return next;
  }

  window.SalesNumbering = {
    formatDateKey,
    buildDocumentNo,
    nextDocumentNo,
    ensureUniqueDocumentNo
  };
})();
