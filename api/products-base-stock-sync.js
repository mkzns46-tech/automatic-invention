const MESSAGE = "products.base_stock の自動更新は停止中です。在庫変更は在庫管理側またはCSV確認運用で行ってください。";

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 503;
  res.end(JSON.stringify({
    ok: false,
    disabled: true,
    mode: "csv",
    service: "products-base-stock-sync",
    message: MESSAGE,
    error: MESSAGE
  }));
};
