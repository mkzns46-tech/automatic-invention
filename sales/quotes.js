const UNIT_OPTIONS = ["個", "本", "袋", "箱", "セット", "台", "式", "ダース", "枚", "組"];
const DEALER_BRANDS = ["FIVICS", "MK", "JET6", "WJ"];

let currentQuoteId = null;
let currentLines = [];
let currentQuoteDirty = false;
let quoteListCache = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!requireSalesAuth()) return;
  document.getElementById("customerType").innerHTML = ARICO_CUSTOMER_TYPES.map(type => `<option value="${type}">${type}</option>`).join("");
  document.getElementById("quoteDate").value = today();
  document.getElementById("validUntil").value = today();
  await loadStaffOptions();
  bindQuoteDirtyEvents();
  await renderQuoteList();
  newQuote();
});

function bindQuoteDirtyEvents() {
  [
    "customerName",
    "customerType",
    "quoteStaff",
    "customerAddress",
    "customerPhone",
    "customerEmail",
    "quoteSubject",
    "quoteDate",
    "validUntil",
    "discountTemplate",
    "quoteMemo"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", markQuoteDirty);
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

async function renderQuoteList() {
  const body = document.getElementById("quoteListBody");
  quoteListCache = (await salesQuoteStore.listQuotes()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  body.innerHTML = quoteListCache.length ? quoteListCache.map(q => `<tr>
    <td>${escapeHtml(q.quoteNo)}</td>
    <td>${escapeHtml(q.quoteDate || "")}</td>
    <td>${escapeHtml(q.customerName || "")}</td>
    <td>${escapeHtml(q.subject || "")}</td>
    <td>${salesYen(calcQuoteTotals(q).total)}</td>
    <td>${escapeHtml(q.status || "下書き")}</td>
    <td>${escapeHtml(q.staff || "")}</td>
    <td>
      <button type="button" class="secondary" onclick="editQuote('${q.id}')">編集</button>
      <button type="button" class="secondary" onclick="printQuoteById('${q.id}')">PDF出力</button>
      <button type="button" class="secondary" onclick="duplicateQuote('${q.id}')">複製</button>
      <button type="button" class="secondary" onclick="showSalesMessage('請求書へ変換は次フェーズで実装します。','warn')">請求書へ変換</button>
    </td>
  </tr>`).join("") : '<tr><td colspan="8">見積書はまだありません。</td></tr>';
}

function markQuoteDirty() {
  currentQuoteDirty = true;
}

function newQuote() {
  currentQuoteId = null;
  currentLines = [];
  currentQuoteDirty = false;
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
    showSalesMessage("商品名・バーコード・スマレジ商品IDを入力してください。", "err");
    return;
  }
  results.innerHTML = '<div class="message">検索中...</div>';
  try {
    const filter = encodeURIComponent(`*${query}*`);
    const rows = await salesFetch(`products?select=*&or=(name.ilike.${filter},barcode.ilike.${filter},smaregi_product_id.ilike.${filter})&limit=20`);
    results.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>商品名</th><th>バーコード</th><th>スマレジ商品ID</th><th>税込単価</th><th>現在庫</th><th>操作</th></tr></thead><tbody>${rows.map(row => {
      const stock = Number(row.base_stock || 0);
      const price = getProductUnitPrice(row);
      return `<tr>
        <td>${escapeHtml(row.name || "")}</td>
        <td>${escapeHtml(row.barcode || "")}</td>
        <td>${escapeHtml(row.smaregi_product_id || "")}</td>
        <td>${price ? salesYen(price) : '<span class="line-stock warn">未登録</span>'}</td>
        <td>${stock > 0 ? `現在庫 ${stock}` : `<span class="line-stock warn">現在庫 0 / 取寄せ</span>`}</td>
        <td><button type="button" class="secondary" onclick='addProductLine(${JSON.stringify(row).replaceAll("'", "&#39;")})'>追加</button></td>
      </tr>`;
    }).join("")}</tbody></table></div>` : '<div class="message warn">該当商品がありません。</div>';
  } catch (e) {
    results.innerHTML = '<div class="message err">商品検索に失敗しました。</div>';
  }
}

function getProductUnitPrice(product) {
  const keys = [
    "price",
    "sales_price",
    "selling_price",
    "unit_price",
    "tax_included_price",
    "tax_included_unit_price",
    "default_price"
  ];
  for (const key of keys) {
    const value = Number(product?.[key] || 0);
    if (value > 0) return value;
  }
  return 0;
}

function addProductLine(product) {
  const units = readUnits();
  const unitKey = product.barcode || product.smaregi_product_id || product.name;
  const unit = units[unitKey] || "個";
  const unitPrice = getProductUnitPrice(product);
  currentLines.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    barcode: product.barcode || "",
    smaregiProductId: product.smaregi_product_id || "",
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
  markQuoteDirty();
  renderLines();
  if (!unitPrice) {
    showSalesMessage("この商品には価格列が登録されていないため、税込単価を手入力してください。", "warn");
  }
}

function renderLines() {
  const area = document.getElementById("quoteLines");
  area.innerHTML = currentLines.length ? currentLines.map((line, index) => `
    <div class="quote-line">
      <label>商品名<input value="${escapeHtml(line.name)}" onchange="updateLine(${index}, 'name', this.value)"></label>
      <label>現在庫<div class="${Number(line.stock) > 0 ? "" : "line-stock warn"}">${Number(line.stock) > 0 ? `現在庫 ${line.stock}` : "現在庫 0 / 取寄せ"}</div></label>
      <label>数量<input type="number" min="0" step="1" value="${line.qty}" onchange="updateLine(${index}, 'qty', this.value)"></label>
      <label>単位<select onchange="updateLine(${index}, 'unit', this.value)">${UNIT_OPTIONS.map(unit => `<option value="${unit}" ${unit === line.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label>
      <label>税込単価<input type="number" min="0" step="1" value="${line.unitPrice}" onchange="updateLine(${index}, 'unitPrice', this.value)"></label>
      <label>値引率%<input type="number" min="0" step="1" value="${line.discountValue}" onchange="updateLine(${index}, 'discountValue', this.value)"></label>
      <label>備考<input value="${escapeHtml(line.memo || "")}" onchange="updateLine(${index}, 'memo', this.value)"></label>
      <button type="button" class="danger" onclick="removeLine(${index})">削除</button>
    </div>`).join("") : '<div class="message">商品明細を追加してください。</div>';
  recalcTotals();
}

function updateLine(index, key, value) {
  const line = currentLines[index];
  if (!line) return;
  if (["qty", "unitPrice", "discountValue"].includes(key)) line[key] = Number(value || 0);
  else line[key] = value;
  if (key === "unit") {
    const unitKey = line.barcode || line.smaregiProductId || line.name;
    if (unitKey) {
      const units = readUnits();
      units[unitKey] = value;
      writeUnits(units);
    }
  }
  if (document.getElementById("discountTemplate").value !== "custom" && key !== "unit") {
    applyDiscountTemplate(false);
  }
  recalcSalesLine(line);
  markQuoteDirty();
  renderLines();
}

function removeLine(index) {
  currentLines.splice(index, 1);
  markQuoteDirty();
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
  markQuoteDirty();
  if (render) renderLines();
}

function recalcTotals() {
  const totals = calcQuoteTotals({ lines: currentLines });
  document.getElementById("subtotalText").textContent = salesYen(totals.subtotal);
  document.getElementById("discountText").textContent = salesYen(totals.discount);
  document.getElementById("totalText").textContent = salesYen(totals.total);
  document.getElementById("taxText").textContent = salesYen(totals.tax);
}

function collectQuote() {
  const existing = currentQuoteId ? quoteListCache.find(q => q.id === currentQuoteId) : null;
  return {
    id: currentQuoteId,
    quoteNo: existing?.quoteNo || "",
    createdAt: existing?.createdAt || "",
    updatedAt: existing?.updatedAt || "",
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

function validateQuote() {
  if (!document.getElementById("customerName").value.trim()) {
    showSalesMessage("顧客名を入力してください。", "err");
    return false;
  }
  if (!currentLines.length) {
    showSalesMessage("商品明細を追加してください。", "err");
    return false;
  }
  return true;
}

async function saveQuote(options = {}) {
  if (!validateQuote()) return null;
  const saved = await salesQuoteStore.saveQuote(collectQuote());
  currentQuoteId = saved.id;
  currentLines = JSON.parse(JSON.stringify(saved.lines || []));
  currentQuoteDirty = false;
  await renderQuoteList();
  if (!options.silent) showSalesMessage(`見積書 ${saved.quoteNo} を保存しました。`, "ok");
  return saved;
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

async function editQuote(id) {
  const quote = await salesQuoteStore.getQuote(id);
  if (!quote) return;
  fillQuoteForm(quote);
  currentQuoteDirty = false;
}

async function duplicateQuote(id) {
  const quote = await salesQuoteStore.getQuote(id);
  if (!quote) return;
  fillQuoteForm(salesQuoteStore.duplicateQuoteDraft(quote));
  currentQuoteDirty = true;
  showSalesMessage("見積書を複製しました。保存すると新しい見積番号になります。", "ok");
}

async function outputCurrentQuotePdf() {
  if (!currentQuoteId) {
    showSalesMessage("PDF出力前に下書き保存してください。見積番号がない状態ではPDFを出力できません。", "warn");
    return;
  }
  if (currentQuoteDirty) {
    const shouldSave = confirm("変更内容が未保存です。保存してからPDFを出力しますか？");
    if (!shouldSave) return;
    const saved = await saveQuote({ silent: true });
    if (!saved?.quoteNo) return;
    printQuotePdf(saved);
    showSalesMessage(`見積書 ${saved.quoteNo} を保存してPDFを出力しました。`, "ok");
    return;
  }
  const quote = await salesQuoteStore.getQuote(currentQuoteId);
  if (!quote?.quoteNo) {
    showSalesMessage("見積番号がないためPDFを出力できません。先に保存してください。", "err");
    return;
  }
  printQuotePdf(quote);
}

async function printQuoteById(id) {
  const quote = await salesQuoteStore.getQuote(id);
  if (quote?.quoteNo) printQuotePdf(quote);
}
