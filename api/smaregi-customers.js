const MESSAGE = "外部API連携は社内承認まで停止中です。スマレジ会員取得はCSV取込で運用してください。";

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 503;
  res.end(JSON.stringify({
    ok: false,
    disabled: true,
    mode: "csv",
    service: "smaregi-customers",
    message: MESSAGE,
    error: MESSAGE
  }));
};
