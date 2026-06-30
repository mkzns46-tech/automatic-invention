(function(){
  const MAKESHOP_RE = /取寄せ|取り寄せ/;
  const STOCK_HEADERS = ["在庫数", "現在在庫数", "在庫", "実在庫", "在庫数量", "stock", "stockquantity"];
  function normalizeHeader(value){ return String(value || "").replace(/^\uFEFF/, "").replace(/[\s　]/g, "").toLowerCase(); }
  function cleanCell(value){ let text = String(value ?? "").trim(); const excel = text.match(/^="(.*)"$/); if (excel) text = excel[1]; return text; }
  async function readFileText(file){
    const buffer = await file.arrayBuffer();
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch(error) {}
    try { return new TextDecoder("shift_jis").decode(buffer); } catch(error) {}
    return new TextDecoder().decode(buffer);
  }
  function parseCsv(text){
    const rows = [];
    let row = [], value = "", quoted = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < src.length; i += 1) {
      const c = src[i], n = src[i + 1];
      if (quoted) {
        if (c === '"' && n === '"') { value += '"'; i += 1; }
        else if (c === '"') quoted = false;
        else value += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cleanCell(value)); value = ""; }
      else if (c === "\n") { row.push(cleanCell(value)); rows.push(row); row = []; value = ""; }
      else if (c !== "\r") value += c;
    }
    row.push(cleanCell(value));
    if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
    if (!rows.length) return { headers: [], records: [] };
    const rawHeaders = rows.shift().map(cleanCell);
    const headers = rawHeaders.map(normalizeHeader);
    const records = rows.filter(cells => cells.some(cell => String(cell).trim() !== "")).map(cells => {
      const record = { __raw: {}, __headers: rawHeaders };
      headers.forEach((header, index) => { record[header] = cleanCell(cells[index]); record.__raw[rawHeaders[index]] = cleanCell(cells[index]); });
      return record;
    });
    return { headers: rawHeaders, records };
  }
  function pick(record, names){
    for (const name of names) {
      const key = normalizeHeader(name);
      if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== "") return record[key];
    }
    return "";
  }
  function hasAnyHeader(headers, names){ const set = new Set(headers.map(normalizeHeader)); return names.find(name => set.has(normalizeHeader(name))) || ""; }
  function toNumber(value, fallback){ return window.BackorderStorage.toNumber(value, fallback); }
  function normalizeDate(value){
    const text = String(value || "").trim();
    if (!text) return "";
    const match = text.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
    if (!match) return text.slice(0, 10);
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  function parseMakeShop(text){
    const parsed = parseCsv(text);
    const rows = parsed.records.map(record => {
      const productName = pick(record, ["商品名"]);
      const variation = pick(record, ["OPTION+商品別特殊表示", "バリエーション", "オプション"]);
      if (!MAKESHOP_RE.test(`${productName} ${variation}`)) return null;
      const orderNumber = pick(record, ["注文番号"]);
      const productCode = pick(record, ["商品コード"]);
      return {
        source: "MakeShop",
        orderDate: normalizeDate(pick(record, ["日付"])),
        orderNumber,
        customerName: pick(record, ["注文者"]),
        productName,
        variation,
        productCode,
        janCode: pick(record, ["JANコード"]),
        orderQty: toNumber(pick(record, ["個数"]), 1),
        duplicateKey: ["makeshop", orderNumber, productCode, productName, variation].join("|"),
        sourceRaw: record.__raw
      };
    }).filter(Boolean);
    return { rows, headers: parsed.headers, warnings: [] };
  }
  function parseSmaregi(text){
    const parsed = parseCsv(text);
    const stockHeader = hasAnyHeader(parsed.headers, STOCK_HEADERS);
    const warnings = [];
    if (!stockHeader) warnings.push("このスマレジCSVには在庫数列がないため、在庫0以下の抽出はできません。取引履歴として読み取りましたが登録対象は0件です。");
    const rows = stockHeader ? parsed.records.map(record => {
      const stockQty = toNumber(pick(record, STOCK_HEADERS), NaN);
      if (!Number.isFinite(stockQty) || stockQty > 0) return null;
      const transactionId = pick(record, ["取引ID", "取引番号"]);
      const productName = pick(record, ["商品名"]);
      const productCode = pick(record, ["商品コード", "商品ID"]);
      const qty = Math.abs(toNumber(pick(record, ["数量"]), 1)) || 1;
      const variation = [pick(record, ["カラー"]), pick(record, ["サイズ"])].filter(Boolean).join(" / ");
      return { source: "スマレジ", orderDate: normalizeDate(pick(record, ["取引日時"])), orderNumber: transactionId, customerName: pick(record, ["会員コード", "会員ID"]), productName, variation, productCode, janCode: pick(record, ["商品コード"]), orderQty: qty, memo: `CSV在庫数: ${stockQty}`, duplicateKey: ["smaregi", transactionId, productCode, productName, qty].join("|"), sourceRaw: record.__raw };
    }).filter(Boolean) : [];
    return { rows, headers: parsed.headers, warnings };
  }
  function toCsv(rows){
    const headers = ["注文日","注文番号/取引番号","注文者","注文元","商品名","バリエーション","商品コード","JANコード","注文数量","入荷数量","残数量","ステータス","発注先","担当者","入荷予定日","入荷日","完了日","キャンセル理由","メモ"];
    const body = rows.map(row => [row.orderDate,row.orderNumber,row.customerName,row.source,row.productName,row.variation,row.productCode,row.janCode,row.orderQty,row.receivedQty,row.remainingQty,row.status,row.supplier,row.staff,row.expectedArrivalDate,row.arrivalDate,row.completedDate,row.cancelReason,row.memo].map(escapeCsv).join(","));
    return [headers.join(","), ...body].join("\r\n");
  }
  function escapeCsv(value){ const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  window.BackorderCsv = { readFileText, parseMakeShop, parseSmaregi, toCsv, parseCsv };
})();

