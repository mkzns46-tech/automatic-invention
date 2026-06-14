const DELIVERIES_KEY = "arico_sales_deliveries_v1";
const DELIVERY_STATUS_DRAFT = "未発行";
const DELIVERY_STATUS_ISSUED = "発行済み";
const DELIVERY_STATUS_CANCELLED = "キャンセル";

let currentDeliveryId = null;
let deliverySearchText = "";
let deliveryStatusFilter = "";
let deliveryDateFrom = "";
let deliveryDateTo = "";
let deliveryListCollapsed = false;

function readDeliveries() {
  return JSON.parse(localStorage.getItem(DELIVERIES_KEY) || "[]");
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

function normalizeDeliveryStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "未発行") return DELIVERY_STATUS_DRAFT;
  if (value === "issued" || value === "発行済み") return DELIVERY_STATUS_ISSUED;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return DELIVERY_STATUS_CANCELLED;
  return status || DELIVERY_STATUS_DRAFT;
}

function statusBadge(status) {
  const value = normalizeDeliveryStatus(status);
  const type = value === DELIVERY_STATUS_CANCELLED ? "danger" : value === DELIVERY_STATUS_ISSUED ? "ok" : "muted";
  return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
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

function recalcDeliveryLine(line) {
  const qty = Number(line.qty || 0);
  const unitPrice = Number(line.unitPrice || 0);
  const discountValue = Number(line.discountValue ?? line.discountRate ?? 0);
  const gross = Math.round(qty * unitPrice);
  const fixedDiscount = Math.max(0, Number(line.discountAmountInput || line.fixedDiscountAmount || line.manualDiscountAmount || 0));
  line.discountAmount = Math.min(gross, fixedDiscount > 0 ? fixedDiscount : Math.round(gross * discountValue / 100));
  line.amount = Math.max(0, gross - line.discountAmount);
  return line;
}

function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  bindDeliveryListControls();
  renderDeliveryList();
  const id = new URLSearchParams(location.search).get("id");
  if (id) selectDelivery(id);
  else clearDeliveryDetail();
});

function bindDeliveryListControls() {
  document.getElementById("deliverySearch")?.addEventListener("input", event => {
    deliverySearchText = event.target.value.trim().toLowerCase();
    renderDeliveryList();
  });
  document.getElementById("deliveryStatusFilter")?.addEventListener("change", event => {
    deliveryStatusFilter = event.target.value;
    renderDeliveryList();
  });
  document.getElementById("deliveryDateFromFilter")?.addEventListener("input", event => {
    deliveryDateFrom = event.target.value;
    renderDeliveryList();
  });
  document.getElementById("deliveryDateToFilter")?.addEventListener("input", event => {
    deliveryDateTo = event.target.value;
    renderDeliveryList();
  });
  setDeliveryListCollapsed(false);
}

function toggleDeliveryCompletedList() {
  setDeliveryListCollapsed(!deliveryListCollapsed);
}

