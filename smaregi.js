/* ARICO TOKYO inventory app: smaregi.js */

/* ===== v72 Smaregi stock check ===== */
let smaregiSnapshot=null;
let smaregiStockItems=[];
let smaregiStockChecks=[];
let smaregiCurrentEventStockByBarcode=new Map();
let smaregiEventStorageStockByBarcode=new Map();
const SMAREGI_DIFFERENCE_REASON_CATEGORIES=["入力ミス","出荷処理漏れ","入荷処理漏れ","商品転用","サンプル使用","商品持ち出し","返品処理漏れ","スマレジ登録ミス","棚違い","不明"];
let smaregiAutoRefreshTimer=null;
let smaregiAutoRefreshBusy=false;
let smaregiMutationBusy=false;
let smaregiReasonSummaryRows=[];

function parseSavedSmaregiStockNumber(value){
  if(value===null||value===undefined||String(value).trim()==="")return null;
  const number=Number(String(value).replace(/,/g,""));
  return Number.isFinite(number) ? number : null;
}

function getSavedSmaregiStockValue(item){
  const fields=[
    "smaregi_stock",
    "smaregi_stock_quantity",
    "stock_amount",
    "stock_quantity",
    "quantity_after",
    "store_stock",
    "在庫数"
  ];
  for(const field of fields){
    const value=parseSavedSmaregiStockNumber(item?.[field]);
    if(value!==null)return value;
  }
  const barcode=String(item?.barcode||item?.jan_code||item?.product_code||"").trim();
  const change=barcode&&smaregiLatestChangeByBarcode instanceof Map ? smaregiLatestChangeByBarcode.get(barcode) : null;
  for(const field of fields){
    const value=parseSavedSmaregiStockNumber(change?.[field]);
    if(value!==null)return value;
  }
  return null;
}

function getSavedSmaregiStockNumber(item,fallback=0){
  const value=getSavedSmaregiStockValue(item);
  return value===null ? fallback : value;
}

function getComparableSmaregiStockNumber(itemOrValue,fallback=0){
  const raw=typeof itemOrValue==="number" || typeof itemOrValue==="string"
    ? parseSavedSmaregiStockNumber(itemOrValue)
    : getSavedSmaregiStockValue(itemOrValue);
  const value=raw===null ? fallback : raw;
  return value<0 ? 0 : value;
}

window.getSavedSmaregiStockValue=getSavedSmaregiStockValue;
window.getSavedSmaregiStockNumber=getSavedSmaregiStockNumber;
window.getComparableSmaregiStockNumber=getComparableSmaregiStockNumber;

function getSmaregiCheck(barcode){
  const matches=(smaregiStockChecks||[]).filter(c=>String(c.barcode)===String(barcode));
  if(!matches.length)return null;
  return matches.sort((a,b)=>new Date(b.checked_at||0)-new Date(a.checked_at||0))[0];
}

function isSmaregiExcludedCheck(check){
  return check?.excluded===true
    || String(check?.excluded||"").toLowerCase()==="true"
    || String(check?.checked_by||"").startsWith("除外:");
}

function isSmaregiNoIssueCheck(check){
  if(!check)return false;
  const value=String(check.no_issue ?? "").trim().toLowerCase();
  return check.no_issue===true
    || check.no_issue===1
    || value==="true"
    || value==="1"
    || value==="yes"
    || Boolean(check.no_issue_at)
    || Boolean(String(check.no_issue_by||"").trim())
    || Boolean(String(check.no_issue_reason||"").trim());
}

function isSmaregiAutoNoIssueCheck(item,check=getSmaregiCheck(item?.barcode)){
  if(!item||!check||isSmaregiExcludedCheck(check)||isSmaregiNoIssueCheck(check))return false;
  const breakdown=getSmaregiInventoryBreakdown(item,check);
  return Number.isFinite(breakdown.comparisonStock)
    && Number.isFinite(breakdown.smaregiStock)
    && breakdown.difference===0;
}

function isSmaregiEffectiveNoIssueCheck(item,check=getSmaregiCheck(item?.barcode)){
  return isSmaregiNoIssueCheck(check)||isSmaregiAutoNoIssueCheck(item,check);
}

window.isSmaregiAutoNoIssueCheck=isSmaregiAutoNoIssueCheck;
window.isSmaregiEffectiveNoIssueCheck=isSmaregiEffectiveNoIssueCheck;

function getSmaregiDisplayCheckedBy(check){
  return String(check?.checked_by||"").replace(/^除外:/,"");
}

function getSmaregiSheetDifference(item){
  // 参考用：スマレジ在庫とシート在庫の差。棚卸差異の判定には使わない。
  return getSavedSmaregiStockNumber(item,0)-Number(getSmaregiAppStock(item.barcode)||0);
}

function getSmaregiActualDifference(item){
  const check=getSmaregiCheck(item.barcode);
  if(!check||isSmaregiExcludedCheck(check)||isSmaregiEffectiveNoIssueCheck(item,check))return null;
  if(check.actual_stock===null||check.actual_stock===undefined||String(check.actual_stock)==="")return null;

  return getSmaregiInventoryBreakdown(item,check).difference;
}

function calculateSmaregiDifference(smaregiStock,actualStock){
  const smaregi=getComparableSmaregiStockNumber(smaregiStock,0);
  const actual=Number(actualStock||0);
  // スマレジ在庫がマイナスでも現物が0なら、棚卸上は差異なしとして扱う。
  return actual-smaregi;
}

function getSmaregiCurrentStoreCode(){
  const context=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
  return String(context.storeCode||window.currentStore||"tokyo").trim()||"tokyo";
}

function buildSmaregiInFilter(values){
  return [...new Set((values||[]).map(value=>String(value||"").trim()).filter(Boolean))]
    .map(value=>value.replace(/[(),]/g,""))
    .filter(Boolean)
    .join(",");
}

function normalizeSmaregiStoreCodeForStorage(value){
  const text=String(value||"").trim();
  if(!text)return "";
  if(typeof getStoreCodeFromName==="function"){
    const fromName=getStoreCodeFromName(text);
    if(fromName)return fromName;
  }
  const lower=text.toLowerCase();
  if(lower==="tokyo"||lower==="東京"||lower==="tokyo店")return "tokyo";
  if(lower==="aichi"||lower==="愛知"||lower==="aichi店")return "aichi";
  if(lower==="nagano"||lower==="長野"||lower==="nagano店")return "nagano";
  return lower;
}

function addSmaregiMapValue(map,barcode,value){
  const key=String(barcode||"").trim();
  if(!key)return;
  map.set(key,Number(map.get(key)||0)+Number(value||0));
}

function getSmaregiCurrentEventStock(barcode){
  return Number(smaregiCurrentEventStockByBarcode.get(String(barcode||"").trim())||0);
}

function getSmaregiEventStorageStock(barcode){
  return Number(smaregiEventStorageStockByBarcode.get(String(barcode||"").trim())||0);
}

function getSmaregiEventShelfStock(barcode){
  return getSmaregiCurrentEventStock(barcode)+getSmaregiEventStorageStock(barcode);
}

function getSmaregiInventoryBreakdown(item,check=getSmaregiCheck(item?.barcode)){
  const actualStock=check&&check.actual_stock!==null&&check.actual_stock!==undefined&&String(check.actual_stock)!==""
    ? Number(check.actual_stock||0)
    : null;
  const currentEventStock=getSmaregiCurrentEventStock(item?.barcode);
  const eventStorageStock=getSmaregiEventStorageStock(item?.barcode);
  const eventShelfStock=currentEventStock+eventStorageStock;
  const comparisonStock=actualStock===null ? null : actualStock+eventShelfStock;
  const smaregiStock=getSavedSmaregiStockNumber(item,0);
  const difference=comparisonStock===null ? null : calculateSmaregiDifference(smaregiStock,comparisonStock);
  return {
    actualStock,
    currentEventStock,
    eventStorageStock,
    eventShelfStock,
    comparisonStock,
    smaregiStock,
    difference
  };
}

