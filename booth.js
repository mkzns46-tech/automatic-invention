/* ARICO TOKYO inventory app: booth.js */

let boothEvents=[];
let boothCurrentEventId="";
let boothFilterFrom="";
let boothFilterTo="";
let boothCameraStream=null;
let boothBarcodeDetector=null;
let boothCameraScanning=false;
let boothZXingReader=null;
let boothZXingRunning=false;
let boothLastScan="";
let boothLastScanAt=0;
let boothNoScanTimer=null;
let boothCurrentVideoTrack=null;
let boothProductPreviewTimer=null;
let boothScanTarget="carry-out";
let boothEventRegisterSettings=[];

function showBoothManagement(){
  showInventoryScreen("booth");
  renderBoothShell();
  loadBoothEvents();
}

function showBoothLocalMessage(text,type=""){
  const message=el("boothMessage");
  if(message){
    message.textContent=text;
    message.className="message "+type;
  }
}

function getBoothStaffDisplayName(staff){
  return typeof getStaffDisplayName==="function" ? getStaffDisplayName(staff) : (staff?.name||"");
}

function getBoothStaffOptions(placeholder="担当者を選択"){
  return `<option value="">${esc(placeholder)}</option>`+((staffMembers||[]).map(staff=>{
    const label=getBoothStaffDisplayName(staff);
    return `<option value="${esc(label)}">${esc(label)}</option>`;
  }).join(""));
}

function validateBoothStaffStore(staffValue,title="店舗確認エラー",focusId=""){
  if(typeof enforceStaffStoreMatch==="function")return enforceStaffStoreMatch(staffValue,title,focusId);
  return true;
}

async function loadBoothEvents(){
  try{
    showBoothLocalMessage("イベントを読み込み中...");
    const events=await sb("booth_events?select=*&order=created_at.desc&limit=200");
    boothEvents=Array.isArray(events)?events:[];
    renderBoothEvents(boothEvents);
    showBoothLocalMessage(boothEvents.length?`イベント ${boothEvents.length}件を表示しています。`:"イベントはまだありません。","ok");
  }catch(e){
    if(typeof showMessage==="function")showMessage("イベント読み込みエラー\n"+e.message,"err");
    else showBoothLocalMessage("イベント読み込みエラー\n"+e.message,"err");
  }
}

function renderBoothShell(){
  const root=el("boothManagementRoot");
  if(!root)return;
  root.innerHTML=`
    <div class="booth-layout">
      <section class="booth-card booth-create-card">
        <h3>イベント作成</h3>
        <form id="boothEventForm" class="booth-form" novalidate>
          <label>イベント名<span class="required">必須</span>
            <input id="boothEventName" autocomplete="off" placeholder="例：インターハイ">
          </label>
          <div class="booth-form-grid">
            <label>会場<span class="required">必須</span>
              <input id="boothEventVenue" autocomplete="off" placeholder="例：夢の島">
            </label>
            <label>作成者<span class="required">必須</span>
              <select id="boothEventCreatedBy">
                ${getBoothStaffOptions()}
              </select>
            </label>
          </div>
          <div class="booth-form-grid">
            <label>開始日<span class="required">必須</span>
              <input id="boothEventStart" type="date">
            </label>
            <label>終了日<span class="required">必須</span>
              <input id="boothEventEnd" type="date">
            </label>
          </div>
          <label>メモ
            <textarea id="boothEventMemo" class="booth-textarea" placeholder="搬入メモ、注意事項など"></textarea>
          </label>
          <button type="submit">イベントを作成</button>
        </form>
      </section>
      <section class="booth-card booth-list-card">
        <div class="booth-list-header">
          <h3>イベント一覧</h3>
          <button type="button" id="reloadBoothEventsBtn" class="secondary">再読み込み</button>
        </div>
        <div class="booth-filter-row">
          <label>開始日
            <input id="boothFilterFromDate" type="date">
          </label>
          <label>終了日
            <input id="boothFilterToDate" type="date">
          </label>
          <button type="button" id="filterBoothEventsBtn" class="secondary">絞り込み</button>
          <button type="button" id="resetBoothEventsFilterBtn" class="secondary">リセット</button>
        </div>
        <div id="boothEventList" class="booth-event-list">
          <div class="booth-empty">読み込み中...</div>
        </div>
      </section>
    </div>
    <section id="boothEventDetailRoot" class="booth-card booth-detail-card" hidden></section>`;

  const form=el("boothEventForm");
  if(form&&!form.dataset.bound){
    form.dataset.bound="1";
    form.addEventListener("submit",e=>{
      e.preventDefault();
      createBoothEvent();
    });
  }
  const reload=el("reloadBoothEventsBtn");
  if(reload&&!reload.dataset.bound){
    reload.dataset.bound="1";
    reload.addEventListener("click",loadBoothEvents);
  }
  const filter=el("filterBoothEventsBtn");
  if(filter&&!filter.dataset.bound){
    filter.dataset.bound="1";
    filter.addEventListener("click",applyBoothEventFilter);
  }
  const reset=el("resetBoothEventsFilterBtn");
  if(reset&&!reset.dataset.bound){
    reset.dataset.bound="1";
    reset.addEventListener("click",resetBoothEventFilter);
  }
}

function getFilteredBoothEvents(events){
  const rows=Array.isArray(events)?events:[];
  if(!boothFilterFrom&&!boothFilterTo)return rows;
  return rows.filter(event=>{
    const start=String(event.event_start||event.event_end||"");
    const end=String(event.event_end||event.event_start||"");
    if(boothFilterFrom&&end&&end<boothFilterFrom)return false;
    if(boothFilterTo&&start&&start>boothFilterTo)return false;
    return true;
  });
}

function isBoothEventClosedStatus(event){
  return String(event?.status||"").toLowerCase()==="closed";
}

function getBoothTodayKey(){
  const now=new Date();
  const y=now.getFullYear();
  const m=String(now.getMonth()+1).padStart(2,"0");
  const d=String(now.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function getBoothDateKey(value){
  return String(value||"").slice(0,10);
}

function getBoothListStatusInfo(event){
  if(isBoothEventClosedStatus(event))return {label:"締め済み",className:"booth-status-closed"};
  const today=getBoothTodayKey();
  const start=getBoothDateKey(event?.event_start);
  const end=getBoothDateKey(event?.event_end);
  if(start&&today<start)return {label:"開催予定",className:"booth-status-upcoming"};
  if(end&&today>end)return {label:"締め前",className:"booth-status-draft"};
  if((!start||today>=start)&&(!end||today<=end))return {label:"開催中",className:"booth-status-active"};
  return {label:"締め前",className:"booth-status-draft"};
}

function applyBoothEventFilter(){
  const from=String(el("boothFilterFromDate")?.value||"").trim();
  const to=String(el("boothFilterToDate")?.value||"").trim();
  if(from&&to&&from>to){
    const errorText="終了日は開始日以降の日付を入力してください。";
    showBoothLocalMessage(errorText,"err");
    if(typeof playErrorSound==="function")playErrorSound();
    if(typeof showPopup==="function")showPopup("イベント絞り込みエラー",errorText);
    el("boothFilterToDate")?.focus();
    return;
  }
  boothFilterFrom=from;
  boothFilterTo=to;
  renderBoothEvents(boothEvents);
  const count=getFilteredBoothEvents(boothEvents).length;
  showBoothLocalMessage(`絞り込み結果：${count}件`,"ok");
}

function resetBoothEventFilter(){
  boothFilterFrom="";
  boothFilterTo="";
  if(el("boothFilterFromDate"))el("boothFilterFromDate").value="";
  if(el("boothFilterToDate"))el("boothFilterToDate").value="";
  renderBoothEvents(boothEvents);
  showBoothLocalMessage(boothEvents.length?`イベント ${boothEvents.length}件を表示しています。`:"イベントはまだありません。","ok");
}

function renderBoothEvents(events){
  const list=el("boothEventList");
  if(!list)return;
  const rows=getFilteredBoothEvents(events);
  const hasActiveFilter=Boolean(boothFilterFrom||boothFilterTo);
  const openRows=rows.filter(event=>!isBoothEventClosedStatus(event));
  const closedRows=rows.filter(event=>isBoothEventClosedStatus(event));
  const visibleRows=hasActiveFilter?rows:openRows;
  const eventCardHtml=event=>{
    const dateText=[event.event_start,event.event_end].filter(Boolean).join(" - ")||"日程未設定";
    const statusInfo=getBoothListStatusInfo(event);
    return `<article class="booth-event-item ${String(boothCurrentEventId)===String(event.id)?"is-open":""} ${isBoothEventClosedStatus(event)?"is-closed":""}">
      <div class="booth-event-main">
        <div class="booth-event-title-row">
          <strong>${esc(event.name||"無題イベント")}</strong>
          <span class="booth-status ${esc(statusInfo.className)}">${esc(statusInfo.label)}</span>
        </div>
        <div class="booth-event-meta">
          <span>会場：${esc(event.venue||"-")}</span>
          <span>日程：${esc(dateText)}</span>
          <span>作成者：${esc(event.created_by||"-")}</span>
        </div>
        ${event.memo?`<p class="booth-event-memo">${esc(event.memo)}</p>`:""}
      </div>
      <div class="booth-event-actions">
        <button type="button" class="secondary booth-open-event-btn" data-event-id="${esc(event.id)}">開く</button>
        <button type="button" class="booth-delete-event-btn" data-event-id="${esc(event.id)}">削除</button>
      </div>
    </article>`;
  };
  if(!rows.length){
    list.innerHTML='<div class="booth-empty">条件に一致するイベントはありません。</div>';
    return;
  }
  const openHtml=visibleRows.length
    ? visibleRows.map(eventCardHtml).join("")
    : '<div class="booth-empty">締め前のイベントはありません。</div>';
  const closedHtml=(!hasActiveFilter&&closedRows.length)
    ? `<details class="booth-closed-events-collapse">
        <summary>締め済みイベント ${closedRows.length}件</summary>
        <div class="booth-event-list booth-closed-event-list">${closedRows.map(eventCardHtml).join("")}</div>
      </details>`
    : "";
  list.innerHTML=[openHtml,closedHtml].filter(Boolean).join("");

  list.querySelectorAll(".booth-open-event-btn").forEach(button=>{
    button.addEventListener("click",()=>openBoothEvent(button.dataset.eventId));
  });
  list.querySelectorAll(".booth-delete-event-btn").forEach(button=>{
    button.addEventListener("click",()=>deleteBoothEvent(button.dataset.eventId));
  });
  return;
  if(!rows.length){
    list.innerHTML='<div class="booth-empty">イベントはまだありません。</div>';
    return;
  }
  list.innerHTML=rows.map(event=>{
    const dateText=[event.event_start,event.event_end].filter(Boolean).join(" - ")||"日程未設定";
    return `<article class="booth-event-item ${String(boothCurrentEventId)===String(event.id)?"is-open":""}">
      <div class="booth-event-main">
        <div class="booth-event-title-row">
          <strong>${esc(event.name||"無題イベント")}</strong>
        </div>
        <div class="booth-event-meta">
          <span>会場：${esc(event.venue||"-")}</span>
          <span>日程：${esc(dateText)}</span>
          <span>作成者：${esc(event.created_by||"-")}</span>
        </div>
        ${event.memo?`<p class="booth-event-memo">${esc(event.memo)}</p>`:""}
      </div>
      <div class="booth-event-actions">
        <button type="button" class="secondary booth-open-event-btn" data-event-id="${esc(event.id)}">開く</button>
        <button type="button" class="booth-delete-event-btn" data-event-id="${esc(event.id)}">削除</button>
      </div>
    </article>`;
  }).join("");

  list.querySelectorAll(".booth-open-event-btn").forEach(button=>{
    button.addEventListener("click",()=>openBoothEvent(button.dataset.eventId));
  });
  list.querySelectorAll(".booth-delete-event-btn").forEach(button=>{
    button.addEventListener("click",()=>deleteBoothEvent(button.dataset.eventId));
  });
}

function showBoothEventCreateError(text){
  showBoothLocalMessage(text,"err");
  if(typeof playErrorSound==="function")playErrorSound();
  if(typeof showPopup==="function")showPopup("イベント作成エラー",text);
}

async function createBoothEvent(){
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const name=String(el("boothEventName")?.value||"").trim();
  const venue=String(el("boothEventVenue")?.value||"").trim();
  const event_start=String(el("boothEventStart")?.value||"").trim()||null;
  const event_end=String(el("boothEventEnd")?.value||"").trim()||null;
  const created_by=String(el("boothEventCreatedBy")?.value||"").trim();
  const memo=String(el("boothEventMemo")?.value||"").trim();

  if(!name||!venue||!event_start||!event_end||!created_by){
    const errorText="イベント名、会場、開始日、終了日、作成者は必須です。";
    showBoothEventCreateError(errorText);
    const firstEmpty=[
      ["boothEventName",name],
      ["boothEventVenue",venue],
      ["boothEventStart",event_start],
      ["boothEventEnd",event_end],
      ["boothEventCreatedBy",created_by]
    ].find(([,value])=>!value);
    if(firstEmpty)el(firstEmpty[0])?.focus();
    return;
  }

  if(event_start>event_end){
    const errorText="終了日は開始日以降の日付を入力してください。";
    showBoothEventCreateError(errorText);
    el("boothEventEnd")?.focus();
    return;
  }
  if(!validateBoothStaffStore(created_by,"店舗確認エラー","boothEventCreatedBy"))return;
  const createContext=typeof getCurrentSmaregiContext==="function"
    ? getCurrentSmaregiContext()
    : {storeCode:"tokyo",storeName:"東京"};

  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "イベント作成確認",
      typeof getSmaregiOperationContextText==="function"
        ? getSmaregiOperationContextText(`イベント名：${name}\n会場：${venue}\n対象期間：${event_start} ～ ${event_end}`)
        : `イベント名：${name}\n会場：${venue}\n対象期間：${event_start} ～ ${event_end}`,
      {okText:"作成"}
    );
    if(!ok)return;
  }

  try{
    const payload={
      name,
      venue,
      event_start,
      event_end,
      created_by,
      store_code:createContext.storeCode,
      store_name:createContext.storeName,
      memo,
      status:"draft"
    };
    const created=await sb("booth_events",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([payload])
    });
    const row=Array.isArray(created)&&created[0]?created[0]:payload;
    boothEvents=[row,...boothEvents];
    renderBoothEvents(boothEvents);
    el("boothEventForm")?.reset();
    const successText=`イベントを作成しました：${row.name||name}`;
    showBoothLocalMessage(successText,"ok");
    if(typeof showMessage==="function")showMessage(successText,"ok");
    if(typeof showPopup==="function")showPopup("イベント作成完了",`イベント名：${row.name||name}\n会場：${row.venue||venue}\n日程：${row.event_start||event_start} - ${row.event_end||event_end}`);
  }catch(e){
    if(typeof showMessage==="function")showMessage("イベント作成エラー\n"+e.message,"err");
    else showBoothLocalMessage("イベント作成エラー\n"+e.message,"err");
  }
}

function openBoothEvent(eventId){
  boothCurrentEventId=String(eventId||"");
  const event=boothEvents.find(row=>String(row.id)===boothCurrentEventId);
  renderBoothEvents(boothEvents);
  const message=el("boothMessage");
  if(message){
    message.textContent=event
      ? `イベントを開きました：${event.name}\n持ち出しスキャン、戻り棚卸、スマレジ在庫連携は次フェーズで実装します。`
      : "イベントが見つかりません。";
    message.className=event?"message ok":"message err";
  }
}

function getBoothStatusLabel(status){
  const map={
    draft:"下書き",
    active:"開催中",
    closed:"締め済み",
    cancelled:"取消"
  };
  return map[status]||status||"-";
}

function getBoothCurrentEvent(){
  return boothEvents.find(row=>String(row.id)===String(boothCurrentEventId||""))||null;
}

