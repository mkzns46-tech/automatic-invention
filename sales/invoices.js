const INVOICES_KEY = "arico_sales_invoices_v1";
const DELIVERIES_KEY = "arico_sales_deliveries_v1";
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

function pickInvoiceCustomerFields(row) {
  const info = row?.customerInfo || row?.customer_info || row?.customerDetail || {};
  return {
    customerId: row?.customerId || "",
    customerCode: row?.customerCode || "",
    smaregiCustomerId: row?.smaregiCustomerId || "",
    smaregiCustomerCode: row?.smaregiCustomerCode || "",
    customerName: row?.customerName || row?.name || row?.customer || row?.clientName || row?.billingName || row?.customer_name || info.customerName || info.name || "",
    organizationName: row?.organizationName || row?.organization || row?.companyName || row?.company || row?.organization_name || info.organizationName || info.organization || info.companyName || "",
    customerType: row?.customerType || row?.customer_type || info.customerType || "",
    address: row?.address || row?.customerAddress || row?.customer_address || info.address || "",
    phone: row?.phone || row?.tel || row?.customerPhone || row?.customer_phone || info.phone || info.tel || "",
    email: row?.email || row?.customerEmail || row?.customer_email || info.email || "",
    customerMemo: row?.customerMemo || row?.memo || ""
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

function normalizeInvoiceLine(line) {
  const normalized = {
    ...line,
    name: line?.name || line?.productName || line?.itemName || line?.product_name || "",
    qty: Number(line?.qty ?? line?.quantity ?? line?.count ?? 0),
    unit: line?.unit || line?.unitName || "",
    unitPrice: Number(line?.unitPrice ?? line?.price ?? line?.taxIncludedPrice ?? line?.salePrice ?? 0),
    discountValue: Number(line?.discountValue ?? line?.discountRate ?? line?.discount ?? 0),
    memo: line?.memo || line?.note || ""
  };
  return recalcInvoiceLine(normalized);
}

function getInvoiceRawLines(invoice) {
  const candidates = [invoice?.items, invoice?.lines, invoice?.products, invoice?.details];
  const rows = candidates.find(value => Array.isArray(value) && value.length) || [];
  return rows.map(normalizeInvoiceLine);
}

function normalizeInvoiceForView(invoice) {
  const normalized = { ...(invoice || {}) };
  const customerView = getInvoiceCustomerView(normalized);
  const lines = getInvoiceRawLines(normalized);
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

function calcInvoiceTotals(invoice) {
  const lines = getInvoiceRawLines(invoice);
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
    subject: invoice.subject || "",
    staff: invoice.staff || "",
    memo: invoice.memo || invoice.customerMemo || "",
    customerMemo: invoice.customerMemo || invoice.memo || "",
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
  const allInvoices = readInvoices().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const invoices = allInvoices.filter(matchesInvoiceListFilters);
  const activeInvoices = invoices.filter(invoice => {
    const status = normalizeInvoiceStatus(invoice.status);
    return status === INVOICE_STATUS_DRAFT || status === INVOICE_STATUS_ISSUED || status === INVOICE_STATUS_WAITING_PAYMENT;
  });
  const completedInvoices = invoices.filter(invoice => {
    const status = normalizeInvoiceStatus(invoice.status);
    return status === INVOICE_STATUS_PAID || status === INVOICE_STATUS_CANCELLED;
  });
  const count = document.getElementById("invoiceListCount");
  if (count) count.textContent = invoiceListSearchText || invoiceListStatusFilter || invoiceListDateFrom || invoiceListDateTo
    ? `入金待ち ${activeInvoices.length}件 / 全${invoices.length}件`
    : `入金待ち ${activeInvoices.length}件`;
  body.innerHTML = activeInvoices.length ? activeInvoices.map(renderInvoiceListRow).join("") : '<tr><td colspan="8">対応が必要な請求書はありません。</td></tr>';
  if (completedBody) {
    completedBody.innerHTML = completedInvoices.length ? completedInvoices.map(renderInvoiceListRow).join("") : '<tr><td colspan="8">完了済み・キャンセル済みの請求書はありません。</td></tr>';
  }
}

function renderInvoiceListRow(invoice) {
  invoice = normalizeInvoiceForView(invoice);
  const totals = calcInvoiceTotals(invoice);
  const status = normalizeInvoiceStatus(invoice.status);
  const customerView = getInvoiceCustomerView(invoice);
  return `<tr>
    <td><span class="number-with-status">${escapeHtml(invoice.invoiceNo)} ${statusBadge(status)}</span></td>
    <td>${escapeHtml(invoice.invoiceDate || "")}</td>
    <td>${escapeHtml(customerView.organizationName)}</td>
    <td>${escapeHtml(customerView.customerName)}</td>
    <td>${money(totals.total)}</td>
    <td>${statusBadge(status)}</td>
    <td>${escapeHtml(invoice.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="editInvoice('${invoice.id}')">${status === INVOICE_STATUS_DRAFT ? "&#32232;&#38598;" : "&#35443;&#32048;"}</button>
      <button type="button" class="secondary" onclick="printInvoiceById('${invoice.id}')">PDF&#20986;&#21147;</button>
    </td>
  </tr>`;
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
  ["invoiceNo", "sourceQuoteNo", "customerName", "invoiceOrganizationName", "customerType", "invoiceStaff", "customerAddress", "customerPhone", "customerEmail", "invoiceSubject", "invoiceMemo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["salesCustomerId", "salesCustomerCode", "salesSmaregiCustomerId", "salesSmaregiCustomerCode"].forEach(id => {
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
  currentInvoiceLines = JSON.parse(JSON.stringify(invoice.lines || []));
  document.getElementById("invoiceNo").value = invoice.invoiceNo || "";
  document.getElementById("invoiceStatus").value = normalizeInvoiceStatus(invoice.status);
  document.getElementById("sourceQuoteNo").value = invoice.sourceQuoteNo || "";
  setFieldValue("salesCustomerId", invoice.customerId || "");
  setFieldValue("salesCustomerCode", invoice.customerCode || "");
  setFieldValue("salesSmaregiCustomerId", invoice.smaregiCustomerId || "");
  setFieldValue("salesSmaregiCustomerCode", invoice.smaregiCustomerCode || "");
  document.getElementById("issuedAt").value = formatDateTime(invoice.issuedAt);
  document.getElementById("customerName").value = customerView.customerName;
  setFieldValue("invoiceOrganizationName", customerView.organizationName);
  document.getElementById("customerType").value = customerView.customerType;
  document.getElementById("invoiceStaff").value = invoice.staff || "";
  document.getElementById("customerAddress").value = customerView.address;
  document.getElementById("customerPhone").value = customerView.phone;
  document.getElementById("customerEmail").value = customerView.email;
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
    sourceQuoteNo: document.getElementById("sourceQuoteNo").value || existing?.sourceQuoteNo || "",
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
    subject: document.getElementById("invoiceSubject").value.trim(),
    invoiceDate: document.getElementById("invoiceDate").value,
    dueDate: document.getElementById("dueDate").value,
    staff: document.getElementById("invoiceStaff").value.trim(),
    memo: document.getElementById("invoiceMemo").value,
    customerMemo: existing?.customerMemo || document.getElementById("invoiceMemo").value,
    items: currentInvoiceLines.map(line => ({ ...line })),
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
  invoice.status = "waiting_payment";
  const issuedAtInput = document.getElementById("issuedAt")?.value;
  invoice.issuedAt = issuedAtInput || new Date().toISOString();
  invoice.updatedAt = new Date().toISOString();
  ensureDeliveryForInvoice(invoice);
  invoices[index] = invoice;
  writeInvoices(invoices);
  currentInvoiceId = invoice.id;
  fillInvoiceForm(invoice);
  renderInvoiceList();
  showSalesMessage("請求書を発行確定しました。ステータスを入金待ちに更新しました。", "ok");
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