async function loadSmaregiEventInventoryCache(barcodes=[]){
  smaregiCurrentEventStockByBarcode=new Map();
  smaregiEventStorageStockByBarcode=new Map();
  const uniqueBarcodes=[...new Set((barcodes||[]).map(value=>String(value||"").trim()).filter(Boolean))];
  if(!uniqueBarcodes.length)return;

  const barcodeFilter=buildSmaregiInFilter(uniqueBarcodes);
  if(!barcodeFilter)return;

  const storeCode=normalizeSmaregiStoreCodeForStorage(getSmaregiCurrentStoreCode());
  const openEvents=await sbAll(`booth_events?select=id,status,store_code&status=neq.closed&store_code=eq.${encodeURIComponent(storeCode)}`,1000,20000);
  const openEventIds=Array.isArray(openEvents)
    ? openEvents.map(event=>String(event.id||"").trim()).filter(Boolean)
    : [];
  const eventItemStorageStockByBarcode=new Map();
  if(openEventIds.length){
    const eventFilter=buildSmaregiInFilter(openEventIds);
    const [eventItems,departureLogs]=await Promise.all([
      sbAll(`booth_event_items?select=event_id,barcode,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,event_storage_qty,consumed_qty&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&item_type=eq.normal`,1000,50000),
      sbAll(`booth_stock_movements?select=event_id,barcode,movement_type&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&movement_type=in.(departure_count,take_out,event_pick)&item_type=eq.normal`,1000,50000).catch(()=>[])
    ]);
    const confirmedDepartureKeys=new Set((Array.isArray(departureLogs)?departureLogs:[]).map(row=>`${row.event_id}::${row.barcode}`));
    (Array.isArray(eventItems)?eventItems:[]).forEach(row=>{
      if(String(row.item_type||"normal")!=="normal")return;
      const hasEventQuantity=Number(row.taken_qty||0)>0
        || Number(row.normal_takeout_qty||0)>0
        || Number(row.storage_takeout_qty||0)>0
        || Number(row.event_storage_qty||0)>0;
      if(!hasEventQuantity && !confirmedDepartureKeys.has(`${row.event_id}::${row.barcode}`))return;
      const qty=Number(row.taken_qty||0)
        -Number(row.sold_qty||0)
        -Number(row.returned_qty||0)
        -Number(row.event_storage_qty||0)
        -Number(row.consumed_qty||0);
      addSmaregiMapValue(smaregiCurrentEventStockByBarcode,row.barcode,qty);
      addSmaregiMapValue(eventItemStorageStockByBarcode,row.barcode,row.event_storage_qty);
    });
  }

  const storageRows=await sbAll(`event_storage_stocks?select=store_code,barcode,storage_qty&barcode=in.(${barcodeFilter})`,1000,50000);
  (Array.isArray(storageRows)?storageRows:[]).forEach(row=>{
    const rowStore=normalizeSmaregiStoreCodeForStorage(row.store_code);
    if(rowStore!==storeCode)return;
    addSmaregiMapValue(smaregiEventStorageStockByBarcode,row.barcode,row.storage_qty);
  });
  eventItemStorageStockByBarcode.forEach((qty,barcode)=>{
    const current=Number(smaregiEventStorageStockByBarcode.get(barcode)||0);
    if(Number(qty||0)>current)smaregiEventStorageStockByBarcode.set(barcode,Number(qty||0));
  });
}

function getSmaregiDifference(item){
  return getSmaregiActualDifference(item);
}

function getSmaregiDiffItems(){
  const keyword=String(el("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
  return smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    if(!check||isSmaregiExcludedCheck(check))return false;
    if(isSmaregiEffectiveNoIssueCheck(item,check))return false;
    if(keyword&&!String(item.product_name||"").toLowerCase().includes(keyword))return false;
    const stockBreakdown=getSmaregiInventoryBreakdown(item,check);
    const difference=stockBreakdown.difference;
    return difference!==null&&difference!==0;
  });
}

function scrollToSmaregiDiffPanel(){
  const panel=el("smaregiDiffOnlyPanel");
  if(panel)panel.scrollIntoView({behavior:"smooth",block:"start"});
}

function getSmaregiAppStock(barcode){
  const product=gp(barcode);
  if(!product)return "";
  return Number(product.base_stock||0)+getSmaregiEventShelfStock(barcode);
}

function getSmaregiCheckerName(){
  return String(el("smaregiCheckerName")?.value||"").trim();
}

function getSmaregiItemGroup(item){
  const product=gp(item.barcode)||{};
  return String(
    item.category||item.genre||item.department||item.location||
    product.category||product.genre||product.department||product.location||
    "未分類"
  ).trim()||"未分類";
}

function isSmaregiManager(){
  return typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
}

function updateSmaregiManagerControls(){
  const manager=isSmaregiManager();
  const settingsAccess=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
  const analyticsActive=document.body.dataset.inventoryScreen==="analytics";
  const sync=el("syncSmaregiStockBtn");
  const complete=el("completeSmaregiStockCheckBtn");
  const reset=el("resetSmaregiCompletionBtn");
  if(sync){
    sync.disabled=!settingsAccess;
    sync.hidden=!settingsAccess;
    sync.classList.add("smaregi-manager-control");
  }
  if(complete){
    complete.disabled=!manager;
    complete.hidden=!manager;
    complete.classList.add("smaregi-manager-control");
    complete.textContent="今回のチェックを完了";
  }
  const diffPanel=el("smaregiDiffOnlyPanel");
  if(diffPanel)diffPanel.hidden=!(manager&&analyticsActive);
  const reasonSummaryPanel=el("smaregiReasonSummaryPanel");
  if(reasonSummaryPanel)reasonSummaryPanel.hidden=!(manager&&analyticsActive);
  if(reset){
    reset.disabled=!manager;
    reset.hidden=!manager;
    reset.classList.add("smaregi-manager-control");
    reset.textContent="チェック完了解除";
  }
  const resetPanel=el("resetSmaregiCompletionBtn")?.closest(".smaregi-reset-panel");
  if(resetPanel)resetPanel.hidden=!manager;
}

function formatDateTimeLocal(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  const pad=n=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getSmaregiStats(){
  const total=smaregiStockItems.length;
  const excluded=smaregiStockItems.filter(item=>isSmaregiExcludedCheck(getSmaregiCheck(item.barcode))).length;
  const completed=smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    return isSmaregiExcludedCheck(check)
      || (check?.actual_stock!==null&&check?.actual_stock!==undefined&&String(check.actual_stock)!=="");
  }).length;
  const unchecked=Math.max(0,total-completed);
  const diffCount=getSmaregiDiffItems().length;
  const targetTotal=total;
  const percent=total>0?Math.round((completed/total)*100):0;
  return {total,completed,unchecked,excluded,diffCount,targetTotal,percent};
}

function getSmaregiStatsText(){
  const stats=getSmaregiStats();
  return `完了：${stats.completed} / ${stats.targetTotal}（${stats.percent}%） / 未入力：${stats.unchecked} / 除外：${stats.excluded}`;
}

function getSmaregiProgressHtml(){
  const stats=getSmaregiStats();
  const checker=getSmaregiCheckerName()||"未選択";
  return `
    <div class="smaregi-progress-card-inner">
      <div class="smaregi-progress-checker">チェック担当者：<strong>${esc(checker)}</strong></div>
      <div class="smaregi-progress-main">チェック済み <span>${stats.completed} / ${stats.total}</span></div>
      <div class="smaregi-progress-sub">除外 ${stats.excluded}　残り ${stats.unchecked}件</div>
      <div class="smaregi-progress-area">
        <div id="smaregiProgressGraph" class="smaregi-progress-graph" role="progressbar" aria-label="棚卸進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.percent}">
          <div id="smaregiProgressFill" class="smaregi-progress-fill" style="width:${stats.percent}%"></div>
        </div>
        <div id="smaregiProgressText" class="smaregi-progress-text">進捗 ${stats.percent}%</div>
      </div>
    </div>`;
}

function updateSmaregiProgressGraph(){
  const stats=getSmaregiStats();
  const graph=el("smaregiProgressGraph");
  const fill=el("smaregiProgressFill");
  const text=el("smaregiProgressText");
  if(graph)graph.setAttribute("aria-valuenow",String(stats.percent));
  if(fill)fill.style.width=`${stats.percent}%`;
  if(text)text.textContent=`進捗 ${stats.percent}%`;
}

function getFocusedSmaregiInputState(){
  const active=document.activeElement;
  if(active&&active.classList&&(active.classList.contains("smaregi-row-actual-input")||active.classList.contains("smaregi-diff-actual-input"))){
    return {barcode:String(active.dataset.barcode||""),value:active.value,selectionStart:active.selectionStart,selectionEnd:active.selectionEnd,inputClass:active.classList.contains("smaregi-diff-actual-input")?"smaregi-diff-actual-input":"smaregi-row-actual-input"};
  }
  return null;
}

function restoreFocusedSmaregiInputState(state){
  if(!state||!state.barcode)return;
  const input=[...document.querySelectorAll(`.${state.inputClass||"smaregi-row-actual-input"}`)].find(el=>String(el.dataset.barcode||"")===String(state.barcode));
  if(!input)return;
  input.value=state.value;
  input.focus();
  try{input.setSelectionRange(state.selectionStart??state.value.length,state.selectionEnd??state.value.length);}catch(_){}
}

