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
    header.innerHTML="<th>商品情報</th><th>実在庫入力</th><th>保存</th><th>除外</th>";
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
    const complete=typeof el==="function" ? el("completeSmaregiStockCheckBtn") : document.getElementById("completeSmaregiStockCheckBtn");
    const stats=getSmaregiStats();
    const lastCheckedAt=getLastCheckedAtSafe();
    const lastLabel=lastCheckedAt && typeof fmt==="function" ? fmt(lastCheckedAt) : String(lastCheckedAt||"前回チェック未設定");
    const checker=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
    if(badge)badge.textContent=smaregiSnapshot ? `前回チェック完了：${lastLabel}` : "スマレジ変動CSV未取込";
    if(progress){
      progress.innerHTML=[
        `<div class="smaregi-progress-main">今回チェック対象 <span>${stats.total}件</span></div>`,
        `<div>チェック済み：${stats.completed}件 / 未チェック：${stats.unchecked}件 / 除外：${stats.excluded||0}件</div>`,
        `<div>担当者：<strong>${safeText(checker||"担当者未設定")}</strong></div>`,
        `<div>前回チェック完了：<strong>${safeText(lastLabel||"前回チェック未設定")}</strong></div>`,
        isFallbackLastCheckedAt()?'<div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>':"",
        `<div class="smaregi-progress-area"><div id="smaregiProgressGraph" class="smaregi-progress-graph" role="progressbar" aria-label="チェック進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.percent||0}"><div id="smaregiProgressFill" class="smaregi-progress-fill" style="width:${stats.percent||0}%"></div></div><div id="smaregiProgressText" class="smaregi-progress-text">進捗 ${stats.percent||0}%</div></div>`
      ].join("");
    }
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
    if(!smaregiSnapshot){
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

  window.renderSmaregiStockChecks=function(){
    const body=typeof el==="function" ? el("smaregiStockCheckBody") : document.getElementById("smaregiStockCheckBody");
    if(!body)return;
    const drafts=collectDraftValues();
    setSmaregiCheckTableHeader();
    if(typeof ensureSmaregiCheckFilterControls==="function")ensureSmaregiCheckFilterControls();
    ensureSmaregiCsvClearButton();
    const complete=typeof el==="function" ? el("completeSmaregiStockCheckBtn") : document.getElementById("completeSmaregiStockCheckBtn");
    if(!smaregiSnapshot){
      body.innerHTML='<tr><td colspan="4">スマレジ在庫変動CSVを取り込むと、前回チェック完了以降の変動商品が表示されます。</td></tr>';
      updateSmaregiProgressOnly();
      if(complete)complete.disabled=true;
      renderSmaregiDiffOnlyPanel();
      return;
    }

    updateSmaregiProgressOnly();
    const visible=getSmaregiFilteredTargetItems();
    if(!visible.length){
      body.innerHTML='<tr><td colspan="4">条件に一致するチェック対象商品はありません。</td></tr>';
      renderSmaregiDiffOnlyPanel();
      return;
    }

    body.innerHTML=visible.map(item=>{
      const barcode=String(item.barcode||"");
      const check=typeof getSmaregiCheck==="function" ? getSmaregiCheck(barcode) : null;
      const checked=!!check;
      const savedActual=check?.actual_stock ?? "";
      const actual=drafts.has(barcode) ? drafts.get(barcode) : savedActual;
      const excludeButton=(isMobileViewport() || (typeof hasInventoryPrivilegedAccess==="function" && !hasInventoryPrivilegedAccess()))
        ? ""
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
