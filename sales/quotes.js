const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
const QUOTES_KEY = "arico_sales_quotes_v1";
const INVOICES_KEY = "arico_sales_invoices_v1";
const PRODUCT_UNITS_KEY = "arico_sales_product_units_v1";
const UNIT_OPTIONS = ["個", "本", "袋", "箱", "セット", "台", "式", "ダース", "枚", "組"];
const DEALER_BRANDS = ["FIVICS", "MK", "JET6", "WJ"];
const QUOTE_STATUS_DRAFT = "下書き";
const QUOTE_STATUS_INVOICED = "請求書変換済み";
const QUOTE_STATUS_CANCELLED = "キャンセル";

let currentQuoteId = null;
let currentLines = [];
let productSearchTimer = null;
let quoteListSearchText = "";
let quoteListStatusFilter = "";
let quoteListDateFrom = "";
let quoteListDateTo = "";
let quoteListCollapsed = false;

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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString("ja-JP") + "円";
}

function normalizeQuoteStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "draft" || value === "下書き") return QUOTE_STATUS_DRAFT;
  if (value === "converted" || value === "invoiced" || value === "invoice_created" || value === "請求書変換済み") return QUOTE_STATUS_INVOICED;
  if (value === "cancel" || value === "cancelled" || value === "canceled" || value === "キャンセル") return QUOTE_STATUS_CANCELLED;
  return status || QUOTE_STATUS_DRAFT;
}

function quoteStatusBadge(status) {
  const value = normalizeQuoteStatus(status);
  const type = value === QUOTE_STATUS_CANCELLED ? "danger" : value === QUOTE_STATUS_INVOICED ? "info" : "muted";
  return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
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
  const value = Number(stock || 0);
  return value > 0 ? `現在庫 ${value}` : "現在庫 0 / 取寄せ";
}

function stockClass(stock) {
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
  document.getElementById("customerType").innerHTML = ARICO_CUSTOMER_TYPES.map(type => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("quoteDate").value = today();
  document.getElementById("validUntil").value = today();
  bindProductAutoSearch();
  bindQuoteCustomerSearch();
  bindQuoteListControls();
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
  showSalesPopup("顧客選択", "顧客情報を反映しました", "ok");
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
    const staff = await salesFetch("staff_members?select=name,store_name&order=name.asc");
    select.innerHTML = '<option value="">担当者を選択</option>' + staff.map(row => {
      const label = row.store_name ? `${row.name}（${row.store_name}）` : row.name;
      return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
    }).join("");
  } catch (_) {
    select.innerHTML = '<option value="">担当者を選択</option>';
  }
}

function renderQuoteList() {
  const body = document.getElementById("quoteListBody");
  const completedBody = document.getElementById("quoteCompletedListBody");
  const allQuotes = readQuotes().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const quotes = allQuotes.filter(matchesQuoteListFilters);
  const activeQuotes = quotes.filter(quote => normalizeQuoteStatus(quote.status) === QUOTE_STATUS_DRAFT);
  const completedQuotes = quotes.filter(quote => normalizeQuoteStatus(quote.status) !== QUOTE_STATUS_DRAFT);
  const count = document.getElementById("quoteListCount");
  if (count) count.textContent = quoteListSearchText || quoteListStatusFilter || quoteListDateFrom || quoteListDateTo
    ? `下書き ${activeQuotes.length}件 / 全${quotes.length}件`
    : `下書き ${activeQuotes.length}件`;
  body.innerHTML = activeQuotes.length ? activeQuotes.map(renderQuoteListRow).join("") : '<tr><td colspan="8">対応が必要な見積書はありません。</td></tr>';
  if (completedBody) {
    completedBody.innerHTML = completedQuotes.length ? completedQuotes.map(renderQuoteListRow).join("") : '<tr><td colspan="8">完了済み・キャンセル済みの見積書はありません。</td></tr>';
  }
}

