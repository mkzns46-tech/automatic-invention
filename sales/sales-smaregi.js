async function salesUpsertProducts(rows) {
  if (!rows.length) return;
  try {
    await salesFetch("products?on_conflict=barcode", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
  } catch (e) {
    if (!String(e.message || e).includes("price")) throw e;
    const withoutPrice = rows.map(({ price, ...row }) => row);
    await salesFetch("products?on_conflict=barcode", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(withoutPrice)
    });
    throw new Error("products.price column is missing. Product data was imported without prices. Run supabase_products_price_update.sql first.");
  }
}

function salesNormalizeSmaregiProduct(row) {
  const product = {
    barcode: String(row.barcode || ""),
    name: String(row.name || ""),
    category: String(row.category || ""),
    genre: String(row.genre || ""),
    department: String(row.department || ""),
    location: String(row.location || ""),
    smaregi_product_id: String(row.smaregi_product_id || "").trim() || null
  };
  if (Object.prototype.hasOwnProperty.call(row, "price")) {
    product.price = Number(row.price || 0);
  }
  return product;
}

function buildSalesSmaregiPriceNote(data, priceCount) {
  const priceApi = data.priceApi || {};
  const source = data.priceSource || {};
  if (priceCount) {
    return [
      `価格反映: ${priceCount}件`,
      `店舗別価格: ${Number(source.storeProductPriceCount || 0)}件`,
      `商品一覧内価格: ${Number(source.inlineProductCount || 0)}件`
    ].join(" / ");
  }
  if (priceApi.attempted && !priceApi.ok) {
    return `価格取得失敗: ${priceApi.error || "unknown error"}`;
  }
  if (!priceApi.attempted) {
    return `価格取得未実行: ${priceApi.error || "storeId is not configured"}`;
  }
  return "価格取得結果: 0件";
}

async function readSalesApiJson(response) {
  const responseText = await response.text().catch(() => "");
  const statusInfo = {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: responseText
  };
  console.log("[Sales Smaregi API response]", statusInfo);
  if (!responseText) {
    const error = new Error(`API応答なし（HTTP ${response.status}）`);
    error.apiStatus = response.status;
    error.apiBody = "";
    throw error;
  }
  try {
    const data = JSON.parse(responseText);
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `API error ${response.status}`);
      error.apiStatus = response.status;
      error.apiBody = responseText;
      error.apiData = data;
      throw error;
    }
    return data;
  } catch (e) {
    if (e.apiStatus) throw e;
    const error = new Error(`JSON解析失敗（HTTP ${response.status}）`);
    error.apiStatus = response.status;
    error.apiBody = responseText;
    error.parseError = e.message || String(e);
    throw error;
  }
}

function getSalesImportErrorTitle(error) {
  const message = String(error?.message || "");
  const body = String(error?.apiBody || "");
  if (message.includes("API応答なし")) return "API応答なし";
  if (message.includes("JSON解析失敗")) return "JSON解析失敗";
  if (message.includes("OAuth") || message.includes("auth") || body.includes("OAuth")) return "スマレジ認証失敗";
  return "取込失敗";
}

function formatSalesImportError(error) {
  const lines = [
    error?.message || "スマレジ商品マスター取込に失敗しました。"
  ];
  if (error?.apiStatus) lines.push(`HTTP status: ${error.apiStatus}`);
  if (error?.parseError) lines.push(`parse error: ${error.parseError}`);
  if (error?.apiBody) lines.push(`response: ${String(error.apiBody).slice(0, 500)}`);
  return lines.join("\n");
}

async function importSalesSmaregiProducts() {
  const button = document.getElementById("salesSmaregiImportBtn");
  const oldText = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "取込中...";
    }
    showSalesMessage("新スマレジ商品マスターを取り込み中...", "");
    const res = await fetch("/api/smaregi-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await readSalesApiJson(res);
    const rows = (Array.isArray(data.products) ? data.products : [])
      .map(salesNormalizeSmaregiProduct)
      .filter(row => row.barcode && row.name);
    for (let i = 0; i < rows.length; i += 500) {
      await salesUpsertProducts(rows.slice(i, i + 500));
    }
    const priceCount = rows.filter(row => Object.prototype.hasOwnProperty.call(row, "price")).length;
    const priceNote = buildSalesSmaregiPriceNote(data, priceCount);
    const message = `商品マスター取込完了: ${rows.length}件\n${priceNote}`;
    const type = priceCount ? "ok" : "warn";
    showSalesMessage(message, type);
    if (typeof showSalesPopup === "function") {
      showSalesPopup(type === "ok" ? "取込完了" : "取込完了（価格警告）", message, type);
    }
  } catch (e) {
    console.error("[Sales Smaregi Import Error]", e);
    const message = formatSalesImportError(e);
    showSalesMessage(message, "err");
    if (typeof showSalesPopup === "function") {
      showSalesPopup(getSalesImportErrorTitle(e), message, "err");
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "スマレジ商品マスター取込";
    }
  }
}
