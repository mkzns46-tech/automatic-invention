(function(){
  const version="Ver 2.90";
  window.ARICO_APP_VERSION=version;
  function addVersionBadge(){
    if(document.getElementById("aricoAppVersionBadge"))return;
    const badge=document.createElement("div");
    badge.id="aricoAppVersionBadge";
    badge.textContent=version;
    badge.setAttribute("aria-label",`ARICO app version ${version}`);
    badge.style.position="fixed";
    badge.style.right="18px";
    badge.style.bottom="18px";
    badge.style.zIndex="2147483647";
    badge.style.padding="10px 16px";
    badge.style.borderRadius="10px";
    badge.style.border="2px solid rgba(255,255,255,.65)";
    badge.style.background="rgba(11,75,51,.96)";
    badge.style.color="#fff";
    badge.style.fontSize="18px";
    badge.style.fontWeight="900";
    badge.style.lineHeight="1.2";
    badge.style.boxShadow="0 6px 18px rgba(16,37,27,.24)";
    badge.style.pointerEvents="none";
    document.body.appendChild(badge);
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",addVersionBadge,{once:true});
  }else{
    addVersionBadge();
  }
})();
