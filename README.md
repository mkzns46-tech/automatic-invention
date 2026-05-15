# v16 担当者設定表示修正版

## 修正内容
- PC画面に「担当者設定」セクションが確実に表示されるよう修正
- スキャン登録の担当者をプルダウン化
- 担当者追加・削除はPC画面のみ
- スマホではスキャン登録だけ表示

## SQL操作
v15のSQLをすでに実行済みなら不要です。
まだなら `supabase_schema_update_v16_staff_members.sql` をSupabase SQL Editorで1回実行してください。

## GitHubへ上書き
- index.html
- app.js
- style.css

確認URL：
https://automatic-invention-eight.vercel.app/?v=16