function renderSmaregiStockChecks(){
  const body=el("smaregiStockCheckBody");
  const badge=el("smaregiSnapshotBadge");
  if(!body)return;

  if(badge){
    badge.textContent=smaregiSnapshot
      ? `最終取得日時：${fmt(smaregiSnapshot.imported_at)}${smaregiSnapshot.range_from ? ` / 変動抽出：${fmt(smaregiSnapshot.range_from)} 以降` : ""}`
      : "未取得";
  }
  const progress=el("smaregiProgressBadge");
  if(progress)progress.innerHTML=getSmaregiProgressHtml();
  updateSmaregiProgressGraph();
  updateSmaregiManagerControls();
  const resetInput=el("resetSmaregiCompletedAtInput");
  if(resetInput&&smaregiSnapshot?.completed_at&&!resetInput.value){
    resetInput.value=formatDateTimeLocal(smaregiSnapshot.completed_at);
  }

  const keyword=String(el("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
  const visible=smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    if(check)return false;
    return !keyword || String(item.product_name||"").toLowerCase().includes(keyword);
  }).sort((a,b)=>{
    const groupCompare=getSmaregiItemGroup(a).localeCompare(getSmaregiItemGroup(b),"ja");
    if(groupCompare)return groupCompare;
    return String(a.product_name||"").localeCompare(String(b.product_name||""),"ja");
  });

  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="5" class="smaregi-empty">「スマレジデータ取り込み」で最新データを表示してください。</td></tr>';
    renderSmaregiDiffOnlyPanel();
    return;
  }

  if(!visible.length){
    body.innerHTML='<tr><td colspan="5" class="smaregi-empty">表示する商品がありません。</td></tr>';
    renderSmaregiDiffOnlyPanel();
    return;
  }

  let lastGroup="";
  body.innerHTML=visible.map(item=>{
    const check=getSmaregiCheck(item.barcode);
    const excluded=isSmaregiExcludedCheck(check);
    const actualDifference=getSmaregiActualDifference(item);
    const status="未チェック";
    const statusClass="";
    const group=getSmaregiItemGroup(item);
    const heading=group!==lastGroup ? `<tr class="smaregi-group-row"><td colspan="5">【${esc(group)}】</td></tr>` : "";
    lastGroup=group;
    return `${heading}<tr class="smaregi-product-row">
      <td><span class="smaregi-status${statusClass}">${status}</span></td>
      <td class="smaregi-product-name-cell"><strong>${esc(item.product_name||"")}</strong>${getSmaregiMovementSummaryHtml(item)}</td>
      <td><input type="number" class="smaregi-row-actual-input" data-barcode="${esc(item.barcode)}" min="0" step="1" inputmode="numeric" value="${excluded ? "" : (check?.actual_stock??"")}" placeholder="手入力" ${excluded?"disabled":""}/></td>
      <td><button type="button" class="smaregi-row-save-btn" data-barcode="${esc(item.barcode)}" ${excluded?"disabled":""}>${check&&!excluded?"更新":"保存"}</button></td>
      <td class="smaregi-row-actions">
        ${isSmaregiManager()&&actualDifference!==null&&actualDifference!==0&&!excluded ? `<button type="button" class="secondary smaregi-cause-btn" data-barcode="${esc(item.barcode)}">原因確認</button>` : ""}
        ${isSmaregiManager() ? (excluded ? `<button type="button" class="secondary smaregi-clear-btn" data-barcode="${esc(item.barcode)}">除外解除</button>` : `<button type="button" class="secondary smaregi-exclude-btn" data-barcode="${esc(item.barcode)}">除外</button>`) : ""}
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".smaregi-row-save-btn").forEach(button=>{
    button.onclick=()=>handleSmaregiRowSave(button);
  });
  body.querySelectorAll(".smaregi-row-actual-input").forEach(input=>{
    input.onkeydown=e=>{
      if(e.key!=="Enter")return;
      e.preventDefault();
      const button=input.closest("tr")?.querySelector(".smaregi-row-save-btn");
      if(button&&!button.disabled)handleSmaregiRowSave(button);
    };
  });
  body.querySelectorAll(".smaregi-exclude-btn").forEach(button=>{
    button.onclick=()=>runWithSmaregiAutoRefreshPaused(
      ()=>excludeSmaregiStockItem(button.dataset.barcode),
      {button}
    );
  });
  body.querySelectorAll(".smaregi-clear-btn").forEach(button=>{
    button.onclick=()=>runWithSmaregiAutoRefreshPaused(
      ()=>clearSmaregiStockCheck(button.dataset.barcode),
      {button}
    );
  });
  body.querySelectorAll(".smaregi-cause-btn").forEach(button=>{
    button.onclick=()=>showSmaregiCauseDetail(button.dataset.barcode);
  });
  renderSmaregiDiffOnlyPanel();
}

function renderSmaregiDiffOnlyPanel(){
  const panel=el("smaregiDiffOnlyPanel");
  const body=el("smaregiDiffOnlyBody");
  const summary=el("smaregiDiffSummary");
  if(!panel||!body)return;

  if(!isSmaregiManager()){
    panel.hidden=true;
    body.innerHTML="";
    if(summary)summary.textContent="";
    return;
  }

  const diffItems=getSmaregiDiffItems();
  const stats=getSmaregiStats();
  const checkedCount=stats.completed;
  if(summary)summary.textContent=`差異：${diffItems.length}件 / 完了：${stats.completed}件 / 未入力：${stats.unchecked}件 / 除外：${stats.excluded}件`;

  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="7" class="smaregi-empty">スマレジデータ取り込みを実行してください。</td></tr>';
    return;
  }

  if(!diffItems.length){
    body.innerHTML='<tr><td colspan="7" class="smaregi-empty">差異のある商品はありません。</td></tr>';
    console.log("[Smaregi Diff List Rendered]",{diffCount:0,totalCheckedCount:checkedCount});
    return;
  }

  body.innerHTML=diffItems.map(item=>{
    const check=getSmaregiCheck(item.barcode);
    const stockBreakdown=getSmaregiInventoryBreakdown(item,check);
    const difference=stockBreakdown.difference;
    const differenceClass=difference<0 ? " is-negative" : " is-positive";
    return `<tr>
      <td>${esc(item.product_name||"")}</td>
      <td><input type="number" class="smaregi-diff-actual-input" data-barcode="${esc(item.barcode)}" min="0" step="1" inputmode="numeric" value="${esc(check?.actual_stock??"")}"/>${check?.actual_corrected===true?'<span class="smaregi-corrected-badge">修正済</span>':""}</td>
      <td>${stockBreakdown.eventShelfStock}</td>
      <td>${stockBreakdown.comparisonStock}</td>
      <td>${stockBreakdown.smaregiStock}</td>
      <td><span class="smaregi-difference${differenceClass}">${difference}</span></td>
      <td>${esc(getSmaregiDisplayCheckedBy(check))}</td>
      <td>${check?.checked_at ? fmt(check.checked_at) : ""}</td>
      <td><div class="diff-action-group"><button type="button" class="secondary smaregi-diff-cause-btn" data-barcode="${esc(item.barcode)}">原因確認</button><button type="button" class="smaregi-diff-save-btn" data-barcode="${esc(item.barcode)}">保存</button><button type="button" class="secondary smaregi-no-issue-btn" data-barcode="${esc(item.barcode)}">問題なし</button>${check?.difference_reason_category?`<small class="smaregi-reason-note" title="${esc(check.difference_reason_memo||"")}">${esc(check.difference_reason_category)}</small>`:""}</div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll(".smaregi-diff-save-btn").forEach(button=>{
    button.onclick=()=>handleSmaregiDiffSave(button);
  });
  body.querySelectorAll(".smaregi-no-issue-btn").forEach(button=>{
    button.onclick=()=>markSmaregiDifferenceNoIssue(button.dataset.barcode,button);
  });
  body.querySelectorAll(".smaregi-diff-cause-btn").forEach(button=>{
    button.onclick=()=>showSmaregiCauseDetail(button.dataset.barcode);
  });
  body.querySelectorAll(".smaregi-diff-actual-input").forEach(input=>{
    input.addEventListener("keydown",event=>{
      if(event.key!=="Enter")return;
      event.preventDefault();
      input.closest("tr")?.querySelector(".smaregi-diff-save-btn")?.click();
    });
  });
  console.log("[Smaregi Diff List Rendered]",{diffCount:diffItems.length,totalCheckedCount:checkedCount});
}

function showSmaregiDiffOnlyPanel(){
  if(!isSmaregiManager()){
    showMessage("差異一覧は分析画面のパスワード認証後に確認できます。","err");
    return;
  }
  const panel=el("smaregiDiffOnlyPanel");
  if(!panel)return;
  panel.hidden=false;
  renderSmaregiDiffOnlyPanel();
  scrollToSmaregiDiffPanel();
  showMessage("今回の差異一覧を表示しました。","ok");
}

async function handleSmaregiRowSave(button){
  const barcode=String(button.dataset.barcode||"");
  const value=button.closest("tr")?.querySelector(".smaregi-row-actual-input")?.value;
  const saved=await runWithSmaregiAutoRefreshPaused(
    ()=>saveSmaregiActualStock(barcode,value),
    {button}
  );
  if(!saved)renderSmaregiStockChecks();
}

async function handleSmaregiDiffSave(button){
  if(!isSmaregiManager()){
    showMessage("差異一覧の数量修正はパスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  const barcode=String(button.dataset.barcode||"");
  const value=button.closest("tr")?.querySelector(".smaregi-diff-actual-input")?.value;
  const saved=await runWithSmaregiAutoRefreshPaused(
    ()=>saveSmaregiActualStock(barcode,value,{markCorrected:true}),
    {button}
  );
  if(!saved)renderSmaregiDiffOnlyPanel();
}

async function markSmaregiDifferenceNoIssue(barcode,button=null){
  if(!isSmaregiManager()){
    showMessage("差異の問題なし処理はパスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  if(!smaregiSnapshot||!confirm("この差異を問題なしとして処理しますか？"))return;
  await runWithSmaregiAutoRefreshPaused(async()=>{
   const checkedBy=getSmaregiCheckerName();
   const no_issue_at=new Date().toISOString();
   try{
    await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({no_issue:true,no_issue_by:checkedBy,no_issue_at,no_issue_reason:""})
    });
    smaregiStockChecks.forEach(check=>{
      if(String(check.barcode)===String(barcode)){
        check.no_issue=true;
        check.no_issue_by=checkedBy;
        check.no_issue_at=no_issue_at;
        check.no_issue_reason="";
      }
    });
    renderSmaregiStockChecks();
    showMessage("差異を問題なしとして処理しました。","ok");
  }catch(e){
    showMessage("問題なし処理エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
  },{button});
}

async function loadLatestSmaregiSnapshot(){
  try{
    showMessage("スマレジ在庫変動データを取得中...");
    const snapshots=await sb("smaregi_stock_snapshots?select=*&order=imported_at.desc&limit=1");
    smaregiSnapshot=Array.isArray(snapshots)&&snapshots.length ? snapshots[0] : null;
    const resetInput=el("resetSmaregiCompletedAtInput");
    if(resetInput)resetInput.value=smaregiSnapshot?.completed_at ? formatDateTimeLocal(smaregiSnapshot.completed_at) : "";
    smaregiStockItems=[];
    smaregiStockChecks=[];

    if(smaregiSnapshot){
      const snapshotId=encodeURIComponent(smaregiSnapshot.id);
      smaregiStockItems=await sbAll(`smaregi_stock_items?select=*&snapshot_id=eq.${snapshotId}&order=product_name.asc`,1000,20000);
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
      await loadSmaregiEventInventoryCache(smaregiStockItems.map(item=>item.barcode));
    }else{
      smaregiCurrentEventStockByBarcode=new Map();
      smaregiEventStorageStockByBarcode=new Map();
    }

    renderSmaregiStockChecks();
    showMessage(smaregiSnapshot
      ? `スマレジ在庫変動データを取得しました：${smaregiStockItems.length}件`
      : "スマレジ在庫変動データはまだありません。在庫変動CSVを取り込んでください。",smaregiSnapshot?"ok":"");
  }catch(e){
    showMessage("スマレジ在庫変動データ取得エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
}

async function syncSmaregiStockFromApi(){
  showCsvOperationMessage("現在はCSV運用中です。スマレジAPIには接続しません。スマレジ在庫変動CSVを選択してください。");
  const csvInput=el("smaregiStockCsvFile");
  if(csvInput){
    csvInput.value="";
    csvInput.click();
  }
  return;
  if(!(typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess())){
    showMessage("スマレジ変動商品データ取り込みは設定画面のパスワード認証後に操作できます。","err");
    return;
  }
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "スマレジ変動商品チェック確認",
      typeof getSmaregiOperationContextText==="function"
        ? getSmaregiOperationContextText("前回チェック以降の変動商品を取得します。")
        : "前回チェック以降の変動商品を取得します。",
      {okText:"取込"}
    );
    if(!ok)return;
  }

  try{
    showMessage("スマレジデータを取り込み中...");
    const smaregiContext=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
    console.log("[Smaregi stock sync] context",smaregiContext);
    const res=await fetch("about:blank",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(smaregiContext)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`APIエラー ${res.status}`);
    await loadLatestSmaregiSnapshot();
    showPopup("スマレジデータ取り込み完了",`前回チェック以降の変動商品を取得しました。\n対象商品：${Number(data.item_count||0)}件\n変動履歴：${Number(data.change_count||0)}件${data.warning ? `\n\n注意：${data.warning}` : ""}`);
  }catch(e){
    showMessage("スマレジデータ取り込みエラー。\n"+e.message,"err");
  }
}

async function applySmaregiActualStocksToSheet(completedBy){
  const targets=smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    return check
      && !isSmaregiExcludedCheck(check)
      && !isSmaregiNoIssueCheck(check)
      && check.actual_corrected===true
      && check.actual_stock!==null
      && check.actual_stock!==undefined
      && String(check.actual_stock)!=="";
  });

  for(const item of targets){
    const barcode=String(item.barcode||"");
    const check=getSmaregiCheck(barcode);
    const actual_stock=Number(check.actual_stock||0);
    if(!Number.isFinite(actual_stock)||actual_stock<0)continue;

    const product=await fetchProductByBarcode(barcode);
    const beforeStock=Number(product?.base_stock||0);
    if(beforeStock===actual_stock)continue;

    await sb("inventory_logs",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        type:"在庫修正",
        staff:completedBy,
        barcode,
        product_name:item.product_name||product?.name||"",
        quantity:actual_stock,
        memo:`スマレジ変動商品チェック完了時に実在庫反映（前在庫 ${beforeStock}）`
      })
    });

    await updateProductCurrentStock(barcode,actual_stock);
  }

  console.log("[Smaregi Actual Stocks Applied]",{
    appliedBy:completedBy,
    targetCount:targets.length
  });

  return targets.length;
}

