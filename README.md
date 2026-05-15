# バーコード在庫管理アプリ v3 CSV取り込み対応

## 追加機能
- CSV一括取り込み
- barcode,name,base_stock,location 形式
- 日本語見出し対応：バーコード,商品名,現在在庫,棚番
- 同一バーコードは上書き更新
- 履歴は削除しません

## 更新方法
1. ZIPを解凍
2. GitHubの既存リポジトリに中身を上書き
3. Commit changes
4. Vercelが自動再デプロイ

## CSV例
barcode,name,base_stock,location
4901234567890,商品A,12,A-01
4909876543210,商品B,5,B-02
