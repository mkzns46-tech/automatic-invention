const INVOICES_KEY = "arico_sales_invoices_v1";
const DELIVERIES_KEY = "arico_sales_deliveries_v1";
const RECEIPTS_KEY = "arico_sales_receipts_v1";
const QUOTES_KEY = "arico_sales_quotes_v1";
const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
const INVOICE_STATUS_OPTIONS = ["下書き", "発行済み", "入金待ち", "入金済み", "入金不要", "キャンセル"];
const INVOICE_STATUS_DRAFT = "下書き";
const INVOICE_STATUS_ISSUED = "発行済み";
const INVOICE_STATUS_WAITING_PAYMENT = "入金待ち";
const INVOICE_STATUS_PAID = "入金済み";
const INVOICE_STATUS_NO_PAYMENT_REQUIRED = "入金不要";
const INVOICE_STATUS_CANCELLED = "キャンセル";
const STOCK_DEDUCTION_STATUS_PENDING = "pending";
const STOCK_DEDUCTION_STATUS_SUCCESS = "success";
const STOCK_DEDUCTION_STATUS_FAILED = "failed";
const STOCK_DEDUCTION_STATUS_SKIPPED = "skipped";
const SMAREGI_SALE_STATUS_PENDING = "pending";
const SMAREGI_SALE_STATUS_SUCCESS = "success";
const SMAREGI_SALE_STATUS_FAILED = "failed";
const SMAREGI_SALE_STATUS_SKIPPED = "skipped";

let currentInvoiceId = null;
let currentInvoiceLines = [];
let invoiceListSearchText = "";
let invoiceListStatusFilter = "";
let invoiceListDateFrom = "";
let invoiceListDateTo = "";
let invoiceListCollapsed = false;

function readInvoices() {
  return JSON.parse(localStorage.getItem(INVOICES_KEY) || "[]");
}

function writeInvoices(invoices) {
  localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
}

function readDeliveries() {
  return JSON.parse(localStorage.getItem(DELIVERIES_KEY) || "[]");
}