async function completeSmaregiStockCheck(){
  if(!isSmaregiManager()){
    showMessage("パスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  if(!smaregiSnapshot){
    showMessage("完了するスマレジ在庫チェックがありません。","err");
    return;
  }
  const stats=getSmaregiStats();
  const warning=stats.unchecked>0?`\n\n未入力商品が${stats.unchecked}件あります。\n本当にチェック完了しますか？`:"";
  const message=[
    `チェック対象　${stats.targetTotal}件`,
    `完了　　　　${stats.completed}件`,
    `未入力　　　${stats.unchecked}件`,
    `除外　　　　${stats.excluded}件`,
    "",
    "チェック完了後、差異一覧で明示的に修正保存した実在庫のみシート在庫へ反映します。",
    "このままチェック完了しますか？",
    warning
  ].join("\n");
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "チェック完了確認",
      typeof getSmaregiOperationContextText==="function"
        ? getSmaregiOperationContextText(message)
        : message,
      {okText:"完了"}
    );
    if(!ok)return;
  }else if(!confirm(message))return;
  try{
    const completedBy=getSmaregiCheckerName();
    if(typeof enforceStaffStoreMatch==="function"&&!enforceStaffStoreMatch(completedBy,"店舗確認エラー","smaregiCheckerName")){
      return;
    }
    const appliedCount=await applySmaregiActualStocksToSheet(completedBy);
    const completed_at=new Date().toISOString();
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return:minimal"},
      body:JSON.stringify({completed_at})
    });
    smaregiSnapshot.completed_at=completed_at;
    renderSmaregiStockChecks();
    console.log("[Smaregi Check Completed]",{
      completedBy,
      completedAt:completed_at,
      appliedCount,
      stats
    });
    showPopup("チェック完了",`今回のチェックを完了しました。\nシート在庫へ反映：${appliedCount}件\n差異がある商品は今回の差異一覧で確認できます。`);
    showMessage(`今回のチェックを完了しました。シート在庫へ反映：${appliedCount}件`,"ok");
    showSmaregiDiffOnlyPanel();
  }catch(e){
    showMessage("チェック完了保存エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
}

async function resetSmaregiStockCheckCompletion(){
  if(!isSmaregiManager()){
    showMessage("パスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  if(!smaregiSnapshot){
    showMessage("戻すスマレジ在庫チェックがありません。","err");
    return;
  }
  const input=el("resetSmaregiCompletedAtInput");
  const selected=String(input?.value||"").trim();
  if(!selected){
    showMessage("戻す日時を選択してください。","err");
    input?.focus();
    return;
  }
  const date=new Date(selected);
  if(Number.isNaN(date.getTime())){
    showMessage("戻す日時を正しく選択してください。","err");
    input?.focus();
    return;
  }
  if(!confirm("チェック完了日時を選択した日時に戻します。よろしいですか？"))return;
  try{
    const resetTo=date.toISOString();
    await sb(`smaregi_stock_snapshots?completed_at=gt.${encodeURIComponent(resetTo)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at:null})
    });
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at:resetTo})
    });
    smaregiSnapshot.completed_at=resetTo;
    renderSmaregiStockChecks();
    console.log("[Smaregi Check Completion Reset]",{
      resetBy:getSmaregiCheckerName(),
      resetTo
    });
    showPopup("チェック完了解除","チェック完了日時を選択した日時に戻しました。");
    showMessage("チェック完了を解除しました。","ok");
  }catch(e){
    showMessage("チェック完了解除エラー。\n"+e.message,"err");
  }
}

async function saveSmaregiActualStock(barcode,value,{markCorrected=false}={}){
  if(!smaregiSnapshot)return false;
  if(!String(barcode||"").trim()){
    showMessage("対象商品が見つかりません。","err");
    return false;
  }
  const valueText=String(value ?? "").trim();
  if(valueText===""){
    showMessage("実在庫を入力してください。0の場合は 0 と入力してください。","err");
    return false;
  }

  if(!/^\d+$/.test(valueText)){
    showMessage("実在庫は0以上の整数で入力してください。","err");
    return false;
  }

  const actual_stock=parseInt(valueText,10);
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item || !Number.isInteger(actual_stock) || actual_stock<0){
    showMessage("実在庫は0以上の整数で入力してください。","err");
    return false;
  }

  try{
    const previousCheck=getSmaregiCheck(barcode);
    const isUpdate=!!previousCheck;
    const comparison_stock=actual_stock+getSmaregiCurrentEventStock(item.barcode)+getSmaregiEventStorageStock(item.barcode);
    const difference=calculateSmaregiDifference(getSavedSmaregiStockNumber(item,0),comparison_stock);
    const checked_by=getSmaregiCheckerName();
    if(!checked_by){
      showMessage("担当者を選択してください","err");
      el("smaregiCheckerName")?.focus();
      return false;
    }
    if(typeof enforceStaffStoreMatch==="function"&&!enforceStaffStoreMatch(checked_by,"店舗確認エラー","smaregiCheckerName")){
      return false;
    }
    if(typeof confirmAppAction==="function"){
      const ok=await confirmAppAction(
        "実在庫保存確認",
        typeof getSmaregiOperationContextText==="function"
          ? getSmaregiOperationContextText(`商品：${item.product_name||barcode}\n棚番：${getProductShelfLabel(gp(barcode)||{location:item.location||""})}\nバーコード：${barcode}\n実在庫：${actual_stock}`)
          : `商品：${item.product_name||barcode}\n実在庫：${actual_stock}`,
        {okText:"保存"}
      );
      if(!ok)return false;
    }
    const checked_at=new Date().toISOString();
    const correctedNow=markCorrected||isUpdate;
    const payload={
      snapshot_id:smaregiSnapshot.id,
      barcode,
      actual_stock,
      difference,
      checked_by,
      checked_at,
      excluded:false,
      no_issue:isSmaregiNoIssueCheck(previousCheck),
      no_issue_by:previousCheck?.no_issue_by||null,
      no_issue_at:previousCheck?.no_issue_at||null,
      no_issue_reason:previousCheck?.no_issue_reason||"",
      difference_reason_category:previousCheck?.difference_reason_category||null,
      difference_reason_memo:previousCheck?.difference_reason_memo||"",
      difference_reason_by:previousCheck?.difference_reason_by||null,
      difference_reason_at:previousCheck?.difference_reason_at||null,
      actual_corrected:correctedNow||previousCheck?.actual_corrected===true,
      actual_corrected_by:correctedNow ? checked_by : (previousCheck?.actual_corrected_by||null),
      actual_corrected_at:correctedNow ? checked_at : (previousCheck?.actual_corrected_at||null)
    };

    // 保存済みの実在庫も確実に更新できるよう、同じ snapshot_id + barcode の旧チェックを削除してから登録します。
    // unique 制約が無いSupabase環境でも、古い実在庫が残って表示される問題を防ぎます。
    await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
      method:"DELETE",
      headers:{Prefer:"return=minimal"}
    });

    const savedRows=await sb("smaregi_stock_checks",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([payload])
    });

    const savedRow=Array.isArray(savedRows)&&savedRows[0] ? savedRows[0] : payload;
    const next={...savedRow,snapshot_id:smaregiSnapshot.id,barcode,actual_stock,difference,checked_by,checked_at};
    smaregiStockChecks=smaregiStockChecks.filter(c=>String(c.barcode)!==String(barcode));
    smaregiStockChecks.push(next);
    renderSmaregiStockChecks();
    console.log("[Smaregi Row Check Saved]",{
      barcode,
      productName:item.product_name||"",
      actualStock:actual_stock,
      smaregiStock:getSavedSmaregiStockNumber(item,0),
      appStock:getSmaregiAppStock(barcode),
      difference,
      checkedBy:checked_by
    });
    showMessage(`実在庫を${isUpdate?"更新":"保存"}しました：${item.product_name||barcode}`,"ok");
    return true;
  }catch(e){
    showMessage("実在庫保存エラー。\n"+e.message,"err");
    return false;
  }
}

async function excludeSmaregiStockItem(barcode){
  if(!isSmaregiManager()){
    showMessage("除外はパスワード認証済みの管理者のみ操作できます。","err");
    return false;
  }
  if(!smaregiSnapshot)return false;
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item){
    showMessage("対象商品が見つかりません。","err");
    return false;
  }
  const checked_by=getSmaregiCheckerName();
  if(!checked_by){
    showMessage("除外する担当者を選択してください。","err");
    el("smaregiCheckerName")?.focus();
    return false;
  }
  if(!confirm(`${item.product_name||barcode} を今回のチェック対象から除外しますか？`))return false;
  try{
    const checked_at=new Date().toISOString();
    const old=getSmaregiCheck(barcode);
    const hasExistingActualStock=old?.actual_stock!==null&&old?.actual_stock!==undefined&&String(old.actual_stock)!=="";
    const actual_stock=hasExistingActualStock ? Number(old.actual_stock) : 0;
    const difference=hasExistingActualStock&&old?.difference!==null&&old?.difference!==undefined
      ? Number(old.difference)
      : 0;
    const next={
      snapshot_id:smaregiSnapshot.id,
      barcode,
      actual_stock:Number.isFinite(actual_stock) ? actual_stock : 0,
      difference:Number.isFinite(difference) ? difference : 0,
      checked_by:`除外:${checked_by}`,
      checked_at,
      excluded:true,
      no_issue:isSmaregiNoIssueCheck(old),
      no_issue_by:old?.no_issue_by||null,
      no_issue_at:old?.no_issue_at||null,
      no_issue_reason:old?.no_issue_reason||"",
      difference_reason_category:old?.difference_reason_category||null,
      difference_reason_memo:old?.difference_reason_memo||"",
      difference_reason_by:old?.difference_reason_by||null,
      difference_reason_at:old?.difference_reason_at||null,
      actual_corrected:old?.actual_corrected===true,
      actual_corrected_by:old?.actual_corrected_by||null,
      actual_corrected_at:old?.actual_corrected_at||null
    };
    await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
      method:"DELETE",
      headers:{Prefer:"return:minimal"}
    });
    await sb("smaregi_stock_checks",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([next])
    });
    smaregiStockChecks=smaregiStockChecks.filter(c=>String(c.barcode)!==String(barcode));
    smaregiStockChecks.push(next);
    renderSmaregiStockChecks();
    console.log("[Smaregi Row Excluded]",{barcode,productName:item.product_name||"",excludedBy:checked_by});
    showMessage(`除外しました：${item.product_name||barcode} / 担当者：${checked_by}`,"ok");
    return true;
  }catch(e){
    showMessage("除外保存エラー。\n"+e.message,"err");
    return false;
  }
}

async function clearSmaregiStockCheck(barcode){
  if(!isSmaregiManager()){
    showMessage("除外解除はパスワード認証済みの管理者のみ操作できます。","err");
    return false;
  }
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item||!smaregiSnapshot)return;
  if(!confirm(`${item.product_name||barcode} のチェック済み状態を解除しますか？`))return;
  try{
    const old=getSmaregiCheck(barcode);
    const hasActualStock=old?.actual_stock!==null&&old?.actual_stock!==undefined&&String(old.actual_stock)!=="";
    if(hasActualStock){
      const checked_by=getSmaregiDisplayCheckedBy(old);
      await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({checked_by,excluded:false})
      });
      if(old){
        old.checked_by=checked_by;
        old.excluded=false;
      }
    }else{
      await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      smaregiStockChecks=smaregiStockChecks.filter(check=>String(check.barcode)!==String(barcode));
    }
    renderSmaregiStockChecks();
    showMessage(`チェックを解除しました：${item.product_name||barcode}`,"ok");
  }catch(e){
    showMessage("チェック解除エラー。\n"+e.message,"err");
  }
}

async function openHistoryFromSmaregi(barcode){
  const input=el("productHistoryBarcodeInput");
  if(input)input.value=barcode;
  showInventoryProductHistory();
  await showProductHistoryForBarcode(barcode);
  el("productHistoryCard")?.scrollIntoView({behavior:"smooth",block:"start"});
}

function getSmaregiCsvStatus(check,difference,item=null){
  if(!check)return "未チェック";
  if(isSmaregiExcludedCheck(check))return "除外";
  if(isSmaregiEffectiveNoIssueCheck(item,check)||difference===0)return "問題なし";
  if(check.actual_corrected===true)return "修正済";
  return "チェック済み";
}

function smaregiCsvRows(differenceOnly=false){
  const rows=[["商品コード","商品名","スマレジ在庫数","シート在庫数","実在庫数","スマレジ差異","担当者","チェック日時","チェック済み状態","原因カテゴリ","原因メモ","原因記入者","原因記入日時"]];
  smaregiStockItems.forEach(item=>{
    const check=getSmaregiCheck(item.barcode);
    const difference=check ? getSmaregiDifference(item) : "";
    if(differenceOnly&&isSmaregiExcludedCheck(check))return;
    if(differenceOnly&&isSmaregiEffectiveNoIssueCheck(item,check))return;
    if(differenceOnly&&difference===0)return;
    if(differenceOnly&&!check)return;
    rows.push([
      item.barcode,
      item.product_name||"",
      getSavedSmaregiStockNumber(item,0),
      getSmaregiAppStock(item.barcode),
      check?.actual_stock??"",
      difference,
      getSmaregiDisplayCheckedBy(check),
      check?.checked_at ? fmt(check.checked_at) : "",
    getSmaregiCsvStatus(check,difference,item),
    check?.difference_reason_category||"",
    check?.difference_reason_memo||"",
    check?.difference_reason_by||"",
    check?.difference_reason_at ? fmt(check.difference_reason_at) : ""
    ]);
  });
  return rows;
}

function getSmaregiDifferenceDateRange(fromId="smaregiDiffCsvFromDate",toId="smaregiDiffCsvToDate"){
  const from=String(el(fromId)?.value||"").trim();
  const to=String(el(toId)?.value||"").trim();
  return {
    from,
    to,
    fromTime:from ? new Date(`${from}T00:00:00`).getTime() : null,
    toTime:to ? new Date(`${to}T23:59:59.999`).getTime() : null
  };
}

function isInSmaregiDifferenceDateRange(value,range=getSmaregiDifferenceDateRange()){
  const time=new Date(value).getTime();
  if(!Number.isFinite(time))return false;
  if(Number.isFinite(range.fromTime)&&time<range.fromTime)return false;
  if(Number.isFinite(range.toTime)&&time>range.toTime)return false;
  return true;
}

function getSmaregiSnapshotStoreCode(snapshot){
  const note=String(snapshot?.note||"");
  const match=note.match(/store_code:([^/\s]+)/);
  return match ? normalizeSmaregiStoreCodeForStorage(match[1]) : "";
}

async function loadSmaregiHistoricalDifferenceRows({recalculateEventStock=true}={}){
  const storeCode=normalizeSmaregiStoreCodeForStorage(getSmaregiCurrentStoreCode());
  const snapshots=await sbAll("smaregi_stock_snapshots?select=id,note&order=imported_at.desc",1000,50000).catch(()=>[]);
  const snapshotMap=new Map((snapshots||[]).map(snapshot=>[String(snapshot.id),snapshot]));
  const checks=(await sbAll("smaregi_stock_checks?select=*&order=checked_at.desc",1000,50000)).filter(check=>{
    const snapshot=snapshotMap.get(String(check.snapshot_id));
    const snapshotStoreCode=getSmaregiSnapshotStoreCode(snapshot);
    return !snapshotStoreCode || snapshotStoreCode===storeCode;
  });
  const items=await sbAll("smaregi_stock_items?select=*",1000,50000);
  if(recalculateEventStock&&typeof loadSmaregiEventInventoryCache==="function"){
    const barcodes=items.map(item=>item.barcode).filter(Boolean);
    await loadSmaregiEventInventoryCache(barcodes).catch(()=>{});
  }
  const itemMap=new Map(items.map(item=>[`${item.snapshot_id}::${item.barcode}`,item]));
  return checks.map(check=>{
    const item={
      ...(itemMap.get(`${check.snapshot_id}::${check.barcode}`)||{}),
      barcode:check.barcode
    };
    const stockBreakdown=recalculateEventStock&&typeof getSmaregiInventoryBreakdown==="function"
      ? getSmaregiInventoryBreakdown(item,check)
      : null;
    const recalculatedDifference=Number(stockBreakdown?.difference);
    const fallbackDifference=check.difference===null||check.difference===undefined||String(check.difference)===""
      ? calculateSmaregiDifference(getSavedSmaregiStockNumber(item,0),check.actual_stock)
      : Number(check.difference);
    const difference=Number.isFinite(recalculatedDifference) ? recalculatedDifference : fallbackDifference;
    return {check,item,difference,stockBreakdown};
  });
}

async function smaregiHistoricalDifferenceCsvRows(){
  const range=getSmaregiDifferenceDateRange("smaregiDiffCsvFromDate","smaregiDiffCsvToDate");
  const historical=await loadSmaregiHistoricalDifferenceRows();
  const rows=[["チェック日時","商品名","バーコード","スマレジ在庫","実在庫","差異","担当者","状態","原因カテゴリ","原因メモ","原因記入者","原因記入日時"]];
  historical.forEach(({check,item,difference})=>{
    if(!isInSmaregiDifferenceDateRange(check.checked_at,range))return;
    if(isSmaregiExcludedCheck(check)||isSmaregiNoIssueCheck(check)||difference===0||!Number.isFinite(difference))return;
    rows.push([
      check.checked_at ? fmt(check.checked_at) : "",
      item.product_name||item.productName||"",
      check.barcode||"",
      getSavedSmaregiStockValue(item)??"",
      check.actual_stock??"",
      difference,
      getSmaregiDisplayCheckedBy(check),
      getSmaregiCsvStatus(check,difference,item),
      check.difference_reason_category||"",
      check.difference_reason_memo||"",
      check.difference_reason_by||"",
      check.difference_reason_at ? fmt(check.difference_reason_at) : ""
    ]);
  });
  return rows;
}

async function exportSmaregiCheckCsv(differenceOnly=false){
  if(differenceOnly&&!isSmaregiManager()){
    showMessage("差異のみCSVはパスワード認証済みの管理者のみダウンロードできます。","err");
    return;
  }
  if(!differenceOnly&&!smaregiSnapshot){
    showMessage("出力するスマレジ在庫がありません。","err");
    return;
  }
  try{
    const rows=differenceOnly ? await smaregiHistoricalDifferenceCsvRows() : smaregiCsvRows(false);
    const today=new Date();
    const ymd=`${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
    downloadCsvFile(differenceOnly?`差異一覧${ymd}.csv`:"smaregi_stock_check_all.csv",rows);
    showMessage(`${differenceOnly?"差異のみ":"全体"}CSVを出力しました：${rows.length-1}件`,"ok");
  }catch(e){
    showMessage("差異CSV出力エラー。\n"+e.message,"err");
  }
}

async function refreshSmaregiChecksFromSupabase(){
  if(!smaregiSnapshot)return;
  const snapshotId=encodeURIComponent(smaregiSnapshot.id);
  smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
  await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
  renderSmaregiStockChecks();
}

async function runWithSmaregiAutoRefreshPaused(task,{button=null,refresh=true}={}){
  if(smaregiMutationBusy)return false;
  smaregiMutationBusy=true;
  if(button)button.disabled=true;
  stopSmaregiAutoRefresh();
  try{
    while(smaregiAutoRefreshBusy){
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return await task();
  }finally{
    try{
      if(refresh&&smaregiSnapshot)await refreshSmaregiChecksFromSupabase();
    }catch(e){
      console.warn("[Smaregi Mutation Refresh Error]",e);
      showMessage("最新状態の再取得エラー。\n"+e.message,"err");
    }
    smaregiMutationBusy=false;
    if(button)button.disabled=false;
    if(!el("smaregiStockCheckCard")?.hidden)startSmaregiAutoRefresh();
  }
}

async function refreshSmaregiCheckStateSilently(){
  const smaregiVisible=!el("smaregiStockCheckCard")?.hidden;
  if(smaregiMutationBusy||smaregiAutoRefreshBusy||!smaregiSnapshot||!smaregiVisible)return;
  smaregiAutoRefreshBusy=true;
  const focused=smaregiVisible ? getFocusedSmaregiInputState() : null;
  try{
    await refreshSmaregiChecksFromSupabase();
    restoreFocusedSmaregiInputState(focused);
    if(!el("smaregiAccuracyPanel")?.hidden)await loadSmaregiAccuracy();
    console.log("[Smaregi Auto Refresh]",getSmaregiStats());
  }catch(e){
    console.warn("[Smaregi Auto Refresh Error]",e);
    showMessage("自動更新エラー。\n"+e.message,"err");
  }finally{
    smaregiAutoRefreshBusy=false;
  }
}

function startSmaregiAutoRefresh(){
  stopSmaregiAutoRefresh();
  smaregiAutoRefreshTimer=setInterval(refreshSmaregiCheckStateSilently,5000);
}

function stopSmaregiAutoRefresh(){
  if(smaregiAutoRefreshTimer){
    clearInterval(smaregiAutoRefreshTimer);
    smaregiAutoRefreshTimer=null;
  }
}

/* CSV operation mode: Smaregi stock APIs are disabled. */
function showCsvOperationMessage(message){
  const text=message||"現在はCSV運用中です。スマレジAPIには接続しません。";
  showMessage(text,"ok");
  if(typeof showPopup==="function")showPopup("API停止中／CSV運用中",text);
}

function pickSmaregiCsvValue(row,keys){
  for(const key of keys){
    const normalized=typeof normalizeHeader==="function" ? normalizeHeader(key) : String(key||"").toLowerCase();
    if(row[normalized]!==undefined&&row[normalized]!==null&&String(row[normalized]).trim()!=="")return String(row[normalized]).trim();
  }
  return "";
}

function smaregiStockCsvToItems(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
  const headers=parsed[0].map(header=>typeof normalizeHeader==="function" ? normalizeHeader(header) : String(header||"").trim().toLowerCase());
  const items=[];
  for(let i=1;i<parsed.length;i++){
    const row={};
    headers.forEach((header,index)=>{row[header]=String(parsed[i][index]??"").trim();});
    const barcode=pickSmaregiCsvValue(row,["barcode","バーコード","JAN","JANコード","商品コード","品番"]);
    const productName=pickSmaregiCsvValue(row,["product_name","productName","name","商品名","品名"]);
    const stockRaw=pickSmaregiCsvValue(row,["smaregi_stock","stock","在庫","現在庫","在庫数","数量"]).replace(/,/g,"");
    if(!barcode&&!productName)continue;
    if(!barcode)throw new Error(`${i+1}行目：バーコードまたは商品コードが空です。`);
    const smaregiStock=Number(stockRaw||0);
    if(!Number.isFinite(smaregiStock))throw new Error(`${i+1}行目：在庫数が数値ではありません。`);
    items.push({
      barcode,
      product_name:productName,
      smaregi_stock:smaregiStock
    });
  }
  if(!items.length)throw new Error("取込対象の在庫変動データがありません。");
  return items;
}

async function importSmaregiStockCsvFile(file){
  try{
    if(!(typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess())){
      showMessage("スマレジ在庫変動CSV取込は管理者のみ操作できます。","err");
      return;
    }
    if(!file)return;
    showMessage("スマレジ在庫変動CSVを取込中...");
    const text=decodeCsvBuffer(await file.arrayBuffer());
    const items=smaregiStockCsvToItems(text);
    const snapshotId=(typeof crypto!=="undefined"&&crypto.randomUUID) ? crypto.randomUUID() : `csv-${Date.now()}`;
    const now=new Date().toISOString();
    await sb("smaregi_stock_snapshots",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        id:snapshotId,
        imported_at:now,
        range_from:null,
        completed_at:now
      })
    });
    for(let i=0;i<items.length;i+=500){
      await sb("smaregi_stock_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(items.slice(i,i+500).map(item=>({
          snapshot_id:snapshotId,
          barcode:item.barcode,
          product_name:item.product_name,
          smaregi_stock:getSavedSmaregiStockNumber(item,0)
        })))
      });
    }
    await loadLatestSmaregiSnapshot();
    showMessage(`スマレジ在庫変動CSVを取込ました：${items.length}件（API通信なし）`,"ok");
  }catch(e){
    showMessage("スマレジ在庫変動CSV取込エラー。\n"+e.message,"err");
  }finally{
    const input=el("smaregiStockCsvFile");
    if(input)input.value="";
  }
}

