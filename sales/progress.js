const PROGRESS_KEYS = {
  quotes: "arico_sales_quotes_v1",
  invoices: "arico_sales_invoices_v1",
  deliveries: "arico_sales_deliveries_v1",
  receipts: "arico_sales_receipts_v1",
  customers: "arico_sales_customers_v1"
};

const TRANSACTION_OPTIONS = ["", "通常販売", "交換", "返金", "無償提供", "その他"];
const STATUS_OPTIONS = ["", "下書き", "請求書変換済み", "請求書発行済", "未発行", "納品書発行済", "発送済", "手渡し済", "担当者手持ち済", "発行済み", "入金待ち", "一部入金", "入金済み", "入金不要", "支払期限超過", "納品待ち", "発送待ち", "未納品", "納品済み"];

function emptyFilters() {
  return {
    slip: "",
    organization: "",
    customer: "",
    staff: "",
    transaction: "",
    status: "",
    dateFrom: "",
    dateTo: ""
  };
}

const progressFilters = {
  ticket: emptyFilters(),
  sales: emptyFilters(),
  unpaid: emptyFilters(),
  delivery: emptyFilters()
};
const progressCollapsed = { ticket: false, sales: false, unpaid: false, delivery: false };

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (_) {
    return [];
  }
}

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
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/[ \u3000\r\n\t-]/g, "").trim();
}

function textMatches(value, search) {
  const needle = normalizeSearchText(search);
  if (!needle) return true;
  return normalizeSearchText(value).includes(needle);
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) return text.slice(0, 10).replaceAll("/", "-");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ja-JP");
}

function normalizeTransactionType(type) {
  const value = String(type || "").trim();
  if (!value) return "通常販売";
  if (value === "返品") return "返金";
  return value;
}

function statusLabel(status, kind = "") {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (!value) return "未作成";
  if (lower === "draft" || value === "下書き") return kind === "delivery" || kind === "receipt" ? "未発行" : "下書き";
  if (lower === "issued") return kind === "delivery" ? "納品書発行済" : "発行済み";
  if (value === "発行済み") return kind === "delivery" ? "納品書発行済" : "発行済み";
  if (lower === "shipped" || value === "発送済") return "発送済";
  if (lower === "hand_delivered" || lower === "hand_delivery" || value === "手渡し済") return "手渡し済";
  if (lower === "staff_carry" || lower === "staff_carried" || value === "担当者手持ち済") return "担当者手持ち済";
  if (value === "納品書発行済" || value === "発送準備中") return "納品書発行済";
  if (lower === "waiting_payment" || lower === "payment_waiting" || value === "入金待ち") return "入金待ち";
  if (lower === "partial_payment" || lower === "partially_paid" || value === "一部入金") return "一部入金";
  if (lower === "paid" || value === "入金済み") return "入金済み";
  if (lower === "no_payment_required" || lower === "no_payment" || lower === "payment_not_required" || value === "入金不要") return "入金不要";
  if (lower === "cancel" || lower === "cancelled" || lower === "canceled" || value === "キャンセル") return "キャンセル";
  if (lower === "converted" || lower === "invoiced" || value === "請求書変換済み") return "請求書変換済み";
  if (lower === "invoice_issued" || value === "請求書発行済") return "請求書発行済";
  if (value === "未発行" || value === "納品待ち" || value === "発送待ち" || value === "未納品" || value === "納品済み" || value === "支払期限超過") return value;
  return value;
}

function statusBadge(status, kind = "") {
  const label = statusLabel(status, kind);
  let type = "muted";
  if (["発行済み", "請求書発行済", "入金済み", "納品済み", "発送済", "手渡し済", "担当者手持ち済"].includes(label)) type = "ok";
  if (["入金待ち", "一部入金", "支払期限超過", "下書き", "未発行", "納品書発行済", "請求書変換済み", "納品待ち", "発送待ち", "未納品"].includes(label)) type = "warn";
  if (label === "入金不要") type = "info";
  if (label === "キャンセル") type = "danger";
  return `<span class="status-badge ${type}">${escapeHtml(label)}</span>`;
}

function stockStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "success" || status === "在庫減算済") return "在庫減算済";
  if (value === "failed" || status === "在庫減算失敗") return "在庫減算失敗";
  if (status === "在庫同期失敗") return "在庫同期失敗";
  if (value === "skipped" || status === "在庫減算対象外") return "在庫減算対象外";
  if (value === "pending" || status === "在庫減算中") return "在庫減算中";
  return "";
}

function stockStatusBadge(status) {
  const label = stockStatusLabel(status);
  if (!label) return "";
  const type = label === "在庫減算済" ? "ok" : label === "在庫減算失敗" || label === "在庫同期失敗" ? "danger" : label === "在庫減算対象外" ? "muted" : "warn";
  return `<span class="status-badge ${type}">${escapeHtml(label)}</span>`;
}

function sameKey(a, b) {
  return String(a || "").trim() && String(a || "").trim() === String(b || "").trim();
}

function readQuotes() { return readJson(PROGRESS_KEYS.quotes); }
function readInvoices() { return readJson(PROGRESS_KEYS.invoices); }
function readDeliveries() { return readJson(PROGRESS_KEYS.deliveries); }
function readReceipts() { return readJson(PROGRESS_KEYS.receipts); }
function readCustomers() { return readJson(PROGRESS_KEYS.customers); }

function getOriginNumber(row, fallback = "") {
  return row?.originNumber || row?.masterNumber || row?.quoteNumber || row?.quoteNo || row?.sourceQuoteNo || fallback || "";
}

function getInvoiceOrigin(invoice) {
  return getOriginNumber(invoice, invoice?.invoiceNo || invoice?.invoiceNumber || "");
}

function extractNumber(value) {
  const matches = String(value || "").match(/\d+/g);
  return matches ? Number(matches[matches.length - 1]) : 0;
}

function sortNewest(a, b) {
  const aDate = a.sortDate || a.updatedAt || a.createdAt || "";
  const bDate = b.sortDate || b.updatedAt || b.createdAt || "";
  if (aDate || bDate) {
    const diff = String(bDate).localeCompare(String(aDate));
    if (diff) return diff;
  }
  return extractNumber(b.sortNumber || b.origin || b.invoiceNo || b.quoteNo) - extractNumber(a.sortNumber || a.origin || a.invoiceNo || a.quoteNo);
}

function resolveCustomer(row) {
  const customers = readCustomers();
  return customers.find(customer =>
    sameKey(customer.id, row?.customerId) ||
    sameKey(customer.customerId, row?.customerId) ||
    sameKey(customer.customerCode, row?.customerCode) ||
    sameKey(customer.code, row?.customerCode) ||
    sameKey(customer.smaregiCustomerId, row?.smaregiCustomerId) ||
    sameKey(customer.smaregiMemberId, row?.smaregiCustomerId) ||
    sameKey(customer.smaregiCustomerCode, row?.smaregiCustomerCode) ||
    sameKey(customer.smaregiMemberCode, row?.smaregiCustomerCode)
  ) || null;
}

function customerView(...rows) {
  for (const row of rows) {
    if (!row) continue;
    const customer = resolveCustomer(row) || {};
    const info = row.customerInfo || row.customer_info || row.customerDetail || {};
    const view = {
      customerName: customer.customerName || customer.name || row.customerName || row.name || row.customer || row.clientName || info.customerName || info.name || "",
      organizationName: customer.organizationName || customer.organization || customer.companyName || row.organizationName || row.organization || row.companyName || info.organizationName || info.organization || info.companyName || ""
    };
    if (view.customerName || view.organizationName) return view;
  }
  return { customerName: "", organizationName: "" };
}

function getLines(row) {
  return [row?.lines, row?.items, row?.products, row?.details].find(value => Array.isArray(value) && value.length) || [];
}

