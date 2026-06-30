<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARICO 取り寄せ管理</title>
<link rel="stylesheet" href="backorder.css">
<script src="backorder-storage.js" defer></script>
<script src="backorder-csv.js" defer></script>
<script src="backorder.js" defer></script>
</head>
<body>
<main class="backorder-wrap">
  <header class="backorder-header">
    <div>
      <div class="brand">ARICO ARCHERY</div>
      <h1>取り寄せ管理</h1>
      <p class="lead">MakeShop取寄せ注文、スマレジ在庫0以下、手動登録を1つの手配ボードで管理します。</p>
    </div>
    <div class="header-actions">
      <a class="pill" href="../portal.html">ポータルへ戻る</a>
      <button type="button" class="secondary" id="exportCsvBtn">CSV出力</button>
    </div>
  </header>

  <div id="message" class="message">CSV取込または手動登録から開始してください。</div>

  <section class="panel import-panel">
    <div class="section-title"><div><h2>CSV取込</h2><p>毎回CSVを全件取り込んでも、新しい注文だけ追加します。既存のステータス、担当者、発注先、入荷数量、メモ、履歴は上書きしません。</p></div></div>
    <div class="import-grid">
      <label>MakeShop 注文CSV<input type="file" id="makeshopCsvInput" accept=".csv,text/csv"></label>
      <label>スマレジ CSV<input type="file" id="smaregiCsvInput" accept=".csv,text/csv"></label>
    </div>
    <div id="importSummary" class="import-summary"></div>
  </section>

  <section class="panel">
    <div class="section-title"><div><h2>手動登録</h2><p>店頭注文、電話注文、請求書取寄せなどを登録できます。</p></div></div>
    <form id="manualForm" class="manual-grid">
      <label>注文日<input type="date" name="orderDate"></label>
      <label>注文番号 / 取引番号<input name="orderNumber" required></label>
      <label>注文者<input name="customerName"></label>
      <label>注文元<select name="source"><option>店頭</option><option>電話</option><option>請求書</option><option>手動</option><option>MakeShop</option><option>スマレジ</option></select></label>
      <label class="wide">商品名<input name="productName" required></label>
      <label>バリエーション<input name="variation"></label>
      <label>商品コード<input name="productCode"></label>
      <label>JANコード<input name="janCode"></label>
      <label>注文数量<input type="number" name="orderQty" min="0" step="1" value="1"></label>
      <label>発注先<input name="supplier"></label>
      <label>担当者<input name="staff"></label>
      <label>入荷予定日<input type="date" name="expectedArrivalDate"></label>
      <label class="wide">メモ<textarea name="memo"></textarea></label>
      <div class="form-actions"><button type="submit">手動登録</button></div>
    </form>
  </section>

  <section class="panel filter-panel">
    <div class="section-title">
      <div><h2>検索・絞り込み</h2></div>
      <div class="tabs">
        <button type="button" class="tab active" data-view="active">未完了手配一覧</button>
        <button type="button" class="tab" data-view="completed">完了一覧</button>
        <button type="button" class="tab" data-view="canceled">キャンセル一覧</button>
      </div>
    </div>
    <div class="filter-grid">
      <label>注文番号 / 取引番号<input id="filterOrderNumber"></label>
      <label>注文者<input id="filterCustomerName"></label>
      <label>商品名<input id="filterProductName"></label>
      <label>ステータス<select id="filterStatus"></select></label>
      <label>発注先<input id="filterSupplier"></label>
      <label>担当者<input id="filterStaff"></label>
      <label class="completed-filter">完了日<input id="filterCompletedDate" type="date"></label>
    </div>
  </section>

  <section class="panel board-panel">
    <div class="section-title"><div><h2 id="boardTitle">未完了手配一覧</h2><p id="boardCount">0件</p></div></div>
    <div class="table-wrap">
      <table class="backorder-table">
        <thead><tr><th>注文日</th><th>注文番号 / 取引番号</th><th>注文者</th><th>注文元</th><th>商品名</th><th>バリエーション</th><th>商品コード</th><th>JANコード</th><th>注文数量</th><th>入荷数量</th><th>残数量</th><th>ステータス</th><th>発注先</th><th>担当者</th><th>入荷予定日</th><th>入荷日</th><th>完了日</th><th>キャンセル理由</th><th>メモ</th><th>履歴</th></tr></thead>
        <tbody id="boardBody"></tbody>
      </table>
    </div>
  </section>
</main>
</body>
</html>

