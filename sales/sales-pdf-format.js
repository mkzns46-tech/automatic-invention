(function () {
  const COMPANY = {
    name: "株式会社ARICO ARCHERY",
    invoiceNo: "T8180001160066",
    postal: "〒454-0014",
    address: "愛知県名古屋市中川区柳川町3-18",
    tel: "052-990-4188",
    representative: "尹恵善"
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function money(value) {
    const number = Math.round(Number(value || 0));
    const sign = number < 0 ? "-" : "";
    return `${sign}${Math.abs(number).toLocaleString("ja-JP")} 円`;
  }

  function numberOnly(value) {
    const number = Math.round(Number(value || 0));
    const sign = number < 0 ? "-" : "";
    return `${sign}${Math.abs(number).toLocaleString("ja-JP")}`;
  }

  function isRefund(type) {
    return String(type || "").trim() === "返金";
  }

  function isFree(type) {
    const value = String(type || "").trim();
    return value === "無償提供" || value === "交換";
  }

  function clampNumber(value, min, max) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeLines(doc) {
    const transactionType = doc.transactionType || "";
    return (doc.lines || doc.items || doc.products || doc.details || []).map(line => {
      const qty = Number(line.qty ?? line.quantity ?? 0);
      const unitPrice = Number(line.unitPrice ?? line.price ?? line.salesPrice ?? 0);
      const gross = Math.max(0, Math.round(Math.abs(qty) * Math.abs(unitPrice)));
      const discountRate = isFree(transactionType)
        ? 100
        : clampNumber(line.discountValue ?? line.discountRate ?? 0, 0, 100);
      const fixedDiscount = Math.max(0, Number(line.discountAmountInput || line.fixedDiscountAmount || line.manualDiscountAmount || 0));
      const discountAmount = Math.min(gross, fixedDiscount > 0 ? fixedDiscount : Math.round(gross * discountRate / 100));
      const net = Math.max(0, gross - discountAmount);
      const amount = isRefund(transactionType) ? -net : net;
      return {
        name: line.name || line.productName || "",
        qty,
        unit: line.unit || "",
        unitPrice,
        memo: line.memo || line.itemMemo || "",
        gross,
        discountAmount,
        amount
      };
    });
  }

  function calcTotals(doc, lines) {
    const subtotal = lines.reduce((sum, line) => sum + Number(line.gross || 0), 0);
    const itemDiscount = lines.reduce((sum, line) => sum + Number(line.discountAmount || 0), 0);
    const baseTotal = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const requestedOverall = Math.max(0, Number(doc.overallDiscountAmount || 0));
    const overallDiscount = isRefund(doc.transactionType)
      ? requestedOverall
      : Math.min(Math.max(0, baseTotal), requestedOverall);
    const discount = itemDiscount + overallDiscount;
    const total = isRefund(doc.transactionType)
      ? baseTotal + overallDiscount
      : Math.max(0, baseTotal - overallDiscount);
    const fallbackTotal = Number(doc.total ?? doc.amount ?? 0);
    const finalTotal = lines.length ? total : fallbackTotal;
    return {
      subtotal: lines.length ? subtotal : Math.max(0, Math.abs(fallbackTotal)),
      discount,
      total: finalTotal,
      tax: Math.floor(Math.abs(finalTotal) * 10 / 110)
    };
  }

  function documentTitle(type) {
    return {
      quote: "見積書",
      invoice: "請求書",
      delivery: "納品書",
      receipt: "領収書"
    }[type] || "帳票";
  }

  function documentNumber(type, doc) {
    return doc.quoteNo || doc.invoiceNo || doc.deliveryNo || doc.receiptNo || doc.originNumber || "";
  }

  function documentDate(type, doc) {
    if (type === "quote") return doc.quoteDate || "";
    if (type === "invoice") return doc.invoiceDate || doc.issuedAt || "";
    if (type === "delivery") return doc.deliveryDate || doc.shipmentDate || doc.issuedAt || "";
    if (type === "receipt") return doc.paymentDate || doc.issuedAt || "";
    return doc.date || "";
  }

  function infoRows(type, doc) {
    if (type === "quote") {
      return [
        ["件名", doc.subject || ""],
        ["納期", doc.deliveryDate || ""],
        ["支払条件", doc.paymentTerms || "先払い"],
        ["見積期限", doc.validUntil || ""]
      ];
    }
    if (type === "invoice") {
      return [
        ["件名", doc.subject || ""],
        ["請求日", doc.invoiceDate || ""],
        ["支払期限", doc.dueDate || ""],
        ["発行日", doc.issuedAt || ""]
      ];
    }
    if (type === "delivery") {
      const shippingMethod = doc.shippingMethod || "";
      const shippingDate = doc.shipmentDate || doc.handoverDate || doc.carryOutDate || "";
      return [
        ["件名", doc.subject || ""],
        ["納品日", doc.deliveryDate || doc.issuedAt || ""],
        ["発送方法", shippingMethod],
        ["発送日", shippingDate]
      ];
    }
    return [
      ["件名", doc.subject || ""],
      ["入金日", doc.paymentDate || ""],
      ["入金額", money(doc.amount || doc.total || 0)],
      ["発行日", doc.issuedAt || ""]
    ];
  }

  function companyBlock(staff) {
    return `
      <div class="company-logo"><span class="logo-mark">●</span><span class="logo-text">ARICO</span><small>ARCHERY GROUP</small></div>
      <div class="company-info">
        <div>${COMPANY.name}</div>
        <div>登録番号：${COMPANY.invoiceNo}</div>
        <div>${COMPANY.postal}</div>
        <div>${COMPANY.address}</div>
        <div>TEL：${COMPANY.tel}</div>
        <div>代表者：${COMPANY.representative}</div>
        <div>担当：${escapeHtml(staff || "")}</div>
      </div>
      <div class="stamp">ARICO<br>ARCHERY</div>
    `;
  }

  function rowsHtml(lines) {
    const rows = lines.map(line => `
      <tr>
        <td class="desc">${escapeHtml(line.name || "")}${line.memo ? `<div class="item-memo">${escapeHtml(line.memo)}</div>` : ""}</td>
        <td class="num">${numberOnly(line.qty)}</td>
        <td>${escapeHtml(line.unit || "")}</td>
        <td class="num">${numberOnly(line.unitPrice)}</td>
        <td class="num ${line.amount < 0 ? "negative" : ""}">${numberOnly(line.amount)}</td>
      </tr>
    `).join("");
    const blankRows = Array.from({ length: Math.max(3, 18 - lines.length) }, () => `
      <tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
    `).join("");
    return rows + blankRows;
  }

  function summaryHtml(totals) {
    const discountRow = totals.discount > 0
      ? `<tr><th>値引き</th><td>-${numberOnly(totals.discount)}</td></tr>`
      : "";
    return `
      <div class="summary-note">※ は軽減税率対象商品<br>（10%対象 税込金額 ${numberOnly(totals.total)} 円 内税 ${numberOnly(totals.tax)}円）</div>
      <table class="summary-table">
        <tr><th>小計</th><td>${numberOnly(totals.subtotal)}</td></tr>
        ${discountRow}
        <tr><th>合計</th><td class="${totals.total < 0 ? "negative" : ""}">${numberOnly(totals.total)}</td></tr>
        <tr><th>内消費税</th><td>(${numberOnly(totals.tax)})</td></tr>
      </table>
    `;
  }

  function printSalesDocument(type, data) {
    const doc = JSON.parse(JSON.stringify(data || {}));
    const title = documentTitle(type);
    const lines = normalizeLines(doc);
    const totals = calcTotals(doc, lines);
    const number = documentNumber(type, doc);
    const date = documentDate(type, doc);
    const note = doc.slipMemo || doc.memo || "";
    const customerName = doc.customerName || doc.name || doc.customer || "";
    const organizationName = doc.organizationName || doc.companyName || doc.organization || "";
    const address = doc.address || "";
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} ${escapeHtml(number)}</title>
<style>
  @page{size:A4;margin:12mm 15mm}
  *{box-sizing:border-box}
  body{margin:0;color:#111;font-family:"Yu Gothic","YuGothic","Meiryo",system-ui,sans-serif;font-size:13px;line-height:1.35}
  .sheet{position:relative;min-height:270mm;padding:2mm 2mm 8mm}
  h1{text-align:center;font-size:24px;letter-spacing:.08em;margin:8px 0 12px;font-weight:700}
  .top{display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:start}
  .customer-name{display:inline-block;min-width:150px;border-bottom:1px solid #999;font-size:16px;margin:0 0 8px;padding:0 6px 2px}
  .customer-address{min-height:58px;white-space:pre-wrap}
  .company{position:relative;padding-left:4px}
  .doc-meta{text-align:right;margin-bottom:8px}
  .company-logo{display:grid;grid-template-columns:42px 1fr;align-items:center;color:#2f744f;margin:6px 0 6px}
  .logo-mark{font-size:28px;line-height:1;color:#2f744f}
  .logo-text{font-size:34px;font-weight:900;letter-spacing:.02em;line-height:.9}
  .company-logo small{grid-column:2;font-size:9px;font-weight:900;letter-spacing:.03em;margin-left:5px}
  .company-info{font-size:13px;line-height:1.42}
  .stamp{position:absolute;right:34px;top:106px;width:62px;height:62px;border:3px double #d62828;border-radius:50%;color:#d62828;display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;line-height:1.15;transform:rotate(-12deg);opacity:.9}
  .message{margin:12px 0 8px}
  .info-list{width:370px;margin:8px 0 18px}
  .info-row{display:grid;grid-template-columns:110px 1fr;min-height:33px;align-items:center;margin-bottom:6px}
  .info-label{background:#2f744f;color:#fff;text-align:center;padding:8px 6px;font-weight:700}
  .info-value{padding:7px 10px;border-bottom:1px solid #ddd}
  .total-row .info-value{border:1px solid #d9d9d9;font-size:24px;font-weight:700;background:#fff}
  .items{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed}
  .items th{background:#2f744f;color:#fff;font-weight:700;padding:7px 8px;border:1px solid #2f744f}
  .items td{border-bottom:1px solid #bdbdbd;border-left:1px solid #e5e5e5;border-right:1px solid #e5e5e5;padding:5px 8px;height:27px;vertical-align:top}
  .items .desc{width:50%}
  .items th:nth-child(2),.items td:nth-child(2){width:10%}
  .items th:nth-child(3),.items td:nth-child(3){width:10%}
  .items th:nth-child(4),.items td:nth-child(4){width:15%}
  .items th:nth-child(5),.items td:nth-child(5){width:15%}
  .num{text-align:right}
  .item-memo{font-size:11px;color:#444;margin-top:2px}
  .blank td{height:28px;color:#fff}
  .negative{color:#b91c1c;font-weight:700}
  .summary-area{display:grid;grid-template-columns:1fr 230px;gap:18px;align-items:start;margin-top:8px}
  .summary-note{font-size:12px;line-height:1.5;padding-top:8px}
  .summary-table{width:230px;border-collapse:collapse}
  .summary-table th{width:105px;background:#2f744f;color:#fff;padding:8px;text-align:right;border:1px solid #2f744f}
  .summary-table td{padding:8px 10px;text-align:right;border:1px solid #ddd}
  .note-title{background:#2f744f;color:#fff;font-weight:700;margin-top:20px;padding:7px 12px}
  .note-box{min-height:92px;border-bottom:1px solid #999;white-space:pre-wrap;padding:10px 4px}
  .footer{position:absolute;right:0;bottom:0;font-size:12px;text-align:right}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{page-break-after:auto}}
</style>
</head>
<body>
<div class="sheet">
  <h1>${escapeHtml(title)}</h1>
  <div class="top">
    <div>
      <div class="customer-name">${escapeHtml(customerName || organizationName)} 様</div>
      <div class="customer-address">${organizationName && organizationName !== customerName ? escapeHtml(organizationName) + "<br>" : ""}${escapeHtml(address)}<br>TEL：${escapeHtml(doc.phone || "")}<br>FAX：</div>
      <div class="message">${type === "receipt" ? "下記の通り、正に領収いたしました。" : "下記のとおり、御見積申し上げます。"}</div>
      <div class="info-list">
        ${infoRows(type, doc).map(([label, value]) => `<div class="info-row"><div class="info-label">${escapeHtml(label)}</div><div class="info-value">${escapeHtml(value)}</div></div>`).join("")}
        <div class="info-row total-row"><div class="info-label">${type === "receipt" ? "領収金額" : "合計金額"}</div><div class="info-value ${totals.total < 0 ? "negative" : ""}">${money(totals.total)} <small>（税込）</small></div></div>
      </div>
    </div>
    <div class="company">
      <div class="doc-meta">No：${escapeHtml(number)}<br>発行日：${escapeHtml(date)}</div>
      ${companyBlock(doc.staff)}
    </div>
  </div>
  <table class="items">
    <thead><tr><th>摘要</th><th>数量</th><th>単位</th><th>税込単価</th><th>税込金額</th></tr></thead>
    <tbody>${rowsHtml(lines)}</tbody>
  </table>
  <div class="summary-area">${summaryHtml(totals)}</div>
  <div class="note-title">備考</div>
  <div class="note-box">${escapeHtml(note)}</div>
  <div class="footer">01/01<br>（ ${escapeHtml(number)} ）</div>
</div>
<script>window.onload = () => { window.print(); setTimeout(() => { if (window.opener) window.opener.focus(); }, 300); };</script>
</body>
</html>`);
    win.document.close();
  }

  window.SalesPdfFormat = {
    printSalesDocument
  };
})();
