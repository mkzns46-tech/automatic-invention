# バーコード在庫管理アプリ v4 初期設定なし版

## 変更内容
- 初期設定画面を削除
- Supabase URL/APIキーを app.js に固定
- CSV一括取り込み対応

## 必ずやること
GitHubで app.js を開いて、上部のこの行を編集してください。

const SUPABASE_API_KEY = "ここに_sb_publishable_で始まるキーを貼る";

ここにSupabaseの Publishable key を貼ります。
Secret key は入れないでください。

SUPABASE_URL は既に設定済みです。