function lineAmount(line, transactionType) {
  if (Number.isFinite(Number(line?.amount))) return Number(line.amount || 0);
  const qty = Number(line?.qty || line?.quantity || 0);
  const unitPrice = Number(line?.unitPrice || line?.price || 0);
  const gross = Math.round(Math.abs(qty) * Math.abs(unitPrice));
  const rate = Math.min(100, Math.max(0, Number(line?.discountValue ?? line?.discountRate ?? 0)));
  const fixedSource = line?.discountAmount ?? line?.discountAmountInput ?? line?.fixedDiscountAmount ?? line?.manualDiscountAmount ?? 0;
  const fixed = Math.max(0, Number(fixedSource));
  const discount = Math.min(gross, fixed > 0 ? fixed : Math.round(gross * rate / 100));
  const net = Math.max(0, gross - discount);
  return normalizeTransactionType(transactionType || line?.transactionType) === "返金" ? -net : net;
}

function totalAmount(...rows) {
  for (const row of rows) {
    if (!row) continue;
    if (Number.isFinite(Number(row.total))) return Number(row.total || 0);
    if (Number.isFinite(Number(row.amount))) return Number(row.amount || 0);
    const lines = getLines(row);
    if (lines.length) return lines.reduce((total, line) => total + lineAmount(line, row.transactionType), 0);
  }
  return 0;
}

function getActivePayments(invoice) {
  return Array.isArray(invoice?.payments) ? invoice.payments.filter(payment => payment.status !== "canceled") : [];
}

