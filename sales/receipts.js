const RECEIPTS_INVOICES_KEY = "arico_sales_invoices_v1";
const RECEIPTS_KEY = "arico_sales_receipts_v1";
const RECEIPT_STATUS_DRAFT = "未発行";
const RECEIPT_STATUS_ISSUED = "発行済み";
const RECEIPT_STATUS_CANCELLED = "キャンセル";

let currentReceiptId = null;
let receiptSearchText = "";
let receiptStatusFilter = "";
let receiptTransactionTypeFilter = "";
let receiptDateFrom = "";
let receiptDateTo = "";
let receiptListCollapsed = true;

function readInvoices() {
  return JSON.parse(localStorage.getItem(RECEIPTS_INVOICES_KEY) || "[]");
}

function readReceipts() {
  return JSON.parse(localStorage.getItem(RECEIPTS_KEY) || "[]");
}

function writeReceipts(receipts) {
  localStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
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

function isRefundReceipt(row) {
  return String(row?.transactionType || "").trim() === "返金" || Number(row?.amount || 0) < 0;
}

function amountClass(value, row = {}) {
  return Number(value || 0) < 0 || isRefundReceipt(row) ? "amount-negative refund-amount" : "";
}

function normalizeInvoiceStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "paid" || value === "入金済み") return "入金済み";
  if (value === "no_payment_required" || value === "no_payment" || value === "payment_not_required" || value === "入金不要") return "入金不要";
  return status || "";
}

function normalizeReceiptStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "未発行") return RECEIPT_STATUS_DRAFT;
  if (value === "issued" || value === "発行済み") return RECEIPT_STATUS_ISSUED;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return RECEIPT_STATUS_CANCELLED;
  return status || RECEIPT_STATUS_DRAFT;
}

function statusBadge(status) {
  const value = normalizeReceiptStatus(status);
  const type = value === RECEIPT_STATUS_CANCELLED ? "danger" : value === RECEIPT_STATUS_ISSUED ? "ok" : "muted";
  return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
}

function getPayments(invoice) {
  return Array.isArray(invoice?.payments) ? invoice.payments : [];
}

function getActivePayments(invoice) {
  return getPayments(invoice).filter(payment => payment.status !== "canceled");
}

function getLatestActivePayment(invoice) {
  return getActivePayments(invoice).slice().sort((a, b) => String(b.paymentDate || b.createdAt).localeCompare(String(a.paymentDate || a.createdAt)))[0] || null;
}

function getPaidTotal(invoice) {
  return getActivePayments(invoice).reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function getReceiptInvoiceTotal(invoice) {
  if (Number.isFinite(Number(invoice?.total))) return Number(invoice.total || 0);
  const lines = Array.isArray(invoice?.lines) ? invoice.lines : Array.isArray(invoice?.items) ? invoice.items : [];
  return lines.reduce((total, line) => total + Number(line.amount || 0), 0);
}

function getReceiptDisplayAmount(invoice) {
  const paidTotal = getPaidTotal(invoice);
  if (paidTotal) return paidTotal;
  return getReceiptInvoiceTotal(invoice);
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

function receiptNo(n) {
  return "REC-" + String(n).padStart(6, "0");
}

function nextReceiptNo(receipts) {
  const max = receipts.reduce((num, receipt) => {
    const match = String(receipt.receiptNo || "").match(/^REC-(\d+)$/);
    return Math.max(num, match ? Number(match[1]) : 0);
  }, 0);
  return receiptNo(max + 1);
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

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  arrangeReceiptDetailLayout();
  bindReceiptControls();
  renderReceiptLists();
  const id = new URLSearchParams(location.search).get("id");
  if (id) selectReceipt(id);
  else clearReceiptDetail();
});

function arrangeReceiptDetailLayout() {
  const card = document.getElementById("receiptDetailCard");
  if (!card) return;
  const groups = [
    ["receiptNo", "receiptCustomerName", "receiptStaff"],
    ["receiptPaymentDate", "receiptAmount", "receiptSubject"],
    ["receiptMemo"]
  ];
  groups.forEach((ids, index) => {
    let row = document.getElementById(`receiptDetailRow${index + 1}`);
    if (!row) {
      row = document.createElement("div");
      row.id = `receiptDetailRow${index + 1}`;
      row.className = ids.length === 3 ? "row three" : ids.length === 2 ? "row two" : "receipt-memo-row";
      card.querySelector(".sales-actions")?.insertAdjacentElement("beforebegin", row);
    }
    ids.forEach(id => {
      const label = document.getElementById(id)?.closest("label");
      if (label) row.appendChild(label);
    });
  });
}

function ensureReceiptTransactionFilter() {
  if (document.getElementById("receiptTransactionTypeFilter")) return;
  const statusLabel = document.getElementById("receiptStatusFilter")?.closest("label");
  if (!statusLabel) return;
  const label = document.createElement("label");
  label.textContent = "取引区分";
  const select = document.createElement("select");
  select.id = "receiptTransactionTypeFilter";
  ["", "通常販売", "交換", "返金", "無償提供", "その他"].forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value || "全て";
    select.appendChild(option);
  });
  label.appendChild(select);
  statusLabel.insertAdjacentElement("afterend", label);
}

