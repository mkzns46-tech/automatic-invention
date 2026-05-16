# v38 1000件超対応版

## 修正内容
- Supabase REST APIの1000件制限に対応
- 商品マスター products をページ分割で全件取得
- 全体履歴 inventory_logs をページ分割で全件取得
- チェック履歴 inventory_checks をページ分割で全件取得
- 担当者 staff_members もページ分割で取得
- CSV出力も読み込んだ全件を対象にできます

## SQL操作
不要です。

## 注意
履歴が数万件以上になると表示が重くなる可能性があります。
その場合は次に「期間指定読み込み」か「月別履歴」にするのがおすすめです。

## 確認URL
https://automatic-invention-eight.vercel.app/?v=38
