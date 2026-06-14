if (!window.ARICO_CUSTOMER_TYPES) {
  window.ARICO_CUSTOMER_TYPES = ["個人", "学校", "協会", "企業", "ショップ", "卸", "その他"];
}
var ARICO_CUSTOMER_TYPES = window.ARICO_CUSTOMER_TYPES;

let customerListCollapsed = false;
let customerSearchText = "";
let customerTypeFilter = "";
let customerDateFrom = "";
let customerDateTo = "";
let customerVisibleLimit = 50;
const CUSTOMER_INITIAL_LIMIT = 50;

function customerStorage() {
  if (window.SalesCustomerStorage) return window.SalesCustomerStorage;
  return {
    readCustomers: () => [],
    writeCustomers: () => {},
    normalizeCustomerType: value => ARICO_CUSTOMER_TYPES.includes(value) ? value : "個人",
    nextCustomerCode: () => "C-000001",
    upsertSmaregiCustomers: () => ({ imported: 0, created: 0, updated: 0, skipped: 0, total: 0 })
  };
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

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("ja-JP");
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function matchesDateRange(value, from, to) {
  if (!from && !to) return true;
  const date = normalizeDateOnly(value);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof requireSalesAuth === "function" && !requireSalesAuth()) return;
  if (!document.getElementById("customerListBody")) return;
  bindCustomerListControls();
  populateCustomerTypeOptions();
  clearCustomerForm();
  updateOrganizationSuggestions();
  renderCustomerList();
});

function populateCustomerTypeOptions() {
  const filter = document.getElementById("customerTypeFilter");
  if (filter && filter.options.length <= 1) {
    filter.innerHTML = '<option value="">全て</option>' + ARICO_CUSTOMER_TYPES.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  }
  const typeSelect = document.getElementById("customerType");
  if (typeSelect) {
    typeSelect.innerHTML = ARICO_CUSTOMER_TYPES.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  }
}

function bindCustomerListControls() {
  document.getElementById("customerSearch")?.addEventListener("input", event => {
    customerSearchText = normalizeSearchText(event.target.value);
    customerVisibleLimit = CUSTOMER_INITIAL_LIMIT;
    renderCustomerList();
  });
  document.getElementById("customerTypeFilter")?.addEventListener("change", event => {
    customerTypeFilter = event.target.value;
    customerVisibleLimit = CUSTOMER_INITIAL_LIMIT;
    renderCustomerList();
  });
  document.getElementById("customerDateFromFilter")?.addEventListener("input", event => {
    customerDateFrom = event.target.value;
    customerVisibleLimit = CUSTOMER_INITIAL_LIMIT;
    renderCustomerList();
  });
  document.getElementById("customerDateToFilter")?.addEventListener("input", event => {
    customerDateTo = event.target.value;
    customerVisibleLimit = CUSTOMER_INITIAL_LIMIT;
    renderCustomerList();
  });
  setCustomerListCollapsed(false);
}

function toggleCustomerList() {
  setCustomerListCollapsed(!customerListCollapsed);
}

function setCustomerListCollapsed(collapsed) {
  customerListCollapsed = collapsed;
  const panel = document.getElementById("customerListPanel");
  const button = document.getElementById("customerListToggle");
  if (panel) panel.hidden = customerListCollapsed;
  if (button) button.textContent = customerListCollapsed ? "一覧を開く" : "一覧を閉じる";
}

function extractCustomerNumber(value) {
  const matches = String(value || "").match(/\d+/g);
  return matches ? Number(matches[matches.length - 1]) : 0;
}

function sortCustomerNewestFirst(a, b) {
  const aDate = a.updatedAt || a.createdAt || "";
  const bDate = b.updatedAt || b.createdAt || "";
  if (aDate || bDate) {
    const diff = String(bDate).localeCompare(String(aDate));
    if (diff) return diff;
  }
  return extractCustomerNumber(b.customerCode || b.code) - extractCustomerNumber(a.customerCode || a.code);
}

