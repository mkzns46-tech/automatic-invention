/* ARICO TOKYO inventory app: core.js */

window.addEventListener("error",(e)=>{
  try{
    if(typeof showMessage==="function")showMessage("起動エラー。\n"+(e.message||""),"err");
  }catch(_){}
});

window.addEventListener("unhandledrejection",(e)=>{
  try{
    if(typeof showMessage==="function")showMessage("通信または処理エラー。\n"+(e.reason?.message||e.reason||""),"err");
  }catch(_){}
});
const el=(id)=>document.getElementById(id);

const INVENTORY_APP_MENU_SECTIONS=[
  {label:"在庫管理",items:[
    {key:"inventory",label:"在庫変動登録",action:"inventory"},
    {key:"history",label:"履歴確認",action:"history"}
  ]},
  {label:"棚卸作業",items:[
    {key:"smaregi",label:"スマレジ変動商品チェック",id:"openSmaregiStockCheckBtn"}
  ]},
  {label:"イベント販売",items:[
    {key:"booth",label:"イベント管理",action:"booth",title:"準備中"}
  ]},
  {label:"分析",items:[
    {key:"inventory-analytics",label:"棚卸分析",action:"inventory-analytics"},
    {key:"booth-analytics",label:"イベント分析",action:"booth-analytics"}
  ]},
  {label:"設定",items:[
    {key:"settings",label:"設定",action:"settings"}
  ]}
];
const INVENTORY_APP_MENU_FOOTER_ITEMS=[
  {key:"admin-auth",label:"管理者認証",action:"admin-auth"},
  {key:"portal",label:"トップへ戻る",action:"portal"},
  {key:"logout",label:"ログアウト",action:"logout"}
];
const INVENTORY_ADMIN_PASSWORD="S3edc##530.";
const INVENTORY_ADMIN_AUTHENTICATED_AT_KEY="arico_inventory_admin_authenticated_at";
const INVENTORY_ADMIN_AUTH_DURATION_MS=12*60*60*1000;
const SMAREGI_CONTEXT_STORAGE_KEY="arico_current_smaregi_context";
const SMAREGI_CONTEXT_OPTIONS={
  stores:[
    {key:"tokyo",label:"東京"},
    {key:"aichi",label:"愛知"}
  ]
};
window.currentSmaregiAccount="production";
window.currentStore="tokyo";

function getSmaregiContextOption(list,key,fallbackKey){
  return list.find(item=>item.key===key)||list.find(item=>item.key===fallbackKey)||list[0];
}

function getCurrentSmaregiContext(){
  let saved={};
  try{
    saved=JSON.parse(localStorage.getItem(SMAREGI_CONTEXT_STORAGE_KEY)||"{}")||{};
  }catch(_){
    saved={};
  }
  const store=getSmaregiContextOption(SMAREGI_CONTEXT_OPTIONS.stores,saved.storeCode||window.currentStore,"tokyo");
  window.currentSmaregiAccount="production";
  window.currentStore=store.key;
  return {
    accountKey:"production",
    accountName:"スマレジ本番接続",
    storeCode:store.key,
    storeName:store.label
  };
}

function setCurrentSmaregiContext(storeCode){
  const store=getSmaregiContextOption(SMAREGI_CONTEXT_OPTIONS.stores,storeCode,"tokyo");
  const context={
    accountKey:"production",
    accountName:"スマレジ本番接続",
    storeCode:store.key,
    storeName:store.label
  };
  window.currentSmaregiAccount=context.accountKey;
  window.currentStore=context.storeCode;
  localStorage.setItem(SMAREGI_CONTEXT_STORAGE_KEY,JSON.stringify({
    storeCode:context.storeCode
  }));
  updateSmaregiContextSelector();
  return context;
}

function getSmaregiRequestContext(){
  const context=getCurrentSmaregiContext();
  return {
    accountKey:context.accountKey,
    accountName:context.accountName,
    storeCode:context.storeCode,
    storeName:context.storeName
  };
}

function getSmaregiContextLabel(context=getCurrentSmaregiContext()){
  return `${context.accountName} / ${context.storeName}`;
}

function getSmaregiOperationContextText(extraText=""){
  const context=getCurrentSmaregiContext();
  return [
    `接続先：${context.accountName}`,
    `店舗：${context.storeName}`,
    extraText ? `\n${extraText}` : "",
    "\nこの店舗のデータを更新します。",
    "よろしいですか？"
  ].filter(Boolean).join("\n");
}

