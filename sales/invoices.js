const INVOICES_KEY = "arico_sales_invoices_v1";
const INVOICE_STATUS_OPTIONS = ["下書き", "発行済み", "入金待ち", "入金済み", "キャンセル"];
const INVOICE_STATUS_DRAFT = "下書き";
const INVOICE_STATUS_ISSUED = "発行済み";
const INVOICE_STATUS_WAITING_PAYMENT = "入金待ち";
const INVOICE_STATUS_PAID = "入金済み";
const INVOICE_STATUS_CANCELLED = "キャンセル";

let currentInvoiceId = null;
let currentInvoiceLines = [];
let invoiceListSearchText = "";
let invoiceListStatusFilter = "";
let invoiceListCollapsed = false;

function readInvoices() {
  return JSON.parse(localStorage.getItem(INVOICES_KEY) || "[]");
}

function writeInvoices(invoices) {
  localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

function normalizeInvoiceStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "下書き") return INVOICE_STATUS_DRAFT;
  if (value === "issued" || value === "発行済み") return INVOICE_STATUS_ISSUED;
  if (value === "waiting_payment" || value === "payment_waiting" || value === "入金待ち") return INVOICE_STATUS_WAITING_PAYMENT;
  if (value === "paid" || value === "入金済み") return INVOICE_STATUS_PAID;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return INVOICE_STATUS_CANCELLED;
  return status || INVOICE_STATUS_DRAFT;
}

function isInvoiceEditable(invoiceOrStatus) {
  const status = normalizeInvoiceStatus(typeof invoiceOrStatus === "string" ? invoiceOrStatus : invoiceOrStatus?.status);
  return status === INVOICE_STATUS_DRAFT;
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
          : "ok";
  return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
}

function recalcInvoiceLine(line) {
  const qty = Number(line.qty || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const discountValue = Number(line.discountValue || 0);
  const gross = Math.round(qty * unitPrice);
  line.discountAmount = Math.round(gross * discountValue / 100);
  line.amount = Math.max(0, gross - line.discountAmount);
  return line;
}

function calcInvoiceTotals(invoice) {
  const lines = invoice?.lines || [];
  let subtotal = 0;
  let discount = 0;
  let total = 0;
  lines.forEach(line => {
    recalcInvoiceLine(line);
    const gross = Math.round(Number(line.qty || 0) * Number(line.unitPrice || 0));
    subtotal += gross;
    discount += Number(line.discountAmount || 0);
    total += Number(line.amount || 0);
  });
  return {
    subtotal,
    discount,
    total,
    tax: Math.floor(total * 10 / 110)
  };
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
  document.getElementById("invoiceStatus").innerHTML = INVOICE_STATUS_OPTIONS
    .map(status => `<option value="${status}">${status}</option>`)
    .join("");
  document.getElementById("invoiceStatus").disabled = true;
  bindInvoiceListControls();
  renderInvoiceList();
  const id = new URLSearchParams(location.search).get("id");
  if (id) editInvoice(id);
  else clearInvoiceEditor();
});

function bindInvoiceListControls() {
  const search = document.getElementById("invoiceListSearch");
  const status = document.getElementById("invoiceStatusFilter");
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
}