function bindReceiptControls() {
  document.getElementById("receiptSearch")?.addEventListener("input", event => {
    receiptSearchText = event.target.value.trim().toLowerCase();
    renderReceiptLists();
  });
  document.getElementById("receiptStatusFilter")?.addEventListener("change", event => {
    receiptStatusFilter = event.target.value;
    renderReceiptLists();
  });
  document.getElementById("receiptTransactionTypeFilter")?.addEventListener("change", event => {
    receiptTransactionTypeFilter = event.target.value;
    renderReceiptLists();
  });
  document.getElementById("receiptDateFromFilter")?.addEventListener("input", event => {
    receiptDateFrom = event.target.value;
    renderReceiptLists();
  });
  document.getElementById("receiptDateToFilter")?.addEventListener("input", event => {
    receiptDateTo = event.target.value;
    renderReceiptLists();
  });
  setReceiptListCollapsed(true);
}

function toggleIssuedReceiptList() {
  setReceiptListCollapsed(!receiptListCollapsed);
}

function toggleReceiptList() {
  setReceiptListCollapsed(!receiptListCollapsed);
}

function setReceiptListCollapsed(collapsed) {
  receiptListCollapsed = collapsed;
  const listPanel = document.getElementById("receiptListPanel");
  const panel = document.getElementById("issuedReceiptListPanel");
  const button = document.getElementById("receiptListToggle") || document.getElementById("receiptIssuedToggle");
  if (listPanel) listPanel.hidden = receiptListCollapsed;
  if (panel) panel.hidden = receiptListCollapsed;
  if (button) button.textContent = receiptListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function getPaidInvoiceTargets() {
  const receipts = readReceipts();
  return readInvoices()
    .filter(invoice => ["入金済み", "入金不要"].includes(normalizeInvoiceStatus(invoice.status)))
    .filter(invoice => !receipts.some(receipt => receipt.sourceInvoiceNo === invoice.invoiceNo))
    .map(invoice => ({ type: "invoice", invoice }))
    .filter(matchesReceiptTargetFilters);
}

function getReceiptRows() {
  return readReceipts()
    .map(receipt => ({ type: "receipt", receipt }))
    .filter(matchesReceiptTargetFilters);
}

function renderReceiptLists() {
  const targets = getPaidInvoiceTargets();
  const receipts = getReceiptRows();
  const draftReceipts = receipts.filter(row => normalizeReceiptStatus(row.receipt.status) === RECEIPT_STATUS_DRAFT);
  const issuedReceipts = receipts.filter(row => normalizeReceiptStatus(row.receipt.status) !== RECEIPT_STATUS_DRAFT);
  const activeRows = [...targets, ...draftReceipts].sort(sortReceiptRows);
  const completedRows = issuedReceipts.sort(sortReceiptRows);
  const displayedRows = [...activeRows, ...completedRows];
  const listCount = document.getElementById("receiptListCount");
  if (listCount) listCount.textContent = `${displayedRows.length}件 / 合計 ${money(displayedRows.reduce((sum, row) => sum + getReceiptRowAmount(row), 0))}`;
  const count = document.getElementById("receiptTargetCount");
  if (count) count.textContent = `未発行 ${activeRows.length}件`;
  document.getElementById("receiptTargetListBody").innerHTML = activeRows.length
    ? activeRows.map(renderReceiptTargetRow).join("")
    : '<tr><td colspan="9">領収書発行対象はありません。</td></tr>';
  document.getElementById("issuedReceiptListBody").innerHTML = completedRows.length
    ? completedRows.map(renderReceiptTargetRow).join("")
    : '<tr><td colspan="9">発行済み・キャンセル済みの領収書はありません。</td></tr>';
}

function sortReceiptRows(a, b) {
  const aDate = a.type === "invoice" ? getLatestActivePayment(a.invoice)?.paymentDate : a.receipt.paymentDate;
  const bDate = b.type === "invoice" ? getLatestActivePayment(b.invoice)?.paymentDate : b.receipt.paymentDate;
  return String(bDate || "").localeCompare(String(aDate || ""));
}

function getReceiptRowAmount(row) {
  if (row.type === "invoice") return getReceiptDisplayAmount(row.invoice);
  return Number(row.receipt?.amount || 0);
}

function renderReceiptTargetRow(row) {
  if (row.type === "invoice") {
    const invoice = row.invoice;
    const payment = getLatestActivePayment(invoice) || {};
    return `<tr>
      <td></td>
      <td><span class="number-with-status">${escapeHtml(invoice.invoiceNo || "")} <span class="status-badge muted">&#26410;&#20316;&#25104;</span></span></td>
      <td>${escapeHtml(normalizeDateOnly(invoice.issuedAt) || payment.paymentDate || "")}</td>
      <td>${escapeHtml(invoice.organizationName || invoice.organization || invoice.companyName || "")}</td>
      <td>${escapeHtml(invoice.customerName || invoice.name || invoice.customer || "")}</td>
      <td class="${amountClass(getReceiptDisplayAmount(invoice), invoice)}">${money(getReceiptDisplayAmount(invoice))}</td>
      <td><span class="status-badge muted">&#26410;&#30330;&#34892;</span></td>
      <td>${escapeHtml(payment.staff || invoice.staff || "")}</td>
      <td><button type="button" class="primary" onclick="createReceiptFromInvoice('${invoice.id}')">&#38936;&#21454;&#26360;&#20316;&#25104;</button></td>
    </tr>`;
  }
  const receipt = row.receipt;
  return `<tr>
    <td><input type="checkbox" class="receipt-pdf-check pdf-select-checkbox" value="${escapeHtml(receipt.id || "")}"></td>
    <td><span class="number-with-status">${escapeHtml(receipt.receiptNo || "")} ${statusBadge(receipt.status)}</span></td>
    <td>${escapeHtml(normalizeDateOnly(receipt.issuedAt) || receipt.paymentDate || "")}</td>
    <td>${escapeHtml(receipt.organizationName || receipt.organization || receipt.companyName || "")}</td>
    <td>${escapeHtml(receipt.customerName || receipt.name || receipt.customer || "")}</td>
    <td class="${amountClass(receipt.amount, receipt)}">${money(receipt.amount)}</td>
    <td>${statusBadge(receipt.status)}</td>
    <td>${escapeHtml(receipt.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="selectReceipt('${receipt.id}')">&#35443;&#32048;</button>
      <button type="button" class="secondary" onclick="printReceiptById('${receipt.id}')">PDF&#20986;&#21147;</button>
    </td>
  </tr>`;
}

function printSelectedReceipts() {
  const ids = Array.from(document.querySelectorAll(".receipt-pdf-check:checked")).map(input => input.value);
  const receipts = readReceipts().filter(receipt => ids.includes(String(receipt.id)));
  if (!receipts.length) {
    showSalesPopup("PDF出力", "印刷する領収書を選択してください。", "warn");
    return;
  }
  if (!window.SalesPdfFormat?.printSalesDocuments) {
    showSalesPopup("PDF出力失敗", "PDFフォーマットを読み込めませんでした。", "err");
    return;
  }
  window.SalesPdfFormat.printSalesDocuments(receipts.map(receipt => ({ type: "receipt", data: receipt })));
}

function matchesReceiptTargetFilters(row) {
  const invoice = row.invoice;
  const receipt = row.receipt;
  const status = receipt ? normalizeReceiptStatus(receipt.status) : RECEIPT_STATUS_DRAFT;
  if (receiptStatusFilter && status !== receiptStatusFilter) return false;
  const transactionType = receipt?.transactionType || invoice?.transactionType || "";
  if (receiptTransactionTypeFilter && transactionType !== receiptTransactionTypeFilter) return false;
  const paymentDate = receipt ? receipt.paymentDate : getLatestActivePayment(invoice)?.paymentDate;
  if (!matchesDateRange([paymentDate, receipt?.createdAt, invoice?.invoiceDate], receiptDateFrom, receiptDateTo)) return false;
  if (!receiptSearchText) return true;
  const text = [
    receipt?.receiptNo,
    receipt?.sourceInvoiceNo,
    receipt?.originNumber,
    receipt?.transactionType,
    receipt?.customerName,
    receipt?.organizationName,
    receipt?.subject,
    receipt?.payerName,
    receipt?.amount,
    invoice?.invoiceNo,
    invoice?.originNumber,
    invoice?.transactionType,
    invoice?.organizationName,
    invoice?.customerName,
    invoice?.subject,
    getReceiptDisplayAmount(invoice),
    status
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(receiptSearchText);
}

function buildReceiptFromInvoice(invoice, receipts) {
  const payment = getLatestActivePayment(invoice) || {};
  const now = new Date().toISOString();
  const newReceiptNo = nextReceiptNo(receipts);
  const originNumber = invoice.originNumber || invoice.masterNumber || invoice.quoteNumber || invoice.sourceQuoteNo || "";
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    receiptNo: newReceiptNo,
    receiptNumber: newReceiptNo,
    originNumber,
    masterNumber: originNumber,
    quoteNumber: invoice.quoteNumber || invoice.sourceQuoteNo || originNumber,
    invoiceNumber: invoice.invoiceNumber || invoice.invoiceNo || "",
    sourceInvoiceId: invoice.id || "",
    sourceInvoiceNo: invoice.invoiceNo || "",
    transactionType: invoice.transactionType || "通常販売",
    originalSlipNumber: "",
    reasonMemo: "",
    customerName: invoice.customerName || "",
    subject: invoice.subject || "",
    paymentDate: payment.paymentDate || normalizeDateOnly(payment.createdAt),
    amount: getReceiptDisplayAmount(invoice),
    method: "振込",
    payerName: payment.payerName || "",
    staff: payment.staff || invoice.staff || "",
    memo: payment.memo || invoice.slipMemo || invoice.memo || "アーチェリー用品代として",
    slipMemo: payment.memo || invoice.slipMemo || invoice.memo || "アーチェリー用品代として",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    issuedAt: ""
  };
}

function createReceiptFromInvoice(invoiceId) {
  const invoice = readInvoices().find(row => row.id === invoiceId);
  if (!invoice || !["入金済み", "入金不要"].includes(normalizeInvoiceStatus(invoice.status))) {
    showSalesPopup("作成できません", "入金済みまたは入金不要の請求書のみ領収書を作成できます。", "warn");
    return;
  }
  const receipts = readReceipts();
  const existing = receipts.find(receipt => receipt.sourceInvoiceNo === invoice.invoiceNo);
  if (existing) {
    selectReceipt(existing.id);
    showSalesPopup("作成済み", "この請求書の領収書は既に作成されています。", "warn");
    return;
  }
  const receipt = buildReceiptFromInvoice(invoice, receipts);
  receipts.push(receipt);
  writeReceipts(receipts);
  renderReceiptLists();
  selectReceipt(receipt.id);
  showSalesPopup("領収書を作成しました", receipt.receiptNo, "ok");
}

function clearReceiptDetail() {
  currentReceiptId = null;
  ["receiptNo", "sourceInvoiceNo", "receiptStatus", "receiptCustomerName", "receiptSubject", "receiptStaff", "receiptPaymentDate", "receiptAmount", "receiptMethod", "receiptMemo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function selectReceipt(id) {
  const receipt = readReceipts().find(row => row.id === id);
  if (!receipt) {
    showSalesPopup("表示できません", "領収書が見つかりません。", "err");
    return;
  }
  currentReceiptId = receipt.id;
  document.getElementById("receiptNo").value = receipt.receiptNo || "";
  document.getElementById("sourceInvoiceNo").value = receipt.sourceInvoiceNo || "";
  document.getElementById("receiptStatus").value = normalizeReceiptStatus(receipt.status);
  document.getElementById("receiptCustomerName").value = receipt.customerName || "";
  document.getElementById("receiptSubject").value = receipt.subject || "";
  document.getElementById("receiptStaff").value = receipt.staff || "";
  document.getElementById("receiptPaymentDate").value = receipt.paymentDate || "";
  document.getElementById("receiptAmount").value = money(receipt.amount);
  document.getElementById("receiptMethod").value = receipt.method || "振込";
  document.getElementById("receiptMemo").value = receipt.slipMemo || receipt.memo || "";
  history.replaceState(null, "", `receipts.html?id=${encodeURIComponent(receipt.id)}`);
  showSalesMessage(`${receipt.receiptNo || ""} を表示しています。`, "ok");
}

function saveReceiptEditsSilently() {
  if (!currentReceiptId) return;
  const receipts = readReceipts();
  const index = receipts.findIndex(row => row.id === currentReceiptId);
  if (index < 0) return;
  const receipt = receipts[index];
  receipt.customerName = document.getElementById("receiptCustomerName")?.value.trim() || receipt.customerName || "";
  receipt.subject = document.getElementById("receiptSubject")?.value.trim() || receipt.subject || "";
  receipt.paymentDate = document.getElementById("receiptPaymentDate")?.value || receipt.paymentDate || "";
  receipt.memo = document.getElementById("receiptMemo")?.value || receipt.memo || "";
  receipt.slipMemo = receipt.memo;
  receipt.updatedAt = new Date().toISOString();
  receipts[index] = receipt;
  writeReceipts(receipts);
}

function saveCurrentReceipt() {
  if (!currentReceiptId) {
    showSalesPopup("\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093", "\u9818\u53ce\u66f8\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002", "warn");
    return;
  }
  const receipts = readReceipts();
  const index = receipts.findIndex(row => row.id === currentReceiptId);
  if (index < 0) {
    showSalesPopup("\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093", "\u9818\u53ce\u66f8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002", "err");
    return;
  }
  const receipt = receipts[index];
  receipt.customerName = document.getElementById("receiptCustomerName")?.value.trim() || "";
  receipt.subject = document.getElementById("receiptSubject")?.value.trim() || "";
  receipt.paymentDate = document.getElementById("receiptPaymentDate")?.value || receipt.paymentDate || "";
  receipt.memo = document.getElementById("receiptMemo")?.value || "";
  receipt.slipMemo = receipt.memo;
  receipt.updatedAt = new Date().toISOString();
  receipts[index] = receipt;
  writeReceipts(receipts);
  renderReceiptLists();
  selectReceipt(receipt.id);
  showSalesPopup("\u4fdd\u5b58\u5b8c\u4e86", "\u9818\u53ce\u66f8\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002", "ok");
}

function outputCurrentReceiptPdf() {
  saveReceiptEditsSilently();
  const receipt = markReceiptIssued(currentReceiptId);
  if (receipt) printReceiptPdf(receipt);
}

function printReceiptById(id) {
  const receipt = markReceiptIssued(id);
  if (receipt) printReceiptPdf(receipt);
}

function markReceiptIssued(id) {
  if (!id) return null;
  const receipts = readReceipts();
  const index = receipts.findIndex(row => row.id === id);
  if (index < 0) return null;
  const receipt = receipts[index];
  if (normalizeReceiptStatus(receipt.status) === RECEIPT_STATUS_DRAFT) {
    const now = new Date().toISOString();
    receipt.status = "issued";
    receipt.issuedAt = normalizeDateOnly(now);
    receipt.updatedAt = now;
    receipts[index] = receipt;
    writeReceipts(receipts);
    renderReceiptLists();
    if (currentReceiptId === id) selectReceipt(id);
  }
  return receipt;
}