async function exportPreviousBoothEventPlanCsv(targetEventId){
  const sourceEventId=String(el("boothCopySourceEvent")?.value||"").trim();
  if(!sourceEventId){
    boothShowError("前回イベントCSV出力エラー","コピー元イベントを選択してください。","boothCopySourceEvent");
    return;
  }
  try{
    const sourceEvent=boothEvents.find(event=>String(event.id)===sourceEventId);
    const rows=await fetchBoothPlanSourceItems(sourceEventId);
    const exportRows=(Array.isArray(rows)?rows:[]).filter(item=>{
      const planned=getBoothPlannedCopyNumbers(item);
      return planned.plannedNormal>0||planned.plannedStorage>0||planned.plannedGacha>0;
    });
    if(!exportRows.length){
      boothShowError("前回イベントCSV出力エラー","CSV出力できる前回イベント実績がありません。");
      return;
    }
    const csvRows=[
      ["商品名","バーコード","通常棚予定数","保管在庫予定数","ガチャ予定数","前回販売数","前回戻り数","前回差異"],
      ...exportRows.map(item=>{
        const planned=getBoothPlannedCopyNumbers(item);
        return [
          item.product_name||"",
          item.barcode||"",
          planned.plannedNormal,
          planned.plannedStorage,
          planned.plannedGacha,
          Number(item.sold_qty||0),
          Number(item.returned_qty||0),
          Number(item.difference_qty||0)
        ];
      })
    ];
    const safeName=String(sourceEvent?.name||"previous_event").replace(/[\\/:*?"<>|]/g,"_");
    const filename=`previous_event_copy_${safeName}_${new Date().toISOString().slice(0,10)}.csv`;
    if(typeof downloadCsvFile==="function")downloadCsvFile(filename,csvRows);
    else{
      const csv=csvRows.map(row=>row.map(value=>`"${String(value??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
      const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      a.download=filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{try{document.body.removeChild(a);}catch(_){} URL.revokeObjectURL(url);},1000);
    }
    boothShowSuccess("前回イベントCSV出力完了",`CSVを出力しました：${exportRows.length}件\n在庫・履歴・スマレジ在庫は変更していません。`);
  }catch(e){
    boothShowError("前回イベントCSV出力エラー","CSV出力に失敗しました。\n"+e.message);
  }
}

function renderBoothEventDetail(event){
  const detail=el("boothEventDetailRoot");
  if(!detail)return;
  if(!event){
    detail.hidden=true;
    detail.innerHTML="";
    return;
  }
  detail.hidden=false;
  detail.innerHTML=`
    <div class="booth-detail-header">
      <div>
        <p class="booth-detail-label">イベント詳細</p>
        <h3>${esc(event.name||"無題イベント")}</h3>
      </div>
      <span class="booth-status booth-status-${esc(event.status||"draft")}">${esc(getBoothStatusLabel(event.status))}</span>
    </div>
    <div class="booth-detail-grid">
      <div><span>イベント名</span><strong>${esc(event.name||"-")}</strong></div>
      <div><span>会場</span><strong>${esc(event.venue||"-")}</strong></div>
      <div><span>開始日</span><strong>${esc(event.event_start||"-")}</strong></div>
      <div><span>終了日</span><strong>${esc(event.event_end||"-")}</strong></div>
      <div><span>担当者</span><strong>${esc(event.created_by||"-")}</strong></div>
      <div><span>状態</span><strong>${esc(getBoothStatusLabel(event.status))}</strong></div>
      <div class="booth-detail-memo"><span>メモ</span><strong>${esc(event.memo||"-")}</strong></div>
    </div>
    <div class="booth-work-menu-title">作業内容を選んでください</div>
    <div class="booth-event-menu" aria-label="イベント内メニュー">
      <button type="button" class="booth-event-menu-btn" data-booth-menu="copy">前回イベントコピー</button>
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">イベント在庫一覧</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="history">持ち出し履歴</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">戻り棚卸</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="storage">イベント保管</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="gacha">ガチャ管理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="sales">販売取込</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="diff">差異確認</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="close">イベント締め</button>
    </div>
    <section class="booth-copy-card">
      <div>
        <h4>前回イベントコピー</h4>
        <p class="section-note">コピー時はピッキング予定数量だけ保存します。在庫・履歴・スマレジ在庫は変更しません。</p>
      </div>
      <div class="booth-copy-row">
        <label>コピー元イベント
          <select id="boothCopySourceEvent">
            <option value="">コピー元イベントを選択</option>
            ${getBoothCopySourceEventOptions(event)}
          </select>
        </label>
        <button type="button" id="boothCopyPreviousEventBtn" class="secondary" ${isBoothEventClosed(event)?"disabled":""}>予定リストへコピー</button>
        <button type="button" id="boothCopyCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothCopyPdfBtn" class="secondary">PDF出力</button>
      </div>
      <div id="boothPlannedList" class="booth-planned-list">
        <div class="booth-empty">予定リストを読み込み中...</div>
      </div>
    </section>
    <section class="booth-copy-card">
      <div>
        <h4>前回イベントコピー</h4>
        <p class="section-note">コピー時はピッキング予定数量だけ保存します。在庫・履歴・スマレジ在庫は変更しません。</p>
      </div>
      <div class="booth-copy-row">
        <label>コピー元イベント
          <select id="boothCopySourceEvent">
            <option value="">コピー元イベントを選択</option>
            ${getBoothCopySourceEventOptions(event)}
          </select>
        </label>
        <button type="button" id="boothCopyPreviousEventBtn" class="secondary" ${closed?"disabled":""}>予定リストへコピー</button>
        <button type="button" id="boothCopyCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothCopyPdfBtn" class="secondary">PDF出力</button>
      </div>
      <div id="boothPlannedList" class="booth-planned-list">
        <div class="booth-empty">予定リストを読み込み中...</div>
      </div>
    </section>
    <div id="boothEventWorkArea" class="booth-work-area">
      <section class="booth-work-card booth-carry-out-card">
        <h4>持ち出しスキャン</h4>
        <p class="section-note">event_id: ${esc(event.id)} に紐づける前提の入力エリアです。スマレジAPI連携はまだ行いません。</p>
        <div class="booth-scan-row">
          <label>バーコード
            <input id="boothCarryOutBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力">
          </label>
          <label>数量
            <input id="boothCarryOutQty" type="number" min="1" step="1" value="1">
          </label>
          <button type="button" id="boothCarryOutRegisterBtn">持ち出し登録</button>
        </div>
      </section>
      <section class="booth-work-card booth-carry-history-card">
        <h4>持ち出し履歴</h4>
        <div class="booth-empty">まだ持ち出し履歴はありません。</div>
      </section>
    </div>`;

  renderBoothCopyCard(event,closed);

  detail.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.addEventListener("click",()=>switchBoothEventMenu(button.dataset.boothMenu));
  });
  el("boothCarryOutRegisterBtn")?.addEventListener("click",registerBoothCarryOutDraft);
}

function switchBoothEventMenu(menu){
  const event=getBoothCurrentEvent();
  if(!event){
    if(typeof showMessage==="function")showMessage("イベントを開いてから操作してください。","err");
    return;
  }
  if(menu==="copy"){
    renderBoothCopyPanel(event);
    return;
  }
  document.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.classList.toggle("is-active",button.dataset.boothMenu===menu);
  });
  if(menu==="copy"){
    renderBoothCopyPanel(event);
    return;
  }
  if(menu==="carry-out"){
    renderBoothEventDetail(event);
    return;
  }
  if(menu==="return"){
    renderBoothReturnPanel(event);
    return;
  }
  if(menu==="gacha"){
    renderBoothGachaPanel(event);
    return;
  }
  if(menu==="sales"){
    renderBoothSalesPanel(event);
    return;
  }
  if(menu==="diff"){
    renderBoothDiffPanel(event);
    return;
  }
  if(menu==="storage"){
    renderBoothReturnPanel(event);
    return;
  }
  if(menu==="close"){
    confirmBoothEventClosePreparing(event);
    return;
  }
  showBoothLocalMessage("準備中です","ok");
  if(typeof showPopup==="function")showPopup("準備中","準備中です");
}

async function confirmBoothSalesImportPreparing(event){
  const period=[event?.event_start,event?.event_end].filter(Boolean).join(" ～ ")||"-";
  const body=[
    `イベント名：\n${event?.name||"-"}`,
    typeof getSmaregiOperationContextText==="function"
      ? getSmaregiOperationContextText(`対象期間：\n${period}\n\nこの条件で販売データを取得します。`)
      : `対象期間：\n${period}\n\nこの条件で販売データを取得します。`
  ].join("\n\n");
  const ok=typeof confirmAppAction==="function"
    ? await confirmAppAction("販売取り込み確認",body,{okText:"仮取り込み"})
    : true;
  if(!ok)return;
  if(typeof showPopup==="function")showPopup("準備中","販売取り込みは次フェーズで実装します。");
}

async function confirmBoothEventClosePreparing(event){
  const area=el("boothEventWorkArea");
  if(!event||!event.id){
    boothShowError("イベント締めエラー","イベントが見つかりません。");
    return;
  }
  if(isBoothEventClosed(event)){
    boothShowError("イベント締めエラー","このイベントはすでに締め済みです。");
    return;
  }
  if(area)area.innerHTML='<section class="booth-work-card"><div class="booth-empty">締め前確認を読み込み中...</div></section>';
  try{
    const summary=await loadBoothCloseSummary(event);
    renderBoothCloseConfirmPanel(event,summary);
  }catch(e){
    if(area)area.innerHTML='<section class="booth-work-card"><div class="booth-empty">締め前確認を読み込めませんでした。</div></section>';
    boothShowError("イベント締めエラー","締め前確認の読み込みに失敗しました。\n"+e.message);
  }
}

function getBoothCloseStoreContext(event){
  const context=typeof getBoothSalesContext==="function"?getBoothSalesContext():{};
  const fallbackStoreCode=typeof getBoothCurrentStoreCode==="function"?getBoothCurrentStoreCode():"tokyo";
  const storeCode=String(event?.store_code||context.storeCode||fallbackStoreCode||"tokyo").toLowerCase();
  const storeName=event?.store_name||context.storeName||(storeCode==="aichi"?"愛知":"東京");
  return {
    storeCode,
    storeName,
    accountName:context.accountName||"スマレジ本番接続"
  };
}

function isBoothShelfReturnReflected(item){
  return item?.shelf_return_reflected===true
    || String(item?.shelf_return_reflected||"").toLowerCase()==="true"
    || Boolean(item?.shelf_return_reflected_at);
}

function getBoothExplicitReturnProcessType(item){
  const value=String(item?.return_process_type||"").toLowerCase().trim();
  return value==="storage"||value==="shelf"?value:"";
}

function getBoothReturnProcessType(item){
  const explicit=getBoothExplicitReturnProcessType(item);
  if(explicit)return explicit;
  if(Number(item?.event_storage_qty||0)>0)return "storage";
  if(Number(item?.shelf_return_qty||0)>0)return "shelf";
  return "";
}

function getBoothCloseReturnProcessType(item){
  return getBoothReturnProcessType(item)||(
    Number(item?.returned_qty||0)>0&&Number(item?.event_storage_qty||0)<=0
      ? "shelf"
      : ""
  );
}

function getBoothReturnProcessLabel(type){
  return String(type||"")==="storage"?"イベント保管":"通常棚へ戻す";
}

function isBoothReturnReflected(item){
  return item?.return_reflected===true
    || String(item?.return_reflected||"").toLowerCase()==="true"
    || Boolean(item?.return_reflected_at)
    || isBoothShelfReturnReflected(item);
}

function getBoothReturnReflectedQty(item){
  if(item?.return_reflected_qty!==undefined&&item?.return_reflected_qty!==null){
    return Number(item.return_reflected_qty||0);
  }
  return getBoothShelfReturnReflectedQty(item);
}

function getBoothReturnReflectQty(item){
  return Number(item?.returned_qty||0);
}

function getBoothReturnReflectDelta(item){
  return getBoothReturnReflectQty(item)-getBoothReturnReflectedQty(item);
}

function calculateBoothGachaConsumed(item){
  return Math.max(0,Number(item?.taken_qty||0)-Number(item?.returned_qty||0));
}

function getBoothCloseShelfReturnQty(item){
  const shelfQty=Number(item?.shelf_return_qty||0);
  const storageQty=Number(item?.event_storage_qty||0);
  const returnedQty=Number(item?.returned_qty||0);
  if(shelfQty>0||storageQty>0)return shelfQty;
  return returnedQty;
}

function getBoothShelfReturnReflectedQty(item){
  if(item?.shelf_return_reflected_qty!==undefined&&item?.shelf_return_reflected_qty!==null){
    return Number(item.shelf_return_reflected_qty||0);
  }
  return 0;
}

function getBoothShelfReturnReflectDelta(item){
  return Number(item?.shelf_return_effective_qty||0)-Number(item?.shelf_return_reflected_qty||0);
}

function mergeBoothCloseRows(normalItems,gachaItems,products){
  const productMap=new Map((products||[]).map(product=>[String(product.barcode||""),product]));
  const rowsByBarcode=new Map();
  (normalItems||[]).forEach(item=>{
    const barcode=String(item.barcode||"");
    const product=productMap.get(barcode)||{};
    rowsByBarcode.set(barcode,{
      id:item.id,
      event_id:item.event_id,
      barcode,
      product_name:item.product_name||product.name||"",
      smaregi_product_id:product.smaregi_product_id||"",
      normal_takeout_qty:Number(item.normal_takeout_qty||0),
      storage_takeout_qty:Number(item.storage_takeout_qty||0),
      taken_qty:Number(item.taken_qty||0),
      sold_qty:Number(item.sold_qty||0),
      returned_qty:Number(item.returned_qty||0),
      shelf_return_qty:Number(item.shelf_return_qty||0),
      event_storage_qty:Number(item.event_storage_qty||0),
      shelf_return_effective_qty:getBoothCloseShelfReturnQty(item),
      return_process_type:getBoothCloseReturnProcessType(item),
      return_process_label:getBoothReturnProcessLabel(getBoothCloseReturnProcessType(item)),
      return_reflected:isBoothReturnReflected(item),
      return_reflected_qty:getBoothReturnReflectedQty(item),
      return_reflect_qty:getBoothReturnReflectQty(item),
      consumed_qty:Number(item.consumed_qty||0),
      difference_qty:calculateBoothItemDifference(item),
      diff_memo:item.diff_memo||"",
      updated_at:item.updated_at||"",
      shelf_return_reflected:isBoothShelfReturnReflected(item),
      shelf_return_reflected_qty:getBoothShelfReturnReflectedQty(item),
      gacha_pick_qty:0,
      gacha_return_qty:0,
      gacha_consumed_qty:0
    });
  });
  (gachaItems||[]).forEach(item=>{
    const barcode=String(item.barcode||"");
    const product=productMap.get(barcode)||{};
    const existing=rowsByBarcode.get(barcode)||{
      id:"",
      event_id:item.event_id,
      barcode,
      product_name:item.product_name||product.name||"",
      smaregi_product_id:product.smaregi_product_id||"",
      normal_takeout_qty:0,
      storage_takeout_qty:0,
      taken_qty:0,
      sold_qty:0,
      returned_qty:0,
      shelf_return_qty:0,
      event_storage_qty:0,
      shelf_return_effective_qty:0,
      return_process_type:"",
      return_process_label:"-",
      return_reflected:false,
      return_reflected_qty:0,
      return_reflect_qty:0,
      consumed_qty:0,
      difference_qty:0,
      diff_memo:"",
      updated_at:item.updated_at||"",
      shelf_return_reflected:false,
      shelf_return_reflected_qty:0
    };
    existing.gacha_pick_qty=Number(item.taken_qty||0);
    existing.gacha_return_qty=Number(item.returned_qty||0);
    existing.gacha_consumed_qty=calculateBoothGachaConsumed(item);
    if(!existing.updated_at)existing.updated_at=item.updated_at||"";
    rowsByBarcode.set(barcode,existing);
  });
  return [...rowsByBarcode.values()].sort((a,b)=>String(a.product_name||"").localeCompare(String(b.product_name||""),"ja"));
}

async function loadBoothCloseSummary(event){
  const eventId=encodeURIComponent(event.id);
  const normalItems=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,shelf_return_qty,event_storage_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,shelf_return_reflected_by,return_process_type,return_reflected,return_reflected_qty,return_reflected_at,return_reflected_by,updated_at&event_id=eq.${eventId}&item_type=eq.normal&order=product_name.asc`);
  const gachaItems=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,returned_qty,consumed_qty,difference_qty,updated_at&event_id=eq.${eventId}&item_type=eq.gacha_prize&order=product_name.asc`);
  const products=await fetchBoothProductsForItems([...(normalItems||[]),...(gachaItems||[])]);
  const rows=mergeBoothCloseRows(normalItems||[],gachaItems||[],products||[]);
  const diffRows=rows.filter(row=>Number(row.difference_qty||0)!==0);
  const unconfirmedRows=diffRows.filter(row=>!String(row.diff_memo||"").trim());
  const returnPendingRows=rows.filter(row=>getBoothReturnReflectDelta(row)!==0);
  const unprocessedReturnRows=rows.filter(row=>Number(row.returned_qty||0)>0&&!getBoothReturnProcessType(row));
  return {
    rows,
    diffItemCount:diffRows.length,
    diffTotal:diffRows.reduce((sum,row)=>sum+Math.abs(Number(row.difference_qty||0)),0),
    unconfirmedCount:unconfirmedRows.length,
    shelfReturnPendingQty:returnPendingRows.reduce((sum,row)=>sum+getBoothReturnReflectDelta(row),0),
    shelfReturnPendingRows:returnPendingRows,
    returnPendingRows,
    unprocessedReturnRows,
    unprocessedReturnCount:unprocessedReturnRows.length
  };
}

function renderBoothCloseConfirmPanel(event,summary){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const context=getBoothCloseStoreContext(event);
  const period=[event.event_start,event.event_end].filter(Boolean).join(" ～ ")||"-";
  const staffOptions='<option value="">締め担当者を選択</option>'+((staffMembers||[]).map(staff=>{
    const name=getBoothStaffDisplayName(staff);
    return `<option value="${esc(name)}" ${name===event.created_by?"selected":""}>${esc(name)}</option>`;
  }).join(""));
  const warning=summary.unconfirmedCount>0
    ? `<div class="message err booth-close-warning">差異メモ未入力の商品が ${esc(summary.unconfirmedCount)} 件あります。差異ありでも締めは可能ですが、内容を確認してください。</div>`
    : "";
  const rows=summary.rows.map(row=>`<tr class="${Number(row.difference_qty||0)===0?"":"booth-close-diff-row"}">
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td>${esc(row.smaregi_product_id||"-")}</td>
      <td>${esc(row.normal_takeout_qty)}</td>
      <td>${esc(row.storage_takeout_qty)}</td>
      <td><strong>${esc(row.taken_qty)}</strong></td>
      <td>${esc(row.sold_qty)}</td>
      <td>${esc(row.shelf_return_effective_qty)}</td>
      <td>${esc(row.event_storage_qty)}</td>
      <td>${esc(row.gacha_pick_qty||0)}</td>
      <td>${esc(row.gacha_return_qty||0)}</td>
      <td>${esc(row.gacha_consumed_qty||0)}</td>
      <td><strong>${esc(row.difference_qty)}</strong></td>
      <td>${esc(row.diff_memo||"-")}</td>
      <td>${esc(formatBoothDateTimeShort(row.updated_at))}</td>
    </tr>`).join("");
  const cards=summary.rows.map(row=>`<article class="booth-history-card booth-close-item-card ${Number(row.difference_qty||0)===0?"":"booth-close-diff-row"}">
      <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong><span>差異：${esc(row.difference_qty)}</span></div>
      <div class="booth-history-card-meta">
        <span>バーコード：${esc(row.barcode||"-")}</span>
        <span>持ち出し：${esc(row.taken_qty)}（通常 ${esc(row.normal_takeout_qty)} / 保管 ${esc(row.storage_takeout_qty)}）</span>
        <span>販売：${esc(row.sold_qty)} / \u901a\u5e38\u68da\u623b\u3057\uff1a${esc(row.shelf_return_effective_qty)} / イベント保管：${esc(row.event_storage_qty)}</span>
        <span>ガチャ：ピック ${esc(row.gacha_pick_qty||0)} / 戻り ${esc(row.gacha_return_qty||0)} / 消費 ${esc(row.gacha_consumed_qty||0)}</span>
        <span>メモ：${esc(row.diff_memo||"-")}</span>
      </div>
    </article>`).join("");
  area.innerHTML=`
    <section class="booth-work-card booth-close-card">
      <h4>イベント締め前確認</h4>
      <p class="section-note">販売・棚戻し・イベント保管・ガチャ・差異を確認してから締め確定します。締め時にスマレジ在庫更新APIは呼びません。</p>
      <div class="booth-close-event-info">
        <div><span>イベント名</span><strong>${esc(event.name||"-")}</strong></div>
        <div><span>会場</span><strong>${esc(event.venue||"-")}</strong></div>
        <div><span>日程</span><strong>${esc(period)}</strong></div>
        <div><span>担当者</span><strong>${esc(event.created_by||"-")}</strong></div>
        <div><span>店舗</span><strong>${esc(context.storeName)} / ${esc(String(context.storeCode).toUpperCase())}</strong></div>
      </div>
      <div class="booth-close-summary-grid">
        <div><span>商品数</span><strong>${esc(summary.rows.length)}</strong></div>
        <div><span>差異あり商品数</span><strong>${esc(summary.diffItemCount)}</strong></div>
        <div><span>差異合計数</span><strong>${esc(summary.diffTotal)}</strong></div>
        <div><span>未確認商品数</span><strong>${esc(summary.unconfirmedCount)}</strong></div>
        <div><span>締め時に通常棚へ戻す数</span><strong>${esc(summary.shelfReturnPendingQty)}</strong></div>
      </div>
      ${warning}
      <div class="booth-history-table-wrap"><table class="booth-history-table booth-close-table">
        <thead><tr><th>商品名</th><th>バーコード</th><th>商品ID</th><th>通常ピック</th><th>保管持ち出し</th><th>持ち出し合計</th><th>販売</th><th>通常棚戻し</th><th>イベント保管</th><th>ガチャピック</th><th>ガチャ戻り</th><th>ガチャ消費</th><th>差異</th><th>メモ</th><th>最終更新</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="15">商品がありません。</td></tr>'}</tbody>
      </table></div>
      <div class="booth-history-cards">${cards}</div>
      <div class="booth-close-actions">
        <label>締め担当者<span class="required">必須</span>
          <select id="boothCloseStaff">${staffOptions}</select>
        </label>
        <button type="button" id="boothCloseReloadBtn" class="secondary">再読み込み</button>
        <button type="button" id="boothCloseConfirmBtn">締め確定</button>
      </div>
    </section>`;
  el("boothCloseReloadBtn")?.addEventListener("click",()=>confirmBoothEventClosePreparing(event));
  el("boothCloseConfirmBtn")?.addEventListener("click",()=>confirmBoothEventClose(event));
}

async function confirmBoothEventClose(event){
  const staff=String(el("boothCloseStaff")?.value||"").trim();
  if(!staff){
    boothShowError("イベント締めエラー","締め担当者を選択してください。","boothCloseStaff");
    return;
  }
  try{
    const latestRows=await sb(`booth_events?select=*&id=eq.${encodeURIComponent(event.id)}&limit=1`);
    const latestEvent=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
    if(!latestEvent){
      boothShowError("イベント締めエラー","イベントが見つかりません。");
      return;
    }
    if(isBoothEventClosed(latestEvent)){
      boothShowError("イベント締めエラー","このイベントはすでに締め済みです。");
      return;
    }
    const summary=await loadBoothCloseSummary(latestEvent);
    if(summary.unprocessedReturnCount>0){
      boothShowError("イベント締めエラー","戻り在庫の処理方法が未選択の商品があります。先に戻り在庫処理で「通常棚へ戻す」または「イベント保管にする」を選択してください。");
      return;
    }
    const body=[
      "このイベントを締めます。",
      "締め後は編集・削除できません。",
      "在庫反映内容を確認してください。",
      "",
      `イベント名：${latestEvent.name||"-"}`,
      `締め担当者：${staff}`,
      `差異あり商品数：${summary.diffItemCount}`,
      `差異合計数：${summary.diffTotal}`,
      `未確認商品数：${summary.unconfirmedCount}`,
      `通常棚へ戻す数：${summary.shelfReturnPendingQty}`,
      "",
      "スマレジ在庫更新APIは呼びません。",
      "イベントピック・ガチャ・イベント保管は二重反映しません。",
      "",
      "実行しますか？"
    ].join("\n");
    const ok=typeof confirmAppAction==="function"
      ? await confirmAppAction("イベント締め最終確認",body,{okText:"締め確定"})
      : true;
    if(!ok)return;
    await finalizeBoothEventClose(latestEvent,summary,staff);
  }catch(e){
    boothShowError("イベント締めエラー","イベント締めに失敗しました。\n"+e.message);
  }
}

async function reflectBoothShelfReturnsOnClose(summary,staff){
  const now=new Date().toISOString();
  for(const item of summary.returnPendingRows||summary.shelfReturnPendingRows||[]){
    const processType=getBoothCloseReturnProcessType(item);
    const effectiveQty=getBoothReturnReflectQty(item);
    const delta=getBoothReturnReflectDelta(item);
    if(delta===0||!item.id||!item.barcode)continue;
    if(!processType)throw new Error("戻り在庫の処理方法が未選択の商品があります。");
    if(processType==="storage"){
      await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),item,delta);
      await sb("event_storage_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:item.event_id||boothCurrentEventId||null,
          store_code:getBoothCurrentStoreCode(),
          smaregi_product_id:item.smaregi_product_id?String(item.smaregi_product_id):null,
          barcode:item.barcode,
          product_name:item.product_name||"",
          movement_type:delta>0?"storage_in":"adjustment",
          quantity:Math.abs(delta),
          staff,
          memo:delta>0?"イベント締め時に戻り在庫をイベント保管へ反映":`イベント締め再反映 ${delta}`
        }])
      });
    }else{
      await adjustBoothProductBaseStock(item.barcode,delta);
      await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          type:"event_close_return",
          event_id:item.event_id||boothCurrentEventId||null,
          staff,
          barcode:item.barcode,
          product_name:item.product_name||"",
          quantity:Math.abs(delta),
          memo:delta>=0?"イベント締め棚戻し":"イベント締め棚戻し反映修正",
          affects_smaregi:false,
          smaregi_delta:0
        })
      });
      await sb("booth_stock_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:item.event_id||boothCurrentEventId||null,
          barcode:item.barcode,
          product_name:item.product_name||"",
          item_type:"normal",
          movement_type:"event_close_return",
          quantity:Math.abs(delta),
          staff,
          memo:delta>=0?"イベント締め棚戻し":"イベント締め棚戻し反映修正",
          affects_smaregi:false,
          smaregi_delta:0
        }])
      });
    }
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        return_process_type:processType,
        return_reflected:effectiveQty>0,
        return_reflected_qty:effectiveQty,
        return_reflected_at:effectiveQty>0?now:null,
        return_reflected_by:effectiveQty>0?staff:null,
        shelf_return_qty:processType==="shelf"?effectiveQty:0,
        event_storage_qty:processType==="storage"?effectiveQty:0,
        shelf_return_reflected:processType==="shelf"&&effectiveQty>0,
        shelf_return_reflected_qty:processType==="shelf"?effectiveQty:0,
        shelf_return_reflected_at:processType==="shelf"&&effectiveQty>0?now:null,
        shelf_return_reflected_by:processType==="shelf"&&effectiveQty>0?staff:null,
        updated_at:now
      })
    });
  }
}

async function ensureBoothCloseReturnHistory(summary,staff){
  const summaryRows=summary.rows||[];
  const eventId=(summaryRows.find(row=>row.event_id)?.event_id)||boothCurrentEventId||null;
  let rows=summaryRows;
  if(eventId){
    const dbRows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,shelf_return_qty,event_storage_qty,return_process_type,return_reflected,return_reflected_qty,shelf_return_reflected,shelf_return_reflected_qty&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&order=product_name.asc`);
    if(Array.isArray(dbRows)&&dbRows.length)rows=dbRows.map(row=>({
      ...row,
      shelf_return_effective_qty:getBoothCloseShelfReturnQty(row),
      return_reflected_qty:getBoothReturnReflectedQty(row)
    }));
  }
  for(const item of rows){
    const processType=getBoothCloseReturnProcessType(item);
    if(processType!=="shelf")continue;
    const qty=getBoothReturnReflectedQty(item)||getBoothReturnReflectQty(item)||getBoothCloseShelfReturnQty(item);
    const eventId=item.event_id||boothCurrentEventId||null;
    if(!eventId||!item.barcode||qty<=0)continue;

    const eventFilter=encodeURIComponent(eventId);
    const barcodeFilter=encodeURIComponent(item.barcode);
    const existingLogs=await sb(`inventory_logs?select=id&type=eq.event_close_return&event_id=eq.${eventFilter}&barcode=eq.${barcodeFilter}&limit=1`);
    if(!Array.isArray(existingLogs)||existingLogs.length===0){
      await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          type:"event_close_return",
          event_id:eventId,
          staff,
          barcode:item.barcode,
          product_name:item.product_name||"",
          quantity:qty,
          memo:"イベント締め棚戻し",
          affects_smaregi:false,
          smaregi_delta:0
        })
      });
    }

    const existingMovements=await sb(`booth_stock_movements?select=id&movement_type=eq.event_close_return&event_id=eq.${eventFilter}&barcode=eq.${barcodeFilter}&limit=1`);
    if(!Array.isArray(existingMovements)||existingMovements.length===0){
      await sb("booth_stock_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:eventId,
          barcode:item.barcode,
          product_name:item.product_name||"",
          item_type:"normal",
          movement_type:"event_close_return",
          quantity:qty,
          staff,
          memo:"イベント締め棚戻し",
          affects_smaregi:false,
          smaregi_delta:0
        }])
      });
    }
  }
}

async function loadBoothReflectedShelfReturnRows(eventId){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,returned_qty,shelf_return_qty,event_storage_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,return_process_type,return_reflected,return_reflected_qty,return_reflected_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&or=(return_reflected.eq.true,return_reflected_qty.gt.0,shelf_return_reflected.eq.true,shelf_return_reflected_qty.gt.0)&order=product_name.asc`);
  return (Array.isArray(rows)?rows:[]).map(row=>({
    ...row,
    shelf_return_effective_qty:getBoothCloseShelfReturnQty(row),
    shelf_return_reflected_qty:getBoothShelfReturnReflectedQty(row),
    return_reflected_qty:getBoothReturnReflectedQty(row)
  }));
}

async function unreflectBoothShelfReturnsOnReopen(eventId,staff){
  const now=new Date().toISOString();
  const reflectedRows=await loadBoothReflectedShelfReturnRows(eventId);
  for(const item of reflectedRows){
    const processType=getBoothReturnProcessType(item)||"shelf";
    const qty=getBoothReturnReflectedQty(item);
    if(qty>0&&item.barcode&&processType==="storage"){
      await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),item,-qty);
      await sb("event_storage_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:eventId,
          store_code:getBoothCurrentStoreCode(),
          smaregi_product_id:item.smaregi_product_id?String(item.smaregi_product_id):null,
          barcode:item.barcode,
          product_name:item.product_name||"",
          movement_type:"adjustment",
          quantity:qty,
          staff,
          memo:"締め解除によりイベント保管反映を取消"
        }])
      });
    }else if(qty>0&&item.barcode){
      await adjustBoothProductBaseStock(item.barcode,-qty);
    }
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        return_reflected:false,
        return_reflected_qty:0,
        return_reflected_at:null,
        return_reflected_by:null,
        shelf_return_reflected:false,
        shelf_return_reflected_qty:0,
        shelf_return_reflected_at:null,
        shelf_return_reflected_by:null,
        updated_at:now
      })
    });
  }
  return reflectedRows.reduce((sum,row)=>sum+getBoothReturnReflectedQty(row),0);
}

async function finalizeBoothEventClose(event,summary,staff){
  const now=new Date().toISOString();
  await reflectBoothShelfReturnsOnClose(summary,staff);
  await ensureBoothCloseReturnHistory(summary,staff);
  const updated=await sb(`booth_events?id=eq.${encodeURIComponent(event.id)}`,{
    method:"PATCH",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      status:"closed",
      closed_at:now,
      closed_by:staff
    })
  });
  const closedEvent=Array.isArray(updated)&&updated[0]?updated[0]:{...event,status:"closed",closed_at:now,closed_by:staff};
  boothEvents=boothEvents.map(row=>String(row.id)===String(event.id)?closedEvent:row);
  boothCurrentEventId=String(event.id);
  renderBoothEvents(boothEvents);
  renderBoothEventDetail(closedEvent);
  boothShowSuccess("イベント締め完了","イベントを締めました。締め後は編集・削除できません。");
}

function renderBoothReopenPanel(event){
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  if(!event||!event.id){
    boothShowError("締め解除エラー","イベントが見つかりません。");
    return;
  }
  if(!isBoothEventClosed(event)){
    boothShowError("締め解除エラー","このイベントは締め済みではありません。");
    return;
  }
  const area=el("boothEventWorkArea");
  if(!area)return;
  const staffOptions=getBoothStaffOptions("解除担当者を選択");
  area.innerHTML=`
    <section class="booth-work-card booth-reopen-card">
      <h4>締め解除</h4>
      <p class="section-note">締め解除はイベントを再編集可能に戻します。締め時に加算した通常棚戻し分だけ products.base_stock から減算し、スマレジ在庫APIは呼びません。</p>
      <div class="booth-close-event-info">
        <div><span>イベント名</span><strong>${esc(event.name||"-")}</strong></div>
        <div><span>締め日時</span><strong>${esc(formatBoothDateTime(event.closed_at))}</strong></div>
        <div><span>締め担当者</span><strong>${esc(event.closed_by||"-")}</strong></div>
        <div><span>状態</span><strong>${esc(getBoothStatusLabel(event.status))}</strong></div>
      </div>
      <div class="booth-reopen-form">
        <label>解除担当者<span class="required">必須</span>
          <select id="boothReopenStaff">${staffOptions}</select>
        </label>
        <label>解除理由<span class="required">必須</span>
          <select id="boothReopenReason">
            <option value="">解除理由を選択</option>
            <option value="数量入力ミス">数量入力ミス</option>
            <option value="戻り登録漏れ">戻り登録漏れ</option>
            <option value="販売取り込み漏れ">販売取り込み漏れ</option>
            <option value="ガチャ戻り漏れ">ガチャ戻り漏れ</option>
            <option value="その他">その他</option>
          </select>
        </label>
        <label>補足メモ
          <input id="boothReopenMemo" autocomplete="off" placeholder="任意メモ">
        </label>
        <button type="button" id="boothReopenConfirmBtn">締め解除を実行</button>
      </div>
    </section>`;
  el("boothReopenConfirmBtn")?.addEventListener("click",()=>confirmBoothEventReopen(event));
}

async function confirmBoothEventReopen(event){
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const staff=String(el("boothReopenStaff")?.value||"").trim();
  const reason=String(el("boothReopenReason")?.value||"").trim();
  const memo=String(el("boothReopenMemo")?.value||"").trim();
  if(!staff){
    boothShowError("締め解除エラー","解除担当者を選択してください。","boothReopenStaff");
    return;
  }
  if(!reason){
    boothShowError("締め解除エラー","解除理由を選択してください。","boothReopenReason");
    return;
  }
  try{
    const rows=await sb(`booth_events?select=*&id=eq.${encodeURIComponent(event.id)}&limit=1`);
    const latestEvent=Array.isArray(rows)&&rows[0]?rows[0]:null;
    if(!latestEvent){
      boothShowError("締め解除エラー","イベントが見つかりません。");
      return;
    }
    if(!isBoothEventClosed(latestEvent)){
      boothShowError("締め解除エラー","このイベントは締め済みではありません。");
      return;
    }
    const reasonText=memo?`${reason} / ${memo}`:reason;
    const body=[
      "このイベントの締めを解除します。",
      "解除後は再編集できるようになります。",
      "在庫や履歴を修正する場合は、再度締め処理を行ってください。",
      "",
      `イベント名：${latestEvent.name||"-"}`,
      `締め日時：${formatBoothDateTime(latestEvent.closed_at)}`,
      `締め担当者：${latestEvent.closed_by||"-"}`,
      `解除担当者：${staff}`,
      `解除理由：${reasonText}`,
      "",
      "締め時に加算した通常棚戻し分だけ products.base_stock から減算します。",
      "スマレジ在庫APIは呼びません。",
      "",
      "実行しますか？"
    ].join("\n");
    const ok=typeof confirmAppAction==="function"
      ? await confirmAppAction("締め解除確認",body,{okText:"締め解除"})
      : true;
    if(!ok)return;
    await finalizeBoothEventReopen(latestEvent,staff,reasonText);
  }catch(e){
    boothShowError("締め解除エラー","締め解除に失敗しました。\n"+e.message);
  }
}

async function finalizeBoothEventReopen(event,staff,reason){
  const now=new Date().toISOString();
  const revertedQty=await unreflectBoothShelfReturnsOnReopen(event.id,staff);
  const updated=await sb(`booth_events?id=eq.${encodeURIComponent(event.id)}`,{
    method:"PATCH",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      status:"active",
      closed_at:null,
      closed_by:null,
      reopened_at:now,
      reopened_by:staff,
      reopen_reason:reason
    })
  });
  const reopenedEvent=Array.isArray(updated)&&updated[0]?updated[0]:{
    ...event,
    status:"active",
    closed_at:null,
    closed_by:null,
    reopened_at:now,
    reopened_by:staff,
    reopen_reason:reason
  };
  boothEvents=boothEvents.map(row=>String(row.id)===String(event.id)?reopenedEvent:row);
  boothCurrentEventId=String(event.id);
  renderBoothEvents(boothEvents);
  renderBoothEventDetail(reopenedEvent);
  boothShowSuccess("締め解除完了",`イベントの締めを解除しました。再編集できます。\n通常棚戻し反映を ${revertedQty} 点戻しました。`);
}

function registerBoothCarryOutDraft(){
  const event=getBoothCurrentEvent();
  if(!event){
    if(typeof showMessage==="function")showMessage("イベントを開いてから持ち出し登録してください。","err");
    return;
  }
  const barcode=String(el("boothCarryOutBarcode")?.value||"").trim();
  const qty=Number(el("boothCarryOutQty")?.value||0);
  if(!barcode||!qty||qty<1){
    if(typeof showMessage==="function")showMessage("バーコードと数量を入力してください。","err");
    return;
  }
  showBoothLocalMessage(`持ち出し登録の土台確認OK：${event.name} / ${barcode} / ${qty}点`,"ok");
  if(typeof showMessage==="function")showMessage("持ち出し登録画面は準備できています。スマレジAPI連携は次フェーズです。","ok");
}

function openBoothEvent(eventId){
  boothCurrentEventId=String(eventId||"");
  const event=getBoothCurrentEvent();
  renderBoothEvents(boothEvents);
  renderBoothEventDetail(event);
  if(event){
    showBoothLocalMessage(`イベントを開きました：${event.name}`,"ok");
  }else if(typeof showMessage==="function"){
    showMessage("イベントが見つかりません。","err");
  }else{
    showBoothLocalMessage("イベントが見つかりません。","err");
  }
}

function showBoothConfirmPopup(title,body,onOk){
  const popup=document.createElement("div");
  popup.className="app-popup booth-confirm-popup";
  popup.style.display="flex";
  popup.innerHTML=`<div class="app-popup-card">
    <div class="app-popup-title">${esc(title)}</div>
    <div class="app-popup-body">${esc(body)}</div>
    <div class="booth-confirm-actions">
      <button type="button" class="secondary booth-confirm-cancel-btn">キャンセル</button>
      <button type="button" class="booth-confirm-ok-btn">OK</button>
    </div>
  </div>`;
  document.body.appendChild(popup);
  const close=()=>{try{document.body.removeChild(popup);}catch(_){}};
  popup.querySelector(".booth-confirm-cancel-btn")?.addEventListener("click",close);
  popup.querySelector(".booth-confirm-ok-btn")?.addEventListener("click",()=>{
    close();
    if(typeof onOk==="function")onOk();
  });
}

async function boothEventHasWorkLogs(eventId){
  const id=encodeURIComponent(eventId);
  const checks=await Promise.all([
    sb(`booth_stock_movements?select=id&event_id=eq.${id}&limit=1`),
    sb(`booth_smaregi_sync_logs?select=id&event_id=eq.${id}&limit=1`),
    sb(`booth_sales_imports?select=id&event_id=eq.${id}&limit=1`)
  ]);
  return checks.some(rows=>Array.isArray(rows)&&rows.length>0);
}

async function deleteBoothEvent(eventId){
  eventId=String(eventId||"");
  if(!eventId)return;
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const event=boothEvents.find(row=>String(row.id)===eventId);
  showBoothConfirmPopup("イベント削除確認","このイベントを削除します。よろしいですか？",async()=>{
    try{
      if(isBoothEventClosed(event)){
        const errorText="締め済みイベントは削除できません。";
        boothShowError("イベント削除エラー",errorText);
        return;
      }
      await sb(`booth_events?id=eq.${encodeURIComponent(eventId)}`,{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      if(boothCurrentEventId===eventId)boothCurrentEventId="";
      boothShowSuccess("イベント削除完了","イベントを削除しました。");
      await loadBoothEvents();
    }catch(e){
      if(typeof showMessage==="function")showMessage("イベント削除エラー\n"+e.message,"err");
      else showBoothLocalMessage("イベント削除エラー\n"+e.message,"err");
    }
  });
}

function boothShowError(title,text,focusId){
  showBoothLocalMessage(text,"err");
  if(typeof playErrorSound==="function")playErrorSound();
  if(typeof showPopup==="function")showPopup(title,text);
  if(focusId)el(focusId)?.focus();
}

function boothShowSuccess(title,text){
  showBoothLocalMessage(text,"ok");
  if(typeof playSuccessSound==="function")playSuccessSound();
  if(typeof showPopup==="function")showPopup(title,text);
}

function getBoothEventCopyLabel(event){
  const dateText=[event?.event_start,event?.event_end].filter(Boolean).join(" - ")||"日程未設定";
  return `${event?.name||"無題イベント"}（${dateText}） / ${event?.venue||"-"}`;
}

function getBoothCopySourceEventOptions(targetEvent){
  return (boothEvents||[])
    .filter(event=>String(event.id)!==String(targetEvent?.id||""))
    .map(event=>`<option value="${esc(event.id)}">${esc(getBoothEventCopyLabel(event))}</option>`)
    .join("");
}

function renderBoothCopyCard(event,closed=false){
  const workArea=el("boothEventWorkArea");
  if(!workArea)return;
  el("boothCopyCard")?.remove();
  const section=document.createElement("section");
  section.id="boothCopyCard";
  section.className="booth-copy-card";
  section.innerHTML=`
    <div>
      <h4>前回イベントコピー</h4>
      <p class="section-note">コピー時はピッキング予定数量だけ保存します。在庫・履歴・スマレジ在庫は変更しません。</p>
    </div>
    <div class="booth-copy-row">
      <label>コピー元イベント
        <select id="boothCopySourceEvent">
          <option value="">コピー元イベントを選択</option>
          ${getBoothCopySourceEventOptions(event)}
        </select>
      </label>
      <button type="button" id="boothCopyPreviousEventBtn" class="secondary" ${closed?"disabled":""}>予定リストへコピー</button>
        <button type="button" id="boothCopyCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothCopyPdfBtn" class="secondary">PDF出力</button>
    </div>
    <div id="boothPlannedList" class="booth-planned-list">
      <div class="booth-empty">予定リストを読み込み中...</div>
    </div>`;
  workArea.parentNode.insertBefore(section,workArea);
}

function renderBoothCopyPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  area.innerHTML=`
    <section id="boothCopyCard" class="booth-copy-card">
      <div>
        <h4>前回イベントコピー</h4>
        <p class="section-note">前回イベントの実績を、今回イベントのピッキング予定リストとしてコピーします。コピー時点では在庫・履歴・スマレジ在庫は変更しません。</p>
      </div>
      <div class="booth-copy-row">
        <label>コピー元イベント
          <select id="boothCopySourceEvent">
            <option value="">コピー元イベントを選択</option>
            ${getBoothCopySourceEventOptions(event)}
          </select>
        </label>
        <button type="button" id="boothCopyPreviousEventBtn" class="secondary" ${closed?"disabled":""}>予定リストへコピー</button>
        <button type="button" id="boothCopyCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothCopyPdfBtn" class="secondary">PDF出力</button>
      </div>
      <div id="boothPlannedList" class="booth-planned-list">
        <div class="booth-empty">予定リストを読み込み中...</div>
      </div>
    </section>`;
  el("boothCopyPreviousEventBtn")?.addEventListener("click",()=>copyPreviousBoothEventPlan(event.id));
  el("boothCopyCsvBtn")?.addEventListener("click",()=>exportPreviousBoothEventPlanCsv(event.id));
  el("boothCopyPdfBtn")?.addEventListener("click",()=>exportPreviousBoothEventPlanPdf(event.id));
  loadBoothPlannedItems(event.id);
}

async function fetchBoothPlanSourceItems(eventId){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc`);
  return Array.isArray(rows)?rows:[];
}

