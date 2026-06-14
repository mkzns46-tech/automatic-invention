const PAYMENTS_INVOICES_KEY = "arico_sales_invoices_v1";
const PAYMENT_STATUS_ISSUED = "発行済み";
const PAYMENT_STATUS_WAITING = "入金待ち";
const PAYMENT_STATUS_PAID = "入金済み";
const PAYMENT_STATUS_CANCELLED = "キャンセル";
const PAYMENT_TARGET_STATUSES = [PAYMENT_STATUS_ISSUED, PAYMENT_STATUS_WAITING, PAYMENT_STATUS_PAID, PAYMENT_STATUS_CANCELLED];

let selectedPaymentInvoiceId = null;
let paymentSearchText = "";
let paymentStatusFilter = "";
let paymentDateFrom = "";
let paymentDateTo = "";
let paymentListCollapsed = false;

function readPaymentInvoices() {
  return JSON.parse(localStorage.getItem(PAYMENTS_INVOICES_KEY) || "[]");
}

function writePaymentInvoices(invoices) {
  localStorage.setItem(PAYMENTS_INVOICES_KEY, JSON.stringify(invoices));
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

function normalizePaymentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "issued" || value === "発行済み") return PAYMENT_STATUS_ISSUED;
  if (value === "waiting_payment" || value === "payment_waiting" || value === "入金待ち") return PAYMENT_STATUS_WAITING;
  if (value === "paid" || value === "入金済み") return PAYMENT_STATUS_PAID;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return PAYMENT_STATUS_CANCELLED;
  return status || "";
}

function statusBadge(status) {
  const value = normalizePaymentStatus(status);
  const type = value === PAYMENT_STATUS_CANCELLED ? "danger" : value === PAYMENT_STATUS_PAID ? "ok" : value === PAYMENT_STATUS_WAITING ? "warn" : "info";
  return `<span class="status-badge ${type}">${escapeHtml(value || "未設定")}</span>`;
}

function readPaymentCustomers() {
  if (window.SalesCustomerStorage?.readCustomers) return window.SalesCustomerStorage.readCustomers();
  try {
    return JSON.parse(localStorage.getItem("arico_sales_customers_v1") || "[]");
  } catch (_) {
    return [];
  }
}

function samePaymentCustomerKey(a, b) {
  return String(a || "").trim() && String(a || "").trim() === String(b || "").trim();
}

function resolvePaymentCustomer(invoice) {
  const customers = readPaymentCustomers();
  if (!customers.length) return null;
  return customers.find(customer =>
    samePaymentCustomerKey(customer.id, invoice.customerId) ||
    samePaymentCustomerKey(customer.customerId, invoice.customerId) ||
    samePaymentCustomerKey(customer.customerCode, invoice.customerCode) ||
    samePaymentCustomerKey(customer.code, invoice.customerCode) ||
    samePaymentCustomerKey(customer.smaregiMemberId, invoice.smaregiCustomerId) ||
    samePaymentCustomerKey(customer.smaregiCustomerId, invoice.smaregiCustomerId) ||
    samePaymentCustomerKey(customer.smaregiMemberCode, invoice.smaregiCustomerCode) ||
    samePaymentCustomerKey(customer.smaregiCustomerCode, invoice.smaregiCustomerCode)
  ) || null;
}

function getPaymentCustomerView(invoice) {
  const customer = resolvePaymentCustomer(invoice) || {};
  const info = invoice?.customerInfo || invoice?.customer_info || invoice?.customerDetail || {};
  return {
    customerName: customer.customerName || customer.name || invoice.customerName || invoice.name || invoice.customer || invoice.clientName || info.customerName || info.name || "",
    organizationName: customer.organizationName || customer.organization || customer.companyName || invoice.organizationName || invoice.organization || invoice.companyName || info.organizationName || info.organization || info.companyName || "",
    customerType: customer.customerType || invoice.customerType || info.customerType || "",
    address: customer.address || invoice.address || info.address || "",
    phone: customer.phone || invoice.phone || info.phone || info.tel || "",
    email: customer.email || invoice.email || info.email || ""
  };
}

