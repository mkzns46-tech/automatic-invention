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
                <option value="">担当者を選択</option>
                ${(staffMembers||[]).map(staff=>`<option value="${esc(staff.name||"")}">${esc(staff.name||"")}</option>`).join("")}
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
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">持ち出しスキャン</button>
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
  if(menu==="carry-out"){
    renderBoothEventDetail(event);
    return;
  }
  document.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.classList.toggle("is-active",button.dataset.boothMenu===menu);
  });
  if(menu==="return"){
    renderBoothReturnPanel(event);
    return;
  }
  if(menu==="sales"){
    renderBoothSalesPanel(event);
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
  const period=[event?.event_start,event?.event_end].filter(Boolean).join(" ～ ")||"-";
  const body=typeof getSmaregiOperationContextText==="function"
    ? getSmaregiOperationContextText(`イベント名：${event?.name||"-"}\n対象期間：${period}\n\nイベントを締めます。`)
    : `イベント名：${event?.name||"-"}\n対象期間：${period}\n\nイベントを締めます。`;
  const ok=typeof confirmAppAction==="function"
    ? await confirmAppAction("イベント締め確認",body,{okText:"締め"})
    : true;
  if(!ok)return;
  if(typeof showPopup==="function")showPopup("準備中","イベント締めは次フェーズで実装します。");
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
  const staffOptions='<option value="">担当者を選択</option>'+((staffMembers||[]).map(staff=>`<option value="${esc(staff.name||"")}">${esc(staff.name||"")}</option>`).join(""));
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
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">持ち出しスキャン</button>
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
        <h4>持ち出しスキャン</h4>
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
    const rows=await sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff&event_id=eq.${encodeURIComponent(eventId)}&movement_type=eq.take_out&item_type=eq.normal&order=created_at.desc&limit=50`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだ持ち出し履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>担当者</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.quantity??"-")}</td>
        <td>${esc(row.staff||"-")}</td>
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
  const rows=await sb(`booth_event_items?select=id,taken_qty&event_id=eq.${eventId}&barcode=eq.${barcode}&item_type=eq.normal&limit=1`);
  const now=new Date().toISOString();
  if(Array.isArray(rows)&&rows[0]){
    const current=Number(rows[0].taken_qty||0);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(rows[0].id)}`,{
      method:"PATCH",
      body:JSON.stringify({
        product_name:product.name||"",
        taken_qty:current+qty,
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
      updated_at:now
    }])
  });
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

  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){
      boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothCarryOutBarcode");
      return;
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
  const dateText=[event.event_start,event.event_end].filter(Boolean).join(" - ")||"-";
  const staffOptions='<option value="">担当者を選択</option>'+((staffMembers||[]).map(staff=>`<option value="${esc(staff.name||"")}">${esc(staff.name||"")}</option>`).join(""));
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
      </div>`:""}
    <div class="booth-work-menu-title">作業内容を選んでください</div>
    <div class="booth-event-menu" aria-label="イベント内メニュー">
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">持ち出しスキャン</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="gacha">ガチャ管理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="history">持ち出し履歴</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="sales">販売取り込み</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">棚戻し棚卸し</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="storage">イベント保管</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="diff">差異確認</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="close">イベント締め</button>
    </div>
    <div id="boothEventWorkArea" class="booth-work-area">
      <section class="booth-work-card booth-carry-out-card">
        <h4>持ち出しスキャン</h4>
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
          <label>担当者<span class="required">必須</span>
            <select id="boothCarryOutStaff" ${closed?"disabled":""}>${staffOptions}</select>
          </label>
          <button type="button" id="boothCarryOutRegisterBtn" ${closed?"disabled":""}>持ち出し登録</button>
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
  el("boothCarryOutRegisterBtn")?.addEventListener("click",registerBoothCarryOut);
  el("reloadBoothCarryOutHistoryBtn")?.addEventListener("click",()=>loadBoothCarryOutHistory(event.id));
  el("boothStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="carry-out";
    startBoothCarryOutCamera();
  });
  el("boothStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  el("boothCameraZoomRange")?.addEventListener("input",applyBoothCameraZoom);
  el("boothCarryOutBarcode")?.addEventListener("input",clearBoothProductPreview);
  el("boothCsvDownloadBtn")?.addEventListener("click",showBoothReportPreparing);
  el("boothPdfDownloadBtn")?.addEventListener("click",showBoothReportPreparing);
  updateBoothCameraZoomLabel();
  loadBoothCarryOutHistory(event.id);
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
  if(menu==="carry-out"){
    renderBoothEventDetail(event);
    return;
  }
  document.querySelectorAll(".booth-event-menu-btn").forEach(button=>{
    button.classList.toggle("is-active",button.dataset.boothMenu===menu);
  });
  if(menu==="return"){
    renderBoothReturnPanel(event);
    return;
  }
  if(menu==="sales"){
    renderBoothSalesPanel(event);
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
    const rows=await sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff&event_id=eq.${encodeURIComponent(eventId)}&movement_type=eq.take_out&item_type=eq.normal&order=created_at.desc&limit=50`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだ持ち出し履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>担当者</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.quantity??"-")}</td>
        <td>${esc(row.staff||"-")}</td>
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
    preview.hidden=false;
    preview.innerHTML=`<div><span>商品名：</span><strong>${esc(product.name||"-")}</strong></div>
      <div><span>現在の東京在庫：</span><strong>${esc(product.base_stock??0)}</strong></div>
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
  const staffOptions='<option value="">担当者を選択</option>'+((staffMembers||[]).map(staff=>`<option value="${esc(staff.name||"")}">${esc(staff.name||"")}</option>`).join(""));
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
    </section>`;
  el("boothReturnBarcode")?.addEventListener("input",clearBoothReturnPreview);
  el("boothReturnQty")?.addEventListener("input",()=>previewBoothReturnProduct({popupOnError:false}));
  el("boothReturnPreviewBtn")?.addEventListener("click",()=>previewBoothReturnProduct({popupOnError:true}));
  el("boothReturnRegisterBtn")?.addEventListener("click",registerBoothReturn);
  el("reloadBoothReturnHistoryBtn")?.addEventListener("click",()=>loadBoothReturnHistory(event.id));
  el("boothReturnStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="return";
    startBoothCarryOutCamera();
  });
  el("boothReturnStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  loadBoothReturnHistory(event.id);
}

