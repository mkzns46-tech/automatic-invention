function printReceiptPdf(receipt) {
  if (!receipt) return;
  const money = value => Number(value || 0).toLocaleString("ja-JP") + "円";
  const win = window.open("", "_blank");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>領収書 ${receipt.receiptNo || ""}</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#10251b;margin:38px}
    h1{font-size:30px;margin:0 0 24px;text-align:center}.row{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px}
    .box{border:1px solid #cfe6d7;border-radius:10px;padding:14px;margin-bottom:16px}.amount{font-size:28px;font-weight:900;border-bottom:3px double #10251b;padding:14px 0;margin:18px 0}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #cfe6d7;padding:9px;text-align:left}th{background:#eaf6ee;width:180px}
  </style></head><body>
    <h1>領収書</h1>
    <div class="row">
      <div><strong>${receipt.customerName || ""} 御中</strong><p>${receipt.subject || ""}</p></div>
      <div class="box">領収書番号：${receipt.receiptNo || ""}<br>請求書番号：${receipt.sourceInvoiceNo || ""}<br>発行日：${receipt.issuedAt || ""}</div>
    </div>
    <div class="amount">金額 ${money(receipt.amount)}</div>
    <p>上記正に領収いたしました。</p>
    <table>
      <tr><th>入金日</th><td>${receipt.paymentDate || ""}</td></tr>
      <tr><th>入金方法</th><td>${receipt.method || "振込"}</td></tr>
      <tr><th>振込名義</th><td>${receipt.payerName || ""}</td></tr>
      <tr><th>担当者</th><td>${receipt.staff || ""}</td></tr>
      <tr><th>備考</th><td>${receipt.memo || ""}</td></tr>
    </table>
    <div class="box" style="margin-top:28px">発行元：ARICO ARCHERY<br>登録番号：T8180001160066</div>
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}
