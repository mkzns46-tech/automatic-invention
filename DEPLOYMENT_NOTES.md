# 追加設定

## Supabase SQL

備品転用の確認者と確認日時を保存するため、デプロイ前に
`supabase_equipment_use_confirmation.sql` を Supabase で実行してください。

備品転用確認カラムだけ不足している場合は
`supabase_equipment_confirmation.sql` のみ実行してください。

このSQLには以下も含まれます。

- `inventory_logs.type` に `備品転用` を許可
- 商品分類用の `category`、`genre`、`department` を `products` に追加
- 差異一覧の「問題なし」保存用に `no_issue`、`no_issue_by`、`no_issue_at`、`no_issue_reason` を `smaregi_stock_checks` に追加
- 差異一覧からの在庫修正保存用に `actual_corrected`、`actual_corrected_by`、`actual_corrected_at` を `smaregi_stock_checks` に追加

すでに他のSQLを実行済みで、修正済カラムだけ不足している場合は
`supabase_actual_corrected.sql` のみ実行してください。

差異原因の記録・集計機能を利用するため、デプロイ前に
`supabase_difference_reasons.sql` も Supabase で実行してください。

このSQLには差異一覧の明示的な除外状態を保存する `excluded` も含まれます。

備品転用確認カラムの存在確認には
`supabase_verify_equipment_confirmation.sql` を実行してください。
3行すべて返ることを確認してください。

## Vercel 環境変数

`api/smaregi-products.js` はスマレジ POS API の `GET /products` を利用します。
商品情報のみを取り込み、在庫数は変更しません。

`api/smaregi-products.js` は `/api/smaregi-sync.js` と同じOAuth認証設定を利用し、
アクセストークンを都度取得します。固定の `SMAREGI_ACCESS_TOKEN` は不要です。

既存のスマレジ変動商品チェックで使用している環境変数をそのまま利用します。

任意:

- `SMAREGI_POS_API_BASE_URL`
  - 未指定時は `https://api.smaregi.jp/{契約ID}/pos` を利用します。

スマレジ側のアプリ設定には `pos.products:read` が必要です。
