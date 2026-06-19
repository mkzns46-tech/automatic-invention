/* ARICO inventory app: Smaregi CSV check state and product-code display overrides. */
var smaregiCheckDisplayMode=window.smaregiCheckDisplayMode||"unchecked";
const SMAREGI_DEFAULT_LAST_CHECKED_AT="2026-06-16T00:00:00+09:00";

function getSmaregiRawLastCheckedAt(){
  return smaregiSnapshot?.completed_at||smaregiSnapshot?.range_from||"";
}

function getSmaregiLastCheckedAt(){
  return getSmaregiRawLastCheckedAt()||SMAREGI_DEFAULT_LAST_CHECKED_AT;
}

function isSmaregiLastCheckedAtFallback(){
  return !getSmaregiRawLastCheckedAt();
}

function getInventoryProductCodeByBarcode(barcode){
  const product=typeof gp==="function" ? gp(barcode) : null;
  return String(product?.product_code||product?.productCode||product?.code||"").trim();
}

function getSmaregiItemProductCode(item){
  const barcode=String(item?.barcode||"").trim();
  const change=smaregiLatestChangeByBarcode.get(barcode)||{};
  const productCode=String(item?.product_code||item?.productCode||change.product_code||change.productCode||getInventoryProductCodeByBarcode(barcode)||"").trim();
  if(productCode)return productCode;
  return barcode && !/^\d{8,14}$/.test(barcode) ? barcode : "";
}

function getSmaregiItemBarcode(item){
  const barcode=String(item?.barcode||"").trim();
  return barcode||"バーコードなし";
}

function getSmaregiItemProductName(item){
  const barcode=String(item?.barcode||"").trim();
  const product=typeof gp==="function" ? gp(barcode) : null;
  const change=smaregiLatestChangeByBarcode.get(barcode)||{};
  return String(item?.product_name||item?.productName||change.product_name||change.productName||product?.name||"商品名なし");
}

function buildInventoryProductIdentityHtml(item){
  const name=getSmaregiItemProductName(item);
  const barcode=getSmaregiItemBarcode(item);
  return `<div class="product-history-identity">
    <strong>${esc(name)}</strong>
    <small>バーコード：${esc(barcode)}</small>
  </div>`;
}

function getSmaregiCurrentTargetItems(){
  const lastCheckedAt=getSmaregiLastCheckedAt();
  const lastTime=lastCheckedAt ? new Date(lastCheckedAt).getTime() : NaN;
  return (smaregiStockItems||[]).filter(item=>{
    const barcode=String(item?.barcode||"");
    const change=smaregiLatestChangeByBarcode.get(barcode);
    if(!change)return !Number.isFinite(lastTime);
    const changedTime=new Date(change.changed_at).getTime();
    if(!Number.isFinite(lastTime))return Number.isFinite(changedTime);
    return Number.isFinite(changedTime)&&changedTime>lastTime;
  });
}

