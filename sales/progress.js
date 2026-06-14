const PROGRESS_KEYS = {
  quotes: "arico_sales_quotes_v1",
  invoices: "arico_sales_invoices_v1",
  deliveries: "arico_sales_deliveries_v1",
  receipts: "arico_sales_receipts_v1",
  customers: "arico_sales_customers_v1"
};

let progressSearchText = "";
let progressCompletionFilter = "incomplete";
let progressTransactionFilter = "";

function readJson(key, fallback = []) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
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
  return normalizeTransactionType(row?.transactionType) === "返金";
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
  if (value === "未発行") return "未発行";
  return value;
}

function statusBadge(status, kind = "") {
  const label = statusLabel(status, kind);
  let type = "muted";
  if (["発行済み", "請求書発行済", "入金済み"].includes(label)) type = "ok";
  if (["入金待ち", "下書き", "未発行", "請求書変換済み"].includes(label)) type = "warn";
  if (label === "入金不要") type = "info";
  if (label === "キャンセル") type = "danger";
  return `<span class="status-badge ${type}">${escapeHtml(label)}</span>`;
}

function getOriginNumber(row, fallback = "") {
  return row?.originNumber || row?.masterNumber || row?.quoteNumber || row?.quoteNo || row?.sourceQuoteNo || fallback || "";
}

function getInvoiceKey(row) {
  return getOriginNumber(row, row?.invoiceNo || row?.invoiceNumber || "");
}

function getCustomerMaster() {
  return readJson(PROGRESS_KEYS.customers);
}

function sameKey(a, b) {
  return String(a || "").trim() && String(a || "").trim() === String(b || "").trim();
}

function resolveCustomer(row) {
  const customers = getCustomerMaster();
  return customers.find(customer =>
    sameKey(customer.id, row.customerId) ||
    sameKey(customer.customerId, row.customerId) ||
    sameKey(customer.customerCode, row.customerCode) ||
    sameKey(customer.code, row.customerCode) ||
    sameKey(customer.smaregiMemberId, row.smaregiCustomerId) ||
    sameKey(customer.smaregiCustomerId, row.smaregiCustomerId) ||
    sameKey(customer.smaregiMemberCode, row.smaregiCustomerCode) ||
    sameKey(customer.smaregiCustomerCode, row.smaregiCustomerCode)
  ) || null;
}

function customerView(...rows) {
  for (const row of rows) {
    if (!row) continue;
    const customer = resolveCustomer(row) || {};
    const info = row.customerInfo || row.customer_info || row.customerDetail || {};
    const view = {
      customerName: customer.customerName || customer.name || row.customerName || row.name || row.customer || row.clientName || info.customerName || info.name || "",
      organizationName: customer.organizationName || customer.organization || customer.companyName || row.organizationName || row.organization || row.companyName || info.organizationName || info.organization || info.companyName || "",
      customerType: customer.customerType || row.customerType || info.customerType || "",
      address: customer.address || row.address || info.address || "",
      phone: customer.phone || row.phone || info.phone || info.tel || "",
      email: customer.email || row.email || info.email || ""
    };
    if (view.customerName || view.organizationName) return view;
  }
  return { customerName: "", organizationName: "", customerType: "", address: "", phone: "", email: "" };
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

function paymentStatus(invoice) {
  if (!invoice) return "未作成";
  const invoiceStatus = statusLabel(invoice.status, "invoice");
  if (invoiceStatus === "入金不要") return "入金不要";
  if (invoiceStatus === "入金済み") return "入金済み";
  if (invoiceStatus === "キャンセル") return "キャンセル";
  const total = totalAmount(invoice);
  if (total <= 0) return "入金不要";
  const paid = getActivePayments(invoice).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (paid >= total) return "入金済み";
  if (invoiceStatus === "発行済み" || invoiceStatus === "入金待ち") return "入金待ち";
  return "未作成";
}

function latestDate(...rows) {
  const values = rows.flatMap(row => row ? [row.updatedAt, row.issuedAt, row.createdAt, row.invoiceDate, row.quoteDate, row.paymentDate] : []);
  return values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] || "";
}

function createProgressRows() {
  const quotes = readJson(PROGRESS_KEYS.quotes);
  const invoices = readJson(PROGRESS_KEYS.invoices);
  const deliveries = readJson(PROGRESS_KEYS.deliveries);
  const receipts = readJson(PROGRESS_KEYS.receipts);
  const groups = new Map();

  function ensure(key) {
    const origin = key || "未採番";
    if (!groups.has(origin)) groups.set(origin, { originNumber: origin, quotes: [], invoices: [], deliveries: [], receipts: [] });
    return groups.get(origin);
  }

  quotes.forEach(quote => ensure(getOriginNumber(quote, quote.quoteNo)).quotes.push(quote));
  invoices.forEach(invoice => ensure(getInvoiceKey(invoice)).invoices.push(invoice));
  deliveries.forEach(delivery => ensure(getOriginNumber(delivery, delivery.deliveryNo)).deliveries.push(delivery));
  receipts.forEach(receipt => ensure(getOriginNumber(receipt, receipt.receiptNo)).receipts.push(receipt));

  return Array.from(groups.values()).map(group => {
    const quote = group.quotes.slice().sort(sortByUpdated)[0] || null;
    const invoice = group.invoices.slice().sort(sortByUpdated)[0] || null;
    const delivery = group.deliveries.slice().sort(sortByUpdated)[0] || null;
    const receipt = group.receipts.slice().sort(sortByUpdated)[0] || null;
    const customer = customerView(quote, invoice, delivery, receipt);
    const transactionType = normalizeTransactionType(quote?.transactionType || invoice?.transactionType || delivery?.transactionType || receipt?.transactionType);
    const row = {
      originNumber: group.originNumber,
      quote,
      invoice,
      delivery,
      receipt,
      transactionType,
      organizationName: customer.organizationName,
      customerName: customer.customerName,
      quoteStatus: quote ? statusLabel(quote.status, "quote") : "未作成",
      invoiceStatus: invoice ? statusLabel(invoice.status, "invoice") : "未作成",
      paymentStatus: paymentStatus(invoice),
      deliveryStatus: delivery ? statusLabel(delivery.status, "delivery") : "未作成",
      receiptStatus: receipt ? statusLabel(receipt.status, "receipt") : "未作成",
      total: totalAmount(invoice, quote, delivery, receipt),
      staff: quote?.staff || invoice?.staff || delivery?.staff || receipt?.staff || "",
      updatedAt: latestDate(quote, invoice, delivery, receipt)
    };
    row.completion = getCompletion(row);
    return row;
  }).sort(sortProgressRows);
}

