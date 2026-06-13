async function salesUpsertProducts(rows) {
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
    throw new Error("products.price列が未作成のため、価格以外の商品情報のみ取り込みました。supabase_products_price_update.sql を実行してください。");
  }
}

function salesNormalizeSmaregiProduct(row) {
  return {
    barcode: String(row.barcode || ""),
    name: String(row.name || ""),
    category: String(row.category || ""),
    genre: String(row.genre || ""),
    department: String(row.department || ""),
    location: String(row.location || ""),
    smaregi_product_id: String(row.smaregi_product_id || "").trim() || null,
    price: Number(row.price || 0)
  };
}

async function importSalesSmaregiProducts() {
  const button = document.getElementById("salesSmaregiImportBtn");
  const accountKey = document.getElementById("salesSmaregiAccount")?.value || "old";
  const storeCode = document.getElementById("salesSmaregiStore")?.value || "tokyo";
  const oldText = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "取得中...";
    }
    showSalesMessage("スマレジ商品マスターを取得しています。", "");
    const res = await fetch("/api/smaregi-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountKey, storeCode })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `APIエラー ${res.status}`);
    const rows = (Array.isArray(data.products) ? data.products : [])
      .map(salesNormalizeSmaregiProduct)
      .filter(row => row.barcode && row.name);
    for (let i = 0; i < rows.length; i += 500) {
      await salesUpsertProducts(rows.slice(i, i + 500));
    }
    const priceCount = rows.filter(row => Number(row.price || 0) > 0).length;
    showSalesMessage(`スマレジ商品マスターを取り込みました。商品数: ${rows.length}件 / 価格あり: ${priceCount}件`, "ok");
  } catch (e) {
    showSalesMessage(e.message || "スマレジ商品マスター取得に失敗しました。", "err");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "スマレジ商品マスター取込";
    }
  }
}
