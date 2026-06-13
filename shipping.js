<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARICO ARCHERY 発送管理</title>
<link rel="stylesheet" href="sales-style.css?v=20260613-vtest">
<script src="sales-auth.js"></script>
<script>requireSalesAuth();</script>
<script src="sales-nav.js?v=20260613-vtest" defer></script>
<script src="shipping.js?v=20260613-vtest" defer></script>
</head>
<body>
<main class="sales-wrap">
  <header class="sales-header">
    <div>
      <div class="brand">ARICO ARCHERY</div>
      <h1>発送管理</h1>
      <p class="lead">請求書・オンライン注文・手動作成・バックオーダーから発送へ進めるための入口です。</p>
    </div>
    <div class="sales-actions">
      <a class="pill" href="index.html">販売管理トップ</a>
      <button type="button" class="secondary" onclick="logoutSales();">ログイン画面に戻る</button>
    </div>
  </header>

  <div id="salesMessage" class="message">発送管理は準備中です。</div>

  <section class="card">
    <div class="section-title">
      <div>
        <h2>発送管理</h2>
        <p class="section-note">今後、請求書・オンライン注文・手動作成・バックオーダーから発送データを作成します。</p>
      </div>
      <div class="badge muted">準備中</div>
    </div>
    <div class="shipping-placeholder-grid">
      <div class="summary"><div>必要数<strong>0</strong></div><div>検品済数<strong>0</strong></div><div>不足数<strong>0</strong></div><div>発送待ち<strong>0</strong></div></div>
    </div>
  </section>

  <section class="card">
    <h2>将来対応予定</h2>
    <div class="shipping-roadmap">
      <span class="status-badge info">請求書から作成</span>
      <span class="status-badge info">オンライン注文から作成</span>
      <span class="status-badge muted">手動作成</span>
      <span class="status-badge muted">バックオーダーから作成</span>
      <span class="status-badge ok">商品スキャン検品</span>
      <span class="status-badge warn">ヤマト / 店頭渡し</span>
      <span class="status-badge ok">納品書発行</span>
    </div>
  </section>
</main>
</body>
</html>
