/* ARICO TOKYO inventory app: analytics.js */

function hasSmaregiChangeBefore(log,smaregiChanges){
  const time=new Date(log.created_at).getTime();
  return smaregiChanges.some(change=>{
    const changeTime=new Date(change.changed_at).getTime();
    return Number.isFinite(changeTime)&&changeTime<=time;
  });
}

function hasAppLogAfter(change,appLogs){
  const time=new Date(change.changed_at).getTime();
  return appLogs.some(log=>{
    const logTime=new Date(log.created_at).getTime();
    return Number.isFinite(logTime)&&logTime>=time;
  });
}

function looksLikeOnlineShipment(change,smaregiChanges){
  const amount=Number(change.amount||0);
  if(amount<=0)return false;
  const time=new Date(change.changed_at).getTime();
  return smaregiChanges.some(other=>{
    const otherTime=new Date(other.changed_at).getTime();
    return Number(other.amount||0)<0&&otherTime>=time&&otherTime-time<=24*60*60*1000;
  });
}

function buildSmaregiAppHistoryRows(productLogs,barcode,smaregiChanges){
  const product=gp(barcode);
  let running=Number(product?.base_stock||0);
  const desc=productLogs.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return desc.map(log=>{
    const qty=Number(log.quantity||0);
    const after=running;
    if(log.type==="入荷")running-=qty;
    if(log.type==="出荷"||log.type==="備品転用")running+=qty;
    if(log.type==="在庫修正")running=qty;
    const suspicious=smaregiChanges.length>0&&!hasSmaregiChangeBefore(log,smaregiChanges);
    return `<tr class="${suspicious?"smaregi-suspicious-row":""}"><td>${fmt(log.created_at)}</td><td>${esc(log.type)}</td><td>${qty}</td><td>${esc(log.staff||"")}</td><td>${esc(log.memo||"")}${suspicious?'<div class="smaregi-warning">要確認：対応する先行スマレジ変動が見つかりません。</div>':""}</td><td>${after}</td></tr>`;
  }).join("");
}

function buildSmaregiChangeRows(smaregiChanges,appLogs){
  return smaregiChanges.map(change=>{
    const suspicious=!hasAppLogAfter(change,appLogs);
    const online=looksLikeOnlineShipment(change,smaregiChanges);
    return `<tr class="${suspicious?"smaregi-suspicious-row":(online?"smaregi-online-row":"")}"><td>${fmt(change.changed_at)}</td><td>${esc(change.stock_division||"")}</td><td>${Number(change.amount||0)}</td><td>${Number(change.stock_amount||0)}</td><td>${esc(change.memo||"")}${suspicious?'<div class="smaregi-warning">要確認：このスマレジ変動後のシート履歴が見つかりません。</div>':""}${online?'<div class="smaregi-online-note">オンライン注文の発送候補：取り置き解除の在庫増と売上の在庫減が近接しています。</div>':""}</td></tr>`;
  }).join("");
}

async function showSmaregiCauseDetail(barcode){
  if(!isSmaregiManager()){
    showMessage("原因確認は分析画面のパスワード認証後に操作できます。","err");
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
    detail.innerHTML=`
      <div class="section-title"><h3>差異原因確認</h3><button type="button" id="closeSmaregiCauseDetailBtn" class="secondary">閉じる</button></div>
      <div class="smaregi-detail-summary">
        <div><strong>商品名</strong><span>${esc(item.product_name||"")}</span></div>
        <div><strong>棚番</strong><span>${esc(getProductShelfLabel(gp(barcode)||{location:item.location||""}))}</span></div>
        <div><strong>バーコード</strong><span>${esc(barcode)}</span></div>
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
          <input id="smaregiDifferenceReasonMemo" value="${esc(check?.difference_reason_memo||"")}" placeholder="状況や再発防止に必要な補足を入力"/>
        </label>
        <button type="button" id="saveSmaregiDifferenceReasonBtn">原因を保存</button>
      </div>
      <p class="section-note">原因記入者：${esc(check?.difference_reason_by||"未記入")} / 原因記入日時：${check?.difference_reason_at?fmt(check.difference_reason_at):"未記入"}</p>
      <h3>在庫管理シート側の履歴</h3>
      <p class="section-note">前回チェック以降の履歴のみ表示します。赤い行は調査優先です。通常はスマレジ変動の後にシート在庫が動きます。</p>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>担当者</th><th>備考</th><th>処理後在庫</th></tr></thead><tbody>${buildSmaregiAppHistoryRows(appLogs,barcode,smaregiChanges)||'<tr><td colspan="6">履歴なし</td></tr>'}</tbody></table></div>
      <h3>スマレジ側の在庫変動履歴</h3>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>在庫数</th><th>理由・備考</th></tr></thead><tbody>${buildSmaregiChangeRows(smaregiChanges,appLogs)||'<tr><td colspan="5">取得可能なスマレジ履歴はありません。</td></tr>'}</tbody></table></div>
    `;
    el("closeSmaregiCauseDetailBtn").onclick=()=>{detail.hidden=true;detail.innerHTML="";};
    el("saveSmaregiDifferenceReasonBtn").onclick=e=>saveSmaregiDifferenceReason(barcode,e.currentTarget);
    showMessage(`原因確認を表示しました：${item.product_name||barcode}`,"ok");
    detail.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    detail.innerHTML=`<div class="message err">原因確認データ取得エラー。\n${esc(e.message)}</div>`;
    showMessage("原因確認データ取得エラー。\n"+e.message,"err");
  }
}