function sortByUpdated(a, b) {
  return String(b?.updatedAt || b?.createdAt || "").localeCompare(String(a?.updatedAt || a?.createdAt || ""));
}

function getCompletion(row) {
  const statuses = [row.quoteStatus, row.invoiceStatus, row.paymentStatus, row.deliveryStatus, row.receiptStatus];
  if (statuses.some(status => status === "キャンセル")) return "cancelled";
  const completePayment = row.paymentStatus === "入金済み" || row.paymentStatus === "入金不要";
  const completeDelivery = row.deliveryStatus === "発行済み";
  const completeReceipt = row.receiptStatus === "発行済み";
  if (completePayment && completeDelivery && completeReceipt && row.invoiceStatus !== "未作成" && !["下書き", "未発行"].includes(row.invoiceStatus)) return "complete";
  return "incomplete";
}

function sortProgressRows(a, b) {
  const rank = { incomplete: 0, complete: 1, cancelled: 2 };
  const diff = rank[a.completion] - rank[b.completion];
  if (diff) return diff;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function matchesProgressFilters(row) {
  if (progressCompletionFilter === "incomplete" && row.completion !== "incomplete") return false;
  if (progressCompletionFilter === "complete" && row.completion !== "complete") return false;
  if (progressTransactionFilter && row.transactionType !== progressTransactionFilter) return false;
  if (!progressSearchText) return true;
  const text = [
    row.originNumber,
    row.transactionType,
    row.organizationName,
    row.customerName,
    row.quoteStatus,
    row.invoiceStatus,
    row.paymentStatus,
    row.deliveryStatus,
    row.receiptStatus,
    row.staff
  ].join(" ").toLowerCase();
  return text.includes(progressSearchText);
}

function renderProgressList() {
  const rows = createProgressRows().filter(matchesProgressFilters);
  const count = document.getElementById("progressCount");
  if (count) count.textContent = `${rows.length}件`;
  const body = document.getElementById("progressListBody");
  if (!body) return;
  body.innerHTML = rows.length ? rows.map(renderProgressRow).join("") : '<tr><td colspan="13">該当する販売進捗はありません。</td></tr>';
}

function renderProgressRow(row) {
  return `<tr>
    <td><span class="number-with-status">${escapeHtml(row.originNumber)} ${row.completion === "incomplete" ? '<span class="status-badge warn">未完了</span>' : row.completion === "complete" ? '<span class="status-badge ok">完了</span>' : '<span class="status-badge danger">キャンセル含む</span>'}</span></td>
    <td>${escapeHtml(row.transactionType)}</td>
    <td>${escapeHtml(row.organizationName)}</td>
    <td>${escapeHtml(row.customerName)}</td>
    <td>${statusBadge(row.quoteStatus, "quote")}</td>
    <td>${statusBadge(row.invoiceStatus, "invoice")}</td>
    <td>${statusBadge(row.paymentStatus, "payment")}</td>
    <td>${statusBadge(row.deliveryStatus, "delivery")}</td>
    <td>${statusBadge(row.receiptStatus, "receipt")}</td>
    <td class="${amountClass(row.total, row)}">${money(row.total)}</td>
    <td>${escapeHtml(row.staff)}</td>
    <td>${escapeHtml(normalizeDateTime(row.updatedAt))}</td>
    <td>${renderActionLinks(row)}</td>
  </tr>`;
}

function pageLink(page, id, label, enabled = true) {
  const href = id ? `${page}?id=${encodeURIComponent(id)}` : page;
  const disabled = enabled ? "" : " disabled";
  return `<a class="secondary progress-action-link${disabled}" href="${href}">${escapeHtml(label)}</a>`;
}

function renderActionLinks(row) {
  return `<div class="progress-actions">
    ${pageLink("quotes.html", row.quote?.id, "見積")}
    ${pageLink("invoices.html", row.invoice?.id, "請求")}
    ${pageLink("payments.html", row.invoice?.id, "入金")}
    ${pageLink("delivery.html", row.delivery?.id, "納品")}
    ${pageLink("receipts.html", row.receipt?.id, "領収")}
  </div>`;
}

function bindProgressControls() {
  document.getElementById("progressSearch")?.addEventListener("input", event => {
    progressSearchText = event.target.value.trim().toLowerCase();
    renderProgressList();
  });
  document.getElementById("progressCompletionFilter")?.addEventListener("change", event => {
    progressCompletionFilter = event.target.value;
    renderProgressList();
  });
  document.getElementById("progressTransactionFilter")?.addEventListener("change", event => {
    progressTransactionFilter = event.target.value;
    renderProgressList();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  bindProgressControls();
  renderProgressList();
});
