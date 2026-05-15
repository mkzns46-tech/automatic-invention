# v15 担当者プルダウン・PC設定版

## 変更内容
- スキャン登録の担当者をプルダウン化
- 担当者の追加・削除はPC画面だけ
- 担当者リストはSupabaseに保存され、全員で共有
- スマホではスキャン登録だけ表示のまま

## SQL操作
必要です。
Supabase SQL Editorで `supabase_schema_update_v15_staff_members.sql` を1回実行してください。

## GitHubへ上書き
- index.html
- app.js
- style.css

確認URL：
https://automatic-invention-eight.vercel.app/?v=15