async function handleBoothScannedCode(code){
  code=String(code||"").trim();
  if(!code)return;
  const t=Date.now();
  if(code===boothLastScan&&t-boothLastScanAt<1800)return;
  boothLastScan=code;
  boothLastScanAt=t;
  const input=el(boothScanTarget==="return"?"boothReturnBarcode":"boothCarryOutBarcode");
  if(input)input.value=code;
  await stopBoothCarryOutCamera(false);
  boothCameraSuccess("バーコードを読み取りました。");
  if(boothScanTarget==="return")await previewBoothReturnProduct({popupOnError:false});
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

  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){
      boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothCarryOutBarcode");
      return;
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
    const rows=await sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff&event_id=eq.${encodeURIComponent(eventId)}&movement_type=eq.return&item_type=eq.normal&order=created_at.desc&limit=50`);
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
        <td>${esc(row.quantity??"-")}</td>
        <td>${esc(row.staff||"-")}</td>
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
    const differenceAfterReturn=calculateBoothDifference(item,quantity);
    if(differenceAfterReturn<0){
      boothShowError("棚戻し棚卸しエラー","戻り数量が持ち出し残数を超えています。","boothReturnQty");
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

function getBoothSalesStaffOptions(){
  return '<option value="">担当者を選択</option>'+((staffMembers||[]).map(staff=>`<option value="${esc(staff.name||"")}">${esc(staff.name||"")}</option>`).join(""));
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
  const form=el("eventRegisterSettingsForm");
  if(form&&!form.dataset.bound){
    form.dataset.bound="1";
    form.addEventListener("submit",saveBoothEventRegisterSettings);
  }
  renderBoothEventRegisterSettings();
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

function buildInFilter(values){
  return values.map(value=>String(value||"").replace(/[(),]/g,"")).filter(Boolean).join(",");
}

async function fetchBoothProductsForItems(items){
  const barcodes=[...new Set(items.map(item=>String(item.barcode||"").trim()).filter(Boolean))];
  if(!barcodes.length)return [];
  const rows=await sb(`products?select=barcode,name,smaregi_product_id&barcode=in.(${buildInFilter(barcodes)})`);
  return Array.isArray(rows)?rows:[];
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

    const response=await fetch("/api/smaregi-event-sales",{
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
  showBoothConfirmPopup("イベント削除確認","このイベントを削除します。よろしいですか？",async()=>{
    try{
      if(isBoothEventClosed(event)){
        boothShowError("イベント削除エラー","締め済みイベントは削除できません。");
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