function getPaymentInvoiceLines(invoice) {
  const candidates = [invoice?.items, invoice?.lines, invoice?.products, invoice?.details];
  return candidates.find(value => Array.isArray(value) && value.length) || [];
}

function recalcPaymentLine(line) {
  const qty = Number(line.qty || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const discountValue = Number(line.discountValue ?? line.discountRate ?? 0);
  const gross = Math.round(qty * unitPrice);
  const fixedDiscount = Math.max(0, Number(line.discountAmountInput || line.fixedDiscountAmount || line.manualDiscountAmount || 0));
  line.discountAmount = Math.min(gross, fixedDiscount > 0 ? fixedDiscount : Math.round(gross * discountValue / 100));
  line.amount = Math.max(0, gross - line.discountAmount);
  return line;
}

function calcInvoiceTotal(invoice) {
  return getPaymentInvoiceLines(invoice).reduce((total, line) => total + Number(recalcPaymentLine(line).amount || 0), 0);
}

function getInvoicePayments(invoice) {
  return Array.isArray(invoice?.payments) ? invoice.payments : [];
}

function getActivePayments(invoice) {
  return getInvoicePayments(invoice).filter(payment => payment.status !== "canceled");
}

function getPaidTotal(invoice) {
  return getActivePayments(invoice).reduce((total, payment) => total + Number(payment.amount || 0), 0);
}

function getLatestActivePayment(invoice) {
  return getActivePayments(invoice).slice().sort((a, b) => String(b.paymentDate || b.createdAt).localeCompare(String(a.paymentDate || a.createdAt)))[0] || null;
}

function getLatestPaymentDate(invoice) {
  const payment = getLatestActivePayment(invoice);
  return payment ? payment.paymentDate || normalizeDateOnly(payment.createdAt) : "";
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP");
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
  bindPaymentListControls();
  clearPaymentForm();
  renderPaymentInvoiceList();
  const id = new URLSearchParams(location.search).get("id");
  if (id) selectPaymentInvoice(id);
});

function bindPaymentListControls() {
  const search = document.getElementById("paymentInvoiceSearch");
  const status = document.getElementById("paymentInvoiceStatusFilter");
  const dateFrom = document.getElementById("paymentInvoiceDateFromFilter");
  const dateTo = document.getElementById("paymentInvoiceDateToFilter");
  if (search) {
    search.addEventListener("input", () => {
      paymentSearchText = search.value.trim().toLowerCase();
      renderPaymentInvoiceList();
    });
  }
  if (status) {
    status.addEventListener("change", () => {
      paymentStatusFilter = status.value;
      renderPaymentInvoiceList();
    });
  }
  if (dateFrom) {
    dateFrom.addEventListener("input", () => {
      paymentDateFrom = dateFrom.value;
      renderPaymentInvoiceList();
    });
  }
  if (dateTo) {
    dateTo.addEventListener("input", () => {
      paymentDateTo = dateTo.value;
      renderPaymentInvoiceList();
    });
  }
  setPaymentListCollapsed(false);
}

function togglePaymentInvoiceList() {
  setPaymentListCollapsed(!paymentListCollapsed);
}

