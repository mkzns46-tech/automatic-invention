(function(){
  "use strict";

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
    const change=getChangeForItem(item);
    const storeCode=getInventoryStoreCodeSafe();
    const raw=getStoreStockValue(item,storeCode,true) ?? getStoreStockValue(change,storeCode,true);
    if(raw===null)return {raw:null,compare:null,storeCode};
    return {raw,compare:Math.max(0,raw),storeCode};
  }

  function getStoreDisplayStocks(source){
    return {
      tokyo:getStoreStockValue(source,"tokyo",false),
      aichi:getStoreStockValue(source,"aichi",false)
    };
  }

  function getCsvSmaregiStock(item){
    return getTargetSmaregiStock(item).compare;
  }

  function displayNumber(value,emptyLabel="未入力"){
    if(value===null || value===undefined || String(value)==="")return emptyLabel;
    const number=Number(value);
    return Number.isFinite(number) ? String(number) : emptyLabel;
  }

  function getChangeDateValue(change){
    return change?.changed_at || change?.movement_datetime || change?.updated_at_from_csv || change?.updated_at || "";
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
    const filtered=items.filter(item=>{
      const change=getChangeForItem(item);
      const changedAt=change.changed_at || change.movement_datetime || item?.changed_at || item?.movement_datetime;
      const changedTime=new Date(changedAt).getTime();
      if(!Number.isFinite(changedTime))return true;
      if(!Number.isFinite(lastTime))return true;
      return changedTime>lastTime;
    });
    return filtered.length ? filtered : items;
  };

  window.getSmaregiFilteredTargetItems=function(){
    const target=window.getSmaregiCurrentTargetItems();
    const mode=window.smaregiCheckDisplayMode || "unchecked";
    if(mode==="checked")return target.filter(isCheckedItem);
    if(mode==="all")return target;
    return target.filter(item=>!isCheckedItem(item));
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
    return `<div class="smaregi-final-product-info">
      <strong>${safeText(getItemName(item)||"商品名未設定")}</strong>
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
    if(badge)badge.textContent=hasMovementData ? "スマレジ変動CSV取込済み" : "スマレジ変動CSV未取込";
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
      const actual=Number(check.actual_stock);
      const smaregiStock=getCsvSmaregiStock(item);
      if(!Number.isFinite(actual)||!Number.isFinite(smaregiStock))return null;
      const difference=actual-smaregiStock;
      if(difference===0)return null;
      return {item,check,actual,smaregiStock,difference};
    }).filter(Boolean);
  }

  window.renderSmaregiDiffOnlyPanel=function(){
    const panel=typeof el==="function" ? el("smaregiDiffOnlyPanel") : document.getElementById("smaregiDiffOnlyPanel");
    const body=typeof el==="function" ? el("smaregiDiffOnlyBody") : document.getElementById("smaregiDiffOnlyBody");
    const summary=typeof el==="function" ? el("smaregiDiffSummary") : document.getElementById("smaregiDiffSummary");
    if(!panel||!body)return;
    if(typeof isSmaregiManager==="function" && !isSmaregiManager()){
      panel.hidden=true;
      body.innerHTML="";
      if(summary)summary.textContent="";
      return;
    }
    const stats=getSmaregiStats();
    const rows=getDiffRows();
    if(summary)summary.textContent=`差異：${rows.length}件 / チェック済み：${stats.completed||0}件 / 未チェック：${stats.unchecked||0}件 / 除外：${stats.excluded||0}件`;
    const hasMovementData=getAllMovementItems().length>0;
    if(!hasMovementData){
      body.innerHTML='<tr><td colspan="10" class="smaregi-empty">スマレジ変動CSV未取込です。</td></tr>';
      return;
    }
    if(!rows.length){
      body.innerHTML='<tr><td colspan="10" class="smaregi-empty">差異のある商品はありません。</td></tr>';
      return;
    }
    body.innerHTML=rows.map(({item,check,actual,smaregiStock,difference})=>{
      const barcode=String(item?.barcode||"");
      const name=getItemName(item)||"商品名未設定";
      const checkedBy=typeof getSmaregiDisplayCheckedBy==="function" ? getSmaregiDisplayCheckedBy(check) : (check?.checked_by||"");
      const differenceClass=difference<0 ? " is-negative" : " is-positive";
      return `<tr>
        <td>${safeText(name)}<div class="smaregi-movement-note">バーコード：${safeText(getItemBarcode(item)||"バーコードなし")}</div></td>
        <td><input type="number" class="smaregi-diff-actual-input" data-barcode="${safeText(barcode)}" min="0" step="1" inputmode="numeric" value="${safeText(actual)}"></td>
        <td>0</td>
        <td>0</td>
        <td>${displayNumber(smaregiStock)}</td>
        <td>${displayNumber(smaregiStock)}</td>
        <td><span class="smaregi-difference${differenceClass}">${difference}</span></td>
        <td>${safeText(checkedBy||"担当者未設定")}</td>
        <td>${check?.checked_at && typeof fmt==="function" ? safeText(fmt(check.checked_at)) : "未入力"}</td>
        <td><div class="diff-action-group"><button type="button" class="smaregi-diff-save-btn" data-barcode="${safeText(barcode)}">保存</button><button type="button" class="secondary smaregi-diff-cause-btn" data-barcode="${safeText(barcode)}">原因確認</button></div></td>
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
    const input=button?.closest("tr")?.querySelector(".smaregi-diff-actual-input");
    const actualStock=readActualStockValue(input);
    if(actualStock===null)return false;
    const barcode=String(button?.dataset?.barcode||"");
    return saveSmaregiActualStockCore(barcode,actualStock,button,{markCorrected:true});
  }

  function ensureSmaregiCsvClearButton(){
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
      showMessage?.("スマレジ在庫変動CSVを取り込んでから保存してください。","err");
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
      const previousCheck=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
      const payload={
        snapshot_id:smaregiSnapshot.id,
        barcode,
        actual_stock:actualStock,
        difference:actualStock-smaregiStock,
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
      const rawQty=parseStockNumber(log.quantity ?? log.qty ?? log.amount);
      const qty=rawQty===null ? 0 : rawQty;
      let after=parseStockNumber(log.after_stock ?? log.stock_after ?? log.base_stock_after);
      let before=parseStockNumber(log.before_stock ?? log.stock_before ?? log.base_stock_before);
      if(after===null && runningStock!==null)after=runningStock;
      let delta=qty;
      if(typeValue==="出荷" || typeValue==="備品転用" || typeValue==="蜃ｺ闕ｷ" || typeValue==="蛯吝刀霆｢逕ｨ" || typeValue==="stock_out" || typeValue==="equipment_transfer" || typeValue==="event_pick"){
        delta=qty>0 ? -qty : qty;
      }else if(typeValue==="入荷" || typeValue==="蜈･闕ｷ" || typeValue==="stock_in" || typeValue==="event_return" || typeValue==="equipment_transfer_cancel" || typeValue==="備品転用キャンセル"){
        delta=Math.abs(qty);
      }else if(typeValue==="在庫修正" || typeValue==="蝨ｨ蠎ｫ菫ｮ豁｣" || typeValue==="stock_adjustment"){
        if(after===null && rawQty!==null)after=qty;
        delta=before!==null && after!==null ? after-before : 0;
      }
      if(before===null && after!==null && Number.isFinite(delta))before=after-delta;
      derivedStockMap.set(log,{before,after});
      if(before!==null)runningStock=before;
    });
    const renderLog=(log)=>{
      const type=INVENTORY_TYPE_LABELS[String(log.type||"").trim()] || log.type || "";
      const qty=log.quantity ?? log.qty ?? log.amount ?? "";
      const staff=log.staff || log.staff_name || log.created_by || "";
      const memo=log.memo || log.note || "";
      const stock=derivedStockMap.get(log)||{};
      const before=stock.before ?? "";
      const after=stock.after ?? "";
      return `<tr>
        <td>${safeText(log.created_at && typeof fmt==="function" ? fmt(log.created_at) : log.created_at || "")}</td>
        <td>${safeText(type)}</td>
        <td>${safeText(before===""?"-":before)}</td>
        <td class="${Number(qty)<0 ? "is-negative" : (Number(qty)>0 ? "is-positive" : "")}">${safeText(qty)}</td>
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
      const storeCode=getInventoryStoreCodeSafe();
      const afterStock=getStoreStockValue(change,storeCode,true);
      const qty=parseStockNumber(change.amount ?? change.movement_quantity);
      const beforeStock=afterStock===null || qty===null ? null : afterStock-qty;
      const staff=change.staff_name || change.staff || change.operator_name || change.created_by || "-";
      const memo=change.memo || change.movement_reason || change.reason || "-";
      return `<tr>
        <td>${safeText(changedAt && typeof fmt==="function" ? fmt(changedAt) : changedAt || "")}</td>
        <td>${safeText(change.stock_division || change.movement_type || "")}</td>
        <td>${safeText(beforeStock===null?"-":beforeStock)}</td>
        <td class="${Number(qty)<0 ? "is-negative" : (Number(qty)>0 ? "is-positive" : "")}">${safeText(qty===null?"-":qty)}</td>
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
      const smaregiStock=targetStockInfo.compare;
      const smaregiRawStock=targetStockInfo.raw;
      const storeLabel=getInventoryStoreLabelSafe();
      const actual=check?.actual_stock ?? "";
      const difference=actual===""||actual===null||actual===undefined||smaregiStock===null ? "-" : Number(actual)-Number(smaregiStock);
      detail.innerHTML=`
        <div class="smaregi-cause-shell">
        <div class="smaregi-cause-header">
          <button type="button" id="closeSmaregiCauseDetailBtn" class="secondary">← 差異一覧に戻る</button>
          <div class="smaregi-cause-title">
            <div><strong>バーコード：</strong>${safeText(itemBarcode||"バーコードなし")}</div>
            <div><strong>商品名：</strong>${safeText(itemName)}</div>
          </div>
          <div class="smaregi-cause-store-badge">店舗：${safeText(storeLabel)}</div>
        </div>
        <div class="smaregi-cause-summary-row">
          <div class="smaregi-cause-summary-card">
            <strong>実在庫（アプリ）</strong>
            <span class="is-app-stock">${safeText(actual===""?"未入力":actual)}</span>
          </div>
          <div class="smaregi-cause-summary-operator">−</div>
          <div class="smaregi-cause-summary-card">
            <strong>スマレジ在庫（${safeText(storeLabel)}）</strong>
            <span class="is-smaregi-stock">${safeText(smaregiRawStock===null?"未取得":smaregiStock)}</span>
          </div>
          <div class="smaregi-cause-summary-operator">=</div>
          <div class="smaregi-cause-summary-card is-difference-card">
            <strong>差異</strong>
            <span class="smaregi-difference${Number(difference)<0 ? " is-negative" : (Number(difference)>0 ? " is-positive" : " is-zero")}">${safeText(difference)}</span>
          </div>
          <div class="smaregi-cause-summary-card">
            <strong>前回チェック締め日時</strong>
            <span>${safeText(typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe())}</span>
          </div>
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
            <p class="section-note">CSV取込済みのスマレジ在庫変動履歴です。</p>
            <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>処理前在庫</th><th>数量</th><th>処理後在庫</th><th>備考</th><th>担当者</th></tr></thead><tbody>${renderCauseSmaregiRows(smaregiChanges,itemBarcode)}</tbody></table></div>
          </section>
        </div>
        <div class="smaregi-cause-footnote">スマレジ側の「処理前在庫」は、CSVの「変動数」と「対象店舗在庫」から計算しています。処理前在庫 = 処理後在庫 − 変動数</div>
        </div>
      `;
      const closeButton=document.getElementById("closeSmaregiCauseDetailBtn");
      if(closeButton)closeButton.onclick=()=>{detail.hidden=true;detail.innerHTML="";};
      const saveButton=document.getElementById("saveSmaregiDifferenceReasonBtn");
      if(saveButton)saveButton.onclick=e=>{
        if(typeof saveSmaregiDifferenceReason==="function")saveSmaregiDifferenceReason(itemBarcode,e.currentTarget);
      };
      showMessage?.(`原因確認を表示しました：${itemName}`,"ok");
      detail.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(error){
      detail.innerHTML=`<div class="message err">原因確認データ取得エラー。\n${safeText(error.message)}</div>`;
      showMessage?.("原因確認データ取得エラー。\n"+error.message,"err");
    }
  };

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
      body.innerHTML=`<tr><td colspan="${emptyColspan}">スマレジ在庫変動CSVを取り込むと、前回チェック完了以降の変動商品が表示されます。</td></tr>`;
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
        grid-template-columns:minmax(0,1.4fr) auto minmax(0,1.4fr) auto minmax(120px,.8fr) minmax(220px,1.2fr);
        gap:8px;
        align-items:stretch;
        margin-bottom:14px;
      }
      .smaregi-cause-summary-card{
        min-height:72px;
        border:1px solid #c7eadb;
        border-radius:8px;
        background:linear-gradient(180deg,#f8fffb,#f3fbf7);
        padding:10px 12px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        gap:5px;
        text-align:center;
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
        min-width:130px;
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
      @media (max-width:800px){
        .smaregi-cause-header{
          grid-template-columns:1fr;
        }
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
      }
    `;
    document.head.appendChild(style);
  }

  const INVENTORY_TYPE_LABELS={
    equipment_transfer:"備品転用",
    event_pick:"イベント持出",
    event_return:"イベント戻し",
    equipment_transfer_cancel:"備品転用キャンセル",
    "備品転用キャンセル":"備品転用キャンセル",
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
    });
  }

  function isEquipmentTransferTypeValue(value){
    const text=String(value||"").trim();
    return text==="備品転用" || text==="equipment_transfer" || text.includes("蛯吝刀");
  }

  function isEquipmentMobileView(){
    return typeof isMobileViewport==="function" ? isMobileViewport() : window.matchMedia("(max-width: 800px)").matches;
  }

  function getEquipmentCache(logId){
    try{return equipmentTransferLogCache.get(String(logId))||null;}catch(_){return null;}
  }

  function setEquipmentCache(logId,log){
    try{equipmentTransferLogCache.set(String(logId),log);}catch(_){}
  }

  window.equipmentCheckHtml=function(log){
    if(!isEquipmentTransferTypeValue(log?.type))return "";
    if(isEquipmentMobileView())return "";
    const rawLogId=String(log?.id||log?.log_id||"");
    if(rawLogId)setEquipmentCache(rawLogId,log);
    const hasAccess=typeof hasInventoryPrivilegedAccess==="function" && hasInventoryPrivilegedAccess();
    const checked=typeof isEquipmentTransferChecked==="function" ? isEquipmentTransferChecked(log) : (log?.equipment_checked===true || !!log?.equipment_checked_at);
    if(!hasAccess)return checked ? '<span class="equipment-confirmed">確認済</span>' : "";
    if(checked){
      return `<div class="equipment-action-group"><span class="equipment-confirmed">確認済</span><button type="button" class="secondary equipment-cancel-btn" data-log-id="${safeText(rawLogId)}">備品転用キャンセル</button></div>`;
    }
    return `<button type="button" class="secondary equipment-confirm-btn" data-log-id="${safeText(rawLogId)}">確認</button>`;
  };

  window.executeEquipmentTransferConfirmation=async function({log,product=null,quantity,checkedBy,button}){
    try{
      const logId=String(log?.id||"");
      const latestRows=logId ? await sbAll(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`,1,10000) : [];
      const latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : log;
      if(!latestLog)throw new Error("備品転用履歴が見つかりません。");
      if(!isEquipmentTransferTypeValue(latestLog.type))throw new Error("備品転用の履歴ではありません。");
      const alreadyChecked=typeof isEquipmentTransferChecked==="function" ? isEquipmentTransferChecked(latestLog) : (latestLog.equipment_checked===true || !!latestLog.equipment_checked_at);
      if(alreadyChecked)throw new Error("この備品転用は確認済みです。");
      const rawQty=Number(latestLog.quantity ?? quantity ?? 1);
      const absQty=Math.abs(Number.isFinite(rawQty) && rawQty!==0 ? rawQty : 1);
      product=product || await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      let nextStock=Number(product.base_stock||0);
      if(rawQty>0){
        nextStock=nextStock-absQty;
        await updateProductCurrentStock(latestLog.barcode,nextStock);
      }
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
      showMessage?.(`備品転用を確認しました：${product.name||latestLog.product_name||""} / 数量 ${absQty}`,"ok");
      showPopup?.("備品転用確認完了",`商品名：${product.name||latestLog.product_name||""}\nバーコード：${latestLog.barcode}\n数量：${absQty}\n現在庫：${nextStock}`);
      return true;
    }catch(error){
      if(button)button.disabled=false;
      showMessage?.("備品転用確認エラー\n"+error.message,"err");
      return false;
    }
  };

  window.confirmEquipmentTransfer=async function(logId,button){
    if(isEquipmentMobileView())return;
    if(typeof hasInventoryPrivilegedAccess==="function" && !hasInventoryPrivilegedAccess()){
      showMessage?.("備品転用確認は管理者認証後に実行できます。","err");
      return;
    }
    const log=getEquipmentCache(logId);
    if(!log){
      showMessage?.("備品転用履歴IDが見つかりません。再読み込みしてください。","err");
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
      showMessage?.("備品転用キャンセルは管理者認証後に実行できます。","err");
      return;
    }
    const ok=confirm("備品転用をキャンセルし、アプリ在庫を戻します。実行しますか？");
    if(!ok)return;
    try{
      button.disabled=true;
      const latestRows=await sbAll(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`,1,10000);
      const latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : getEquipmentCache(logId);
      if(!latestLog)throw new Error("備品転用履歴が見つかりません。");
      if(!isEquipmentTransferTypeValue(latestLog.type))throw new Error("備品転用の履歴ではありません。");
      const duplicate=await sbAll(`inventory_logs?select=id&type=eq.${encodeURIComponent("備品転用キャンセル")}&barcode=eq.${encodeURIComponent(latestLog.barcode)}&memo=ilike.*${encodeURIComponent(logId)}*&limit=1`,1,10000).catch(()=>[]);
      if(Array.isArray(duplicate)&&duplicate.length)throw new Error("この備品転用はすでにキャンセル済みです。");
      const product=await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      const absQty=Math.abs(Number(latestLog.quantity||1))||1;
      const nextStock=Number(product.base_stock||0)+absQty;
      await updateProductCurrentStock(latestLog.barcode,nextStock);
      const staff=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
      const inserted=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"備品転用キャンセル",
          staff,
          barcode:latestLog.barcode,
          product_name:latestLog.product_name||product.name||"",
          quantity:absQty,
          memo:`備品転用キャンセル 元履歴:${logId}`
        })
      });
      const cancelLog=Array.isArray(inserted)&&inserted[0] ? inserted[0] : null;
      try{if(Array.isArray(logs)&&cancelLog)logs.unshift(cancelLog);}catch(_){}
      showMessage?.(`備品転用をキャンセルしました：${product.name||latestLog.product_name||""} / 数量 ${absQty}`,"ok");
      showPopup?.("備品転用キャンセル完了",`商品名：${product.name||latestLog.product_name||""}\nバーコード：${latestLog.barcode}\n戻し数量：${absQty}\n現在庫：${nextStock}`);
      if(typeof renderGlobalHistory==="function")renderGlobalHistory();
      if(typeof selectedBarcode!=="undefined" && selectedBarcode && typeof showProductHistoryForBarcode==="function")showProductHistoryForBarcode(selectedBarcode);
      return true;
    }catch(error){
      if(button)button.disabled=false;
      showMessage?.("備品転用キャンセルエラー\n"+error.message,"err");
      return false;
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
    if(typeof bindEquipmentConfirmButtons==="function")bindEquipmentConfirmButtons();
    if(!window.__smaregiFinalTypeLabelTimer){
      window.__smaregiFinalTypeLabelTimer=setInterval(()=>{
        applyInventoryTypeDisplayLabels();
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
