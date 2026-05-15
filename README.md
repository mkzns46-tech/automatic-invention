# バーコード在庫管理アプリ v5 履歴・在庫チェック強化版

## 追加内容
- 在庫確認で商品行をクリックすると、その商品の過去履歴を表示
- チェック者名を入力して在庫チェック記録を保存
- チェック履歴を表示
- 「全履歴」と「最古チェック以降」の切り替え
- 商品登録数を表示
- 商品名必須チェックを強化

## 必須作業
1. Supabase SQL Editorで `supabase_schema_update_v5.sql` を実行
2. GitHubへ `index.html`, `style.css`, `app.js` を上書き
3. app.js の `SUPABASE_API_KEY` に `sb_publishable_...` を貼る
4. Commit changes
5. Vercel更新後、Ctrl + Shift + R
