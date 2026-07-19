(function(){
  const version="v9";
  window.ARICO_APP_VERSION=version;
  function addVersionBadge(){
    if(document.getElementById("aricoAppVersionBadge"))return;
    const badge=document.createElement("div");
    badge.id="aricoAppVersionBadge";
    badge.textContent=version;
    badge.setAttribute("aria-label",`ARICO app version ${version}`);
    badge.style.position="fixed";
    badge.style.right="14px";
    badge.style.bottom="12px";
    badge.style.zIndex="2147483647";
    badge.style.padding="6px 11px";
    badge.style.borderRadius="999px";
    badge.style.border="1px solid rgba(255,255,255,.45)";
    badge.style.background="rgba(18,83,57,.94)";
    badge.style.color="#fff";
    badge.style.fontSize="14px";
    badge.style.fontWeight="900";
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
