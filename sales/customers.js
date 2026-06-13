const ARICO_CUSTOMER_TYPES = ["個人", "学校", "協会", "企業", "ショップ", "卸", "その他"];
const CUSTOMER_QUOTES_KEY = "arico_sales_quotes_v1";
const CUSTOMER_INVOICES_KEY = "arico_sales_invoices_v1";

let customerListCollapsed = false;
let customerSearchText = "";
let customerTypeFilter = "";
let customerDateFrom = "";
let customerDateTo = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function readCustomerQuotes() {
  return JSON.parse(localStorage.getItem(CUSTOMER_QUOTES_KEY) || "[]");
}

function readCustomerInvoices() {
  return JSON.parse(localStorage.getItem(CUSTOMER_INVOICES_KEY) || "[]");
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
  bindCustomerListControls();
  renderCustomerList();
});

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

function collectCustomers() {
  const map = new Map();
  const add = (row, type) => {
    const name = String(row.customerName || "").trim();
    if (!name) return;
    const current = map.get(name) || {
      customerName: name,
      customerType: row.customerType || "",
      phone: row.phone || "",
      email: row.email || "",
      staff: row.staff || "",
      latestDate: "",
      quoteCount: 0,
      invoiceCount: 0
    };
    current.customerType = current.customerType || row.customerType || "";
    current.phone = current.phone || row.phone || "";
    current.email = current.email || row.email || "";
    current.staff = current.staff || row.staff || "";
    const date = normalizeDateOnly(row.invoiceDate || row.quoteDate || row.updatedAt || row.createdAt);
    if (date && date > current.latestDate) current.latestDate = date;
    if (type === "quote") current.quoteCount += 1;
    if (type === "invoice") current.invoiceCount += 1;
    map.set(name, current);
  };
  readCustomerQuotes().forEach(row => add(row, "quote"));
  readCustomerInvoices().forEach(row => add(row, "invoice"));
  return [...map.values()].sort((a, b) => String(b.latestDate).localeCompare(String(a.latestDate)));
}

function renderCustomerList() {
  const body = document.getElementById("customerListBody");
  if (!body) return;
  const allCustomers = collectCustomers();
  const customers = allCustomers.filter(matchesCustomerFilters);
  const count = document.getElementById("customerListCount");
  if (count) count.textContent = `${customers.length}件`;
  body.innerHTML = customers.length ? customers.map(customer => `<tr>
    <td>${escapeHtml(customer.customerName)}</td>
    <td>${escapeHtml(customer.customerType)}</td>
    <td>${escapeHtml(customer.phone)}</td>
    <td>${escapeHtml(customer.email)}</td>
    <td>${escapeHtml(customer.staff)}</td>
    <td>${escapeHtml(customer.latestDate)}</td>
    <td>${customer.quoteCount}</td>
    <td>${customer.invoiceCount}</td>
  </tr>`).join("") : '<tr><td colspan="8">顧客データはありません。</td></tr>';
}

function matchesCustomerFilters(customer) {
  if (customerTypeFilter && customer.customerType !== customerTypeFilter) return false;
  if (!matchesDateRange(customer.latestDate, customerDateFrom, customerDateTo)) return false;
  if (!customerSearchText) return true;
  const text = [
    customer.customerName,
    customer.customerType,
    customer.phone,
    customer.email,
    customer.staff
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return text.includes(customerSearchText);
}
