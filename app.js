let products = [];
let logs = [];
let videoStream = null;
let detector = null;
let scanning = false;
let lastScan = "";
let lastScanAt = 0;

const el = (id) => document.getElementById(id);

// ===== 固定設定 =====
// SUPABASE_URL はこのままでOKです。
// SUPABASE_API_KEY はSupabaseの Publishable key を貼ってください。
// 例：const SUPABASE_API_KEY = "sb_publishable_xxxxxxxxxxxxxxxxx";
const SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
// ====================

function getConfig() {
  return {
    url: SUPABASE_URL.replace(/\/+$/, ""),
    key: SUPABASE_API_KEY.trim()
  };
}

function showMessage(text, type = "") {
  const m = el("message");
  m.textContent = text;
  m.className = "message " + type;
}

function beep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, ok ? 90 : 220);
  } catch (_) {}
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = getConfig();
  if (!url || !key || key.includes("ここに_")) throw new Error("app.js の SUPABASE_API_KEY を設定してください。");
  if (!url.startsWith("https://") || !url.includes(".supabase.co")) {
    throw new Error("Supabase URLの形式が違います。例：https://xxxxx.supabase.co");
  }

  const headers = {
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(options.headers || {})
  };

  const res = await fetch(url + "/rest/v1/" + path, {
    ...options,
    headers
  });

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!res.ok) {
    const detail = typeof body === "object" ? JSON.stringify(body) : String(body || "");
    throw new Error(`Supabaseエラー ${res.status}\n${detail}`);
  }

  return body;
}

async function reloadAll() {
  try {
    showMessage("接続中...");
    products = await supabaseRequest("products?select=*&order=name.asc");
    logs = await supabaseRequest("inventory_logs?select=*&order=created_at.desc&limit=500");
    render();
    showMessage("準備OK。スマホカメラまたは手入力で登録できます。", "ok");
  } catch (e) {
    showMessage("データ取得エラー。\n" + e.message, "err");
  }
}

function calcStock() {
  const map = new Map();
  for (const p of products) {
    map.set(p.barcode, {
      barcode: p.barcode,
      name: p.name,
      location: p.location || "",
      base_stock: Number(p.base_stock || 0),
      inQty: 0,
      outQty: 0,
      adjustQty: 0,
      stock: Number(p.base_stock || 0)
    });
  }
  for (const l of logs) {
    const item = map.get(l.barcode);
    if (!item) continue;
    const q = Number(l.quantity || 0);
    if (l.type === "入荷") item.inQty += q;
    if (l.type === "出荷") item.outQty += q;
    if (l.type === "在庫修正") item.adjustQty += q;
  }
  for (const item of map.values()) {
    item.stock = item.base_stock + item.inQty - item.outQty + item.adjustQty;
  }
  return Array.from(map.values());
}

function render() {
  const q = el("searchInput").value.trim().toLowerCase();
  const stockRows = calcStock().filter(r =>
    !q || r.barcode.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || String(r.location).toLowerCase().includes(q)
  );
  el("stockBody").innerHTML = stockRows.map(r => `
    <tr>
      <td>${escapeHtml(r.barcode)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.location)}</td>
      <td>${r.base_stock}</td>
      <td>${r.inQty}</td>
      <td>${r.outQty}</td>
      <td>${r.adjustQty}</td>
      <td class="${r.stock < 0 ? "stock-minus" : "stock-plus"}">${r.stock}</td>
    </tr>
  `).join("");

  const filteredLogs = logs.filter(l =>
    !q || l.barcode.toLowerCase().includes(q) || String(l.product_name).toLowerCase().includes(q) ||
    String(l.staff).toLowerCase().includes(q) || String(l.memo).toLowerCase().includes(q)
  );
  el("historyBody").innerHTML = filteredLogs.map(l => `
    <tr>
      <td>${formatDate(l.created_at)}</td>
      <td>${escapeHtml(l.type)}</td>
      <td>${escapeHtml(l.staff)}</td>
      <td>${escapeHtml(l.barcode)}</td>
      <td>${escapeHtml(l.product_name || "")}</td>
      <td>${l.quantity}</td>
      <td>${escapeHtml(l.memo || "")}</td>
    </tr>
  `).join("");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleString("ja-JP"); } catch { return iso; }
}

async function registerBarcode(barcode) {
  try {
    barcode = String(barcode || "").trim();
    if (!barcode) return;

    const type = el("type").value;
    const staff = el("staff").value.trim();
    const qty = Number(el("qty").value || 1);
    const memo = el("memo").value.trim();

    if (!staff) {
      beep(false);
      showMessage("担当者を入力してください。", "err");
      return;
    }
    if (!qty || (type !== "在庫修正" && qty < 1)) {
      beep(false);
      showMessage("数量を確認してください。", "err");
      return;
    }

    const product = products.find(p => p.barcode === barcode);
    if (!product) {
      beep(false);
      showMessage(`未登録バーコード：${barcode}。先に商品登録してください。`, "err");
      el("productBarcode").value = barcode;
      return;
    }

    if (type === "出荷") {
      const stock = calcStock().find(s => s.barcode === barcode)?.stock ?? 0;
      if (stock - qty < 0) {
        beep(false);
        showMessage(`在庫不足：${product.name} / 現在庫 ${stock} / 出荷数 ${qty}`, "err");
        return;
      }
    }

    await supabaseRequest("inventory_logs", {
      method: "POST",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({
        type,
        staff,
        barcode,
        product_name: product.name,
        quantity: qty,
        memo
      })
    });

    beep(true);
    showMessage(`${type}登録：${product.name} / 数量 ${qty}`, "ok");
    el("barcodeInput").value = "";
    await reloadAll();
    el("barcodeInput").focus();
  } catch (e) {
    beep(false);
    showMessage("登録エラー。\n" + e.message, "err");
  }
}

