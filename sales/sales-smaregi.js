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
    throw new Error("products.price column is missing. Product data was imported without prices. Run supabase_products_price_update.sql first.");
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

function buildSalesSmaregiPriceNote(data, priceCount) {
  const apiPriceCount = Number(data.priceCount || priceCount || 0);
  const priceApi = data.priceApi || {};
  const source = data.priceSource || {};
  if (apiPriceCount) {
    return [
      `Prices: ${priceCount}`,
      `store price matched: ${Number(source.storeProductPriceCount || 0)}`,
      `product response price: ${Number(source.inlineProductCount || 0)}`
    ].join(" / ");
  }
  if (priceApi.attempted && !priceApi.ok) {
    return `Prices: 0. Store price API failed: ${priceApi.error || "unknown error"}`;
  }
  if (!priceApi.attempted) {
    return `Prices: 0. Store price API was skipped: ${priceApi.error || "storeId is not configured"}`;
  }
  return "Prices: 0. Smaregi returned no product prices.";
}

async function importSalesSmaregiProducts() {
  const button = document.getElementById("salesSmaregiImportBtn");
  const accountKey = document.getElementById("salesSmaregiAccount")?.value || "old";
  const storeCode = document.getElementById("salesSmaregiStore")?.value || "tokyo";
  const oldText = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Importing...";
    }
    showSalesMessage("Smaregi product master import started.", "");
    const res = await fetch("/api/smaregi-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountKey, storeCode })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    const rows = (Array.isArray(data.products) ? data.products : [])
      .map(salesNormalizeSmaregiProduct)
      .filter(row => row.barcode && row.name);
    for (let i = 0; i < rows.length; i += 500) {
      await salesUpsertProducts(rows.slice(i, i + 500));
    }
    const priceCount = rows.filter(row => Number(row.price || 0) > 0).length;
    const apiPriceCount = Number(data.priceCount || priceCount || 0);
    const priceNote = buildSalesSmaregiPriceNote(data, priceCount);
    showSalesMessage(`Smaregi import complete. Products: ${rows.length} / ${priceNote}`, apiPriceCount ? "ok" : "warn");
  } catch (e) {
    showSalesMessage(e.message || "Smaregi product master import failed.", "err");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldText || "スマレジ商品マスター取込";
    }
  }
}
