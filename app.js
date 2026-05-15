const CONFIG_KEY = "barcode_inventory_supabase_config_v1";
let supabaseClient = null;
let products = [];
let logs = [];
let videoStream = null;
let detector = null;
let scanning = false;
let lastScan = "";
let lastScanAt = 0;

const el = (id) => document.getElementById(id);

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

function nowIsoJp() {
  return new Date().toISOString();
}

function loadConfig() {
  const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  el("supabaseUrl").value = saved.url || "";
  el("supabaseKey").value = saved.key || "";
  if (saved.url && saved.key) initSupabase(saved.url, saved.key);
}

function saveConfig() {
  const url = el("supabaseUrl").value.trim();
  const key = el("supabaseKey").value.trim();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
  initSupabase(url, key);
}

async function initSupabase(url, key) {
  if (!url || !key) return;
  supabaseClient = supabase.createClient(url, key);
  showMessage("接続中...");
  await reloadAll();
}

async function reloadAll() {
  if (!supabaseClient) {
    showMessage("Supabase設定を保存してください。", "err");
    return;
  }
  const { data: p, error: pe } = await supabaseClient.from("products").select("*").order("name");
  const { data: l, error: le } = await supabaseClient.from("inventory_logs").select("*").order("created_at", { ascending: false }).limit(500);
  if (pe || le) {
    showMessage("データ取得エラー。SQL設定やSupabaseキーを確認してください。", "err");
    return;
  }
  products = p || [];
  logs = l || [];
  render();
  showMessage("準備OK。スマホカメラまたは手入力で登録できます。", "ok");
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

  const payload = {
    type,
    staff,
    barcode,
    product_name: product.name,
    quantity: qty,
    memo,
    created_at: nowIsoJp()
  };

  const { error } = await supabaseClient.from("inventory_logs").insert(payload);
  if (error) {
    beep(false);
    showMessage("登録エラー：" + error.message, "err");
    return;
  }

  beep(true);
  showMessage(`${type}登録：${product.name} / 数量 ${qty}`, "ok");
  el("barcodeInput").value = "";
  await reloadAll();
  el("barcodeInput").focus();
}

async function saveProduct(e) {
  e.preventDefault();
  if (!supabaseClient) return showMessage("Supabase設定を保存してください。", "err");
  const barcode = el("productBarcode").value.trim();
  const name = el("productName").value.trim();
  const base_stock = Number(el("baseStock").value || 0);
  const location = el("location").value.trim();
  if (!barcode || !name) return showMessage("バーコードと商品名は必須です。", "err");

  const { error } = await supabaseClient.from("products").upsert({ barcode, name, base_stock, location }, { onConflict: "barcode" });

  if (error) {
    showMessage("商品登録エラー：" + error.message, "err");
    return;
  }
  beep(true);
  showMessage(`商品登録・更新：${name}`, "ok");
  el("productBarcode").value = "";
  el("productName").value = "";
  el("baseStock").value = "0";
  el("location").value = "";
  await reloadAll();
}

async function startCamera() {
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

el("saveConfigBtn").addEventListener("click", saveConfig);
el("reloadBtn").addEventListener("click", reloadAll);
el("productForm").addEventListener("submit", saveProduct);
el("manualForm").addEventListener("submit", (e) => { e.preventDefault(); registerBarcode(el("barcodeInput").value); });
el("startCameraBtn").addEventListener("click", startCamera);
el("stopCameraBtn").addEventListener("click", stopCamera);
el("searchInput").addEventListener("input", render);
el("clearFilterBtn").addEventListener("click", () => { el("searchInput").value = ""; render(); });
el("csvBtn").addEventListener("click", exportCsv);

loadConfig();
