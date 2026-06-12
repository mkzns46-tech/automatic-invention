function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : "");
}

function comingSoonSales(name) {
  showSalesMessage(`${name} は準備中です。v1では見積書のみ利用できます。`, "warn");
}

function renderSalesHome() {
  const menus = [
    ["見積書", "quotes.html", "見積書作成・一覧・PDF出力"],
    ["請求書", "invoices.html", "準備中"],
    ["入金確認", "payments.html", "準備中"],
    ["検品", "picking.html", "準備中"],
    ["納品書", "delivery.html", "準備中"],
    ["領収書", "receipts.html", "準備中"],
    ["卸発注残", "backorders.html", "準備中"],
    ["顧客管理", "customers.html", "準備中"]
  ];
  const area = document.getElementById("salesMenuGrid");
  if (!area) return;
  area.innerHTML = menus.map(([title, href, desc], index) => `
    <a class="card menu-card ${index ? "disabled" : ""}" href="${href}" ${index ? `onclick="comingSoonSales('${title}'); return false;"` : ""}>
      <h3>${title}</h3>
      <p>${desc}</p>
    </a>
  `).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  renderSalesHome();
});