function updateSmaregiContextSelector(){
  const context=getCurrentSmaregiContext();
  const store=el("smaregiStoreSelect");
  const badge=el("smaregiContextBadge");
  if(store)store.value=context.storeCode;
  if(badge){
    const storeBadge=context.storeCode==="aichi" ? "AICHI" : "TOKYO";
    badge.classList.toggle("is-production",true);
    badge.classList.toggle("is-tokyo",context.storeCode==="tokyo");
    badge.classList.toggle("is-aichi",context.storeCode==="aichi");
    badge.innerHTML=`<span>接続先：${esc(context.accountName)}</span><strong>${esc(storeBadge)}</strong><span>店舗：${esc(context.storeName)}</span>`;
  }
}

function renderSmaregiConnectionSelector(){
  const root=el("smaregiContextBar");
  if(!root)return;
  const context=getCurrentSmaregiContext();
  const storeClass=context.storeCode==="aichi" ? "is-aichi" : "is-tokyo";
  const storeBadge=context.storeCode==="aichi" ? "AICHI" : "TOKYO";
  root.innerHTML=`
    <div id="smaregiContextBadge" class="smaregi-context-badge is-production ${storeClass}">
      <span>接続先：${esc(context.accountName)}</span>
      <strong>${esc(storeBadge)}</strong>
      <span>店舗：${esc(context.storeName)}</span>
    </div>
    <label>店舗
      <select id="smaregiStoreSelect" aria-label="店舗">
        ${SMAREGI_CONTEXT_OPTIONS.stores.map(item=>`<option value="${esc(item.key)}">${esc(item.label)}</option>`).join("")}
      </select>
    </label>`;
  updateSmaregiContextSelector();
  const input=el("smaregiStoreSelect");
  if(input){
    input.addEventListener("change",()=>{
      const next=setCurrentSmaregiContext(input.value);
      if(typeof showMessage==="function")showMessage(`店舗を ${next.storeName} に切り替えました。接続先は環境変数で設定されたスマレジ本番接続です。`);
    });
  }
}

function getInventoryAppMenuItemHtml(item){
  const attrs=`class="inventory-app-menu-item" data-menu-key="${esc(item.key)}" ${item.disabled?"disabled":""} ${item.title?`title="${esc(item.title)}"`:""}`;
  const body=`<span>${esc(item.label)}</span>`;
  if(item.href)return `<a ${attrs} href="${esc(item.href)}">${body}</a>`;
  return `<button type="button" ${attrs} ${item.id?`id="${esc(item.id)}"`:""} data-menu-action="${esc(item.action||"")}">${body}</button>`;
}

function getInventoryAppMenuSectionHtml(section){
  return `<section class="inventory-app-menu-section">
    <h2 class="inventory-app-menu-heading">${esc(section.label)}</h2>
    <div class="inventory-app-menu-section-items">${section.items.map(getInventoryAppMenuItemHtml).join("")}</div>
  </section>`;
}

