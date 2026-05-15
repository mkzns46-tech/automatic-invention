# v17 起動中停止修正版

## 修正内容
- 「起動中…」から動かない問題を修正
- 削除済みの在庫確認欄/searchInputをapp.jsが読みに行って止まる問題を修正
- 担当者設定はPC画面に表示
- 担当者プルダウン対応

## SQL操作
v15/v16の担当者SQLを実行済みなら不要です。
まだなら `supabase_schema_update_v16_staff_members.sql` をSupabase SQL Editorで1回実行してください。

## GitHubへ上書き
- app.js
- index.html
- style.css

確認URL：
https://automatic-invention-eight.vercel.app/?v=17
