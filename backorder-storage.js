(function(){
  const MAKESHOP_RE = /取寄せ|取り寄せ/;
  function parseCsv(text){
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i += 1) {
      const char = src[i];
      const next = src[i + 1];
      if (quoted) {
        if (char === '"' && next === '"') { value += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(value); value = ""; }
      else if (char === "\n") { row.push(value); rows.push(row); row = []; value = ""; }
      else if (char !== "\r") value += char;
    }
    row.push(value);
    if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map(normalizeHeader);
    return rows.filter(cells => cells.some(cell => String(cell).trim() !== "")).map(cells => {
      const record = {};
      headers.forEach((header, index) => { record[header] = String(cells[index] ?? "").trim(); });
      return record;
    });
  }
  function normalizeHeader(value){ return String(value || "").replace(/\s/g, "").replace(/　/g, "").toLowerCase(); }
  function pick(record, names){
    for (const name of names) {
      const key = normalizeHeader(name);
      if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== "") return record[key];
    }
    return "";
  }
  function toNumber(value, fallback){ return window.BackorderStorage.toNumber(value, fallback); }
  function parseMakeShop(text){
    return parseCsv(text).map(record => {
      const productName = pick(record, ["商品名", "商品名1", "品名", "商品"]);
      const variation = pick(record, ["バリエーション", "オプション", "選択肢", "規格", "種類"]);
      if (!MAKESHOP_RE.test(`${productName} ${variation}`)) return null;
      const orderNo = pick(record, ["注文番号", "受注番号", "オーダー番号", "注文no", "orderno"]);
      const productCode = pick(record, ["商品コード", "独自商品コード", "型番", "品番", "productcode"]);
      return {
        source: "MakeShop",
        orderDate: normalizeDate(pick(record, ["注文日", "受注日", "注文日時", "date"])),
        orderNo,
        customerName: pick(record, ["注文者", "注文者名", "購入者", "購入者名", "氏名", "顧客名"]),
        productName,
        variation,
        productCode,
        janCode: pick(record, ["JANコード", "JAN", "バーコード", "barcode"]),
        orderQty: toNumber(pick(record, ["数量", "注文数量", "個数", "購入数"]), 1),
        duplicateKey: ["makeshop", orderNo, productCode, productName, variation].join("|")
      };
    }).filter(Boolean);
  }
  function parseSmaregi(text){
    return parseCsv(text).map(record => {
      const stockQty = toNumber(pick(record, ["在庫数", "現在在庫数", "在庫", "stock", "stockquantity"]), NaN);
      if (!Number.isFinite(stockQty) || stockQty > 0) return null;
      const transactionNo = pick(record, ["取引番号", "取引ID", "取引id", "伝票番号", "レシート番号", "transactionid"]);
      const productCode = pick(record, ["商品コード", "商品ID", "商品id", "品番", "productcode"]);
      const productName = pick(record, ["商品名", "品名", "商品"]);
      const qty = Math.abs(toNumber(pick(record, ["数量", "販売数量", "不足数量", "注文数量"]), stockQty || 1)) || 1;
      return {
        source: "スマレジ",
        orderDate: normalizeDate(pick(record, ["取引日", "販売日", "日付", "日時", "date"])),
        orderNo: transactionNo,
        customerName: pick(record, ["会員名", "顧客名", "購入者", "注文者"]),
        productName,
        variation: pick(record, ["バリエーション", "規格", "部門名", "カテゴリ"]),
        productCode,
        janCode: pick(record, ["JANコード", "JAN", "バーコード", "barcode"]),
        orderQty: qty,
        memo: `CSV在庫数: ${stockQty}`,
        duplicateKey: ["smaregi", transactionNo, productCode, productName, qty].join("|")
      };
    }).filter(Boolean);
  }
  function normalizeDate(value){
    const text = String(value || "").trim();
    if (!text) return "";
    const match = text.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
    if (!match) return text.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  function toCsv(rows){
    const headers = ["注文日","注文番号/取引番号","注文者","注文元","商品名","バリエーション","商品コード","JANコード","注文数量","入荷数量","残数量","ステータス","発注先","担当者","入荷予定日","入荷日","完了日","キャンセル理由","メモ"];
    const body = rows.map(row => [row.orderDate,row.orderNo,row.customerName,row.source,row.productName,row.variation,row.productCode,row.janCode,row.orderQty,row.receivedQty,row.remainingQty,row.status,row.supplier,row.staff,row.expectedArrivalDate,row.arrivalDate,row.completedDate,row.cancelReason,row.memo].map(escapeCsv).join(","));
    return [headers.join(","), ...body].join("\r\n");
  }
  function escapeCsv(value){
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  window.BackorderCsv = { parseMakeShop, parseSmaregi, toCsv };
})();