function toggleInvoiceList() {
  invoiceListCollapsed = !invoiceListCollapsed;
  const panel = document.getElementById("invoiceListPanel");
  const button = document.getElementById("invoiceListToggle");
  if (panel) panel.hidden = invoiceListCollapsed;
  if (button) button.textContent = invoiceListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function renderInvoiceList() {
  const body = document.getElementById("invoiceListBody");
  const invoices = readInvoices()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .filter(matchesInvoiceListFilters);
  body.innerHTML = invoices.length ? invoices.map(invoice => {
    const totals = calcInvoiceTotals(invoice);
    const status = normalizeInvoiceStatus(invoice.status);
    return `<tr>
      <td><span class="number-with-status">${escapeHtml(invoice.invoiceNo)} ${statusBadge(status)}</span></td>
      <td>${escapeHtml(invoice.invoiceDate || "")}</td>
      <td>${escapeHtml(invoice.customerName || "")}</td>
      <td>${escapeHtml(invoice.subject || "")}</td>
      <td>${money(totals.total)}</td>
      <td>${statusBadge(status)}</td>
      <td>${escapeHtml(invoice.sourceQuoteNo || "")}</td>
      <td>
        <button type="button" class="secondary" onclick="editInvoice('${invoice.id}')">編集</button>
        <button type="button" class="secondary" onclick="printInvoiceById('${invoice.id}')">PDF出力</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="8">請求書はまだありません。見積書一覧から「請求書へ変換」を実行してください。</td></tr>';
}

function matchesInvoiceListFilters(invoice) {
  const status = normalizeInvoiceStatus(invoice.status);
  if (invoiceListStatusFilter && status !== invoiceListStatusFilter) return false;
  if (!invoiceListSearchText) return true;
  const text = [
    invoice.invoiceNo,
    invoice.sourceQuoteNo,
    invoice.customerName,
    invoice.staff,
    invoice.subject,
    status,
    invoice.status
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(invoiceListSearchText);
}

function clearInvoiceEditor() {
  currentInvoiceId = null;
  currentInvoiceLines = [];
  ["invoiceNo", "sourceQuoteNo", "customerName", "customerType", "invoiceStaff", "customerAddress", "customerPhone", "customerEmail", "invoiceSubject", "invoiceMemo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("invoiceStatus").value = INVOICE_STATUS_DRAFT;
  document.getElementById("issuedAt").value = "";
  document.getElementById("invoiceDate").value = today();
  document.getElementById("dueDate").value = today();
  renderInvoiceLines();
  updateInvoiceLockState({ status: INVOICE_STATUS_DRAFT });
}

function fillInvoiceForm(invoice) {
  currentInvoiceId = invoice.id || null;
  currentInvoiceLines = JSON.parse(JSON.stringify(invoice.lines || []));
  document.getElementById("invoiceNo").value = invoice.invoiceNo || "";
  document.getElementById("invoiceStatus").value = normalizeInvoiceStatus(invoice.status);
  document.getElementById("sourceQuoteNo").value = invoice.sourceQuoteNo || "";
  document.getElementById("issuedAt").value = formatDateTime(invoice.issuedAt);
  document.getElementById("customerName").value = invoice.customerName || "";
  document.getElementById("customerType").value = invoice.customerType || "";
  document.getElementById("invoiceStaff").value = invoice.staff || "";
  document.getElementById("customerAddress").value = invoice.address || "";
  document.getElementById("customerPhone").value = invoice.phone || "";
  document.getElementById("customerEmail").value = invoice.email || "";
  document.getElementById("invoiceSubject").value = invoice.subject || "";
  document.getElementById("invoiceDate").value = invoice.invoiceDate || today();
  document.getElementById("dueDate").value = invoice.dueDate || today();
  document.getElementById("invoiceMemo").value = invoice.memo || "";
  renderInvoiceLines();
  updateInvoiceLockState(invoice);
}

function editInvoice(id) {
  const invoice = readInvoices().find(row => row.id === id);
  if (!invoice) {
    showSalesMessage("請求書が見つかりません。", "err");
    return;
  }
  fillInvoiceForm(invoice);
  history.replaceState(null, "", `invoices.html?id=${encodeURIComponent(id)}`);
}

function renderInvoiceLines() {
  const area = document.getElementById("invoiceLines");
  const locked = !isInvoiceEditable(document.getElementById("invoiceStatus")?.value);
  const disabled = locked ? "disabled" : "";
  area.innerHTML = currentInvoiceLines.length ? currentInvoiceLines.map((line, index) => {
    recalcInvoiceLine(line);
    return `<div class="invoice-line">
      <label>商品名<input value="${escapeHtml(line.name || "")}" onchange="updateInvoiceLine(${index}, 'name', this.value)" ${disabled}></label>
      <label>数量<input type="number" min="0" step="1" value="${Number(line.qty || 0)}" onchange="updateInvoiceLine(${index}, 'qty', this.value)" ${disabled}></label>
      <label>単位<input value="${escapeHtml(line.unit || "")}" onchange="updateInvoiceLine(${index}, 'unit', this.value)" ${disabled}></label>
      <label>税込単価<input type="number" min="0" step="1" value="${Number(line.unitPrice || 0)}" onchange="updateInvoiceLine(${index}, 'unitPrice', this.value)" ${disabled}></label>
      <label>値引率%<input type="number" min="0" step="1" value="${Number(line.discountValue || 0)}" onchange="updateInvoiceLine(${index}, 'discountValue', this.value)" ${disabled}></label>
      <label>金額<div class="line-amount">${money(line.amount)}</div></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" onchange="updateInvoiceLine(${index}, 'memo', this.value)" ${disabled}></label>
      <button type="button" class="danger" onclick="removeInvoiceLine(${index})" ${disabled}>削除</button>
    </div>`;
  }).join("") : '<div class="message">請求商品がありません。</div>';
  recalcTotals();
}

function updateInvoiceLine(index, key, value) {
  if (!isInvoiceEditable(document.getElementById("invoiceStatus")?.value)) {
    showSalesMessage("発行済みの請求書は商品明細を編集できません。", "warn");
    renderInvoiceLines();
    return;
  }
  const line = currentInvoiceLines[index];
  if (!line) return;
  if (["qty", "unitPrice", "discountValue"].includes(key)) line[key] = Number(value || 0);
  else line[key] = value;
  recalcInvoiceLine(line);
  renderInvoiceLines();
}

function removeInvoiceLine(index) {
  if (!isInvoiceEditable(document.getElementById("invoiceStatus")?.value)) {
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
  const lockTargets = [
    "customerName",
    "customerType",
    "invoiceStaff",
    "customerAddress",
    "customerPhone",
    "customerEmail",
    "invoiceSubject",
    "invoiceDate",
    "dueDate",
    "invoiceMemo"
  ];
  if (issueButton) {
    const hasInvoice = Boolean(currentInvoiceId || document.getElementById("invoiceNo")?.value);
    const shouldShow = Boolean(hasInvoice && editable);
    issueButton.hidden = !shouldShow;
    issueButton.style.display = shouldShow ? "" : "none";
    issueButton.disabled = !shouldShow;
    issueButton.textContent = "発行確定";
  }
  if (saveButton) {
    saveButton.hidden = !editable;
    saveButton.disabled = !editable;
  }
  lockTargets.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = !editable;
  });
  document.getElementById("invoiceEditorCard")?.classList.toggle("locked", !editable);
  showSalesMessage(
    editable ? "請求書を編集できます。" : "発行済みのため請求情報・金額・商品明細は編集できません。PDF出力とキャンセル処理は可能です。",
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
  const totals = calcInvoiceTotals({ lines: currentInvoiceLines });
  document.getElementById("subtotalText").textContent = money(totals.subtotal);
  document.getElementById("discountText").textContent = money(totals.discount);
  document.getElementById("totalText").textContent = money(totals.total);
  document.getElementById("taxText").textContent = money(totals.tax);
}

function collectInvoice() {
  const invoices = readInvoices();
  const existing = currentInvoiceId ? invoices.find(invoice => invoice.id === currentInvoiceId) : null;
  return {
    ...(existing || {}),
    id: currentInvoiceId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    invoiceNo: document.getElementById("invoiceNo").value || existing?.invoiceNo || "",
    sourceQuoteId: existing?.sourceQuoteId || "",
    sourceQuoteNo: document.getElementById("sourceQuoteNo").value || existing?.sourceQuoteNo || "",
    issuedAt: existing?.issuedAt || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: normalizeInvoiceStatus(document.getElementById("invoiceStatus").value),
    customerName: document.getElementById("customerName").value.trim(),
    customerType: document.getElementById("customerType").value.trim(),
    address: document.getElementById("customerAddress").value.trim(),
    phone: document.getElementById("customerPhone").value.trim(),
    email: document.getElementById("customerEmail").value.trim(),
    subject: document.getElementById("invoiceSubject").value.trim(),
    invoiceDate: document.getElementById("invoiceDate").value,
    dueDate: document.getElementById("dueDate").value,
    staff: document.getElementById("invoiceStaff").value.trim(),
    memo: document.getElementById("invoiceMemo").value,
    lines: currentInvoiceLines.map(line => ({ ...line }))
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
  const confirmed = await confirmSalesPopup("発行確定", "この請求書を発行確定しますか？", "warn");
  if (!confirmed) return;
  const invoices = readInvoices();
  const index = invoices.findIndex(row => row.id === currentInvoiceId);
  if (index < 0) {
    showSalesMessage("請求書が見つかりません。", "err");
    return;
  }
  const invoice = collectInvoice();
  if (!isInvoiceEditable(invoice.status)) {
    showSalesMessage("この請求書は発行確定済みです。", "warn");
    return;
  }
  invoice.status = INVOICE_STATUS_ISSUED;
  invoice.issuedAt = new Date().toISOString();
  invoice.updatedAt = invoice.issuedAt;
  invoices[index] = invoice;
  writeInvoices(invoices);
  fillInvoiceForm(invoice);
  renderInvoiceList();
  showSalesPopup("発行確定", "請求書を発行確定しました", "ok");
}

function cancelInvoice() {
  if (!currentInvoiceId) return;
  document.getElementById("invoiceStatus").value = INVOICE_STATUS_CANCELLED;
  saveInvoice();
}

function outputCurrentInvoicePdf() {
  printInvoicePdf(collectInvoice());
}

function printInvoiceById(id) {
  const invoice = readInvoices().find(row => row.id === id);
  if (invoice) printInvoicePdf(invoice);
}
