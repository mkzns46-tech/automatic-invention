function quoteEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function printQuotePdf(quote) {
  if (!quote?.quoteNo) return;
  const totals = calcQuoteTotals(quote);
  const rows = (quote.lines || []).map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${quoteEscape(line.name)}</td>
      <td>${quoteEscape(line.smaregiProductId || line.barcode || "")}</td>
      <td class="num">${Number(line.qty || 0)}</td>
      <td>${quoteEscape(line.unit || "")}</td>
      <td class="num">${salesYen(line.unitPrice)}</td>
      <td class="num">${salesYen(line.amount)}</td>
    </tr>
  `).join("");
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${quoteEscape(quote.quoteNo)}</title>
<style>
@page { size: A4; margin: 16mm; }
body { font-family: "Yu Gothic", "Meiryo", sans-serif; color:#10251d; font-size:13px; }
.title { text-align:center; font-size:28px; font-weight:800; letter-spacing:.18em; margin:4px 0 18px; }
.top { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:20px; }
.company { text-align:right; line-height:1.65; }
.company strong { font-size:16px; }
.customer { line-height:1.7; }
.doc-meta { margin:12px 0; line-height:1.7; }
.total { border:2px solid #111; padding:12px 18px; font-size:24px; font-weight:800; margin:18px 0; display:inline-block; }
table { width:100%; border-collapse:collapse; margin-top:12px; }
th, td { border:1px solid #999; padding:7px; font-size:12px; }
th { background:#eaf5ee; }
.num { text-align:right; }
.summary { width:320px; margin-left:auto; margin-top:18px; }
.summary div { display:flex; justify-content:space-between; border-bottom:1px solid #ccc; padding:6px 0; }
.summary .grand { border-bottom:2px solid #111; font-size:15px; }
.memo { margin-top:24px; white-space:pre-wrap; border-top:1px solid #ccc; padding-top:12px; }
</style>
</head>
<body>
<div class="title">見積書</div>
<div class="top">
  <div class="customer">
    <strong>${quoteEscape(quote.customerName)} 御中</strong><br>
    ${quoteEscape(quote.address)}<br>
    TEL ${quoteEscape(quote.phone)}
  </div>
  <div class="company">
    <strong>株式会社ARICO ARCHERY</strong><br>
    登録番号: T8180001160066<br>
    〒454-0014<br>
    愛知県名古屋市中川区柳川町3-18<br>
    TEL: 052-990-4188<br>
    代表者: 尹 惠善<br>
    担当者: ${quoteEscape(quote.staff)}
  </div>
</div>
<div class="doc-meta">見積番号: ${quoteEscape(quote.quoteNo)}　見積日: ${quoteEscape(quote.quoteDate)}　有効期限: ${quoteEscape(quote.validUntil)}</div>
<p>下記の通り、お見積りいたします。</p>
<div class="total">合計金額 ${salesYen(totals.total)}（税込）</div>
<table>
  <thead><tr><th>No</th><th>商品名</th><th>商品コード</th><th>数量</th><th>単位</th><th>税込単価</th><th>税込金額</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="summary">
  <div><span>小計</span><strong>${salesYen(totals.subtotal)}</strong></div>
  <div><span>値引き</span><strong>${salesYen(totals.discount)}</strong></div>
  <div class="grand"><span>合計</span><strong>${salesYen(totals.total)}</strong></div>
  <div><span>内消費税（10%）</span><strong>${salesYen(totals.tax)}</strong></div>
</div>
<div class="memo"><strong>備考</strong><br>${quoteEscape(quote.memo || "")}</div>
<script>window.onload=()=>{window.print();};</script>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