function getBoothPlannedCopyNumbers(item){
  const itemType=String(item?.item_type||"normal");
  const normalActual=Number(item?.normal_takeout_qty||0);
  const storageActual=Number(item?.storage_takeout_qty||0);
  const takenActual=Number(item?.taken_qty||0);
  return {
    plannedNormal:itemType==="normal" ? (normalActual||(!storageActual?takenActual:0)) : 0,
    plannedStorage:itemType==="normal" ? storageActual : 0,
    plannedGacha:itemType==="gacha_prize" ? takenActual : 0
  };
}

function getBoothCopyExportRows(items){
  const sourceItems=Array.isArray(items)?items:[];
  const mapped=sourceItems.map(item=>{
    const planned=getBoothPlannedCopyNumbers(item);
    const taken=Number(item?.taken_qty||0);
    const sold=Number(item?.sold_qty||0);
    const returned=Number(item?.returned_qty||0);
    const consumed=Number(item?.consumed_qty||0);
    const used=consumed||Math.max(0,taken-returned);
    const isGacha=String(item?.item_type||"normal")==="gacha_prize";
    const denominator=taken;
    const numerator=isGacha?used:sold;
    const rate=denominator>0?`${Math.round((numerator/denominator)*100)}%`:"-";
    return {
      productName:item?.product_name||"",
      barcode:item?.barcode||"",
      isGacha,
      plannedNormal:planned.plannedNormal,
      plannedStorage:planned.plannedStorage,
      plannedGacha:planned.plannedGacha,
      taken,
      sold,
      returned,
      used,
      difference:Number(item?.difference_qty||0),
      consumptionRate:rate
    };
  }).filter(row=>row.plannedNormal>0||row.plannedStorage>0||row.plannedGacha>0);
  return {
    sales:mapped.filter(row=>!row.isGacha),
    gacha:mapped.filter(row=>row.isGacha)
  };
}

function getBoothCopySummary(rows,type){
  const list=Array.isArray(rows)?rows:[];
  const planned=list.reduce((sum,row)=>sum+(type==="gacha"?Number(row.plannedGacha||0):Number(row.plannedNormal||0)+Number(row.plannedStorage||0)),0);
  const actual=list.reduce((sum,row)=>sum+(type==="gacha"?Number(row.used||0):Number(row.sold||0)),0);
  const rates=list.map(row=>{
    const base=Number(row.taken||0);
    const value=type==="gacha"?Number(row.used||0):Number(row.sold||0);
    return base>0?(value/base)*100:null;
  }).filter(value=>value!==null);
  const average=rates.length?`${Math.round(rates.reduce((sum,value)=>sum+value,0)/rates.length)}%`:"-";
  return {count:list.length,planned,actual,average};
}

async function getBoothCopyExportContext(){
  const sourceEventId=String(el("boothCopySourceEvent")?.value||"").trim();
  if(!sourceEventId){
    boothShowError("前回イベント出力エラー","コピー元イベントを選択してください。","boothCopySourceEvent");
    return null;
  }
  const sourceEvent=boothEvents.find(event=>String(event.id)===sourceEventId);
  const items=await fetchBoothPlanSourceItems(sourceEventId);
  const rows=getBoothCopyExportRows(items);
  if(!rows.sales.length&&!rows.gacha.length){
    boothShowError("前回イベント出力エラー","出力できる前回イベント実績がありません。");
    return null;
  }
  return {sourceEvent,rows};
}

async function exportPreviousBoothEventPlanCsv(targetEventId){
  try{
    const context=await getBoothCopyExportContext(targetEventId);
    if(!context)return;
    const {sourceEvent,rows}=context;
    const csvRows=[
      ["販売商品"],
      ["商品名","バーコード","planned_normal_takeout_qty","planned_storage_takeout_qty","taken_qty","sold_qty","returned_qty","difference_qty","consumption_rate"],
      ...rows.sales.map(row=>[
        row.productName,
        row.barcode,
        row.plannedNormal,
        row.plannedStorage,
        row.taken,
        row.sold,
        row.returned,
        row.difference,
        row.consumptionRate
      ]),
      [],
      ["ガチャ商品"],
      ["商品名","バーコード","planned_gacha_qty","taken_qty","used_qty","returned_qty","difference_qty","consumption_rate"],
      ...rows.gacha.map(row=>[
        row.productName,
        row.barcode,
        row.plannedGacha,
        row.taken,
        row.used,
        row.returned,
        row.difference,
        row.consumptionRate
      ])
    ];
    const safeName=String(sourceEvent?.name||"previous_event").replace(/[\\/:*?"<>|]/g,"_");
    const filename=`previous_event_copy_${safeName}_${new Date().toISOString().slice(0,10)}.csv`;
    if(typeof downloadCsvFile==="function")downloadCsvFile(filename,csvRows);
    else{
      const csv=csvRows.map(row=>row.map(value=>`"${String(value??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
      const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;
      a.download=filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{try{document.body.removeChild(a);}catch(_){} URL.revokeObjectURL(url);},1000);
    }
    boothShowSuccess("前回イベントCSV出力完了","CSVを出力しました。在庫・履歴・スマレジ在庫は変更していません。");
  }catch(e){
    boothShowError("前回イベントCSV出力エラー","CSV出力に失敗しました。\n"+e.message);
  }
}

function boothCopyPdfTable(title,headers,rows){
  const headerHtml=headers.map(header=>`<th>${esc(header)}</th>`).join("");
  const bodyHtml=rows.length
    ? rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">対象商品はありません。</td></tr>`;
  return `<h2>${esc(title)}</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

async function exportPreviousBoothEventPlanPdf(targetEventId){
  try{
    const context=await getBoothCopyExportContext(targetEventId);
    if(!context)return;
    const {sourceEvent,rows}=context;
    const salesSummary=getBoothCopySummary(rows.sales,"sales");
    const gachaSummary=getBoothCopySummary(rows.gacha,"gacha");
    const eventDate=[sourceEvent?.event_start,sourceEvent?.event_end].filter(Boolean).join(" ～ ")||"-";
    const outputAt=new Date().toLocaleString("ja-JP");
    const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
      <title>ARICO ARCHERY イベント予定リスト</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#12372a;margin:24px;}
        h1{font-size:22px;margin:0 0 12px;}
        h2{font-size:16px;margin:22px 0 8px;border-bottom:2px solid #2d6a4f;padding-bottom:4px;}
        .meta{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;margin-bottom:16px;font-size:13px;}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;}
        th,td{border:1px solid #cfe3d6;padding:6px 8px;text-align:left;}
        th{background:#e5f4ea;}
        .summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px;}
        .summary div{border:1px solid #cfe3d6;border-radius:10px;padding:10px;background:#f7fcf8;}
        @media print{button{display:none}body{margin:12mm}}
      </style></head><body>
      <h1>ARICO ARCHERY<br>イベント予定リスト</h1>
      <div class="meta">
        <strong>イベント名</strong><span>${esc(sourceEvent?.name||"-")}</span>
        <strong>会場</strong><span>${esc(sourceEvent?.venue||"-")}</span>
        <strong>開催日</strong><span>${esc(eventDate)}</span>
        <strong>出力日時</strong><span>${esc(outputAt)}</span>
      </div>
      ${boothCopyPdfTable("販売商品",["商品名","予定数","持出数","販売数","戻り数","差異","消化率"],rows.sales.map(row=>[
        row.productName,
        Number(row.plannedNormal||0)+Number(row.plannedStorage||0),
        row.taken,
        row.sold,
        row.returned,
        row.difference,
        row.consumptionRate
      ]))}
      ${boothCopyPdfTable("ガチャ商品",["商品名","予定数","持出数","使用数","戻り数","差異","消化率"],rows.gacha.map(row=>[
        row.productName,
        row.plannedGacha,
        row.taken,
        row.used,
        row.returned,
        row.difference,
        row.consumptionRate
      ]))}
      <h2>集計</h2>
      <div class="summary">
        <div>
          <strong>販売商品</strong><br>
          商品数：${salesSummary.count}<br>
          販売予定数：${salesSummary.planned}<br>
          販売実績数：${salesSummary.actual}<br>
          平均消化率：${salesSummary.average}
        </div>
        <div>
          <strong>ガチャ商品</strong><br>
          商品数：${gachaSummary.count}<br>
          ガチャ予定数：${gachaSummary.planned}<br>
          ガチャ使用数：${gachaSummary.actual}<br>
          平均消化率：${gachaSummary.average}
        </div>
      </div>
      <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));</script>
      </body></html>`;
    const win=window.open("","_blank");
    if(!win){
      boothShowError("前回イベントPDF出力エラー","PDF出力画面を開けませんでした。ポップアップブロックを確認してください。");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    boothShowSuccess("前回イベントPDF出力","PDF出力用の印刷画面を開きました。在庫・履歴・スマレジ在庫は変更していません。");
  }catch(e){
    boothShowError("前回イベントPDF出力エラー","PDF出力に失敗しました。\n"+e.message);
  }
}

async function findBoothPlanTargetItem(eventId,barcode,itemType){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,item_type&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.${encodeURIComponent(itemType)}&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function saveBoothPlannedItem(eventId,item){
  const itemType=String(item.item_type||"normal");
  const barcode=String(item.barcode||"").trim();
  if(!barcode)return false;
  const now=new Date().toISOString();
  const productName=item.product_name||"";
  const target=await findBoothPlanTargetItem(eventId,barcode,itemType);
  const {plannedNormal,plannedStorage,plannedGacha}=getBoothPlannedCopyNumbers(item);
  const payload={
    product_name:productName,
    planned_normal_takeout_qty:plannedNormal,
    planned_storage_takeout_qty:plannedStorage,
    planned_gacha_qty:plannedGacha,
    updated_at:now
  };
  if(target){
    await sb(`booth_event_items?id=eq.${encodeURIComponent(target.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify(payload)
    });
    return true;
  }
  await sb("booth_event_items",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:eventId,
      barcode,
      product_name:productName,
      item_type:itemType,
      taken_qty:0,
      normal_takeout_qty:0,
      storage_takeout_qty:0,
      sold_qty:0,
      returned_qty:0,
      consumed_qty:0,
      difference_qty:0,
      planned_normal_takeout_qty:plannedNormal,
      planned_storage_takeout_qty:plannedStorage,
      planned_gacha_qty:plannedGacha,
      updated_at:now
    }])
  });
  return true;
}

async function loadBoothPlannedItems(eventId){
  const list=el("boothPlannedList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">予定リストを読み込み中...</div>';
    const rows=await sb(`booth_event_items?select=barcode,product_name,item_type,planned_normal_takeout_qty,planned_storage_takeout_qty,planned_gacha_qty&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc`);
    const planned=(Array.isArray(rows)?rows:[]).filter(row=>
      Number(row.planned_normal_takeout_qty||0)>0||
      Number(row.planned_storage_takeout_qty||0)>0||
      Number(row.planned_gacha_qty||0)>0
    );
    if(!planned.length){
      list.innerHTML='<div class="booth-empty">ピッキング予定リストはまだありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>通常棚予定</th><th>保管在庫予定</th><th>ガチャ予定</th></tr></thead>
      <tbody>${planned.map(row=>`<tr>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(Number(row.planned_normal_takeout_qty||0))}</td>
        <td>${esc(Number(row.planned_storage_takeout_qty||0))}</td>
        <td>${esc(Number(row.planned_gacha_qty||0))}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">予定リストを読み込めませんでした。</div>';
  }
}

async function loadBoothPlannedItems(eventId){
  const list=el("boothPlannedList");
  if(!list)return;
  list.innerHTML='<div class="booth-empty">予定リストを読み込み中...</div>';
  try{
    const rows=await sb(`booth_event_items?select=barcode,product_name,item_type,planned_normal_takeout_qty,planned_storage_takeout_qty,planned_gacha_qty&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc`);
    const planned=(Array.isArray(rows)?rows:[]).filter(row=>
      Number(row.planned_normal_takeout_qty||0)>0||
      Number(row.planned_storage_takeout_qty||0)>0||
      Number(row.planned_gacha_qty||0)>0
    );
    if(!planned.length){
      list.innerHTML='<div class="booth-empty">ピッキング予定リストはまだありません。</div>';
      return;
    }
    const salesRows=planned.filter(row=>Number(row.planned_gacha_qty||0)<=0);
    const gachaRows=planned.filter(row=>Number(row.planned_gacha_qty||0)>0);
    const salesTable=salesRows.length?`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>通常棚予定</th><th>保管在庫予定</th></tr></thead>
      <tbody>${salesRows.map(row=>`<tr>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(Number(row.planned_normal_takeout_qty||0))}</td>
        <td>${esc(Number(row.planned_storage_takeout_qty||0))}</td>
      </tr>`).join("")}</tbody>
    </table></div>`:'<div class="booth-empty">販売商品の予定はありません。</div>';
    const gachaTable=gachaRows.length?`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>ガチャ予定</th></tr></thead>
      <tbody>${gachaRows.map(row=>`<tr>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(Number(row.planned_gacha_qty||0))}</td>
      </tr>`).join("")}</tbody>
    </table></div>`:'<div class="booth-empty">ガチャ商品の予定はありません。</div>';
    list.innerHTML=`
      <div class="booth-copy-section-title">販売商品</div>
      ${salesTable}
      <div class="booth-copy-section-title">ガチャ商品</div>
      ${gachaTable}
    `;
  }catch(e){
    list.innerHTML='<div class="booth-empty">予定リストを読み込めませんでした。</div>';
  }
}

async function copyPreviousBoothEventPlan(targetEventId){
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const targetEvent=boothEvents.find(event=>String(event.id)===String(targetEventId));
  if(!targetEvent){
    boothShowError("前回イベントコピーエラー","コピー先イベントが見つかりません。");
    return;
  }
  if(isBoothEventClosed(targetEvent)){
    boothShowError("前回イベントコピーエラー","締め済みイベントにはコピーできません。");
    return;
  }
  const sourceEventId=String(el("boothCopySourceEvent")?.value||"").trim();
  if(!sourceEventId){
    boothShowError("前回イベントコピーエラー","コピー元イベントを選択してください。","boothCopySourceEvent");
    return;
  }
  const sourceEvent=boothEvents.find(event=>String(event.id)===sourceEventId);
  const execute=async()=>{
    try{
      const sourceItems=await fetchBoothPlanSourceItems(sourceEventId);
      const copyItems=sourceItems.filter(item=>{
        const itemType=String(item.item_type||"normal");
        if(itemType==="gacha_prize")return Number(item.taken_qty||0)>0;
        return Number(item.normal_takeout_qty||0)>0||Number(item.storage_takeout_qty||0)>0||Number(item.taken_qty||0)>0;
      });
      if(!copyItems.length){
        boothShowError("前回イベントコピーエラー","コピーできるピッキング実績がありません。");
        return;
      }
      let count=0;
      for(const item of copyItems){
        if(await saveBoothPlannedItem(targetEventId,item))count++;
      }
      await loadBoothPlannedItems(targetEventId);
      boothShowSuccess("前回イベントコピー完了",`予定リストへ ${count} 件コピーしました。\n在庫・履歴・スマレジ在庫は変更していません。`);
    }catch(e){
      boothShowError("前回イベントコピーエラー","前回イベントコピーに失敗しました。\n"+e.message);
    }
  };
  const body=[
    `コピー元：${sourceEvent?getBoothEventCopyLabel(sourceEvent):sourceEventId}`,
    `コピー先：${getBoothEventCopyLabel(targetEvent)}`,
    "",
    "コピー時は予定数量だけ保存します。",
    "products.base_stock、event_storage_stocks、スマレジ在庫、inventory_logs、booth_stock_movements は変更しません。",
    "",
    "実行しますか？"
  ].join("\n");
  if(typeof showBoothConfirmPopup==="function")showBoothConfirmPopup("前回イベントコピー確認",body,execute);
  else await execute();
}

function renderBoothEventDetail(event){
  const detail=el("boothEventDetailRoot");
  if(!detail)return;
  if(!event){
    detail.hidden=true;
    detail.innerHTML="";
    return;
  }
  detail.hidden=false;
  const dateText=[event.event_start,event.event_end].filter(Boolean).join(" - ")||"-";
  const staffOptions=getBoothStaffOptions();
  detail.innerHTML=`
    <div class="booth-detail-header">
      <div>
        <p class="booth-detail-label">イベント詳細</p>
        <h3>${esc(event.name||"無題イベント")}</h3>
      </div>
      <span class="booth-status booth-status-${esc(event.status||"draft")}">${esc(getBoothStatusLabel(event.status))}</span>
    </div>
    <div class="booth-detail-grid">
      <div><span>イベント名</span><strong>${esc(event.name||"-")}</strong></div>
      <div><span>会場</span><strong>${esc(event.venue||"-")}</strong></div>
      <div><span>日程</span><strong>${esc(dateText)}</strong></div>
      <div><span>作成者</span><strong>${esc(event.created_by||"-")}</strong></div>
      <div><span>状態</span><strong>${esc(getBoothStatusLabel(event.status))}</strong></div>
      <div class="booth-detail-memo"><span>メモ</span><strong>${esc(event.memo||"-")}</strong></div>
    </div>
    <div class="booth-event-menu" aria-label="イベント内メニュー">
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">イベント在庫一覧</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="history">持ち出し履歴</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">戻り棚卸</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="storage">イベント保管</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="gacha">ガチャ管理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="sales">販売取込</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="diff">差異確認</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="close">イベント締め</button>
    </div>
    <div id="boothEventWorkArea" class="booth-work-area">
      <section class="booth-work-card booth-carry-out-card">
        <h4>イベント在庫一覧</h4>
        <p class="section-note">イベント保管在庫から今回イベント在庫へ移動します。スマレジ在庫・通常棚在庫・inventory_logsは変更しません。</p>
        <div class="button-row booth-camera-button-row">
          <button type="button" id="boothStartCameraBtn">カメラ読取</button>
          <div class="camera-zoom-row booth-camera-zoom-row">
            <label>カメラズーム
              <input id="boothCameraZoomRange" type="range" min="1" max="3" step="0.1" value="1.5">
              <span id="boothCameraZoomValue">1.5x</span>
            </label>
          </div>
          <button type="button" id="boothStopCameraBtn" class="secondary">停止</button>
        </div>
        <div class="camera-area booth-camera-area">
          <video id="boothCarryOutVideo" muted playsinline></video>
          <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
            <div class="camera-guide-box">
              <div class="camera-guide-line"></div>
            </div>
            <div class="camera-guide-text">赤線にバーコードを合わせてください</div>
          </div>
        </div>
        <div class="booth-scan-row">
          <label>バーコード
            <input id="boothCarryOutBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力">
          </label>
          <label>数量
            <input id="boothCarryOutQty" type="number" min="1" step="1" value="1">
          </label>
          <label>担当者<span class="required">必須</span>
            <select id="boothCarryOutStaff">${staffOptions}</select>
          </label>
          <button type="button" id="boothCarryOutRegisterBtn">持ち出し登録</button>
        </div>
        <label class="booth-carry-memo-label">メモ
          <input id="boothCarryOutMemo" autocomplete="off" placeholder="任意メモ">
        </label>
      </section>
      <section class="booth-work-card booth-carry-history-card">
        <div class="booth-list-header">
          <h4>持ち出し履歴</h4>
          <button type="button" id="reloadBoothCarryOutHistoryBtn" class="secondary">再読み込み</button>
        </div>
        <div id="boothCarryOutHistoryList" class="booth-carry-history-list">
          <div class="booth-empty">読み込み中...</div>
        </div>
      </section>
    </div>`;

  detail.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.addEventListener("click",()=>switchBoothEventMenu(button.dataset.boothMenu));
  });
  renderBoothCopyCard(event,isBoothEventClosed(event));
  el("boothCopyPreviousEventBtn")?.addEventListener("click",()=>copyPreviousBoothEventPlan(event.id));
  el("boothCopyCsvBtn")?.addEventListener("click",()=>exportPreviousBoothEventPlanCsv(event.id));
  el("boothCopyPdfBtn")?.addEventListener("click",()=>exportPreviousBoothEventPlanPdf(event.id));
  el("boothCarryOutRegisterBtn")?.addEventListener("click",registerBoothCarryOut);
  el("reloadBoothCarryOutHistoryBtn")?.addEventListener("click",()=>loadBoothCarryOutHistory(event.id));
  el("boothStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="carry-out";
    startBoothCarryOutCamera();
  });
  el("boothStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  el("boothCameraZoomRange")?.addEventListener("input",applyBoothCameraZoom);
  updateBoothCameraZoomLabel();
  loadBoothCarryOutHistory(event.id);
  loadBoothPlannedItems(event.id);
  renderBoothEventInventoryPanel(event);
}

function boothEventItemCurrentQty(item){
  const taken=Number(item?.taken_qty||0);
  const sold=Number(item?.sold_qty||0);
  const returned=Number(item?.returned_qty||0);
  const consumed=Number(item?.consumed_qty||0);
  return Math.max(0,taken-sold-returned-consumed);
}

function boothGachaItemCurrentQty(item){
  return Math.max(0,Number(item?.taken_qty||0)-Number(item?.returned_qty||0));
}

function boothProductShelfText(product){
  if(typeof getProductShelfLabel==="function")return getProductShelfLabel(product||{});
  const location=String(product?.location||"").trim();
  return location||"未設定";
}

function boothProductIdentityBlock(row){
  return `<div class="booth-product-identity">
    <strong>${esc(row.name||row.product_name||"-")}</strong>
    <span>棚番：${esc(row.shelf||"未設定")}</span>
    <span>バーコード：${esc(row.barcode||"-")}</span>
  </div>`;
}

async function loadBoothProductsByBarcode(barcodes){
  const unique=[...new Set((barcodes||[]).filter(Boolean).map(String))];
  if(!unique.length)return new Map();
  const inList=unique.map(v=>encodeURIComponent(v)).join(",");
  const rows=await sb(`products?select=barcode,name,location,updated_at&barcode=in.(${inList})&limit=1000`).catch(()=>[]);
  return new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row.barcode||""),row]));
}