async function saveSmaregiDifferenceReason(barcode,button=null){
  if(!isSmaregiManager()){
    showMessage("原因登録は分析画面のパスワード認証後に操作できます。","err");
    return;
  }
  const check=getSmaregiCheck(barcode);
  if(!smaregiSnapshot||!check){
    showMessage("原因を記入する差異データが見つかりません。","err");
    return;
  }
  const difference_reason_category=String(el("smaregiDifferenceReasonCategory")?.value||"").trim();
  const difference_reason_memo=String(el("smaregiDifferenceReasonMemo")?.value||"").trim();
  const difference_reason_by=getSmaregiCheckerName();
  if(!difference_reason_category){
    showMessage("原因カテゴリを選択してください。","err");
    el("smaregiDifferenceReasonCategory")?.focus();
    return;
  }
  if(!difference_reason_by){
    showMessage("担当者を選択してください。","err");
    el("smaregiCheckerName")?.focus();
    return;
  }
  await runWithSmaregiAutoRefreshPaused(async()=>{
    const difference_reason_at=new Date().toISOString();
    try{
      await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({difference_reason_category,difference_reason_memo,difference_reason_by,difference_reason_at})
      });
      Object.assign(check,{difference_reason_category,difference_reason_memo,difference_reason_by,difference_reason_at});
      showMessage(`差異原因を保存しました：${difference_reason_category}`,"ok");
      await showSmaregiCauseDetail(barcode);
    }catch(e){
      showMessage("差異原因保存エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
    }
  },{button});
}

function getSmaregiReasonSummaryRows(historical,range=getSmaregiDifferenceDateRange("smaregiReasonFromDate","smaregiReasonToDate")){
  const grouped=new Map();
  historical.forEach(({check,difference})=>{
    if(!isInSmaregiDifferenceDateRange(check.checked_at,range))return;
    if(isSmaregiExcludedCheck(check)||isSmaregiNoIssueCheck(check)||difference===0||!Number.isFinite(difference))return;
    const category=String(check.difference_reason_category||"未分類");
    const current=grouped.get(category)||{category,count:0,differenceTotal:0};
    current.count+=1;
    current.differenceTotal+=Math.abs(difference);
    grouped.set(category,current);
  });
  return [...grouped.values()].sort((a,b)=>b.count-a.count||b.differenceTotal-a.differenceTotal||a.category.localeCompare(b.category,"ja"));
}

