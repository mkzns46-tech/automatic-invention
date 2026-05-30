# v72 スマレジ変動商品チェック版

## 修正内容
- 商品名検索候補にスクロールバーを追加
- 商品名検索結果を最大80件まで表示
- カメラズーム調整スライダーを追加
- カメラ読取感度をさらに強化
- 商品別履歴に「表示中を一括チェック」ボタンを追加
- スマレジ変動商品チェック画面を追加
- 最新スマレジ在庫スナップショット表示、CSV取り込み、実在庫保存、差異絞り込み、CSV出力を追加
- 「履歴を見る」から既存の商品別履歴へ連携
- `supabase_schema_update_v72_smaregi_stock_check.sql` をSupabase SQL Editorで1回実行

## スマレジ在庫CSV
ヘッダーは `barcode,product_name,smaregi_stock` を使用します。日本語の `バーコード,商品名,スマレジ在庫` にも対応しています。
同梱の `smaregi_stock_import_sample.csv` で形式を確認できます。

`スマレジ在庫取得` は保存済みの最新スナップショットを表示します。OAuth認証、スマレジ在庫API取得、前回差分抽出は次フェーズです。

## 確認URL
https://automatic-invention-eight.vercel.app/?v=72