function renderCustomerList() {
  const body = document.getElementById("customerListBody");
  if (!body) return;
  const allCustomers = customerStorage().readCustomers();
  const customers = allCustomers.filter(matchesCustomerFilters).sort(sortCustomerNewestFirst);
  const hasFilters = Boolean(customerSearchText || customerTypeFilter || customerDateFrom || customerDateTo);
  const visibleCustomers = hasFilters ? customers : customers.slice(0, customerVisibleLimit);
  const count = document.getElementById("customerListCount");
  if (count) count.textContent = hasFilters || customers.length <= visibleCustomers.length
    ? `${customers.length}件`
    : `${visibleCustomers.length}件 / 全${customers.length}件`;
  body.innerHTML = visibleCustomers.length ? visibleCustomers.map(customer => `<tr>
    <td>${escapeHtml(customer.customerCode)}</td>
    <td title="${escapeHtml(customer.customerName)}"><button type="button" class="link-button" onclick="showCustomerDetail('${escapeHtml(customer.id)}');">${escapeHtml(customer.customerName)}</button></td>
    <td title="${escapeHtml(customer.organizationName || "")}">${escapeHtml(customer.organizationName || "")}</td>
    <td>${escapeHtml(customer.customerType)}</td>
    <td>${escapeHtml(formatDate(customer.updatedAt))}</td>
    <td><button type="button" class="secondary" onclick="editCustomer('${escapeHtml(customer.id)}');">&#32232;&#38598;</button> ${canDeleteCustomer(customer) ? `<button type="button" class="danger" onclick="deleteCustomer('${escapeHtml(customer.id)}');">&#21066;&#38500;</button>` : ""}</td>
  </tr>`).join("") : '<tr><td colspan="6">顧客データはありません。</td></tr>';
  if (!hasFilters && customers.length > visibleCustomers.length) {
    body.innerHTML += `<tr><td colspan="6"><button type="button" class="secondary" onclick="showMoreCustomers();">さらに表示（次の${CUSTOMER_INITIAL_LIMIT}件）</button></td></tr>`;
  }
}

function showMoreCustomers() {
  customerVisibleLimit += CUSTOMER_INITIAL_LIMIT;
  renderCustomerList();
}

function getOrganizationNames() {
  return [...new Set(customerStorage().readCustomers()
    .map(customer => String(customer.organizationName || "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function updateOrganizationSuggestions() {
  const datalist = document.getElementById("customerOrganizationSuggestions");
  if (!datalist) return;
  datalist.innerHTML = getOrganizationNames()
    .slice(0, 300)
    .map(name => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function customerSyncBadge(customer) {
  const linked = Boolean(customer.smaregiCustomerId || customer.smaregiMemberId);
  return linked
    ? '<span class="status-badge ok">&#12473;&#12510;&#12524;&#12472;&#36899;&#25658;&#28168;</span>'
    : '<span class="status-badge muted">&#26410;&#36899;&#25658;</span>';
}

function startNewCustomerRegistration() {
  clearCustomerForm();
  showCustomerMessage("\u65b0\u898f\u9867\u5ba2\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002", "ok");
  document.getElementById("customerEditCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function readCustomerQuotes() {
  try {
    const rows = JSON.parse(localStorage.getItem("arico_sales_quotes_v1") || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function readCustomerInvoices() {
  try {
    const rows = JSON.parse(localStorage.getItem("arico_sales_invoices_v1") || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function customerUsageKeys(customer) {
  return [
    customer.id,
    customer.customerCode,
    customer.smaregiMemberId,
    customer.smaregiMemberCode,
    customer.smaregiCustomerId,
    customer.smaregiCustomerCode
  ].map(value => String(value || "").trim()).filter(Boolean);
}

function isCustomerUsed(customer) {
  const keys = new Set(customerUsageKeys(customer));
  const usedBy = row => [
    row.customerId,
    row.customerCode,
    row.smaregiCustomerId,
    row.smaregiCustomerCode
  ].some(value => keys.has(String(value || "").trim()));
  return readCustomerQuotes().some(usedBy) || readCustomerInvoices().some(usedBy);
}

function canDeleteCustomer(customer) {
  return customer && !isCustomerUsed(customer);
}

function updateCustomerDeleteButton(customer) {
  const button = document.getElementById("deleteCustomerButton");
  if (!button) return;
  const show = Boolean(customer?.id);
  button.hidden = !show;
  button.disabled = show && !canDeleteCustomer(customer);
}

function showCustomerDetail(id) {
  const customer = customerStorage().readCustomers().find(row => row.id === id);
  const card = document.getElementById("customerDetailCard");
  const body = document.getElementById("customerDetailBody");
  if (!customer || !card || !body) return;
  body.innerHTML = `
    <div><span>&#39015;&#23458;&#12467;&#12540;&#12489;</span><strong>${escapeHtml(customer.customerCode)}</strong></div>
    <div><span>&#39015;&#23458;&#21517;</span><strong>${escapeHtml(customer.customerName)}</strong></div>
    <div><span>&#39015;&#23458;&#21306;&#20998;</span><strong>${escapeHtml(customer.customerType)}</strong></div>
    <div><span>&#22243;&#20307;&#21517;</span><strong>${escapeHtml(customer.organizationName)}</strong></div>
    <div><span>&#21516;&#26399;&#29366;&#24907;</span><strong>${customerSyncBadge(customer)}</strong></div>
    <div><span>&#38651;&#35441;&#30058;&#21495;</span><strong>${escapeHtml(customer.phone)}</strong></div>
    <div><span>&#12513;&#12540;&#12523;&#12450;&#12489;&#12524;&#12473;</span><strong>${escapeHtml(customer.email)}</strong></div>
    <div><span>&#20303;&#25152;</span><strong>${escapeHtml(customer.address)}</strong></div>
    <div><span>&#12473;&#12510;&#12524;&#12472;&#20250;&#21729;&#12467;&#12540;&#12489;</span><strong>${escapeHtml(customer.smaregiMemberCode || customer.smaregiCustomerCode)}</strong></div>
    <div><span>&#30331;&#37682;&#26085;</span><strong>${escapeHtml(formatDate(customer.createdAt))}</strong></div>
    <div><span>&#26356;&#26032;&#26085;</span><strong>${escapeHtml(formatDate(customer.updatedAt))}</strong></div>
  `;
  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideCustomerDetail() {
  document.getElementById("customerDetailCard")?.classList.add("hidden");
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function matchesCustomerFilters(customer) {
  if (customerTypeFilter && customer.customerType !== customerTypeFilter) return false;
  const dateTarget = customer.updatedAt || customer.smaregiUpdatedAt || customer.createdAt;
  if (!matchesDateRange(dateTarget, customerDateFrom, customerDateTo)) return false;
  if (!customerSearchText) return true;
  const text = [
    customer.customerName,
    customer.organizationName,
    customer.kana,
    customer.customerType,
    customer.phone,
    customer.email,
    customer.staff,
    customer.smaregiMemberCode,
    customer.customerCode
  ].map(value => normalizeSearchText(value)).join(" ");
  return text.includes(customerSearchText);
}

async function importSmaregiCustomers() {
  const button = document.getElementById("customerSmaregiImportBtn");
  if (button) button.disabled = true;
  showCustomerMessage("スマレジ会員データを取り込んでいます。");
  try {
    const response = await fetch("/api/smaregi-customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const text = await response.text();
    console.log("[smaregi-customers]", response.status, text);
    if (!text) {
      throw new Error(`API応答が空です。HTTP ${response.status}`);
    }
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error(`JSON解析失敗。HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!response.ok || !data.ok) {
      throw new Error(data?.error || `スマレジ会員データ取込に失敗しました。HTTP ${response.status}`);
    }

    console.log("[smaregi-customers] raw sample", data.diagnostics?.rawSample || []);
    console.log("[smaregi-customers] raw keys", data.diagnostics?.rawKeys || []);
    console.log("[smaregi-customers] skip reasons", data.diagnostics?.skipReasons || {});
    console.log("[smaregi-customers] field hits", data.diagnostics?.fieldHits || {});

    const result = customerStorage().upsertSmaregiCustomers(data.customers || []);
    const skipped = Number(data.skipped || 0) + Number(result.skipped || 0);
    const skipReasons = data.diagnostics?.skipReasons || {};
    const message = [
      "スマレジ会員データを取り込みました。",
      `取得件数：${data.count || 0}件`,
      `取込可能件数：${data.importableCount || 0}件`,
      `新規：${result.created}件`,
      `更新：${result.updated}件`,
      `スキップ：${skipped}件`,
      `顧客名なし：${skipReasons.customerNameMissing || 0}件`,
      `会員コードなし：${skipReasons.smaregiMemberCodeMissing || 0}件`,
      `会員IDなし：${skipReasons.smaregiMemberIdMissing || 0}件`
    ].join("\n");
    renderCustomerList();
    updateOrganizationSuggestions();
    showCustomerMessage(message, "ok");
    showSalesPopup("取込完了", message, "ok");
  } catch (error) {
    const message = error?.message || String(error);
    showCustomerMessage(message, "err");
    showSalesPopup("取込失敗", message, "err");
  } finally {
    if (button) button.disabled = false;
  }
}

