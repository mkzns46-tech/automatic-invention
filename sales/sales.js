function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

function comingSoonSales(name) {
  showSalesMessage(`${name} は準備中です。現在は見積書・請求書・入金確認・納品書・領収書・顧客管理・設定を利用できます。`, "warn");
}

function renderSalesHome() {
  const menus = [
    ["販売進捗確認", "progress.html", "見積から領収までの進捗を確認", false],
    ["見積書", "quotes.html", "見積書作成・一覧・PDF出力", false],
    ["請求書", "invoices.html", "見積から変換・編集・PDF出力", false],
    ["入金確認", "payments.html", "請求書発行後の入金状態を確認", false],
    ["検品確認", "shipping.html", "発送前確認の状況を確認", true],
    ["納品書", "delivery.html", "請求書から作成された納品書を確認", false],
    ["領収書", "receipts.html", "入金済み請求書から領収書を作成", false],
    ["顧客管理", "customers.html", "見積書・請求書の顧客一覧", false],
    ["設定", "settings.html", "スマレジ商品データ取込", false]
  ];
  const area = document.getElementById("salesMenuGrid");
  if (!area) return;
  area.innerHTML = menus.map(([title, href, desc, disabled]) => `
    <a class="card menu-card ${disabled ? "disabled" : ""}" href="${href}" ${disabled ? `onclick="comingSoonSales('${title}'); return false;"` : ""}>
      <h3>${title}</h3>
      <p>${desc}</p>
    </a>
  `).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  renderSalesHome();
});
