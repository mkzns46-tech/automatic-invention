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
