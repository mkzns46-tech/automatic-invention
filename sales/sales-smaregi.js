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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
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
    const message = e.message || "スマレジ商品マスター取込に失敗しました。";
    showSalesMessage(message, "err");
    if (typeof showSalesPopup === "function") {
      showSalesPopup("取込失敗", message, "err");
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "スマレジ商品マスター取込";
    }
  }
}
