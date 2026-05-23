const LOGIN_USER = "arico";
const LOGIN_PASSWORD = "0201";
const LOGIN_KEY = "arico_portal_logged_in";
const HISTORY_SHEET_URL = "https://automatic-invention-eight.vercel.app/?auth=ARICO_PORTAL_2026";

function el(id){
  return document.getElementById(id);
}

function showLogin(){
  el("loginView").classList.remove("hidden");
  el("portalView").classList.add("hidden");
}

function showPortal(){
  el("loginView").classList.add("hidden");
  el("portalView").classList.remove("hidden");
}

function login(){
  const id = el("id").value.trim();
  const pass = el("pass").value;
  const error = el("error");

  if(id === LOGIN_USER && pass === LOGIN_PASSWORD){
    localStorage.setItem(LOGIN_KEY,"ok");
    sessionStorage.setItem(LOGIN_KEY,"ok");
    error.textContent = "";
    showPortal();
    return;
  }

  error.textContent = currentLang() === "ko"
    ? "사용자 ID 또는 비밀번호가 다릅니다."
    : "ユーザーIDまたはパスワードが違います。";
}

function logout(){
  localStorage.removeItem(LOGIN_KEY);
  sessionStorage.removeItem(LOGIN_KEY);
  el("pass").value = "";
  showLogin();
}

function isLoggedIn(){
  return localStorage.getItem(LOGIN_KEY) === "ok" || sessionStorage.getItem(LOGIN_KEY) === "ok";
}

function requireLogin(){
  if(!isLoggedIn()){
    alert(currentLang() === "ko" ? "로그인해 주세요." : "ログインしてください");
    showLogin();
    return false;
  }
  return true;
}

function goHistorySheet(){
  if(!requireLogin())return;
  window.location.href = HISTORY_SHEET_URL;
}

function comingSoon(name){
  if(!requireLogin())return;

  const koNames = {
    "レンタルリム管理":"렌탈 림 관리",
    "出荷前検品":"출하 전 검품"
  };

  if(currentLang() === "ko"){
    alert((koNames[name] || name) + "는 현재 작성 중입니다.");
  }else{
    alert(name + " は現在作成中です。");
  }
}

function currentLang(){
  return localStorage.getItem("arico_portal_lang") || "ja";
}

function setLang(lang){
  localStorage.setItem("arico_portal_lang",lang);

  document.querySelectorAll("[data-ja]").forEach(node=>{
    node.textContent = node.dataset[lang] || node.dataset.ja;
  });

  document.querySelectorAll(".lang-btn").forEach(btn=>{
    btn.classList.toggle("active",
      (lang === "ja" && btn.textContent.trim() === "日本語") ||
      (lang === "ko" && btn.textContent.trim() === "한국어")
    );
  });

  const error = el("error");
  if(error && error.textContent){
    error.textContent = lang === "ko"
      ? "사용자 ID 또는 비밀번호가 다릅니다."
      : "ユーザーIDまたはパスワードが違います。";
  }
}

window.addEventListener("DOMContentLoaded",()=>{
  setLang(currentLang());

  const link = el("historyLink");
  if(link){
    link.href = HISTORY_SHEET_URL;
    link.addEventListener("click",(e)=>{
      if(!requireLogin()){
        e.preventDefault();
      }
    });
  }

  if(isLoggedIn()){
    showPortal();
  }else{
    showLogin();
  }

  el("pass").addEventListener("keydown",(e)=>{
    if(e.key === "Enter")login();
  });

  el("id").addEventListener("keydown",(e)=>{
    if(e.key === "Enter")login();
  });
});
