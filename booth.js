/* ARICO TOKYO inventory app: booth.js */

let boothEvents=[];
let boothCurrentEventId="";

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
              <input id="boothEventCreatedBy" list="boothStaffList" autocomplete="off" placeholder="担当者名">
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
        <datalist id="boothStaffList">${(staffMembers||[]).map(staff=>`<option value="${esc(staff.name||"")}"></option>`).join("")}</datalist>
      </section>
      <section class="booth-card booth-list-card">
        <div class="booth-list-header">
          <h3>イベント一覧</h3>
          <button type="button" id="reloadBoothEventsBtn" class="secondary">再読み込み</button>
        </div>
        <div id="boothEventList" class="booth-event-list">
          <div class="booth-empty">読み込み中...</div>
        </div>
      </section>
    </div>`;

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
}

function renderBoothEvents(events){
  const list=el("boothEventList");
  if(!list)return;
  const rows=Array.isArray(events)?events:[];
  if(!rows.length){
    list.innerHTML='<div class="booth-empty">イベントはまだありません。</div>';
    return;
  }
  list.innerHTML=rows.map(event=>{
    const dateText=[event.event_start,event.event_end].filter(Boolean).join(" - ")||"日程未設定";
    return `<article class="booth-event-item ${boothCurrentEventId===event.id?"is-open":""}">
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
      </div>
    </article>`;
  }).join("");

  list.querySelectorAll(".booth-open-event-btn").forEach(button=>{
    button.addEventListener("click",()=>openBoothEvent(button.dataset.eventId));
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