function sortBoothInventoryRows(rows,sortKey){
  const list=[...(rows||[])];
  if(typeof sortProductsForDisplay==="function"){
    return sortProductsForDisplay(list,sortKey);
  }
  const collator=new Intl.Collator("ja",{numeric:true,sensitivity:"base"});
  if(sortKey==="barcode")return list.sort((a,b)=>collator.compare(String(a.barcode||""),String(b.barcode||"")));
  if(sortKey==="location")return list.sort((a,b)=>{
    const av=String(a.shelf||"");
    const bv=String(b.shelf||"");
    if(!av&&!bv)return 0;
    if(!av)return 1;
    if(!bv)return -1;
    return collator.compare(av,bv);
  });
  if(sortKey==="updated_at")return list.sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0));
  return list.sort((a,b)=>collator.compare(String(a.name||""),String(b.name||"")));
}

async function buildBoothEventInventoryRows(eventId){
  const items=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=in.(normal,gacha_prize)&order=product_name.asc&limit=2000`);
  const rows=Array.isArray(items)?items:[];
  const productsByBarcode=await loadBoothProductsByBarcode(rows.map(row=>row.barcode));
  const map=new Map();
  rows.forEach(item=>{
    const barcode=String(item.barcode||"");
    if(!barcode)return;
    const product=productsByBarcode.get(barcode)||{};
    const row=map.get(barcode)||{
      barcode,
      name:product.name||item.product_name||"",
      product_name:item.product_name||product.name||"",
      shelf:boothProductShelfText(product),
      updated_at:product.updated_at||item.updated_at||"",
      eventShelfQty:0,
      gachaQty:0
    };
    if(item.item_type==="gacha_prize")row.gachaQty+=boothGachaItemCurrentQty(item);
    else row.eventShelfQty+=boothEventItemCurrentQty(item);
    map.set(barcode,row);
  });
  return [...map.values()].map(row=>({...row,totalQty:row.eventShelfQty+row.gachaQty})).filter(row=>row.totalQty!==0);
}

async function renderBoothEventInventoryPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-event-inventory-card">
    <div class="booth-list-header">
      <div>
        <h4>イベント在庫一覧</h4>
        <p class="section-note">在庫変動登録のイベントピック、ガチャ登録から現在のイベント関連在庫を集計します。</p>
      </div>
      <span id="boothEventInventoryCount" class="inventory-count-pill">0件</span>
    </div>
    <div class="booth-event-inventory-controls">
      <label>商品検索
        <input id="boothEventInventorySearch" autocomplete="off" placeholder="商品名・バーコード">
      </label>
      <label>並び順
        <select id="boothEventInventorySort">
          <option value="name">商品名順</option>
          <option value="barcode">バーコード順</option>
          <option value="location">棚番順</option>
          <option value="updated_at">最終更新順</option>
        </select>
      </label>
      <button type="button" id="boothEventInventoryReloadBtn" class="secondary">再読込</button>
    </div>
    <div id="boothEventInventoryList" class="booth-event-inventory-list"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  const storageKey="arico_booth_event_inventory_sort";
  const sortEl=el("boothEventInventorySort");
  if(sortEl)sortEl.value=localStorage.getItem(storageKey)||"name";
  const draw=async()=>{
    const listEl=el("boothEventInventoryList");
    if(!listEl)return;
    listEl.innerHTML='<div class="booth-empty">読み込み中...</div>';
    try{
      const query=String(el("boothEventInventorySearch")?.value||"").trim().toLowerCase();
      const sortKey=String(el("boothEventInventorySort")?.value||"name");
      localStorage.setItem(storageKey,sortKey);
      let rows=await buildBoothEventInventoryRows(event.id);
      if(query){
        rows=rows.filter(row=>[row.name,row.product_name,row.barcode,row.shelf].some(v=>String(v||"").toLowerCase().includes(query)));
      }
      rows=sortBoothInventoryRows(rows,sortKey);
      const countEl=el("boothEventInventoryCount");
      if(countEl)countEl.textContent=`${rows.length}件`;
      if(!rows.length){
        listEl.innerHTML='<div class="booth-empty">イベント関連在庫はありません。</div>';
        return;
      }
      listEl.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-event-inventory-table">
        <thead><tr><th>商品情報</th><th>イベント棚在庫</th><th>ガチャ在庫</th><th>合計</th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td>${boothProductIdentityBlock(row)}</td>
          <td>${esc(row.eventShelfQty)}</td>
          <td>${esc(row.gachaQty)}</td>
          <td><strong>${esc(row.totalQty)}</strong></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="booth-history-cards">
        ${rows.map(row=>`<article class="booth-history-card">
          ${boothProductIdentityBlock(row)}
          <div class="booth-history-card-meta">
            <span>イベント棚在庫：${esc(row.eventShelfQty)}</span>
            <span>ガチャ在庫：${esc(row.gachaQty)}</span>
            <span>イベント関連在庫合計：${esc(row.totalQty)}</span>
          </div>
        </article>`).join("")}
      </div>`;
    }catch(e){
      listEl.innerHTML='<div class="booth-empty">イベント在庫一覧を読み込めませんでした。</div>';
      boothShowError("イベント在庫一覧エラー","イベント在庫一覧の読み込みに失敗しました。\n"+e.message);
    }
  };
  el("boothEventInventorySearch")?.addEventListener("input",draw);
  el("boothEventInventorySort")?.addEventListener("change",draw);
  el("boothEventInventoryReloadBtn")?.addEventListener("click",draw);
  draw();
}

async function renderBoothGachaListPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-gacha-card">
    <div class="booth-list-header">
      <div>
        <h4>ガチャ商品</h4>
        <p class="section-note">在庫変動登録で対象イベントへ登録したガチャ商品を表示します。</p>
      </div>
      <button type="button" id="reloadBoothGachaListBtn" class="secondary">再読込</button>
    </div>
    <div id="boothGachaList" class="booth-carry-history-list"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  const draw=async()=>{
    const list=el("boothGachaList");
    if(!list)return;
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    try{
      const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,returned_qty,consumed_qty,difference_qty,updated_at&event_id=eq.${encodeURIComponent(event.id)}&item_type=eq.gacha_prize&order=product_name.asc&limit=1000`);
      const items=Array.isArray(rows)?rows:[];
      const productsByBarcode=await loadBoothProductsByBarcode(items.map(row=>row.barcode));
      const viewRows=items.map(item=>{
        const product=productsByBarcode.get(String(item.barcode||""))||{};
        const registered=Number(item.taken_qty||0);
        const returned=Number(item.returned_qty||0);
        const current=Math.max(0,registered-returned);
        return {
          barcode:item.barcode,
          name:product.name||item.product_name||"",
          shelf:boothProductShelfText(product),
          registered,
          used:Number(item.consumed_qty||current),
          current,
          updated_at:product.updated_at||item.updated_at||""
        };
      });
      if(!viewRows.length){
        list.innerHTML='<div class="booth-empty">ガチャ商品はありません。在庫変動登録で「ガチャ」を登録してください。</div>';
        return;
      }
      list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-gacha-list-table">
        <thead><tr><th>商品情報</th><th>ガチャ登録数</th><th>使用数</th><th>現在ガチャ在庫</th></tr></thead>
        <tbody>${viewRows.map(row=>`<tr>
          <td>${boothProductIdentityBlock(row)}</td>
          <td>${esc(row.registered)}</td>
          <td>${esc(row.used)}</td>
          <td><strong>${esc(row.current)}</strong></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="booth-history-cards">
        ${viewRows.map(row=>`<article class="booth-history-card">
          ${boothProductIdentityBlock(row)}
          <div class="booth-history-card-meta">
            <span>ガチャ登録数：${esc(row.registered)}</span>
            <span>使用数：${esc(row.used)}</span>
            <span>現在ガチャ在庫：${esc(row.current)}</span>
          </div>
        </article>`).join("")}
      </div>`;
    }catch(e){
      list.innerHTML='<div class="booth-empty">ガチャ商品を読み込めませんでした。</div>';
      boothShowError("ガチャ商品エラー","ガチャ商品の読み込みに失敗しました。\n"+e.message);
    }
  };
  el("reloadBoothGachaListBtn")?.addEventListener("click",draw);
  draw();
}

async function findBoothProductByBarcode(barcode){
  const rows=await sb(`products?select=barcode,name,base_stock,smaregi_product_id&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function loadBoothCarryOutHistory(eventId){
  const list=el("boothCarryOutHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rows=await sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,takeout_source&event_id=eq.${encodeURIComponent(eventId)}&movement_type=eq.take_out&item_type=eq.normal&order=created_at.desc&limit=50`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだ持ち出し履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>担当者</th><th>持ち出し元</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.quantity??"-")}</td>
        <td>${esc(row.staff||"-")}</td>
        <td>${esc(getBoothCarryOutSourceLabel(getBoothMovementTakeoutSource(row)))}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">持ち出し履歴を読み込めませんでした。</div>';
    boothShowError("持ち出し履歴エラー","持ち出し履歴の読み込みに失敗しました。\n"+e.message);
  }
}

function formatBoothDateTime(value){
  if(!value)return "-";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value);
  return date.toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
}

function showBoothCameraGuide(){
  el("boothCameraGuideOverlay")?.classList.add("is-active");
}

function hideBoothCameraGuide(){
  el("boothCameraGuideOverlay")?.classList.remove("is-active");
}

function getBoothCameraZoomValue(){
  const range=el("boothCameraZoomRange");
  const v=range?Number(range.value||1.5):1.5;
  return Number.isFinite(v)?v:1.5;
}

function updateBoothCameraZoomLabel(){
  const value=el("boothCameraZoomValue");
  if(value)value.textContent=getBoothCameraZoomValue().toFixed(1)+"x";
}

async function applyBoothCameraZoom(){
  try{
    updateBoothCameraZoomLabel();
    if(!boothCurrentVideoTrack||!boothCurrentVideoTrack.getCapabilities)return;
    const caps=boothCurrentVideoTrack.getCapabilities();
    if(!caps.zoom)return;
    const desired=getBoothCameraZoomValue();
    const zoom=Math.min(caps.zoom.max,Math.max(caps.zoom.min,desired));
    await boothCurrentVideoTrack.applyConstraints({advanced:[{zoom}]});
  }catch(_){}
}

async function improveBoothCameraTrack(videoEl){
  try{
    const stream=videoEl&&videoEl.srcObject;
    const track=stream&&stream.getVideoTracks&&stream.getVideoTracks()[0];
    if(!track)return;
    boothCurrentVideoTrack=track;
    const caps=track.getCapabilities?track.getCapabilities():{};
    const advanced=[];
    if(caps.focusMode&&caps.focusMode.includes("continuous"))advanced.push({focusMode:"continuous"});
    if(caps.exposureMode&&caps.exposureMode.includes("continuous"))advanced.push({exposureMode:"continuous"});
    if(caps.whiteBalanceMode&&caps.whiteBalanceMode.includes("continuous"))advanced.push({whiteBalanceMode:"continuous"});
    if(caps.zoom){
      const desired=getBoothCameraZoomValue();
      advanced.push({zoom:Math.min(caps.zoom.max,Math.max(caps.zoom.min,desired))});
    }
    if(advanced.length)await track.applyConstraints({advanced});
    updateBoothCameraZoomLabel();
  }catch(_){}
}

function boothCameraError(title,text){
  showBoothLocalMessage(text,"err");
  if(typeof playErrorSound==="function")playErrorSound();
  if(typeof showPopup==="function")showPopup(title,text);
}

function boothCameraSuccess(text){
  showBoothLocalMessage(text,"ok");
  if(typeof playSuccessSound==="function")playSuccessSound();
}

function startBoothNoScanTimer(){
  clearTimeout(boothNoScanTimer);
  boothNoScanTimer=setTimeout(async()=>{
    if(!boothCameraScanning&&!boothZXingRunning)return;
    await stopBoothCarryOutCamera(false);
    boothCameraError("読み取りエラー","バーコードを読み取れませんでした。");
  },15000);
}

async function startBoothCarryOutCamera(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothCameraError("カメラ起動エラー","イベントを開いてからカメラを起動してください。");
    return;
  }
  try{
    await stopBoothCarryOutCamera(false);
    showBoothLocalMessage("カメラを起動しています...");
    const video=el("boothCarryOutVideo");
    if(!video)throw new Error("カメラ表示エリアが見つかりません。");
    video.style.display="block";
    showBoothCameraGuide();

    if(typeof ensureZXing==="function"){
      await ensureZXing();
    }
    if(window.ZXing){
      if(!boothZXingReader){
        const hints=new Map();
        const formats=[
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8,
          ZXing.BarcodeFormat.UPC_A,
          ZXing.BarcodeFormat.UPC_E,
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.ITF
        ];
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,formats);
        hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
        boothZXingReader=new ZXing.BrowserMultiFormatReader(hints,50);
      }
      boothZXingRunning=true;
      startBoothNoScanTimer();
      await boothZXingReader.decodeFromConstraints(
        {video:{
          facingMode:{ideal:"environment"},
          width:{ideal:2560},
          height:{ideal:1440},
          focusMode:{ideal:"continuous"},
          exposureMode:{ideal:"continuous"}
        }},
        video,
        async(result)=>{
          if(result&&boothZXingRunning){
            await handleBoothScannedCode(result.getText());
          }
        }
      );
      improveBoothCameraTrack(video);
      showBoothLocalMessage("カメラ読取中です。赤枠にバーコードを合わせてください。","ok");
      return;
    }

    if("BarcodeDetector"in window){
      boothBarcodeDetector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","code_39","qr_code"]});
      boothCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
      video.srcObject=boothCameraStream;
      await video.play();
      boothCameraScanning=true;
      startBoothNoScanTimer();
      improveBoothCameraTrack(video);
      showBoothLocalMessage("カメラ読取中です。赤枠にバーコードを合わせてください。","ok");
      boothScanLoop();
      return;
    }

    boothCameraError("カメラ起動エラー","カメラを起動できませんでした。");
  }catch(e){
    await stopBoothCarryOutCamera(false);
    boothCameraError("カメラ起動エラー","カメラを起動できませんでした。");
  }
}

async function stopBoothCarryOutCamera(showOk=true){
  clearTimeout(boothNoScanTimer);
  boothCameraScanning=false;
  boothZXingRunning=false;
  boothCurrentVideoTrack=null;
  if(boothZXingReader){
    try{boothZXingReader.reset();}catch(_){}
  }
  if(boothCameraStream){
    boothCameraStream.getTracks().forEach(track=>track.stop());
    boothCameraStream=null;
  }
  const video=el("boothCarryOutVideo");
  if(video){
    try{video.pause();}catch(_){}
    video.srcObject=null;
    video.style.display="none";
  }
  hideBoothCameraGuide();
  if(showOk)showBoothLocalMessage("カメラを停止しました。","ok");
}

async function boothScanLoop(){
  if(!boothCameraScanning||!boothBarcodeDetector)return;
  try{
    const video=el("boothCarryOutVideo");
    const codes=video?await boothBarcodeDetector.detect(video):[];
    if(codes.length)await handleBoothScannedCode(codes[0].rawValue);
  }catch(_){}
  if(boothCameraScanning)requestAnimationFrame(boothScanLoop);
}

async function handleBoothScannedCode(code){
  code=String(code||"").trim();
  if(!code)return;
  const t=Date.now();
  if(code===boothLastScan&&t-boothLastScanAt<1800)return;
  boothLastScan=code;
  boothLastScanAt=t;
  const input=el("boothCarryOutBarcode");
  if(input)input.value=code;
  await stopBoothCarryOutCamera(false);
  boothCameraSuccess("バーコードを読み取りました。");

  try{
    const product=await findBoothProductByBarcode(code);
    if(!product){
      boothCameraError("商品未登録","このバーコードの商品は登録されていません。");
      return;
    }
    showBoothLocalMessage(`読み取り成功：${product.name||code}`,"ok");
  }catch(e){
    boothCameraError("読み取りエラー","バーコードを読み取れませんでした。");
  }
}

async function upsertBoothEventItem(event,product,qty){
  const eventId=encodeURIComponent(event.id);
  const barcode=encodeURIComponent(product.barcode);
  const source=getBoothCarryOutSource();
  const sourceField=source==="storage"?"storage_takeout_qty":"normal_takeout_qty";
  const rows=await sb(`booth_event_items?select=id,taken_qty,normal_takeout_qty,storage_takeout_qty&event_id=eq.${eventId}&barcode=eq.${barcode}&item_type=eq.normal&limit=1`);
  const now=new Date().toISOString();
  if(Array.isArray(rows)&&rows[0]){
    const current=Number(rows[0].taken_qty||0);
    const sourceCurrent=Number(rows[0][sourceField]||0);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(rows[0].id)}`,{
      method:"PATCH",
      body:JSON.stringify({
        product_name:product.name||"",
        taken_qty:current+qty,
        [sourceField]:sourceCurrent+qty,
        updated_at:now
      })
    });
    return;
  }
  await sb("booth_event_items",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"normal",
      taken_qty:qty,
      normal_takeout_qty:source==="storage"?0:qty,
      storage_takeout_qty:source==="storage"?qty:0,
      updated_at:now
    }])
  });
}

function getBoothCarryOutSource(){
  const value=String(el("boothCarryOutSource")?.value||"storage");
  return value==="storage"?"storage":"normal";
}

function getBoothCarryOutSourceLabel(source){
  return source==="storage"?"イベント保管在庫":"通常棚";
}

function getBoothMovementTakeoutSource(row){
  const value=String(row?.takeout_source||"normal");
  return value==="storage"?"storage":"normal";
}

function getBoothCurrentStoreCode(){
  const context=getBoothSalesContext();
  return String(context?.storeCode||"tokyo");
}

async function findBoothEventStorageStock(storeCode,barcode){
  const rows=await sb(`event_storage_stocks?select=id,store_code,barcode,product_name,storage_qty&store_code=eq.${encodeURIComponent(storeCode)}&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function applyBoothStorageOut(event,product,quantity,staff,memo){
  const storeCode=getBoothCurrentStoreCode();
  const stock=await findBoothEventStorageStock(storeCode,product.barcode);
  const currentQty=Number(stock?.storage_qty||0);
  if(!stock||currentQty<quantity){
    boothShowError("持ち出し登録エラー","イベント保管在庫が不足しています。","boothCarryOutSource");
    return false;
  }
  const now=new Date().toISOString();
  await sb(`event_storage_stocks?id=eq.${encodeURIComponent(stock.id)}`,{
    method:"PATCH",
    body:JSON.stringify({
      product_name:product.name||stock.product_name||"",
      storage_qty:currentQty-quantity,
      updated_at:now
    })
  });
  await sb("event_storage_movements",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:event.id,
      store_code:storeCode,
      smaregi_product_id:product.smaregi_product_id?String(product.smaregi_product_id):null,
      barcode:product.barcode,
      product_name:product.name||"",
      movement_type:"storage_out",
      quantity,
      staff,
      memo
    }])
  });
  return true;
}

async function registerBoothCarryOut(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("持ち出し登録エラー","イベントを開いてから持ち出し登録してください。");
    return;
  }
  const barcode=String(el("boothCarryOutBarcode")?.value||"").trim();
  const qtyText=String(el("boothCarryOutQty")?.value||"").trim();
  const staff=String(el("boothCarryOutStaff")?.value||"").trim();
  const memo=String(el("boothCarryOutMemo")?.value||"").trim();
  const source=getBoothCarryOutSource();

  if(!barcode){
    boothShowError("持ち出し登録エラー","バーコードを入力してください。","boothCarryOutBarcode");
    return;
  }
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("持ち出し登録エラー","数量は1以上の整数を入力してください。","boothCarryOutQty");
    return;
  }
  const quantity=Number(qtyText);
  if(!staff){
    boothShowError("持ち出し登録エラー","担当者を選択してください。","boothCarryOutStaff");
    return;
  }
  if(!validateBoothStaffStore(staff,"店舗確認エラー","boothCarryOutStaff"))return;

  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){
      boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothCarryOutBarcode");
      return;
    }
    if(source==="storage"){
      const storageOk=await applyBoothStorageOut(event,product,quantity,staff,memo);
      if(!storageOk)return;
    }
    await sb("booth_stock_movements",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify([{
        event_id:event.id,
        barcode:product.barcode,
        product_name:product.name||"",
        item_type:"normal",
        movement_type:"take_out",
        quantity,
        staff,
        memo,
        takeout_source:source,
        affects_smaregi:false,
        smaregi_delta:0
      }])
    });

    await upsertBoothEventItem(event,product,quantity);

    el("boothCarryOutBarcode").value="";
    el("boothCarryOutQty").value="1";
    if(el("boothCarryOutMemo"))el("boothCarryOutMemo").value="";
    await loadBoothCarryOutHistory(event.id);
    boothShowSuccess("持ち出し登録完了","持ち出しを登録しました。");
    el("boothCarryOutBarcode")?.focus();
  }catch(e){
    boothShowError("持ち出し登録エラー","持ち出し登録に失敗しました。\n"+e.message);
  }
}

function isBoothEventClosed(event){
  return String(event?.status||"").toLowerCase()==="closed";
}

function showBoothClosedError(){
  boothShowError("イベント操作エラー","このイベントは締め済みです。編集できません。");
}

function showBoothReportPreparing(){
  if(typeof showPopup==="function")showPopup("準備中","イベントレポート出力は次フェーズで実装します。");
}

