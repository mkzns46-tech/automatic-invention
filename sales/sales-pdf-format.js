(function () {
  const COMPANY = {
    name: "株式会社ARICO ARCHERY",
    invoiceNo: "T8180001160066",
    postal: "〒454-0014",
    address: "愛知県名古屋市中川区柳川町3-18",
    tel: "052-990-4188",
    representative: "尹恵善"
  };
  const LOGO_FALLBACK_SRC = "assets/arico-logo.png";
  const STAMP_FALLBACK_SRC = "assets/arico-stamp.png";
  const LOGO_STORAGE_KEYS = ["arico_sales_pdf_logo", "aricoSalesPdfLogo", "salesPdfLogo"];
  const STAMP_STORAGE_KEYS = ["arico_sales_pdf_stamp", "aricoSalesPdfStamp", "salesPdfStamp"];
  const HTML2PDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";

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

  function formatDate(value) {
    if (!value) return "";
    const text = String(value);
    const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) return `${match[1]}/${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")}`;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text.slice(0, 10);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}/${m}/${d}`;
  }

  function readStoredImage(keys, fallback) {
    try {
      for (const key of keys) {
        const value = localStorage.getItem(key);
        if (value) return value;
      }
    } catch (_) {}
    return fallback;
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

  function documentTitle(type) {
    return {
      quote: "見積書",
      invoice: "請求書",
      delivery: "納品書",
      receipt: "領収書"
    }[type] || "帳票";
  }

  function documentFileLabel(type) {
    return {
      quote: "見積書",
      invoice: "請求書",
      delivery: "納品書",
      receipt: "領収書"
    }[type] || "伝票";
  }

  function documentMessage(type) {
    return {
      quote: "下記のとおり、御見積申し上げます。",
      invoice: "下記のとおり、ご請求申し上げます。",
      delivery: "下記のとおり、納品いたしました。",
      receipt: "下記の通り、正に領収いたしました。"
    }[type] || "";
  }

  function sanitizeFilePart(value) {
    return String(value || "")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "")
      .slice(0, 48) || "顧客";
  }

  function filenameDate(doc) {
    const raw = doc.invoiceDate || doc.quoteDate || doc.deliveryDate || doc.paymentDate || doc.issuedAt || doc.createdAt || new Date();
    const formatted = formatDate(raw).replaceAll("/", "");
    return /^\d{8}$/.test(formatted) ? formatted : formatDate(new Date()).replaceAll("/", "");
  }

  function pdfFilename(type, doc) {
    const customer = sanitizeFilePart(doc.customerName || doc.name || doc.customer || doc.organizationName || "顧客");
    return `${filenameDate(doc)}【${customer}】様-${documentFileLabel(type)}.pdf`;
  }

  function documentNumber(type, doc) {
    return doc.quoteNo || doc.invoiceNo || doc.deliveryNo || doc.receiptNo || doc.originNumber || "";
  }

  function documentDate(type, doc) {
    if (type === "quote") return formatDate(doc.quoteDate || doc.createdAt || "");
    if (type === "invoice") return formatDate(doc.invoiceDate || "");
    if (type === "delivery") return formatDate(doc.deliveryDate || doc.shipmentDate || doc.issuedAt || "");
    if (type === "receipt") return formatDate(doc.paymentDate || doc.issuedAt || "");
    return formatDate(doc.date || "");
  }

  function issueDate(type, doc) {
    if (type === "invoice") return formatDate(doc.issuedAt || doc.invoiceDate || "");
    if (type === "delivery") return formatDate(doc.issuedAt || doc.deliveryDate || "");
    if (type === "receipt") return formatDate(doc.issuedAt || doc.paymentDate || "");
    return formatDate(doc.quoteDate || doc.createdAt || "");
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
        name: line.name || line.productName || line.itemName || "",
        qty,
        unit: line.unit || "",
        unitPrice,
        memo: line.memo || line.itemMemo || line.note || "",
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

  function splitLines(lines, type) {
    if (type === "receipt") return [[]];
    const firstLimit = 18;
    const nextLimit = 27;
    if (lines.length <= firstLimit) return [lines];
    const pages = [lines.slice(0, firstLimit)];
    for (let i = firstLimit; i < lines.length; i += nextLimit) {
      pages.push(lines.slice(i, i + nextLimit));
    }
    return pages;
  }

  function infoRows(type, doc) {
    if (type === "quote") {
      return [
        ["件名", doc.subject || ""],
        ["支払条件", doc.paymentTerms || "先払い"],
        ["見積期限", formatDate(doc.validUntil || "")]
      ];
    }
    if (type === "invoice") {
      return [
        ["件名", doc.subject || ""],
        ["支払期限", formatDate(doc.dueDate || "")]
      ];
    }
    if (type === "delivery") {
      return [
        ["件名", doc.subject || ""]
      ];
    }
    return [
      ["但し書き", doc.slipMemo || doc.memo || "アーチェリー用品代として"],
      ["入金日", formatDate(doc.paymentDate || "")],
      ["入金額", money(doc.amount || doc.total || 0)],
      ["発行日", issueDate(type, doc)]
    ];
  }

  function metaRows(type, doc, number) {
    const rows = [["No", number], ["発行日", issueDate(type, doc)]];
    if (type === "quote") rows.push(["見積日", documentDate(type, doc)]);
    if (type === "invoice") rows.push(["請求日", documentDate(type, doc)]);
    if (type === "delivery") rows.push(["納品日", documentDate(type, doc)]);
    if (type === "receipt") rows.push(["入金日", documentDate(type, doc)]);
    return rows;
  }

  function companyBlock(staff) {
    const logoSrc = readStoredImage(LOGO_STORAGE_KEYS, LOGO_FALLBACK_SRC);
    const stampSrc = readStoredImage(STAMP_STORAGE_KEYS, STAMP_FALLBACK_SRC);
    return `
      <img class="company-logo-img" src="${escapeHtml(logoSrc)}" alt="ARICO ARCHERY GROUP">
      <div class="company-info">
        <div>${COMPANY.name}</div>
        <div>登録番号：${COMPANY.invoiceNo}</div>
        <div>${COMPANY.postal}</div>
        <div>${COMPANY.address}</div>
        <div>TEL：${COMPANY.tel}</div>
        <div>代表者：${COMPANY.representative}</div>
        <div class="staff-line">担当：${escapeHtml(staff || "")}</div>
      </div>
      <img class="stamp-img" src="${escapeHtml(stampSrc)}" alt="印影">
    `;
  }

  function itemRows(lines, blankCount) {
    const rows = lines.map(line => `
      <tr>
        <td class="desc">${escapeHtml(line.name || "")}${line.memo ? `<div class="item-memo">${escapeHtml(line.memo)}</div>` : ""}</td>
        <td class="num">${numberOnly(line.qty)}</td>
        <td>${escapeHtml(line.unit || "")}</td>
        <td class="num">${numberOnly(line.unitPrice)}</td>
        <td class="num ${line.amount < 0 ? "negative" : ""}">${numberOnly(line.amount)}</td>
      </tr>
    `).join("");
    const blanks = Array.from({ length: Math.max(0, blankCount) }, () => `
      <tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
    `).join("");
    return rows + blanks;
  }

  function bankInfoHtml(type) {
    if (type !== "invoice") return "";
    return `
      <div class="bank-info">
        <div class="bank-title">振込先</div>
        <div>GMOあおぞらネット銀行 法人営業部</div>
        <div>普通 1890583</div>
        <div>株式会社ARICO ARCHERY</div>
      </div>
    `;
  }

  function summaryHtml(type, totals) {
    const discountRow = totals.discount > 0
      ? `<tr><th>値引き</th><td>-${numberOnly(totals.discount)}</td></tr>`
      : "";
    return `
      <div class="summary-note">※ は軽減税率対象商品<br>（10%対象 税込金額 ${numberOnly(totals.total)} 円 内税 ${numberOnly(totals.tax)}円）</div>
      <div>
        <table class="summary-table">
          ${discountRow}
          <tr><th>合計</th><td class="${totals.total < 0 ? "negative" : ""}">${numberOnly(totals.total)}</td></tr>
          <tr><th>内消費税</th><td>(${numberOnly(totals.tax)})</td></tr>
        </table>
        ${bankInfoHtml(type)}
      </div>
    `;
  }

  function tablePageHtml({ type, doc, title, number, pageLines, pageIndex, pageTotal, totals, isLast, note }) {
    const blankTarget = pageIndex === 0 ? Math.min(18, Math.max(5, pageLines.length + 2)) : Math.min(27, Math.max(5, pageLines.length + 2));
    return `<div class="sheet">
      ${pageTotal > 1 ? `<div class="page-count top-count">${pageIndex + 1}/${pageTotal}</div>` : ""}
      <h1>${escapeHtml(title)}</h1>
      ${pageIndex === 0 ? headerHtml({ type, doc, number, totals }) : `<div class="continuation">No：${escapeHtml(number)}　${escapeHtml(title)} 続き</div>`}
      <table class="items">
        <thead><tr><th>摘要</th><th>数量</th><th>単位</th><th>税込単価</th><th>税込金額</th></tr></thead>
        <tbody>${itemRows(pageLines, Math.max(3, blankTarget - pageLines.length))}</tbody>
      </table>
      ${isLast ? `<div class="summary-area">${summaryHtml(type, totals)}</div><div class="note-title">備考</div><div class="note-box">${escapeHtml(note)}</div>` : ""}
      <div class="footer">${pageIndex + 1}/${pageTotal}<br>（ ${escapeHtml(number)} ）</div>
    </div>`;
  }

  function headerHtml({ type, doc, number, totals }) {
    const customerName = doc.customerName || doc.name || doc.customer || "";
    const organizationName = doc.organizationName || doc.companyName || doc.organization || "";
    const address = doc.address || "";
    return `<div class="top">
      <div>
        <div class="customer-name">${escapeHtml(customerName || organizationName)} 様</div>
        <div class="customer-address">${organizationName && organizationName !== customerName ? escapeHtml(organizationName) + "<br>" : ""}${escapeHtml(address)}<br>TEL：${escapeHtml(doc.phone || "")}<br>FAX：</div>
        <div class="message">${escapeHtml(documentMessage(type))}</div>
        <div class="info-list">
          ${infoRows(type, doc).map(([label, value]) => `<div class="info-row"><div class="info-label">${escapeHtml(label)}</div><div class="info-value">${escapeHtml(value)}</div></div>`).join("")}
          <div class="info-row total-row"><div class="info-label">${type === "receipt" ? "領収金額" : "合計金額"}</div><div class="info-value ${totals.total < 0 ? "negative" : ""}">${money(totals.total)} <small>（税込）</small></div></div>
        </div>
      </div>
      <div class="company">
        <table class="doc-meta">${metaRows(type, doc, number).map(([label, value]) => `<tr><th>${escapeHtml(label)}：</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>
        ${companyBlock(doc.staff)}
      </div>
    </div>`;
  }

  function receiptHtml({ doc, title, number, totals, note }) {
    return `<div class="sheet receipt-sheet">
      <h1>${escapeHtml(title)}</h1>
      <div class="receipt-top">
        <div>
          <div class="customer-name">${escapeHtml(doc.customerName || "")} 様</div>
          <div class="receipt-amount ${totals.total < 0 ? "negative" : ""}">金額 ${money(totals.total)}</div>
          <div class="receipt-message">但し、${escapeHtml(note || "アーチェリー用品代として")}<br>上記正に領収いたしました。</div>
          <div class="revenue-stamp-box">収入印紙</div>
          <table class="receipt-breakdown">
            <tr><th>内訳</th><th>金額</th></tr>
            <tr><td>消費税額等</td><td>${numberOnly(totals.tax)} 円</td></tr>
            <tr><td>合計</td><td>${numberOnly(totals.total)} 円</td></tr>
          </table>
        </div>
        <div class="company">
          ${companyBlock(doc.staff)}
        </div>
      </div>
      <div class="footer">1/1</div>
    </div>`;
  }

  function css() {
    return `<style>
      @page{size:A4;margin:10mm 14mm}
      *{box-sizing:border-box}
      body{margin:0;color:#111;font-family:"Yu Gothic","YuGothic","Meiryo",system-ui,sans-serif;font-size:12.5px;line-height:1.28}
      .sheet{position:relative;min-height:auto;padding:2mm 2mm 8mm;page-break-after:always}
      .sheet:last-child{page-break-after:auto}
      h1{text-align:center;font-size:23px;letter-spacing:.08em;margin:6px 0 10px;font-weight:700}
      .page-count{font-size:13px;font-weight:700;color:#111}
      .top-count{position:absolute;right:2mm;top:1mm}
      .top{display:grid;grid-template-columns:1.08fr .92fr;gap:24px;align-items:start}
      .customer-name{display:inline-block;min-width:150px;border-bottom:1px solid #999;font-size:16px;margin:0 0 8px;padding:0 6px 2px}
      .customer-address{min-height:54px;white-space:pre-wrap}
      .company{position:relative;width:260px;margin-left:auto;padding-left:0}
      .doc-meta{width:260px;margin:0 0 6px 0;border-collapse:collapse;font-size:13px}
      .doc-meta th{font-weight:400;text-align:right;padding:0 4px 2px 0;white-space:nowrap}
      .doc-meta td{text-align:left;padding:0 0 2px 0;min-width:125px}
      .company-logo-img{display:block;width:220px;max-height:64px;object-fit:contain;margin:4px 0 4px}
      .company-info{width:230px;font-size:12.5px;line-height:1.38}
      .staff-line{display:inline-block;padding-right:62px}
      .stamp-img{position:absolute;right:8px;top:126px;width:56px;height:56px;object-fit:contain}
      .message{margin:10px 0 7px}
      .info-list{width:315px;margin:7px 0 15px}
      .info-row{display:grid;grid-template-columns:105px 210px;min-height:31px;align-items:center;margin-bottom:5px}
      .info-label{background:#2f744f;color:#fff;text-align:center;padding:7px 6px;font-weight:700}
      .info-value{padding:6px 9px;border-bottom:1px solid #ddd}
      .total-row .info-value{border:0;border-bottom:1px solid #ddd;font-size:20px;font-weight:700;background:#fff}
      .items{width:100%;border-collapse:collapse;margin-top:7px;table-layout:fixed}
      .items th{background:#2f744f;color:#fff;font-weight:700;padding:6px 8px;border:1px solid #2f744f}
      .items td{border-bottom:1px solid #bdbdbd;border-left:1px solid #e5e5e5;border-right:1px solid #e5e5e5;padding:4px 8px;height:24px;vertical-align:top}
      .items .desc{width:50%}
      .items th:nth-child(2),.items td:nth-child(2){width:10%}
      .items th:nth-child(3),.items td:nth-child(3){width:10%;text-align:right}
      .items th:nth-child(4),.items td:nth-child(4){width:15%}
      .items th:nth-child(5),.items td:nth-child(5){width:15%}
      .num{text-align:right}
      .item-memo{font-size:10.5px;color:#444;margin-top:1px}
      .blank td{height:24px;color:#fff}
      .negative{color:#b91c1c;font-weight:700}
      .summary-area{display:grid;grid-template-columns:1fr 225px;gap:18px;align-items:start;margin-top:8px}
      .summary-note{font-size:12px;line-height:1.45;padding-top:8px}
      .summary-table{width:225px;border-collapse:collapse}
      .summary-table th{width:105px;background:#2f744f;color:#fff;padding:7px 8px;text-align:right;border:1px solid #2f744f}
      .summary-table td{padding:7px 10px;text-align:right;border:1px solid #ddd}
      .bank-info{margin-top:10px;border:1px solid #d7dfd9;padding:8px 10px;font-size:12px;line-height:1.55}
      .bank-title{font-weight:700;color:#2f744f;margin-bottom:2px}
      .note-title{background:#2f744f;color:#fff;font-weight:700;margin-top:16px;padding:6px 12px}
      .note-box{min-height:78px;border-bottom:1px solid #999;white-space:pre-wrap;padding:8px 4px}
      .footer{position:absolute;right:0;bottom:0;font-size:12px;text-align:right}
      .continuation{margin:8px 0 10px;text-align:right}
      .receipt-top{display:grid;grid-template-columns:1fr 260px;gap:32px;margin-top:24px}
      .receipt-amount{font-size:28px;font-weight:900;border-bottom:3px double #111;padding:14px 0;margin:24px 0 18px}
      .receipt-message{font-size:16px;line-height:1.8;margin:16px 0 28px}
      .revenue-stamp-box{width:110px;height:86px;border:1px solid #999;display:flex;align-items:center;justify-content:center;margin:18px 0;color:#555}
      .receipt-breakdown{width:360px;border-collapse:collapse;margin-top:12px}
      .receipt-breakdown th{background:#2f744f;color:#fff;border:1px solid #2f744f;padding:8px}
      .receipt-breakdown td{border:1px solid #ddd;padding:8px}
      .receipt-breakdown td:last-child{text-align:right}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style>`;
  }

  function cssText() {
    return css().replace(/^<style>/, "").replace(/<\/style>$/, "");
  }

  function documentPages(type, data) {
    const doc = JSON.parse(JSON.stringify(data || {}));
    if (type === "receipt" && !(doc.slipMemo || doc.memo)) {
      doc.slipMemo = "アーチェリー用品代として";
      doc.memo = doc.slipMemo;
    }
    const title = documentTitle(type);
    const lines = normalizeLines(doc);
    const totals = calcTotals(doc, lines);
    const number = documentNumber(type, doc);
    const note = doc.slipMemo || doc.memo || "";
    const linePages = splitLines(lines, type);
    const pageTotal = type === "receipt" ? 1 : linePages.length;
    const pages = type === "receipt"
      ? receiptHtml({ doc, title, number, totals, note })
      : linePages.map((pageLines, index) => tablePageHtml({
        type,
        doc,
        title,
        number,
        pageLines,
        pageIndex: index,
        pageTotal,
        totals,
        isLast: index === linePages.length - 1,
        note
      })).join("");
    return { pages, title, number, filename: pdfFilename(type, doc) };
  }

  function showPdfActionPopup(filename, count) {
    return new Promise(resolve => {
      const popup = document.createElement("div");
      popup.className = "app-popup";
      popup.style.display = "flex";
      popup.innerHTML = `
        <div class="app-popup-card">
          <div class="app-popup-title">PDF出力</div>
          <div class="app-popup-body">${escapeHtml(count > 1 ? `${count}件のPDFを出力します。` : filename)}<br>出力方法を選択してください。</div>
          <div class="sales-actions" style="justify-content:center;margin-top:12px">
            <button type="button" class="primary" data-action="print">印刷</button>
            <button type="button" class="secondary" data-action="save">保存</button>
            <button type="button" class="secondary" data-action="cancel">キャンセル</button>
          </div>
        </div>
      `;
      const close = action => {
        popup.remove();
        resolve(action);
      };
      popup.addEventListener("click", event => {
        const action = event.target?.dataset?.action;
        if (action) close(action);
        if (event.target === popup) close("cancel");
      });
      document.body.appendChild(popup);
    });
  }

  function loadHtml2Pdf() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${HTML2PDF_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.html2pdf));
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src = HTML2PDF_SRC;
      script.onload = () => window.html2pdf ? resolve(window.html2pdf) : reject(new Error("html2pdf load failed"));
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function buildDocuments(documents) {
    const built = documents.map(({ type, data }) => documentPages(type, data));
    const first = built[0] || { title: "伝票", number: "", filename: "伝票.pdf", pages: "" };
    const body = built.map(item => item.pages).join("");
    const title = documents.length === 1 ? first.filename : `販売管理PDF-${formatDate(new Date()).replaceAll("/", "")}.pdf`;
    return { built, first, body, title };
  }

  function openPdfWindow(documents, action) {
    const { body, title } = buildDocuments(documents);
    const win = window.open("", "_blank");
    if (!win) return;
    const baseHref = location.href.replace(/[^/]*$/, "");
    const safeTitleLiteral = JSON.stringify(title).replace(/</g, "\\u003c");
    const autoScript = action === "print"
      ? `<script>window.onload = () => { document.title=${safeTitleLiteral}; setTimeout(() => window.print(), 120); };</script>`
      : "";
    win.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><base href="${escapeHtml(baseHref)}"><title>${escapeHtml(title)}</title>${css()}</head><body>${body}${autoScript}</body></html>`);
    win.document.close();
  }

  function waitForImages(container) {
    const images = Array.from(container.querySelectorAll("img"));
    if (!images.length) return Promise.resolve();
    return Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, 1200);
      });
    }));
  }

  function waitForPaint() {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function downloadPdf(documents) {
    const { body, title, built } = buildDocuments(documents);
    const html2pdf = await loadHtml2Pdf();
    const firstDoc = documents[0]?.data || {};
    const firstBuilt = built[0] || {};
    const firstLines = normalizeLines(firstDoc);
    console.log("sales pdf save", {
      type: documents[0]?.type || "",
      number: firstBuilt.number || documentNumber(documents[0]?.type, firstDoc),
      customerName: firstDoc.customerName || firstDoc.name || firstDoc.customer || "",
      itemCount: firstLines.length,
      htmlLength: body.length
    });
    if (!body || body.length < 100 || !body.includes("sheet")) {
      throw new Error("PDF HTML is empty");
    }
    const style = document.createElement("style");
    style.dataset.salesPdfDownload = "true";
    style.textContent = `${cssText()}
      .pdf-download-root{position:fixed;left:0;top:0;width:210mm;background:#fff;z-index:2147483647;pointer-events:none}
      .pdf-download-root .sheet{width:210mm;min-height:277mm;background:#fff;margin:0 auto}
    `;
    const container = document.createElement("div");
    container.className = "pdf-download-root";
    container.innerHTML = body;
    document.head.appendChild(style);
    document.body.appendChild(container);
    try {
      await waitForImages(container);
      await waitForPaint();
      const target = container.querySelector(".sheet") ? container : container.firstElementChild;
      await html2pdf()
        .set({
          margin: 0,
          filename: title,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, allowTaint: true, backgroundColor: "#ffffff" },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"], after: ".sheet" }
        })
        .from(target)
        .save();
    } finally {
      container.remove();
      style.remove();
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function downloadPdfFiles(documents) {
    for (const documentItem of documents) {
      await downloadPdf([documentItem]);
      await sleep(450);
    }
  }

  async function printSalesDocument(type, data) {
    const info = documentPages(type, data);
    const action = await showPdfActionPopup(info.filename, 1);
    if (action === "cancel") return;
    if (action === "save") {
      try {
        await downloadPdf([{ type, data }]);
      } catch (error) {
        alert(`PDF保存に失敗しました。\n${error?.message || error}`);
      }
      return;
    }
    openPdfWindow([{ type, data }], action);
  }

  async function printSalesDocuments(documents) {
    const safeDocuments = (documents || []).filter(item => item && item.type && item.data);
    if (!safeDocuments.length) return;
    const first = documentPages(safeDocuments[0].type, safeDocuments[0].data);
    const action = await showPdfActionPopup(first.filename, safeDocuments.length);
    if (action === "cancel") return;
    if (action === "save") {
      try {
        await downloadPdfFiles(safeDocuments);
      } catch (error) {
        alert(`PDF保存に失敗しました。\n${error?.message || error}`);
      }
      return;
    }
    openPdfWindow(safeDocuments, action);
  }

  window.SalesPdfFormat = { printSalesDocument, printSalesDocuments };
})();
