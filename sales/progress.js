const PROGRESS_KEYS = {
  quotes: "arico_sales_quotes_v1",
  invoices: "arico_sales_invoices_v1",
  deliveries: "arico_sales_deliveries_v1",
  receipts: "arico_sales_receipts_v1",
  customers: "arico_sales_customers_v1"
};

const progressSearch = { ticket: "", sales: "", unpaid: "", delivery: "" };
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
  return Number(value || 0).toLocaleString("ja-JP") + "円";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
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

function isRefund(row) {
  return normalizeTransactionType(row?.transactionType) === "返金" || Number(row?.total || row?.amount || 0) < 0;
}

function amountClass(value, row = {}) {
  return Number(value || 0) < 0 || isRefund(row) ? "amount-negative refund-amount" : "";
}

function statusLabel(status, kind = "") {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (!value) return "未作成";
  if (lower === "draft" || value === "下書き") return kind === "delivery" || kind === "receipt" ? "未発行" : "下書き";
  if (lower === "issued" || value === "発行済み") return "発行済み";
  if (lower === "waiting_payment" || lower === "payment_waiting" || value === "入金待ち") return "入金待ち";
  if (lower === "paid" || value === "入金済み") return "入金済み";
  if (lower === "no_payment_required" || lower === "no_payment" || lower === "payment_not_required" || value === "入金不要") return "入金不要";
  if (lower === "cancel" || lower === "cancelled" || lower === "canceled" || value === "キャンセル") return "キャンセル";
  if (lower === "converted" || lower === "invoiced" || value === "請求書変換済み") return "請求書変換済み";
  if (value === "請求書発行済") return "請求書発行済";
  if (value === "未発行" || value === "納品待ち" || value === "発送待ち" || value === "未納品" || value === "納品済み") return value;
  return value;
}

function statusBadge(status, kind = "") {
  const label = statusLabel(status, kind);
  let type = "muted";
  if (["発行済み", "請求書発行済", "入金済み", "納品済み"].includes(label)) type = "ok";
  if (["入金待ち", "一部入金", "支払期限超過", "下書き", "未発行", "請求書変換済み", "納品待ち", "発送待ち", "未納品"].includes(label)) type = "warn";
  if (label === "入金不要") type = "info";
  if (label === "キャンセル") type = "danger";
  return `<span class="status-badge ${type}">${escapeHtml(label)}</span>`;
}

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

function sameKey(a, b) {
  return String(a || "").trim() && String(a || "").trim() === String(b || "").trim();
}