function getSmaregiFilteredTargetItems(){
  const keyword=String(el("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
  return getSmaregiCurrentTargetItems().filter(item=>{
    const barcode=String(item?.barcode||"");
    const checked=!!getSmaregiCheck(barcode);
    if(smaregiCheckDisplayMode==="checked"&&!checked)return false;
    if(smaregiCheckDisplayMode==="unchecked"&&checked)return false;
    if(!keyword)return true;
    return [
      getSmaregiItemProductName(item),
      getSmaregiItemProductCode(item),
      getSmaregiItemBarcode(item)
    ].some(value=>String(value||"").toLowerCase().includes(keyword));
  }).sort((a,b)=>{
    const at=new Date(smaregiLatestChangeByBarcode.get(String(a?.barcode||""))?.changed_at||0).getTime();
    const bt=new Date(smaregiLatestChangeByBarcode.get(String(b?.barcode||""))?.changed_at||0).getTime();
    return bt-at||getSmaregiItemProductName(a).localeCompare(getSmaregiItemProductName(b),"ja");
  });
}

function ensureSmaregiCheckFilterControls(){
  const message=el("smaregiMessage");
  if(!message)return;
  let box=el("smaregiCheckFilterControls");
  if(!box){
    box=document.createElement("div");
    box.id="smaregiCheckFilterControls";
    box.className="button-row smaregi-check-filter-controls";
    message.insertAdjacentElement("afterend",box);
  }
  const buttons=[
    ["all","全件表示"],
    ["unchecked","未チェックのみ表示"],
    ["checked","チェック済みのみ表示"]
  ];
  box.innerHTML=buttons.map(([mode,label])=>`<button type="button" class="${smaregiCheckDisplayMode===mode?"primary":"secondary"}" data-smaregi-check-filter="${mode}">${label}</button>`).join("");
  box.querySelectorAll("[data-smaregi-check-filter]").forEach(button=>{
    button.onclick=()=>{
      smaregiCheckDisplayMode=button.dataset.smaregiCheckFilter||"unchecked";
      window.smaregiCheckDisplayMode=smaregiCheckDisplayMode;
      renderSmaregiStockChecks();
    };
  });
}

function renderSmaregiStockChecks(){
  const body=el("smaregiStockCheckBody");
  if(!body)return;
  ensureSmaregiCheckFilterControls();
  const badge=el("smaregiStockSnapshotBadge");
  const progress=el("smaregiStockProgress");
  const complete=el("completeSmaregiStockCheckBtn");
  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="4">スマレジ在庫変動CSVを取り込むと、前回チェック完了以降の変動商品が表示されます。</td></tr>';
    if(badge)badge.textContent="スマレジ在庫変動CSV未取込";
    if(progress)progress.innerHTML=`<div>前回チェック完了：${fmt(SMAREGI_DEFAULT_LAST_CHECKED_AT)}</div><div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>`;
    if(complete)complete.disabled=true;
    renderSmaregiDiffOnlyPanel();
    return;
  }

  const stats=getSmaregiStats();
  const lastCheckedAt=getSmaregiLastCheckedAt();
  const lastLabel=lastCheckedAt ? fmt(lastCheckedAt) : "未完了";
  if(badge)badge.textContent=`前回チェック完了：${lastLabel}`;
  if(progress){
    progress.innerHTML=`
      <div class="smaregi-progress-main">今回チェック対象 <span>${stats.total}件</span></div>
      <div>前回チェック完了：<strong>${esc(lastLabel)}</strong></div>
      ${isSmaregiLastCheckedAtFallback()?'<div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>':""}
      <div>今回チェック対象：前回チェック完了以降のスマレジ在庫変動</div>
      <div>チェック済み：${stats.completed}件 / 未チェック：${stats.unchecked}件</div>
    `;
  }
  if(complete)complete.disabled=!stats.total;

  const visible=getSmaregiFilteredTargetItems();
  if(!visible.length){
    body.innerHTML='<tr><td colspan="4">条件に一致するチェック対象商品はありません。</td></tr>';
    renderSmaregiDiffOnlyPanel();
    return;
  }

  body.innerHTML=visible.map(item=>{
    const barcode=String(item.barcode||"");
    const check=getSmaregiCheck(barcode);
    const checked=!!check;
    const actual=check?.actual_stock??"";
    const comparisonStock=getSmaregiAppStock(barcode);
    const difference=check&&actual!=="" ? calculateSmaregiDifference(Number(item.smaregi_stock||0),Number(actual||0)) : "";
    const status=checked ? "チェック済み" : "未チェック";
    return `<tr class="${checked?"is-checked":"is-unchecked"}">
      <td>${esc(status)}${check?.checked_at?`<div class="smaregi-movement-note">${fmt(check.checked_at)}</div>`:""}</td>
      <td>${buildInventoryProductIdentityHtml(item)}${getSmaregiMovementSummaryHtml(item)}<div class="smaregi-movement-note">比較用在庫：${esc(comparisonStock)} / スマレジ在庫：${Number(item.smaregi_stock||0)} / 差異：${difference===""?"-":difference}</div></td>
      <td><input type="number" class="smaregi-actual-stock-input" data-barcode="${esc(barcode)}" value="${esc(actual)}"></td>
      <td>
        <button type="button" class="smaregi-row-save-btn" data-barcode="${esc(barcode)}">確認</button>
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".smaregi-row-save-btn").forEach(button=>button.onclick=()=>saveSmaregiActualStock(button.dataset.barcode,button));
  renderSmaregiDiffOnlyPanel();
}

function getSmaregiStats(){
  const target=getSmaregiCurrentTargetItems();
  const completed=target.filter(item=>!!getSmaregiCheck(item.barcode)).length;
  return {
    total:target.length,
    targetTotal:target.length,
    completed,
    unchecked:Math.max(0,target.length-completed),
    differences:getSmaregiDiffItems().length
  };
}

function getSmaregiDiffItems(){
  return getSmaregiCurrentTargetItems().map(item=>{
    const check=getSmaregiCheck(item.barcode);
    if(!check||check.actual_stock===""||check.actual_stock===null||typeof check.actual_stock==="undefined")return null;
    const difference=calculateSmaregiDifference(Number(item.smaregi_stock||0),Number(check.actual_stock||0));
    return difference ? {item,check,difference} : null;
  }).filter(Boolean);
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
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      const allChanges=await sbAll("smaregi_stock_changes?select=*&order=changed_at.desc",1000,50000).catch(()=>[]);
      smaregiLatestChangeByBarcode=latestSmaregiChangesByBarcode(allChanges);
      smaregiStockItems=[...smaregiLatestChangeByBarcode.values()].map(change=>({
        snapshot_id:smaregiSnapshot.id,
        barcode:change.barcode,
        product_code:change.product_code||"",
        product_name:change.product_name||"",
        smaregi_stock:change.stock_amount
      }));
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
      await loadSmaregiEventInventoryCache(smaregiStockItems.map(item=>item.barcode));
    }else{
      smaregiCurrentEventStockByBarcode=new Map();
      smaregiEventStorageStockByBarcode=new Map();
    }
    renderSmaregiStockChecks();
    showMessage(smaregiSnapshot
      ? `スマレジ在庫変動データを取得しました：今回対象 ${getSmaregiCurrentTargetItems().length}件`
      : "スマレジ在庫変動データはまだありません。在庫変動CSVを取り込んでください。",smaregiSnapshot?"ok":"");
  }catch(e){
    showMessage("スマレジ在庫変動データ取得エラー。\n"+e.message,"err");
  }
}

async function completeSmaregiStockCheck(){
  if(!smaregiSnapshot){
    showMessage("完了するスマレジ在庫チェックがありません。","err");
    return;
  }
  const stats=getSmaregiStats();
  if(!stats.total){
    showMessage("今回チェック対象の商品がありません。","err");
    return;
  }
  const warning=stats.unchecked>0?`\n\n未チェック商品が${stats.unchecked}件あります。\nこのまま今回のチェックを完了しますか？`:"";
  if(!confirm(`今回のチェックを完了します。\n対象：${stats.total}件\nチェック済み：${stats.completed}件${warning}`))return;
  try{
    const completedAt=new Date().toISOString();
    const completedBy=getSmaregiCheckerName();
    const appliedCount=typeof applySmaregiActualStocksToSheet==="function" ? await applySmaregiActualStocksToSheet(completedBy) : 0;
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at:completedAt})
    });
    smaregiSnapshot.completed_at=completedAt;
    const resetInput=el("resetSmaregiCompletedAtInput");
    if(resetInput)resetInput.value=formatDateTimeLocal(completedAt);
    renderSmaregiStockChecks();
    showPopup("チェック完了",`今回のチェックを完了しました。\n前回チェック完了：${fmt(completedAt)}\nシート在庫へ反映：${appliedCount}件`);
    showMessage(`今回のチェックを完了しました。前回チェック完了：${fmt(completedAt)}`,"ok");
  }catch(e){
    showMessage("チェック完了保存エラー。\n"+e.message,"err");
  }
}

function getSmaregiMovementSummaryHtml(item){
  const barcode=String(item?.barcode||"");
  const change=smaregiLatestChangeByBarcode.get(barcode);
  if(!change)return '<div class="smaregi-movement-note">最終変動：CSV内に変動履歴なし</div>';
  return `<div class="smaregi-movement-note">
    <span>最終変動：${esc(fmt(change.changed_at))}</span>
    <span>変動数：${Number(change.amount||0)}</span>
    <span>理由：${esc(change.stock_division||"-")}</span>
    <span>備考：${esc(change.memo||"")}</span>
  </div>`;
}

function buildSmaregiChangeRows(smaregiChanges,appLogs){
  return smaregiChanges.map(change=>{
    const barcode=String(change.barcode||"");
    const suspicious=!hasAppLogAfter(change,appLogs);
    const online=looksLikeOnlineShipment(change,smaregiChanges);
    return `<tr class="${suspicious?"smaregi-suspicious-row":(online?"smaregi-online-row":"")}">
      <td>${fmt(change.changed_at)}</td>
      <td>${esc(change.stock_division||"")}</td>
      <td>${Number(change.amount||0)}</td>
      <td>${Number(change.stock_amount||0)}</td>
      <td>${esc(change.memo||"")}
        <div class="smaregi-movement-note">バーコード：${esc(barcode||"バーコードなし")}</div>
        ${suspicious?'<div class="smaregi-warning">要確認：このスマレジ変動後のシート履歴が見つかりません。</div>':""}
        ${online?'<div class="smaregi-online-note">オンライン注文の発送候補：取り置き解除の在庫増と売上の在庫減が近接しています。</div>':""}
      </td>
    </tr>`;
  }).join("");
}

async function showSmaregiCauseDetail(barcode){
  if(!isSmaregiManager()){
    showMessage("原因確認は権限確認後に操作できます。","err");
    return;
  }
  const detail=el("smaregiCauseDetail");
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!detail||!item)return;
  showMessage("原因確認データを読み込み中...");
  detail.hidden=false;
  detail.innerHTML='<div class="message">原因確認データを読み込み中...</div>';
  try{
    await fetchProductByBarcode(barcode);
    const allAppLogs=await loadProductHistoryByBarcode(barcode);
    let smaregiChanges=[];
    try{
      smaregiChanges=await sbAll(`smaregi_stock_changes?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=changed_at.desc`,1000,10000);
    }catch(_){
      smaregiChanges=[];
    }
    const rangeFromTime=smaregiSnapshot?.range_from ? new Date(smaregiSnapshot.range_from).getTime() : null;
    const rangeToTime=smaregiSnapshot?.completed_at ? new Date(smaregiSnapshot.completed_at).getTime() : Date.now();
    const inCauseRange=(value)=>{
      const t=new Date(value).getTime();
      if(!Number.isFinite(t))return false;
      if(Number.isFinite(rangeFromTime)&&t<rangeFromTime)return false;
      if(Number.isFinite(rangeToTime)&&t>rangeToTime)return false;
      return true;
    };
    const appLogs=allAppLogs.filter(log=>inCauseRange(log.created_at));
    smaregiChanges=smaregiChanges.filter(change=>inCauseRange(change.changed_at));
    const check=getSmaregiCheck(barcode);
    const difference=getSmaregiDifference(item);
    const barcodeLabel=getSmaregiItemBarcode(item);
    detail.innerHTML=`
      <div class="section-title"><h3>差異原因確認</h3><button type="button" id="closeSmaregiCauseDetailBtn" class="secondary">閉じる</button></div>
      <div class="smaregi-detail-summary">
        <div><strong>商品名</strong><span>${esc(getSmaregiItemProductName(item))}</span></div>
        <div><strong>バーコード</strong><span>${esc(barcodeLabel)}</span></div>
        <div><strong>スマレジ在庫</strong><span>${Number(item.smaregi_stock||0)}</span></div>
        <div><strong>シート在庫</strong><span>${esc(getSmaregiAppStock(barcode))}</span></div>
        <div><strong>実在庫</strong><span>${check?.actual_stock??"-"}</span></div>
        <div><strong>スマレジ差異</strong><span class="smaregi-difference${difference ? " is-negative" : ""}">${difference??"-"}</span></div>
        <div><strong>担当者</strong><span>${esc(check?.checked_by||"")}</span></div>
        <div><strong>チェック日時</strong><span>${check?.checked_at?fmt(check.checked_at):""}</span></div>
      </div>
      <div class="smaregi-reason-form">
        <label>原因カテゴリ
          <select id="smaregiDifferenceReasonCategory">
            <option value="">選択してください</option>
            ${SMAREGI_DIFFERENCE_REASON_CATEGORIES.map(category=>`<option value="${esc(category)}" ${check?.difference_reason_category===category?"selected":""}>${esc(category)}</option>`).join("")}
          </select>
        </label>
        <label>原因メモ
          <input id="smaregiDifferenceReasonMemo" value="${esc(check?.difference_reason_memo||"")}" placeholder="状況や再発防止に必要な補足を入力">
        </label>
        <button type="button" id="saveSmaregiDifferenceReasonBtn">原因を保存</button>
      </div>
      <p class="section-note">原因記入者：${esc(check?.difference_reason_by||"未記入")} / 原因記入日時：${check?.difference_reason_at?fmt(check.difference_reason_at):"未記入"}</p>
      <h3>在庫管理シート側の履歴</h3>
      <p class="section-note">前回チェック以降の履歴のみ表示します。赤い行は調査優先です。</p>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>担当者</th><th>備考</th><th>処理後在庫</th></tr></thead><tbody>${buildSmaregiAppHistoryRows(appLogs,barcode,smaregiChanges)||'<tr><td colspan="6">履歴なし</td></tr>'}</tbody></table></div>
      <h3>スマレジ側の在庫変動履歴</h3>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>在庫数</th><th>理由・備考</th></tr></thead><tbody>${buildSmaregiChangeRows(smaregiChanges,appLogs)||'<tr><td colspan="5">取得可能なスマレジ履歴はありません。</td></tr>'}</tbody></table></div>
    `;
    el("closeSmaregiCauseDetailBtn").onclick=()=>{detail.hidden=true;detail.innerHTML="";};
    el("saveSmaregiDifferenceReasonBtn").onclick=e=>saveSmaregiDifferenceReason(barcode,e.currentTarget);
    showMessage(`原因確認を表示しました：${getSmaregiItemProductName(item)}`,"ok");
    detail.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    detail.innerHTML=`<div class="message err">原因確認データ取得エラー。\n${esc(e.message)}</div>`;
    showMessage("原因確認データ取得エラー。\n"+e.message,"err");
  }
}

/* Final UI override: movement check is count/confirm only. */
function buildInventoryProductIdentityHtml(item){
  const name=getSmaregiItemProductName(item);
  const barcode=getSmaregiItemBarcode(item);
  const change=smaregiLatestChangeByBarcode.get(String(item?.barcode||""));
  return `<div class="product-history-identity">
    <strong>${esc(name)}</strong>
    <small>バーコード：${esc(barcode)}${change?.changed_at?`<br>最終変動日時：${esc(fmt(change.changed_at))}`:""}</small>
  </div>`;
}

function setSmaregiCheckTableHeader(){
  const body=el("smaregiStockCheckBody");
  const header=body?.closest("table")?.querySelector("thead tr");
  if(!header)return;
  header.innerHTML="<th>商品情報</th><th>変動数</th><th>現在庫</th><th>実在庫入力</th><th>保存</th><th>状態</th><th>確認</th>";
}

function renderSmaregiStockChecks(){
  const body=el("smaregiStockCheckBody");
  if(!body)return;
  setSmaregiCheckTableHeader();
  ensureSmaregiCheckFilterControls();
  const badge=el("smaregiStockSnapshotBadge");
  const progress=el("smaregiStockProgress");
  const complete=el("completeSmaregiStockCheckBtn");
  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="7">スマレジ在庫変動CSVを取り込むと、前回チェック完了以降の変動商品が表示されます。</td></tr>';
    if(badge)badge.textContent="スマレジ在庫変動CSV未取込";
    if(progress)progress.innerHTML=`<div>前回チェック完了：${fmt(SMAREGI_DEFAULT_LAST_CHECKED_AT)}</div><div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>`;
    if(complete)complete.disabled=true;
    renderSmaregiDiffOnlyPanel();
    return;
  }

  const stats=getSmaregiStats();
  const lastCheckedAt=getSmaregiLastCheckedAt();
  const lastLabel=lastCheckedAt ? fmt(lastCheckedAt) : "未完了";
  if(badge)badge.textContent=`前回チェック完了：${lastLabel}`;
  if(progress){
    progress.innerHTML=`
      <div class="smaregi-progress-main">今回チェック対象 <span>${stats.total}件</span></div>
      <div>前回チェック完了：<strong>${esc(lastLabel)}</strong></div>
      ${isSmaregiLastCheckedAtFallback()?'<div class="smaregi-warning">前回チェック日時未設定のため 2026/06/16 を基準にしています</div>':""}
      <div>今回チェック対象：前回チェック完了以降のスマレジ在庫変動</div>
      <div>チェック済み：${stats.completed}件 / 未チェック：${stats.unchecked}件</div>
    `;
  }
  if(complete)complete.disabled=!stats.total;

  const visible=getSmaregiFilteredTargetItems();
  if(!visible.length){
    body.innerHTML='<tr><td colspan="7">条件に一致するチェック対象商品はありません。</td></tr>';
    renderSmaregiDiffOnlyPanel();
    return;
  }

  body.innerHTML=visible.map(item=>{
    const barcode=String(item.barcode||"");
    const check=getSmaregiCheck(barcode);
    const checked=!!check;
    const actual=check?.actual_stock??"";
    const change=smaregiLatestChangeByBarcode.get(barcode)||{};
    const movementAmount=Number(change.amount||0);
    const currentStock=Number(item.smaregi_stock||change.stock_amount||0);
    const status=checked ? "チェック済み" : "未チェック";
    const disabled=checked ? "disabled" : "";
    return `<tr class="${checked?"is-checked":"is-unchecked"}">
      <td>${buildInventoryProductIdentityHtml(item)}</td>
      <td>${movementAmount}</td>
      <td>${currentStock}</td>
      <td><input type="number" class="smaregi-actual-stock-input" data-barcode="${esc(barcode)}" value="${esc(actual)}"></td>
      <td><button type="button" class="smaregi-row-save-btn" data-barcode="${esc(barcode)}">保存</button></td>
      <td>${esc(status)}${check?.checked_at?`<div class="smaregi-movement-note">${fmt(check.checked_at)}</div>`:""}</td>
      <td><button type="button" class="smaregi-row-confirm-btn" data-barcode="${esc(barcode)}" ${disabled}>${checked?"確認済み":"確認"}</button></td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".smaregi-row-save-btn").forEach(button=>button.onclick=()=>saveSmaregiActualStock(button.dataset.barcode,button));
  body.querySelectorAll(".smaregi-row-confirm-btn").forEach(button=>button.onclick=()=>saveSmaregiActualStock(button.dataset.barcode,button));
  renderSmaregiDiffOnlyPanel();
}
