# v12 元データ現在庫更新・エラー修正版

## 修正内容
- 在庫確認セクション削除後のデータ取得エラーを修正
- 入荷・出荷・在庫修正時に products.base_stock も更新
- base_stock は画面上「現在庫」として扱います
- 入荷：現在庫に加算
- 出荷：現在庫から減算
- 在庫修正：入力した数量で現在庫を上書き
- 履歴は今まで通り inventory_logs に残ります

## SQL操作
不要です。
既に products update all のポリシーがあるため、そのまま動きます。

GitHubへ以下を上書きしてください。
- app.js
- index.html
- style.css