async function saveProduct(e) {
  e.preventDefault();
  try {
    const barcode = el("productBarcode").value.trim();
    const name = el("productName").value.trim();
    const base_stock = Number(el("baseStock").value || 0);
    const location = el("location").value.trim();
    if (!barcode || !name) return showMessage("バーコードと商品名は必須です。", "err");

    await upsertProducts([{ barcode, name, base_stock, location }]);

    beep(true);
    showMessage(`商品登録・更新：${name}`, "ok");
    el("productBarcode").value = "";
    el("productName").value = "";
    el("baseStock").value = "0";
    el("location").value = "";
    await reloadAll();
  } catch (e) {
    beep(false);
    showMessage("商品登録エラー。\n" + e.message, "err");
  }
}

async function upsertProducts(rows) {
  await supabaseRequest("products?on_conflict=barcode", {
    method: "POST",
    headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (inQuotes) {
      if (c === '"' && n === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c !== "\r") {
        field += c;
      }
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/\s/g, "");
}

function getValue(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return "";
}

async function importCsvFile(file) {
  try {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) throw new Error("CSVにデータ行がありません。");

    const headers = parsed[0].map(normalizeHeader);
    const rows = [];

    for (let i = 1; i < parsed.length; i++) {
      const raw = {};
      headers.forEach((h, idx) => raw[h] = (parsed[i][idx] ?? "").trim());

      const barcode = String(getValue(raw, ["barcode", "バーコード", "jan", "jancode", "janコード", "品番"])).trim();
      const name = String(getValue(raw, ["name", "商品名", "productname", "product_name", "品名"])).trim();
      const stockRaw = String(getValue(raw, ["base_stock", "basestock", "現在在庫", "在庫", "原在庫", "stock", "quantity", "数量"])).replace(/,/g, "").trim();
      const location = String(getValue(raw, ["location", "棚番", "ロケーション", "場所"])).trim();

      if (!barcode && !name) continue;
      if (!barcode || !name) throw new Error(`${i + 1}行目：バーコードまたは商品名が空です。`);

      const base_stock = Number(stockRaw || 0);
      if (!Number.isFinite(base_stock)) throw new Error(`${i + 1}行目：在庫数が数字ではありません。`);

      rows.push({ barcode, name, base_stock, location });
    }

    if (rows.length === 0) throw new Error("取り込み対象データがありません。");

    // Supabase REST has payload size limits. Split into chunks.
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await upsertProducts(rows.slice(i, i + chunkSize));
    }

    beep(true);
    showMessage(`CSV取り込み完了：${rows.length}件の商品を登録・更新しました。`, "ok");
    await reloadAll();
  } catch (e) {
    beep(false);
    showMessage("CSV取り込みエラー。\n" + e.message, "err");
  } finally {
    el("csvFile").value = "";
  }
}

function downloadSampleCsv() {
  const csv = "\uFEFFbarcode,name,base_stock,location\n4901234567890,サンプル商品A,10,A-01\n4909876543210,サンプル商品B,5,B-01\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "product_import_sample.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function startCamera() {
  try {
    if (!("BarcodeDetector" in window)) {
      showMessage("このブラウザはカメラバーコード読取に未対応です。Chrome系ブラウザか、手入力欄＋外付けスキャナを使ってください。", "err");
      return;
    }
    detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code"] });
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = el("video");
    video.srcObject = videoStream;
    video.style.display = "block";
    await video.play();
    scanning = true;
    scanLoop();
  } catch (e) {
    showMessage("カメラ起動エラー。\n" + e.message, "err");
  }
}

function stopCamera() {
  scanning = false;
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  el("video").style.display = "none";
}

async function scanLoop() {
  if (!scanning || !detector) return;
  try {
    const codes = await detector.detect(el("video"));
    if (codes.length) {
      const code = codes[0].rawValue;
      const t = Date.now();
      if (code !== lastScan || t - lastScanAt > 1800) {
        lastScan = code;
        lastScanAt = t;
        await registerBarcode(code);
      }
    }
  } catch (_) {}
  requestAnimationFrame(scanLoop);
}

function exportCsv() {
  const rows = [["日時","区分","担当者","バーコード","商品名","数量","備考"]];
  for (const l of logs) rows.push([formatDate(l.created_at), l.type, l.staff, l.barcode, l.product_name, l.quantity, l.memo || ""]);
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "inventory_history.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

el("reloadBtn").addEventListener("click", reloadAll);
el("productForm").addEventListener("submit", saveProduct);
el("manualForm").addEventListener("submit", (e) => { e.preventDefault(); registerBarcode(el("barcodeInput").value); });
el("startCameraBtn").addEventListener("click", startCamera);
el("stopCameraBtn").addEventListener("click", stopCamera);
el("searchInput").addEventListener("input", render);
el("clearFilterBtn").addEventListener("click", () => { el("searchInput").value = ""; render(); });
el("csvBtn").addEventListener("click", exportCsv);
el("csvFile").addEventListener("change", (e) => importCsvFile(e.target.files[0]));
el("downloadSampleCsvBtn").addEventListener("click", downloadSampleCsv);

reloadAll();