function editCustomer(id) {
  const customer = customerStorage().readCustomers().find(row => row.id === id);
  if (!customer) return;
  setCustomerFormMode("edit");
  setValue("customerId", customer.id);
  setValue("customerCode", customer.customerCode);
  setValue("smaregiMemberId", customer.smaregiMemberId);
  setValue("smaregiMemberCode", customer.smaregiMemberCode);
  setValue("customerName", customer.customerName);
  setValue("customerOrganizationName", customer.organizationName);
  setValue("customerKana", customer.kana);
  setValue("customerType", customerStorage().normalizeCustomerType(customer.customerType));
  setValue("customerStaff", customer.staff);
  setValue("customerPostalCode", customer.postalCode);
  setValue("customerPhone", customer.phone);
  setValue("customerAddress", customer.address);
  setValue("customerEmail", customer.email);
  setValue("customerMemo", customer.memo);
  updateCustomerDeleteButton(customer);
  document.getElementById("customerEditCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearCustomerForm() {
  const fields = [
    "customerId",
    "customerCode",
    "smaregiMemberId",
    "smaregiMemberCode",
    "customerName",
    "customerOrganizationName",
    "customerKana",
    "customerStaff",
    "customerPostalCode",
    "customerPhone",
    "customerAddress",
    "customerEmail",
    "customerMemo"
  ];
  fields.forEach(id => setValue(id, ""));
  setValue("customerCode", customerStorage().nextCustomerCode(customerStorage().readCustomers()));
  setValue("customerType", "\u500b\u4eba");
  setCustomerFormMode("new");
  updateCustomerDeleteButton(null);
}

function setCustomerFormMode(mode) {
  const isNew = mode === "new";
  const title = document.getElementById("customerFormTitle");
  const button = document.getElementById("customerSaveButton");
  if (title) title.textContent = isNew ? "\u9867\u5ba2\u65b0\u898f\u767b\u9332" : "\u9867\u5ba2\u7de8\u96c6";
  if (button) button.textContent = isNew ? "\u767b\u9332" : "\u4fdd\u5b58";
}

function saveCustomer() {
  const customers = customerStorage().readCustomers();
  const id = getValue("customerId") || makeCustomerId();
  const existingIndex = customers.findIndex(row => row.id === id);
  const now = new Date().toISOString();
  const customer = {
    ...(existingIndex >= 0 ? customers[existingIndex] : {}),
    id,
    customerCode: getValue("customerCode") || customerStorage().nextCustomerCode(customers),
    smaregiMemberId: getValue("smaregiMemberId"),
    smaregiMemberCode: getValue("smaregiMemberCode"),
    smaregiCustomerId: getValue("smaregiMemberId"),
    smaregiCustomerCode: getValue("smaregiMemberCode"),
    customerName: getValue("customerName"),
    organizationName: getValue("customerOrganizationName"),
    kana: getValue("customerKana"),
    customerType: customerStorage().normalizeCustomerType(getValue("customerType")),
    staff: getValue("customerStaff"),
    postalCode: getValue("customerPostalCode"),
    phone: getValue("customerPhone"),
    address: getValue("customerAddress"),
    email: getValue("customerEmail"),
    memo: getValue("customerMemo"),
    createdAt: existingIndex >= 0 ? customers[existingIndex].createdAt : now,
    updatedAt: now
  };
  if (!customer.customerName) {
    showSalesPopup("\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093", "\u9867\u5ba2\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044", "warn");
    return;
  }
  if (existingIndex >= 0) customers[existingIndex] = customer;
  else customers.push(customer);
  customerStorage().writeCustomers(customers);
  setValue("customerId", customer.id);
  setValue("customerCode", customer.customerCode);
  setCustomerFormMode("edit");
  updateCustomerDeleteButton(customer);
  renderCustomerList();
  updateOrganizationSuggestions();
  showCustomerMessage("顧客情報を保存しました。", "ok");
  showSalesPopup("保存完了", "顧客情報を保存しました。", "ok");
}

async function deleteCurrentCustomer() {
  const id = getValue("customerId");
  if (id) await deleteCustomer(id);
}

async function deleteCustomer(id) {
  const customers = customerStorage().readCustomers();
  const customer = customers.find(row => row.id === id);
  if (!customer) return;
  if (!canDeleteCustomer(customer)) {
    showSalesPopup("\u524a\u9664\u3067\u304d\u307e\u305b\u3093", "\u898b\u7a4d\u66f8\u30fb\u8acb\u6c42\u66f8\u3067\u4f7f\u7528\u6e08\u307f\u306e\u9867\u5ba2\u306f\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002", "warn");
    return;
  }
  const ok = await confirmCustomerPopup("\u9867\u5ba2\u524a\u9664", "\u3053\u306e\u9867\u5ba2\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f", "warn");
  if (!ok) return;
  customerStorage().writeCustomers(customers.filter(row => row.id !== id));
  const selectedId = getValue("customerId");
  if (selectedId === id) clearCustomerForm();
  else updateCustomerDeleteButton(null);
  updateOrganizationSuggestions();
  showSalesPopup("\u524a\u9664\u5b8c\u4e86", "\u9867\u5ba2\u3092\u524a\u9664\u3057\u307e\u3057\u305f", "ok");
  const popup = document.getElementById("salesPopup");
  if (popup) popup.dataset.afterClose = "renderCustomerList";
}

function confirmCustomerPopup(title, body, type = "warn") {
  const popup = document.getElementById("salesPopup");
  const titleEl = document.getElementById("salesPopupTitle");
  const bodyEl = document.getElementById("salesPopupBody");
  const okButton = popup?.querySelector("button");
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
    popup.dataset.type = type;
    titleEl.textContent = title;
    bodyEl.textContent = body;
    popup.classList.remove("hidden");
    okButton.textContent = "OK";
    cancelButton.textContent = "\u30ad\u30e3\u30f3\u30bb\u30eb";
    cancelButton.style.display = "";
    const close = result => {
      popup.classList.add("hidden");
      cancelButton.style.display = "none";
      okButton.textContent = "OK";
      okButton.onclick = closeSalesPopup;
      cancelButton.onclick = null;
      resolve(result);
    };
    okButton.onclick = () => close(true);
    cancelButton.onclick = () => close(false);
    playSalesNotifySound(type);
  });
}