function renderBoothEventDetail(event){
  const detail=el("boothEventDetailRoot");
  if(!detail)return;
  if(!event){
    detail.hidden=true;
    detail.innerHTML="";
    return;
  }
  detail.hidden=false;
  const closed=isBoothEventClosed(event);
  const adminAuthed=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
  const dateText=[event.event_start,event.event_end].filter(Boolean).join(" - ")||"-";
  const staffOptions=getBoothStaffOptions();
  const detailOpen=window.innerWidth>800?" open":"";
  detail.innerHTML=`
    <div class="booth-detail-header booth-detail-title-only">
      <div>
        <p class="booth-detail-label">イベント名</p>
        <h3>${esc(event.name||"無題イベント")}</h3>
      </div>
      <span class="booth-status booth-status-${esc(event.status||"draft")}">${esc(getBoothStatusLabel(event.status))}</span>
    </div>
    <details class="booth-event-detail-collapse"${detailOpen}>
      <summary>イベント詳細</summary>
      <div class="booth-detail-grid">
        <div><span>会場</span><strong>${esc(event.venue||"-")}</strong></div>
        <div><span>日程</span><strong>${esc(dateText)}</strong></div>
        <div><span>作成者</span><strong>${esc(event.created_by||"-")}</strong></div>
        <div><span>状態</span><strong>${esc(getBoothStatusLabel(event.status))}</strong></div>
        <div class="booth-detail-memo"><span>メモ</span><strong>${esc(event.memo||"-")}</strong></div>
      </div>
    </details>
    ${closed?`<div class="message err booth-closed-notice">このイベントは締め済みです。編集できません。</div>
      <div class="booth-report-actions">
        <button type="button" id="boothCsvDownloadBtn" class="secondary">CSVダウンロード</button>
        <button type="button" id="boothPdfDownloadBtn" class="secondary">PDFダウンロード</button>
        ${adminAuthed
          ? `<button type="button" id="boothReopenEventBtn" class="secondary booth-reopen-btn">締め解除</button>`
          : `<button type="button" class="secondary booth-reopen-btn" disabled>締め解除（管理者認証が必要）</button>`}
      </div>
      ${adminAuthed?"":`<div class="message booth-admin-required-note">締め解除には管理者認証が必要です。</div>`}`:""}
    <div class="booth-work-menu-title">作業内容を選んでください</div>
    <div class="booth-event-menu" aria-label="イベント内メニュー">
      <button type="button" class="booth-event-menu-btn" data-booth-menu="copy">前回イベントコピー</button>
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">イベント在庫一覧</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="gacha">ガチャ管理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="history">持ち出し履歴</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="sales">販売取り込み</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">戻り在庫処理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="diff">差異確認</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="close">イベント締め</button>
    </div>
    <div id="boothEventWorkArea" class="booth-work-area">
      <section class="booth-work-card booth-carry-out-card">
        <h4>イベント在庫一覧</h4>
        <p class="section-note">今回はスマレジAPIを呼ばず、event_id: ${esc(event.id)} に持ち出し履歴だけ保存します。</p>
        <div class="button-row booth-camera-button-row">
          <button type="button" id="boothStartCameraBtn">カメラ読取</button>
          <div class="camera-zoom-row booth-camera-zoom-row">
            <label>カメラズーム
              <input id="boothCameraZoomRange" type="range" min="1" max="3" step="0.1" value="1.5">
              <span id="boothCameraZoomValue">1.5x</span>
            </label>
          </div>
          <button type="button" id="boothStopCameraBtn" class="secondary">停止</button>
        </div>
        <div class="camera-area booth-camera-area">
          <video id="boothCarryOutVideo" muted playsinline></video>
          <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
            <div class="camera-guide-box">
              <div class="camera-guide-line"></div>
            </div>
            <div class="camera-guide-text">赤線にバーコードを合わせてください</div>
          </div>
        </div>
        <div class="booth-scan-row">
          <label>バーコード
            <input id="boothCarryOutBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力" ${closed?"disabled":""}>
          </label>
          <label>数量
            <input id="boothCarryOutQty" type="number" min="1" step="1" placeholder="数量" ${closed?"disabled":""}>
          </label>
          <label>持ち出し元
            <input id="boothCarryOutSource" type="hidden" value="storage">
            <div class="booth-fixed-field">イベント保管在庫</div>
          </label>
          <label>担当者<span class="required">必須</span>
            <select id="boothCarryOutStaff" ${closed?"disabled":""}>${staffOptions}</select>
          </label>
          <button type="button" id="boothCarryOutRegisterBtn" ${closed?"disabled":""}>イベント在庫一覧登録</button>
        </div>
        <div id="boothProductPreview" class="booth-product-preview" hidden></div>
        <label class="booth-carry-memo-label">メモ
          <input id="boothCarryOutMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}>
        </label>
      </section>
      <section class="booth-work-card booth-carry-history-card">
        <div class="booth-list-header">
          <h4>持ち出し履歴</h4>
          <button type="button" id="reloadBoothCarryOutHistoryBtn" class="secondary">再読み込み</button>
        </div>
        <div id="boothCarryOutHistoryList" class="booth-carry-history-list">
          <div class="booth-empty">読み込み中...</div>
        </div>
      </section>
    </div>`;

  detail.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.addEventListener("click",()=>switchBoothEventMenu(button.dataset.boothMenu));
  });
  el("boothCopyPreviousEventBtn")?.addEventListener("click",()=>copyPreviousBoothEventPlan(event.id));
  el("boothCopyCsvBtn")?.addEventListener("click",()=>exportPreviousBoothEventPlanCsv(event.id));
  el("boothCopyPdfBtn")?.addEventListener("click",()=>exportPreviousBoothEventPlanPdf(event.id));
  el("boothCarryOutRegisterBtn")?.addEventListener("click",registerBoothCarryOut);
  el("reloadBoothCarryOutHistoryBtn")?.addEventListener("click",()=>loadBoothCarryOutHistory(event.id));
  el("boothStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="carry-out";
    startBoothCarryOutCamera();
  });
  el("boothStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  el("boothCameraZoomRange")?.addEventListener("input",applyBoothCameraZoom);
  el("boothCarryOutBarcode")?.addEventListener("input",clearBoothProductPreview);
  el("boothCarryOutSource")?.addEventListener("change",()=>previewBoothCarryOutProduct({popupOnError:false}));
  el("boothCsvDownloadBtn")?.addEventListener("click",showBoothReportPreparing);
  el("boothPdfDownloadBtn")?.addEventListener("click",showBoothReportPreparing);
  el("boothReopenEventBtn")?.addEventListener("click",()=>renderBoothReopenPanel(event));
  updateBoothCameraZoomLabel();
  loadBoothCarryOutHistory(event.id);
  loadBoothPlannedItems(event.id);
}

function switchBoothEventMenu(menu){
  const event=getBoothCurrentEvent();
  if(!event){
    if(typeof showMessage==="function")showMessage("イベントを開いてから操作してください。","err");
    return;
  }
  const lockedMenus=["gacha","sales","return","storage","close"];
  if(isBoothEventClosed(event)&&lockedMenus.includes(menu)){
    showBoothClosedError();
    return;
  }
  document.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.classList.toggle("is-active",button.dataset.boothMenu===menu);
  });
  if(menu==="copy"){
    renderBoothCopyPanel(event);
    return;
  }
  if(menu==="carry-out"){
    renderBoothEventInventoryPanel(event);
    return;
  }
  if(menu==="return"){
    renderBoothReturnPanel(event);
    return;
  }
  if(menu==="gacha"){
    renderBoothGachaListPanel(event);
    return;
  }
  if(menu==="sales"){
    renderBoothSalesPanel(event);
    return;
  }
  if(menu==="diff"){
    renderBoothDiffPanel(event);
    return;
  }
  if(menu==="storage"){
    renderBoothReturnPanel(event);
    return;
  }
  if(menu==="close"){
    confirmBoothEventClosePreparing(event);
    return;
  }
  showBoothLocalMessage("準備中です","ok");
  if(typeof showPopup==="function")showPopup("準備中","準備中です");
}

function formatBoothDateTimeShort(value){
  if(!value)return "-";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value);
  return `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}

async function loadBoothCarryOutHistory(eventId){
  const list=el("boothCarryOutHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rows=await sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,takeout_source,movement_type&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(take_out,event_pick)&item_type=eq.normal&order=created_at.desc&limit=50`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだ持ち出し履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>担当者</th><th>持ち出し元</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.quantity??"-")}</td>
        <td>${esc(row.staff||"-")}</td>
        <td>${esc(getBoothCarryOutSourceLabel(getBoothMovementTakeoutSource(row)))}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="booth-history-cards">
      ${rows.map(row=>`<article class="booth-history-card">
        <div class="booth-history-card-top">
          <strong>${esc(row.product_name||"-")}</strong>
          <span>${esc(formatBoothDateTimeShort(row.created_at))}</span>
        </div>
        <div class="booth-history-card-meta">
          <span>バーコード：${esc(row.barcode||"-")}</span>
          <span>数量：${esc(row.quantity??"-")}</span>
          <span>担当者：${esc(row.staff||"-")}</span>
          <span>持ち出し元：${esc(getBoothCarryOutSourceLabel(getBoothMovementTakeoutSource(row)))}</span>
        </div>
      </article>`).join("")}
    </div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">持ち出し履歴を読み込めませんでした。</div>';
    boothShowError("持ち出し履歴エラー","持ち出し履歴の読み込みに失敗しました。\n"+e.message);
  }
}

function clearBoothProductPreview(){
  clearTimeout(boothProductPreviewTimer);
  const preview=el("boothProductPreview");
  if(preview){
    preview.hidden=true;
    preview.innerHTML="";
  }
}

async function previewBoothCarryOutProduct(options={}){
  const popupOnError=options.popupOnError===true;
  const preview=el("boothProductPreview");
  const barcode=String(el("boothCarryOutBarcode")?.value||"").trim();
  if(!preview)return;
  if(!barcode){
    preview.hidden=true;
    preview.innerHTML="";
    return;
  }
  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){
      preview.hidden=true;
      preview.innerHTML="";
      if(popupOnError)boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothCarryOutBarcode");
      return;
    }
    const source=getBoothCarryOutSource();
    let storageLine="";
    if(source==="storage"){
      const stock=await findBoothEventStorageStock(getBoothCurrentStoreCode(),product.barcode);
      storageLine=`<div><span>現在のイベント保管在庫：</span><strong>${esc(stock?.storage_qty??0)}</strong></div>`;
    }
    preview.hidden=false;
    preview.innerHTML=`<div><span>商品名：</span><strong>${esc(product.name||"-")}</strong></div>
      <div><span>持ち出し元：</span><strong>${esc(getBoothCarryOutSourceLabel(source))}</strong></div>
      <div><span>現在の東京在庫：</span><strong>${esc(product.base_stock??0)}</strong></div>
      ${storageLine}
      <div><span>スマレジ在庫：</span><strong>変更しません</strong></div>`;
  }catch(e){
    preview.hidden=true;
    preview.innerHTML="";
    if(popupOnError)boothShowError("商品検索エラー","商品検索に失敗しました。\n"+e.message);
  }
}

function clearBoothReturnPreview(){
  const preview=el("boothReturnProductPreview");
  if(preview){
    preview.hidden=true;
    preview.innerHTML="";
  }
}

async function findBoothEventItemByBarcode(eventId,barcode){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,difference_qty,consumed_qty&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.normal&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

function calculateBoothDifference(item,returnInput=0){
  const taken=Number(item?.taken_qty||0);
  const sold=Number(item?.sold_qty||0);
  const returned=Number(item?.returned_qty||0)+Number(returnInput||0);
  const consumed=Number(item?.consumed_qty||0);
  return taken-sold-returned-consumed;
}

function renderBoothReturnPreview(item,returnInput=0){
  const preview=el("boothReturnProductPreview");
  if(!preview||!item)return;
  const taken=Number(item.taken_qty||0);
  const sold=Number(item.sold_qty||0);
  const returned=Number(item.returned_qty||0);
  const consumed=Number(item.consumed_qty||0);
  const difference=calculateBoothDifference(item,returnInput);
  preview.hidden=false;
  preview.innerHTML=`<div><span>商品名：</span><strong>${esc(item.product_name||"-")}</strong></div>
    <div><span>バーコード：</span><strong>${esc(item.barcode||"-")}</strong></div>
    <div><span>持ち出し数：</span><strong>${esc(taken)}</strong></div>
    <div><span>販売数：</span><strong>${esc(sold)}</strong></div>
    <div><span>戻り登録済み：</span><strong>${esc(returned)}</strong></div>
    <div><span>消化数：</span><strong>${esc(consumed)}</strong></div>
    <div><span>今回戻り入力：</span><strong>${esc(Number(returnInput||0))}</strong></div>
    <div><span>差異数：</span><strong>${esc(difference)}</strong></div>
    <div><span>スマレジ在庫：</span><strong>変更しません</strong></div>`;
}

async function previewBoothReturnProduct(options={}){
  const popupOnError=options.popupOnError===true;
  const event=getBoothCurrentEvent();
  const preview=el("boothReturnProductPreview");
  const barcode=String(el("boothReturnBarcode")?.value||"").trim();
  if(!preview)return;
  if(!event||!barcode){
    clearBoothReturnPreview();
    return null;
  }
  try{
    const item=await findBoothEventItemByBarcode(event.id,barcode);
    if(!item){
      clearBoothReturnPreview();
      if(popupOnError)boothShowError("棚戻し棚卸しエラー","この商品はこのイベントで持ち出し登録されていません。","boothReturnBarcode");
      return null;
    }
    const returnInput=Number(el("boothReturnQty")?.value||0);
    renderBoothReturnPreview(item,returnInput);
    return item;
  }catch(e){
    clearBoothReturnPreview();
    if(popupOnError)boothShowError("棚戻し棚卸しエラー","商品確認に失敗しました。\n"+e.message);
    return null;
  }
}

function renderBoothReturnPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  const staffOptions=getBoothStaffOptions();
  area.innerHTML=`
    <section class="booth-work-card booth-return-card">
      <h4>棚戻し棚卸し</h4>
      <p class="section-note">持ち出し済み商品を対象に戻り数を登録します。スマレジ在庫・東京在庫は変更しません。</p>
      <div class="button-row booth-camera-button-row">
        <button type="button" id="boothReturnStartCameraBtn" ${closed?"disabled":""}>カメラ読取</button>
        <button type="button" id="boothReturnStopCameraBtn" class="secondary">停止</button>
      </div>
      <div class="camera-area booth-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
          <div class="camera-guide-box">
            <div class="camera-guide-line"></div>
          </div>
          <div class="camera-guide-text">赤線にバーコードを合わせてください</div>
        </div>
      </div>
      <div class="booth-scan-row booth-return-row">
        <label>バーコード
          <input id="boothReturnBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力" ${closed?"disabled":""}>
        </label>
        <label>戻り数量
          <input id="boothReturnQty" type="number" min="1" step="1" placeholder="数量" ${closed?"disabled":""}>
        </label>
        <label>担当者<span class="required">必須</span>
          <select id="boothReturnStaff" ${closed?"disabled":""}>${staffOptions}</select>
        </label>
        <button type="button" id="boothReturnPreviewBtn" class="secondary" ${closed?"disabled":""}>商品確認</button>
        <button type="button" id="boothReturnRegisterBtn" ${closed?"disabled":""}>棚戻し登録</button>
      </div>
      <div id="boothReturnProductPreview" class="booth-product-preview" hidden></div>
      <label class="booth-carry-memo-label">メモ
        <input id="boothReturnMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}>
      </label>
    </section>
    <section class="booth-work-card booth-return-history-card">
      <div class="booth-list-header">
        <h4>棚戻し履歴</h4>
        <button type="button" id="reloadBoothReturnHistoryBtn" class="secondary">再読み込み</button>
      </div>
      <div id="boothReturnHistoryList" class="booth-carry-history-list">
        <div class="booth-empty">読み込み中...</div>
      </div>
    </section>
    <section class="booth-work-card booth-return-process-card">
      <div class="booth-list-header">
        <h4>戻り在庫処理</h4>
        <button type="button" id="reloadBoothReturnProcessBtn" class="secondary">再読み込み</button>
      </div>
      <p class="section-note">戻り棚卸し数を、イベント全体で「通常棚へ戻す」または「イベント保管にする」のどちらかに決めます。実際の在庫反映はイベント締め時に行います。</p>
      <div class="booth-scan-row booth-return-process-row">
        <label>処理方法
          <select id="boothReturnProcessType" ${closed?"disabled":""}>
            <option value="">処理方法を選択</option>
            <option value="shelf">通常棚へ戻す</option>
            <option value="storage">イベント保管にする</option>
          </select>
        </label>
        <label>担当者<span class="required">必須</span>
          <select id="boothReturnProcessStaff" ${closed?"disabled":""}>${staffOptions}</select>
        </label>
        <label>メモ
          <input id="boothReturnProcessMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}>
        </label>
        <button type="button" id="boothReturnProcessSaveBtn" ${closed?"disabled":""}>戻り先を保存</button>
      </div>
      <div id="boothReturnProcessList" class="booth-carry-history-list">
        <div class="booth-empty">読み込み中...</div>
      </div>
    </section>`;
  el("boothReturnBarcode")?.addEventListener("input",clearBoothReturnPreview);
  el("boothReturnQty")?.addEventListener("input",()=>previewBoothReturnProduct({popupOnError:false}));
  el("boothReturnPreviewBtn")?.addEventListener("click",()=>previewBoothReturnProduct({popupOnError:true}));
  el("boothReturnRegisterBtn")?.addEventListener("click",registerBoothReturn);
  el("reloadBoothReturnHistoryBtn")?.addEventListener("click",()=>loadBoothReturnHistory(event.id));
  el("reloadBoothReturnProcessBtn")?.addEventListener("click",()=>loadBoothReturnProcessList(event.id));
  el("boothReturnProcessSaveBtn")?.addEventListener("click",()=>saveBoothReturnProcess(event));
  el("boothReturnStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="return";
    startBoothCarryOutCamera();
  });
  el("boothReturnStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  loadBoothReturnHistory(event.id);
  loadBoothReturnProcessList(event.id);
}

async function loadBoothReturnProcessList(eventId){
  const list=el("boothReturnProcessList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,shelf_return_qty,event_storage_qty,return_process_type,return_reflected,return_reflected_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&order=product_name.asc`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">戻り在庫処理の対象商品はありません。</div>';
      return;
    }
    const tableRows=rows.map(row=>{
      const processType=getBoothReturnProcessType(row);
      const reflected=isBoothReturnReflected(row);
      return `<tr>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.taken_qty??0)}</td>
        <td>${esc(row.sold_qty??0)}</td>
        <td>${esc(row.consumed_qty??0)}</td>
        <td>${esc(row.returned_qty??0)}</td>
        <td>${esc(calculateBoothItemDifference(row))}</td>
        <td>${esc(processType?getBoothReturnProcessLabel(processType):"未選択")}</td>
        <td>${esc(reflected?"反映済み":"未反映")}</td>
      </tr>`;
    }).join("");
    const cardRows=rows.map(row=>{
      const processType=getBoothReturnProcessType(row);
      const reflected=isBoothReturnReflected(row);
      return `<article class="booth-history-card booth-return-process-item-card">
        <div class="booth-history-card-top">
          <strong>${esc(row.product_name||"-")}</strong>
          <span>${esc(reflected?"反映済み":"未反映")}</span>
        </div>
        <div class="booth-history-card-meta">
          <span>バーコード：${esc(row.barcode||"-")}</span>
          <span>持ち出し：${esc(row.taken_qty??0)} / 販売：${esc(row.sold_qty??0)} / 戻り：${esc(row.returned_qty??0)}</span>
          <span>ガチャ消費：${esc(row.consumed_qty??0)} / 差異：${esc(calculateBoothItemDifference(row))}</span>
          <span>処理方法：${esc(processType?getBoothReturnProcessLabel(processType):"未選択")}</span>
        </div>
      </article>`;
    }).join("");
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-return-process-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し</th><th>販売</th><th>ガチャ消費</th><th>戻り棚卸し</th><th>差異</th><th>処理方法</th><th>反映状態</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards">${cardRows}</div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">戻り在庫処理を読み込めませんでした。</div>';
    boothShowError("戻り在庫処理エラー","戻り在庫処理の読み込みに失敗しました。\n"+e.message);
  }
}

async function saveBoothReturnProcess(event){
  if(!event||!event.id){
    boothShowError("戻り在庫処理エラー","イベントを開いてから操作してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  const processType=String(el("boothReturnProcessType")?.value||"").trim();
  const staff=String(el("boothReturnProcessStaff")?.value||"").trim();
  const memo=String(el("boothReturnProcessMemo")?.value||"").trim();
  if(processType!=="shelf"&&processType!=="storage"){
    boothShowError("戻り在庫処理エラー","処理方法を選択してください。","boothReturnProcessType");
    return;
  }
  if(!staff){
    boothShowError("戻り在庫処理エラー","担当者を選択してください。","boothReturnProcessStaff");
    return;
  }
  try{
    const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,returned_qty,return_reflected,return_reflected_qty,shelf_return_reflected,shelf_return_reflected_qty&event_id=eq.${encodeURIComponent(event.id)}&item_type=eq.normal&order=product_name.asc`);
    const items=Array.isArray(rows)?rows:[];
    if(!items.length){
      boothShowError("戻り在庫処理エラー","戻り在庫処理の対象商品がありません。");
      return;
    }
    const alreadyReflected=items.filter(item=>isBoothReturnReflected(item));
    if(alreadyReflected.length){
      boothShowError("戻り在庫処理エラー","すでに締め反映済みの商品があります。修正する場合は先に締め解除してください。");
      return;
    }
    const now=new Date().toISOString();
    for(const item of items){
      const returnedQty=Number(item.returned_qty||0);
      await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          return_process_type:processType,
          shelf_return_qty:processType==="shelf"?returnedQty:0,
          event_storage_qty:processType==="storage"?returnedQty:0,
          updated_at:now
        })
      });
    }
    boothShowSuccess("戻り在庫処理完了",`戻り在庫の処理方法を「${getBoothReturnProcessLabel(processType)}」で保存しました。締め時まで在庫は変更しません。`);
    await loadBoothReturnProcessList(event.id);
  }catch(e){
    boothShowError("戻り在庫処理エラー","戻り在庫処理の保存に失敗しました。\n"+e.message);
  }
}

async function handleBoothScannedCode(code){
  code=String(code||"").trim();
  if(!code)return;
  const t=Date.now();
  if(code===boothLastScan&&t-boothLastScanAt<1800)return;
  boothLastScan=code;
  boothLastScanAt=t;
  const input=el(boothScanTarget==="return"?"boothReturnBarcode":boothScanTarget==="storage"?"boothStorageBarcode":boothScanTarget==="gacha"?"boothGachaBarcode":"boothCarryOutBarcode");
  if(input)input.value=code;
  await stopBoothCarryOutCamera(false);
  boothCameraSuccess("バーコードを読み取りました。");
  if(boothScanTarget==="return")await previewBoothReturnProduct({popupOnError:false});
  else if(boothScanTarget==="storage")await previewBoothStorageProduct({popupOnError:false});
  else if(boothScanTarget==="gacha")await previewBoothGachaProduct({popupOnError:false});
  else await previewBoothCarryOutProduct({popupOnError:false});
}

async function registerBoothCarryOut(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("持ち出し登録エラー","イベントを開いてから持ち出し登録してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  const barcode=String(el("boothCarryOutBarcode")?.value||"").trim();
  const qtyText=String(el("boothCarryOutQty")?.value||"").trim();
  const staff=String(el("boothCarryOutStaff")?.value||"").trim();
  const memo=String(el("boothCarryOutMemo")?.value||"").trim();
  const source=getBoothCarryOutSource();

  if(!barcode){
    boothShowError("持ち出し登録エラー","バーコードを入力してください。","boothCarryOutBarcode");
    return;
  }
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("持ち出し登録エラー","数量は1以上の整数を入力してください。","boothCarryOutQty");
    return;
  }
  const quantity=Number(qtyText);
  if(!staff){
    boothShowError("持ち出し登録エラー","担当者を選択してください。","boothCarryOutStaff");
    return;
  }
  if(!validateBoothStaffStore(staff,"店舗確認エラー","boothCarryOutStaff"))return;

  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){
      boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothCarryOutBarcode");
      return;
    }
    if(source==="storage"){
      const storageOk=await applyBoothStorageOut(event,product,quantity,staff,memo);
      if(!storageOk)return;
    }
    await sb("booth_stock_movements",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify([{
        event_id:event.id,
        barcode:product.barcode,
        product_name:product.name||"",
        item_type:"normal",
        movement_type:"take_out",
        quantity,
        staff,
        memo,
        takeout_source:source,
        affects_smaregi:false,
        smaregi_delta:0
      }])
    });

    await upsertBoothEventItem(event,product,quantity);

    el("boothCarryOutBarcode").value="";
    el("boothCarryOutQty").value="";
    if(el("boothCarryOutMemo"))el("boothCarryOutMemo").value="";
    const preview=el("boothProductPreview");
    if(preview){
      preview.hidden=true;
      preview.innerHTML="";
    }
    await loadBoothCarryOutHistory(event.id);
    boothShowSuccess("持ち出し登録完了","持ち出しを登録しました。");
    el("boothCarryOutBarcode")?.focus();
  }catch(e){
    boothShowError("持ち出し登録エラー","持ち出し登録に失敗しました。\n"+e.message);
  }
}

async function loadBoothReturnHistory(eventId){
  const list=el("boothReturnHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rows=await sb(`booth_stock_movements?select=id,created_at,product_name,barcode,quantity,staff,memo&event_id=eq.${encodeURIComponent(eventId)}&movement_type=eq.return&item_type=eq.normal&order=created_at.desc&limit=50`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだ棚戻し履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>戻り数</th><th>担当者</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td><input class="booth-history-qty-input" id="boothReturnQtyEdit_${esc(row.id)}" type="number" min="1" step="1" value="${esc(row.quantity??"")}"></td>
        <td>${esc(row.staff||"-")}</td>
        <td><button type="button" class="secondary booth-history-edit-btn" data-return-edit-id="${esc(row.id)}" data-return-edit-barcode="${esc(row.barcode||"")}">修正</button></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="booth-history-cards">
      ${rows.map(row=>`<article class="booth-history-card">
        <div class="booth-history-card-top">
          <strong>${esc(row.product_name||"-")}</strong>
          <span>${esc(formatBoothDateTimeShort(row.created_at))}</span>
        </div>
        <div class="booth-history-card-meta">
          <span>バーコード：${esc(row.barcode||"-")}</span>
          <span>戻り数：${esc(row.quantity??"-")}</span>
          <span>担当者：${esc(row.staff||"-")}</span>
        </div>
      </article>`).join("")}
    </div>`;
    list.querySelectorAll("[data-return-edit-id]").forEach(button=>{
      button.addEventListener("click",()=>updateBoothReturnHistoryQuantity(button.dataset.returnEditId,button.dataset.returnEditBarcode));
    });
  }catch(e){
    list.innerHTML='<div class="booth-empty">棚戻し履歴を読み込めませんでした。</div>';
    boothShowError("棚戻し履歴エラー","棚戻し履歴の読み込みに失敗しました。\n"+e.message);
  }
}

async function updateBoothReturnedQty(item,quantity){
  const current=Number(item.returned_qty||0);
  const nextReturned=current+quantity;
  const difference=calculateBoothDifference({...item,returned_qty:nextReturned},0);
  await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
    method:"PATCH",
    body:JSON.stringify({
      returned_qty:nextReturned,
      difference_qty:difference,
      updated_at:new Date().toISOString()
    })
  });
}

async function recalculateBoothReturnedQty(eventId,barcode){
  const [item,returns]=await Promise.all([
    findBoothEventItemByBarcode(eventId,barcode),
    sb(`booth_stock_movements?select=quantity&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&movement_type=eq.return&item_type=eq.normal&limit=1000`)
  ]);
  if(!item)return null;
  const nextReturned=(Array.isArray(returns)?returns:[]).reduce((sum,row)=>sum+Number(row.quantity||0),0);
  const difference=Number(item.taken_qty||0)-Number(item.sold_qty||0)-nextReturned-Number(item.consumed_qty||0);
  await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
    method:"PATCH",
    body:JSON.stringify({
      returned_qty:nextReturned,
      difference_qty:difference,
      updated_at:new Date().toISOString()
    })
  });
  return {...item,returned_qty:nextReturned,difference_qty:difference};
}

async function updateBoothReturnHistoryQuantity(movementId,barcode){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("戻し履歴修正エラー","イベントを開いてから修正してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  movementId=String(movementId||"").trim();
  barcode=String(barcode||"").trim();
  const input=el(`boothReturnQtyEdit_${movementId}`)||el(`boothReturnQtyEditCard_${movementId}`);
  const qtyText=String(input?.value||"").trim();
  if(!movementId||!barcode){
    boothShowError("戻し履歴修正エラー","修正対象の履歴が見つかりません。");
    return;
  }
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("戻し履歴修正エラー","戻り数は1以上の整数を入力してください。",input?.id||"");
    return;
  }
  const quantity=Number(qtyText);
  try{
    await sb(`booth_stock_movements?id=eq.${encodeURIComponent(movementId)}`,{
      method:"PATCH",
      body:JSON.stringify({
        quantity
      })
    });
    await recalculateBoothReturnedQty(event.id,barcode);
    await loadBoothReturnHistory(event.id);
    const currentBarcode=String(el("boothReturnBarcode")?.value||"").trim();
    if(currentBarcode&&currentBarcode===barcode)await previewBoothReturnProduct({popupOnError:false});
    boothShowSuccess("戻し履歴修正完了","戻り数を修正しました。");
  }catch(e){
    boothShowError("戻し履歴修正エラー","戻し履歴の修正に失敗しました。\n"+e.message);
  }
}