async function syncSmaregiStockFromApi(){
  showCsvOperationMessage("現在はCSV運用中です。スマレジAPIには接続しません。スマレジ在庫変動CSVを選択してください。");
  const input=el("smaregiStockCsvFile");
  if(input){
    input.value="";
    input.click();
  }
}

async function adjustEquipmentTransferSmaregiStock(){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
}

async function reverseEquipmentTransferSmaregiStock(){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
}

function showEquipmentTransferConfirmPopup({log,product,quantity,checkedBy,onOk}){
  const popup=document.createElement("div");
  popup.className="app-popup app-confirm-popup";
  popup.style.display="flex";
  popup.innerHTML=`<div class="app-popup-card">
    <div class="app-popup-title">商品転用確認</div>
    <div class="app-popup-body">現在はCSV運用中です。スマレジAPIには接続せず、アプリ内の商品転用確認だけを行います。
商品名：${esc(product?.name||log?.product_name||"-")}
棚番：${esc(getProductShelfLabel(product))}
バーコード：${esc(log?.barcode||product?.barcode||"-")}
数量：${esc(quantity)}
担当者：${esc(checkedBy)}

スマレジ在庫は自動変更されません。</div>
    <div class="app-confirm-actions">
      <button type="button" class="secondary app-equipment-transfer-cancel-btn">キャンセル</button>
      <button type="button" class="app-equipment-transfer-ok-btn">確認する</button>
    </div>
  </div>`;
  const close=()=>{try{document.body.removeChild(popup);}catch(_){}};
  popup.querySelector(".app-equipment-transfer-cancel-btn")?.addEventListener("click",close);
  popup.querySelector(".app-equipment-transfer-ok-btn")?.addEventListener("click",()=>{close();onOk();});
  popup.addEventListener("click",event=>{if(event.target===popup)close();});
  document.body.appendChild(popup);
}