function renderInventoryAppMenu(){
  const menu=el("inventoryAppMenu");
  if(!menu)return;
  menu.hidden=false;
  menu.innerHTML=`
    <div class="inventory-app-menu-main">${INVENTORY_APP_MENU_SECTIONS.map(getInventoryAppMenuSectionHtml).join("")}</div>
    <div class="inventory-app-menu-footer">${INVENTORY_APP_MENU_FOOTER_ITEMS.map(getInventoryAppMenuItemHtml).join("")}</div>`;
  menu.querySelectorAll(".inventory-app-menu-item[href]").forEach(link=>{
    link.addEventListener("click",()=>{
      if(link.dataset.menuKey==="inventory"&&typeof hideSmaregiStockCheck==="function")hideSmaregiStockCheck();
      setInventoryAppMenuActive(link.dataset.menuKey);
      closeInventoryMenuDrawer();
    });
  });
  menu.querySelectorAll(".inventory-app-menu-item:not([disabled])").forEach(item=>{
    item.addEventListener("click",closeInventoryMenuDrawer);
  });
  const inventoryButton=menu.querySelector('[data-menu-action="inventory"]');
  if(inventoryButton)inventoryButton.addEventListener("click",showInventoryRegistration);
  const historyButton=menu.querySelector('[data-menu-action="history"]');
  if(historyButton)historyButton.addEventListener("click",showInventoryHistory);
  const boothButton=menu.querySelector('[data-menu-action="booth"]');
  if(boothButton)boothButton.addEventListener("click",()=>{
    if(typeof showBoothManagement==="function")showBoothManagement();
    else showPopup("イベント管理","準備中です。");
  });
  const adminAuthButton=menu.querySelector('[data-menu-action="admin-auth"]');
  if(adminAuthButton)adminAuthButton.addEventListener("click",authenticateInventoryAdmin);
  const inventoryAnalyticsButton=menu.querySelector('[data-menu-action="inventory-analytics"]');
  if(inventoryAnalyticsButton)inventoryAnalyticsButton.addEventListener("click",showInventoryAnalytics);
  const boothAnalyticsButton=menu.querySelector('[data-menu-action="booth-analytics"]');
  if(boothAnalyticsButton)boothAnalyticsButton.addEventListener("click",showBoothAnalytics);
  const portalButton=menu.querySelector('[data-menu-action="portal"]');
  if(portalButton)portalButton.addEventListener("click",goToPortal);
  const settingsButton=menu.querySelector('[data-menu-action="settings"]');
  if(settingsButton)settingsButton.addEventListener("click",showInventorySettings);
  const logoutButton=menu.querySelector('[data-menu-action="logout"]');
  if(logoutButton)logoutButton.addEventListener("click",logout);
  bindInventoryMenuDrawer();
  updateInventoryAdminAuthControl();
  setInventoryAppMenuActive("inventory");
}

function setInventoryAppMenuActive(key){
  const menu=el("inventoryAppMenu");
  if(!menu)return;
  menu.querySelectorAll(".inventory-app-menu-item").forEach(item=>{
    const active=item.dataset.menuKey===key;
    item.classList.toggle("is-active",active);
    if(active)item.setAttribute("aria-current","page");
    else item.removeAttribute("aria-current");
  });
}

function showInventoryRegistration(){
  showInventoryScreen("inventory");
}

function showInventoryHistory(){
  showInventoryScreen("history");
  if(typeof renderGlobalHistory==="function")renderGlobalHistory();
}

function showInventoryProductHistory(){
  showInventoryScreen("history");
  scrollInventoryPanelIntoView("productHistoryCard");
}

function hasInventoryPrivilegedAccess(){
  return isInventoryAdminAuthenticated();
}

function isInventoryAdminAuthenticated(){
  const authenticatedAt=Number(localStorage.getItem(INVENTORY_ADMIN_AUTHENTICATED_AT_KEY)||0);
  const now=Date.now();
  const valid=authenticatedAt>0&&authenticatedAt<=now&&now-authenticatedAt<INVENTORY_ADMIN_AUTH_DURATION_MS;
  if(!valid)localStorage.removeItem(INVENTORY_ADMIN_AUTHENTICATED_AT_KEY);
  return valid;
}

function authenticateInventoryAdmin(){
  if(isInventoryAdminAuthenticated()){
    showPopup("管理者認証","認証済みです。認証後12時間は再入力不要です。");
    return true;
  }
  const password=prompt("管理者パスワードを入力してください。");
  if(String(password||"").trim()!==INVENTORY_ADMIN_PASSWORD){
    if(password!==null)showMessage("パスワードが違います。","err");
    return false;
  }
  localStorage.setItem(INVENTORY_ADMIN_AUTHENTICATED_AT_KEY,String(Date.now()));
  updateInventoryAdminAuthControl();
  if(typeof updateSmaregiManagerControls==="function")updateSmaregiManagerControls();
  showMessage("管理者認証が完了しました。12時間は再入力不要です。","ok");
  return true;
}

function updateInventoryAdminAuthControl(){
  const button=el("inventoryAppMenu")?.querySelector('[data-menu-action="admin-auth"]');
  if(!button)return;
  const authenticated=isInventoryAdminAuthenticated();
  button.classList.toggle("is-authenticated",authenticated);
  button.textContent=authenticated?"管理者認証済み":"管理者認証";
}

function unlockInventoryScreen(){
  return requireInventoryPrivilegedAccess();
}

function requireInventoryPrivilegedAccess(){
  if(hasInventoryPrivilegedAccess())return true;
  showMessage("先にメニューの「管理者認証」ボタンから認証してください。","err");
  return false;
}

function showInventorySettings(){
  if(!unlockInventoryScreen("settings"))return;
  showInventoryScreen("settings");
}

