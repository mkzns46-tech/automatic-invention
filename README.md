# v80 スマレジ日時送信ガード版

## v90 現場運用向け棚卸し
- 一覧の商品行へ実在庫数を手入力して「入力チェック」で保存
- 実在庫 `0` の保存に対応
- 入力チェック時に自動でチェック済み化
- 担当者プルダウンを画面上部へ集約
- チェック済み件数と未チェックを表示
- 責任者「田中」のみチェック完了、差異のみCSV、チェック完了解除を操作可能
- 間違えて完了した場合は選択日時へ完了日時を戻せる
- 全体CSV、差異のみCSVを追加
- 差異商品の原因確認パネルを追加
- 在庫管理シート履歴とスマレジ変動履歴を比較表示
- 旧商品別履歴の在庫チェック操作欄を非表示
- スマレジ在庫CSV取り込みを削除

追加SQLは不要です。

担当者は一度選ぶと、そのスマホ内で保持されます。一覧の共有状態は「最新状態に更新」で再読込します。

### 基本操作
1. 画面上部で担当者を選択
2. 商品行へ実在庫数を入力
3. 「入力チェック」を押す
4. 保存済み状態を確認して次の商品へ進む

## 修正内容
- 商品名検索候補にスクロールバーを追加
- 商品名検索結果を最大80件まで表示
- カメラズーム調整スライダーを追加
- カメラ読取感度をさらに強化
- 商品別履歴に「表示中を一括チェック」ボタンを追加
- スマレジ変動商品チェック画面を追加
- アプリ起動時は従来のトップ画面を表示し、メニューボタン押下時のみスマレジ変動商品チェック画面へ切り替え
- スマレジ変動商品チェック画面に「トップへ戻る」を追加
- 最新スマレジ在庫スナップショット表示、実在庫保存、CSV出力を追加
- 「履歴を見る」から既存の商品別履歴へ連携
- `supabase_schema_update_v72_smaregi_stock_check.sql` をSupabase SQL Editorで1回実行
- CSV取り込み直後に一覧を即時描画するよう修正
- OAuth2 Client CredentialsでスマレジAPIへサーバー側接続
- 前回チェック完了日時以降に変動した商品のみ取得
- スマレジ在庫変動履歴を `smaregi_stock_changes` に保存
- 変動商品の抽出は現行仕様の `GET /stock` 更新日時フィルターを使用
- 契約プランにより `GET /stock/changes/{product_id}/{store_id}` が利用できない場合も、一覧取得は継続
- OAuth認証先を `SMAREGI_ENV=production|sandbox` で明示指定可能
- Vercel環境変数へ引用符や改行が混入した場合に正規化
- Vercelログへ認証URL、環境、契約ID先頭、CLIENT_ID先頭、文字数を安全に出力
- `/stock` の日時パラメータを `YYYY-MM-DDTHH:mm:ss+09:00` 形式へ修正
- `/stock` の日時クエリキーを `upd_date_time-from` / `upd_date_time-to` に修正
- Vercelログへ `/stock` 送信直前の日時パラメータを出力
- Vercelログへ `/stock` の最終送信URL、店舗ID、環境、認証URLを `console.log` で出力
- `/stock` 失敗時の返却JSONへ同じ診断情報を付加
- `splitDateRanges(formatSmaregiDate(since), formatSmaregiDate(now))` でAPI送信前の日時変換を明示
- `splitDateRanges()` の戻り値を `formatSmaregiDate(start)` / `formatSmaregiDate(next)` に固定
- `/stock` 送信直前に `YYYY-MM-DDTHH:mm:ss+09:00` 形式を検証
- 旧v72 SQLを実行済みの場合は `supabase_schema_update_v73_smaregi_api_sync.sql` を追加実行

## Vercel環境変数
- `SMAREGI_CONTRACT_ID`
- `SMAREGI_CLIENT_ID`
- `SMAREGI_CLIENT_SECRET`
- `SMAREGI_STORE_ID`
- `SMAREGI_ENV=production` 本番環境
- `SMAREGI_ENV=sandbox` 開発用サンドボックス環境

`SMAREGI_ENV` は明示設定を推奨します。本番用クライアント情報とサンドボックス用クライアント情報を混在させないでください。

スマレジ・デベロッパーズ側で `pos.stock:read`、`pos.products:read`、`pos.stock-changes:read` のスコープを有効にしてください。

初回API同期は直近7日間を対象にします。以降は「今回のチェックを完了」を押した日時以降に変動した商品のみ表示します。

## 確認URL
https://automatic-invention-eight.vercel.app/?v=72
