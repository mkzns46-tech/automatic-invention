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

  window.startSmaregiAutoRefresh=function(){
    stopSmaregiAutoRefresh();
  };

  window.stopSmaregiAutoRefresh=stopSmaregiAutoRefresh;

  window.refreshSmaregiCheckStateSilently=async function(){
    return;
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

  function getLastCheckedAtSafe(){
    if(typeof getSmaregiLastCheckedAt==="function")return getSmaregiLastCheckedAt();
    return "2026-06-16T00:00:00+09:00";
  }

  function isFallbackLastCheckedAt(){
    return typeof isSmaregiLastCheckedAtFallback==="function" && isSmaregiLastCheckedAtFallback();
  }

  function isCheckedItem(item){
    const barcode=String(item?.barcode||"");
    const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
    return !!check;
  }

  window.getSmaregiCurrentTargetItems=function(){
    const items=Array.isArray(smaregiStockItems) ? smaregiStockItems : [];
    const lastCheckedAt=getLastCheckedAtSafe();
    const lastTime=new Date(lastCheckedAt).getTime();
    return items.filter(item=>{
      const change=getChangeForItem(item);
      const changedAt=change.changed_at || change.movement_datetime || item?.changed_at || item?.movement_datetime;
      const changedTime=new Date(changedAt).getTime();
      if(!Number.isFinite(changedTime))return true;
      if(!Number.isFinite(lastTime))return true;
      return changedTime>lastTime;
    });
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
    const completed=target.filter(isCheckedItem).length;
    return {
      total:target.length,
      completed,
      unchecked:target.length-completed
    };
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
    header.innerHTML=[
      "<th>商品情報</th>",
      "<th>実在庫入力</th>",
      "<th>保存</th>",
      "<th>除外</th>"
    ].join("");
  }

  function buildProductInfo(item){
    const change=getChangeForItem(item);
    const changedAt=change.changed_at || change.movement_datetime || item?.changed_at || item?.movement_datetime || "";
    const dateLabel=changedAt && typeof fmt==="function" ? fmt(changedAt) : changedAt;
    return `<div class="smaregi-final-product-info">
      <strong>${safeText(getItemName(item))}</strong>
      <small>バーコード：${safeText(getItemBarcode(item) || "バーコードなし")}</small>
      <small>最終変動：${safeText(dateLabel || "-")}</small>
    </div>`;
  }

  function ensureSmaregiCsvClearButton(){
    const host=document.getElementById("smaregiCheckFilterControls")
      || document.querySelector(".smaregi-check-filter-controls")
      || document.getElementById("smaregiStockProgress")
      || document.getElementById("smaregiStockCheckCard");
    if(!host)return;
    let button=document.getElementById("clearSmaregiMovementCsvBtn");
    if(!button){
      button=document.createElement("button");
      button.type="button";
      button.id="clearSmaregiMovementCsvBtn";
      button.className="secondary smaregi-clear-csv-button";
      button.textContent="取込済みスマレジ変動CSVを削除";
      host.appendChild(button);
    }
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
      try{ smaregiLatestChangeByBarcode.clear(); }catch(_){}
      showPopup?.("削除完了","取込済みスマレジ変動CSVデータを削除しました。");
      showMessage?.("取込済みスマレジ変動CSVデータを削除しました。","ok");
      window.renderSmaregiStockChecks();
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
    const rawValue=String(input?.value??"").trim();
    console.log("[smaregi actual stock save]",{
      barcode:button?.dataset?.barcode||"",
      rawValue
    });
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

  window.saveSmaregiActualStockFromRow=async function(button){
    if(!smaregiSnapshot){
      showMessage?.("スマレジ在庫変動CSVを取り込んでから保存してください。","err");
      return false;
    }
    const barcode=String(button?.dataset?.barcode||"");
    const actualStock=readActualStockFromButton(button);
    if(actualStock===null)return false;
    const item=(Array.isArray(smaregiStockItems) ? smaregiStockItems : []).find(row=>String(row.barcode||"")===barcode);
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
      const change=getChangeForItem(item);
      const smaregiStock=Number(item.smaregi_stock ?? change.stock_amount ?? 0);
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
        difference_reason_at:previousCheck?.difference_reason_at||null
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
      window.renderSmaregiStockChecks();
      return true;
    }catch(error){
      button.disabled=false;
      showMessage?.("実在庫保存エラー\n"+error.message,"err");
      return false;
    }
  };

  window.renderSmaregiStockChecks=function(){
    stopSmaregiAutoRefresh();
    const body=typeof el==="function" ? el("smaregiStockCheckBody") : document.getElementById("smaregiStockCheckBody");
    if(!body)return;
    const drafts=collectDraftValues();
    setSmaregiCheckTableHeader();
    if(typeof ensureSmaregiCheckFilterControls==="function")ensureSmaregiCheckFilterControls();
    ensureSmaregiCsvClearButton();
    const badge=typeof el==="function" ? el("smaregiStockSnapshotBadge") : document.getElementById("smaregiStockSnapshotBadge");
    const progress=typeof el==="function" ? el("smaregiStockProgress") : document.getElementById("smaregiStockProgress");
    const complete=typeof el==="function" ? el("completeSmaregiStockCheckBtn") : document.getElementById("completeSmaregiStockCheckBtn");
    if(!smaregiSnapshot){
      body.innerHTML='<tr><td colspan="4">スマレジ在庫変動CSVを取り込むと、前回チェック完了以降の変動商品が表示されます。</td></tr>';
      if(badge)badge.textContent="スマレジ在庫変動CSV未取込";
      if(progress)progress.innerHTML='<div>前回チェック完了：2026/06/16 00:00</div><div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>';
      if(complete)complete.disabled=true;
      if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
      return;
    }

    const stats=getSmaregiStats();
    const lastCheckedAt=getLastCheckedAtSafe();
    const lastLabel=lastCheckedAt && typeof fmt==="function" ? fmt(lastCheckedAt) : String(lastCheckedAt||"2026/06/16 00:00");
    if(badge)badge.textContent=`前回チェック完了：${lastLabel}`;
    if(progress){
      progress.innerHTML=[
        `<div class="smaregi-progress-main">今回チェック対象 <span>${stats.total}件</span></div>`,
        `<div>前回チェック完了：<strong>${safeText(lastLabel)}</strong></div>`,
        isFallbackLastCheckedAt()?'<div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>':"",
        `<div>保存済み：${stats.completed}件 / 未チェック：${stats.unchecked}件</div>`
      ].join("");
    }
    if(complete)complete.disabled=!stats.total;

    const visible=getSmaregiFilteredTargetItems();
    if(!visible.length){
      body.innerHTML='<tr><td colspan="4">条件に一致するチェック対象商品はありません。</td></tr>';
      if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
      return;
    }

    body.innerHTML=visible.map(item=>{
      const barcode=String(item.barcode||"");
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
      const checked=!!check;
      const savedActual=check?.actual_stock ?? "";
      const actual=drafts.has(barcode) ? drafts.get(barcode) : savedActual;
      const excludeButton=(typeof hasInventoryPrivilegedAccess==="function" && hasInventoryPrivilegedAccess())
        ? `<button type="button" class="secondary smaregi-row-exclude-btn" data-barcode="${safeText(barcode)}">除外</button>`
        : `<button type="button" class="secondary smaregi-row-exclude-btn" data-barcode="${safeText(barcode)}">除外</button>`;
      return `<tr class="smaregi-work-row ${checked?"is-checked":"is-unchecked"}">
        <td>${buildProductInfo(item)}</td>
        <td><input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="smaregi-actual-stock-input" data-barcode="${safeText(barcode)}" value="${safeText(actual)}"></td>
        <td><button type="button" class="smaregi-row-save-btn" data-barcode="${safeText(barcode)}">${checked?"保存済み":"保存"}</button></td>
        <td>${excludeButton}</td>
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
    if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
  };

  function bootFinalSmaregiCheck(){
    stopSmaregiAutoRefresh();
    if(document.getElementById("smaregiStockCheckBody")){
      try{ window.renderSmaregiStockChecks(); }catch(error){ console.warn("[smaregi final render]",error); }
    }
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",bootFinalSmaregiCheck,{once:true});
  }else{
    setTimeout(bootFinalSmaregiCheck,0);
  }
})();