function readCustomers() {
  if (window.SalesCustomerStorage?.readCustomers) return window.SalesCustomerStorage.readCustomers();
  return readJson(PROGRESS_KEYS.customers);
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
  const qty = Number(line?.qty || 0);
  const unitPrice = Number(line?.unitPrice || 0);
  const gross = Math.round(Math.abs(qty) * Math.abs(unitPrice));
  const rate = Math.min(100, Math.max(0, Number(line?.discountValue ?? line?.discountRate ?? 0)));
  const fixed = Math.max(0, Number(line?.discountAmountInput || line?.fixedDiscountAmount || line?.manualDiscountAmount || 0));
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

function latestPaymentDate(invoice) {
  return getActivePayments(invoice)
    .slice()
    .sort((a, b) => String(b.paymentDate || b.createdAt || "").localeCompare(String(a.paymentDate || a.createdAt || "")))[0]?.paymentDate || "";
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

function readQuotes() { return readJson(PROGRESS_KEYS.quotes); }
function readInvoices() { return readJson(PROGRESS_KEYS.invoices); }
function readDeliveries() { return readJson(PROGRESS_KEYS.deliveries); }
function readReceipts() { return readJson(PROGRESS_KEYS.receipts); }

function findByOrigin(rows, origin) {
  return rows.find(row => getOriginNumber(row, row.deliveryNo || row.receiptNo || row.quoteNo || row.invoiceNo) === origin) || null;
}

function ensureGroup(map, origin) {
  const key = origin || "未採番";
  if (!map.has(key)) map.set(key, { origin: key, quotes: [], invoices: [], deliveries: [], receipts: [] });
  return map.get(key);
}

function buildGroups() {
  const groups = new Map();
  readQuotes().forEach(quote => ensureGroup(groups, getOriginNumber(quote, quote.quoteNo)).quotes.push(quote));
  readInvoices().forEach(invoice => ensureGroup(groups, getInvoiceOrigin(invoice)).invoices.push(invoice));
  readDeliveries().forEach(delivery => ensureGroup(groups, getOriginNumber(delivery, delivery.deliveryNo)).deliveries.push(delivery));
  readReceipts().forEach(receipt => ensureGroup(groups, getOriginNumber(receipt, receipt.receiptNo)).receipts.push(receipt));
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
  const sortDate = [quote, invoice, delivery, receipt].map(row => row?.updatedAt || row?.createdAt || "").sort((a, b) => String(b).localeCompare(String(a)))[0] || "";
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

function isCancelledRow(row) {
  return [row.quoteStatus, row.invoiceStatus, row.paymentStatus, row.deliveryStatus].includes("キャンセル");
}

function matchesSearch(row, section, extra = []) {
  const searchText = progressSearch[section] || "";
  if (!searchText) return true;
  const text = [
    row.origin,
    row.transactionType,
    row.organizationName,
    row.customerName,
    row.staff,
    row.quoteStatus,
    row.invoiceStatus,
    row.paymentStatus,
    row.deliveryStatus,
    row.invoice?.invoiceDate,
    row.invoice?.dueDate,
    row.delivery?.deliveryDate,
    row.delivery?.issuedAt,
    row.updatedAt,
    ...extra
  ].join(" ").toLowerCase();
  return text.includes(searchText);
}

function pageLink(page, id, label) {
  const href = id ? `${page}?id=${encodeURIComponent(id)}` : page;
  return `<a class="secondary progress-action-link" href="${href}">${escapeHtml(label)}</a>`;
}

function actionLinks(row, kinds) {
  const links = [];
  if (kinds.includes("quote")) links.push(pageLink("quotes.html", row.quote?.id, "見積"));
  if (kinds.includes("invoice")) links.push(pageLink("invoices.html", row.invoice?.id, "請求"));
  if (kinds.includes("payment")) links.push(pageLink("payments.html", row.invoice?.id, "入金"));
  if (kinds.includes("delivery")) links.push(pageLink("delivery.html", row.delivery?.id, "納品"));
  return `<div class="progress-actions">${links.join("")}</div>`;
}

function renderRows(bodyId, countId, rows, renderer, emptyMessage, colspan) {
  const body = document.getElementById(bodyId);
  const count = document.getElementById(countId);
  if (count) count.textContent = `${rows.length}件 / 合計 ${money(rows.reduce((sum, row) => sum + Number(row.total || 0), 0))}`;
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(renderer).join("") : `<tr><td colspan="${colspan}">${escapeHtml(emptyMessage)}</td></tr>`;
}

function renderTicketRows(allRows) {
  const rows = allRows.filter(row => !isCancelledRow(row)).filter(row => matchesSearch(row, "ticket")).sort(sortNewest);
  renderRows("ticketProgressBody", "ticketProgressCount", rows, row => `
    <tr>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(row.transactionType)}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td>${statusBadge(row.quoteStatus, "quote")}</td>
      <td>${statusBadge(row.invoiceStatus, "invoice")}</td>
      <td>${statusBadge(row.paymentStatus, "payment")}</td>
      <td>${statusBadge(row.deliveryStatus, "delivery")}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${escapeHtml(row.staff)}</td>
      <td>${escapeHtml(normalizeDateTime(row.updatedAt))}</td>
      <td>${actionLinks(row, ["quote", "invoice", "payment", "delivery"])}</td>
    </tr>`, "伝票ごとの進捗はありません。", 12);
}

function renderSalesRows(allRows) {
  const rows = allRows.filter(row => row.invoice).filter(row => !isCancelledRow(row)).filter(row => matchesSearch(row, "sales")).sort(sortNewest);
  renderRows("salesProgressBody", "salesProgressCount", rows, row => `
    <tr>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(row.invoice.invoiceDate || "")}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${statusBadge(row.invoiceStatus, "invoice")}</td>
      <td>${escapeHtml(row.staff)}</td>
      <td>${actionLinks(row, ["invoice"])}</td>
    </tr>`, "売上確認対象はありません。", 8);
}

function renderUnpaidRows(allRows) {
  const rows = allRows
    .filter(row => !["入金済み", "入金不要", "キャンセル"].includes(row.paymentStatus))
    .filter(row => row.unpaid > 0 || row.paymentStatus === "入金待ち" || row.paymentStatus === "一部入金" || isPaymentOverdue(row.invoice))
    .filter(row => !isCancelledRow(row))
    .filter(row => matchesSearch(row, "unpaid"))
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
      <td>${escapeHtml(row.staff)}</td>
      <td>${actionLinks(row, ["payment"])}</td>
    </tr>`;
  }, "未入金の請求書はありません。", 11);
}

function renderUndeliveredRows(allRows) {
  const rows = allRows
    .filter(row => !["発行済み", "納品済み", "キャンセル"].includes(row.deliveryStatus))
    .filter(row => !isCancelledRow(row))
    .filter(row => matchesSearch(row, "delivery"))
    .sort(sortNewest);
  renderRows("undeliveredProgressBody", "undeliveredProgressCount", rows, row => `
    <tr>
      <td>${escapeHtml(row.origin)}</td>
      <td>${escapeHtml(normalizeDateOnly(row.delivery?.issuedAt) || row.delivery?.deliveryDate || "")}</td>
      <td>${escapeHtml(row.organizationName)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
      <td>${statusBadge(row.deliveryStatus, "delivery")}</td>
      <td>${escapeHtml(row.staff)}</td>
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

function bindProgressControls() {
  [
    ["ticketProgressSearch", "ticket"],
    ["salesProgressSearch", "sales"],
    ["unpaidProgressSearch", "unpaid"],
    ["deliveryProgressSearch", "delivery"]
  ].forEach(([id, section]) => {
    document.getElementById(id)?.addEventListener("input", event => {
      progressSearch[section] = event.target.value.trim().toLowerCase();
      renderProgressSections();
    });
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
  renderProgressSections();
});