function makeCustomerId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `customer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

function getValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function showCustomerMessage(text, type = "") {
  const message = document.getElementById("salesMessage");
  if (!message) return;
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function playSalesNotifySound(type = "ok") {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = type === "err" ? 220 : type === "warn" ? 330 : 660;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, 120);
  } catch (_) {}
}

function showSalesPopup(title, body, type = "ok") {
  const popup = document.getElementById("salesPopup");
  const popupTitle = document.getElementById("salesPopupTitle");
  const popupBody = document.getElementById("salesPopupBody");
  if (!popup || !popupTitle || !popupBody) {
    alert(body || title);
    return;
  }
  const okButton = popup.querySelector("button");
  const cancelButton = document.getElementById("salesPopupCancel");
  if (okButton) okButton.onclick = closeSalesPopup;
  if (cancelButton) cancelButton.style.display = "none";
  popup.dataset.type = type;
  popupTitle.textContent = title;
  popupBody.textContent = body;
  popup.classList.remove("hidden");
  playSalesNotifySound(type);
}

function closeSalesPopup() {
  const popup = document.getElementById("salesPopup");
  const afterClose = popup?.dataset.afterClose || "";
  popup?.classList.add("hidden");
  if (popup) delete popup.dataset.afterClose;
  if (afterClose === "renderCustomerList") renderCustomerList();
}