function showInventorySettingsSection(menuKey,targetId){
  if(!unlockInventoryScreen("settings"))return;
  showInventoryScreen("settings",menuKey);
  scrollInventoryPanelIntoView(targetId);
}

function showInventoryAnalytics(){
  if(!unlockInventoryScreen("analytics"))return;
  showInventoryScreen("analytics","inventory-analytics");
  if(typeof loadSmaregiAccuracy==="function")loadSmaregiAccuracy();
  if(typeof loadSmaregiDifferenceRanking==="function")loadSmaregiDifferenceRanking();
  if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
  if(typeof showSmaregiReasonSummary==="function")showSmaregiReasonSummary({scroll:false});
}

function showBoothAnalytics(){
  if(!unlockInventoryScreen("analytics"))return;
  showInventoryScreen("booth-analytics");
}

function showInventoryAnalyticsSection(menuKey,targetId){
  if(!unlockInventoryScreen("analytics"))return;
  showInventoryScreen("analytics",menuKey);
  if(typeof loadSmaregiAccuracy==="function")loadSmaregiAccuracy();
  if(typeof loadSmaregiDifferenceRanking==="function")loadSmaregiDifferenceRanking();
  if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
  if(typeof showSmaregiReasonSummary==="function")showSmaregiReasonSummary({scroll:false});
  scrollInventoryPanelIntoView(targetId);
}

function scrollInventoryPanelIntoView(targetId){
  const target=el(targetId);
  if(target)target.scrollIntoView({behavior:"smooth",block:"start"});
}

function showInventoryScreen(screen,menuKey=screen){
  document.body.dataset.inventoryScreen=screen;
  document.querySelector("main.grid")?.classList.remove("smaregi-mode");
  document.querySelectorAll("[data-inventory-screen]").forEach(panel=>{
    panel.hidden=panel.dataset.inventoryScreen!==screen;
  });
  if(screen==="smaregi"&&typeof startSmaregiAutoRefresh==="function")startSmaregiAutoRefresh();
  else if(typeof stopSmaregiAutoRefresh==="function")stopSmaregiAutoRefresh();
  if(typeof updateSmaregiManagerControls==="function")updateSmaregiManagerControls();
  updateInventoryAdminAuthControl();
  setInventoryAppMenuActive(menuKey);
  closeInventoryMenuDrawer();
}

function setInventoryMenuDrawerOpen(open){
  document.body.classList.toggle("inventory-menu-open",Boolean(open));
  const toggle=el("inventoryMenuToggleBtn");
  if(toggle)toggle.setAttribute("aria-expanded",String(Boolean(open)));
}

function closeInventoryMenuDrawer(){
  setInventoryMenuDrawerOpen(false);
}

function bindInventoryMenuDrawer(){
  const toggle=el("inventoryMenuToggleBtn");
  const overlay=el("inventoryMenuOverlay");
  if(toggle&&!toggle.dataset.menuBound){
    toggle.dataset.menuBound="1";
    toggle.addEventListener("click",()=>setInventoryMenuDrawerOpen(!document.body.classList.contains("inventory-menu-open")));
  }
  if(overlay&&!overlay.dataset.menuBound){
    overlay.dataset.menuBound="1";
    overlay.addEventListener("click",closeInventoryMenuDrawer);
  }
}


function showPopup(title, body){
  const popup=el("appPopup");
  const t=el("appPopupTitle");
  const b=el("appPopupBody");
  if(t)t.textContent=title||"完了";
  if(b)b.textContent=body||"";
  if(popup)popup.style.display="flex";
}

function hidePopup(){
  const popup=el("appPopup");
  if(popup)popup.style.display="none";
}

function confirmAppAction(title,body,{okText="実行",cancelText="キャンセル"}={}){
  return new Promise(resolve=>{
    const popup=document.createElement("div");
    popup.className="app-popup app-confirm-popup";
    popup.style.display="flex";
    popup.innerHTML=`<div class="app-popup-card">
      <div class="app-popup-title">${esc(title||"確認")}</div>
      <div class="app-popup-body">${esc(body||"")}</div>
      <div class="app-confirm-actions">
        <button type="button" class="secondary app-confirm-cancel-btn">${esc(cancelText)}</button>
        <button type="button" class="app-confirm-ok-btn">${esc(okText)}</button>
      </div>
    </div>`;
    const close=value=>{
      try{document.body.removeChild(popup);}catch(_){}
      resolve(value);
    };
    popup.querySelector(".app-confirm-cancel-btn")?.addEventListener("click",()=>close(false));
    popup.querySelector(".app-confirm-ok-btn")?.addEventListener("click",()=>close(true));
    popup.addEventListener("click",event=>{
      if(event.target===popup)close(false);
    });
    document.body.appendChild(popup);
  });
}