async function executeEquipmentTransferConfirmation({log,product=null,quantity,checkedBy,button}){
  const logId=String(log?.id||"").trim();
  let latestLog=null;
  let productUpdated=false;
  let currentStock=null;
  await runWithSmaregiAutoRefreshPaused(async()=>{
    try{
      const latestRows=await sb(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`);
      latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : null;
      if(!latestLog)throw new Error(`商品転用履歴が見つかりません。inventory_logs.id=${logId}`);
      if(isEquipmentTransferChecked(latestLog))throw new Error("この商品転用は確認済みです。");
      const type=String(latestLog.type||"");
      if(type!=="備品転用"&&type!=="equipment_transfer")throw new Error("商品転用の履歴ではありません。");
      quantity=Number(latestLog.quantity||quantity||0);
      if(!Number.isInteger(quantity)||quantity<=0)throw new Error("数量は1以上で入力してください。");
      product=product || await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      currentStock=Number(product.base_stock||0);
      const nextStock=currentStock-quantity;
      if(nextStock<0)throw new Error(`在庫不足：${product.name} / 現在庫 ${currentStock} / 商品転用数 ${quantity}`);
      await updateProductCurrentStock(latestLog.barcode,nextStock);
      productUpdated=true;
      const equipment_checked_at=new Date().toISOString();
      const patchPayload={
        type:"equipment_transfer",
        equipment_checked:true,
        equipment_checked_by:checkedBy,
        equipment_checked_at,
        affects_smaregi:false,
        smaregi_delta:0,
        memo:latestLog.memo||""
      };
      const patchedRows=await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}&select=*`,{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify(patchPayload)
      });
      const refreshedLog=Array.isArray(patchedRows)&&patchedRows[0] ? patchedRows[0] : null;
      if(!refreshedLog)throw new Error(`商品転用履歴を更新できませんでした。inventory_logs.id=${logId}`);
      const displayLog={...refreshedLog,type:"備品転用"};
      equipmentTransferLogCache.set(logId,displayLog);
      replaceEquipmentConfirmationDom(logId,displayLog);
      logs=(logs||[]).some(item=>String(item.id)===String(logId))
        ? logs.map(item=>String(item.id)===String(logId) ? displayLog : item)
        : [displayLog,...logs];
      showMessage(`商品転用を確認しました：${product.name} / 数量 ${quantity}（API通信なし）`,"ok");
      showPopup("商品転用完了",`商品名：${product.name}\n棚番：${getProductShelfLabel(product)}\nバーコード：${latestLog.barcode}\n数量：${quantity}\n現在庫：${nextStock}\nスマレジ在庫：自動変更なし（CSV運用中）`);
      renderGlobalHistory();
      if(selectedBarcode)await showProductHistoryForBarcode(selectedBarcode,displayLog);
      replaceEquipmentConfirmationDom(logId,displayLog);
      if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
    }catch(e){
      if(productUpdated&&product&&latestLog?.barcode){
        try{await updateProductCurrentStock(latestLog.barcode,currentStock);}catch(_){}
      }
      showMessage("商品転用確認エラー。\n"+e.message,"err");
    }
  },{button});
}