function setPaymentListCollapsed(collapsed) {
  paymentListCollapsed = collapsed;
  const listPanel = document.getElementById("paymentInvoiceListPanel");
  const panel = document.getElementById("paymentCompletedListPanel");
  const button = document.getElementById("paymentInvoiceListToggle");
  if (listPanel) listPanel.hidden = paymentListCollapsed;
  if (panel) panel.hidden = paymentListCollapsed;
  if (button) button.textContent = paymentListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function getPaymentTargetInvoices() {
  return readPaymentInvoices()
    .filter(invoice => PAYMENT_TARGET_STATUSES.includes(normalizePaymentStatus(invoice.status)))
    .sort((a, b) => String(b.issuedAt || b.invoiceDate || b.createdAt).localeCompare(String(a.issuedAt || a.invoiceDate || a.createdAt)));
}

function renderPaymentInvoiceList() {
  const body = document.getElementById("paymentInvoiceListBody");
  const completedBody = document.getElementById("paymentCompletedListBody");
  const allInvoices = getPaymentTargetInvoices();
  const invoices = allInvoices.filter(matchesPaymentInvoiceFilters);
  const activeInvoices = invoices.filter(invoice => {
    const status = normalizePaymentStatus(invoice.status);
    return status === PAYMENT_STATUS_ISSUED || status === PAYMENT_STATUS_WAITING;
  });
  const completedInvoices = invoices.filter(invoice => {
    const status = normalizePaymentStatus(invoice.status);
    return status === PAYMENT_STATUS_PAID || status === PAYMENT_STATUS_CANCELLED;
  });
  const count = document.getElementById("paymentInvoiceListCount");
  if (count) count.textContent = paymentSearchText || paymentStatusFilter || paymentDateFrom || paymentDateTo
    ? `入金待ち ${activeInvoices.length}件 / 全${invoices.length}件`
    : `入金待ち ${activeInvoices.length}件`;
  if (!body) return;
  body.innerHTML = activeInvoices.length ? activeInvoices.map(renderPaymentInvoiceRow).join("") : '<tr><td colspan="9">対応が必要な入金確認はありません。</td></tr>';
  if (completedBody) {
    completedBody.innerHTML = completedInvoices.length ? completedInvoices.map(renderPaymentInvoiceRow).join("") : '<tr><td colspan="9">完了済み・キャンセル済みの入金確認はありません。</td></tr>';
  }
}

function renderPaymentInvoiceRow(invoice) {
  const total = calcInvoiceTotal(invoice);
  const status = normalizePaymentStatus(invoice.status);
  const paymentDate = getLatestPaymentDate(invoice);
  const customerView = getPaymentCustomerView(invoice);
  const customerLabel = [customerView.organizationName, customerView.customerName].filter(Boolean).join(" / ");
  const cancelButton = status === PAYMENT_STATUS_PAID
    ? `<button type="button" class="danger" onclick="cancelPayment('${invoice.id}')">&#20837;&#37329;&#21462;&#28040;</button>`
    : "";
  return `<tr>
    <td><span class="number-with-status">${escapeHtml(invoice.invoiceNo || "")} ${statusBadge(status)}</span></td>
    <td>${escapeHtml(invoice.invoiceDate || "")}</td>
    <td>${escapeHtml(paymentDate || "")}</td>
    <td>${escapeHtml(invoice.dueDate || "")}</td>
    <td>${escapeHtml(customerLabel || customerView.customerName)}</td>
    <td>${money(total)}</td>
    <td>${statusBadge(status)}</td>
    <td>${escapeHtml(invoice.staff || "")}</td>
    <td><button type="button" class="secondary" onclick="selectPaymentInvoice('${invoice.id}')">&#36984;&#25246;</button>${cancelButton}</td>
  </tr>`;
}

function matchesPaymentInvoiceFilters(invoice) {
  const status = normalizePaymentStatus(invoice.status);
  const customerView = getPaymentCustomerView(invoice);
  if (paymentStatusFilter && status !== paymentStatusFilter) return false;
  if (!matchesDateRange([invoice.invoiceDate, invoice.issuedAt, invoice.dueDate], paymentDateFrom, paymentDateTo)) return false;
  if (!paymentSearchText) return true;
  const text = [
    invoice.invoiceNo,
    customerView.customerName,
    customerView.organizationName,
    invoice.staff,
    invoice.subject,
    status,
    invoice.status,
    invoice.invoiceDate,
    invoice.issuedAt,
    invoice.dueDate
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(paymentSearchText);
}

function clearPaymentForm() {
  selectedPaymentInvoiceId = null;
  document.getElementById("paymentInvoiceNo").value = "";
  document.getElementById("paymentCustomerName").value = "";
  document.getElementById("paymentInvoiceTotal").value = "";
  ["paymentOrganizationName", "paymentCustomerType", "paymentCustomerAddress", "paymentCustomerPhone", "paymentCustomerEmail"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("paymentDate").value = today();
  document.getElementById("paymentAmount").value = "";
  document.getElementById("paymentMethod").value = "振込";
  document.getElementById("paymentPayerName").value = "";
  document.getElementById("paymentStaff").value = "";
  document.getElementById("paymentCurrentStatus").value = "";
  document.getElementById("paymentMemo").value = "";
  document.getElementById("paymentInvoiceLink").href = "invoices.html";
  renderPaymentHistory(null);
}

function selectPaymentInvoice(id) {
  const invoice = readPaymentInvoices().find(row => row.id === id);
  if (!invoice) {
    showSalesPopup("選択失敗", "請求書が見つかりません。", "err");
    return;
  }
  selectedPaymentInvoiceId = invoice.id;
  const total = calcInvoiceTotal(invoice);
  const paid = getPaidTotal(invoice);
  const customerView = getPaymentCustomerView(invoice);
  document.getElementById("paymentInvoiceNo").value = invoice.invoiceNo || "";
  document.getElementById("paymentCustomerName").value = customerView.customerName || "";
  const setReadonlyCustomer = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
  };
  setReadonlyCustomer("paymentOrganizationName", customerView.organizationName);
  setReadonlyCustomer("paymentCustomerType", customerView.customerType);
  setReadonlyCustomer("paymentCustomerAddress", customerView.address);
  setReadonlyCustomer("paymentCustomerPhone", customerView.phone);
  setReadonlyCustomer("paymentCustomerEmail", customerView.email);
  document.getElementById("paymentInvoiceTotal").value = `${money(total)}（入金済 ${money(paid)}）`;
  document.getElementById("paymentDate").value = today();
  document.getElementById("paymentAmount").value = Math.max(0, total - paid);
  document.getElementById("paymentMethod").value = "振込";
  document.getElementById("paymentPayerName").value = customerView.customerName || "";
  document.getElementById("paymentStaff").value = invoice.staff || "";
  document.getElementById("paymentCurrentStatus").value = normalizePaymentStatus(invoice.status);
  document.getElementById("paymentMemo").value = "";
  document.getElementById("paymentInvoiceLink").href = `invoices.html?id=${encodeURIComponent(invoice.id)}`;
  renderPaymentHistory(invoice);
  scrollToPaymentEditor();
  showSalesMessage(`${invoice.invoiceNo || ""} の入金確認を入力できます。`, "ok");
}

function scrollToPaymentEditor() {
  const target = document.getElementById("paymentEditorCard");
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("section-focus-highlight");
  window.setTimeout(() => target.classList.remove("section-focus-highlight"), 1800);
}

function savePayment() {
  if (!selectedPaymentInvoiceId) {
    showSalesPopup("請求書未選択", "入金確認する請求書を選択してください。", "warn");
    return;
  }
  const amount = Number(document.getElementById("paymentAmount").value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    showSalesPopup("入力確認", "入金額を1円以上で入力してください。", "warn");
    return;
  }
  const invoices = readPaymentInvoices();
  const index = invoices.findIndex(row => row.id === selectedPaymentInvoiceId);
  if (index < 0) {
    showSalesPopup("保存失敗", "請求書が見つかりません。", "err");
    return;
  }
  const invoice = invoices[index];
  const now = new Date().toISOString();
  const previousStatus = normalizePaymentStatus(invoice.status);
  const payment = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    paymentDate: document.getElementById("paymentDate").value || today(),
    amount,
    method: "振込",
    payerName: document.getElementById("paymentPayerName").value.trim(),
    staff: document.getElementById("paymentStaff").value.trim(),
    memo: document.getElementById("paymentMemo").value,
    status: "confirmed",
    previousStatus,
    createdAt: now
  };
  invoice.payments = [...getInvoicePayments(invoice), payment];
  invoice.paymentUpdatedAt = now;
  invoice.updatedAt = now;
  invoice.status = getPaidTotal(invoice) >= calcInvoiceTotal(invoice) ? PAYMENT_STATUS_PAID : PAYMENT_STATUS_WAITING;
  if (invoice.status === PAYMENT_STATUS_PAID) {
    invoice.paidAt = now;
    invoice.paymentDate = payment.paymentDate;
    invoice.paidAmount = getPaidTotal(invoice);
  }
  invoices[index] = invoice;
  writePaymentInvoices(invoices);
  selectPaymentInvoice(invoice.id);
  renderPaymentInvoiceList();
  showSalesPopup("入金確認を保存しました", `${invoice.invoiceNo || ""}\nステータス: ${invoice.status}`, "ok");
}

async function cancelPayment(id) {
  const invoices = readPaymentInvoices();
  const index = invoices.findIndex(row => row.id === id);
  if (index < 0) {
    showSalesPopup("取消失敗", "請求書が見つかりません。", "err");
    return;
  }
  const confirmed = await confirmSalesPopup("入金確認取消", "この入金確認を取り消しますか？", "warn");
  if (!confirmed) return;
  const invoice = invoices[index];
  const payment = getLatestActivePayment(invoice);
  if (!payment) {
    showSalesPopup("取消不可", "取り消せる入金履歴がありません。", "warn");
    return;
  }
  const now = new Date().toISOString();
  payment.status = "canceled";
  payment.canceledAt = now;
  payment.canceledBy = document.getElementById("paymentStaff")?.value.trim() || payment.staff || "";
  payment.cancelReason = "";
  const activePaidTotal = getPaidTotal(invoice);
  const invoiceTotal = calcInvoiceTotal(invoice);
  if (activePaidTotal >= invoiceTotal) {
    invoice.status = PAYMENT_STATUS_PAID;
    invoice.paidAmount = activePaidTotal;
  } else if (activePaidTotal > 0) {
    invoice.status = PAYMENT_STATUS_WAITING;
    delete invoice.paidAt;
    delete invoice.paymentDate;
    invoice.paidAmount = activePaidTotal;
  } else {
    invoice.status = payment.previousStatus === PAYMENT_STATUS_ISSUED ? PAYMENT_STATUS_ISSUED : PAYMENT_STATUS_WAITING;
    delete invoice.paidAt;
    delete invoice.paymentDate;
    delete invoice.paidAmount;
  }
  invoice.paymentUpdatedAt = now;
  invoice.updatedAt = now;
  invoices[index] = invoice;
  writePaymentInvoices(invoices);
  selectPaymentInvoice(invoice.id);
  renderPaymentInvoiceList();
  showSalesPopup("入金確認を取り消しました", `${invoice.invoiceNo || ""}\nステータス: ${invoice.status}`, "ok");
}

function renderPaymentHistory(invoice) {
  const area = document.getElementById("paymentHistory");
  if (!area) return;
  if (!invoice) {
    area.innerHTML = '<div class="message">請求書を選択すると入金履歴を表示します。</div>';
    return;
  }
  const payments = getInvoicePayments(invoice).slice().sort((a, b) => String(b.paymentDate || b.createdAt).localeCompare(String(a.paymentDate || a.createdAt)));
  if (!payments.length) {
    area.innerHTML = '<div class="message warn">入金履歴はまだありません。</div>';
    return;
  }
  area.innerHTML = `<div class="table-wrap payment-history-table"><table>
    <thead><tr><th>入金日</th><th>入金額</th><th>振込名義</th><th>担当者</th><th>ステータス</th><th>メモ</th><th>取消日時</th></tr></thead>
    <tbody>${payments.map(payment => `<tr>
      <td>${escapeHtml(payment.paymentDate || "")}</td>
      <td>${money(payment.amount)}</td>
      <td>${escapeHtml(payment.payerName || "")}</td>
      <td>${escapeHtml(payment.staff || "")}</td>
      <td>${payment.status === "canceled" ? '<span class="status-badge danger">取消済み</span>' : '<span class="status-badge ok">入金確認済み</span>'}</td>
      <td>${escapeHtml(payment.memo || "")}</td>
      <td>${escapeHtml(formatDateTime(payment.canceledAt))}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}
