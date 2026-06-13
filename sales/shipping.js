function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  showSalesMessage("検品確認は準備中です。発送確認で行った検品・発送結果を販売管理側で確認する画面として整備予定です。", "warn");
});