/* CSV operation mode: Smaregi stock movement import. */
let smaregiLatestChangeByBarcode=new Map();

function normalizeSmaregiMovementDate(value){
  const text=String(value||"").trim();
  if(!text)return new Date().toISOString();
  const normalized=text
    .replace(/\//g,"-")
    .replace(" ","T")
    .replace(/年|月/g,"-")
    .replace(/日/g,"")
    .replace(/時/g,":")
    .replace(/分/g,":")
    .replace(/秒/g,"");
  const date=new Date(normalized);
  if(Number.isNaN(date.getTime()))return new Date().toISOString();
  return date.toISOString();
}

function smaregiMovementKey(row){
  const identity=String(row.barcode||row.product_code||row.product_name||"").trim();
  const changedAt=String(row.changed_at||row.movement_datetime||row.updated_at_from_csv||"").trim();
  const amount=String(row.amount??row.movement_quantity??"").trim();
  const storeStock=String(row.stock_amount??row.smaregi_stock_quantity??row.tokyo_stock??row.aichi_stock??"").trim();
  return [identity,changedAt,amount,storeStock].join("|");
/*
  return [
    String(row.barcode||""),
    String(row.changed_at||""),
    String(row.stock_division||""),
    String(row.amount||""),
    String(row.stock_amount||""),
    String(row.memo||"")
  ].join("|");
*/
}

function smaregiStableHash(value){
  const text=String(value||"");
  let hash=2166136261;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(36);
}

function buildSmaregiCsvChangeId(change){
  const identity=String(change.barcode||change.product_code||change.product_name||"").trim();
  const raw=[
    identity,
    String(change.changed_at||"").trim(),
    String(change.amount||"").trim(),
    String(change.stock_amount??change.smaregi_stock_quantity??change.tokyo_stock??change.aichi_stock??"").trim(),
    String(change.stock_division||"").trim(),
    String(change.memo||"").trim()
  ].join("|");
  return `csv_${smaregiStableHash(raw)}`;
}

function smaregiMovementCsvToChanges(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
  const headers=parsed[0].map(header=>typeof normalizeHeader==="function" ? normalizeHeader(header) : String(header||"").trim().toLowerCase());
  const changes=[];
  for(let i=1;i<parsed.length;i++){
    const row={};
    headers.forEach((header,index)=>{row[header]=String(parsed[i][index]??"").trim();});
    const barcode=pickSmaregiCsvValue(row,["barcode","バーコード","JAN","JANコード","商品コード","品番","product_code","productcode"]);
    const productName=pickSmaregiCsvValue(row,["product_name","productName","name","商品名","品名"]);
    const changedAt=normalizeSmaregiMovementDate(pickSmaregiCsvValue(row,["changed_at","changedAt","movement_datetime","movementdatetime","日時","処理日時","変動日時","更新日時","日付"]));
    const stockDivision=pickSmaregiCsvValue(row,["stock_division","stockDivision","movement_type","movementtype","区分","変動区分","処理区分","理由","変動理由"]);
    const amountRaw=pickSmaregiCsvValue(row,["amount","movement_quantity","movementquantity","変動数","数量","増減数","移動数"]).replace(/,/g,"");
    const stockRaw=pickSmaregiCsvValue(row,["stock_amount","stockAmount","quantity_after","quantityafter","在庫数","処理後在庫","現在庫","変動後在庫"]).replace(/,/g,"");
    const memo=pickSmaregiCsvValue(row,["memo","備考","メモ","理由メモ","コメント"]);
    if(!barcode&&!productName)continue;
    if(!barcode)throw new Error(`${i+1}行目：バーコードまたは商品コードが空です。`);
    const amount=Number(amountRaw||0);
    const stockAmount=Number(stockRaw||0);
    if(!Number.isFinite(amount))throw new Error(`${i+1}行目：変動数が数値ではありません。`);
    if(!Number.isFinite(stockAmount))throw new Error(`${i+1}行目：処理後在庫が数値ではありません。`);
    changes.push({
      barcode,
      product_name:productName,
      changed_at:changedAt,
      stock_division:stockDivision,
      amount,
      stock_amount:stockAmount,
      memo
    });
  }
  if(!changes.length)throw new Error("取込対象の在庫変動データがありません。");
  return changes;
}

function latestSmaregiChangesByBarcode(changes){
  const map=new Map();
  (changes||[]).forEach(change=>{
    const barcode=String(change.barcode||"").trim();
    if(!barcode)return;
    const current=map.get(barcode);
    if(!current||new Date(change.changed_at||0)>new Date(current.changed_at||0)){
      map.set(barcode,change);
    }
  });
  return map;
}

function smaregiMovementCsvToChanges(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
  const headers=parsed[0].map(header=>typeof normalizeHeader==="function" ? normalizeHeader(header) : String(header||"").trim().toLowerCase());
  const changes=[];
  for(let i=1;i<parsed.length;i++){
    const row={};
    headers.forEach((header,index)=>{row[header]=String(parsed[i][index]??"").trim();});
    const barcode=pickSmaregiCsvValue(row,["barcode","バーコード","JAN","JANコード"]);
    const productCode=pickSmaregiCsvValue(row,["product_code","productcode","商品コード","品番","code"]);
    const productName=pickSmaregiCsvValue(row,["product_name","productName","name","商品名","品名"]);
    const changedAt=normalizeSmaregiMovementDate(pickSmaregiCsvValue(row,["changed_at","changedAt","movement_datetime","movementdatetime","日時","処理日時","変動日時","更新日時","日付"]));
    const stockDivision=pickSmaregiCsvValue(row,["stock_division","stockDivision","movement_type","movementtype","区分","変動区分","処理区分","理由","変動理由"]);
    const amountRaw=pickSmaregiCsvValue(row,["amount","movement_quantity","movementquantity","変動数","数量","増減数","移動数"]).replace(/,/g,"");
    const stockRaw=pickSmaregiCsvValue(row,["stock_amount","stockAmount","quantity_after","quantityafter","在庫数","処理後在庫","現在庫","変動後在庫"]).replace(/,/g,"");
    const memo=pickSmaregiCsvValue(row,["memo","備考","メモ","理由メモ","コメント"]);
    const productIdentity=String(barcode||productCode||productName||"").trim();
    if(!productIdentity)continue;
    const amount=Number(amountRaw||0);
    const stockAmount=Number(stockRaw||0);
    if(!Number.isFinite(amount))throw new Error(`${i+1}行目：変動数が数値ではありません。`);
    if(!Number.isFinite(stockAmount))throw new Error(`${i+1}行目：処理後在庫が数値ではありません。`);
    const change={
      barcode:productIdentity,
      product_code:productCode,
      product_name:productName,
      changed_at:changedAt,
      stock_division:stockDivision,
      amount,
      stock_amount:stockAmount,
      memo
    };
    change.smaregi_change_id=buildSmaregiCsvChangeId(change);
    changes.push(change);
  }
  if(!changes.length)throw new Error("取込対象の在庫変動データがありません。");
  return changes;
}

function dedupeSmaregiMovementChanges(changes,existingKeys=new Set()){
  const seen=new Set();
  const unique=[];
  const duplicates=[];
  (changes||[]).forEach(change=>{
    const key=smaregiMovementKey(change);
    if(existingKeys.has(key)||seen.has(key)){
      duplicates.push(change);
      return;
    }
    seen.add(key);
    unique.push(change);
  });
  return {unique,duplicates};
}

async function importSmaregiStockCsvFile(file){
  try{
    if(!(typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess())){
      showMessage("スマレジ在庫変動CSV取込は管理者のみ操作できます。","err");
      return;
    }
    if(!file)return;
    showMessage("スマレジ在庫変動CSVを取込中...");
    const text=decodeCsvBuffer(await file.arrayBuffer());
    const changes=smaregiMovementCsvToChanges(text);
    const existing=await sbAll("smaregi_stock_changes?select=smaregi_change_id,barcode,changed_at,stock_division,amount,stock_amount,memo",1000,50000).catch(()=>[]);
    const existingKeys=new Set((existing||[]).map(smaregiMovementKey));
    const deduped=dedupeSmaregiMovementChanges(changes,existingKeys);
    const newChanges=deduped.unique;
    const duplicateCount=deduped.duplicates.length;
    const errorCount=0;
    const snapshotId=(typeof crypto!=="undefined"&&crypto.randomUUID) ? crypto.randomUUID() : `csv-movement-${Date.now()}`;
    const now=new Date().toISOString();
    const previousSnapshots=await sb("smaregi_stock_snapshots?select=completed_at&order=imported_at.desc&limit=1").catch(()=>[]);
    const previousCompletedAt=Array.isArray(previousSnapshots)&&previousSnapshots[0]?.completed_at ? previousSnapshots[0].completed_at : null;
    await sb("smaregi_stock_snapshots",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        id:snapshotId,
        imported_at:now,
        range_from:previousCompletedAt,
        completed_at:previousCompletedAt
      })
    });
    for(let i=0;i<newChanges.length;i+=500){
      await sb("smaregi_stock_changes",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(newChanges.slice(i,i+500).map(change=>({
          smaregi_change_id:change.smaregi_change_id||buildSmaregiCsvChangeId(change),
          snapshot_id:snapshotId,
          barcode:change.barcode,
          changed_at:change.changed_at,
          stock_division:change.stock_division,
          amount:change.amount,
          stock_amount:change.stock_amount,
          memo:change.memo
        })))
      });
    }
    const uniqueDisplayChanges=dedupeSmaregiMovementChanges(changes,new Set()).unique;
    const latestMap=latestSmaregiChangesByBarcode(uniqueDisplayChanges);
    const latestItems=[...latestMap.values()].map(change=>({
      snapshot_id:snapshotId,
      barcode:change.barcode,
      product_name:change.product_name,
      smaregi_stock:change.stock_amount
    }));
    for(let i=0;i<latestItems.length;i+=500){
      await sb("smaregi_stock_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(latestItems.slice(i,i+500))
      });
    }
    await loadLatestSmaregiSnapshot();
    showMessage(`\u30b9\u30de\u30ec\u30b8\u5728\u5eab\u5909\u52d5CSV\u3092\u53d6\u8fbc\u307e\u3057\u305f\uff1a\u53d6\u8fbc ${changes.length}\u4ef6 / \u65b0\u898f ${newChanges.length}\u4ef6 / \u91cd\u8907\u9664\u5916 ${duplicateCount}\u4ef6 / \u30a8\u30e9\u30fc ${errorCount}\u4ef6\uff08API\u901a\u4fe1\u306a\u3057\uff09`,"ok");
    if(typeof showPopup==="function")showPopup("\u30b9\u30de\u30ec\u30b8\u5728\u5eab\u5909\u52d5CSV\u53d6\u8fbc\u5b8c\u4e86",`\u53d6\u8fbc\u4ef6\u6570\uff1a${changes.length}\u4ef6\n\u65b0\u898f\u4ef6\u6570\uff1a${newChanges.length}\u4ef6\n\u91cd\u8907\u9664\u5916\u4ef6\u6570\uff1a${duplicateCount}\u4ef6\n\u30a8\u30e9\u30fc\u4ef6\u6570\uff1a${errorCount}\u4ef6`);
    return;
    showMessage(`スマレジ在庫変動CSVを取込ました：代表商品 ${latestItems.length}件 / 新規変動 ${newChanges.length}件（API通信なし）`,"ok");
  }catch(e){
    showMessage("スマレジ在庫変動CSV取込エラー。\n"+e.message,"err");
  }finally{
    const input=el("smaregiStockCsvFile");
    if(input)input.value="";
  }
}

