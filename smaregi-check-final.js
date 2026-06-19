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

  function getCsvSmaregiStock(item){
    const change=getChangeForItem(item);
    const candidates=[
      item?.smaregi_stock,
      item?.smaregi_stock_quantity,
      item?.stock_amount,
      change?.stock_amount,
      change?.smaregi_stock_quantity
    ];
    for(const candidate of candidates){
      if(candidate===null || candidate===undefined || String(candidate).trim()==="")continue;
      const number=Number(String(candidate).replace(/,/g,""));
      if(Number.isFinite(number))return number;
    }
    return null;
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
    return mergeRowsById(results).sort((a,b)=>new Date(getChangeDateValue(b)||0)-new Date(getChangeDateValue(a)||0));
  }

  function renderCauseAppLogRows(logs,barcode){
    const lastCheckTime=getLastCheckTimeValue();
    const lastCheckLabel=typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe();
    let dividerInserted=false;
    const rows=[];
    if(!logs.length){
      rows.push(`<tr><td colspan="6">バーコード ${safeText(barcode||"未設定")} の在庫管理側履歴はありません。</td></tr>`);
    }
    logs.forEach(log=>{
      const logTime=new Date(log.created_at).getTime();
      if(!dividerInserted && Number.isFinite(logTime) && logTime<=lastCheckTime){
        dividerInserted=true;
        rows.push(`<tr class="smaregi-last-check-divider"><td colspan="6">前回チェック締め：${safeText(lastCheckLabel)}</td></tr>`);
      }
      const type=INVENTORY_TYPE_LABELS[String(log.type||"").trim()] || log.type || "";
      const qty=log.quantity ?? log.qty ?? log.amount ?? "";
      const staff=log.staff || log.staff_name || log.created_by || "";
      const memo=log.memo || log.note || "";
      const after=log.after_stock ?? log.stock_after ?? log.base_stock_after ?? "";
      rows.push(`<tr>
        <td>${safeText(log.created_at && typeof fmt==="function" ? fmt(log.created_at) : log.created_at || "")}</td>
        <td>${safeText(type)}</td>
        <td>${safeText(qty)}</td>
        <td>${safeText(staff)}</td>
        <td>${safeText(memo)}</td>
        <td>${safeText(after===""?"-":after)}</td>
      </tr>`);
    });
    if(!dividerInserted && Number.isFinite(lastCheckTime)){
      rows.push(`<tr class="smaregi-last-check-divider"><td colspan="6">前回チェック締め：${safeText(lastCheckLabel)}</td></tr>`);
    }
    return rows.join("");
  }

  function renderCauseSmaregiRows(changes,barcode){
    if(!changes.length){
      return `<tr><td colspan="5">バーコード ${safeText(barcode||"未設定")} のCSV取込済み履歴はありません。</td></tr>`;
    }
    const lastCheckTime=getLastCheckTimeValue();
    let dividerInserted=false;
    const rows=[];
    changes.forEach(change=>{
      const changedAt=getChangeDateValue(change);
      const changedTime=new Date(changedAt).getTime();
      if(!dividerInserted && Number.isFinite(changedTime) && changedTime<=lastCheckTime){
        dividerInserted=true;
        rows.push(`<tr class="smaregi-last-check-divider"><td colspan="5">前回チェック締め：${safeText(typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe())}（ここまで前回確認済み）</td></tr>`);
      }
      rows.push(`<tr>
        <td>${safeText(changedAt && typeof fmt==="function" ? fmt(changedAt) : changedAt || "")}</td>
        <td>${safeText(change.stock_division || change.movement_type || "")}</td>
        <td>${safeText(change.amount ?? change.movement_quantity ?? "")}</td>
        <td>${safeText(change.stock_amount ?? change.smaregi_stock_quantity ?? "")}</td>
        <td>${safeText(change.memo || change.movement_reason || "")}</td>
      </tr>`);
    });
    if(!dividerInserted){
      rows.push(`<tr class="smaregi-last-check-divider"><td colspan="5">前回チェック締め：${safeText(typeof fmt==="function" ? fmt(getLastCheckedAtSafe()) : getLastCheckedAtSafe())}</td></tr>`);
    }
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
      const smaregiStock=getCsvSmaregiStock(item);
      const actual=check?.actual_stock ?? "";
      const difference=actual===""||actual===null||actual===undefined||smaregiStock===null ? "-" : Number(actual)-Number(smaregiStock);
      detail.innerHTML=`
        <div class="section-title"><h3>差異原因確認</h3><button type="button" id="closeSmaregiCauseDetailBtn" class="secondary">閉じる</button></div>
        <div class="smaregi-detail-summary">
          <div><strong>商品名</strong><span>${safeText(itemName)}</span></div>
          <div><strong>バーコード</strong><span>${safeText(itemBarcode||"バーコードなし")}</span></div>
          <div><strong>スマレジ在庫</strong><span>${safeText(smaregiStock===null?"未取得":smaregiStock)}</span></div>
          <div><strong>実在庫</strong><span>${safeText(actual===""?"未入力":actual)}</span></div>
          <div><strong>差異</strong><span class="smaregi-difference${Number(difference)<0 ? " is-negative" : (Number(difference)>0 ? " is-positive" : "")}">${safeText(difference)}</span></div>
          <div><strong>担当者</strong><span>${safeText(check?.checked_by||"担当者未設定")}</span></div>
          <div><strong>チェック日時</strong><span>${safeText(check?.checked_at&&typeof fmt==="function" ? fmt(check.checked_at) : check?.checked_at||"未入力")}</span></div>
        </div>
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
        <h3>在庫管理側の履歴</h3>
        <p class="section-note">バーコード ${safeText(itemBarcode||"未設定")} の在庫管理側履歴を表示します。前回チェック締め位置を青い区切りで表示します。</p>
        <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>担当者</th><th>備考</th><th>処理後在庫</th></tr></thead><tbody>${renderCauseAppLogRows(appLogs,itemBarcode)}</tbody></table></div>
        <h3>スマレジ側の在庫変動履歴</h3>
        <p class="section-note">CSV取込済みの smaregi_stock_changes を、バーコード優先で検索しています。スマレジ在庫はCSV H列「在庫数」、最終変動日時はCSV J列「更新日時」です。</p>
        <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>変動数</th><th>在庫数</th><th>理由・備考</th></tr></thead><tbody>${renderCauseSmaregiRows(smaregiChanges,itemBarcode)}</tbody></table></div>
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

  const INVENTORY_TYPE_LABELS={
    equipment_transfer:"備品転用",
    event_pick:"イベント持出",
    event_return:"イベント戻し",
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
    wrapDifferenceReasonSave();
    bindFinalRefreshButton();
    applyInventoryTypeDisplayLabels();
    if(!window.__smaregiFinalTypeLabelTimer){
      window.__smaregiFinalTypeLabelTimer=setInterval(applyInventoryTypeDisplayLabels,1000);
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