async function registerBoothReturn(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("棚戻し棚卸しエラー","イベントを開いてから戻り登録してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  const barcode=String(el("boothReturnBarcode")?.value||"").trim();
  const qtyText=String(el("boothReturnQty")?.value||"").trim();
  const staff=String(el("boothReturnStaff")?.value||"").trim();
  const memo=String(el("boothReturnMemo")?.value||"").trim();

  if(!barcode){
    boothShowError("棚戻し棚卸しエラー","バーコードを入力してください。","boothReturnBarcode");
    return;
  }
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("棚戻し棚卸しエラー","戻り数量は1以上の整数を入力してください。","boothReturnQty");
    return;
  }
  const quantity=Number(qtyText);
  if(!staff){
    boothShowError("棚戻し棚卸しエラー","担当者を選択してください。","boothReturnStaff");
    return;
  }

  try{
    const item=await findBoothEventItemByBarcode(event.id,barcode);
    if(!item){
      boothShowError("棚戻し棚卸しエラー","この商品はこのイベントで持ち出し登録されていません。","boothReturnBarcode");
      return;
    }
    await sb("booth_stock_movements",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify([{
        event_id:event.id,
        barcode:item.barcode,
        product_name:item.product_name||"",
        item_type:"normal",
        movement_type:"return",
        quantity,
        staff,
        memo,
        affects_smaregi:false,
        smaregi_delta:0
      }])
    });

    await updateBoothReturnedQty(item,quantity);

    el("boothReturnBarcode").value="";
    el("boothReturnQty").value="";
    if(el("boothReturnMemo"))el("boothReturnMemo").value="";
    clearBoothReturnPreview();
    await loadBoothReturnHistory(event.id);
    boothShowSuccess("棚戻し登録完了","戻り数量を登録しました。");
    el("boothReturnBarcode")?.focus();
  }catch(e){
    boothShowError("棚戻し棚卸しエラー","戻り登録に失敗しました。\n"+e.message);
  }
}

async function getBoothLatestSmaregiStock(barcode){
  try{
    const snapshots=await sb("smaregi_stock_snapshots?select=id&order=imported_at.desc&limit=1");
    const snapshotId=Array.isArray(snapshots)&&snapshots[0]?snapshots[0].id:"";
    if(!snapshotId)return null;
    const rows=await sb(`smaregi_stock_items?select=smaregi_stock&snapshot_id=eq.${encodeURIComponent(snapshotId)}&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
    return Array.isArray(rows)&&rows[0]?Number(rows[0].smaregi_stock||0):null;
  }catch(_){
    return null;
  }
}

async function findBoothGachaEventItem(eventId,barcode){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.gacha_prize&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function getBoothGachaSummary(eventId,barcode){
  const item=await findBoothGachaEventItem(eventId,barcode);
  const picked=Number(item?.taken_qty||0);
  const returned=Number(item?.returned_qty||0);
  return {
    item,
    picked,
    returned,
    current: picked-returned,
    consumed: picked-returned
  };
}

function renderBoothGachaPreview(product,smaregiStock,summary){
  const preview=el("boothGachaProductPreview");
  if(!preview||!product)return;
  preview.hidden=false;
  preview.innerHTML=`<div><span>商品名：</span><strong>${esc(product.name||"-")}</strong></div>
    <div><span>バーコード：</span><strong>${esc(product.barcode||"-")}</strong></div>
    <div><span>スマレジ商品ID：</span><strong>${esc(product.smaregi_product_id||"未登録")}</strong></div>
    <div><span>スマレジ在庫：</span><strong>${smaregiStock===null?"未取込":esc(smaregiStock)}</strong></div>
    <div><span>現在ガチャ持ち出し数：</span><strong>${esc(summary?.current??0)}</strong></div>
    <div><span>ガチャ消費見込み：</span><strong>${esc(summary?.consumed??0)}</strong></div>`;
}

function clearBoothGachaPreview(){
  const preview=el("boothGachaProductPreview");
  if(preview){
    preview.hidden=true;
    preview.innerHTML="";
  }
}

async function previewBoothGachaProduct(options={}){
  const popupOnError=options.popupOnError===true;
  const event=getBoothCurrentEvent();
  const barcode=String(el("boothGachaBarcode")?.value||"").trim();
  if(!event||!barcode){
    clearBoothGachaPreview();
    return null;
  }
  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){
      clearBoothGachaPreview();
      if(popupOnError)boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothGachaBarcode");
      return null;
    }
    const [smaregiStock,summary]=await Promise.all([
      getBoothLatestSmaregiStock(barcode),
      getBoothGachaSummary(event.id,barcode)
    ]);
    renderBoothGachaPreview(product,smaregiStock,summary);
    return {product,smaregiStock,summary};
  }catch(e){
    clearBoothGachaPreview();
    if(popupOnError)boothShowError("ガチャ商品確認エラー","商品確認に失敗しました。\n"+e.message);
    return null;
  }
}

async function updateBoothProductBaseStock(barcode,newStock){
  const rows=await sb(`products?barcode=eq.${encodeURIComponent(barcode)}`,{
    method:"PATCH",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({base_stock:newStock})
  });
  if(!Array.isArray(rows)||!rows.length){
    throw new Error(`products.base_stock を更新できませんでした：${barcode}`);
  }
  const p=typeof gp==="function"?gp(barcode):null;
  if(p)p.base_stock=newStock;
  return rows[0];
}

async function adjustBoothProductBaseStock(barcode,delta){
  const product=await findBoothProductByBarcode(barcode);
  if(!product)throw new Error(`商品が見つかりません：${barcode}`);
  const nextStock=Number(product.base_stock||0)+Number(delta||0);
  return updateBoothProductBaseStock(barcode,nextStock);
}

async function callBoothSmaregiStockAdjust({event,product,delta,memo}){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
  const context=getBoothSalesContext();
  const response=await fetch("about:blank",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      storeCode:context.storeCode||getBoothCurrentStoreCode(),
      smaregiProductId:product.smaregi_product_id,
      delta,
      eventId:event.id,
      barcode:product.barcode,
      productName:product.name,
      memo
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body?.error){
    throw new Error(body?.error||`スマレジ在庫更新API ${response.status}`);
  }
  return body;
}

async function insertBoothGachaInventoryLog(event,product,quantity,staff,memo,type,delta){
  const inserted=await sb("inventory_logs",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      type,
      staff,
      barcode:product.barcode,
      product_name:product.name||"",
      quantity,
      memo,
      event_id:event.id,
      affects_smaregi:true,
      smaregi_delta:delta
    })
  });
  return Array.isArray(inserted)&&inserted[0]?inserted[0]:null;
}

async function insertBoothGachaMovement(event,product,quantity,staff,memo,movementType,delta){
  await sb("booth_stock_movements",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"gacha_prize",
      movement_type:movementType,
      quantity,
      staff,
      memo,
      affects_smaregi:true,
      smaregi_delta:delta
    }])
  });
}

async function upsertBoothGachaEventItem(event,product,quantity,action){
  const eventId=encodeURIComponent(event.id);
  const barcode=encodeURIComponent(product.barcode);
  const rows=await sb(`booth_event_items?select=id,taken_qty,returned_qty&event_id=eq.${eventId}&barcode=eq.${barcode}&item_type=eq.gacha_prize&limit=1`);
  const now=new Date().toISOString();
  if(Array.isArray(rows)&&rows[0]){
    const currentTaken=Number(rows[0].taken_qty||0);
    const currentReturned=Number(rows[0].returned_qty||0);
    const nextTaken=action==="pick"?currentTaken+quantity:currentTaken;
    const nextReturned=action==="return"?currentReturned+quantity:currentReturned;
    await sb(`booth_event_items?id=eq.${encodeURIComponent(rows[0].id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        product_name:product.name||"",
        taken_qty:nextTaken,
        returned_qty:nextReturned,
        consumed_qty:Math.max(0,nextTaken-nextReturned),
        difference_qty:0,
        updated_at:now
      })
    });
    return;
  }
  const taken=action==="pick"?quantity:0;
  const returned=action==="return"?quantity:0;
  await sb("booth_event_items",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"gacha_prize",
      taken_qty:taken,
      returned_qty:returned,
      consumed_qty:Math.max(0,taken-returned),
      difference_qty:0,
      updated_at:now
    }])
  });
}

function getBoothGachaStaffOptions(){
  return getBoothStaffOptions();
}

function renderBoothGachaPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  const staffOptions=getBoothGachaStaffOptions();
  area.innerHTML=`
    <section class="booth-work-card booth-gacha-card">
      <h4>ガチャ管理</h4>
      <p class="section-note">ガチャ景品だけを管理します。ピック時はスマレジ在庫を減算し、戻り時はスマレジ在庫へ戻します。</p>
      <div class="button-row booth-camera-button-row">
        <button type="button" id="boothGachaStartCameraBtn" ${closed?"disabled":""}>カメラ読取</button>
        <div class="camera-zoom-row booth-camera-zoom-row">
          <label>カメラズーム
            <input id="boothCameraZoomRange" type="range" min="1" max="3" step="0.1" value="1.5">
            <span id="boothCameraZoomValue">1.5x</span>
          </label>
        </div>
        <button type="button" id="boothGachaStopCameraBtn" class="secondary">停止</button>
      </div>
      <div class="camera-area booth-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
          <div class="camera-guide-box">
            <div class="camera-guide-line"></div>
          </div>
          <div class="camera-guide-text">赤枠にバーコードを合わせてください</div>
        </div>
      </div>
      <div class="booth-scan-row booth-gacha-scan-row">
        <label>バーコード
          <input id="boothGachaBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力" ${closed?"disabled":""}>
        </label>
        <label>数量
          <input id="boothGachaQty" type="number" min="1" step="1" placeholder="数量" ${closed?"disabled":""}>
        </label>
        <label>担当者<span class="required">必須</span>
          <select id="boothGachaStaff" ${closed?"disabled":""}>${staffOptions}</select>
        </label>
        <button type="button" id="boothGachaPreviewBtn" class="secondary" ${closed?"disabled":""}>商品確認</button>
        <button type="button" id="boothGachaPickBtn" ${closed?"disabled":""}>ガチャピック登録</button>
        <button type="button" id="boothGachaReturnBtn" class="secondary" ${closed?"disabled":""}>ガチャ戻り登録</button>
      </div>
      <div id="boothGachaProductPreview" class="booth-product-preview" hidden></div>
      <label class="booth-carry-memo-label">メモ
        <input id="boothGachaMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}>
      </label>
    </section>
    <section class="booth-work-card booth-gacha-history-card">
      <div class="booth-list-header">
        <h4>ガチャ履歴</h4>
        <button type="button" id="reloadBoothGachaHistoryBtn" class="secondary">再読み込み</button>
      </div>
      <div id="boothGachaHistoryList" class="booth-carry-history-list">
        <div class="booth-empty">読み込み中...</div>
      </div>
    </section>`;
  el("boothGachaBarcode")?.addEventListener("input",clearBoothGachaPreview);
  el("boothGachaQty")?.addEventListener("input",()=>previewBoothGachaProduct({popupOnError:false}));
  el("boothGachaPreviewBtn")?.addEventListener("click",()=>previewBoothGachaProduct({popupOnError:true}));
  el("boothGachaPickBtn")?.addEventListener("click",()=>confirmBoothGachaPick());
  el("boothGachaReturnBtn")?.addEventListener("click",()=>confirmBoothGachaReturn());
  el("reloadBoothGachaHistoryBtn")?.addEventListener("click",()=>loadBoothGachaHistory(event.id));
  el("boothGachaStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="gacha";
    startBoothCarryOutCamera();
  });
  el("boothGachaStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  el("boothCameraZoomRange")?.addEventListener("input",applyBoothCameraZoom);
  updateBoothCameraZoomLabel();
  loadBoothGachaHistory(event.id);
}

async function validateBoothGachaForm(action){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("ガチャ登録エラー","イベントを開いてから操作してください。");
    return null;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return null;
  }
  const barcode=String(el("boothGachaBarcode")?.value||"").trim();
  const qtyText=String(el("boothGachaQty")?.value||"").trim();
  const staff=String(el("boothGachaStaff")?.value||"").trim();
  const memo=String(el("boothGachaMemo")?.value||"").trim();
  if(!barcode){
    boothShowError("ガチャ登録エラー","バーコードを入力してください。","boothGachaBarcode");
    return null;
  }
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("ガチャ登録エラー","数量は1以上の整数を入力してください。","boothGachaQty");
    return null;
  }
  if(!staff){
    boothShowError("ガチャ登録エラー","担当者を選択してください。","boothGachaStaff");
    return null;
  }
  if(!validateBoothStaffStore(staff,"店舗確認エラー","boothGachaStaff"))return null;
  const product=await findBoothProductByBarcode(barcode);
  if(!product){
    boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothGachaBarcode");
    return null;
  }
  if(!product.smaregi_product_id){
    boothShowError("スマレジ商品ID未登録","商品マスターを再取り込みしてください。","boothGachaBarcode");
    return null;
  }
  const quantity=Number(qtyText);
  const currentStock=Number(product.base_stock||0);
  const summary=await getBoothGachaSummary(event.id,barcode);
  if(action==="pick"&&currentStock-quantity<0){
    boothShowError("ガチャ登録エラー",`通常棚在庫が不足しています。\n現在庫：${currentStock}\n登録数：${quantity}`,"boothGachaQty");
    return null;
  }
  if(action==="return"&&summary.current<quantity){
    boothShowError("ガチャ戻り登録エラー",`ガチャ持ち出し数を超えて戻り登録できません。\n現在ガチャ持ち出し数：${summary.current}\n戻り数：${quantity}`,"boothGachaQty");
    return null;
  }
  const smaregiStock=await getBoothLatestSmaregiStock(barcode);
  renderBoothGachaPreview(product,smaregiStock,summary);
  return {event,product,quantity,staff,memo,currentStock,summary};
}

async function confirmBoothGachaPick(){
  const data=await validateBoothGachaForm("pick");
  if(!data)return;
  const body=[
    `商品名：${data.product.name||"-"}`,
    `数量：${data.quantity}`,
    `担当者：${data.staff}`,
    "",
    "この商品をガチャ景品として登録します。",
    "スマレジ在庫が減算されます。",
    "",
    "よろしいですか？"
  ].join("\n");
  showBoothConfirmPopup("ガチャピック確認",body,async()=>registerBoothGachaMovement("pick",data));
}

async function confirmBoothGachaReturn(){
  const data=await validateBoothGachaForm("return");
  if(!data)return;
  const body=[
    `商品名：${data.product.name||"-"}`,
    `数量：${data.quantity}`,
    `担当者：${data.staff}`,
    "",
    "この商品をガチャ戻りとして登録します。",
    "スマレジ在庫が加算されます。",
    "",
    "よろしいですか？"
  ].join("\n");
  showBoothConfirmPopup("ガチャ戻り確認",body,async()=>registerBoothGachaMovement("return",data));
}

async function registerBoothGachaMovement(action,data){
  const isPick=action==="pick";
  const movementType=isPick?"gacha_pick":"gacha_return";
  const delta=isPick?-data.quantity:data.quantity;
  const nextStock=data.currentStock+delta;
  let smaregiAdjusted=false;
  let productUpdated=false;
  try{
    await callBoothSmaregiStockAdjust({
      event:data.event,
      product:data.product,
      delta,
      memo:`ARICOイベント管理 ${isPick?"ガチャピック":"ガチャ戻り"} ${data.event.name||""}`
    });
    smaregiAdjusted=true;

    await updateBoothProductBaseStock(data.product.barcode,nextStock);
    productUpdated=true;

    await insertBoothGachaInventoryLog(data.event,data.product,data.quantity,data.staff,data.memo,movementType,delta);
    await insertBoothGachaMovement(data.event,data.product,data.quantity,data.staff,data.memo,movementType,delta);
    await upsertBoothGachaEventItem(data.event,data.product,data.quantity,action);

    el("boothGachaBarcode").value="";
    el("boothGachaQty").value="";
    if(el("boothGachaMemo"))el("boothGachaMemo").value="";
    clearBoothGachaPreview();
    await loadBoothGachaHistory(data.event.id);
    boothShowSuccess(isPick?"ガチャピック登録完了":"ガチャ戻り登録完了",`${data.product.name||"-"} / 数量 ${data.quantity}\nスマレジ在庫を${isPick?"減算":"加算"}しました。`);
    el("boothGachaBarcode")?.focus();
  }catch(e){
    let rollbackMessage="";
    if(smaregiAdjusted){
      try{
        await callBoothSmaregiStockAdjust({
          event:data.event,
          product:data.product,
          delta:-delta,
          memo:`ARICOイベント管理 ${isPick?"ガチャピック":"ガチャ戻り"} ロールバック`
        });
        rollbackMessage="\nスマレジ在庫は元に戻しました。";
      }catch(rollbackError){
        rollbackMessage="\nスマレジ在庫の自動戻しに失敗しました。手動確認してください。\n"+rollbackError.message;
      }
    }
    if(productUpdated){
      try{await updateBoothProductBaseStock(data.product.barcode,data.currentStock);}catch(_){}
    }
    boothShowError(isPick?"ガチャピック登録エラー":"ガチャ戻り登録エラー",`${isPick?"ガチャピック":"ガチャ戻り"}登録に失敗しました。\n${e.message}${rollbackMessage}`);
  }
}

async function loadBoothGachaHistory(eventId){
  const list=el("boothGachaHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rows=await sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,memo,movement_type&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.gacha_prize&movement_type=in.(gacha_pick,gacha_return)&order=created_at.desc&limit=80`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだガチャ履歴はありません。</div>';
      return;
    }
    const typeLabel=row=>String(row.movement_type)==="gacha_return"?"戻り":"ピック";
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>区分</th><th>担当者</th><th>メモ</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.quantity??"-")}</td>
        <td>${esc(typeLabel(row))}</td>
        <td>${esc(row.staff||"-")}</td>
        <td>${esc(row.memo||"")}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="booth-history-cards">
      ${rows.map(row=>`<article class="booth-history-card">
        <div class="booth-history-card-top">
          <strong>${esc(row.product_name||"-")}</strong>
          <span>${esc(formatBoothDateTimeShort(row.created_at))}</span>
        </div>
        <div class="booth-history-card-meta">
          <span>バーコード：${esc(row.barcode||"-")}</span>
          <span>数量：${esc(row.quantity??"-")}</span>
          <span>区分：${esc(typeLabel(row))}</span>
          <span>担当者：${esc(row.staff||"-")}</span>
          ${row.memo?`<span>メモ：${esc(row.memo)}</span>`:""}
        </div>
      </article>`).join("")}
    </div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">ガチャ履歴を読み込めませんでした。</div>';
    boothShowError("ガチャ履歴エラー","ガチャ履歴の読み込みに失敗しました。\n"+e.message);
  }
}

function getBoothSalesStaffOptions(){
  return getBoothStaffOptions();
}

function getBoothSalesContext(){
  if(typeof getCurrentSmaregiContext==="function")return getCurrentSmaregiContext();
  return {accountKey:"production",accountName:"スマレジ本番接続",storeCode:"tokyo",storeName:"東京"};
}

function getBoothStoreName(storeCode){
  return storeCode==="aichi"?"愛知":"東京";
}

async function loadBoothEventRegisterSettings(){
  const rows=await sb("event_register_settings?select=*&order=store_code.asc");
  boothEventRegisterSettings=Array.isArray(rows)?rows:[];
  return boothEventRegisterSettings;
}

function getBoothEventRegisterSetting(storeCode){
  const code=String(storeCode||"tokyo");
  return boothEventRegisterSettings.find(row=>String(row.store_code)===code)||{
    store_code:code,
    register_name:`${getBoothStoreName(code)}イベントレジ`,
    register_id:"",
    terminal_id:""
  };
}

function getBoothEventRegisterValue(storeCode,key){
  const setting=getBoothEventRegisterSetting(storeCode);
  return String(setting?.[key]||"");
}

function setBoothEventRegisterFormValues(){
  ["tokyo","aichi"].forEach(code=>{
    const prefix=code==="aichi"?"aichi":"tokyo";
    const setting=getBoothEventRegisterSetting(code);
    const name=el(`${prefix}EventRegisterName`);
    const registerId=el(`${prefix}EventRegisterId`);
    const terminalId=el(`${prefix}EventTerminalId`);
    if(name)name.value=setting.register_name||`${getBoothStoreName(code)}イベントレジ`;
    if(registerId)registerId.value=setting.register_id||"";
    if(terminalId)terminalId.value=setting.terminal_id||"";
  });
}

async function renderBoothEventRegisterSettings(){
  if(!el("eventRegisterSettingsForm"))return;
  try{
    await loadBoothEventRegisterSettings();
    setBoothEventRegisterFormValues();
  }catch(e){
    const msg=el("eventRegisterSettingsMessage");
    if(msg){
      msg.textContent="イベントレジ設定を読み込めませんでした。\n"+e.message;
      msg.className="message err";
    }
  }
}

async function saveBoothEventRegisterSettings(event){
  event?.preventDefault?.();
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const now=new Date().toISOString();
  const rows=[
    {
      store_code:"tokyo",
      register_name:String(el("tokyoEventRegisterName")?.value||"東京イベントレジ").trim()||"東京イベントレジ",
      register_id:String(el("tokyoEventRegisterId")?.value||"").trim(),
      terminal_id:String(el("tokyoEventTerminalId")?.value||"").trim(),
      updated_at:now
    },
    {
      store_code:"aichi",
      register_name:String(el("aichiEventRegisterName")?.value||"愛知イベントレジ").trim()||"愛知イベントレジ",
      register_id:String(el("aichiEventRegisterId")?.value||"").trim(),
      terminal_id:String(el("aichiEventTerminalId")?.value||"").trim(),
      updated_at:now
    }
  ];
  try{
    await sb("event_register_settings?on_conflict=store_code",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=representation"},
      body:JSON.stringify(rows)
    });
    await loadBoothEventRegisterSettings();
    const msg=el("eventRegisterSettingsMessage");
    if(msg){
      msg.textContent="イベント販売用レジ設定を保存しました。";
      msg.className="message ok";
    }
    if(typeof showMessage==="function")showMessage("イベント販売用レジ設定を保存しました。","ok");
  }catch(e){
    if(typeof showMessage==="function")showMessage("イベント販売用レジ設定の保存に失敗しました。\n"+e.message,"err");
  }
}

function bindBoothEventRegisterSettings(){
  ensureBoothEventRegisterSettingsCard();
  const form=el("eventRegisterSettingsForm");
  if(form&&!form.dataset.bound){
    form.dataset.bound="1";
    form.addEventListener("submit",saveBoothEventRegisterSettings);
  }
  renderBoothEventRegisterSettings();
}

function ensureBoothEventRegisterSettingsCard(){
  if(el("eventRegisterSettingsCard"))return;
  const productImport=el("productImportCard");
  const parent=productImport?.parentElement||document.querySelector("main.grid");
  if(!parent)return;
  const section=document.createElement("section");
  section.className="card event-register-settings-card";
  section.id="eventRegisterSettingsCard";
  section.dataset.inventoryScreen="settings";
  section.innerHTML=`
    <div class="section-title">
      <div>
        <h2>イベント販売用レジ設定</h2>
        <p class="section-note">販売取り込み対象にするイベントレジを店舗ごとに設定します。未設定の場合、販売取り込みは実行できません。</p>
      </div>
    </div>
    <form id="eventRegisterSettingsForm" class="event-register-settings-form">
      <div class="event-register-settings-grid">
        <fieldset>
          <legend>東京イベントレジ</legend>
          <label>レジ名<input id="tokyoEventRegisterName" placeholder="東京イベントレジ"></label>
          <label>register_id<input id="tokyoEventRegisterId" placeholder="後で登録"></label>
          <label>terminal_id<input id="tokyoEventTerminalId" placeholder="後で登録"></label>
        </fieldset>
        <fieldset>
          <legend>愛知イベントレジ</legend>
          <label>レジ名<input id="aichiEventRegisterName" placeholder="愛知イベントレジ"></label>
          <label>register_id<input id="aichiEventRegisterId" placeholder="後で登録"></label>
          <label>terminal_id<input id="aichiEventTerminalId" placeholder="後で登録"></label>
        </fieldset>
      </div>
      <button type="submit">イベントレジ設定を保存</button>
    </form>
    <div id="eventRegisterSettingsMessage" class="message"></div>`;
  if(productImport)productImport.insertAdjacentElement("afterend",section);
  else parent.appendChild(section);
  if(document.body.dataset.inventoryScreen!=="settings")section.hidden=true;
}

function getBoothSalesContextSummary(event,fromDate,toDate){
  const context=getBoothSalesContext();
  const register=getBoothSalesTargetRegister();
  return [
    `接続先：${context.accountName||"スマレジ本番接続"}`,
    `店舗：${context.storeName||"-"}`,
    `販売取込対象レジ：${register.name}`,
    `イベント名：${event?.name||"-"}`,
    `対象期間：${fromDate||event?.event_start||"-"} ～ ${toDate||event?.event_end||"-"}`
  ].join("\n");
}

function getBoothSalesTargetRegister(){
  const context=getBoothSalesContext();
  const select=el("boothSalesTargetRegister");
  const option=select?.selectedOptions?.[0];
  const code=String(select?.value||"event").trim()||"event";
  const setting=getBoothEventRegisterSetting(context.storeCode);
  return {
    code,
    name:option?.dataset.registerName||setting.register_name||`${context.storeName||""}イベントレジ`,
    registerId:option?.dataset.registerId||setting.register_id||"",
    terminalId:option?.dataset.terminalId||setting.terminal_id||""
  };
}

function getBoothSalesTargetRegisterOptions(){
  const context=getBoothSalesContext();
  const setting=getBoothEventRegisterSetting(context.storeCode);
  const name=setting.register_name||`${context.storeName||""}イベントレジ`;
  return `<option value="event" data-register-name="${esc(name)}" data-register-id="${esc(setting.register_id||"")}" data-terminal-id="${esc(setting.terminal_id||"")}">${esc(name)}</option>`;
}

function updateBoothSalesRegisterDisplay(){
  const context=getBoothSalesContext();
  const select=el("boothSalesTargetRegister");
  const display=el("boothSalesTargetRegisterDisplay");
  if(select)select.innerHTML=getBoothSalesTargetRegisterOptions();
  const register=getBoothSalesTargetRegister();
  if(display)display.textContent=register.name;
  const note=el("boothSalesRegisterStatus");
  if(note){
    const ready=Boolean(register.terminalId||register.registerId);
    note.textContent=ready
      ? `対象レジID設定済み：${register.name}`
      : `イベント販売用レジIDが未設定です：${context.storeName||"-"}`;
    note.className=ready ? "message ok booth-sales-register-status" : "message err booth-sales-register-status";
  }
}

