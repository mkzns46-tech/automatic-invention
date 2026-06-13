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
let quoteListCollapsed = true;

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
  setQuoteListCollapsed(true);
}

function toggleQuoteList() {
  setQuoteListCollapsed(!quoteListCollapsed);
}

function setQuoteListCollapsed(collapsed) {
  quoteListCollapsed = collapsed;
  const panel = document.getElementById("quoteListPanel");
  const button = document.getElementById("quoteListToggle");
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
  const allQuotes = readQuotes().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const quotes = allQuotes.filter(matchesQuoteListFilters);
  const count = document.getElementById("quoteListCount");
  if (count) count.textContent = quoteListSearchText || quoteListStatusFilter || quoteListDateFrom || quoteListDateTo
    ? `${quotes.length}/${allQuotes.length}件`
    : `${allQuotes.length}件`;
  body.innerHTML = quotes.length ? quotes.map(q => `<tr>
    <td><span class="number-with-status">${escapeHtml(q.quoteNo)} ${quoteStatusBadge(q.status)}</span></td>
    <td>${escapeHtml(q.quoteDate || "")}</td>
    <td>${escapeHtml(q.customerName || "")}</td>
    <td>${escapeHtml(q.subject || "")}</td>
    <td>${money(calcQuoteTotals(q).total)}</td>
    <td>${quoteStatusBadge(q.status)}</td>
    <td>${escapeHtml(q.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="editQuote('${q.id}')">編集</button>
      <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">PDF出力</button>
      <button type="button" class="secondary" onclick="duplicateQuote('${q.id}')">複製</button>
      <button type="button" class="secondary" onclick="convertQuoteToInvoice('${q.id}')">請求書へ変換</button>
    </td>
  </tr>`).join("") : '<tr><td colspan="8">見積書はまだありません。</td></tr>';
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
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    invoiceNo: nextInvoiceNo(invoices),
    sourceQuoteId: quote.id,
    sourceQuoteNo: quote.quoteNo || "",
    createdAt: now,
    updatedAt: now,
    status: "下書き",
    customerName: quote.customerName || "",
    customerType: quote.customerType || "",
    address: quote.address || "",
    phone: quote.phone || "",
    email: quote.email || "",
    subject: quote.subject || "",
    invoiceDate: today(),
    dueDate: today(),
    staff: quote.staff || "",
    memo: quote.memo || "",
    discountTemplate: quote.discountTemplate || "none",
    lines: JSON.parse(JSON.stringify(quote.lines || []))
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

function newQuote() {
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
  renderLines();
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
    status: existing?.status || "下書き",
    customerName: document.getElementById("customerName").value.trim(),
    customerType: document.getElementById("customerType").value,
    address: document.getElementById("customerAddress").value.trim(),
    phone: document.getElementById("customerPhone").value.trim(),
    email: document.getElementById("customerEmail").value.trim(),
    subject: document.getElementById("quoteSubject").value.trim(),
    quoteDate: document.getElementById("quoteDate").value,
    validUntil: document.getElementById("validUntil").value,
    staff: document.getElementById("quoteStaff").value,
    memo: document.getElementById("quoteMemo").value,
    discountTemplate: document.getElementById("discountTemplate").value,
    lines: currentLines.map(({ stock, ...line }) => ({ ...line }))
  };
}

async function saveQuote() {
  if (!document.getElementById("customerName").value.trim()) {
    showSalesMessage("顧客名を入力してください。", "err");
    return;
  }
  if (!currentLines.length) {
    showSalesMessage("見積商品を追加してください。", "err");
    return;
  }
  try {
    await refreshQuoteLineStocks();
  } catch (_) {
    showSalesMessage("最新在庫の再確認に失敗しました。見積は保存できますが、現在庫表示を確認してください。", "warn");
  }
  const quote = collectQuote();
  const quotes = readQuotes();
  const index = quotes.findIndex(q => q.id === quote.id);
  if (index >= 0) quotes[index] = quote;
  else quotes.push(quote);
  writeQuotes(quotes);
  currentQuoteId = quote.id;
  renderQuoteList();
  showSalesMessage("見積書を保存しました。", "ok");
}

async function fillQuoteForm(quote) {
  currentQuoteId = quote.id || null;
  currentLines = JSON.parse(JSON.stringify(quote.lines || [])).map(line => ({ ...line, stock: 0 }));
  document.getElementById("customerName").value = quote.customerName || "";
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

function outputCurrentQuotePdf() {
  printQuotePdf(collectQuote());
}

function printQuoteById(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (quote) printQuotePdf(quote);
}