function renderQuoteListRow(q) {
  const deleteButton = canDeleteQuote(q)
    ? `<button type="button" class="danger" onclick="deleteQuote('${q.id}')">&#21066;&#38500;</button>`
    : "";
  return `<tr>
    <td><span class="number-with-status">${escapeHtml(q.quoteNo)} ${quoteStatusBadge(q.status)}</span></td>
    <td>${escapeHtml(q.quoteDate || "")}</td>
    <td>${escapeHtml(q.customerName || "")}</td>
    <td>${escapeHtml(q.subject || "")}</td>
    <td>${money(calcQuoteTotals(q).total)}</td>
    <td>${quoteStatusBadge(q.status)}</td>
    <td>${escapeHtml(q.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="editQuote('${q.id}')">&#32232;&#38598;</button>
      <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">PDF&#20986;&#21147;</button>
      <button type="button" class="secondary" onclick="duplicateQuote('${q.id}')">&#35079;&#35069;</button>
      <button type="button" class="secondary next-step-button" onclick="convertQuoteToInvoice('${q.id}')">&#35531;&#27714;&#26360;&#12408;&#22793;&#25563;</button>
      ${deleteButton}
    </td>
  </tr>`;
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

function buildInvoiceFromQuote(quote, invoices) {
  const now = new Date().toISOString();
  const lines = quote.lines || quote.items || [];
  const customerName = quote.customerName || quote.name || "";
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    invoiceNo: nextInvoiceNo(invoices),
    sourceQuoteId: quote.id,
    sourceQuoteNo: quote.quoteNo || "",
    customerId: quote.customerId || "",
    customerCode: quote.customerCode || "",
    smaregiCustomerId: quote.smaregiCustomerId || "",
    smaregiCustomerCode: quote.smaregiCustomerCode || "",
    createdAt: now,
    updatedAt: now,
    status: "draft",
    customerName,
    organizationName: quote.organizationName || "",
    customerType: quote.customerType || "",
    address: quote.address || "",
    phone: quote.phone || "",
    email: quote.email || "",
    subject: quote.subject || "",
    invoiceDate: today(),
    dueDate: today(),
    staff: quote.staff || "",
    memo: quote.memo || quote.customerMemo || "",
    customerMemo: quote.customerMemo || quote.memo || "",
    discountTemplate: quote.discountTemplate || "none",
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
    quote.status = QUOTE_STATUS_INVOICED;
    writeQuotes(quotes);
    renderQuoteList();
    showSalesMessage(`作成済みの請求書を開きます: ${existing.invoiceNo}`, "warn");
    location.href = `invoices.html?id=${encodeURIComponent(existing.id)}`;
    return;
  }
  const invoice = buildInvoiceFromQuote(quote, invoices);
  invoices.push(invoice);
  writeInvoices(invoices);
  quote.status = QUOTE_STATUS_INVOICED;
  writeQuotes(quotes);
  renderQuoteList();
  showSalesMessage(`請求書を作成しました: ${invoice.invoiceNo}`, "ok");
  location.href = `invoices.html?id=${encodeURIComponent(invoice.id)}`;
}

