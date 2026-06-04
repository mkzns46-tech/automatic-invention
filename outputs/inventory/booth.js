/* ARICO TOKYO inventory app: booth.js */

let boothEvents=[];
let boothCurrentEventId="";
let boothFilterFrom="";
let boothFilterTo="";

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
    showBoothLocalMessage("ブースイベントを読み込み中...");
    const events=await sb("booth_events?select=*&order=created_at.desc&limit=200");
    boothEvents=Array.isArray(events)?events:[];
    renderBoothEvents(boothEvents);
    showBoothLocalMessage(boothEvents.length?`イベント ${boothEvents.length}件を表示しています。`:"イベントはまだありません。","ok");
  }catch(e){
    if(typeof showMessage==="function")showMessage("ブースイベント読み込みエラー\n"+e.message,"err");
    else showBoothLocalMessage("ブースイベント読み込みエラー\n"+e.message,"err");
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
    <div class="booth-event-menu" aria-label="イベント内メニュー">
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">持ち出しスキャン</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="history">持ち出し履歴</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">戻り棚卸</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="storage">ブース保管</button>
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
  showBoothLocalMessage("準備中です","ok");
  if(typeof showPopup==="function")showPopup("準備中","準備中です");
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
      if(await boothEventHasWorkLogs(eventId)){
        const errorText="このイベントには作業履歴があるため削除できません。";
        showBoothLocalMessage(errorText,"err");
        if(typeof playErrorSound==="function")playErrorSound();
        if(typeof showPopup==="function")showPopup("イベント削除エラー",errorText);
        return;
      }
      await sb(`booth_events?id=eq.${encodeURIComponent(eventId)}`,{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      if(boothCurrentEventId===eventId)boothCurrentEventId="";
      if(typeof showMessage==="function")showMessage(`イベントを削除しました：${event?.name||eventId}`,"ok");
      await loadBoothEvents();
    }catch(e){
      if(typeof showMessage==="function")showMessage("イベント削除エラー\n"+e.message,"err");
      else showBoothLocalMessage("イベント削除エラー\n"+e.message,"err");
    }
  });
}
