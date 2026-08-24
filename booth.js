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
let boothReturnDraftEventId="";
let boothReturnDraftDestination="";
let boothReturnDraftDestinationEventId="";
let boothReturnDraftItems=new Map();
let boothReturnSearchRequestId=0;
let boothGachaReturnDraftEventId="";
let boothGachaReturnDraftItems=new Map();

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

async function loadBoothCommonEventShelfStartRows(storeCode,options={}){
  const normalizedStore=normalizeBoothStoreCode(storeCode||getBoothCurrentStoreCode());
  const excludeEventId=String(options.excludeEventId||"").trim();
  if(!normalizedStore)return [];
  const byBarcode=new Map();
  const commonRows=await sb(`event_storage_stocks?select=store_code,barcode,product_name,storage_qty&store_code=eq.${encodeURIComponent(normalizedStore)}&storage_qty=gt.0&order=product_name.asc&limit=5000`);
  (Array.isArray(commonRows)?commonRows:[]).forEach(row=>{
    const barcode=String(row.barcode||"").trim();
    if(!barcode)return;
    const current=byBarcode.get(barcode)||{
      barcode,
      product_name:row.product_name||"",
      quantity:0,
      updated_at:"",
      source:"event_storage_stocks"
    };
    current.quantity+=Number(row.storage_qty||0);
    if(!current.product_name&&row.product_name)current.product_name=row.product_name;
    byBarcode.set(barcode,current);
  });

  const events=await sb(`booth_events?select=id,store_code,status&store_code=eq.${encodeURIComponent(normalizedStore)}&limit=5000`).catch(()=>[]);
  const eventIds=(Array.isArray(events)?events:[])
    .filter(event=>normalizeBoothStoreCode(event?.store_code)===normalizedStore)
    .filter(event=>isBoothEventClosedStatus(event))
    .map(event=>String(event.id||"").trim())
    .filter(id=>!excludeEventId||id!==excludeEventId)
    .filter(Boolean);
  if(eventIds.length){
    const itemRows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,shelf_return_qty,event_storage_qty,return_process_type,updated_at&event_id=in.(${buildInFilter(eventIds)})&item_type=eq.normal&order=updated_at.desc&limit=50000`).catch(()=>[]);
    (Array.isArray(itemRows)?itemRows:[]).forEach(item=>{
      const barcode=String(item.barcode||"").trim();
      if(!barcode||byBarcode.has(barcode))return;
      const quantity=getBoothCommonShelfCurrentQtyFromEventItem(item);
      if(quantity<=0)return;
      byBarcode.set(barcode,{
        barcode,
        product_name:item.product_name||"",
        quantity,
        updated_at:item.updated_at||"",
        source:"booth_event_items"
      });
    });
  }

  const rows=[...byBarcode.values()].filter(row=>Number(row.quantity||0)>0);
  const products=await loadBoothProductsByBarcode(rows.map(row=>row.barcode)).catch(()=>new Map());
  return rows.map(row=>{
    const product=products.get(String(row.barcode||""))||{};
    return {
      ...row,
      product_name:product.name||row.product_name||"",
      quantity:Number(row.quantity||0)
    };
  }).filter(row=>row.barcode&&row.quantity>0);
}

async function loadBoothCurrentEventStorageRows(storeCode,options={}){
  const normalizedStore=normalizeBoothStoreCode(storeCode||getBoothCurrentStoreCode());
  if(!normalizedStore)return [];
  const byBarcode=new Map();
  const selectedEventId=String(options.eventId||"").trim();
  const commonRows=await sb(`event_storage_stocks?select=store_code,barcode,product_name,storage_qty&store_code=eq.${encodeURIComponent(normalizedStore)}&storage_qty=gt.0&order=product_name.asc&limit=5000`);
  (Array.isArray(commonRows)?commonRows:[]).forEach(row=>{
    const barcode=String(row.barcode||"").trim();
    const quantity=Number(row.storage_qty||0);
    if(!barcode||quantity<=0)return;
    const current=byBarcode.get(barcode)||{
      barcode,
      product_name:row.product_name||"",
      quantity:0,
      updated_at:"",
      source:"event_storage_stocks"
    };
    current.quantity+=quantity;
    if(!current.product_name&&row.product_name)current.product_name=row.product_name;
    byBarcode.set(barcode,current);
  });
  const eventRows=await sb(`booth_events?select=id,store_code,status,created_at&store_code=eq.${encodeURIComponent(normalizedStore)}&order=created_at.desc&limit=5000`);
  const events=(Array.isArray(eventRows)?eventRows:[])
    .filter(event=>normalizeBoothStoreCode(event?.store_code)===normalizedStore)
    .filter(event=>String(event?.status||"").toLowerCase()!=="deleted");
  const eventOrderIds=[];
  if(selectedEventId&&events.some(event=>String(event.id||"")===selectedEventId)){
    eventOrderIds.push(selectedEventId);
  }
  events.forEach(event=>{
    const id=String(event.id||"").trim();
    if(id&&!eventOrderIds.includes(id))eventOrderIds.push(id);
  });
  if(eventOrderIds.length){
    const orderMap=new Map(eventOrderIds.map((id,index)=>[id,index]));
    const itemRows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,shelf_return_qty,event_storage_qty,return_process_type,updated_at&event_id=in.(${buildInFilter(eventOrderIds)})&item_type=eq.normal&order=updated_at.desc&limit=50000`);
    const sortedItems=(Array.isArray(itemRows)?itemRows:[]).slice().sort((a,b)=>{
      const orderA=orderMap.has(String(a.event_id||""))?orderMap.get(String(a.event_id||"")):999999;
      const orderB=orderMap.has(String(b.event_id||""))?orderMap.get(String(b.event_id||"")):999999;
      if(orderA!==orderB)return orderA-orderB;
      return new Date(b.updated_at||0).getTime()-new Date(a.updated_at||0).getTime();
    });
    const seenEventBarcodes=new Set();
    sortedItems.forEach(item=>{
      const barcode=String(item.barcode||"").trim();
      if(!barcode||byBarcode.has(barcode)||seenEventBarcodes.has(barcode))return;
      seenEventBarcodes.add(barcode);
      const quantity=getBoothCommonShelfCurrentQtyFromEventItem(item);
      if(quantity<=0)return;
      byBarcode.set(barcode,{
        barcode,
        product_name:item.product_name||"",
        quantity,
        updated_at:item.updated_at||"",
        source:"booth_event_items"
      });
    });
  }
  const rows=[...byBarcode.values()].filter(row=>Number(row.quantity||0)>0);
  const products=await loadBoothProductsByBarcode(rows.map(row=>row.barcode)).catch(()=>new Map());
  return rows.map(row=>{
    const product=products.get(String(row.barcode||""))||{};
    return {
      ...row,
      product_name:product.name||row.product_name||"",
      quantity:Number(row.quantity||0),
      updated_at:row.updated_at||""
    };
  }).filter(row=>row.barcode&&row.quantity>0);
}

async function seedBoothEventStartInventoryFromCommonShelf(event,storeCode){
  const eventId=String(event?.id||"").trim();
  if(!eventId)return {count:0,total:0,skipped:true};
  const existing=await sb(`booth_event_items?select=id,barcode,product_name,taken_qty,normal_takeout_qty,storage_takeout_qty&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&limit=50000`).catch(()=>[]);
  const existingByBarcode=new Map();
  (Array.isArray(existing)?existing:[]).forEach(row=>{
    const barcode=String(row.barcode||"").trim();
    if(barcode&&!existingByBarcode.has(barcode))existingByBarcode.set(barcode,row);
  });
  const rows=await loadBoothCommonEventShelfStartRows(storeCode,{excludeEventId:eventId});
  const rowsToInsert=[];
  rows.forEach(row=>{
    const existingRow=existingByBarcode.get(String(row.barcode||"").trim());
    if(!existingRow){
      rowsToInsert.push(row);
      return;
    }
  });
  if(!rowsToInsert.length)return {count:0,total:0,skipped:false};
  const now=new Date().toISOString();
  const payload=rowsToInsert.map(row=>({
    event_id:eventId,
    barcode:row.barcode,
    product_name:row.product_name||"",
    item_type:"normal",
    taken_qty:row.quantity,
    normal_takeout_qty:0,
    storage_takeout_qty:row.quantity,
    sold_qty:0,
    returned_qty:0,
    consumed_qty:0,
    difference_qty:row.quantity,
    updated_at:now
  }));
  for(let i=0;i<payload.length;i+=500){
    await sb("booth_event_items",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify(payload.slice(i,i+500))
    });
  }
  return {
    count:payload.length,
    total:payload.reduce((sum,row)=>sum+Number(row.taken_qty||0),0),
    skipped:false
  };
}

async function seedBoothEventStartInventoryForOpen(event){
  return {count:0,total:0,skipped:true};
  const eventId=String(event?.id||"").trim();
  if(!eventId||isBoothEventClosed(event))return;
  window.__boothStartInventorySeedInProgress=window.__boothStartInventorySeedInProgress||new Set();
  if(window.__boothStartInventorySeedInProgress.has(eventId))return;
  window.__boothStartInventorySeedInProgress.add(eventId);
  try{
    const result=await seedBoothEventStartInventoryFromCommonShelf(event,event.store_code||getBoothCurrentStoreCode());
    if(result.count>0){
      const text=`共通イベント棚から ${result.count}商品 / ${result.total}個 を今回イベントの開始在庫として反映しました。`;
      showBoothLocalMessage(text,"ok");
      if(typeof showMessage==="function")showMessage(text,"ok");
      await loadBoothEvents();
      renderBoothEventDetail(getBoothCurrentEvent());
    }
  }catch(error){
    console.warn("[booth event start inventory seed on open failed]",error);
    const text=`共通イベント棚の開始在庫反映に失敗しました: ${error?.message||error}`;
    showBoothLocalMessage(text,"warn");
    if(typeof showMessage==="function")showMessage(text,"warn");
  }finally{
    window.__boothStartInventorySeedInProgress.delete(eventId);
  }
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
    let startInventoryResult={count:0,total:0,skipped:false};
    let startInventoryError="";
    try{
      startInventoryResult=await seedBoothEventStartInventoryFromCommonShelf(row,createContext.storeCode);
    }catch(seedError){
      console.warn("[booth event start inventory seed failed]",seedError);
      startInventoryError=seedError?.message||String(seedError||"");
    }
    boothEvents=[row,...boothEvents];
    renderBoothEvents(boothEvents);
    el("boothEventForm")?.reset();
    const successText=`イベントを作成しました：${row.name||name}`;
    const startInventoryText=startInventoryError
      ? `\n共通イベント棚の開始在庫反映に失敗しました: ${startInventoryError}`
      : startInventoryResult.count>0
        ? `\n共通イベント棚から ${startInventoryResult.count}商品 / ${startInventoryResult.total}個 を今回イベントの開始在庫として反映しました。`
        : "\n共通イベント棚の開始在庫はありません。";
    showBoothLocalMessage(successText+startInventoryText,startInventoryError?"warn":"ok");
    if(typeof showMessage==="function")showMessage(successText+startInventoryText,startInventoryError?"warn":"ok");
    if(typeof showPopup==="function")showPopup("イベント作成完了",`イベント名：${row.name||name}\n会場：${row.venue||venue}\n日程：${row.event_start||event_start} - ${row.event_end||event_end}${startInventoryText}`);
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
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">イベント持ち出し登録</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="history">持ち出し履歴</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">戻り在庫処理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="storage">イベント保管</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="gacha">ガチャ管理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="departure-list">持ち出し在庫一覧</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="sales">販売取込</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="diff">差異確認</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="report">イベントレポート</button>
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
  if(menu==="report"){
    renderBoothEventReportPanel(event);
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
  return value==="storage"||value==="shelf"||value==="event"||value==="keep"?value:"";
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
  const value=String(type||"");
  if(value==="storage")return "イベント保管";
  if(value==="event")return "別イベント棚へ移動";
  return "通常棚へ戻す";
}

function getBoothCommonShelfCurrentQtyFromEventItem(item){
  const taken=Number(item?.taken_qty||0);
  const sold=Number(item?.sold_qty||0);
  const processType=getBoothCloseReturnProcessType(item);
  const returned=Number(item?.returned_qty||0);
  const keepsOnCommonShelf=processType==="storage"||processType==="event"||processType==="keep";
  if(keepsOnCommonShelf&&returned>0){
    return Math.max(0,returned);
  }
  const shelfReturn=keepsOnCommonShelf
    ? 0
    : Number(item?.shelf_return_qty||0)>0
      ? Number(item.shelf_return_qty||0)
      : returned;
  // Gacha is an independent stock flow and never changes common event shelf.
  return Math.max(0,taken-sold-shelfReturn);
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

function mergeBoothCloseRows(normalItems,gachaItems,products,salesRows=[]){
  const productMap=new Map((products||[]).map(product=>[String(product.barcode||""),product]));
  const salesByBarcode=new Map();
  (Array.isArray(salesRows)?salesRows:[]).forEach(sale=>{
    if(isBoothGachaSaleRow(sale))return;
    const barcode=String(sale?.barcode||"").trim();
    if(!barcode)return;
    salesByBarcode.set(barcode,(salesByBarcode.get(barcode)||0)+Number(sale?.quantity||0));
  });
  const rowsByBarcode=new Map();
  (normalItems||[]).forEach(item=>{
    const barcode=String(item.barcode||"");
    const product=productMap.get(barcode)||{};
    const soldQty=salesByBarcode.has(barcode)
      ? salesByBarcode.get(barcode)
      : Number(item.sold_qty||0);
    rowsByBarcode.set(barcode,{
      id:item.id,
      event_id:item.event_id,
      item_type:"normal",
      barcode,
      product_name:item.product_name||product.name||"",
      product_id:product.id||"",
      smaregi_product_id:product.smaregi_product_id||"",
      normal_takeout_qty:Number(item.normal_takeout_qty||0),
      storage_takeout_qty:Number(item.storage_takeout_qty||0),
      taken_qty:Number(item.taken_qty||0),
      sold_qty:soldQty,
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
      difference_qty:calculateBoothItemDifference({...item,sold_qty:soldQty}),
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
      item_type:"gacha_prize",
      barcode,
      product_name:item.product_name||product.name||"",
      product_id:product.id||"",
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
  const [normalItems,gachaItems,salesRows]=await Promise.all([
    sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,shelf_return_qty,event_storage_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,shelf_return_reflected_by,return_process_type,return_reflected,return_reflected_qty,return_reflected_at,return_reflected_by,updated_at&event_id=eq.${eventId}&item_type=eq.normal&order=product_name.asc`),
    sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,returned_qty,consumed_qty,difference_qty,updated_at&event_id=eq.${eventId}&item_type=eq.gacha_prize&order=product_name.asc`),
    // Event close uses the same event-scoped sales details as the report.
    // A failed read must not be treated as zero sales.
    sb(`event_sales_imports?select=*&event_id=eq.${eventId}&import_status=in.(pending,confirmed)&order=sold_at.asc&limit=3000`)
  ]);
  const products=await fetchBoothProductsForItems([...(normalItems||[]),...(gachaItems||[])]);
  const rows=mergeBoothCloseRows(
    normalItems||[],
    gachaItems||[],
    products||[],
    dedupeBoothSalesRows(salesRows||[])
  );
  const diffRows=rows.filter(row=>Number(row.difference_qty||0)!==0);
  const unconfirmedRows=diffRows.filter(row=>!String(row.diff_memo||"").trim());
  const returnPendingRows=rows.filter(row=>row.item_type==="normal"&&getBoothReturnReflectDelta(row)!==0);
  const unprocessedReturnRows=rows.filter(row=>row.item_type==="normal"&&Number(row.returned_qty||0)>0&&!getBoothReturnProcessType(row));
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

function renderLegacyBoothCloseConfirmPanel(event,summary){
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

async function confirmLegacyBoothEventClose(event){
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
    }else if(processType!=="event"){
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
    if(qty>0&&item.barcode&&processType==="storage"&&false){
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
    }else if(qty>0&&item.barcode&&processType!=="storage"){
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
    <div class="booth-confirm-actions app-popup-footer">
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

async function buildBoothEventReportData(eventId){
  const [items,imports,movements,diffRows]=await Promise.all([
    sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,event_storage_qty,shelf_return_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc&limit=3000`).catch(()=>[]),
    sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed)&order=sold_at.asc&limit=3000`).catch(()=>[]),
    sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,memo,movement_type,item_type&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(departure_count,return,gacha_pick,gacha_return,event_close_return)&order=created_at.desc&limit=3000`).catch(()=>[]),
    buildBoothDiffUniverseRows(eventId).catch(()=>[])
  ]);
  const rows=Array.isArray(items)?items:[];
  const normal=rows.filter(row=>String(row.item_type||"normal")==="normal");
  const gacha=rows.filter(row=>String(row.item_type||"")==="gacha_prize");
  const salesRows=dedupeBoothSalesRows(imports);
  const normalSales=salesRows.filter(row=>!isBoothGachaSaleRow(row));
  const gachaSales=salesRows.filter(isBoothGachaSaleRow);
  return {
    normal,
    gacha,
    salesRows,
    normalSales,
    gachaSales,
    movements:Array.isArray(movements)?movements:[],
    diffRows:Array.isArray(diffRows)?diffRows:[],
    totals:{
      normalSalesQty:normalSales.reduce((sum,row)=>sum+Number(row.quantity||0),0),
      gachaSalesQty:gachaSales.reduce((sum,row)=>sum+Number(row.quantity||0),0),
      gachaRegistered:gacha.reduce((sum,row)=>sum+Number(row.taken_qty||0),0),
      gachaUsed:gacha.reduce((sum,row)=>sum+Number(boothGachaUsedQty(row)||0),0),
      start:normal.reduce((sum,row)=>sum+Number(row.taken_qty||0),0),
      diffCount:(Array.isArray(diffRows)?diffRows:[]).filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered).length
    }
  };
}

async function renderBoothEventReportPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-event-report-card">
    <div class="booth-list-header">
      <div>
        <h4>イベントレポート</h4>
        <p class="section-note">売上実績、ガチャ実績、商品別販売、景品使用、在庫差異を確認します。持ち出し未登録の商品でもスマレジAPI売上は表示します。</p>
      </div>
      <div class="button-row booth-export-buttons">
        <button type="button" id="boothEventReportCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothEventReportPdfBtn" class="secondary">PDF出力</button>
        <button type="button" id="boothEventReportReloadBtn" class="secondary">再読み込み</button>
      </div>
    </div>
    <div id="boothEventReportBody" class="booth-event-report-body"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  el("boothEventReportReloadBtn")?.addEventListener("click",()=>loadBoothEventReport(event.id));
  el("boothEventReportCsvBtn")?.addEventListener("click",()=>exportBoothEventReportCsv(event));
  el("boothEventReportPdfBtn")?.addEventListener("click",()=>exportBoothEventReportPdf(event));
  loadBoothEventReport(event.id);
}

async function loadBoothEventReport(eventId){
  const body=el("boothEventReportBody");
  if(!body)return;
  try{
    body.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothEventReportData(eventId);
    body.innerHTML=`
      <div class="booth-report-summary-grid">
        <div><span>持ち出し確定数</span><strong>${esc(data.totals.start)}</strong></div>
        <div><span>通常売上数</span><strong>${esc(data.totals.normalSalesQty)}</strong></div>
        <div><span>ガチャ売上数</span><strong>${esc(data.totals.gachaSalesQty)}</strong></div>
      <div><span>ガチャ持ち出し / 確定使用</span><strong>${esc(data.totals.gachaRegistered)} / ${esc(data.totals.gachaUsedConfirmed?data.totals.gachaUsed:"未確定")}</strong></div>
        <div><span>在庫差異件数</span><strong>${esc(data.totals.diffCount)}</strong></div>
      </div>
      <section class="booth-report-section"><h5>通常売上集計</h5>${renderBoothReportSalesSummary(data.normalSales)}</section>
      <section class="booth-report-section"><h5>ガチャ売上集計</h5>${renderBoothReportSalesSummary(data.gachaSales)}</section>
      <section class="booth-report-section"><h5>商品別販売実績</h5>${renderBoothReportSalesRows(data.salesRows)}</section>
      <section class="booth-report-section"><h5>ガチャ景品実績</h5>${renderBoothReportGachaItems(data.gacha)}</section>
      <section class="booth-report-section"><h5>在庫差異</h5>${renderBoothReportDiffRows(data.diffRows)}</section>`;
  }catch(e){
    body.innerHTML='<div class="booth-empty">イベントレポートを読み込めませんでした。</div>';
    boothShowError("イベントレポートエラー","イベントレポートの読み込みに失敗しました。\n"+e.message);
  }
}

async function renderBoothEventReportPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-event-report-card">
    <div class="booth-list-header">
      <div>
        <h4>イベントレポート</h4>
        <p class="section-note">売上実績、ガチャ実績、商品別販売、景品使用、在庫差異を確認します。持ち出し未登録の商品でもスマレジAPI売上は表示します。</p>
      </div>
      <div class="button-row booth-export-buttons">
        <button type="button" id="boothEventReportCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothEventReportPdfBtn" class="secondary">PDF出力</button>
        <button type="button" id="boothEventReportReloadBtn" class="secondary">再読み込み</button>
      </div>
    </div>
    <div id="boothEventReportBody" class="booth-event-report-body"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  el("boothEventReportReloadBtn")?.addEventListener("click",()=>loadBoothEventReport(event.id));
  el("boothEventReportCsvBtn")?.addEventListener("click",()=>exportBoothEventReportCsv(event));
  el("boothEventReportPdfBtn")?.addEventListener("click",()=>exportBoothEventReportPdf(event));
  loadBoothEventReport(event.id);
}

async function loadBoothEventReport(eventId){
  const body=el("boothEventReportBody");
  if(!body)return;
  try{
    body.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothEventReportData(eventId);
    body.innerHTML=`
      <div class="booth-report-summary-grid">
        <div><span>持ち出し確定数</span><strong>${esc(data.totals.start)}</strong></div>
        <div><span>通常売上数</span><strong>${esc(data.totals.normalSalesQty)}</strong></div>
        <div><span>ガチャ売上数</span><strong>${esc(data.totals.gachaSalesQty)}</strong></div>
      <div><span>ガチャ持ち出し / 確定使用</span><strong>${esc(data.totals.gachaRegistered)} / ${esc(data.totals.gachaUsedConfirmed?data.totals.gachaUsed:"未確定")}</strong></div>
        <div><span>在庫差異件数</span><strong>${esc(data.totals.diffCount)}</strong></div>
      </div>
      <section class="booth-report-section"><h5>通常売上集計</h5>${renderBoothReportSalesSummary(data.normalSales)}</section>
      <section class="booth-report-section"><h5>ガチャ売上集計</h5>${renderBoothReportSalesSummary(data.gachaSales)}</section>
      <section class="booth-report-section"><h5>商品別販売実績</h5>${renderBoothReportSalesRows(data.salesRows)}</section>
      <section class="booth-report-section"><h5>ガチャ景品実績</h5>${renderBoothReportGachaItems(data.gacha)}</section>
      <section class="booth-report-section"><h5>在庫差異</h5>${renderBoothReportDiffRows(data.diffRows)}</section>`;
  }catch(e){
    body.innerHTML='<div class="booth-empty">イベントレポートを読み込めませんでした。</div>';
    boothShowError("イベントレポートエラー","イベントレポートの読み込みに失敗しました。\n"+e.message);
  }
}

function renderBoothReportSalesSummary(rows){
  const list=Array.isArray(rows)?rows:[];
  if(!list.length)return '<div class="booth-empty">対象売上はありません。</div>';
  const qty=list.reduce((sum,row)=>sum+Number(row.quantity||0),0);
  return `<div class="booth-report-mini-summary"><div><span>明細数</span><strong>${esc(list.length)}</strong></div><div><span>販売数</span><strong>${esc(qty)}</strong></div></div>`;
}

function renderBoothReportDiffRows(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
  if(!list.length)return '<div class="booth-empty">在庫差異はありません。</div>';
  return `<div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table">
    <thead><tr><th>商品名</th><th>バーコード</th><th>比較店舗</th><th>持ち出し</th><th>販売</th><th>戻り</th><th>消費</th><th>差異</th><th>状態</th></tr></thead>
    <tbody>${list.map(row=>`<tr><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.store_code||"-")}</td><td>${row.taken_registered?esc(row.taken_qty??0):"未登録"}</td><td>${esc(row.sold_qty??0)}</td><td>${esc(row.returned_qty??0)}</td><td>${esc(row.consumed_qty??0)}</td><td><strong>${esc(calculateBoothItemDifference(row))}</strong></td><td>${row.taken_registered?"要確認":"持ち出し未登録"}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

async function exportBoothEventReportCsv(event){
  try{
    const data=await buildBoothEventReportData(event.id);
    const diffRows=data.diffRows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
    const rows=[
      ["イベント概要"],
      ["イベント名",event?.name||""],
      ["会場",event?.venue||""],
      ["開始日",event?.event_start||""],
      ["終了日",event?.event_end||""],
      [],
      ["通常売上集計"],
      ["明細数","販売数"],
      [data.normalSales.length,data.totals.normalSalesQty],
      [],
      ["ガチャ売上集計"],
      ["明細数","販売数"],
      [data.gachaSales.length,data.totals.gachaSalesQty],
      [],
      ["商品別販売実績"],
      ["販売日時","商品名","バーコード","数量","対象レジ","状態"],
      ...data.salesRows.map(row=>[formatBoothDateTime(row.sold_at),row.product_name||"",row.barcode||"",row.quantity??0,row.target_register_name||"",row.import_status||""]),
      [],
      ["ガチャ景品実績"],
      ["商品名","バーコード","ガチャ持ち出し数","ガチャ使用数","ガチャ戻し数","現在ガチャ残数"],
      ...data.gacha.map(row=>[row.product_name||"",row.barcode||"",row.taken_qty??0,row.consumed_qty??0,row.returned_qty??0,boothGachaItemCurrentQty(row)]),
      [],
      ["在庫差異"],
      ["商品名","バーコード","比較店舗","持ち出し","販売","戻り","消費","差異","状態"],
      ...diffRows.map(row=>[row.product_name||"",row.barcode||"",row.store_code||"",row.taken_registered?row.taken_qty:"未登録",row.sold_qty??0,row.returned_qty??0,row.consumed_qty??0,calculateBoothItemDifference(row),row.taken_registered?"要確認":"持ち出し未登録"])
    ];
    downloadBoothCsvFile(`${boothEventExportBaseName(event,"イベントレポート")}.csv`,rows);
  }catch(e){
    boothShowError("CSV出力エラー","イベントレポートCSVの出力に失敗しました。\n"+e.message);
  }
}

async function exportBoothEventReportPdf(event){
  try{
    const data=await buildBoothEventReportData(event.id);
    const diffRows=data.diffRows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
    const html=`<h1>イベントレポート</h1>
      <div class="meta">
        <strong>イベント</strong><span>${esc(event?.name||"-")}</span>
        <strong>会場</strong><span>${esc(event?.venue||"-")}</span>
        <strong>期間</strong><span>${esc([event?.event_start,event?.event_end].filter(Boolean).join(" - ")||"-")}</span>
        <strong>出力日時</strong><span>${esc(new Date().toLocaleString("ja-JP"))}</span>
      </div>
      <div class="summary">
        <div><strong>通常売上</strong><br>${esc(data.totals.normalSalesQty)}</div>
        <div><strong>ガチャ売上</strong><br>${esc(data.totals.gachaSalesQty)}</div>
        <div><strong>ガチャ使用</strong><br>${esc(data.totals.gachaUsed)}</div>
        <div><strong>差異件数</strong><br>${esc(data.totals.diffCount)}</div>
      </div>
      ${boothPdfTable("商品別販売実績",["販売日時","商品名","バーコード","数量","対象レジ","状態"],data.salesRows.map(row=>[formatBoothDateTime(row.sold_at),row.product_name||"",row.barcode||"",row.quantity??0,row.target_register_name||"",row.import_status||""]))}
      ${boothPdfTable("ガチャ景品実績",["商品名","バーコード","ガチャ持ち出し数","ガチャ使用数","ガチャ戻し数","現在ガチャ残数"],data.gacha.map(row=>[row.product_name||"",row.barcode||"",row.taken_qty??0,row.consumed_qty??0,row.returned_qty??0,boothGachaItemCurrentQty(row)]))}
      ${boothPdfTable("在庫差異",["商品名","バーコード","比較店舗","持ち出し","販売","戻り","消費","差異","状態"],diffRows.map(row=>[row.product_name||"",row.barcode||"",row.store_code||"",row.taken_registered?row.taken_qty:"未登録",row.sold_qty??0,row.returned_qty??0,row.consumed_qty??0,calculateBoothItemDifference(row),row.taken_registered?"要確認":"持ち出し未登録"]))}`;
    if(openBoothPdfWindow("イベントレポート",html))boothShowSuccess("PDF出力","イベントレポートPDFの印刷画面を開きました。");
  }catch(e){
    boothShowError("PDF出力エラー","イベントレポートPDFの出力に失敗しました。\n"+e.message);
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
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">イベント持ち出し登録</button>
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
        <h4>イベント持ち出し登録</h4>
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
  const returned=boothGachaReturnActualQty(item);
  if(returned===null)return Math.max(0,Number(item?.taken_qty||0));
  return Math.max(0,returned);
}

function isBoothGachaReturnCounted(item){
  return String(item?.diff_memo||"").includes("ガチャ戻りカウント");
}

function boothGachaReturnActualQty(item){
  return isBoothGachaReturnCounted(item) ? Number(item?.returned_qty||0) : null;
}

function boothGachaUsedQty(item){
  const returned=boothGachaReturnActualQty(item);
  if(returned===null)return null;
  return Math.max(0,Number(item?.taken_qty||0)-returned);
}

function boothGachaDisplayQty(value,emptyLabel="未確定"){
  return value===null||value===undefined ? emptyLabel : String(value);
}

function boothGachaSmaregiAdjustmentQty(log){
  const delta=Number(log?.smaregi_delta);
  if(Number.isFinite(delta)&&delta!==0)return delta;
  const match=String(log?.memo||"").match(/使用数\s*[:：]?\s*(-?\d+)/);
  return match ? -Math.abs(Number(match[1]||0)) : 0;
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
  const rows=await sb(`products?select=barcode,name,location,category,genre,department,smaregi_product_id,price&barcode=in.(${inList})&limit=1000`).catch(()=>[]);
  return new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row.barcode||""),row]));
}

function boothCsvValue(value){
  return `"${String(value??"").replaceAll('"','""')}"`;
}

function downloadBoothCsvFile(filename,rows){
  if(typeof downloadCsvFile==="function"){
    downloadCsvFile(filename,rows);
    return;
  }
  const csv=(rows||[]).map(row=>(row||[]).map(boothCsvValue).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{try{document.body.removeChild(a);}catch(_){} URL.revokeObjectURL(url);},1000);
}

function boothSafeExportName(value){
  return String(value||"event").replace(/[\\/:*?"<>|]/g,"_").slice(0,80)||"event";
}

function boothTodayYmd(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

function boothDateToYmd(value){
  const text=String(value||"").trim();
  const match=text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(match)return `${match[1]}${match[2]}${match[3]}`;
  const d=new Date(text);
  if(!Number.isNaN(d.getTime()))return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  return boothTodayYmd();
}

function boothEventExportBaseName(event,suffix){
  const start=boothDateToYmd(event?.event_start);
  const end=boothDateToYmd(event?.event_end||event?.event_start);
  return `${start}～${end}${boothSafeExportName(event?.name||"イベント")}${suffix}`;
}

function boothPdfTable(title,headers,rows){
  const body=(rows||[]).length
    ? rows.map(row=>`<tr>${row.map(value=>`<td>${esc(value)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">対象データはありません。</td></tr>`;
  return `<section class="pdf-section"><h2>${esc(title)}</h2><table><thead><tr>${headers.map(header=>`<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function openBoothPdfWindow(title,htmlBody){
  const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
    <title>${esc(title)}</title>
    <style>
      @page{size:A4 landscape;margin:10mm}
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#12372a;margin:0;font-size:11px}
      h1{font-size:18px;margin:0 0 10px}
      h2{font-size:14px;margin:14px 0 6px;border-bottom:2px solid #2d6a4f;padding-bottom:4px}
      .meta{display:grid;grid-template-columns:110px 1fr 110px 1fr;gap:5px 10px;margin:8px 0 12px}
      table{width:100%;border-collapse:collapse;margin:0 0 12px;page-break-inside:auto}
      thead{display:table-header-group}
      tr{page-break-inside:avoid;page-break-after:auto}
      th,td{border:1px solid #b9d9c6;padding:5px 6px;text-align:left;vertical-align:top;word-break:break-word}
      th{background:#dff2e5;font-weight:800}
      .pdf-section{page-break-inside:auto}
      .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0 12px}
      .summary div{border:1px solid #b9d9c6;border-radius:8px;padding:7px;background:#f7fcf8}
    </style></head><body>${htmlBody}<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));</script></body></html>`;
  const win=window.open("","_blank");
  if(!win){
    boothShowError("PDF出力エラー","PDF出力用の画面を開けませんでした。ポップアップブロックを確認してください。");
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
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
  const items=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.normal&order=product_name.asc&limit=2000`);
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
      updated_at:item.updated_at||"",
      eventShelfQty:0
    };
    row.eventShelfQty+=boothEventItemCurrentQty(item);
    map.set(barcode,row);
  });
  return [...map.values()].filter(row=>row.eventShelfQty!==0);
}

async function renderBoothEventInventoryPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-event-inventory-card">
    <div class="booth-list-header">
      <div>
        <h4>イベント持ち出し登録</h4>
        <p class="section-note">今回イベントへ実際に持っていく商品をスキャン・カウントし、持ち出し在庫として確定します。</p>
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
  </section>
  <section class="booth-work-card booth-departure-count-card">
    <div class="booth-list-header">
      <div>
        <h4>イベント持ち出し登録</h4>
        <p class="section-note">イベント棚全体をスキャンして、開始時確定在庫として保存します。通常在庫とスマレジ在庫は変更しません。</p>
      </div>
    </div>
    <div class="booth-scan-row">
      <label>バーコード
        <input id="boothDepartureBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードをスキャン、または手入力">
      </label>
      <label>数量
        <input id="boothDepartureQty" type="number" min="1" step="1" value="1">
      </label>
      <label>担当者<span class="required">必須</span>
        <select id="boothDepartureStaff">${getBoothSalesStaffOptions()}</select>
      </label>
      <button type="button" id="boothDepartureCameraBtn" class="secondary">カメラ</button>
      <button type="button" id="boothDepartureAddBtn">カウント追加</button>
      <button type="button" id="boothDepartureCompleteBtn" class="secondary">持ち出しを確定</button>
    </div>
    <div id="boothDepartureCountList" class="booth-carry-history-list"><div class="booth-empty">まだカウントはありません。</div></div>
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
        listEl.innerHTML='<div class="booth-empty">イベント関連在庫はありません。下の棚卸欄から商品をスキャンして持ち出し在庫を確定できます。</div>';
        return;
      }
      listEl.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-event-inventory-table">
        <thead><tr><th>商品情報</th><th>現在イベント棚在庫</th></tr></thead>
        <tbody>${rows.map(row=>`<tr>
          <td>${boothProductIdentityBlock(row)}</td>
          <td>${esc(row.eventShelfQty)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="booth-history-cards">
        ${rows.map(row=>`<article class="booth-history-card">
          ${boothProductIdentityBlock(row)}
          <div class="booth-history-card-meta">
            <span>イベント棚在庫：${esc(row.eventShelfQty)}</span>
          </div>
        </article>`).join("")}
      </div>`;
    }catch(e){
      listEl.innerHTML='<div class="booth-empty">イベント持ち出し登録を読み込めませんでした。</div>';
      boothShowError("イベント持ち出し登録エラー","イベント持ち出し登録の読み込みに失敗しました。\n"+e.message);
    }
  };
  el("boothEventInventorySearch")?.addEventListener("input",draw);
  el("boothEventInventorySort")?.addEventListener("change",draw);
  el("boothEventInventoryReloadBtn")?.addEventListener("click",draw);
  el("boothDepartureAddBtn")?.addEventListener("click",addBoothDepartureCountFromInput);
  el("boothDepartureCompleteBtn")?.addEventListener("click",completeBoothDepartureCount);
  el("boothDepartureCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="departure-count";
    startBoothCarryOutCamera();
  });
  el("boothDepartureBarcode")?.addEventListener("keydown",event=>{
    if(event.key==="Enter"){
      event.preventDefault();
      addBoothDepartureCountFromInput();
    }
  });
  draw();
  renderBoothDepartureCountList(event.id);
}

function getBoothDepartureCountStorageKey(eventId){
  return `arico_booth_departure_count_${eventId}`;
}

function readBoothDepartureCounts(eventId){
  try{
    const raw=localStorage.getItem(getBoothDepartureCountStorageKey(eventId));
    const data=raw?JSON.parse(raw):{};
    return data&&typeof data==="object"?data:{};
  }catch(_){
    return {};
  }
}

function writeBoothDepartureCounts(eventId,data){
  localStorage.setItem(getBoothDepartureCountStorageKey(eventId),JSON.stringify(data||{}));
}

async function addBoothDepartureCountFromInput(){
  const event=getBoothCurrentEvent();
  if(!event)return;
  const barcode=String(el("boothDepartureBarcode")?.value||"").trim();
  const qtyText=String(el("boothDepartureQty")?.value||"1").trim()||"1";
  if(!barcode){
    boothShowError("イベント持ち出し登録エラー","バーコードを入力してください。","boothDepartureBarcode");
    return;
  }
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("イベント持ち出し登録エラー","数量は1以上の整数で入力してください。","boothDepartureQty");
    return;
  }
  const product=await findBoothProductByBarcode(barcode);
  if(!product){
    boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothDepartureBarcode");
    return;
  }
  const counts=readBoothDepartureCounts(event.id);
  const current=counts[barcode]||{barcode,product_name:product.name||"",quantity:0};
  current.product_name=product.name||current.product_name||"";
  current.quantity=Number(current.quantity||0)+Number(qtyText);
  counts[barcode]=current;
  writeBoothDepartureCounts(event.id,counts);
  if(el("boothDepartureBarcode"))el("boothDepartureBarcode").value="";
  if(el("boothDepartureQty"))el("boothDepartureQty").value="1";
  await renderBoothDepartureCountList(event.id);
  boothShowSuccess("イベント持ち出し登録","入力に追加しました。確定するまで在庫は変わりません。");
  el("boothDepartureBarcode")?.focus();
}

async function renderBoothDepartureCountList(eventId){
  const list=el("boothDepartureCountList");
  if(!list)return;
  const counts=Object.values(readBoothDepartureCounts(eventId));
  if(!counts.length){
    list.innerHTML='<div class="booth-empty">まだカウントはありません。</div>';
    return;
  }
  const items=await fetchBoothEventItems(eventId).catch(()=>[]);
  const itemMap=new Map((Array.isArray(items)?items:[]).map(item=>[String(item.barcode||""),item]));
  list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
    <thead><tr><th>商品名</th><th>バーコード</th><th>イベント棚理論数</th><th>実カウント</th><th>差異</th></tr></thead>
    <tbody>${counts.map(row=>{
      const item=itemMap.get(String(row.barcode||""))||{};
      const theory=boothEventItemCurrentQty(item);
      const count=Number(row.quantity||0);
      return `<tr><td>${esc(row.product_name||item.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(theory)}</td><td><strong>${esc(count)}</strong></td><td>${esc(count-theory)}</td></tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

async function completeBoothDepartureCount(){
  const event=getBoothCurrentEvent();
  if(!event)return;
  if(isBoothEventClosed(event)){
    showBoothClosedError();
    return;
  }
  const staff=String(el("boothDepartureStaff")?.value||"").trim();
  if(!staff){
    boothShowError("イベント持ち出し登録エラー","担当者を選択してください。","boothDepartureStaff");
    return;
  }
  if(!validateBoothStaffStore(staff,"担当者確認エラー","boothDepartureStaff"))return;
  const counts=Object.values(readBoothDepartureCounts(event.id));
  if(!counts.length){
    boothShowError("イベント持ち出し登録エラー","確定する商品がありません。");
    return;
  }
  const ok=typeof confirmAppAction==="function"
    ? await confirmAppAction("イベント持ち出し確定",`${counts.length} 商品の持ち出しを確定します。`,{okText:"確定"})
    : true;
  if(!ok)return;
  try{
    const items=await fetchBoothEventItems(event.id);
    const itemMap=new Map((Array.isArray(items)?items:[])
      .filter(item=>String(item.item_type||"normal")==="normal")
      .map(item=>[String(item.barcode||""),item]));
    const now=new Date().toISOString();
    for(const row of counts){
      const barcode=String(row.barcode||"");
      const count=Number(row.quantity||0);
      const item=itemMap.get(barcode);
      const theory=item?boothEventItemCurrentQty(item):0;
      const confirmedSalesQty=await getConfirmedBoothSalesQty(event.id,barcode);
      if(item){
        await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({
            taken_qty:count,
            sold_qty:confirmedSalesQty,
            difference_qty:count-confirmedSalesQty-Number(item.returned_qty||0)-Number(item.consumed_qty||0),
            updated_at:now
          })
        });
      }else{
        await sb("booth_event_items",{
          method:"POST",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify([{
            event_id:event.id,
            barcode,
            product_name:row.product_name||"",
            item_type:"normal",
            taken_qty:count,
            normal_takeout_qty:count,
            storage_takeout_qty:0,
            sold_qty:confirmedSalesQty,
            returned_qty:0,
            consumed_qty:0,
            difference_qty:count-confirmedSalesQty,
            updated_at:now
          }])
        });
      }
      await sb("booth_stock_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([{
          event_id:event.id,
          barcode,
          product_name:row.product_name||item?.product_name||"",
          item_type:"normal",
          movement_type:"departure_count",
          quantity:count,
          staff,
          memo:`theory=${theory}; actual=${count}`,
          affects_smaregi:false,
          smaregi_delta:0
        }])
      }).catch(()=>{});
    }
    localStorage.removeItem(getBoothDepartureCountStorageKey(event.id));
    boothShowSuccess("イベント持ち出し確定","持ち出しを確定しました。");
    await renderBoothEventInventoryPanel(event);
  }catch(e){
    boothShowError("イベント持ち出し確定エラー","持ち出しの確定に失敗しました。\n"+e.message);
  }
}

/* Ver 2.73: event take-out is a draft until the operator confirms it. */
async function searchBoothDepartureProducts(query){
  const term=String(query||"").trim();
  if(!term)return [];
  const safeTerm=term.replace(/[(),*]/g," ").trim();
  if(!safeTerm)return [];
  const pattern=encodeURIComponent(`*${safeTerm}*`);
  const select="barcode,name,base_stock,smaregi_product_id";
  const [nameRows,barcodeRows]=await Promise.all([
    sb(`products?select=${select}&name=ilike.${pattern}&limit=20`).catch(()=>[]),
    sb(`products?select=${select}&barcode=ilike.${pattern}&limit=20`).catch(()=>[])
  ]);
  const map=new Map();
  [...(Array.isArray(nameRows)?nameRows:[]),...(Array.isArray(barcodeRows)?barcodeRows:[])].forEach(product=>{
    const barcode=String(product?.barcode||"").trim();
    if(barcode&&!map.has(barcode))map.set(barcode,product);
  });
  return [...map.values()].slice(0,30);
}

function isBoothDepartureGachaProduct(product){
  return BOOTH_GACHA_SMAREGI_PRODUCT_IDS.has(String(product?.smaregi_product_id||"").trim());
}

async function renderBoothEventInventoryPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  area.innerHTML=`<section class="booth-work-card booth-carry-out-card">
    <div class="booth-list-header">
      <div>
        <h4>イベント持ち出し登録</h4>
        <p class="section-note">イベントへ持ち出す通常商品を入力します。入力中は下書きとして保持し、確定時に通常棚から共通イベント棚へ移動します。</p>
      </div>
      <span id="boothDepartureSummary" class="inventory-count-pill">0商品 / 0個</span>
    </div>
    <div class="booth-return-product-search">
      <label class="booth-return-product-search-label">商品名検索
        <input id="boothDepartureSearch" autocomplete="off" placeholder="商品名・バーコードで検索" ${closed?"disabled":""}>
      </label>
      <div id="boothDepartureSearchResults" class="booth-return-product-search-results" hidden></div>
    </div>
    <div class="button-row booth-camera-button-row">
      <button type="button" id="boothDepartureCameraBtn" ${closed?"disabled":""}>カメラ読取</button>
      <button type="button" id="boothDepartureStopCameraBtn" class="secondary">停止</button>
    </div>
    <div class="camera-area booth-camera-area">
      <video id="boothCarryOutVideo" muted playsinline></video>
      <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
        <div class="camera-guide-box"><div class="camera-guide-line"></div></div>
        <div class="camera-guide-text">赤線にバーコードを合わせてください</div>
      </div>
    </div>
    <div class="booth-scan-row">
      <label>バーコード
        <input id="boothDepartureBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力してEnter" ${closed?"disabled":""}>
      </label>
      <label>数量
        <input id="boothDepartureQty" type="number" min="1" step="1" value="1" ${closed?"disabled":""}>
      </label>
      <button type="button" id="boothDepartureAddBtn" ${closed?"disabled":""}>入力に追加</button>
    </div>
    <div class="booth-return-common-fields">
      <label>担当者<span class="required">必須</span><select id="boothDepartureStaff" ${closed?"disabled":""}>${getBoothSalesStaffOptions()}</select></label>
      <label>メモ<input id="boothDepartureMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}></label>
    </div>
    <div id="boothDepartureCountList" class="booth-return-draft-list"><div class="booth-empty">バーコードを読み取ると、ここに持ち出し対象商品が追加されます。</div></div>
    <button type="button" id="boothDepartureCompleteBtn" class="booth-return-apply-btn" ${closed?"disabled":""}>持ち出しを確定</button>
  </section>
  <section class="booth-work-card booth-carry-history-card">
    <div class="booth-list-header">
      <h4>確定済み持ち出し履歴</h4>
      <button type="button" id="reloadBoothCarryOutHistoryBtn" class="secondary">再読み込み</button>
    </div>
    <div id="boothCarryOutHistoryList" class="booth-carry-history-list"><div class="booth-empty">読み込み中...</div></div>
  </section>`;

  const searchInput=el("boothDepartureSearch");
  const searchResults=el("boothDepartureSearchResults");
  let searchTimer=null;
  searchInput?.addEventListener("input",()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(async()=>{
      if(!searchResults)return;
      const query=String(searchInput.value||"").trim();
      if(!query){searchResults.hidden=true;searchResults.innerHTML="";return;}
      searchResults.hidden=false;
      searchResults.innerHTML='<div class="booth-empty">検索中...</div>';
      const products=await searchBoothDepartureProducts(query);
      if(!products.length){searchResults.innerHTML='<div class="booth-empty">該当する商品がありません。</div>';return;}
      searchResults.innerHTML=products.map(product=>`<button type="button" class="booth-return-search-result" data-departure-product-barcode="${esc(product.barcode||"")}">
        <strong>${esc(product.name||"-")}</strong><span>${esc(product.barcode||"-")}</span>
      </button>`).join("");
    },180);
  });
  searchResults?.addEventListener("click",async clickEvent=>{
    const button=clickEvent.target.closest("[data-departure-product-barcode]");
    if(!button)return;
    if(el("boothDepartureBarcode"))el("boothDepartureBarcode").value=button.dataset.departureProductBarcode||"";
    if(searchInput)searchInput.value="";
    searchResults.hidden=true;
    searchResults.innerHTML="";
    await addBoothDepartureCountFromInput();
  });
  el("boothDepartureAddBtn")?.addEventListener("click",addBoothDepartureCountFromInput);
  el("boothDepartureCompleteBtn")?.addEventListener("click",completeBoothDepartureCount);
  el("reloadBoothCarryOutHistoryBtn")?.addEventListener("click",()=>loadBoothCarryOutHistory(event.id));
  el("boothDepartureCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="departure-count";
    startBoothCarryOutCamera();
  });
  el("boothDepartureStopCameraBtn")?.addEventListener("click",()=>stopBoothCarryOutCamera());
  el("boothDepartureBarcode")?.addEventListener("keydown",keydownEvent=>{
    if(keydownEvent.key==="Enter"){
      keydownEvent.preventDefault();
      addBoothDepartureCountFromInput();
    }
  });
  await renderBoothDepartureCountList(event.id);
  await loadBoothCarryOutHistory(event.id);
}

async function addBoothDepartureCountFromInput(){
  const event=getBoothCurrentEvent();
  if(!event)return;
  const barcode=String(el("boothDepartureBarcode")?.value||"").trim();
  const qtyText=String(el("boothDepartureQty")?.value||"1").trim()||"1";
  if(!barcode){boothShowError("持ち出し登録エラー","バーコードを入力してください。","boothDepartureBarcode");return;}
  if(!/^[1-9]\d*$/.test(qtyText)){
    boothShowError("持ち出し登録エラー","数量は1以上の整数で入力してください。","boothDepartureQty");
    return;
  }
  const product=await findBoothProductByBarcode(barcode);
  if(!product){boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothDepartureBarcode");return;}
  if(isBoothDepartureGachaProduct(product)){
    boothShowError("ガチャ商品は対象外","ガチャ商品はガチャ管理から登録してください。","boothDepartureBarcode");
    return;
  }
  const counts=readBoothDepartureCounts(event.id);
  const current=counts[barcode]||{barcode,product_name:product.name||"",quantity:0};
  current.product_name=product.name||current.product_name||"";
  current.quantity=Number(current.quantity||0)+Number(qtyText);
  counts[barcode]=current;
  writeBoothDepartureCounts(event.id,counts);
  if(el("boothDepartureBarcode"))el("boothDepartureBarcode").value="";
  if(el("boothDepartureQty"))el("boothDepartureQty").value="1";
  await renderBoothDepartureCountList(event.id);
  boothShowSuccess("イベント持ち出し登録","入力に追加しました。確定するまで在庫は変わりません。");
  el("boothDepartureBarcode")?.focus();
}

async function renderBoothDepartureCountList(eventId){
  const list=el("boothDepartureCountList");
  if(!list)return;
  const counts=Object.values(readBoothDepartureCounts(eventId)).filter(row=>Number(row.quantity||0)>0);
  const total=counts.reduce((sum,row)=>sum+Number(row.quantity||0),0);
  const summary=el("boothDepartureSummary");
  if(summary)summary.textContent=`${counts.length}商品 / ${total}個`;
  if(!counts.length){
    list.innerHTML='<div class="booth-empty">バーコードを読み取ると、ここに持ち出し対象商品が追加されます。</div>';
    return;
  }
  list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-departure-draft-table">
    <thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し数</th><th>操作</th></tr></thead>
    <tbody>${counts.map(row=>`<tr>
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td><div class="booth-qty-editor"><button type="button" class="secondary" data-departure-action="decrease" data-departure-barcode="${esc(row.barcode||"")}">－</button><input type="number" min="1" step="1" value="${esc(row.quantity||1)}" data-departure-qty="${esc(row.barcode||"")}"><button type="button" class="secondary" data-departure-action="increase" data-departure-barcode="${esc(row.barcode||"")}">＋</button></div></td>
      <td><button type="button" class="secondary" data-departure-action="remove" data-departure-barcode="${esc(row.barcode||"")}">削除</button></td>
    </tr>`).join("")}</tbody>
  </table></div>
  <div class="booth-history-cards">${counts.map(row=>`<article class="booth-history-card">
    <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong><button type="button" class="secondary" data-departure-action="remove" data-departure-barcode="${esc(row.barcode||"")}">削除</button></div>
    <div class="booth-history-card-meta"><span>バーコード：${esc(row.barcode||"-")}</span><label>持ち出し数<input type="number" min="1" step="1" value="${esc(row.quantity||1)}" data-departure-qty="${esc(row.barcode||"")}"></label></div>
    <div class="booth-qty-editor"><button type="button" class="secondary" data-departure-action="decrease" data-departure-barcode="${esc(row.barcode||"")}">－</button><button type="button" class="secondary" data-departure-action="increase" data-departure-barcode="${esc(row.barcode||"")}">＋</button></div>
  </article>`).join("")}</div>`;
  list.querySelectorAll("[data-departure-action]").forEach(button=>button.addEventListener("click",async()=>{
    const barcode=String(button.dataset.departureBarcode||"");
    const action=button.dataset.departureAction;
    const draft=readBoothDepartureCounts(eventId);
    const row=draft[barcode];
    if(!row)return;
    const quantity=Number(row.quantity||0);
    if(action==="increase")row.quantity=quantity+1;
    else if(action==="decrease")row.quantity=Math.max(1,quantity-1);
    else if(action==="remove")delete draft[barcode];
    writeBoothDepartureCounts(eventId,draft);
    await renderBoothDepartureCountList(eventId);
  }));
  list.querySelectorAll("[data-departure-qty]").forEach(input=>input.addEventListener("change",async()=>{
    const barcode=String(input.dataset.departureQty||"");
    const value=String(input.value||"").trim();
    const draft=readBoothDepartureCounts(eventId);
    if(!/^[1-9]\d*$/.test(value)){
      await renderBoothDepartureCountList(eventId);
      boothShowError("持ち出し登録エラー","数量は1以上の整数で入力してください。");
      return;
    }
    if(draft[barcode])draft[barcode].quantity=Number(value);
    writeBoothDepartureCounts(eventId,draft);
    await renderBoothDepartureCountList(eventId);
  }));
}

async function upsertBoothConfirmedNormalTakeoutItem(event,product,quantity){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty&event_id=eq.${encodeURIComponent(event.id)}&barcode=eq.${encodeURIComponent(product.barcode)}&item_type=eq.normal&limit=1`);
  const previous=Array.isArray(rows)&&rows[0]?{...rows[0]}:null;
  const now=new Date().toISOString();
  if(previous){
    await sb(`booth_event_items?id=eq.${encodeURIComponent(previous.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        product_name:product.name||previous.product_name||"",
        taken_qty:Number(previous.taken_qty||0)+quantity,
        normal_takeout_qty:Number(previous.normal_takeout_qty||0)+quantity,
        updated_at:now
      })
    });
    return {previous,created:null};
  }
  const createdRows=await sb("booth_event_items",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"normal",
      taken_qty:quantity,
      normal_takeout_qty:quantity,
      storage_takeout_qty:0,
      sold_qty:0,
      returned_qty:0,
      consumed_qty:0,
      difference_qty:quantity,
      updated_at:now
    }])
  });
  return {previous:null,created:Array.isArray(createdRows)&&createdRows[0]?createdRows[0]:null};
}

async function restoreBoothConfirmedNormalTakeoutItem(operation){
  const item=operation.eventItem;
  if(item?.previous){
    const previous=item.previous;
    await sb(`booth_event_items?id=eq.${encodeURIComponent(previous.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        product_name:previous.product_name||"",
        taken_qty:previous.taken_qty,
        normal_takeout_qty:previous.normal_takeout_qty,
        storage_takeout_qty:previous.storage_takeout_qty,
        sold_qty:previous.sold_qty,
        returned_qty:previous.returned_qty,
        consumed_qty:previous.consumed_qty,
        difference_qty:previous.difference_qty,
        updated_at:new Date().toISOString()
      })
    });
  }else if(item?.created?.id){
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.created.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
  }
}

async function restoreBoothConfirmedTakeoutStorage(operation){
  const current=await findBoothEventStorageStock(operation.storeCode,operation.product.barcode);
  if(operation.previousStorage){
    if(!current)throw new Error("event_storage_stocks rollback row not found");
    await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({storage_qty:Number(operation.previousStorage.storage_qty||0),product_name:operation.previousStorage.product_name||operation.product.name||"",updated_at:new Date().toISOString()})
    });
  }else if(current?.id){
    await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
  }
}

async function completeBoothDepartureCount(){
  const event=getBoothCurrentEvent();
  if(!event)return;
  if(isBoothEventClosed(event)){showBoothClosedError();return;}
  const staff=String(el("boothDepartureStaff")?.value||"").trim();
  const memo=String(el("boothDepartureMemo")?.value||"").trim();
  if(!staff){boothShowError("持ち出し登録エラー","担当者を選択してください。","boothDepartureStaff");return;}
  if(!validateBoothStaffStore(staff,"担当者確認エラー","boothDepartureStaff"))return;
  const counts=Object.values(readBoothDepartureCounts(event.id)).filter(row=>Number(row.quantity||0)>0);
  if(!counts.length){boothShowError("持ち出し登録エラー","確定する商品がありません。");return;}
  const storeCode=getBoothCurrentStoreCode();
  const checked=[];
  try{
    for(const row of counts){
      const quantity=Number(row.quantity||0);
      const product=await findBoothProductByBarcode(String(row.barcode||""));
      if(!product)throw new Error(`商品マスター未登録：${row.barcode}`);
      if(isBoothDepartureGachaProduct(product))throw new Error(`${product.name||row.barcode} はガチャ商品です。ガチャ管理から登録してください。`);
      const duplicate=await sb(`booth_stock_movements?select=id&event_id=eq.${encodeURIComponent(event.id)}&barcode=eq.${encodeURIComponent(product.barcode)}&item_type=eq.normal&movement_type=in.(take_out,departure_count,event_transfer)&limit=1`);
      if(Array.isArray(duplicate)&&duplicate.length)throw new Error(`${product.name||product.barcode} はすでに持ち出し確定済みです。`);
      const latestBase=Number(product.base_stock||0);
      if(latestBase<quantity)throw new Error(`${product.name||product.barcode} の通常棚在庫が不足しています。現在庫 ${latestBase} / 持ち出し ${quantity}`);
      checked.push({row,product,quantity,latestBase});
    }
    const total=checked.reduce((sum,row)=>sum+row.quantity,0);
    const ok=typeof confirmAppAction==="function"
      ? await confirmAppAction("イベント持ち出し確定",[`変更商品：${checked.length}件`, `持ち出し合計：${total}個`,"通常棚 → 共通イベント棚","","確定すると在庫を移動します。"].join("\n"),{okText:"確定"})
      : true;
    if(!ok)return;
    window.__aricoBoothDepartureSaving=true;
    const applied=[];
    try{
      for(const row of checked){
        const product=await findBoothProductByBarcode(row.product.barcode);
        if(!product)throw new Error(`商品マスター未登録：${row.product.barcode}`);
        const duplicate=await sb(`booth_stock_movements?select=id&event_id=eq.${encodeURIComponent(event.id)}&barcode=eq.${encodeURIComponent(product.barcode)}&item_type=eq.normal&movement_type=in.(take_out,departure_count,event_transfer)&limit=1`);
        if(Array.isArray(duplicate)&&duplicate.length)throw new Error(`${product.name||product.barcode} はすでに持ち出し確定済みです。`);
        const baseBefore=Number(product.base_stock||0);
        if(baseBefore<row.quantity)throw new Error(`${product.name||row.product.barcode} の通常棚在庫が不足しています。現在庫 ${baseBefore} / 持ち出し ${row.quantity}`);
        const previousStorage=await findBoothEventStorageStock(storeCode,product.barcode);
        const operation={event,product,row,storeCode,baseBefore,previousStorage,eventItem:null,movement:null,storageMovement:null};
        applied.push(operation);
        await updateBoothProductBaseStock(product.barcode,baseBefore-row.quantity);
        await upsertBoothEventStorageStock(storeCode,{...product,product_name:product.name||""},row.quantity);
        const movementRows=await sb("booth_stock_movements",{
          method:"POST",
          headers:{Prefer:"return=representation"},
          body:JSON.stringify([{
            event_id:event.id,
            barcode:product.barcode,
            product_name:product.name||"",
            item_type:"normal",
            movement_type:"take_out",
            quantity:row.quantity,
            staff,
            memo,
            takeout_source:"normal",
            affects_smaregi:false,
            smaregi_delta:0
          }])
        });
        operation.movement=Array.isArray(movementRows)&&movementRows[0]?movementRows[0]:null;
        const storageMovementRows=await sb("event_storage_movements",{
          method:"POST",
          headers:{Prefer:"return=representation"},
          body:JSON.stringify([{
            event_id:event.id,
            store_code:storeCode,
            smaregi_product_id:product.smaregi_product_id?String(product.smaregi_product_id):null,
            barcode:product.barcode,
            product_name:product.name||"",
            movement_type:"storage_in",
            quantity:row.quantity,
            staff,
            memo
          }])
        });
        operation.storageMovement=Array.isArray(storageMovementRows)&&storageMovementRows[0]?storageMovementRows[0]:null;
        operation.eventItem=await upsertBoothConfirmedNormalTakeoutItem(event,product,row.quantity);
      }
    }catch(applyError){
      for(const operation of applied.reverse()){
        try{
          if(operation.movement?.id)await sb(`booth_stock_movements?id=eq.${encodeURIComponent(operation.movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(operation.storageMovement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(operation.storageMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(operation.eventItem)await restoreBoothConfirmedNormalTakeoutItem(operation);
          await restoreBoothConfirmedTakeoutStorage(operation);
          await updateBoothProductBaseStock(operation.product.barcode,operation.baseBefore);
        }catch(rollbackError){console.warn("[booth departure rollback failed]",rollbackError);}
      }
      throw applyError;
    }
    localStorage.removeItem(getBoothDepartureCountStorageKey(event.id));
    if(el("boothDepartureMemo"))el("boothDepartureMemo").value="";
    await renderBoothEventInventoryPanel(event);
    boothShowSuccess("イベント持ち出し確定",`${checked.length}商品・${total}個を共通イベント棚へ移動しました。`);
  }catch(error){
    boothShowError("イベント持ち出し確定エラー","持ち出しの確定に失敗しました。\n"+error.message);
  }finally{
    window.__aricoBoothDepartureSaving=false;
  }
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
    <div class="booth-gacha-return-count-panel">
      <h5>ガチャ戻りカウント</h5>
      <p class="section-note">イベント終了後、戻ってきた景品数を商品ごとに入力してから一括保存します。入力中は在庫を変更せず、保存時だけ通常棚へ加算します。在庫変動登録の「ガチャ戻し」とは別処理です。</p>
      <div class="button-row booth-camera-button-row">
        <button type="button" id="boothGachaReturnCountStartCameraBtn">カメラ読取</button>
        <button type="button" id="boothGachaReturnCountStopCameraBtn" class="secondary">停止</button>
      </div>
      <div class="camera-area booth-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div id="boothCameraGuideOverlay" class="camera-guide-overlay">
          <div class="camera-guide-box"><div class="camera-guide-line"></div></div>
          <div class="camera-guide-text">赤枠にバーコードを合わせてください</div>
        </div>
      </div>
      <div class="booth-scan-row">
        <label>バーコード<input id="boothGachaReturnCountBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力"></label>
        <label>担当者<select id="boothGachaReturnCountStaff">${getBoothStaffOptions()}</select></label>
        <button type="button" id="boothGachaReturnCountAddBtn">商品を追加</button>
      </div>
      <div id="boothGachaReturnCountDraftList" class="booth-return-draft-list"><div class="booth-empty">バーコードを追加すると、ここに戻り数量の入力欄が表示されます。</div></div>
      <button type="button" id="boothGachaReturnCountSaveBtn">一括確認して保存</button>
    </div>
    <section class="booth-gacha-confirmation-panel">
      <div class="booth-list-header"><div><h5>スマレジ調整確認</h5><p class="section-note">ガチャ使用数分をスマレジ側で手動調整した後に確認します。確認ボタンはスマレジAPIを更新しません。</p></div></div>
      <div class="booth-gacha-confirmation-filters" role="group" aria-label="スマレジ調整確認の表示切替">
        <button type="button" class="secondary is-active" data-booth-gacha-confirm-filter="pending">未確認</button>
        <button type="button" class="secondary" data-booth-gacha-confirm-filter="confirmed">確認済み</button>
        <button type="button" class="secondary" data-booth-gacha-confirm-filter="all">すべて</button>
      </div>
      <div id="boothGachaHistoryList" class="booth-carry-history-list"><div class="booth-empty">読み込み中...</div></div>
    </section>
  </section>`;
  const draw=async()=>{
    const list=el("boothGachaList");
    if(!list)return;
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    try{
      const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,returned_qty,consumed_qty,difference_qty,diff_memo,updated_at&event_id=eq.${encodeURIComponent(event.id)}&item_type=eq.gacha_prize&order=product_name.asc&limit=1000`);
      const items=Array.isArray(rows)?rows:[];
      const productsByBarcode=await loadBoothProductsByBarcode(items.map(row=>row.barcode));
      const viewRows=items.map(item=>{
        const product=productsByBarcode.get(String(item.barcode||""))||{};
        return {
          id:item.id,
          barcode:item.barcode,
          name:product.name||item.product_name||"",
          shelf:boothProductShelfText(product),
          current:boothGachaItemCurrentQty(item),
          counted:isBoothGachaReturnCounted(item),
          returned:boothGachaReturnActualQty(item),
          used:boothGachaUsedQty(item),
          updated_at:item.updated_at||""
        };
      });
      if(!viewRows.length){
        list.innerHTML='<div class="booth-empty">ガチャ商品はありません。在庫変動登録で「ガチャ」を登録してください。</div>';
        return;
      }
      list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-gacha-list-table">
        <thead><tr><th>商品情報</th><th>現在ガチャ在庫</th></tr></thead>
        <tbody>${viewRows.map(row=>`<tr>
          <td>${boothProductIdentityBlock(row)}</td>
          <td><strong>${esc(row.current)}</strong></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="booth-history-cards">
        ${viewRows.map(row=>`<article class="booth-history-card">
          ${boothProductIdentityBlock(row)}
          <div class="booth-history-card-meta">
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
  const barcodeInput=el("boothGachaReturnCountBarcode");
  const add=()=>addBoothGachaReturnDraftFromBarcode(event,barcodeInput?.value);
  barcodeInput?.addEventListener("keydown",inputEvent=>{
    if(inputEvent.key==="Enter"){
      inputEvent.preventDefault();
      add();
    }
  });
  el("boothGachaReturnCountAddBtn")?.addEventListener("click",add);
  el("boothGachaReturnCountStartCameraBtn")?.addEventListener("click",()=>{
    boothScanTarget="gacha-return-count";
    startBoothCarryOutCamera();
  });
  el("boothGachaReturnCountStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  el("boothCameraZoomRange")?.addEventListener("input",applyBoothCameraZoom);
  updateBoothCameraZoomLabel();
  el("boothGachaReturnCountDraftList")?.addEventListener("click",inputEvent=>{
    const button=inputEvent.target.closest("[data-booth-gacha-return-action]");
    if(!button)return;
    const barcode=button.dataset.boothGachaReturnBarcode||"";
    const action=button.dataset.boothGachaReturnAction;
    if(action==="remove")boothGachaReturnDraftItems.delete(barcode);
    else if(action==="increase")changeBoothGachaReturnDraftQuantity(barcode,1);
    else if(action==="decrease")changeBoothGachaReturnDraftQuantity(barcode,-1);
    renderBoothGachaReturnDraftCards(event);
  });
  el("boothGachaReturnCountDraftList")?.addEventListener("change",inputEvent=>{
    const input=inputEvent.target.closest("[data-booth-gacha-return-qty]");
    if(input)setBoothGachaReturnDraftQuantity(input.dataset.boothGachaReturnQty,input.value,event);
  });
  el("boothGachaReturnCountSaveBtn")?.addEventListener("click",async buttonEvent=>{
    await saveBoothGachaReturnCount(event,buttonEvent.currentTarget,draw);
  });
  el("boothGachaHistoryList")?.closest(".booth-gacha-confirmation-panel")?.addEventListener("click",inputEvent=>{
    const filterButton=inputEvent.target.closest("[data-booth-gacha-confirm-filter]");
    if(filterButton){
      document.querySelectorAll("[data-booth-gacha-confirm-filter]").forEach(button=>button.classList.toggle("is-active",button===filterButton));
      loadBoothGachaHistory(event.id,filterButton.dataset.boothGachaConfirmFilter||"pending");
      return;
    }
    const confirmButton=inputEvent.target.closest(".booth-gacha-confirm-btn");
    if(confirmButton)confirmBoothGachaManualCheck(confirmButton.dataset.logId,event.id);
  });
  renderBoothGachaReturnDraftCards(event);
  draw();
  loadBoothGachaHistory(event.id,"pending");
}

async function findBoothGachaCountItem(eventId,barcode){
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,returned_qty,consumed_qty,difference_qty,diff_memo,return_reflected,return_reflected_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.gacha_prize&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

function getBoothGachaReturnDraft(event){
  const eventId=String(event?.id||"");
  if(boothGachaReturnDraftEventId!==eventId){
    boothGachaReturnDraftEventId=eventId;
    boothGachaReturnDraftItems=new Map();
  }
  return boothGachaReturnDraftItems;
}

function isBoothGachaReturnCountAllowed(event){
  if(isBoothEventClosed(event))return true;
  const end=String(event?.event_end||"").trim();
  if(!end)return false;
  const endDate=new Date(/^\d{4}-\d{2}-\d{2}$/.test(end)?`${end}T23:59:59+09:00`:end);
  return Number.isFinite(endDate.getTime())&&endDate.getTime()<=Date.now();
}

function renderBoothGachaReturnDraftCards(event){
  const list=el("boothGachaReturnCountDraftList");
  if(!list)return;
  const items=[...getBoothGachaReturnDraft(event).values()];
  if(!items.length){
    list.innerHTML='<div class="booth-empty">バーコードを追加すると、ここに戻り数量の入力欄が表示されます。</div>';
    return;
  }
  list.innerHTML=items.map(entry=>`<article class="booth-return-draft-item" data-booth-gacha-return-card="${esc(entry.barcode)}">
    <div class="booth-return-draft-head"><strong>${esc(entry.productName||"-")}</strong><button type="button" class="secondary" data-booth-gacha-return-action="remove" data-booth-gacha-return-barcode="${esc(entry.barcode)}">削除</button></div>
    <div class="booth-return-draft-meta"><span>バーコード：${esc(entry.barcode)}</span><span>ガチャ持ち出し確定数：${esc(entry.pickedQty)}</span><span>使用数：${esc(Math.max(0,entry.pickedQty-entry.quantity))}</span></div>
    <div class="booth-return-draft-controls">
      <button type="button" class="secondary" data-booth-gacha-return-action="decrease" data-booth-gacha-return-barcode="${esc(entry.barcode)}" aria-label="戻り数量を減らす">−</button>
      <input type="number" min="0" max="${esc(entry.pickedQty)}" step="1" value="${esc(entry.quantity)}" data-booth-gacha-return-qty="${esc(entry.barcode)}" aria-label="戻り実数">
      <button type="button" class="secondary" data-booth-gacha-return-action="increase" data-booth-gacha-return-barcode="${esc(entry.barcode)}" aria-label="戻り数量を増やす">＋</button>
    </div>
  </article>`).join("");
}

async function addBoothGachaReturnDraftFromBarcode(event,rawBarcode){
  const barcode=String(rawBarcode||"").trim();
  if(!event||!barcode)return;
  if(!isBoothGachaReturnCountAllowed(event)){
    boothShowError("ガチャ戻りカウントエラー","ガチャ戻りカウントはイベント終了後に実行してください。","boothGachaReturnCountBarcode");
    return;
  }
  try{
    const item=await findBoothGachaCountItem(event.id,barcode);
    if(!item){
      boothShowError("ガチャ戻りカウントエラー","このイベントでガチャ商品として持ち出された商品ではありません。","boothGachaReturnCountBarcode");
      return;
    }
    if(isBoothGachaReturnCounted(item)){
      boothShowError("ガチャ戻りカウントエラー","この商品はすでに戻りカウント済みです。二重保存はできません。","boothGachaReturnCountBarcode");
      return;
    }
    const pickedQty=Math.max(0,Number(item.taken_qty||0));
    if(pickedQty<=0){
      boothShowError("ガチャ戻りカウントエラー","持ち出し確定数が0の商品は対象にできません。","boothGachaReturnCountBarcode");
      return;
    }
    const items=getBoothGachaReturnDraft(event);
    const existing=items.get(barcode);
    const next=Math.min(pickedQty,Number(existing?.quantity||0)+1);
    if(existing&&Number(existing.quantity||0)>=pickedQty){
      boothShowError("ガチャ戻り数量エラー",`戻り数量は持ち出し確定数(${pickedQty})を超えられません。`);
      return;
    }
    items.set(barcode,{barcode,productName:item.product_name||"",item,pickedQty,quantity:next});
    renderBoothGachaReturnDraftCards(event);
    const input=el("boothGachaReturnCountBarcode");
    if(input){input.value="";input.focus();}
  }catch(error){
    boothShowError("ガチャ戻りカウントエラー","商品確認に失敗しました。\n"+(error.message||""),"boothGachaReturnCountBarcode");
  }
}

function changeBoothGachaReturnDraftQuantity(barcode,delta){
  const entry=boothGachaReturnDraftItems.get(String(barcode||""));
  if(!entry)return;
  const rawNext=Number(entry.quantity||0)+Number(delta||0);
  if(rawNext>entry.pickedQty){
    boothShowError("ガチャ戻り数量エラー",`戻り数量は持ち出し確定数(${entry.pickedQty})以内で入力してください。`);
    return;
  }
  const next=Math.max(0,rawNext);
  entry.quantity=next;
}

function setBoothGachaReturnDraftQuantity(barcode,value,event){
  const entry=boothGachaReturnDraftItems.get(String(barcode||""));
  if(!entry)return;
  const text=String(value??"").trim();
  if(!/^\d+$/.test(text)){
    boothShowError("ガチャ戻り数量エラー","戻り実数は0以上の整数で入力してください。");
    renderBoothGachaReturnDraftCards(event);
    return;
  }
  const requested=Number(text);
  if(requested>entry.pickedQty){
    boothShowError("ガチャ戻り数量エラー",`戻り数量は持ち出し確定数(${entry.pickedQty})以内で入力してください。`);
    renderBoothGachaReturnDraftCards(event);
    return;
  }
  const next=Math.max(0,requested);
  entry.quantity=next;
  renderBoothGachaReturnDraftCards(event);
}

async function previewBoothGachaReturnCount(event){
  const preview=el("boothGachaReturnCountPreview");
  if(!preview)return;
  const barcode=String(el("boothGachaReturnCountBarcode")?.value||"").trim();
  const qtyText=String(el("boothGachaReturnCountQty")?.value||"").trim();
  if(!event||!barcode){
    preview.hidden=true;
    preview.innerHTML="";
    return null;
  }
  try{
    const item=await findBoothGachaCountItem(event.id,barcode);
    if(!item){
      preview.hidden=false;
      preview.innerHTML='<div class="message err">このイベントでガチャ商品として持ち出されていません。</div>';
      return null;
    }
    const taken=Number(item.taken_qty||0);
    const qty=/^\d+$/.test(qtyText)?Number(qtyText):null;
    const used=qty===null?null:Math.max(0,taken-qty);
    preview.hidden=false;
    preview.innerHTML=`<div><span>商品名：</span><strong>${esc(item.product_name||"-")}</strong></div>
      <div><span>バーコード：</span><strong>${esc(item.barcode||"-")}</strong></div>
      <div><span>ガチャ持ち出し確定数：</span><strong>${esc(taken)}</strong></div>
      <div><span>戻り実数：</span><strong>${qty===null?"未入力":esc(qty)}</strong></div>
      <div><span>確定使用数：</span><strong>${used===null?"未確定":esc(used)}</strong></div>`;
    return item;
  }catch(e){
    preview.hidden=false;
    preview.innerHTML=`<div class="message err">戻りカウント確認エラー：${esc(e.message)}</div>`;
    return null;
  }
}

async function saveBoothGachaReturnCount(event,button,afterSave){
  if(!event||window.__aricoBoothGachaReturnSaving)return;
  if(!isBoothGachaReturnCountAllowed(event)){
    boothShowError("ガチャ戻りカウントエラー","ガチャ戻りカウントはイベント終了後に実行してください。");
    return;
  }
  const entries=[...getBoothGachaReturnDraft(event).values()];
  const staff=String(el("boothGachaReturnCountStaff")?.value||"").trim();
  if(!entries.length){
    boothShowError("ガチャ戻りカウントエラー","戻り数量を入力する商品を追加してください。","boothGachaReturnCountBarcode");
    return;
  }
  if(!staff){
    boothShowError("ガチャ戻りカウントエラー","担当者を選択してください。","boothGachaReturnCountStaff");
    return;
  }
  if(!validateBoothStaffStore(staff,"店舗確認エラー","boothGachaReturnCountStaff"))return;
  window.__aricoBoothGachaReturnSaving=true;
  const checked=[];
  try{
    if(button)button.disabled=true;
    for(const entry of entries){
      const [item,product]=await Promise.all([
        findBoothGachaCountItem(event.id,entry.barcode),
        findBoothProductByBarcode(entry.barcode)
      ]);
      if(!item)throw new Error(`${entry.productName||entry.barcode}: ガチャ持ち出し商品が見つかりません。`);
      if(isBoothGachaReturnCounted(item))throw new Error(`${entry.productName||entry.barcode}: すでに戻りカウント済みです。`);
      if(!product)throw new Error(`${entry.barcode}: 商品マスターが見つかりません。`);
      const pickedQty=Math.max(0,Number(item.taken_qty||0));
      const returnedQty=Number(entry.quantity||0);
      if(!Number.isInteger(returnedQty)||returnedQty<0||returnedQty>pickedQty){
        throw new Error(`${entry.productName||entry.barcode}: 戻り実数が持ち出し確定数の範囲外です。`);
      }
      checked.push({entry,item,product,pickedQty,returnedQty,usedQty:Math.max(0,pickedQty-returnedQty)});
    }
    const body=checked.map(row=>`${row.product.name||row.item.product_name||row.entry.barcode}: 戻り ${row.returnedQty} / 使用 ${row.usedQty}`).join("\n");
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("ガチャ戻りカウント確認",body,{okText:"通常棚へ反映して保存"}):true;
    if(!ok)return;
    const applied=[];
    try{
      for(const row of checked){
        const countedAt=new Date().toISOString();
        const memo=`ガチャ戻りカウント / 戻り実数 ${row.returnedQty} / 使用数 ${row.usedQty} / スマレジ調整：未確認 / 担当者 ${staff} / ${countedAt}`;
        const operation={row,baseBefore:Number(row.product.base_stock||0),inventoryLog:null,movement:null,itemBefore:{...row.item}};
        applied.push(operation);
        await updateBoothProductBaseStock(row.product.barcode,operation.baseBefore+row.returnedQty);
        operation.inventoryLog=await insertBoothGachaInventoryLog(event,row.product,row.returnedQty,staff,memo,"gacha_return",-row.usedQty);
        if(!operation.inventoryLog?.id)throw new Error(`${row.product.name||row.product.barcode}: ガチャ戻り履歴を保存できませんでした。`);
        operation.movement=await insertBoothGachaMovement(event,row.product,row.returnedQty,staff,memo,"gacha_return",row.returnedQty,"normal");
        if(!operation.movement?.id)throw new Error(`${row.product.name||row.product.barcode}: ガチャ戻り移動履歴を保存できませんでした。`);
        await patchBoothEventItem(row.item,{
          returned_qty:row.returnedQty,
          consumed_qty:row.usedQty,
          difference_qty:0,
          return_reflected:true,
          return_reflected_qty:row.returnedQty,
          return_reflected_at:countedAt,
          return_reflected_by:staff,
          diff_memo:memo,
          updated_at:countedAt
        });
      }
    }catch(error){
      for(const done of applied.reverse()){
        try{
          await updateBoothProductBaseStock(done.row.product.barcode,done.baseBefore);
          await patchBoothEventItem(done.row.item,{
            returned_qty:done.itemBefore.returned_qty||0,
            consumed_qty:done.itemBefore.consumed_qty||0,
            difference_qty:done.itemBefore.difference_qty||0,
            return_reflected:done.itemBefore.return_reflected||false,
            return_reflected_qty:done.itemBefore.return_reflected_qty||0,
            return_reflected_at:done.itemBefore.return_reflected_at||null,
            return_reflected_by:done.itemBefore.return_reflected_by||null,
            diff_memo:done.itemBefore.diff_memo||""
          });
          if(done.inventoryLog?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(done.inventoryLog.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(done.movement?.id)await sb(`booth_stock_movements?id=eq.${encodeURIComponent(done.movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        }catch(rollbackError){console.warn("[gacha return rollback failed]",rollbackError);}
      }
      throw error;
    }
    getBoothGachaReturnDraft(event).clear();
    renderBoothGachaReturnDraftCards(event);
    const barcodeInput=el("boothGachaReturnCountBarcode");
    if(barcodeInput){barcodeInput.value="";barcodeInput.focus();}
    if(typeof afterSave==="function")await afterSave();
    await refreshBoothEventRelatedViews(event.id);
    if(el("boothGachaHistoryList"))await loadBoothGachaHistory(event.id,"pending");
    boothShowSuccess("ガチャ戻りカウント保存",`${checked.length}商品を通常棚へ戻し、ガチャ使用数を確定しました。\nスマレジ調整は未確認として履歴に残しました。`);
  }catch(e){
    boothShowError("ガチャ戻りカウントエラー","戻り実数の保存に失敗しました。\n"+e.message);
  }finally{
    window.__aricoBoothGachaReturnSaving=false;
    if(button)button.disabled=false;
  }
}

async function renderBoothDepartureInventoryListPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-departure-list-card">
    <div class="booth-list-header">
      <div>
        <h4>持ち出し在庫一覧</h4>
        <p class="section-note">イベント持ち出し登録で確定した今回イベントの持ち出し在庫と、取得済みスマレジ販売数・戻り数を確認します。</p>
      </div>
      <button type="button" id="boothDepartureListReloadBtn" class="secondary">再読み込み</button>
    </div>
    <div id="boothDepartureInventoryList" class="booth-event-inventory-list"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  el("boothDepartureListReloadBtn")?.addEventListener("click",()=>loadBoothDepartureInventoryList(event.id));
  loadBoothDepartureInventoryList(event.id);
}

async function loadBoothDepartureInventoryList(eventId){
  const list=el("boothDepartureInventoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const [items,salesRows]=await Promise.all([
      fetchBoothEventItems(eventId),
      sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=eq.confirmed&order=sold_at.asc&limit=2000`).catch(()=>[])
    ]);
    const normalItems=Array.isArray(items)?items:[];
    const confirmedSales=(Array.isArray(salesRows)?salesRows:[]).filter(row=>!isBoothGachaSaleRow(row));
    const hasSalesImport=confirmedSales.length>0;
    const salesByBarcode=new Map();
    confirmedSales.forEach(row=>{
      const barcode=String(row.barcode||"");
      if(!barcode)return;
      const current=salesByBarcode.get(barcode)||{quantity:0,product_name:row.product_name||"",smaregi_product_id:row.smaregi_product_id||""};
      current.quantity+=Number(row.quantity||0);
      current.product_name=current.product_name||row.product_name||"";
      salesByBarcode.set(barcode,current);
    });
    const itemBarcodes=new Set(normalItems.map(item=>String(item.barcode||"")));
    const rows=normalItems.map(item=>{
      const sale=salesByBarcode.get(String(item.barcode||""));
      const soldQty=hasSalesImport?Number(sale?.quantity||0):null;
      const gachaUsed=Number(item.consumed_qty||0);
      const returned=Number(item.returned_qty||0);
      const taken=Number(item.taken_qty||0);
      const remain=soldQty===null?null:taken-soldQty-returned-gachaUsed;
      return {
        product_name:item.product_name||"",
        barcode:item.barcode||"",
        taken,
        soldQty,
        gachaUsed,
        returned,
        remain,
        diff:Number(item.difference_qty||0),
        status:"confirmed"
      };
    });
    salesByBarcode.forEach((sale,barcode)=>{
      if(itemBarcodes.has(barcode))return;
      rows.push({
        product_name:sale.product_name||"",
        barcode,
        taken:null,
        soldQty:Number(sale.quantity||0),
        gachaUsed:null,
        returned:null,
        remain:null,
        diff:null,
        status:"unconfirmed"
      });
    });
    const productsByBarcode=await loadBoothProductsByBarcode(rows.map(row=>row.barcode));
    if(!rows.length){
      list.innerHTML='<div class="booth-empty">持ち出し在庫・販売履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table booth-departure-list-table">
      <thead><tr><th>商品名</th><th>棚番</th><th>バーコード</th><th>持ち出し確定数</th><th>スマレジ販売数</th><th>ガチャ使用数</th><th>理論残数</th><th>戻り時実数</th><th>差異</th></tr></thead>
      <tbody>${rows.map(row=>{
        const product=productsByBarcode.get(String(row.barcode||""))||{};
        return `<tr>
          <td>${esc(row.product_name||product.name||"-")}${row.status==="unconfirmed"?'<div class="booth-status-note">持ち出し数未確定</div>':""}</td>
          <td>${esc(boothProductShelfText(product))}</td>
          <td>${esc(row.barcode||"-")}</td>
          <td>${row.taken===null?"未確定":esc(row.taken)}</td>
          <td>${row.soldQty===null?"未取得":esc(row.soldQty)}</td>
          <td>${row.gachaUsed===null?"-":esc(row.gachaUsed)}</td>
          <td>${row.remain===null?"算出不可":esc(row.remain)}</td>
          <td>${row.returned===null?"-":esc(row.returned)}</td>
          <td>${row.diff===null?"-":esc(row.diff)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">持ち出し在庫一覧を読み込めませんでした。</div>';
    boothShowError("持ち出し在庫一覧エラー","持ち出し在庫一覧の読み込みに失敗しました。\n"+e.message);
  }
}

async function buildBoothDepartureInventoryData(eventId){
  const [items,salesRows]=await Promise.all([
    sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,updated_at&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc&limit=3000`).catch(()=>[]),
    sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=eq.confirmed&order=sold_at.asc&limit=3000`).catch(()=>[])
  ]);
  const itemRows=Array.isArray(items)?items:[];
  const confirmedSales=(Array.isArray(salesRows)?salesRows:[]).filter(row=>!isBoothGachaSaleRow(row));
  const salesByBarcode=new Map();
  confirmedSales.forEach(row=>{
    const barcode=String(row.barcode||"").trim();
    if(!barcode)return;
    const current=salesByBarcode.get(barcode)||{quantity:0,product_name:row.product_name||""};
    current.quantity+=Number(row.quantity||0);
    current.product_name=current.product_name||row.product_name||"";
    salesByBarcode.set(barcode,current);
  });
  const normalItems=itemRows.filter(row=>String(row.item_type||"normal")==="normal");
  const gachaItems=itemRows.filter(row=>String(row.item_type||"")==="gacha_prize");
  const normalBarcodes=new Set(normalItems.map(row=>String(row.barcode||"")));
  const normalRows=normalItems.map(item=>{
    const sale=salesByBarcode.get(String(item.barcode||""));
    const taken=Number(item.taken_qty||0);
    const soldQty=Number(sale?.quantity ?? item.sold_qty ?? 0);
    const remain=taken-soldQty-Number(item.returned_qty||0)-Number(item.consumed_qty||0);
    return {
      product_name:item.product_name||sale?.product_name||"",
      barcode:item.barcode||"",
      taken,
      soldQty,
      remain,
      status:"confirmed",
      updated_at:item.updated_at||""
    };
  });
  salesByBarcode.forEach((sale,barcode)=>{
    if(normalBarcodes.has(barcode))return;
    normalRows.push({
      product_name:sale.product_name||"",
      barcode,
      taken:null,
      soldQty:Number(sale.quantity||0),
      remain:null,
      status:"unconfirmed",
      updated_at:sale.sold_at||""
    });
  });
  const gachaRows=gachaItems.map(item=>{
    const taken=Number(item.taken_qty||0);
    const returned=boothGachaReturnActualQty(item);
    const used=boothGachaUsedQty(item);
    return {
      product_name:item.product_name||"",
      barcode:item.barcode||"",
      taken,
      used,
      returned,
      remain:boothGachaItemCurrentQty(item),
      counted:isBoothGachaReturnCounted(item),
      updated_at:item.updated_at||""
    };
  });
  const sorter=(a,b)=>String(a.product_name||"").localeCompare(String(b.product_name||""),"ja",{numeric:true,sensitivity:"base"});
  return {normalRows:normalRows.sort(sorter),gachaRows:gachaRows.sort(sorter)};
}

function renderBoothDepartureNormalSection(rows){
  const body=rows.length?rows.map(row=>`<tr>
    <td>${esc(row.product_name||"-")}${row.status==="unconfirmed"?'<div class="booth-status-note">持ち出し未登録</div>':""}</td>
    <td>${esc(row.barcode||"-")}</td>
    <td>${row.taken===null?"未登録":esc(row.taken)}</td>
    <td>${esc(row.soldQty??0)}</td>
    <td>${row.remain===null?"算出不可":esc(row.remain)}</td>
  </tr>`).join(""):`<tr><td colspan="5">通常持ち出し在庫はありません。</td></tr>`;
  const cards=rows.map(row=>`<article class="booth-history-card booth-departure-card">
    <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong>${row.status==="unconfirmed"?'<span class="booth-diff-status is-warn">持ち出し未登録</span>':""}</div>
    <div class="booth-history-card-meta">
      <span>バーコード：${esc(row.barcode||"-")}</span>
      <span>持ち出し数：${row.taken===null?"未登録":esc(row.taken)}</span>
      <span>販売数：${esc(row.soldQty??0)}</span>
      <span>現在残数：${row.remain===null?"算出不可":esc(row.remain)}</span>
    </div>
  </article>`).join("");
  return `<section class="booth-split-list-section">
    <h5>通常持ち出し在庫</h5>
    <div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-departure-list-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し数</th><th>販売数</th><th>現在残数</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="booth-history-cards booth-scroll-cards">${cards||'<div class="booth-empty">通常持ち出し在庫はありません。</div>'}</div>
  </section>`;
}

function renderBoothDepartureGachaSection(rows){
  const body=rows.length?rows.map(row=>`<tr>
    <td>${esc(row.product_name||"-")}</td>
    <td>${esc(row.barcode||"-")}</td>
    <td>${esc(row.taken)}</td>
    <td>${esc(boothGachaDisplayQty(row.returned))}</td>
    <td>${esc(boothGachaDisplayQty(row.used))}</td>
    <td>${esc(row.remain)}</td>
  </tr>`).join(""):`<tr><td colspan="6">ガチャ持ち出し在庫はありません。</td></tr>`;
  const cards=rows.map(row=>`<article class="booth-history-card booth-departure-card">
    <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong></div>
    <div class="booth-history-card-meta">
      <span>バーコード：${esc(row.barcode||"-")}</span>
      <span>ガチャ持ち出し数：${esc(row.taken)}</span>
      <span>戻り実数：${esc(boothGachaDisplayQty(row.returned))}</span>
      <span>使用数：${esc(boothGachaDisplayQty(row.used))}</span>
      <span>現在ガチャ残数：${esc(row.remain)}</span>
    </div>
  </article>`).join("");
  return `<section class="booth-split-list-section">
    <h5>ガチャ持ち出し在庫</h5>
    <div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-departure-list-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>ガチャ持ち出し数</th><th>戻り実数</th><th>使用数</th><th>現在ガチャ在庫</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="booth-history-cards booth-scroll-cards">${cards||'<div class="booth-empty">ガチャ持ち出し在庫はありません。</div>'}</div>
  </section>`;
}

async function renderBoothDepartureInventoryListPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-departure-list-card">
    <div class="booth-list-header">
      <div>
        <h4>持ち出し在庫一覧</h4>
        <p class="section-note">イベント持ち出し登録で確定した通常持ち出し在庫と、ガチャ持ち出し在庫を別表で確認します。</p>
      </div>
      <div class="button-row booth-export-buttons">
        <button type="button" id="boothDepartureListCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothDepartureListPdfBtn" class="secondary">PDF出力</button>
        <button type="button" id="boothDepartureListReloadBtn" class="secondary">再読み込み</button>
      </div>
    </div>
    <div class="booth-event-inventory-controls">
      <label>商品検索
        <input id="boothDepartureListSearch" autocomplete="off" placeholder="商品名・バーコードで検索">
      </label>
      <label>並び順
        <select id="boothDepartureListSort">
          <option value="name">商品名順</option>
          <option value="barcode">バーコード順</option>
          <option value="updated_at">最終更新順</option>
        </select>
      </label>
      <label>表示
        <select id="boothDepartureListFilter">
          <option value="all">全件</option>
          <option value="start">開始時イベント棚あり</option>
          <option value="additional">追加持ち出しあり</option>
          <option value="taken">イベント棚在庫あり</option>
        </select>
      </label>
    </div>
    <div id="boothDepartureInventoryList" class="booth-event-inventory-list"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  const storageKey="arico_booth_departure_list_sort";
  const filterStorageKey="arico_booth_departure_list_filter";
  const sortEl=el("boothDepartureListSort");
  if(sortEl)sortEl.value=localStorage.getItem(storageKey)||"name";
  const filterEl=el("boothDepartureListFilter");
  if(filterEl)filterEl.value=localStorage.getItem(filterStorageKey)||"all";
  el("boothDepartureListSearch")?.addEventListener("input",()=>loadBoothDepartureInventoryList(event.id));
  el("boothDepartureListSort")?.addEventListener("change",()=>{
    localStorage.setItem(storageKey,String(el("boothDepartureListSort")?.value||"name"));
    loadBoothDepartureInventoryList(event.id);
  });
  el("boothDepartureListFilter")?.addEventListener("change",()=>{
    localStorage.setItem(filterStorageKey,String(el("boothDepartureListFilter")?.value||"all"));
    loadBoothDepartureInventoryList(event.id);
  });
  el("boothDepartureListReloadBtn")?.addEventListener("click",()=>loadBoothDepartureInventoryList(event.id));
  el("boothDepartureListCsvBtn")?.addEventListener("click",()=>exportBoothDepartureInventoryCsv(event));
  el("boothDepartureListPdfBtn")?.addEventListener("click",()=>exportBoothDepartureInventoryPdf(event));
  loadBoothDepartureInventoryList(event.id);
}

async function loadBoothDepartureInventoryList(eventId){
  const list=el("boothDepartureInventoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothDepartureInventoryData(eventId);
    const query=String(el("boothDepartureListSearch")?.value||"").trim().toLowerCase();
    const sortKey=String(el("boothDepartureListSort")?.value||localStorage.getItem("arico_booth_departure_list_sort")||"name");
    const filterRows=rows=>query
      ? rows.filter(row=>[row.product_name,row.name,row.barcode,row.shelf].some(value=>String(value||"").toLowerCase().includes(query)))
      : rows;
    const sortRows=rows=>sortBoothInventoryRows(rows.map(row=>({
      ...row,
      name:row.name||row.product_name||"",
      updated_at:row.updated_at||""
    })),sortKey);
    const normalRows=sortRows(filterRows(data.normalRows));
    const gachaRows=sortRows(filterRows(data.gachaRows));
    if(!normalRows.length&&!gachaRows.length){
      list.innerHTML='<div class="booth-empty">持ち出し在庫・販売履歴・ガチャ在庫はありません。</div>';
      return;
    }
    const commonTotal=normalRows.reduce((sum,row)=>sum+Number(row.commonShelfQty||0),0);
    const gachaTotal=gachaRows.reduce((sum,row)=>sum+Number(row.remain||0),0);
    list.innerHTML=`<div class="booth-summary-strip">
      <span>イベント棚在庫：${esc(normalRows.length)}商品 / ${esc(commonTotal)}個</span>
      <span>ガチャ現在庫：${esc(gachaRows.length)}商品 / ${esc(gachaTotal)}個</span>
    </div>${renderBoothDepartureNormalSection(normalRows)}${renderBoothDepartureGachaSection(gachaRows)}`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">持ち出し在庫一覧を読み込めませんでした。</div>';
    boothShowError("持ち出し在庫一覧エラー","持ち出し在庫一覧の読み込みに失敗しました。\n"+e.message);
  }
}

async function exportBoothDepartureInventoryCsv(event){
  try{
    const data=await buildBoothDepartureInventoryData(event.id);
    const rows=[
      ["通常持ち出し在庫"],
      ["商品名","バーコード","持ち出し数","販売数","現在残数"],
      ...data.normalRows.map(row=>[
        row.product_name||"",
        row.barcode||"",
        row.taken===null?"未登録":row.taken,
        row.soldQty??0,
        row.remain===null?"算出不可":row.remain
      ]),
      [],
      ["ガチャ持ち出し在庫"],
      ["商品名","バーコード","ガチャ持ち出し数","戻り実数","使用数","現在ガチャ在庫"],
      ...data.gachaRows.map(row=>[
        row.product_name||"",
        row.barcode||"",
        row.taken,
        boothGachaDisplayQty(row.returned),
        boothGachaDisplayQty(row.used),
        row.remain
      ])
    ];
    downloadBoothCsvFile(`${boothEventExportBaseName(event,"持ち出し在庫一覧")}.csv`,rows);
  }catch(e){
    boothShowError("CSV出力エラー","持ち出し在庫一覧CSVの出力に失敗しました。\n"+e.message);
  }
}

async function exportBoothDepartureInventoryPdf(event){
  try{
    const data=await buildBoothDepartureInventoryData(event.id);
    const html=`<h1>持ち出し在庫一覧</h1>
      <div class="meta">
        <strong>イベント</strong><span>${esc(event?.name||"-")}</span>
        <strong>出力日時</strong><span>${esc(new Date().toLocaleString("ja-JP"))}</span>
      </div>
      ${boothPdfTable("通常持ち出し在庫",["商品名","バーコード","持ち出し数","販売数","現在残数"],data.normalRows.map(row=>[
        row.product_name||"",
        row.barcode||"",
        row.taken===null?"未登録":row.taken,
        row.soldQty??0,
        row.remain===null?"算出不可":row.remain
      ]))}
      ${boothPdfTable("ガチャ持ち出し在庫",["商品名","バーコード","ガチャ持ち出し数","戻り実数","使用数","現在ガチャ在庫"],data.gachaRows.map(row=>[
        row.product_name||"",
        row.barcode||"",
        row.taken,
        boothGachaDisplayQty(row.returned),
        boothGachaDisplayQty(row.used),
        row.remain
      ]))}`;
    if(openBoothPdfWindow(boothEventExportBaseName(event,"持ち出し在庫一覧"),html))boothShowSuccess("PDF出力","持ち出し在庫一覧PDFの印刷画面を開きました。");
  }catch(e){
    boothShowError("PDF出力エラー","持ち出し在庫一覧PDFの出力に失敗しました。\n"+e.message);
  }
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
      const onZXingResult=async(result)=>{
        if(result&&boothZXingRunning){
          await handleBoothScannedCode(result.getText());
        }
      };
      const zxingConstraints=[
        {video:{
          facingMode:{ideal:"environment"},
          width:{ideal:2560},
          height:{ideal:1440},
          focusMode:{ideal:"continuous"},
          exposureMode:{ideal:"continuous"}
        }},
        {video:{facingMode:{ideal:"environment"}}},
        {video:true}
      ];
      let zxingStarted=false;
      let lastZXingError=null;
      for(const constraints of zxingConstraints){
        try{
          await boothZXingReader.decodeFromConstraints(constraints,video,onZXingResult);
          zxingStarted=true;
          break;
        }catch(cameraError){
          lastZXingError=cameraError;
          try{boothZXingReader.reset();}catch(_){}
        }
      }
      if(!zxingStarted)throw lastZXingError||new Error("カメラを起動できませんでした。");
      improveBoothCameraTrack(video);
      showBoothLocalMessage("カメラ読取中です。赤枠にバーコードを合わせてください。","ok");
      return;
    }

    if("BarcodeDetector"in window){
      boothBarcodeDetector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","code_39","qr_code"]});
      const constraintsList=[
        {video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}},
        {video:{facingMode:"environment"}},
        {video:true}
      ];
      let lastCameraError=null;
      for(const constraints of constraintsList){
        try{
          boothCameraStream=await navigator.mediaDevices.getUserMedia(constraints);
          break;
        }catch(cameraError){
          lastCameraError=cameraError;
        }
      }
      if(!boothCameraStream)throw lastCameraError||new Error("カメラを起動できませんでした。");
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
    let message="カメラを起動できませんでした。";
    if(e?.name==="NotAllowedError")message="カメラの使用が許可されていません。ブラウザのカメラ権限を確認してください。";
    else if(e?.name==="NotFoundError")message="使用できるカメラが見つかりません。";
    else if(e?.message)message=e.message;
    boothCameraError("カメラ起動エラー",message);
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
  const value=String(el("boothCarryOutSource")?.value||"normal");
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
  return normalizeBoothStoreCode(context?.storeCode||"tokyo");
}

function normalizeBoothStoreCode(value){
  const text=String(value||"").trim().toLowerCase();
  if(text==="東京"||text==="東京店"||text==="tokyo")return "tokyo";
  if(text==="愛知"||text==="愛知店"||text==="aichi")return "aichi";
  if(text==="長野"||text==="長野店"||text==="nagano")return "nagano";
  return text;
}

async function findBoothEventStorageStock(storeCode,barcode){
  const normalizedStore=normalizeBoothStoreCode(storeCode);
  const normalizedBarcode=String(barcode||"").trim();
  if(!normalizedStore||!normalizedBarcode)return null;
  const rows=await sb(`event_storage_stocks?select=id,store_code,barcode,product_name,storage_qty&barcode=eq.${encodeURIComponent(normalizedBarcode)}&limit=100`);
  return Array.isArray(rows)
    ? (rows.find(row=>normalizeBoothStoreCode(row?.store_code)===normalizedStore)||null)
    : null;
}

// Older event rows were created before the store-wide event shelf table was
// introduced. Prefer the explicit common-shelf balance, with a legacy
// event-item fallback for those rows so their return can still be completed.
function getBoothReturnAvailability(item,storageStock){
  if(storageStock){
    return {quantity:Math.max(0,Number(storageStock.storage_qty||0)),source:"common-event-shelf"};
  }
  return {quantity:getBoothEventShelfCurrentQty(item),source:"legacy-event-item"};
}

async function restoreBoothEventStorageStock(storeCode,item,previousStock){
  const current=await findBoothEventStorageStock(storeCode,item?.barcode);
  if(previousStock){
    if(!current)throw new Error("event_storage_stocks rollback row not found");
    await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        product_name:previousStock.product_name||item?.product_name||"",
        storage_qty:Number(previousStock.storage_qty||0),
        updated_at:new Date().toISOString()
      })
    });
    return;
  }
  if(current){
    await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({storage_qty:0,updated_at:new Date().toISOString()})
    });
  }
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
      <button type="button" class="booth-event-menu-btn is-active" data-booth-menu="carry-out">イベント持ち出し登録</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="gacha">ガチャ管理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="departure-list">持ち出し在庫一覧</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="sales">販売取り込み</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="return">戻り在庫処理</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="report">イベントレポート</button>
      <button type="button" class="booth-event-menu-btn" data-booth-menu="close">イベント締め</button>
    </div>
    <div id="boothEventWorkArea" class="booth-work-area">
      <section class="booth-work-card booth-carry-out-card">
        <h4>イベント持ち出し登録</h4>
        <p class="section-note">イベントへ持ち出す商品を登録します。入力中は下書きとして保持し、確定時に通常棚から共通イベント棚へ移動します。</p>
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
            <input id="boothCarryOutSource" type="hidden" value="normal">
            <div class="booth-fixed-field">通常棚</div>
          </label>
          <label>担当者<span class="required">必須</span>
            <select id="boothCarryOutStaff" ${closed?"disabled":""}>${staffOptions}</select>
          </label>
          <button type="button" id="boothCarryOutRegisterBtn" ${closed?"disabled":""}>イベント持ち出しを登録</button>
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
  el("boothCsvDownloadBtn")?.addEventListener("click",()=>exportBoothEventReportCsv(event));
  el("boothPdfDownloadBtn")?.addEventListener("click",()=>exportBoothEventReportPdf(event));
  el("boothReopenEventBtn")?.addEventListener("click",()=>renderBoothReopenPanel(event));
  updateBoothCameraZoomLabel();
  loadBoothCarryOutHistory(event.id);
  loadBoothPlannedItems(event.id);
  renderBoothEventInventoryPanel(event);
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
  if(menu==="departure-list"){
    renderBoothDepartureInventoryListPanel(event);
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
  if(menu==="report"){
    renderBoothEventReportPanel(event);
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
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,difference_qty,consumed_qty&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.normal&limit=1`);
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

function getBoothReturnDraft(event){
  const eventId=String(event?.id||"");
  if(boothReturnDraftEventId!==eventId){
    boothReturnDraftEventId=eventId;
    boothReturnDraftDestination="";
    boothReturnDraftDestinationEventId="";
    boothReturnDraftItems=new Map();
  }
  return boothReturnDraftItems;
}

function getBoothReturnDestinationEvents(sourceEvent){
  const sourceStore=String(sourceEvent?.store_code||getBoothCurrentStoreCode?.()||"").toLowerCase();
  return (Array.isArray(boothEvents)?boothEvents:[]).filter(target=>{
    if(String(target?.id||"")===String(sourceEvent?.id||""))return false;
    if(isBoothEventClosed(target))return false;
    if(String(target?.status||"").toLowerCase()==="cancelled")return false;
    const targetStore=String(target?.store_code||sourceStore).toLowerCase();
    return !sourceStore||!targetStore||targetStore===sourceStore;
  });
}

function setBoothReturnDestination(destination){
  const items=boothReturnDraftItems;
  if(items.size&&destination!==boothReturnDraftDestination){
    boothShowError("戻し先変更エラー","入力済みの商品があります。入力分を反映するか、カードを削除してから戻し先を変更してください。");
    return false;
  }
  boothReturnDraftDestination=destination==="event"||destination==="keep"?"event":"shelf";
  boothReturnDraftDestinationEventId="";
  document.querySelectorAll("[data-booth-return-destination]").forEach(button=>{
    button.classList.toggle("is-selected",button.dataset.boothReturnDestination===boothReturnDraftDestination);
    button.setAttribute("aria-pressed",button.dataset.boothReturnDestination===boothReturnDraftDestination?"true":"false");
  });
  const target=el("boothReturnDestinationEvent");
  const wrap=el("boothReturnDestinationEventWrap");
  if(wrap)wrap.hidden=boothReturnDraftDestination!=="event";
  if(target&&boothReturnDraftDestination!=="event")target.value="";
  return true;
}

function renderBoothReturnDraftCards(event){
  const list=el("boothReturnDraftList");
  if(!list)return;
  const items=[...getBoothReturnDraft(event).values()];
  if(!items.length){
    list.innerHTML='<div class="booth-empty">バーコードを読み取ると、ここに戻り対象商品が追加されます。</div>';
    return;
  }
  list.innerHTML=items.map(entry=>`<article class="booth-return-draft-item" data-booth-return-card="${esc(entry.barcode)}">
    <div class="booth-return-draft-head"><strong>${esc(entry.productName||entry.item?.product_name||"-")}</strong><button type="button" class="secondary" data-booth-return-action="remove" data-booth-return-barcode="${esc(entry.barcode)}">削除</button></div>
    <div class="booth-return-draft-meta"><span>バーコード：${esc(entry.barcode)}</span><span>持ち出し：${esc(entry.item?.taken_qty??0)}</span><span>販売：${esc(entry.item?.sold_qty??0)}</span><span>ガチャ移動：${esc(entry.item?.consumed_qty??0)}</span><span>戻り可能：${esc(entry.currentQty)}</span></div>
    <div class="booth-return-draft-controls">
      <button type="button" class="secondary" data-booth-return-action="decrease" data-booth-return-barcode="${esc(entry.barcode)}" aria-label="数量を減らす">−</button>
      <input type="number" min="0" max="${esc(entry.currentQty)}" step="1" value="${esc(entry.quantity)}" data-booth-return-qty="${esc(entry.barcode)}" aria-label="戻り数量">
      <button type="button" class="secondary" data-booth-return-action="increase" data-booth-return-barcode="${esc(entry.barcode)}" aria-label="数量を増やす">＋</button>
    </div>
  </article>`).join("");
}

async function addBoothReturnDraftFromBarcode(rawBarcode){
  const event=getBoothCurrentEvent();
  const barcode=String(rawBarcode||"").trim();
  if(!event||!barcode)return;
  if(isBoothEventClosed(event)){showBoothClosedError();return;}
  if(!boothReturnDraftDestination){
    boothShowError("戻り先未選択","先に「通常棚へ戻す」または「イベント棚へ移動」を選択してください。","boothReturnDestinationShelf");
    return;
  }
  if(boothReturnDraftDestination==="event"&&!String(el("boothReturnDestinationEvent")?.value||"").trim()){
    boothShowError("移動先未選択","移動先イベントを選択してください。","boothReturnDestinationEvent");
    return;
  }
  try{
    const item=await findBoothEventItemByBarcode(event.id,barcode);
    if(!item){
      boothShowError("戻り対象外商品","この商品は現在イベントの通常商品として持ち出されていません。","boothReturnBarcode");
      return;
    }
    const currentQty=getBoothEventShelfCurrentQty(item);
    if(currentQty<=0){
      boothShowError("戻り対象外商品","この商品の現在イベント棚在庫は0です。","boothReturnBarcode");
      return;
    }
    const items=getBoothReturnDraft(event);
    const existing=items.get(barcode);
    if(existing&&existing.quantity>=currentQty){
      boothShowError("戻り数量エラー",`戻り数量が現在イベント棚在庫に達しています。\n現在イベント棚在庫：${currentQty}`);
      return;
    }
    items.set(barcode,{
      barcode,
      productName:item.product_name||"",
      item,
      currentQty,
      quantity:Math.min(currentQty,Number(existing?.quantity||0)+1)
    });
    renderBoothReturnDraftCards(getBoothCurrentEvent());
    const input=el("boothReturnBarcode");
    if(input){input.value="";input.focus();}
    showBoothLocalMessage(`${item.product_name||barcode} を戻り対象へ追加しました。数量を確認して一括反映してください。`,"ok");
  }catch(e){
    boothShowError("戻り対象追加エラー","商品確認に失敗しました。\n"+e.message,"boothReturnBarcode");
  }
}

function changeBoothReturnDraftQuantity(barcode,delta){
  const entry=boothReturnDraftItems.get(String(barcode||""));
  if(!entry)return;
  const rawNext=Number(entry.quantity||0)+Number(delta||0);
  if(rawNext>entry.currentQty){
    boothShowError("戻り数量エラー",`戻り数量は共通イベント棚在庫(${entry.currentQty})以内で入力してください。`);
    return;
  }
  const next=Math.max(0,rawNext);
  if(next===0)boothReturnDraftItems.delete(entry.barcode);
  else entry.quantity=next;
  renderBoothReturnDraftCards(getBoothCurrentEvent());
}

function setBoothReturnDraftQuantity(barcode,value){
  const entry=boothReturnDraftItems.get(String(barcode||""));
  if(!entry)return;
  const text=String(value??"").trim();
  if(!/^\d+$/.test(text)){
    boothShowError("戻り数量エラー","戻り数量は0以上の整数で入力してください。");
    renderBoothReturnDraftCards(getBoothCurrentEvent());
    return;
  }
  const requested=Number(text);
  if(requested>entry.currentQty){
    boothShowError("戻り数量エラー",`戻り数量は共通イベント棚在庫(${entry.currentQty})以内で入力してください。`);
    renderBoothReturnDraftCards(getBoothCurrentEvent());
    return;
  }
  const next=Math.max(0,requested);
  if(next===0)boothReturnDraftItems.delete(entry.barcode);
  else entry.quantity=next;
  renderBoothReturnDraftCards(getBoothCurrentEvent());
}

async function getBoothReturnDestinationEvent(event){
  const eventId=String(el("boothReturnDestinationEvent")?.value||"").trim();
  const target=getBoothReturnDestinationEvents(event).find(row=>String(row.id)===eventId);
  return target||null;
}

async function addBoothReturnEventShelfQty(event,product,quantity){
  const item=await findBoothEventItemByBarcode(event.id,product.barcode);
  if(item){
    const previous={...item};
    await patchBoothEventItem(item,{
      product_name:product.name||item.product_name||"",
      taken_qty:Number(item.taken_qty||0)+quantity,
      normal_takeout_qty:Number(item.normal_takeout_qty||0)+quantity,
      difference_qty:calculateBoothItemDifference({...item,taken_qty:Number(item.taken_qty||0)+quantity,normal_takeout_qty:Number(item.normal_takeout_qty||0)+quantity})
    });
    return {item:{...item,taken_qty:Number(item.taken_qty||0)+quantity,normal_takeout_qty:Number(item.normal_takeout_qty||0)+quantity},previous,created:false};
  }
  const inserted=await sb("booth_event_items",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"normal",
      taken_qty:quantity,
      normal_takeout_qty:quantity,
      storage_takeout_qty:0,
      sold_qty:0,
      returned_qty:0,
      consumed_qty:0,
      difference_qty:quantity,
      updated_at:new Date().toISOString()
    }])
  });
  const created=Array.isArray(inserted)&&inserted[0]?inserted[0]:await findBoothEventItemByBarcode(event.id,product.barcode);
  if(!created)throw new Error("移動先イベントの商品行を作成できませんでした。");
  return {item:created,previous:null,created:true};
}

async function restoreBoothReturnSourceItem(snapshot){
  if(!snapshot?.item)return;
  const item=snapshot.item;
  await patchBoothEventItem(item,{
    returned_qty:item.returned_qty||0,
    difference_qty:item.difference_qty||0,
    return_process_type:item.return_process_type||null,
    return_reflected:item.return_reflected||false,
    return_reflected_qty:item.return_reflected_qty||0,
    return_reflected_at:item.return_reflected_at||null,
    return_reflected_by:item.return_reflected_by||null,
    shelf_return_qty:item.shelf_return_qty||0,
    event_storage_qty:item.event_storage_qty||0,
    shelf_return_reflected:item.shelf_return_reflected||false,
    shelf_return_reflected_qty:item.shelf_return_reflected_qty||0,
    shelf_return_reflected_at:item.shelf_return_reflected_at||null,
    shelf_return_reflected_by:item.shelf_return_reflected_by||null
  });
}

async function applyBoothReturnSourceItem(item,quantity,processType,staff){
  const nextReturned=Number(item.returned_qty||0)+quantity;
  const updated={...item,returned_qty:nextReturned};
  await patchBoothEventItem(item,{
    returned_qty:nextReturned,
    difference_qty:calculateBoothDifference(updated,0),
    return_process_type:processType,
    return_reflected:true,
    return_reflected_qty:nextReturned,
    return_reflected_at:new Date().toISOString(),
    return_reflected_by:staff,
    shelf_return_qty:processType==="shelf"?nextReturned:0,
    event_storage_qty:0,
    shelf_return_reflected:processType==="shelf",
    shelf_return_reflected_qty:processType==="shelf"?nextReturned:0,
    shelf_return_reflected_at:processType==="shelf"?new Date().toISOString():null,
    shelf_return_reflected_by:processType==="shelf"?staff:null
  });
}

async function insertBoothReturnMovement(event,item,quantity,staff,memo,movementType="return"){
  const requestedType=String(movementType||"return");
  const normalizedType=requestedType==="event_stock_confirm"?"return":requestedType;
  const normalizedMemo=requestedType==="event_stock_confirm"
    ? ["イベント棚に残す確認",memo].filter(Boolean).join(" / ")
    : memo;
  const inserted=await sb("booth_stock_movements",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:item.barcode,
      product_name:item.product_name||"",
      item_type:"normal",
      movement_type:normalizedType,
      quantity,
      staff,
      memo:normalizedMemo,
      takeout_source:normalizedType==="event_transfer"?"event":"normal",
      affects_smaregi:false,
      smaregi_delta:0
    }])
  });
  return Array.isArray(inserted)&&inserted[0]?inserted[0]:null;
}

async function removeBoothReturnDestinationItem(result,quantity){
  if(!result?.item)return;
  if(result.created){
    await sb(`booth_event_items?id=eq.${encodeURIComponent(result.item.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
    return;
  }
  const item=result.item;
  await patchBoothEventItem(item,{
    taken_qty:Math.max(0,Number(item.taken_qty||0)-quantity),
    normal_takeout_qty:Math.max(0,Number(item.normal_takeout_qty||0)-quantity),
    difference_qty:calculateBoothItemDifference({
      ...item,
      taken_qty:Math.max(0,Number(item.taken_qty||0)-quantity),
      normal_takeout_qty:Math.max(0,Number(item.normal_takeout_qty||0)-quantity)
    })
  });
}

async function applyBoothReturnDraft(){
  if(window.__aricoBoothReturnSaving){
    boothShowError("戻り登録エラー","戻り登録処理中です。完了までお待ちください。");
    return;
  }
  const event=getBoothCurrentEvent();
  const destination=boothReturnDraftDestination;
  const staff=String(el("boothReturnStaff")?.value||"").trim();
  const memo=String(el("boothReturnMemo")?.value||"").trim();
  const entries=[...getBoothReturnDraft(event).values()].filter(entry=>Number(entry.quantity||0)>0);
  if(!event||isBoothEventClosed(event)){showBoothClosedError();return;}
  if(destination!=="shelf"&&destination!=="event"){
    boothShowError("戻り先未選択","戻り先を選択してください。","boothReturnDestinationShelf");
    return;
  }
  const targetEvent=destination==="event"?await getBoothReturnDestinationEvent(event):null;
  if(destination==="event"&&!targetEvent){
    boothShowError("移動先未選択","移動先イベントを選択してください。","boothReturnDestinationEvent");
    return;
  }
  if(!entries.length){
    boothShowError("戻り商品未選択","バーコードを読み取り、戻り数量を入力してください。","boothReturnBarcode");
    return;
  }
  if(!staff){
    boothShowError("戻り登録エラー","担当者を選択してください。","boothReturnStaff");
    return;
  }
  if(!validateBoothStaffStore(staff,"店舗確認エラー","boothReturnStaff"))return;
  const checked=[];
  try{
    for(const entry of entries){
      const item=await findBoothEventItemByBarcode(event.id,entry.barcode);
      const currentQty=getBoothEventShelfCurrentQty(item);
      if(!item||currentQty<Number(entry.quantity||0)){
        throw new Error(`${entry.productName||entry.barcode} の現在イベント棚在庫が不足しています。現在：${currentQty} / 戻り：${entry.quantity}`);
      }
      const product=await findBoothProductByBarcode(entry.barcode);
      if(!product)throw new Error(`${entry.barcode} の商品マスターが見つかりません。`);
      checked.push({entry,item,product,quantity:Number(entry.quantity||0)});
    }
    const summary=checked.map(row=>`${row.product.name||row.barcode}：${row.quantity}`).join("\n");
    const destinationText=destination==="shelf"?"通常棚へ戻す":`イベント棚へ移動：${targetEvent.name||targetEvent.id}`;
    const body=["戻り在庫を一括反映します。",`戻し先：${destinationText}`,`担当者：${staff}`,"",summary,"","実行しますか？"].join("\n");
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("戻り在庫一括反映",body,{okText:"反映"}):true;
    if(!ok)return;
    window.__aricoBoothReturnSaving=true;
    const applied=[];
    try{
      for(const row of checked){
        const snapshot={item:{...row.item}};
        const operation={
          snapshot,
          row,
          baseBefore:null,
          inventoryLog:null,
          sourceMovement:null,
          destinationMovement:null,
          destinationResult:null
        };
        applied.push(operation);
        if(destination==="shelf"){
          operation.baseBefore=Number(row.product.base_stock||0);
          await updateBoothProductBaseStock(row.product.barcode,operation.baseBefore+row.quantity);
          operation.inventoryLog=await insertBoothEventReturnInventoryLog(event,row.item,row.quantity,staff,memo,"event_return");
          operation.sourceMovement=await insertBoothReturnMovement(event,row.item,row.quantity,staff,memo,"return");
          await applyBoothReturnSourceItem(row.item,row.quantity,"shelf",staff);
        }else{
          operation.destinationResult=await addBoothReturnEventShelfQty(targetEvent,row.product,row.quantity);
          operation.inventoryLog=await insertBoothEventReturnInventoryLog(event,row.item,row.quantity,staff,`${memo}${memo?" / ":""}移動先イベント：${targetEvent.name||targetEvent.id}`,"event_transfer");
          operation.sourceMovement=await insertBoothReturnMovement(event,row.item,row.quantity,staff,`${memo}${memo?" / ":""}移動先イベント：${targetEvent.name||targetEvent.id}`,"event_transfer");
          operation.destinationMovement=await insertBoothReturnMovement(targetEvent,operation.destinationResult.item,row.quantity,staff,`移動元イベント：${event.name||event.id}`,"event_transfer");
          await applyBoothReturnSourceItem(row.item,row.quantity,"event",staff);
        }
      }
    }catch(applyError){
      for(const done of applied.reverse()){
        try{
          if(done.baseBefore!==null)await updateBoothProductBaseStock(done.row.product.barcode,done.baseBefore);
          if(done.inventoryLog?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(done.inventoryLog.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(done.sourceMovement?.id)await sb(`booth_stock_movements?id=eq.${encodeURIComponent(done.sourceMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(done.destinationMovement?.id)await sb(`booth_stock_movements?id=eq.${encodeURIComponent(done.destinationMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(done.destinationResult)await removeBoothReturnDestinationItem(done.destinationResult,done.row.quantity);
          await restoreBoothReturnSourceItem(done.snapshot);
        }catch(rollbackError){console.warn("[booth return rollback failed]",rollbackError);}
      }
      throw applyError;
    }
    boothReturnDraftItems.clear();
    renderBoothReturnDraftCards(getBoothCurrentEvent());
    await refreshBoothEventRelatedViews(event.id);
    boothShowSuccess("戻り在庫反映完了",`${checked.length}商品を${destination==="shelf"?"通常棚":"移動先イベント棚"}へ反映しました。`);
    el("boothReturnBarcode")?.focus();
  }catch(e){
    boothShowError("戻り在庫反映エラー","戻り在庫の反映に失敗しました。\n"+e.message);
  }finally{
    window.__aricoBoothReturnSaving=false;
  }
}

function renderBoothReturnPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  const staffOptions=getBoothStaffOptions();
  getBoothReturnDraft(event);
  const destinationEvents=getBoothReturnDestinationEvents(event);
  area.innerHTML=`
    <section class="booth-work-card booth-return-card">
      <h4>戻り在庫処理</h4>
      <p class="section-note">戻し先を最初に選択し、バーコードを読み取って商品をまとめて反映します。現在イベントの通常商品だけが対象です。</p>
      <div class="booth-return-destination-options" role="group" aria-label="戻し先">
        <button type="button" class="booth-return-destination-btn" id="boothReturnDestinationShelf" data-booth-return-destination="shelf" aria-pressed="false" ${closed?"disabled":""}>通常棚へ戻す</button>
        <button type="button" class="booth-return-destination-btn" data-booth-return-destination="event" aria-pressed="false" ${closed?"disabled":""}>イベント棚へ移動</button>
      </div>
      <div id="boothReturnDestinationEventWrap" class="booth-return-target-event" hidden>
        <label>移動先イベント<span class="required">必須</span>
          <select id="boothReturnDestinationEvent" ${closed?"disabled":""}>
            <option value="">移動先イベントを選択</option>
            ${destinationEvents.map(target=>`<option value="${esc(target.id)}">${esc(target.name||"無題イベント")}（${esc(getBoothStatusLabel(target.status))}）</option>`).join("")}
          </select>
        </label>
        ${destinationEvents.length?"":"<div class=\"booth-empty\">同じ店舗の移動可能なイベントがありません。</div>"}
      </div>
      <div class="booth-return-scan-controls">
        <button type="button" id="boothReturnStartCameraBtn" ${closed?"disabled":""}>カメラ読取</button>
        <button type="button" id="boothReturnStopCameraBtn" class="secondary">停止</button>
        <label class="booth-return-barcode-label">バーコード
          <input id="boothReturnBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力してEnter" ${closed?"disabled":""}>
        </label>
      </div>
      <div class="booth-return-product-search">
        <label class="booth-return-product-search-label">商品名検索
          <input id="boothReturnProductSearch" autocomplete="off" placeholder="商品名で検索" ${closed?"disabled":""}>
        </label>
        <div id="boothReturnProductSearchResults" class="booth-return-product-search-results" hidden></div>
      </div>
      <div class="camera-area booth-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div id="boothCameraGuideOverlay" class="camera-guide-overlay"><div class="camera-guide-box"><div class="camera-guide-line"></div></div><div class="camera-guide-text">赤線にバーコードを合わせてください</div></div>
      </div>
      <div class="booth-return-common-fields">
        <label>担当者<span class="required">必須</span><select id="boothReturnStaff" ${closed?"disabled":""}>${staffOptions}</select></label>
        <label>メモ<input id="boothReturnMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}></label>
      </div>
      <div id="boothReturnDraftList" class="booth-return-draft-list"><div class="booth-empty">バーコードを読み取ると、ここに戻り対象商品が追加されます。</div></div>
      <button type="button" id="boothReturnApplyBtn" class="booth-return-apply-btn" ${closed?"disabled":""}>入力分を一括反映</button>
    </section>
    <section class="booth-work-card booth-return-history-card">
      <div class="booth-list-header"><h4>戻り在庫履歴</h4><button type="button" id="reloadBoothReturnHistoryBtn" class="secondary">再読み込み</button></div>
      <div id="boothReturnHistoryList" class="booth-carry-history-list"><div class="booth-empty">読み込み中...</div></div>
    </section>`;
  if(boothReturnDraftDestination)setBoothReturnDestination(boothReturnDraftDestination);
  const barcodeInput=el("boothReturnBarcode");
  const add=()=>addBoothReturnDraftFromBarcode(barcodeInput?.value);
  barcodeInput?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();add();}});
  bindBoothReturnProductSearch(event);
  document.querySelectorAll("[data-booth-return-destination]").forEach(button=>button.addEventListener("click",()=>setBoothReturnDestination(button.dataset.boothReturnDestination)));
  el("boothReturnDestinationEvent")?.addEventListener("change",()=>{boothReturnDraftDestinationEventId=String(el("boothReturnDestinationEvent")?.value||"");});
  el("boothReturnDraftList")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-booth-return-action]");
    if(!button)return;
    const barcode=button.dataset.boothReturnBarcode||"";
    const action=button.dataset.boothReturnAction;
    if(action==="remove")boothReturnDraftItems.delete(barcode);
    else if(action==="increase")changeBoothReturnDraftQuantity(barcode,1);
    else if(action==="decrease")changeBoothReturnDraftQuantity(barcode,-1);
    renderBoothReturnDraftCards(getBoothCurrentEvent());
  });
  el("boothReturnDraftList")?.addEventListener("change",event=>{
    const input=event.target.closest("[data-booth-return-qty]");
    if(input)setBoothReturnDraftQuantity(input.dataset.boothReturnQty,input.value);
  });
  el("boothReturnDraftList")?.addEventListener("input",event=>{
    const input=event.target.closest("[data-booth-return-qty]");
    if(input)updateBoothReturnDraftQuantityWhileTyping(input);
  });
  el("boothReturnApplyBtn")?.addEventListener("click",applyBoothReturnDraft);
  el("reloadBoothReturnHistoryBtn")?.addEventListener("click",()=>loadBoothReturnHistory(event.id));
  el("boothReturnStartCameraBtn")?.addEventListener("click",()=>{boothScanTarget="return";startBoothCarryOutCamera();});
  el("boothReturnStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  renderBoothReturnDraftCards(event);
  loadBoothReturnHistory(event.id);
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
  const input=el(boothScanTarget==="return"?"boothReturnBarcode":boothScanTarget==="storage"?"boothStorageBarcode":boothScanTarget==="gacha"?"boothGachaBarcode":boothScanTarget==="gacha-return-count"?"boothGachaReturnCountBarcode":boothScanTarget==="departure-count"?"boothDepartureBarcode":"boothCarryOutBarcode");
  if(input)input.value=code;
  await stopBoothCarryOutCamera(false);
  boothCameraSuccess("バーコードを読み取りました。");
  if(boothScanTarget==="departure-count")await addBoothDepartureCountFromInput();
  else if(boothScanTarget==="return"){
    if(typeof window.addBoothReturnDraftFromBarcode==="function")await window.addBoothReturnDraftFromBarcode(code);
    else await addBoothReturnDraftFromBarcode(code);
  }
  else if(boothScanTarget==="gacha-return-count")await addBoothGachaReturnDraftFromBarcode(getBoothCurrentEvent(),code);
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

// Ver 2.37: a carry-out moves stock from the normal shelf into the one
// store-wide event shelf. The event id is kept only on the audit rows.
async function registerBoothCarryOut(){
  const event=getBoothCurrentEvent();
  if(!event){
    boothShowError("持ち出し登録エラー","イベントを開いてから持ち出し登録してください。");
    return;
  }
  if(isBoothEventClosed(event)){showBoothClosedError();return;}
  const barcode=String(el("boothCarryOutBarcode")?.value||"").trim();
  const qtyText=String(el("boothCarryOutQty")?.value||"").trim();
  const staff=String(el("boothCarryOutStaff")?.value||"").trim();
  const memo=String(el("boothCarryOutMemo")?.value||"").trim();
  if(!barcode){boothShowError("持ち出し登録エラー","バーコードを入力してください。","boothCarryOutBarcode");return;}
  if(!/^[1-9]\d*$/.test(qtyText)){boothShowError("持ち出し登録エラー","数量は1以上の整数で入力してください。","boothCarryOutQty");return;}
  const quantity=Number(qtyText);
  if(!staff){boothShowError("持ち出し登録エラー","担当者を選択してください。","boothCarryOutStaff");return;}
  if(!validateBoothStaffStore(staff,"店舗確認エラー","boothCarryOutStaff"))return;
  let movement=null;
  let storageMovement=null;
  let baseBefore=null;
  let previousStorage=null;
  const storeCode=getBoothCurrentStoreCode();
  try{
    const product=await findBoothProductByBarcode(barcode);
    if(!product){boothShowError("商品未登録","このバーコードの商品は登録されていません。","boothCarryOutBarcode");return;}
    baseBefore=Number(product.base_stock||0);
    const baseAfter=baseBefore-quantity;
    const negativeCarryOut=baseAfter<0;
    if(negativeCarryOut){
      const confirmed=await confirmBoothNegativeCarryOut(baseBefore,quantity,baseAfter);
      if(!confirmed)return;
    }
    const movementMemo=[
      memo,
      negativeCarryOut?`通常棚不足の状態でイベント持ち出し登録（処理前 ${baseBefore} / 持ち出し ${quantity} / 処理後 ${baseAfter}）`:""
    ].filter(Boolean).join(" / ");
    previousStorage=await findBoothEventStorageStock(storeCode,product.barcode);
    await updateBoothProductBaseStock(product.barcode,baseAfter);
    await upsertBoothEventStorageStock(storeCode,product,quantity);
    const movementRows=await sb("booth_stock_movements",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([{
        event_id:event.id,
        barcode:product.barcode,
        product_name:product.name||"",
        item_type:"normal",
        movement_type:"take_out",
        quantity,
        staff,
        memo:movementMemo,
        takeout_source:"normal",
        affects_smaregi:false,
        smaregi_delta:0
      }])
    });
    movement=Array.isArray(movementRows)&&movementRows[0]?movementRows[0]:null;
    const storageMovementRows=await sb("event_storage_movements",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([{
        event_id:event.id,
        store_code:storeCode,
        smaregi_product_id:product.smaregi_product_id?String(product.smaregi_product_id):null,
        barcode:product.barcode,
        product_name:product.name||"",
        movement_type:"storage_in",
        quantity,
        staff,
        memo:movementMemo
      }])
    });
    storageMovement=Array.isArray(storageMovementRows)&&storageMovementRows[0]?storageMovementRows[0]:null;
    await upsertBoothEventItem(event,product,quantity);
    el("boothCarryOutBarcode").value="";
    el("boothCarryOutQty").value="";
    if(el("boothCarryOutMemo"))el("boothCarryOutMemo").value="";
    const preview=el("boothProductPreview");
    if(preview){preview.hidden=true;preview.innerHTML="";}
    await loadBoothCarryOutHistory(event.id);
    boothShowSuccess("持ち出し登録完了","通常棚から共通イベント棚へ登録しました。");
    el("boothCarryOutBarcode")?.focus();
  }catch(error){
    try{
      if(movement?.id)await sb(`booth_stock_movements?id=eq.${encodeURIComponent(movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      if(storageMovement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(storageMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      if(previousStorage||baseBefore!==null)await restoreBoothEventStorageStock(storeCode,{barcode},previousStorage);
      if(baseBefore!==null)await updateBoothProductBaseStock(barcode,baseBefore);
    }catch(rollbackError){console.warn("[booth carry-out rollback failed]",rollbackError);}
    boothShowError("持ち出し登録エラー","持ち出し登録に失敗しました。\n"+error.message);
  }
}

async function loadBoothReturnHistory(eventId){
  const list=el("boothReturnHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rows=await sb(`booth_stock_movements?select=id,created_at,product_name,barcode,quantity,staff,memo,movement_type&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(return,event_transfer)&item_type=eq.normal&order=created_at.desc&limit=100`);
    if(!Array.isArray(rows)||!rows.length){
      list.innerHTML='<div class="booth-empty">まだ棚戻し履歴はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>処理</th><th>数量</th><th>担当者</th><th>操作</th></tr></thead>
      <tbody>${rows.map(row=>`<tr>
        <td>${esc(formatBoothDateTime(row.created_at))}</td>
        <td>${esc(row.product_name||"-")}</td>
        <td>${esc(row.barcode||"-")}</td>
        <td>${esc(row.movement_type==="event_transfer"?"イベント棚移動":"通常棚戻し")}</td>
        <td>${row.movement_type==="return"?`<input class="booth-history-qty-input" id="boothReturnQtyEdit_${esc(row.id)}" type="number" min="1" step="1" value="${esc(row.quantity??"")}">`:esc(row.quantity??"")}</td>
        <td>${esc(row.staff||"-")}</td>
        <td>${row.movement_type==="return"?`<button type="button" class="secondary booth-history-edit-btn" data-return-edit-id="${esc(row.id)}" data-return-edit-barcode="${esc(row.barcode||"")}">修正</button>`:"-"}</td>
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
          <span>${esc(row.movement_type==="event_transfer"?"イベント棚移動":"通常棚戻し")}：${esc(row.quantity??"-")}</span>
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

async function insertBoothEventReturnInventoryLog(event,item,quantity,staff,memo,type="event_return"){
  // inventory_logs.type is shared with the app inventory screen and is
  // constrained to the four inventory operation types. Keep the event
  // operation detail in memo while storing a valid inventory type.
  const inventoryType=type==="event_stock_confirm" ? "\u5728\u5eab\u4fee\u6b63" : "\u5165\u8377";
  const operationMemo=type==="event_stock_confirm"
    ? ["\u30a4\u30d9\u30f3\u30c8\u68da\u306b\u6b8b\u3059\u78ba\u8a8d",memo].filter(Boolean).join(" / ")
    : ["\u30a4\u30d9\u30f3\u30c8\u623b\u3057\uff08\u901a\u5e38\u68da\uff09",memo].filter(Boolean).join(" / ");
  const inserted=await sb("inventory_logs",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      type:inventoryType,
      staff,
      barcode:item.barcode,
      product_name:item.product_name||"",
      quantity,
      memo:operationMemo,
      event_id:event.id,
      affects_smaregi:false,
      smaregi_delta:0
    })
  });
  return Array.isArray(inserted)&&inserted[0]?inserted[0]:null;
}

async function refreshBoothEventRelatedViews(eventId){
  const tasks=[];
  if(el("boothReturnHistoryList"))tasks.push(loadBoothReturnHistory(eventId));
  if(el("boothReturnProcessList"))tasks.push(loadBoothReturnProcessList(eventId));
  if(el("boothDepartureInventoryList"))tasks.push(loadBoothDepartureInventoryList(eventId));
  if(el("boothGachaHistoryList"))tasks.push(loadBoothGachaHistory(eventId));
  if(el("boothDiffList"))tasks.push(loadBoothDiffList(eventId));
  await Promise.all(tasks.map(task=>Promise.resolve(task).catch(()=>{})));
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
    boothShowError("戻し履歴修正エラー","戻し数量は1以上の整数で入力してください。",input?.id||"");
    return;
  }
  const quantity=Number(qtyText);
  try{
    const movementRows=await sb(`booth_stock_movements?select=id,quantity&event_id=eq.${encodeURIComponent(event.id)}&id=eq.${encodeURIComponent(movementId)}&movement_type=eq.return&item_type=eq.normal&limit=1`);
    const movement=Array.isArray(movementRows)&&movementRows[0]?movementRows[0]:null;
    if(!movement){
      boothShowError("戻し履歴修正エラー","修正対象の履歴が見つかりません。");
      return;
    }
    const item=await findBoothEventItemByBarcode(event.id,barcode);
    if(!item){
      boothShowError("戻し履歴修正エラー","修正対象の商品が見つかりません。");
      return;
    }
    const oldQty=Number(movement.quantity||0);
    const maxReturnable=getBoothEventShelfCurrentQty(item)+oldQty;
    if(quantity>maxReturnable){
      boothShowError("戻し数量エラー",`現在イベント棚在庫を超えて戻せません。\n現在イベント棚在庫：${maxReturnable}\n戻し数量：${quantity}`,"boothReturnQty");
      return;
    }
    const delta=quantity-oldQty;
    let productAdjusted=false;
    try{
      if(delta!==0){
        await adjustBoothProductBaseStock(barcode,delta);
        productAdjusted=true;
      }
      await sb(`booth_stock_movements?id=eq.${encodeURIComponent(movementId)}`,{
        method:"PATCH",
        body:JSON.stringify({quantity})
      });
    }catch(saveError){
      if(productAdjusted){
        try{await adjustBoothProductBaseStock(barcode,-delta);}catch(_){}
      }
      throw saveError;
    }
    await recalculateBoothReturnedQty(event.id,barcode);
    await refreshBoothEventRelatedViews(event.id);
    const currentBarcode=String(el("boothReturnBarcode")?.value||"").trim();
    if(currentBarcode&&currentBarcode===barcode)await previewBoothReturnProduct({popupOnError:false});
    boothShowSuccess("戻し履歴修正完了","戻し数量を修正しました。");
  }catch(e){
    boothShowError("戻し履歴修正エラー","戻し履歴の修正に失敗しました。\n"+e.message);
  }
}
async function registerBoothReturn(){
  if(window.__aricoBoothReturnSaving){
    boothShowError("戻し登録エラー","戻し登録処理中です。完了までお待ちください。");
    return;
  }
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

  window.__aricoBoothReturnSaving=true;
  try{
    const item=await findBoothEventItemByBarcode(event.id,barcode);
    if(!item){
      boothShowError("棚戻し棚卸しエラー","この商品はこのイベントで持ち出し登録されていません。","boothReturnBarcode");
      return;
    }
    const currentEventQty=getBoothEventShelfCurrentQty(item);
    if(quantity>currentEventQty){
      boothShowError("戻し数量エラー",`現在イベント棚在庫を超えて戻せません。\n現在イベント棚在庫：${currentEventQty}\n戻し数量：${quantity}`,"boothReturnQty");
      return;
    }
    const product=await findBoothProductByBarcode(barcode);
    const baseBefore=Number(product?.base_stock||0);
    let productUpdated=false;
    let insertedLogId="";
    try{
      await updateBoothProductBaseStock(barcode,baseBefore+quantity);
      productUpdated=true;
      const insertedLog=await insertBoothEventReturnInventoryLog(event,item,quantity,staff,memo);
      insertedLogId=insertedLog?.id?String(insertedLog.id):"";
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
          takeout_source:"normal",
          affects_smaregi:false,
          smaregi_delta:0
        }])
      });

      await updateBoothReturnedQty(item,quantity);
    }catch(saveError){
      if(productUpdated){
        try{await updateBoothProductBaseStock(barcode,baseBefore);}catch(_){}
      }
      if(insertedLogId){
        try{await sb(`inventory_logs?id=eq.${encodeURIComponent(insertedLogId)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});}catch(_){}
      }
      throw saveError;
    }

    el("boothReturnBarcode").value="";
    el("boothReturnQty").value="";
    if(el("boothReturnMemo"))el("boothReturnMemo").value="";
    clearBoothReturnPreview();
    await refreshBoothEventRelatedViews(event.id);
    boothShowSuccess("棚戻し登録完了","戻り数量を登録しました。");
    el("boothReturnBarcode")?.focus();
  }catch(e){
    boothShowError("棚戻し棚卸しエラー","戻り登録に失敗しました。\n"+e.message);
  }finally{
    window.__aricoBoothReturnSaving=false;
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
  const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.gacha_prize&limit=1`);
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function getBoothGachaSummary(eventId,barcode){
  const item=await findBoothGachaEventItem(eventId,barcode);
  const picked=Number(item?.taken_qty||0);
  const countedReturn=boothGachaReturnActualQty(item);
  return {
    item,
    picked,
    returned:countedReturn,
    current:boothGachaItemCurrentQty(item),
    consumed:boothGachaUsedQty(item)
  };
  /*
  let picked=Number(item?.taken_qty||0);
  let returned=0;
  try{
    const movementRows=await sb(`booth_stock_movements?select=movement_type,quantity&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.gacha_prize&movement_type=in.(gacha_pick,gacha_return)&limit=1000`);
    if(Array.isArray(movementRows)&&movementRows.length){
      picked=movementRows.filter(row=>String(row.movement_type)==="gacha_pick").reduce((sum,row)=>sum+Number(row.quantity||0),0);
      returned=movementRows.filter(row=>String(row.movement_type)==="gacha_return").reduce((sum,row)=>sum+Number(row.quantity||0),0);
    }
  }catch(_){}
  return {
    item,
    picked,
    returned,
    current: picked-returned,
    consumed: picked-returned
  };
  */
}

function getBoothEventShelfCurrentQty(item){
  if(!item)return 0;
  const taken=Number(item.taken_qty||0);
  const sold=Number(item.sold_qty||0);
  const returned=Number(item.returned_qty||0);
  const consumed=Number(item.consumed_qty||0);
  return Math.max(0,taken-sold-returned-consumed);
}

async function patchBoothEventItem(item,payload){
  await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({...payload,updated_at:new Date().toISOString()})
  });
}

async function moveBoothEventShelfQtyToGacha(event,product,quantity){
  return null;
  const item=await findBoothEventItemByBarcode(event.id,product.barcode);
  const stock=await findBoothEventStorageStock(getBoothCurrentStoreCode(),product.barcode);
  const current=Number(stock?.storage_qty||0);
  if(!item||!stock||current<quantity)return null;
  const normal=Math.max(0,Number(item.normal_takeout_qty||0));
  const storage=Math.max(0,Number(item.storage_takeout_qty||0));
  const useNormal=Math.min(normal,quantity);
  const useStorage=Math.min(storage,quantity-useNormal);
  const previous={
    taken_qty:Number(item.taken_qty||0),
    normal_takeout_qty:normal,
    storage_takeout_qty:storage
  };
  await patchBoothEventItem(item,{
    taken_qty:Math.max(0,Number(item.taken_qty||0)-quantity),
    normal_takeout_qty:normal-useNormal,
    storage_takeout_qty:storage-useStorage
  });
  await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),product,-quantity);
  return {item,previous,storageBefore:stock};
}

async function rollbackBoothEventShelfQty(moveResult){
  if(!moveResult?.item||!moveResult?.previous)return;
  await patchBoothEventItem(moveResult.item,moveResult.previous);
  if(moveResult.storageBefore){
    await restoreBoothEventStorageStock(getBoothCurrentStoreCode(),moveResult.item,moveResult.storageBefore);
  }
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
  const adjustment=type==="gacha_return" ? Number(delta||0) : 0;
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
       affects_smaregi:false,
       smaregi_delta:Number.isFinite(adjustment)?adjustment:0,
      equipment_checked:false
    })
  });
  return Array.isArray(inserted)&&inserted[0]?inserted[0]:null;
}

async function insertBoothGachaMovement(event,product,quantity,staff,memo,movementType,delta,source){
  const safeSource=source==="storage" ? "storage" : "normal";
  const inserted=await sb("booth_stock_movements",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"gacha_prize",
      movement_type:movementType,
      quantity,
      staff,
      memo,
      takeout_source:safeSource,
       affects_smaregi:false,
      smaregi_delta:0
    }])
  });
  return Array.isArray(inserted)&&inserted[0]?inserted[0]:null;
}

async function upsertBoothGachaEventItem(event,product,quantity,action){
  if(action!=="pick")throw new Error("ガチャ戻りは専用の戻りカウントで登録してください。");
  const eventId=encodeURIComponent(event.id);
  const barcode=encodeURIComponent(product.barcode);
  const rows=await sb(`booth_event_items?select=id,taken_qty,returned_qty,consumed_qty&event_id=eq.${eventId}&barcode=eq.${barcode}&item_type=eq.gacha_prize&limit=1`);
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
        consumed_qty:Number(rows[0].consumed_qty||0),
        difference_qty:0,
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
      item_type:"gacha_prize",
      taken_qty:quantity,
      returned_qty:0,
      consumed_qty:0,
      difference_qty:0,
      updated_at:now
    }])
  });
}

function getBoothGachaStaffOptions(){
  return getBoothStaffOptions();
}

function renderBoothGachaPanel(event){
  return renderBoothGachaListPanel(event);
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
  if(action!=="pick"){
    boothShowError("ガチャ戻り登録エラー","戻り実数はイベント管理のガチャ戻りカウントだけで登録してください。");
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
  if(action==="pick"&&currentStock<quantity){
    boothShowError("ガチャ登録エラー",`通常棚在庫が不足しています。\n通常棚在庫：${currentStock}\n登録数：${quantity}`,"boothGachaQty");
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
    "ARICO側のガチャ在庫として記録します。",
    "スマレジ在庫は自動変更しません。スマレジ側は手動修正後に履歴で確認してください。",
    "",
    "よろしいですか？"
  ].join("\n");
  showBoothConfirmPopup("ガチャピック確認",body,async()=>registerBoothGachaMovement("pick",data));
}

async function confirmBoothGachaReturn(){
  boothShowError("ガチャ戻り登録は使用できません","戻り実数はイベント管理のガチャ戻りカウントだけで登録してください。");
  return;
  const data=await validateBoothGachaForm("return");
  if(!data)return;
  const body=[
    `商品名：${data.product.name||"-"}`,
    `数量：${data.quantity}`,
    `担当者：${data.staff}`,
    "",
    "この商品をガチャ戻りとして登録します。",
    "ガチャ在庫を減らし、通常棚在庫へ戻します。",
    "スマレジ在庫は自動変更しません。スマレジ側は手動修正後に履歴で確認してください。",
    "",
    "よろしいですか？"
  ].join("\n");
  showBoothConfirmPopup("ガチャ戻り確認",body,async()=>registerBoothGachaMovement("return",data));
}

async function registerBoothGachaMovement(action,data){
  if(action!=="pick"){
    boothShowError("ガチャ戻り登録エラー","戻り実数はイベント管理のガチャ戻りカウントだけで登録してください。");
    return;
  }
  if(window.__aricoBoothGachaSaving){
    boothShowError("ガチャ登録エラー","ガチャ登録処理中です。完了までお待ちください。");
    return;
  }
  window.__aricoBoothGachaSaving=true;
  const movementType="gacha_pick";
  const delta=-Number(data.quantity||0);
  let productUpdated=false;
  let inventoryLog=null;
  let gachaMovement=null;
  let baseStockBefore=Number(data.currentStock||0);
  try{
    const latestProduct=await findBoothProductByBarcode(data.product.barcode);
    if(!latestProduct)throw new Error(`商品が見つかりません：${data.product.barcode}`);
    baseStockBefore=Number(latestProduct.base_stock||0);
    const requestedQty=Number(data.quantity||0);
    const nextStock=baseStockBefore-requestedQty;
    if(nextStock<0)throw new Error(`通常棚在庫が不足しています：現在庫 ${baseStockBefore} / 登録数 ${requestedQty}`);
    await updateBoothProductBaseStock(data.product.barcode,nextStock);
    productUpdated=true;

    inventoryLog=await insertBoothGachaInventoryLog(
      data.event,latestProduct,requestedQty,data.staff,data.memo,movementType,delta
    );
    if(!inventoryLog?.id)throw new Error("ガチャ在庫履歴を保存できませんでした。");
    gachaMovement=await insertBoothGachaMovement(
      data.event,latestProduct,requestedQty,data.staff,data.memo,movementType,delta,
      "normal"
    );
    if(!gachaMovement?.id)throw new Error("ガチャ持ち出し履歴を保存できませんでした。");
    await upsertBoothGachaEventItem(data.event,latestProduct,requestedQty,action);

    el("boothGachaBarcode").value="";
    el("boothGachaQty").value="";
    if(el("boothGachaMemo"))el("boothGachaMemo").value="";
    clearBoothGachaPreview();
    await refreshBoothEventRelatedViews(data.event.id);
    boothShowSuccess("ガチャピック登録完了",`${latestProduct.name||data.product.name||"-"} / 数量 ${requestedQty}\n通常棚からガチャ在庫へ移動しました。\nスマレジ在庫は自動変更していません。手動修正後に履歴で確認してください。`);
    el("boothGachaBarcode")?.focus();
  }catch(e){
    if(gachaMovement?.id){
      try{await sb(`booth_stock_movements?id=eq.${encodeURIComponent(gachaMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});}catch(_){}
    }
    if(inventoryLog?.id){
      try{await sb(`inventory_logs?id=eq.${encodeURIComponent(inventoryLog.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});}catch(_){}
    }
    if(productUpdated){
      try{await updateBoothProductBaseStock(data.product.barcode,baseStockBefore);}catch(_){}
    }
    boothShowError("ガチャピック登録エラー",`ガチャピック登録に失敗しました。\n${e.message}`);
  }finally{
    window.__aricoBoothGachaSaving=false;
  }
}

async function loadBoothGachaHistory(eventId,filter="pending"){
  const list=el("boothGachaHistoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const [rawRows,logRows,itemRows]=await Promise.all([
      sb(`booth_stock_movements?select=id,event_id,created_at,product_name,barcode,quantity,staff,memo,movement_type&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.gacha_prize&movement_type=in.(gacha_pick,gacha_return)&order=created_at.desc&limit=200`),
      sb(`inventory_logs?select=id,created_at,type,barcode,quantity,staff,smaregi_delta,equipment_checked,equipment_checked_by,equipment_checked_at&event_id=eq.${encodeURIComponent(eventId)}&type=in.(gacha_pick,gacha_return)&order=created_at.desc&limit=300`).catch(()=>[]),
      sb(`booth_event_items?select=barcode,taken_qty,returned_qty,consumed_qty,diff_memo&event_id=eq.${encodeURIComponent(eventId)}&item_type=eq.gacha_prize&limit=1000`).catch(()=>[])
    ]);
    const itemByBarcode=new Map((Array.isArray(itemRows)?itemRows:[]).map(row=>[String(row.barcode||""),row]));
    const logCandidates=Array.isArray(logRows)?logRows:[];
    const takeMatchingLog=row=>{
      const type=String(row.movement_type||"");
      const barcode=String(row.barcode||"");
      const qty=Number(row.quantity||0);
      const staff=String(row.staff||"");
      return logCandidates.find(log=>String(log.type||"")===type&&String(log.barcode||"")===barcode&&Number(log.quantity||0)===qty&&String(log.staff||"")===staff)||null;
    };
    const seenIds=new Set();
    const seenSemantic=new Map();
    const rows=(Array.isArray(rawRows)?rawRows:[]).filter(row=>{
      const id=String(row.id||"");
      if(id&&seenIds.has(id))return false;
      if(id)seenIds.add(id);
      const createdTime=new Date(row.created_at).getTime();
      const semanticKey=[row.event_id||eventId,row.movement_type||"",row.barcode||"",row.quantity??"",row.staff||""].join("|");
      const previousTime=seenSemantic.get(semanticKey);
      if(Number.isFinite(createdTime)&&Number.isFinite(previousTime)&&Math.abs(createdTime-previousTime)<=2000)return false;
      if(Number.isFinite(createdTime))seenSemantic.set(semanticKey,createdTime);
      return true;
    }).map(row=>{
      const log=takeMatchingLog(row);
      const item=itemByBarcode.get(String(row.barcode||""));
      const isReturn=String(row.movement_type||"")==="gacha_return";
      const usage=isReturn&&item&&isBoothGachaReturnCounted(item)
        ? Number(boothGachaUsedQty(item)||0)
        : Math.max(0,-Number(boothGachaSmaregiAdjustmentQty(log)||0));
      const checked=Boolean(log&&(log.equipment_checked===true||String(log.equipment_checked||"").toLowerCase()==="true"||log.equipment_checked_at));
      return {row,log,item,isReturn,usage,checked,returned:isReturn?(item&&isBoothGachaReturnCounted(item)?Number(item.returned_qty||0):Number(row.quantity||0)):null};
    });
    const visible=rows.filter(entry=>filter==="all"?entry.isReturn:(filter==="confirmed"?entry.isReturn&&entry.usage>0&&entry.checked:entry.isReturn&&entry.usage>0&&!entry.checked));
    const currentEvent=Array.isArray(boothEvents)?boothEvents.find(row=>String(row.id)===String(eventId)):getBoothCurrentEvent();
    const canConfirm=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
    const statusCell=entry=>{
      if(!entry.isReturn||entry.usage<=0)return '<span class="equipment-check-status">調整不要</span>';
      if(entry.checked)return `<span class="equipment-check-status is-checked">確認済</span><small>${esc(entry.log?.equipment_checked_by||"")} / ${esc(formatBoothDateTimeShort(entry.log?.equipment_checked_at))}</small>`;
      return canConfirm&&entry.log?.id
        ? `<button type="button" class="secondary booth-gacha-confirm-btn" data-log-id="${esc(entry.log.id)}">確認</button>`
        : '<span class="equipment-check-status is-pending">未確認</span>';
    };
    if(!visible.length){
      list.innerHTML=`<div class="booth-empty">${filter==="pending"?"未確認のスマレジ調整はありません。":"該当するガチャ戻り履歴はありません。"}</div>`;
      return;
    }
    list.innerHTML=`<div class="section-note">イベント：${esc(currentEvent?.name||eventId)} / 未確認調整：${esc(rows.filter(entry=>entry.isReturn&&entry.usage>0&&!entry.checked).length)}件</div>
      <div class="booth-history-table-wrap"><table class="booth-history-table">
      <thead><tr><th>イベント名</th><th>商品名</th><th>バーコード</th><th>持ち出し</th><th>戻り</th><th>使用</th><th>調整必要数</th><th>担当者</th><th>登録日時</th><th>状態</th></tr></thead>
      <tbody>${visible.map(entry=>{const row=entry.row;const taken=Number(entry.item?.taken_qty||0);const adjustment=entry.usage>0?-entry.usage:0;return `<tr>
        <td>${esc(currentEvent?.name||eventId)}</td><td>${esc(row.product_name||entry.item?.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td>
        <td>${entry.isReturn?esc(taken):"-"}</td><td>${entry.isReturn?esc(entry.returned??0):"-"}</td><td>${entry.isReturn?esc(entry.usage):"-"}</td><td>${entry.isReturn?esc(adjustment):"-"}</td>
        <td>${esc(row.staff||"-")}</td><td>${esc(formatBoothDateTime(row.created_at))}</td><td>${statusCell(entry)}</td>
      </tr>`}).join("")}</tbody></table></div>`;
  }catch(e){
    list.innerHTML='<div class="booth-empty">ガチャ戻り確認一覧を読み込めませんでした。</div>';
    boothShowError("ガチャ戻り確認エラー","スマレジ調整確認一覧の読み込みに失敗しました。\n"+e.message);
  }
}

async function confirmBoothGachaManualCheck(logId,eventId){
  if(!logId){
    boothShowError("スマレジ手動確認エラー","確認対象の在庫履歴が見つかりません。");
    return;
  }
  if(typeof hasInventoryPrivilegedAccess==="function"&&!hasInventoryPrivilegedAccess()){
    boothShowError("スマレジ手動確認エラー","確認は管理者ログイン時のみ実行できます。");
    return;
  }
  const checkedBy=typeof getSmaregiCheckerName==="function" ? getSmaregiCheckerName() : "";
  try{
    const latestRows=await sb(`inventory_logs?select=id,equipment_checked,equipment_checked_at&event_id=eq.${encodeURIComponent(eventId)}&id=eq.${encodeURIComponent(logId)}&limit=1`);
    const latest=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
    if(!latest)throw new Error("確認対象の在庫履歴が見つかりません。");
    if(latest.equipment_checked===true||String(latest.equipment_checked||"").toLowerCase()==="true"||latest.equipment_checked_at){
      boothShowError("スマレジ手動確認エラー","このガチャ戻りはすでに確認済みです。");
      return;
    }
    await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        equipment_checked:true,
        equipment_checked_by:checkedBy||"管理者",
        equipment_checked_at:new Date().toISOString()
      })
    });
    boothShowSuccess("スマレジ手動確認","ガチャ履歴を確認済みにしました。");
    await loadBoothGachaHistory(eventId);
  }catch(e){
    boothShowError("スマレジ手動確認エラー","確認状態の保存に失敗しました。\n"+e.message);
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
      <h4>開催中販売状況</h4>
      <p class="section-note">スマレジから最新販売を取得して表示します。取得時は在庫数を変更せず、販売確定時だけイベント棚へ反映します。</p>
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
        <button type="button" id="boothSalesDraftImportBtn" ${closed?"disabled":""}>最新販売を取得</button>
        <button type="button" id="boothSalesConfirmBtn" class="secondary" ${closed?"disabled":""}>確定して販売数へ反映</button>
        <button type="button" id="reloadBoothSalesImportBtn" class="secondary">再読み込み</button>
      </div>
      <div id="boothSalesImportList" class="booth-sales-import-list">
         <div class="booth-empty">開催中販売状況を読み込み中...</div>
      </div>
      <div id="boothSalesRegisterStatus" class="message"></div>
       <p class="section-note booth-sales-register-note">店舗IDだけでは取得しません。イベント販売用レジIDが未設定の場合、販売取得は実行できません。</p>
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
  // The production products table uses barcode as its primary key. Do not
  // request the optional id column: it is not present in the live schema.
  const rows=await sb(`products?select=*&barcode=in.(${buildInFilter(barcodes)})`);
  return Array.isArray(rows)?rows:[];
}

async function fetchBoothProductsBySmaregiProductIds(productIds){
  const ids=[...new Set((productIds||[]).map(id=>String(id||"").trim()).filter(Boolean))];
  if(!ids.length)return [];
  const rows=await sb(`products?select=*&smaregi_product_id=in.(${buildInFilter(ids)})&limit=2000`);
  return Array.isArray(rows)?rows:[];
}

async function getConfirmedBoothSalesQty(eventId,barcode){
  const rows=await sb(`event_sales_imports?select=quantity&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&import_status=eq.confirmed&limit=2000`).catch(()=>[]);
  return (Array.isArray(rows)?rows:[]).reduce((sum,row)=>sum+Number(row.quantity||0),0);
}

function calculateBoothItemDifference(item){
  const itemType=String(item?.item_type||"normal");
  const gachaConsumed=itemType==="gacha_prize"?Number(item?.consumed_qty||0):0;
  const taken=itemType==="normal"&&typeof getBoothNormalCarryOutTotalQty==="function"
    ?getBoothNormalCarryOutTotalQty(item)
    :Number(item?.taken_qty||0);
  return taken-Number(item?.sold_qty||0)-Number(item?.returned_qty||0)-gachaConsumed;
}

async function confirmBoothNegativeCarryOut(currentQty,takeoutQty,afterQty){
  const body=[
    "通常棚在庫が不足しています。",
    "",
    `現在庫：${currentQty}`,
    `持ち出し：${takeoutQty}`,
    `持ち出し後：${afterQty}`,
    "",
    "このまま持ち出しを登録しますか？"
  ].join("\n");
  if(typeof confirmAppAction==="function"){
    return await confirmAppAction("通常棚在庫が不足しています",body,{okText:"マイナス在庫で登録",cancelText:"キャンセル"});
  }
  return window.confirm(body);
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

function boothDiffRowKey(row){
  const store=String(row.store_code||row.source_store_code||"").trim().toLowerCase();
  const product=String(row.barcode||row.smaregi_product_id||row.product_id||"").trim();
  return `${store||"event"}::${product}`;
}

function upsertBoothDiffUniverseRow(map,row){
  const key=boothDiffRowKey(row);
  const current=map.get(key)||{
    id:"",
    event_id:row.event_id||"",
    barcode:row.barcode||"",
    product_name:row.product_name||"",
    item_type:row.item_type||"normal",
    smaregi_product_id:row.smaregi_product_id||"",
    store_code:row.store_code||row.source_store_code||"",
    taken_qty:null,
    sold_qty:0,
    returned_qty:0,
    consumed_qty:0,
    difference_qty:0,
    diff_memo:"",
    updated_at:"",
    source_flags:new Set(),
    source_status:""
  };
  current.id=current.id||row.id||"";
  current.barcode=current.barcode||row.barcode||"";
  current.product_name=current.product_name||row.product_name||"";
  current.item_type=row.item_type||current.item_type||"normal";
  current.smaregi_product_id=current.smaregi_product_id||row.smaregi_product_id||"";
  current.store_code=current.store_code||row.store_code||row.source_store_code||"";
  if(row.taken_qty!==undefined&&row.taken_qty!==null)current.taken_qty=Number(current.taken_qty||0)+Number(row.taken_qty||0);
  if(row.sold_qty!==undefined)current.sold_qty+=Number(row.sold_qty||0);
  if(row.returned_qty!==undefined)current.returned_qty+=Number(row.returned_qty||0);
  if(row.consumed_qty!==undefined)current.consumed_qty+=Number(row.consumed_qty||0);
  current.diff_memo=current.diff_memo||row.diff_memo||"";
  current.updated_at=[current.updated_at,row.updated_at,row.created_at,row.sold_at].filter(Boolean).sort().pop()||"";
  (row.source_flags||[]).forEach(flag=>current.source_flags.add(flag));
  map.set(key,current);
}

async function buildBoothDiffUniverseRows(eventId){
  const [eventRows,items,sales,movements]=await Promise.all([
    sb(`booth_events?select=id,store_code&id=eq.${encodeURIComponent(eventId)}&limit=1`).catch(()=>[]),
    sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,updated_at&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc&limit=3000`).catch(()=>[]),
    sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed)&order=sold_at.asc&limit=3000`).catch(()=>[]),
    sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,memo,movement_type,item_type,takeout_source,store_code&event_id=eq.${encodeURIComponent(eventId)}&order=created_at.desc&limit=3000`).catch(()=>[])
  ]);
  const eventStoreCode=String((Array.isArray(eventRows)&&eventRows[0]?.store_code)||getBoothCurrentStoreCode?.()||"").toLowerCase();
  const map=new Map();
  const itemRows=(Array.isArray(items)?items:[]).filter(row=>String(row.item_type||"normal")==="normal");
  const salesRows=dedupeBoothSalesRows(sales).filter(row=>!isBoothGachaSaleRow(row));
  const movementRows=(Array.isArray(movements)?movements:[]).filter(row=>String(row.item_type||"normal")!=="gacha_prize");
  const productIds=[...new Set(salesRows.map(row=>String(row.smaregi_product_id||"").trim()).filter(Boolean))];
  const saleProducts=await fetchBoothProductsBySmaregiProductIds(productIds).catch(()=>[]);
  const productBySmaregiId=new Map((saleProducts||[]).map(product=>[String(product.smaregi_product_id||""),product]));
  itemRows.forEach(item=>{
    upsertBoothDiffUniverseRow(map,{
      ...item,
      store_code:eventStoreCode,
      taken_qty:Number(item.taken_qty||0),
      sold_qty:Number(item.sold_qty||0),
      returned_qty:Number(item.returned_qty||0),
      consumed_qty:Number(item.consumed_qty||0),
      source_flags:["event_item"]
    });
  });
  salesRows.forEach(sale=>{
    const product=productBySmaregiId.get(String(sale.smaregi_product_id||""))||{};
    upsertBoothDiffUniverseRow(map,{
      event_id:eventId,
      barcode:sale.barcode||product.barcode||String(sale.smaregi_product_id||""),
      product_name:sale.product_name||product.name||"",
      smaregi_product_id:sale.smaregi_product_id||"",
      store_code:sale.store_code||eventStoreCode,
      sold_qty:Number(sale.quantity||0),
      sold_at:sale.sold_at,
      source_flags:["sales_import"]
    });
  });
  movementRows.forEach(move=>{
    const movement=String(move.movement_type||"");
    const itemType=String(move.item_type||"normal");
    const qty=Number(move.quantity||0);
    upsertBoothDiffUniverseRow(map,{
      event_id:eventId,
      barcode:move.barcode||"",
      product_name:move.product_name||"",
      item_type:itemType,
      store_code:move.store_code||eventStoreCode,
      returned_qty:movement==="return"||movement==="gacha_return"||movement==="event_close_return"?qty:0,
      consumed_qty:movement==="gacha_pick"?qty:0,
      created_at:move.created_at,
      source_flags:["stock_movement"]
    });
  });
  const rows=[...map.values()].map(row=>{
    const takenRegistered=row.taken_qty!==null&&row.taken_qty!==undefined;
    const normalized={...row,taken_qty:takenRegistered?Number(row.taken_qty||0):0};
    const diff=calculateBoothItemDifference(normalized);
    const flags=[...row.source_flags];
    return {
      ...normalized,
      taken_registered:takenRegistered,
      difference_qty:diff,
      source_status:takenRegistered?"":"持ち出し未登録",
      source_flags:flags
    };
  }).sort((a,b)=>String(a.product_name||"").localeCompare(String(b.product_name||""),"ja",{numeric:true,sensitivity:"base"}));
  return rows;
}

async function loadBoothDiffList(eventId){
  const list=el("boothDiffList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const rowsAll=await buildBoothDiffUniverseRows(eventId);
    const keyword=String(el("boothDiffSearch")?.value||"").trim().toLowerCase();
    const diffOnly=Boolean(el("boothDiffOnly")?.checked);
    let rows=rowsAll;
    if(keyword){
      rows=rows.filter(row=>{
        return String(row.product_name||"").toLowerCase().includes(keyword)
          || String(row.barcode||"").toLowerCase().includes(keyword)
          || String(row.smaregi_product_id||"").toLowerCase().includes(keyword)
          || String(row.store_code||"").toLowerCase().includes(keyword);
      });
    }
    if(diffOnly)rows=rows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
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
    list.innerHTML='<div class="booth-empty">表示対象の商品はありません。持ち出し、販売、ガチャ、戻り、その他イベント変動がすべて0件の場合のみ空になります。</div>';
    return;
  }
  const tableRows=rows.map(row=>{
    const status=row.taken_registered?getBoothDiffStatus(row):{label:"持ち出し未登録",className:"is-warn"};
    const diff=calculateBoothItemDifference(row);
    const canSave=Boolean(row.id);
    return `<tr class="booth-diff-row ${esc(status.className)}">
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td>${esc(row.store_code||"-")}</td>
      <td>${row.taken_registered?esc(row.taken_qty??0):"未登録"}</td>
      <td>${esc(row.sold_qty??0)}</td>
      <td>${esc(row.returned_qty??0)}</td>
      <td>${esc(row.consumed_qty??0)}</td>
      <td><strong>${esc(diff)}</strong></td>
      <td><span class="booth-diff-status ${esc(status.className)}">${esc(status.label)}</span></td>
      <td>${canSave?`<textarea id="boothDiffMemo_${esc(row.id)}" class="booth-diff-memo" placeholder="差異確認メモ">${esc(row.diff_memo||"")}</textarea>`:"-"}</td>
      <td>${esc(formatBoothDateTime(row.updated_at))}</td>
      <td><div class="booth-diff-actions">${canSave?`<button type="button" class="secondary booth-diff-save-btn" data-diff-item-id="${esc(row.id)}">メモ保存</button>`:""}<button type="button" class="secondary booth-diff-ai-btn" data-diff-key="${esc(boothDiffRowKey(row))}">AIで原因を分析</button></div></td>
    </tr>`;
  }).join("");
  const cardRows=rows.map(row=>{
    const status=row.taken_registered?getBoothDiffStatus(row):{label:"持ち出し未登録",className:"is-warn"};
    const diff=calculateBoothItemDifference(row);
    const canSave=Boolean(row.id);
    return `<article class="booth-history-card booth-diff-item-card ${esc(status.className)}">
      <div class="booth-history-card-top">
        <strong>${esc(row.product_name||"-")}</strong>
        <span class="booth-diff-status ${esc(status.className)}">${esc(status.label)}</span>
      </div>
      <div class="booth-history-card-meta">
        <span>バーコード：${esc(row.barcode||"-")}</span>
        <span>比較店舗：${esc(row.store_code||"-")}</span>
        <span>持ち出し：${row.taken_registered?esc(row.taken_qty??0):"未登録"} / 販売：${esc(row.sold_qty??0)} / 戻り：${esc(row.returned_qty??0)} / 消費：${esc(row.consumed_qty??0)}</span>
        <span>差異：${esc(diff)}</span>
        <span>最終更新：${esc(formatBoothDateTimeShort(row.updated_at))}</span>
      </div>
      ${canSave?`<textarea id="boothDiffMemoCard_${esc(row.id)}" class="booth-diff-memo" placeholder="差異確認メモ">${esc(row.diff_memo||"")}</textarea>
      <button type="button" class="secondary booth-diff-save-btn" data-diff-item-id="${esc(row.id)}">メモ保存</button>`:""}
      <button type="button" class="secondary booth-diff-ai-btn" data-diff-key="${esc(boothDiffRowKey(row))}">AIで原因を分析</button>
      <div class="booth-ai-result" id="boothAiResult_${esc(boothDiffRowKey(row)).replace(/[^a-zA-Z0-9_-]/g,"_")}"></div>
    </article>`;
  }).join("");
  list.innerHTML=`
    <div class="booth-diff-summary">表示 ${esc(rows.length)} 件。母集団は持ち出し確定、スマレジ販売、ガチャ、戻り、イベント変動を統合して作成しています。</div>
    <div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-diff-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>比較店舗</th><th>持ち出し</th><th>販売</th><th>戻り</th><th>消費</th><th>差異</th><th>状態</th><th>メモ</th><th>最終更新</th><th>操作</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards booth-scroll-cards">${cardRows}</div>`;
  list.querySelectorAll("[data-diff-item-id]").forEach(button=>{
    button.addEventListener("click",()=>saveBoothDiffMemo(button.dataset.diffItemId));
  });
  window.__boothDiffRowsForAi=new Map(rows.map(row=>[boothDiffRowKey(row),row]));
  list.querySelectorAll(".booth-diff-ai-btn").forEach(button=>{
    button.addEventListener("click",()=>analyzeBoothDiffWithAi(button.dataset.diffKey,button));
  });
}

async function analyzeBoothDiffWithAi(diffKey,button){
  const row=window.__boothDiffRowsForAi?.get(diffKey);
  if(!row){
    boothShowError("AI分析エラー","分析対象の商品が見つかりません。");
    return;
  }
  const event=getBoothCurrentEvent();
  const resultId=`boothAiResult_${String(diffKey||"").replace(/[^a-zA-Z0-9_-]/g,"_")}`;
  const resultEl=document.getElementById(resultId);
  const oldText=button?.textContent;
  try{
    if(button){button.disabled=true;button.textContent="AI分析中...";}
    if(resultEl)resultEl.innerHTML='<div class="message">AI分析中...</div>';
    const response=await fetch("/api/booth-diff-ai",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        event:{
          id:event?.id||"",
          name:event?.name||"",
          event_start:event?.event_start||"",
          event_end:event?.event_end||"",
          store_code:event?.store_code||getBoothCurrentStoreCode?.()||""
        },
        product:{
          product_name:row.product_name||"",
          barcode:row.barcode||"",
          smaregi_product_id:row.smaregi_product_id||""
        },
        inventory:{
          store_code:row.store_code||"",
          taken_qty:row.taken_registered?row.taken_qty:"未登録",
          sold_qty:row.sold_qty??0,
          returned_qty:row.returned_qty??0,
          consumed_qty:row.consumed_qty??0,
          difference_qty:calculateBoothItemDifference(row),
          source_flags:row.source_flags||[]
        },
        histories:{
          diff_memo:row.diff_memo||"",
          updated_at:row.updated_at||""
        }
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`AI API ${response.status}`);
    const html=`<div class="booth-ai-analysis">
      <strong>AI分析</strong>
      <div><span>原因候補：</span>${esc(data.cause||"-")}</div>
      <div><span>確信度：</span>${esc(data.confidence||"-")}</div>
      <div><span>根拠：</span>${esc(data.evidence||"-")}</div>
      <div><span>確認推奨：</span>${esc(data.recommended_check||"-")}</div>
    </div>`;
    if(resultEl)resultEl.innerHTML=html;
    else boothShowSuccess("AI分析",`${data.cause||""}\n確信度：${data.confidence||""}\n確認推奨：${data.recommended_check||""}`);
  }catch(e){
    if(resultEl)resultEl.innerHTML=`<div class="message err">AI分析エラー：${esc(e.message)}</div>`;
    boothShowError("AI分析エラー",e.message);
  }finally{
    if(button){button.disabled=false;button.textContent=oldText||"AIで原因を分析";}
  }
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

function getBoothSalesImportKey(row){
  return `${String(row?.smaregi_transaction_id||"").trim()}::${String(row?.smaregi_detail_id||"").trim()}`;
}

function getBoothSalesRowTimestamp(row){
  return Date.parse(String(row?.updated_at||row?.imported_at||row?.sold_at||""))||0;
}

function dedupeBoothSalesRows(rows){
  const map=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    const status=String(row?.import_status||"").trim().toLowerCase();
    if(status&&!["pending","confirmed"].includes(status))return;
    const key=getBoothSalesImportKey(row);
    if(key==="::")return;
    const current=map.get(key);
    if(!current||getBoothSalesRowTimestamp(row)>=getBoothSalesRowTimestamp(current))map.set(key,row);
  });
  return [...map.values()].sort((a,b)=>String(a?.sold_at||"").localeCompare(String(b?.sold_at||"")));
}

function normalizeBoothSalesIdentity(value){
  return String(value??"").trim().toLowerCase();
}

function setBoothSalesImportSummary(message,className="message"){
  const status=el("boothSalesRegisterStatus");
  if(!status)return;
  status.className=className;
  status.style.whiteSpace="pre-wrap";
  status.textContent=message;
}

async function fetchExistingBoothSalesImportMap(eventId){
  const rows=await sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed,cancelled)&limit=5000`);
  const map=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    map.set(getBoothSalesImportKey(row),row);
  });
  return map;
}

async function saveBoothSalesImportRows(rows,existingMap){
  const uniqueRows=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    const key=getBoothSalesImportKey(row);
    if(key!=="::")uniqueRows.set(key,row);
  });
  const insertRows=[];
  const updateRows=[];
  uniqueRows.forEach(row=>{
    const existing=existingMap.get(getBoothSalesImportKey(row));
    if(existing)updateRows.push({existing,row});
    else insertRows.push(row);
  });
  if(insertRows.length){
    await sb("event_sales_imports",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify(insertRows)
    });
  }
  for(const {existing,row} of updateRows){
    const {event_id,smaregi_transaction_id,smaregi_detail_id,import_status,...update}=row;
    // A confirmed sale has already changed the event shelf. Re-fetching the
    // same API detail must never turn it back into an unconfirmed sale.
    update.import_status=existing.import_status==="confirmed"?"confirmed":"pending";
    if(existing.import_status==="confirmed"&&Number(existing.quantity||0)!==Number(row.quantity||0)){
      // Do not silently apply a second stock movement for a changed confirmed
      // detail. Keep the confirmed quantity until a human reviews it.
      update.quantity=existing.quantity;
      update.unit_price=existing.unit_price;
      update.amount=existing.amount;
    }
    await sb(`event_sales_imports?id=eq.${encodeURIComponent(existing.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify(update)
    });
  }
  return {inserted:insertRows.length,updated:updateRows.length,unique:uniqueRows.size};
}

async function cancelMissingBoothSalesImports(eventId,existingMap,activeKeys,form){
  const from=Date.parse(`${form.fromDate}T00:00:00+09:00`);
  const to=Date.parse(`${form.toDate}T23:59:59+09:00`);
  const registerCode=normalizeBoothSalesIdentity(form.register?.code);
  const terminalId=normalizeBoothSalesIdentity(form.register?.terminalId||form.register?.registerId);
  const now=new Date().toISOString();
  for(const existing of existingMap.values()){
    if(!["pending","confirmed"].includes(existing.import_status))continue;
    if(registerCode&&normalizeBoothSalesIdentity(existing.target_register_code)!==registerCode)continue;
    const existingTerminal=normalizeBoothSalesIdentity(existing.smaregi_terminal_id||existing.smaregi_register_id);
    if(terminalId&&existingTerminal&&existingTerminal!==terminalId)continue;
    const soldAt=Date.parse(String(existing.sold_at||""));
    if(Number.isFinite(soldAt)&&((Number.isFinite(from)&&soldAt<from)||(Number.isFinite(to)&&soldAt>to)))continue;
    if(activeKeys.has(getBoothSalesImportKey(existing)))continue;
    // Keep the row for auditability, but remove it from the pending quantity.
    // Confirmed rows are marked cancelled for human review; no automatic shelf
    // restoration is performed from a preview refresh.
    await sb(`event_sales_imports?id=eq.${encodeURIComponent(existing.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({import_status:"cancelled",updated_at:now})
    });
  }
}

async function loadBoothSalesImports(eventId){
  const list=el("boothSalesImportList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">仮取り込み一覧を読み込み中...</div>';
    const [imports,items]=await Promise.all([
      sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed,cancelled)&order=sold_at.asc&limit=2000`),
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
    const hasItem=Boolean(item.id);
    const imported=Number(row.quantity||0);
    const diff=hasItem?getBoothSalesDifference(item,imported):"持ち出し未確定";
    const statusLabel=row.import_status==="confirmed"?"確定済み":row.import_status==="cancelled"?"取消・変更":"未確定";
    return `<tr>
      <td>${esc(formatBoothDateTime(row.sold_at))}</td>
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td>${esc(row.smaregi_product_id||"-")}</td>
      <td>${esc(row.target_register_name||"-")}</td>
      <td>${hasItem?esc(item.taken_qty??0):"未確定"}</td>
      <td>${esc(imported)}</td>
      <td>${hasItem?esc(item.returned_qty??0):"-"}</td>
      <td>${esc(diff)}</td>
      <td>${esc(statusLabel)}</td>
      <td>${esc(row.smaregi_transaction_id||"-")} / ${esc(row.smaregi_detail_id||"-")}</td>
    </tr>`;
  }).join("");
  const cardRows=rows.map(row=>{
    const item=itemMap.get(String(row.barcode||""))||{};
    const hasItem=Boolean(item.id);
    const imported=Number(row.quantity||0);
    const diff=hasItem?getBoothSalesDifference(item,imported):"持ち出し未確定";
    const statusLabel=row.import_status==="confirmed"?"確定済み":row.import_status==="cancelled"?"取消・変更":"未確定";
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
        <span>状態：${esc(statusLabel)}</span>
        <span>取引：${esc(row.smaregi_transaction_id||"-")} / ${esc(row.smaregi_detail_id||"-")}</span>
      </div>
    </article>`;
  }).join("");
  const pendingCount=rows.filter(row=>row.import_status==="pending").length;
  const confirmedCount=rows.filter(row=>row.import_status==="confirmed").length;
  const cancelledCount=rows.filter(row=>row.import_status==="cancelled").length;
  list.innerHTML=`
    <div class="booth-sales-import-summary">未確定 ${esc(pendingCount)} 件 / 確定済み ${esc(confirmedCount)} 件 / 取消・変更 ${esc(cancelledCount)} 件。未確定分だけを販売確定できます。</div>
    <div class="booth-history-table-wrap"><table class="booth-history-table booth-sales-table">
      <thead><tr><th>販売日時</th><th>商品名</th><th>バーコード</th><th>商品ID</th><th>対象レジ</th><th>持ち出し</th><th>販売候補</th><th>戻り</th><th>差異見込み</th><th>状態</th><th>取引ID</th></tr></thead>
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
    ? await confirmAppAction("開催中販売の最新取得確認",`${getBoothSalesContextSummary(event,fromDate,toDate)}\n\nこの条件で最新販売を取得します。在庫数は変更しません。`,{okText:"最新販売を取得"})
    : true;
  if(!ok)return;

  try{
    const items=await fetchBoothEventItems(event.id);
    const products=await fetchBoothProductsForItems(items);
    const itemByBarcode=new Map();
    const itemByProductCode=new Map();
    const itemByProductId=new Map();
    const productBySmaregiId=new Map();
    const productByBarcode=new Map();
    const productByCode=new Map();
    const addCandidate=(map,key,value)=>{
      if(!key)return;
      const list=map.get(key)||[];
      if(!list.some(candidate=>String(candidate?.barcode||"")===String(value?.barcode||"")))list.push(value);
      map.set(key,list);
    };
    items.forEach(item=>{
      addCandidate(itemByBarcode,normalizeBoothSalesIdentity(item.barcode),item);
      addCandidate(itemByProductCode,normalizeBoothSalesIdentity(item.product_code||item.productCode||item.code),item);
    });
    products.forEach(product=>{
      const productId=String(product.smaregi_product_id||"").trim();
      const barcode=normalizeBoothSalesIdentity(product.barcode);
      const productCode=normalizeBoothSalesIdentity(product.product_code||product.productCode||product.code);
      const item=(itemByBarcode.get(barcode)||[])[0];
      if(productId){
        addCandidate(productBySmaregiId,normalizeBoothSalesIdentity(productId),product);
        if(item)addCandidate(itemByProductId,normalizeBoothSalesIdentity(productId),{...item,smaregi_product_id:productId,product_name:item.product_name||product.name||""});
      }
      addCandidate(productByBarcode,barcode,product);
      addCandidate(productByCode,productCode,product);
    });
    // Gacha products are not normal event-shelf items, but their sales are
    // part of the event report and must be fetched with booth sales.
    const productIds=[...new Set([
      ...itemByProductId.keys(),
      ...BOOTH_GACHA_SMAREGI_PRODUCT_IDS
    ])];
    const missingProductIds=items.filter(item=>{
      const productList=itemByBarcode.get(normalizeBoothSalesIdentity(item.barcode))||[];
      return !productList.some(product=>String(product.smaregi_product_id||"").trim());
    });
    if(!productIds.length){
      const message=`販売データは取得しましたが、商品マスター照合用のスマレジ商品IDがありません。\n取得明細：0件\n未照合：${items.length}件\n商品を自動作成せず、商品マスターのスマレジ商品IDを確認してください。`;
      setBoothSalesImportSummary(message,"message warn");
      await loadBoothSalesImports(event.id);
      return;
    }

    const fromDateTime=String(event.event_start||"").includes("T")?event.event_start:null;
    const toDateTime=String(event.event_end||"").includes("T")?event.event_end:null;
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
        fromDateTime,
        toDateTime,
        smaregiProductIds:productIds
      })
    });
    const body=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(body?.error||`スマレジ販売データ取得エラー ${response.status}`);

    const salesProductIds=[...new Set((body.sales||[]).map(sale=>String(sale.smaregi_product_id||"").trim()).filter(Boolean))];
    const saleProducts=await fetchBoothProductsBySmaregiProductIds(salesProductIds);
    (saleProducts||[]).forEach(product=>{
      const productId=normalizeBoothSalesIdentity(product.smaregi_product_id);
      if(productId)addCandidate(productBySmaregiId,productId,product);
      addCandidate(productByBarcode,normalizeBoothSalesIdentity(product.barcode),product);
      addCandidate(productByCode,normalizeBoothSalesIdentity(product.product_code||product.productCode||product.code),product);
    });

    const uniqueSales=new Map();
    (body.sales||[]).forEach(sale=>{
      const key=getBoothSalesImportKey(sale);
      if(key!=="::")uniqueSales.set(key,sale);
    });
    const activeKeys=new Set(uniqueSales.keys());
    const unmatched=[];
    const duplicateMatches=[];
    const rows=[];
    const now=new Date().toISOString();
    uniqueSales.forEach(sale=>{
      const smaregiProductId=String(sale.smaregi_product_id||"").trim();
      const productCode=normalizeBoothSalesIdentity(sale.product_code||sale.productCode||sale.code);
      const barcode=normalizeBoothSalesIdentity(sale.barcode);
      const productCandidates=[...(productBySmaregiId.get(normalizeBoothSalesIdentity(smaregiProductId))||[])];
      const itemCandidates=[...(itemByProductId.get(normalizeBoothSalesIdentity(smaregiProductId))||[])];
      if(!productCandidates.length&&barcode)productCandidates.push(...(productByBarcode.get(barcode)||[]));
      if(!productCandidates.length&&productCode)productCandidates.push(...(productByCode.get(productCode)||[]));
      const product=productCandidates[0];
      if(productCandidates.length>1){
        duplicateMatches.push({sale,productCandidates});
        unmatched.push({sale,reason:"商品マスターが複数件一致"});
        return;
      }
      let item=itemCandidates[0];
      if(!item&&product)item=(itemByBarcode.get(normalizeBoothSalesIdentity(product.barcode))||[])[0];
      if(!item&&barcode)item=(itemByBarcode.get(barcode)||[])[0];
      if(!item&&productCode)item=(itemByProductCode.get(productCode)||[])[0];
      const isGachaSale=isBoothGachaSaleRow(sale);
      if(!item&&!isGachaSale){
        unmatched.push({sale,reason:smaregiProductId?"イベント商品未登録":"スマレジ商品IDなし"});
        return;
      }
      const rowBarcode=String(item?.barcode||product?.barcode||barcode||"").trim();
      const quantity=Number(sale.quantity||0);
      if(!rowBarcode||!quantity){
        unmatched.push({sale,reason:!rowBarcode?"バーコードなし":"数量0"});
        return;
      }
      rows.push({
        event_id:event.id,
        smaregi_transaction_id:String(sale.smaregi_transaction_id||""),
        smaregi_detail_id:String(sale.smaregi_detail_id||""),
        smaregi_product_id:smaregiProductId,
        barcode:rowBarcode,
        product_name:item?.product_name||product?.name||sale.product_name||"",
        quantity,
        unit_price:Number(sale.unit_price||0),
        amount:Number(sale.amount||0),
        sold_at:sale.sold_at||null,
        store_code:context.storeCode,
        smaregi_store_id:body.context?.storeId||null,
        target_register_code:body.context?.targetRegisterCode||register.code,
        target_register_name:body.context?.targetRegisterName||register.name,
        smaregi_register_id:body.context?.targetRegisterId||body.context?.targetTerminalId||sale.smaregi_terminal_id||null,
        smaregi_terminal_id:sale.smaregi_terminal_id||body.context?.targetTerminalId||null,
        import_status:"pending",
        imported_by:staff,
        imported_at:body.fetchedAt||now,
        updated_at:now
      });
    });

    const salesTotalQty=rows.reduce((sum,row)=>sum+Number(row.quantity||0),0);
    const salesTotalAmount=rows.reduce((sum,row)=>sum+Number(row.amount||0),0);
    const unmatchedLines=unmatched.slice(0,10).map(({sale,reason})=>`${sale.smaregi_transaction_id||"-"}/${sale.smaregi_detail_id||"-"}: ${reason}`);
    const summary=[
      `最新取得：${Number(body.transactionsCount||0)}取引 / ${uniqueSales.size}明細`,
      `照合済み：${rows.length}明細 / 販売数量：${salesTotalQty}個 / 売上：${salesTotalAmount}`,
      `未照合：${unmatched.length}明細 / 商品IDなし：${missingProductIds.length}商品`,
      `取得日時：${body.fetchedAt||now}`
    ];
    if(unmatchedLines.length)summary.push(`未照合明細（先頭${unmatchedLines.length}件）：\n${unmatchedLines.join("\n")}`);
    if(duplicateMatches.length){
      summary.unshift("商品マスター重複のため保存を中止しました。重複を解消してから再取得してください。");
      setBoothSalesImportSummary(summary.join("\n"),"message err");
      await loadBoothSalesImports(event.id);
      return;
    }

    const existingMap=await fetchExistingBoothSalesImportMap(event.id);
    await cancelMissingBoothSalesImports(event.id,existingMap,activeKeys,form);

    if(rows.length){
      try{
        await saveBoothSalesImportRows(rows,existingMap);
      }catch(insertError){
        if(!String(insertError?.message||"").includes("unit_price")&&!String(insertError?.message||"").includes("amount"))throw insertError;
        const fallbackRows=rows.map(({unit_price,amount,...row})=>row);
        await saveBoothSalesImportRows(fallbackRows,existingMap);
      }
    }
    await loadBoothSalesImports(event.id);
    setBoothSalesImportSummary(summary.join("\n"),unmatched.length?"message warn":"message ok");
    boothShowSuccess("販売データ取得完了",`最新販売を ${rows.length} 明細へ更新しました。DB在庫は変更していません。`);
  }catch(e){
    boothShowError("販売取得エラー","開催中販売の取得に失敗しました。\n"+e.message);
  }
}

async function refreshBoothOngoingSalesCache(apiContext={}){
  const context={
    ...(typeof getSmaregiRequestContext==="function"?getSmaregiRequestContext():{}),
    ...(apiContext||{})
  };
  const storeCode=String(context.storeCode||window.currentStore||"tokyo").trim().toLowerCase()||"tokyo";
  const today=new Date().toISOString().slice(0,10);
  try{
    const events=await sb(`booth_events?select=*&store_code=eq.${encodeURIComponent(storeCode)}&limit=1000`);
    const activeEvents=(Array.isArray(events)?events:[]).filter(event=>{
      if(String(event.status||"").toLowerCase()==="closed")return false;
      const start=String(event.event_start||"").slice(0,10);
      const end=String(event.event_end||event.event_start||"").slice(0,10);
      return (!start||today>=start)&&(!end||today<=end);
    });
    if(!activeEvents.length){
      window.__smaregiOngoingSalesState={ok:true,hasOngoingEvent:false,fetchedAt:new Date().toISOString()};
      return window.__smaregiOngoingSalesState;
    }
    const settings=await sb(`event_register_settings?select=*&store_code=eq.${encodeURIComponent(storeCode)}&limit=1`).catch(()=>[]);
    const setting=Array.isArray(settings)&&settings[0]?settings[0]:{};
    const register={
      code:"event",
      name:setting.register_name||`${storeCode}イベントレジ`,
      registerId:String(setting.register_id||""),
      terminalId:String(setting.terminal_id||setting.register_id||"")
    };
    if(!register.terminalId)throw new Error(`${storeCode}店のイベント販売用端末IDが未設定です。`);

    let fetchedAt="";
    let detailCount=0;
    for(const event of activeEvents){
      const items=(await fetchBoothEventItems(event.id)).filter(item=>String(item.item_type||"normal")==="normal");
      const normalProducts=await fetchBoothProductsForItems(items);
      const gachaProducts=await fetchBoothProductsBySmaregiProductIds([...BOOTH_GACHA_SMAREGI_PRODUCT_IDS]).catch(()=>[]);
      const products=[...normalProducts,...gachaProducts];
      const itemByBarcode=new Map(items.map(item=>[normalizeBoothSalesIdentity(item.barcode),item]));
      const productById=new Map();
      products.forEach(product=>{
        const id=normalizeBoothSalesIdentity(product.smaregi_product_id);
        if(id&&!productById.has(id))productById.set(id,product);
      });
      const productIds=[...new Set([
        ...productById.keys(),
        ...BOOTH_GACHA_SMAREGI_PRODUCT_IDS
      ])];
      if(!productIds.length)throw new Error(`${event.name||"開催中イベント"}の商品にスマレジ商品IDが設定されていません。`);
      const fromDate=String(event.event_start||today).slice(0,10);
      const toDate=String(event.event_end||today).slice(0,10);
      const response=await fetch("./api/smaregi-event-sales",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          ...context,
          storeCode,
          targetRegisterCode:register.code,
          targetRegisterName:register.name,
          targetRegisterId:register.registerId,
          targetTerminalId:register.terminalId,
          fromDate,
          toDate,
          smaregiProductIds:productIds
        })
      });
      const body=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(body?.error||`イベント販売API ${response.status}`);
      fetchedAt=body?.fetchedAt||new Date().toISOString();
      const sales=Array.isArray(body?.sales)?body.sales:[];
      const saleProductIds=[...new Set(sales.map(sale=>String(sale.smaregi_product_id||"").trim()).filter(Boolean))];
      const saleProducts=await fetchBoothProductsBySmaregiProductIds(saleProductIds);
      const saleProductById=new Map((saleProducts||[]).map(product=>[normalizeBoothSalesIdentity(product.smaregi_product_id),product]));
      const rows=[];
      const activeKeys=new Set();
      sales.forEach(sale=>{
        const key=getBoothSalesImportKey(sale);
        if(key==="::")return;
        activeKeys.add(key);
        const product=saleProductById.get(normalizeBoothSalesIdentity(sale.smaregi_product_id))||productById.get(normalizeBoothSalesIdentity(sale.smaregi_product_id));
        const item=itemByBarcode.get(normalizeBoothSalesIdentity(product?.barcode));
        const isGachaSale=isBoothGachaSaleRow(sale);
        const quantity=Number(sale.quantity||0);
        if((!item&&!isGachaSale)||!product||!quantity)return;
        rows.push({
          event_id:event.id,
          smaregi_transaction_id:String(sale.smaregi_transaction_id||""),
          smaregi_detail_id:String(sale.smaregi_detail_id||""),
          smaregi_product_id:String(sale.smaregi_product_id||""),
          barcode:String(item?.barcode||product.barcode||""),
          product_name:item?.product_name||product.name||sale.product_name||"",
          quantity,
          unit_price:Number(sale.unit_price||0),
          amount:Number(sale.amount||0),
          sold_at:sale.sold_at||null,
          store_code:storeCode,
          smaregi_store_id:body.context?.storeId||null,
          target_register_code:body.context?.targetRegisterCode||register.code,
          target_register_name:body.context?.targetRegisterName||register.name,
          smaregi_register_id:body.context?.targetRegisterId||register.registerId||register.terminalId,
          smaregi_terminal_id:sale.smaregi_terminal_id||register.terminalId,
          import_status:"pending",
          imported_by:"smaregi-sync",
          imported_at:fetchedAt,
          updated_at:new Date().toISOString()
        });
      });
      const existingMap=await fetchExistingBoothSalesImportMap(event.id);
      await cancelMissingBoothSalesImports(event.id,existingMap,activeKeys,{fromDate,toDate,register});
      if(rows.length)await saveBoothSalesImportRows(rows,existingMap);
      detailCount+=sales.length;
    }
    window.__smaregiOngoingSalesState={ok:true,hasOngoingEvent:true,fetchedAt,detailCount};
    return window.__smaregiOngoingSalesState;
  }catch(error){
    window.__smaregiOngoingSalesState={ok:false,hasOngoingEvent:true,error:String(error?.message||error)};
    throw error;
  }
}

window.refreshBoothOngoingSalesCache=refreshBoothOngoingSalesCache;

async function confirmBoothSalesImport(){
  const form=validateBoothSalesForm();
  if(!form)return;
  const {event,fromDate,toDate,staff}=form;
  try{
    const pending=await sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(event.id)}&import_status=eq.pending&order=sold_at.asc&limit=500`);
    const rows=(Array.isArray(pending)?pending:[]).filter(row=>!isBoothGachaSaleRow(row));
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

async function renderBoothEventReportPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-event-report-card">
    <div class="booth-list-header">
      <div>
        <h4>イベントレポート</h4>
        <p class="section-note">指定イベントの販売・ガチャ・棚卸結果を集計表示します。スマレジ在庫や products.base_stock は変更しません。</p>
      </div>
      <button type="button" id="boothEventReportReloadBtn" class="secondary">再読み込み</button>
    </div>
    <div id="boothEventReportBody" class="booth-event-report-body"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  el("boothEventReportReloadBtn")?.addEventListener("click",()=>loadBoothEventReport(event.id));
  loadBoothEventReport(event.id);
}

async function loadBoothEventReport(eventId){
  const body=el("boothEventReportBody");
  if(!body)return;
  try{
    body.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const [items,imports,movements]=await Promise.all([
      sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,event_storage_qty,shelf_return_qty,updated_at&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc&limit=2000`),
      sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed)&order=sold_at.asc&limit=2000`).catch(()=>[]),
      sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,memo,movement_type,item_type&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(departure_count,return,gacha_pick,gacha_return)&order=created_at.desc&limit=2000`).catch(()=>[])
    ]);
    const rows=Array.isArray(items)?items:[];
    const normal=rows.filter(row=>String(row.item_type||"normal")==="normal");
    const gacha=rows.filter(row=>String(row.item_type||"")==="gacha_prize");
    const salesRows=Array.isArray(imports)?imports:[];
    const movementRows=Array.isArray(movements)?movements:[];
    const totalSalesQty=salesRows.reduce((sum,row)=>sum+Number(row.quantity||0),0);
    const totalGachaRegistered=gacha.reduce((sum,row)=>sum+Number(row.taken_qty||0),0);
    const totalGachaUsed=gacha.reduce((sum,row)=>sum+Number(boothGachaUsedQty(row)||0),0);
    const totalGachaUsedConfirmed=gacha.length>0&&gacha.every(row=>isBoothGachaReturnCounted(row));
    const totalStart=normal.reduce((sum,row)=>sum+Number(row.taken_qty||0),0);
    const totalReturned=normal.reduce((sum,row)=>sum+Number(row.returned_qty||0),0);
    const totalRemain=normal.reduce((sum,row)=>sum+calculateBoothItemDifference(row),0);
    const departureLogs=movementRows.filter(row=>String(row.movement_type)==="departure_count");
    body.innerHTML=`
      <div class="booth-report-summary-grid">
        <div><span>開始時確定在庫</span><strong>${esc(totalStart)}</strong></div>
        <div><span>通常販売数</span><strong>${esc(totalSalesQty)}</strong></div>
        <div><span>戻り実数</span><strong>${esc(totalReturned)}</strong></div>
        <div><span>イベント棚残数</span><strong>${esc(totalRemain)}</strong></div>
        <div><span>ガチャ持ち出し / 確定使用</span><strong>${esc(totalGachaRegistered)} / ${esc(totalGachaUsedConfirmed?totalGachaUsed:"未確定")}</strong></div>
      </div>
      <section class="booth-report-section"><h5>商品別 通常在庫</h5>${renderBoothReportNormalItems(normal)}</section>
      <section class="booth-report-section"><h5>ガチャ商品</h5>${renderBoothReportGachaItems(gacha)}</section>
      <section class="booth-report-section"><h5>スマレジ販売履歴（対象ブース端末のみ）</h5>${renderBoothReportSalesRows(salesRows)}</section>
      <section class="booth-report-section"><h5>持ち出し確定ログ</h5>${renderBoothReportMovementRows(departureLogs)}</section>`;
  }catch(e){
    body.innerHTML='<div class="booth-empty">イベントレポートを読み込めませんでした。</div>';
    boothShowError("イベントレポートエラー","イベントレポートの読み込みに失敗しました。\n"+e.message);
  }
}

function renderBoothReportNormalItems(rows){
  if(!rows.length)return '<div class="booth-empty">通常イベント在庫はありません。</div>';
  return `<div class="booth-history-table-wrap"><table class="booth-history-table">
    <thead><tr><th>商品名</th><th>バーコード</th><th>開始時確定</th><th>販売</th><th>戻り</th><th>ガチャ使用</th><th>理論残</th></tr></thead>
    <tbody>${rows.map(row=>`<tr><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.taken_qty??0)}</td><td>${esc(row.sold_qty??0)}</td><td>${esc(row.returned_qty??0)}</td><td>${esc(row.consumed_qty??0)}</td><td><strong>${esc(calculateBoothItemDifference(row))}</strong></td></tr>`).join("")}</tbody>
  </table></div>`;
}

function renderBoothReportGachaItems(rows){
  if(!rows.length)return '<div class="booth-empty">ガチャ商品はありません。</div>';
  return `<div class="booth-history-table-wrap"><table class="booth-history-table">
    <thead><tr><th>商品名</th><th>バーコード</th><th>ガチャ持ち出し数</th><th>戻り実数</th><th>使用数</th></tr></thead>
    <tbody>${rows.map(row=>`<tr><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.taken_qty??0)}</td><td>${esc(boothGachaDisplayQty(boothGachaReturnActualQty(row)))}</td><td>${esc(boothGachaDisplayQty(boothGachaUsedQty(row)))}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function renderBoothReportSalesRows(rows){
  if(!rows.length)return '<div class="booth-empty">確定済み販売履歴はありません。</div>';
  return `<div class="booth-history-table-wrap"><table class="booth-history-table">
    <thead><tr><th>販売日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>端末ID</th></tr></thead>
    <tbody>${rows.map(row=>`<tr><td>${esc(formatBoothDateTime(row.sold_at))}</td><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.quantity??0)}</td><td>${esc(row.smaregi_terminal_id||"-")}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function renderBoothReportMovementRows(rows){
  if(!rows.length)return '<div class="booth-empty">持ち出し確定ログはありません。</div>';
  return `<div class="booth-history-table-wrap"><table class="booth-history-table">
    <thead><tr><th>日時</th><th>商品名</th><th>バーコード</th><th>数量</th><th>担当者</th><th>メモ</th></tr></thead>
    <tbody>${rows.map(row=>`<tr><td>${esc(formatBoothDateTime(row.created_at))}</td><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.quantity??0)}</td><td>${esc(row.staff||"-")}</td><td>${esc(row.memo||"")}</td></tr>`).join("")}</tbody>
  </table></div>`;
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

renderBoothEventReportPanel=async function(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  area.innerHTML=`<section class="booth-work-card booth-event-report-card">
    <div class="booth-list-header">
      <div>
        <h4>イベントレポート</h4>
        <p class="section-note">売上実績、ガチャ実績、商品別販売、景品使用、在庫差異を確認します。持ち出し未登録の商品でもスマレジAPI売上は表示します。</p>
      </div>
      <div class="button-row booth-export-buttons">
        <button type="button" id="boothEventReportCsvBtn" class="secondary">CSV出力</button>
        <button type="button" id="boothEventReportPdfBtn" class="secondary">PDF出力</button>
        <button type="button" id="boothEventReportReloadBtn" class="secondary">再読み込み</button>
      </div>
    </div>
    <div id="boothEventReportBody" class="booth-event-report-body"><div class="booth-empty">読み込み中...</div></div>
  </section>`;
  el("boothEventReportReloadBtn")?.addEventListener("click",()=>loadBoothEventReport(event.id));
  el("boothEventReportCsvBtn")?.addEventListener("click",()=>exportBoothEventReportCsv(event));
  el("boothEventReportPdfBtn")?.addEventListener("click",()=>exportBoothEventReportPdf(event));
  loadBoothEventReport(event.id);
};

// Ver 2.37: the event shelf is shared by store and barcode. Event ids remain
// on audit rows only, so a later event can use the same shelf stock.
function getBoothExplicitReturnProcessType(item){
  const value=String(item?.return_process_type||"").toLowerCase().trim();
  return ["storage","shelf","event","keep"].includes(value)?value:"";
}

function getBoothReturnProcessLabel(type){
  const value=String(type||"");
  if(value==="storage")return "\u30a4\u30d9\u30f3\u30c8\u68da";
  if(value==="keep")return "\u30a4\u30d9\u30f3\u30c8\u68da\u306b\u6b8b\u3059";
  if(value==="event")return "\u30a4\u30d9\u30f3\u30c8\u68da";
  return "\u901a\u5e38\u68da\u3078\u623b\u3059";
}

function renderBoothReturnPanel(event){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const closed=isBoothEventClosed(event);
  getBoothReturnDraft(event);
  const staffOptions=getBoothStaffOptions();
  area.innerHTML=`
    <section class="booth-work-card booth-return-card">
      <h4>\u623b\u308a\u5728\u5eab\u51e6\u7406</h4>
      <p class="section-note">\u5546\u54c1\u3092\u30b9\u30ad\u30e3\u30f3\u3057\u3001\u623b\u3057\u5148\u3092\u5168\u4f53\u3067\u9078\u629e\u3057\u3066\u767b\u9332\u3057\u307e\u3059\u3002\u30a4\u30d9\u30f3\u30c8\u68da\u306f\u5e97\u8217\u5171\u901a\u3067\u3059\u3002</p>
      <div class="booth-return-destination-options" role="group" aria-label="\u623b\u3057\u5148">
        <button type="button" class="booth-return-destination-btn" data-booth-return-destination="shelf" aria-pressed="false" ${closed?"disabled":""}>\u901a\u5e38\u68da\u3078\u623b\u3059</button>
        <button type="button" class="booth-return-destination-btn" data-booth-return-destination="keep" aria-pressed="false" ${closed?"disabled":""}>\u30a4\u30d9\u30f3\u30c8\u68da\u306b\u6b8b\u3059</button>
      </div>
      <div class="booth-return-scan-controls">
        <button type="button" id="boothReturnStartCameraBtn" ${closed?"disabled":""}>\u30ab\u30e1\u30e9\u8aad\u53d6</button>
        <button type="button" id="boothReturnStopCameraBtn" class="secondary">\u505c\u6b62</button>
        <label class="booth-return-barcode-label">\u30d0\u30fc\u30b3\u30fc\u30c9
          <input id="boothReturnBarcode" autocomplete="off" inputmode="numeric" placeholder="\u30d0\u30fc\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u3066Enter" ${closed?"disabled":""}>
        </label>
      </div>
      <div class="booth-return-product-search">
        <label class="booth-return-product-search-label">\u5546\u54c1\u540d\u691c\u7d22
          <input id="boothReturnProductSearch" autocomplete="off" placeholder="\u5546\u54c1\u540d\u3067\u691c\u7d22" ${closed?"disabled":""}>
        </label>
        <div id="boothReturnProductSearchResults" class="booth-return-product-search-results" hidden></div>
      </div>
      <div class="camera-area booth-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div id="boothCameraGuideOverlay" class="camera-guide-overlay"><div class="camera-guide-box"><div class="camera-guide-line"></div></div><div class="camera-guide-text">\u30d0\u30fc\u30b3\u30fc\u30c9\u3092\u30ab\u30e1\u30e9\u306b\u5408\u308f\u305b\u3066\u304f\u3060\u3055\u3044</div></div>
      </div>
      <div class="booth-return-common-fields">
        <label>\u62c5\u5f53\u8005<span class="required">\u5fc5\u9808</span><select id="boothReturnStaff" ${closed?"disabled":""}>${staffOptions}</select></label>
        <label>\u30e1\u30e2<input id="boothReturnMemo" autocomplete="off" placeholder="\u4efb\u610f\u30e1\u30e2" ${closed?"disabled":""}></label>
      </div>
      <div id="boothReturnDraftList" class="booth-return-draft-list"><div class="booth-empty">\u30d0\u30fc\u30b3\u30fc\u30c9\u3092\u8aad\u307f\u53d6\u308b\u3068\u3053\u3053\u306b\u5bfe\u8c61\u5546\u54c1\u304c\u8ffd\u52a0\u3055\u308c\u307e\u3059\u3002</div></div>
      <button type="button" id="boothReturnApplyBtn" class="booth-return-apply-btn" ${closed?"disabled":""}>\u5165\u529b\u5206\u3092\u4e00\u62ec\u53cd\u6620</button>
    </section>
    <section class="booth-work-card booth-return-history-card">
      <div class="booth-list-header"><h4>\u623b\u308a\u5728\u5eab\u5c65\u6b74</h4><button type="button" id="reloadBoothReturnHistoryBtn" class="secondary">\u518d\u8aad\u307f\u8fbc\u307f</button></div>
      <div id="boothReturnHistoryList" class="booth-carry-history-list"><div class="booth-empty">\u8aad\u307f\u8fbc\u307f\u4e2d...</div></div>
    </section>`;
  if(boothReturnDraftDestination)setBoothReturnDestination(boothReturnDraftDestination);
  const barcodeInput=el("boothReturnBarcode");
  const add=()=>addBoothReturnDraftFromBarcode(barcodeInput?.value);
  barcodeInput?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();add();}});
  bindBoothReturnProductSearch(event);
  document.querySelectorAll("[data-booth-return-destination]").forEach(button=>button.addEventListener("click",()=>setBoothReturnDestination(button.dataset.boothReturnDestination)));
  el("boothReturnDraftList")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-booth-return-action]");
    if(!button)return;
    const barcode=button.dataset.boothReturnBarcode||"";
    if(button.dataset.boothReturnAction==="remove")boothReturnDraftItems.delete(barcode);
    else if(button.dataset.boothReturnAction==="increase")changeBoothReturnDraftQuantity(barcode,1);
    else if(button.dataset.boothReturnAction==="decrease")changeBoothReturnDraftQuantity(barcode,-1);
    renderBoothReturnDraftCards(getBoothCurrentEvent());
  });
  el("boothReturnDraftList")?.addEventListener("change",event=>{
    const input=event.target.closest("[data-booth-return-qty]");
    if(input)setBoothReturnDraftQuantity(input.dataset.boothReturnQty,input.value);
  });
  el("boothReturnApplyBtn")?.addEventListener("click",applyBoothReturnDraft);
  el("reloadBoothReturnHistoryBtn")?.addEventListener("click",()=>loadBoothReturnHistory(event.id));
  el("boothReturnStartCameraBtn")?.addEventListener("click",()=>{boothScanTarget="return";startBoothCarryOutCamera();});
  el("boothReturnStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
  renderBoothReturnDraftCards(event);
  loadBoothReturnHistory(event.id);
}

function setBoothReturnDestination(destination){
  if(boothReturnDraftItems.size&&destination!==boothReturnDraftDestination){
    boothShowError("\u623b\u3057\u5148\u5909\u66f4\u30a8\u30e9\u30fc","\u8ffd\u52a0\u6e08\u307f\u5546\u54c1\u3092\u524a\u9664\u3057\u3066\u304b\u3089\u623b\u3057\u5148\u3092\u5909\u66f4\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    return false;
  }
  const next=destination==="keep"||destination==="event"?"keep":"shelf";
  boothReturnDraftDestination=next;
  boothReturnDraftDestinationEventId="";
  document.querySelectorAll("[data-booth-return-destination]").forEach(button=>{
    const selected=button.dataset.boothReturnDestination===next;
    button.classList.toggle("is-selected",selected);
    button.setAttribute("aria-pressed",selected?"true":"false");
  });
  return true;
}

function updateBoothReturnDraftQuantityWhileTyping(input){
  const barcode=String(input?.dataset?.boothReturnQty||"");
  const entry=boothReturnDraftItems.get(barcode);
  const text=String(input?.value||"").trim();
  if(!entry||!/^[0-9]+$/.test(text))return;
  const quantity=Number(text);
  if(quantity<=entry.currentQty)entry.quantity=quantity;
}

async function loadBoothReturnProductSearch(event,rawQuery){
  const results=el("boothReturnProductSearchResults");
  const query=String(rawQuery||"").trim().toLowerCase();
  if(!results)return;
  if(!query){
    results.hidden=true;
    results.innerHTML="";
    return;
  }
  const requestId=++boothReturnSearchRequestId;
  results.hidden=false;
  results.innerHTML='<div class="booth-empty">\u691c\u7d22\u4e2d...</div>';
  try{
    const [items,storageRows]=await Promise.all([
      sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty&event_id=eq.${encodeURIComponent(event.id)}&item_type=eq.normal&order=product_name.asc&limit=3000`),
      sb(`event_storage_stocks?select=barcode,product_name,storage_qty&store_code=eq.${encodeURIComponent(getBoothCurrentStoreCode())}&storage_qty=gt.0&limit=3000`).catch(()=>[])
    ]);
    if(requestId!==boothReturnSearchRequestId)return;
    const storageByBarcode=new Map((Array.isArray(storageRows)?storageRows:[]).map(row=>[String(row.barcode||""),row]));
    const seen=new Set();
    const matches=(Array.isArray(items)?items:[]).filter(item=>{
      const barcode=String(item?.barcode||"");
      if(!barcode||seen.has(barcode))return false;
      const storage=storageByBarcode.get(barcode)||null;
      const availability=getBoothReturnAvailability(item,storage);
      if(availability.quantity<=0)return false;
      const name=String(item?.product_name||storage?.product_name||"");
      if(!`${name} ${barcode}`.toLowerCase().includes(query))return false;
      seen.add(barcode);
      return true;
    }).slice(0,30);
    if(!matches.length){
      results.innerHTML='<div class="booth-empty">\u8a72\u5f53\u3059\u308b\u623b\u308a\u5bfe\u8c61\u5546\u54c1\u304c\u3042\u308a\u307e\u305b\u3093\u3002</div>';
      return;
    }
    results.innerHTML=matches.map(item=>{
      const barcode=String(item.barcode||"");
      const storage=storageByBarcode.get(barcode)||null;
      const availability=getBoothReturnAvailability(item,storage);
      return `<button type="button" class="booth-return-search-result" data-booth-return-search-barcode="${esc(barcode)}">
        <span class="booth-return-search-copy"><strong>${esc(item.product_name||storage?.product_name||barcode)}</strong><small>\u30d0\u30fc\u30b3\u30fc\u30c9: ${esc(barcode)} / \u623b\u308a\u53ef\u80fd: ${esc(availability.quantity)}</small></span>
        <span class="booth-return-search-action">\u9078\u629e</span>
      </button>`;
    }).join("");
  }catch(error){
    if(requestId!==boothReturnSearchRequestId)return;
    results.innerHTML=`<div class="booth-error-message">${esc(error?.message||"\u5546\u54c1\u691c\u7d22\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002")}</div>`;
  }
}

function bindBoothReturnProductSearch(event){
  const input=el("boothReturnProductSearch");
  const results=el("boothReturnProductSearchResults");
  if(!input||!results)return;
  let timer=null;
  input.addEventListener("input",()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>loadBoothReturnProductSearch(event,input.value),180);
  });
  input.addEventListener("keydown",inputEvent=>{
    if(inputEvent.key==="Escape"){
      input.value="";
      results.hidden=true;
      results.innerHTML="";
    }
  });
  results.addEventListener("click",inputEvent=>{
    const button=inputEvent.target.closest("[data-booth-return-search-barcode]");
    if(!button)return;
    input.value="";
    results.hidden=true;
    results.innerHTML="";
    void addBoothReturnDraftFromBarcode(button.dataset.boothReturnSearchBarcode||"");
  });
}

async function addBoothReturnDraftFromBarcode(rawBarcode){
  const event=getBoothCurrentEvent();
  const barcode=String(rawBarcode||"").trim();
  if(!event||!barcode)return;
  if(isBoothEventClosed(event)){showBoothClosedError();return;}
  if(!boothReturnDraftDestination){
    boothShowError("\u623b\u3057\u5148\u672a\u9078\u629e","\u5148\u306b\u300c\u901a\u5e38\u68da\u3078\u623b\u3059\u300d\u307e\u305f\u306f\u300c\u30a4\u30d9\u30f3\u30c8\u68da\u306b\u6b8b\u3059\u300d\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    return;
  }
  try{
    const [item,stock,product]=await Promise.all([
      findBoothEventItemByBarcode(event.id,barcode),
      findBoothEventStorageStock(getBoothCurrentStoreCode(),barcode),
      findBoothProductByBarcode(barcode)
    ]);
    const availability=getBoothReturnAvailability(item,stock);
    const currentQty=availability.quantity;
    if(!item||currentQty<=0){
      boothShowError("\u623b\u308a\u5bfe\u8c61\u5916\u5546\u54c1",`${product?.name||barcode}\n\u901a\u5e38\u68da\u5728\u5eab: ${Number(product?.base_stock||0)}\n\u3053\u306e\u30a4\u30d9\u30f3\u30c8\u306e\u623b\u308a\u53ef\u80fd数: ${currentQty}\n\u6301\u3061出し\u6b8b\u6570または\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u6b8b\u6570がある\u5546\u54c1を\u8aad\u307f取ってください。`);
      return;
    }
    const items=getBoothReturnDraft(event);
    const existing=items.get(barcode);
    // Scanning selects the product. The quantity field is authoritative, so
    // scanning the same product again does not silently add another unit.
    const quantity=existing ? Math.min(currentQty,Math.max(0,Number(existing.quantity||0))) : 1;
    items.set(barcode,{barcode,productName:item.product_name||product?.name||"",item,currentQty,source:availability.source,quantity});
    renderBoothReturnDraftCards(event);
    const quantityInput=[...document.querySelectorAll("[data-booth-return-qty]")]
      .find(input=>input.dataset.boothReturnQty===barcode);
    const barcodeInput=el("boothReturnBarcode");
    if(barcodeInput)barcodeInput.value="";
    if(quantityInput){quantityInput.focus();quantityInput.select();}
    else barcodeInput?.focus();
  }catch(error){
    boothShowError("\u623b\u308a\u5728\u5eab\u5546\u54c1\u30a8\u30e9\u30fc",error.message||"\u5546\u54c1\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002");
  }
}

async function insertBoothCommonEventMovement(event,item,quantity,staff,memo,movementType){
  const rows=await sb("event_storage_movements",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify([{
      event_id:event?.id||boothCurrentEventId||null,
      store_code:getBoothCurrentStoreCode(),
      smaregi_product_id:item?.smaregi_product_id?String(item.smaregi_product_id):null,
      barcode:item?.barcode||"",
      product_name:item?.product_name||item?.name||"",
      movement_type:movementType,
      quantity:Math.abs(Number(quantity||0)),
      staff,
      memo:memo||""
    }])
  });
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function applyBoothReturnDraft(){
  if(window.__aricoBoothReturnSaving)return;
  const event=getBoothCurrentEvent();
  const destination=boothReturnDraftDestination;
  const staff=String(el("boothReturnStaff")?.value||"").trim();
  const memo=String(el("boothReturnMemo")?.value||"").trim();
  const entries=[...getBoothReturnDraft(event).values()].filter(entry=>Number(entry.quantity||0)>0);
  if(!event||isBoothEventClosed(event)){showBoothClosedError();return;}
  if(!["shelf","keep"].includes(destination)){
    boothShowError("\u623b\u3057\u5148\u672a\u9078\u629e","\u623b\u3057\u5148\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    return;
  }
  if(!entries.length){boothShowError("\u5bfe\u8c61\u672a\u5165\u529b","\u5546\u54c1\u3092\u30b9\u30ad\u30e3\u30f3\u3057\u3066\u304f\u3060\u3055\u3044\u3002");return;}
  if(!staff){boothShowError("\u62c5\u5f53\u8005\u672a\u9078\u629e","\u62c5\u5f53\u8005\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002");return;}
  if(!validateBoothStaffStore(staff,"\u5e97\u8217\u78ba\u8a8d\u30a8\u30e9\u30fc","boothReturnStaff"))return;
  const checked=[];
  try{
    for(const entry of entries){
      const [item,stock,product]=await Promise.all([
        findBoothEventItemByBarcode(event.id,entry.barcode),
        findBoothEventStorageStock(getBoothCurrentStoreCode(),entry.barcode),
        findBoothProductByBarcode(entry.barcode)
      ]);
      const quantity=Number(entry.quantity||0);
      const availability=getBoothReturnAvailability(item,stock);
      const currentQty=availability.quantity;
      if(!item||currentQty<quantity)throw new Error(`${entry.productName||entry.barcode}: \u623b\u308a\u53ef\u80fd\u6570(${currentQty})\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002\u901a\u5e38\u68da\u5728\u5eab\u306f\u623b\u308a\u53ef\u80fd\u6570\u306b\u306f\u542b\u307e\u308c\u307e\u305b\u3093\u3002`);
      if(!product)throw new Error(`${entry.barcode}: \u5546\u54c1\u30de\u30b9\u30bf\u30fc\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002`);
      checked.push({item,stock,product,quantity,source:availability.source});
    }
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("\u623b\u308a\u5728\u5eab\u3092\u53cd\u6620",checked.map(row=>`${row.product.name||row.item.product_name}: ${row.quantity}`).join("\n"),{okText:"\u53cd\u6620"}):true;
    if(!ok)return;
    window.__aricoBoothReturnSaving=true;
    const applied=[];
    try{
      for(const row of checked){
        const operation={row,baseBefore:null,storageBefore:{...row.stock},itemBefore:{...row.item},inventoryLog:null,sourceMovement:null,storageMovement:null};
        applied.push(operation);
        if(destination==="shelf"){
          operation.baseBefore=Number(row.product.base_stock||0);
          await updateBoothProductBaseStock(row.product.barcode,operation.baseBefore+row.quantity);
          if(row.source==="common-event-shelf"){
            await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),row.product,-row.quantity);
          }
          operation.inventoryLog=await insertBoothEventReturnInventoryLog(event,row.item,row.quantity,staff,memo,"event_return");
          if(!operation.inventoryLog?.id)throw new Error(`${row.product.name||row.product.barcode}: 戻り履歴を保存できませんでした。`);
          operation.sourceMovement=await insertBoothReturnMovement(event,row.item,row.quantity,staff,memo,"return");
          if(!operation.sourceMovement?.id)throw new Error(`${row.product.name||row.product.barcode}: 戻り移動履歴を保存できませんでした。`);
          if(row.source==="common-event-shelf"){
            operation.storageMovement=await insertBoothCommonEventMovement(event,row.product,row.quantity,staff,memo,"storage_out");
            if(!operation.storageMovement?.id)throw new Error(`${row.product.name||row.product.barcode}: イベント棚移動履歴を保存できませんでした。`);
          }
        }else{
          operation.inventoryLog=await insertBoothEventReturnInventoryLog(event,row.item,row.quantity,staff,memo,"event_stock_confirm");
          if(!operation.inventoryLog?.id)throw new Error(`${row.product.name||row.product.barcode}: 確認履歴を保存できませんでした。`);
          operation.sourceMovement=await insertBoothReturnMovement(event,row.item,row.quantity,staff,memo,"event_stock_confirm");
          if(!operation.sourceMovement?.id)throw new Error(`${row.product.name||row.product.barcode}: 確認移動履歴を保存できませんでした。`);
        }
        await applyBoothReturnSourceItem(row.item,row.quantity,destination,staff);
      }
    }catch(error){
      for(const done of applied.reverse()){
        try{
          if(done.baseBefore!==null)await updateBoothProductBaseStock(done.row.product.barcode,done.baseBefore);
          if(destination==="shelf"&&done.row.source==="common-event-shelf")await restoreBoothEventStorageStock(getBoothCurrentStoreCode(),done.row.product,done.storageBefore);
          if(done.inventoryLog?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(done.inventoryLog.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(done.sourceMovement?.id)await sb(`booth_stock_movements?id=eq.${encodeURIComponent(done.sourceMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(done.storageMovement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(done.storageMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          await restoreBoothReturnSourceItem({item:done.itemBefore});
        }catch(rollbackError){console.warn("[booth return rollback failed]",rollbackError);}
      }
      throw error;
    }
    boothReturnDraftItems.clear();
    renderBoothReturnDraftCards(event);
    await refreshBoothEventRelatedViews(event.id);
    boothShowSuccess("\u623b\u308a\u5728\u5eab\u53cd\u6620\u5b8c\u4e86",`${checked.length}\u5546\u54c1\u3092${destination==="shelf"?"\u901a\u5e38\u68da":"\u30a4\u30d9\u30f3\u30c8\u68da"}\u3068\u3057\u3066\u53cd\u6620\u3057\u307e\u3057\u305f\u3002`);
  }catch(error){
    boothShowError("\u623b\u308a\u5728\u5eab\u53cd\u6620\u30a8\u30e9\u30fc",error.message||"\u623b\u308a\u5728\u5eab\u306e\u53cd\u6620\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }finally{window.__aricoBoothReturnSaving=false;}
}

async function reflectBoothShelfReturnsOnClose(summary,staff){
  const now=new Date().toISOString();
  for(const item of summary.returnPendingRows||summary.shelfReturnPendingRows||[]){
    const processType=getBoothCloseReturnProcessType(item);
    const effectiveQty=getBoothReturnReflectQty(item);
    const delta=getBoothReturnReflectDelta(item);
    if(delta===0||!item.id||!item.barcode)continue;
    if(!processType)throw new Error("\u623b\u308a\u5148\u304c\u672a\u9078\u629e\u306e\u5546\u54c1\u304c\u3042\u308a\u307e\u3059\u3002");
    if(processType==="storage"){
      await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),item,delta);
      await insertBoothCommonEventMovement({id:item.event_id||boothCurrentEventId},item,delta,staff,"\u30a4\u30d9\u30f3\u30c8\u68da\u3078\u53cd\u6620","storage_in");
    }else if(processType==="shelf"){
      await adjustBoothProductBaseStock(item.barcode,delta);
      await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),item,-delta);
      await insertBoothCommonEventMovement({id:item.event_id||boothCurrentEventId},item,delta,staff,"\u901a\u5e38\u68da\u3078\u623b\u3057","storage_out");
    }else if(processType==="keep"){
      // The count is recorded, but the shared shelf stock does not move.
    }else if(processType!=="event"){
      await adjustBoothProductBaseStock(item.barcode,delta);
    }
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({
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
    })});
  }
}

async function unreflectBoothShelfReturnsOnReopen(eventId,staff){
  const now=new Date().toISOString();
  const reflectedRows=await loadBoothReflectedShelfReturnRows(eventId);
  for(const item of reflectedRows){
    const processType=getBoothReturnProcessType(item)||"shelf";
    const qty=getBoothReturnReflectedQty(item);
    if(qty>0&&item.barcode&&processType==="storage"&&false){
      await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),item,-qty);
      await insertBoothCommonEventMovement({id:eventId},item,qty,staff,"\u30c1\u30a7\u30c3\u30af\u89e3\u9664","storage_out");
    }else if(qty>0&&item.barcode&&processType==="shelf"){
      await adjustBoothProductBaseStock(item.barcode,-qty);
      await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),item,qty);
      await insertBoothCommonEventMovement({id:eventId},item,qty,staff,"\u30c1\u30a7\u30c3\u30af\u89e3\u9664","storage_in");
    }else if(qty>0&&item.barcode&&processType!=="keep"&&processType!=="storage"){
      await adjustBoothProductBaseStock(item.barcode,-qty);
    }
    await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({return_reflected:false,return_reflected_qty:0,return_reflected_at:null,return_reflected_by:null,shelf_return_reflected:false,shelf_return_reflected_qty:0,shelf_return_reflected_at:null,shelf_return_reflected_by:null,updated_at:now})});
  }
  return reflectedRows.reduce((sum,row)=>sum+getBoothReturnReflectedQty(row),0);
}

async function moveBoothEventShelfQtyToGacha(event,product,quantity){
  return null;
  const stock=await findBoothEventStorageStock(getBoothCurrentStoreCode(),product.barcode);
  const current=Number(stock?.storage_qty||0);
  if(!stock||current<quantity)return null;
  const item=await findBoothEventItemByBarcode(event.id,product.barcode);
  const previous=item?{taken_qty:Number(item.taken_qty||0),normal_takeout_qty:Number(item.normal_takeout_qty||0),storage_takeout_qty:Number(item.storage_takeout_qty||0)}:null;
  if(item){
    const normal=Math.max(0,Number(item.normal_takeout_qty||0));
    const storage=Math.max(0,Number(item.storage_takeout_qty||0));
    const useNormal=Math.min(normal,quantity);
    await patchBoothEventItem(item,{taken_qty:Math.max(0,Number(item.taken_qty||0)-quantity),normal_takeout_qty:normal-useNormal,storage_takeout_qty:Math.max(0,storage-(quantity-useNormal))});
  }
  await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),product,-quantity);
  const storageMovement=await insertBoothCommonEventMovement(event,product,quantity,"","\u30ac\u30c1\u30e3\u3078\u79fb\u52d5","storage_out");
  return {item,previous,storageBefore:stock,storageMovement};
}

async function rollbackBoothEventShelfQty(moveResult){
  if(!moveResult)return;
  if(moveResult.item&&moveResult.previous)await patchBoothEventItem(moveResult.item,moveResult.previous);
  if(moveResult.storageBefore)await restoreBoothEventStorageStock(getBoothCurrentStoreCode(),moveResult.item||{barcode:moveResult.storageBefore.barcode,product_name:moveResult.storageBefore.product_name},moveResult.storageBefore);
  if(moveResult.storageMovement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(moveResult.storageMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
}

async function confirmBoothSalesImport(){
  if(window.__aricoBoothSalesConfirming)return;
  window.__aricoBoothSalesConfirming=true;
  const form=validateBoothSalesForm();
  if(!form){window.__aricoBoothSalesConfirming=false;return;}
  const {event,fromDate,toDate,staff}=form;
  try{
    const pending=await sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(event.id)}&import_status=eq.pending&order=sold_at.asc&limit=500`);
    const rows=(Array.isArray(pending)?pending:[]).filter(row=>!isBoothGachaSaleRow(row));
    if(!rows.length){boothShowError("\u8ca9\u58f2\u78ba\u5b9a\u30a8\u30e9\u30fc","\u672a\u78ba\u8a8d\u306e\u8ca9\u58f2\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093\u3002");return;}
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("\u8ca9\u58f2\u3092\u78ba\u5b9a",`${getBoothSalesContextSummary(event,fromDate,toDate)}\n\n${rows.length}\u4ef6\u3092\u78ba\u5b9a\u3057\u307e\u3059\u3002`,{okText:"\u78ba\u5b9a"}):true;
    if(!ok)return;
    const items=await fetchBoothEventItems(event.id);
    const itemByBarcode=new Map(items.map(item=>[String(item.barcode||""),item]));
    const addByBarcode=new Map();
    rows.forEach(row=>{const barcode=String(row.barcode||"").trim();if(barcode)addByBarcode.set(barcode,(addByBarcode.get(barcode)||0)+Number(row.quantity||0));});
    const prepared=[];
    for(const [barcode,addQty] of addByBarcode.entries()){
      if(!Number.isFinite(addQty)||addQty<=0)continue;
      const item=itemByBarcode.get(barcode);
      if(!item)throw new Error(`${barcode}: イベント商品として登録されていません。`);
      const product=await findBoothProductByBarcode(barcode);
      if(!product)throw new Error(`${barcode}: 商品マスターが見つかりません。`);
      const stock=await findBoothEventStorageStock(getBoothCurrentStoreCode(),barcode);
      const currentQty=Number(stock?.storage_qty||0);
      if(!stock||currentQty<addQty){
        throw new Error(`${product.name||item.product_name||barcode}: 共通イベント棚在庫が不足しています（現在 ${currentQty} / 販売 ${addQty}）。`);
      }
      prepared.push({barcode,addQty,item,product,stock});
    }
    if(!prepared.length)throw new Error("販売確定できる数量がありません。");
    const applied=[];
    try{
      for(const preparedRow of prepared){
        const {barcode,addQty,item,product,stock}=preparedRow;
        const storageBefore=stock?{...stock}:null;
        await upsertBoothEventStorageStock(getBoothCurrentStoreCode(),product,-addQty);
        const storageMovement=await insertBoothCommonEventMovement(event,product,addQty,staff,"\u30a4\u30d9\u30f3\u30c8\u8ca9\u58f2","storage_out");
        const nextSold=Number(item.sold_qty||0)+Number(addQty||0);
        await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({sold_qty:nextSold,difference_qty:calculateBoothItemDifference({...item,sold_qty:nextSold}),updated_at:new Date().toISOString()})});
        applied.push({item,product,storageBefore,storageMovement});
      }
      await sb(`event_sales_imports?event_id=eq.${encodeURIComponent(event.id)}&import_status=eq.pending`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({import_status:"confirmed",confirmed_by:staff,confirmed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    }catch(error){
      for(const row of applied.reverse()){
        try{await restoreBoothEventStorageStock(getBoothCurrentStoreCode(),row.product,row.storageBefore);if(row.storageMovement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(row.storageMovement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});await patchBoothEventItem(row.item,{sold_qty:row.item.sold_qty,difference_qty:row.item.difference_qty});}catch(rollbackError){console.warn("[booth sales rollback failed]",rollbackError);}
      }
      throw error;
    }
    await loadBoothSalesImports(event.id);
    boothShowSuccess("\u8ca9\u58f2\u78ba\u5b9a\u5b8c\u4e86","\u8ca9\u58f2\u6570\u91cf\u3092\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u304b\u3089\u6e1b\u7b97\u3057\u307e\u3057\u305f\u3002");
  }catch(error){boothShowError("\u8ca9\u58f2\u78ba\u5b9a\u30a8\u30e9\u30fc",error.message||"\u8ca9\u58f2\u306e\u78ba\u5b9a\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");}
  finally{window.__aricoBoothSalesConfirming=false;}
}

async function buildBoothDepartureInventoryData(eventId){
  const storeCode=getBoothCurrentStoreCode();
  const selectedEventId=String(eventId||boothCurrentEventId||"").trim();
  const [commonRows,eventNormalRows,gachaRows]=await Promise.all([
    loadBoothCurrentEventStorageRows(storeCode,{eventId:selectedEventId}),
    selectedEventId
      ? sb(`booth_event_items?select=id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,updated_at&event_id=eq.${encodeURIComponent(selectedEventId)}&item_type=eq.normal&order=product_name.asc&limit=5000`).catch(()=>[])
      : Promise.resolve([]),
    selectedEventId
      ? sb(`booth_event_items?select=barcode,product_name,item_type,taken_qty,returned_qty,consumed_qty,updated_at&event_id=eq.${encodeURIComponent(selectedEventId)}&item_type=eq.gacha_prize&order=product_name.asc&limit=3000`).catch(()=>[])
      : Promise.resolve([])
  ]);
  const stocks=Array.isArray(commonRows)?commonRows:[];
  const eventRows=Array.isArray(eventNormalRows)?eventNormalRows:[];
  const barcodes=[...new Set([...stocks,...eventRows].map(row=>String(row.barcode||"").trim()).filter(Boolean))];
  const products=await loadBoothProductsByBarcode(barcodes);
  const commonByBarcode=new Map();
  stocks.forEach(row=>{
    const barcode=String(row.barcode||"").trim();
    if(!barcode)return;
    commonByBarcode.set(barcode,{
      quantity:Number(row.quantity??row.storage_qty??0),
      updated_at:row.updated_at||"",
      product_name:row.product_name||""
    });
  });
  const normalByBarcode=new Map();
  eventRows.forEach(item=>{
    const barcode=String(item.barcode||"").trim();
    if(!barcode)return;
    const product=products.get(barcode)||{};
    const common=commonByBarcode.get(barcode)||{};
    const searchText=[
      item.product_name,
      product.name,
      barcode,
      boothProductShelfText(product),
      product.category,
      product.genre,
      product.department,
      product.smaregi_product_id,
      product.price
    ].filter(value=>value!==null&&value!==undefined&&String(value).trim()!=="").join(" ");
    const startQty=Math.max(0,Number(item.storage_takeout_qty||0));
    const additionalQty=Math.max(0,Number(item.normal_takeout_qty||0));
    const splitTotal=startQty+additionalQty;
    const legacyTaken=Math.max(0,Number(item.taken_qty||0));
    normalByBarcode.set(barcode,{
      id:item.id,
      product_name:item.product_name||product.name||common.product_name||"",
      name:product.name||item.product_name||common.product_name||"",
      barcode,
      shelf:boothProductShelfText(product),
      searchText,
      startQty:splitTotal>0?startQty:0,
      additionalQty:splitTotal>0?additionalQty:legacyTaken,
      taken:splitTotal>0?splitTotal:legacyTaken,
      commonShelfQty:Number(common.quantity||0),
      soldQty:Number(item.sold_qty||0),
      returnedQty:Number(item.returned_qty||0),
      remain:calculateBoothItemDifference(item),
      updated_at:item.updated_at||common.updated_at||"",
      editable:true
    });
  });
  stocks.forEach(row=>{
    const barcode=String(row.barcode||"").trim();
    if(!barcode||normalByBarcode.has(barcode))return;
    const product=products.get(barcode)||{};
    const quantity=Number(row.quantity??row.storage_qty??0);
    const searchText=[
      row.product_name,
      product.name,
      barcode,
      boothProductShelfText(product),
      product.category,
      product.genre,
      product.department,
      product.smaregi_product_id,
      product.price
    ].filter(value=>value!==null&&value!==undefined&&String(value).trim()!=="").join(" ");
    normalByBarcode.set(barcode,{product_name:row.product_name||product.name||"",name:product.name||row.product_name||"",barcode,shelf:boothProductShelfText(product),searchText,startQty:quantity,additionalQty:0,commonShelfQty:quantity,taken:quantity,soldQty:null,remain:quantity,updated_at:row.updated_at||"",editable:false,missingEventItem:true});
  });
  const normalRows=[...normalByBarcode.values()];
  const gacha=Array.isArray(gachaRows)?gachaRows:[];
  const gachaRowsData=gacha.map(item=>({product_name:item.product_name||"",barcode:item.barcode||"",taken:Number(item.taken_qty||0),returned:boothGachaReturnActualQty(item),used:boothGachaUsedQty(item),remain:boothGachaItemCurrentQty(item),counted:isBoothGachaReturnCounted(item),updated_at:item.updated_at||""}));
  return {
    normalRows,
    gachaRows:gachaRowsData,
    departureTotal:normalRows.reduce((sum,row)=>sum+Number(row.taken||0),0),
    commonShelfTotal:stocks.reduce((sum,row)=>sum+Number(row.quantity??row.storage_qty??0),0)
  };
}

function renderBoothDepartureNormalSection(rows){
  const body=rows.length?rows.map(row=>{
    const disabled=row.editable?"":"disabled";
    const action=row.editable
      ?`<button type="button" class="secondary booth-history-edit-btn" data-booth-departure-save="${esc(row.id||"")}">修正保存</button>`
      :`<span class="status-badge">開始在庫のみ</span>`;
    return `<tr data-booth-departure-row data-item-id="${esc(row.id||"")}" data-barcode="${esc(row.barcode||"")}">
      <td>${esc(row.product_name||"-")}</td>
      <td>${esc(row.barcode||"-")}</td>
      <td><input class="booth-history-qty-input" data-booth-departure-start type="number" min="0" step="1" inputmode="numeric" value="${esc(row.startQty??0)}" ${disabled}></td>
      <td><input class="booth-history-qty-input" data-booth-departure-additional type="number" min="0" step="1" inputmode="numeric" value="${esc(row.additionalQty??0)}" ${disabled}></td>
      <td><strong data-booth-departure-total>${esc(row.commonShelfQty??0)}</strong></td>
      <td>${esc(formatBoothDateTime(row.updated_at))}</td>
      <td>${action}</td>
    </tr>`;
  }).join(""):"<tr><td colspan=\"7\">今回イベントの持ち出し在庫はありません。</td></tr>";
  const cards=rows.map(row=>{
    const disabled=row.editable?"":"disabled";
    const action=row.editable
      ?`<button type="button" class="secondary booth-history-edit-btn" data-booth-departure-save="${esc(row.id||"")}">修正保存</button>`
      :`<span class="status-badge">開始在庫のみ</span>`;
    return `<article class="booth-history-card booth-departure-card" data-booth-departure-row data-item-id="${esc(row.id||"")}" data-barcode="${esc(row.barcode||"")}">
      <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong><span>${esc(row.barcode||"-")}</span></div>
      <div class="booth-history-card-meta"><span>イベント棚在庫: <strong data-booth-departure-total>${esc(row.commonShelfQty??0)}</strong></span><span>最終更新: ${esc(formatBoothDateTime(row.updated_at))}</span></div>
      <label>開始時イベント棚<input class="booth-history-qty-input" data-booth-departure-start type="number" min="0" step="1" inputmode="numeric" value="${esc(row.startQty??0)}" ${disabled}></label>
      <label>追加持ち出し<input class="booth-history-qty-input" data-booth-departure-additional type="number" min="0" step="1" inputmode="numeric" value="${esc(row.additionalQty??0)}" ${disabled}></label>
      ${action}
    </article>`;
  }).join("");
  return `<section class="booth-split-list-section"><h5>今回イベント持ち出し在庫</h5><p class="section-note">開始時イベント棚と、今回追加で通常棚から持ち出した数量の合計をイベント棚在庫として表示します。追加持ち出しを修正すると通常棚と共通イベント棚も差分だけ調整します。</p><div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-departure-list-table"><thead><tr><th>商品名</th><th>バーコード</th><th>開始時イベント棚</th><th>追加持ち出し</th><th>イベント棚在庫</th><th>最終更新</th><th>修正</th></tr></thead><tbody>${body}</tbody></table></div><div class="booth-history-cards booth-scroll-cards">${cards}</div></section>`;
}

function syncBoothDepartureCorrectionRow(row){
  if(!row)return;
  const start=Number(row.querySelector("[data-booth-departure-start]")?.value||0);
  const additional=Number(row.querySelector("[data-booth-departure-additional]")?.value||0);
  row.querySelectorAll("[data-booth-departure-total]").forEach(node=>{node.textContent=String(Math.max(0,start)+Math.max(0,additional));});
}

async function loadBoothEventItemForDepartureCorrection(itemId){
  const id=String(itemId||"").trim();
  if(!id)throw new Error("修正対象が見つかりません。");
  const rows=await sb(`booth_event_items?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if(!Array.isArray(rows)||!rows[0])throw new Error("修正対象の商品を取得できませんでした。");
  return rows[0];
}

async function saveBoothDepartureCorrection(itemId,button){
  const event=getBoothCurrentEvent();
  if(!event)throw new Error("イベントが選択されていません。");
  const row=button?.closest("[data-booth-departure-row]");
  const startInput=row?.querySelector("[data-booth-departure-start]");
  const additionalInput=row?.querySelector("[data-booth-departure-additional]");
  const newStartRaw=String(startInput?.value||"").trim();
  const newAdditionalRaw=String(additionalInput?.value||"").trim();
  if(!/^\d+$/.test(newStartRaw)||!/^\d+$/.test(newAdditionalRaw)){
    boothShowError("持ち出し数修正エラー","開始時イベント棚・追加持ち出しは0以上の整数で入力してください。");
    return;
  }
  const item=await loadBoothEventItemForDepartureCorrection(itemId);
  if(String(item.event_id)!==String(event.id))throw new Error("別イベントの商品は修正できません。");
  if(String(item.item_type||"normal")!=="normal")throw new Error("通常商品の持ち出しだけ修正できます。");
  const oldStart=Math.max(0,Number(item.storage_takeout_qty||0));
  const newStart=Number(newStartRaw);
  const newAdditional=Number(newAdditionalRaw);
  const oldAdditional=Math.max(0,Number(item.normal_takeout_qty||0));
  const additionalDelta=newAdditional-oldAdditional;
  const startDelta=newStart-oldStart;
  const product=await findBoothProductByBarcode(item.barcode);
  if(!product)throw new Error(`商品マスターが見つかりません：${item.barcode}`);
  const storeCode=getBoothCurrentStoreCode();
  const baseBefore=Number(product.base_stock||0);
  const storageBefore=await findBoothEventStorageStock(storeCode,item.barcode);
  const currentStorageRows=await loadBoothCurrentEventStorageRows(storeCode,{eventId:event.id});
  const currentStorageRow=(Array.isArray(currentStorageRows)?currentStorageRows:[])
    .find(row=>String(row.barcode||"").trim()===String(item.barcode||"").trim());
  const storageBeforeQty=Number(currentStorageRow?.quantity??storageBefore?.storage_qty??0);
  const patchedPayload={
    storage_takeout_qty:newStart,
    normal_takeout_qty:newAdditional,
    taken_qty:newStart+newAdditional,
    difference_qty:calculateBoothItemDifference({...item,storage_takeout_qty:newStart,normal_takeout_qty:newAdditional,taken_qty:newStart+newAdditional})
  };
  if(additionalDelta>0){
    const baseAfter=baseBefore-additionalDelta;
    if(baseAfter<0){
      const confirmed=await confirmBoothNegativeCarryOut(baseBefore,additionalDelta,baseAfter);
      if(!confirmed)return;
    }
  }
  if(additionalDelta<0&&storageBeforeQty<Math.abs(additionalDelta)){
    boothShowError("持ち出し数修正エラー",`共通イベント棚在庫が不足しているため戻せません。\n現在の共通イベント棚：${storageBeforeQty}\n戻したい数量：${Math.abs(additionalDelta)}`);
    return;
  }
  try{
    if(button)button.disabled=true;
    if(additionalDelta!==0){
      await adjustBoothProductBaseStock(item.barcode,-additionalDelta);
      if(storageBefore){
        await upsertBoothEventStorageStock(storeCode,{barcode:item.barcode,product_name:item.product_name||product.name||""},additionalDelta);
      }
    }
    await patchBoothEventItem(item,patchedPayload);
    const nextBaseStock=baseBefore-additionalDelta;
    const negativeNote=additionalDelta!==0&&nextBaseStock<0
      ? `\n通常棚在庫は${nextBaseStock}になります。マイナス在庫として記録しました。`
      : "";
    boothShowSuccess("持ち出し数を修正しました",`開始時イベント棚：${oldStart} → ${newStart}\n追加持ち出し：${oldAdditional} → ${newAdditional}${startDelta!==0?"\n開始時イベント棚の修正では通常棚・共通イベント棚は変更していません。":""}${negativeNote}`);
    await loadBoothDepartureInventoryList(event.id);
    if(document.getElementById("boothEventReportBody"))await loadBoothEventReport(event.id);
  }catch(error){
    try{
      if(additionalDelta!==0){
        await updateBoothProductBaseStock(item.barcode,baseBefore);
        if(storageBefore)await restoreBoothEventStorageStock(storeCode,item,storageBefore);
      }
    }catch(rollbackError){console.warn("[booth departure correction rollback failed]",rollbackError);}
    boothShowError("持ち出し数修正エラー",error.message||"持ち出し数の修正に失敗しました。");
  }finally{
    if(button)button.disabled=false;
  }
}

async function loadBoothReturnHistory(eventId){
  const list=el("boothReturnHistoryList");
  if(!list)return;
  try{
    const rows=await sb(`booth_stock_movements?select=id,created_at,product_name,barcode,quantity,staff,memo,movement_type&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(return,event_transfer)&item_type=eq.normal&order=created_at.desc&limit=100`);
    const values=Array.isArray(rows)?rows:[];
    list.innerHTML=values.length?`<div class="booth-history-table-wrap"><table class="booth-history-table"><thead><tr><th>\u65e5\u6642</th><th>\u5546\u54c1\u540d</th><th>\u30d0\u30fc\u30b3\u30fc\u30c9</th><th>\u6570\u91cf</th><th>\u51e6\u7406</th><th>\u62c5\u5f53\u8005</th></tr></thead><tbody>${values.map(row=>{const kept=String(row.memo||"").includes("イベント棚に残す確認");return `<tr><td>${esc(formatBoothDateTime(row.created_at))}</td><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.quantity??0)}</td><td>${esc(kept?"\u30a4\u30d9\u30f3\u30c8\u68da\u306b\u6b8b\u3059":"\u901a\u5e38\u68da\u3078\u623b\u3059")}</td><td>${esc(row.staff||"-")}</td></tr>`}).join("")}</tbody></table></div>`:"<div class=\"booth-empty\">\u623b\u308a\u5728\u5eab\u5c65\u6b74\u306f\u3042\u308a\u307e\u305b\u3093\u3002</div>";
  }catch(error){list.innerHTML=`<div class="booth-empty">${esc(error.message||"\u623b\u308a\u5c65\u6b74\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3002")}</div>`;}
}

async function exportBoothDepartureInventoryCsv(event){
  try{
    const data=await buildBoothDepartureInventoryData(event?.id);
    const rows=[
      ["\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u5728\u5eab"],
      ["\u5546\u54c1\u540d","\u30d0\u30fc\u30b3\u30fc\u30c9","\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u73fe\u5728\u5eab","\u6700\u7d42\u66f4\u65b0"],
      ...data.normalRows.map(row=>[row.product_name||"",row.barcode||"",row.commonShelfQty??0,row.updated_at||""]),
      [],
      ["\u30ac\u30c1\u30e3\u6301\u3061\u51fa\u3057\u5728\u5eab"],
      ["\u5546\u54c1\u540d","\u30d0\u30fc\u30b3\u30fc\u30c9","\u30ac\u30c1\u30e3\u6301\u3061\u51fa\u3057\u6570","\u623b\u308a\u5b9f\u6570","\u4f7f\u7528\u6570","\u73fe\u5728\u30ac\u30c1\u30e3\u5728\u5eab"],
      ...data.gachaRows.map(row=>[row.product_name||"",row.barcode||"",row.taken,boothGachaDisplayQty(row.returned),boothGachaDisplayQty(row.used),row.remain])
    ];
    downloadBoothCsvFile(`${boothEventExportBaseName(event,"\u6301\u3061\u51fa\u3057\u5728\u5eab\u4e00\u89a7")}.csv`,rows);
  }catch(error){
    boothShowError("CSV\u51fa\u529b\u30a8\u30e9\u30fc",error.message||"\u6301\u3061\u51fa\u3057\u5728\u5eab\u4e00\u89a7CSV\u306e\u51fa\u529b\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }
}

async function exportBoothDepartureInventoryPdf(event){
  try{
    const data=await buildBoothDepartureInventoryData(event?.id);
    const html=`<h1>\u6301\u3061\u51fa\u3057\u5728\u5eab\u4e00\u89a7</h1>
      ${boothPdfTable("\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u5728\u5eab",["\u5546\u54c1\u540d","\u30d0\u30fc\u30b3\u30fc\u30c9","\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u73fe\u5728\u5eab","\u6700\u7d42\u66f4\u65b0"],data.normalRows.map(row=>[row.product_name||"",row.barcode||"",row.commonShelfQty??0,formatBoothDateTime(row.updated_at)]))}
      ${boothPdfTable("\u30ac\u30c1\u30e3\u6301\u3061\u51fa\u3057\u5728\u5eab",["\u5546\u54c1\u540d","\u30d0\u30fc\u30b3\u30fc\u30c9","\u30ac\u30c1\u30e3\u6301\u3061\u51fa\u3057\u6570","\u623b\u308a\u5b9f\u6570","\u4f7f\u7528\u6570","\u73fe\u5728\u30ac\u30c1\u30e3\u5728\u5eab"],data.gachaRows.map(row=>[row.product_name||"",row.barcode||"",row.taken,boothGachaDisplayQty(row.returned),boothGachaDisplayQty(row.used),row.remain]))}`;
    if(openBoothPdfWindow(boothEventExportBaseName(event,"\u6301\u3061\u51fa\u3057\u5728\u5eab\u4e00\u89a7"),html))boothShowSuccess("PDF\u51fa\u529b","\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u5728\u5eab\u306ePDF\u3092\u958b\u304d\u307e\u3057\u305f\u3002");
  }catch(error){
    boothShowError("PDF\u51fa\u529b\u30a8\u30e9\u30fc",error.message||"\u6301\u3061\u51fa\u3057\u5728\u5eab\u4e00\u89a7PDF\u306e\u51fa\u529b\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
  }
}

loadBoothDepartureInventoryList=async function(eventId){
  const list=el("boothDepartureInventoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothDepartureInventoryData(eventId);
    const query=String(el("boothDepartureListSearch")?.value||"").trim().toLowerCase();
    const sortKey=String(el("boothDepartureListSort")?.value||localStorage.getItem("arico_booth_departure_list_sort")||"name");
    const filterRows=rows=>query
      ? rows.filter(row=>[row.product_name,row.name,row.barcode,row.shelf].some(value=>String(value||"").toLowerCase().includes(query)))
      : rows;
    const sortRows=rows=>sortBoothInventoryRows(rows.map(row=>({
      ...row,
      name:row.name||row.product_name||"",
      updated_at:row.updated_at||""
    })),sortKey);
    const normalRows=sortRows(filterRows(data.normalRows));
    const gachaRows=sortRows(filterRows(data.gachaRows));
    if(!normalRows.length&&!gachaRows.length){
      list.innerHTML='<div class="booth-empty">持ち出し在庫はありません。</div>';
      return;
    }
    const commonTotal=normalRows.reduce((sum,row)=>sum+Number(row.commonShelfQty||0),0);
    const gachaTotal=gachaRows.reduce((sum,row)=>sum+Number(row.remain||0),0);
    list.innerHTML=`<div class="booth-summary-strip">
      <span>イベント棚在庫：${esc(normalRows.length)}商品 / ${esc(commonTotal)}個</span>
      <span>ガチャ現在庫：${esc(gachaRows.length)}商品 / ${esc(gachaTotal)}個</span>
    </div>${renderBoothDepartureNormalSection(normalRows)}${renderBoothDepartureGachaSection(gachaRows)}`;
  }catch(error){
    list.innerHTML='<div class="booth-empty">持ち出し在庫一覧を読み込めませんでした。</div>';
    boothShowError("持ち出し在庫一覧エラー",error.message||"持ち出し在庫一覧の読み込みに失敗しました。");
  }
};

loadBoothDepartureInventoryList=async function(eventId){
  const list=el("boothDepartureInventoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothDepartureInventoryData(eventId);
    const query=String(el("boothDepartureListSearch")?.value||"").trim().toLowerCase();
    const sortKey=String(el("boothDepartureListSort")?.value||localStorage.getItem("arico_booth_departure_list_sort")||"name");
    const filterKey=String(el("boothDepartureListFilter")?.value||localStorage.getItem("arico_booth_departure_list_filter")||"all");
    const searchMatches=row=>!query||[row.searchText,row.product_name,row.name,row.barcode,row.shelf].some(value=>String(value||"").toLowerCase().includes(query));
    const departureFilterMatches=row=>{
      if(filterKey==="start")return Number(row.startQty||0)>0;
      if(filterKey==="additional")return Number(row.additionalQty||0)>0;
      if(filterKey==="taken")return Number(row.commonShelfQty||0)>0;
      return true;
    };
    const sortRows=rows=>sortBoothInventoryRows(rows.map(row=>({
      ...row,
      name:row.name||row.product_name||"",
      updated_at:row.updated_at||""
    })),sortKey);
    const allNormalRows=Array.isArray(data.normalRows)?data.normalRows:[];
    const allGachaRows=Array.isArray(data.gachaRows)?data.gachaRows:[];
    const normalRows=sortRows(allNormalRows.filter(row=>searchMatches(row)&&departureFilterMatches(row)));
    const gachaRows=sortRows(allGachaRows.filter(row=>searchMatches(row)));
    if(!normalRows.length&&!gachaRows.length){
      list.innerHTML='<div class="booth-empty">条件に一致する持ち出し在庫はありません。</div>';
      return;
    }
    const allCommonRows=allNormalRows.filter(row=>Number(row.commonShelfQty||0)>0);
    const allGachaActiveRows=allGachaRows.filter(row=>Number(row.remain||0)>0);
    const commonTotal=allCommonRows.reduce((sum,row)=>sum+Number(row.commonShelfQty||0),0);
    const gachaTotal=allGachaActiveRows.reduce((sum,row)=>sum+Number(row.remain||0),0);
    list.innerHTML=`<div class="booth-summary-strip">
      <span>イベント棚在庫：${esc(allCommonRows.length)}商品 / ${esc(commonTotal)}個</span>
      <span>ガチャ現在庫：${esc(allGachaActiveRows.length)}商品 / ${esc(gachaTotal)}個</span>
      <span>表示：${esc(normalRows.length)} / ${esc(allNormalRows.length)}商品</span>
    </div>${renderBoothDepartureNormalSection(normalRows)}${renderBoothDepartureGachaSection(gachaRows)}`;
  }catch(error){
    list.innerHTML='<div class="booth-empty">持ち出し在庫一覧を読み込めませんでした。</div>';
    boothShowError("持ち出し在庫一覧エラー",error.message||"持ち出し在庫一覧の読み込みに失敗しました。");
  }
};

loadBoothDepartureInventoryList=async function(eventId){
  const list=el("boothDepartureInventoryList");
  if(!list)return;
  try{
    list.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothDepartureInventoryData(eventId);
    const query=String(el("boothDepartureListSearch")?.value||"").trim().toLowerCase();
    const sortKey=String(el("boothDepartureListSort")?.value||localStorage.getItem("arico_booth_departure_list_sort")||"name");
    const filterKey=String(el("boothDepartureListFilter")?.value||localStorage.getItem("arico_booth_departure_list_filter")||"all");
    const searchMatches=row=>!query||[row.searchText,row.product_name,row.name,row.barcode,row.shelf].some(value=>String(value||"").toLowerCase().includes(query));
    const departureFilterMatches=row=>{
      if(filterKey==="start")return Number(row.startQty||0)>0;
      if(filterKey==="additional")return Number(row.additionalQty||0)>0;
      if(filterKey==="taken")return Number(row.commonShelfQty||0)>0;
      return true;
    };
    const sortRows=rows=>sortBoothInventoryRows(rows.map(row=>({
      ...row,
      name:row.name||row.product_name||"",
      updated_at:row.updated_at||""
    })),sortKey);
    const allNormalRows=Array.isArray(data.normalRows)?data.normalRows:[];
    const allGachaRows=Array.isArray(data.gachaRows)?data.gachaRows:[];
    const normalRows=sortRows(allNormalRows.filter(row=>searchMatches(row)&&departureFilterMatches(row)));
    const gachaRows=sortRows(allGachaRows.filter(row=>searchMatches(row)));
    if(!normalRows.length&&!gachaRows.length){
      list.innerHTML='<div class="booth-empty">条件に一致する持ち出し在庫はありません。</div>';
      return;
    }
    const allCommonRows=allNormalRows.filter(row=>Number(row.commonShelfQty||0)>0);
    const allGachaActiveRows=allGachaRows.filter(row=>Number(row.remain||0)>0);
    const commonTotal=allCommonRows.reduce((sum,row)=>sum+Number(row.commonShelfQty||0),0);
    const gachaTotal=allGachaActiveRows.reduce((sum,row)=>sum+Number(row.remain||0),0);
    list.innerHTML=`<div class="booth-summary-strip">
      <span>イベント棚在庫：${esc(allCommonRows.length)}商品 / ${esc(commonTotal)}個</span>
      <span>ガチャ現在庫：${esc(allGachaActiveRows.length)}商品 / ${esc(gachaTotal)}個</span>
      <span>表示：${esc(normalRows.length)} / ${esc(allNormalRows.length)}商品</span>
    </div>${renderBoothDepartureNormalSection(normalRows)}${renderBoothDepartureGachaSection(gachaRows)}`;
  }catch(error){
    list.innerHTML='<div class="booth-empty">持ち出し在庫一覧を読み込めませんでした。</div>';
    boothShowError("持ち出し在庫一覧エラー",error.message||"持ち出し在庫一覧の読み込みに失敗しました。");
  }
};

exportBoothDepartureInventoryCsv=async function(event){
  try{
    const data=await buildBoothDepartureInventoryData(event?.id);
    const rows=[
      ["今回イベント持ち出し在庫"],
      ["商品名","バーコード","開始時イベント棚","追加持ち出し","イベント棚在庫","最終更新"],
      ...data.normalRows.map(row=>[row.product_name||"",row.barcode||"",row.startQty??0,row.additionalQty??0,row.commonShelfQty??0,row.updated_at||""]),
      [],
      ["ガチャ持ち出し在庫"],
      ["商品名","バーコード","ガチャ持ち出し数","戻り実数","使用数","現在ガチャ在庫"],
      ...data.gachaRows.map(row=>[row.product_name||"",row.barcode||"",row.taken,boothGachaDisplayQty(row.returned),boothGachaDisplayQty(row.used),row.remain])
    ];
    downloadBoothCsvFile(`${boothEventExportBaseName(event,"持ち出し在庫一覧")}.csv`,rows);
  }catch(error){
    boothShowError("CSV出力エラー",error.message||"持ち出し在庫一覧CSVの出力に失敗しました。");
  }
};

exportBoothDepartureInventoryPdf=async function(event){
  try{
    const data=await buildBoothDepartureInventoryData(event?.id);
    const html=`<h1>持ち出し在庫一覧</h1>
      ${boothPdfTable("今回イベント持ち出し在庫",["商品名","バーコード","開始時イベント棚","追加持ち出し","イベント棚在庫","最終更新"],data.normalRows.map(row=>[row.product_name||"",row.barcode||"",row.startQty??0,row.additionalQty??0,row.commonShelfQty??0,formatBoothDateTime(row.updated_at)]))}
      ${boothPdfTable("ガチャ持ち出し在庫",["商品名","バーコード","ガチャ持ち出し数","戻り実数","使用数","現在ガチャ在庫"],data.gachaRows.map(row=>[row.product_name||"",row.barcode||"",row.taken,boothGachaDisplayQty(row.returned),boothGachaDisplayQty(row.used),row.remain]))}`;
    if(openBoothPdfWindow(boothEventExportBaseName(event,"持ち出し在庫一覧"),html))boothShowSuccess("PDF出力","持ち出し在庫一覧のPDFを開きました。");
  }catch(error){
    boothShowError("PDF出力エラー",error.message||"持ち出し在庫一覧PDFの出力に失敗しました。");
  }
};

if(!window.__aricoBoothDepartureCorrectionHandlersBound){
  document.addEventListener("input",event=>{
    const input=event.target.closest("[data-booth-departure-additional],[data-booth-departure-start]");
    if(input)syncBoothDepartureCorrectionRow(input.closest("[data-booth-departure-row]"));
  });
  document.addEventListener("click",event=>{
    const button=event.target.closest("[data-booth-departure-save]");
    if(button)void saveBoothDepartureCorrection(button.dataset.boothDepartureSave||"",button);
  });
  window.__aricoBoothDepartureCorrectionHandlersBound=true;
}

loadBoothEventReport=async function(eventId){
  const body=el("boothEventReportBody");
  if(!body)return;
  try{
    body.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const data=await buildBoothEventReportData(eventId);
    body.innerHTML=`
      <div class="booth-report-summary-grid">
        <div><span>持ち出し確定数</span><strong>${esc(data.totals.start)}</strong></div>
        <div><span>通常売上数</span><strong>${esc(data.totals.normalSalesQty)}</strong></div>
        <div><span>ガチャ売上数</span><strong>${esc(data.totals.gachaSalesQty)}</strong></div>
        <div><span>ガチャ持ち出し / 確定使用</span><strong>${esc(data.totals.gachaRegistered)} / ${esc(data.totals.gachaUsedConfirmed?data.totals.gachaUsed:"未確定")}</strong></div>
        <div><span>在庫差異件数</span><strong>${esc(data.totals.diffCount)}</strong></div>
      </div>
      <section class="booth-report-section"><h5>通常売上集計</h5>${renderBoothReportSalesSummary(data.normalSales)}</section>
      <section class="booth-report-section"><h5>ガチャ売上集計</h5>${renderBoothReportSalesSummary(data.gachaSales)}</section>
      <section class="booth-report-section"><h5>商品別販売実績</h5>${renderBoothReportSalesRows(data.salesRows)}</section>
      <section class="booth-report-section"><h5>ガチャ景品実績</h5>${renderBoothReportGachaItems(data.gacha)}</section>
      <section class="booth-report-section"><h5>在庫差異</h5>${renderBoothReportDiffRows(data.diffRows)}</section>`;
  }catch(e){
    body.innerHTML='<div class="booth-empty">イベントレポートを読み込めませんでした。</div>';
    boothShowError("イベントレポートエラー","イベントレポートの読み込みに失敗しました。\n"+e.message);
  }
};

function boothMoney(value){
  return `¥${Number(value||0).toLocaleString("ja-JP")}`;
}

function getBoothSaleAmount(row){
  return Number(row?.amount||0);
}

const BOOTH_GACHA_SMAREGI_PRODUCT_IDS=new Set(["18485","11274"]);
const BOOTH_NON_GACHA_DISCOUNT_RATE=0.1;

function isBoothGachaSaleRow(row){
  return BOOTH_GACHA_SMAREGI_PRODUCT_IDS.has(String(row?.smaregi_product_id||"").trim());
}

function getBoothReportSaleAmount(row){
  const amount=getBoothSaleAmount(row);
  if(isBoothGachaSaleRow(row))return amount;
  const discount=Math.floor(Math.abs(amount)*BOOTH_NON_GACHA_DISCOUNT_RATE);
  return amount>=0?amount-discount:amount+discount;
}

function prepareBoothReportSalesRows(rows){
  return (Array.isArray(rows)?rows:[]).map(row=>({
    ...row,
    amount:getBoothReportSaleAmount(row)
  }));
}

function aggregateBoothSalesByProduct(rows){
  const map=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    const key=String(row.barcode||row.smaregi_product_id||row.product_name||"").trim();
    if(!key)return;
    const current=map.get(key)||{
      product_name:row.product_name||"",
      barcode:row.barcode||"",
      smaregi_product_id:row.smaregi_product_id||"",
      quantity:0,
      amount:0,
      transaction_count:0
    };
    current.product_name=current.product_name||row.product_name||"";
    current.barcode=current.barcode||row.barcode||"";
    current.smaregi_product_id=current.smaregi_product_id||row.smaregi_product_id||"";
    current.quantity+=Number(row.quantity||0);
    current.amount+=getBoothSaleAmount(row);
    current.transaction_count+=1;
    map.set(key,current);
  });
  return [...map.values()].sort((a,b)=>String(a.product_name||"").localeCompare(String(b.product_name||""),"ja",{numeric:true,sensitivity:"base"}));
}

function getBoothReportSalesSummaryRows(rows){
  const list=Array.isArray(rows)?rows:[];
  return {
    detailCount:list.length,
    productCount:aggregateBoothSalesByProduct(list).length,
    qty:list.reduce((sum,row)=>sum+Number(row.quantity||0),0),
    amount:list.reduce((sum,row)=>sum+getBoothSaleAmount(row),0)
  };
}

function getBoothReportSalesKey(row){
  return String(row?.barcode||row?.smaregi_product_id||"").trim();
}

function mergeBoothReportReturnSales(itemRows,salesRows){
  const salesByKey=new Map();
  (Array.isArray(salesRows)?salesRows:[]).forEach(row=>{
    if(isBoothGachaSaleRow(row))return;
    const key=getBoothReportSalesKey(row);
    if(!key)return;
    salesByKey.set(key,(salesByKey.get(key)||0)+Number(row.quantity||0));
  });
  return (Array.isArray(itemRows)?itemRows:[]).map(row=>{
    const key=getBoothReportSalesKey(row);
    const importedQty=key&&salesByKey.has(key)?salesByKey.get(key):null;
    return {
      ...row,
      // Event sales imports are the report source of truth. Older confirmed
      // events may only have booth_event_items.sold_qty, so retain that value
      // only when no matching import detail exists.
      sold_qty:importedQty===null?Number(row.sold_qty||0):importedQty
    };
  });
}

function getBoothNormalCarryOutStartQty(row){
  return Math.max(0,Number(row?.storage_takeout_qty||0));
}

function getBoothNormalCarryOutAdditionalQty(row){
  return Math.max(0,Number(row?.normal_takeout_qty||0));
}

function getBoothNormalCarryOutTotalQty(row){
  const splitTotal=getBoothNormalCarryOutStartQty(row)+getBoothNormalCarryOutAdditionalQty(row);
  if(splitTotal>0)return splitTotal;
  return Math.max(0,Number(row?.taken_qty||0));
}

function normalizeBoothNormalCarryOutRow(row){
  const total=getBoothNormalCarryOutTotalQty(row);
  return {
    ...row,
    taken_qty:total
  };
}

buildBoothEventReportData=async function(eventId){
  const [items,importsResult,movements,diffRows]=await Promise.all([
    sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,consumed_qty,difference_qty,diff_memo,event_storage_qty,shelf_return_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,shelf_return_reflected_by,return_process_type,return_reflected,return_reflected_qty,return_reflected_at,return_reflected_by,updated_at&event_id=eq.${encodeURIComponent(eventId)}&order=product_name.asc&limit=3000`).catch(()=>[]),
    sb(`event_sales_imports?select=*&event_id=eq.${encodeURIComponent(eventId)}&import_status=in.(pending,confirmed)&order=sold_at.asc&limit=3000`)
      .then(rows=>({ok:true,rows:Array.isArray(rows)?rows:[]}))
      .catch(error=>({ok:false,rows:[],error})),
    sb(`booth_stock_movements?select=created_at,product_name,barcode,quantity,staff,memo,movement_type,item_type&event_id=eq.${encodeURIComponent(eventId)}&movement_type=in.(departure_count,return,gacha_pick,gacha_return,event_close_return)&order=created_at.desc&limit=3000`).catch(()=>[]),
    buildBoothDiffUniverseRows(eventId).catch(()=>[])
  ]);
  if(!importsResult.ok){
    throw new Error(`イベント販売実績の取得に失敗しました。販売数を0として計算していません。${importsResult.error?.message?`\n${importsResult.error.message}`:""}`);
  }
  const rows=(Array.isArray(items)?items:[]).map(row=>String(row.item_type||"normal")==="normal"?normalizeBoothNormalCarryOutRow(row):row);
  const gacha=rows.filter(row=>String(row.item_type||"")==="gacha_prize");
  const salesRows=dedupeBoothSalesRows(importsResult.rows);
  const isGachaSale=row=>isBoothGachaSaleRow(row);
  const normalSales=salesRows.filter(row=>!isGachaSale(row));
  const gachaSales=salesRows.filter(isGachaSale);
  const reportNormalSales=prepareBoothReportSalesRows(normalSales);
  const reportGachaSales=prepareBoothReportSalesRows(gachaSales);
  const normalSummary=getBoothReportSalesSummaryRows(reportNormalSales);
  const gachaSummary=getBoothReportSalesSummaryRows(reportGachaSales);
  return {
    normal:mergeBoothReportReturnSales(rows.filter(row=>String(row.item_type||"normal")==="normal"),normalSales),
    gacha,
    salesRows:[...reportNormalSales,...reportGachaSales],
    normalSales:reportNormalSales,
    gachaSales:reportGachaSales,
    normalSalesProducts:aggregateBoothSalesByProduct(reportNormalSales),
    gachaSalesProducts:aggregateBoothSalesByProduct(reportGachaSales),
    movements:Array.isArray(movements)?movements:[],
    diffRows:Array.isArray(diffRows)?diffRows:[],
    totals:{
      normalSalesQty:normalSummary.qty,
      normalSalesAmount:normalSummary.amount,
      normalSalesProducts:normalSummary.productCount,
      gachaSalesQty:gachaSummary.qty,
      gachaSalesAmount:gachaSummary.amount,
      gachaSalesProducts:gachaSummary.productCount,
      totalSalesAmount:normalSummary.amount+gachaSummary.amount,
      gachaRegistered:gacha.reduce((sum,row)=>sum+Number(row.taken_qty||0),0),
      gachaUsed:gacha.reduce((sum,row)=>sum+Number(boothGachaUsedQty(row)||0),0),
      gachaUsedConfirmed:gacha.length>0&&gacha.every(row=>isBoothGachaReturnCounted(row)),
      start:rows.filter(row=>String(row.item_type||"normal")==="normal").reduce((sum,row)=>sum+getBoothNormalCarryOutTotalQty(row),0),
      diffCount:(Array.isArray(diffRows)?diffRows:[]).filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered).length
    }
  };
};

function renderBoothReportOverview(event,data){
  return `<section class="booth-report-section booth-report-overview">
    <h5>1. イベント概要</h5>
    <div class="booth-report-overview-grid">
      <div><span>イベント名</span><strong>${esc(event?.name||"-")}</strong></div>
      <div><span>会場</span><strong>${esc(event?.venue||"-")}</strong></div>
      <div><span>期間</span><strong>${esc([event?.event_start,event?.event_end].filter(Boolean).join(" - ")||"-")}</strong></div>
      <div><span>持ち出し確定数</span><strong>${esc(data.totals.start)}</strong></div>
    </div>
  </section>`;
}

function renderBoothReportSalesSummaryCards(data){
  return `<section class="booth-report-section">
    <h5>2. 売上サマリー</h5>
    <div class="booth-report-summary-grid booth-report-sales-summary">
      <div><span>通常売上</span><strong>${esc(boothMoney(data.totals.normalSalesAmount))}</strong></div>
      <div><span>通常販売点数</span><strong>${esc(data.totals.normalSalesQty)}</strong></div>
      <div><span>ガチャ売上</span><strong>${esc(boothMoney(data.totals.gachaSalesAmount))}</strong></div>
      <div><span>ガチャ回数</span><strong>${esc(data.totals.gachaSalesQty)}</strong></div>
      <div><span>合計売上</span><strong>${esc(boothMoney(data.totals.totalSalesAmount))}</strong></div>
    </div>
  </section>`;
}

renderBoothReportSalesRows=function(rows){
  const aggregated=aggregateBoothSalesByProduct(rows);
  if(!aggregated.length)return '<div class="booth-empty">販売実績はありません。</div>';
  const tableRows=aggregated.map(row=>{
    const avg=row.quantity?Math.round(row.amount/row.quantity):0;
    return `<tr><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.quantity)}</td><td>${esc(boothMoney(row.amount))}</td><td>${esc(boothMoney(avg))}</td></tr>`;
  }).join("");
  const cards=aggregated.map(row=>{
    const avg=row.quantity?Math.round(row.amount/row.quantity):0;
    return `<article class="booth-history-card booth-report-product-card">
      <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong></div>
      <div class="booth-history-card-meta">
        <span>バーコード：${esc(row.barcode||"-")}</span>
        <span>販売数量合計：${esc(row.quantity)}</span>
        <span>売上金額合計：${esc(boothMoney(row.amount))}</span>
        <span>平均販売単価：${esc(boothMoney(avg))}</span>
      </div>
    </article>`;
  }).join("");
  return `<div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-report-sales-product-table">
    <thead><tr><th>商品名</th><th>バーコード</th><th>販売数量合計</th><th>売上金額合計</th><th>平均販売単価</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div><div class="booth-history-cards booth-scroll-cards">${cards}</div>`;
};

renderBoothReportSalesSummary=function(rows){
  const summary=getBoothReportSalesSummaryRows(rows);
  if(!summary.detailCount)return '<div class="booth-empty">対象売上はありません。</div>';
  return `<div class="booth-report-mini-summary">
    <div><span>商品数</span><strong>${esc(summary.productCount)}</strong></div>
    <div><span>販売点数</span><strong>${esc(summary.qty)}</strong></div>
    <div><span>売上金額</span><strong>${esc(boothMoney(summary.amount))}</strong></div>
  </div>`;
};

loadBoothEventReport=async function(eventId){
  const body=el("boothEventReportBody");
  if(!body)return;
  try{
    body.innerHTML='<div class="booth-empty">読み込み中...</div>';
    const event=getBoothCurrentEvent();
    // Keep an open event report in sync with the latest booth-sales cache.
    // Closed events continue to use saved imports and do not trigger another
    // sales API request.
    if(event&&String(event.id)===String(eventId)&&!isBoothEventClosed(event)&&typeof window.refreshBoothOngoingSalesCache==="function"){
      await window.refreshBoothOngoingSalesCache().catch(error=>console.warn("[booth report sales refresh skipped]",error));
    }
    const data=await buildBoothEventReportData(eventId);
    body.innerHTML=`
      ${renderBoothReportOverview(event,data)}
      ${renderBoothReportSalesSummaryCards(data)}
      <section class="booth-report-section"><h5>3. 商品別販売実績</h5><p class="section-note">商品ごとに集計した販売実績です。取引ごとの詳細は販売履歴で確認します。</p>${renderBoothReportSalesRows(data.normalSales)}</section>
      <section class="booth-report-section"><h5>4. ガチャ実績</h5>${renderBoothReportSalesSummary(data.gachaSales)}${renderBoothReportGachaItems(data.gacha)}</section>
      ${renderBoothReportReturnBatchSection(data.normal)}

      <section class="booth-report-section"><h5>5. 在庫結果</h5>${renderBoothReportDiffRows(data.diffRows)}</section>`;
  }catch(e){
    body.innerHTML='<div class="booth-empty">イベントレポートを読み込めませんでした。</div>';
    boothShowError("イベントレポートエラー","イベントレポートの読み込みに失敗しました。\n"+e.message);
  }
};

exportBoothEventReportCsv=async function(event){
  try{
    const data=await buildBoothEventReportData(event.id);
    const diffRows=data.diffRows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
    const normalProducts=aggregateBoothSalesByProduct(data.normalSales);
    const gachaProducts=aggregateBoothSalesByProduct(data.gachaSales);
    const rows=[
      ["イベント概要"],
      ["イベント名",event?.name||""],
      ["会場",event?.venue||""],
      ["開始日",event?.event_start||""],
      ["終了日",event?.event_end||""],
      [],
      ["売上サマリー"],
      ["通常売上","通常販売点数","ガチャ売上","ガチャ回数","合計売上"],
      [data.totals.normalSalesAmount,data.totals.normalSalesQty,data.totals.gachaSalesAmount,data.totals.gachaSalesQty,data.totals.totalSalesAmount],
      [],
      ["商品別販売実績"],
      ["商品名","バーコード","販売数量合計","売上金額合計"],
      ...normalProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,row.amount]),
      [],
      ["ガチャ売上集計"],
      ["商品名","バーコード","販売数量合計","売上金額合計"],
      ...gachaProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,row.amount]),
      [],
      ["ガチャ景品実績"],
      ["商品名","バーコード","ガチャ持ち出し数","戻り実数","使用数"],
      ...data.gacha.map(row=>[row.product_name||"",row.barcode||"",row.taken_qty??0,boothGachaDisplayQty(boothGachaReturnActualQty(row)),boothGachaDisplayQty(boothGachaUsedQty(row))]),
      [],
      ["在庫差異"],
      ["商品名","バーコード","比較店舗","持ち出し","販売","戻り","消費","差異","状態"],
      ...diffRows.map(row=>[row.product_name||"",row.barcode||"",row.store_code||"",row.taken_registered?row.taken_qty:"未登録",row.sold_qty??0,row.returned_qty??0,row.consumed_qty??0,calculateBoothItemDifference(row),row.taken_registered?"要確認":"持ち出し未登録"])
    ];
    downloadBoothCsvFile(`${boothEventExportBaseName(event,"イベントレポート")}.csv`,rows);
  }catch(e){
    boothShowError("CSV出力エラー","イベントレポートCSVの出力に失敗しました。\n"+e.message);
  }
};

exportBoothEventReportPdf=async function(event){
  try{
    const data=await buildBoothEventReportData(event.id);
    const normalProducts=aggregateBoothSalesByProduct(data.normalSales);
    const gachaProducts=aggregateBoothSalesByProduct(data.gachaSales);
    const diffRows=data.diffRows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
    const html=`<h1>イベントレポート</h1>
      <div class="meta">
        <strong>イベント</strong><span>${esc(event?.name||"-")}</span>
        <strong>会場</strong><span>${esc(event?.venue||"-")}</span>
        <strong>期間</strong><span>${esc([event?.event_start,event?.event_end].filter(Boolean).join(" - ")||"-")}</span>
        <strong>出力日時</strong><span>${esc(new Date().toLocaleString("ja-JP"))}</span>
      </div>
      <div class="summary">
        <div><strong>通常売上</strong><br>${esc(boothMoney(data.totals.normalSalesAmount))}</div>
        <div><strong>通常販売点数</strong><br>${esc(data.totals.normalSalesQty)}</div>
        <div><strong>ガチャ売上</strong><br>${esc(boothMoney(data.totals.gachaSalesAmount))}</div>
        <div><strong>ガチャ回数</strong><br>${esc(data.totals.gachaSalesQty)}</div>
        <div><strong>合計売上</strong><br>${esc(boothMoney(data.totals.totalSalesAmount))}</div>
      </div>
      ${boothPdfTable("商品別販売実績",["商品名","バーコード","販売数量合計","売上金額合計"],normalProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,boothMoney(row.amount)]))}
      ${boothPdfTable("ガチャ売上集計",["商品名","バーコード","販売数量合計","売上金額合計"],gachaProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,boothMoney(row.amount)]))}
      ${boothPdfTable("ガチャ景品実績",["商品名","バーコード","ガチャ持ち出し数","戻り実数","使用数"],data.gacha.map(row=>[row.product_name||"",row.barcode||"",row.taken_qty??0,boothGachaDisplayQty(boothGachaReturnActualQty(row)),boothGachaDisplayQty(boothGachaUsedQty(row))]))}
      ${boothPdfTable("在庫差異",["商品名","バーコード","比較店舗","持ち出し","販売","戻り","消費","差異","状態"],diffRows.map(row=>[row.product_name||"",row.barcode||"",row.store_code||"",row.taken_registered?row.taken_qty:"未登録",row.sold_qty??0,row.returned_qty??0,row.consumed_qty??0,calculateBoothItemDifference(row),row.taken_registered?"要確認":"持ち出し未登録"]))}`;
    if(openBoothPdfWindow(boothEventExportBaseName(event,"イベントレポート"),html))boothShowSuccess("PDF出力","イベントレポートPDFの印刷画面を開きました。");
  }catch(e){
    boothShowError("PDF出力エラー","イベントレポートPDFの出力に失敗しました。\n"+e.message);
  }
};

// Ver 2.74: count event returns first; choose the destination in the report.
(function(){
  const root=window;
  const states=root.__aricoPureReturnStates||(root.__aricoPureReturnStates=new Map());

  function currentEvent(){
    return typeof getBoothCurrentEvent==="function"?getBoothCurrentEvent():null;
  }

  function key(event){return String(event?.id||"");}

  function stateFor(event){
    const id=key(event);
    let state=states.get(id);
    if(!state){
      state={eventId:id,event,rows:new Map(),draft:new Map(),saved:new Map(),saving:new Set(),query:"",loading:true,error:"",lastSyncedAt:""};
      states.set(id,state);
    }
    state.event=event;
    if(!state.saving)state.saving=new Set();
    return state;
  }

  function takeoutQty(row){
    const taken=Number(row?.taken_qty||0);
    if(taken>0)return taken;
    return Math.max(0,Number(row?.normal_takeout_qty||0)+Number(row?.storage_takeout_qty||0));
  }

  function countRows(event){
    return sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,returned_qty,updated_at&event_id=eq.${encodeURIComponent(event.id)}&item_type=eq.normal&order=product_name.asc&limit=5000`)
      .then(rows=>(Array.isArray(rows)?rows:[]).filter(row=>takeoutQty(row)>0||Number(row?.returned_qty||0)>0));
  }

  function pureReturnRows(state){
    const query=String(state.query||"").trim().toLowerCase();
    return [...state.rows.values()].filter(row=>{
      if(!query)return true;
      return `${row.product_name||""} ${row.barcode||""}`.toLowerCase().includes(query);
    });
  }

  function renderPureReturnList(state){
    const list=el("boothReturnDraftList");
    if(!list)return;
    const previousScrollTop=list.scrollTop||0;
    const updateSummary=()=>{
      const changed=[...state.rows.entries()].filter(([barcode,row])=>Number(state.draft.get(barcode)??row.returned_qty??0)!==Number(state.saved.get(barcode)??row.returned_qty??0)).length;
      const saving=state.saving?.size||0;
      const badge=el("boothReturnUnsavedBadge");
      if(badge){
        if(state.loading)badge.textContent="共有棚卸を読み込み中";
        else if(saving>0)badge.textContent=`保存中：${saving}商品`;
        else badge.textContent=state.lastSyncedAt?`共有棚卸中 / 最終更新：${state.lastSyncedAt}`:"共有棚卸中";
        badge.classList.toggle("is-active",changed>0||saving>0);
      }
      const button=el("boothReturnApplyBtn");
      if(button){
        button.textContent=saving>0?"保存中...":"戻り棚卸を確認して完了";
        button.disabled=state.loading||saving>0||isBoothEventClosed(state.event);
      }
    };
    if(state.loading){
      list.innerHTML='<div class="booth-empty" data-pure-return-loading>戻り実数を読み込み中...</div>';
      updateSummary();
      return;
    }
    if(state.error){
      list.innerHTML=`<div class="booth-error-message">${esc(state.error)}</div>`;
      updateSummary();
      return;
    }
    const rows=pureReturnRows(state);
    if(!rows.length){
      list.innerHTML='<div class="booth-empty">対象商品がありません。</div>';
      updateSummary();
      return;
    }
    const closed=isBoothEventClosed(state.event);
    list.innerHTML=rows.map(row=>{
      const barcode=String(row.barcode||"");
      const max=takeoutQty(row);
      const value=Number(state.draft.get(barcode)??row.returned_qty??0);
      const saved=Number(state.saved.get(barcode)??row.returned_qty??0);
      const dirty=value!==saved;
      const saving=state.saving?.has(barcode);
      return `<article class="booth-return-draft-item ${saving||dirty?"is-dirty":""}" data-pure-return-row data-barcode="${esc(barcode)}">
        <div class="booth-return-draft-head">
          <div><strong>${esc(row.product_name||"-")}</strong><span class="booth-return-unsaved-chip" data-pure-return-dirty-chip ${saving||dirty?"":"hidden"}>${saving?"保存中":"未保存"}</span></div>
          <button type="button" class="secondary" data-pure-return-action="remove" data-barcode="${esc(barcode)}" ${closed||saving?"disabled":""}>削除</button>
        </div>
        <div class="booth-return-draft-meta"><span>バーコード：${esc(barcode)}</span><span>持ち出し数：${esc(max)}</span><span data-pure-return-save-summary>共有保存済み：${esc(saved)}</span></div>
        <div class="booth-return-qty-title">今回の戻り数量</div>
        <div class="booth-return-draft-controls">
          <button type="button" class="secondary" data-pure-return-action="decrease" data-barcode="${esc(barcode)}" ${closed||saving||value<=0?"disabled":""}>−</button>
          <input type="number" min="0" max="${esc(max)}" step="1" inputmode="numeric" value="${esc(value)}" data-pure-return-qty="${esc(barcode)}" ${closed||saving?"disabled":""}>
          <button type="button" class="secondary" data-pure-return-action="increase" data-barcode="${esc(barcode)}" ${closed||saving||value>=max?"disabled":""}>＋</button>
        </div>
        <button type="button" class="booth-return-card-save" data-pure-return-action="save" data-barcode="${esc(barcode)}" ${closed||saving||!dirty?"disabled":""}>保存</button>
      </article>`;
    }).join("");
    updateSummary();
    list.scrollTop=previousScrollTop;
  }

  function pureReturnCardForBarcode(barcode){
    const list=el("boothReturnDraftList");
    if(!list)return null;
    return [...list.querySelectorAll("[data-pure-return-row]")].find(node=>String(node.dataset.barcode||"")===String(barcode||""))||null;
  }

  function refreshPureReturnDraftCard(state,barcode){
    const row=state?.rows?.get(String(barcode||""));
    const card=pureReturnCardForBarcode(barcode);
    if(!row||!card)return;
    const value=Number(state.draft.get(String(barcode))??row.returned_qty??0);
    const saved=Number(state.saved.get(String(barcode))??row.returned_qty??0);
    const saving=state.saving?.has(String(barcode));
    const dirty=value!==saved;
    const chip=card.querySelector("[data-pure-return-dirty-chip]");
    if(chip){
      chip.textContent=saving?"保存中":"未保存";
      chip.hidden=!(saving||dirty);
    }
    const summary=card.querySelector("[data-pure-return-save-summary]");
    if(summary)summary.textContent=dirty?`共有保存済み：${saved} → 今回：${value}`:`共有保存済み：${saved}`;
    const save=card.querySelector("[data-pure-return-action='save']");
    if(save)save.disabled=state.loading||saving||!dirty||isBoothEventClosed(state.event);
    const decrease=card.querySelector("[data-pure-return-action='decrease']");
    if(decrease)decrease.disabled=state.loading||saving||value<=0||isBoothEventClosed(state.event);
    const increase=card.querySelector("[data-pure-return-action='increase']");
    if(increase)increase.disabled=state.loading||saving||value>=takeoutQty(row)||isBoothEventClosed(state.event);
    card.classList.toggle("is-dirty",dirty);
  }

  function focusPureReturnQty(barcode){
    setTimeout(()=>{
      const card=pureReturnCardForBarcode(barcode);
      const input=card?.querySelector("[data-pure-return-qty]");
      if(input){
        input.focus({preventScroll:true});
        input.select?.();
      }
    },80);
  }

  function renderPureReturnSearchResults(state){
    const box=el("boothReturnProductSearchResults");
    if(!box)return;
    const query=String(state.query||"").trim().toLowerCase();
    if(!query){
      box.hidden=true;
      box.innerHTML="";
      return;
    }
    box.hidden=false;
    if(state.loading){
      box.innerHTML='<div class="booth-empty">戻り実数を読み込み中...</div>';
      return;
    }
    if(state.error){
      box.innerHTML=`<div class="booth-error-message">${esc(state.error)}</div>`;
      return;
    }
    const rows=[...state.rows.values()].filter(row=>{
      return `${row.product_name||""} ${row.barcode||""}`.toLowerCase().includes(query);
    }).slice(0,30);
    if(!rows.length){
      box.innerHTML='<div class="booth-empty">該当商品がありません。</div>';
      return;
    }
    box.innerHTML=rows.map(row=>{
      const barcode=String(row.barcode||"");
      return `<button type="button" class="booth-return-search-result" data-pure-return-search-barcode="${esc(barcode)}">
        <span class="booth-return-search-copy"><strong>${esc(row.product_name||"-")}</strong><small>バーコード: ${esc(barcode)} / 持ち出し数: ${esc(takeoutQty(row))}</small></span>
        <span class="booth-return-search-action">選択</span>
      </button>`;
    }).join("");
  }

  function renderPureReturnHistory(state,rows){
    const list=el("boothReturnHistoryList");
    if(!list)return;
    const saved=(Array.isArray(rows)?rows:[...state.rows.values()]).filter(row=>Number(row?.returned_qty||0)>0);
    if(!saved.length){
      list.innerHTML='<div class="booth-empty">保存済みの戻り実績はありません。</div>';
      return;
    }
    list.innerHTML=`<div class="booth-history-table-wrap"><table class="booth-history-table"><thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し数</th><th>戻り実数</th></tr></thead><tbody>${saved.map(row=>`<tr><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(takeoutQty(row))}</td><td><strong>${esc(row.returned_qty||0)}</strong></td></tr>`).join("")}</tbody></table></div>`;
  }

  function setPureReturnControlsDisabled(disabled){
    ["boothReturnBarcode","boothReturnProductSearch","boothReturnStaff","boothReturnMemo","boothReturnApplyBtn","boothReturnStartCameraBtn"].forEach(id=>{
      const node=el(id);
      if(node)node.disabled=disabled;
    });
  }

  async function loadPureReturnState(state){
    state.loading=true;
    state.error="";
    renderPureReturnList(state);
    setPureReturnControlsDisabled(true);
    try{
      const rows=await countRows(state.event);
      state.rows=new Map(rows.map(row=>[String(row.barcode||""),row]).filter(([barcode])=>barcode));
      for(const [barcode,row] of state.rows){
        const returned=Math.max(0,Number(row.returned_qty||0));
        state.draft.set(barcode,returned);
        state.saved.set(barcode,returned);
      }
      state.lastSyncedAt=new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"});
      state.loading=false;
      renderPureReturnList(state);
      renderPureReturnSearchResults(state);
      renderPureReturnHistory(state,rows);
      setPureReturnControlsDisabled(isBoothEventClosed(state.event));
    }catch(error){
      state.loading=false;
      state.error=error?.message||"戻り実績を取得できませんでした。";
      renderPureReturnList(state);
      renderPureReturnSearchResults(state);
      renderPureReturnHistory(state,[]);
      setPureReturnControlsDisabled(true);
    }
  }

  function applyPureReturnRow(state,row){
    const barcode=String(row?.barcode||"");
    if(!barcode)return;
    const returned=Math.max(0,Number(row.returned_qty||0));
    state.rows.set(barcode,row);
    state.draft.set(barcode,returned);
    state.saved.set(barcode,returned);
    state.lastSyncedAt=new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"});
  }

  async function patchPureReturnQtyWithCurrentValue(item,currentReturned,nextReturned){
    const returnedFilter=item.returned_qty===null||item.returned_qty===undefined?"returned_qty=is.null":`returned_qty=eq.${encodeURIComponent(currentReturned)}`;
    const rows=await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}&${returnedFilter}&select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,returned_qty,updated_at`,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({returned_qty:nextReturned,updated_at:new Date().toISOString()})
    });
    return Array.isArray(rows)&&rows.length?rows[0]:null;
  }

  async function savePureReturnQty(state,barcode,nextQty,{increment=0,focusQty=false}={}){
    barcode=String(barcode||"");
    const event=state?.event;
    if(!event||!barcode||state.loading||isBoothEventClosed(event))return;
    if(state.saving.has(barcode))return;
    state.saving.add(barcode);
    renderPureReturnList(state);
    try{
      let latest=null;
      let updated=null;
      for(let attempt=0;attempt<3;attempt++){
        latest=await findBoothEventItemByBarcode(event.id,barcode);
        if(!latest||latest.item_type!=="normal"||takeoutQty(latest)<=0)throw new Error("このイベントの持ち出し対象商品ではありません。");
        const max=takeoutQty(latest);
        const base=Number(latest.returned_qty||0);
        const rawNext=increment?base+Number(increment||0):Number(nextQty||0);
        if(!Number.isInteger(rawNext)||rawNext<0)throw new Error("戻り実数は0以上の整数で入力してください。");
        const safeNext=Math.max(0,Math.min(max,rawNext));
        if(increment){
          updated=await patchPureReturnQtyWithCurrentValue(latest,base,safeNext);
          if(updated)break;
          continue;
        }
        await patchBoothEventItem(latest,{returned_qty:safeNext});
        updated={...latest,returned_qty:safeNext};
        break;
      }
      if(!updated)throw new Error("他端末の更新と重なりました。もう一度読み取ってください。");
      applyPureReturnRow(state,{...latest,...updated});
      renderPureReturnHistory(state,[...state.rows.values()]);
    }catch(error){
      boothShowError("戻り実数保存エラー",error?.message||"戻り実数を保存できませんでした。","boothReturnBarcode");
    }finally{
      state.saving.delete(barcode);
      renderPureReturnList(state);
      renderPureReturnSearchResults(state);
      if(focusQty)focusPureReturnQty(barcode);
    }
  }

  function changePureReturnQty(state,barcode,delta){
    const row=state.rows.get(String(barcode||""));
    if(!row)return;
    const max=takeoutQty(row);
    const current=Number(state.draft.get(barcode)??row.returned_qty??0);
    const next=Math.max(0,Math.min(max,current+delta));
    void savePureReturnQty(state,barcode,next);
  }

  root.renderBoothReturnPanel=function(event){
    const area=el("boothEventWorkArea");
    if(!area)return;
    const state=stateFor(event);
    const closed=isBoothEventClosed(event);
    const staffOptions=typeof getBoothStaffOptions==="function"?getBoothStaffOptions():"";
    area.innerHTML=`<section class="booth-work-card booth-return-card">
      <div class="booth-return-hero">
        <div>
          <h4>戻り在庫棚卸</h4>
          <p class="section-note">イベントから戻ってきた商品をスキャンし、実際に戻ってきた数量を入力してください。<br>この画面では戻り先は決定しません。</p>
        </div>
        <strong id="boothReturnUnsavedBadge" class="booth-return-unsaved-summary">未保存：0商品</strong>
      </div>
      <div class="booth-return-input-panel">
        <div class="booth-return-scan-controls">
          <label class="booth-return-barcode-label">バーコード<input id="boothReturnBarcode" autocomplete="off" inputmode="numeric" placeholder="バーコードを入力してEnter" ${closed?"disabled":""}></label>
          <button type="button" id="boothReturnStartCameraBtn" ${closed?"disabled":""}>カメラ読取</button>
          <button type="button" id="boothReturnStopCameraBtn" class="secondary">停止</button>
        </div>
        <div class="booth-return-product-search"><label>商品検索<input id="boothReturnProductSearch" autocomplete="off" placeholder="商品名・バーコードで検索" ${closed?"disabled":""}></label><div id="boothReturnProductSearchResults" class="booth-return-product-search-results" hidden></div></div>
        <div class="booth-return-common-fields"><label>担当者<select id="boothReturnStaff" ${closed?"disabled":""}>${staffOptions}</select></label><label>メモ<input id="boothReturnMemo" autocomplete="off" placeholder="任意メモ" ${closed?"disabled":""}></label></div>
      </div>
      <div class="camera-area booth-camera-area booth-return-camera-area">
        <video id="boothCarryOutVideo" muted playsinline></video>
        <div class="camera-guide-overlay" aria-hidden="true"></div>
      </div>
      <div class="booth-return-divider"><span>今回の棚卸</span></div>
      <div id="boothReturnDraftList" class="booth-return-draft-list"><div class="booth-empty" data-pure-return-loading>戻り実数を読み込み中...</div></div>
      <button type="button" id="boothReturnApplyBtn" class="booth-return-apply-btn" ${closed?"disabled":""}>戻り棚卸を確認して完了</button>
    </section>
    <section class="booth-work-card booth-return-history-card"><div class="booth-list-header"><div><h4>過去の戻り履歴</h4><p class="section-note">保存済みの戻り実数です。</p></div><button type="button" id="reloadBoothReturnHistoryBtn" class="secondary">再読み込み</button></div><div id="boothReturnHistoryList" class="booth-carry-history-list"><div class="booth-empty">読み込み中...</div></div></section>`;

    const barcodeInput=el("boothReturnBarcode");
    barcodeInput?.addEventListener("keydown",inputEvent=>{
      if(inputEvent.key!=="Enter")return;
      inputEvent.preventDefault();
      void root.addBoothReturnDraftFromBarcode(barcodeInput.value);
      barcodeInput.value="";
    });
    el("boothReturnProductSearch")?.addEventListener("input",inputEvent=>{
      state.query=inputEvent.target.value;
      renderPureReturnSearchResults(state);
      renderPureReturnList(state);
    });
    el("boothReturnProductSearchResults")?.addEventListener("click",inputEvent=>{
      const button=inputEvent.target.closest("[data-pure-return-search-barcode]");
      if(!button)return;
      const barcode=String(button.dataset.pureReturnSearchBarcode||"");
      const searchInput=el("boothReturnProductSearch");
      if(searchInput)searchInput.value="";
      state.query="";
      renderPureReturnSearchResults(state);
      void root.addBoothReturnDraftFromBarcode(barcode);
    });
    el("boothReturnDraftList")?.addEventListener("click",inputEvent=>{
      const button=inputEvent.target.closest("[data-pure-return-action]");
      if(!button)return;
      const barcode=String(button.dataset.barcode||"");
      if(button.dataset.pureReturnAction==="remove")void savePureReturnQty(state,barcode,0);
      else if(button.dataset.pureReturnAction==="increase")changePureReturnQty(state,barcode,1);
      else if(button.dataset.pureReturnAction==="decrease")changePureReturnQty(state,barcode,-1);
      else if(button.dataset.pureReturnAction==="save"){
        const row=state.rows.get(barcode);
        if(!row)return;
        const next=Number(state.draft.get(barcode)??row.returned_qty??0);
        void savePureReturnQty(state,barcode,next);
      }
    });
    el("boothReturnDraftList")?.addEventListener("input",inputEvent=>{
      const input=inputEvent.target.closest("[data-pure-return-qty]");
      if(!input)return;
      const barcode=String(input.dataset.pureReturnQty||"");
      const row=state.rows.get(barcode);
      if(!row)return;
      const text=String(input.value||"").trim();
      if(text!==""&&!/^[0-9]+$/.test(text)){
        input.value=String(state.draft.get(barcode)??row.returned_qty??0);
        return;
      }
      const max=takeoutQty(row);
      const next=text===""?0:Math.max(0,Math.min(max,Number(text)));
      if(String(next)!==text&&text!=="")input.value=String(next);
      state.draft.set(barcode,next);
      refreshPureReturnDraftCard(state,barcode);
    });
    el("boothReturnDraftList")?.addEventListener("change",inputEvent=>{
      const input=inputEvent.target.closest("[data-pure-return-qty]");
      if(!input)return;
      const barcode=String(input.dataset.pureReturnQty||"");
      const row=state.rows.get(barcode);
      const text=String(input.value||"").trim();
      if(!row||!/^[0-9]+$/.test(text)){renderPureReturnList(state);return;}
      const next=Math.max(0,Math.min(takeoutQty(row),Number(text)));
      input.value=String(next);
      state.draft.set(barcode,next);
      refreshPureReturnDraftCard(state,barcode);
    });
    el("boothReturnApplyBtn")?.addEventListener("click",()=>void root.saveBoothReturnDraft());
    el("reloadBoothReturnHistoryBtn")?.addEventListener("click",()=>void loadPureReturnState(state));
    el("boothReturnStartCameraBtn")?.addEventListener("click",()=>{boothScanTarget="return";startBoothCarryOutCamera();});
    el("boothReturnStopCameraBtn")?.addEventListener("click",stopBoothCarryOutCamera);
    void loadPureReturnState(state);
  };

  root.addBoothReturnDraftFromBarcode=async function(rawBarcode){
    const event=currentEvent();
    const state=event?stateFor(event):null;
    const barcode=String(rawBarcode||"").trim();
    if(!barcode)return;
    if(!event||!state){
      boothShowError("戻り棚卸エラー","イベントを開いてから商品を追加してください。","boothReturnBarcode");
      return;
    }
    if(state.loading){
      boothShowError("戻り棚卸準備中","戻り実数の読み込み完了後に追加してください。","boothReturnBarcode");
      return;
    }
    if(isBoothEventClosed(event))return;
    let row=state.rows.get(barcode);
    if(!row){
      row=await findBoothEventItemByBarcode(event.id,barcode);
      if(row&&row.item_type==="normal"&&takeoutQty(row)>0){
        applyPureReturnRow(state,row);
      }
    }
    if(!row||row.item_type!=="normal"||takeoutQty(row)<=0){
      boothShowError("対象外商品","このイベントの持ち出し対象商品ではありません。","boothReturnBarcode");
      return;
    }
    const current=Number(state.draft.get(barcode)??row.returned_qty??0);
    const saved=Number(state.saved.get(barcode)??row.returned_qty??0);
    if(current>=takeoutQty(row)){
      boothShowError("数量上限","戻り実数は持ち出し数を超えられません。","boothReturnBarcode");
      return;
    }
    await savePureReturnQty(state,barcode,current+1,{increment:current===saved?1:0,focusQty:true});
  };

  root.saveBoothReturnDraft=async function(){
    const event=currentEvent();
    const state=event?stateFor(event):null;
    if(!event||!state||state.loading||isBoothEventClosed(event))return;
    const changes=[...state.rows.entries()].map(([barcode,row])=>({barcode,row,before:Number(state.saved.get(barcode)??row.returned_qty??0),next:Number(state.draft.get(barcode)??row.returned_qty??0)})).filter(entry=>entry.before!==entry.next);
    if(!changes.length){
      await loadPureReturnState(state);
      boothShowSuccess("戻り棚卸を確認しました。","戻り実数は共有データへ保存済みです。戻り先はイベントレポートで確定します。");
      return;
    }
    for(const entry of changes){
      if(!Number.isInteger(entry.next)||entry.next<0||entry.next>takeoutQty(entry.row)){
        boothShowError("戻り実数エラー","戻り実数は0以上の整数で、持ち出し数以下にしてください。");
        return;
      }
    }
    if(root.__aricoPureReturnSaving)return;
    root.__aricoPureReturnSaving=true;
    const operations=[];
    try{
      const latestRows=await countRows(event);
      const latestByBarcode=new Map(latestRows.map(row=>[String(row.barcode||""),row]));
      for(const entry of changes){
        const latest=latestByBarcode.get(entry.barcode);
        if(!latest)throw new Error(`対象商品が見つかりません: ${entry.barcode}`);
        if(entry.next>takeoutQty(latest))throw new Error(`${latest.product_name||entry.barcode}: 持ち出し数を超えています。`);
        operations.push({item:latest,before:Number(latest.returned_qty||0)});
        await patchBoothEventItem(latest,{returned_qty:entry.next});
      }
      await loadPureReturnState(state);
      boothShowSuccess("戻り実数を保存しました。",`${changes.length}商品の実数を保存しました。戻り先はイベントレポートで確定します。`);
    }catch(error){
      for(const operation of operations.reverse()){
        try{await patchBoothEventItem(operation.item,{returned_qty:operation.before});}catch(rollbackError){console.warn("[pure return rollback failed]",rollbackError);}
      }
      boothShowError("戻り実数保存エラー",error?.message||"戻り実数を保存できませんでした。");
    }finally{
      root.__aricoPureReturnSaving=false;
    }
  };

  root.loadBoothReturnHistory=async function(eventId){
    const state=states.get(String(eventId||""));
    if(!state)return;
    try{
      const rows=await countRows(state.event);
      renderPureReturnHistory(state,rows);
    }catch(error){
      const list=el("boothReturnHistoryList");
      if(list)list.innerHTML=`<div class="booth-error-message">${esc(error?.message||"戻り実績を取得できませんでした。")}</div>`;
    }
  };

  root.updateBoothReportReturnBatchSummary=function(section){
    if(!section)return;
    const selected=normalizeBoothReportReturnDestination(section.dataset.selectedDestination||"");
    const button=section.querySelector("[data-booth-report-return-batch-save]");
    if(button){
      button.textContent=selected?"戻り先を一括確定":"戻り先を選択してください";
      button.disabled=!selected||section.dataset.destinationLocked==="true";
    }
    const label=section.querySelector("[data-booth-report-return-destination-label]");
    if(label)label.textContent=selected?getBoothReportReturnDestinationLabel(selected):"未確定";
  };

  root.renderBoothReportReturnBatchSection=function(rows){
    const list=(typeof buildBoothReportReturnRows==="function"?buildBoothReportReturnRows(rows):Array.isArray(rows)?rows:[]).filter(row=>row.item_type==="normal"||row.item_type==null);
    if(!list.length)return '<section class="booth-report-section" data-booth-report-return-section><h5>戻り実績</h5><div class="booth-empty">戻り対象商品はありません。</div></section>';
    const state=typeof getBoothReportReturnDestinationState==="function"?getBoothReportReturnDestinationState(list):{locked:"",mixed:false};
    const locked=normalizeBoothReportReturnDestination(state.locked||"");
    const recommended="storage";
    const buttons=["storage","shelf"].map(type=>`<button type="button" class="booth-report-return-destination-btn${locked===type?" is-selected":""}" data-booth-report-return-destination="${type}" aria-pressed="${locked===type?"true":"false"}" ${locked&&!state.mixed?"disabled":""}>${getBoothReportReturnDestinationLabel(type)}</button>`).join("");
    const rowsHtml=list.map(row=>`<tr><td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.taken_qty??0)}</td><td><strong>${esc(row.returned_qty??0)}</strong></td></tr>`).join("");
    const cards=list.map(row=>`<article class="booth-history-card"><div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong><span>${esc(row.barcode||"-")}</span></div><div class="booth-history-card-meta"><span>持ち出し数：${esc(row.taken_qty??0)}</span><span>戻り実数：${esc(row.returned_qty??0)}</span></div></article>`).join("");
    return `<section class="booth-report-section booth-report-return-batch" data-booth-report-return-section data-selected-destination="${esc(locked)}" data-destination-locked="${locked?"true":"false"}" data-destination-mixed="${state.mixed?"true":"false"}">
      <div class="booth-report-return-header"><div><h5>戻り実績</h5><p class="section-note">戻り在庫処理で保存した実数です。戻り先はイベント単位で一括確定します。</p></div><strong>対象商品：${esc(list.length)}商品 / 戻り実数合計：${esc(list.reduce((sum,row)=>sum+Number(row.returned_qty||0),0))}個</strong></div>
      <div class="booth-report-return-destination"><strong>現在の戻り先：</strong><span data-booth-report-return-destination-label>${locked?esc(getBoothReportReturnDestinationLabel(locked)):"未確定"}</span><p class="section-note">おすすめ：${esc(getBoothReportReturnDestinationLabel(recommended))}（確認後に確定します）</p><div class="booth-report-return-destination-options" role="group" aria-label="戻り先">${buttons}</div>${state.mixed?'<p class="form-error">既存データの戻り先が混在しています。戻り先を選ぶとイベント単位で統一できます。</p>':""}</div>
      <div class="booth-report-return-actions"><button type="button" class="primary" data-booth-report-return-batch-save ${locked||state.mixed?"disabled":"disabled"}>戻り先を選択してください</button></div>
      <div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table"><thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し数</th><th>戻り実数</th></tr></thead><tbody>${rowsHtml}</tbody></table></div><div class="booth-history-cards booth-scroll-cards">${cards}</div>
    </section>`;
  };

  root.saveBoothReportReturnBatch=async function(){
    if(root.__aricoBoothReportReturnBatchSaving)return;
    const section=document.querySelector("[data-booth-report-return-section]");
    const event=currentEvent();
    const destination=normalizeBoothReportReturnDestination(section?.dataset.selectedDestination||"");
    if(!section||!event||!destination){boothShowError("戻り先未確定","戻り先を選択してから確定してください。");return;}
    if(section.dataset.destinationLocked==="true"){boothShowError("戻り先確定済み","戻り先はすでに確定しています。変更は管理者操作から行ってください。");return;}
    if(section.dataset.destinationMixed==="true")section.dataset.destinationMixed="false";
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("戻り先を一括確定",[`戻り先：${getBoothReportReturnDestinationLabel(destination)}`,"保存済みの戻り実数へイベント単位で適用します。","在庫移動は通常棚へ戻す場合だけ実行します。"].join("\n"),{okText:"確定",cancelText:"キャンセル"}):true;
    if(!ok)return;
    root.__aricoBoothReportReturnBatchSaving=true;
    const operations=[];
    const staff=String(event.created_by||"イベントレポート");
    try{
      const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,returned_qty,return_process_type,return_reflected,return_reflected_qty,return_reflected_at,return_reflected_by,shelf_return_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,shelf_return_reflected_by&event_id=eq.${encodeURIComponent(event.id)}&item_type=eq.normal&order=product_name.asc&limit=5000`);
      const targets=(Array.isArray(rows)?rows:[]).filter(row=>takeoutQty(row)>0);
      if(!targets.length)throw new Error("戻り対象商品がありません。");
      const existing=typeof getBoothReportReturnDestinationState==="function"?getBoothReportReturnDestinationState(targets):{locked:"",mixed:false};
      if(existing.locked)throw new Error("戻り先はすでに確定しています。");
      for(const item of targets){
        const returned=Math.max(0,Number(item.returned_qty||0));
        const reflected=isBoothReturnReflected(item);
        const reflectedQty=reflected?getBoothReturnReflectedQty(item):0;
        const delta=returned-reflectedQty;
        const operation={item,before:{...item},baseDelta:destination==="shelf"?delta:0,storageDelta:destination==="shelf"?-delta:0,baseAdjusted:false,storageAdjusted:false,movement:null,inventoryLog:null,patched:false};
        operations.push(operation);
        if(operation.baseDelta){await adjustBoothProductBaseStock(item.barcode,operation.baseDelta);operation.baseAdjusted=true;}
        if(operation.storageDelta){await upsertBoothEventStorageStock(getBoothEventStoreCode(event),item,operation.storageDelta);operation.storageAdjusted=true;}
        if(operation.storageDelta&&typeof insertBoothCommonEventMovement==="function")operation.movement=await insertBoothCommonEventMovement(event,item,Math.abs(operation.storageDelta),staff,operation.storageDelta>0?"event return kept on common shelf":"event return moved to normal shelf",operation.storageDelta>0?"storage_in":"storage_out");
        if(operation.baseDelta)operation.inventoryLog=await sb("inventory_logs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({type:"在庫修正",staff,barcode:item.barcode,product_name:item.product_name||"",quantity:operation.baseDelta,memo:"event return destination confirmed",event_id:event.id,affects_smaregi:false,smaregi_delta:0})});
        const now=new Date().toISOString();
        await patchBoothEventItem(item,{return_process_type:destination,return_reflected:true,return_reflected_qty:returned,return_reflected_at:now,return_reflected_by:staff,shelf_return_qty:destination==="shelf"?returned:0,shelf_return_reflected:destination==="shelf",shelf_return_reflected_qty:destination==="shelf"?returned:0,shelf_return_reflected_at:destination==="shelf"?now:null,shelf_return_reflected_by:destination==="shelf"?staff:null});
        operation.patched=true;
      }
      await refreshBoothEventRelatedViews(event.id);
      await loadBoothEventReport(event.id);
      boothShowSuccess("戻り先を確定しました",`${targets.length}商品の戻り先を${getBoothReportReturnDestinationLabel(destination)}にしました。`);
    }catch(error){
      for(const operation of operations.reverse()){
        try{
          if(operation.patched)await patchBoothEventItem(operation.item,getBoothReportReturnRestorePayload(operation.before));
          if(operation.inventoryLog?.[0]?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(operation.inventoryLog[0].id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(operation.movement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(operation.movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
          if(operation.storageAdjusted)await upsertBoothEventStorageStock(getBoothEventStoreCode(event),operation.item,-operation.storageDelta);
          if(operation.baseAdjusted)await adjustBoothProductBaseStock(operation.item.barcode,-operation.baseDelta);
        }catch(rollbackError){console.warn("[event return destination rollback failed]",rollbackError);}
      }
      boothShowError("戻り先確定エラー",error?.message||"戻り先を確定できませんでした。");
    }finally{
      root.__aricoBoothReportReturnBatchSaving=false;
    }
  };

  const originalCloseRender=root.renderBoothCloseConfirmPanel;
  root.renderBoothCloseConfirmPanel=function(event,summary){
    originalCloseRender(event,summary);
    const card=el("boothCloseCard")||document.querySelector(".booth-close-card");
    const button=el("boothCloseConfirmBtn");
    const rows=Array.isArray(summary?.rows)?summary.rows:[];
    const normalRows=rows.filter(row=>row.item_type==="normal"&&(Number(row.normal_takeout_qty||0)>0||Number(row.storage_takeout_qty||0)>0||Number(row.taken_qty||0)>0));
    const missingReturn=normalRows.length>0&&!normalRows.some(row=>Number(row.returned_qty||0)>0)&&!normalRows.some(row=>getBoothReturnProcessType(row));
    const pending=(summary?.unprocessedReturnRows||rows.filter(row=>row.item_type==="normal"&&Number(row.returned_qty||0)>0&&!getBoothReturnProcessType(row))).length;
    const requiresReturnInput=Boolean(missingReturn||pending);
    if(!requiresReturnInput||!card)return;
    if(button)button.disabled=true;
    const actions=card.querySelector(".booth-close-actions");
    if(actions){
      const warning=document.createElement("div");
      warning.className="message err booth-close-warning";
      warning.innerHTML=missingReturn?"戻り実績が保存されていません。戻り在庫処理で実数を保存してください。 <button type=\"button\" class=\"secondary\" data-open-booth-report>戻り在庫処理を開く</button>":"戻り実績は保存済みです。戻り先をイベントレポートで確定してください。 <button type=\"button\" class=\"secondary\" data-open-booth-report>イベントレポートを開く</button>";
      actions.before(warning);
      warning.querySelector("[data-open-booth-report]")?.addEventListener("click",()=>{if(missingReturn&&typeof renderBoothReturnPanel==="function")renderBoothReturnPanel(event);else if(typeof renderBoothEventReportPanel==="function")renderBoothEventReportPanel(event);});
    }
  };

  function timeout(promise,ms){
    let timer;
    const guard=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error("イベント締めデータの取得がタイムアウトしました。")),ms);});
    return Promise.race([Promise.resolve(promise),guard]).finally(()=>clearTimeout(timer));
  }

  root.confirmBoothEventClosePreparing=async function(event){
    const area=el("boothEventWorkArea");
    if(!event?.id){boothShowError("イベント締めエラー","イベントが選択されていません。");return;}
    if(area)area.innerHTML='<section class="booth-work-card"><div class="booth-empty" data-booth-close-loading>イベント棚の現数を読み込み中...</div></section>';
    try{
      const summary=await timeout(loadBoothCloseSummary(event),30000);
      const withShelf=await timeout(loadBoothCloseCommonStockSummary(event,summary),30000);
      root.renderBoothCloseConfirmPanel(event,withShelf);
    }catch(error){
      if(area)area.innerHTML=`<section class="booth-work-card booth-error-card"><h4>イベント締めデータを取得できませんでした。</h4><p class="booth-error-message">${esc(error?.message||"取得に失敗しました。")}</p><button type="button" id="boothCloseRetryBtn" class="secondary">再読み込み</button></section>`;
      el("boothCloseRetryBtn")?.addEventListener("click",()=>root.confirmBoothEventClosePreparing(event));
    }finally{
      const loading=area?.querySelector("[data-booth-close-loading]");
      if(loading){
        area.innerHTML='<section class="booth-work-card booth-error-card"><h4>イベント締めデータを取得できませんでした。</h4><p class="booth-error-message">読み込みを完了できませんでした。再読み込みしてください。</p><button type="button" id="boothCloseRetryBtn" class="secondary">再読み込み</button></section>';
        el("boothCloseRetryBtn")?.addEventListener("click",()=>root.confirmBoothEventClosePreparing(event));
      }
    }
  };
})();

// Ver 2.38: event close uses the current common event shelf stock.
function getBoothEventStoreCode(event){
  return normalizeBoothStoreCode(event?.store_code||getBoothCurrentStoreCode?.()||"tokyo");
}

async function loadBoothCloseCommonStockSummary(event,summary){
  const rows=Array.isArray(summary?.rows)?summary.rows:[];
  const barcodes=[...new Set(rows.map(row=>String(row.barcode||"").trim()).filter(Boolean))];
  const storeCode=getBoothEventStoreCode(event);
  let stocks=[];
  if(barcodes.length){
    stocks=await sb("event_storage_stocks?select=id,store_code,barcode,product_name,storage_qty,updated_at&store_code=eq."+encodeURIComponent(storeCode)+"&barcode=in.("+buildInFilter(barcodes)+")&limit=5000");
  }
  const byBarcode=new Map((Array.isArray(stocks)?stocks:[]).map(stock=>[String(stock.barcode||""),stock]));
  return {
    ...summary,
    rows:rows.map(row=>{
      const barcode=String(row.barcode||"");
      const commonStock=byBarcode.get(barcode);
      const current=commonStock
        ? Number(commonStock.storage_qty||0)
        : getBoothCommonShelfCurrentQtyFromEventItem(row);
      return {...row,event_shelf_current_qty:current,event_shelf_store_code:storeCode};
    }),
    commonShelfStocks:Array.isArray(stocks)?stocks:[],
    event_shelf_store_code:storeCode
  };
}

function getBoothCloseShelfReturnQuantity(row){
  return getBoothCloseReturnProcessType(row)==="shelf"?Math.max(0,getBoothReturnReflectedQty(row)):0;
}

function renderBoothCloseConfirmPanel(event,summary){
  const area=el("boothEventWorkArea");
  if(!area)return;
  const storeCode=getBoothEventStoreCode(event);
  const context=getBoothCloseStoreContext(event);
  const adminAuthed=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
  const period=[event?.event_start,event?.event_end].filter(Boolean).join(" - ")||"-";
  const rows=Array.isArray(summary?.rows)?summary.rows:[];
  const normalRows=rows.filter(row=>Number(row.normal_takeout_qty||0)>0||Number(row.storage_takeout_qty||0)>0||Number(row.taken_qty||0)>0);
  const savedReturnRows=normalRows.filter(row=>Number(row.returned_qty||0)>0&&normalizeBoothReportReturnDestination(getBoothReturnProcessType(row)));
  const returnDestinationState=getBoothReportReturnDestinationState(savedReturnRows);
  const returnTotal=normalRows.reduce((sum,row)=>sum+Number(row.returned_qty||0),0);
  const remainingRows=normalRows.filter(row=>Number(row.event_shelf_current_qty||0)>0);
  const remainingQty=remainingRows.reduce((sum,row)=>sum+Number(row.event_shelf_current_qty||0),0);
  const tableRows=normalRows.length?normalRows.map(row=>{
    const current=Number(row.event_shelf_current_qty||0);
    const taken=Number(row.taken_qty||0);
    const sold=Number(row.sold_qty||0);
    const planned=Math.max(0,taken-sold);
    const returned=Number(row.returned_qty||0);
    const destination=getBoothCloseReturnProcessType(row);
    const destinationLabel=destination==="storage"?"共通イベント棚":destination==="shelf"?"通常棚":"未確定";
    return '<tr><td>'+esc(row.product_name||"-")+'</td><td>'+esc(row.barcode||"-")+'</td><td>'+esc(taken)+'</td><td>'+esc(sold)+'</td><td>'+esc(planned)+'</td><td>'+esc(returned)+'</td><td>'+esc(destinationLabel)+'</td><td><strong>'+esc(current)+'</strong></td></tr>';
  }).join(""):'<tr><td colspan="8">終了対象の商品はありません。</td></tr>';
  area.innerHTML='<section class="booth-work-card booth-close-card">'+
    '<h4>イベント終了処理</h4>'+
    '<p class="section-note">終了前に戻り数量を確定します。スマレジ在庫APIは呼び出しません。</p>'+
    '<div class="booth-close-event-info">'+
      '<div><span>イベント名</span><strong>'+esc(event?.name||"-")+'</strong></div>'+
      '<div><span>期間</span><strong>'+esc(period)+'</strong></div>'+
      '<div><span>会場</span><strong>'+esc(event?.venue||"-")+'</strong></div>'+
      '<div><span>店舗</span><strong>'+esc(context.storeName)+' / '+esc(storeCode.toUpperCase())+'</strong></div>'+
      '<div><span>作成者</span><strong>'+esc(event?.created_by||"-")+'</strong></div>'+
    '</div>'+
    '<div class="booth-close-summary-grid">'+
      '<div><span>対象商品数</span><strong>'+esc(normalRows.length)+'</strong></div>'+
      '<div><span>保存済み戻り実数</span><strong>'+esc(returnTotal)+'</strong></div>'+
      '<div><span>イベント棚に残る商品数</span><strong>'+esc(remainingRows.length)+'</strong></div>'+
      '<div><span>イベント棚に残る数量</span><strong>'+esc(remainingQty)+'</strong></div>'+
    '</div>'+
    '<div class="booth-history-table-wrap booth-close-table-wrap"><table class="booth-history-table booth-close-table">'+
      '<thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し</th><th>販売</th><th>戻り予定</th><th>戻り実数</th><th>戻り先</th><th>共通イベント棚現数</th></tr></thead>'+
      '<tbody>'+tableRows+'</tbody></table></div>'+
    '<div class="booth-close-actions"><button type="button" id="boothCloseReloadBtn" class="secondary">再読み込み</button>'+(adminAuthed&&returnDestinationState.locked&&!returnDestinationState.mixed?'<button type="button" class="secondary" data-booth-return-destination-change data-event-id="'+esc(event?.id||'')+'" data-current-destination="'+esc(returnDestinationState.locked)+'">戻り先を変更</button>':'')+(isBoothEventClosed(event)?'<button type="button" id="boothCloseConfirmBtn" disabled>イベント終了済み</button>':'<button type="button" id="boothCloseConfirmBtn">イベントを終了する</button>')+'</div>'+
  '</section>';
  el("boothCloseReloadBtn")?.addEventListener("click",()=>confirmBoothEventClosePreparing(event));
  el("boothCloseConfirmBtn")?.addEventListener("click",()=>confirmBoothEventClose(event));
}

async function confirmBoothEventClosePreparing(event){
  const area=el("boothEventWorkArea");
  if(!event?.id){boothShowError("イベント終了エラー","イベントが見つかりません。");return;}
  if(area)area.innerHTML='<section class="booth-work-card"><div class="booth-empty">イベント棚の現数を読み込み中…</div></section>';
  try{
    const summary=await loadBoothCloseCommonStockSummary(event,await loadBoothCloseSummary(event));
    renderBoothCloseConfirmPanel(event,summary);
  }catch(error){boothShowError("イベント終了エラー","終了前の在庫読み込みに失敗しました。"+(error.message||""));}
}

async function createBoothEventCloseSnapshots(event,summary,staff,closedAt){
  const eventId=String(event?.id||"");
  if(!eventId)return [];
  const normalItems=await sb("booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,shelf_return_qty,event_storage_qty,return_process_type,return_reflected_qty&event_id=eq."+encodeURIComponent(eventId)+"&item_type=eq.normal&order=product_name.asc&limit=3000");
  const gachaItems=await sb("booth_event_items?select=barcode,taken_qty&event_id=eq."+encodeURIComponent(eventId)+"&item_type=eq.gacha_prize&limit=3000").catch(()=>[]);
  const gachaByBarcode=new Map((Array.isArray(gachaItems)?gachaItems:[]).map(row=>[String(row.barcode||""),Number(row.taken_qty||0)]));
  const commonByBarcode=new Map((summary.commonShelfStocks||[]).map(row=>[String(row.barcode||""),Number(row.storage_qty||0)]));
  const summaryByBarcode=new Map((summary.rows||[]).map(row=>[String(row.barcode||""),Number(row.event_shelf_current_qty||0)]));
  const productIdByBarcode=new Map((summary.rows||[]).map(row=>[String(row.barcode||""),String(row.product_id||"").trim()]));
  const existing=await sb("booth_stock_movements?select=id,barcode&event_id=eq."+encodeURIComponent(eventId)+"&movement_type=eq.event_close_snapshot&item_type=eq.normal&limit=3000").catch(()=>[]);
  const existingBarcodes=new Set((Array.isArray(existing)?existing:[]).map(row=>String(row.barcode||"")));
  const payload=(Array.isArray(normalItems)?normalItems:[]).filter(row=>!existingBarcodes.has(String(row.barcode||""))).map(row=>{
    const barcode=String(row.barcode||"");
    const current=commonByBarcode.has(barcode)
      ? Number(commonByBarcode.get(barcode)||0)
      : Number(summaryByBarcode.get(barcode)||0);
    const returned=getBoothCloseShelfReturnQuantity(row);
    const snapshot={event_id:eventId,store_id:event.store_id||event.store_code||getBoothEventStoreCode(event),store_code:getBoothEventStoreCode(event),product_id:productIdByBarcode.get(barcode)||null,barcode,event_shelf_stock_before_close:current+returned,returned_to_normal_qty:returned,remaining_event_shelf_qty:current,sold_qty:Number(row.sold_qty||0),gacha_moved_qty:gachaByBarcode.get(barcode)||0,closed_at:closedAt,closed_by:staff};
    return {event_id:eventId,barcode,product_name:row.product_name||"",item_type:"normal",movement_type:"event_close_snapshot",quantity:current,staff,memo:JSON.stringify(snapshot),affects_smaregi:false,smaregi_delta:0};
  });
  if(!payload.length)return [];
  const inserted=await sb("booth_stock_movements",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
  return Array.isArray(inserted)?inserted:[];
}

async function confirmBoothEventClose(event){
  const staff=String(event?.closed_by||event?.created_by||"イベント終了処理").trim()||"イベント終了処理";
  try{
    const latestRows=await sb("booth_events?select=*&id=eq."+encodeURIComponent(event.id)+"&limit=1");
    const latestEvent=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
    if(!latestEvent){boothShowError("イベント終了エラー","イベントが見つかりません。");return;}
    if(isBoothEventClosed(latestEvent)){boothShowError("イベント終了エラー","このイベントはすでに終了しています。");return;}
    const summary=await loadBoothCloseSummary(latestEvent);
    const closeNormalRows=summary.rows.filter(row=>row.item_type==="normal"&&(Number(row.normal_takeout_qty||0)>0||Number(row.storage_takeout_qty||0)>0||Number(row.taken_qty||0)>0));
    const noReturnSaved=closeNormalRows.length>0&&!closeNormalRows.some(row=>Number(row.returned_qty||0)>0)&&!closeNormalRows.some(row=>getBoothReturnProcessType(row));
    const unprocessedNormal=summary.rows.filter(row=>row.item_type==="normal"&&(Number(row.normal_takeout_qty||0)>0||Number(row.storage_takeout_qty||0)>0||Number(row.taken_qty||0)>0)&&Number(row.returned_qty||0)>0&&!getBoothReturnProcessType(row));
    if(noReturnSaved){boothShowError("イベント終了エラー","戻り実績が保存されていません。戻り在庫処理で実数を保存してください。");return;}
    if(unprocessedNormal.length){boothShowError("イベント終了エラー","戻り先が未選択の商品があります。イベントレポートで戻り先を確定してください。");return;}
    const body=["イベント名："+(latestEvent.name||"-"),"担当者："+staff,"対象商品数："+summary.rows.length,"通常棚へ戻す数量と、イベント棚に残る数量を保存してイベントを終了します。"].join("\\n");
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("イベント終了確認",body,{okText:"イベントを終了する"}):true;
    if(!ok)return;
    await finalizeBoothEventClose(latestEvent,summary,staff);
  }catch(error){boothShowError("イベント終了エラー",error.message||"イベント終了に失敗しました。");}
}

async function finalizeBoothEventClose(event,summary,staff){
  const now=new Date().toISOString();
  let reflected=false;
  let snapshots=[];
  try{
    await reflectBoothShelfReturnsOnClose(summary,staff);
    reflected=true;
    await ensureBoothCloseReturnHistory(summary,staff);
    const finalSummary=await loadBoothCloseCommonStockSummary(event,await loadBoothCloseSummary(event));
    snapshots=await createBoothEventCloseSnapshots(event,finalSummary,staff,now);
    const updated=await sb("booth_events?id=eq."+encodeURIComponent(event.id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"closed",closed_at:now,closed_by:staff})});
    const closedEvent=Array.isArray(updated)&&updated[0]?updated[0]:{...event,status:"closed",closed_at:now,closed_by:staff};
    boothEvents=boothEvents.map(row=>String(row.id)===String(event.id)?closedEvent:row);
    boothCurrentEventId=String(event.id);
    renderBoothEvents(boothEvents);
    renderBoothEventDetail(closedEvent);
    boothShowSuccess("イベント終了完了","イベントを終了しました。イベント棚に残った数量は店舗共通イベント棚に残っています。");
  }catch(error){
    for(const row of snapshots){if(row?.id)await sb("booth_stock_movements?id=eq."+encodeURIComponent(row.id),{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});}
    if(reflected)await rollbackBoothCloseReflection(summary,staff).catch(()=>{});
    throw error;
  }
}

function getBoothCloseRestorePayload(before){
  return {
    return_process_type:before.return_process_type||null,
    return_reflected:isBoothReturnReflected(before),
    return_reflected_qty:Number(before.return_reflected_qty||0),
    return_reflected_at:before.return_reflected_at||null,
    return_reflected_by:before.return_reflected_by||null,
    shelf_return_qty:Number(before.shelf_return_qty||0),
    event_storage_qty:Number(before.event_storage_qty||0),
    shelf_return_reflected:isBoothShelfReturnReflected(before),
    shelf_return_reflected_qty:Number(before.shelf_return_reflected_qty||0),
    shelf_return_reflected_at:before.shelf_return_reflected_at||null,
    shelf_return_reflected_by:before.shelf_return_reflected_by||null
  };
}

async function reflectBoothShelfReturnsOnClose(summary,staff){
  const pending=(summary.returnPendingRows||summary.shelfReturnPendingRows||[]).filter(row=>row.item_type==="normal"&&getBoothReturnReflectDelta(row)!==0);
  const applied=[];
  try{
    for(const item of pending){
      const processType=getBoothCloseReturnProcessType(item);
      if(!processType)throw new Error("戻り先が未選択の商品があります。");
      const delta=getBoothReturnReflectDelta(item);
      const operation={item,before:{...item},processType,delta,baseMoved:false,storageMoved:false,movement:null};
      applied.push(operation);
      if(processType==="storage"&&item.__legacyStorageMove===true){
        await upsertBoothEventStorageStock(getBoothEventStoreCode({store_code:item.store_code}),item,delta);
        operation.storageMoved=true;
        operation.movement=await insertBoothCommonEventMovement({id:item.event_id||boothCurrentEventId},item,delta,staff,"イベント終了時の棚戻し","storage_in");
      }else if(processType==="shelf"){
        await adjustBoothProductBaseStock(item.barcode,delta);
        operation.baseMoved=true;
        await upsertBoothEventStorageStock(getBoothEventStoreCode({store_code:item.store_code}),item,-delta);
        operation.storageMoved=true;
        operation.movement=await insertBoothCommonEventMovement({id:item.event_id||boothCurrentEventId},item,delta,staff,"通常棚へ戻す","storage_out");
      }
      await patchBoothEventItem(item,{
        return_process_type:processType,
        return_reflected:getBoothReturnReflectQty(item)>0,
        return_reflected_qty:getBoothReturnReflectQty(item),
        return_reflected_at:getBoothReturnReflectQty(item)>0?new Date().toISOString():null,
        return_reflected_by:getBoothReturnReflectQty(item)>0?staff:null,
        shelf_return_qty:processType==="shelf"?getBoothReturnReflectQty(item):0,
        event_storage_qty:processType==="storage"?getBoothReturnReflectQty(item):0,
        shelf_return_reflected:processType==="shelf"&&getBoothReturnReflectQty(item)>0,
        shelf_return_reflected_qty:processType==="shelf"?getBoothReturnReflectQty(item):0,
        shelf_return_reflected_at:processType==="shelf"&&getBoothReturnReflectQty(item)>0?new Date().toISOString():null,
        shelf_return_reflected_by:processType==="shelf"&&getBoothReturnReflectQty(item)>0?staff:null
      });
    }
  }catch(error){
    for(const operation of applied.reverse()){
      try{
        if(operation.processType==="shelf"){
          if(operation.baseMoved)await adjustBoothProductBaseStock(operation.item.barcode,-operation.delta);
          if(operation.storageMoved)await upsertBoothEventStorageStock(getBoothEventStoreCode({store_code:operation.item.store_code}),operation.item,operation.delta);
        }else if(operation.processType==="storage"&&operation.storageMoved){
          await upsertBoothEventStorageStock(getBoothEventStoreCode({store_code:operation.item.store_code}),operation.item,-operation.delta);
        }
        if(operation.movement?.id)await sb("event_storage_movements?id=eq."+encodeURIComponent(operation.movement.id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
        await patchBoothEventItem(operation.item,getBoothCloseRestorePayload(operation.before));
      }catch(rollbackError){console.warn("[booth close rollback failed]",rollbackError);}
    }
    throw error;
  }
}

async function rollbackBoothCloseReflection(summary,staff){
  const pending=(summary.returnPendingRows||summary.shelfReturnPendingRows||[]).filter(row=>row.item_type==="normal"&&getBoothReturnReflectDelta(row)!==0);
  for(const item of pending.reverse()){
    const processType=getBoothCloseReturnProcessType(item);
    const delta=getBoothReturnReflectDelta(item);
    if(processType==="shelf"){
      await adjustBoothProductBaseStock(item.barcode,-delta);
      await upsertBoothEventStorageStock(getBoothEventStoreCode({store_code:item.store_code}),item,delta);
    }else if(processType==="storage"&&item.__legacyStorageMove===true){
      // Keep rollback compatibility for legacy rows that really moved stock.
      // The current common-shelf return path is record-only.
      await upsertBoothEventStorageStock(getBoothEventStoreCode({store_code:item.store_code}),item,-delta);
    }
    await patchBoothEventItem(item,getBoothCloseRestorePayload(item));
  }
}

// Ver 2.55: keep the physical return count in booth_event_items.returned_qty.
// The report edits that same value and only adjusts stock by the already
// reflected delta, so saving the report cannot add the full return twice.
function calculateBoothReturnPlannedQty(item){
  return Math.max(0,
    Number(item?.taken_qty||0)-
    Number(item?.sold_qty||0)
  );
}

function calculateBoothReturnReportDifference(item){
  return Number(item?.returned_qty||0)-calculateBoothReturnPlannedQty(item);
}

function buildBoothReportReturnRows(rows){
  return (Array.isArray(rows)?rows:[]).map(item=>({
    ...item,
    planned_return_qty:calculateBoothReturnPlannedQty(item),
    return_difference:calculateBoothReturnReportDifference(item)
  }));
}

function renderBoothReportReturnSection(rows){
  const list=buildBoothReportReturnRows(rows);
  if(!list.length)return `<section class="booth-report-section" data-booth-report-return-section>
    <h5>通常商品戻り実績</h5><div class="booth-empty">通常商品の戻り実績はありません。</div>
  </section>`;
  const tableRows=list.map(row=>`<tr data-booth-report-return-row data-item-id="${esc(row.id||"")}" data-return-diff="${esc(row.return_difference)}">
    <td>${esc(row.product_name||"-")}</td>
    <td>${esc(row.barcode||"-")}</td>
    <td>${esc(row.taken_qty??0)}</td>
    <td>${esc(row.sold_qty??0)}</td>
    <td>${esc(row.consumed_qty??0)}</td>
    <td>${esc(row.planned_return_qty)}</td>
    <td><input class="booth-history-qty-input" data-booth-report-return-qty type="number" min="0" step="1" value="${esc(row.returned_qty??0)}" aria-label="戻り実数"></td>
    <td><strong>${esc(row.return_difference)}</strong></td>
    <td><button type="button" class="secondary booth-history-edit-btn" data-booth-report-return-save="${esc(row.id||"")}">保存</button></td>
  </tr>`).join("");
  const cards=list.map(row=>`<article class="booth-history-card" data-booth-report-return-row data-item-id="${esc(row.id||"")}" data-return-diff="${esc(row.return_difference)}">
    <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong><span>${esc(row.barcode||"-")}</span></div>
    <div class="booth-history-card-meta">
      <span>持ち出し数: ${esc(row.taken_qty??0)}</span>
      <span>販売数: ${esc(row.sold_qty??0)}</span>
      <span>ガチャ移動数: ${esc(row.consumed_qty??0)}</span>
      <span>戻り予定数: ${esc(row.planned_return_qty)}</span>
      <span>差異: ${esc(row.return_difference)}</span>
    </div>
    <label>戻り実数<input class="booth-history-qty-input" data-booth-report-return-qty type="number" min="0" step="1" value="${esc(row.returned_qty??0)}"></label>
    <button type="button" class="secondary booth-history-edit-btn" data-booth-report-return-save="${esc(row.id||"")}">保存</button>
  </article>`).join("");
  return `<section class="booth-report-section" data-booth-report-return-section>
    <h5>通常商品戻り実績</h5>
    <p class="section-note">戻り棚卸で保存した戻り実数を表示します。ここで修正した値は戻り棚卸にも共通反映され、在庫反映済みの場合は差分だけ調整します。</p>
    <div class="button-row">
      <button type="button" class="secondary" data-booth-report-return-filter="all" aria-pressed="true">全件</button>
      <button type="button" class="secondary" data-booth-report-return-filter="diff" aria-pressed="false">差異のみ</button>
    </div>
    <div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-report-return-table">
      <thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し数</th><th>販売数</th><th>ガチャ移動数</th><th>戻り予定数</th><th>戻り実数</th><th>差異</th><th>操作</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="booth-history-cards booth-scroll-cards">${cards}</div>
  </section>`;
}

async function saveBoothReportReturnQty(itemId,button){
  if(window.__aricoBoothReportReturnSaving)return;
  const event=getBoothCurrentEvent();
  const row=button?.closest("[data-booth-report-return-row]");
  const input=row?.querySelector("[data-booth-report-return-qty]");
  const value=String(input?.value||"").trim();
  if(!event||!itemId||!/^[0-9]+$/.test(value)){
    boothShowError("戻り実数エラー","戻り実数は0以上の整数で入力してください。",input?.id||"");
    return;
  }
  const nextReturned=Number(value);
  window.__aricoBoothReportReturnSaving=true;
  let baseStockDelta=0;
  let stockDelta=0;
  let storageStockDelta=0;
  let processType="";
  let stockChanged=false;
  let stockProduct=null;
  let adjustmentLog=null;
  let before=null;
  try{
    const itemRows=await sb(`booth_event_items?select=*&id=eq.${encodeURIComponent(itemId)}&event_id=eq.${encodeURIComponent(event.id)}&limit=1`);
    const item=Array.isArray(itemRows)&&itemRows[0]?itemRows[0]:null;
    if(!item)throw new Error("対象の戻り商品が見つかりません。");
    before={...item};
    const planned=calculateBoothReturnPlannedQty(item);
    if(nextReturned>planned){
      throw new Error(`戻り実数は戻り予定数(${planned})を超えられません。`);
    }
    const oldReturned=Number(item.returned_qty||0);
    const wasReflected=isBoothReturnReflected(item);
    processType=getBoothReturnProcessType(item)||"";
    const reflectedQty=wasReflected
      ? (item.return_reflected_qty!==undefined&&item.return_reflected_qty!==null
        ? Number(item.return_reflected_qty||0)
        : oldReturned)
      : 0;
    if(processType==="shelf"||processType==="storage"){
      baseStockDelta=nextReturned-reflectedQty;
      // Keeping the item on the common event shelf records the return count
      // only. The current common-shelf stock is not increased a second time.
      storageStockDelta=processType==="shelf"?-baseStockDelta:0;
    }
    stockProduct=await findBoothProductByBarcode(String(item.barcode||"").trim());
    if(baseStockDelta&&processType==="shelf"){
      if(!stockProduct)throw new Error(`商品マスターが見つかりません: ${item.barcode}`);
      await adjustBoothProductBaseStock(item.barcode,baseStockDelta);
      stockChanged=true;
    }
    if(storageStockDelta){
      await upsertBoothEventStorageStock(getBoothEventStoreCode(event),item,storageStockDelta);
      stockChanged=true;
    }
    stockDelta=processType==="shelf"?baseStockDelta:storageStockDelta;
    const now=new Date().toISOString();
    const reflectedValue=(processType==="shelf"||processType==="storage")?nextReturned:0;
    const payload={
      returned_qty:nextReturned,
      difference_qty:calculateBoothDifference({...item,returned_qty:nextReturned}),
      return_process_type:processType||item.return_process_type||null,
      return_reflected:(processType==="shelf"||processType==="storage")&&nextReturned>0,
      return_reflected_qty:reflectedValue,
      return_reflected_at:(processType==="shelf"||processType==="storage")&&nextReturned>0?now:null,
      return_reflected_by:wasReflected&&nextReturned>0?(item.return_reflected_by||"レポート修正"):null,
      shelf_return_qty:processType==="shelf"?reflectedValue:0,
      event_storage_qty:processType==="storage"?reflectedValue:0,
      shelf_return_reflected:processType==="shelf"&&nextReturned>0,
      shelf_return_reflected_qty:processType==="shelf"?reflectedValue:0,
      shelf_return_reflected_at:processType==="shelf"&&nextReturned>0?now:null,
      shelf_return_reflected_by:processType==="shelf"&&wasReflected&&nextReturned>0?(item.shelf_return_reflected_by||"レポート修正"):null
    };
    if(baseStockDelta){
      adjustmentLog=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"在庫修正",
          staff:String(item.return_reflected_by||"レポート修正"),
          barcode:item.barcode,
          product_name:item.product_name||"",
          quantity:baseStockDelta,
          memo:`イベント戻り実数修正 ${oldReturned} -> ${nextReturned}`,
          event_id:event.id,
          affects_smaregi:false,
          smaregi_delta:0
        })
      });
    }
    await patchBoothEventItem(item,payload);
    await refreshBoothEventRelatedViews(event.id);
    await loadBoothEventReport(event.id);
    boothShowSuccess("戻り実数を更新しました",stockDelta?`在庫は差分 ${stockDelta} のみ調整しました。`:
      "イベント戻り棚卸と同じ正式な戻り実数を更新しました。");
  }catch(error){
    try{
      if(adjustmentLog?.[0]?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(adjustmentLog[0].id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      if(stockChanged&&stockDelta&&before){
        if(processType==="shelf")await adjustBoothProductBaseStock(before.barcode,-stockDelta);
        if(processType==="storage")await upsertBoothEventStorageStock(getBoothEventStoreCode(event),before,-stockDelta);
      }
    }catch(rollbackError){console.warn("[booth report return rollback failed]",rollbackError);}
    boothShowError("戻り実数保存エラー",error.message||"戻り実数の保存に失敗しました。",input?.id||"");
  }finally{
    window.__aricoBoothReportReturnSaving=false;
  }
}

if(!window.__aricoBoothReportReturnHandlersBound){
  document.addEventListener("click",event=>{
    const save=event.target.closest("[data-booth-report-return-save]");
    if(save){
      void saveBoothReportReturnQty(save.dataset.boothReportReturnSave||"",save);
      return;
    }
    const filter=event.target.closest("[data-booth-report-return-filter]");
    if(!filter)return;
    const section=filter.closest("[data-booth-report-return-section]");
    if(!section)return;
    const mode=filter.dataset.boothReportReturnFilter||"all";
    section.querySelectorAll("[data-booth-report-return-filter]").forEach(button=>button.setAttribute("aria-pressed",button===filter?"true":"false"));
    section.querySelectorAll("[data-booth-report-return-row]").forEach(row=>{
      row.hidden=mode==="diff"&&Number(row.dataset.returnDiff||0)===0;
    });
  });
  window.__aricoBoothReportReturnHandlersBound=true;
}

// Keep the official report exports aligned with the report's canonical return
// quantities. The difference section remains a separate exception list, while
// the return-results section always contains every normal product.
function normalizeBoothReportReturnDestination(value){
  const type=String(value||"").toLowerCase().trim();
  if(type==="shelf")return "shelf";
  if(type==="storage"||type==="event"||type==="keep")return "storage";
  return "";
}

function getBoothReportReturnDestinationLabel(value){
  const destination=normalizeBoothReportReturnDestination(value);
  if(destination==="shelf")return "通常棚へ戻す";
  if(destination==="storage")return "共通イベント棚に残す";
  return "未選択";
}

function getBoothReturnDestinationChangeRows(rows){
  return (Array.isArray(rows)?rows:[]).filter(row=>{
    const itemType=String(row?.item_type||"normal").toLowerCase();
    return itemType==="normal"&&Number(row?.returned_qty||0)>0&&normalizeBoothReportReturnDestination(getBoothReturnProcessType(row));
  });
}

async function insertBoothReturnDestinationAudit(event,item,oldDestination,newDestination,quantity,staff){
  const now=new Date().toISOString();
  const memo=[
    "イベント戻り先変更",
    `変更前：${getBoothReportReturnDestinationLabel(oldDestination)}`,
    `変更後：${getBoothReportReturnDestinationLabel(newDestination)}`,
    `戻り実数：${Number(quantity||0)}`,
    `変更日時：${now}`
  ].join(" / ");
  const rows=await sb("inventory_logs",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      type:"在庫修正",
      event_id:event?.id||null,
      staff,
      barcode:item?.barcode||"",
      product_name:item?.product_name||"",
      quantity:Number(quantity||0),
      memo,
      affects_smaregi:false,
      smaregi_delta:0
    })
  });
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function insertBoothReturnDestinationMovement(event,item,storeCode,oldDestination,newDestination,quantity,staff){
  const movementType=oldDestination==="shelf"&&newDestination==="storage"?"storage_in":"storage_out";
  const rows=await sb("event_storage_movements",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify([{
      event_id:event?.id||null,
      store_code:storeCode,
      smaregi_product_id:item?.smaregi_product_id?String(item.smaregi_product_id):null,
      barcode:item?.barcode||"",
      product_name:item?.product_name||"",
      movement_type:movementType,
      quantity:Math.abs(Number(quantity||0)),
      staff,
      memo:`イベント戻り先変更：${getBoothReportReturnDestinationLabel(oldDestination)} → ${getBoothReportReturnDestinationLabel(newDestination)}`
    }])
  });
  return Array.isArray(rows)&&rows[0]?rows[0]:null;
}

async function changeBoothEventReturnDestination(eventId,requestedDestination){
  if(window.__aricoBoothReturnDestinationChanging)return;
  if(typeof hasInventoryPrivilegedAccess!=="function"||!hasInventoryPrivilegedAccess()){
    boothShowError("戻り先変更エラー","戻り先の変更は管理者のみ実行できます。");
    return;
  }
  const destination=normalizeBoothReportReturnDestination(requestedDestination);
  if(!destination){
    boothShowError("戻り先変更エラー","変更後の戻り先が不正です。");
    return;
  }
  const targetEventId=String(eventId||boothCurrentEventId||"").trim();
  if(!targetEventId){
    boothShowError("戻り先変更エラー","イベントが選択されていません。");
    return;
  }
  let event=null;
  let operations=[];
  try{
    const eventRows=await sb(`booth_events?select=*&id=eq.${encodeURIComponent(targetEventId)}&limit=1`);
    event=Array.isArray(eventRows)&&eventRows[0]?eventRows[0]:null;
    if(!event)throw new Error("イベントが見つかりません。");
    const rows=await sb(`booth_event_items?select=*&event_id=eq.${encodeURIComponent(targetEventId)}&item_type=eq.normal&limit=3000`);
    const returnedItems=(Array.isArray(rows)?rows:[]).filter(row=>Number(row?.returned_qty||0)>0);
    const returnedRows=getBoothReturnDestinationChangeRows(returnedItems);
    if(!returnedRows.length)throw new Error("戻り実績が保存された通常商品がありません。");
    if(returnedRows.length!==returnedItems.length)throw new Error("戻り先が未確定の商品があります。先にイベントレポートで戻り先を確定してください。");
    const state=getBoothReportReturnDestinationState(returnedRows);
    if(state.mixed)throw new Error("同じイベント内で戻り先が混在しています。個別に変更せず、先に管理者へ確認してください。");
    const current=state.locked;
    if(!current)throw new Error("現在の戻り先を確認できません。");
    if(current===destination){
      boothShowSuccess("戻り先変更","指定された戻り先はすでに設定されています。数量・在庫は変更していません。");
      return;
    }
    const totalQty=returnedRows.reduce((sum,row)=>sum+Number(row.returned_qty||0),0);
    const closed=isBoothEventClosed(event);
    const body=[
      "イベント単位で戻り先を変更します。",
      `現在：${getBoothReportReturnDestinationLabel(current)}`,
      `変更後：${getBoothReportReturnDestinationLabel(destination)}`,
      `対象商品：${returnedRows.length}件`,
      `戻り実数合計：${totalQty}個`,
      closed?"このイベントは締め済みです。変更後の在庫場所だけを反映します。":"戻り実数そのものは変更しません。"
    ].join(String.fromCharCode(10));
    const ok=typeof confirmAppAction==="function"
      ?await confirmAppAction("イベント戻り先変更",body,{okText:"変更する",cancelText:"キャンセル"})
      :true;
    if(!ok)return;
    window.__aricoBoothReturnDestinationChanging=true;
    const storeCode=getBoothEventStoreCode(event);
    const staff=String(event.closed_by||event.created_by||"管理者").trim()||"管理者";
    for(const row of returnedRows){
      const latestRows=await sb(`booth_event_items?select=*&event_id=eq.${encodeURIComponent(targetEventId)}&id=eq.${encodeURIComponent(row.id)}&item_type=eq.normal&limit=1`);
      const latest=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
      if(!latest)throw new Error(`${row.product_name||row.barcode}: 最新の戻り実績が見つかりません。`);
      const latestDestination=normalizeBoothReportReturnDestination(getBoothReturnProcessType(latest));
      if(latestDestination!==current)throw new Error("保存中に戻り先が変更されました。画面を再読み込みして確認してください。");
      const quantity=Number(latest.returned_qty||0);
      const before={...latest};
      const operation={item:latest,before,baseDelta:destination==="shelf"?quantity:-quantity,storageDelta:destination==="storage"?quantity:-quantity,baseAdjusted:false,storageAdjusted:false,inventoryLog:null,movement:null,patched:false};
      operations.push(operation);
      const product=await findBoothProductByBarcode(String(latest.barcode||"").trim());
      if(!product)throw new Error(`商品マスターが見つかりません：${latest.barcode||""}`);
      if(operation.storageDelta<0){
        const stock=await findBoothEventStorageStock(storeCode,latest.barcode);
        if(!stock||Number(stock.storage_qty||0)<Math.abs(operation.storageDelta))throw new Error(`${latest.product_name||latest.barcode}: 共通イベント棚在庫が不足しています。`);
      }
      if(operation.baseDelta) {
        await adjustBoothProductBaseStock(latest.barcode,operation.baseDelta);
        operation.baseAdjusted=true;
      }
      if(operation.storageDelta){
        await upsertBoothEventStorageStock(storeCode,latest,operation.storageDelta);
        operation.storageAdjusted=true;
        operation.movement=await insertBoothReturnDestinationMovement(event,latest,storeCode,current,destination,quantity,staff);
      }
      operation.inventoryLog=await insertBoothReturnDestinationAudit(event,latest,current,destination,operation.baseDelta,staff);
      const now=new Date().toISOString();
      await patchBoothEventItem(latest,{
        return_process_type:destination,
        shelf_return_qty:destination==="shelf"?quantity:0,
        event_storage_qty:destination==="storage"?quantity:0,
        shelf_return_reflected:destination==="shelf"&&quantity>0,
        shelf_return_reflected_qty:destination==="shelf"?quantity:0,
        shelf_return_reflected_at:destination==="shelf"&&quantity>0?now:null,
        shelf_return_reflected_by:destination==="shelf"&&quantity>0?staff:null,
        return_reflected:true,
        return_reflected_qty:quantity,
        return_reflected_at:quantity>0?now:null,
        return_reflected_by:quantity>0?staff:null
      });
      operation.patched=true;
    }
    await refreshBoothEventRelatedViews(targetEventId);
    if(document.querySelector("[data-booth-report-return-section]"))await loadBoothEventReport(targetEventId);
    else if(el("boothCloseCard")||el("boothCloseConfirmBtn"))await confirmBoothEventClosePreparing(event);
    boothShowSuccess("戻り先を変更しました",`${returnedRows.length}件の戻り先を${getBoothReportReturnDestinationLabel(destination)}へ変更しました。戻り実数は変更していません。`);
  }catch(error){
    for(const operation of operations.reverse()){
      try{
        if(operation.patched)await patchBoothEventItem(operation.item,getBoothReportReturnRestorePayload(operation.before));
        if(operation.inventoryLog?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(operation.inventoryLog.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        if(operation.movement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(operation.movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        if(operation.storageAdjusted)await upsertBoothEventStorageStock(getBoothEventStoreCode(event),operation.item,-operation.storageDelta);
        if(operation.baseAdjusted)await adjustBoothProductBaseStock(operation.item.barcode,-operation.baseDelta);
      }catch(rollbackError){console.warn("[booth return destination rollback failed]",rollbackError);}
    }
    boothShowError("戻り先変更エラー",error.message||"戻り先の変更に失敗しました。");
  }finally{
    window.__aricoBoothReturnDestinationChanging=false;
  }
}

function getBoothReportReturnDestinationState(rows){
  const types=[...new Set((Array.isArray(rows)?rows:[]).map(row=>normalizeBoothReportReturnDestination(getBoothReturnProcessType(row))).filter(Boolean))];
  return {locked:types.length===1?types[0]:"",mixed:types.length>1};
}

function getBoothReportReturnRestorePayload(before){
  return {
    returned_qty:Number(before?.returned_qty||0),
    difference_qty:Number(before?.difference_qty||0),
    return_process_type:before?.return_process_type||null,
    return_reflected:before?.return_reflected||false,
    return_reflected_qty:Number(before?.return_reflected_qty||0),
    return_reflected_at:before?.return_reflected_at||null,
    return_reflected_by:before?.return_reflected_by||null,
    shelf_return_qty:Number(before?.shelf_return_qty||0),
    event_storage_qty:Number(before?.event_storage_qty||0),
    shelf_return_reflected:before?.shelf_return_reflected||false,
    shelf_return_reflected_qty:Number(before?.shelf_return_reflected_qty||0),
    shelf_return_reflected_at:before?.shelf_return_reflected_at||null,
    shelf_return_reflected_by:before?.shelf_return_reflected_by||null
  };
}
function updateBoothReportReturnBatchSummary(section){
  if(!section)return;
  const values=new Map();
  section.querySelectorAll("[data-booth-report-return-input]").forEach(input=>{
    const id=String(input.dataset.itemId||"");
    if(id&&!values.has(id))values.set(id,{value:String(input.value||"").trim(),saved:String(input.dataset.savedReturned||"0")});
  });
  const changed=[...values.values()].filter(row=>row.value!==row.saved);
  const selected=normalizeBoothReportReturnDestination(section.dataset.selectedDestination||"");
  const destinationDirty=section.dataset.returnDestinationDirty==="true";
  section.querySelectorAll("[data-booth-report-return-unsaved-count]").forEach(node=>{node.textContent=`未保存：${changed.length}件`;});
  const button=section.querySelector("[data-booth-report-return-batch-save]");
  if(button){
    button.textContent=destinationDirty&&changed.length===0?"戻り先を一括確定":`戻り実績を一括保存（${changed.length}件）`;
    button.disabled=!selected||(!destinationDirty&&changed.length===0);
  }
  section.querySelectorAll("[data-booth-report-return-row]").forEach(row=>{
    const input=row.querySelector("[data-booth-report-return-input]");
    const saved=String(input?.dataset.savedReturned||"0");
    row.classList.toggle("is-unsaved",String(input?.value||"").trim()!==saved);
    const status=row.querySelector("[data-booth-report-return-status]");
    if(status)status.textContent=String(input?.value||"").trim()===saved?"保存済み":"未保存";
  });
}

function syncBoothReportReturnInput(input){
  const section=input?.closest("[data-booth-report-return-section]");
  const itemId=String(input?.dataset.itemId||"");
  if(!section||!itemId)return;
  section.querySelectorAll("[data-booth-report-return-input]").forEach(other=>{
    if(other!==input&&String(other.dataset.itemId||"")===itemId)other.value=input.value;
  });
  const rows=section.querySelectorAll("[data-booth-report-return-row]");
  rows.forEach(row=>{
    if(String(row.dataset.itemId||"")!==itemId)return;
    const planned=Number(input.dataset.plannedReturned||0);
    const raw=String(input.value||"").trim();
    const diffNode=row.querySelector("[data-booth-report-return-difference]");
    if(diffNode)diffNode.textContent=/^[0-9]+$/.test(raw)?String(Number(raw)-planned):"-";
    row.dataset.returnDiff=/^[0-9]+$/.test(raw)?String(Number(raw)-planned):"0";
  });
  updateBoothReportReturnBatchSummary(section);
}

function renderBoothReportReturnBatchSection(rows){
  const list=buildBoothReportReturnRows(rows);
  if(!list.length)return `<section class="booth-report-section" data-booth-report-return-section><h5>通常商品戻り実績</h5><div class="booth-empty">通常商品の戻り実績はありません。</div></section>`;
  const state=getBoothReportReturnDestinationState(list);
  const locked=state.locked;
  const adminAuthed=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
  const destinationLabel=locked?getBoothReportReturnDestinationLabel(locked):"未選択";
  const destinationButtons=["shelf","storage"].map(type=>`<button type="button" class="booth-report-return-destination-btn${locked===type?" is-selected":""}" data-booth-report-return-destination="${type}" aria-pressed="${locked===type?"true":"false"}" ${locked&&!state.mixed?"disabled":""}>${getBoothReportReturnDestinationLabel(type)}</button>`).join("");
  const destinationChangeButton=locked&&!state.mixed&&adminAuthed
    ?`<button type="button" class="secondary" data-booth-return-destination-change data-event-id="${esc(boothCurrentEventId||"")}">戻り先を変更</button>`
    :"";
  const tableRows=list.map(row=>{
    const id=String(row.id||"");
    const returned=Number(row.returned_qty||0);
    const saved=isBoothReturnReflected(row)||getBoothReturnProcessType(row);
    return `<tr data-booth-report-return-row data-item-id="${esc(id)}" data-return-diff="${esc(row.return_difference)}">
      <td>${esc(row.product_name||"-")}</td><td>${esc(row.barcode||"-")}</td><td>${esc(row.taken_qty??0)}</td><td>${esc(row.sold_qty??0)}</td><td>${esc(row.consumed_qty??0)}</td><td>${esc(row.planned_return_qty)}</td>
      <td><input class="booth-history-qty-input" data-booth-report-return-input type="number" min="0" step="1" inputmode="numeric" data-item-id="${esc(id)}" data-product-name="${esc(row.product_name||"")}" data-barcode="${esc(row.barcode||"")}" data-saved-returned="${esc(returned)}" data-planned-returned="${esc(row.planned_return_qty)}" value="${esc(returned)}" aria-label="戻り実数"></td>
      <td><strong data-booth-report-return-difference>${esc(row.return_difference)}</strong></td><td><span data-booth-report-return-status>${saved?"保存済み":"未保存"}</span></td></tr>`;
  }).join("");
  const cards=list.map(row=>{
    const id=String(row.id||"");
    const returned=Number(row.returned_qty||0);
    const saved=isBoothReturnReflected(row)||getBoothReturnProcessType(row);
    return `<article class="booth-history-card booth-report-return-card" data-booth-report-return-row data-item-id="${esc(id)}" data-return-diff="${esc(row.return_difference)}">
      <div class="booth-history-card-top"><strong>${esc(row.product_name||"-")}</strong><span>${esc(row.barcode||"-")}</span></div>
      <div class="booth-history-card-meta"><span>持ち出し数：${esc(row.taken_qty??0)}</span><span>販売数：${esc(row.sold_qty??0)}</span><span>ガチャ移動数：${esc(row.consumed_qty??0)}</span><span>戻り予定数：${esc(row.planned_return_qty)}</span><span>差異：<strong data-booth-report-return-difference>${esc(row.return_difference)}</strong></span></div>
      <label>戻り実数<input class="booth-history-qty-input" data-booth-report-return-input type="number" min="0" step="1" inputmode="numeric" data-item-id="${esc(id)}" data-product-name="${esc(row.product_name||"")}" data-barcode="${esc(row.barcode||"")}" data-saved-returned="${esc(returned)}" data-planned-returned="${esc(row.planned_return_qty)}" value="${esc(returned)}"></label>
      <span class="booth-report-return-status" data-booth-report-return-status>${saved?"保存済み":"未保存"}</span></article>`;
  }).join("");
  return `<section class="booth-report-section booth-report-return-batch" data-booth-report-return-section data-selected-destination="${esc(locked)}" data-destination-mixed="${state.mixed?"true":"false"}">
    <div class="booth-report-return-header"><div><h5>通常商品戻り実績</h5><p class="section-note">戻り実数を入力して、最後に一括保存します。保存後の戻り先はイベント単位で固定され、管理者が変更できます。</p></div><strong data-booth-report-return-unsaved-count>未保存：0件</strong></div>
    <div class="booth-report-return-destination"><strong>戻り先（イベント単位で固定）</strong><span data-booth-report-return-destination-label>${esc(destinationLabel)}</span><div class="booth-report-return-destination-options" role="group" aria-label="戻り先">${destinationButtons}</div>${destinationChangeButton}${state.mixed?'<p class="form-error">既存データの戻り先が混在しています。戻り先を選ぶとイベント単位で統一できます。</p>':""}</div>
    <div class="button-row"><button type="button" class="secondary" data-booth-report-return-filter="all" aria-pressed="true">全件</button><button type="button" class="secondary" data-booth-report-return-filter="diff" aria-pressed="false">差異のみ</button></div>
    <div class="booth-report-return-actions"><button type="button" class="primary" data-booth-report-return-batch-save disabled>戻り実績を一括保存（0件）</button><span>変更した商品のみ保存します。</span></div>
    <div class="booth-history-table-wrap booth-scroll-table"><table class="booth-history-table booth-report-return-table"><thead><tr><th>商品名</th><th>バーコード</th><th>持ち出し数</th><th>販売数</th><th>ガチャ移動数</th><th>戻り予定数</th><th>戻り実数</th><th>差異</th><th>状態</th></tr></thead><tbody>${tableRows}</tbody></table></div>
    <div class="booth-history-cards booth-scroll-cards">${cards}</div>
  </section>`;
}
async function saveBoothReportReturnBatch(){
  if(window.__aricoBoothReportReturnBatchSaving)return;
  const section=document.querySelector("[data-booth-report-return-section]");
  const event=getBoothCurrentEvent();
  const destination=normalizeBoothReportReturnDestination(section?.dataset.selectedDestination||"");
  if(!section||!event){boothShowError("戻り実績保存エラー","イベントレポートを開いてから操作してください。");return;}
  if(!destination){boothShowError("戻り先未選択","戻り先を選択してください。");return;}
  if(section.dataset.destinationMixed==="true")section.dataset.destinationMixed="false";
  const entries=new Map();
  section.querySelectorAll("[data-booth-report-return-input]").forEach(input=>{
    const id=String(input.dataset.itemId||"");
    if(id&&!entries.has(id))entries.set(id,{id,value:String(input.value||"").trim(),saved:Number(input.dataset.savedReturned||0),productName:String(input.dataset.productName||""),barcode:String(input.dataset.barcode||"")});
  });
  const changed=[...entries.values()].filter(row=>row.value!==String(row.saved));
  if(!changed.length)return;
  for(const row of changed){
    if(!/^[0-9]+$/.test(row.value)){boothShowError("戻り実数エラー","戻り実数は0以上の整数で入力してください。");return;}
  }
  const totalQty=changed.reduce((sum,row)=>sum+Number(row.value),0);
  const totalDelta=changed.reduce((sum,row)=>sum+(Number(row.value)-row.saved),0);
  const summary=changed.map(row=>`${row.productName||"商品"}（${row.barcode||"バーコード不明"}）: ${row.saved} → ${Number(row.value)}`).join(String.fromCharCode(10));
  const movementMessage=destination==="shelf"
    ? `共通イベント棚から通常棚へ差分 ${totalDelta} 個を反映します。`
    : "在庫移動は行わず、戻り実績のみ保存します。";
  const body=["戻り実績を一括保存します。","戻り先："+getBoothReportReturnDestinationLabel(destination),"変更商品："+changed.length+"件","戻り数量合計："+totalQty+"個",movementMessage,"",summary,"","保存後は戻り先を変更できません。実行しますか？"].join(String.fromCharCode(10));
  const ok=typeof confirmAppAction==="function"?await confirmAppAction("戻り実績一括保存",body,{okText:"保存",cancelText:"キャンセル"}):true;
  if(!ok)return;
  window.__aricoBoothReportReturnBatchSaving=true;
  const operations=[];
  const staff=String(event.created_by||"イベントレポート戻り実績");
  try{
    for(const entry of changed){
      const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,shelf_return_qty,event_storage_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,shelf_return_reflected_by,return_process_type,return_reflected,return_reflected_qty,return_reflected_at,return_reflected_by&event_id=eq.${encodeURIComponent(event.id)}&id=eq.${encodeURIComponent(entry.id)}&item_type=eq.normal&limit=1`);
      const item=Array.isArray(rows)&&rows[0]?rows[0]:null;
      if(!item)throw new Error("対象の戻り商品が見つかりません。");
      const before={...item};
      const existingDestination=normalizeBoothReportReturnDestination(getBoothReturnProcessType(item));
      if(existingDestination&&existingDestination!==destination)throw new Error(`${item.product_name||item.barcode}: 戻り先が既に別の設定で固定されています。`);
      const nextReturned=Number(entry.value);
      const reflected=isBoothReturnReflected(item);
      const reflectedQty=reflected?getBoothReturnReflectedQty(item):0;
      const returnDelta=nextReturned-reflectedQty;
      const baseStockDelta=destination==="shelf"?returnDelta:0;
      // A storage return is already represented by the common shelf stock.
      // Only a normal-shelf return moves quantity between stock locations.
      const storageStockDelta=destination==="shelf"?-returnDelta:0;
      const operation={item,before,baseStockDelta,storageStockDelta,baseAdjusted:false,storageAdjusted:false,movement:null,inventoryLog:null,patched:false};
      operations.push(operation);
       if(baseStockDelta||storageStockDelta){
        if(destination==="shelf"){
           await adjustBoothProductBaseStock(item.barcode,baseStockDelta);
          operation.baseAdjusted=true;
        }
         await upsertBoothEventStorageStock(getBoothEventStoreCode(event),item,storageStockDelta);
        operation.storageAdjusted=true;
         const movementType=storageStockDelta>0?"storage_in":"storage_out";
        operation.movement=await insertBoothCommonEventMovement(event,item,Math.abs(storageStockDelta),staff,storageStockDelta>0?"戻り実績保存":"通常棚へ戻す",movementType);
        operation.inventoryLog=baseStockDelta?await sb("inventory_logs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({type:"在庫修正",staff,barcode:item.barcode,product_name:item.product_name||"",quantity:baseStockDelta,memo:`イベントレポート戻り実績 ${reflectedQty} -> ${nextReturned}`,event_id:event.id,affects_smaregi:false,smaregi_delta:0})}):null;
      }
      const now=new Date().toISOString();
      await patchBoothEventItem(item,{
        returned_qty:nextReturned,
        difference_qty:calculateBoothDifference({...item,returned_qty:nextReturned}),
        return_process_type:destination,
        return_reflected:true,
        return_reflected_qty:nextReturned,
        return_reflected_at:now,
        return_reflected_by:staff,
        shelf_return_qty:destination==="shelf"?nextReturned:0,
        event_storage_qty:destination==="storage"?nextReturned:0,
        shelf_return_reflected:destination==="shelf",
        shelf_return_reflected_qty:destination==="shelf"?nextReturned:0,
        shelf_return_reflected_at:destination==="shelf"?now:null,
        shelf_return_reflected_by:destination==="shelf"?staff:null
      });
      operation.patched=true;
    }
    await refreshBoothEventRelatedViews(event.id);
    await loadBoothEventReport(event.id);
    boothShowSuccess("戻り実績を保存しました",`${changed.length}件の戻り実績を保存しました。戻り先：${getBoothReportReturnDestinationLabel(destination)}`);
  }catch(error){
    for(const operation of operations.reverse()){
      try{
        if(operation.patched)await patchBoothEventItem(operation.item,getBoothReportReturnRestorePayload(operation.before));
        if(operation.inventoryLog?.[0]?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(operation.inventoryLog[0].id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        if(operation.movement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(operation.movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        if(operation.storageAdjusted)await upsertBoothEventStorageStock(getBoothEventStoreCode(event),operation.item,-operation.storageStockDelta);
        if(operation.baseAdjusted)await adjustBoothProductBaseStock(operation.item.barcode,-operation.baseStockDelta);
      }catch(rollbackError){console.warn("[booth report return batch rollback failed]",rollbackError);}
    }
    boothShowError("戻り実績保存エラー",error.message||"戻り実績の保存に失敗しました。");
  }finally{
    window.__aricoBoothReportReturnBatchSaving=false;
  }
}

// Final batch-save implementation: keep booth_event_items as the return
// record and update the store-common event shelf by destination delta.
async function saveBoothReportReturnBatch(){
  if(window.__aricoBoothReportReturnBatchSaving)return;
  const section=document.querySelector("[data-booth-report-return-section]");
  const event=getBoothCurrentEvent();
  const destination=normalizeBoothReportReturnDestination(section?.dataset.selectedDestination||"");
  if(!section||!event){boothShowError("Return save error","Open an event report first.");return;}
  if(!destination){boothShowError("Return destination required","Select a return destination first.");return;}
  if(section.dataset.destinationMixed==="true")section.dataset.destinationMixed="false";

  const entries=new Map();
  section.querySelectorAll("[data-booth-report-return-input]").forEach(input=>{
    const id=String(input.dataset.itemId||"");
    if(id&&!entries.has(id))entries.set(id,{
      id,
      value:String(input.value||"").trim(),
      saved:Number(input.dataset.savedReturned||0),
      productName:String(input.dataset.productName||""),
      barcode:String(input.dataset.barcode||"")
    });
  });
  const destinationDirty=section.dataset.returnDestinationDirty==="true";
  const changed=[...entries.values()].filter(row=>destinationDirty||row.value!==String(row.saved));
  if(!changed.length){boothShowError("Return save error","No return results or destination changes to save.");return;}
  for(const row of changed){
    if(!/^[0-9]+$/.test(row.value)){
      boothShowError("Return quantity error","Enter a whole number of 0 or more.");
      return;
    }
  }

  const totalQty=changed.reduce((sum,row)=>sum+Number(row.value),0);
  const body=[
    "Save event return results?",
    `Destination: ${getBoothReportReturnDestinationLabel(destination)}`,
    `Changed products: ${changed.length}`,
    `Returned quantity total: ${totalQty}`
  ].join(String.fromCharCode(10));
  const ok=typeof confirmAppAction==="function"
    ?await confirmAppAction("Save event return results",body,{okText:"Save",cancelText:"Cancel"})
    :true;
  if(!ok)return;

  window.__aricoBoothReportReturnBatchSaving=true;
  const operations=[];
  const staff=String(event.created_by||"event report");
  try{
    for(const entry of changed){
      const rows=await sb(`booth_event_items?select=id,event_id,barcode,product_name,item_type,taken_qty,sold_qty,returned_qty,consumed_qty,difference_qty,shelf_return_qty,event_storage_qty,shelf_return_reflected,shelf_return_reflected_qty,shelf_return_reflected_at,shelf_return_reflected_by,return_process_type,return_reflected,return_reflected_qty,return_reflected_at,return_reflected_by&event_id=eq.${encodeURIComponent(event.id)}&id=eq.${encodeURIComponent(entry.id)}&item_type=eq.normal&limit=1`);
      const item=Array.isArray(rows)&&rows[0]?rows[0]:null;
      if(!item)throw new Error("Return item was not found.");
      const before={...item};
      const existingDestination=normalizeBoothReportReturnDestination(getBoothReturnProcessType(item));
      if(existingDestination&&existingDestination!==destination&&!destinationDirty){
        throw new Error("This event already has a different return destination.");
      }
      const nextReturned=Number(entry.value);
      const planned=calculateBoothReturnPlannedQty(item);
      if(nextReturned>planned)throw new Error(`Return quantity exceeds planned quantity for ${item.product_name||item.barcode}.`);
      const reflectedQty=isBoothReturnReflected(item)?getBoothReturnReflectedQty(item):0;
      const previousBaseStockEffect=existingDestination==="shelf"?reflectedQty:0;
      const previousStorageStockEffect=existingDestination==="shelf"?-reflectedQty:0;
      const nextBaseStockEffect=destination==="shelf"?nextReturned:0;
      const nextStorageStockEffect=destination==="shelf"?-nextReturned:0;
      const baseStockDelta=nextBaseStockEffect-previousBaseStockEffect;
      // A storage return is already represented by the common shelf stock.
      // Only a normal-shelf return moves quantity between stock locations.
      const storageStockDelta=nextStorageStockEffect-previousStorageStockEffect;
      const operation={item,before,baseStockDelta,storageStockDelta,baseAdjusted:false,storageAdjusted:false,movement:null,inventoryLog:null,patched:false};
      operations.push(operation);

      if(baseStockDelta){
        const product=await findBoothProductByBarcode(String(item.barcode||"").trim());
        if(!product)throw new Error(`Product master not found: ${item.barcode}`);
        await adjustBoothProductBaseStock(item.barcode,baseStockDelta);
        operation.baseAdjusted=true;
      }
      if(storageStockDelta){
        await upsertBoothEventStorageStock(getBoothEventStoreCode(event),item,storageStockDelta);
        operation.storageAdjusted=true;
        operation.movement=await insertBoothCommonEventMovement(
          event,
          item,
          Math.abs(storageStockDelta),
          staff,
          storageStockDelta>0?"event return kept on common shelf":"event return moved to normal shelf",
          storageStockDelta>0?"storage_in":"storage_out"
        );
      }
      if(baseStockDelta){
        operation.inventoryLog=await sb("inventory_logs",{
          method:"POST",
          headers:{Prefer:"return=representation"},
          body:JSON.stringify({
            type:"inventory adjustment",
            staff,
            barcode:item.barcode,
            product_name:item.product_name||"",
            quantity:baseStockDelta,
            memo:`event return ${reflectedQty} -> ${nextReturned}`,
            event_id:event.id,
            affects_smaregi:false,
            smaregi_delta:0
          })
        });
      }
      const now=new Date().toISOString();
      await patchBoothEventItem(item,{
        returned_qty:nextReturned,
        difference_qty:calculateBoothDifference({...item,returned_qty:nextReturned}),
        return_process_type:destination,
        return_reflected:nextReturned>0,
        return_reflected_qty:nextReturned,
        return_reflected_at:nextReturned>0?now:null,
        return_reflected_by:nextReturned>0?staff:null,
        shelf_return_qty:destination==="shelf"?nextReturned:0,
        event_storage_qty:destination==="storage"?nextReturned:0,
        shelf_return_reflected:destination==="shelf"&&nextReturned>0,
        shelf_return_reflected_qty:destination==="shelf"?nextReturned:0,
        shelf_return_reflected_at:destination==="shelf"&&nextReturned>0?now:null,
        shelf_return_reflected_by:destination==="shelf"&&nextReturned>0?staff:null
      });
      operation.patched=true;
    }
    await refreshBoothEventRelatedViews(event.id);
    await loadBoothEventReport(event.id);
    boothShowSuccess("Return results saved",`${changed.length} products saved.`);
  }catch(error){
    for(const operation of operations.reverse()){
      try{
        if(operation.patched)await patchBoothEventItem(operation.item,getBoothReportReturnRestorePayload(operation.before));
        if(operation.inventoryLog?.[0]?.id)await sb(`inventory_logs?id=eq.${encodeURIComponent(operation.inventoryLog[0].id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        if(operation.movement?.id)await sb(`event_storage_movements?id=eq.${encodeURIComponent(operation.movement.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
        if(operation.storageAdjusted)await upsertBoothEventStorageStock(getBoothEventStoreCode(event),operation.item,-operation.storageStockDelta);
        if(operation.baseAdjusted)await adjustBoothProductBaseStock(operation.item.barcode,-operation.baseStockDelta);
      }catch(rollbackError){console.warn("[booth report return batch rollback failed]",rollbackError);}
    }
    boothShowError("Return save error",error.message||"Failed to save event return results.");
  }finally{
    window.__aricoBoothReportReturnBatchSaving=false;
  }
}

if(!window.__aricoBoothReportReturnBatchHandlersBound){
  document.addEventListener("click",event=>{
    const destinationChange=event.target.closest("[data-booth-return-destination-change]");
    if(destinationChange){
      const eventId=String(destinationChange.dataset.eventId||boothCurrentEventId||"");
      const reportSection=destinationChange.closest("[data-booth-report-return-section]");
      const currentDestination=normalizeBoothReportReturnDestination(reportSection?.dataset.selectedDestination||destinationChange.dataset.currentDestination||"");
      const nextDestination=currentDestination==="shelf"?"storage":"shelf";
      void changeBoothEventReturnDestination(eventId,nextDestination);
      return;
    }
    const destinationButton=event.target.closest("[data-booth-report-return-destination]");
    if(destinationButton){
      const section=destinationButton.closest("[data-booth-report-return-section]");
      const selected=normalizeBoothReportReturnDestination(destinationButton.dataset.boothReportReturnDestination||"");
      if(!section)return;
      const locked=normalizeBoothReportReturnDestination(section.dataset.selectedDestination||"");
      if(locked&&locked!==selected&&section.dataset.destinationMixed!=="true"&&section.dataset.returnDestinationDirty!=="true"){boothShowError("戻り先固定エラー","このイベントの戻り先は既に固定されています。");return;}
      section.dataset.selectedDestination=selected;
      if(section.dataset.destinationMixed==="true")section.dataset.destinationMixed="false";
      section.dataset.returnDestinationDirty="true";
      section.querySelectorAll("[data-booth-report-return-destination]").forEach(button=>{button.setAttribute("aria-pressed",button===destinationButton?"true":"false");button.classList.toggle("is-selected",button===destinationButton);});
      const label=section.querySelector("[data-booth-report-return-destination-label]");
      if(label)label.textContent=getBoothReportReturnDestinationLabel(selected);
      updateBoothReportReturnBatchSummary(section);
      return;
    }
    const save=event.target.closest("[data-booth-report-return-batch-save]");
    if(save){void saveBoothReportReturnBatch();return;}
    const filter=event.target.closest("[data-booth-report-return-filter]");
    if(!filter)return;
    const section=filter.closest("[data-booth-report-return-section]");
    if(!section)return;
    const mode=filter.dataset.boothReportReturnFilter||"all";
    section.querySelectorAll("[data-booth-report-return-filter]").forEach(button=>button.setAttribute("aria-pressed",button===filter?"true":"false"));
    section.querySelectorAll("[data-booth-report-return-row]").forEach(row=>{row.hidden=mode==="diff"&&Number(row.dataset.returnDiff||0)===0;});
  });
  document.addEventListener("input",event=>{
    const input=event.target.closest("[data-booth-report-return-input]");
    if(input)syncBoothReportReturnInput(input);
  });
  window.__aricoBoothReportReturnBatchHandlersBound=true;
}
exportBoothEventReportCsv=async function(event){
  try{
    const data=await buildBoothEventReportData(event.id);
    const returnRows=buildBoothReportReturnRows(data.normal);
    const normalProducts=aggregateBoothSalesByProduct(data.normalSales);
    const gachaProducts=aggregateBoothSalesByProduct(data.gachaSales);
    const diffRows=data.diffRows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
    const rows=[
      ["イベントレポート"],
      ["イベント名",event?.name||""],
      ["会場",event?.venue||""],
      ["期間",[event?.event_start,event?.event_end].filter(Boolean).join(" - ")],
      [],
      ["通常商品戻り実績"],
      ["商品名","バーコード","持ち出し数","販売数","ガチャ移動数","戻り予定数","戻り実数","差異","戻り先"],
      ...returnRows.map(row=>[row.product_name||"",row.barcode||"",row.taken_qty??0,row.sold_qty??0,row.consumed_qty??0,row.planned_return_qty,row.returned_qty??0,row.return_difference,getBoothReportReturnDestinationLabel(getBoothReturnProcessType(row))]),
      [],
      ["商品別通常販売実績"],
      ["商品名","バーコード","販売数量","売上"],
      ...normalProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,row.amount]),
      [],
      ["ガチャ販売実績"],
      ["商品名","バーコード","販売数量","売上"],
      ...gachaProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,row.amount]),
      [],
      ["在庫差異"],
      ["商品名","バーコード","持ち出し数","販売数","戻り実数","ガチャ移動数","差異","状態"],
      ...diffRows.map(row=>[row.product_name||"",row.barcode||"",row.taken_registered?row.taken_qty:"持ち出し未登録",row.sold_qty??0,row.returned_qty??0,row.consumed_qty??0,calculateBoothItemDifference(row),row.taken_registered?"確認済み":"持ち出し未登録"])
    ];
    downloadBoothCsvFile(`${boothEventExportBaseName(event,"イベントレポート")}.csv`,rows);
  }catch(error){
    boothShowError("CSV出力エラー",error.message||"イベントレポートCSVの出力に失敗しました。");
  }
};

exportBoothEventReportPdf=async function(event){
  try{
    const data=await buildBoothEventReportData(event.id);
    const returnRows=buildBoothReportReturnRows(data.normal);
    const normalProducts=aggregateBoothSalesByProduct(data.normalSales);
    const gachaProducts=aggregateBoothSalesByProduct(data.gachaSales);
    const diffRows=data.diffRows.filter(row=>calculateBoothItemDifference(row)!==0||!row.taken_registered);
    const html=`<h1>イベントレポート</h1>
      <div class="meta"><strong>イベント</strong><span>${esc(event?.name||"-")}</span><strong>会場</strong><span>${esc(event?.venue||"-")}</span><strong>期間</strong><span>${esc([event?.event_start,event?.event_end].filter(Boolean).join(" - ")||"-")}</span></div>
      ${boothPdfTable("通常商品戻り実績",["商品名","バーコード","持ち出し数","販売数","ガチャ移動数","戻り予定数","戻り実数","差異","戻り先"],returnRows.map(row=>[row.product_name||"",row.barcode||"",row.taken_qty??0,row.sold_qty??0,row.consumed_qty??0,row.planned_return_qty,row.returned_qty??0,row.return_difference,getBoothReportReturnDestinationLabel(getBoothReturnProcessType(row))]))}
      ${boothPdfTable("商品別通常販売実績",["商品名","バーコード","販売数量","売上"],normalProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,boothMoney(row.amount)]))}
      ${boothPdfTable("ガチャ販売実績",["商品名","バーコード","販売数量","売上"],gachaProducts.map(row=>[row.product_name||"",row.barcode||"",row.quantity,boothMoney(row.amount)]))}
      ${boothPdfTable("在庫差異",["商品名","バーコード","持ち出し数","販売数","戻り実数","ガチャ移動数","差異","状態"],diffRows.map(row=>[row.product_name||"",row.barcode||"",row.taken_registered?row.taken_qty:"持ち出し未登録",row.sold_qty??0,row.returned_qty??0,row.consumed_qty??0,calculateBoothItemDifference(row),row.taken_registered?"確認済み":"持ち出し未登録"]))}`;
    if(openBoothPdfWindow(boothEventExportBaseName(event,"イベントレポート"),html))boothShowSuccess("PDF出力","イベントレポートPDFを開きました。");
  }catch(error){
    boothShowError("PDF出力エラー",error.message||"イベントレポートPDFの出力に失敗しました。");
  }
};

// Ver 2.75: event close is status-only. Return stock movements are completed
// when the return destination is confirmed in the event report.
(function(root){
  function aricoCloseRowsNeedingReturn(summary){
    const rows=Array.isArray(summary?.rows)?summary.rows:[];
    return rows.filter(row=>row.item_type==="normal"&&(
      Number(row.normal_takeout_qty||0)>0||
      Number(row.storage_takeout_qty||0)>0||
      Number(row.taken_qty||0)>0
    ));
  }

  function aricoCloseRowsWithoutDestination(rows){
    return rows.filter(row=>Number(row.returned_qty||0)>0&&!normalizeBoothReportReturnDestination(getBoothReturnProcessType(row)));
  }

  function aricoCloseHasNoReturnSaved(rows){
    return rows.length>0
      && !rows.some(row=>Number(row.returned_qty||0)>0)
      && !rows.some(row=>normalizeBoothReportReturnDestination(getBoothReturnProcessType(row)));
  }

  reflectBoothShelfReturnsOnClose=async function(){
    return [];
  };

  rollbackBoothCloseReflection=async function(){
    return [];
  };

  finalizeBoothEventClose=async function(event,summary,staff){
    const now=new Date().toISOString();
    let snapshots=[];
    try{
      const finalSummary=await loadBoothCloseCommonStockSummary(event,await loadBoothCloseSummary(event));
      snapshots=await createBoothEventCloseSnapshots(event,finalSummary,staff,now).catch(error=>{
        console.warn("[booth close snapshot skipped]",error);
        return [];
      });
      const updated=await sb("booth_events?id=eq."+encodeURIComponent(event.id),{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({status:"closed",closed_at:now,closed_by:staff})
      });
      const closedEvent=Array.isArray(updated)&&updated[0]?updated[0]:{...event,status:"closed",closed_at:now,closed_by:staff};
      boothEvents=boothEvents.map(row=>String(row.id)===String(event.id)?closedEvent:row);
      boothCurrentEventId=String(event.id);
      renderBoothEvents(boothEvents);
      renderBoothEventDetail(closedEvent);
      boothShowSuccess("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u5b8c\u4e86","\u30a4\u30d9\u30f3\u30c8\u3092\u7de0\u3081\u307e\u3057\u305f\u3002\u7de0\u3081\u30dc\u30bf\u30f3\u3067\u306f\u901a\u5e38\u68da\u30fb\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u306e\u6570\u91cf\u306f\u5909\u66f4\u3057\u3066\u3044\u307e\u305b\u3093\u3002");
      return {closedEvent,snapshots};
    }catch(error){
      for(const row of snapshots){
        if(row?.id)await sb("booth_stock_movements?id=eq."+encodeURIComponent(row.id),{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});
      }
      throw error;
    }
  };

  confirmBoothEventClose=async function(event){
    const staff=String(event?.closed_by||event?.created_by||"\u30a4\u30d9\u30f3\u30c8\u7de0\u3081").trim()||"\u30a4\u30d9\u30f3\u30c8\u7de0\u3081";
    try{
      const latestRows=await sb("booth_events?select=*&id=eq."+encodeURIComponent(event.id)+"&limit=1");
      const latestEvent=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
      if(!latestEvent){boothShowError("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u30a8\u30e9\u30fc","\u30a4\u30d9\u30f3\u30c8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002");return;}
      if(isBoothEventClosed(latestEvent)){boothShowError("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u30a8\u30e9\u30fc","\u3053\u306e\u30a4\u30d9\u30f3\u30c8\u306f\u3059\u3067\u306b\u7de0\u3081\u6e08\u307f\u3067\u3059\u3002");return;}
      const summary=await loadBoothCloseCommonStockSummary(latestEvent,await loadBoothCloseSummary(latestEvent));
      const normalRows=aricoCloseRowsNeedingReturn(summary);
      const noReturnSaved=aricoCloseHasNoReturnSaved(normalRows);
      const unprocessedNormal=aricoCloseRowsWithoutDestination(normalRows);
      if(noReturnSaved){
        boothShowError("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u30a8\u30e9\u30fc","\u623b\u308a\u5b9f\u6570\u304c\u4fdd\u5b58\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u623b\u308a\u5728\u5eab\u51e6\u7406\u3067\u5b9f\u6570\u3092\u4fdd\u5b58\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
        return;
      }
      if(unprocessedNormal.length){
        boothShowError("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u30a8\u30e9\u30fc","\u623b\u308a\u5148\u304c\u672a\u78ba\u5b9a\u306e\u5546\u54c1\u304c\u3042\u308a\u307e\u3059\u3002\u30a4\u30d9\u30f3\u30c8\u30ec\u30dd\u30fc\u30c8\u3067\u623b\u308a\u5148\u3092\u78ba\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
        return;
      }
      const eventShelfQty=normalRows.reduce((sum,row)=>sum+Number(row.event_shelf_current_qty||0),0);
      const returnQty=normalRows.reduce((sum,row)=>sum+Number(row.returned_qty||0),0);
      const body=[
        "\u3053\u306e\u30a4\u30d9\u30f3\u30c8\u3092\u7de0\u3081\u307e\u3059\u3002",
        "\u7de0\u3081\u30dc\u30bf\u30f3\u3067\u306f\u901a\u5e38\u68da\u30fb\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u306e\u6570\u91cf\u306f\u5909\u66f4\u3057\u307e\u305b\u3093\u3002",
        "",
        "\u30a4\u30d9\u30f3\u30c8\uff1a"+(latestEvent.name||"-"),
        "\u62c5\u5f53\u8005\uff1a"+staff,
        "\u5bfe\u8c61\u5546\u54c1\u6570\uff1a"+normalRows.length,
        "\u4fdd\u5b58\u6e08\u307f\u623b\u308a\u5b9f\u6570\uff1a"+returnQty,
        "\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u306b\u6b8b\u308b\u6570\u91cf\uff1a"+eventShelfQty
      ].join("\n");
      const ok=typeof confirmAppAction==="function"
        ? await confirmAppAction("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u78ba\u8a8d",body,{okText:"\u30a4\u30d9\u30f3\u30c8\u3092\u7de0\u3081\u308b",cancelText:"\u30ad\u30e3\u30f3\u30bb\u30eb"})
        : true;
      if(!ok)return;
      await finalizeBoothEventClose(latestEvent,summary,staff);
    }catch(error){
      boothShowError("\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u30a8\u30e9\u30fc",error.message||"\u30a4\u30d9\u30f3\u30c8\u7de0\u3081\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
    }
  };

  confirmBoothEventReopen=async function(event){
    const staff=String(el("boothReopenStaff")?.value||"").trim();
    const reason=String(el("boothReopenReason")?.value||"").trim();
    if(!staff){boothShowError("\u7de0\u3081\u89e3\u9664\u30a8\u30e9\u30fc","\u89e3\u9664\u62c5\u5f53\u8005\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002","boothReopenStaff");return;}
    if(!reason){boothShowError("\u7de0\u3081\u89e3\u9664\u30a8\u30e9\u30fc","\u89e3\u9664\u7406\u7531\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002","boothReopenReason");return;}
    try{
      const latestRows=await sb("booth_events?select=*&id=eq."+encodeURIComponent(event.id)+"&limit=1");
      const latestEvent=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
      if(!latestEvent){boothShowError("\u7de0\u3081\u89e3\u9664\u30a8\u30e9\u30fc","\u30a4\u30d9\u30f3\u30c8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002");return;}
      if(!isBoothEventClosed(latestEvent)){boothShowError("\u7de0\u3081\u89e3\u9664\u30a8\u30e9\u30fc","\u3053\u306e\u30a4\u30d9\u30f3\u30c8\u306f\u7de0\u3081\u6e08\u307f\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002");return;}
      const reasonText=el("boothReopenReason")?.selectedOptions?.[0]?.textContent||reason;
      const body=[
        "\u3053\u306e\u30a4\u30d9\u30f3\u30c8\u306e\u7de0\u3081\u3092\u89e3\u9664\u3057\u307e\u3059\u3002",
        "\u7de0\u3081\u89e3\u9664\u30dc\u30bf\u30f3\u3067\u306f\u901a\u5e38\u68da\u30fb\u5171\u901a\u30a4\u30d9\u30f3\u30c8\u68da\u306e\u6570\u91cf\u306f\u5909\u66f4\u3057\u307e\u305b\u3093\u3002",
        "",
        "\u30a4\u30d9\u30f3\u30c8\uff1a"+(latestEvent.name||"-"),
        "\u7de0\u3081\u65e5\u6642\uff1a"+formatBoothDateTime(latestEvent.closed_at),
        "\u89e3\u9664\u62c5\u5f53\u8005\uff1a"+staff,
        "\u89e3\u9664\u7406\u7531\uff1a"+reasonText
      ].join("\n");
      const ok=typeof confirmAppAction==="function"
        ? await confirmAppAction("\u7de0\u3081\u89e3\u9664\u78ba\u8a8d",body,{okText:"\u7de0\u3081\u89e3\u9664",cancelText:"\u30ad\u30e3\u30f3\u30bb\u30eb"})
        : true;
      if(!ok)return;
      const now=new Date().toISOString();
      const updated=await sb("booth_events?id=eq."+encodeURIComponent(latestEvent.id),{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({status:"draft",closed_at:null,closed_by:null,reopened_at:now,reopened_by:staff,reopen_reason:reason})
      });
      const reopenedEvent=Array.isArray(updated)&&updated[0]?updated[0]:{...latestEvent,status:"draft",closed_at:null,closed_by:null,reopened_at:now,reopened_by:staff,reopen_reason:reason};
      boothEvents=boothEvents.map(row=>String(row.id)===String(latestEvent.id)?reopenedEvent:row);
      boothCurrentEventId=String(latestEvent.id);
      renderBoothEvents(boothEvents);
      renderBoothEventDetail(reopenedEvent);
      boothShowSuccess("\u7de0\u3081\u89e3\u9664\u5b8c\u4e86","\u30a4\u30d9\u30f3\u30c8\u306e\u7de0\u3081\u3092\u89e3\u9664\u3057\u307e\u3057\u305f\u3002\u5728\u5eab\u6570\u91cf\u306f\u5909\u66f4\u3057\u3066\u3044\u307e\u305b\u3093\u3002");
    }catch(error){
      boothShowError("\u7de0\u3081\u89e3\u9664\u30a8\u30e9\u30fc",error.message||"\u7de0\u3081\u89e3\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002");
    }
  };

  root.confirmBoothEventClose=confirmBoothEventClose;
  root.finalizeBoothEventClose=finalizeBoothEventClose;
  root.reflectBoothShelfReturnsOnClose=reflectBoothShelfReturnsOnClose;
  root.rollbackBoothCloseReflection=rollbackBoothCloseReflection;
  root.confirmBoothEventReopen=confirmBoothEventReopen;
})(window);