function readReceipts() {
  try {
    return JSON.parse(localStorage.getItem(RECEIPTS_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function writeDeliveries(deliveries) {
  localStorage.setItem(DELIVERIES_KEY, JSON.stringify(deliveries));
}

function readLinkedQuotes() {
  try {
    const rows = JSON.parse(localStorage.getItem(QUOTES_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function writeLinkedQuotes(quotes) {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
}

async function salesRestFetch(path, options = {}) {
  const url = `${ARICO_SUPABASE_URL}/rest/v1/${path}`;
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        apikey: ARICO_SUPABASE_API_KEY,
        Authorization: `Bearer ${ARICO_SUPABASE_API_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(`Supabase fetch failed: ${url}: ${error?.message || error}`);
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Supabase API ${response.status}: ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultTradeSubject(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = value => String(value).padStart(2, "0");
  return `${safe.getFullYear()}年${pad(safe.getMonth() + 1)}月${pad(safe.getDate())}日取引分`;
}

function datePlusDays(value, days) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  safe.setDate(safe.getDate() + Number(days || 0));
  return safe.toISOString().slice(0, 10);
}

function removeUnusedInvoiceFields() {
  ["sourceQuoteNo", "originalSlipNumber", "reasonMemo"].forEach(id => {
    const input = document.getElementById(id);
    const label = input?.closest("label");
    if (label) label.remove();
  });
}

function arrangeInvoiceHeaderRow() {
  const invoiceNoLabel = document.getElementById("invoiceNo")?.closest("label");
  const statusLabel = document.getElementById("invoiceStatus")?.closest("label");
  const issuedAtLabel = document.getElementById("issuedAt")?.closest("label");
  if (!invoiceNoLabel || !statusLabel || !issuedAtLabel) return;
  const sourceRow = invoiceNoLabel.parentElement;
  let row = document.getElementById("invoiceHeaderInfoRow");
  if (!row) {
    row = document.createElement("div");
    row.id = "invoiceHeaderInfoRow";
    row.className = "row three invoice-header-info-row";
    sourceRow.insertAdjacentElement("afterend", row);
  }
  row.appendChild(invoiceNoLabel);
  row.appendChild(statusLabel);
  row.appendChild(issuedAtLabel);
}

function arrangeInvoiceSubjectDateRow() {
  const subjectLabel = document.getElementById("invoiceSubject")?.closest("label");
  const dateLabel = document.getElementById("invoiceDate")?.closest("label");
  const dueLabel = document.getElementById("dueDate")?.closest("label");
  const staffLabel = document.getElementById("invoiceStaff")?.closest("label");
  const transactionLabel = document.getElementById("transactionType")?.closest("label");
  const sourceRow = subjectLabel?.parentElement;
  if (!sourceRow || !subjectLabel || !dateLabel || !dueLabel) return;
  let row = document.getElementById("invoiceSubjectDateRow");
  if (!row) {
    row = document.createElement("div");
    row.id = "invoiceSubjectDateRow";
    row.className = "row three invoice-subject-date-row";
    sourceRow.insertAdjacentElement("afterend", row);
  }
  row.appendChild(subjectLabel);
  row.appendChild(dateLabel);
  row.appendChild(dueLabel);

  if (!staffLabel || !transactionLabel) return;
  let secondRow = document.getElementById("invoiceStaffTransactionRow");
  if (!secondRow) {
    secondRow = document.createElement("div");
    secondRow.id = "invoiceStaffTransactionRow";
    secondRow.className = "row three staff-transaction-row";
    row.insertAdjacentElement("afterend", secondRow);
  }
  secondRow.appendChild(staffLabel);
  secondRow.appendChild(transactionLabel);
}

function moveInvoiceOverallDiscountToSummary() {
  const label = document.getElementById("overallDiscountAmount")?.closest("label");
  const discountBox = document.getElementById("discountText")?.closest("div");
  if (!label || !discountBox || label.closest(".summary")) return;
  label.classList.add("summary-input-box");
  discountBox.insertAdjacentElement("afterend", label);
}

function markInvoiceRequiredLabels() {
  const requiredIds = [
    "invoiceNo",
    "invoiceStatus",
    "issuedAt",
    "customerName",
    "invoiceOrganizationName",
    "customerType",
    "customerAddress",
    "customerPhone",
    "customerEmail",
    "invoiceSubject",
    "invoiceDate",
    "dueDate",
    "invoiceStaff",
    "transactionType"
  ];
  requiredIds.forEach(id => applyRequiredLabel(document.getElementById(id)?.closest("label")));
}

function applyRequiredLabel(label) {
  if (!label || label.querySelector(":scope > .required-mark")) return;
  label.classList.add("required-label");
  const marker = document.createElement("span");
  marker.className = "required-mark";
  marker.textContent = " *";
  const textNode = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.after(marker);
  else label.prepend(marker);
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

function setFieldValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? "";
}

function money(value) {
  return Number(value || 0).toLocaleString("ja-JP") + "円";
}

function amountClass(value, transactionType = "") {
  return Number(value || 0) < 0 || isRefundTransaction(transactionType) ? "amount-negative refund-amount" : "";
}

function extractSlipNumber(value) {
  const matches = String(value || "").match(/\d+/g);
  return matches ? Number(matches[matches.length - 1]) : 0;
}

function sortNewestFirst(a, b) {
  const aDate = a.updatedAt || a.createdAt || "";
  const bDate = b.updatedAt || b.createdAt || "";
  if (aDate || bDate) {
    const diff = String(bDate).localeCompare(String(aDate));
    if (diff) return diff;
  }
  return extractSlipNumber(b.invoiceNo || b.invoiceNumber || b.originNumber) - extractSlipNumber(a.invoiceNo || a.invoiceNumber || a.originNumber);
}

function refundBadge(transactionType) {
  return isRefundTransaction(transactionType) ? '<span class="status-badge danger">返金</span>' : "";
}

function clampNumber(value, min, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function getCurrentTransactionType() {
  return document.getElementById("transactionType")?.value || "通常販売";
}

function isRefundTransaction(type) {
  return String(type || "").trim() === "返金";
}

function isFreeTransaction(type) {
  const value = String(type || "").trim();
  return value === "無償提供" || value === "交換";
}

function normalizeTransactionType(type) {
  const value = String(type || "").trim();
  if (value === "返品") return "返金";
  return value || "通常販売";
}

function normalizeInvoiceStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "下書き") return INVOICE_STATUS_DRAFT;
  if (value === "issued" || value === "発行済み") return INVOICE_STATUS_ISSUED;
  if (value === "waiting_payment" || value === "payment_waiting" || value === "入金待ち") return INVOICE_STATUS_WAITING_PAYMENT;
  if (value === "paid" || value === "入金済み") return INVOICE_STATUS_PAID;
  if (value === "no_payment_required" || value === "no_payment" || value === "payment_not_required" || value === "入金不要") return INVOICE_STATUS_NO_PAYMENT_REQUIRED;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return INVOICE_STATUS_CANCELLED;
  return status || INVOICE_STATUS_DRAFT;
}

function isInvoiceEditable(invoiceOrStatus) {
  if (invoiceOrStatus && typeof invoiceOrStatus === "object" && !invoiceOrStatus.issuedAt) return true;
  const status = normalizeInvoiceStatus(typeof invoiceOrStatus === "string" ? invoiceOrStatus : invoiceOrStatus?.status);
  return status === INVOICE_STATUS_DRAFT;
}

function isCurrentInvoiceEditable() {
  const invoice = currentInvoiceId ? readInvoices().find(row => row.id === currentInvoiceId) : null;
  if (invoice) return isInvoiceEditable(invoice);
  return isInvoiceEditable(document.getElementById("invoiceStatus")?.value);
}

function pickInvoiceCustomerFields(row) {
  const customerObject = typeof row?.customer === "object" && row.customer ? row.customer : {};
  const info = row?.customerInfo || row?.customer_info || row?.customerDetail || row?.customerData || row?.billingCustomer || customerObject || {};
  return {
    customerId: row?.customerId || info.customerId || info.id || "",
    customerCode: row?.customerCode || info.customerCode || info.code || "",
    smaregiCustomerId: row?.smaregiCustomerId || info.smaregiCustomerId || info.smaregiMemberId || "",
    smaregiCustomerCode: row?.smaregiCustomerCode || info.smaregiCustomerCode || info.smaregiMemberCode || "",
    customerName: row?.customerName || row?.name || row?.clientName || row?.billingName || row?.customer_name || info.customerName || info.name || "",
    organizationName: row?.organizationName || row?.organization || row?.companyName || row?.company || row?.organization_name || info.organizationName || info.organization || info.companyName || "",
    customerType: row?.customerType || row?.customer_type || info.customerType || "",
    address: row?.address || row?.customerAddress || row?.customer_address || info.address || "",
    phone: row?.phone || row?.tel || row?.customerPhone || row?.customer_phone || info.phone || info.tel || "",
    email: row?.email || row?.customerEmail || row?.customer_email || info.email || "",
    customerMemo: row?.customerMemo || row?.memo || info.customerMemo || info.memo || ""
  };
}

function readCustomerMaster() {
  if (window.SalesCustomerStorage?.readCustomers) {
    return window.SalesCustomerStorage.readCustomers();
  }
  try {
    return JSON.parse(localStorage.getItem("arico_sales_customers_v1") || "[]");
  } catch (_) {
    return [];
  }
}

function sameCustomerKey(a, b) {
  return String(a || "").trim() && String(a || "").trim() === String(b || "").trim();
}

function resolveInvoiceCustomer(invoice) {
  const customers = readCustomerMaster();
  if (!customers.length) return null;
  return customers.find(customer =>
    sameCustomerKey(customer.id, invoice.customerId) ||
    sameCustomerKey(customer.customerId, invoice.customerId) ||
    sameCustomerKey(customer.customerCode, invoice.customerCode) ||
    sameCustomerKey(customer.code, invoice.customerCode) ||
    sameCustomerKey(customer.smaregiCustomerId, invoice.smaregiCustomerId) ||
    sameCustomerKey(customer.smaregiMemberId, invoice.smaregiCustomerId) ||
    sameCustomerKey(customer.smaregiCustomerCode, invoice.smaregiCustomerCode) ||
    sameCustomerKey(customer.smaregiMemberCode, invoice.smaregiCustomerCode)
  ) || null;
}

function getInvoiceCustomerView(invoice) {
  const customer = resolveInvoiceCustomer(invoice) || {};
  const fallback = pickInvoiceCustomerFields(invoice || {});
  return {
    customerName: customer.customerName || customer.name || fallback.customerName,
    organizationName: customer.organizationName || customer.organization || customer.companyName || fallback.organizationName,
    customerType: customer.customerType || fallback.customerType,
    address: customer.address || fallback.address,
    phone: customer.phone || fallback.phone,
    email: customer.email || fallback.email,
    customerMemo: customer.memo || customer.customerMemo || fallback.customerMemo
  };
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP");
}

function statusBadge(status) {
  const value = normalizeInvoiceStatus(status);
  const type = value === INVOICE_STATUS_CANCELLED
    ? "danger"
    : value === INVOICE_STATUS_DRAFT
      ? "muted"
      : value === INVOICE_STATUS_WAITING_PAYMENT
        ? "warn"
        : value === INVOICE_STATUS_ISSUED
          ? "info"
          : value === INVOICE_STATUS_NO_PAYMENT_REQUIRED
            ? "info"
            : "ok";
  return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
}

function normalizeStockDeductionStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === STOCK_DEDUCTION_STATUS_PENDING || value === "減算中") return STOCK_DEDUCTION_STATUS_PENDING;
  if (value === STOCK_DEDUCTION_STATUS_SUCCESS || value === "在庫減算済") return STOCK_DEDUCTION_STATUS_SUCCESS;
  if (value === STOCK_DEDUCTION_STATUS_FAILED || value === "在庫減算失敗") return STOCK_DEDUCTION_STATUS_FAILED;
  if (value === STOCK_DEDUCTION_STATUS_SKIPPED || value === "対象外") return STOCK_DEDUCTION_STATUS_SKIPPED;
  return "";
}

function stockDeductionLabel(status) {
  const value = normalizeStockDeductionStatus(status);
  if (value === STOCK_DEDUCTION_STATUS_PENDING) return "在庫減算中";
  if (value === STOCK_DEDUCTION_STATUS_SUCCESS) return "在庫減算済";
  if (value === STOCK_DEDUCTION_STATUS_FAILED) return "在庫減算失敗";
  if (value === STOCK_DEDUCTION_STATUS_SKIPPED) return "在庫減算対象外";
  return "未実行";
}

function stockDeductionDisplay(invoiceOrStatus) {
  if (invoiceOrStatus && typeof invoiceOrStatus === "object") {
    if (
      normalizeStockDeductionStatus(invoiceOrStatus.stockDeductionStatus) === STOCK_DEDUCTION_STATUS_SUCCESS &&
      invoiceOrStatus.stockBaseStockSyncStatus === "failed"
    ) {
      return "在庫同期失敗";
    }
    return stockDeductionLabel(invoiceOrStatus.stockDeductionStatus);
  }
  return stockDeductionLabel(invoiceOrStatus);
}

function normalizeSmaregiSaleStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === SMAREGI_SALE_STATUS_PENDING || value === "登録中") return SMAREGI_SALE_STATUS_PENDING;
  if (value === SMAREGI_SALE_STATUS_SUCCESS || value === "登録済み") return SMAREGI_SALE_STATUS_SUCCESS;
  if (value === SMAREGI_SALE_STATUS_FAILED || value === "登録失敗") return SMAREGI_SALE_STATUS_FAILED;
  if (value === SMAREGI_SALE_STATUS_SKIPPED || value === "対象外") return SMAREGI_SALE_STATUS_SKIPPED;
  return "";
}

function smaregiSaleLabel(status) {
  const value = normalizeSmaregiSaleStatus(status);
  if (value === SMAREGI_SALE_STATUS_PENDING) return "スマレジ売上登録中";
  if (value === SMAREGI_SALE_STATUS_SUCCESS) return "スマレジ売上登録済み";
  if (value === SMAREGI_SALE_STATUS_FAILED) return "スマレジ売上登録失敗";
  if (value === SMAREGI_SALE_STATUS_SKIPPED) return "スマレジ売上登録対象外";
  return "未登録";
}

function smaregiSaleDisplay(invoiceOrStatus) {
  if (invoiceOrStatus && typeof invoiceOrStatus === "object") {
    if (
      normalizeSmaregiSaleStatus(invoiceOrStatus.smaregiSaleStatus) === SMAREGI_SALE_STATUS_SUCCESS &&
      invoiceOrStatus.stockBaseStockSyncStatus === "failed"
    ) {
      return "スマレジ売上登録済み / 在庫同期失敗";
    }
    return smaregiSaleLabel(invoiceOrStatus.smaregiSaleStatus);
  }
  return smaregiSaleLabel(invoiceOrStatus);
}

function stockDeductionBadge(invoice) {
  if (invoice?.stockBaseStockSyncStatus === "failed") {
    return '<span class="status-badge danger">在庫同期失敗</span>';
  }
  const value = normalizeStockDeductionStatus(invoice?.stockDeductionStatus);
  if (!value) return "";
  const type = value === STOCK_DEDUCTION_STATUS_SUCCESS
    ? "ok"
    : value === STOCK_DEDUCTION_STATUS_FAILED
      ? "danger"
      : value === STOCK_DEDUCTION_STATUS_SKIPPED
        ? "muted"
        : "warn";
  return `<span class="status-badge ${type}">${escapeHtml(stockDeductionLabel(value))}</span>`;
}

function isStockDeductionTarget(invoice) {
  const type = normalizeTransactionType(invoice?.transactionType);
  return type !== "返金";
}

function isSmaregiSaleTarget(invoice) {
  return isStockDeductionTarget(invoice);
}

function canRetryStockDeduction(invoice) {
  const status = normalizeSmaregiSaleStatus(invoice?.smaregiSaleStatus);
  return Boolean(invoice?.id && isSmaregiSaleTarget(invoice) && (status === SMAREGI_SALE_STATUS_FAILED || invoice.stockBaseStockSyncStatus === "failed"));
}

function canOutputInvoicePdf(invoice) {
  if (!invoice) return false;
  return Boolean(invoice.issuedAt) && normalizeInvoiceStatus(invoice.status) !== INVOICE_STATUS_DRAFT;
}

function normalizeDeliveryStatusForInvoice(status) {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (lower === "cancel" || lower === "cancelled" || lower === "canceled" || value === "キャンセル") return "cancelled";
  if (lower === "issued" || value === "納品書発行済" || value === "発送準備中" || value === "発行済み") return "issued";
  if (lower === "shipped" || lower === "delivered" || value === "発送済" || value === "納品済み") return "shipped";
  if (lower === "hand_delivered" || lower === "hand_delivery" || value === "手渡し済") return "shipped";
  if (lower === "staff_carry" || lower === "staff_carried" || value === "担当者手持ち済") return "shipped";
  return value;
}

function normalizeReceiptStatusForInvoice(status) {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (lower === "issued" || value === "発行済み") return "issued";
  if (lower === "cancel" || lower === "cancelled" || lower === "canceled" || value === "キャンセル") return "cancelled";
  return value;
}

function invoiceHasPaidRecord(invoice) {
  if (normalizeInvoiceStatus(invoice?.status) === INVOICE_STATUS_PAID) return true;
  if (invoice?.paidAt) return true;
  if (Number(invoice?.paidAmount || 0) > 0) return true;
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  return payments.some(payment => payment?.status !== "canceled" && Number(payment?.amount || 0) > 0);
}

function getLinkedDeliveriesForInvoice(invoice) {
  const invoiceNo = String(invoice?.invoiceNo || invoice?.invoiceNumber || "").trim();
  const invoiceId = String(invoice?.id || "").trim();
  if (!invoiceNo && !invoiceId) return [];
  return readDeliveries().filter(delivery => {
    const keys = [
      delivery.sourceInvoiceNo,
      delivery.invoiceNo,
      delivery.invoiceNumber,
      delivery.sourceInvoiceId,
      delivery.invoiceId
    ].map(value => String(value || "").trim()).filter(Boolean);
    return keys.includes(invoiceNo) || keys.includes(invoiceId);
  });
}

function invoiceHasBlockedDelivery(invoice) {
  return getLinkedDeliveriesForInvoice(invoice).some(delivery => {
    const status = normalizeDeliveryStatusForInvoice(delivery.status);
    return status !== "cancelled" && (status === "issued" || status === "shipped" || Boolean(delivery.shippedAt || delivery.completedAt));
  });
}

function invoiceHasIssuedReceipt(invoice) {
  const invoiceNo = String(invoice?.invoiceNo || invoice?.invoiceNumber || "").trim();
  const invoiceId = String(invoice?.id || "").trim();
  if (!invoiceNo && !invoiceId) return false;
  return readReceipts().some(receipt => {
    const status = normalizeReceiptStatusForInvoice(receipt.status);
    if (status === "cancelled") return false;
    const linked = [
      receipt.sourceInvoiceNo,
      receipt.invoiceNo,
      receipt.invoiceNumber,
      receipt.sourceInvoiceId,
      receipt.invoiceId
    ].map(value => String(value || "").trim()).filter(Boolean);
    return (linked.includes(invoiceNo) || linked.includes(invoiceId)) && (status === "issued" || Boolean(receipt.issuedAt));
  });
}

function canCancelInvoice(invoice) {
  if (!invoice) return false;
  const status = normalizeInvoiceStatus(invoice.status);
  if (status === INVOICE_STATUS_CANCELLED || status === INVOICE_STATUS_DRAFT || status === INVOICE_STATUS_PAID || status === INVOICE_STATUS_NO_PAYMENT_REQUIRED) return false;
  if (normalizeSmaregiSaleStatus(invoice.smaregiSaleStatus) !== SMAREGI_SALE_STATUS_SUCCESS) return false;
  if (invoiceHasPaidRecord(invoice)) return false;
  if (invoiceHasBlockedDelivery(invoice)) return false;
  if (invoiceHasIssuedReceipt(invoice)) return false;
  return status === INVOICE_STATUS_ISSUED || status === INVOICE_STATUS_WAITING_PAYMENT;
}

function recalcInvoiceLine(line) {
  const transactionType = normalizeTransactionType(line.transactionType || getCurrentTransactionType());
  const qty = Number(line.qty || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const discountValue = isFreeTransaction(transactionType) ? 100 : clampNumber(line.discountValue ?? line.discountRate ?? 0, 0, 100);
  const gross = Math.max(0, Math.round(Math.abs(qty) * Math.abs(unitPrice)));
  const rateDiscount = Math.round(gross * discountValue / 100);
  const fixedDiscount = Math.max(0, Number(line.discountAmountInput || line.fixedDiscountAmount || line.manualDiscountAmount || 0));
  const appliedFixedDiscount = isFreeTransaction(transactionType) ? 0 : fixedDiscount;
  line.transactionType = transactionType;
  line.discountValue = discountValue;
  line.discountRate = discountValue;
  line.discountAmountInput = appliedFixedDiscount;
  line.discountAmount = Math.min(gross, appliedFixedDiscount > 0 ? appliedFixedDiscount : rateDiscount);
  const netAmount = Math.max(0, gross - line.discountAmount);
  line.amount = isRefundTransaction(transactionType) ? -netAmount : netAmount;
  return line;
}

function formatInvoiceStock(line) {
  if (line.manualProduct || (!line.barcode && !line.smaregiProductId && !line.productId)) return "手入力";
  const value = Number(line.stock ?? line.base_stock ?? 0);
  return value > 0 ? `現在庫 ${value}` : "取寄せ";
}

function invoiceStockClass(line) {
  if (line.manualProduct || (!line.barcode && !line.smaregiProductId && !line.productId)) return "line-stock muted";
  return Number(line.stock ?? line.base_stock ?? 0) > 0 ? "" : "line-stock warn";
}

function normalizeInvoiceLine(line) {
  const normalized = {
    ...line,
    name: line?.name || line?.productName || line?.itemName || line?.product_name || "",
    qty: Number(line?.qty ?? line?.quantity ?? line?.count ?? 0),
    unit: line?.unit || line?.unitName || "",
    unitPrice: Number(line?.unitPrice ?? line?.price ?? line?.taxIncludedPrice ?? line?.salePrice ?? 0),
    discountValue: Number(line?.discountValue ?? line?.discountRate ?? line?.discount ?? 0),
    discountAmountInput: Number(line?.discountAmountInput ?? line?.fixedDiscountAmount ?? line?.manualDiscountAmount ?? 0),
    memo: line?.memo || line?.note || ""
  };
  normalized.discountRate = normalized.discountValue;
  return recalcInvoiceLine(normalized);
}

function firstLineArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const rows = Object.values(value).filter(row => row && typeof row === "object");
      if (rows.length) return rows;
    }
  }
  return [];
}

function getInvoiceRawLines(invoice) {
  const rows = firstLineArray(
    invoice?.lines,
    invoice?.items,
    invoice?.products,
    invoice?.details,
    invoice?.invoiceItems,
    invoice?.invoiceLines,
    invoice?.quoteLines,
    invoice?.lineItems,
    invoice?.orderItems
  );
  return rows.map(normalizeInvoiceLine);
}

async function refreshInvoiceLineStocks() {
  const targets = currentInvoiceLines
    .map(line => ({
      barcode: String(line.barcode || line.productCode || "").trim(),
      productId: String(line.smaregiProductId || line.smaregi_product_id || line.productId || "").trim()
    }))
    .filter(target => target.barcode || target.productId);
  const unique = new Map(targets.map(target => [`${target.barcode}|${target.productId}`, target]));
  for (const target of unique.values()) {
    let rows = [];
    if (target.barcode) {
      rows = await salesRestFetch(`products?select=barcode,base_stock,smaregi_product_id&barcode=eq.${encodeURIComponent(target.barcode)}&limit=1`).catch(() => []);
    }
    if ((!Array.isArray(rows) || !rows[0]) && target.productId) {
      rows = await salesRestFetch(`products?select=barcode,base_stock,smaregi_product_id&smaregi_product_id=eq.${encodeURIComponent(target.productId)}&limit=1`).catch(() => []);
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) continue;
    currentInvoiceLines.forEach(line => {
      const sameBarcode = target.barcode && String(line.barcode || line.productCode || "") === target.barcode;
      const sameProduct = target.productId && String(line.smaregiProductId || line.smaregi_product_id || line.productId || "") === target.productId;
      if (sameBarcode || sameProduct) line.stock = Number(row.base_stock || 0);
    });
  }
  renderInvoiceLines();
}

function normalizeInvoiceForView(invoice) {
  const normalized = { ...(invoice || {}) };
  const customerView = getInvoiceCustomerView(normalized);
  const lines = getInvoiceRawLines(normalized);
  const customerFields = pickInvoiceCustomerFields(normalized);
  normalized.customerId = normalized.customerId || customerFields.customerId;
  normalized.customerCode = normalized.customerCode || customerFields.customerCode;
  normalized.smaregiCustomerId = normalized.smaregiCustomerId || customerFields.smaregiCustomerId;
  normalized.smaregiCustomerCode = normalized.smaregiCustomerCode || customerFields.smaregiCustomerCode;
  normalized.customerName = customerView.customerName;
  normalized.organizationName = customerView.organizationName;
  normalized.customerType = customerView.customerType;
  normalized.address = customerView.address;
  normalized.phone = customerView.phone;
  normalized.email = customerView.email;
  normalized.customerMemo = customerView.customerMemo;
  normalized.items = lines;
  normalized.lines = lines;
  return normalized;
}

function persistNormalizedInvoiceIfNeeded(invoice) {
  if (!invoice?.id) return invoice;
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === invoice.id);
  if (index < 0) return invoice;
  const original = invoices[index];
  const normalized = normalizeInvoiceForView(original);
  const shouldPersist = Boolean(
    normalized.customerName && !original.customerName ||
    normalized.organizationName && !original.organizationName ||
    normalized.lines.length && (!Array.isArray(original.lines) || !original.lines.length)
  );
  if (shouldPersist) {
    invoices[index] = {
      ...original,
      customerId: normalized.customerId || original.customerId || "",
      customerCode: normalized.customerCode || original.customerCode || "",
      smaregiCustomerId: normalized.smaregiCustomerId || original.smaregiCustomerId || "",
      smaregiCustomerCode: normalized.smaregiCustomerCode || original.smaregiCustomerCode || "",
      customerName: normalized.customerName || original.customerName || "",
      organizationName: normalized.organizationName || original.organizationName || "",
      customerType: normalized.customerType || original.customerType || "",
      address: normalized.address || original.address || "",
      phone: normalized.phone || original.phone || "",
      email: normalized.email || original.email || "",
      items: normalized.items,
      lines: normalized.lines
    };
    writeInvoices(invoices);
    return invoices[index];
  }
  return normalized;
}

function calcInvoiceTotals(invoice) {
  const lines = getInvoiceRawLines(invoice);
  let subtotal = 0;
  let discount = 0;
  let total = 0;
  lines.forEach(line => {
    recalcInvoiceLine(line);
    const gross = Math.max(0, Math.round(Math.abs(Number(line.qty || 0)) * Math.abs(Number(line.unitPrice || 0))));
    subtotal += gross;
    discount += Number(line.discountAmount || 0);
    total += Number(line.amount || 0);
  });
  const overallDiscountAmount = Math.max(0, Number(invoice?.overallDiscountAmount || 0));
  const appliedOverallDiscount = isRefundTransaction(invoice?.transactionType)
    ? overallDiscountAmount
    : Math.min(Math.max(0, total), overallDiscountAmount);
  discount += appliedOverallDiscount;
  total = isRefundTransaction(invoice?.transactionType)
    ? total + appliedOverallDiscount
    : Math.max(0, total - appliedOverallDiscount);
  return {
    subtotal,
    discount,
    overallDiscountAmount: appliedOverallDiscount,
    total,
    tax: Math.floor(total * 10 / 110)
  };
}

function buildStockDeductionLines(invoice) {
  return getInvoiceRawLines(invoice).map(line => {
    const normalizedLine = recalcInvoiceLine({ ...line, transactionType: invoice.transactionType });
    const qty = Math.abs(Number(normalizedLine.qty || normalizedLine.quantity || 0));
    const productId = String(line.smaregiProductId || line.smaregi_product_id || line.productId || "").trim();
    const barcode = String(line.barcode || line.productCode || "").trim();
    return {
      productId,
      smaregiProductId: productId,
      productCode: barcode,
      barcode,
      name: String(normalizedLine.name || line.name || "").trim(),
      productName: String(normalizedLine.name || line.name || "").trim(),
      quantity: qty,
      qty,
      unit: normalizedLine.unit || line.unit || "",
      unitPrice: Number(normalizedLine.unitPrice || 0),
      price: Number(normalizedLine.unitPrice || 0),
      discountRate: Number(normalizedLine.discountRate ?? normalizedLine.discountValue ?? 0),
      discountValue: Number(normalizedLine.discountValue ?? normalizedLine.discountRate ?? 0),
      discountAmount: Number(normalizedLine.discountAmount || 0),
      discountAmountInput: Number(normalizedLine.discountAmountInput || 0),
      amount: Number(normalizedLine.amount || 0),
      memo: normalizedLine.memo || line.memo || ""
    };
  }).filter(line => line.quantity > 0 && (line.productId || line.barcode || line.productCode));
}

function buildSmaregiSaleLines(invoice) {
  return getInvoiceRawLines(invoice).map(line => {
    const normalizedLine = recalcInvoiceLine({ ...line, transactionType: invoice.transactionType });
    const qty = Math.abs(Number(normalizedLine.qty || normalizedLine.quantity || 0));
    const productId = String(line.smaregiProductId || line.smaregi_product_id || line.productId || "").trim();
    const barcode = String(line.barcode || line.productCode || "").trim();
    const manualProduct = Boolean(line.manualProduct) || (!productId && !barcode);
    return {
      productId,
      smaregiProductId: productId,
      productCode: barcode,
      barcode,
      manualProduct,
      name: String(normalizedLine.name || line.name || "").trim(),
      productName: String(normalizedLine.name || line.name || "").trim(),
      quantity: qty,
      qty,
      unit: normalizedLine.unit || line.unit || "",
      unitPrice: Number(normalizedLine.unitPrice || 0),
      price: Number(normalizedLine.unitPrice || 0),
      discountRate: Number(normalizedLine.discountRate ?? normalizedLine.discountValue ?? 0),
      discountValue: Number(normalizedLine.discountValue ?? normalizedLine.discountRate ?? 0),
      discountAmount: Number(normalizedLine.discountAmount || 0),
      discountAmountInput: Number(normalizedLine.discountAmountInput || 0),
      amount: Number(normalizedLine.amount || 0),
      memo: normalizedLine.memo || line.memo || ""
    };
  }).filter(line => line.quantity > 0 && (line.productId || line.barcode || line.productCode || line.manualProduct || line.name));
}

async function readStockApiJson(response) {
  const text = await response.text().catch(() => "");
  console.log("[Sales stock decrement API response]", {
    ok: response.ok,
    status: response.status,
    body: text
  });
  if (!text) {
    throw new Error(`在庫減算API応答が空です。HTTP ${response.status}`);
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`在庫減算APIのJSON解析に失敗しました。HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `在庫減算APIエラー HTTP ${response.status}`);
  }
  return data;
}

async function findProductForStockLine(line) {
  if (line.barcode) {
    const rows = await salesRestFetch(`products?select=barcode,base_stock,smaregi_product_id&barcode=eq.${encodeURIComponent(line.barcode)}&limit=1`);
    if (Array.isArray(rows) && rows[0]) return { row: rows[0], filter: `barcode=eq.${encodeURIComponent(line.barcode)}` };
  }
  if (line.productId) {
    const rows = await salesRestFetch(`products?select=barcode,base_stock,smaregi_product_id&smaregi_product_id=eq.${encodeURIComponent(line.productId)}&limit=1`);
    if (Array.isArray(rows) && rows[0]) return { row: rows[0], filter: `smaregi_product_id=eq.${encodeURIComponent(line.productId)}` };
  }
  return null;
}

async function syncProductsBaseStock(lines, mode = "decrement") {
  const response = await fetch("/api/products-base-stock-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines, mode })
  });
  const text = await response.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    throw new Error(`products.base_stock sync JSON parse failed HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  console.log("[products.base_stock sync response]", {
    ok: response.ok,
    status: response.status,
    body: data || text
  });
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `products.base_stock sync API error HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return Array.isArray(data?.results) ? data.results : [];
}

async function cancelSmaregiSale(invoice, reason) {
  const lines = Array.isArray(invoice.smaregiSaleLines) && invoice.smaregiSaleLines.length
    ? invoice.smaregiSaleLines
    : buildStockDeductionLines(invoice);
  const totals = calcInvoiceTotals(invoice);
  const response = await fetch("/api/smaregi-sales-cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      originNumber: invoice.originNumber || invoice.masterNumber || invoice.sourceQuoteNo || "",
      smaregiTransactionId: invoice.smaregiTransactionId || "",
      cancelReason: reason || "",
      cancelledAt: invoice.cancelledAt || invoice.canceledAt || new Date().toISOString(),
      tax: totals.tax,
      overallDiscountAmount: totals.overallDiscountAmount || 0,
      overallDiscountReason: invoice.overallDiscountReason || "",
      lines
    })
  });
  const text = await response.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    throw new Error(`Smaregi sale cancel JSON parse failed HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  console.log("[Smaregi sale cancel response]", {
    ok: response.ok,
    status: response.status,
    body: data || text
  });
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Smaregi sale cancel API error HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { data, lines };
}

async function restoreProductsBaseStock(lines) {
  return syncProductsBaseStock(lines, "restore");
}

async function applyInvoiceCancel(invoice, reason) {
  const next = { ...invoice };
  const now = new Date().toISOString();
  const alreadyCanceled = normalizeInvoiceStatus(next.status) === INVOICE_STATUS_CANCELLED ||
    (next.cancelStatus === "success" && Boolean(next.cancelledAt || next.canceledAt));
  if (alreadyCanceled) {
    throw new Error("This invoice is already canceled.");
  }
  next.cancelStatus = "pending";
  next.cancelReason = reason || "";
  next.cancelRequestedAt = now;

  const saleSucceeded = normalizeSmaregiSaleStatus(next.smaregiSaleStatus) === SMAREGI_SALE_STATUS_SUCCESS;
  const baseStockWasSynced = next.stockBaseStockSyncStatus === "success";
  if (!saleSucceeded) {
    next.cancelStatus = "failed";
    next.cancelError = "スマレジ売上登録が成功していないため、請求書キャンセルを完了できません。";
    next.smaregiCancelStatus = "skipped";
    next.stockRestoreStatus = "skipped";
    next.updatedAt = new Date().toISOString();
    return next;
  } else {
    if (next.smaregiCancelStatus === "success") {
      throw new Error("Smaregi sale cancel is already completed.");
    }
    next.smaregiCancelStatus = "pending";
    const cancelResult = await cancelSmaregiSale(next, reason);
    next.smaregiCancelStatus = "success";
    next.smaregiCancelError = "";
    next.smaregiCancelTransactionId = cancelResult.data.smaregiCancelTransactionId || "";
    next.smaregiCanceledAt = now;
    next.smaregiCancelLines = cancelResult.lines.map(line => ({ ...line }));

    if (baseStockWasSynced) {
      next.stockRestoreStatus = "pending";
      const restoreResults = await restoreProductsBaseStock(cancelResult.lines);
      next.stockRestoreStatus = restoreResults.every(row => row.ok) ? "success" : "failed";
      next.stockRestoreError = next.stockRestoreStatus === "failed" ? "Some products.base_stock restore lines failed." : "";
      next.stockRestoredAt = next.stockRestoreStatus === "success" ? new Date().toISOString() : "";
      next.stockRestoreLines = restoreResults;
      if (next.stockRestoreStatus !== "success") {
        next.cancelStatus = "failed";
        next.cancelError = next.stockRestoreError || "products.base_stock復帰に失敗しました。";
        next.updatedAt = new Date().toISOString();
        return next;
      }
    } else {
      next.cancelStatus = "failed";
      next.cancelError = "products.base_stockの減算成功履歴がないため、在庫復帰を確認できません。";
      next.stockRestoreStatus = "skipped";
      next.stockRestoreError = next.cancelError;
      next.stockRestoreLines = [];
      next.updatedAt = new Date().toISOString();
      return next;
    }
  }

  next.status = INVOICE_STATUS_CANCELLED;
  next.cancelStatus = "success";
  next.cancelError = "";
  next.cancelledAt = now;
  next.canceledAt = now;
  next.updatedAt = new Date().toISOString();
  return next;
}

async function applyInvoiceStockDeduction(invoice) {
  const next = { ...invoice };
  if (normalizeSmaregiSaleStatus(next.smaregiSaleStatus) === SMAREGI_SALE_STATUS_SUCCESS) return next;
  if (!isSmaregiSaleTarget(next)) {
    next.smaregiSaleStatus = SMAREGI_SALE_STATUS_SKIPPED;
    next.smaregiSaleError = "";
    next.smaregiSaleLines = [];
    next.smaregiSaleRegisteredAt = "";
    return next;
  }
  const saleLines = buildSmaregiSaleLines(next);
  if (!saleLines.length) {
    next.smaregiSaleStatus = SMAREGI_SALE_STATUS_SKIPPED;
    next.smaregiSaleError = "スマレジ売上登録対象の商品明細がありません。";
    next.smaregiSaleLines = [];
    next.smaregiSaleRegisteredAt = "";
    return next;
  }
  const stockLines = buildStockDeductionLines(next);
  next.smaregiSaleStatus = SMAREGI_SALE_STATUS_PENDING;
  next.smaregiSaleError = "";
  next.smaregiSaleLines = saleLines;
  try {
    const totals = calcInvoiceTotals(next);
    console.log("[Sales Smaregi sale request]", {
      invoiceId: next.id,
      invoiceNo: next.invoiceNo,
      originNumber: next.originNumber || next.masterNumber || next.sourceQuoteNo || "",
      transactionType: next.transactionType,
      total: totals.total,
      lines: saleLines
    });
    const response = await fetch("/api/smaregi-sales-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: next.id,
        invoiceNo: next.invoiceNo,
        invoiceDate: next.invoiceDate,
        confirmedAt: next.confirmedAt,
        issuedAt: next.issuedAt,
        updatedAt: next.updatedAt,
        originNumber: next.originNumber || next.masterNumber || next.sourceQuoteNo || "",
        transactionType: next.transactionType,
        customerName: next.customerName || "",
        organizationName: next.organizationName || "",
        total: totals.total,
        tax: totals.tax,
        overallDiscountAmount: totals.overallDiscountAmount || 0,
        overallDiscountReason: next.overallDiscountReason || "",
        smaregiCustomerId: next.smaregiCustomerId || "",
        smaregiCustomerCode: next.smaregiCustomerCode || "",
        idempotencyKey: `${next.id || next.invoiceNo}:smaregi-sale`,
        lines: saleLines
      })
    });
    const data = await readStockApiJson(response);
    let baseStockSync = [];
    try {
      baseStockSync = await syncProductsBaseStock(stockLines);
      next.stockBaseStockSyncStatus = baseStockSync.every(row => row.ok) ? "success" : "failed";
    } catch (syncError) {
      next.stockBaseStockSyncStatus = "failed";
      next.stockBaseStockSyncError = syncError.message || String(syncError);
    }
    next.smaregiSaleStatus = SMAREGI_SALE_STATUS_SUCCESS;
    next.smaregiSaleRegisteredAt = new Date().toISOString();
    next.smaregiSaleError = next.stockBaseStockSyncStatus === "failed" ? `products.base_stock同期失敗: ${next.stockBaseStockSyncError || "一部商品未同期"}` : "";
    next.smaregiTransactionId = data.smaregiTransactionId || "";
    next.smaregiSaleLines = saleLines.map(line => ({ ...line }));
    next.stockBaseStockSyncLines = baseStockSync;
  } catch (error) {
    next.smaregiSaleStatus = SMAREGI_SALE_STATUS_FAILED;
    next.smaregiSaleRegisteredAt = "";
    next.smaregiSaleError = error.message || String(error);
    next.smaregiTransactionId = "";
    next.smaregiSaleLines = saleLines.map(line => ({ ...line }));
  }
  return next;
}

function deliveryNo(n) {
  return "DEL-" + String(n).padStart(6, "0");
}

function nextDeliveryNo(deliveries) {
  const max = deliveries.reduce((num, delivery) => {
    const match = String(delivery.deliveryNo || "").match(/^DEL-(\d+)$/);
    return Math.max(num, match ? Number(match[1]) : 0);
  }, 0);
  return deliveryNo(max + 1);
}

function buildDeliveryFromInvoice(invoice, deliveries) {
  const totals = calcInvoiceTotals(invoice);
  const now = new Date().toISOString();
  const originNumber = invoice.originNumber || invoice.masterNumber || invoice.quoteNumber || invoice.sourceQuoteNo || "";
  const customerView = getInvoiceCustomerView(invoice);
  const newDeliveryNo = nextDeliveryNo(deliveries);
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    deliveryNo: newDeliveryNo,
    deliveryNumber: newDeliveryNo,
    originNumber,
    masterNumber: originNumber,
    quoteNumber: invoice.quoteNumber || invoice.sourceQuoteNo || originNumber,
    invoiceNumber: invoice.invoiceNumber || invoice.invoiceNo || "",
    sourceInvoiceId: invoice.id || "",
    sourceInvoiceNo: invoice.invoiceNo || "",
    customerId: invoice.customerId || "",
    customerCode: invoice.customerCode || "",
    smaregiCustomerId: invoice.smaregiCustomerId || "",
    smaregiCustomerCode: invoice.smaregiCustomerCode || "",
    invoiceDate: invoice.invoiceDate || "",
    issuedAt: invoice.issuedAt || "",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    customerName: customerView.customerName,
    organizationName: customerView.organizationName,
    customerType: customerView.customerType,
    address: customerView.address,
    phone: customerView.phone,
    email: customerView.email,
    subject: invoice.subject || defaultTradeSubject(today()),
    staff: invoice.staff || "",
    transactionType: normalizeTransactionType(invoice.transactionType),
    originalSlipNumber: "",
    reasonMemo: "",
    overallDiscountAmount: Math.max(0, Number(invoice.overallDiscountAmount || 0)),
    overallDiscountReason: invoice.overallDiscountReason || "",
    memo: invoice.slipMemo || invoice.memo || invoice.customerMemo || "",
    slipMemo: invoice.slipMemo || invoice.memo || invoice.customerMemo || "",
    customerMemo: invoice.customerMemo || invoice.slipMemo || invoice.memo || "",
    items: JSON.parse(JSON.stringify(invoice.lines || invoice.items || [])),
    lines: JSON.parse(JSON.stringify(invoice.lines || invoice.items || [])),
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    tax: totals.tax
  };
}

function ensureDeliveryForInvoice(invoice) {
  const deliveries = readDeliveries();
  const existing = deliveries.find(delivery => delivery.sourceInvoiceNo === invoice.invoiceNo);
  if (existing) return existing;
  const delivery = buildDeliveryFromInvoice(invoice, deliveries);
  deliveries.push(delivery);
  writeDeliveries(deliveries);
  return delivery;
}

function markSourceQuoteIssued(invoice) {
  const quotes = readLinkedQuotes();
  if (!quotes.length) return;
  const sourceKeys = [
    invoice.sourceQuoteId,
    invoice.sourceQuoteNo,
    invoice.quoteNumber,
    invoice.originNumber,
    invoice.masterNumber
  ].map(value => String(value || "").trim()).filter(Boolean);
  if (!sourceKeys.length) return;
  let changed = false;
  const updatedQuotes = quotes.map(quote => {
    const quoteKeys = [
      quote.id,
      quote.quoteNo,
      quote.quoteNumber,
      quote.originNumber,
      quote.masterNumber
    ].map(value => String(value || "").trim()).filter(Boolean);
    if (!quoteKeys.some(key => sourceKeys.includes(key))) return quote;
    changed = true;
    return {
      ...quote,
      status: "請求書発行済",
      updatedAt: new Date().toISOString()
    };
  });
  if (changed) writeLinkedQuotes(updatedQuotes);
}

function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

function playSalesNoticeSound(type = "ok") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = type === "err" ? 220 : type === "warn" ? 440 : 660;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.22);
  } catch (_) {}
}

function showSalesPopup(title, body, type = "ok") {
  const popup = document.getElementById("salesPopup");
  const titleEl = document.getElementById("salesPopupTitle");
  const bodyEl = document.getElementById("salesPopupBody");
  const close = document.getElementById("salesPopupClose");
  if (!popup || !titleEl || !bodyEl || !close) {
    alert(`${title}\n${body || ""}`);
    return;
  }
  titleEl.textContent = title || "完了";
  bodyEl.textContent = body || "";
  popup.dataset.type = type;
  popup.style.display = "flex";
  close.onclick = () => {
    popup.style.display = "none";
  };
  playSalesNoticeSound(type);
}

function confirmSalesPopup(title, body, type = "warn") {
  const popup = document.getElementById("salesPopup");
  const titleEl = document.getElementById("salesPopupTitle");
  const bodyEl = document.getElementById("salesPopupBody");
  const okButton = document.getElementById("salesPopupClose");
  if (!popup || !titleEl || !bodyEl || !okButton) {
    return Promise.resolve(confirm(body || title || ""));
  }
  let cancelButton = document.getElementById("salesPopupCancel");
  if (!cancelButton) {
    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.id = "salesPopupCancel";
    cancelButton.className = "secondary";
    okButton.insertAdjacentElement("afterend", cancelButton);
  }
  return new Promise(resolve => {
    titleEl.textContent = title || "確認";
    bodyEl.textContent = body || "";
    popup.dataset.type = type;
    popup.style.display = "flex";
    okButton.textContent = "OK";
    cancelButton.textContent = "キャンセル";
    cancelButton.style.display = "";
    const close = result => {
      popup.style.display = "none";
      cancelButton.style.display = "none";
      okButton.textContent = "OK";
      okButton.onclick = null;
      cancelButton.onclick = null;
      resolve(result);
    };
    okButton.onclick = () => close(true);
    cancelButton.onclick = () => close(false);
    playSalesNoticeSound(type);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  removeUnusedInvoiceFields();
  arrangeInvoiceHeaderRow();
  arrangeInvoiceSubjectDateRow();
  moveInvoiceOverallDiscountToSummary();
  markInvoiceRequiredLabels();
  document.getElementById("invoiceStatus").innerHTML = INVOICE_STATUS_OPTIONS
    .map(status => `<option value="${status}">${status}</option>`)
    .join("");
  document.getElementById("invoiceStatus").disabled = true;
  bindInvoiceTransactionTypeControls();
  bindInvoiceListControls();
  window.SalesArchive?.bindToggle?.(renderInvoiceList);
  renderInvoiceList();
  const id = new URLSearchParams(location.search).get("id");
  if (id) editInvoice(id);
  else clearInvoiceEditor();
});

function bindInvoiceTransactionTypeControls() {
  const transactionType = document.getElementById("transactionType");
  if (!transactionType) return;
  transactionType.addEventListener("change", () => {
    applyInvoiceTransactionTypeToLines();
    renderInvoiceLines();
  });
}

function applyInvoiceTransactionTypeToLines() {
  const transactionType = normalizeTransactionType(getCurrentTransactionType());
  currentInvoiceLines.forEach(line => {
    const wasAuto = Boolean(line.autoTransactionDiscount);
    line.transactionType = transactionType;
    if (isFreeTransaction(transactionType)) {
      if (!wasAuto) {
        line.manualDiscountRateBeforeTransaction = Number(line.discountValue ?? line.discountRate ?? 0);
        line.manualDiscountAmountBeforeTransaction = Number(line.discountAmountInput || 0);
      }
      line.discountValue = 100;
      line.discountRate = 100;
      line.discountAmountInput = 0;
      line.autoTransactionDiscount = true;
    } else if (wasAuto) {
      line.discountValue = Number(line.manualDiscountRateBeforeTransaction || 0);
      line.discountRate = Number(line.manualDiscountRateBeforeTransaction || 0);
      line.discountAmountInput = Number(line.manualDiscountAmountBeforeTransaction || 0);
      line.autoTransactionDiscount = false;
    }
    recalcInvoiceLine(line);
  });
}

function bindInvoiceListControls() {
  const search = document.getElementById("invoiceListSearch");
  const status = document.getElementById("invoiceStatusFilter");
  const dateFrom = document.getElementById("invoiceDateFromFilter");
  const dateTo = document.getElementById("invoiceDateToFilter");
  if (search) {
    search.addEventListener("input", () => {
      invoiceListSearchText = search.value.trim().toLowerCase();
      renderInvoiceList();
    });
  }
  if (status) {
    status.addEventListener("change", () => {
      invoiceListStatusFilter = status.value;
      renderInvoiceList();
    });
  }
  if (dateFrom) {
    dateFrom.addEventListener("input", () => {
      invoiceListDateFrom = dateFrom.value;
      renderInvoiceList();
    });
  }
  if (dateTo) {
    dateTo.addEventListener("input", () => {
      invoiceListDateTo = dateTo.value;
      renderInvoiceList();
    });
  }
  setInvoiceListCollapsed(false);
}

function toggleInvoiceList() {
  setInvoiceListCollapsed(!invoiceListCollapsed);
}

function setInvoiceListCollapsed(collapsed) {
  invoiceListCollapsed = collapsed;
  const listPanel = document.getElementById("invoiceListPanel");
  const panel = document.getElementById("invoiceCompletedListPanel");
  const button = document.getElementById("invoiceListToggle");
  if (listPanel) listPanel.hidden = invoiceListCollapsed;
  if (panel) panel.hidden = invoiceListCollapsed;
  if (button) button.textContent = invoiceListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function renderInvoiceList() {
  const body = document.getElementById("invoiceListBody");
  const completedBody = document.getElementById("invoiceCompletedListBody");
  const allInvoices = readInvoices().filter(invoice => window.SalesArchive?.shouldShow?.(invoice) ?? true).sort(sortNewestFirst);
  const invoices = allInvoices.filter(matchesInvoiceListFilters);
  const completedStatuses = new Set([INVOICE_STATUS_PAID, INVOICE_STATUS_NO_PAYMENT_REQUIRED, INVOICE_STATUS_CANCELLED]);
  const completedInvoices = invoices.filter(invoice => {
    const status = normalizeInvoiceStatus(invoice.status);
    return completedStatuses.has(status);
  });
  const activeInvoices = invoices.filter(invoice => !completedStatuses.has(normalizeInvoiceStatus(invoice.status)));
  console.log("invoice list counts", {
    stored: allInvoices.length,
    filtered: invoices.length,
    active: activeInvoices.length,
    completed: completedInvoices.length,
    statuses: invoices.map(invoice => invoice.status || "").filter(Boolean)
  });
  const count = document.getElementById("invoiceListCount");
  if (count) count.textContent = invoiceListSearchText || invoiceListStatusFilter || invoiceListDateFrom || invoiceListDateTo
    ? `入金待ち ${activeInvoices.length}件 / 全${invoices.length}件`
    : `入金待ち ${activeInvoices.length}件`;
  body.innerHTML = activeInvoices.length ? activeInvoices.map(renderInvoiceListRow).join("") : '<tr><td colspan="9">対応が必要な請求書はありません。</td></tr>';
  if (completedBody) {
    completedBody.innerHTML = completedInvoices.length ? completedInvoices.map(renderInvoiceListRow).join("") : '<tr><td colspan="9">完了済み・キャンセル済みの請求書はありません。</td></tr>';
  }
}

function renderInvoiceListRow(invoice) {
  invoice = normalizeInvoiceForView(invoice);
  const totals = calcInvoiceTotals(invoice);
  const status = normalizeInvoiceStatus(invoice.status);
  const customerView = getInvoiceCustomerView(invoice);
  const archiveButton = window.SalesArchive?.isArchived?.(invoice)
    ? `<button type="button" class="secondary" onclick="archiveInvoice('${invoice.id}', false)">再表示</button>`
    : `<button type="button" class="secondary" onclick="archiveInvoice('${invoice.id}', true)">非表示</button>`;
  return `<tr>
    <td><input type="checkbox" class="invoice-pdf-check pdf-select-checkbox" value="${escapeHtml(invoice.id || "")}"></td>
    <td><span class="number-with-status">${escapeHtml(invoice.invoiceNo)} ${statusBadge(status)}</span></td>
    <td>${escapeHtml(invoice.invoiceDate || "")}</td>
    <td>${escapeHtml(customerView.organizationName)}</td>
    <td>${escapeHtml(customerView.customerName)}</td>
    <td class="${amountClass(totals.total, invoice.transactionType)}">${money(totals.total)}</td>
    <td>${statusBadge(status)}</td>
    <td>${escapeHtml(getSalesStaffDisplayName(invoice.staff || ""))}</td>
    <td>
      <button type="button" class="secondary" onclick="editInvoice('${invoice.id}')">${status === INVOICE_STATUS_DRAFT ? "&#32232;&#38598;" : "&#35443;&#32048;"}</button>
      ${canOutputInvoicePdf(invoice) ? `<button type="button" class="secondary" onclick="printInvoiceById('${invoice.id}')">PDF&#20986;&#21147;</button>` : `<button type="button" class="secondary" disabled title="請求書確定後にPDF出力できます">PDF&#20986;&#21147;</button>`}
      ${canRetryStockDeduction(invoice) ? `<button type="button" class="secondary" onclick="retryInvoiceStockDeduction('${invoice.id}')">売上登録再実行</button>` : ""}
      ${archiveButton}
    </td>
  </tr>`;
}

function printSelectedInvoices() {
  const ids = Array.from(document.querySelectorAll(".invoice-pdf-check:checked")).map(input => input.value);
  const invoices = readInvoices().filter(invoice => ids.includes(String(invoice.id)) && canOutputInvoicePdf(invoice));
  if (!invoices.length) {
    showSalesPopup("PDF出力", "印刷できる請求書を選択してください。", "warn");
    return;
  }
  if (!window.SalesPdfFormat?.printSalesDocuments) {
    showSalesPopup("PDF出力失敗", "PDFフォーマットを読み込めませんでした。", "err");
    return;
  }
  window.SalesPdfFormat.printSalesDocuments(invoices.map(invoice => ({ type: "invoice", data: normalizeInvoiceForView(invoice) })));
}

function matchesInvoiceListFilters(invoice) {
  const status = normalizeInvoiceStatus(invoice.status);
  const customerView = getInvoiceCustomerView(invoice);
  if (invoiceListStatusFilter && status !== invoiceListStatusFilter) return false;
  if (!matchesDateRange([invoice.invoiceDate, invoice.issuedAt, invoice.dueDate], invoiceListDateFrom, invoiceListDateTo)) return false;
  if (!invoiceListSearchText) return true;
  const text = [
    invoice.invoiceNo,
    invoice.sourceQuoteNo,
    customerView.customerName,
    customerView.organizationName,
    invoice.staff,
    getSalesStaffDisplayName(invoice.staff),
    invoice.subject,
    status,
    invoice.status
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(invoiceListSearchText);
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function matchesDateRange(values, from, to) {
  if (!from && !to) return true;
  return values.some(value => {
    const date = normalizeDateOnly(value);
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}

function clearInvoiceEditor() {
  currentInvoiceId = null;
  currentInvoiceLines = [];
  ["invoiceNo", "sourceQuoteNo", "customerName", "invoiceOrganizationName", "customerType", "invoiceStaff", "customerAddress", "customerPhone", "customerEmail", "invoiceSubject", "invoiceMemo", "originalSlipNumber", "reasonMemo", "stockDeductionStatus", "overallDiscountReason"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  setFieldValue("overallDiscountAmount", 0);
  ["salesCustomerId", "salesCustomerCode", "salesSmaregiCustomerId", "salesSmaregiCustomerCode"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("invoiceStatus").value = INVOICE_STATUS_DRAFT;
  setFieldValue("transactionType", "通常販売");
  document.getElementById("issuedAt").value = "";
  document.getElementById("invoiceDate").value = today();
  document.getElementById("dueDate").value = datePlusDays(today(), 14);
  setFieldValue("invoiceSubject", defaultTradeSubject());
  renderInvoiceLines();
  updateInvoiceLockState({ status: INVOICE_STATUS_DRAFT });
}

function fillInvoiceForm(invoice) {
  invoice = persistNormalizedInvoiceIfNeeded(invoice);
  invoice = normalizeInvoiceForView(invoice);
  const customerView = getInvoiceCustomerView(invoice);
  console.log("render invoice customer fields", {
    ...pickInvoiceCustomerFields(invoice),
    resolvedCustomerName: customerView.customerName,
    resolvedOrganizationName: customerView.organizationName,
    resolvedAddress: customerView.address,
    resolvedPhone: customerView.phone,
    resolvedEmail: customerView.email
  });
  currentInvoiceId = invoice.id || null;
  currentInvoiceLines = JSON.parse(JSON.stringify(getInvoiceRawLines(invoice)));
  document.getElementById("invoiceNo").value = invoice.invoiceNo || "";
  document.getElementById("invoiceStatus").value = invoice.issuedAt ? normalizeInvoiceStatus(invoice.status) : INVOICE_STATUS_DRAFT;
  setFieldValue("stockDeductionStatus", smaregiSaleDisplay(invoice));
  setFieldValue("sourceQuoteNo", invoice.sourceQuoteNo || "");
  setFieldValue("salesCustomerId", invoice.customerId || "");
  setFieldValue("salesCustomerCode", invoice.customerCode || "");
  setFieldValue("salesSmaregiCustomerId", invoice.smaregiCustomerId || "");
  setFieldValue("salesSmaregiCustomerCode", invoice.smaregiCustomerCode || "");
  document.getElementById("issuedAt").value = formatDateTime(invoice.issuedAt);
  document.getElementById("customerName").value = customerView.customerName;
  setFieldValue("invoiceOrganizationName", customerView.organizationName);
  document.getElementById("customerType").value = customerView.customerType;
  document.getElementById("invoiceStaff").value = getSalesStaffDisplayName(invoice.staff || "");
  document.getElementById("customerAddress").value = customerView.address;
  document.getElementById("customerPhone").value = customerView.phone;
  document.getElementById("customerEmail").value = customerView.email;
  document.getElementById("invoiceSubject").value = invoice.subject || defaultTradeSubject(invoice.invoiceDate || invoice.createdAt);
  document.getElementById("invoiceDate").value = invoice.invoiceDate || today();
  document.getElementById("dueDate").value = invoice.dueDate || datePlusDays(invoice.invoiceDate || today(), 14);
  setFieldValue("transactionType", normalizeTransactionType(invoice.transactionType));
  setFieldValue("originalSlipNumber", "");
  setFieldValue("reasonMemo", "");
  document.getElementById("invoiceMemo").value = invoice.slipMemo || invoice.memo || "";
  setFieldValue("overallDiscountAmount", invoice.overallDiscountAmount || 0);
  setFieldValue("overallDiscountReason", invoice.overallDiscountReason || "");
  applyInvoiceTransactionTypeToLines();
  renderInvoiceLines();
  updateInvoiceLockState(invoice);
  refreshInvoiceLineStocks().catch(error => {
    console.warn("invoice stock refresh failed", error);
  });
}

function editInvoice(id) {
  const invoice = readInvoices().find(row =>
    row.id === id ||
    row.invoiceNo === id ||
    row.invoiceNumber === id ||
    row.sourceQuoteId === id ||
    row.sourceQuoteNo === id ||
    row.quoteNumber === id
  );
  if (!invoice) {
    showSalesMessage("請求書が見つかりません。", "err");
    return;
  }
  fillInvoiceForm(invoice);
  history.replaceState(null, "", `invoices.html?id=${encodeURIComponent(invoice.id || id)}`);
  scrollToInvoiceEditor();
}

function scrollToInvoiceEditor() {
  const target = document.getElementById("invoiceEditorCard");
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("section-focus-highlight");
  window.setTimeout(() => target.classList.remove("section-focus-highlight"), 1800);
}

function renderInvoiceLines() {
  const area = document.getElementById("invoiceLines");
  const locked = !isCurrentInvoiceEditable();
  const disabled = locked ? "disabled" : "";
  const memoDisabled = "";
  area.innerHTML = currentInvoiceLines.length ? currentInvoiceLines.map((line, index) => {
    recalcInvoiceLine(line);
    return `<div class="invoice-line">
      <label>現在庫<div class="${invoiceStockClass(line)}">${formatInvoiceStock(line)}</div></label>
      <label>商品名<input value="${escapeHtml(line.name || "")}" onchange="updateInvoiceLine(${index}, 'name', this.value)" ${disabled}></label>
      <label>数量<input type="number" min="0" step="1" value="${Number(line.qty || 0)}" onchange="updateInvoiceLine(${index}, 'qty', this.value)" ${disabled}></label>
      <label>単位<input value="${escapeHtml(line.unit || "")}" onchange="updateInvoiceLine(${index}, 'unit', this.value)" ${disabled}></label>
      <label>税込単価<input type="number" min="0" step="1" value="${Number(line.unitPrice || 0)}" onchange="updateInvoiceLine(${index}, 'unitPrice', this.value)" ${disabled}></label>
      <label>値引率%<input type="number" min="0" max="100" step="1" value="${Number(line.discountValue || 0)}" onchange="updateInvoiceLine(${index}, 'discountValue', this.value)" ${disabled}></label>
      <label>値引額<input type="number" min="0" step="1" value="${Number(line.discountAmountInput || 0)}" onchange="updateInvoiceLine(${index}, 'discountAmountInput', this.value)" ${disabled}></label>
      <label>金額<div class="line-amount ${amountClass(line.amount, line.transactionType)}">${money(line.amount)} ${refundBadge(line.transactionType)}</div></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" onchange="updateInvoiceLine(${index}, 'memo', this.value)" ${memoDisabled}></label>
      <button type="button" class="danger" onclick="removeInvoiceLine(${index})" ${disabled}>削除</button>
    </div>`;
  }).join("") : '<div class="message">請求商品がありません。</div>';
  markInvoiceLineRequiredLabels(area);
  recalcTotals();
}

function markInvoiceLineRequiredLabels(area) {
  area.querySelectorAll("label").forEach(label => {
    const control = label.querySelector("input,select");
    const handler = control?.getAttribute("onchange") || "";
    if (handler.includes("'memo'")) return;
    if (control || label.querySelector(".line-amount")) applyRequiredLabel(label);
  });
}

function updateInvoiceLine(index, key, value) {
  const editable = isCurrentInvoiceEditable();
  if (!editable && key !== "memo") {
    showSalesMessage("発行済みの請求書は商品明細を編集できません。", "warn");
    renderInvoiceLines();
    return;
  }
  const line = currentInvoiceLines[index];
  if (!line) return;
  if (key === "discountValue") {
    line[key] = clampNumber(value, 0, 100);
    line.autoTransactionDiscount = false;
  } else if (key === "discountAmountInput") {
    line[key] = Math.max(0, Number(value || 0));
    line.autoTransactionDiscount = false;
  } else if (["qty", "unitPrice"].includes(key)) line[key] = Math.max(0, Number(value || 0));
  else line[key] = value;
  if (key === "discountValue") line.discountRate = clampNumber(value, 0, 100);
  recalcInvoiceLine(line);
  if (!editable && key === "memo") {
    persistInvoiceLineMemos();
    showSalesMessage("商品備考を保存しました。", "ok");
  }
  renderInvoiceLines();
}

function persistInvoiceLineMemos() {
  if (!currentInvoiceId) return;
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === currentInvoiceId);
  if (index < 0) return;
  const existing = invoices[index];
  const lines = getInvoiceRawLines(existing).map((line, lineIndex) => ({
    ...line,
    memo: currentInvoiceLines[lineIndex]?.memo || ""
  }));
  invoices[index] = {
    ...existing,
    lines,
    items: lines,
    updatedAt: new Date().toISOString()
  };
  writeInvoices(invoices);
}

function removeInvoiceLine(index) {
  if (!isCurrentInvoiceEditable()) {
    showSalesMessage("発行済みの請求書は商品明細を編集できません。", "warn");
    return;
  }
  currentInvoiceLines.splice(index, 1);
  renderInvoiceLines();
}

function updateInvoiceLockState(invoice) {
  const editable = isInvoiceEditable(invoice);
  const issueButton = ensureIssueInvoiceButton();
  const saveButton = document.getElementById("saveInvoiceBtn");
  const pdfButton = document.getElementById("invoicePdfBtn");
  const retryStockButton = document.getElementById("retryStockDeductionBtn");
  const cancelButton = document.getElementById("cancelInvoiceBtn");
  const alwaysReadonlyCustomerTargets = [
    "customerName",
    "invoiceOrganizationName",
    "customerType",
    "customerAddress",
    "customerPhone",
    "customerEmail"
  ];
  const lockTargets = [
    "invoiceStaff",
    "invoiceSubject",
    "issuedAt",
    "invoiceDate",
    "dueDate",
    "transactionType",
    "originalSlipNumber",
    "reasonMemo",
    "invoiceMemo",
    "overallDiscountAmount",
    "overallDiscountReason"
  ];
  if (issueButton) {
    const hasInvoice = Boolean(currentInvoiceId || document.getElementById("invoiceNo")?.value);
    const shouldShow = Boolean(hasInvoice && editable);
    issueButton.hidden = !shouldShow;
    issueButton.style.display = shouldShow ? "" : "none";
    issueButton.disabled = !shouldShow;
    issueButton.textContent = "請求書確定";
  }
  if (saveButton) {
    saveButton.hidden = !editable;
    saveButton.disabled = !editable;
  }
  if (pdfButton) {
    const pdfAvailable = canOutputInvoicePdf(invoice);
    pdfButton.hidden = false;
    pdfButton.disabled = !pdfAvailable;
    pdfButton.title = pdfAvailable ? "" : "請求書確定後にPDF出力できます";
  }
  if (retryStockButton) {
    const shouldShowRetry = canRetryStockDeduction(invoice);
    retryStockButton.hidden = !shouldShowRetry;
    retryStockButton.disabled = !shouldShowRetry;
  }
  if (cancelButton) {
    const shouldShowCancel = canCancelInvoice(invoice);
    cancelButton.hidden = !shouldShowCancel;
    cancelButton.style.display = shouldShowCancel ? "" : "none";
    cancelButton.disabled = !shouldShowCancel;
  }
  alwaysReadonlyCustomerTargets.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.readOnly = true;
      element.disabled = false;
      element.classList.add("customer-readonly-input");
    }
  });
  lockTargets.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = !editable;
  });
  document.getElementById("invoiceEditorCard")?.classList.toggle("locked", !editable);
  showSalesMessage(
    editable ? "請求書を編集できます。" : "確定済みのため請求情報・金額・商品明細は編集できません。商品備考、PDF出力、キャンセル処理は可能です。",
    editable ? "" : "warn"
  );
  renderInvoiceLines();
}

function ensureIssueInvoiceButton() {
  let button = document.getElementById("issueInvoiceBtn");
  const saveButton = document.getElementById("saveInvoiceBtn");
  const pdfButton = document.getElementById("invoicePdfBtn");
  const actions = saveButton?.parentElement || pdfButton?.parentElement;
  if (button) {
    if (actions && pdfButton && button.nextElementSibling !== pdfButton) actions.insertBefore(button, pdfButton);
    return button;
  }
  if (!actions) return null;
  button = document.createElement("button");
  button.type = "button";
  button.id = "issueInvoiceBtn";
  button.className = "primary invoice-issue-button";
  button.textContent = "発行確定";
  button.onclick = issueInvoice;
  if (pdfButton) actions.insertBefore(button, pdfButton);
  else if (saveButton) actions.insertBefore(button, saveButton.nextSibling);
  else actions.prepend(button);
  return button;
}

function recalcTotals() {
  currentInvoiceLines.forEach(recalcInvoiceLine);
  const totals = calcInvoiceTotals({
    lines: currentInvoiceLines,
    transactionType: getCurrentTransactionType(),
    overallDiscountAmount: document.getElementById("overallDiscountAmount")?.value || 0
  });
  document.getElementById("subtotalText").textContent = money(totals.subtotal);
  document.getElementById("discountText").textContent = money(totals.discount);
  const totalText = document.getElementById("totalText");
  totalText.textContent = money(totals.total);
  totalText.classList.toggle("amount-negative", totals.total < 0 || isRefundTransaction(getCurrentTransactionType()));
  totalText.classList.toggle("refund-amount", totals.total < 0 || isRefundTransaction(getCurrentTransactionType()));
  document.getElementById("taxText").textContent = money(totals.tax);
}

function collectInvoice() {
  const invoices = readInvoices();
  const existing = currentInvoiceId ? invoices.find(invoice => invoice.id === currentInvoiceId) : null;
  const originNumber = existing?.originNumber || existing?.masterNumber || existing?.quoteNumber || existing?.sourceQuoteNo || "";
  const customerView = getInvoiceCustomerView(existing || {});
  return {
    ...(existing || {}),
    id: currentInvoiceId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    invoiceNo: document.getElementById("invoiceNo").value || existing?.invoiceNo || "",
    invoiceNumber: document.getElementById("invoiceNo").value || existing?.invoiceNumber || existing?.invoiceNo || "",
    originNumber,
    masterNumber: originNumber,
    quoteNumber: existing?.quoteNumber || existing?.sourceQuoteNo || originNumber,
    sourceQuoteId: existing?.sourceQuoteId || "",
    sourceQuoteNo: existing?.sourceQuoteNo || "",
    customerId: document.getElementById("salesCustomerId")?.value || existing?.customerId || "",
    customerCode: document.getElementById("salesCustomerCode")?.value || existing?.customerCode || "",
    smaregiCustomerId: document.getElementById("salesSmaregiCustomerId")?.value || existing?.smaregiCustomerId || "",
    smaregiCustomerCode: document.getElementById("salesSmaregiCustomerCode")?.value || existing?.smaregiCustomerCode || "",
    issuedAt: document.getElementById("issuedAt")?.value || existing?.issuedAt || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: normalizeInvoiceStatus(document.getElementById("invoiceStatus").value),
    customerName: customerView.customerName,
    organizationName: customerView.organizationName,
    customerType: customerView.customerType,
    address: customerView.address,
    phone: customerView.phone,
    email: customerView.email,
    subject: document.getElementById("invoiceSubject").value.trim() || defaultTradeSubject(document.getElementById("invoiceDate").value || new Date()),
    invoiceDate: document.getElementById("invoiceDate").value,
    dueDate: document.getElementById("dueDate").value,
    staff: storageSalesStaffName(document.getElementById("invoiceStaff").value.trim()),
    transactionType: normalizeTransactionType(document.getElementById("transactionType")?.value || existing?.transactionType),
    originalSlipNumber: "",
    reasonMemo: "",
    memo: document.getElementById("invoiceMemo").value,
    slipMemo: document.getElementById("invoiceMemo").value,
    customerMemo: existing?.customerMemo || document.getElementById("invoiceMemo").value,
    overallDiscountAmount: Math.max(0, Number(document.getElementById("overallDiscountAmount")?.value || 0)),
    overallDiscountReason: document.getElementById("overallDiscountReason")?.value?.trim() || "",
    items: currentInvoiceLines.map(line => recalcInvoiceLine({ ...line, transactionType: normalizeTransactionType(document.getElementById("transactionType")?.value) })),
    lines: currentInvoiceLines.map(line => recalcInvoiceLine({ ...line, transactionType: normalizeTransactionType(document.getElementById("transactionType")?.value) }))
  };
}

function saveInvoice() {
  if (!document.getElementById("customerName").value.trim()) {
    showSalesMessage("顧客名を入力してください。", "err");
    return;
  }
  if (!currentInvoiceLines.length) {
    showSalesMessage("請求商品がありません。", "err");
    return;
  }
  const invoice = collectInvoice();
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === invoice.id);
  if (index >= 0) invoices[index] = invoice;
  else invoices.push(invoice);
  writeInvoices(invoices);
  currentInvoiceId = invoice.id;
  renderInvoiceList();
  updateInvoiceLockState(invoice);
  showSalesPopup("保存完了", `請求書を保存しました\n${invoice.invoiceNo}`, "ok");
}

async function issueInvoice() {
  if (!currentInvoiceId) {
    showSalesMessage("先に請求書を保存してください。", "err");
    return;
  }
  const confirmed = await confirmSalesPopup("請求書確定", "この請求書を確定しますか？", "warn");
  if (!confirmed) return;
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === currentInvoiceId);
  if (index < 0) {
    showSalesMessage("請求書が見つかりません。", "err");
    return;
  }
  let invoice = collectInvoice();
  if (!isInvoiceEditable(invoice.status)) {
    showSalesMessage("この請求書は発行確定済みです。", "warn");
    return;
  }
  const totals = calcInvoiceTotals(invoice);
  const confirmedAt = new Date().toISOString();
  invoice.status = totals.total <= 0 ? "no_payment_required" : "waiting_payment";
  invoice.issuedAt = confirmedAt;
  invoice.confirmedAt = confirmedAt;
  invoice.invoiceConfirmedAt = confirmedAt;
  invoice.updatedAt = confirmedAt;
  invoice = await applyInvoiceStockDeduction(invoice);
  ensureDeliveryForInvoice(invoice);
  markSourceQuoteIssued(invoice);
  invoices[index] = invoice;
  writeInvoices(invoices);
  currentInvoiceId = invoice.id;
  const refreshedInvoice = readInvoices().find(row => row.id === invoice.id) || invoice;
  fillInvoiceForm(refreshedInvoice);
  renderInvoiceList();
  updateInvoiceLockState(refreshedInvoice);
  const statusLabel = normalizeInvoiceStatus(invoice.status);
  const saleMessage = smaregiSaleDisplay(invoice);
  showSalesMessage(`請求書を確定しました。ステータスを${statusLabel}に更新しました。スマレジ売上登録: ${saleMessage}`, invoice.smaregiSaleStatus === SMAREGI_SALE_STATUS_FAILED ? "warn" : "ok");
  showSalesPopup("請求書確定", `請求書を確定しました\nスマレジ売上登録: ${saleMessage}${invoice.smaregiSaleError ? `\n${invoice.smaregiSaleError}` : ""}`, invoice.smaregiSaleStatus === SMAREGI_SALE_STATUS_FAILED ? "warn" : "ok");
}

async function retryInvoiceStockDeduction(id) {
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === id);
  if (index < 0) {
    showSalesMessage("請求書が見つかりません。", "err");
    return;
  }
  const original = normalizeInvoiceForView(invoices[index]);
  if (!canRetryStockDeduction(original)) {
    showSalesMessage("スマレジ売上登録の再実行対象ではありません。", "warn");
    return;
  }
  showSalesMessage("スマレジ売上登録を再実行しています。", "warn");
  let updated = null;
  if (
    normalizeSmaregiSaleStatus(original.smaregiSaleStatus) === SMAREGI_SALE_STATUS_SUCCESS &&
    original.stockBaseStockSyncStatus === "failed"
  ) {
    updated = { ...original };
    try {
      const lines = Array.isArray(updated.smaregiSaleLines) && updated.smaregiSaleLines.length
        ? updated.smaregiSaleLines
        : buildStockDeductionLines(updated);
      const baseStockSync = await syncProductsBaseStock(lines);
      updated.stockBaseStockSyncStatus = baseStockSync.every(row => row.ok) ? "success" : "failed";
      updated.stockBaseStockSyncError = updated.stockBaseStockSyncStatus === "failed" ? "一部商品のproducts.base_stock同期に失敗しました。" : "";
      updated.smaregiSaleError = updated.stockBaseStockSyncStatus === "failed" ? updated.stockBaseStockSyncError : "";
      updated.stockBaseStockSyncLines = baseStockSync;
    } catch (error) {
      updated.stockBaseStockSyncStatus = "failed";
      updated.stockBaseStockSyncError = error.message || String(error);
      updated.smaregiSaleError = `products.base_stock同期失敗: ${updated.stockBaseStockSyncError}`;
    }
  } else {
    updated = await applyInvoiceStockDeduction(original);
  }
  updated.updatedAt = new Date().toISOString();
  invoices[index] = updated;
  writeInvoices(invoices);
  if (currentInvoiceId === updated.id) fillInvoiceForm(updated);
  renderInvoiceList();
  const type = updated.smaregiSaleStatus === SMAREGI_SALE_STATUS_SUCCESS ? "ok" : "warn";
  showSalesMessage(`スマレジ売上登録再実行: ${smaregiSaleDisplay(updated)}`, type);
  showSalesPopup("スマレジ売上登録再実行", `${smaregiSaleDisplay(updated)}${updated.smaregiSaleError ? `\n${updated.smaregiSaleError}` : ""}`, type);
}

function retryCurrentInvoiceStockDeduction() {
  if (!currentInvoiceId) {
    showSalesMessage("請求書を選択してください。", "warn");
    return;
  }
  retryInvoiceStockDeduction(currentInvoiceId);
}

async function cancelInvoice() {
  if (!currentInvoiceId) return;
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === currentInvoiceId);
  if (index < 0) {
    showSalesMessage("請求書が見つかりません。", "err");
    return;
  }
  const invoice = normalizeInvoiceForView(invoices[index]);
  if (!canCancelInvoice(invoice)) {
    showSalesPopup("キャンセルできません", "入金済み、納品書発行済み、発送済み、領収書発行済み、キャンセル済みの請求書はこの画面からキャンセルできません。", "warn");
    updateInvoiceLockState(invoice);
    return;
  }
  const confirmed = await confirmSalesPopup("請求書キャンセル", "この請求書をキャンセルしますか？", "warn");
  if (!confirmed) return;
  const reason = window.prompt("キャンセル理由を入力してください。\n例：注文キャンセル / 誤発行 / 商品変更 / 数量変更 / 返金対応 / その他", "") || "";
  try {
    const updated = await applyInvoiceCancel(invoice, reason);
    invoices[index] = updated;
    writeInvoices(invoices);
    fillInvoiceForm(updated);
    renderInvoiceList();
    if (updated.cancelStatus !== "success") {
      showSalesPopup("請求書キャンセル失敗", updated.cancelError || "キャンセル処理を完了できませんでした。", "warn");
      return;
    }
    const restoreMessage = updated.stockRestoreStatus === "failed"
      ? "\nproducts.base_stock復帰に失敗しました。詳細を確認してください。"
      : "";
    showSalesPopup("請求書キャンセル", `請求書をキャンセルしました${restoreMessage}`, updated.stockRestoreStatus === "failed" ? "warn" : "ok");
  } catch (error) {
    const message = error?.message || String(error);
    showSalesPopup("請求書キャンセル失敗", message, "err");
  }
}

function outputCurrentInvoicePdf() {
  const invoice = currentInvoiceId ? readInvoices().find(row => row.id === currentInvoiceId) : null;
  if (!canOutputInvoicePdf(invoice)) {
    showSalesPopup("PDF出力", "請求書確定後にPDF出力できます", "warn");
    return;
  }
  try {
    printInvoicePdf(normalizeInvoiceForView(invoice));
  } finally {
    restoreInvoiceEditorAfterPdf();
  }
}

function printInvoiceById(id) {
  const invoice = readInvoices().find(row => row.id === id);
  if (!invoice) return;
  if (!canOutputInvoicePdf(invoice)) {
    showSalesPopup("PDF出力", "請求書確定後にPDF出力できます", "warn");
    return;
  }
  printInvoicePdf(normalizeInvoiceForView(invoice));
}

function archiveInvoice(id, archived = true) {
  const invoices = readInvoices();
  const invoice = invoices.find(row => row.id === id);
  if (!invoice) return;
  window.SalesArchive?.markArchived?.(invoice, archived);
  writeInvoices(invoices);
  renderInvoiceList();
  showSalesPopup(archived ? "????????" : "???????", "??????????????????????????", "ok");
}

function restoreInvoiceEditorAfterPdf() {
  window.setTimeout(() => {
    const invoice = currentInvoiceId ? readInvoices().find(row => row.id === currentInvoiceId) : { status: INVOICE_STATUS_DRAFT };
    updateInvoiceLockState(invoice || { status: INVOICE_STATUS_DRAFT });
    window.focus();
  }, 300);
}
