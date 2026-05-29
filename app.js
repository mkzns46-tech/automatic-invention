const HISTORY_SHEET_URL = "https://automatic-invention-eight.vercel.app/?auth=ARICO_PORTAL_2026&t=";

function setLang(lang){
  localStorage.setItem("arico_lang", lang);

  if(lang === "ko"){
    document.getElementById("title").innerText = "업무 시스템 로그인";
    document.getElementById("desc").innerText = "시스템으로 들어가기 위한 포털입니다.";
    document.getElementById("portalTitle").innerText = "시스템 포털";
    document.getElementById("historyTitle").innerText = "재고 변동 관리";
    document.getElementById("historyDesc").innerText = "입고 · 출고 · 재고 수정 · 상품 이력 관리";
    document.getElementById("rimTitle").innerText = "렌탈림 관리";
    document.getElementById("shipTitle").innerText = "출고전 검품";
    document.getElementById("soon1").innerText = "제작중";
    document.getElementById("soon2").innerText = "제작중";
  }
}

function login(){
  const id = document.getElementById("id").value;
  const pass = document.getElementById("pass").value;

  if(id === "arico" && pass === "0201"){
    localStorage.setItem("arico_portal_login","ok");

    document.getElementById("loginWrap").classList.add("hidden");
    document.getElementById("portalWrap").classList.remove("hidden");
  }else{
    document.getElementById("error").innerText = "ユーザーIDまたはパスワードが違います。";
  }
}

function logout(){
  localStorage.removeItem("arico_portal_login");
  location.reload();
}

function goHistory(){
  if(localStorage.getItem("arico_portal_login") !== "ok"){
    location.reload();
    return;
  }

  window.location.href = HISTORY_SHEET_URL + Date.now();
}

function comingSoon(ja,ko){
  const lang = localStorage.getItem("arico_lang");

  if(lang === "ko"){
    alert(ko + " 는 현재 제작중입니다.");
  }else{
    alert(ja + " は現在作成中です。");
  }
}

window.onload = function(){
  const lang = localStorage.getItem("arico_lang") || "ja";
  setLang(lang);

  if(localStorage.getItem("arico_portal_login") === "ok"){
    document.getElementById("loginWrap").classList.add("hidden");
    document.getElementById("portalWrap").classList.remove("hidden");
  }
}