function getBoothSalesDifference(item,soldAdd=0){
  const taken=Number(item?.taken_qty||0);
  const sold=Number(item?.sold_qty||0)+Number(soldAdd||0);
  const returned=Number(item?.returned_qty||0);
  const consumed=Number(item?.consumed_qty||0);
  return taken-sold-returned-consumed;
}

function renderBoothSalesPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  const context=getBoothSalesContext();
  const fromDate=String(event.event_start||"").slice(0,10);
  const toDate=String(event.event_end||event.event_start||"").slice(0,10);
  const storeBadge=context.storeCode==="aichi"?"AICHI":"TOKYO";
  area.innerHTML=`
    <section class="booth-work-card booth-sales-card">
      <h4>販売取り込み</h4>
      <p class="section-note">スマレジ販売データを仮取り込みし、確認後にイベント販売数へ反映します。在庫数は変更しません。</p>
      <div class="booth-sales-context">
        <div><span>接続先</span><strong>${esc(context.accountName||"スマレジ本番接続")}</strong></div>
        <div><span>店舗</span><strong>${esc(context.storeName||"-")} / ${esc(storeBadge)}</strong></div>
        <div><span>販売取込対象レジ</span><strong id="boothSalesTargetRegisterDisplay">${esc(getBoothEventRegisterSetting(context.storeCode).register_name||`${context.storeName||""}イベントレジ`)}</strong></div>
        <div><span>イベント名</span><strong>${esc(event.name||"-")}</strong></div>
        <div><span>対象期間</span><strong>${esc(fromDate||"-")} ～ ${esc(toDate||"-")}</strong></div>
      </div>
      <div class="booth-sales-form">
        <label>販売取込対象レジ<span class="required">必須</span>
          <select id="boothSalesTargetRegister" ${closed?"disabled":""}>${getBoothSalesTargetRegisterOptions()}</select>
        </label>
        <label>開始日
          <input id="boothSalesFromDate" type="date" value="${esc(fromDate)}" ${closed?"disabled":""}>
        </label>
        <label>終了日
          <input id="boothSalesToDate" type="date" value="${esc(toDate)}" ${closed?"disabled":""}>
        </label>
        <label>担当者<span class="required">必須</span>
          <select id="boothSalesStaff" ${closed?"disabled":""}>${getBoothSalesStaffOptions()}</select>
        </label>
        <button type="button" id="boothSalesDraftImportBtn" ${closed?"disabled":""}>仮取り込み</button>
        <button type="button" id="boothSalesConfirmBtn" class="secondary" ${closed?"disabled":""}>確定して販売数へ反映</button>
        <button type="button" id="reloadBoothSalesImportBtn" class="secondary">再読み込み</button>
      </div>
      <div id="boothSalesImportList" class="booth-sales-import-list">
        <div class="booth-empty">仮取り込み一覧を読み込み中...</div>
      </div>
      <div id="boothSalesRegisterStatus" class="message"></div>
      <p class="section-note booth-sales-register-note">店舗IDだけでは取り込みません。イベント販売用レジIDが未設定の場合、仮取り込みは実行できません。</p>
    </section>`;

  el("boothSalesDraftImportBtn")?.addEventListener("click",importBoothSalesDraft);
  el("boothSalesConfirmBtn")?.addEventListener("click",confirmBoothSalesImport);
  el("reloadBoothSalesImportBtn")?.addEventListener("click",()=>loadBoothSalesImports(event.id));
  loadBoothEventRegisterSettings().then(updateBoothSalesRegisterDisplay).catch(()=>updateBoothSalesRegisterDisplay());
  loadBoothSalesImports(event.id);
}

async function fetchBoothEventItems(eventId){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&order=product_name.asc`);
  return Array.isArray(rows)?rows:[];
}

async function fetchBoothDiffEventItems(eventId){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,updated_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&order=product_name.asc`);
  return Array.isArray(rows)?rows:[];
}

function buildInFilter(values){
  return values.map(value=>String(value||"").replace(/[(),]/g,"")).filter(Boolean).join(",");
}

async function fetchBoothProductsForItems(items){
  const barcodes=[...new Set(items.map(item=>String(item.barcode||"").trim()).filter(Boolean))];
  if(!barcodes.length)return [];
  const rows=await sb(`products?select=barcode,name,smaregi_product_id&barcode=in.(${buildInFilter(barcodes)})`);
  return Array.isArray(rows)?rows:[];
}

function calculateBoothItemDifference(item){
  return Number(item?.taken_qty||0)-Number(item?.sold_qty||0)-Number(item?.returned_qty||0)-Number(item?.consumed_qty||0);
}

function getBoothDiffStatus(item){
  const diff=calculateBoothItemDifference(item);
  const taken=Number(item?.taken_qty||0);
  const sold=Number(item?.sold_qty||0);
  const returned=Number(item?.returned_qty||0);
  if(diff===0)return {label:"差異なし",className:"is-ok"};
  if(diff>0){
    if(sold===0&&returned<taken)return {label:"不足 / 要確認 / 販売未取込の可能性",className:"is-warn"};
    return {label:"不足 / 要確認",className:"is-warn"};
  }
  return {label:"過剰戻り / 要確認",className:"is-over"};
}

function renderBoothDiffPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`
    <section class="booth-work-card booth-diff-card">
      <h4>差異確認</h4>
      <p class="section-note">イベント内の商品ごとに、持ち出し数・販売数・戻り数・消費数・差異数を確認します。スマレジ在庫・東京在庫は変更しません。</p>
      <div class="booth-diff-filters">
        <label>商品名・バーコード検索
          <input id="boothDiffSearch" autocomplete="off" placeholder="商品名またはバーコード">
        </label>
        <label class="booth-diff-check">
          <input id="boothDiffOnly" type="checkbox">
          差異ありのみ表示
        </label>
        <button type="button" id="boothDiffReloadBtn" class="secondary">再読み込み</button>
      </div>
      <div id="boothDiffList" class="booth-diff-list">
        <div class="booth-empty">読み込み中...</div>
      </div>
    </section>`;
  el("boothDiffSearch")?.addEventListener("input",()=>loadBoothDiffList(event.id));
  el("boothDiffOnly")?.addEventListener("change",()=>loadBoothDiffList(event.id));
  el("boothDiffReloadBtn")?.addEventListener("click",()=>loadBoothDiffList(event.id));
  loadBoothDiffList(event.id);
}

async function loadBoothDiffList(eventId){
  const list=el("boothDiffList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const items=await fetchBoothDiffEventItems(eventId);
    const products=await fetchBoothProductsForItems(items);
    const productMap=new Map((products||[]).map(product=>[String(product.barcode||""),product]));
    const keyword=String(el("boothDiffSearch")?.value||"").trim().toLowerCase();
    const diffOnly=Boolean(el("boothDiffOnly")?.checked);
    let rows=(items||[]).map(item=>{
      const product=productMap.get(String(item.barcode||""))||{};
      const diff=calculateBoothItemDifference(item);
      return {...item,smaregi_product_id:product.smaregi_product_id||"",difference_qty:diff};
    });
    if(keyword){
      rows=rows.filter(row=>{
        return String(row.product_name||"").toLowerCase().includes(keyword)
          || String(row.barcode||"").toLowerCase().includes(keyword)
          || String(row.smaregi_product_id||"").toLowerCase().includes(keyword);
      });
    }
    if(diffOnly)rows=rows.filter(row=>calculateBoothItemDifference(row)!==0);
    renderBoothDiffList(rows);
  }catch(e){
    list.innerHTML='<div class="booth-empty">差異確認を読み込めませんでした。</div>';
    boothShowError("差異確認エラー","差異確認の読み込みに失敗しました。\n"+e.message);
  }
}

function renderBoothDiffList(rows){
  const list=el("boothDiffList");
  if(!list)return;
  if(!rows.length){
    list.innerHTML='<div class="booth-empty">表示対象の商品はありません。</div>';
    return;
  }
  const tableRows=rows.map(row=>{
    const status=getBoothDiffStatus(row);
    const diff=calculateBoothItemDifference(row);
    return `<tr class="booth-diff-row ${esc(status.className)}">
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td>${esc(row.smaregi_product_id||"-")}</td>
      <td>${esc(row.taken_qty??0)}</td>
      <td>${esc(row.sold_qty??0)}</td>
      <td>${esc(row.returned_qty??0)}</td>
      <td>${esc(row.consumed_qty??0)}</td>
      <td><strong>${esc(diff)}</strong></td>
      <td><span class="booth-diff-status ${esc(status.className)}">${esc(status.label)}</span></td>
      <td><textarea id="boothDiffMemo_${esc(row.id)}" class="booth-diff-memo" placeholder="差異確認メモ">${esc(row.diff_memo||"")}</textarea></td>
      <td>${esc(formatBoothDateTime(row.updated_at))}</td>
      <td><button type="button" class="secondary booth-diff-save-btn" data-diff-item-id="${esc(row.id)}">メモ保存</button></td>
    </tr>`;
  }).join("");
  const cardRows=rows.map(row=>{
    const status=getBoothDiffStatus(row);
    const diff=calculateBoothItemDifference(row);
    return `<article class="booth-history-card booth-diff-item-card ${esc(status.className)}">
      <div class="booth-history-card-top">
        <strong>${esc(row.product_name||"-")}</strong>
        <span class="booth-diff-status ${esc(status.className)}">${esc(status.label)}</span>
      </div>
      <div class="booth-history-card-meta">
        <span>バーコード：${esc(row.barcode||"-")}</span>
        <span>スマレジ商品ID：${esc(row.smaregi_product_id||"-")}</span>
        <span>持ち出し：${esc(row.taken_qty??0)} / 販売：${esc(row.sold_qty??0)} / 戻り：${esc(row.returned_qty??0)} / 消費：${esc(row.consumed_qty??0)}</span>
        <span>差異：${esc(diff)}</span>
        <span>最終更新：${esc(formatBoothDateTimeShort(row.updated_at))}</span>
      </div>
      <textarea id="boothDiffMemoCard_${esc(row.id)}" class="booth-diff-memo" placeholder="差異確認メモ">${esc(row.diff_memo||"")}</textarea>
      <button type="button" class="secondary booth-diff-save-btn" data-diff-item-id="${esc(row.id)}">メモ保存</button>
    </article>`;
  }).join("");
  list.innerHTML=`
    <div class="booth-diff-summary">表示 ${esc(rows.length)} 件。差異数は「持ち出し - 販売 - 戻り - 消費」で表示しています。</div>
    <div class="booth-history-table-wrap"><table class="booth-history-table booth-diff-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>商品ID</th><th>持ち出し</th><th>販売</th><th>戻り</th><th>消費</th><th>差異</th><th>状態</th><th>メモ</th><th>最終更新</th><th>操作</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards">${cardRows}</div>`;
  list.querySelectorAll("[data-diff-item-id]").forEach(button=>{
    button.addEventListener("click",()=>saveBoothDiffMemo(button.dataset.diffItemId));
  });
}

async function saveBoothDiffMemo(itemId){
  itemId=String(itemId||"").trim();
  const memoEl=el(`boothDiffMemo_${itemId}`)||el(`boothDiffMemoCard_${itemId}`);
  const memo=String(memoEl?.value||"").trim();
  if(!itemId){
    boothShowError("差異メモ保存エラー","保存対象の商品が見つかりません。");
    return;
  }
  try{
    await sb(`booth_event_items?id=eq.${encodeURIComponent(itemId)}`,{
      method:"PATCH",
      body:JSON.stringify({
        diff_memo:memo,
        updated_at:new Date().toISOString()
      })
    });
    boothShowSuccess("差異メモ保存完了","差異確認メモを保存しました。");
  }catch(e){
    boothShowError("差異メモ保存エラー","差異確認メモの保存に失敗しました。\n"+e.message);
  }
}

async function fetchBoothStorageEventItems(eventId){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,shelf_return_qty,event_storage_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&order=product_name.asc`);
  return Array.isArray(rows)?rows:[];
}

async function fetchBoothStorageStocksForItems(items){
  const storeCode=getBoothCurrentStoreCode();
  const barcodes=[...new Set((items||[]).map(item=>String(item.barcode||"").trim()).filter(Boolean))];
  if(!barcodes.length)return [];
  const rows=await sb(`event_storage_stocks?select=id,store_code,barcode,product_name,storage_qty,updated_at&store_code=eq.${encodeURIComponent(storeCode)}&barcode=in.(${buildInFilter(barcodes)})`);
  return Array.isArray(rows)?rows:[];
}

function renderBoothStoragePanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  const staffOptions=getBoothStorageStaffOptions();
  area.innerHTML=`
    <section class="booth-work-card booth-storage-card">
      <h4>イベント保管</h4>
      <p class="section-note">バーコードを読み取り、戻り数を通常棚へ戻す分と次回用のイベント保管分に振り分けます。スマレジ在庫・products.base_stock・inventory_logs は変更しません。</p>
      <div class="button-row booth-camera-button-row">
        <button type="button" id="boothStorageStartCameraBtn" ${closed?"disabled":""}>カメラ読取</button>
        <button type="button" id="boothStorageStopCameraBtn" class="secondary">停止</button>
      </div>
      <div class="camera-area booth-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
          <div class="camera-guide-box">
            <div class="camera-guide-line"></div>
          </div>
          <div class="camera-guide-text">赤線にバーコードを合わせてください</div>
        </div>
      </div>
      <div class="booth-scan-row booth-storage-scan-row">
        <label>バーコード
          <input id="boothStorageBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力" ${closed?"disabled":""}>
        </label>
        <label>通常棚へ戻す
          <input id="boothStorageShelfQty" type="number" min="0" step="1" placeholder="0" ${closed?"disabled":""}>
        </label>
        <label>イベント保管
          <input id="boothStorageKeepQty" type="number" min="0" step="1" placeholder="0" ${closed?"disabled":""}>
        </label>
        <label>担当者<span class="required">必須</span>
          <select id="boothStorageStaff" ${closed?"disabled":""}>${staffOptions}</select>
        </label>
        <button type="button" id="boothStoragePreviewBtn" class="secondary" ${closed?"disabled":""}>商品確認</button>
        <button type="button" id="boothStorageRegisterBtn" ${closed?"disabled":""}>登録</button>
      </div>
      <div id="boothStorageProductPreview" class="booth-product-preview" hidden></div>
      <label class="booth-carry-memo-label">メモ
        <input id="boothStorageMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}>
      </label>
    </section>
    <section class="booth-work-card booth-storage-history-card">
      <div class="booth-list-header">
        <h4>イベント保管履歴</h4>
        <button type="button" id="reloadBoothStorageHistoryBtn" class="secondary">再読み込み</button>
      </div>
      <div id="boothStorageHistoryList" class="booth-carry-history-list">
        <div class="booth-empty">読み込み中...</div>
      </div>
    </section>`;
  el("boothStorageBarcode")?.addEventListener("input",clearBoothStoragePreview);
  el("boothStorageShelfQty")?.addEventListener("input",()=>previewBoothStorageProduct({popupOnError:false}));
  el("boothStorageKeepQty")?.addEventListener("input",()=>previewBoothStorageProduct({popupOnError:false}));
  el("boothStoragePreviewBtn")?.addEventListener("click",()=>previewBoothStorageProduct({popupOnError:true}));
  el("boothStorageRegisterBtn")?.addEventListener("click",saveBoothStorageSplitFromForm);
  el("reloadBoothStorageHistoryBtn")?.addEventListener("click",()=>loadBoothStorageHistory(event.id));
  el("boothStorageStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="storage";
    startBoothCarryOutCamera();
  });
  el("boothStorageStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  loadBoothStorageHistory(event.id);
}

async function loadBoothStorageList(eventId){
  const list=el("boothStorageList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const items=await fetchBoothStorageEventItems(eventId);
    const [products,stocks]=await Promise.all([
      fetchBoothProductsForItems(items),
      fetchBoothStorageStocksForItems(items)
    ]);
    const productMap=new Map((products||[]).map(product=>[String(product.barcode||""),product]));
    const stockMap=new Map((stocks||[]).map(stock=>[String(stock.barcode||""),stock]));
    const keyword=String(el("boothStorageSearch")?.value||"").trim().toLowerCase();
    let rows=(items||[]).map(item=>{
      const product=productMap.get(String(item.barcode||""))||{};
      const stock=stockMap.get(String(item.barcode||""))||{};
      return {
        ...item,
        smaregi_product_id:product.smaregi_product_id||"",
        current_storage_qty:Number(stock.storage_qty||0)
      };
    });
    if(keyword){
      rows=rows.filter(row=>{
        return String(row.product_name||"").toLowerCase().includes(keyword)
          || String(row.barcode||"").toLowerCase().includes(keyword)
          || String(row.smaregi_product_id||"").toLowerCase().includes(keyword);
      });
    }
    renderBoothStorageList(rows);
  }catch(e){
    list.innerHTML='<div class="booth-empty">イベント保管を読み込めませんでした。</div>';
    boothShowError("イベント保管エラー","イベント保管の読み込みに失敗しました。\n"+e.message);
  }
}

function getBoothStorageStaffOptions(){
  return getBoothStaffOptions();
}

function renderBoothStorageList(rows){
  const list=el("boothStorageList");
  if(!list)return;
  if(!rows.length){
    list.innerHTML='<div class="booth-empty">表示対象の商品はありません。</div>';
    return;
  }
  const staffOptions=getBoothStorageStaffOptions();
  const buildInputs=(row,suffix)=>`
    <label>通常棚へ戻す
      <input id="boothShelfReturn_${esc(row.id)}_${esc(suffix)}" type="number" min="0" step="1" value="${esc(row.shelf_return_qty??0)}">
    </label>
    <label>イベント保管
      <input id="boothEventStorage_${esc(row.id)}_${esc(suffix)}" type="number" min="0" step="1" value="${esc(row.event_storage_qty??0)}">
    </label>
    <label>担当者<span class="required">必須</span>
      <select id="boothStorageStaff_${esc(row.id)}_${esc(suffix)}">${staffOptions}</select>
    </label>
    <label>メモ
      <input id="boothStorageMemo_${esc(row.id)}_${esc(suffix)}" autocomplete="off" placeholder="任意メモ">
    </label>
    <button type="button" class="booth-storage-save-btn" data-storage-item-id="${esc(row.id)}" data-storage-suffix="${esc(suffix)}">登録</button>`;
  const tableRows=rows.map(row=>`<tr>
    <td>${esc(row.product_name||"-")}</td>
    <td>${esc(row.barcode||"-")}</td>
    <td>${esc(row.taken_qty??0)}</td>
    <td>${esc(row.sold_qty??0)}</td>
    <td>${esc(row.returned_qty??0)}</td>
    <td>${esc(row.shelf_return_qty??0)}</td>
    <td>${esc(row.event_storage_qty??0)}</td>
    <td>${esc(row.current_storage_qty??0)}</td>
    <td><div class="booth-storage-inputs">${buildInputs(row,"table")}</div></td>
  </tr>`).join("");
  const cardRows=rows.map(row=>`<article class="booth-history-card booth-storage-item-card">
    <div class="booth-history-card-top">
      <strong>${esc(row.product_name||"-")}</strong>
      <span>保管在庫 ${esc(row.current_storage_qty??0)}</span>
    </div>
    <div class="booth-history-card-meta">
      <span>バーコード：${esc(row.barcode||"-")}</span>
      <span>スマレジ商品ID：${esc(row.smaregi_product_id||"-")}</span>
      <span>持ち出し：${esc(row.taken_qty??0)} / 販売：${esc(row.sold_qty??0)} / 戻り：${esc(row.returned_qty??0)} / 消費：${esc(row.consumed_qty??0)}</span>
      <span>通常棚戻し：${esc(row.shelf_return_qty??0)} / イベント保管：${esc(row.event_storage_qty??0)}</span>
      <span>現在のイベント保管在庫：${esc(row.current_storage_qty??0)}</span>
    </div>
    <div class="booth-storage-inputs">${buildInputs(row,"card")}</div>
  </article>`).join("");
  list.innerHTML=`
    <div class="booth-diff-summary">表示 ${esc(rows.length)} 件。通常棚戻し + イベント保管 は戻り数を超えない範囲で登録します。</div>
    <div class="booth-history-table-wrap"><table class="booth-history-table booth-storage-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し</th><th>販売</th><th>戻り</th><th>通常棚戻し</th><th>イベント保管</th><th>現在保管在庫</th><th>登録</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards">${cardRows}</div>`;
  list.querySelectorAll("[data-storage-item-id]").forEach(button=>{
    button.addEventListener("click",()=>saveBoothStorageSplit(button.dataset.storageItemId,button.dataset.storageSuffix));
  });
}

function parseBoothStorageQty(inputId,label){
  const raw=String(el(inputId)?.value||"").trim();
  if(raw==="")return 0;
  if(!/^\d+$/.test(raw)){
    boothShowError("イベント保管エラー",`${label}は0以上の整数を入力してください。`,inputId);
    return null;
  }
  return Number(raw);
}

function clearBoothStoragePreview(){
  const preview=el("boothStorageProductPreview");
  if(preview){
    preview.hidden=true;
    preview.innerHTML="";
  }
}

async function findBoothStorageEventItemByBarcode(eventId,barcode){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,shelf_return_qty,event_storage_qty&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.normal&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

function renderBoothStoragePreview(item,currentStorageQty,shelfQty=0,storageQty=0){
  const preview=el("boothStorageProductPreview");
  if(!preview||!item)return;
  const total=Number(shelfQty||0)+Number(storageQty||0);
  preview.hidden=false;
  preview.innerHTML=`<div><span>商品名：</span><strong>${esc(item.product_name||"-")}</strong></div>
    <div><span>バーコード：</span><strong>${esc(item.barcode||"-")}</strong></div>
    <div><span>持ち出し：</span><strong>${esc(item.taken_qty??0)}</strong></div>
    <div><span>販売：</span><strong>${esc(item.sold_qty??0)}</strong></div>
    <div><span>戻り：</span><strong>${esc(item.returned_qty??0)}</strong></div>
    <div><span>登録済み 通常棚戻し：</span><strong>${esc(item.shelf_return_qty??0)}</strong></div>
    <div><span>登録済み イベント保管：</span><strong>${esc(item.event_storage_qty??0)}</strong></div>
    <div><span>今回入力合計：</span><strong>${esc(total)}</strong></div>
    <div><span>現在のイベント保管在庫：</span><strong>${esc(currentStorageQty??0)}</strong></div>
    <div><span>スマレジ在庫：</span><strong>変更しません</strong></div>`;
}

async function previewBoothStorageProduct(options={}){
  const popupOnError=options.popupOnError===true;
  const event=getBoothCurrentEvent();
  const barcode=String(el("boothStorageBarcode")?.value||"").trim();
  const preview=el("boothStorageProductPreview");
  if(!preview)return null;
  if(!event||!barcode){
    clearBoothStoragePreview();
    return null;
  }
  try{
    const item=await findBoothStorageEventItemByBarcode(event.id,barcode);
    if(!item){
      clearBoothStoragePreview();
      if(popupOnError)boothShowError("イベント保管エラー","この商品はこのイベントで持ち出し登録されていません。","boothStorageBarcode");
      return null;
    }
    const stock=await findBoothEventStorageStock(getBoothCurrentStoreCode(),barcode);
    const shelfQty=Number(el("boothStorageShelfQty")?.value||0);
    const storageQty=Number(el("boothStorageKeepQty")?.value||0);
    renderBoothStoragePreview(item,Number(stock?.storage_qty||0),shelfQty,storageQty);
    return item;
  }catch(e){
    clearBoothStoragePreview();
    if(popupOnError)boothShowError("イベント保管エラー","商品確認に失敗しました。\n"+e.message);
    return null;
  }
}

async function upsertBoothEventStorageStock(storeCode,item,delta){
  if(delta===0)return;
  const stock=await findBoothEventStorageStock(storeCode,item.barcode);
  const currentQty=Number(stock?.storage_qty||0);
  const nextQty=currentQty+delta;
  if(nextQty<0){
    boothShowError("イベント保管エラー","イベント保管在庫が不足するため修正できません。");
    throw new Error("event_storage_stocks.storage_qty would be negative");
  }
  const now=new Date().toISOString();
  if(stock){
    await sb(`event_storage_stocks?id=eq.${encodeURIComponent(stock.id)}`,{
      method:"PATCH",
      body:JSON.stringify({
        product_name:item.product_name||stock.product_name||"",
        storage_qty:nextQty,
        updated_at:now
      })
    });
    return;
  }
  if(delta<0){
    boothShowError("イベント保管エラー","イベント保管在庫が不足するため修正できません。");
    throw new Error("event_storage_stocks row not found");
  }
  await sb("event_storage_stocks",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      store_code:storeCode,
      barcode:item.barcode,
      product_name:item.product_name||"",
      storage_qty:delta,
      updated_at:now
    }])
  });
}

async function saveBoothStorageSplit(itemId,suffix){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("イベント保管エラー","イベントを開いてから操作してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  itemId=String(itemId||"").trim();
  suffix=String(suffix||"table");
  const shelfQty=parseBoothStorageQty(`boothShelfReturn_${itemId}_${suffix}`,"通常棚へ戻す数");
  if(shelfQty===null)return;
  const storageQty=parseBoothStorageQty(`boothEventStorage_${itemId}_${suffix}`,"イベント保管に残す数");
  if(storageQty===null)return;
  const staff=String(el(`boothStorageStaff_${itemId}_${suffix}`)?.value||"").trim();
  const memo=String(el(`boothStorageMemo_${itemId}_${suffix}`)?.value||"").trim();
  if(!staff){
    boothShowError("イベント保管エラー","担当者を選択してください。",`boothStorageStaff_${itemId}_${suffix}`);
    return;
  }
  try{
    const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,shelf_return_qty,event_storage_qty&event_id=eq.${encodeURIComponent(event.id)}&id=eq.${encodeURIComponent(itemId)}&limit=1`);
    const item=Array.isArray(rows)&&rows[0]?rows[0]:null;
    if(!item){
      boothShowError("イベント保管エラー","保存対象の商品が見つかりません。");
      return;
    }
    const returnedQty=Number(item.returned_qty||0);
    if(shelfQty+storageQty>returnedQty){
      boothShowError("イベント保管エラー","通常棚へ戻す数とイベント保管に残す数の合計が戻り数を超えています。");
      return;
    }
    const previousStorageQty=Number(item.event_storage_qty||0);
    const delta=storageQty-previousStorageQty;
    const products=await fetchBoothProductsForItems([item]);
    const product=Array.isArray(products)&&products[0]?products[0]:{};
    const itemForStorage={...item,smaregi_product_id:product.smaregi_product_id||""};
    const storeCode=getBoothCurrentStoreCode();
    await upsertBoothEventStorageStock(storeCode,itemForStorage,delta);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
      method:"PATCH",
      body:JSON.stringify({
        shelf_return_qty:shelfQty,
        event_storage_qty:storageQty,
        updated_at:new Date().toISOString()
      })
    });
    if(delta!==0){
      await sb("event_storage_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:event.id,
          store_code:storeCode,
          smaregi_product_id:itemForStorage.smaregi_product_id?String(itemForStorage.smaregi_product_id):null,
          barcode:item.barcode,
          product_name:item.product_name||"",
          movement_type:delta>0?"storage_in":"adjustment",
          quantity:Math.abs(delta),
          staff,
          memo:delta>0?memo:`イベント保管数修正 ${previousStorageQty} -> ${storageQty}${memo?` / ${memo}`:""}`
        }])
      });
    }
    boothShowSuccess("イベント保管登録完了","イベント保管の振り分けを保存しました。");
    await loadBoothStorageList(event.id);
  }catch(e){
    if(String(e?.message||"").includes("event_storage_stocks"))return;
    boothShowError("イベント保管エラー","イベント保管の保存に失敗しました。\n"+e.message);
  }
}