function getSmaregiDifferenceRankingRows(historical,range=getSmaregiDifferenceDateRange("smaregiRankingFromDate","smaregiRankingToDate")){
  const grouped=new Map();
  historical.forEach(({check,item,difference})=>{
    if(!isInSmaregiDifferenceDateRange(check.checked_at,range))return;
    if(isSmaregiExcludedCheck(check)||isSmaregiNoIssueCheck(check)||difference===0||!Number.isFinite(difference))return;
    const barcode=String(check.barcode||item.barcode||"");
    if(!barcode)return;
    const current=grouped.get(barcode)||{
      barcode,
      productName:String(item.product_name||item.productName||gp(barcode)?.name||""),
      differenceCount:0,
      differenceTotal:0,
      reasonCounts:new Map()
    };
    const category=String(check.difference_reason_category||"未分類");
    current.differenceCount+=1;
    current.differenceTotal+=Math.abs(difference);
    current.reasonCounts.set(category,(current.reasonCounts.get(category)||0)+1);
    grouped.set(barcode,current);
  });
  return [...grouped.values()].map(row=>{
    const mainReason=[...row.reasonCounts.entries()]
      .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],"ja"))[0]?.[0]||"未分類";
    return {...row,mainReason};
  }).sort((a,b)=>b.differenceCount-a.differenceCount||b.differenceTotal-a.differenceTotal||a.productName.localeCompare(b.productName,"ja"));
}

function renderSmaregiDifferenceRanking(rows){
  const body=el("smaregiDifferenceRankingBody");
  const message=el("smaregiDifferenceRankingMessage");
  if(!body)return;
  body.innerHTML=rows.length
    ? rows.map((row,index)=>`<tr><td><strong>${index+1}位</strong></td><td>${esc(row.barcode)}</td><td>${esc(row.productName)}</td><td>${row.differenceCount}件</td><td>${row.differenceTotal}</td><td>${esc(row.mainReason)}</td></tr>`).join("")
    : '<tr><td colspan="6" class="smaregi-empty">指定期間内の差異商品はありません。</td></tr>';
  if(message)message.textContent=`差異商品：${rows.length}件`;
}

async function loadSmaregiDifferenceRanking(historical=null){
  const panel=el("smaregiDifferenceRankingPanel");
  if(!panel)return;
  const message=el("smaregiDifferenceRankingMessage");
  if(message)message.textContent="差異ランキングを集計中...";
  try{
    const rows=historical || await loadSmaregiHistoricalDifferenceRows();
    renderSmaregiDifferenceRanking(getSmaregiDifferenceRankingRows(rows));
  }catch(e){
    if(message)message.textContent="差異ランキング集計エラー。\n"+e.message;
  }
}

function getMonthRange(monthOffset=0){
  const now=new Date();
  const from=new Date(now.getFullYear(),now.getMonth()+monthOffset,1);
  const to=new Date(now.getFullYear(),now.getMonth()+monthOffset+1,1);
  return {fromTime:from.getTime(),toTime:to.getTime()-1};
}

function getSmaregiAccuracyCurrentRange(){
  const range=typeof getSmaregiDifferenceDateRange==="function"
    ? getSmaregiDifferenceDateRange("smaregiRankingFromDate","smaregiRankingToDate")
    : null;
  return range && (Number.isFinite(range.fromTime)||Number.isFinite(range.toTime)) ? range : getMonthRange(0);
}

function getPreviousRange(range){
  if(!range||!Number.isFinite(range.fromTime)||!Number.isFinite(range.toTime))return getMonthRange(-1);
  const span=Math.max(0,range.toTime-range.fromTime);
  return {fromTime:range.fromTime-span-1,toTime:range.fromTime-1};
}

function calculateSmaregiAccuracy(historical,range){
  const rows=historical.filter(({check})=>isInSmaregiDifferenceDateRange(check.checked_at,range)&&!isSmaregiExcludedCheck(check));
  const checkedCount=rows.length;
  const differenceCount=rows.filter(({check,difference})=>!isSmaregiNoIssueCheck(check)&&Number.isFinite(difference)&&difference!==0).length;
  const differenceRate=checkedCount?differenceCount/checkedCount*100:0;
  const accuracy=checkedCount?(checkedCount-differenceCount)/checkedCount*100:0;
  return {checkedCount,differenceCount,differenceRate,accuracy};
}

function formatPercent(value,digits=1){
  return `${Number(value||0).toFixed(digits)}%`;
}

function getSmaregiAccuracyMonthlyTrend(historical,monthCount=6){
  const rows=[];
  for(let offset=-(monthCount-1);offset<=0;offset+=1){
    const range=getMonthRange(offset);
    const current=calculateSmaregiAccuracy(historical,range);
    if(!current.checkedCount)continue;
    const previous=calculateSmaregiAccuracy(historical,getMonthRange(offset-1));
    const month=new Date(range.fromTime);
    rows.push({
      ...current,
      year:month.getFullYear(),
      month:month.getMonth()+1,
      change:previous.checkedCount ? current.accuracy-previous.accuracy : null
    });
  }
  return rows;
}

