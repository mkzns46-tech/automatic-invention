const HISTORY_SHEET_URL = "https://automatic-invention-eight.vercel.app/";
const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

function createPortalToken(){
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2,"0")).join("");
}

async function createPortalSession(){
  const token = createPortalToken();
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const res = await fetch(ARICO_SUPABASE_URL + "/rest/v1/portal_sessions", {
    method: "POST",
    headers: {
      apikey: ARICO_SUPABASE_API_KEY,
      Authorization: "Bearer " + ARICO_SUPABASE_API_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ token, expires_at: expires, source: "arico_portal" })
  });
  if(!res.ok){
    const text = await res.text();
    throw new Error(text || "session insert failed");
  }
  return token;
}

function setLang(lang){
  localStorage.setItem("arico_lang", lang);
  if(lang !== "ko"){
    const historyTitle = document.getElementById("historyTitle");
    const historyDesc = document.getElementById("historyDesc");
    if(historyTitle) historyTitle.innerText = "在庫確認アプリ";
    if(historyDesc) historyDesc.innerText = "在庫管理・棚卸・スマレジ連携";
    return;
  }
  const map = {
    title:"업무 시스템 로그인",
    desc:"시스템으로 들어가기 위한 포털입니다.",
    portalTitle:"시스템 포털",
    historyTitle:"재고 확인 앱",
    historyDesc:"재고 관리 · 재고 조사 · Smaregi 연동",
    rimTitle:"렌탈림 관리",
    shipTitle:"출고전 검품",
    soon1:"제작중",
    soon2:"제작중"
  };
  Object.entries(map).forEach(([id,text])=>{ const el=document.getElementById(id); if(el)el.innerText=text; });
}

function login(){
  const id = document.getElementById("id").value;
  const pass = document.getElementById("pass").value;
  if(id === "arico" && pass === "0201"){
    if(typeof createAuthSession==="function")createAuthSession(id);
    localStorage.setItem("arico_portal_login","ok");
    document.getElementById("loginWrap")?.classList.add("hidden");
    document.getElementById("portalWrap")?.classList.remove("hidden");
  }else{
    document.getElementById("error").innerText = "ユーザーIDまたはパスワードが違います。";
  }
}

function logout(){
  if(typeof clearAuthSession==="function")clearAuthSession();
  localStorage.removeItem("arico_portal_login");
  sessionStorage.removeItem("arico_portal_login");
  location.reload();
}

function goHistory(){
  if(localStorage.getItem("arico_portal_login") !== "ok"){
    location.reload();
    return;
  }
  window.location.href = buildInventoryAuthUrl(HISTORY_SHEET_URL);
}

function comingSoon(ja,ko){
  const lang = localStorage.getItem("arico_lang");
  alert(lang === "ko" ? ko + " 는 현재 제작중입니다." : ja + " は現在作成中です。");
}

window.onload = function(){
  const lang = localStorage.getItem("arico_lang") || "ja";
  setLang(lang);
  if(localStorage.getItem("arico_portal_login") === "ok"){
    document.getElementById("loginWrap")?.classList.add("hidden");
    document.getElementById("portalWrap")?.classList.remove("hidden");
  }
};
