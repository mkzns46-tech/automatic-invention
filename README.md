# バーコード在庫管理アプリ（Vercel + Supabase）

## できること
- スマホでバーコード読み取り
- 外付けバーコードスキャナ入力
- 入荷／出荷／在庫修正
- 担当者・備考を履歴保存
- 原在庫＋履歴で実在庫を自動計算
- PCで在庫確認・履歴検索
- CSV出力
- ピッ音・エラー音

## 1. Supabase準備
1. Supabaseで新規プロジェクト作成
2. SQL Editorを開く
3. `supabase_schema.sql` の中身を貼り付けてRun
4. Project Settings → API で以下を確認
   - Project URL
   - anon public key

## 2. Vercelで公開
### GitHub経由
1. このフォルダをGitHubにアップロード
2. VercelでNew Project
3. GitHubリポジトリを選択
4. Deploy

### CLI
```bash
npm i -g vercel
vercel --prod
```

## 3. 初回利用
1. Vercelで発行されたURLを開く
2. Supabase URLとanon keyを入力
3. 設定保存
4. 商品登録
5. スマホで同じURLを開いてスキャン

## 注意
- 試作用としてanon keyで読み書きできるRLSポリシーにしています。
- URLとキーを知っている人は操作できるため、本運用ではログイン機能追加を推奨します。
- iPhone/SafariではBarcodeDetectorが動かない場合があります。その場合は外付けBluetoothバーコードスキャナ、またはChrome系ブラウザを使ってください。