function renderSmaregiAccuracyMonthlyTrend(rows){
  const list=el("smaregiAccuracyMonthlyTrend");
  if(!list)return;
  list.innerHTML=rows.length
    ? rows.map(row=>`
      <div class="inventory-accuracy-month-card">
        <strong class="inventory-accuracy-month-title">${row.year}年${row.month}月</strong>
        <div class="inventory-accuracy-month-value">精度 ${formatPercent(row.accuracy)}</div>
        <div class="inventory-accuracy-month-detail">チェック ${row.checkedCount}件</div>
        <div class="inventory-accuracy-month-detail">差異 ${row.differenceCount}件</div>
        <div class="inventory-accuracy-diff ${row.change===null?"":(row.change>=0?"good":"bad")}">前月比 ${row.change===null?"-":`${row.change>=0?"+":""}${row.change.toFixed(1)}%`}</div>
        <div class="inventory-accuracy-mini-bar"><div class="inventory-accuracy-mini-fill" style="width:${Math.max(0,Math.min(100,row.accuracy))}%"></div></div>
      </div>`).join("")
    : '<div class="smaregi-empty">直近6ヶ月の棚卸精度データはありません。</div>';
  list.scrollLeft=list.scrollWidth;
}

async function loadSmaregiAccuracy(historical=null){
  if(!inventoryAuthReady)return;
  const panel=el("smaregiAccuracyPanel");
  if(!panel)return;
  const message=el("smaregiAccuracyMessage");
  try{
    const rows=historical || await loadSmaregiHistoricalDifferenceRows();
    const currentRange=getSmaregiAccuracyCurrentRange();
    const current=calculateSmaregiAccuracy(rows,currentRange);
    const previous=calculateSmaregiAccuracy(rows,getPreviousRange(currentRange));
    const trendRows=typeof loadSmaregiHistoricalDifferenceRows==="function"
      ? await loadSmaregiHistoricalDifferenceRows({recalculateEventStock:false}).catch(()=>rows)
      : rows;
    renderSmaregiAccuracyMonthlyTrend(getSmaregiAccuracyMonthlyTrend(trendRows));
    const change=current.accuracy-previous.accuracy;
    if(el("smaregiAccuracyChecked"))el("smaregiAccuracyChecked").textContent=`${current.checkedCount}件`;
    if(el("smaregiAccuracyDifference"))el("smaregiAccuracyDifference").textContent=`${current.differenceCount}件`;
    if(el("smaregiDifferenceRate"))el("smaregiDifferenceRate").textContent=formatPercent(current.differenceRate);
    if(el("smaregiAccuracyPercent"))el("smaregiAccuracyPercent").textContent=formatPercent(current.accuracy);
    if(el("smaregiPreviousAccuracy"))el("smaregiPreviousAccuracy").textContent=formatPercent(previous.accuracy);
    if(el("smaregiAccuracyFill"))el("smaregiAccuracyFill").style.width=`${Math.max(0,Math.min(100,current.accuracy))}%`;
    const changeEl=el("smaregiAccuracyChange");
    if(changeEl){
      changeEl.textContent=`${change>=0?"+":""}${change.toFixed(1)}%`;
      changeEl.className=change>=0?"is-improved":"is-worse";
    }
    if(message)message.textContent=`指定期間 ${formatPercent(current.accuracy)} / 比較期間 ${formatPercent(previous.accuracy)}`;
  }catch(e){
    if(message)message.textContent="棚卸精度集計エラー。\n"+e.message;
  }
}

let smaregiAnalyticsRefreshTimer=null;

async function refreshSmaregiAnalyticsPanels(){
  const panel=el("smaregiAccuracyPanel");
  if(!panel||panel.hidden)return;
  const historical=await loadSmaregiHistoricalDifferenceRows();
  await loadSmaregiAccuracy(historical);
  await loadSmaregiDifferenceRanking(historical);
}

function scheduleSmaregiAnalyticsRefresh(){
  clearTimeout(smaregiAnalyticsRefreshTimer);
  smaregiAnalyticsRefreshTimer=setTimeout(()=>{
    refreshSmaregiAnalyticsPanels().catch(e=>{
      const message=el("smaregiDifferenceRankingMessage")||el("smaregiAccuracyMessage");
      if(message)message.textContent="棚卸分析の自動更新エラー。\n"+e.message;
    });
  },250);
}