function showMessage(text,type="",options={}){
  if(type==="ok")playSuccessSound();
  if(type==="err"){
    playErrorSound();
    if(options.popup!==false)showPopup("エラー",text);
  }
  const smaregiCard=el("smaregiStockCheckCard");
  const productImportCard=el("productImportCard");
  const m=smaregiCard&&!smaregiCard.hidden
    ? el("smaregiMessage")
    : (productImportCard&&!productImportCard.hidden ? el("productImportMessage") : el("message"));
  if(!m)return;
  m.textContent=text;
  m.className="message "+type;
}

function playSuccessSound(){
  try{
    const audio=new Audio("/sounds/success.mp3");
    audio.volume=0.6;
    audio.play().catch(()=>playFallbackNotificationTone("success"));
  }catch(_){
    playFallbackNotificationTone("success");
  }
}

function playErrorSound(){
  try{
    const audio=new Audio("/sounds/error.mp3");
    audio.volume=0.7;
    audio.play().catch(()=>playFallbackNotificationTone("error"));
  }catch(_){
    playFallbackNotificationTone("error");
  }
}

function playFallbackNotificationTone(type){
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return;
    const ctx=new AudioContextClass();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    const now=ctx.currentTime;
    const isError=type==="error";

    osc.type=isError?"square":"sine";
    osc.frequency.setValueAtTime(isError?220:740,now);
    if(isError)osc.frequency.setValueAtTime(160,now+0.12);
    else osc.frequency.setValueAtTime(980,now+0.08);
    gain.gain.setValueAtTime(isError?0.08:0.06,now);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+(isError?0.24:0.16));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now+(isError?0.25:0.17));
    setTimeout(()=>{
      try{ctx.close();}catch(_){}
    },isError?280:200);
  }catch(_){}
}


async function sb(path,opt={}){
  const headers={
    apikey:SUPABASE_API_KEY,
    Authorization:"Bearer "+SUPABASE_API_KEY,
    "Content-Type":"application/json",
    Accept:"application/json",
    ...(opt.headers||{})
  };

  const res=await fetch(SUPABASE_URL.replace(/\/+$/,"")+"/rest/v1/"+path,{...opt,headers});
  const text=await res.text();

  let body=null;
  try{body=text?JSON.parse(text):null;}catch{body=text;}

  if(!res.ok){
    const detail=typeof body==="object"?JSON.stringify(body):String(body||"");
    throw new Error(`Supabaseエラー ${res.status}\n${detail}`);
  }
  return body;
}