function paidAmount(invoice) {
  return getActivePayments(invoice).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function paymentStatus(invoice) {
  if (!invoice) return "未作成";
  const invoiceStatus = statusLabel(invoice.status, "invoice");
  if (invoiceStatus === "入金不要") return "入金不要";
  if (invoiceStatus === "入金済み") return "入金済み";
  if (invoiceStatus === "キャンセル") return "キャンセル";
  const total = totalAmount(invoice);
  if (total <= 0) return "入金不要";
  const paid = paidAmount(invoice);
  if (paid >= total) return "入金済み";
  if (paid > 0) return "一部入金";
  if (invoiceStatus === "発行済み" || invoiceStatus === "入金待ち") return "入金待ち";
  return "未作成";
}

function unpaidAmount(invoice) {
  return Math.max(0, totalAmount(invoice) - paidAmount(invoice));
}

function isPaymentOverdue(invoice) {
  const dueDate = normalizeDateOnly(invoice?.dueDate);
  return Boolean(dueDate && dueDate < today() && unpaidAmount(invoice) > 0);
}

function ensureGroup(map, origin) {
  const key = origin || "未採番";
  if (!map.has(key)) map.set(key, { origin: key, quotes: [], invoices: [], deliveries: [], receipts: [] });
  return map.get(key);
}

function buildGroups() {
  const groups = new Map();
  readQuotes().filter(row => window.SalesArchive?.shouldShow?.(row) ?? true).forEach(quote => ensureGroup(groups, getOriginNumber(quote, quote.quoteNo)).quotes.push(quote));
  readInvoices().filter(row => window.SalesArchive?.shouldShow?.(row) ?? true).forEach(invoice => ensureGroup(groups, getInvoiceOrigin(invoice)).invoices.push(invoice));
  readDeliveries().filter(row => window.SalesArchive?.shouldShow?.(row) ?? true).forEach(delivery => ensureGroup(groups, getOriginNumber(delivery, delivery.deliveryNo)).deliveries.push(delivery));
  readReceipts().filter(row => window.SalesArchive?.shouldShow?.(row) ?? true).forEach(receipt => ensureGroup(groups, getOriginNumber(receipt, receipt.receiptNo)).receipts.push(receipt));
  return Array.from(groups.values());
}

function latestRow(rows) {
  return rows.slice().sort((a, b) => sortNewest(
    { sortDate: a.updatedAt || a.createdAt, sortNumber: a.quoteNo || a.invoiceNo || a.deliveryNo || a.receiptNo },
    { sortDate: b.updatedAt || b.createdAt, sortNumber: b.quoteNo || b.invoiceNo || b.deliveryNo || b.receiptNo }
  ))[0] || null;
}

function makeProgressRow(group) {
  const quote = latestRow(group.quotes);
  const invoice = latestRow(group.invoices);
  const delivery = latestRow(group.deliveries);
  const receipt = latestRow(group.receipts);
  const customer = customerView(invoice, quote, delivery, receipt);
  const transactionType = normalizeTransactionType(invoice?.transactionType || quote?.transactionType || delivery?.transactionType || receipt?.transactionType);
  const sortDate = [quote, invoice, delivery, receipt]
    .map(row => row?.updatedAt || row?.createdAt || "")
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || "";
  return {
    origin: group.origin,
    quote,
    invoice,
    delivery,
    receipt,
    transactionType,
    organizationName: customer.organizationName,
    customerName: customer.customerName,
    total: totalAmount(invoice, quote, delivery, receipt),
    paid: paidAmount(invoice),
    unpaid: invoice ? unpaidAmount(invoice) : 0,
    quoteStatus: quote ? statusLabel(quote.status, "quote") : "未作成",
    invoiceStatus: invoice ? statusLabel(invoice.status, "invoice") : "未作成",
    stockDeductionStatus: invoice?.stockBaseStockSyncStatus === "failed" ? "在庫同期失敗" : invoice ? stockStatusLabel(invoice.stockDeductionStatus) : "",
    paymentStatus: paymentStatus(invoice),
    deliveryStatus: delivery ? statusLabel(delivery.status, "delivery") : "未発行",
    staff: invoice?.staff || quote?.staff || delivery?.staff || receipt?.staff || "",
    sortDate,
    sortNumber: group.origin,
    updatedAt: sortDate
  };
}

function buildProgressRows() {
  return buildGroups().map(makeProgressRow);
}

function isCancelStatus(status) {
  return statusLabel(status) === "キャンセル";
}

function isCancelledRow(row) {
  return [row.quoteStatus, row.invoiceStatus, row.paymentStatus, row.deliveryStatus].some(isCancelStatus);
}

function rowStatusValues(row, section) {
  if (section === "sales") return [row.invoiceStatus];
  if (section === "unpaid") return [isPaymentOverdue(row.invoice) ? "支払期限超過" : row.paymentStatus];
  if (section === "delivery") return [row.deliveryStatus];
  return [row.quoteStatus, row.invoiceStatus, row.paymentStatus, row.deliveryStatus];
}

function rowDateValues(row, section) {
  if (section === "sales") {
    return [row.invoice?.invoiceDate, row.invoice?.issuedAt, row.invoice?.updatedAt, row.invoice?.createdAt];
  }
  if (section === "unpaid") {
    return [row.invoice?.invoiceDate, row.invoice?.dueDate, row.invoice?.issuedAt, row.invoice?.updatedAt, row.invoice?.createdAt];
  }
  if (section === "delivery") {
    return [row.delivery?.deliveryDate, row.delivery?.issuedAt, row.delivery?.shipmentDate, row.delivery?.handoverDate, row.delivery?.carryOutDate, row.delivery?.updatedAt, row.delivery?.createdAt, row.invoice?.invoiceDate];
  }
  return [
    row.quote?.quoteDate,
    row.quote?.validUntil,
    row.quote?.updatedAt,
    row.quote?.createdAt,
    row.invoice?.invoiceDate,
    row.invoice?.dueDate,
    row.invoice?.issuedAt,
    row.delivery?.deliveryDate,
    row.delivery?.issuedAt,
    row.updatedAt
  ];
}

function matchesDateRange(row, section) {
  const filters = progressFilters[section];
  const from = normalizeDateOnly(filters.dateFrom);
  const to = normalizeDateOnly(filters.dateTo);
  if (!from && !to) return true;
  const dates = rowDateValues(row, section).map(normalizeDateOnly).filter(Boolean);
  if (!dates.length) return false;
  return dates.some(date => (!from || date >= from) && (!to || date <= to));
}

function matchesFilters(row, section) {
  const filters = progressFilters[section];
  if (!textMatches(row.origin, filters.slip)) return false;
  if (!textMatches(row.organizationName, filters.organization)) return false;
  if (!textMatches(row.customerName, filters.customer)) return false;
  if (!textMatches([row.staff, getSalesStaffDisplayName(row.staff)].join(" "), filters.staff)) return false;
  if (filters.transaction && normalizeTransactionType(row.transactionType) !== filters.transaction) return false;
  if (filters.status && !rowStatusValues(row, section).some(status => statusLabel(status) === filters.status)) return false;
  if (!matchesDateRange(row, section)) return false;
  return true;
}

function isRefund(row) {
  return normalizeTransactionType(row?.transactionType) === "返金" || Number(row?.total || row?.amount || 0) < 0;
}

function amountClass(value, row = {}) {
  return Number(value || 0) < 0 || isRefund(row) ? "amount-negative refund-amount" : "";
}

function pageLink(page, id, label) {
  const href = id ? `${page}?id=${encodeURIComponent(id)}` : page;
  return `<a class="secondary progress-action-link" href="${href}">${escapeHtml(label)}</a>`;
}

function pdfButton(type, id) {
  if (!id) return "";
  const label = { quote: "見積PDF", invoice: "請求PDF", delivery: "納品PDF", receipt: "領収PDF" }[type] || "PDF";
  return `<button type="button" class="secondary progress-action-link" onclick="printProgressPdf('${type}', '${escapeHtml(id)}')">${label}</button>`;
}

function printProgressPdf(type, id) {
  const sources = {
    quote: readQuotes(),
    invoice: readInvoices(),
    delivery: readDeliveries(),
    receipt: readReceipts()
  };
  const doc = (sources[type] || []).find(row => row.id === id);
  if (!doc) {
    alert("PDF出力対象の伝票が見つかりません。");
    return;
  }
  if (!window.SalesPdfFormat?.printSalesDocument) {
    alert("PDF出力機能を読み込めませんでした。");
    return;
  }
  window.SalesPdfFormat.printSalesDocument(type, doc);
}

function progressRowDocuments(row) {
  const documents = [];
  if (row?.quote) documents.push({ type: "quote", data: row.quote });
  if (row?.invoice) documents.push({ type: "invoice", data: row.invoice });
  if (row?.delivery) documents.push({ type: "delivery", data: row.delivery });
  if (row?.receipt) documents.push({ type: "receipt", data: row.receipt });
  return documents;
}

function printProgressRowPdfs(origin) {
  const row = buildProgressRows().find(item => String(item.origin) === String(origin));
  const documents = progressRowDocuments(row);
  if (!documents.length) {
    alert("PDF出力対象の伝票が見つかりません。");
    return;
  }
  if (!window.SalesPdfFormat?.printSalesDocuments) {
    alert("PDF出力機能を読み込めませんでした。");
    return;
  }
  window.SalesPdfFormat.printSalesDocuments(documents);
}

function actionLinks(row, kinds) {
  const links = [];
  if (kinds.includes("quote")) links.push(pageLink("quotes.html", row.quote?.id, "見積"));
  if (kinds.includes("invoice")) links.push(pageLink("invoices.html", row.invoice?.id, "請求"));
  if (kinds.includes("payment")) links.push(pageLink("payments.html", row.invoice?.id, "入金"));
  if (kinds.includes("delivery")) links.push(pageLink("delivery.html", row.delivery?.id, "納品"));
  const pdf = progressRowDocuments(row).length
    ? `<button type="button" class="secondary progress-action-link progress-pdf-button" onclick="printProgressRowPdfs('${escapeHtml(row.origin)}')">PDF出力</button>`
    : "";
  return `<div class="progress-actions"><div class="progress-detail-actions">${links.join("")}</div>${pdf}</div>`;
}

function printSelectedProgressTickets() {
  const origins = Array.from(document.querySelectorAll(".progress-ticket-pdf-check:checked")).map(input => input.value);
  if (!origins.length) {
    alert("印刷する伝票を選択してください。");
    return;
  }
  const rows = buildProgressRows().filter(row => origins.includes(String(row.origin)));
  const documents = [];
  rows.forEach(row => {
    documents.push(...progressRowDocuments(row));
  });
  if (!documents.length) {
    alert("PDF出力対象の伝票が見つかりません。");
    return;
  }
  if (!window.SalesPdfFormat?.printSalesDocuments) {
    alert("PDF出力機能を読み込めませんでした。");
    return;
  }
  window.SalesPdfFormat.printSalesDocuments(documents);
}

function renderRows(bodyId, countId, rows, renderer, emptyMessage, colspan) {
  const body = document.getElementById(bodyId);
  const count = document.getElementById(countId);
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  if (count) count.textContent = `${rows.length}件 / 合計 ${money(total)}`;
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(renderer).join("") : `<tr><td colspan="${colspan}">${escapeHtml(emptyMessage)}</td></tr>`;
}

function renderTicketRows(allRows) {
  const rows = allRows.filter(row => !isCancelledRow(row)).filter(row => matchesFilters(row, "ticket")).sort(sortNewest);
  renderRows("ticketProgressBody", "ticketProgressCount", rows, row => `
    <tr>
      <td><input type="checkbox" class="progress-ticket-pdf-check pdf-select-checkbox" value="${escapeHtml(row.origin)}"></td>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(row.transactionType)}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td>${statusBadge(row.quoteStatus, "quote")}</td>
      <td>${statusBadge(row.invoiceStatus, "invoice")}</td>
      <td>${statusBadge(row.paymentStatus, "payment")}</td>
      <td>${statusBadge(row.deliveryStatus, "delivery")}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${escapeHtml(getSalesStaffDisplayName(row.staff))}</td>
      <td>${escapeHtml(normalizeDateTime(row.updatedAt))}</td>
      <td>${actionLinks(row, ["quote", "invoice", "payment", "delivery"])}</td>
    </tr>`, "伝票ごとの進捗はありません。", 13);
}

function renderSalesRows(allRows) {
  const rows = allRows.filter(row => row.invoice).filter(row => !isCancelledRow(row)).filter(row => matchesFilters(row, "sales")).sort(sortNewest);
  renderRows("salesProgressBody", "salesProgressCount", rows, row => `
    <tr>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(row.invoice.invoiceDate || "")}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${statusBadge(row.invoiceStatus, "invoice")}</td>
      <td>${escapeHtml(getSalesStaffDisplayName(row.staff))}</td>
      <td>${actionLinks(row, ["invoice"])}</td>
    </tr>`, "請求書はありません。", 8);
}

function renderUnpaidRows(allRows) {
  const rows = allRows
    .filter(row => !["入金済み", "入金不要", "キャンセル"].includes(row.paymentStatus))
    .filter(row => row.unpaid > 0 || row.paymentStatus === "入金待ち" || row.paymentStatus === "一部入金" || isPaymentOverdue(row.invoice))
    .filter(row => !isCancelledRow(row))
    .filter(row => matchesFilters(row, "unpaid"))
    .sort(sortNewest);
  renderRows("unpaidProgressBody", "unpaidProgressCount", rows, row => {
    const overdue = isPaymentOverdue(row.invoice) ? " overdue-text" : "";
    return `<tr>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(row.invoice?.invoiceDate || "")}</td>
      <td class="${overdue}">${escapeHtml(row.invoice?.dueDate || "")}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${money(row.paid)}</td>
      <td class="${overdue}">${money(row.unpaid)}</td>
      <td>${statusBadge(isPaymentOverdue(row.invoice) ? "支払期限超過" : row.paymentStatus, "payment")}</td>
      <td>${escapeHtml(getSalesStaffDisplayName(row.staff))}</td>
      <td>${actionLinks(row, ["payment"])}</td>
    </tr>`;
  }, "未入金の請求書はありません。", 11);
}

function renderUndeliveredRows(allRows) {
  const rows = allRows
    .filter(row => !["発送済", "手渡し済", "担当者手持ち済", "納品済み", "キャンセル"].includes(row.deliveryStatus))
    .filter(row => !isCancelledRow(row))
    .filter(row => matchesFilters(row, "delivery"))
    .sort(sortNewest);
  renderRows("undeliveredProgressBody", "undeliveredProgressCount", rows, row => `
    <tr>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(normalizeDateOnly(row.delivery?.issuedAt) || row.delivery?.deliveryDate || "")}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${statusBadge(row.deliveryStatus, "delivery")}</td>
      <td>${escapeHtml(getSalesStaffDisplayName(row.staff))}</td>
      <td>${actionLinks(row, ["delivery"])}</td>
    </tr>`, "未納品の伝票はありません。", 8);
}

function renderProgressSections() {
  const rows = buildProgressRows();
  renderTicketRows(rows);
  renderSalesRows(rows);
  renderUnpaidRows(rows);
  renderUndeliveredRows(rows);
}

function fillSelect(id, options, allLabel = "全て") {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = options.map(option => {
    const label = option || allLabel;
    return `<option value="${escapeHtml(option)}">${escapeHtml(label)}</option>`;
  }).join("");
}

function bindProgressControls() {
  ["ticket", "sales", "unpaid", "delivery"].forEach(section => {
    fillSelect(`${section}TransactionFilter`, TRANSACTION_OPTIONS);
    fillSelect(`${section}StatusFilter`, STATUS_OPTIONS);
  });

  [
    ["ticketSlipFilter", "ticket", "slip"],
    ["ticketOrganizationFilter", "ticket", "organization"],
    ["ticketCustomerFilter", "ticket", "customer"],
    ["ticketStaffFilter", "ticket", "staff"],
    ["ticketTransactionFilter", "ticket", "transaction"],
    ["ticketStatusFilter", "ticket", "status"],
    ["ticketDateFromFilter", "ticket", "dateFrom"],
    ["ticketDateToFilter", "ticket", "dateTo"],
    ["salesSlipFilter", "sales", "slip"],
    ["salesOrganizationFilter", "sales", "organization"],
    ["salesCustomerFilter", "sales", "customer"],
    ["salesStaffFilter", "sales", "staff"],
    ["salesTransactionFilter", "sales", "transaction"],
    ["salesStatusFilter", "sales", "status"],
    ["salesDateFromFilter", "sales", "dateFrom"],
    ["salesDateToFilter", "sales", "dateTo"],
    ["unpaidSlipFilter", "unpaid", "slip"],
    ["unpaidOrganizationFilter", "unpaid", "organization"],
    ["unpaidCustomerFilter", "unpaid", "customer"],
    ["unpaidStaffFilter", "unpaid", "staff"],
    ["unpaidTransactionFilter", "unpaid", "transaction"],
    ["unpaidStatusFilter", "unpaid", "status"],
    ["unpaidDateFromFilter", "unpaid", "dateFrom"],
    ["unpaidDateToFilter", "unpaid", "dateTo"],
    ["deliverySlipFilter", "delivery", "slip"],
    ["deliveryOrganizationFilter", "delivery", "organization"],
    ["deliveryCustomerFilter", "delivery", "customer"],
    ["deliveryStaffFilter", "delivery", "staff"],
    ["deliveryTransactionFilter", "delivery", "transaction"],
    ["deliveryStatusFilter", "delivery", "status"],
    ["deliveryDateFromFilter", "delivery", "dateFrom"],
    ["deliveryDateToFilter", "delivery", "dateTo"]
  ].forEach(([id, section, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const update = event => {
      progressFilters[section][key] = event.target.value.trim();
      renderProgressSections();
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
}

function toggleProgressSection(name) {
  progressCollapsed[name] = !progressCollapsed[name];
  const panel = document.getElementById(`${name}ProgressPanel`);
  const button = document.getElementById(`${name}ProgressToggle`);
  if (panel) panel.hidden = progressCollapsed[name];
  if (button) button.textContent = progressCollapsed[name] ? "一覧を開く" : "一覧を閉じる";
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  bindProgressControls();
  window.SalesArchive?.bindToggle?.(renderProgressSections);
  renderProgressSections();
});
