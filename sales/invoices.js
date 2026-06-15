const INVOICES_KEY = "arico_sales_invoices_v1";
const DELIVERIES_KEY = "arico_sales_deliveries_v1";
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
