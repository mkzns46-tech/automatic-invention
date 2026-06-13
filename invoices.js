<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARICO ARCHERY 請求書</title>
<link rel="stylesheet" href="sales-style.css?v=20260613-vtest">
<script src="sales-auth.js"></script>
<script>requireSalesAuth();</script>
<script src="sales-nav.js?v=20260613-vtest" defer></script>
<script src="invoice-pdf.js?v=20260613-vtest"></script>
<script src="invoices.js?v=20260613-vtest" defer></script>
</head>
<body>
<main class="sales-wrap">
  <header class="sales-header">
    <div>
      <div class="brand">ARICO ARCHERY</div>
      <h1>請求書</h1>
      <p class="lead">見積書から変換した請求書の一覧・編集・PDF出力を行います。在庫とスマレジ売上は変更しません。</p>
    </div>
    <div class="sales-actions">
      <a class="pill" href="quotes.html">見積書</a>
      <button type="button" class="secondary" onclick="logoutSales();">ログイン画面に戻る</button>
    </div>
  </header>

  <div id="salesMessage" class="message">請求書を確認できます。</div>

  <section class="card">
    <div class="sales-actions section-heading-row">
      <h2>請求書一覧</h2>
      <button type="button" class="secondary" onclick="clearInvoiceEditor();">新規入力をクリア</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>請求書番号</th><th>請求日</th><th>顧客名</th><th>件名</th><th>合計金額</th><th>ステータス</th><th>元見積</th><th>操作</th></tr></thead>
        <tbody id="invoiceListBody"></tbody>
      </table>
    </div>
  </section>

  <section class="card" id="invoiceEditorCard">
    <h2>請求情報</h2>
    <div class="row">
      <label>請求書番号<input id="invoiceNo" readonly></label>
      <label>ステータス<select id="invoiceStatus"></select></label>
      <label>元見積番号<input id="sourceQuoteNo" readonly></label>
      <label>発行日時<input id="issuedAt" readonly></label>
    </div>
    <div class="row three">
      <label>顧客名<input id="customerName"></label>
      <label>顧客区分<input id="customerType"></label>
      <label>担当者<input id="invoiceStaff"></label>
    </div>
    <div class="row three">
      <label>住所<input id="customerAddress"></label>
      <label>電話番号<input id="customerPhone"></label>
      <label>メールアドレス<input id="customerEmail"></label>
    </div>
    <div class="row three">
      <label>件名<input id="invoiceSubject"></label>
      <label>請求日<input id="invoiceDate" type="date"></label>
      <label>支払期限<input id="dueDate" type="date"></label>
    </div>
    <label>備考<textarea id="invoiceMemo"></textarea></label>
  </section>

  <section class="card">
    <h2>請求商品</h2>
    <div id="invoiceLines" class="invoice-lines"></div>
    <div class="summary">
      <div>小計<strong id="subtotalText">0円</strong></div>
      <div>値引き <strong id="discountText">0円</strong></div>
      <div>合計<strong id="totalText">0円</strong></div>
      <div>内消費税<strong id="taxText">0円</strong></div>
    </div>
    <div class="sales-actions" style="margin-top:14px">
      <button type="button" class="primary" id="saveInvoiceBtn" onclick="saveInvoice();">保存</button>
      <button type="button" class="primary invoice-issue-button" id="issueInvoiceBtn" onclick="issueInvoice();">発行確定</button>
      <button type="button" class="secondary" id="invoicePdfBtn" onclick="outputCurrentInvoicePdf();">PDF出力</button>
      <button type="button" class="danger" id="cancelInvoiceBtn" onclick="cancelInvoice();">キャンセル</button>
    </div>
  </section>
</main>
<div id="salesPopup" class="app-popup" style="display:none;">
  <div class="app-popup-card">
    <div id="salesPopupTitle" class="app-popup-title">完了</div>
    <div id="salesPopupBody" class="app-popup-body"></div>
    <button type="button" id="salesPopupClose">OK</button>
  </div>
</div>
</body>
</html>
