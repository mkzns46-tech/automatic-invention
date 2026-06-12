const ARICO_SALES_AUTH_KEY = "arico_sales_auth_token";
const ARICO_SALES_AUTH_EXPIRES_KEY = "arico_sales_auth_expires";
const ARICO_SALES_LOGIN_PAGE = "sales-login.html";

function getSalesAuthExpires() {
  return Number(sessionStorage.getItem(ARICO_SALES_AUTH_EXPIRES_KEY) || 0);
}

function hasSalesAuth() {
  const token = sessionStorage.getItem(ARICO_SALES_AUTH_KEY);
  const expires = getSalesAuthExpires();
  return Boolean(token && expires && Date.now() < expires);
}

function clearSalesAuth() {
  sessionStorage.removeItem(ARICO_SALES_AUTH_KEY);
  sessionStorage.removeItem(ARICO_SALES_AUTH_EXPIRES_KEY);
}

function requireSalesAuth() {
  if (hasSalesAuth()) return true;
  clearSalesAuth();
  const current = location.pathname.split("/").pop() || "index.html";
  location.replace(`${ARICO_SALES_LOGIN_PAGE}?next=${encodeURIComponent(current)}`);
  return false;
}

async function loginSalesAdmin(password) {
  const res = await fetch("/api/sales-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "販売管理認証に失敗しました。");
  }
  sessionStorage.setItem(ARICO_SALES_AUTH_KEY, data.token);
  sessionStorage.setItem(ARICO_SALES_AUTH_EXPIRES_KEY, String(Date.now() + Number(data.expiresInMs || 0)));
}

function logoutSales() {
  clearSalesAuth();
  location.href = ARICO_SALES_LOGIN_PAGE;
}
