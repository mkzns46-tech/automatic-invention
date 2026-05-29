# ARICO PORTAL

## ログイン情報
- ID: arico
- PASS: 0201

## 履歴管理シートリンク
`app.js` の `HISTORY_SHEET_URL` を変更してください。

現在:
https://automatic-invention-eight.vercel.app/?auth=ARICO_PORTAL_2026

## 在庫シートから戻された時
`index.html?next=history` でログインした場合、ログイン後に在庫変動確認シートへ自動で戻ります。

在庫シート側のログインガードで、未ログイン時の戻り先は以下にしてください。

```js
const ARICO_PORTAL_URL = "https://arico-portal.vercel.app/index.html?next=history";
```
