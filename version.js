(function(){
  const version="v2026.07.19.5";
  window.ARICO_APP_VERSION=version;
  function addVersionBadge(){
    if(document.getElementById("aricoAppVersionBadge"))return;
    const badge=document.createElement("div");
    badge.id="aricoAppVersionBadge";
    badge.textContent=version;
    badge.setAttribute("aria-label",`ARICO app version ${version}`);
    badge.style.position="fixed";
    badge.style.right="10px";
    badge.style.bottom="8px";
    badge.style.zIndex="2147483647";
    badge.style.padding="3px 7px";
    badge.style.borderRadius="999px";
    badge.style.border="1px solid rgba(27,67,50,.18)";
    badge.style.background="rgba(255,255,255,.86)";
    badge.style.color="#1b4332";
    badge.style.fontSize="11px";
    badge.style.fontWeight="800";
    badge.style.lineHeight="1.2";
    badge.style.boxShadow="0 4px 14px rgba(16,37,27,.10)";
    badge.style.pointerEvents="none";
    document.body.appendChild(badge);
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",addVersionBadge,{once:true});
  }else{
    addVersionBadge();
  }
})();
