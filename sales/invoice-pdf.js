function invoicePdfMoney(value) {
  return Number(value || 0).toLocaleString("ja-JP") + "円";
}

function invoicePdfAmountClass(value, transactionType = "") {
  return Number(value || 0) < 0 || invoicePdfIsRefundTransaction(transactionType) ? "amount-negative refund-amount" : "";
}

function invoicePdfEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function invoicePdfClampNumber(value, min, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function invoicePdfIsRefundTransaction(type) {
  return String(type || "").trim() === "返金";
}

function invoicePdfIsFreeTransaction(type) {
  const value = String(type || "").trim();
  return value === "無償提供" || value === "交換";
}

function invoicePdfNormalizeTransactionType(type) {
  const value = String(type || "").trim();
  if (value === "返品") return "返金";
  return value || "通常販売";
}

function invoicePdfRecalcLine(line) {
  const transactionType = invoicePdfNormalizeTransactionType(line.transactionType);
  const gross = Math.max(0, Math.round(Math.abs(Number(line.qty || 0)) * Math.abs(Number(line.unitPrice || 0))));
  const discountRate = invoicePdfIsFreeTransaction(transactionType)
    ? 100
    : invoicePdfClampNumber(line.discountValue ?? line.discountRate ?? 0, 0, 100);
  const rateDiscount = Math.round(gross * discountRate / 100);
  const fixedDiscount = Math.max(0, Number(line.discountAmountInput || line.fixedDiscountAmount || line.manualDiscountAmount || 0));
  const appliedFixedDiscount = invoicePdfIsFreeTransaction(transactionType) ? 0 : fixedDiscount;
  line.transactionType = transactionType;
  line.discountValue = discountRate;
  line.discountRate = discountRate;
  line.discountAmountInput = appliedFixedDiscount;
  line.discountAmount = Math.min(gross, appliedFixedDiscount > 0 ? appliedFixedDiscount : rateDiscount);
  const netAmount = Math.max(0, gross - line.discountAmount);
  line.amount = invoicePdfIsRefundTransaction(transactionType) ? -netAmount : netAmount;
  return line;
}

function calcInvoicePdfTotals(invoice) {
  let subtotal = 0;
  let discount = 0;
  let total = 0;
  (invoice.lines || []).forEach(line => {
    invoicePdfRecalcLine(line);
    const gross = Math.max(0, Math.round(Math.abs(Number(line.qty || 0)) * Math.abs(Number(line.unitPrice || 0))));
    subtotal += gross;
    discount += Number(line.discountAmount || 0);
    total += Number(line.amount || 0);
  });
  const overallDiscountAmount = Math.max(0, Number(invoice?.overallDiscountAmount || 0));
  const appliedOverallDiscount = invoicePdfIsRefundTransaction(invoice?.transactionType)
    ? overallDiscountAmount
    : Math.min(Math.max(0, total), overallDiscountAmount);
  discount += appliedOverallDiscount;
  total = invoicePdfIsRefundTransaction(invoice?.transactionType)
    ? total + appliedOverallDiscount
    : Math.max(0, total - appliedOverallDiscount);
  return {
    subtotal,
    discount,
    overallDiscountAmount: appliedOverallDiscount,
    total,
    tax: Math.floor(total * 10 / 110)
  };
}

function printInvoicePdf(invoice) {
  const doc = JSON.parse(JSON.stringify(invoice || {}));
  doc.transactionType = invoicePdfNormalizeTransactionType(doc.transactionType);
  doc.lines = (doc.lines || []).map(line => ({ ...line, transactionType: doc.transactionType || line.transactionType || "通常販売" }));
  const totals = calcInvoicePdfTotals(doc);
  const rows = (doc.lines || []).map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${invoicePdfEscape(line.name || "")}</td>
      <td class="num">${Number(line.qty || 0)}</td>
      <td>${invoicePdfEscape(line.unit || "")}</td>
      <td class="num">${invoicePdfMoney(line.unitPrice)}</td>
      <td class="num">${Number(line.discountAmountInput || 0) > 0 ? invoicePdfMoney(line.discountAmountInput) : `${Number(line.discountValue || 0)}%`}</td>
      <td class="num ${invoicePdfAmountClass(line.amount, line.transactionType)}">${invoicePdfMoney(line.amount)}</td>
    </tr>
  `).join("");
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${invoicePdfEscape(doc.invoiceNo || "invoice")}</title>
<style>
  @page{size:A4;margin:14mm}
  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}
  .top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #1b4332;padding-bottom:14px}
  h1{margin:0;font-size:30px;letter-spacing:.08em}
  .brand{font-weight:900;color:#1b4332}
  .meta{text-align:right;line-height:1.7;font-size:13px}
  .customer{margin:22px 0;font-size:15px;line-height:1.8}
  .total{display:inline-block;margin:12px 0 22px;padding:12px 22px;border:2px solid #1b4332;font-size:22px;font-weight:900}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#dcf5e2;color:#1b4332}
  th,td{border:1px solid #cfe6d7;padding:8px;text-align:left}
  .num{text-align:right}
  .amount-negative,.refund-amount{color:#b91c1c!important;font-weight:900}
  .summary{width:320px;margin:18px 0 0 auto}
  .summary div{display:flex;justify-content:space-between;border-bottom:1px solid #cfe6d7;padding:7px 0}
  .note{margin-top:22px;white-space:pre-wrap;line-height:1.7}
  .registration{margin-top:20px;font-size:12px;color:#374151}
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">ARICO ARCHERY</div>
      <h1>請求書</h1>
    </div>
    <div class="meta">
      <div>請求書番号: ${invoicePdfEscape(doc.invoiceNo || "")}</div>
      <div>請求日: ${invoicePdfEscape(doc.invoiceDate || "")}</div>
      <div>支払期限: ${invoicePdfEscape(doc.dueDate || "")}</div>
      <div>元見積: ${invoicePdfEscape(doc.sourceQuoteNo || "")}</div>
    </div>
  </div>
  <div class="customer">
    <strong>${invoicePdfEscape(doc.customerName || "")} 御中</strong><br>
    ${invoicePdfEscape(doc.address || "")}<br>
    件名: ${invoicePdfEscape(doc.subject || "")}
    <br>取引区分: ${invoicePdfEscape(doc.transactionType || "通常販売")}
    ${doc.originalSlipNumber ? `<br>元伝票番号: ${invoicePdfEscape(doc.originalSlipNumber)}` : ""}
    ${doc.reasonMemo ? `<br>理由メモ: ${invoicePdfEscape(doc.reasonMemo)}` : ""}
  </div>
  <div class="total ${invoicePdfAmountClass(totals.total, doc.transactionType)}">ご請求金額 ${invoicePdfMoney(totals.total)}</div>
  <table>
    <thead><tr><th>No.</th><th>商品名</th><th>数量</th><th>単位</th><th>税込単価</th><th>値引</th><th>金額</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">明細なし</td></tr>'}</tbody>
  </table>
  <div class="summary">
    <div><span>小計</span><strong>${invoicePdfMoney(totals.subtotal)}</strong></div>
    <div><span>値引</span><strong>${invoicePdfMoney(totals.discount)}</strong></div>
    <div><span>全体値引き</span><strong>${invoicePdfMoney(totals.overallDiscountAmount || 0)}</strong></div>
    <div><span>合計</span><strong class="${invoicePdfAmountClass(totals.total, doc.transactionType)}">${invoicePdfMoney(totals.total)}</strong></div>
    <div><span>内消費税 10%</span><strong>${invoicePdfMoney(totals.tax)}</strong></div>
  </div>
  <div class="note">${invoicePdfEscape(doc.overallDiscountReason ? `全体値引き理由: ${doc.overallDiscountReason}\n${doc.slipMemo || doc.memo || ""}` : doc.slipMemo || doc.memo || "")}</div>
  <div class="registration">登録番号 T8180001160066</div>
  <script>window.onload = () => { window.print(); setTimeout(() => { if (window.opener) window.opener.focus(); }, 300); };</script>
</body>
</html>`);
  win.document.close();
}
