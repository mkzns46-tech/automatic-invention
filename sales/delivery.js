const DELIVERIES_KEY = "arico_sales_deliveries_v1";
const DELIVERY_STATUS_DRAFT = "未発行";
const DELIVERY_STATUS_ISSUED = "納品書発行済";
const DELIVERY_STATUS_SHIPPED = "発送済";
const DELIVERY_STATUS_CANCELLED = "キャンセル";

let currentDeliveryId = null;
let deliverySearchText = "";
let deliveryStatusFilter = "";
let deliveryDateFrom = "";
let deliveryDateTo = "";
let deliveryListCollapsed = false;

function readDeliveries() {
  try {
    return JSON.parse(localStorage.getItem(DELIVERIES_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function writeDeliveries(deliveries) {
  localStorage.setItem(DELIVERIES_KEY, JSON.stringify(deliveries));
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
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
}

function isRefundDelivery(deliveryOrType) {
  const type = typeof deliveryOrType === "string" ? deliveryOrType : deliveryOrType?.transactionType;
  return String(type || "").trim() === "返金";
}

function amountClass(value, deliveryOrType = "") {
  return Number(value || 0) < 0 || isRefundDelivery(deliveryOrType) ? "amount-negative refund-amount" : "";
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
  return extractSlipNumber(b.originNumber || b.masterNumber || b.quoteNumber || b.deliveryNo) - extractSlipNumber(a.originNumber || a.masterNumber || a.quoteNumber || a.deliveryNo);
}

function normalizeDeliveryStatus(status) {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (!value || lower === "draft" || value === "未発行") return DELIVERY_STATUS_DRAFT;
  if (lower === "issued" || value === "発行済み" || value === "納品書発行済" || value === "発送準備中") return DELIVERY_STATUS_ISSUED;
  if (lower === "shipped" || value === "発送済" || value === "納品済み") return DELIVERY_STATUS_SHIPPED;
  if (lower === "cancel" || lower === "cancelled" || lower === "canceled" || value === "キャンセル") return DELIVERY_STATUS_CANCELLED;
  return value;
}

function statusBadge(status) {
  const value = normalizeDeliveryStatus(status);
  const type = value === DELIVERY_STATUS_CANCELLED
    ? "danger"
    : value === DELIVERY_STATUS_SHIPPED
      ? "ok"
      : value === DELIVERY_STATUS_ISSUED
        ? "info"
        : "muted";
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
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ja-JP");
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
  const transactionType = line.transactionType || "";
  const qty = Number(line.qty || line.quantity || 0);
  const unitPrice = Number(line.unitPrice || line.price || 0);
  const discountValue = Number(line.discountValue ?? line.discountRate ?? 0);
  const gross = Math.max(0, Math.round(Math.abs(qty) * Math.abs(unitPrice)));
  const fixedSource = line.discountAmount ?? line.discountAmountInput ?? line.fixedDiscountAmount ?? line.manualDiscountAmount ?? 0;
  const fixedDiscount = Math.max(0, Number(fixedSource));
  line.discountAmount = Math.min(gross, fixedDiscount > 0 ? fixedDiscount : Math.round(gross * discountValue / 100));
  const netAmount = Math.max(0, gross - line.discountAmount);
  line.amount = isRefundDelivery(transactionType) ? -netAmount : netAmount;
  return line;
}

function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

function playNotifySound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.08);
  } catch (_) {
    // Popup remains visible even when browser blocks sound.
  }
}

function showSalesPopup(title, body, type = "ok") {
  const popup = document.getElementById("salesPopup");
  const titleEl = document.getElementById("salesPopupTitle");
  const bodyEl = document.getElementById("salesPopupBody");
  const close = document.getElementById("salesPopupClose");
  if (!popup || !titleEl || !bodyEl) {
    showSalesMessage(body || title, type);
    return;
  }
  titleEl.textContent = title || "完了";
  bodyEl.textContent = body || "";
  popup.dataset.type = type;
  popup.style.display = "flex";
  if (close) close.onclick = () => { popup.style.display = "none"; };
  playNotifySound();
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

function toggleDeliveryList() {
  setDeliveryListCollapsed(!deliveryListCollapsed);
}

function setDeliveryListCollapsed(collapsed) {
  deliveryListCollapsed = collapsed;
  const listPanel = document.getElementById("deliveryListPanel");
  const button = document.getElementById("deliveryListToggle");
  if (listPanel) listPanel.hidden = deliveryListCollapsed;
  if (button) button.textContent = deliveryListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function renderDeliveryList() {
  const allDeliveries = readDeliveries().sort(sortNewestFirst);
  const deliveries = allDeliveries.filter(matchesDeliveryFilters);
  const activeDeliveries = deliveries.filter(delivery => {
    const status = normalizeDeliveryStatus(delivery.status);
    return status !== DELIVERY_STATUS_SHIPPED && status !== DELIVERY_STATUS_CANCELLED;
  });
  const completedDeliveries = deliveries.filter(delivery => {
    const status = normalizeDeliveryStatus(delivery.status);
    return status === DELIVERY_STATUS_SHIPPED || status === DELIVERY_STATUS_CANCELLED;
  });
  const count = document.getElementById("deliveryListCount");
  if (count) count.textContent = deliverySearchText || deliveryStatusFilter || deliveryDateFrom || deliveryDateTo
    ? `対応 ${activeDeliveries.length}件 / 全${deliveries.length}件`
    : `対応 ${activeDeliveries.length}件`;
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
    <td>${escapeHtml(normalizeDateOnly(delivery.shipmentDate) || normalizeDateOnly(delivery.issuedAt) || delivery.deliveryDate || delivery.invoiceDate || "")}</td>
    <td>${escapeHtml(delivery.organizationName || delivery.organization || delivery.companyName || "")}</td>
    <td>${escapeHtml(delivery.customerName || delivery.name || delivery.customer || "")}</td>
    <td class="${amountClass(delivery.total, delivery)}">${money(delivery.total)}</td>
    <td>${statusBadge(status)}</td>
    <td>${escapeHtml(delivery.shippingStaff || delivery.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="selectDelivery('${delivery.id}')">詳細</button>
      <button type="button" class="secondary" onclick="printDeliveryById('${delivery.id}')">PDF出力</button>
      ${status !== DELIVERY_STATUS_SHIPPED && status !== DELIVERY_STATUS_CANCELLED ? `<button type="button" class="invoice-issue-button" onclick="quickShipDelivery('${delivery.id}')">発送済</button>` : ""}
    </td>
  </tr>`;
}

function matchesDeliveryFilters(delivery) {
  const status = normalizeDeliveryStatus(delivery.status);
  if (deliveryStatusFilter === "未発送") {
    if (status === DELIVERY_STATUS_SHIPPED || status === DELIVERY_STATUS_CANCELLED) return false;
  } else if (deliveryStatusFilter === "完了済") {
    if (status !== DELIVERY_STATUS_SHIPPED) return false;
  } else if (deliveryStatusFilter && status !== deliveryStatusFilter) {
    return false;
  }
  if (!matchesDateRange([delivery.createdAt, delivery.invoiceDate, delivery.issuedAt, delivery.shipmentDate, delivery.updatedAt], deliveryDateFrom, deliveryDateTo)) return false;
  if (!deliverySearchText) return true;
  const text = [
    delivery.originNumber,
    delivery.masterNumber,
    delivery.quoteNumber,
    delivery.deliveryNo,
    delivery.sourceInvoiceNo,
    delivery.organizationName,
    delivery.customerName,
    delivery.shippingCarrier,
    delivery.trackingNumber,
    delivery.shippingStaff,
    delivery.staff,
    delivery.subject,
    status,
    delivery.status
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(deliverySearchText);
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function clearDeliveryDetail() {
  currentDeliveryId = null;
  [
    "deliveryNo",
    "sourceInvoiceNo",
    "deliveryStatus",
    "deliveryCustomerName",
    "deliveryCustomerType",
    "deliveryStaff",
    "deliveryAddress",
    "deliveryPhone",
    "deliveryEmail",
    "deliverySubject",
    "deliveryInvoiceDate",
    "deliveryIssuedAt",
    "shipmentDate",
    "shippingCarrier",
    "trackingNumber",
    "shippingStaff",
    "shippingMemo"
  ].forEach(id => setFieldValue(id, ""));
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
  setFieldValue("deliveryNo", delivery.deliveryNo || "");
  setFieldValue("sourceInvoiceNo", delivery.sourceInvoiceNo || "");
  setFieldValue("deliveryStatus", normalizeDeliveryStatus(delivery.status));
  setFieldValue("deliveryCustomerName", delivery.customerName || "");
  setFieldValue("deliveryCustomerType", delivery.customerType || "");
  setFieldValue("deliveryStaff", delivery.staff || "");
  setFieldValue("deliveryAddress", delivery.address || "");
  setFieldValue("deliveryPhone", delivery.phone || "");
  setFieldValue("deliveryEmail", delivery.email || "");
  setFieldValue("deliverySubject", delivery.subject || "");
  setFieldValue("deliveryInvoiceDate", delivery.invoiceDate || "");
  setFieldValue("deliveryIssuedAt", formatDateTime(delivery.issuedAt));
  setFieldValue("shipmentDate", normalizeDateOnly(delivery.shipmentDate));
  setFieldValue("shippingCarrier", delivery.shippingCarrier || "");
  setFieldValue("trackingNumber", delivery.trackingNumber || "");
  setFieldValue("shippingStaff", delivery.shippingStaff || delivery.staff || "");
  setFieldValue("shippingMemo", delivery.shippingMemo || "");
  renderDeliveryLines(delivery);
  updateTotals(delivery);
  history.replaceState(null, "", `delivery.html?id=${encodeURIComponent(delivery.id)}`);
  showSalesMessage(`${delivery.deliveryNo || ""} を表示しています。`, "ok");
}

function renderDeliveryLines(delivery) {
  const area = document.getElementById("deliveryLines");
  const lines = delivery.lines || [];
  area.innerHTML = lines.length ? lines.map(line => {
    line.transactionType = line.transactionType || delivery.transactionType || "";
    recalcDeliveryLine(line);
    return `<div class="invoice-line">
      <label>商品名<input value="${escapeHtml(line.name || "")}" readonly></label>
      <label>数量<input value="${Number(line.qty || 0)}" readonly></label>
      <label>単位<input value="${escapeHtml(line.unit || "")}" readonly></label>
      <label>税込単価<input value="${Number(line.unitPrice || 0)}" readonly></label>
      <label>値引率%<input value="${Number(line.discountValue ?? line.discountRate ?? 0)}" readonly></label>
      <label>金額<div class="line-amount ${amountClass(line.amount, line.transactionType)}">${money(line.amount)}</div></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" readonly></label>
    </div>`;
  }).join("") : '<div class="message">納品商品がありません。</div>';
}

function updateTotals(delivery) {
  document.getElementById("deliverySubtotalText").textContent = money(delivery.subtotal);
  document.getElementById("deliveryDiscountText").textContent = money(delivery.discount);
  const totalText = document.getElementById("deliveryTotalText");
  totalText.textContent = money(delivery.total);
  totalText.classList.toggle("amount-negative", Number(delivery.total || 0) < 0 || isRefundDelivery(delivery));
  totalText.classList.toggle("refund-amount", Number(delivery.total || 0) < 0 || isRefundDelivery(delivery));
  document.getElementById("deliveryTaxText").textContent = money(delivery.tax);
}

function updateDelivery(id, updater) {
  const deliveries = readDeliveries();
  const index = deliveries.findIndex(row => row.id === id);
  if (index < 0) return null;
  const current = deliveries[index];
  const next = updater({ ...current }) || current;
  next.updatedAt = new Date().toISOString();
  deliveries[index] = next;
  writeDeliveries(deliveries);
  return next;
}

function markDeliveryIssuedById(id) {
  return updateDelivery(id, current => {
    const status = normalizeDeliveryStatus(current.status);
    if (status === DELIVERY_STATUS_CANCELLED || status === DELIVERY_STATUS_SHIPPED) return current;
    if (!current.issuedAt) current.issuedAt = new Date().toISOString();
    current.status = DELIVERY_STATUS_ISSUED;
    return current;
  });
}

function markCurrentDeliveryIssued() {
  if (!currentDeliveryId) {
    showSalesPopup("確認", "納品書を選択してください。", "warn");
    return;
  }
  const delivery = updateDelivery(currentDeliveryId, current => {
    if (normalizeDeliveryStatus(current.status) === DELIVERY_STATUS_CANCELLED) return current;
    if (!current.issuedAt) current.issuedAt = new Date().toISOString();
    current.status = DELIVERY_STATUS_ISSUED;
    return current;
  });
  if (!delivery) return;
  selectDelivery(delivery.id);
  renderDeliveryList();
  showSalesPopup("納品書発行", "納品書を発行済にしました。", "ok");
}

function collectShipmentFields(base = {}) {
  return {
    shipmentDate: document.getElementById("shipmentDate")?.value || base.shipmentDate || today(),
    shippingCarrier: document.getElementById("shippingCarrier")?.value || base.shippingCarrier || "",
    trackingNumber: document.getElementById("trackingNumber")?.value || base.trackingNumber || "",
    shippingStaff: document.getElementById("shippingStaff")?.value || base.shippingStaff || base.staff || "",
    shippingMemo: document.getElementById("shippingMemo")?.value || base.shippingMemo || ""
  };
}

function markCurrentDeliveryShipped() {
  if (!currentDeliveryId) {
    showSalesPopup("確認", "納品書を選択してください。", "warn");
    return;
  }
  const delivery = updateDelivery(currentDeliveryId, current => {
    const shipment = collectShipmentFields(current);
    if (!current.issuedAt) current.issuedAt = new Date().toISOString();
    current.status = DELIVERY_STATUS_SHIPPED;
    current.shipmentDate = shipment.shipmentDate;
    current.shippingCarrier = shipment.shippingCarrier;
    current.trackingNumber = shipment.trackingNumber;
    current.shippingStaff = shipment.shippingStaff;
    current.shippingMemo = shipment.shippingMemo;
    current.shippedAt = current.shippedAt || new Date().toISOString();
    return current;
  });
  if (!delivery) return;
  selectDelivery(delivery.id);
  renderDeliveryList();
  showSalesPopup("発送済登録", "発送済として登録しました。", "ok");
}

function quickShipDelivery(id) {
  const deliveries = readDeliveries();
  const delivery = deliveries.find(row => row.id === id);
  if (!delivery) return;
  currentDeliveryId = id;
  selectDelivery(id);
  const updated = updateDelivery(id, current => {
    if (!current.issuedAt) current.issuedAt = new Date().toISOString();
    current.status = DELIVERY_STATUS_SHIPPED;
    current.shipmentDate = current.shipmentDate || today();
    current.shippingCarrier = current.shippingCarrier || "";
    current.trackingNumber = current.trackingNumber || "";
    current.shippingStaff = current.shippingStaff || current.staff || "";
    current.shippedAt = current.shippedAt || new Date().toISOString();
    return current;
  });
  if (!updated) return;
  selectDelivery(updated.id);
  renderDeliveryList();
  showSalesPopup("発送済登録", "発送済として登録しました。必要に応じて発送情報を追記してください。", "ok");
}

function outputCurrentDeliveryPdf() {
  if (!currentDeliveryId) return;
  const issued = markDeliveryIssuedById(currentDeliveryId);
  const delivery = issued || readDeliveries().find(row => row.id === currentDeliveryId);
  if (delivery) {
    selectDelivery(delivery.id);
    renderDeliveryList();
    printDeliveryPdf(delivery);
  }
}

function printDeliveryById(id) {
  const issued = markDeliveryIssuedById(id);
  const delivery = issued || readDeliveries().find(row => row.id === id);
  if (delivery) {
    renderDeliveryList();
    printDeliveryPdf(delivery);
  }
}