function newQuote(shouldScroll = false) {
  currentQuoteId = null;
  currentLines = [];
  ["customerName", "customerAddress", "customerPhone", "customerEmail", "quoteSubject", "quoteMemo", "productSearchInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("customerType").value = "個人";
  document.getElementById("discountTemplate").value = "none";
  document.getElementById("quoteDate").value = today();
  document.getElementById("validUntil").value = today();
  document.getElementById("productSearchResults").innerHTML = "";
  ["salesCustomerId", "salesCustomerCode", "salesSmaregiCustomerId", "salesSmaregiCustomerCode", "quoteCustomerSearchInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const customerResults = document.getElementById("quoteCustomerSearchResults");
  if (customerResults) customerResults.innerHTML = "";
  renderLines();
  updateQuoteDeleteButton(null);
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
    results.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>商品名</th><th>バーコード</th><th>現在庫</th><th>販売価格</th><th>操作</th></tr></thead><tbody>${rows.map(raw => {
      const row = sanitizeProductRow(raw);
      const price = getProductPriceInfo(row);
      return `<tr>
        <td>${escapeHtml(row.name || "")}</td>
        <td>${escapeHtml(row.barcode || "")}</td>
        <td><span class="${stockClass(row.base_stock)}">${formatStock(row.base_stock)}</span></td>
        <td>${price.hasPrice ? money(price.value) : '<span class="line-stock warn">価格未登録</span>'}</td>
        <td><button type="button" class="secondary" onclick='addProductLine(${JSON.stringify(row).replaceAll("'", "&#39;")})'>追加</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : '<div class="message warn">該当商品がありません。</div>';
  } catch (e) {
    results.innerHTML = '<div class="message err">商品検索に失敗しました。</div>';
  }
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
      discountValue: 0,
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
  area.innerHTML = currentLines.length ? currentLines.map((line, index) => `
    <div class="quote-line">
      <label>商品名<input value="${escapeHtml(line.name)}" onchange="updateLine(${index}, 'name', this.value)"></label>
      <label>現在庫<div class="${stockClass(line.stock)}">${formatStock(line.stock)}</div></label>
      <label>数量<input type="number" min="0" step="1" value="${line.qty}" onchange="updateLine(${index}, 'qty', this.value)"></label>
      <label>単位<select onchange="updateLine(${index}, 'unit', this.value)">${UNIT_OPTIONS.map(unit => `<option value="${unit}" ${unit === line.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label>
      <label>税込単価<input type="number" min="0" step="1" value="${line.unitPrice}" onchange="updateLine(${index}, 'unitPrice', this.value)"></label>
      <label>値引率%<input type="number" min="0" step="1" value="${line.discountValue}" onchange="updateLine(${index}, 'discountValue', this.value)"></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" onchange="updateLine(${index}, 'memo', this.value)"></label>
      <button type="button" class="danger" onclick="removeLine(${index})">削除</button>
    </div>`).join("") : '<div class="message">見積商品を追加してください。</div>';
  recalcTotals();
}

function updateLine(index, key, value) {
  const line = currentLines[index];
  if (!line) return;
  if (["qty", "unitPrice", "discountValue"].includes(key)) line[key] = Number(value || 0);
  else line[key] = value;
  if (key === "unit" && line.barcode) {
    const units = readUnits();
    units[line.barcode] = value;
    writeUnits(units);
  }
  if (document.getElementById("discountTemplate").value !== "custom" && key !== "unit") {
    applyDiscountTemplate(false);
  }
  recalcSalesLine(line);
  renderLines();
}

function removeLine(index) {
  currentLines.splice(index, 1);
  renderLines();
}

function isDealerBrand(name) {
  const text = String(name || "").toUpperCase();
  return DEALER_BRANDS.some(brand => text.includes(brand));
}

function applyDiscountTemplate(render = true) {
  const template = document.getElementById("discountTemplate").value;
  currentLines.forEach(line => {
    if (template === "all10") line.discountValue = 10;
    if (template === "dealer10") line.discountValue = isDealerBrand(line.name) ? 10 : 0;
    if (template === "none") line.discountValue = 0;
    recalcSalesLine(line);
  });
  if (render) renderLines();
}

function recalcTotals() {
  currentLines.forEach(recalcSalesLine);
  const totals = calcQuoteTotals({ lines: currentLines });
  document.getElementById("subtotalText").textContent = money(totals.subtotal);
  document.getElementById("discountText").textContent = money(totals.discount);
  document.getElementById("totalText").textContent = money(totals.total);
  document.getElementById("taxText").textContent = money(totals.tax);
}

function collectQuote() {
  const quotes = readQuotes();
  const existing = currentQuoteId ? quotes.find(q => q.id === currentQuoteId) : null;
  return {
    id: currentQuoteId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    quoteNo: existing?.quoteNo || nextQuoteNo(quotes),
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
    subject: document.getElementById("quoteSubject").value.trim(),
    quoteDate: document.getElementById("quoteDate").value,
    validUntil: document.getElementById("validUntil").value,
    staff: document.getElementById("quoteStaff").value,
    memo: document.getElementById("quoteMemo").value,
    customerMemo: document.getElementById("quoteMemo").value,
    discountTemplate: document.getElementById("discountTemplate").value,
    lines: currentLines.map(({ stock, ...line }) => ({ ...line }))
  };
}

async function saveQuote() {
  if (!document.getElementById("salesCustomerId")?.value) {
    showSalesMessage("\u9867\u5ba2\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044", "err");
    showSalesPopup("\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093", "\u9867\u5ba2\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044", "warn");
    return;
  }
  if (!currentLines.length) {
    showSalesMessage("\u898b\u7a4d\u5546\u54c1\u3092\u8ffd\u52a0\u3057\u3066\u304f\u3060\u3055\u3044\u3002", "err");
    return;
  }
  try {
    await refreshQuoteLineStocks();
  } catch (_) {
    showSalesMessage("\u6700\u65b0\u5728\u5eab\u306e\u518d\u78ba\u8a8d\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u898b\u7a4d\u306f\u4fdd\u5b58\u3067\u304d\u307e\u3059\u304c\u3001\u73fe\u5728\u5eab\u8868\u793a\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", "warn");
  }
  const quote = collectQuote();
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
  currentLines = JSON.parse(JSON.stringify(quote.lines || [])).map(line => ({ ...line, stock: 0 }));
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
  document.getElementById("quoteSubject").value = quote.subject || "";
  document.getElementById("quoteDate").value = quote.quoteDate || today();
  document.getElementById("validUntil").value = quote.validUntil || today();
  document.getElementById("quoteStaff").value = quote.staff || "";
  document.getElementById("quoteMemo").value = quote.memo || "";
  document.getElementById("discountTemplate").value = quote.discountTemplate || "none";
  renderLines();
  updateQuoteDeleteButton(quote);
  await refreshQuoteLineStocks().catch(() => {});
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
  printQuotePdf(collectQuote());
}

function printQuoteById(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (quote) printQuotePdf(quote);
}
