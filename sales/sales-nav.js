const SALES_MENU_ITEMS = [
  ["販売進捗確認", "progress.html"],
  ["見積書", "quotes.html"],
  ["請求書", "invoices.html"],
  ["入金確認", "payments.html"],
  ["検品確認", "shipping.html"],
  ["納品書", "delivery.html"],
  ["領収書", "receipts.html"],
  ["顧客管理", "customers.html"],
  ["設定", "settings.html"]
];

const SALES_MENU_ITEMS_KO = [
  ["판매진척확인", "progress.html"],
  ["견적서", "quotes.html"],
  ["청구서", "invoices.html"],
  ["입금확인", "payments.html"],
  ["검품확인", "shipping.html"],
  ["납품서", "delivery.html"],
  ["영수증", "receipts.html"],
  ["고객관리", "customers.html"],
  ["설정", "settings.html"]
];

function renderSalesSidebar() {
  if (document.body.classList.contains("sales-login-page")) return;
  const current = location.pathname.split("/").pop() || "index.html";
  const isKo = document.documentElement.lang === "ko" || current === "index_ko.html";
  const menus = isKo ? SALES_MENU_ITEMS_KO : SALES_MENU_ITEMS;
  document.body.classList.add("sales-has-sidebar");

  const nav = document.createElement("aside");
  nav.className = "sales-sidebar";
  nav.innerHTML = `
    <div class="sales-sidebar-brand">
      <strong>ARICO ARCHERY</strong>
      <span>${isKo ? "판매관리" : "販売管理"}</span>
    </div>
    <nav aria-label="${isKo ? "판매관리 메뉴" : "販売管理メニュー"}">
      <a class="sales-menu-link ${current === "index.html" || current === "index_ko.html" ? "active" : ""}" href="${isKo ? "index_ko.html" : "index.html"}"><strong>${isKo ? "トップ" : "トップ"}</strong></a>
      ${menus.map(([title, href]) => `
        <a class="sales-menu-link ${current === href ? "active" : ""}" href="${href}">
          <strong>${title}</strong>
        </a>
      `).join("")}
    </nav>
    <div class="sales-sidebar-bottom">
      <a class="sales-menu-link" href="${isKo ? "index_ko.html" : "index.html"}"><strong>${isKo ? "トップへ戻る" : "トップへ戻る"}</strong></a>
      <button type="button" class="sales-menu-logout" onclick="logoutSales();">${isKo ? "ログアウト" : "ログアウト"}</button>
    </div>
  `;
  document.body.prepend(nav);
  renderSalesHeaderLanguage(current);
}

function renderSalesHeaderLanguage(current) {
  const header = document.querySelector(".sales-header");
  if (!header || header.querySelector(".sales-header-language")) return;
  let actions = header.querySelector(".sales-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "sales-actions";
    header.appendChild(actions);
  }
  const lang = document.createElement("div");
  lang.className = "sales-header-language";
  lang.innerHTML = `
    <a class="${current !== "index_ko.html" ? "active" : ""}" href="index.html">日本語</a>
    <a class="${current === "index_ko.html" ? "active" : ""}" href="index_ko.html">한국어</a>
  `;
  actions.appendChild(lang);
}

function renderSalesCsvModeBanner() {
  if (document.body.classList.contains("sales-login-page")) return;
  if (document.querySelector(".sales-csv-mode-banner")) return;
  const target = document.querySelector(".sales-header") || document.querySelector("main") || document.body;
  const banner = document.createElement("div");
  banner.className = "sales-csv-mode-banner";
  banner.textContent = "API停止中／CSV運用中：スマレジ等の外部サービスへ自動登録・取得・更新は行いません。";
  if (target.classList?.contains("sales-header")) {
    target.insertAdjacentElement("afterend", banner);
  } else {
    target.prepend(banner);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderSalesSidebar();
  renderSalesCsvModeBanner();
});
