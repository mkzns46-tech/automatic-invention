function printDeliveryPdf(delivery) {
  if (!delivery) return;
  const money = value => Number(value || 0).toLocaleString("ja-JP") + "円";
  const isRefund = String(delivery.transactionType || "").trim() === "返金";
  const amountClass = value => Number(value || 0) < 0 || isRefund ? "amount-negative refund-amount" : "";
  const win = window.open("", "_blank");
  const rows = (delivery.lines || []).map(line => `
    <tr>
      <td>${line.name || ""}</td>
      <td>${Number(line.qty || 0)}</td>
      <td>${line.unit || ""}</td>
      <td>${money(line.unitPrice)}</td>
      <td>${Number(line.discountValue ?? line.discountRate ?? 0)}%</td>
      <td class="${amountClass(line.amount)}">${money(line.amount)}</td>
      <td>${line.memo || ""}</td>
    </tr>
  `).join("");
  const status = String(delivery.status || "").trim();
  const shippingMethod = delivery.shippingMethod || (status === "手渡し済" ? "手渡し" : status === "担当者手持ち済" ? "担当者手持ち" : "配送");
  const shippingDate = delivery.shipmentDate || delivery.handoverDate || delivery.carryOutDate || "";
  const shippingDateLabel = shippingMethod === "手渡し" ? "受け渡し日" : shippingMethod === "担当者手持ち" ? "持ち出し日" : "発送日";
  const deliveryOnlyInfo = shippingMethod === "配送"
    ? `<br>配送会社：${delivery.shippingCarrier || ""}<br>送り状番号：${delivery.trackingNumber || ""}`
    : "";
  const shippingBox = shippingDate || delivery.shippingCarrier || delivery.trackingNumber || delivery.shippingMethod
    ? `<div class="box">発送方法：${shippingMethod}<br>${shippingDateLabel}：${shippingDate || ""}${deliveryOnlyInfo}<br>担当者：${delivery.shippingStaff || ""}</div>`
    : "";
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>納品書 ${delivery.deliveryNo || ""}</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#10251b;margin:32px}
    h1{font-size:28px;margin:0 0 20px} .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px}
    .box{border:1px solid #cfe6d7;border-radius:10px;padding:12px;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #cfe6d7;padding:8px;text-align:left;font-size:13px}th{background:#eaf6ee}
    .amount-negative,.refund-amount{color:#b91c1c!important;font-weight:900}
    .summary{width:320px;margin-left:auto}.summary div{display:flex;justify-content:space-between;border-bottom:1px solid #cfe6d7;padding:6px}
  </style></head><body>
    <div class="head"><div><h1>納品書</h1><strong>${delivery.customerName || ""} 御中</strong><p>${delivery.subject || ""}</p></div>
    <div class="box">納品書番号：${delivery.deliveryNo || ""}<br>元請求書番号：${delivery.sourceInvoiceNo || ""}<br>請求日：${delivery.invoiceDate || ""}<br>発行日：${delivery.issuedAt || ""}</div></div>
    <div class="box">発行元：ARICO ARCHERY<br>登録番号：T8180001160066</div>
    ${shippingBox}
    <table><thead><tr><th>商品名</th><th>数量</th><th>単位</th><th>税込単価</th><th>値引率</th><th>金額</th><th>備考</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="summary"><div><span>小計</span><strong>${money(delivery.subtotal)}</strong></div><div><span>値引き</span><strong>${money(delivery.discount)}</strong></div><div><span>合計</span><strong class="${amountClass(delivery.total)}">${money(delivery.total)}</strong></div><div><span>内消費税</span><strong>${money(delivery.tax)}</strong></div></div>
    ${delivery.slipMemo || delivery.memo ? `<div class="box">伝票備考<br>${delivery.slipMemo || delivery.memo || ""}</div>` : ""}
  </body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function printDeliveryPdf(delivery) {
  if (window.SalesPdfFormat?.printSalesDocument) {
    window.SalesPdfFormat.printSalesDocument("delivery", delivery);
    return;
  }
  alert("PDFフォーマットを読み込めませんでした。");
}