async function sbAll(path,pageSize=1000,maxRows=20000){
  const all=[];
  let offset=0;

  while(true){
    const url=path+(path.includes("?")?"&":"?")+`limit=${pageSize}&offset=${offset}`;
    const rows=await sb(url);
    if(!Array.isArray(rows))return rows;

    all.push(...rows);
    if(rows.length<pageSize)break;

    offset+=pageSize;
    if(offset>=maxRows)break;
  }
  return all;
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,(c)=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function fmt(iso){
  try{return new Date(iso).toLocaleString("ja-JP");}
  catch{return iso;}
}

function gp(barcode){
  return products.find(p=>String(p.barcode)===String(barcode));
}

async function fetchProductByBarcode(barcode){
  barcode=String(barcode||"").trim();
  if(!barcode)return null;

  const cached=gp(barcode);
  if(cached)return cached;

  const rows=await sb(`products?select=*&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
  const p=Array.isArray(rows)&&rows.length?rows[0]:null;

  if(p&&!gp(p.barcode)){
    products.push(p);
  }

  return p;
}

function getCurrentStock(barcode){
  const p=gp(barcode);
  return Number(p?.base_stock||0);
}

function downloadCsvFile(filename,rows){
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  a.style.display="none";
  document.body.appendChild(a);
  setTimeout(()=>{
    a.click();
    setTimeout(()=>{
      try{document.body.removeChild(a);}catch(_){}
      URL.revokeObjectURL(url);
    },1000);
  },0);
}



function on(id,event,fn){
  const x=el(id);
  if(x)x.addEventListener(event,fn);
}

/* ===== v50 Japanese / Korean UI toggle ===== */
const I18N = {
  ja: {
    "ARICO TOKYO 在庫管理":"ARICO ARCHERY 在庫管理",
    "ARICO ARCHERY 在庫管理":"ARICO ARCHERY 在庫管理",
    
    "再読み込み":"再読み込み",
    "在庫変動登録":"在庫変動登録",
    "持ち出し・入荷・在庫修正・備品転用を記録します":"持ち出し・入荷・在庫修正・備品転用を記録します",
    "区分":"区分",
    "担当者":"担当者",
    "数量":"数量",
    "備考（自由入力・連続スキャン中は保持）":"備考（自由入力・連続スキャン中は保持）",
    "📷 カメラでバーコード読み取り":"📷 カメラでバーコード読み取り",
    "停止":"停止",
    "バーコード入力":"バーコード入力",
    "登録":"登録",
    "担当者設定":"担当者設定",
    "スマホ側の担当者プルダウンに反映されます":"スマホ側の担当者プルダウンに反映されます",
    "担当者名":"担当者名",
    "担当者を追加":"担当者を追加",
    "操作":"操作",
    "削除":"削除",
    "商品登録":"商品登録",
    "バーコード":"バーコード",
    "商品名":"商品名",
    "現在庫":"現在庫",
    "棚番":"棚番",
    "商品を登録 / 更新":"商品を登録 / 更新",
    "CSV取り込み":"CSV取り込み",
    "商品マスターをまとめて登録・更新できます":"商品マスターをまとめて登録・更新できます",
    "簡単インポート":"簡単インポート",
    "上書き対応":"上書き対応",
    "サンプルあり":"サンプルあり",
    "⬆ 追加・更新で取り込み":"⬆ 追加・更新で取り込み",
    "サンプルCSVをダウンロード":"サンプルCSVをダウンロード",
    "スマレジ商品マスター取込":"スマレジ商品マスター取込",
    "商品別履歴":"商品別履歴",
    "商品履歴検索":"商品履歴検索",
    "在庫チェック":"在庫チェック",
    "チェック記録":"チェック記録",
    "全履歴を表示":"全履歴を表示",
    "チェック以降を表示":"チェック以降を表示",
    "入力日時":"入力日時",
    "在庫数":"在庫数",
    "入荷":"入荷",
    "出荷":"出荷",
    "備品転用":"備品転用",
    "備品転用確認":"備品転用確認",
    "区分検索":"区分検索",
    "商品名検索":"商品名検索",
    "担当者検索":"担当者検索",
    "備考検索":"備考検索",
    "全体履歴":"全体履歴",
    "履歴CSV":"履歴CSV",
    "全データCSV":"全データCSV",
    "検索をクリア":"検索をクリア"
  },
  ko: {
    "ARICO TOKYO 在庫管理":"ARICO ARCHERY 재고 관리",
    "ARICO ARCHERY 在庫管理":"ARICO ARCHERY 재고 관리",
    
    "再読み込み":"다시 불러오기",
    "在庫変動登録":"재고 변동 등록",
    "持ち出し・入荷・在庫修正・備品転用を記録します":"반출・입고・재고 수정・비품 전용을 기록합니다",
    "区分":"구분",
    "担当者":"담당자",
    "数量":"수량",
    "備考（自由入力・連続スキャン中は保持）":"비고（자유 입력・연속 스캔 중 유지）",
    "📷 カメラでバーコード読み取り":"📷 카메라로 바코드 읽기",
    "停止":"정지",
    "バーコード入力":"바코드 입력",
    "登録":"등록",
    "担当者設定":"담당자 설정",
    "スマホ側の担当者プルダウンに反映されます":"스마트폰 담당자 선택 목록에 반영됩니다",
    "担当者名":"담당자명",
    "担当者を追加":"담당자 추가",
    "操作":"작업",
    "削除":"삭제",
    "商品登録":"상품 등록",
    "バーコード":"바코드",
    "商品名":"상품명",
    "現在庫":"현재 재고",
    "棚番":"선반 번호",
    "商品を登録 / 更新":"상품 등록 / 업데이트",
    "CSV取り込み":"CSV 가져오기",
    "商品マスターをまとめて登録・更新できます":"상품 마스터를 일괄 등록・업데이트합니다",
    "簡単インポート":"간단 가져오기",
    "上書き対応":"덮어쓰기 지원",
    "サンプルあり":"샘플 제공",
    "⬆ 追加・更新で取り込み":"⬆ 추가・업데이트 가져오기",
    "サンプルCSVをダウンロード":"샘플 CSV 다운로드",
    "スマレジ商品マスター取込":"스마레지 상품 마스터 가져오기",
    "商品別履歴":"상품별 이력",
    "商品履歴検索":"상품 이력 검색",
    "在庫チェック":"재고 확인",
    "チェック記録":"확인 기록",
    "全履歴を表示":"전체 이력 표시",
    "チェック以降を表示":"확인 이후 표시",
    "入力日時":"입력 일시",
    "在庫数":"작업 전 재고",
    "入荷":"입고",
    "出荷":"출고",
    "備品転用":"비품 전용",
    "備品転用確認":"비품 전용 확인",
    "区分検索":"구분 검색",
    "商品名検索":"상품명 검색",
    "担当者検索":"담당자 검색",
    "備考検索":"비고 검색",
    "全体履歴":"전체 이력",
    "履歴CSV":"이력 CSV",
    "全データCSV":"전체 데이터 CSV",
    "検索をクリア":"검색 초기화"
  }
};

const I18N_REVERSE = {};
for(const lang of Object.keys(I18N)){
  for(const [ja,ko] of Object.entries(I18N.ko)){
    I18N_REVERSE[ko]=ja;
  }
}

function getLang(){return localStorage.getItem("arico_lang")||"ja";}

function setLang(lang){
  localStorage.setItem("arico_lang",lang);
  applyLang();
}

function translateText(raw,lang){
  const t=String(raw||"").trim();
  const ja=I18N_REVERSE[t]||t;
  return I18N[lang][ja]||ja;
}

function walkTextNodes(root,lang){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      const parent=node.parentElement;
      if(!parent)return NodeFilter.FILTER_REJECT;
      if(["SCRIPT","STYLE","TEXTAREA","OPTION"].includes(parent.tagName))return NodeFilter.FILTER_REJECT;
      if(parent.closest(".table-wrap tbody"))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    const original=node.nodeValue;
    const trimmed=original.trim();
    if(!trimmed)return;
    const translated=translateText(trimmed,lang);
    if(translated!==trimmed){
      node.nodeValue=original.replace(trimmed,translated);
    }
  });
}

function applyPlaceholders(lang){
  const map={
    ja:{
      staffNameInput:"例：田中",
      barcodeInput:"バーコードをスキャン、または手入力",
      memo:"例：棚卸差異、サンプル使用、不良返品など",
      productBarcode:"バーコードを入力",
      productName:"商品名を必ず入力",
      location:"例：A-01",
      productHistoryBarcodeInput:"バーコードを入力またはスキャン"
    },
    ko:{
      staffNameInput:"예：다나카",
      barcodeInput:"바코드를 스캔하거나 직접 입력",
      memo:"예：재고 차이, 샘플 사용, 불량 반품 등",
      productBarcode:"바코드를 입력",
      productName:"상품명을 반드시 입력",
      location:"예：A-01",
      productHistoryBarcodeInput:"바코드를 입력 또는 스캔"
    }
  };
  const m=map[lang];
  Object.keys(m).forEach(id=>{
    const x=document.getElementById(id);
    if(x)x.placeholder=m[id];
  });
}

function applySelectLabels(lang){
  const labels=lang==="ko"
    ?{staff:"담당자를 선택"}
    :{staff:"担当者を選択"};
  const staff=document.getElementById("staff");
  if(staff&&staff.options.length)staff.options[0].textContent=labels.staff;
}

function applyLang(){
  const lang=getLang();
  walkTextNodes(document.body,lang);
  applyPlaceholders(lang);
  applySelectLabels(lang);

  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.classList.toggle("active",lang==="ja");
  if(ko)ko.classList.toggle("active",lang==="ko");
}

window.addEventListener("DOMContentLoaded",()=>{
  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.onclick=()=>setLang("ja");
  if(ko)ko.onclick=()=>setLang("ko");
  setTimeout(applyLang,50);
});


/* v51 language button fallback */
function bindLanguageButtons(){
  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.onclick=()=>setLang("ja");
  if(ko)ko.onclick=()=>setLang("ko");
  if(typeof applyLang==="function")applyLang();
}
window.addEventListener("load",bindLanguageButtons);
setTimeout(bindLanguageButtons,300);
