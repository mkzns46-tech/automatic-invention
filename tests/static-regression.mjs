// Static regression checks for past production bugs. No dependencies.
// Run: node tests/static-regression.mjs   (exit code 1 on failure)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const pageScripts = html => [...read(html).matchAll(/<script\b[^>]*\bsrc="\.\/([^"?]+)[^"]*"/g)].map(m => m[1]);

const results = [];
function check(name, fn) {
  try {
    const problem = fn();
    results.push({ name, ok: !problem, problem });
  } catch (error) {
    results.push({ name, ok: false, problem: error.message });
  }
}

// Scripts served by the app page (index.html) plus the lazily loaded booth.js.
const appScripts = [...new Set([...pageScripts("index.html"), "booth.js"])];
const appSource = appScripts.map(file => [file, read(file)]);
const findAll = (regex) => appSource.flatMap(([file, text]) =>
  text.split(/\r?\n/).flatMap((line, i) => regex.test(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 140)}`] : []));

check("products has no id / product_code column: no PostgREST query uses them", () => {
  const hits = findAll(/products\?[^"'`]*(\bid=eq\.|select=[^&"'`]*\bid\b|product_code)/);
  return hits.length ? hits.join("\n") : "";
});

check("product_locations has no deleted_at column: never written", () => {
  const hits = findAll(/deleted_at\s*:/).filter(line => line.startsWith("shelf-location.js"));
  return hits.length ? hits.join("\n") : "";
});

check("barcode is never converted to a number", () => {
  const hits = findAll(/(parseInt|parseFloat|Number)\(\s*[\w.?]*barcode\s*\)/);
  return hits.length ? hits.join("\n") : "";
});

check("history header matches the 11 row cells", () => {
  const src = read("history.js");
  const m = src.match(/const desired=\[([^\]]+)\];\s*\n\s*row\.innerHTML=desired/);
  if (!m) return "ensureHistoryEventShelfHeaders no longer rebuilds the header from `desired`";
  const headers = m[1].split(",").length;
  const rowSrc = read("history-product-code.js");
  const body = rowSrc.slice(rowSrc.indexOf("function buildGlobalHistoryRows"));
  const cells = (body.slice(body.indexOf("return `<tr>"), body.indexOf("</tr>`")).match(/<td[ >]/g) || []).length;
  return headers === cells ? "" : `header ${headers} columns vs row ${cells} cells`;
});

check("equipmentCheckHtml keeps the status badge (no empty string for mobile)", () => {
  const src = read("smaregi-check-final.js");
  const body = src.slice(src.indexOf("window.equipmentCheckHtml=function"), src.indexOf("window.replaceEquipmentConfirmationDom"));
  if (/isEquipmentMobileView\(\)|isMobileViewport\(\)|matchMedia/.test(body)) return "equipmentCheckHtml depends on the viewport";
  return /確認済/.test(body) && /未確認/.test(body) ? "" : "status badges missing";
});

check("在庫変動登録 has no legacy event pick / gacha options", () => {
  const select = (read("index.html").match(/<select id="type">([\s\S]*?)<\/select>/) || [])[1] || "";
  return /value="(event_pick|gacha|gacha_return)"/.test(select) ? "legacy option is back in #type" : "";
});

