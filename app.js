// ===== 固定設定 =====
const SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";

// Supabase の Publishable key を貼る
const SUPABASE_API_KEY = "sb_publishable_ここにあなたのキー";
// ====================

let products = [];
let logs = [];
let videoStream = null;
let detector = null;
let scanning = false;
let lastScan = "";
let lastScanAt = 0;

const el = (id) => document.getElementById(id);

function getConfig() {
  return {
    url: SUPABASE_URL.replace(/\/+$/, ""),
    key: SUPABASE_API_KEY.trim()
  };
}

function showMessage(text, type = "") {
  const m = el("message");
  if (!m) return;
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

    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, ok ? 90 : 220);

  } catch (_) {}
}

async function supabaseRequest(path, options = {}) {

  const { url, key } = getConfig();

  const headers = {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers || {})
  };

  const res = await fetch(url + "/rest/v1/" + path, {
    ...options,
    headers
  });

  const text = await res.text();

  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    throw new Error(
      typeof body === "object"
        ? JSON.stringify(body)
        : String(body || "")
    );
  }

  return body;
}

async function reloadAll() {

  try {

    showMessage("接続中...");

    products = await supabaseRequest(
      "products?select=*&order=name.asc"
    );

    logs = await supabaseRequest(
      "inventory_logs?select=*&order=created_at.desc&limit=500"
    );

    render();

    showMessage(
      "準備OK。スマホカメラまたは手入力で登録できます。",
      "ok"
    );

  } catch (e) {

    showMessage(
      "データ取得エラー\n" + e.message,
      "err"
    );
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

    item.stock =
      item.base_stock +
      item.inQty -
      item.outQty +
      item.adjustQty;
  }

  return Array.from(map.values());
}

function render() {

  const q =
    el("searchInput")?.value
      ?.trim()
      ?.toLowerCase() || "";

  const stockRows = calcStock().filter((r) =>
    !q ||
    r.barcode.toLowerCase().includes(q) ||
    r.name.toLowerCase().includes(q) ||
    String(r.location).toLowerCase().includes(q)
  );

  el("stockBody").innerHTML =
    stockRows.map((r) => `
      <tr>
        <td>${r.barcode}</td>
        <td>${r.name}</td>
        <td>${r.location}</td>
        <td>${r.base_stock}</td>
        <td>${r.inQty}</td>
        <td>${r.outQty}</td>
        <td>${r.adjustQty}</td>
        <td>${r.stock}</td>
      </tr>
    `).join("");

  const filteredLogs = logs.filter((l) =>
    !q ||
    l.barcode.toLowerCase().includes(q) ||
    String(l.product_name).toLowerCase().includes(q)
  );

  el("historyBody").innerHTML =
    filteredLogs.map((l) => `
      <tr>
        <td>${new Date(l.created_at).toLocaleString("ja-JP")}</td>
        <td>${l.type}</td>
        <td>${l.staff}</td>
        <td>${l.barcode}</td>
        <td>${l.product_name}</td>
        <td>${l.quantity}</td>
        <td>${l.memo || ""}</td>
      </tr>
    `).join("");
}

async function upsertProducts(rows) {

  await supabaseRequest(
    "products?on_conflict=barcode",
    {
      method: "POST",
      headers: {
        Prefer:
          "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows)
    }
  );
}

async function saveProduct(e) {

  e.preventDefault();

  try {

    const barcode =
      el("productBarcode").value.trim();

    const name =
      el("productName").value.trim();

    const base_stock =
      Number(el("baseStock").value || 0);

    const location =
      el("location").value.trim();

    await upsertProducts([
      {
        barcode,
        name,
        base_stock,
        location
      }
    ]);

    beep(true);

    showMessage(
      `商品登録・更新：${name}`,
      "ok"
    );

    await reloadAll();

  } catch (e) {

    beep(false);

    showMessage(
      "商品登録エラー\n" + e.message,
      "err"
    );
  }
}

async function registerBarcode(barcode) {

  try {

    barcode = String(barcode || "").trim();

    if (!barcode) return;

    const type = el("type").value;
    const staff = el("staff").value.trim();
    const qty = Number(el("qty").value || 1);
    const memo = el("memo").value.trim();

    const product =
      products.find((p) =>
        p.barcode === barcode
      );

    if (!product) {

      beep(false);

      showMessage(
        `未登録バーコード：${barcode}`,
        "err"
      );

      return;
    }

    await supabaseRequest(
      "inventory_logs",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          type,
          staff,
          barcode,
          product_name: product.name,
          quantity: qty,
          memo
        })
      }
    );

    beep(true);

    showMessage(
      `${type}登録：${product.name}`,
      "ok"
    );

    await reloadAll();

  } catch (e) {

    beep(false);

    showMessage(
      "登録エラー\n" + e.message,
      "err"
    );
  }
}

el("reloadBtn")
  ?.addEventListener("click", reloadAll);

el("productForm")
  ?.addEventListener("submit", saveProduct);

el("manualForm")
  ?.addEventListener("submit", (e) => {

    e.preventDefault();

    registerBarcode(
      el("barcodeInput").value
    );
  });

reloadAll();