async function loadLatestSmaregiSnapshot(){
  try{
    showMessage("スマレジ在庫変動データを取得中...");
    const snapshots=await sb("smaregi_stock_snapshots?select=*&order=imported_at.desc&limit=1");
    smaregiSnapshot=Array.isArray(snapshots)&&snapshots.length ? snapshots[0] : null;
    const resetInput=el("resetSmaregiCompletedAtInput");
    if(resetInput)resetInput.value=smaregiSnapshot?.completed_at ? formatDateTimeLocal(smaregiSnapshot.completed_at) : "";
    smaregiStockItems=[];
    smaregiStockChecks=[];
    smaregiLatestChangeByBarcode=new Map();
    if(smaregiSnapshot){
      const snapshotId=encodeURIComponent(smaregiSnapshot.id);
      smaregiStockItems=await sbAll(`smaregi_stock_items?select=*&snapshot_id=eq.${snapshotId}&order=product_name.asc`,1000,20000);
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      const latestChanges=await sbAll(`smaregi_stock_changes?select=*&snapshot_id=eq.${snapshotId}&order=changed_at.desc`,1000,50000).catch(()=>[]);
      smaregiLatestChangeByBarcode=latestSmaregiChangesByBarcode(latestChanges);
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
      await loadSmaregiEventInventoryCache(smaregiStockItems.map(item=>item.barcode));
    }else{
      smaregiCurrentEventStockByBarcode=new Map();
      smaregiEventStorageStockByBarcode=new Map();
    }
    renderSmaregiStockChecks();
    showMessage(smaregiSnapshot
      ? `スマレジ在庫変動データを取得しました：${smaregiStockItems.length}件`
      : "スマレジ在庫変動データはまだありません。在庫変動CSVを取り込んでください。",smaregiSnapshot?"ok":"");
  }catch(e){
    showMessage("スマレジ在庫変動データ取得エラー。\n"+e.message,"err");
  }
}

function getSmaregiMovementSummaryHtml(item){
  const change=smaregiLatestChangeByBarcode.get(String(item.barcode||""));
  if(!change)return `<div class="smaregi-movement-note">最終変動：CSV内に変動履歴なし</div>`;
  return `<div class="smaregi-movement-note">
    <span>最終変動：${esc(fmt(change.changed_at))}</span>
    <span>変動数：${Number(change.amount||0)}</span>
    <span>理由：${esc(change.stock_division||"-")}</span>
    <span>備考：${esc(change.memo||"")}</span>
  </div>`;
}

async function syncSmaregiStockFromApi(){
  showCsvOperationMessage("現在はCSV運用中です。スマレジAPIには接続しません。スマレジ在庫変動CSVを選択してください。");
  const input=el("smaregiStockCsvFile");
  if(input){
    input.value="";
    input.click();
  }
}
