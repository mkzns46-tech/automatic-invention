const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
const QUOTES_KEY = "arico_sales_quotes_v1";
const PRODUCT_UNITS_KEY = "arico_sales_product_units_v1";
const UNIT_OPTIONS = ["個", "本", "袋", "箱", "セット", "台", "式", "ダース", "枚", "組"];
const DEALER_BRANDS = ["FIVICS", "MK", "JET6", "WJ"];

let currentQuoteId = null;
let currentLines = [];

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

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString("ja-JP") + "円";
}

function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

function getProductUnitPrice(product) {
  const value = Number(product?.price ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function playSalesNotifySound(type = "ok") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = type === "err" ? 220 : 660;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  } catch (_) {}
}

function showSalesToast(text, type = "ok") {
  const toast = document.getElementById("salesToast");
  if (!toast) {
    alert(text);
    return;
  }
  toast.textContent = text;
  toast.className = `sales-toast ${type}`;
  toast.hidden = false;
  clearTimeout(showSalesToast.timer);
  showSalesToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function notifySalesProductAdded(text, type = "ok") {
  showSalesToast(text, type);
  playSalesNotifySound(type);
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!requireSalesAuth()) return;
  document.getElementById("customerType").innerHTML = ARICO_CUSTOMER_TYPES.map(type => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("quoteDate").value = today();
  document.getElementById("validUntil").value = today();
  await loadStaffOptions();
  renderQuoteList();
  newQuote();
});

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
  const quotes = readQuotes().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  body.innerHTML = quotes.length ? quotes.map(q => `<tr>
    <td>${escapeHtml(q.quoteNo)}</td>
    <td>${escapeHtml(q.quoteDate || "")}</td>
    <td>${escapeHtml(q.customerName || "")}</td>
    <td>${escapeHtml(q.subject || "")}</td>
    <td>${money(calcQuoteTotals(q).total)}</td>
    <td>${escapeHtml(q.status || "下書き")}</td>
    <td>${escapeHtml(q.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="editQuote('${q.id}')">編集</button>
      <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">PDF出力</button>
      <button type="button" class="secondary" onclick="duplicateQuote('${q.id}')">複製</button>
      <button type="button" class="secondary" onclick="showSalesMessage('請求書へ変換はv1では準備中です。','warn')">請求書へ変換</button>
    </td>
  </tr>`).join("") : '<tr><td colspan="8">見積書はまだありません。</td></tr>';
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
    showSalesMessage("商品名・バーコード・商品コードを入力してください。", "err");
    return;
  }
  results.innerHTML = '<div class="message">検索中...</div>';
  try {
    const filter = encodeURIComponent(`*${query}*`);
    const rows = await salesFetch(`products?select=barcode,name,base_stock,category,genre,price&or=(name.ilike.${filter},barcode.ilike.${filter})&limit=20`);
    results.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>商品名</th><th>バーコード</th><th>税込単価</th><th>現在在庫</th><th>操作</th></tr></thead><tbody>${rows.map(row => {
      const stock = Number(row.base_stock || 0);
      const price = getProductUnitPrice(row);
      return `<tr>
        <td>${escapeHtml(row.name || "")}</td>
        <td>${escapeHtml(row.barcode || "")}</td>
        <td>${price ? money(price) : '<span class="line-stock warn">未登録</span>'}</td>
        <td>${stock > 0 ? `現在在庫 ${stock}` : `<span class="line-stock warn">現在在庫 0 / 取寄せ</span>`}</td>
        <td><button type="button" class="secondary" onclick='addProductLine(${JSON.stringify(row).replaceAll("'", "&#39;")})'>追加</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : '<div class="message warn">該当商品がありません。</div>';
  } catch (e) {
    results.innerHTML = '<div class="message err">商品検索に失敗しました。</div>';
  }
}

function addProductLine(product) {
  try {
    const units = readUnits();
    const unit = units[product.barcode] || "個";
    const unitPrice = getProductUnitPrice(product);
    currentLines.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      barcode: product.barcode || "",
      name: product.name || "",
      stock: Number(product.base_stock || 0),
      qty: 1,
      unit,
      unitPrice,
      discountValue: 0,
      discountAmount: 0,
      amount: 0,
      memo: ""
    });
    renderLines();
    notifySalesProductAdded("商品を見積に追加しました", "ok");
  } catch (e) {
    notifySalesProductAdded("商品の追加に失敗しました", "err");
  }
}

function renderLines() {
  const area = document.getElementById("quoteLines");
  area.innerHTML = currentLines.length ? currentLines.map((line, index) => `
    <div class="quote-line">
      <label>商品名<input value="${escapeHtml(line.name)}" onchange="updateLine(${index}, 'name', this.value)"></label>
      <label>現在在庫<div class="${Number(line.stock) > 0 ? "" : "line-stock warn"}">${Number(line.stock) > 0 ? `現在在庫 ${line.stock}` : "現在在庫 0 / 取寄せ"}</div></label>
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
    lines: currentLines
  };
}

function saveQuote() {
  if (!document.getElementById("customerName").value.trim()) {
    showSalesMessage("顧客名を入力してください。", "err");
    return;
  }
  if (!currentLines.length) {
    showSalesMessage("見積商品を追加してください。", "err");
    return;
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

function fillQuoteForm(quote) {
  currentQuoteId = quote.id || null;
  currentLines = JSON.parse(JSON.stringify(quote.lines || []));
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
}

function editQuote(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (quote) fillQuoteForm(quote);
}

function duplicateQuote(id) {
  const quote = readQuotes().find(q => q.id === id);
  if (!quote) return;
  fillQuoteForm({
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
