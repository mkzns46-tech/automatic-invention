(function () {
  const COMPANY = {
    name: "株式会社ARICO ARCHERY",
    invoiceNo: "T8180001160066",
    postal: "〒454-0014",
    address: "愛知県名古屋市中川区柳川町3-18",
    tel: "052-990-4188",
    representative: "尹恵善"
  };
  const LOGO_FALLBACK_SRC = "assets/arico-logo.png";
  const STAMP_FALLBACK_SRC = "assets/arico-stamp.png";
  const LOGO_STORAGE_KEYS = ["arico_sales_pdf_logo", "aricoSalesPdfLogo", "salesPdfLogo"];
  const STAMP_STORAGE_KEYS = ["arico_sales_pdf_stamp", "aricoSalesPdfStamp", "salesPdfStamp"];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function money(value) {
    const number = Math.round(Number(value || 0));
    const sign = number < 0 ? "-" : "";
    return `${sign}${Math.abs(number).toLocaleString("ja-JP")} 円`;
  }

  function numberOnly(value) {
    const number = Math.round(Number(value || 0));
    const sign = number < 0 ? "-" : "";
    return `${sign}${Math.abs(number).toLocaleString("ja-JP")}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const text = String(value);
    const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) return `${match[1]}/${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")}`;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text.slice(0, 10);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${d}`;
  }

  function readStoredImage(keys, fallback) {
    try {
      for (const key of keys) {
        const value = localStorage.getItem(key);
        if (value) return value;
      }
    } catch (_) {}
    return fallback;
  }

  function isRefund(type) {
    return String(type || "").trim() === "返金";
  }

  function isFree(type) {
    const value = String(type || "").trim();
    return value === "無償提供" || value === "交換";
  }

  function clampNumber(value, min, max) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function documentTitle(type) {
    return {
      quote: "見積書",
      invoice: "請求書",
      delivery: "納品書",
      receipt: "領収書"
    }[type] || "帳票";
  }

  function documentNumber(type, doc) {
    return doc.quoteNo || doc.invoiceNo || doc.deliveryNo || doc.receiptNo || doc.originNumber || "";
  }

  function documentDate(type, doc) {
    if (type === "quote") return formatDate(doc.quoteDate || doc.createdAt || "");
    if (type === "invoice") return formatDate(doc.invoiceDate || "");
    if (type === "delivery") return formatDate(doc.deliveryDate || doc.shipmentDate || doc.issuedAt || "");
    if (type === "receipt") return formatDate(doc.paymentDate || doc.issuedAt || "");
    return formatDate(doc.date || "");
  }

  function issueDate(type, doc) {
    if (type === "invoice") return formatDate(doc.issuedAt || doc.invoiceDate || "");
    if (type === "delivery") return formatDate(doc.issuedAt || doc.deliveryDate || "");
    if (type === "receipt") return formatDate(doc.issuedAt || doc.paymentDate || "");
    return formatDate(doc.quoteDate || doc.createdAt || "");
  }

  function normalizeLines(doc) {
    const transactionType = doc.transactionType || "";
    return (doc.lines || doc.items || doc.products || doc.details || []).map(line => {
      const qty = Number(line.qty ?? line.quantity ?? 0);
      const unitPrice = Number(line.unitPrice ?? line.price ?? line.salesPrice ?? 0);
      const gross = Math.max(0, Math.round(Math.abs(qty) * Math.abs(unitPrice)));
      const discountRate = isFree(transactionType)
        ? 100
        : clampNumber(line.discountValue ?? line.discountRate ?? 0, 0, 100);
      const fixedDiscount = Math.max(0, Number(line.discountAmountInput || line.fixedDiscountAmount || line.manualDiscountAmount || 0));
      const discountAmount = Math.min(gross, fixedDiscount > 0 ? fixedDiscount : Math.round(gross * discountRate / 100));
      const net = Math.max(0, gross - discountAmount);
      const amount = isRefund(transactionType) ? -net : net;
      return {
        name: line.name || line.productName || line.itemName || "",
        qty,
        unit: line.unit || "",
        unitPrice,
        memo: line.memo || line.itemMemo || line.note || "",
        gross,
        discountAmount,
        amount
      };
    });
  }

  function calcTotals(doc, lines) {
    const subtotal = lines.reduce((sum, line) => sum + Number(line.gross || 0), 0);
    const itemDiscount = lines.reduce((sum, line) => sum + Number(line.discountAmount || 0), 0);
    const baseTotal = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const requestedOverall = Math.max(0, Number(doc.overallDiscountAmount || 0));
    const overallDiscount = isRefund(doc.transactionType)
      ? requestedOverall
      : Math.min(Math.max(0, baseTotal), requestedOverall);
    const discount = itemDiscount + overallDiscount;
    const total = isRefund(doc.transactionType)
      ? baseTotal + overallDiscount
      : Math.max(0, baseTotal - overallDiscount);
    const fallbackTotal = Number(doc.total ?? doc.amount ?? 0);
    const finalTotal = lines.length ? total : fallbackTotal;
    return {
      subtotal: lines.length ? subtotal : Math.max(0, Math.abs(fallbackTotal)),
      discount,
      total: finalTotal,
      tax: Math.floor(Math.abs(finalTotal) * 10 / 110)
    };
  }

  function splitLines(lines, type) {
    if (type === "receipt") return [[]];
    const firstLimit = 18;
    const nextLimit = 27;
    if (lines.length <= firstLimit) return [lines];
    const pages = [lines.slice(0, firstLimit)];
    for (let i = firstLimit; i < lines.length; i += nextLimit) {
      pages.push(lines.slice(i, i + nextLimit));
    }
    return pages;
  }

  function infoRows(type, doc) {
    if (type === "quote") {
      return [
        ["件名", doc.subject || ""],
        ["支払条件", doc.paymentTerms || "先払い"],
        ["見積期限", formatDate(doc.validUntil || "")]
      ];
    }
    if (type === "invoice") {
      return [
        ["件名", doc.subject || ""],
        ["支払期限", formatDate(doc.dueDate || "")]
      ];
    }
    if (type === "delivery") {
      return [
        ["件名", doc.subject || ""]
      ];
    }
    return [
      ["但し書き", doc.slipMemo || doc.memo || "アーチェリー用品代として"],
      ["入金日", formatDate(doc.paymentDate || "")],
      ["入金額", money(doc.amount || doc.total || 0)],
      ["発行日", issueDate(type, doc)]
    ];
  }

  function metaRows(type, doc, number) {
    const rows = [["No", number], ["発行日", issueDate(type, doc)]];
    if (type === "quote") rows.push(["見積日", documentDate(type, doc)]);
    if (type === "invoice") rows.push(["請求日", documentDate(type, doc)]);
    if (type === "delivery") rows.push(["納品日", documentDate(type, doc)]);
    if (type === "receipt") rows.push(["入金日", documentDate(type, doc)]);
    return rows;
  }

  function companyBlock(staff) {
    const logoSrc = readStoredImage(LOGO_STORAGE_KEYS, LOGO_FALLBACK_SRC);