function setDeliveryListCollapsed(collapsed) {
  deliveryListCollapsed = collapsed;
  const listPanel = document.getElementById("deliveryListPanel");
  const panel = document.getElementById("deliveryCompletedListPanel");
  const button = document.getElementById("deliveryCompletedToggle");
  if (listPanel) listPanel.hidden = deliveryListCollapsed;
  if (panel) panel.hidden = deliveryListCollapsed;
  if (button) button.textContent = deliveryListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function renderDeliveryList() {
  const allDeliveries = readDeliveries().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const deliveries = allDeliveries.filter(matchesDeliveryFilters);
  const activeDeliveries = deliveries.filter(delivery => normalizeDeliveryStatus(delivery.status) === DELIVERY_STATUS_DRAFT);
  const completedDeliveries = deliveries.filter(delivery => normalizeDeliveryStatus(delivery.status) !== DELIVERY_STATUS_DRAFT);
  const count = document.getElementById("deliveryListCount");
  if (count) count.textContent = deliverySearchText || deliveryStatusFilter || deliveryDateFrom || deliveryDateTo
    ? `未発行 ${activeDeliveries.length}件 / 全${deliveries.length}件`
    : `未発行 ${activeDeliveries.length}件`;
  document.getElementById("deliveryListBody").innerHTML = activeDeliveries.length
    ? activeDeliveries.map(renderDeliveryRow).join("")
    : '<tr><td colspan="8">対応が必要な納品書はありません。</td></tr>';
  document.getElementById("deliveryCompletedListBody").innerHTML = completedDeliveries.length
    ? completedDeliveries.map(renderDeliveryRow).join("")
    : '<tr><td colspan="8">完了済み・キャンセル済みの納品書はありません。</td></tr>';
}

function renderDeliveryRow(delivery) {
  const status = normalizeDeliveryStatus(delivery.status);
  const displayNumber = delivery.originNumber || delivery.masterNumber || delivery.quoteNumber || delivery.deliveryNo || "";
  return `<tr>
    <td><span class="number-with-status">${escapeHtml(displayNumber)} ${statusBadge(status)}</span></td>
    <td>${escapeHtml(normalizeDateOnly(delivery.issuedAt) || delivery.deliveryDate || delivery.invoiceDate || "")}</td>
    <td>${escapeHtml(delivery.organizationName || delivery.organization || delivery.companyName || "")}</td>
    <td>${escapeHtml(delivery.customerName || delivery.name || delivery.customer || "")}</td>
    <td>${money(delivery.total)}</td>
    <td>${statusBadge(status)}</td>
    <td>${escapeHtml(delivery.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="selectDelivery('${delivery.id}')">&#35443;&#32048;</button>
      <button type="button" class="secondary" onclick="printDeliveryById('${delivery.id}')">PDF&#20986;&#21147;</button>
    </td>
  </tr>`;
}

function matchesDeliveryFilters(delivery) {
  const status = normalizeDeliveryStatus(delivery.status);
  if (deliveryStatusFilter && status !== deliveryStatusFilter) return false;
  if (!matchesDateRange([delivery.createdAt, delivery.invoiceDate, delivery.issuedAt], deliveryDateFrom, deliveryDateTo)) return false;
  if (!deliverySearchText) return true;
  const text = [
    delivery.originNumber,
    delivery.masterNumber,
    delivery.quoteNumber,
    delivery.deliveryNo,
    delivery.sourceInvoiceNo,
    delivery.customerName,
    delivery.staff,
    delivery.subject,
    status,
    delivery.status
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(deliverySearchText);
}

function clearDeliveryDetail() {
  currentDeliveryId = null;
  ["deliveryNo", "sourceInvoiceNo", "deliveryStatus", "deliveryCustomerName", "deliveryCustomerType", "deliveryStaff", "deliveryAddress", "deliveryPhone", "deliveryEmail", "deliverySubject", "deliveryInvoiceDate", "deliveryIssuedAt"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("deliveryLines").innerHTML = '<div class="message">納品書を選択してください。</div>';
  updateTotals({});
}

function selectDelivery(id) {
  const delivery = readDeliveries().find(row => row.id === id);
  if (!delivery) {
    showSalesMessage("納品書が見つかりません。", "err");
    return;
  }
  currentDeliveryId = delivery.id;
  document.getElementById("deliveryNo").value = delivery.deliveryNo || "";
  document.getElementById("sourceInvoiceNo").value = delivery.sourceInvoiceNo || "";
  document.getElementById("deliveryStatus").value = normalizeDeliveryStatus(delivery.status);
  document.getElementById("deliveryCustomerName").value = delivery.customerName || "";
  document.getElementById("deliveryCustomerType").value = delivery.customerType || "";
  document.getElementById("deliveryStaff").value = delivery.staff || "";
  document.getElementById("deliveryAddress").value = delivery.address || "";
  document.getElementById("deliveryPhone").value = delivery.phone || "";
  document.getElementById("deliveryEmail").value = delivery.email || "";
  document.getElementById("deliverySubject").value = delivery.subject || "";
  document.getElementById("deliveryInvoiceDate").value = delivery.invoiceDate || "";
  document.getElementById("deliveryIssuedAt").value = formatDateTime(delivery.issuedAt);
  renderDeliveryLines(delivery);
  updateTotals(delivery);
  history.replaceState(null, "", `delivery.html?id=${encodeURIComponent(delivery.id)}`);
  showSalesMessage(`${delivery.deliveryNo || ""} を表示しています。`, "ok");
}

function renderDeliveryLines(delivery) {
  const area = document.getElementById("deliveryLines");
  const lines = delivery.lines || [];
  area.innerHTML = lines.length ? lines.map(line => {
    recalcDeliveryLine(line);
    return `<div class="invoice-line">
      <label>商品名<input value="${escapeHtml(line.name || "")}" readonly></label>
      <label>数量<input value="${Number(line.qty || 0)}" readonly></label>
      <label>単位<input value="${escapeHtml(line.unit || "")}" readonly></label>
      <label>税込単価<input value="${Number(line.unitPrice || 0)}" readonly></label>
      <label>値引率%<input value="${Number(line.discountValue || 0)}" readonly></label>
      <label>金額<div class="line-amount">${money(line.amount)}</div></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" readonly></label>
    </div>`;
  }).join("") : '<div class="message">納品商品がありません。</div>';
}

function updateTotals(delivery) {
  document.getElementById("deliverySubtotalText").textContent = money(delivery.subtotal);
  document.getElementById("deliveryDiscountText").textContent = money(delivery.discount);
  document.getElementById("deliveryTotalText").textContent = money(delivery.total);
  document.getElementById("deliveryTaxText").textContent = money(delivery.tax);
}

function outputCurrentDeliveryPdf() {
  const delivery = readDeliveries().find(row => row.id === currentDeliveryId);
  if (delivery) printDeliveryPdf(delivery);
}

function printDeliveryById(id) {
  const delivery = readDeliveries().find(row => row.id === id);
  if (delivery) printDeliveryPdf(delivery);
}