check("departure list render function is defined (past ReferenceError)", () => {
  const booth = read("booth.js");
  return /function renderBoothDepartureInventoryListPanel\s*\(/.test(booth) ? "" : "renderBoothDepartureInventoryListPanel is not defined";
});

check("event close / delete / edits are guarded and event-scoped", () => {
  const booth = read("booth.js");
  const problems = [];
  if (!/__aricoBoothEventCloseInFlight/.test(booth)) problems.push("close in-flight guard missing");
  if (!/__aricoBoothEventDeleteInFlight/.test(booth)) problems.push("delete in-flight guard missing");
  const rollback = booth.slice(booth.indexOf("async function rollbackBoothEventStocksBeforeDelete"));
  const rollbackEnd = rollback.search(/\r?\n}\r?\n/);
  if (rollbackEnd < 0) problems.push("could not find the end of rollbackBoothEventStocksBeforeDelete");
  else if (/getBoothCurrentStoreCode\(\)/.test(rollback.slice(0, rollbackEnd))) problems.push("delete uses the UI store instead of the event store");
  if (!/reopened_at/.test(rollback.slice(0, 1200))) problems.push("delete no longer refuses closed/reopened events (double restore)");
  if (!/async function assertBoothEventOpenForEdit/.test(booth)) problems.push("closed-event edit guard missing");
  const closePatch = booth.match(/booth_event_items\?event_id=eq\.\$\{[^}]+\}&item_type=eq\.normal`[^;]*event_storage_qty:0/);
  if (!closePatch) problems.push("close no longer scopes the event_storage_qty reset to the target event_id");
  return problems.join("; ");
});

check("sales confirm only confirms applied rows", () => {
  const booth = read("booth.js");
  const body = booth.slice(booth.indexOf("async function confirmBoothSalesImport(){"), booth.indexOf("async function buildBoothDepartureInventoryData"));
  return /event_sales_imports\?event_id=eq\.\$\{encodeURIComponent\(event\.id\)\}&import_status=eq\.pending`,\{method:"PATCH"/.test(body)
    ? "confirm PATCHes every pending row of the event" : "";
});

check("イベント持ち出しCSVはバーコード基準（テンプレートも バーコード,数量）", () => {
  const booth = read("booth.js");
  const problems = [];
  if (!/parseInventoryCsv\(await file\.text\(\),\{defaultIdentity:"barcode",forceIdentity:"barcode"\}\)/.test(booth)) problems.push("持ち出しCSVの取込が見出しに関係なくバーコード基準になっていない");
  if (!/boothDepartureCsvTemplateBtn"\)\?\.addEventListener\("click",downloadBoothDepartureCsvTemplate\)/.test(booth)) problems.push("持ち出しのテンプレートボタンが商品コード用テンプレートを使っている");
  if (!/\\uFEFFバーコード,数量/.test(booth)) problems.push("バーコード用テンプレートが無い");
  return problems.join("; ");
});

check("認証の無いスマレジ書き込みAPIは停止したまま（在庫調整・売上登録/取消）", () => {
  const problems = [];
  for (const file of ["api/smaregi-stock-adjust.js"]) {
    const src = read(file).replace(/^\s*\/\/.*$/gm, ""); // コメント行は判定しない
    if (/\/stock\/|\/transactions|fetch\(/.test(src) || !/statusCode = 503/.test(src)) problems.push(`${file} がスマレジへ書き込める状態に戻っている`);
  }
  for (const file of ["api/smaregi-sales-register.js", "api/smaregi-sales-cancel.js"]) {
    if (fs.existsSync(path.join(root, file))) problems.push(`${file} が復活している`);
  }
  return problems.join("; ");
});

check("戻り保存で反映済み記録・イベント共通棚分を消さない／持ち出しRPC(v2)は event_storage_qty を加算", () => {
  const booth = read("booth.js");
  const problems = [];
  const active = booth.slice(booth.lastIndexOf("root.saveBoothReportReturnBatch=saveBoothReportReturnBatch=async function"));
  const body = active.slice(0, active.indexOf("};"));
  if (/return_reflected:false|event_storage_qty:0/.test(body)) problems.push("戻り実績の一括保存が反映済み記録または event_storage_qty を消している");
  const sql = read("sql/rpc_booth_takeout_close_v3.sql");
  if (!/event_storage_qty=coalesce\(event_item_row\.event_storage_qty,0\)\+v_qty/.test(sql)) problems.push("持ち出しRPCが event_storage_qty を加算していない");
  if (!/v_return_apply:=v_returned-v_already/.test(sql)) problems.push("締めRPCに再締めの二重戻し防止が無い");
  // 実在庫があれば持ち出せる（ARICOの通常棚在庫不足では止めない）
  if (/normal stock shortage/.test(sql)) problems.push("持ち出しRPCが通常棚在庫不足で止めている");
  const complete = booth.slice(booth.indexOf("async function completeBoothDepartureCount"), booth.indexOf("async function completeBoothDepartureCount") + 4000);
  if (/の通常棚在庫が不足しています/.test(complete)) problems.push("持ち出し確定が通常棚在庫不足で止めている");
  return problems.join("; ");
});

check("商品マスター取込は数字13桁のバーコードだけ登録・更新する（CSV / スマレジAPI）", () => {
  const src = read("product-import.js");
  const problems = [];
  if (!/function isValidMasterBarcode\(barcode\)\{\s*return \/\^\\d\{13\}\$\/\.test/.test(src)) problems.push("13桁チェック関数が無い");
  const csv = src.slice(src.indexOf("function csvToRows"), src.indexOf("async function importCsvFile"));
  if (!/isValidMasterBarcode/.test(csv)) problems.push("CSV取込で13桁チェックをしていない");
  const api = src.slice(src.indexOf("const comparisonFields="), src.indexOf("const plannedBarcodes=new Map();"));
  if (!/isValidMasterBarcode\(barcode\)/.test(api)) problems.push("スマレジAPI取込で13桁チェックをしていない");
  return problems.join("; ");
});

check("バーコード変更は products だけを書き換えず、RPCで関連データごと付け替える", () => {
  const src = read("product-import.js");
  const problems = [];
  if (!/rpc\/change_product_barcode/.test(src)) problems.push("取込がバーコード変更RPCを使っていない");
  // products.barcode を直接 PATCH で書き換えていない（barcode を含む payload で barcode=eq.旧 を更新しない）
  if (/products\?barcode=eq\.[^`"']*`?,\{method:"PATCH"[^}]*barcode:/.test(src)) problems.push("products.barcode を直接書き換えている");
  const sql = read("sql/rpc_change_product_barcode_v1.sql");
  if (!/exists\(select 1 from public\.products where barcode=v_new\)/.test(sql)) problems.push("RPCが変更先バーコードの衝突を確認していない");
  if (!/a\.attname='barcode'/.test(sql)) problems.push("RPCが関連テーブルの barcode を付け替えていない");
  return problems.join("; ");
});

check("スマレジ差異の保存で difference を null にしない（NOT NULL制約）／担当者が空でも補う", () => {
  const fin = read("smaregi-check-final.js");
  const sm = read("smaregi.js");
  const problems = [];
  if (/difference:Number\.isFinite\(Number\(calculation\?\.difference\)\) \? Number\(calculation\.difference\) : null,/.test(fin)) problems.push("保存時に difference が null になりうる");
  if (!/provisionalDifference:/.test(sm)) problems.push("仮の差異（provisionalDifference）が無い");
  const checker = sm.slice(sm.indexOf("function getSmaregiCheckerName"), sm.indexOf("function getSmaregiCheckerName") + 700);
  if (!/arico_smaregi_checker/.test(checker) || !/currentStaffName/.test(checker)) problems.push("チェック担当者が空の時の補完が無い");
  return problems.join("; ");
});

check("event register settings: unset IDs stop the sales fetch", () => {
  const booth = read("booth.js");
  return /イベント販売用レジIDが未設定/.test(booth) ? "" : "unset-register guard message not found";
});

check("no removed sales / backorder pages are referenced", () => {
  const hits = findAll(/(sales\/[a-z-]+\.html|backorder\/backorder\.html|api\/(sales-auth|smaregi-sales-register|smaregi-sales-cancel|products-base-stock-sync))/);
  return hits.length ? hits.join("\n") : "";
});

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "\n      " + String(r.problem).replace(/\n/g, "\n      ")}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
