const SALES_MENU_ITEMS = [
  ["見積書", "quotes.html", "作成・一覧・PDF"],
  ["請求書", "invoices.html", "変換・編集・PDF"],
  ["入金確認", "payments.html", "手動確認"],
  ["検品確認", "shipping.html", "準備中"],
  ["納品書", "delivery.html", "準備中"],
  ["領収書", "receipts.html", "準備中"],
  ["顧客管理", "customers.html", "準備中"],
  ["設定", "settings.html", "スマレジ商品取込"]
];

const SALES_MENU_ITEMS_KO = [
  ["견적서", "quotes.html", "작성・목록・PDF"],
  ["청구서", "invoices.html", "변환・편집・PDF"],
  ["입금 확인", "payments.html", "수동 확인"],
  ["검품 확인", "shipping.html", "준비 중"],
  ["납품서", "delivery.html", "준비 중"],
  ["영수증", "receipts.html", "준비 중"],
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
    <nav aria-label="${isKo ? "판매 관리 메뉴" : "販売管理メニュー"}">
      <a class="sales-menu-link ${current === "index.html" || current === "index_ko.html" ? "active" : ""}" href="${isKo ? "index_ko.html" : "index.html"}">${isKo ? "トップ" : "トップ"}</a>
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
