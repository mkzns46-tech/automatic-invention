const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
const QUOTES_KEY = "arico_sales_quotes_v1";
const INVOICES_KEY = "arico_sales_invoices_v1";
const PRODUCT_UNITS_KEY = "arico_sales_product_units_v1";
const UNIT_OPTIONS = ["個", "本", "袋", "箱", "セット", "台", "式", "ダース", "枚", "組"];
const DEALER_BRANDS = ["FIVICS", "MK", "JET6", "WJ", "ARICO"];
const QUOTE_STATUS_DRAFT = "下書き";
const QUOTE_STATUS_INVOICED = "請求書変換済み";
const QUOTE_STATUS_INVOICE_ISSUED = "請求書発行済";
const QUOTE_STATUS_CANCELLED = "キャンセル";

let currentQuoteId = null;
let currentLines = [];
let productSearchTimer = null;
let quoteListSearchText = "";
let quoteListStatusFilter = "";
let quoteListDateFrom = "";
let quoteListDateTo = "";
let quoteListCollapsed = false;
let currentQuoteLocked = false;

function salesFetch(path) {
  return fetch(`${ARICO_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: ARICO_SUPABASE_API_KEY,
      Authorization: `Bearer ${ARICO_SUPABASE_API_KEY}`
    }
  }).then(async res => {
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  });
}

function readQuotes() {
  return JSON.parse(localStorage.getItem(QUOTES_KEY) || "[]");
}

function writeQuotes(quotes) {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
}

function readUnits() {
  return JSON.parse(localStorage.getItem(PRODUCT_UNITS_KEY) || "{}");
}

function writeUnits(units) {
  localStorage.setItem(PRODUCT_UNITS_KEY, JSON.stringify(units));
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
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

function quoteNo(n) {
  return "Q-" + String(n).padStart(6, "0");
}

function nextQuoteNo(quotes) {
  const max = quotes.reduce((num, quote) => {
    const match = String(quote.quoteNo || "").match(/^Q-(\d+)$/);
    return Math.max(num, match ? Number(match[1]) : 0);
  }, 0);
  return quoteNo(max + 1);
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
  return extractSlipNumber(b.quoteNo || b.quoteNumber || b.originNumber) - extractSlipNumber(a.quoteNo || a.quoteNumber || a.originNumber);
}

function readInvoices() {
  return JSON.parse(localStorage.getItem(INVOICES_KEY) || "[]");
}

function writeInvoices(invoices) {
  localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
}

function invoiceNo(n) {
  return "INV-" + String(n).padStart(6, "0");
}

function nextInvoiceNo(invoices) {
  const max = invoices.reduce((num, invoice) => {
    const match = String(invoice.invoiceNo || "").match(/^INV-(\d+)$/);
    return Math.max(num, match ? Number(match[1]) : 0);
  }, 0);
  return invoiceNo(max + 1);
}

function normalizeInvoiceStatusForQuote(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "下書き") return "draft";
  if (value === "issued" || value === "発行済み") return "issued";
  if (value === "waiting_payment" || value === "payment_waiting" || value === "入金待ち") return "waiting_payment";
  if (value === "paid" || value === "入金済み") return "paid";
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return "canceled";
  return value;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString("ja-JP") + "円";
}

function amountClass(value, transactionType = "") {
  return Number(value || 0) < 0 || isRefundTransaction(transactionType) ? "amount-negative refund-amount" : "";
}

function refundBadge(transactionType) {
  return isRefundTransaction(transactionType) ? '<span class="status-badge danger">返金</span>' : "";
}

function clampNumber(value, min, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
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

function removeUnusedQuoteFields() {
  ["originalSlipNumber", "reasonMemo"].forEach(id => {
    const input = document.getElementById(id);
    const label = input?.closest("label");
    if (label) label.remove();
  });
}

function arrangeQuoteSubjectBlock() {
  const subjectLabel = document.getElementById("quoteSubject")?.closest("label");
  const dateLabel = document.getElementById("quoteDate")?.closest("label");
  const validLabel = document.getElementById("validUntil")?.closest("label");
  const staffLabel = document.getElementById("quoteStaff")?.closest("label");
  const transactionLabel = document.getElementById("transactionType")?.closest("label");
  const discountLabel = document.getElementById("discountTemplate")?.closest("label");
  if (!subjectLabel || !dateLabel || !validLabel || !staffLabel || !transactionLabel || !discountLabel) return;

  const sourceRow = subjectLabel.parentElement;
  let firstRow = document.getElementById("quoteSubjectDateRow");
  if (!firstRow) {
    firstRow = document.createElement("div");
    firstRow.id = "quoteSubjectDateRow";
    firstRow.className = "row three subject-date-row";
    sourceRow.insertAdjacentElement("afterend", firstRow);
  }
  firstRow.appendChild(subjectLabel);
  firstRow.appendChild(dateLabel);
  firstRow.appendChild(validLabel);

  let secondRow = document.getElementById("quoteStaffTransactionRow");
  if (!secondRow) {
    secondRow = document.createElement("div");
    secondRow.id = "quoteStaffTransactionRow";
    secondRow.className = "row three staff-transaction-row";
    firstRow.insertAdjacentElement("afterend", secondRow);
  }
  secondRow.appendChild(staffLabel);
  secondRow.appendChild(transactionLabel);
  secondRow.appendChild(discountLabel);
}

function moveQuoteOverallDiscountToSummary() {
  const label = document.getElementById("overallDiscountAmount")?.closest("label");
  const discountBox = document.getElementById("discountText")?.closest("div");
  if (!label || !discountBox || label.closest(".summary")) return;
  label.classList.add("summary-input-box");
  discountBox.insertAdjacentElement("afterend", label);
}

function markQuoteRequiredLabels() {
  const requiredIds = [
    "customerName",
    "quoteOrganizationName",
    "customerType",
    "customerAddress",
    "customerPhone",
    "customerEmail",
    "quoteSubject",
    "quoteDate",
    "validUntil",
    "quoteStaff",
    "transactionType",
    "discountTemplate"
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

function recalcSalesLine(line) {
  const transactionType = normalizeTransactionType(line?.transactionType || getCurrentTransactionType());
  const qty = Number(line?.qty || 0);
  const unitPrice = Number(line?.unitPrice || 0);
  const gross = Math.max(0, Math.round(Math.abs(qty) * Math.abs(unitPrice)));
  const discountRate = isFreeTransaction(transactionType)
    ? 100
    : clampNumber(line?.discountValue ?? line?.discountRate ?? line?.discount ?? 0, 0, 100);
  const fixedDiscount = Math.max(0, Number(line?.discountAmountInput || line?.fixedDiscountAmount || line?.manualDiscountAmount || 0));
  const rateDiscount = Math.round(gross * discountRate / 100);
  line.transactionType = transactionType;
  line.discountRate = discountRate;
  line.discountValue = discountRate;
  const appliedFixedDiscount = isFreeTransaction(transactionType) ? 0 : fixedDiscount;
  line.discountAmountInput = appliedFixedDiscount;
  line.discountAmount = Math.min(gross, appliedFixedDiscount > 0 ? appliedFixedDiscount : rateDiscount);
  const netAmount = Math.max(0, gross - line.discountAmount);
  line.amount = isRefundTransaction(transactionType) ? -netAmount : netAmount;
  return line;
}

function calcQuoteTotals(quote) {
  const lines = Array.isArray(quote?.lines) ? quote.lines : Array.isArray(quote?.items) ? quote.items : [];
  let subtotal = 0;
  let discount = 0;
  let total = 0;
  lines.forEach(line => {
    recalcSalesLine(line);
    const gross = Math.max(0, Math.round(Math.abs(Number(line.qty || 0)) * Math.abs(Number(line.unitPrice || 0))));
    subtotal += gross;
    discount += Number(line.discountAmount || 0);
    total += Number(line.amount || 0);
  });
  const overallDiscountAmount = Math.max(0, Number(quote?.overallDiscountAmount || 0));
  const appliedOverallDiscount = isRefundTransaction(quote?.transactionType)
    ? overallDiscountAmount
    : Math.min(Math.max(0, total), overallDiscountAmount);
  discount += appliedOverallDiscount;
  total = isRefundTransaction(quote?.transactionType)
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

function normalizeQuoteStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "下書き") return QUOTE_STATUS_DRAFT;
  if (value === "converted" || value === "invoiced" || value === "invoice_created" || value === "請求書変換済み") return QUOTE_STATUS_INVOICED;
  if (value === "invoice_issued" || value === "issued_invoice" || value === "請求書発行済") return QUOTE_STATUS_INVOICE_ISSUED;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return QUOTE_STATUS_CANCELLED;
  return status || QUOTE_STATUS_DRAFT;
}

function quoteStatusBadge(status) {
  const value = normalizeQuoteStatus(status);
  const type = value === QUOTE_STATUS_CANCELLED ? "danger" : value === QUOTE_STATUS_INVOICE_ISSUED ? "ok" : value === QUOTE_STATUS_INVOICED ? "info" : "muted";
  return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
}

function isQuoteEditable(quoteOrStatus) {
  return normalizeQuoteStatus(typeof quoteOrStatus === "string" ? quoteOrStatus : quoteOrStatus?.status) !== QUOTE_STATUS_INVOICE_ISSUED;
}

function canDeleteQuote(quoteOrStatus) {
  const status = normalizeQuoteStatus(typeof quoteOrStatus === "string" ? quoteOrStatus : quoteOrStatus?.status);
  return status === QUOTE_STATUS_DRAFT || status === QUOTE_STATUS_CANCELLED;
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

function getProductPriceInfo(product) {
  if (!product || product.price === null || product.price === undefined) {
    return { hasPrice: false, value: 0 };
  }
  const value = Number(product.price);
  return Number.isFinite(value) ? { hasPrice: true, value } : { hasPrice: false, value: 0 };
}

function formatStock(stock) {
  if (stock === "manual") return "手入力";
  const value = Number(stock || 0);
  return value > 0 ? `現在庫 ${value}` : "取寄せ";
}

function stockClass(stock) {
  if (stock === "manual") return "line-stock muted";
  return Number(stock || 0) > 0 ? "" : "line-stock warn";
}

function sanitizeProductRow(row = {}) {
  return {
    barcode: String(row.barcode || ""),
    name: String(row.name || ""),
    base_stock: Number(row.base_stock || 0),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    smaregi_product_id: row.smaregi_product_id || null
  };
}

async function fetchProductByBarcode(barcode) {
  const value = String(barcode || "").trim();
  if (!value) return null;
  const rows = await salesFetch(`products?select=barcode,name,base_stock,price,smaregi_product_id&barcode=eq.${encodeURIComponent(value)}&limit=1`);
  return rows[0] ? sanitizeProductRow(rows[0]) : null;
}

async function refreshQuoteLineStocks() {
  const uniqueBarcodes = [...new Set(currentLines.map(line => String(line.barcode || "").trim()).filter(Boolean))];
  for (const barcode of uniqueBarcodes) {
    const latest = await fetchProductByBarcode(barcode).catch(() => null);
    if (!latest) continue;
    currentLines.forEach(line => {
      if (String(line.barcode) !== barcode) return;
      line.stock = latest.base_stock;
      if (line.name === "" && latest.name) line.name = latest.name;
    });
  }
  renderLines();
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!requireSalesAuth()) return;
  removeUnusedQuoteFields();
  arrangeQuoteSubjectBlock();
  moveQuoteOverallDiscountToSummary();
  markQuoteRequiredLabels();
  document.getElementById("customerType").innerHTML = ARICO_CUSTOMER_TYPES.map(type => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("quoteDate").value = today();
  document.getElementById("validUntil").value = datePlusDays(today(), 14);
  bindProductAutoSearch();
  bindQuoteCustomerSearch();
  bindQuoteListControls();
  bindTransactionTypeControls();
  await loadStaffOptions();
  renderQuoteList();
  newQuote();
});

function bindQuoteListControls() {
  const search = document.getElementById("quoteListSearch");
  const status = document.getElementById("quoteStatusFilter");
  const dateFrom = document.getElementById("quoteDateFromFilter");
  const dateTo = document.getElementById("quoteDateToFilter");
  if (search) {
    search.addEventListener("input", () => {
      quoteListSearchText = search.value.trim().toLowerCase();
      renderQuoteList();
    });
  }
  if (status) {
    status.addEventListener("change", () => {
      quoteListStatusFilter = status.value;
      renderQuoteList();
    });
  }
  if (dateFrom) {
    dateFrom.addEventListener("input", () => {
      quoteListDateFrom = dateFrom.value;
      renderQuoteList();
    });
  }
  if (dateTo) {
    dateTo.addEventListener("input", () => {
      quoteListDateTo = dateTo.value;
      renderQuoteList();
    });
  }
  setQuoteListCollapsed(false);
}

function toggleQuoteList() {
  setQuoteListCollapsed(!quoteListCollapsed);
}

function setQuoteListCollapsed(collapsed) {
  quoteListCollapsed = collapsed;
  const listPanel = document.getElementById("quoteListPanel");
  const panel = document.getElementById("quoteCompletedListPanel");
  const button = document.getElementById("quoteListToggle");
  if (listPanel) listPanel.hidden = quoteListCollapsed;
  if (panel) panel.hidden = quoteListCollapsed;
  if (button) button.textContent = quoteListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function bindTransactionTypeControls() {
  const transactionType = document.getElementById("transactionType");
  if (!transactionType) return;
  transactionType.addEventListener("change", () => {
    applyTransactionTypeToLines();
    renderLines();
  });
}

function applyTransactionTypeToLines() {
  const transactionType = normalizeTransactionType(getCurrentTransactionType());
  currentLines.forEach(line => {
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
    recalcSalesLine(line);
  });
}

function bindProductAutoSearch() {
  const input = document.getElementById("productSearchInput");
  if (!input) return;
  input.addEventListener("input", () => {
    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(searchProducts, 250);
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(productSearchTimer);
    searchProducts();
  });
}

function bindQuoteCustomerSearch() {
  const input = document.getElementById("quoteCustomerSearchInput");
  if (!input) return;
  input.addEventListener("input", () => renderQuoteCustomerSearchResults(input.value));
}

function renderQuoteCustomerSearchResults(query) {
  const results = document.getElementById("quoteCustomerSearchResults");
  if (!results) return;
  const text = String(query || "").trim();
  if (!text) {
    results.innerHTML = "";
    return;
  }
  const customers = window.SalesCustomerStorage?.searchCustomers
    ? window.SalesCustomerStorage.searchCustomers(text, 20)
    : [];
  results.innerHTML = customers.length ? `<div class="table-wrap"><table><thead><tr><th>顧客名</th><th>顧客区分</th><th>電話番号</th><th>メールアドレス</th><th>スマレジ会員コード</th><th>操作</th></tr></thead><tbody>${customers.map(customer => `<tr>
    <td>${escapeHtml(customer.customerName)}</td>
    <td>${escapeHtml(customer.customerType)}</td>
    <td>${escapeHtml(customer.phone)}</td>
    <td>${escapeHtml(customer.email)}</td>
    <td>${escapeHtml(customer.smaregiMemberCode)}</td>
    <td><button type="button" class="secondary" onclick="selectQuoteCustomer('${escapeHtml(customer.id)}')">選択</button></td>
  </tr>`).join("")}</tbody></table></div>` : `<div class="message warn">該当顧客が見つかりません</div><button type="button" class="secondary" onclick="openQuoteNewCustomerModal('${escapeHtml(text)}')">新規顧客登録</button>`;
}

function selectQuoteCustomer(customerId) {
  const customer = window.SalesCustomerStorage?.readCustomers().find(row => row.id === customerId);
  if (!customer) return;
  applyCustomerToQuote(customer);
  setFieldValue("quoteCustomerSearchInput", "");
  const results = document.getElementById("quoteCustomerSearchResults");
  if (results) results.innerHTML = "";
  showSalesPopup("完了", "顧客情報を反映しました", "ok");
}

function applyCustomerToQuote(customer) {
  setFieldValue("salesCustomerId", customer.id);
  setFieldValue("salesCustomerCode", customer.customerCode);
  setFieldValue("salesSmaregiCustomerId", customer.smaregiMemberId);
  setFieldValue("salesSmaregiCustomerCode", customer.smaregiMemberCode);
  setFieldValue("customerName", customer.customerName || customer.name);
  setFieldValue("quoteOrganizationName", customer.organizationName);
  setFieldValue("customerType", customer.customerType || "個人");
  setFieldValue("customerAddress", customer.address);
  setFieldValue("customerPhone", customer.phone);
  setFieldValue("customerEmail", customer.email);
  const orgInput = document.getElementById("quoteOrganizationName");
  if (orgInput) orgInput.value = customer.organizationName || "";
  const memo = document.getElementById("quoteMemo");
  if (memo && customer.memo && !memo.value) memo.value = customer.memo;
}

function openQuoteNewCustomerModal(seedName = "") {
  const modal = document.getElementById("quoteCustomerCreateModal");
  if (!modal) {
    location.href = "customers.html";
    return;
  }
  const typeSelect = document.getElementById("quoteNewCustomerType");
  if (typeSelect && !typeSelect.options.length) {
    typeSelect.innerHTML = ARICO_CUSTOMER_TYPES.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  }
  setFieldValue("quoteNewCustomerName", seedName);
  setFieldValue("quoteNewCustomerStaff", "");
  setFieldValue("quoteNewCustomerPostalCode", "");
  setFieldValue("quoteNewCustomerAddress", "");
  setFieldValue("quoteNewCustomerPhone", "");
  setFieldValue("quoteNewCustomerEmail", "");
  setFieldValue("quoteNewCustomerMemo", "");
  if (typeSelect) typeSelect.value = ARICO_CUSTOMER_TYPES[0] || "";
  modal.style.display = "flex";
}

function closeQuoteNewCustomerModal() {
  const modal = document.getElementById("quoteCustomerCreateModal");
  if (modal) modal.style.display = "none";
}

function saveQuoteNewCustomer() {
  try {
    const customer = window.SalesCustomerStorage.createManualCustomer({
      customerName: document.getElementById("quoteNewCustomerName")?.value,
      customerType: document.getElementById("quoteNewCustomerType")?.value,
      staff: document.getElementById("quoteNewCustomerStaff")?.value,
      postalCode: document.getElementById("quoteNewCustomerPostalCode")?.value,
      address: document.getElementById("quoteNewCustomerAddress")?.value,
      phone: document.getElementById("quoteNewCustomerPhone")?.value,
      email: document.getElementById("quoteNewCustomerEmail")?.value,
      memo: document.getElementById("quoteNewCustomerMemo")?.value
    });
    closeQuoteNewCustomerModal();
    applyCustomerToQuote(customer);
    setFieldValue("quoteCustomerSearchInput", "");
    const results = document.getElementById("quoteCustomerSearchResults");
    if (results) results.innerHTML = "";
    showSalesPopup("顧客登録", "顧客情報を反映しました", "ok");
  } catch (error) {
    showSalesPopup("保存できません", error?.message || String(error), "warn");
  }
}

function setFieldValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

async function loadStaffOptions() {
  const select = document.getElementById("quoteStaff");
  try {
    const staff = await (window.SalesStaffDisplay?.loadStaffDisplays?.() || salesFetch("staff_members?select=name,store_name&order=name.asc"));
    select.innerHTML = '<option value="">??????</option>' + staff.map(row => {
      const value = window.SalesStaffDisplay?.staffOptionValue?.(row) || (row.store_name ? `${row.name} (${row.store_name})` : row.name);
      const label = window.SalesStaffDisplay?.staffOptionLabel?.(row) || value;
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join("");
  } catch (_) {
    select.innerHTML = '<option value="">??????</option>';
  }
}

function renderQuoteList() {
  const body = document.getElementById("quoteListBody");
  const completedBody = document.getElementById("quoteCompletedListBody");
  const allQuotes = readQuotes().sort(sortNewestFirst);
  const quotes = allQuotes.filter(matchesQuoteListFilters);
  const activeQuotes = quotes.filter(quote => normalizeQuoteStatus(quote.status) === QUOTE_STATUS_DRAFT);
  const completedQuotes = quotes.filter(quote => normalizeQuoteStatus(quote.status) !== QUOTE_STATUS_DRAFT);
  const count = document.getElementById("quoteListCount");
  if (count) count.textContent = quoteListSearchText || quoteListStatusFilter || quoteListDateFrom || quoteListDateTo
    ? `下書き ${activeQuotes.length}件 / 全${quotes.length}件`
    : `下書き ${activeQuotes.length}件`;
  body.innerHTML = activeQuotes.length ? activeQuotes.map(renderQuoteListRow).join("") : '<tr><td colspan="9">対応が必要な見積書はありません。</td></tr>';
  if (completedBody) {
    completedBody.innerHTML = completedQuotes.length ? completedQuotes.map(renderQuoteListRow).join("") : '<tr><td colspan="9">完了済み・キャンセル済みの見積書はありません。</td></tr>';
  }
}

function renderQuoteListRow(q) {
  const status = normalizeQuoteStatus(q.status);
  const deleteButton = canDeleteQuote(q)
    ? `<button type="button" class="danger" onclick="deleteQuote('${q.id}')">&#21066;&#38500;</button>`
    : "";
  const convertButton = status === QUOTE_STATUS_DRAFT || status === QUOTE_STATUS_INVOICED
    ? `<button type="button" class="secondary next-step-button" onclick="convertQuoteToInvoice('${q.id}')">&#35531;&#27714;&#26360;&#12408;&#22793;&#25563;</button>`
    : "";
  return `<tr data-quote-id="${escapeHtml(q.id || "")}">
    <td><input type="checkbox" class="quote-pdf-check pdf-select-checkbox" value="${escapeHtml(q.id || "")}"></td>
    <td><span class="number-with-status">${escapeHtml(q.quoteNo)} ${quoteStatusBadge(q.status)}</span></td>
    <td>${escapeHtml(normalizeDateOnly(q.createdAt) || q.quoteDate || "")}</td>
    <td>${escapeHtml(q.organizationName || q.organization || q.companyName || "")}</td>
    <td>${escapeHtml(q.customerName || q.name || q.customer || "")}</td>
    <td class="${amountClass(calcQuoteTotals(q).total, q.transactionType)}">${money(calcQuoteTotals(q).total)}</td>
    <td>${quoteStatusBadge(q.status)}</td>
    <td>${escapeHtml(getSalesStaffDisplayName(q.staff || ""))}</td>
    <td>
      <button type="button" class="secondary" onclick="editQuote('${q.id}')">${status === QUOTE_STATUS_INVOICE_ISSUED ? "詳細" : "&#32232;&#38598;"}</button>
      <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">PDF&#20986;&#21147;</button>
      <button type="button" class="secondary" onclick="duplicateQuote('${q.id}')">&#35079;&#35069;</button>
      ${convertButton}
      ${deleteButton}
    </td>
  </tr>`;
}

function printSelectedQuotes() {
  const ids = Array.from(document.querySelectorAll(".quote-pdf-check:checked")).map(input => input.value);
  const quotes = readQuotes().filter(quote => ids.includes(String(quote.id)));
  if (!quotes.length) {
    showSalesPopup("PDF出力", "印刷する見積書を選択してください。", "warn");
    return;
  }
  if (!window.SalesPdfFormat?.printSalesDocuments) {
    showSalesPopup("PDF出力失敗", "PDFフォーマットを読み込めませんでした。", "err");
    return;
  }
  window.SalesPdfFormat.printSalesDocuments(quotes.map(quote => ({ type: "quote", data: quote })));
}

function scrollToSavedQuote(quoteId) {
  if (!quoteId) return;
  setQuoteListCollapsed(false);
  window.requestAnimationFrame(() => {
    const escapedId = window.CSS?.escape ? CSS.escape(String(quoteId)) : String(quoteId);
    const row = document.querySelector(`[data-quote-id="${escapedId}"]`);
    const target = row || document.getElementById("quoteListPanel");
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (row) {
      row.classList.add("saved-row-highlight");
      setTimeout(() => row.classList.remove("saved-row-highlight"), 2400);
    }
  });
}

function matchesQuoteListFilters(quote) {
  const status = normalizeQuoteStatus(quote.status);
  if (quoteListStatusFilter && status !== quoteListStatusFilter) return false;
  if (!matchesDateRange([quote.createdAt, quote.quoteDate, quote.validUntil], quoteListDateFrom, quoteListDateTo)) return false;
  if (!quoteListSearchText) return true;
  const text = [
    quote.quoteNo,
    quote.customerName,
    quote.staff,
    getSalesStaffDisplayName(quote.staff),
    quote.subject,
    status,
    quote.status
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(quoteListSearchText);
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

function pickCustomerFields(row) {
  return {
    customerId: row?.customerId || "",
    customerCode: row?.customerCode || "",
    smaregiCustomerId: row?.smaregiCustomerId || "",
    smaregiCustomerCode: row?.smaregiCustomerCode || "",
    customerName: row?.customerName || row?.name || row?.customer || row?.clientName || "",
    organizationName: row?.organizationName || row?.organization || row?.companyName || "",
    customerType: row?.customerType || "",
    address: row?.address || "",
    phone: row?.phone || "",
    email: row?.email || "",
    customerMemo: row?.customerMemo || row?.memo || ""
  };
}

function resolveQuoteCustomer(quote) {
  const keys = [
    quote.customerId,
    quote.customerCode,
    quote.smaregiCustomerId,
    quote.smaregiCustomerCode
  ].map(value => String(value || "").trim()).filter(Boolean);
  if (!keys.length || !window.SalesCustomerStorage?.readCustomers) return null;
  return window.SalesCustomerStorage.readCustomers().find(customer => {
    const customerKeys = [
      customer.id,
      customer.customerCode,
      customer.smaregiMemberId,
      customer.smaregiMemberCode,
      customer.smaregiCustomerId,
      customer.smaregiCustomerCode
    ].map(value => String(value || "").trim()).filter(Boolean);
    return customerKeys.some(key => keys.includes(key));
  }) || null;
}

function buildInvoiceFromQuote(quote, invoices) {
  const now = new Date().toISOString();
  const lines = quote.lines || quote.items || [];
  const linkedCustomer = resolveQuoteCustomer(quote) || {};
  console.log("convert quote customer fields", pickCustomerFields(quote));
  const originNumber = quote.originNumber || quote.masterNumber || quote.quoteNumber || quote.quoteNo || "";
  const newInvoiceNo = nextInvoiceNo(invoices);
  const customerName = quote.customerName || quote.name || quote.customer || quote.clientName || linkedCustomer.customerName || linkedCustomer.name || "";
  const organizationName = quote.organizationName || quote.organization || quote.companyName || linkedCustomer.organizationName || linkedCustomer.organization || linkedCustomer.companyName || "";
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    invoiceNo: newInvoiceNo,
    invoiceNumber: newInvoiceNo,
    originNumber,
    masterNumber: originNumber,
    quoteNumber: quote.quoteNumber || quote.quoteNo || originNumber,
    sourceQuoteId: quote.id,
    sourceQuoteNo: quote.quoteNo || "",
    customerId: quote.customerId || linkedCustomer.id || "",
    customerCode: quote.customerCode || linkedCustomer.customerCode || "",
    smaregiCustomerId: quote.smaregiCustomerId || linkedCustomer.smaregiCustomerId || linkedCustomer.smaregiMemberId || "",
    smaregiCustomerCode: quote.smaregiCustomerCode || linkedCustomer.smaregiCustomerCode || linkedCustomer.smaregiMemberCode || "",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    customerName,
    organizationName,
    customerType: quote.customerType || linkedCustomer.customerType || "",
    address: quote.address || linkedCustomer.address || "",
    phone: quote.phone || linkedCustomer.phone || "",
    email: quote.email || linkedCustomer.email || "",
    subject: quote.subject || "",
    invoiceDate: today(),
    dueDate: datePlusDays(today(), 14),
    staff: quote.staff || "",
    memo: quote.slipMemo || quote.memo || quote.customerMemo || linkedCustomer.memo || "",
    slipMemo: quote.slipMemo || quote.memo || quote.customerMemo || "",
    customerMemo: quote.customerMemo || quote.slipMemo || quote.memo || linkedCustomer.memo || "",
    transactionType: normalizeTransactionType(quote.transactionType),
    originalSlipNumber: "",
    reasonMemo: "",
    discountTemplate: quote.discountTemplate || "none",
    overallDiscountAmount: Math.max(0, Number(quote.overallDiscountAmount || 0)),
    overallDiscountReason: quote.overallDiscountReason || "",
    items: JSON.parse(JSON.stringify(lines)),
    lines: JSON.parse(JSON.stringify(lines))
  };
}

function convertQuoteToInvoice(id) {
  const quotes = readQuotes();
  const quote = quotes.find(q => q.id === id);
  if (!quote) {
    showSalesMessage("見積書が見つかりません。", "err");
    return;
  }
  const invoices = readInvoices();
  const existing = invoices.find(invoice => invoice.sourceQuoteId === quote.id);
  if (existing) {
    if (normalizeInvoiceStatusForQuote(existing.status) === "draft") {
      const updatedInvoice = {
        ...buildInvoiceFromQuote(quote, invoices),
        id: existing.id,
        invoiceNo: existing.invoiceNo,
        invoiceNumber: existing.invoiceNumber || existing.invoiceNo,
        createdAt: existing.createdAt || new Date().toISOString(),
        status: existing.status || "draft",
        issuedAt: existing.issuedAt || "",
        updatedAt: new Date().toISOString()
      };
      const existingIndex = invoices.findIndex(invoice => invoice.id === existing.id);
      if (existingIndex >= 0) invoices[existingIndex] = updatedInvoice;
      writeInvoices(invoices);
      quote.status = QUOTE_STATUS_INVOICED;
      writeQuotes(quotes);
      renderQuoteList();
      showSalesMessage(`下書き請求書を最新の見積内容で更新しました: ${updatedInvoice.invoiceNo}`, "ok");
      location.href = `invoices.html?id=${encodeURIComponent(updatedInvoice.id)}`;
      return;
    }
    quote.status = QUOTE_STATUS_INVOICED;
    writeQuotes(quotes);
    renderQuoteList();
    showSalesMessage(`作成済みの請求書を開きます: ${existing.invoiceNo}`, "warn");
    location.href = `invoices.html?id=${encodeURIComponent(existing.id)}`;
    return;
  }
  const invoice = buildInvoiceFromQuote(quote, invoices);
  console.log("created invoice customer fields", pickCustomerFields(invoice));
  invoices.push(invoice);
  writeInvoices(invoices);
  const savedInvoice = readInvoices().find(row => row.id === invoice.id);
  console.log("saved invoice customer fields", pickCustomerFields(savedInvoice || invoice));
  quote.status = QUOTE_STATUS_INVOICED;
  writeQuotes(quotes);
  renderQuoteList();
  showSalesMessage(`請求書を作成しました: ${invoice.invoiceNo}`, "ok");
  location.href = `invoices.html?id=${encodeURIComponent(invoice.id)}`;
}

function newQuote(shouldScroll = false) {
  currentQuoteId = null;
  currentLines = [];
  currentQuoteLocked = false;
  ["customerName", "customerAddress", "customerPhone", "customerEmail", "quoteSubject", "quoteMemo", "productSearchInput", "originalSlipNumber", "reasonMemo", "overallDiscountReason"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  setFieldValue("overallDiscountAmount", 0);
  document.getElementById("customerType").value = "個人";
  setFieldValue("transactionType", "通常販売");
  document.getElementById("discountTemplate").value = "none";
  document.getElementById("quoteDate").value = today();
  document.getElementById("validUntil").value = datePlusDays(today(), 14);
  setFieldValue("quoteSubject", defaultTradeSubject());
  document.getElementById("productSearchResults").innerHTML = "";
  ["salesCustomerId", "salesCustomerCode", "salesSmaregiCustomerId", "salesSmaregiCustomerCode", "quoteCustomerSearchInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const customerResults = document.getElementById("quoteCustomerSearchResults");
  if (customerResults) customerResults.innerHTML = "";
  renderLines();
  updateQuoteDeleteButton(null);
  updateQuoteLockState({ status: QUOTE_STATUS_DRAFT });
  if (shouldScroll) {
    document.getElementById("quoteEditorCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function searchProducts() {
  const query = document.getElementById("productSearchInput").value.trim();
  const results = document.getElementById("productSearchResults");
  if (!query) {
    results.innerHTML = "";
    return;
  }
  results.innerHTML = '<div class="message">検索中...</div>';
  try {
    const filter = encodeURIComponent(`*${query}*`);
    const rows = await salesFetch(`products?select=barcode,name,base_stock,price,smaregi_product_id&or=(name.ilike.${filter},barcode.ilike.${filter},smaregi_product_id.ilike.${filter})&limit=20`);
    results.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>商品名</th><th>バーコード</th><th>販売価格</th><th>操作</th></tr></thead><tbody>${rows.map(raw => {
      const row = sanitizeProductRow(raw);
      const price = getProductPriceInfo(row);
      return `<tr>
        <td>${escapeHtml(row.name || "")}</td>
        <td>${escapeHtml(row.barcode || "")}</td>
        <td>${price.hasPrice ? money(price.value) : '<span class="line-stock warn">価格未登録</span>'}</td>
        <td><button type="button" class="secondary" onclick='addProductLine(${JSON.stringify(row).replaceAll("'", "&#39;")})'>追加</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : '<div class="message warn">該当商品がありません。</div>';
  } catch (e) {
    results.innerHTML = '<div class="message err">商品検索に失敗しました。</div>';
  }
}

function addManualProductLine() {
  currentLines.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    barcode: "",
    smaregiProductId: "",
    manualProduct: true,
    name: "",
    stock: "manual",
    qty: 1,
    unit: "個",
    unitPrice: 0,
    transactionType: normalizeTransactionType(getCurrentTransactionType()),
    discountValue: isFreeTransaction(getCurrentTransactionType()) ? 100 : 0,
    discountRate: isFreeTransaction(getCurrentTransactionType()) ? 100 : 0,
    discountAmountInput: 0,
    autoTransactionDiscount: isFreeTransaction(getCurrentTransactionType()),
    discountAmount: 0,
    amount: 0,
    memo: ""
  });
  renderLines();
  showSalesPopup("追加完了", "手入力商品を追加しました", "ok");
}

async function addProductLine(product) {
  try {
    const latest = await fetchProductByBarcode(product.barcode).catch(() => null);
    const row = latest || sanitizeProductRow(product);
    const units = readUnits();
    const unit = units[row.barcode] || "個";
    const price = getProductPriceInfo(row);
    currentLines.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      barcode: row.barcode || "",
      smaregiProductId: row.smaregi_product_id || "",
      name: row.name || "",
      stock: Number(row.base_stock || 0),
      qty: 1,
      unit,
      unitPrice: price.hasPrice ? price.value : 0,
      transactionType: normalizeTransactionType(getCurrentTransactionType()),
      discountValue: isFreeTransaction(getCurrentTransactionType()) ? 100 : 0,
      discountRate: isFreeTransaction(getCurrentTransactionType()) ? 100 : 0,
      discountAmountInput: 0,
      autoTransactionDiscount: isFreeTransaction(getCurrentTransactionType()),
      discountAmount: 0,
      amount: 0,
      memo: ""
    });
    renderLines();
    showSalesPopup("追加完了", "商品を見積に追加しました", "ok");
  } catch (e) {
    showSalesPopup("追加失敗", "商品の追加に失敗しました", "err");
  }
}

function renderLines() {
  const area = document.getElementById("quoteLines");
  const disabled = currentQuoteLocked ? "disabled" : "";
  area.innerHTML = currentLines.length ? currentLines.map((line, index) => `
    <div class="quote-line">
      <label>商品名<input value="${escapeHtml(line.name)}" onchange="updateLine(${index}, 'name', this.value)" ${disabled}></label>
      <label>現在庫<div class="${stockClass(line.stock)}">${formatStock(line.stock)}</div></label>
      <label>数量<input type="number" min="0" step="1" value="${line.qty}" onchange="updateLine(${index}, 'qty', this.value)" ${disabled}></label>
      <label>単位<select onchange="updateLine(${index}, 'unit', this.value)" ${disabled}>${UNIT_OPTIONS.map(unit => `<option value="${unit}" ${unit === line.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label>
      <label>税込単価<input type="number" min="0" step="1" value="${line.unitPrice}" onchange="updateLine(${index}, 'unitPrice', this.value)" ${disabled}></label>
      <label>値引率%<input type="number" min="0" max="100" step="1" value="${line.discountValue}" onchange="updateLine(${index}, 'discountValue', this.value)" ${disabled}></label>
      <label>値引額<input type="number" min="0" step="1" value="${Number(line.discountAmountInput || 0)}" onchange="updateLine(${index}, 'discountAmountInput', this.value)" ${disabled}></label>
      <label>金額<div class="line-amount ${amountClass(line.amount, line.transactionType)}">${money(line.amount)} ${refundBadge(line.transactionType)}</div></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" onchange="updateLine(${index}, 'memo', this.value)" ${disabled}></label>
      <button type="button" class="danger" onclick="removeLine(${index})" ${disabled}>削除</button>
    </div>`).join("") : '<div class="message">見積商品を追加してください。</div>';
  markLineRequiredLabels(area);
  recalcTotals();
}

function markLineRequiredLabels(area) {
  area.querySelectorAll("label").forEach(label => {
    const control = label.querySelector("input,select");
    const handler = control?.getAttribute("onchange") || "";
    if (handler.includes("'memo'")) return;
    if (control || label.querySelector(".line-amount")) applyRequiredLabel(label);
  });
}

function updateLine(index, key, value) {
  if (currentQuoteLocked) {
    showSalesMessage("請求書発行済みの見積書は編集できません。", "warn");
    renderLines();
    return;
  }
  const line = currentLines[index];
  if (!line) return;
  if (key === "discountValue" || key === "discountRate") {
    const discountRate = clampNumber(value, 0, 100);
    line.discountValue = discountRate;
    line.discountRate = discountRate;
    line.autoTransactionDiscount = false;
  } else if (key === "discountAmountInput") {
    line[key] = Math.max(0, Number(value || 0));
    line.autoTransactionDiscount = false;
  } else if (["qty", "unitPrice"].includes(key)) line[key] = Math.max(0, Number(value || 0));
  else line[key] = value;
  if (key === "unit" && line.barcode) {
    const units = readUnits();
    units[line.barcode] = value;
    writeUnits(units);
  }
  if (document.getElementById("discountTemplate").value !== "custom" && !["unit", "discountValue", "discountRate", "discountAmountInput"].includes(key)) {
    applyDiscountTemplate(false);
  }
  recalcSalesLine(line);
  renderLines();
}

function removeLine(index) {
  if (currentQuoteLocked) {
    showSalesMessage("請求書発行済みの見積書は編集できません。", "warn");
    return;
  }
  currentLines.splice(index, 1);
  renderLines();
}

function isDealerBrand(name) {
  const text = normalizeDealerBrandText(name);
  return DEALER_BRANDS.some(brand => text.includes(brand));
}

function normalizeDealerBrandText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/ＡＲＩＣＯ/g, "ARICO")
    .replace(/ＡＲＣＨＥＲＹ/g, "ARCHERY")
    .replace(/\s+/g, "")
    .replace(/[　]/g, "");
}

function applyDiscountTemplate(render = true) {
  const template = document.getElementById("discountTemplate").value;
  const transactionType = getCurrentTransactionType();
  currentLines.forEach(line => {
    line.transactionType = transactionType;
    if (isFreeTransaction(transactionType)) {
      line.discountValue = 100;
      line.autoTransactionDiscount = true;
    }
    else if (template === "all10") line.discountValue = 10;
    else if (template === "dealer10") line.discountValue = isDealerBrand(line.name) ? 10 : 0;
    else if (template === "none") line.discountValue = 0;
    line.discountRate = line.discountValue;
    recalcSalesLine(line);
  });
  if (render) renderLines();
}

function recalcTotals() {
  currentLines.forEach(recalcSalesLine);
  const totals = calcQuoteTotals({
    lines: currentLines,
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

function collectQuote() {
  const quotes = readQuotes();
  const existing = currentQuoteId ? quotes.find(q => q.id === currentQuoteId) : null;
  const quoteNo = existing?.quoteNo || nextQuoteNo(quotes);
  const originNumber = existing?.originNumber || existing?.masterNumber || existing?.quoteNumber || quoteNo;
  return {
    id: currentQuoteId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    quoteNo,
    quoteNumber: existing?.quoteNumber || quoteNo,
    originNumber,
    masterNumber: originNumber,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customerId: document.getElementById("salesCustomerId")?.value || existing?.customerId || "",
    customerCode: document.getElementById("salesCustomerCode")?.value || existing?.customerCode || "",
    smaregiCustomerId: document.getElementById("salesSmaregiCustomerId")?.value || existing?.smaregiCustomerId || "",
    smaregiCustomerCode: document.getElementById("salesSmaregiCustomerCode")?.value || existing?.smaregiCustomerCode || "",
    status: existing?.status || "下書き",
    customerName: document.getElementById("customerName").value.trim(),
    organizationName: document.getElementById("quoteOrganizationName")?.value?.trim() || "",
    customerType: document.getElementById("customerType").value,
    address: document.getElementById("customerAddress").value.trim(),
    phone: document.getElementById("customerPhone").value.trim(),
    email: document.getElementById("customerEmail").value.trim(),
    subject: document.getElementById("quoteSubject").value.trim() || defaultTradeSubject(document.getElementById("quoteDate").value || new Date()),
    quoteDate: document.getElementById("quoteDate").value,
    validUntil: document.getElementById("validUntil").value,
    staff: document.getElementById("quoteStaff").value,
    transactionType: normalizeTransactionType(document.getElementById("transactionType")?.value || existing?.transactionType),
    originalSlipNumber: "",
    reasonMemo: "",
    memo: document.getElementById("quoteMemo").value,
    slipMemo: document.getElementById("quoteMemo").value,
    customerMemo: document.getElementById("quoteMemo").value,
    discountTemplate: document.getElementById("discountTemplate").value,
    overallDiscountAmount: Math.max(0, Number(document.getElementById("overallDiscountAmount")?.value || 0)),
    overallDiscountReason: document.getElementById("overallDiscountReason")?.value?.trim() || "",
    lines: currentLines.map(({ stock, ...line }) => recalcSalesLine({ ...line, transactionType: normalizeTransactionType(document.getElementById("transactionType")?.value) }))
  };
}

function printQuotePdf(quote) {
  const doc = JSON.parse(JSON.stringify(quote || {}));
  doc.transactionType = normalizeTransactionType(doc.transactionType);
  const lines = (doc.lines || doc.items || []).map(line => recalcSalesLine({ ...line, transactionType: doc.transactionType || line.transactionType || "通常販売" }));
  const totals = calcQuoteTotals({ ...doc, lines });
  const rows = lines.map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.name || "")}</td>
      <td class="num">${Number(line.qty || 0)}</td>
      <td>${escapeHtml(line.unit || "")}</td>
      <td class="num">${money(line.unitPrice)}</td>
      <td class="num">${Number(line.discountAmountInput || 0) > 0 ? money(line.discountAmountInput) : `${Number(line.discountValue || 0)}%`}</td>
      <td class="num ${amountClass(line.amount, line.transactionType)}">${money(line.amount)}</td>
    </tr>
  `).join("");
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.quoteNo || "quote")}</title>
<style>
  @page{size:A4;margin:14mm}
  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}
  .top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #1b4332;padding-bottom:14px}
  h1{margin:0;font-size:30px;letter-spacing:.08em}
  .brand{font-weight:900;color:#1b4332}
  .meta{text-align:right;line-height:1.7;font-size:13px}
  .customer{margin:22px 0;font-size:15px;line-height:1.8}
  .total{display:inline-block;margin:12px 0 22px;padding:12px 22px;border:2px solid #1b4332;font-size:22px;font-weight:900}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#dcf5e2;color:#1b4332}
  th,td{border:1px solid #cfe6d7;padding:8px;text-align:left}
  .num{text-align:right}
  .amount-negative,.refund-amount{color:#b91c1c!important;font-weight:900}
  .summary{width:320px;margin:18px 0 0 auto}
  .summary div{display:flex;justify-content:space-between;border-bottom:1px solid #cfe6d7;padding:7px 0}
  .note{margin-top:22px;white-space:pre-wrap;line-height:1.7}
</style>
</head>
<body>
  <div class="top">
    <div><div class="brand">ARICO ARCHERY</div><h1>見積書</h1></div>
    <div class="meta">
      <div>見積書番号: ${escapeHtml(doc.quoteNo || "")}</div>
      <div>見積日: ${escapeHtml(doc.quoteDate || "")}</div>
      <div>有効期限: ${escapeHtml(doc.validUntil || "")}</div>
    </div>
  </div>
  <div class="customer">
    <strong>${escapeHtml(doc.customerName || "")} 御中</strong><br>
    ${escapeHtml(doc.address || "")}<br>
    件名: ${escapeHtml(doc.subject || "")}
    <br>取引区分: ${escapeHtml(doc.transactionType || "通常販売")}
  </div>
  <div class="total ${amountClass(totals.total, doc.transactionType)}">見積金額 ${money(totals.total)}</div>
  <table>
    <thead><tr><th>No.</th><th>商品名</th><th>数量</th><th>単位</th><th>税込単価</th><th>値引</th><th>金額</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">明細なし</td></tr>'}</tbody>
  </table>
  <div class="summary">
    <div><span>小計</span><strong>${money(totals.subtotal)}</strong></div>
    <div><span>値引</span><strong>${money(totals.discount)}</strong></div>
    <div><span>全体値引き</span><strong>${money(totals.overallDiscountAmount || 0)}</strong></div>
    <div><span>合計</span><strong class="${amountClass(totals.total, doc.transactionType)}">${money(totals.total)}</strong></div>
    <div><span>内消費税 10%</span><strong>${money(totals.tax)}</strong></div>
  </div>
  <div class="note">${escapeHtml(doc.overallDiscountReason ? `全体値引き理由: ${doc.overallDiscountReason}\n${doc.slipMemo || doc.memo || ""}` : doc.slipMemo || doc.memo || "")}</div>
  <script>window.onload = () => { window.print(); setTimeout(() => { if (window.opener) window.opener.focus(); }, 300); };</script>
</body>
</html>`);
  win.document.close();
}

async function saveQuote() {
  if (currentQuoteLocked) {
    showSalesPopup("保存できません", "請求書発行済みの見積書は編集できません。", "warn");
    return;
  }
  if (!document.getElementById("salesCustomerId")?.value) {
    showSalesMessage("\u9867\u5ba2\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044", "err");
    showSalesPopup("\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093", "\u9867\u5ba2\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044", "warn");
    return;
  }
  if (!document.getElementById("quoteStaff")?.value) {
    showSalesMessage("担当者を入力してください", "err");
    showSalesPopup("保存できません", "担当者を入力してください", "warn");
    return;
  }
  if (!currentLines.length) {
    showSalesMessage("\u898b\u7a4d\u5546\u54c1\u3092\u8ffd\u52a0\u3057\u3066\u304f\u3060\u3055\u3044\u3002", "err");
    return;
  }
  const quote = collectQuote();
  console.log("save quote customer fields", pickCustomerFields(quote));
  const quotes = readQuotes();
  const index = quotes.findIndex(q => q.id === quote.id);
  const isNewQuote = index < 0;
  if (index >= 0) quotes[index] = quote;
  else quotes.push(quote);
  writeQuotes(quotes);
  currentQuoteId = quote.id;
  renderQuoteList();
  updateQuoteDeleteButton(quote);
  const savedMessage = isNewQuote ? "\u898b\u7a4d\u66f8\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f" : "\u898b\u7a4d\u66f8\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f";
  showSalesMessage(savedMessage, "ok");
  showSalesPopup("\u4fdd\u5b58\u5b8c\u4e86", savedMessage, "ok");
  scrollToSavedQuote(quote.id);
}

function updateQuoteDeleteButton(quote) {
  const button = document.getElementById("deleteQuoteBtn");
  if (!button) return;
  const shouldShow = Boolean(quote?.id && canDeleteQuote(quote));
  button.hidden = !shouldShow;
  button.disabled = !shouldShow;
}

async function fillQuoteForm(quote) {
  currentQuoteId = quote.id || null;
  currentQuoteLocked = !isQuoteEditable(quote);
  currentLines = JSON.parse(JSON.stringify(quote.lines || [])).map(line => ({ ...line, transactionType: normalizeTransactionType(quote.transactionType || line.transactionType), stock: 0 }));
  setFieldValue("salesCustomerId", quote.customerId || "");
  setFieldValue("salesCustomerCode", quote.customerCode || "");
  setFieldValue("salesSmaregiCustomerId", quote.smaregiCustomerId || "");
  setFieldValue("salesSmaregiCustomerCode", quote.smaregiCustomerCode || "");
  setFieldValue("quoteCustomerSearchInput", "");
  const customerResults = document.getElementById("quoteCustomerSearchResults");
  if (customerResults) customerResults.innerHTML = "";
  document.getElementById("customerName").value = quote.customerName || quote.name || "";
  setFieldValue("quoteOrganizationName", quote.organizationName || "");
  document.getElementById("customerType").value = quote.customerType || "個人";
  document.getElementById("customerAddress").value = quote.address || "";
  document.getElementById("customerPhone").value = quote.phone || "";
  document.getElementById("customerEmail").value = quote.email || "";
  document.getElementById("quoteSubject").value = quote.subject || defaultTradeSubject(quote.quoteDate || quote.createdAt);
  document.getElementById("quoteDate").value = quote.quoteDate || today();
  document.getElementById("validUntil").value = quote.validUntil || datePlusDays(quote.quoteDate || today(), 14);
  document.getElementById("quoteStaff").value = quote.staff || "";
  setFieldValue("transactionType", normalizeTransactionType(quote.transactionType));
  setFieldValue("originalSlipNumber", "");
  setFieldValue("reasonMemo", "");
  document.getElementById("quoteMemo").value = quote.slipMemo || quote.memo || "";
  document.getElementById("discountTemplate").value = quote.discountTemplate || "none";
  setFieldValue("overallDiscountAmount", quote.overallDiscountAmount || 0);
  setFieldValue("overallDiscountReason", quote.overallDiscountReason || "");
  applyTransactionTypeToLines();
  renderLines();
  updateQuoteDeleteButton(quote);
  updateQuoteLockState(quote);
  await refreshQuoteLineStocks().catch(() => {});
}

function updateQuoteLockState(quote) {
  const locked = !isQuoteEditable(quote);
  currentQuoteLocked = locked;
  const editableIds = [
    "quoteCustomerSearchInput",
    "customerType",
    "quoteSubject",
    "quoteDate",
    "validUntil",
    "quoteStaff",
    "transactionType",
    "originalSlipNumber",
    "reasonMemo",
    "discountTemplate",
    "overallDiscountAmount",
    "overallDiscountReason",
    "quoteMemo",
    "productSearchInput"
  ];
  editableIds.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = locked;
  });
  const saveButton = document.querySelector('button[onclick="saveQuote();"]');
  if (saveButton) {
    saveButton.hidden = locked;
    saveButton.disabled = locked;
  }
  document.getElementById("quoteEditorCard")?.classList.toggle("locked", locked);
  if (locked) showSalesMessage("請求書発行済みの見積書は編集できません。PDF出力と複製は可能です。", "warn");
}

async function editQuote(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (quote) await fillQuoteForm(quote);
}

async function duplicateQuote(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (!quote) return;
  await fillQuoteForm({
    ...JSON.parse(JSON.stringify(quote)),
    id: null,
    quoteNo: "",
    createdAt: "",
    updatedAt: "",
    status: "下書き",
    quoteDate: today()
  });
  showSalesMessage("見積書を複製しました。保存すると新しい見積番号になります。", "ok");
}

async function deleteCurrentQuote() {
  if (!currentQuoteId) return;
  await deleteQuote(currentQuoteId);
}

async function deleteQuote(id) {
  const quotes = readQuotes();
  const quote = quotes.find(q => q.id === id);
  if (!quote) {
    showSalesPopup("削除失敗", "見積書が見つかりません。", "err");
    return;
  }
  if (!canDeleteQuote(quote)) {
    showSalesPopup("削除できません", "請求書に変換済みの見積書は削除できません。", "warn");
    return;
  }
  const confirmed = await confirmSalesPopup("見積書削除", "この見積書を削除しますか？", "warn");
  if (!confirmed) return;
  writeQuotes(quotes.filter(q => q.id !== id));
  renderQuoteList();
  if (currentQuoteId === id) newQuote();
  showSalesPopup("削除完了", "見積書を削除しました", "ok");
}

function outputCurrentQuotePdf() {
  try {
    printQuotePdf(collectQuote());
  } finally {
    restoreQuoteEditorAfterPdf();
  }
}

function printQuoteById(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (quote) printQuotePdf(quote);
}

function restoreQuoteEditorAfterPdf() {
  window.setTimeout(() => {
    const quote = currentQuoteId ? readQuotes().find(q => q.id === currentQuoteId) : { status: QUOTE_STATUS_DRAFT };
    updateQuoteLockState(quote || { status: QUOTE_STATUS_DRAFT });
    window.focus();
  }, 300);
}

function printQuotePdf(quote) {
  if (window.SalesPdfFormat?.printSalesDocument) {
    window.SalesPdfFormat.printSalesDocument("quote", quote);
    return;
  }
  showSalesPopup("PDF出力失敗", "PDFフォーマットを読み込めませんでした。", "err");
}
