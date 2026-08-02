(function(){
  "use strict";

  let smaregiDiffAutoLoadPromise=null;
  let smaregiDiffAutoLoadedKey="";

  function safeText(value){
    return typeof esc==="function" ? esc(value) : String(value ?? "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function stopSmaregiAutoRefresh(){
    try{
      if(typeof smaregiAutoRefreshTimer!=="undefined" && smaregiAutoRefreshTimer){
        clearInterval(smaregiAutoRefreshTimer);
        smaregiAutoRefreshTimer=null;
      }
    }catch(_){}
  }

  window.stopSmaregiAutoRefresh=stopSmaregiAutoRefresh;

  window.startSmaregiAutoRefresh=function(){
    stopSmaregiAutoRefresh();
    smaregiAutoRefreshTimer=setInterval(()=>window.refreshSmaregiCheckStateSilently(),5000);
  };

  function getChangeForItem(item){
    try{
      return smaregiLatestChangeByBarcode?.get(String(item?.barcode||"")) || {};
    }catch(_){
      return {};
    }
  }

  function getItemName(item){
    if(typeof getSmaregiItemProductName==="function")return getSmaregiItemProductName(item);
    return item?.product_name || item?.productName || "";
  }

  function getItemBarcode(item){
    if(typeof getSmaregiItemBarcode==="function")return getSmaregiItemBarcode(item);
    return item?.barcode || item?.jan_code || item?.product_code || "";
  }

  function isMobileViewport(){
    return !!(window.matchMedia && window.matchMedia("(max-width: 800px)").matches);
  }

  function canShowExcludeColumn(){
    if(isMobileViewport())return false;
    return typeof hasInventoryPrivilegedAccess!=="function" || hasInventoryPrivilegedAccess();
  }

  function getAllMovementItems(){
    const items=Array.isArray(smaregiStockItems) ? smaregiStockItems.filter(Boolean) : [];
    if(items.length)return items;
    try{
      if(smaregiLatestChangeByBarcode && smaregiLatestChangeByBarcode.size){
        return [...smaregiLatestChangeByBarcode.entries()].map(([key,change])=>({
          barcode:change.barcode || key || change.product_code || change.product_name || "",
          product_name:change.product_name || "",
          smaregi_stock:change.stock_amount,
          smaregi_stock_quantity:change.stock_amount,
          stock_amount:change.stock_amount,
          changed_at:change.changed_at,
          movement_datetime:change.changed_at
        })).filter(item=>String(item.barcode||""));
      }
    }catch(_){}
    return [];
  }

  function getLastCheckedAtSafe(){
    if(typeof getSmaregiLastCheckedAt==="function")return getSmaregiLastCheckedAt();
    return "2026-06-16T00:00:00+09:00";
  }

  function isFallbackLastCheckedAt(){
    return typeof isSmaregiLastCheckedAtFallback==="function" && isSmaregiLastCheckedAtFallback();
  }

  function isExcludedCheck(check){
    if(typeof isSmaregiExcludedCheck==="function")return isSmaregiExcludedCheck(check);
    return check?.excluded===true || String(check?.checked_by||"").startsWith("除外:");
  }

  function hasActualStock(check){
    return check && check.actual_stock!==null && check.actual_stock!==undefined && String(check.actual_stock)!=="";
  }

  function isCheckedItem(item){
    const barcode=String(item?.barcode||"");
    const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
    return hasActualStock(check) || isExcludedCheck(check);
  }

  function parseStockNumber(value){
    if(value===null || value===undefined || String(value).trim()==="")return null;
    const number=Number(String(value).replace(/,/g,""));
    return Number.isFinite(number) ? number : null;
  }

  function getInventoryStoreCodeSafe(){
    const raw=(typeof getInventoryCurrentStoreCode==="function" ? getInventoryCurrentStoreCode() : "")
      || (typeof getSmaregiCurrentStoreCode==="function" ? getSmaregiCurrentStoreCode() : "")
      || window.currentStoreCode
      || window.inventoryCurrentStoreCode
      || "tokyo";
    const value=String(raw||"").toLowerCase();
    if(value.includes("aichi") || value.includes("愛知") || value.includes("アイチ"))return "aichi";
    return "tokyo";
  }

  function getInventoryStoreLabelSafe(){
    return getInventoryStoreCodeSafe()==="aichi" ? "アイチ店" : "東京店";
  }

  function pickNumericField(source,names){
    if(!source)return null;
    for(const name of names){
      const value=parseStockNumber(source[name]);
      if(value!==null)return value;
    }
    return null;
  }

  function getStoreStockValue(source,storeCode,allowGeneric=false){
    if(!source)return null;
    const tokyoFields=[
      "tokyo_stock","tokyo_store_stock","tokyo_stock_amount","tokyo_quantity",
      "stock_tokyo","store_tokyo_stock","tokyo_inventory","tokyo",
      "東京店舗在庫","東京在庫","東京店在庫"
    ];
    const aichiFields=[
      "aichi_stock","aichi_store_stock","aichi_stock_amount","aichi_quantity",
      "stock_aichi","store_aichi_stock","aichi_inventory","aichi",
      "愛知店舗在庫","アイチ店舗在庫","愛知在庫","アイチ在庫","愛知店在庫"
    ];
    const specific=pickNumericField(source,storeCode==="aichi" ? aichiFields : tokyoFields);
    if(specific!==null)return specific;
    if(!allowGeneric)return null;
    return pickNumericField(source,[
      "stock_amount","smaregi_stock","smaregi_stock_quantity","stock_quantity",
      "quantity_after","store_stock","在庫数"
    ]);
  }

  function getTargetSmaregiStock(item){
    const storeCode=getInventoryStoreCodeSafe();
    const raw=typeof window.getSavedSmaregiStockValue==="function"
      ? window.getSavedSmaregiStockValue(item)
      : getStoreStockValue(item,storeCode,true);
    if(raw===null)return {raw:null,compare:null,storeCode};
    return {raw,compare:raw<0?0:raw,storeCode};
  }

  function getStoreDisplayStocks(source){
    return {
      tokyo:getStoreStockValue(source,"tokyo",false),
      aichi:getStoreStockValue(source,"aichi",false)
    };
  }

  function getCsvSmaregiStock(item){
    return getTargetSmaregiStock(item).raw;
  }

  function getComparableCsvSmaregiStock(item){
    return getTargetSmaregiStock(item).compare;
  }

  window.getCsvSmaregiStock=getCsvSmaregiStock;
  window.getComparableCsvSmaregiStock=getComparableCsvSmaregiStock;
  window.getTargetSmaregiStock=getTargetSmaregiStock;

  function displayNumber(value,emptyLabel="未入力"){
    if(value===null || value===undefined || String(value)==="")return emptyLabel;
    const number=Number(value);
    return Number.isFinite(number) ? String(number) : emptyLabel;
  }

  function formatSignedDisplay(value){
    const number=Number(value);
    if(!Number.isFinite(number))return "-";
    if(number>0)return `+${number}`;
    return String(number);
  }

  function signedClass(value){
    const number=Number(value);
    if(number<0)return "is-negative";
    if(number>0)return "is-positive";
    return "";
  }

  function getChangeDateValue(change){
    return change?.changed_at || change?.movement_datetime || change?.updated_at_from_csv || change?.updated_at || "";
  }

  function getSmaregiStockDivisionLabel(value){
    const text=String(value||"").trim();
    if(!text)return "";
    const labels={
      "01":"修正",
      "02":"売上",
      "03":"仕入",
      "04":"出庫",
      "05":"入庫",
      "06":"レンタル",
      "07":"取置き",
      "08":"棚卸",
      "09":"調整",
      "10":"出荷",
      "12":"返品",
      "13":"販促品",
      "14":"ロス",
      "15":"スマレジAPI連携",
      "16":"売上引当",
      "17":"入庫欠品",
      "18":"受注在庫引当"
    };
    if(labels[text])return labels[text];
    if(/^\d+$/.test(text))return `不明（${text}）`;
    return text;
  }

  function getLastCheckTimeValue(){
    const lastCheckedAt=getLastCheckedAtSafe();
    const time=new Date(lastCheckedAt).getTime();
    return Number.isFinite(time) ? time : new Date("2026-06-16T00:00:00+09:00").getTime();
  }

  window.getSmaregiCurrentTargetItems=function(){
    const items=getAllMovementItems();
    const lastCheckedAt=getLastCheckedAtSafe();
    const lastTime=new Date(lastCheckedAt).getTime();
    return items.filter(item=>{
      const change=getChangeForItem(item);
      const changedAt=change.changed_at || change.movement_datetime || item?.changed_at || item?.movement_datetime;
      const changedTime=new Date(changedAt).getTime();
      if(!Number.isFinite(changedTime))return false;
      if(!Number.isFinite(lastTime))return true;
      return changedTime>lastTime;
    });
  };

  window.getSmaregiFilteredTargetItems=function(){
    const target=window.getSmaregiCurrentTargetItems();
    const mode=window.smaregiCheckDisplayMode || "unchecked";
    const keyword=typeof normalizeSearchText==="function"
      ? normalizeSearchText(document.getElementById("smaregiStockSearchInput")?.value||"")
      : String(document.getElementById("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
    const filtered=target.filter(item=>{
      if(mode==="checked"&&!isCheckedItem(item))return false;
      if(mode!=="checked"&&mode!=="all"&&isCheckedItem(item))return false;
      if(!keyword)return true;
      const barcode=String(getItemBarcode(item)||item?.barcode||"");
      const product=typeof gp==="function" ? (gp(barcode)||{}) : {};
      const values=[
        getItemName(item),
        barcode,
        item?.product_code,
        item?.item_number,
        item?.color,
        item?.size,
        product.name,
        product.barcode,
        product.product_code,
        product.smaregi_product_id,
        product.item_number,
        product.part_number,
        product.color,
        product.size,
        product.location
      ];
      const haystack=values.filter(value=>value!==null&&value!==undefined).join(" ");
      const text=typeof normalizeSearchText==="function" ? normalizeSearchText(haystack) : String(haystack).toLowerCase();
      return text.includes(keyword);
    });
    const sortSelect=document.getElementById("smaregiProductSearchSort");
    const sortKey="arico_product_search_sort_smaregi";
    const sortMode=["name","barcode","location","updated"].includes(String(sortSelect?.value||""))
      ? String(sortSelect.value)
      : ["name","barcode","location","updated"].includes(String(localStorage.getItem(sortKey)||""))
        ? String(localStorage.getItem(sortKey))
        : "name";
    if(sortSelect&&sortSelect.value!==sortMode)sortSelect.value=sortMode;
    if(typeof sortProductsForDisplay!=="function"){
      return [...filtered].sort((a,b)=>String(getItemName(a)||"").localeCompare(String(getItemName(b)||""),"ja"));
    }
    const mapped=filtered.map((item,index)=>{
      const barcode=String(getItemBarcode(item)||item?.barcode||"");
      const product=typeof gp==="function" ? (gp(barcode)||{}) : {};
      const change=getChangeForItem(item);
      return {
        ...item,
        __index:index,
        name:getItemName(item)||product.name||"",
        barcode,
        location:product.location||item?.location||"",
        updated_at:change?.changed_at||item?.latest_change_at||item?.changed_at||item?.updated_at||product.updated_at||""
      };
    });
    return sortProductsForDisplay(mapped,sortMode);
  };

  window.getSmaregiStats=function(){
    const target=window.getSmaregiCurrentTargetItems();
    const excluded=target.filter(item=>{
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(String(item?.barcode||"")) : null;
      return isExcludedCheck(check);
    }).length;
    const completed=target.filter(item=>{
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(String(item?.barcode||"")) : null;
      return hasActualStock(check) && !isExcludedCheck(check);
    }).length;
    const unchecked=Math.max(0,target.length-completed-excluded);
    const percent=target.length>0 ? Math.round(((completed+excluded)/target.length)*100) : 0;
    return {total:target.length,completed,unchecked,excluded,percent};
  };

  window.refreshSmaregiCheckStateSilently=async function(){
    if(!smaregiSnapshot)return;
    try{
      const snapshotId=smaregiSnapshot.id;
      const latestChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${encodeURIComponent(snapshotId)}&order=checked_at.desc`,1000,20000);
      smaregiStockChecks=Array.isArray(latestChecks) ? latestChecks : [];
      updateSmaregiProgressOnly();
      renderSmaregiDiffOnlyPanel();
    }catch(error){
      console.warn("[smaregi progress refresh]",error);
    }
  };

  function collectDraftValues(){
    const body=typeof el==="function" ? el("smaregiStockCheckBody") : document.getElementById("smaregiStockCheckBody");
    const drafts=new Map();
    body?.querySelectorAll(".smaregi-actual-stock-input").forEach(input=>{
      const barcode=String(input.dataset.barcode||"");
      if(!barcode)return;
      const value=String(input.value??"");
      if(value!=="" || document.activeElement===input)drafts.set(barcode,value);
    });
    return drafts;
  }

  function setSmaregiCheckTableHeader(){
    const body=typeof el==="function" ? el("smaregiStockCheckBody") : document.getElementById("smaregiStockCheckBody");
    const header=body?.closest("table")?.querySelector("thead tr");
    if(!header)return;
    header.innerHTML=canShowExcludeColumn()
      ? "<th>商品情報</th><th>実在庫入力</th><th>保存</th><th>除外</th>"
      : "<th>商品情報</th><th>実在庫入力</th><th>保存</th>";
  }

  function buildProductInfo(item){
    const change=getChangeForItem(item);
    const changedAt=change.changed_at || change.movement_datetime || item?.changed_at || item?.movement_datetime || "";
    const dateLabel=changedAt && typeof fmt==="function" ? fmt(changedAt) : changedAt;
    const product=typeof gp==="function" ? gp(getItemBarcode(item)) : null;
    return `<div class="smaregi-final-product-info">
      <strong>${safeText(getItemName(item)||"商品名未設定")}</strong>
      <small>棚番：${safeText(getProductShelfLabel(product||{location:item?.location||""}))}</small>
      <small>バーコード：${safeText(getItemBarcode(item)||"バーコードなし")}</small>
      <small>最終変動：${safeText(dateLabel||"-")}</small>
    </div>`;
  }

  function updateSmaregiProgressOnly(){
    const badge=typeof el==="function" ? el("smaregiStockSnapshotBadge") : document.getElementById("smaregiStockSnapshotBadge");
    const progress=typeof el==="function" ? el("smaregiStockProgress") : document.getElementById("smaregiStockProgress");
    const legacyBadge=typeof el==="function" ? el("smaregiProgressBadge") : document.getElementById("smaregiProgressBadge");
    const complete=typeof el==="function" ? el("completeSmaregiStockCheckBtn") : document.getElementById("completeSmaregiStockCheckBtn");
    const stats=getSmaregiStats();
    const hasMovementData=stats.total>0;
    const lastCheckedAt=getLastCheckedAtSafe();
    const lastLabel=lastCheckedAt && typeof fmt==="function" ? fmt(lastCheckedAt) : String(lastCheckedAt||"前回チェック未設定");
    const checker=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
    if(badge)badge.textContent=hasMovementData ? "スマレジ変動API取得済み" : "スマレジ変動API未取得";
    if(progress){
      progress.innerHTML=[
        `<div class="smaregi-progress-main">今回チェック対象 <span>${stats.total}件</span></div>`,
        `<div>チェック済み：${stats.completed}件 / 未チェック：${stats.unchecked}件 / 除外：${stats.excluded||0}件</div>`,
        `<div>担当者：<strong>${safeText(checker||"担当者未設定")}</strong></div>`,
        `<div>前回チェック完了：<strong>${safeText(lastLabel||"前回チェック未設定")}</strong></div>`,
        isFallbackLastCheckedAt()?'<div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>':"",
        `<div class="smaregi-progress-area"><div id="smaregiProgressGraph" class="smaregi-progress-graph" role="progressbar" aria-label="チェック進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.percent||0}"><div id="smaregiProgressFill" class="smaregi-progress-fill" style="width:${stats.percent||0}%"></div></div><div id="smaregiProgressText" class="smaregi-progress-text">進捗 ${stats.completed+stats.excluded}/${stats.total}件（${stats.percent||0}%）</div></div>`
      ].join("");
    }
    const graph=document.getElementById("smaregiProgressGraph");
    const fill=document.getElementById("smaregiProgressFill");
    const text=document.getElementById("smaregiProgressText");
    if(legacyBadge){
      legacyBadge.classList.remove("muted");
      legacyBadge.innerHTML=`<div class="smaregi-progress-card-inner">
        <div class="smaregi-progress-main">チェック済み <span>${stats.completed+stats.excluded} / ${stats.total}</span></div>
        <div class="smaregi-progress-sub">未チェック ${stats.unchecked}件　除外 ${stats.excluded||0}件</div>
        <div class="smaregi-progress-area">
          <div class="smaregi-progress-graph" role="progressbar" aria-label="チェック進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.percent||0}">
            <div class="smaregi-progress-fill" style="width:${stats.percent||0}%"></div>
          </div>
          <div class="smaregi-progress-text">進捗 ${stats.completed+stats.excluded}/${stats.total}件（${stats.percent||0}%）</div>
        </div>
      </div>`;
    }
    if(graph)graph.setAttribute("aria-valuenow",String(stats.percent||0));
    if(fill)fill.style.width=`${stats.percent||0}%`;
    if(text)text.textContent=`進捗 ${stats.completed+stats.excluded}/${stats.total}件（${stats.percent||0}%）`;
    if(complete)complete.disabled=!stats.total;
  }

  function getDiffRows(){
    const target=window.getSmaregiCurrentTargetItems();
    return target.map(item=>{
      const barcode=String(item?.barcode||"");
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
      if(!hasActualStock(check))return null;
      if(isExcludedCheck(check))return null;
      if(check?.no_issue===true)return null;
      if(check?.difference_reason_category || check?.difference_reason_memo || check?.difference_reason_by || check?.difference_reason_at)return null;
      const breakdown=typeof getSmaregiInventoryBreakdown==="function"
        ? getSmaregiInventoryBreakdown(item,check)
        : null;
      const actual=Number(breakdown?.actualStock ?? check.actual_stock);
      const currentEventStock=Number(breakdown?.currentEventStock ?? 0);
      const eventStorageStock=Number(breakdown?.eventStorageStock ?? 0);
      const eventShelfStock=Number(breakdown?.eventShelfStock ?? (currentEventStock+eventStorageStock));
      const comparisonStock=Number(breakdown?.comparisonStock ?? actual);
      const smaregiStock=getCsvSmaregiStock(item);
      const smaregiCompareStock=getComparableCsvSmaregiStock(item);
      if(!Number.isFinite(actual)||!Number.isFinite(eventShelfStock)||!Number.isFinite(smaregiStock)||!Number.isFinite(smaregiCompareStock)||!Number.isFinite(comparisonStock))return null;
      const difference=comparisonStock-smaregiCompareStock;
      if(difference===0)return null;
      return {item,check,actual,eventShelfStock,comparisonStock,smaregiStock,smaregiCompareStock,difference};
    }).filter(Boolean);
  }

  function hasInventoryAdminAccessSafe(){
    return typeof hasInventoryPrivilegedAccess==="function" && hasInventoryPrivilegedAccess();
  }

  function getDiffRowActionsHtml(barcode,{includeExclude=false,includeEquipment=true}={}){
    return `<div class="diff-action-group">
      <button type="button" class="smaregi-diff-save-btn" data-barcode="${safeText(barcode)}">保存</button>
      <button type="button" class="secondary smaregi-diff-cause-btn" data-barcode="${safeText(barcode)}">原因確認</button>
      <button type="button" class="secondary smaregi-no-issue-btn" data-barcode="${safeText(barcode)}">問題なし</button>
      ${includeEquipment?`<button type="button" class="secondary smaregi-diff-equipment-btn" data-barcode="${safeText(barcode)}">商品転用</button>`:""}
      ${includeExclude?`<button type="button" class="secondary smaregi-diff-exclude-btn" data-barcode="${safeText(barcode)}">除外</button>`:""}
    </div>`;
  }

  function getSmaregiDiffProductSearchSort(){
    const key="arico_product_search_sort_smaregi_diff";
    const value=String(document.getElementById("smaregiDiffProductSearchSort")?.value||localStorage.getItem(key)||"name");
    return ["name","barcode","location","updated"].includes(value) ? value : "name";
  }

  function getDiffProductSearchText(){
    const value=document.getElementById("smaregiDiffProductSearchInput")?.value||"";
    return typeof normalizeSearchText==="function" ? normalizeSearchText(value) : String(value||"").trim().toLowerCase();
  }

  function getDiffProductHaystack(row){
    const item=row?.item||{};
    const barcode=String(getItemBarcode(item)||item.barcode||"");
    const product=typeof gp==="function" ? (gp(barcode)||{}) : {};
    const values=[
      getItemName(item),
      barcode,
      item.product_code,
      item.item_number,
      item.color,
      item.size,
      product.name,
      product.barcode,
      product.product_code,
      product.smaregi_product_id,
      product.item_number,
      product.part_number,
      product.color,
      product.size,
      product.location
    ];
    const text=values.filter(value=>value!==null&&value!==undefined).join(" ");
    return typeof normalizeSearchText==="function" ? normalizeSearchText(text) : String(text).toLowerCase();
  }

  function sortDiffRowsForDisplay(rows){
    const mode=getSmaregiDiffProductSearchSort();
    if(typeof sortProductsForDisplay!=="function"){
      return [...rows].sort((a,b)=>String(getItemName(a.item)||"").localeCompare(String(getItemName(b.item)||""),"ja"));
    }
    const mapped=rows.map((row,index)=>{
      const barcode=String(getItemBarcode(row.item)||row.item?.barcode||"");
      const product=typeof gp==="function" ? (gp(barcode)||{}) : {};
      return {
        ...row,
        __index:index,
        name:getItemName(row.item)||product.name||"",
        barcode,
        location:product.location||row.item?.location||"",
        updated_at:product.updated_at||row.item?.updated_at||row.item?.changed_at||""
      };
    });
    return sortProductsForDisplay(mapped,mode);
  }

  function bindSmaregiDiffProductSearchControls(){
    const input=document.getElementById("smaregiDiffProductSearchInput");
    const select=document.getElementById("smaregiDiffProductSearchSort");
    const key="arico_product_search_sort_smaregi_diff";
    if(input&&input.dataset.diffSearchBound!=="1"){
      input.dataset.diffSearchBound="1";
      input.addEventListener("input",()=>renderSmaregiDiffOnlyPanel());
    }
    if(select){
      select.value=getSmaregiDiffProductSearchSort();
      if(select.dataset.diffSortBound!=="1"){
        select.dataset.diffSortBound="1";
        select.addEventListener("change",()=>{
          localStorage.setItem(key,select.value||"name");
          renderSmaregiDiffOnlyPanel();
        });
      }
    }
  }

  function prepareEquipmentTransferFromDiff(barcode){
    const item=getAllMovementItems().find(row=>String(row.barcode||"")===String(barcode));
    if(typeof showInventoryScreen==="function")showInventoryScreen("inventory");
    const typeSelect=document.getElementById("type");
    if(typeSelect){
      const equipmentOption=[...typeSelect.options].find(option=>option.value==="備品転用" || option.textContent==="商品転用");
      if(equipmentOption)typeSelect.value=equipmentOption.value;
      typeSelect.dispatchEvent(new Event("change",{bubbles:true}));
    }
    const barcodeInput=document.getElementById("barcodeInput");
    if(barcodeInput){
      barcodeInput.value=barcode;
      barcodeInput.dispatchEvent(new Event("input",{bubbles:true}));
      barcodeInput.focus();
    }
    const qtyInput=document.getElementById("qty");
    if(qtyInput && !String(qtyInput.value||"").trim())qtyInput.value="1";
    const memoInput=document.getElementById("memo");
    if(memoInput && !String(memoInput.value||"").trim())memoInput.value=`棚卸差異から商品転用 ${getItemName(item)||barcode}`;
    showMessage?.("商品転用登録に移動しました。数量・担当者・備考を確認して登録してください。","ok");
  }

  function readNoIssueReason(){
    const reason=prompt("問題なしとして登録する理由・メモを入力してください。", "確認済み");
    if(reason===null)return null;
    return String(reason||"").trim();
  }

  async function markSmaregiDifferenceNoIssue(barcode,button=null){
    if(!smaregiSnapshot){
      showMessage?.("スマレジAPIから在庫変動を取得してから登録してください。","err");
      return false;
    }
    const item=getAllMovementItems().find(row=>String(row.barcode||"")===String(barcode));
    const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
    if(!item||!check){
      showMessage?.("問題なし登録する差異データが見つかりません。","err");
      return false;
    }
    const checkedBy=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
    if(!checkedBy){
      showMessage?.("担当者を選択してください。","err");
      const checker=document.getElementById("smaregiCheckerName");
      checker?.focus();
      return false;
    }
    const noIssueReason=readNoIssueReason();
    if(noIssueReason===null)return false;
    const smaregiStock=getCsvSmaregiStock(item);
    const smaregiCompareStock=getComparableCsvSmaregiStock(item);
    const stockBreakdown=typeof getSmaregiInventoryBreakdown==="function" ? getSmaregiInventoryBreakdown(item,check) : null;
    const actual=Number(stockBreakdown?.comparisonStock ?? check.actual_stock);
    const difference=Number.isFinite(actual)&&Number.isFinite(smaregiCompareStock) ? actual-smaregiCompareStock : check.difference;
    const ok=confirm([
      "この差異を今回の棚卸では「問題なし」として登録します。",
      "",
      `商品：${getItemName(item)||barcode}`,
      `バーコード：${barcode}`,
      `スマレジ在庫：${Number.isFinite(smaregiStock)?smaregiStock:"-"}`,
      `比較用在庫：${Number.isFinite(actual)?actual:"-"}`,
      `差異：${Number.isFinite(difference)?difference:"-"}`,
      "",
      "登録後、この商品は差異一覧・原因確認集計・差異件数から外れます。"
    ].join("\n"));
    if(!ok)return false;
    try{
      if(button)button.disabled=true;
      const noIssueAt=new Date().toISOString();
      const payload={
        no_issue:true,
        no_issue_by:checkedBy,
        no_issue_at:noIssueAt,
        no_issue_reason:noIssueReason,
        difference:Number.isFinite(difference) ? difference : check.difference,
        actual_stock:Number.isFinite(Number(check.actual_stock)) ? Number(check.actual_stock) : check.actual_stock,
        excluded:false
      };
      const savedRows=await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify(payload)
      });
      const savedRow=Array.isArray(savedRows)&&savedRows[0] ? savedRows[0] : {...check,...payload};
      smaregiStockChecks=smaregiStockChecks.filter(row=>String(row.barcode)!==String(barcode));
      smaregiStockChecks.push({...savedRow,snapshot_id:smaregiSnapshot.id,barcode});
      renderSmaregiDiffOnlyPanel();
      renderSmaregiStockChecks();
      updateSmaregiProgressOnly();
      if(typeof loadSmaregiAccuracy==="function")loadSmaregiAccuracy();
      if(typeof loadSmaregiDifferenceRanking==="function")loadSmaregiDifferenceRanking();
      if(typeof loadSmaregiReasonSummary==="function")loadSmaregiReasonSummary();
      showMessage?.(`問題なしとして登録しました：${getItemName(item)||barcode}`,"ok");
      return true;
    }catch(error){
      if(button)button.disabled=false;
      showMessage?.("問題なし登録エラー\n"+error.message,"err");
      return false;
    }
  }

  window.markSmaregiDifferenceNoIssue=markSmaregiDifferenceNoIssue;

  function getSmaregiDiffAutoLoadKey(){
    try{
      const context=typeof getSmaregiApiStoreContextForCheck==="function" ? getSmaregiApiStoreContextForCheck() : {};
      return String(context.storeCode||window.currentStore||"tokyo").trim().toLowerCase()||"tokyo";
    }catch(_){
      return String(window.currentStore||"tokyo").trim().toLowerCase()||"tokyo";
    }
  }

  function ensureSmaregiDiffDataLoaded(body,summary){
    const hasData=!!smaregiSnapshot || (Array.isArray(smaregiStockItems)&&smaregiStockItems.length>0);
    const loadKey=getSmaregiDiffAutoLoadKey();
    if(hasData || smaregiDiffAutoLoadedKey===loadKey)return false;
    if(typeof loadLatestSmaregiSnapshot!=="function")return false;

    if(summary)summary.textContent="スマレジAPIデータを読み込み中...";
    if(body)body.innerHTML='<tr><td colspan="9" class="smaregi-empty">スマレジAPIデータを読み込み中...</td></tr>';
    if(!smaregiDiffAutoLoadPromise){
      smaregiDiffAutoLoadPromise=Promise.resolve()
        .then(()=>loadLatestSmaregiSnapshot())
        .catch(error=>showMessage?.(`スマレジAPIデータ取得エラー\n${error.message}`,"err"))
        .finally(()=>{
          smaregiDiffAutoLoadedKey=loadKey;
          smaregiDiffAutoLoadPromise=null;
          setTimeout(()=>window.renderSmaregiDiffOnlyPanel?.(),0);
        });
    }
    return true;
  }

  window.renderSmaregiDiffOnlyPanel=function(){
    const panel=typeof el==="function" ? el("smaregiDiffOnlyPanel") : document.getElementById("smaregiDiffOnlyPanel");
    const body=typeof el==="function" ? el("smaregiDiffOnlyBody") : document.getElementById("smaregiDiffOnlyBody");
    const summary=typeof el==="function" ? el("smaregiDiffSummary") : document.getElementById("smaregiDiffSummary");
    if(!panel||!body)return;
    const headerRow=body.closest("table")?.querySelector("thead tr");
    if(headerRow){
      headerRow.innerHTML="<th>商品名</th><th>実在庫</th><th>イベント棚在庫</th><th>比較用在庫</th><th>スマレジ在庫</th><th>差異</th><th>担当者</th><th>チェック日時</th><th>操作</th>";
    }
    if(ensureSmaregiDiffDataLoaded(body,summary))return;
    const stats=getSmaregiStats();
    bindSmaregiDiffProductSearchControls();
    const allRows=getDiffRows();
    const keyword=getDiffProductSearchText();
    const rows=sortDiffRowsForDisplay(keyword ? allRows.filter(row=>getDiffProductHaystack(row).includes(keyword)) : allRows);
    if(summary)summary.textContent=`差異：${allRows.length}件 / 表示：${rows.length}件 / チェック済み：${stats.completed||0}件 / 未チェック：${stats.unchecked||0}件 / 除外：${stats.excluded||0}件`;
    const hasMovementData=getAllMovementItems().length>0;
    if(!hasMovementData){
      body.innerHTML='<tr><td colspan="9" class="smaregi-empty">スマレジ変動API未取得です。</td></tr>';
      return;
    }
    if(!rows.length){
      body.innerHTML='<tr><td colspan="9" class="smaregi-empty">差異のある商品はありません。</td></tr>';
      return;
    }
    body.innerHTML=rows.map(({item,check,actual,eventShelfStock,comparisonStock,smaregiStock,difference})=>{
      const barcode=String(item?.barcode||"");
      const name=getItemName(item)||"商品名未設定";
      const checkedBy=typeof getSmaregiDisplayCheckedBy==="function" ? getSmaregiDisplayCheckedBy(check) : (check?.checked_by||"");
      const differenceClass=difference<0 ? " is-negative" : " is-positive";
      const checkedAt=check?.checked_at && typeof fmt==="function" ? safeText(fmt(check.checked_at)) : "未入力";
      const showExclude=hasInventoryAdminAccessSafe();
      return `<tr class="smaregi-diff-row" data-barcode="${safeText(barcode)}">
        <td class="smaregi-diff-product-cell">
          <div class="smaregi-diff-pc-product">${safeText(name)}<div class="smaregi-movement-note">棚番：${safeText(getProductShelfLabel(gp(getItemBarcode(item))||{location:item.location||""}))}</div><div class="smaregi-movement-note">バーコード：${safeText(getItemBarcode(item)||"バーコードなし")}</div></div>
          <div class="smaregi-diff-mobile-card">
            <strong class="smaregi-diff-mobile-name">${safeText(name)}</strong>
            <div class="smaregi-diff-mobile-barcode">棚番：${safeText(getProductShelfLabel(gp(getItemBarcode(item))||{location:item.location||""}))}</div>
            <div class="smaregi-diff-mobile-barcode">バーコード：${safeText(getItemBarcode(item)||"バーコードなし")}</div>
            <div class="smaregi-diff-mobile-values">
              <label>実在庫<input type="number" class="smaregi-diff-actual-input smaregi-diff-mobile-actual-input" data-barcode="${safeText(barcode)}" min="0" step="1" inputmode="numeric" value="${safeText(actual)}"></label>
              <div><span>スマレジ在庫</span><strong>${displayNumber(smaregiStock)}</strong></div>
              <div><span>通常棚</span><strong>${displayNumber(actual)}</strong></div>
              <div><span>イベント棚在庫</span><strong>${displayNumber(eventShelfStock)}</strong></div>
              <div><span>比較用在庫</span><strong>${displayNumber(comparisonStock)}</strong></div>
              <div class="smaregi-diff-mobile-difference"><span>差異</span><strong class="smaregi-difference${differenceClass}">${difference}</strong></div>
              <div><span>最終更新日時</span><strong>${checkedAt}</strong></div>
            </div>
            ${getDiffRowActionsHtml(barcode,{includeExclude:showExclude,includeEquipment:true})}
          </div>
        </td>
        <td><input type="number" class="smaregi-diff-actual-input smaregi-diff-pc-actual-input" data-barcode="${safeText(barcode)}" min="0" step="1" inputmode="numeric" value="${safeText(actual)}"></td>
        <td>${displayNumber(eventShelfStock)}</td>
        <td>${displayNumber(comparisonStock)}</td>
        <td>${displayNumber(smaregiStock)}</td>
        <td><span class="smaregi-difference${differenceClass}">${difference}</span></td>
        <td>${safeText(checkedBy||"担当者未設定")}</td>
        <td>${checkedAt}</td>
        <td>${getDiffRowActionsHtml(barcode,{includeExclude:showExclude,includeEquipment:true})}</td>
      </tr>`;
    }).join("");
    body.querySelectorAll(".smaregi-diff-save-btn").forEach(button=>{
      button.onclick=()=>saveSmaregiDiffActualStock(button);
    });
    body.querySelectorAll(".smaregi-diff-cause-btn").forEach(button=>{
      button.onclick=()=>{
        if(typeof showSmaregiCauseDetail==="function")showSmaregiCauseDetail(button.dataset.barcode);
      };
    });
    body.querySelectorAll(".smaregi-no-issue-btn").forEach(button=>{
      button.onclick=()=>markSmaregiDifferenceNoIssue(button.dataset.barcode,button);
    });
    body.querySelectorAll(".smaregi-diff-equipment-btn").forEach(button=>{
      button.onclick=()=>prepareEquipmentTransferFromDiff(button.dataset.barcode);
    });
    body.querySelectorAll(".smaregi-diff-exclude-btn").forEach(button=>{
      button.onclick=()=>{
        if(!hasInventoryAdminAccessSafe()){
          showMessage?.("除外は管理者認証後に実行できます。","err");
          return;
        }
        if(typeof excludeSmaregiStockItem==="function")excludeSmaregiStockItem(button.dataset.barcode,button);
      };
    });
  };

  function readActualStockValue(input){
    const rawValue=String(input?.value??"").trim();
    if(rawValue===""){
      showMessage?.("実在庫を入力してください。0は保存できます。","err");
      input?.focus();
      return null;
    }
    const value=Number(rawValue);
    if(!Number.isInteger(value) || value<0){
      showMessage?.("実在庫は0以上の整数で入力してください。","err");
      input?.focus();
      return null;
    }
    return value;
  }

  async function saveSmaregiDiffActualStock(button){
    const mobileCard=button?.closest(".smaregi-diff-mobile-card");
    const input=mobileCard?.querySelector(".smaregi-diff-mobile-actual-input")
      || button?.closest("tr")?.querySelector(".smaregi-diff-pc-actual-input")
      || button?.closest("tr")?.querySelector(".smaregi-diff-actual-input");
    const actualStock=readActualStockValue(input);
    if(actualStock===null)return false;
    const barcode=String(button?.dataset?.barcode||"");
    return saveSmaregiActualStockCore(barcode,actualStock,button,{markCorrected:true});
  }

  function ensureSmaregiCsvClearButton(){
    const existing=document.getElementById("clearSmaregiMovementCsvBtn");
    if(existing)existing.hidden=true;
    return;
    const host=document.getElementById("smaregiCheckFilterControls")
      || document.querySelector(".smaregi-check-filter-controls")
      || document.getElementById("smaregiStockProgress")
      || document.getElementById("smaregiStockCheckCard");
    if(!host)return;
    let button=document.getElementById("clearSmaregiMovementCsvBtn");
    const canManage=typeof hasInventoryPrivilegedAccess!=="function" || hasInventoryPrivilegedAccess();
    if(!canManage){
      if(button)button.hidden=true;
      return;
    }
    if(!button){
      button=document.createElement("button");
      button.type="button";
      button.id="clearSmaregiMovementCsvBtn";
      button.className="secondary smaregi-clear-csv-button";
      button.textContent="取込済みスマレジ変動CSVを削除";
      host.appendChild(button);
    }
    button.hidden=false;
    button.onclick=clearSmaregiMovementCsvImports;
  }

  window.clearSmaregiMovementCsvImports=async function(){
    if(typeof hasInventoryPrivilegedAccess==="function" && !hasInventoryPrivilegedAccess()){
      showMessage?.("管理者認証後に実行できます。","err");
      return;
    }
    const ok=confirm("取込済みスマレジ変動CSVデータを削除します。\n削除対象は smaregi_stock_changes のみです。\n商品マスター、実在庫、棚卸履歴、担当者設定、前回チェック完了日時は削除しません。\n実行しますか？");
    if(!ok)return;
    try{
      await sb("smaregi_stock_changes?smaregi_change_id=not.is.null",{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      if(Array.isArray(smaregiStockItems))smaregiStockItems.length=0;
      smaregiStockChecks=[];
      smaregiSnapshot=null;
      try{ smaregiLatestChangeByBarcode.clear(); }catch(_){}
      updateSmaregiProgressOnly();
      renderSmaregiDiffOnlyPanel();
      renderSmaregiStockChecks();
      showPopup?.("削除完了","取込済みスマレジ変動CSVデータを削除しました。");
      showMessage?.("取込済みスマレジ変動CSVデータを削除しました。","ok");
    }catch(error){
      showMessage?.("スマレジ変動CSV削除エラー\n"+error.message,"err");
    }
  };

  function getActualInputFromButton(button){
    const row=button?.closest("tr");
    return row?.querySelector(".smaregi-actual-stock-input") || null;
  }

  function readActualStockFromButton(button){
    const input=getActualInputFromButton(button);
    console.log("[smaregi actual stock save]",{
      barcode:button?.dataset?.barcode||"",
      rawValue:String(input?.value??"").trim()
    });
    return readActualStockValue(input);
  }

  window.saveSmaregiActualStockFromRow=async function(button){
    const barcode=String(button?.dataset?.barcode||"");
    const actualStock=readActualStockFromButton(button);
    if(actualStock===null)return false;
    return saveSmaregiActualStockCore(barcode,actualStock,button);
  };

  async function saveSmaregiActualStockCore(barcode,actualStock,button,{markCorrected=false}={}){
    if(!smaregiSnapshot){
      showMessage?.("スマレジAPIから在庫変動を取得してから保存してください。","err");
      return false;
    }
    const item=getAllMovementItems().find(row=>String(row.barcode||"")===barcode);
    if(!item){
      showMessage?.("対象商品が見つかりません。","err");
      return false;
    }
    const checkedBy=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
    if(!checkedBy){
      showMessage?.("担当者を選択してください。","err");
      const checker=document.getElementById("smaregiCheckerName");
      checker?.focus();
      return false;
    }
    try{
      button.disabled=true;
      const checkedAt=new Date().toISOString();
      const smaregiStock=Number(getCsvSmaregiStock(item) ?? 0);
      const smaregiCompareStock=Number(getComparableCsvSmaregiStock(item) ?? 0);
      const previousCheck=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
      const eventBreakdown=typeof getSmaregiInventoryBreakdown==="function"
        ? getSmaregiInventoryBreakdown(item,{...previousCheck,actual_stock:actualStock})
        : null;
      const comparisonStock=Number(eventBreakdown?.comparisonStock ?? actualStock);
      const payload={
        snapshot_id:smaregiSnapshot.id,
        barcode,
        actual_stock:actualStock,
        difference:Number.isFinite(comparisonStock) ? comparisonStock-smaregiCompareStock : actualStock-smaregiCompareStock,
        checked_by:checkedBy,
        checked_at:checkedAt,
        excluded:false,
        no_issue:previousCheck?.no_issue===true,
        no_issue_by:previousCheck?.no_issue_by||null,
        no_issue_at:previousCheck?.no_issue_at||null,
        no_issue_reason:previousCheck?.no_issue_reason||"",
        difference_reason_category:previousCheck?.difference_reason_category||null,
        difference_reason_memo:previousCheck?.difference_reason_memo||"",
        difference_reason_by:previousCheck?.difference_reason_by||null,
        difference_reason_at:previousCheck?.difference_reason_at||null,
        actual_corrected:markCorrected||previousCheck?.actual_corrected===true,
        actual_corrected_by:markCorrected ? checkedBy : (previousCheck?.actual_corrected_by||null),
        actual_corrected_at:markCorrected ? checkedAt : (previousCheck?.actual_corrected_at||null)
      };
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
      smaregiStockChecks=smaregiStockChecks.filter(row=>String(row.barcode)!==barcode);
      smaregiStockChecks.push({...savedRow,snapshot_id:smaregiSnapshot.id,barcode,actual_stock:actualStock,checked_by:checkedBy,checked_at:checkedAt});
      showMessage?.(`実在庫を保存しました：${getItemName(item)}`,"ok");
      renderSmaregiStockChecks();
      return true;
    }catch(error){
      button.disabled=false;
      showMessage?.("実在庫保存エラー\n"+error.message,"err");
      return false;
    }
  }

  function mergeRowsById(rows){
    const seen=new Set();
    return (rows||[]).filter(row=>{
      const key=String(row?.id || JSON.stringify(row));
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    });
  }

  function smaregiHistoryDedupeKey(row){
    const identity=String(row?.barcode||row?.product_code||row?.product_name||"").trim();
    const changedAt=String(getChangeDateValue(row)||"").trim();
    const amount=String(row?.amount??row?.movement_quantity??"").trim();
    const stock=String(row?.stock_amount??row?.smaregi_stock_quantity??row?.tokyo_stock??row?.aichi_stock??"").trim();
    return [identity,changedAt,amount,stock].join("|");
  }

  function dedupeSmaregiHistoryRows(rows){
    const seen=new Set();
    return (rows||[]).filter(row=>{
      const key=smaregiHistoryDedupeKey(row);
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    });
  }

  async function loadInventoryLogsForCause(barcode,productName){
    const results=[];
    try{
      if(barcode){
        const direct=await sbAll(`inventory_logs?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=created_at.desc`,1000,10000);
        if(Array.isArray(direct))results.push(...direct);
      }
    }catch(error){
      console.warn("[cause inventory_logs by barcode]",error);
    }
    if(!results.length && barcode && typeof loadProductHistoryByBarcode==="function"){
      try{
        const fallback=await loadProductHistoryByBarcode(barcode);
        if(Array.isArray(fallback))results.push(...fallback);
      }catch(error){
        console.warn("[cause loadProductHistoryByBarcode]",error);
      }
    }
    if(!results.length && !barcode && productName){
      try{
        const byName=await sbAll(`inventory_logs?select=*&product_name=ilike.*${encodeURIComponent(productName)}*&order=created_at.desc`,1000,10000);
        if(Array.isArray(byName))results.push(...byName);
      }catch(error){
        console.warn("[cause inventory_logs by product name]",error);
      }
    }
    return mergeRowsById(results);
  }

  async function loadSmaregiChangesForCause(barcode,productName){
    const results=[];
    try{
      if(barcode){
        const direct=await sbAll(`smaregi_stock_changes?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=changed_at.desc`,1000,20000);
        if(Array.isArray(direct))results.push(...direct);
      }
    }catch(error){
      console.warn("[cause smaregi_stock_changes by barcode]",error);
    }
    if(!results.length && productName){
      try{
        const byName=await sbAll(`smaregi_stock_changes?select=*&product_name=ilike.*${encodeURIComponent(productName)}*&order=changed_at.desc`,1000,20000);
        if(Array.isArray(byName))results.push(...byName);
      }catch(error){
        console.warn("[cause smaregi_stock_changes by product name]",error);
      }
    }
    return dedupeSmaregiHistoryRows(mergeRowsById(results)).sort((a,b)=>new Date(getChangeDateValue(b)||0)-new Date(getChangeDateValue(a)||0));
  }

  function renderCauseAppLogRows(logs,barcode){
    const lastCheckTime=getLastCheckTimeValue();
    const lastCheckLabel=typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe();
    const rows=[];
    if(!logs.length){
      rows.push(`<tr><td colspan="7">バーコード ${safeText(barcode||"未設定")} の在庫管理側履歴はありません。</td></tr>`);
    }
    const newestLogs=[];
    const olderLogs=[];
    logs.forEach(log=>{
      const logTime=new Date(log.created_at).getTime();
      if(Number.isFinite(logTime) && logTime<=lastCheckTime)olderLogs.push(log);
      else newestLogs.push(log);
    });
    const sortedLogs=[...logs].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    let runningStock=null;
    try{
      const product=typeof gp==="function" ? gp(barcode) : null;
      const current=parseStockNumber(product?.base_stock);
      if(current!==null)runningStock=current;
    }catch(_){}
    const derivedStockMap=new Map();
    sortedLogs.forEach(log=>{
      const typeValue=String(log.type||"").trim();
      const memoValue=String(log.memo||log.note||"");
      const isEquipmentCancelLog=memoValue.includes("備品転用キャンセル");
      const rawQty=parseStockNumber(log.quantity ?? log.qty ?? log.amount);
      const qty=rawQty===null ? 0 : rawQty;
      let after=parseStockNumber(log.after_stock ?? log.stock_after ?? log.base_stock_after);
      let before=parseStockNumber(log.before_stock ?? log.stock_before ?? log.base_stock_before);
      if(after===null && runningStock!==null)after=runningStock;
      let delta=qty;
      if(isEquipmentCancelLog || typeValue==="入荷" || typeValue==="蜈･闕ｷ" || typeValue==="stock_in" || typeValue==="event_return" || typeValue==="equipment_transfer_cancel" || typeValue==="商品転用キャンセル"){
        delta=Math.abs(qty);
      }else if(typeValue==="出荷" || typeValue==="備品転用" || typeValue==="蜃ｺ闕ｷ" || typeValue==="蛯吝刀霆｢逕ｨ" || typeValue==="stock_out" || typeValue==="equipment_transfer" || typeValue==="event_pick"){
        delta=qty>0 ? -qty : qty;
      }else if(typeValue==="在庫修正" || typeValue==="蝨ｨ蠎ｫ菫ｮ豁｣" || typeValue==="stock_adjustment"){
        if(after===null && rawQty!==null)after=qty;
        delta=before!==null && after!==null ? after-before : 0;
      }
      if(before===null && after!==null && Number.isFinite(delta))before=after-delta;
      derivedStockMap.set(log,{before,after,delta});
      if(before!==null)runningStock=before;
    });
    const renderLog=(log)=>{
      const type=String(log.memo||log.note||"").includes("備品転用キャンセル")
        ? "商品転用キャンセル"
        : (INVENTORY_TYPE_LABELS[String(log.type||"").trim()] || log.type || "");
      const staff=log.staff || log.staff_name || log.created_by || "";
      const memo=log.memo || log.note || "";
      const stock=derivedStockMap.get(log)||{};
      const before=stock.before ?? "";
      const after=stock.after ?? "";
      const delta=stock.delta ?? (log.quantity ?? log.qty ?? log.amount ?? "");
      return `<tr>
        <td>${safeText(log.created_at && typeof fmt==="function" ? fmt(log.created_at) : log.created_at || "")}</td>
        <td>${safeText(type)}</td>
        <td>${safeText(before===""?"-":before)}</td>
        <td class="${signedClass(delta)}">${safeText(formatSignedDisplay(delta))}</td>
        <td>${safeText(after===""?"-":after)}</td>
        <td>${safeText(memo||"-")}</td>
        <td>${safeText(staff||"-")}</td>
      </tr>`;
    };
    rows.push(...newestLogs.map(renderLog));
    if(Number.isFinite(lastCheckTime)){
      rows.push(`<tr class="smaregi-last-check-divider"><td colspan="7">前回チェック締め：${safeText(lastCheckLabel)}</td></tr>`);
    }
    rows.push(...olderLogs.slice(0,5).map(renderLog));
    return rows.join("");
  }
  function renderCauseSmaregiRows(changes,barcode){
    if(!changes.length){
      return `<tr><td colspan="7">バーコード ${safeText(barcode||"未設定")} のCSV取込済み履歴はありません。</td></tr>`;
    }
    const lastCheckTime=getLastCheckTimeValue();
    const rows=[];
    const newestChanges=[];
    const olderChanges=[];
    changes.forEach(change=>{
      const changedAt=getChangeDateValue(change);
      const changedTime=new Date(changedAt).getTime();
      if(Number.isFinite(changedTime) && changedTime<=lastCheckTime)olderChanges.push(change);
      else newestChanges.push(change);
    });
    const renderChange=(change)=>{
      const changedAt=getChangeDateValue(change);
      const afterStock=typeof window.getSavedSmaregiStockValue==="function"
        ? window.getSavedSmaregiStockValue(change)
        : parseStockNumber(change?.stock_amount);
      const qty=parseStockNumber(change.amount ?? change.movement_quantity);
      const beforeStock=afterStock!==null && qty!==null ? afterStock-qty : null;
      const staff=change.staff_name || change.staff || change.operator_name || change.created_by || "-";
      const memo=change.memo || change.movement_reason || change.reason || "-";
      return `<tr>
        <td>${safeText(changedAt && typeof fmt==="function" ? fmt(changedAt) : changedAt || "")}</td>
        <td>${safeText(getSmaregiStockDivisionLabel(change.stock_division || change.movement_type || ""))}</td>
        <td>${safeText(beforeStock===null?"-":beforeStock)}</td>
        <td class="${signedClass(qty)}">${safeText(qty===null?"-":formatSignedDisplay(qty))}</td>
        <td>${safeText(afterStock===null?"-":afterStock)}</td>
        <td>${safeText(memo)}</td>
        <td>${safeText(staff)}</td>
      </tr>`;
    };
    rows.push(...newestChanges.map(renderChange));
    if(Number.isFinite(lastCheckTime)){
      rows.push(`<tr class="smaregi-last-check-divider"><td colspan="7">前回チェック締め：${safeText(typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe())}</td></tr>`);
    }
    rows.push(...olderChanges.slice(0,5).map(renderChange));
    return rows.join("");
  }
  window.showSmaregiCauseDetail=async function(barcode){
    if(typeof isSmaregiManager==="function" && !isSmaregiManager()){
      showMessage?.("原因確認は分析画面のパスワード認証後に操作できます。","err");
      return;
    }
    const detail=typeof el==="function" ? el("smaregiCauseDetail") : document.getElementById("smaregiCauseDetail");
    const item=getAllMovementItems().find(row=>String(row.barcode||"")===String(barcode));
    if(!detail||!item)return;
    const itemName=getItemName(item)||"商品名未設定";
    const itemBarcode=getItemBarcode(item)||barcode||"";
    showMessage?.("原因確認データを読み込み中...");
    detail.hidden=false;
    detail.innerHTML='<div class="message">原因確認データを読み込み中...</div>';
    try{
      const lastCheckTime=getLastCheckTimeValue();
      const [allAppLogs,allSmaregiChanges]=await Promise.all([
        loadInventoryLogsForCause(itemBarcode,itemName),
        loadSmaregiChangesForCause(itemBarcode,itemName)
      ]);
      const appLogs=allAppLogs;
      const smaregiChanges=allSmaregiChanges;
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(itemBarcode) : null;
      const targetStockInfo=getTargetSmaregiStock(item);
      const smaregiStock=targetStockInfo.raw;
      const smaregiCompareStock=targetStockInfo.compare;
      const storeLabel=getInventoryStoreLabelSafe();
      const actual=check?.actual_stock ?? "";
      const breakdown=typeof getSmaregiInventoryBreakdown==="function"
        ? getSmaregiInventoryBreakdown(item,check)
        : null;
      const eventShelfStock=Number(breakdown?.eventShelfStock ?? 0);
      const comparisonStock=Number(breakdown?.comparisonStock ?? Number(actual||0));
      const difference=actual===""||actual===null||actual===undefined||smaregiCompareStock===null || !Number.isFinite(comparisonStock)
        ? "-"
        : comparisonStock-Number(smaregiCompareStock);
      const aiKey=String(itemBarcode||barcode||"");
      if(!window.__smaregiCauseAiPayloads)window.__smaregiCauseAiPayloads=new Map();
      window.__smaregiCauseAiPayloads.set(aiKey,{
        summary:{
          product_name:itemName,
          barcode:itemBarcode,
          store:storeLabel,
          actual_stock:actual===""?"未入力":actual,
          event_shelf_stock:Number.isFinite(eventShelfStock)?eventShelfStock:"未取得",
          comparison_stock:Number.isFinite(comparisonStock)?comparisonStock:"未取得",
          smaregi_stock:smaregiStock===null?"未取得":smaregiStock,
          difference,
          last_checked_at:getLastCheckedAtSafe()
        },
        arico_logs:appLogs.slice(0,80).map(log=>({
          created_at:log.created_at,
          type:INVENTORY_TYPE_LABELS[String(log.type||"").trim()] || log.type || "",
          quantity:log.quantity ?? log.qty ?? log.amount ?? "",
          memo:log.memo || log.note || "",
          staff:log.staff || log.staff_name || log.created_by || "",
          smaregi_manual_checked:log.equipment_checked===true || !!log.equipment_checked_at,
          smaregi_manual_checked_by:log.equipment_checked_by || "",
          smaregi_manual_checked_at:log.equipment_checked_at || ""
        })),
        smaregi_changes:smaregiChanges.slice(0,80).map(change=>({
          changed_at:getChangeDateValue(change),
          type:getSmaregiStockDivisionLabel(change.stock_division || change.movement_type || ""),
          quantity:change.amount ?? change.movement_quantity ?? "",
          stock_after:typeof window.getSavedSmaregiStockValue==="function" ? window.getSavedSmaregiStockValue(change) : change.stock_amount,
          memo:change.memo || change.movement_reason || change.reason || "",
          staff:change.staff_name || change.staff || change.operator_name || change.created_by || ""
        }))
      });
      detail.innerHTML=`
        <div class="smaregi-cause-shell">
        <div class="smaregi-cause-header">
          <div class="smaregi-cause-title">
            <h3>原因確認</h3>
            <div><strong>商品名：</strong>${safeText(itemName)}</div>
            <div><strong>棚番：</strong>${safeText(getProductShelfLabel(gp(itemBarcode)||{location:item.location||""}))}</div>
            <div><strong>バーコード：</strong>${safeText(itemBarcode||"バーコードなし")}</div>
          </div>
          <div class="smaregi-cause-header-actions">
            <button type="button" class="smaregi-cause-ai-btn primary-cause-ai" data-barcode="${safeText(aiKey)}">ChatGPT用プロンプトをコピー</button>
            <button type="button" class="secondary close-smaregi-cause-detail-btn">閉じる</button>
            <div class="smaregi-cause-store-badge">店舗：${safeText(storeLabel)}</div>
          </div>
        </div>
        <div class="smaregi-cause-summary-row">
          <div class="smaregi-cause-summary-card is-formula-input">
            <strong>実在庫（アプリ）</strong>
            <span class="is-app-stock">${safeText(actual===""?"未入力":actual)}</span>
          </div>
          <div class="smaregi-cause-summary-operator">+</div>
          <div class="smaregi-cause-summary-card is-formula-input">
            <strong>イベント棚在庫</strong>
            <span>${safeText(Number.isFinite(eventShelfStock)?eventShelfStock:"未取得")}</span>
          </div>
          <div class="smaregi-cause-summary-operator">=</div>
          <div class="smaregi-cause-summary-card is-comparison-card">
            <strong>比較用在庫</strong>
            <span class="is-app-stock">${safeText(Number.isFinite(comparisonStock)?comparisonStock:"未取得")}</span>
          </div>
          <div class="smaregi-cause-summary-operator">−</div>
          <div class="smaregi-cause-summary-card is-formula-input">
            <strong>スマレジ在庫（${safeText(storeLabel)}）</strong>
            <span class="is-smaregi-stock">${safeText(smaregiStock===null?"未取得":smaregiStock)}</span>
          </div>
          <div class="smaregi-cause-summary-operator">=</div>
          <div class="smaregi-cause-summary-card is-difference-card">
            <strong>差異</strong>
            <span class="smaregi-difference${Number(difference)<0 ? " is-negative" : (Number(difference)>0 ? " is-positive" : " is-zero")}">${safeText(difference)}</span>
          </div>
          <div class="smaregi-cause-summary-card is-last-check-card">
            <strong>前回チェック締め日時</strong>
            <span>${safeText(typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe())}</span>
          </div>
        </div>
        <div class="smaregi-cause-ai-panel is-prominent">
          <div>
            <strong>ChatGPT分析</strong>
            <span>差異情報と履歴をまとめてコピーします。ChatGPTに貼り付けて原因候補を確認してください。</span>
          </div>
          <button type="button" class="smaregi-cause-ai-btn primary-cause-ai" data-barcode="${safeText(aiKey)}">ChatGPT用プロンプトをコピー</button>
          <div class="smaregi-cause-ai-result" id="smaregiCauseAiResult_${safeText(aiKey).replace(/[^a-zA-Z0-9_-]/g,"_")}"></div>
        </div>
        <div class="smaregi-cause-guide">在庫管理側の履歴とスマレジ側の在庫変動履歴を比較して、差異の原因を確認してください。</div>
        <div class="smaregi-reason-form">
          <label>原因カテゴリ
            <select id="smaregiDifferenceReasonCategory">
              <option value="">選択してください</option>
              ${((window.SMAREGI_DIFFERENCE_REASON_CATEGORIES)||(typeof SMAREGI_DIFFERENCE_REASON_CATEGORIES!=="undefined" ? SMAREGI_DIFFERENCE_REASON_CATEGORIES : [])).map(category=>`<option value="${safeText(category)}" ${check?.difference_reason_category===category?"selected":""}>${safeText(category)}</option>`).join("")}
            </select>
          </label>
          <label>原因メモ
            <input id="smaregiDifferenceReasonMemo" value="${safeText(check?.difference_reason_memo||"")}" placeholder="状況や再発防止に必要な補足を入力"/>
          </label>
          <button type="button" id="saveSmaregiDifferenceReasonBtn">原因を保存</button>
        </div>
        <p class="section-note">原因記入者：${safeText(check?.difference_reason_by||"未記入")} / 原因記入日時：${safeText(check?.difference_reason_at&&typeof fmt==="function" ? fmt(check.difference_reason_at) : check?.difference_reason_at||"未記入")}</p>
        <div class="smaregi-cause-history-grid">
          <section class="smaregi-cause-history-card">
            <h3>在庫管理側の履歴</h3>
            <p class="section-note">アプリで記録された在庫の増減履歴です。</p>
            <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>処理前在庫</th><th>数量</th><th>処理後在庫</th><th>備考</th><th>担当者</th></tr></thead><tbody>${renderCauseAppLogRows(appLogs,itemBarcode)}</tbody></table></div>
          </section>
          <section class="smaregi-cause-history-card">
            <h3>スマレジ側の在庫変動履歴</h3>
            <p class="section-note">スマレジAPIから取得した指定店舗の在庫変動履歴です。</p>
            <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>処理前在庫</th><th>数量</th><th>処理後在庫</th><th>備考</th><th>担当者</th></tr></thead><tbody>${renderCauseSmaregiRows(smaregiChanges,itemBarcode)}</tbody></table></div>
          </section>
        </div>
        <div class="smaregi-cause-footnote">スマレジ側の在庫は、API取得時に保存した在庫数をそのまま表示しています。</div>
        </div>
      `;
      detail.querySelectorAll(".close-smaregi-cause-detail-btn").forEach(closeButton=>{
        closeButton.onclick=()=>{
          detail.hidden=true;
          detail.innerHTML="";
        };
      });
      const saveButton=detail.querySelector("#saveSmaregiDifferenceReasonBtn");
      if(saveButton)saveButton.onclick=e=>{
        if(typeof saveSmaregiDifferenceReason==="function")saveSmaregiDifferenceReason(itemBarcode,e.currentTarget);
      };
      detail.querySelectorAll(".smaregi-cause-ai-btn").forEach(button=>{
        button.onclick=()=>copySmaregiCausePromptForChatGpt(button.dataset.barcode,button);
      });
      showMessage?.(`原因確認を表示しました：${itemName}`,"ok");
      detail.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){
      detail.innerHTML=`<div class="message err">原因確認データ取得エラー。\n${safeText(error.message)}</div>`;
      showMessage?.("原因確認データ取得エラー。\n"+error.message,"err");
    }
  };

  function buildSmaregiCausePrompt(payload){
    const summary=payload?.summary||{};
    return [
      "ARICO在庫管理のスマレジ在庫差異について、原因候補を分析してください。",
      "",
      "あなたは分析のみを行ってください。ARICO在庫変更、スマレジ在庫変更、原因カテゴリ確定、確認済み変更、履歴削除は行わないでください。",
      "",
      "出力形式:",
      "【原因候補】",
      "【確信度】高 / 中 / 低",
      "【根拠】",
      "【確認推奨】",
      "",
      "差異サマリー:",
      `商品名: ${summary.product_name||"-"}`,
      `バーコード: ${summary.barcode||"-"}`,
      `対象店舗: ${summary.store||"-"}`,
      `実在庫（ARICO）: ${summary.actual_stock ?? "-"}`,
      `イベント棚在庫: ${summary.event_shelf_stock ?? "-"}`,
      `比較用在庫（実在庫 + イベント棚在庫）: ${summary.comparison_stock ?? "-"}`,
      `スマレジ在庫: ${summary.smaregi_stock ?? "-"}`,
      `差異: ${summary.difference ?? "-"}`,
      `前回チェック締め日時: ${summary.last_checked_at||"-"}`,
      "",
      "ARICO側在庫変動履歴:",
      JSON.stringify(payload?.arico_logs||[],null,2),
      "",
      "スマレジ側在庫変動履歴:",
      JSON.stringify(payload?.smaregi_changes||[],null,2),
      "",
      "確認観点:",
      "- 商品転用、ガチャ、ガチャ戻し、イベント持ち出し、入荷、出荷、棚卸修正の差分を見てください。",
      "- 担当者、備考、スマレジ手動確認済み/未確認も参考にしてください。",
      "- 前回チェック締め以降の履歴を優先し、必要に応じて直前の履歴も参考にしてください。"
    ].join("\n");
  }

  async function copyTextToClipboard(text){
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea=document.createElement("textarea");
    textarea.value=text;
    textarea.setAttribute("readonly","");
    textarea.style.position="fixed";
    textarea.style.left="-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try{
      return document.execCommand("copy");
    }finally{
      textarea.remove();
    }
  }

  async function copySmaregiCausePromptForChatGpt(barcode,button){
    const key=String(barcode||"");
    const payload=window.__smaregiCauseAiPayloads?.get(key);
    const resultId=`smaregiCauseAiResult_${key.replace(/[^a-zA-Z0-9_-]/g,"_")}`;
    const resultEl=document.getElementById(resultId);
    if(!payload){
      showMessage?.("コピー対象の原因確認データが見つかりません。","err");
      return;
    }
    const oldText=button?.textContent;
    try{
      if(button){button.disabled=true;button.textContent="コピー中...";}
      const prompt=buildSmaregiCausePrompt(payload);
      const copied=await copyTextToClipboard(prompt);
      if(!copied)throw new Error("クリップボードへコピーできませんでした。");
      if(resultEl)resultEl.innerHTML='<div class="message ok">ChatGPT用プロンプトをコピーしました。ChatGPTを開いて貼り付けてください。</div>';
      showMessage?.("ChatGPT用プロンプトをコピーしました。","ok");
    }catch(error){
      if(resultEl)resultEl.innerHTML=`<div class="message err">コピーエラー：${safeText(error.message)}</div>`;
      showMessage?.("コピーエラー\n"+error.message,"err");
    }finally{
      if(button){button.disabled=false;button.textContent=oldText||"ChatGPT用プロンプトをコピー";}
    }
  }

  window.renderSmaregiStockChecks=function(){
    const body=typeof el==="function" ? el("smaregiStockCheckBody") : document.getElementById("smaregiStockCheckBody");
    if(!body)return;
    const drafts=collectDraftValues();
    setSmaregiCheckTableHeader();
    if(typeof ensureSmaregiCheckFilterControls==="function")ensureSmaregiCheckFilterControls();
    ensureSmaregiCsvClearButton();
    const complete=typeof el==="function" ? el("completeSmaregiStockCheckBtn") : document.getElementById("completeSmaregiStockCheckBtn");
    const hasMovementData=getAllMovementItems().length>0;
    const emptyColspan=canShowExcludeColumn()?4:3;
    if(!hasMovementData){
      body.innerHTML=`<tr><td colspan="${emptyColspan}">スマレジAPIから在庫変動を取得すると、前回チェック完了以降の変動商品が表示されます。</td></tr>`;
      updateSmaregiProgressOnly();
      if(complete)complete.disabled=true;
      renderSmaregiDiffOnlyPanel();
      return;
    }

    updateSmaregiProgressOnly();
    const visible=getSmaregiFilteredTargetItems();
    if(!visible.length){
      body.innerHTML=`<tr><td colspan="${emptyColspan}">条件に一致するチェック対象商品はありません。</td></tr>`;
      renderSmaregiDiffOnlyPanel();
      return;
    }

    body.innerHTML=visible.map(item=>{
      const barcode=String(item.barcode||"");
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
      const checked=!!check;
      const savedActual=check?.actual_stock ?? "";
      const actual=drafts.has(barcode) ? drafts.get(barcode) : savedActual;
      const excludeCell=canShowExcludeColumn()
        ? `<td><button type="button" class="secondary smaregi-row-exclude-btn" data-barcode="${safeText(barcode)}">除外</button></td>`
        : "";
      return `<tr class="smaregi-work-row ${checked?"is-checked":"is-unchecked"}">
        <td>${buildProductInfo(item)}</td>
        <td><input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="smaregi-actual-stock-input" data-barcode="${safeText(barcode)}" value="${safeText(actual)}"></td>
        <td><button type="button" class="smaregi-row-save-btn" data-barcode="${safeText(barcode)}">${checked?"保存済み":"保存"}</button></td>
        ${excludeCell}
      </tr>`;
    }).join("");

    body.querySelectorAll(".smaregi-row-save-btn").forEach(button=>{
      button.onclick=()=>saveSmaregiActualStockFromRow(button);
    });
    body.querySelectorAll(".smaregi-row-exclude-btn").forEach(button=>{
      button.onclick=()=>{
        if(typeof hasInventoryPrivilegedAccess==="function" && !hasInventoryPrivilegedAccess()){
          showMessage?.("除外は管理者認証後に実行できます。","err");
          return;
        }
        if(typeof excludeSmaregiStockItem==="function")excludeSmaregiStockItem(button.dataset.barcode,button);
      };
    });
    renderSmaregiDiffOnlyPanel();
  };

  function bindFinalRefreshButton(){
    const button=document.getElementById("refreshSmaregiChecksBtn");
    if(!button||button.dataset.finalRefreshBound==="1")return;
    button.dataset.finalRefreshBound="1";
    button.onclick=async ()=>{
      try{
        button.disabled=true;
        if(typeof refreshSmaregiChecksFromSupabase==="function"){
          await refreshSmaregiChecksFromSupabase();
        }else if(typeof loadLatestSmaregiSnapshot==="function"){
          await loadLatestSmaregiSnapshot();
        }
        renderSmaregiStockChecks();
        showMessage?.("最新状態に更新しました。","ok");
      }catch(error){
        showMessage?.("最新状態の更新エラー\n"+error.message,"err");
      }finally{
        button.disabled=false;
      }
    };
  }

  function bindPopupKeyboardClose(){
    if(document.body?.dataset.smaregiFinalPopupKeys==="1")return;
    if(document.body)document.body.dataset.smaregiFinalPopupKeys="1";
    document.addEventListener("keydown",event=>{
      if(event.key!=="Enter" && event.key!=="Escape")return;
      const confirmPopup=[...document.querySelectorAll(".app-confirm-popup")]
        .find(popup=>getComputedStyle(popup).display!=="none");
      if(confirmPopup){
        event.preventDefault();
        if(event.key==="Escape"){
          confirmPopup.querySelector(".app-confirm-cancel-btn")?.click();
        }else{
          confirmPopup.querySelector(".app-confirm-ok-btn")?.click();
        }
        return;
      }
      const popup=document.getElementById("appPopup");
      if(!popup || getComputedStyle(popup).display==="none")return;
      event.preventDefault();
      const close=document.getElementById("appPopupClose");
      if(close)close.click();
      else if(typeof hidePopup==="function")hidePopup();
    },true);
  }

  function injectCauseHistoryLayoutStyle(){
    if(document.getElementById("smaregiCauseHistoryLayoutStyle"))return;
    const style=document.createElement("style");
    style.id="smaregiCauseHistoryLayoutStyle";
    style.textContent=`
      .smaregi-cause-shell{
        padding:2px 0 4px;
      }
      .smaregi-cause-header{
        display:grid;
        grid-template-columns:auto minmax(0,1fr) auto;
        gap:16px;
        align-items:center;
        margin-bottom:14px;
      }
      .smaregi-cause-title{
        display:grid;
        gap:4px;
        font-size:15px;
        color:#12352c;
      }
      .smaregi-cause-store-badge{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:84px;
        padding:7px 12px;
        border-radius:10px;
        background:#dbeafe;
        color:#1d4ed8;
        font-weight:700;
      }
      .smaregi-cause-summary-row{
        display:grid;
        grid-template-columns:minmax(116px,1fr) 34px minmax(116px,1fr) 34px minmax(116px,1fr) 34px minmax(116px,1fr) 34px minmax(116px,1fr);
        gap:8px;
        align-items:stretch;
        margin:0 0 14px;
      }
      .smaregi-cause-summary-card{
        min-height:74px;
        border:1px solid #c7eadb;
        border-radius:8px;
        background:linear-gradient(180deg,#f8fffb,#f3fbf7);
        padding:10px 12px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        gap:5px;
        text-align:center;
      }
      .smaregi-cause-summary-card.is-comparison-card{
        background:#ecfdf5;
        border-color:#86efac;
      }
      .smaregi-cause-summary-card.is-difference-card{
        background:#fff7ed;
        border-color:#fdba74;
      }
      .smaregi-cause-summary-card.is-last-check-card{
        background:#f8fafc;
      }
      .smaregi-cause-summary-card strong{
        font-size:13px;
        color:#12352c;
      }
      .smaregi-cause-summary-card span{
        font-size:22px;
        font-weight:800;
      }
      .smaregi-cause-summary-card .is-app-stock{
        color:#15803d;
      }
      .smaregi-cause-summary-card .is-smaregi-stock{
        color:#2563eb;
      }
      .smaregi-cause-summary-operator{
        display:flex;
        align-items:center;
        justify-content:center;
        min-height:74px;
        font-size:24px;
        font-weight:800;
        color:#334155;
      }
      .smaregi-cause-guide{
        border:1px solid #93c5fd;
        background:#eff6ff;
        color:#1d4ed8;
        border-radius:8px;
        padding:10px 14px;
        margin:10px 0 16px;
        font-weight:700;
      }
      .smaregi-cause-history-grid{
        display:grid;
        grid-template-columns:minmax(0,1fr) minmax(0,1fr);
        gap:16px;
        align-items:start;
      }
      .smaregi-cause-history-card{
        min-width:0;
        border:1px solid #cfe7dc;
        border-radius:8px;
        background:#fff;
        padding:12px;
        height:560px;
        display:flex;
        flex-direction:column;
        box-sizing:border-box;
        overflow:hidden;
      }
      .smaregi-cause-history-card h3{
        margin:0 0 4px;
        font-size:18px;
        color:#0f5132;
      }
      .smaregi-cause-history-card:nth-child(2) h3{
        color:#1d4ed8;
      }
      .smaregi-cause-history-card .table-wrap{
        flex:1;
        min-height:0;
        overflow:auto;
        border:1px solid #e5e7eb;
        border-radius:8px;
      }
      .smaregi-cause-history-card table{
        min-width:760px;
        width:100%;
        border-collapse:separate;
        border-spacing:0;
      }
      .smaregi-cause-history-card thead th{
        position:sticky;
        top:0;
        z-index:1;
        background:#e8f7ee;
      }
      .smaregi-cause-history-card:nth-child(2) thead th{
        background:#eaf2ff;
      }
      .smaregi-cause-history-card td,
      .smaregi-cause-history-card th{
        white-space:nowrap;
      }
      .smaregi-cause-history-card td:nth-child(6){
        white-space:normal;
        width:150px;
        max-width:170px;
        min-width:130px;
        word-break:break-word;
        overflow-wrap:anywhere;
      }
      .smaregi-cause-history-card td:nth-child(6){
        display:-webkit-box;
        -webkit-line-clamp:3;
        -webkit-box-orient:vertical;
        overflow:hidden;
      }
      #historyBody td:nth-child(9),
      #recentRegistrationHistoryBody td:nth-child(9),
      #selectedHistoryBody td:nth-child(9){
        width:170px;
        max-width:190px;
        min-width:140px;
        white-space:normal;
        word-break:break-word;
        overflow-wrap:anywhere;
        vertical-align:middle;
      }
      #historyBody .memo-cell,
      #recentRegistrationHistoryBody .memo-cell,
      #selectedHistoryBody .memo-cell{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        align-items:center;
        gap:8px;
        max-width:190px;
      }
      #historyBody .memo-text,
      #recentRegistrationHistoryBody .memo-text,
      #selectedHistoryBody .memo-text{
        display:-webkit-box;
        -webkit-line-clamp:3;
        -webkit-box-orient:vertical;
        overflow:hidden;
        white-space:normal;
        word-break:break-word;
        overflow-wrap:anywhere;
        line-height:1.35;
      }
      .smaregi-last-check-divider td{
        background:#eaf2ff !important;
        color:#1d4ed8;
        border-top:2px solid #2563eb;
        border-bottom:2px solid #2563eb;
        text-align:center;
        font-weight:800;
      }
      .smaregi-cause-footnote{
        margin-top:14px;
        border:1px solid #f3d18a;
        background:#fff8e6;
        color:#6b4e00;
        border-radius:8px;
        padding:10px 14px;
        font-size:13px;
      }
      .smaregi-difference.is-zero{
        color:#334155;
      }
      .history-qty-negative,
      .is-negative{
        color:#dc2626;
        font-weight:700;
      }
      .history-qty-positive,
      .is-positive{
        color:#15803d;
        font-weight:700;
      }
      .equipment-action-group{
        display:flex;
        align-items:center;
        justify-content:flex-start;
        gap:8px;
        flex-wrap:wrap;
      }
      .equipment-status-badge{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:64px;
        height:28px;
        padding:0 10px;
        border-radius:8px;
        font-size:13px;
        font-weight:800;
        line-height:1;
        white-space:nowrap;
      }
      .equipment-status-badge.is-unchecked{
        color:#8a5a00;
        background:#fff3cd;
      }
      .equipment-status-badge.is-checked,
      .equipment-confirmed{
        color:#166534;
        background:#dcfce7;
      }
      .equipment-confirm-btn,
      .equipment-cancel-btn,
      .memo-edit-btn{
        box-sizing:border-box;
        min-width:96px;
        max-width:120px;
        height:38px;
        padding:0 14px;
        border-radius:8px;
        font-size:14px;
        font-weight:800;
        line-height:1;
        white-space:nowrap;
      }
      .equipment-confirm-btn{
        border:1px solid #2f9d62;
        background:#2f9d62;
        color:#fff;
      }
      .equipment-cancel-btn{
        border:1px solid #c2410c;
        background:#fff;
        color:#b91c1c;
      }
      .memo-edit-btn{
        border:1px solid #2f9d62;
        background:#fff;
        color:#0f5132;
      }
      .product-history-identity{
        display:grid;
        gap:3px;
        line-height:1.35;
      }
      .product-history-identity strong{
        font-size:14px;
      }
      .product-history-identity small{
        color:#64748b;
        font-size:12px;
      }
      @media (max-width:800px){
        .smaregi-cause-header{
          grid-template-columns:1fr;
        }
        .smaregi-cause-summary-row{
          grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr);
        }
        .smaregi-cause-summary-operator{
          min-height:64px;
        }
        .smaregi-cause-summary-card.is-last-check-card{
          grid-column:1 / -1;
        }
      }
      @media (max-width:520px){
        .smaregi-cause-summary-row{
          grid-template-columns:1fr;
        }
        .smaregi-cause-summary-operator{
          min-height:20px;
        }
        .smaregi-cause-history-grid{
          display:block;
        }
        .smaregi-cause-history-card{
          margin-top:14px;
          height:auto;
          min-height:0;
        }
        .smaregi-cause-history-card:first-child{
          margin-top:0;
        }
        .smaregi-cause-history-card .table-wrap{
          max-height:520px;
        }
        #historyBody td:nth-child(9),
        #recentRegistrationHistoryBody td:nth-child(9),
        #selectedHistoryBody td:nth-child(9){
          width:110px;
          max-width:130px;
          min-width:90px;
        }
        #historyBody .memo-cell,
        #recentRegistrationHistoryBody .memo-cell,
        #selectedHistoryBody .memo-cell{
          max-width:130px;
        }
        #historyBody .memo-text,
        #recentRegistrationHistoryBody .memo-text,
        #selectedHistoryBody .memo-text,
        .smaregi-cause-history-card td:nth-child(6){
          -webkit-line-clamp:1;
        }
        .equipment-action-group,
        .equipment-confirm-btn,
        .equipment-cancel-btn{
          display:none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const INVENTORY_TYPE_LABELS={
    equipment_transfer:"商品転用",
    "備品転用":"商品転用",
    event_pick:"イベント持出",
    event_return:"イベント戻し",
    equipment_transfer_cancel:"商品転用キャンセル",
    "商品転用キャンセル":"商品転用キャンセル",
    stock_adjustment:"在庫修正",
    stock_in:"入荷",
    stock_out:"出荷"
  };

  function applyInventoryTypeDisplayLabels(){
    ["recentRegistrationHistoryBody","historyBody","selectedHistoryBody"].forEach(id=>{
      const body=document.getElementById(id);
      if(!body)return;
      body.querySelectorAll("td").forEach(cell=>{
        const text=String(cell.textContent||"").trim();
        if(INVENTORY_TYPE_LABELS[text])cell.textContent=INVENTORY_TYPE_LABELS[text];
      });
      body.querySelectorAll("tr").forEach(row=>{
        const cells=row.querySelectorAll("td");
        const typeCell=cells[1];
        const memoCell=cells[8];
        const typeText=String(typeCell?.textContent||"").trim();
        const memoText=String(memoCell?.textContent||"").trim();
        if(typeCell && memoText.includes("備品転用キャンセル") && (typeText==="備品転用" || typeText==="equipment_transfer")){
          typeCell.textContent="商品転用キャンセル";
        }
      });
    });
  }

  function applyMemoOverflowTitles(){
    document.querySelectorAll("#historyBody .memo-text,#recentRegistrationHistoryBody .memo-text,#selectedHistoryBody .memo-text").forEach(node=>{
      const text=String(node.textContent||"").trim();
      if(text)node.title=text;
    });
    document.querySelectorAll(".smaregi-cause-history-card tbody tr td:nth-child(6)").forEach(node=>{
      const text=String(node.textContent||"").trim();
      if(text)node.title=text;
    });
  }

  function isEquipmentTransferTypeValue(value){
    const text=String(value||"").trim();
    if(text==="equipment_transfer_cancel" || text==="商品転用キャンセル")return false;
    return text==="備品転用" || text==="equipment_transfer" || text.includes("蛯吝刀");
  }

  function isEquipmentCancelLog(log){
    const type=String(log?.type||"").trim();
    const memo=String(log?.memo||log?.note||"");
    return type==="equipment_transfer_cancel"
      || type==="商品転用キャンセル"
      || memo.includes("備品転用キャンセル")
      || memo.includes("元履歴:");
  }

  function isEquipmentMobileView(){
    return typeof isMobileViewport==="function" ? isMobileViewport() : window.matchMedia("(max-width: 800px)").matches;
  }

  function getEquipmentCache(logId){
    try{return equipmentTransferLogCache.get(String(logId))||null;}catch(_){return null;}
  }

  const equipmentCancelBusyLogIds=new Set();

  function setEquipmentCache(logId,log){
    try{equipmentTransferLogCache.set(String(logId),log);}catch(_){}
  }

  window.equipmentCheckHtml=function(log){
    if(isEquipmentCancelLog(log))return '<span class="equipment-status-badge is-checked">キャンセル済</span>';
    if(!isEquipmentTransferTypeValue(log?.type))return "";
    if(isEquipmentMobileView())return "";
    const rawLogId=String(log?.id||log?.log_id||"");
    if(rawLogId)setEquipmentCache(rawLogId,log);
    const hasAccess=typeof hasInventoryPrivilegedAccess==="function" && hasInventoryPrivilegedAccess();
    const checked=typeof isEquipmentTransferChecked==="function" ? isEquipmentTransferChecked(log) : (log?.equipment_checked===true || !!log?.equipment_checked_at);
    if(checked)return '<span class="equipment-status-badge is-checked">確認済</span>';
    if(!hasAccess)return '<span class="equipment-status-badge is-unchecked">未確認</span>';
    return `<div class="equipment-action-group">
      <span class="equipment-status-badge is-unchecked">未確認</span>
      <button type="button" class="equipment-confirm-btn" data-log-id="${safeText(rawLogId)}">確認</button>
      <button type="button" class="equipment-cancel-btn" data-log-id="${safeText(rawLogId)}">キャンセル</button>
    </div>`;
  };

  window.replaceEquipmentConfirmationDom=function(logId,log){
    const checkedHtml='<span class="equipment-status-badge is-checked">確認済</span>';
    document.querySelectorAll(".equipment-check-cell").forEach(cell=>{
      if(String(cell.dataset.logId||"")===String(logId))cell.innerHTML=checkedHtml;
    });
    document.querySelectorAll(".equipment-confirm-btn,.equipment-cancel-btn").forEach(button=>{
      if(String(button.dataset.logId||"")!==String(logId))return;
      const cell=button.closest("td");
      if(cell)cell.innerHTML=`<div class="equipment-check-cell" data-log-id="${safeText(logId)}">${checkedHtml}</div>`;
    });
    if(log)setEquipmentCache(logId,log);
  };

  async function markEquipmentTransferChecked(latestLog,checkedBy){
    const logId=String(latestLog?.id||"");
    if(!logId)throw new Error("商品転用履歴IDが見つかりません。");
    const checkedAt=new Date().toISOString();
    const patch={equipment_checked:true,equipment_checked_at:checkedAt,equipment_checked_by:checkedBy||""};
    const refreshed=await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}`,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(patch)
    });
    const refreshedLog=Array.isArray(refreshed)&&refreshed[0] ? refreshed[0] : {...latestLog,...patch};
    setEquipmentCache(logId,refreshedLog);
    if(typeof replaceEquipmentConfirmationDom==="function")replaceEquipmentConfirmationDom(logId,refreshedLog);
    return refreshedLog;
  }

  async function applyEquipmentCancelToCurrentSmaregiCheck(barcode,quantity,checkedBy){
    if(!smaregiSnapshot)return false;
    const item=getAllMovementItems().find(row=>String(row.barcode||"")===String(barcode));
    const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
    if(!item||!hasActualStock(check))return false;
    const actualStock=Number(check.actual_stock);
    if(!Number.isFinite(actualStock))return false;
    const checkedAt=new Date().toISOString();
    const nextActualStock=actualStock+Math.abs(Number(quantity||1)||1);
    const eventBreakdown=typeof getSmaregiInventoryBreakdown==="function"
      ? getSmaregiInventoryBreakdown(item,{...check,actual_stock:nextActualStock})
      : null;
    const comparisonStock=Number(eventBreakdown?.comparisonStock ?? nextActualStock);
    const smaregiStock=getCsvSmaregiStock(item);
    const smaregiCompareStock=getComparableCsvSmaregiStock(item);
    const payload={
      actual_stock:nextActualStock,
      difference:Number.isFinite(comparisonStock)&&Number.isFinite(smaregiCompareStock) ? comparisonStock-smaregiCompareStock : nextActualStock-smaregiCompareStock,
      checked_by:checkedBy||check.checked_by||"",
      checked_at:checkedAt,
      excluded:false,
      no_issue:true,
      no_issue_by:checkedBy||check.no_issue_by||null,
      no_issue_at:checkedAt,
      no_issue_reason:check.no_issue_reason||"商品転用キャンセル確認済み",
      difference_reason_category:check.difference_reason_category||null,
      difference_reason_memo:check.difference_reason_memo||"",
      difference_reason_by:check.difference_reason_by||null,
      difference_reason_at:check.difference_reason_at||null,
      actual_corrected:true,
      actual_corrected_by:checkedBy||check.actual_corrected_by||null,
      actual_corrected_at:checkedAt
    };
    const savedRows=await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(payload)
    });
    const savedRow=Array.isArray(savedRows)&&savedRows[0] ? savedRows[0] : {...check,...payload};
    smaregiStockChecks=smaregiStockChecks.filter(row=>String(row.barcode)!==String(barcode));
    smaregiStockChecks.push({...savedRow,snapshot_id:smaregiSnapshot.id,barcode});
    return true;
  }

  function refreshSmaregiAnalysisAfterEquipmentChange(){
    try{renderSmaregiStockChecks();}catch(_){}
    try{renderSmaregiDiffOnlyPanel();}catch(_){}
    try{updateSmaregiProgressOnly();}catch(_){}
    try{if(typeof loadSmaregiAccuracy==="function")loadSmaregiAccuracy();}catch(_){}
    try{if(typeof loadSmaregiDifferenceRanking==="function")loadSmaregiDifferenceRanking();}catch(_){}
    try{if(typeof loadSmaregiReasonSummary==="function")loadSmaregiReasonSummary();}catch(_){}
  }

  window.executeEquipmentTransferConfirmation=async function({log,product=null,quantity,checkedBy,button}){
    try{
      const logId=String(log?.id||"");
      const latestRows=logId ? await sbAll(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`,1,10000) : [];
      const latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : log;
      if(!latestLog)throw new Error("商品転用履歴が見つかりません。");
      if(!isEquipmentTransferTypeValue(latestLog.type))throw new Error("商品転用の履歴ではありません。");
      const alreadyChecked=typeof isEquipmentTransferChecked==="function" ? isEquipmentTransferChecked(latestLog) : (latestLog.equipment_checked===true || !!latestLog.equipment_checked_at);
      if(alreadyChecked)throw new Error("この商品転用は確認済みです。");
      const rawQty=Number(latestLog.quantity ?? quantity ?? 1);
      const absQty=Math.abs(Number.isFinite(rawQty) && rawQty!==0 ? rawQty : 1);
      product=product || await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      let nextStock=Number(product.base_stock||0);
      if(rawQty>0){
        nextStock=nextStock-absQty;
        await updateProductCurrentStock(latestLog.barcode,nextStock);
      }
      const refreshedLog=await markEquipmentTransferChecked(latestLog,checkedBy);
      showMessage?.(`商品転用を確認しました：${product.name||latestLog.product_name||""} / 数量 ${absQty}`,"ok");
      showPopup?.("商品転用確認完了",`商品名：${product.name||latestLog.product_name||""}\n棚番：${getProductShelfLabel(product)}\nバーコード：${latestLog.barcode}\n数量：${absQty}\n現在庫：${nextStock}`);
      return true;
    }catch(error){
      if(button)button.disabled=false;
      showMessage?.("商品転用確認エラー\n"+error.message,"err");
      return false;
    }
  };

  window.confirmEquipmentTransfer=async function(logId,button){
    if(isEquipmentMobileView())return;
    if(typeof hasInventoryPrivilegedAccess==="function" && !hasInventoryPrivilegedAccess()){
      showMessage?.("商品転用確認は管理者認証後に実行できます。","err");
      return;
    }
    const log=getEquipmentCache(logId);
    if(!log){
      showMessage?.("商品転用履歴IDが見つかりません。再読み込みしてください。","err");
      return;
    }
    const checkedBy=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
    if(!checkedBy){
      showMessage?.("担当者を選択してください。","err");
      return;
    }
    button.disabled=true;
    await window.executeEquipmentTransferConfirmation({log,quantity:Math.abs(Number(log.quantity||1)),checkedBy,button});
  };

  window.cancelEquipmentTransfer=async function(logId,button){
    if(isEquipmentMobileView())return;
    if(typeof hasInventoryPrivilegedAccess==="function" && !hasInventoryPrivilegedAccess()){
      showMessage?.("商品転用キャンセルは管理者認証後に実行できます。","err");
      return;
    }
    logId=String(logId||"");
    if(!logId){
      showMessage?.("商品転用履歴IDが見つかりません。再読み込みしてください。","err");
      return;
    }
    if(equipmentCancelBusyLogIds.has(logId)){
      showMessage?.("この商品転用キャンセルは処理中です。完了までお待ちください。","err");
      return;
    }
    const ok=confirm("商品転用をキャンセルし、アプリ在庫を戻します。実行しますか？");
    if(!ok)return;
    let checkedLog=null;
    try{
      equipmentCancelBusyLogIds.add(logId);
      button.disabled=true;
      button.dataset.cancelBusy="1";
      const latestRows=await sbAll(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`,1,10000);
      const latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : getEquipmentCache(logId);
      if(!latestLog)throw new Error("商品転用履歴が見つかりません。");
      if(!isEquipmentTransferTypeValue(latestLog.type))throw new Error("商品転用の履歴ではありません。");
      const alreadyChecked=typeof isEquipmentTransferChecked==="function" ? isEquipmentTransferChecked(latestLog) : (latestLog.equipment_checked===true || !!latestLog.equipment_checked_at);
      if(alreadyChecked)throw new Error("この商品転用はすでに確認終了済みです。再キャンセルはできません。");
      const duplicate=await sbAll(`inventory_logs?select=id&barcode=eq.${encodeURIComponent(latestLog.barcode)}&memo=ilike.*${encodeURIComponent(logId)}*&limit=1`,1,10000).catch(()=>[]);
      if(Array.isArray(duplicate)&&duplicate.length)throw new Error("この商品転用はすでにキャンセル済みです。");
      const product=await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      const absQty=Math.abs(Number(latestLog.quantity||1))||1;
      const nextStock=Number(product.base_stock||0)+absQty;
      const staff=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
      if(!staff){
        throw new Error("担当者を選択してください。");
      }
      checkedLog=await markEquipmentTransferChecked(latestLog,staff);
      await updateProductCurrentStock(latestLog.barcode,nextStock);
      const inserted=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"equipment_transfer",
          staff,
          barcode:latestLog.barcode,
          product_name:latestLog.product_name||product.name||"",
          quantity:absQty,
          memo:`備品転用キャンセル 元履歴:${logId}`,
          equipment_checked:true,
          equipment_checked_by:staff,
          equipment_checked_at:new Date().toISOString()
        })
      });
      const cancelLog=Array.isArray(inserted)&&inserted[0] ? inserted[0] : null;
      await applyEquipmentCancelToCurrentSmaregiCheck(latestLog.barcode,absQty,staff);
      try{if(Array.isArray(logs)&&cancelLog)logs.unshift(cancelLog);}catch(_){}
      try{
        if(Array.isArray(logs)){
          logs=logs.map(row=>String(row.id)===String(logId) ? {...row,...checkedLog} : row);
        }
      }catch(_){}
      showMessage?.(`商品転用をキャンセルしました：${product.name||latestLog.product_name||""} / 数量 ${absQty}`,"ok");
      showPopup?.("商品転用キャンセル完了",`商品名：${product.name||latestLog.product_name||""}\n棚番：${getProductShelfLabel(product)}\nバーコード：${latestLog.barcode}\n戻し数量：${absQty}\n現在庫：${nextStock}`);
      if(typeof renderGlobalHistory==="function")renderGlobalHistory();
      if(typeof selectedBarcode!=="undefined" && selectedBarcode && typeof showProductHistoryForBarcode==="function")showProductHistoryForBarcode(selectedBarcode);
      refreshSmaregiAnalysisAfterEquipmentChange();
      return true;
    }catch(error){
      if(button){
        button.disabled=false;
        delete button.dataset.cancelBusy;
      }
      showMessage?.("商品転用キャンセルエラー\n"+error.message,"err");
      return false;
    }finally{
      equipmentCancelBusyLogIds.delete(logId);
    }
  };

  window.bindEquipmentConfirmButtons=function(){
    document.querySelectorAll(".equipment-confirm-btn").forEach(button=>{
      if(button.dataset.finalBound==="1")return;
      button.dataset.finalBound="1";
      button.onclick=()=>window.confirmEquipmentTransfer(button.dataset.logId,button);
    });
    document.querySelectorAll(".equipment-cancel-btn").forEach(button=>{
      if(button.dataset.finalBound==="1")return;
      button.dataset.finalBound="1";
      button.onclick=()=>window.cancelEquipmentTransfer(button.dataset.logId,button);
    });
  };

  function wrapDifferenceReasonSave(){
    if(window.saveSmaregiDifferenceReason?.__smaregiFinalWrapped)return;
    const originalSave=window.saveSmaregiDifferenceReason;
    if(typeof originalSave!=="function")return;
    const wrapped=async function(barcode,button=null){
      const result=await originalSave.call(this,barcode,button);
      try{
        await refreshSmaregiCheckStateSilently();
        const detail=document.getElementById("smaregiCauseDetail");
        if(detail){
          detail.hidden=true;
          detail.innerHTML="";
        }
        renderSmaregiDiffOnlyPanel();
        updateSmaregiProgressOnly();
      }catch(error){
        console.warn("[smaregi reason save refresh]",error);
      }
      return result;
    };
    wrapped.__smaregiFinalWrapped=true;
    window.saveSmaregiDifferenceReason=wrapped;
  }

  function bootFinalSmaregiCheck(){
    bindPopupKeyboardClose();
    injectCauseHistoryLayoutStyle();
    wrapDifferenceReasonSave();
    bindFinalRefreshButton();
    applyInventoryTypeDisplayLabels();
    applyMemoOverflowTitles();
    if(typeof bindEquipmentConfirmButtons==="function")bindEquipmentConfirmButtons();
    if(!window.__smaregiFinalTypeLabelTimer){
      window.__smaregiFinalTypeLabelTimer=setInterval(()=>{
        applyInventoryTypeDisplayLabels();
        applyMemoOverflowTitles();
        if(typeof bindEquipmentConfirmButtons==="function")bindEquipmentConfirmButtons();
      },1000);
    }
    if(document.getElementById("smaregiStockCheckBody")){
      try{
        renderSmaregiStockChecks();
        startSmaregiAutoRefresh();
      }catch(error){
        console.warn("[smaregi final render]",error);
      }
    }
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",bootFinalSmaregiCheck,{once:true});
  }else{
    setTimeout(bootFinalSmaregiCheck,0);
  }
})();

function getSmaregiApiStoreContextForCheck(){
  const context=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
  const storeCode=String(context.storeCode||window.currentStore||"tokyo").trim().toLowerCase()||"tokyo";
  return {
    ...context,
    storeCode,
    currentStore:storeCode,
    storeName:context.storeName||storeCode
  };
}

function parseSmaregiSnapshotStoreId(snapshot){
  const note=String(snapshot?.note||"");
  const match=note.match(/store_id:([^/\s]+)/);
  return match ? match[1].trim() : "";
}

async function loadLatestSmaregiSnapshot(){
  const context=getSmaregiApiStoreContextForCheck();
  const storeCode=context.storeCode;
  const noteFilter=encodeURIComponent(`*store_code:${storeCode}*`);
  try{
    showMessage?.(`スマレジAPIデータを取得中：${context.storeName||storeCode}`);
    const snapshots=await sb(`smaregi_stock_snapshots?select=*&source=eq.api&note=ilike.${noteFilter}&order=imported_at.desc&limit=1`);
    smaregiSnapshot=Array.isArray(snapshots)&&snapshots.length ? snapshots[0] : null;
    const resetInput=typeof el==="function" ? el("resetSmaregiCompletedAtInput") : document.getElementById("resetSmaregiCompletedAtInput");
    const lastCheckValue=smaregiSnapshot?.completed_at || smaregiSnapshot?.range_from || "";
    if(resetInput)resetInput.value=lastCheckValue && typeof formatDateTimeLocal==="function" ? formatDateTimeLocal(lastCheckValue) : "";
    smaregiStockItems=[];
    smaregiStockChecks=[];
    smaregiLatestChangeByBarcode=new Map();
    if(smaregiSnapshot){
      const snapshotId=encodeURIComponent(smaregiSnapshot.id);
      const storeId=parseSmaregiSnapshotStoreId(smaregiSnapshot);
      const itemStoreFilter=storeId ? `&store_id=eq.${encodeURIComponent(storeId)}` : "";
      smaregiStockItems=await sbAll(`smaregi_stock_items?select=*&snapshot_id=eq.${snapshotId}${itemStoreFilter}&order=product_name.asc`,1000,20000);
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      const changeStoreFilter=storeId ? `&store_id=eq.${encodeURIComponent(storeId)}` : "";
      const latestChanges=await sbAll(`smaregi_stock_changes?select=*&snapshot_id=eq.${snapshotId}${changeStoreFilter}&order=changed_at.desc`,1000,50000).catch(()=>[]);
      smaregiLatestChangeByBarcode=latestSmaregiChangesByBarcode(latestChanges);
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
      await loadSmaregiEventInventoryCache(smaregiStockItems.map(item=>item.barcode));
    }else{
      smaregiCurrentEventStockByBarcode=new Map();
      smaregiEventStorageStockByBarcode=new Map();
    }
    renderSmaregiStockChecks();
    showMessage?.(smaregiSnapshot
      ? `スマレジAPIデータを取得しました：${context.storeName||storeCode} / ${smaregiStockItems.length}件`
      : `スマレジAPIデータはまだありません：${context.storeName||storeCode}`,"ok");
  }catch(error){
    smaregiSnapshot=null;
    smaregiStockItems=[];
    smaregiStockChecks=[];
    smaregiLatestChangeByBarcode=new Map();
    renderSmaregiStockChecks();
    showMessage?.(`スマレジAPIデータ取得エラー\n${error.message}`,"err");
  }
}

async function syncSmaregiStockFromApi(){
  const context=getSmaregiApiStoreContextForCheck();
  if(typeof hasInventoryPrivilegedAccess==="function"&&!hasInventoryPrivilegedAccess()){
    showMessage?.("スマレジAPI取得は管理者認証後に実行できます。","err");
    return;
  }
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "スマレジAPI取得確認",
      `対象店舗：${context.storeName||context.storeCode}\n前回チェック完了以降の在庫変動商品をAPIから取得します。`,
      {okText:"取得"}
    );
    if(!ok)return;
  }
  try{
    showMessage?.(`スマレジAPIから在庫変動を取得中：${context.storeName||context.storeCode}`);
    const res=await fetch("./api/smaregi-sync",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(context)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`API error ${res.status}`);
    await loadLatestSmaregiSnapshot();
    showPopup?.("スマレジAPI取得完了",
      `対象店舗：${data.store_name||context.storeName||context.storeCode}\n対象商品：${Number(data.item_count||0)}件\n変動履歴：${Number(data.change_count||0)}件\n対象期間：${fmt(data.range_from)} - ${fmt(data.range_to)}${data.warning?`\n\n注意：${data.warning}`:""}`
    );
    showMessage?.(`スマレジAPI取得完了：${Number(data.item_count||0)}件 / ${data.store_name||context.storeName||context.storeCode}`,"ok");
  }catch(error){
    showMessage?.(`スマレジAPI取得失敗\n${error.message}`,"err");
  }
}

async function resetSmaregiStockCheckCompletion(){
  if(typeof hasInventoryPrivilegedAccess==="function"&&!hasInventoryPrivilegedAccess()){
    showMessage?.("チェック完了解除は管理者認証後に実行できます。","err");
    return;
  }
  if(!smaregiSnapshot){
    showMessage?.("解除するスマレジ在庫変動チェックがありません。","err");
    return;
  }
  const input=typeof el==="function" ? el("resetSmaregiCompletedAtInput") : document.getElementById("resetSmaregiCompletedAtInput");
  const selected=String(input?.value||"").trim();
  if(!selected){
    showMessage?.("戻す日時を選択してください。","err");
    input?.focus();
    return;
  }
  const date=new Date(selected);
  if(Number.isNaN(date.getTime())){
    showMessage?.("戻す日時を正しく選択してください。","err");
    input?.focus();
    return;
  }
  const context=getSmaregiApiStoreContextForCheck();
  const ok=typeof confirmAppAction==="function"
    ? await confirmAppAction("チェック完了解除",`対象店舗：${context.storeName||context.storeCode}\nこの店舗の現在のチェック完了日時だけを変更します。`,{okText:"解除"})
    : confirm(`この店舗の現在のチェック完了日時だけを変更します。\n対象店舗：${context.storeName||context.storeCode}`);
  if(!ok)return;
  try{
    const resetTo=date.toISOString();
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at:resetTo})
    });
    smaregiSnapshot.completed_at=resetTo;
    renderSmaregiStockChecks();
    showPopup?.("チェック完了解除",`対象店舗：${context.storeName||context.storeCode}\n前回チェック完了：${fmt(resetTo)}`);
    showMessage?.("この店舗のチェック完了日時を更新しました。","ok");
  }catch(error){
    showMessage?.("チェック完了解除エラー\n"+error.message,"err");
  }
}
