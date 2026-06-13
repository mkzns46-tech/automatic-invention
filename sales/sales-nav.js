const SALES_MENU_ITEMS = [
  ["見積書", "quotes.html", "見積作成・一覧・PDF"],
  ["請求書", "invoices.html", "変換・編集・PDF"],
  ["入金確認", "payments.html", "準備中"],
  ["検品", "picking.html", "準備中"],
  ["納品書", "delivery.html", "準備中"],
  ["領収書", "receipts.html", "準備中"],
  ["卸発注残", "backorders.html", "準備中"],
  ["顧客管理", "customers.html", "準備中"],
  ["設定", "settings.html", "スマレジ商品取込"]
];

const SALES_MENU_ITEMS_KO = [
  ["견적서", "quotes.html", "견적 작성・목록・PDF"],
  ["청구서", "invoices.html", "변환・편집・PDF"],
  ["입금 확인", "payments.html", "준비 중"],
  ["검품", "picking.html", "준비 중"],
  ["납품서", "delivery.html", "준비 중"],
  ["영수증", "receipts.html", "준비 중"],
  ["도매 발주 잔량", "backorders.html", "준비 중"],
  ["고객 관리", "customers.html", "준비 중"],
  ["설정", "settings.html", "스마레지 상품 가져오기"]
];

function renderSalesSidebar() {
  if (document.body.classList.contains("sales-login-page")) return;
  const current = location.pathname.split("/").pop() || "index.html";
  const isKo = document.documentElement.lang === "ko";
  const menus = isKo ? SALES_MENU_ITEMS_KO : SALES_MENU_ITEMS;
  document.body.classList.add("sales-has-sidebar");
  const nav = document.createElement("aside");
  nav.className = "sales-sidebar";
  nav.innerHTML = `
    <div class="sales-sidebar-brand">
      <strong>ARICO ARCHERY</strong>
      <span>${isKo ? "판매 관리" : "販売管理"}</span>
    </div>
    <nav aria-label="販売管理メニュー">
      <a class="sales-menu-link ${current === "index.html" || current === "index_ko.html" ? "active" : ""}" href="${isKo ? "index_ko.html" : "index.html"}">${isKo ? "톱" : "トップ"}</a>
      ${menus.map(([title, href, desc]) => `
        <a class="sales-menu-link ${current === href ? "active" : ""}" href="${href}">
          <strong>${title}</strong>
          <span>${desc}</span>
        </a>
      `).join("")}
    </nav>
    <div class="sales-language">
      <a class="${current !== "index_ko.html" ? "active" : ""}" href="index.html">日本語</a>
      <a class="${current === "index_ko.html" ? "active" : ""}" href="index_ko.html">한국어</a>
    </div>
  `;
  document.body.prepend(nav);
}

document.addEventListener("DOMContentLoaded", renderSalesSidebar);