async function saveBoothStorageSplitFromForm(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("イベント保管エラー","イベントを開いてから操作してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  const barcode=String(el("boothStorageBarcode")?.value||"").trim();
  if(!barcode){
    boothShowError("イベント保管エラー","バーコードを入力してください。","boothStorageBarcode");
    return;
  }
  const shelfQty=parseBoothStorageQty("boothStorageShelfQty","通常棚へ戻す数");
  if(shelfQty===null)return;
  const storageQty=parseBoothStorageQty("boothStorageKeepQty","イベント保管に残す数");
  if(storageQty===null)return;
  const staff=String(el("boothStorageStaff")?.value||"").trim();
  const memo=String(el("boothStorageMemo")?.value||"").trim();
  if(!staff){
    boothShowError("イベント保管エラー","担当者を選択してください。","boothStorageStaff");
    return;
  }
  try{
    const item=await findBoothStorageEventItemByBarcode(event.id,barcode);
    if(!item){
      boothShowError("イベント保管エラー","この商品はこのイベントで持ち出し登録されていません。","boothStorageBarcode");
      return;
    }
    const returnedQty=Number(item.returned_qty||0);
    if(shelfQty+storageQty>returnedQty){
      boothShowError("イベント保管エラー","通常棚へ戻す数とイベント保管に残す数の合計が戻り数を超えています。");
      return;
    }
    const previousStorageQty=Number(item.event_storage_qty||0);
    const delta=storageQty-previousStorageQty;
    const products=await fetchBoothProductsForItems([item]);
    const product=Array.isArray(products)&&products[0]?products[0]:{};
    const itemForStorage={...item,smaregi_product_id:product.smaregi_product_id||""};
    const storeCode=getBoothCurrentStoreCode();
    await upsertBoothEventStorageStock(storeCode,itemForStorage,delta);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
      method:"PATCH",
      body:JSON.stringify({
        shelf_return_qty:shelfQty,
        event_storage_qty:storageQty,
        updated_at:new Date().toISOString()
      })
    });
    if(delta!==0){
      await sb("event_storage_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:event.id,
          store_code:storeCode,
          smaregi_product_id:itemForStorage.smaregi_product_id?String(itemForStorage.smaregi_product_id):null,
          barcode:item.barcode,
          product_name:item.product_name||"",
          movement_type:delta>0?"storage_in":"adjustment",
          quantity:Math.abs(delta),
          staff,
          memo:delta>0?memo:`イベント保管数修正 ${previousStorageQty} -> ${storageQty}${memo?` / ${memo}`:""}`
        }])
      });
    }
    boothShowSuccess("イベント保管登録完了","イベント保管の振り分けを保存しました。");
    el("boothStorageBarcode").value="";
    el("boothStorageShelfQty").value="";
    el("boothStorageKeepQty").value="";
    if(el("boothStorageMemo"))el("boothStorageMemo").value="";
    clearBoothStoragePreview();
    await loadBoothStorageHistory(event.id);
    el("boothStorageBarcode")?.focus();
  }catch(e){
    if(String(e?.message||"").includes("event_storage_stocks"))return;
    boothShowError("イベント保管エラー","イベント保管の保存に失敗しました。\n"+e.message);
  }
}

async function loadBoothStorageHistory(eventId){
  const list=el("boothStorageHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const items=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,shelf_return_qty,event_storage_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&or=${encodeURIComponent("(shelf_return_qty.gt.0,event_storage_qty.gt.0)")}&order=updated_at.desc`);
    if(!Array.isArray(items)||!items.length){
      list.innerHTML='<div class="booth-empty">まだイベント保管履歴はありません。</div>';
      return;
    }
    const stocks=await fetchBoothStorageStocksForItems(items);
    const stockMap=new Map((stocks||[]).map(stock=>[String(stock.barcode||""),stock]));
    const rows=(items||[]).map(item=>{
      const stock=stockMap.get(String(item.barcode||""))||{};
      return {...item,current_storage_qty:Number(stock.storage_qty||0)};
    });
    const tableRows=rows.map(row=>`<tr>
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td>${esc(row.returned_qty??0)}</td>
      <td><input class="booth-history-qty-input" id="boothStorageShelfEdit_${esc(row.id)}" type="number" min="0" step="1" value="${esc(row.shelf_return_qty??0)}"></td>
      <td><input class="booth-history-qty-input" id="boothStorageKeepEdit_${esc(row.id)}" type="number" min="0" step="1" value="${esc(row.event_storage_qty??0)}"></td>
      <td>${esc(row.current_storage_qty??0)}</td>
      <td><input id="boothStorageStaffEdit_${esc(row.id)}" autocomplete="off" placeholder="任意"></td>
      <td><input id="boothStorageMemoEdit_${esc(row.id)}" autocomplete="off" placeholder="任意メモ"></td>
      <td><button type="button" class="secondary booth-history-edit-btn" data-storage-edit-id="${esc(row.id)}">修正</button></td>
    </tr>`).join("");
    const cardRows=rows.map(row=>`<article class="booth-history-card booth-storage-item-card">
      <div class="booth-history-card-top">
        <strong>${esc(row.product_name||"-")}</strong>
        <span>保管 ${esc(row.event_storage_qty??0)}</span>
      </div>
      <div class="booth-history-card-meta">
        <span>バーコード：${esc(row.barcode||"-")}</span>
        <span>戻り：${esc(row.returned_qty??0)}</span>
        <span>通常棚戻し：${esc(row.shelf_return_qty??0)} / イベント保管：${esc(row.event_storage_qty??0)}</span>
        <span>現在のイベント保管在庫：${esc(row.current_storage_qty??0)}</span>
      </div>
    </article>`).join("");
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-storage-history-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>戻り</th><th>通常棚戻し</th><th>イベント保管</th><th>現在保管在庫</th><th>担当者</th><th>メモ</th><th>操作</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards">${cardRows}</div>`;
    list.querySelectorAll("[data-storage-edit-id]").forEach(button=>{
      button.addEventListener("click",()=>updateBoothStorageHistorySplit(button.dataset.storageEditId));
    });
  }catch(e){
    list.innerHTML='<div class="booth-empty">イベント保管履歴を読み込めませんでした。</div>';
    boothShowError("イベント保管履歴エラー","イベント保管履歴の読み込みに失敗しました。\n"+e.message);
  }
}

async function updateBoothStorageHistorySplit(itemId){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("イベント保管修正エラー","イベントを開いてから操作してください。");
    return;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  itemId=String(itemId||"").trim();
  const shelfQty=parseBoothStorageQty(`boothStorageShelfEdit_${itemId}`,"通常棚へ戻す数");
  if(shelfQty===null)return;
  const storageQty=parseBoothStorageQty(`boothStorageKeepEdit_${itemId}`,"イベント保管に残す数");
  if(storageQty===null)return;
  const staff=String(el(`boothStorageStaffEdit_${itemId}`)?.value||"").trim()||"修正";
  const memo=String(el(`boothStorageMemoEdit_${itemId}`)?.value||"").trim();
  try{
    const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,shelf_return_qty,event_storage_qty&event_id=eq.${encodeURIComponent(event.id)}&id=eq.${encodeURIComponent(itemId)}&limit=1`);
    const item=Array.isArray(rows)&&rows[0]?rows[0]:null;
    if(!item){
      boothShowError("イベント保管修正エラー","修正対象の商品が見つかりません。");
      return;
    }
    const returnedQty=Number(item.returned_qty||0);
    if(shelfQty+storageQty>returnedQty){
      boothShowError("イベント保管修正エラー","通常棚へ戻す数とイベント保管に残す数の合計が戻り数を超えています。");
      return;
    }
    const previousStorageQty=Number(item.event_storage_qty||0);
    const delta=storageQty-previousStorageQty;
    const products=await fetchBoothProductsForItems([item]);
    const product=Array.isArray(products)&&products[0]?products[0]:{};
    const itemForStorage={...item,smaregi_product_id:product.smaregi_product_id||""};
    const storeCode=getBoothCurrentStoreCode();
    await upsertBoothEventStorageStock(storeCode,itemForStorage,delta);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
      method:"PATCH",
      body:JSON.stringify({
        shelf_return_qty:shelfQty,
        event_storage_qty:storageQty,
        updated_at:new Date().toISOString()
      })
    });
    if(delta!==0){
      await sb("event_storage_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:event.id,
          store_code:storeCode,
          smaregi_product_id:itemForStorage.smaregi_product_id?String(itemForStorage.smaregi_product_id):null,
          barcode:item.barcode,
          product_name:item.product_name||"",
          movement_type:delta>0?"storage_in":"adjustment",
          quantity:Math.abs(delta),
          staff,
          memo:`イベント保管履歴修正 ${previousStorageQty} -> ${storageQty}${memo?` / ${memo}`:""}`
        }])
      });
    }
    boothShowSuccess("イベント保管修正完了","イベント保管履歴を修正しました。");
    await loadBoothStorageHistory(event.id);
  }catch(e){
    if(String(e?.message||"").includes("event_storage_stocks"))return;
    boothShowError("イベント保管修正エラー","イベント保管履歴の修正に失敗しました。\n"+e.message);
  }
}

async function fetchExistingBoothSalesImportKeys(eventId){
  const rows=await sb(`event_sales_imports?select=smaregi_transaction_id,smaregi_detail_id&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed)`);
  const keys=new Set();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    keys.add(`${row.smaregi_transaction_id}::${row.smaregi_detail_id}`);
  });
  return keys;
}

async function loadBoothSalesImports(eventId){
  const list=el("boothSalesImportList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">仮取り込み一覧を読み込み中...</div>';
    const [imports,items]=await Promise.all([
      sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=eq.pending&order=sold_at.asc&limit=500`),
      fetchBoothEventItems(eventId)
    ]);
    renderBoothSalesImports(Array.isArray(imports)?imports:[],items);
  }catch(e){
    list.innerHTML='<div class="booth-empty">販売取り込み一覧を読み込めませんでした。</div>';
    boothShowError("販売取り込みエラー","販売取り込み一覧の読み込みに失敗しました。\nevent_sales_imports SQLが未実行の場合は先に実行してください。\n"+e.message);
  }
}

function renderBoothSalesImports(rows,items){
  const list=el("boothSalesImportList");
  if(!list)return;
  const itemMap=new Map((items||[]).map(item=>[String(item.barcode||""),item]));
  if(!rows.length){
    list.innerHTML='<div class="booth-empty">未確定の仮取り込みデータはありません。</div>';
    return;
  }
  const tableRows=rows.map(row=>{
    const item=itemMap.get(String(row.barcode||""))||{};
    const imported=Number(row.quantity||0);
    const diff=getBoothSalesDifference(item,imported);
    return `<tr>
      <td>${esc(formatBoothDateTime(row.sold_at))}</td>
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td>${esc(row.smaregi_product_id||"-")}</td>
      <td>${esc(row.target_register_name||"-")}</td>
      <td>${esc(item.taken_qty??0)}</td>
      <td>${esc(imported)}</td>
      <td>${esc(item.returned_qty??0)}</td>
      <td>${esc(diff)}</td>
      <td>${esc(row.smaregi_transaction_id||"-")} / ${esc(row.smaregi_detail_id||"-")}</td>
    </tr>`;
  }).join("");
  const cardRows=rows.map(row=>{
    const item=itemMap.get(String(row.barcode||""))||{};
    const imported=Number(row.quantity||0);
    const diff=getBoothSalesDifference(item,imported);
    return `<article class="booth-history-card booth-sales-card-row">
      <div class="booth-history-card-top">
        <strong>${esc(row.product_name||"-")}</strong>
        <span>${esc(formatBoothDateTimeShort(row.sold_at))}</span>
      </div>
      <div class="booth-history-card-meta">
        <span>バーコード：${esc(row.barcode||"-")}</span>
        <span>スマレジ商品ID：${esc(row.smaregi_product_id||"-")}</span>
        <span>対象レジ：${esc(row.target_register_name||"-")}</span>
        <span>持ち出し：${esc(item.taken_qty??0)} / 販売候補：${esc(imported)} / 戻り：${esc(item.returned_qty??0)}</span>
        <span>差異見込み：${esc(diff)}</span>
        <span>取引：${esc(row.smaregi_transaction_id||"-")} / ${esc(row.smaregi_detail_id||"-")}</span>
      </div>
    </article>`;
  }).join("");
  list.innerHTML=`
    <div class="booth-sales-import-summary">未確定 ${esc(rows.length)} 行。確認後に「確定して販売数へ反映」を押してください。</div>
    <div class="booth-history-table-wrap"><table class="booth-history-table booth-sales-table">
      <thead><tr><th>販売日時</th><th>商品名</th><th>バーコード</th><th>商品ID</th><th>対象レジ</th><th>持ち出し</th><th>販売候補</th><th>戻り</th><th>差異見込み</th><th>取引ID</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards">${cardRows}</div>`;
}

function validateBoothSalesForm(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("販売取り込みエラー","イベントを開いてから販売取り込みを行ってください。");
    return null;
  }
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return null;
  }
  const fromDate=String(el("boothSalesFromDate")?.value||"").trim();
  const toDate=String(el("boothSalesToDate")?.value||"").trim();
  const staff=String(el("boothSalesStaff")?.value||"").trim();
  const register=getBoothSalesTargetRegister();
  if(!register.code){
    boothShowError("販売取り込みエラー","販売取込対象レジを選択してください。","boothSalesTargetRegister");
    return null;
  }
  if(!register.terminalId&&!register.registerId){
    boothShowError("販売取り込みエラー","イベント販売用レジIDが未設定です","boothSalesTargetRegister");
    return null;
  }
  if(!fromDate||!toDate){
    boothShowError("販売取り込みエラー","開始日と終了日を入力してください。");
    return null;
  }
  if(fromDate>toDate){
    boothShowError("販売取り込みエラー","終了日は開始日以降の日付を入力してください。");
    return null;
  }
  if(!staff){
    boothShowError("販売取り込みエラー","担当者を選択してください。","boothSalesStaff");
    return null;
  }
  return {event,fromDate,toDate,staff,register};
}

async function importBoothSalesDraft(){
  boothShowError("API停止中／CSV運用中","スマレジAPIから販売データは取得しません。イベント販売データはCSV取込で反映してください。");
  return;
  const form=validateBoothSalesForm();
  if(!form)return;
  const {event,fromDate,toDate,staff,register}=form;
  const context=getBoothSalesContext();
  const ok=typeof confirmAppAction==="function"
    ? await confirmAppAction("販売データ仮取り込み確認",`${getBoothSalesContextSummary(event,fromDate,toDate)}\n\nこの条件で販売データを取得します。`,{okText:"仮取り込み"})
    : true;
  if(!ok)return;

  try{
    const items=await fetchBoothEventItems(event.id);
    if(!items.length){
      boothShowError("販売取り込みエラー","このイベントには持ち出し済み商品がありません。");
      return;
    }
    const products=await fetchBoothProductsForItems(items);
    const itemByBarcode=new Map(items.map(item=>[String(item.barcode||""),item]));
    const itemByProductId=new Map();
    products.forEach(product=>{
      const productId=String(product.smaregi_product_id||"").trim();
      const item=itemByBarcode.get(String(product.barcode||""));
      if(productId&&item)itemByProductId.set(productId,{...item,smaregi_product_id:productId,product_name:item.product_name||product.name||""});
    });
    const productIds=[...itemByProductId.keys()];
    if(!productIds.length){
      boothShowError("販売取り込みエラー","持ち出し済み商品のスマレジ商品IDが見つかりません。商品マスターを再取り込みしてください。");
      return;
    }

    const response=await fetch("about:blank",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        ...(typeof getSmaregiRequestContext==="function"?getSmaregiRequestContext():context),
        storeCode:context.storeCode,
        targetRegisterCode:register.code,
        targetRegisterName:register.name,
        targetRegisterId:register.registerId,
        targetTerminalId:register.terminalId||register.registerId,
        fromDate,
        toDate,
        smaregiProductIds:productIds
      })
    });
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(body?.error||`スマレジ販売データ取得エラー ${response.status}`);

    const existingKeys=await fetchExistingBoothSalesImportKeys(event.id);
    const now=new Date().toISOString();
    const rows=(body.sales||[]).map(sale=>{
      const item=itemByProductId.get(String(sale.smaregi_product_id||""));
      if(!item)return null;
      const key=`${sale.smaregi_transaction_id}::${sale.smaregi_detail_id}`;
      if(existingKeys.has(key))return null;
      return {
        event_id:event.id,
        smaregi_transaction_id:String(sale.smaregi_transaction_id||""),
        smaregi_detail_id:String(sale.smaregi_detail_id||""),
        smaregi_product_id:String(sale.smaregi_product_id||""),
        barcode:item.barcode,
        product_name:item.product_name||sale.product_name||"",
        quantity:Number(sale.quantity||0),
        sold_at:sale.sold_at||null,
        store_code:context.storeCode,
        smaregi_store_id:body.context?.storeId||null,
        target_register_code:body.context?.targetRegisterCode||register.code,
        target_register_name:body.context?.targetRegisterName||register.name,
        smaregi_register_id:body.context?.targetRegisterId||body.context?.targetTerminalId||sale.smaregi_terminal_id||null,
        smaregi_terminal_id:sale.smaregi_terminal_id||body.context?.targetTerminalId||null,
        import_status:"pending",
        imported_by:staff,
        imported_at:now,
        updated_at:now
      };
    }).filter(row=>row&&row.smaregi_transaction_id&&row.smaregi_detail_id&&row.quantity>0);

    if(rows.length){
      await sb("event_sales_imports",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(rows)
      });
    }
    await loadBoothSalesImports(event.id);
    boothShowSuccess("販売データ仮取り込み完了",`仮取り込み ${rows.length} 行を保存しました。確定するまで販売数には反映されません。`);
  }catch(e){
    boothShowError("販売取り込みエラー","販売データの仮取り込みに失敗しました。\n"+e.message);
  }
}

async function confirmBoothSalesImport(){
  const form=validateBoothSalesForm();
  if(!form)return;
  const {event,fromDate,toDate,staff}=form;
  try{
    const pending=await sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(event.id)}&import_status=eq.pending&order=sold_at.asc&limit=500`);
    const rows=Array.isArray(pending)?pending:[];
    if(!rows.length){
      boothShowError("販売取り込みエラー","確定待ちの仮取り込みデータがありません。");
      return;
    }
    const ok=typeof confirmAppAction==="function"
      ? await confirmAppAction("販売取り込み確定確認",`${getBoothSalesContextSummary(event,fromDate,toDate)}\n\n未確定 ${rows.length} 行を販売数へ反映します。`,{okText:"確定"})
      : true;
    if(!ok)return;

    const items=await fetchBoothEventItems(event.id);
    const itemByBarcode=new Map(items.map(item=>[String(item.barcode||""),item]));
    const addByBarcode=new Map();
    rows.forEach(row=>{
      const barcode=String(row.barcode||"");
      addByBarcode.set(barcode,(addByBarcode.get(barcode)||0)+Number(row.quantity||0));
    });
    for(const [barcode,addQty] of addByBarcode.entries()){
      const item=itemByBarcode.get(barcode);
      if(!item)continue;
      const nextSold=Number(item.sold_qty||0)+Number(addQty||0);
      await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
        method:"PATCH",
        body:JSON.stringify({
          sold_qty:nextSold,
          difference_qty:getBoothSalesDifference(item,addQty),
          updated_at:new Date().toISOString()
        })
      });
    }
    await sb(`event_sales_imports?event_id=eq.${encodeURIComponent(event.id)}&import_status=eq.pending`,{
      method:"PATCH",
      body:JSON.stringify({
        import_status:"confirmed",
        confirmed_by:staff,
        confirmed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      })
    });
    await loadBoothSalesImports(event.id);
    boothShowSuccess("販売取り込み確定完了","販売数をイベント集計へ反映しました。スマレジ在庫・東京在庫は変更していません。");
  }catch(e){
    boothShowError("販売取り込み確定エラー","販売取り込みの確定に失敗しました。\n"+e.message);
  }
}

async function deleteBoothEvent(eventId){
  eventId=String(eventId||"");
  if(!eventId)return;
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const event=boothEvents.find(row=>String(row.id)===eventId);
  showBoothConfirmPopup("\u30a4\u30d9\u30f3\u30c8\u524a\u9664\u78ba\u8a8d","\u3053\u306e\u30a4\u30d9\u30f3\u30c8\u3092\u524a\u9664\u3057\u307e\u3059\u3002\n\u901a\u5e38\u68da\u30d4\u30c3\u30af\u5206\u3068\u30a4\u30d9\u30f3\u30c8\u4fdd\u7ba1\u5728\u5eab\u6301\u3061\u51fa\u3057\u5206\u306f\u5143\u306b\u623b\u3057\u307e\u3059\u3002\n\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f",async()=>{
    try{
      if(isBoothEventClosed(event)){
        boothShowError("\u30a4\u30d9\u30f3\u30c8\u524a\u9664\u30a8\u30e9\u30fc","\u7de0\u3081\u6e08\u307f\u30a4\u30d9\u30f3\u30c8\u306f\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002");
        return;
      }
      await rollbackBoothEventStocksBeforeDelete(eventId);
      await sb(`event_storage_movements?event_id=eq.${encodeURIComponent(eventId)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});
      await sb(`booth_stock_movements?event_id=eq.${encodeURIComponent(eventId)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});
      await sb(`booth_event_items?event_id=eq.${encodeURIComponent(eventId)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});
      await sb(`booth_events?id=eq.${encodeURIComponent(eventId)}`,{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      if(boothCurrentEventId===eventId)boothCurrentEventId="";
      boothShowSuccess("\u30a4\u30d9\u30f3\u30c8\u524a\u9664\u5b8c\u4e86","\u30a4\u30d9\u30f3\u30c8\u3092\u524a\u9664\u3057\u307e\u3057\u305f\u3002\u30d4\u30c3\u30af\u6e08\u307f\u5728\u5eab\u306f\u623b\u3057\u307e\u3057\u305f\u3002");
      await loadBoothEvents();
    }catch(e){
      if(typeof showMessage==="function")showMessage("\u30a4\u30d9\u30f3\u30c8\u524a\u9664\u30a8\u30e9\u30fc\n"+e.message,"err");
      else showBoothLocalMessage("\u30a4\u30d9\u30f3\u30c8\u524a\u9664\u30a8\u30e9\u30fc\n"+e.message,"err");
    }
  });
}

async function rollbackBoothEventStocksBeforeDelete(eventId){
  const events=await sb(`booth_events?select=id,status&id=eq.${encodeURIComponent(eventId)}&limit=1`).catch(()=>[]);
  const event=Array.isArray(events)&&events[0]?events[0]:boothEvents.find(row=>String(row.id)===String(eventId));
  if(isBoothEventClosed(event))throw new Error("\u7de0\u3081\u6e08\u307f\u30a4\u30d9\u30f3\u30c8\u306f\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002");

  const items=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,normal_takeout_qty,storage_takeout_qty,event_storage_qty,sold_qty&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc`);
  const rows=Array.isArray(items)?items:[];
  if(rows.some(row=>Number(row.sold_qty||0)>0))throw new Error("\u8ca9\u58f2\u53d6\u308a\u8fbc\u307f\u6e08\u307f\u306e\u5546\u54c1\u304c\u3042\u308b\u305f\u3081\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002");
  if(rows.some(row=>String(row.item_type||"")==="gacha_prize"))throw new Error("\u30ac\u30c1\u30e3\u5c65\u6b74\u304c\u3042\u308b\u30a4\u30d9\u30f3\u30c8\u306f\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002");

  const salesImports=await sb(`event_sales_imports?select=id&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed)&limit=1`).catch(()=>[]);
  if(Array.isArray(salesImports)&&salesImports.length)throw new Error("\u8ca9\u58f2\u53d6\u308a\u8fbc\u307f\u5c65\u6b74\u304c\u3042\u308b\u305f\u3081\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002");

  const gachaMovements=await sb(`booth_stock_movements?select=id&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(gacha_pick,gacha_return)&limit=1`).catch(()=>[]);
  if(Array.isArray(gachaMovements)&&gachaMovements.length)throw new Error("\u30ac\u30c1\u30e3\u5c65\u6b74\u304c\u3042\u308b\u30a4\u30d9\u30f3\u30c8\u306f\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3002");

  const storeCode=typeof getBoothCurrentStoreCode==="function"?getBoothCurrentStoreCode():"tokyo";
  for(const item of rows.filter(row=>String(row.item_type||"normal")==="normal")){
    const normalQty=Number(item.normal_takeout_qty||0);
    const storageTakeoutQty=Number(item.storage_takeout_qty||0);
    const eventStorageQty=Number(item.event_storage_qty||0);
    if(normalQty>0&&item.barcode){
      await adjustBoothProductBaseStock(item.barcode,normalQty);
      await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          type:"event_delete_return",
          event_id:eventId,
          staff:"イベント削除",
          barcode:item.barcode,
          product_name:item.product_name||"",
          quantity:normalQty,
          memo:"イベント削除ピック戻し",
          affects_smaregi:false,
          smaregi_delta:0
        })
      });
    }
    const storageDelta=storageTakeoutQty-eventStorageQty;
    if(storageDelta!==0&&item.barcode){
      await upsertBoothEventStorageStock(storeCode,item,storageDelta);
    }
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        taken_qty:0,
        normal_takeout_qty:0,
        storage_takeout_qty:0,
        event_storage_qty:0,
        shelf_return_qty:0,
        returned_qty:0,
        difference_qty:0,
        updated_at:new Date().toISOString()
      })
    });
  }
}
