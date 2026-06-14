if (!window.ARICO_CUSTOMER_TYPES) {
  window.ARICO_CUSTOMER_TYPES = ["個人", "学校", "協会", "企業", "ショップ", "卸", "その他"];
}
var ARICO_CUSTOMER_TYPES = window.ARICO_CUSTOMER_TYPES;

let customerListCollapsed = false;
let customerSearchText = "";
let customerTypeFilter = "";
let customerDateFrom = "";
let customerDateTo = "";

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
    customerSearchText = event.target.value.trim().toLowerCase();
    renderCustomerList();
  });
  document.getElementById("customerTypeFilter")?.addEventListener("change", event => {
    customerTypeFilter = event.target.value;
    renderCustomerList();
  });
  document.getElementById("customerDateFromFilter")?.addEventListener("input", event => {
    customerDateFrom = event.target.value;
    renderCustomerList();
  });
  document.getElementById("customerDateToFilter")?.addEventListener("input", event => {
    customerDateTo = event.target.value;
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

function renderCustomerList() {
  const body = document.getElementById("customerListBody");
  if (!body) return;
  const allCustomers = customerStorage().readCustomers();
  const customers = allCustomers.filter(matchesCustomerFilters)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const count = document.getElementById("customerListCount");
  if (count) count.textContent = `${customers.length}件`;
  body.innerHTML = customers.length ? customers.map(customer => `<tr>
    <td>${escapeHtml(customer.customerCode)}</td>
    <td>${escapeHtml(customer.customerName)}</td>
    <td>${escapeHtml(customer.customerType)}</td>
    <td>${escapeHtml(customer.phone)}</td>
    <td>${escapeHtml(customer.email)}</td>
    <td>${escapeHtml(customer.smaregiMemberCode)}</td>
    <td>${escapeHtml(customer.staff)}</td>
    <td>${escapeHtml(formatDate(customer.updatedAt))}</td>
    <td><button type="button" class="secondary" onclick="editCustomer('${escapeHtml(customer.id)}');">編集</button></td>
  </tr>`).join("") : '<tr><td colspan="9">顧客データはありません。</td></tr>';
}

function matchesCustomerFilters(customer) {
  if (customerTypeFilter && customer.customerType !== customerTypeFilter) return false;
  const dateTarget = customer.updatedAt || customer.smaregiUpdatedAt || customer.createdAt;
  if (!matchesDateRange(dateTarget, customerDateFrom, customerDateTo)) return false;
  if (!customerSearchText) return true;
  const text = [
    customer.customerName,
    customer.kana,
    customer.customerType,
    customer.phone,
    customer.email,
    customer.staff,
    customer.smaregiMemberCode,
    customer.customerCode
  ].map(value => String(value || "").toLowerCase()).join(" ");
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

    const result = customerStorage().upsertSmaregiCustomers(data.customers || []);
    const skipped = Number(data.skipped || 0) + Number(result.skipped || 0);
    const message = [
      "スマレジ会員データを取り込みました。",
      `取得件数：${data.count || 0}件`,
      `新規：${result.created}件`,
      `更新：${result.updated}件`,
      `スキップ：${skipped}件`
    ].join("\n");
    renderCustomerList();
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
  setValue("customerId", customer.id);
  setValue("customerCode", customer.customerCode);
  setValue("smaregiMemberId", customer.smaregiMemberId);
  setValue("smaregiMemberCode", customer.smaregiMemberCode);
  setValue("customerName", customer.customerName);
  setValue("customerKana", customer.kana);
  setValue("customerType", customerStorage().normalizeCustomerType(customer.customerType));
  setValue("customerStaff", customer.staff);
  setValue("customerPostalCode", customer.postalCode);
  setValue("customerPhone", customer.phone);
  setValue("customerAddress", customer.address);
  setValue("customerEmail", customer.email);
  setValue("customerMemo", customer.memo);
  document.getElementById("customerEditCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearCustomerForm() {
  const fields = [
    "customerId",
    "customerCode",
    "smaregiMemberId",
    "smaregiMemberCode",
    "customerName",
    "customerKana",
    "customerStaff",
    "customerPostalCode",
    "customerPhone",
    "customerAddress",
    "customerEmail",
    "customerMemo"
  ];
  fields.forEach(id => setValue(id, ""));
  setValue("customerType", "個人");
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
    customerName: getValue("customerName"),
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
    showSalesPopup("保存できません", "顧客名を入力してください。", "warn");
    return;
  }
  if (existingIndex >= 0) customers[existingIndex] = customer;
  else customers.push(customer);
  customerStorage().writeCustomers(customers);
  setValue("customerId", customer.id);
  setValue("customerCode", customer.customerCode);
  renderCustomerList();
  showCustomerMessage("顧客情報を保存しました。", "ok");
  showSalesPopup("保存完了", "顧客情報を保存しました。", "ok");
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
  popup.dataset.type = type;
  popupTitle.textContent = title;
  popupBody.textContent = body;
  popup.classList.remove("hidden");
  playSalesNotifySound(type);
}

function closeSalesPopup() {
  document.getElementById("salesPopup")?.classList.add("hidden");
}
