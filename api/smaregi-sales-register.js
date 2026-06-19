const MESSAGE = "外部API連携は社内承認まで停止中です。スマレジ売上登録はCSVで手動処理してください。";

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 503;
  res.end(JSON.stringify({
    ok: false,
    disabled: true,
    mode: "csv",
    service: "smaregi-sales-register",
    message: MESSAGE,
    error: MESSAGE
  }));
};
