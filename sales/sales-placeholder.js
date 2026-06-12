document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  const title = document.body.dataset.salesTitle || "準備中";
  const titleEl = document.getElementById("salesPlaceholderTitle");
  const messageEl = document.getElementById("salesPlaceholderMessage");
  if (titleEl) titleEl.textContent = title;
  if (messageEl) {
    messageEl.textContent = `${title}は次フェーズで実装します。v1では見積書のみ利用できます。`;
  }
});
