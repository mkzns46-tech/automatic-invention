// 停止中：このエンドポイントは認証なしでスマレジの実在庫（/stock/{id}/add）を書き換えられた。
// アプリからの呼び出しは既に無い（booth.js / inventory.js の在庫調整は停止済み）。
// smaregi-sales-register.js 等と同じ 503 応答にする。再開する場合はサーバー側認証と
// 二重送信防止（idempotency）を入れてから。
const MESSAGE = "外部API連携は社内承認まで停止中です。スマレジ在庫調整はスマレジ側で手動処理してください。";

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 503;
  res.end(JSON.stringify({
    ok: false,
    disabled: true,
    mode: "manual",
    service: "smaregi-stock-adjust",
    message: MESSAGE,
    error: MESSAGE
  }));
};