function renderSmaregiReasonSummary(){
  const body=el("smaregiReasonSummaryBody");
  const message=el("smaregiReasonSummaryMessage");
  if(!body)return;
  body.innerHTML=smaregiReasonSummaryRows.length
    ? smaregiReasonSummaryRows.map((row,index)=>`<tr><td><strong>${index+1}位</strong> ${esc(row.category)}</td><td>${row.count}件</td><td>${row.differenceTotal}</td></tr>`).join("")
    : '<tr><td colspan="3" class="smaregi-empty">指定期間内の差異原因はありません。</td></tr>';
  if(message)message.textContent=`原因カテゴリ：${smaregiReasonSummaryRows.length}件`;
}

async function showSmaregiReasonSummary({scroll=true}={}){
  if(!isSmaregiManager()){
    showMessage("差異原因集計は分析画面のパスワード認証後に確認できます。","err");
    return;
  }
  const panel=el("smaregiReasonSummaryPanel");
  if(!panel)return;
  panel.hidden=false;
  const message=el("smaregiReasonSummaryMessage");
  if(message)message.textContent="差異原因を集計中...";
  try{
    smaregiReasonSummaryRows=getSmaregiReasonSummaryRows(await loadSmaregiHistoricalDifferenceRows());
    renderSmaregiReasonSummary();
    if(scroll)panel.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    if(message)message.textContent="差異原因集計エラー。\n"+e.message;
  }
}

async function exportSmaregiReasonSummaryCsv(){
  try{
    smaregiReasonSummaryRows=getSmaregiReasonSummaryRows(await loadSmaregiHistoricalDifferenceRows());
    renderSmaregiReasonSummary();
    const rows=[["原因カテゴリ","件数","差異数量合計"]];
    smaregiReasonSummaryRows.forEach(row=>rows.push([row.category,row.count,row.differenceTotal]));
    downloadCsvFile("smaregi_difference_reason_summary.csv",rows);
    showMessage(`差異原因集計CSVを出力しました：${rows.length-1}件`,"ok");
  }catch(e){
    showMessage("差異原因集計CSV出力エラー。\n"+e.message,"err");
  }
}

/* CSV operation mode: show the previous check close in Smaregi movement history. */
function buildSmaregiChangeRows(smaregiChanges,appLogs){
  const completedAt=smaregiSnapshot?.completed_at ? new Date(smaregiSnapshot.completed_at).getTime() : null;
  let dividerInserted=false;
  const rows=[];
  (smaregiChanges||[]).forEach(change=>{
    const changeTime=new Date(change.changed_at).getTime();
    if(!dividerInserted&&Number.isFinite(completedAt)&&Number.isFinite(changeTime)&&changeTime<=completedAt){
      dividerInserted=true;
      rows.push(`<tr class="smaregi-last-check-divider"><td colspan="5">前回チェック締め：${esc(fmt(smaregiSnapshot.completed_at))}（ここまで前回確認済み）</td></tr>`);
    }
    const suspicious=!hasAppLogAfterSmaregiChange(change,appLogs);
    const online=looksLikeOnlineShipment(change,smaregiChanges);
    rows.push(`<tr class="${suspicious?"smaregi-suspicious-row":(online?"smaregi-online-row":"")}"><td>${fmt(change.changed_at)}</td><td>${esc(change.stock_division||"")}</td><td>${Number(change.amount||0)}</td><td>${Number(change.stock_amount||0)}</td><td>${esc(change.memo||"")}${suspicious?'<div class="smaregi-warning">要確認：このスマレジ変動後のシート履歴が見つかりません。</div>':""}${online?'<div class="smaregi-online-note">オンライン注文の発送候補：取り置き解除の在庫増と売上の在庫減が近接しています。</div>':""}</td></tr>`);
  });
  if(!dividerInserted&&Number.isFinite(completedAt)){
    rows.push(`<tr class="smaregi-last-check-divider"><td colspan="5">前回チェック締め：${esc(fmt(smaregiSnapshot.completed_at))}</td></tr>`);
  }
  return rows.join("");
}
