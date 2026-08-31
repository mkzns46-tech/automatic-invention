/* ARICO TOKYO inventory app: inventory.js */

let products=[];
let logs=[];
let staffMembers=[];
let selectedBarcode="";
let dataLoaded=false;
let dataLoadError=false;
let eventPickEvents=[];
let equipmentTransferLogCache=new Map();
let inventorySourceStockState={barcode:"",source:"",quantity:null,ok:false};

let videoStream=null;
let detector=null;
let scanning=false;
let lastScan="";
let lastScanAt=0;
let zxingReader=null;
let zxingRunning=false;

function removeLegacyGachaInventoryOptions(){
  document.querySelectorAll('#type option[value="gacha"],#type option[value="gacha_return"]').forEach(option=>option.remove());
}

removeLegacyGachaInventoryOptions();

function render(){
  removeLegacyGachaInventoryOptions();
  renderStaffOptions();
  ensureEventPickSourceControl();
  renderEventPickOptions();
  renderScrollableEventPickPicker();
  renderStaffList();
  renderProductCount();
  renderRecentRegistrationHistory();
  renderGlobalHistory();
  renderSelectedProductHistory();
  if(typeof renderAppInventoryCount==="function")renderAppInventoryCount();
  if(typeof renderShelfLocation==="function")renderShelfLocation();
  if(typeof applyLang==='function')setTimeout(applyLang,0);
}

function updateEquipmentMemoUi(){
  ensureEventPickSourceControl();
  const required=el("equipmentMemoRequired");
  const memo=el("memo");
  const isEquipment=el("type")?.value==="備品転用";
  const isEventPick=el("type")?.value==="event_pick";
  const isGacha=el("type")?.value==="gacha";
  const isGachaReturn=el("type")?.value==="gacha_return";
  const isStockOut=el("type")?.value==="出荷";
  const canChooseSource=isStockOut;
  if(required)required.hidden=!isEquipment;
  if(memo)memo.required=isEquipment;
  const eventLabel=el("eventPickEventLabel");
  if(eventLabel){
    const needsEvent=isEventPick||isGacha||isGachaReturn;
    eventLabel.hidden=!needsEvent;
    eventLabel.style.display=needsEvent?"":"none";
  }
  const sourceLabel=el("eventPickSourceLabel");
  if(sourceLabel){
    sourceLabel.hidden=!canChooseSource;
    sourceLabel.style.display=canChooseSource?"":"none";
  }
  if((isEventPick||isGacha||isGachaReturn)&&typeof loadEventPickEvents==="function"&&!eventPickEvents.length){
    loadEventPickEvents().then(()=>{
      renderEventPickOptions();
      renderScrollableEventPickPicker();
    }).catch(()=>{});
  }
  renderScanPreview();
}

function ensureEventPickSourceControl(){
  const eventLabel=el("eventPickEventLabel");
  if(!eventLabel||el("eventPickSourceLabel"))return;
  const label=document.createElement("label");
  label.id="eventPickSourceLabel";
  label.hidden=true;
  label.style.display="none";
  label.innerHTML='持ち出し元 <span class="required">必須</span><select id="eventPickSourceSelect"><option value="normal">通常棚</option><option value="storage">イベント保管在庫</option></select>';
  eventLabel.insertAdjacentElement("afterend",label);
  el("eventPickSourceSelect").addEventListener("change",()=>renderScanPreview());
}

function getEventPickSource(){
  return el("eventPickSourceSelect")?.value==="storage" ? "storage" : "normal";
}

function getEventPickSourceLabel(source){
  return source==="storage" ? "イベント保管在庫" : "通常棚";
}

function ensureInventorySourceStockInfo(){
  let node=el("inventorySourceStockInfo");
  if(node)return node;
  const qtyInput=el("qty");
  if(!qtyInput?.parentElement)return null;
  node=document.createElement("span");
  node.id="inventorySourceStockInfo";
  node.className="message inventory-source-stock-info";
  node.setAttribute("aria-live","polite");
  qtyInput.insertAdjacentElement("afterend",node);
  return node;
}

function setInventorySourceStockInfo(text,className="message"){
  const node=ensureInventorySourceStockInfo();
  if(!node)return;
  node.textContent=text||"";
  node.className=className;
}

function clearInventorySourceStockState(){
  inventorySourceStockState={barcode:"",source:"",quantity:null,ok:false};
  setInventorySourceStockInfo("");
}

async function fetchLatestInventoryProduct(barcode){
  const normalizedBarcode=String(barcode||"").trim();
  if(!normalizedBarcode)return null;
  const rows=await sb(`products?select=*&barcode=eq.${encodeURIComponent(normalizedBarcode)}&limit=1`);
  const product=Array.isArray(rows)&&rows[0]?rows[0]:null;
  if(product){
    const cached=gp(normalizedBarcode);
    if(cached)Object.assign(cached,product);
    else products.push(product);
  }
  return product;
}

async function getInventorySourceStock(product,source){
  const barcode=String(product?.barcode||"").trim();
  if(!barcode)throw new Error("バーコードがありません。");
  if(source==="storage"){
    const row=await getEventStorageStockRow(getInventoryCurrentStoreCode(),barcode);
    if(!row)throw new Error("イベント棚在庫を取得できませんでした。");
    return {barcode,source,quantity:Math.max(0,Number(row.storage_qty||0)),product};
  }
  const latest=await fetchLatestInventoryProduct(barcode);
  if(!latest)throw new Error("通常棚在庫を取得できませんでした。");
  return {barcode,source,quantity:Number(latest.base_stock||0),product:latest};
}

function applyInventorySourceStockState(state){
  inventorySourceStockState={barcode:state.barcode,source:state.source,quantity:state.quantity,ok:true};
  const label=state.source==="storage"?"イベント棚在庫":"通常棚在庫";
  setInventorySourceStockInfo(`${label}：${state.quantity}`,"message ok inventory-source-stock-info");
}

function applyInventorySourceStockError(source){
  inventorySourceStockState={barcode:"",source,quantity:null,ok:false};
  const label=source==="storage"?"イベント棚在庫":"通常棚在庫";
  setInventorySourceStockInfo(`${label}を取得できませんでした`,"message err inventory-source-stock-info");
}

async function loadEventPickEvents(){
  try{
    eventPickEvents=await sb("booth_events?select=id,name,venue,event_start,event_end,status&status=neq.closed&order=event_start.desc&limit=200");
    if(!Array.isArray(eventPickEvents))eventPickEvents=[];
  }catch(e){
    console.warn("[event pick events load failed]",e);
    eventPickEvents=[];
  }
}

function formatEventPickEventLabel(event){
  const name=event?.name||"無題イベント";
  const date=[event?.event_start,event?.event_end].filter(Boolean).join(" - ");
  const venue=event?.venue?` / ${event.venue}`:"";
  return `${name}${date?`（${date}）`:""}${venue}`;
}

function renderEventPickOptions(){
  const select=el("eventPickEventSelect");
  if(!select)return;
  const current=select.value;
  select.innerHTML='<option value="">イベントを選択</option>'+(eventPickEvents||[]).map(event=>`<option value="${esc(event.id)}">${esc(formatEventPickEventLabel(event))}</option>`).join("");
  if(current)select.value=current;
}

function findEventPickEvent(eventId){
  return (eventPickEvents||[]).find(event=>String(event.id)===String(eventId))||null;
}

function renderScrollableEventPickPicker(){
  const select=el("eventPickEventSelect");
  if(!select)return;
  select.classList.add("event-pick-native-select");
  let picker=el("eventPickEventPicker");
  if(!picker){
    picker=document.createElement("div");
    picker.id="eventPickEventPicker";
    picker.className="event-pick-picker";
    select.insertAdjacentElement("afterend",picker);
  }

  const selectedEvent=findEventPickEvent(select.value);
  const selectedLabel=selectedEvent?formatEventPickEventLabel(selectedEvent):"イベントを選択";
  picker.innerHTML=`
    <button type="button" class="event-pick-toggle" aria-expanded="false">${esc(selectedLabel)}</button>
    <div class="event-pick-list" hidden>
      <input type="search" class="event-pick-search" placeholder="イベント名・会場で検索">
      <div class="event-pick-options"></div>
    </div>`;

  const toggle=picker.querySelector(".event-pick-toggle");
  const list=picker.querySelector(".event-pick-list");
  const search=picker.querySelector(".event-pick-search");
  const options=picker.querySelector(".event-pick-options");

  const renderOptions=()=>{
    const keyword=String(search.value||"").trim().toLowerCase();
    const filtered=(eventPickEvents||[]).filter(event=>{
      const label=formatEventPickEventLabel(event).toLowerCase();
      return !keyword||label.includes(keyword);
    });
    options.innerHTML=`
      <button type="button" class="event-pick-option${!select.value?" is-selected":""}" data-event-id="">イベントを選択</button>
      ${filtered.map(event=>{
        const id=String(event.id);
        return `<button type="button" class="event-pick-option${id===String(select.value)?" is-selected":""}" data-event-id="${esc(id)}">${esc(formatEventPickEventLabel(event))}</button>`;
      }).join("")}
      ${filtered.length?"":'<div class="event-pick-empty">該当イベントがありません</div>'}`;
    options.querySelectorAll(".event-pick-option").forEach(option=>{
      option.onclick=e=>{
        e.stopPropagation();
        select.value=option.dataset.eventId||"";
        const event=findEventPickEvent(select.value);
        toggle.textContent=event?formatEventPickEventLabel(event):"イベントを選択";
        list.hidden=true;
        toggle.setAttribute("aria-expanded","false");
        select.dispatchEvent(new Event("change",{bubbles:true}));
      };
    });
  };

  toggle.onclick=e=>{
    e.stopPropagation();
    const willOpen=list.hidden;
    document.querySelectorAll(".event-pick-list,.staff-picker-list").forEach(other=>{other.hidden=true;});
    document.querySelectorAll(".event-pick-toggle,.staff-picker-toggle").forEach(other=>other.setAttribute("aria-expanded","false"));
    list.hidden=!willOpen;
    toggle.setAttribute("aria-expanded",String(willOpen));
    if(willOpen){
      renderOptions();
      setTimeout(()=>search.focus(),0);
    }
  };
  search.oninput=renderOptions;
  list.onclick=e=>e.stopPropagation();
  renderOptions();
}

function renderProductCount(){
  const badge=el("productCountBadge");
  if(badge)badge.textContent="登録数：高速モード";
}

function renderStaffOptions(){
  const staffLabel=s=>typeof getStaffDisplayName==="function" ? getStaffDisplayName(s) : (s.name||"");
  const options='<option value="">担当者を選択</option>'+staffMembers.map(s=>`<option value="${esc(staffLabel(s))}">${esc(staffLabel(s))}</option>`).join("");

  const staff=el("staff");
  if(staff){
    const cur=staff.value;
    staff.innerHTML=options;
    if(cur)staff.value=cur;
  }
  updateSmaregiProductImportControl();

  const smaregiChecker=el("smaregiCheckerName");
  if(smaregiChecker){
    const cur=smaregiChecker.value||localStorage.getItem("arico_smaregi_checker")||"";
    smaregiChecker.innerHTML='<option value="">担当者を選択</option>'+staffMembers.map(s=>`<option value="${esc(staffLabel(s))}">${esc(staffLabel(s))}</option>`).join("");
    if(cur)smaregiChecker.value=cur;
  }
  renderScrollableStaffPicker("staff","staffPicker");
  renderScrollableStaffPicker("smaregiCheckerName","smaregiCheckerNamePicker");
}

function renderScrollableStaffPicker(selectId,pickerId){
  const select=el(selectId);
  const picker=el(pickerId);
  if(!select||!picker)return;

  select.classList.add("staff-native-select");
  const selected=String(select.value||"");
  const staffLabel=member=>typeof getStaffDisplayName==="function" ? getStaffDisplayName(member) : (member.name||"");
  picker.innerHTML=`
    <button type="button" class="staff-picker-toggle" aria-expanded="false">${esc(selected||"担当者を選択")}</button>
    <div class="staff-picker-list" hidden>
      ${staffMembers.map(member=>`<button type="button" class="staff-picker-option${staffLabel(member)===selected?" is-selected":""}" data-staff-name="${esc(staffLabel(member))}">${esc(staffLabel(member))}</button>`).join("")}
    </div>`;

  const toggle=picker.querySelector(".staff-picker-toggle");
  const list=picker.querySelector(".staff-picker-list");
  toggle.onclick=e=>{
    e.stopPropagation();
    const willOpen=list.hidden;
    document.querySelectorAll(".staff-picker-list").forEach(other=>{other.hidden=true;});
    document.querySelectorAll(".staff-picker-toggle").forEach(other=>other.setAttribute("aria-expanded","false"));
    list.hidden=!willOpen;
    toggle.setAttribute("aria-expanded",String(willOpen));
  };
  picker.querySelectorAll(".staff-picker-option").forEach(option=>{
    option.onclick=e=>{
      e.stopPropagation();
      select.value=option.dataset.staffName||"";
      if(typeof applyStoreFromStaffValue==="function")applyStoreFromStaffValue(select.value);
      list.hidden=true;
      toggle.textContent=select.value||"担当者を選択";
      toggle.setAttribute("aria-expanded","false");
      select.dispatchEvent(new Event("change",{bubbles:true}));
    };
  });
}

document.addEventListener("click",()=>{
  document.querySelectorAll(".staff-picker-list").forEach(list=>{list.hidden=true;});
  document.querySelectorAll(".staff-picker-toggle").forEach(toggle=>toggle.setAttribute("aria-expanded","false"));
  document.querySelectorAll(".event-pick-list").forEach(list=>{list.hidden=true;});
  document.querySelectorAll(".event-pick-toggle").forEach(toggle=>toggle.setAttribute("aria-expanded","false"));
});

function renderStaffList(){
  const badge=el("staffCountBadge");
  const body=el("staffListBody");

  if(badge)badge.textContent=`担当者：${staffMembers.length}人`;
  if(!body)return;

  body.innerHTML=staffMembers.map(s=>`
    <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(typeof getStaffStoreName==="function" ? getStaffStoreName(s) : (s.store_name||s.store_code||"未設定"))}</td>
      <td>
        <div class="staff-action-group">
          <button type="button" class="staff-edit-btn secondary" data-staff-id="${s.id}" data-staff-name="${esc(s.name)}" data-staff-store="${esc(s.store_code||"")}">編集</button>
          <button type="button" class="staff-delete-btn" data-staff-id="${s.id}">削除</button>
        </div>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".staff-edit-btn").forEach(btn=>{
    btn.onclick=()=>editStaff(btn.dataset.staffId,btn.dataset.staffName,btn.dataset.staffStore);
  });
  document.querySelectorAll(".staff-delete-btn").forEach(btn=>{
    btn.onclick=()=>deleteStaff(btn.dataset.staffId);
  });
}

async function saveStaff(e){
  e.preventDefault();
  if(!requireInventoryPrivilegedAccess())return;
  try{
    const name=el("staffNameInput").value.trim();
    const storeCode=String(el("staffStoreInput")?.value||"").trim();
    if(!name){
      showMessage("担当者名を入力してください。","err");
      return;
    }
    if(!storeCode){
      showMessage("所属店舗を選択してください。","err");
      return;
    }
    const storeInfo=typeof getStoreInfoByCode==="function" ? getStoreInfoByCode(storeCode) : {key:storeCode,label:storeCode};

    await sb("staff_members?on_conflict=name,store_code",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify([{name,store_code:storeInfo.key,store_name:storeInfo.label}])
    });

    el("staffNameInput").value="";
    if(el("staffStoreInput"))el("staffStoreInput").value="";
    showMessage(`担当者を追加しました：${name}`,"ok");
    await reloadAll();
  }catch(e){
    showMessage("担当者追加エラー。\n"+e.message,"err");
  }
}

async function deleteStaff(id){
  if(!requireInventoryPrivilegedAccess())return;
  try{
    if(!confirm("この担当者を削除しますか？"))return;
    await sb(`staff_members?id=eq.${encodeURIComponent(id)}`,{
      method:"DELETE",
      headers:{Prefer:"return=minimal"}
    });
    showMessage("担当者を削除しました。","ok");
    await reloadAll();
  }catch(e){
    showMessage("担当者削除エラー。\n"+e.message,"err");
  }
}

async function editStaff(id,currentName,currentStoreCode=""){
  if(!requireInventoryPrivilegedAccess())return;
  try{
    const name=String(prompt("変更後の担当者名を入力してください。",currentName||"")||"").trim();
    if(!name)return;
    const storeCode=String(prompt("所属店舗コードを入力してください。tokyo / aichi / nagano",currentStoreCode||"tokyo")||"").trim().toLowerCase();
    const storeInfo=typeof getStoreInfoByCode==="function" ? getStoreInfoByCode(storeCode) : {key:storeCode,label:storeCode};
    await sb(`staff_members?id=eq.${encodeURIComponent(id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({name,store_code:storeInfo.key,store_name:storeInfo.label})
    });
    showMessage(`担当者名を変更しました：${name}`,"ok");
    await reloadAll();
  }catch(e){
    showMessage("担当者編集エラー。\n"+e.message,"err");
  }
}

async function renderScanPreview(){
  const info=el("scanProductInfo");
  const input=el("barcodeInput");
  if(!info||!input)return;

  const barcode=input.value.trim();

  if(!barcode){
    info.textContent="";
    info.className="message";
    clearInventorySourceStockState();
    return;
  }

  info.textContent="商品確認中...";
  info.className="message";

  try{
    const p=await fetchProductByBarcode(barcode);
    if(!p){
      info.textContent=`未登録バーコード：${barcode}`;
      info.className="message err";
      clearInventorySourceStockState();
      return;
    }

    const source=getEventPickSource();
    try{
      const stockState=await getInventorySourceStock(p,source);
      applyInventorySourceStockState(stockState);
      info.textContent=`${buildProductIdentityText(stockState.product)}\n${source==="storage"?"イベント棚現在庫":"通常棚現在庫"}：${stockState.quantity}`;
    }catch(stockError){
      applyInventorySourceStockError(source);
      info.textContent=`${buildProductIdentityText(p)}\n${source==="storage"?"イベント棚在庫":"通常棚在庫"}を取得できませんでした`;
      info.className="message err";
      return;
    }
    info.className="message ok";
  }catch(e){
    info.textContent="商品確認エラー。\n"+e.message;
    info.className="message err";
  }
}

async function syncHistoryFromScanBarcode(){
  const input=el("barcodeInput");
  if(!input)return;

  const barcode=input.value.trim();
  await renderScanPreview();

  const historyInput=el("productHistoryBarcodeInput");
  if(historyInput)historyInput.value=barcode;

  if(!barcode)return;

  const p=await fetchProductByBarcode(barcode);
  if(p){
    selectedBarcode=barcode;
    await showProductHistoryForBarcode(barcode);
  }
}

async function renderProductStockInfo(){
  const info=el("productStockInfo");
  const input=el("productBarcode");
  if(!info||!input)return;

  const barcode=input.value.trim();
  if(!barcode){
    info.textContent="";
    info.className="message";
    return;
  }

  const p=await fetchProductByBarcode(barcode);
  if(!p){
    info.textContent="未登録バーコードです。新規商品として登録できます。";
    info.className="message";
    return;
  }

  info.textContent=`登録済み\n${buildProductIdentityText(p)}\n現在庫：${Number(p.base_stock||0)}`;
  info.className="message ok";
}

async function saveProduct(e){
  e.preventDefault();

  try{
    const barcode=el("productBarcode").value.trim();
    const name=el("productName").value.trim();
    const base_stock=Number(el("baseStock").value||0);
    const location=el("location").value.trim();

    if(!barcode){
      showMessage("バーコードは必須です。","err");
      return;
    }

    if(!name){
      showMessage("商品名は必須です。","err");
      el("productName").focus();
      return;
    }

    await upsertProducts([{barcode,name,base_stock,location}]);

    const existing=gp(barcode);
    if(existing){
      existing.name=name;
      existing.base_stock=base_stock;
      existing.location=location;
    }else{
      products.push({barcode,name,base_stock,location});
    }

    showMessage(`商品登録・更新：${name}`,"ok");
    showPopup("商品登録完了", `商品名：${name}\n棚番：${getProductShelfLabel({location})}\nバーコード：${barcode}\n現在庫：${base_stock}`);

    el("productBarcode").value="";
    el("productName").value="";
    el("baseStock").value="0";
    el("location").value="";
  }catch(e){
    showMessage("商品登録エラー。\n"+e.message,"err");
  }
}

async function updateProductCurrentStock(barcode,newStock){
  await sb(`products?barcode=eq.${encodeURIComponent(barcode)}`,{
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({base_stock:newStock})
  });

  const p=gp(barcode);
  if(p)p.base_stock=newStock;
}

function getInventoryCurrentStoreCode(){
  if(typeof getCurrentSmaregiContext==="function"){
    const context=getCurrentSmaregiContext();
    if(context?.storeCode)return context.storeCode;
  }
  if(window.currentStore)return window.currentStore;
  return "tokyo";
}

function normalizeInventoryStoreCode(value){
  const text=String(value||"").trim().toLowerCase();
  if(text==="東京"||text==="東京店"||text==="tokyo")return "tokyo";
  if(text==="愛知"||text==="愛知店"||text==="aichi")return "aichi";
  if(text==="長野"||text==="長野店"||text==="nagano")return "nagano";
  return text;
}

async function getEventStorageStockRow(storeCode,barcode){
  const normalizedStore=normalizeInventoryStoreCode(storeCode);
  const normalizedBarcode=String(barcode||"").trim();
  if(!normalizedStore||!normalizedBarcode)return null;
  // Prefer the explicit store-common balance. Query by barcode and normalize
  // legacy store labels such as "東京店" to the canonical code.
  const rows=await sb(`event_storage_stocks?select=id,store_code,barcode,product_name,storage_qty&barcode=eq.${encodeURIComponent(normalizedBarcode)}&limit=100`);
  const commonRow=Array.isArray(rows)
    ? (rows.find(row=>normalizeInventoryStoreCode(row?.store_code)===normalizedStore)||null)
    : null;
  if(commonRow)return commonRow;

  // Keep inventory registration aligned with 在庫一覧確認. That screen uses
  // the shared loader, which reconstructs the current common shelf from the
  // latest event-item row when older data has not yet been materialized in
  // event_storage_stocks. No event_id is used as the balance key here.
  if(typeof loadBoothCurrentEventStorageRows==="function"){
    const fallbackRows=await loadBoothCurrentEventStorageRows(normalizedStore);
    const fallback=Array.isArray(fallbackRows)
      ? fallbackRows.find(row=>String(row?.barcode||"").trim()===normalizedBarcode)
      : null;
    if(fallback){
      return {
        id:"",
        store_code:normalizedStore,
        barcode:normalizedBarcode,
        product_name:fallback.product_name||"",
        storage_qty:Math.max(0,Number(fallback.quantity||0)),
        updated_at:fallback.updated_at||"",
        source:fallback.source||"booth_event_items"
      };
    }
  }
  return null;
}

async function getEventStorageStockForDisplay(barcode){
  try{
    const row=await getEventStorageStockRow(getInventoryCurrentStoreCode(),barcode);
    return {ok:true,quantity:Math.max(0,Number(row?.storage_qty||0))};
  }catch(error){
    console.warn("[inventory event shelf lookup failed]",error);
    return {ok:false,error};
  }
}

async function applyEventStoragePick(event,product,qty,staff,memo){
  const storeCode=getInventoryCurrentStoreCode();
  const stockRow=await getEventStorageStockRow(storeCode,product.barcode);
  if(!stockRow){
    throw new Error("イベント棚在庫を取得できませんでした。店舗またはバーコードを確認してください。");
  }
  const currentStorage=Number(stockRow.storage_qty||0);
  if(currentStorage<qty){
    throw new Error(`イベント保管在庫が不足しています。現在のイベント保管在庫：${currentStorage}`);
  }
  const nextStorage=currentStorage-qty;
  const stockPayload={
    product_name:product.name||stockRow.product_name||"",
    storage_qty:nextStorage,
    updated_at:new Date().toISOString()
  };
  if(stockRow.id){
    await sb(`event_storage_stocks?id=eq.${encodeURIComponent(stockRow.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify(stockPayload)
    });
  }else{
    // Materialize the same balance in the canonical common-shelf table when
    // the shared loader had to reconstruct it from legacy event data.
    await sb("event_storage_stocks",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([{
        store_code:storeCode,
        barcode:product.barcode,
        product_name:stockPayload.product_name,
        storage_qty:nextStorage,
        updated_at:stockPayload.updated_at
      }])
    });
  }
  const movementPayload={
    event_id:event?.id||null,
    store_code:storeCode,
    smaregi_product_id:product.smaregi_product_id||null,
    barcode:product.barcode,
    product_name:product.name||"",
    movement_type:"storage_out",
    quantity:qty,
    staff,
    memo,
    before_qty:currentStorage,
    after_qty:nextStorage
  };
  if(event?.id){
    await sb("event_storage_movements",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify([movementPayload])
    });
  }else{
    try{
      await sb("event_storage_movements",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify([movementPayload])
      });
    }catch(e){
      console.warn("[event storage movement skipped]",e);
    }
  }
  return {storeCode,currentStorage,nextStorage};
}

async function rollbackEventStoragePick(storeCode,product,qty){
  if(!storeCode)return;
  const stockRow=await getEventStorageStockRow(storeCode,product.barcode);
  if(!stockRow)return;
  await sb(`event_storage_stocks?id=eq.${encodeURIComponent(stockRow.id)}`,{
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({
      storage_qty:Number(stockRow.storage_qty||0)+qty,
      updated_at:new Date().toISOString()
    })
  });
}

async function upsertEventPickEventItem(event,product,qty,source="normal"){
  const eventId=encodeURIComponent(event.id);
  const barcode=encodeURIComponent(product.barcode);
  const rows=await sb(`booth_event_items?select=id,taken_qty,normal_takeout_qty,storage_takeout_qty&event_id=eq.${eventId}&barcode=eq.${barcode}&item_type=eq.normal&limit=1`);
  const now=new Date().toISOString();
  if(Array.isArray(rows)&&rows[0]){
    const currentTaken=Number(rows[0].taken_qty||0);
    const currentNormal=Number(rows[0].normal_takeout_qty||0);
    const currentStorage=Number(rows[0].storage_takeout_qty||0);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(rows[0].id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        product_name:product.name||"",
        taken_qty:currentTaken+qty,
        normal_takeout_qty:source==="storage" ? currentNormal : currentNormal+qty,
        storage_takeout_qty:source==="storage" ? currentStorage+qty : currentStorage,
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
      normal_takeout_qty:source==="storage" ? 0 : qty,
      storage_takeout_qty:source==="storage" ? qty : 0,
      updated_at:now
    }])
  });
}

async function insertEventPickMovement(event,product,qty,staff,memo,source="normal"){
  await sb("booth_stock_movements",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"normal",
      movement_type:"event_pick",
      quantity:qty,
      staff,
      memo,
      takeout_source:source,
      affects_smaregi:false,
      smaregi_delta:0
    }])
  });
}

async function registerEventPickFromInventory({event,product,barcode,qty,staff,memo,currentStock,newStock,source="normal"}){
  let productUpdated=false;
  let insertedLogId="";
  let insertedLog=null;
  let storagePickResult=null;
  try{
    if(source==="storage"){
      storagePickResult=await applyEventStoragePick(event,product,qty,staff,memo);
    }else{
      await updateProductCurrentStock(barcode,newStock);
      productUpdated=true;

      insertedLog=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"event_pick",
          staff,
          barcode,
          product_name:product.name,
          quantity:qty,
          memo,
          event_id:event.id,
          store_code:(typeof getCurrentSmaregiContext==="function"?getCurrentSmaregiContext()?.storeCode:window.currentStore)||"tokyo",
          inventory_scope:"normal",
          before_stock:currentStock,
          after_stock:newStock,
          affects_smaregi:false,
          smaregi_delta:0
        })
      });
      insertedLogId=Array.isArray(insertedLog)&&insertedLog[0]?String(insertedLog[0].id||""):"";
    }

    await insertEventPickMovement(event,product,qty,staff,memo,source);
    await upsertEventPickEventItem(event,product,qty,source);

    if(source!=="storage"){
      logs.unshift({
        id:insertedLogId,
        created_at:Array.isArray(insertedLog)&&insertedLog[0]?insertedLog[0].created_at:new Date().toISOString(),
        type:"event_pick",
        staff,
        barcode,
        product_name:product.name,
        quantity:qty,
        memo,
        event_id:event.id,
        affects_smaregi:false,
        smaregi_delta:0
      });
    }

    const sourceLabel=getEventPickSourceLabel(source);
    const stockLine=source==="storage" ? `イベント保管在庫：${storagePickResult?.nextStorage ?? "-"}`
      : `通常棚在庫：${newStock}`;
    showMessage(`イベントピック登録：${product.name} / イベント：${event.name||"-"} / 持ち出し元：${sourceLabel} / 数量 ${qty}`,"ok");
    showPopup("イベントピック登録完了",`イベント名：${event.name||"-"}\n商品名：${product.name}\n棚番：${getProductShelfLabel(product)}\nバーコード：${product.barcode||""}\n持ち出し元：${sourceLabel}\n数量：${qty}\n${stockLine}\n担当者：${staff}\nスマレジ在庫：変更しません`);

    el("barcodeInput").value="";
    el("qty").value="";
    await renderScanPreview();
    await showProductHistoryForBarcode(barcode);
    el("barcodeInput").focus();
  }catch(e){
    if(productUpdated){
      try{await updateProductCurrentStock(barcode,currentStock);}catch(_){}
    }
    if(storagePickResult){
      try{await rollbackEventStoragePick(storagePickResult.storeCode,product,qty);}catch(_){}
    }
    if(insertedLogId){
      try{
        await sb(`inventory_logs?id=eq.${encodeURIComponent(insertedLogId)}`,{
          method:"DELETE",
          headers:{Prefer:"return=minimal"}
        });
      }catch(_){}
    }
    throw e;
  }
}

async function findInventoryEventItem(eventId,barcode,itemType="normal"){
  const rows=await sb(`booth_event_items?select=*&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.${encodeURIComponent(itemType)}&limit=1`);
  return Array.isArray(rows)&&rows[0] ? rows[0] : null;
}

function getEventShelfCurrentQty(item){
  if(!item)return 0;
  const taken=Number(item.taken_qty||0);
  const sold=Number(item.sold_qty||0);
  const returned=Number(item.returned_qty||0);
  const consumed=Number(item.consumed_qty||0);
  return Math.max(0,taken-sold-returned-consumed);
}

function getGachaCurrentQty(item){
  if(!item)return 0;
  return Math.max(0,Number(item.taken_qty||0)-Number(item.returned_qty||0));
}

async function getInventoryGachaMovementCurrentQty(eventId,barcode,fallbackItem=null){
  try{
    const rows=await sb(`booth_stock_movements?select=movement_type,quantity&event_id=eq.${encodeURIComponent(eventId)}&barcode=eq.${encodeURIComponent(barcode)}&item_type=eq.gacha_prize&movement_type=in.(gacha_pick,gacha_return)&limit=1000`);
    if(Array.isArray(rows)&&rows.length){
      const picked=rows.filter(row=>String(row.movement_type)==="gacha_pick").reduce((sum,row)=>sum+Number(row.quantity||0),0);
      const returned=rows.filter(row=>String(row.movement_type)==="gacha_return").reduce((sum,row)=>sum+Number(row.quantity||0),0);
      return Math.max(0,picked-returned);
    }
  }catch(_){}
  return getGachaCurrentQty(fallbackItem);
}

async function patchInventoryEventItem(item,payload){
  await sb(`booth_event_items?id=eq.${encodeURIComponent(item.id)}`,{
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({...payload,updated_at:new Date().toISOString()})
  });
}

async function moveEventShelfQtyToGacha(event,product,qty){
  return false;
  const item=await findInventoryEventItem(event.id,product.barcode,"normal");
  const current=getEventShelfCurrentQty(item);
  if(!item||current<qty)return false;
  const normal=Math.max(0,Number(item.normal_takeout_qty||0));
  const storage=Math.max(0,Number(item.storage_takeout_qty||0));
  const useNormal=Math.min(normal,qty);
  const useStorage=Math.min(storage,qty-useNormal);
  await patchInventoryEventItem(item,{
    taken_qty:Math.max(0,Number(item.taken_qty||0)-qty),
    normal_takeout_qty:normal-useNormal,
    storage_takeout_qty:storage-useStorage
  });
  return true;
}

async function addQtyToEventShelf(event,product,qty){
  const item=await findInventoryEventItem(event.id,product.barcode,"normal");
  if(item){
    await patchInventoryEventItem(item,{
      product_name:product.name||item.product_name||"",
      taken_qty:Number(item.taken_qty||0)+qty,
      normal_takeout_qty:Number(item.normal_takeout_qty||0)+qty
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
      normal_takeout_qty:qty,
      storage_takeout_qty:0,
      sold_qty:0,
      returned_qty:0,
      consumed_qty:0,
      difference_qty:0,
      updated_at:new Date().toISOString()
    }])
  });
}

async function upsertInventoryGachaEventItem(event,product,qty,action){
  if(action==="return")return;
  const item=await findInventoryEventItem(event.id,product.barcode,"gacha_prize");
  if(item){
    const taken=Number(item.taken_qty||0);
    const returned=Number(item.returned_qty||0);
    const nextTaken=action==="pick" ? taken+qty : taken;
    const nextReturned=action==="return" ? returned+qty : returned;
    await patchInventoryEventItem(item,{
      product_name:product.name||item.product_name||"",
      taken_qty:nextTaken,
      returned_qty:nextReturned,
      consumed_qty:Math.max(0,nextTaken-nextReturned),
      difference_qty:0
    });
    return;
  }
  const taken=action==="pick" ? qty : 0;
  const returned=action==="return" ? qty : 0;
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
      updated_at:new Date().toISOString()
    }])
  });
}

async function rollbackInventoryGachaEventItem(event,product,qty,action){
  const item=await findInventoryEventItem(event.id,product.barcode,"gacha_prize");
  if(!item)return;
  const taken=Number(item.taken_qty||0);
  const returned=Number(item.returned_qty||0);
  const nextTaken=action==="pick" ? Math.max(0,taken-qty) : taken;
  const nextReturned=action==="return" ? Math.max(0,returned-qty) : returned;
  await patchInventoryEventItem(item,{
    taken_qty:nextTaken,
    returned_qty:nextReturned,
    consumed_qty:Math.max(0,nextTaken-nextReturned)
  });
}

async function insertInventoryGachaMovement(event,product,qty,staff,memo,movementType,delta,source){
  await sb("booth_stock_movements",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify([{
      event_id:event.id,
      barcode:product.barcode,
      product_name:product.name||"",
      item_type:"gacha_prize",
      movement_type:movementType,
      quantity:qty,
      staff,
      memo,
      takeout_source:source||"",
      affects_smaregi:true,
      smaregi_delta:delta
    }])
  });
}

async function registerGachaFromInventory({action,event,product,barcode,qty,staff,memo,currentStock}){
  throw new Error("ガチャ数量は在庫変動登録から変更できません。イベント管理の戻りカウントだけで登録してください。");
  /* Legacy path intentionally disabled: gacha stock is not a normal inventory movement. */
  if(window.__aricoInventoryGachaSaving){
    showMessage("ガチャ登録処理中です。完了までお待ちください。","err");
    return;
  }
  window.__aricoInventoryGachaSaving=true;
  const isPick=action==="pick";
  const movementType=isPick?"gacha_pick":"gacha_return";
  const delta=isPick?-qty:qty;
  let source="";
  let productUpdated=false;
  let sourceMoved=false;
  let gachaUpdated=false;
  let previousStock=currentStock;
  let insertedLog=null;
  let insertedLogId="";
  try{
    if(isPick){
      const movedFromEventShelf=await moveEventShelfQtyToGacha(event,product,qty);
      source=movedFromEventShelf?"event_shelf":"normal";
      sourceMoved=true;
      if(!movedFromEventShelf){
        const nextStock=currentStock-qty;
        if(nextStock<0)throw new Error(`在庫不足：${product.name||barcode} / 現在庫 ${currentStock} / ガチャ ${qty}`);
        await updateProductCurrentStock(barcode,nextStock);
        productUpdated=true;
      }
    }else{
      const gachaItem=await findInventoryEventItem(event.id,barcode,"gacha_prize");
      const currentGacha=await getInventoryGachaMovementCurrentQty(event.id,barcode,gachaItem);
      if(currentGacha<qty)throw new Error(`ガチャ在庫不足：${product.name||barcode} / 現在ガチャ在庫 ${currentGacha} / 戻し ${qty}`);
      const nextStock=currentStock+qty;
      await updateProductCurrentStock(barcode,nextStock);
      productUpdated=true;
      source="normal";
    }

    insertedLog=await sb("inventory_logs",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({
        type:movementType,
        staff,
        barcode,
        product_name:product.name,
        quantity:qty,
        memo,
        event_id:event.id,
        affects_smaregi:true,
        smaregi_delta:delta,
        equipment_checked:false
      })
    });
    insertedLogId=Array.isArray(insertedLog)&&insertedLog[0]?String(insertedLog[0].id||""):"";

    await upsertInventoryGachaEventItem(event,product,qty,action);
    gachaUpdated=true;
    await insertInventoryGachaMovement(event,product,qty,staff,memo,movementType,delta,source);

    const logRow=Array.isArray(insertedLog)&&insertedLog[0]?insertedLog[0]:null;
    logs.unshift({
      id:insertedLogId,
      created_at:logRow?.created_at||new Date().toISOString(),
      type:movementType,
      staff,
      barcode,
      product_name:product.name,
      quantity:qty,
      memo,
      event_id:event.id,
      affects_smaregi:true,
      smaregi_delta:delta,
      equipment_checked:false
    });

    const label=isPick?"ガチャ":"ガチャ戻し";
    showMessage(`${label}登録：${product.name||barcode} / イベント：${event.name||"-"} / 数量 ${qty}`,"ok");
    showPopup(`${label}登録完了`,`${label}\n${buildProductIdentityText(product)}\nイベント：${event.name||"-"}\n数量：${qty}\n担当者：${staff}\nスマレジ在庫：手動確認対象`);

    el("barcodeInput").value="";
    el("qty").value="";
    await renderScanPreview();
    await showProductHistoryForBarcode(barcode);
    el("barcodeInput").focus();
  }catch(e){
    if(productUpdated){
      try{await updateProductCurrentStock(barcode,previousStock);}catch(_){}
    }
    if(gachaUpdated){
      try{await rollbackInventoryGachaEventItem(event,product,qty,action);}catch(_){}
    }
    if(sourceMoved&&source==="event_shelf"){
      try{
        if(isPick)await addQtyToEventShelf(event,product,qty);
        else await moveEventShelfQtyToGacha(event,product,qty);
      }catch(_){}
    }
    if(insertedLogId){
      try{
        await sb(`inventory_logs?id=eq.${encodeURIComponent(insertedLogId)}`,{
          method:"DELETE",
          headers:{Prefer:"return=minimal"}
        });
      }catch(_){}
    }
    throw e;
  }finally{
    window.__aricoInventoryGachaSaving=false;
  }
}

async function registerBarcode(barcode){
  let directStorageOutResult=null;
  let directStorageOutProduct=null;
  let directStorageOutQty=0;
  try{
    updateEquipmentMemoUi();
    barcode=String(barcode||"").trim();
    const type=el("type").value;
    const staff=el("staff").value.trim();
    const qtyRaw=el("qty").value.trim();
    const qty=Number(qtyRaw);
    const memo=el("memo").value.trim();
    const isEventPick=type==="event_pick";
    const isGacha=type==="gacha";
    const isGachaReturn=type==="gacha_return";
    if(isGacha||isGachaReturn){
      showMessage("ガチャ数量は在庫変動登録から変更できません。イベント管理の戻りカウントだけで登録してください。","err");
      return;
    }
    const requiresEvent=isEventPick||isGacha||isGachaReturn;
    const isStockOut=type==="\u51fa\u8377";
    const canChooseSource=isStockOut;
    const eventPickEventId=String(el("eventPickEventSelect")?.value||"").trim();
    const eventPickEvent=requiresEvent?findEventPickEvent(eventPickEventId):null;
    const eventPickSource=canChooseSource?getEventPickSource():"normal";

    if(requiresEvent){
      if(!eventPickEvent){
        showMessage("イベント名を選択してください","err");
        el("eventPickEventSelect")?.focus();
        return;
      }
      if(!staff){
        showMessage("担当者を選択してください","err");
        el("staff").focus();
        return;
      }
      if(!barcode){
        showMessage("バーコードを入力してください","err");
        el("barcodeInput")?.focus();
        return;
      }
      if(qtyRaw===""){
        showMessage("数量を入力してください","err");
        el("qty")?.focus();
        return;
      }
      if(!Number.isFinite(qty)||qty<=0){
        showMessage("数量は1以上で入力してください","err");
        el("qty")?.focus();
        return;
      }
    }else if(!barcode){
      return;
    }

    if(!staff){
      showMessage("担当者を選択してください。","err");
      el("staff").focus();
      return;
    }

    const requiresStaffStoreMatch=type==="備品転用"||type==="在庫修正"||requiresEvent||(type==="\u51fa\u8377"&&eventPickSource==="storage");
    if(requiresStaffStoreMatch&&typeof enforceStaffStoreMatch==="function"&&!enforceStaffStoreMatch(staff,"店舗確認エラー","staff")){
      return;
    }

    if(requiresEvent&&!eventPickEvent){
      showMessage("イベントピックするイベントを選択してください。","err");
      el("eventPickEventSelect")?.focus();
      return;
    }

    if(qtyRaw==="" || !Number.isFinite(qty) || (type==="在庫修正" ? qty < 0 : qty <= 0)){
      showMessage(type==="在庫修正" ? "在庫修正は0以上の数字を入力してください。" : "数量を入力してください。","err");
      el("qty").focus();
      return;
    }

    if(type==="備品転用"&&!memo){
      showMessage("商品転用は備考入力が必須です","err");
      el("memo").focus();
      return;
    }

    let p=await fetchProductByBarcode(barcode);

    if(!p){
      showMessage(`未登録バーコード：${barcode}。PCで商品登録してください。`,"err");
      return;
    }

    let sourceStockState=null;
    try{
      sourceStockState=await getInventorySourceStock(p,eventPickSource);
      applyInventorySourceStockState(sourceStockState);
      p=sourceStockState.product||p;
    }catch(stockError){
      applyInventorySourceStockError(eventPickSource);
      showMessage(`${getEventPickSourceLabel(eventPickSource)}の在庫を取得できませんでした。登録を中止しました。`,"err");
      return;
    }

    const currentStock=eventPickSource==="storage"
      ? Number(sourceStockState.quantity||0)
      : Number(p.base_stock||0);
    let newStock=currentStock;

    if(type==="入荷")newStock=currentStock+qty;
    if(type==="出荷")newStock=eventPickSource==="storage" ? currentStock : currentStock-qty;
    if(type==="備品転用")newStock=currentStock;
    if(type==="在庫修正")newStock=qty;
    if(isEventPick&&eventPickSource!=="storage")newStock=currentStock-qty;
    const isEquipmentTransferType=String(type||"")==="\u5099\u54c1\u8ee2\u7528" || String(type||"").includes("\u86ef\u541d\u5200");
    if(isEquipmentTransferType)newStock=currentStock-qty;

    if(((type==="出荷"&&eventPickSource!=="storage")||(isEventPick&&eventPickSource!=="storage"))&&newStock<0){
      showMessage(`在庫不足：${p.name} / 現在庫 ${currentStock} / ${type}数 ${qty}`,"err");
      return;
    }

    if(isEventPick){
      await registerEventPickFromInventory({
        event:eventPickEvent,
        product:p,
        barcode,
        qty,
        staff,
        memo,
        currentStock,
        newStock,
        source:eventPickSource
      });
      return;
    }

    if(isGacha||isGachaReturn){
      await registerGachaFromInventory({
        action:isGacha?"pick":"return",
        event:eventPickEvent,
        product:p,
        barcode,
        qty,
        staff,
        memo,
        currentStock
      });
      return;
    }

    if(type==="出荷"&&eventPickSource==="storage"){
      directStorageOutResult=await applyEventStoragePick(null,p,qty,staff,memo);
      directStorageOutProduct=p;
      directStorageOutQty=qty;
    }

    const inventoryMemo=(type==="出荷"&&eventPickSource==="storage")
      ? [memo,`持ち出し元：${getEventPickSourceLabel(eventPickSource)}`].filter(Boolean).join(" / ")
      : memo;

    const logQuantity=isEquipmentTransferType ? -Math.abs(qty) : qty;

    const insertedLog=await sb("inventory_logs",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({
        type,
        staff,
        barcode,
        product_name:p.name,
        quantity:logQuantity,
        memo:inventoryMemo,
        store_code:(typeof getCurrentSmaregiContext==="function"?getCurrentSmaregiContext()?.storeCode:window.currentStore)||"tokyo",
        inventory_scope:(type==="出荷"&&eventPickSource==="storage")?"event_shelf":"normal",
        before_stock:currentStock,
        after_stock:newStock,
        event_shelf_before:directStorageOutResult?.currentStorage??null,
        event_shelf_after:directStorageOutResult?.nextStorage??null
      })
    });

    if(!(type==="出荷"&&eventPickSource==="storage")){
      await updateProductCurrentStock(barcode,newStock);
    }

    logs.unshift({
      id:(typeof insertedLog!=="undefined" && Array.isArray(insertedLog) && insertedLog[0]) ? insertedLog[0].id : "",
      created_at:(typeof insertedLog!=="undefined" && Array.isArray(insertedLog) && insertedLog[0]) ? insertedLog[0].created_at : new Date().toISOString(),
      type,
      staff,
      barcode,
      product_name:p.name,
      quantity:logQuantity,
      memo:inventoryMemo
    });

    const visibleEventPickSourceLine=canChooseSource
      ? `\n持ち出し元：${getEventPickSourceLabel(getEventPickSource())}`
      : "";
    const stockDisplayLine=(type==="出荷"&&eventPickSource==="storage")
      ? `\nイベント保管在庫：${directStorageOutResult?.nextStorage ?? "-"}\n通常棚在庫：${newStock}`
      : `\n現在庫：${newStock}`;

    showMessage(type==="在庫修正"
      ?`在庫修正：${p.name} / 現在庫を ${qty} に上書き / 担当者：${staff}`
      :`${type}登録：${p.name} / 担当者：${staff} / 数量 ${qty} / 現在庫 ${newStock}`
    ,"ok");

    showPopup("登録完了",
      type==="在庫修正"
        ? `在庫修正\n${buildProductIdentityText(p)}\n現在庫：${newStock}\n担当者：${staff}`
        : `${type}登録\n${buildProductIdentityText(p)}${visibleEventPickSourceLine}\n数量：${qty}${stockDisplayLine}\n担当者：${staff}`
    );

    el("barcodeInput").value="";
    el("qty").value="";
    await renderScanPreview();
    await showProductHistoryForBarcode(barcode);
    el("barcodeInput").focus();
  }catch(e){
    if(directStorageOutResult&&directStorageOutProduct&&directStorageOutQty){
      try{await rollbackEventStoragePick(directStorageOutResult.storeCode,directStorageOutProduct,directStorageOutQty);}catch(_){}
    }
    showMessage("登録エラー。\n"+e.message,"err");
  }
}

async function editLogMemo(logId,currentMemo){
  try{
    if(!logId){
      showMessage("この履歴は再読み込み後に備考修正できます。","err");
      return;
    }

    const next=prompt("備考を修正してください", currentMemo||"");
    if(next===null)return;

    await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({memo:next})
    });

    (logs||[]).forEach(l=>{
      if(String(l.id)===String(logId))l.memo=next;
    });

    showMessage("備考を修正しました。","ok");

    if(selectedBarcode){
      await showProductHistoryForBarcode(selectedBarcode);
    }else{
      renderGlobalHistory();
    }
  }catch(e){
    showMessage("備考修正エラー。\\n"+e.message,"err");
  }
}

function memoCellHtml(log){
  const id=log.id||"";
  const memo=log.memo||"";
  const displayMemo=String(memo).replace(/備品転用/g,"商品転用");
  return `<div class="memo-cell">
    <span class="memo-text">${esc(displayMemo)}</span>
    <button type="button" class="memo-edit-btn" data-log-id="${esc(id)}" data-memo="${esc(memo)}">修正</button>
  </div>`;
}

function bindMemoEditButtons(){
  document.querySelectorAll(".memo-edit-btn").forEach(btn=>{
    btn.onclick=()=>{
      editLogMemo(btn.dataset.logId,btn.dataset.memo||"");
    };
  });
}

function isEquipmentTransferChecked(log){
  return log?.equipment_checked===true
    || String(log?.equipment_checked||"").toLowerCase()==="true"
    || Boolean(log?.equipment_checked_at);
}

function isManualSmaregiConfirmationType(log){
  const type=String(log?.type||"");
  return type==="備品転用"||type==="equipment_transfer"||type==="gacha_pick"||type==="gacha_return";
}

function isGachaInventoryLog(log){
  const type=String(log?.type||"");
  return type==="gacha_pick"||type==="gacha_return";
}

function equipmentCheckHtml(log){
  if(!isManualSmaregiConfirmationType(log))return "";
  const rawLogId=String(log.id||"");
  if(rawLogId)equipmentTransferLogCache.set(rawLogId,log);
  const logId=esc(rawLogId);
  if(isEquipmentTransferChecked(log)){
    return `<div class="equipment-check-cell" data-log-id="${logId}"><span class="equipment-check-status is-checked">確認済</span><small>${esc(log.equipment_checked_by||"")} / ${fmt(log.equipment_checked_at)}</small></div>`;
  }
  const hasAccess=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
  if(!hasAccess){
    return `<div class="equipment-check-cell" data-log-id="${logId}"><span class="equipment-check-status is-unchecked">未確認</span><button type="button" class="equipment-confirm-btn" data-log-id="${logId}" disabled title="管理者認証後に操作できます">管理者認証が必要</button></div>`;
  }
  return `<div class="equipment-check-cell" data-log-id="${logId}"><span class="equipment-check-status is-unchecked">未確認</span><button type="button" class="equipment-confirm-btn" data-log-id="${logId}">確認</button></div>`;
}

function showManualSmaregiConfirmPopup({log,quantity,checkedBy,onOk}){
  const typeLabel=String(log.type)==="gacha_return" ? "ガチャ戻し" : "ガチャ";
  const popup=document.createElement("div");
  popup.className="app-popup app-confirm-popup";
  popup.style.display="flex";
  popup.innerHTML=`<div class="app-popup-card">
    <div class="app-popup-title">${esc(typeLabel)}確認</div>
    <div class="app-popup-body">${esc(typeLabel)}のスマレジ手動調整を確認済みにします。

商品名：${esc(log.product_name||"-")}
棚番：${esc(getProductShelfLabel({location:log.location||""}))}
バーコード：${esc(log.barcode||"-")}
数量：${esc(quantity)}
担当者：${esc(log.staff||"-")}
確認者：${esc(checkedBy)}

よろしいですか？</div>
    <div class="app-confirm-actions">
      <button type="button" class="secondary app-manual-smaregi-cancel-btn">キャンセル</button>
      <button type="button" class="app-manual-smaregi-ok-btn">確認済みにする</button>
    </div>
  </div>`;
  const close=()=>{try{document.body.removeChild(popup);}catch(_){}};
  popup.querySelector(".app-manual-smaregi-cancel-btn")?.addEventListener("click",close);
  popup.querySelector(".app-manual-smaregi-ok-btn")?.addEventListener("click",()=>{
    close();
    onOk();
  });
  popup.addEventListener("click",event=>{
    if(event.target===popup)close();
  });
  document.body.appendChild(popup);
}

async function executeManualSmaregiConfirmation({log,checkedBy,button}){
  const logId=String(log.id||"").trim();
  await runWithSmaregiAutoRefreshPaused(async()=>{
    try{
      const latestRows=await sb(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`);
      const latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : null;
      if(!latestLog)throw new Error(`inventory_logs.id=${logId} が見つかりません`);
      if(!isGachaInventoryLog(latestLog))throw new Error("ガチャ履歴ではありません");
      if(isEquipmentTransferChecked(latestLog))throw new Error("すでに確認済みです");
      const equipment_checked_at=new Date().toISOString();
      const patchedRows=await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}&select=*`,{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          equipment_checked:true,
          equipment_checked_by:checkedBy,
          equipment_checked_at
        })
      });
      const refreshedLog=Array.isArray(patchedRows)&&patchedRows[0] ? patchedRows[0] : null;
      if(!refreshedLog)throw new Error(`inventory_logs.id=${logId} を更新できませんでした`);
      equipmentTransferLogCache.set(logId,refreshedLog);
      replaceEquipmentConfirmationDom(logId,refreshedLog);
      logs=(logs||[]).some(item=>String(item.id)===String(logId))
        ? logs.map(item=>String(item.id)===String(logId) ? refreshedLog : item)
        : [refreshedLog,...logs];
      showMessage("スマレジ手動調整を確認済みにしました","ok");
      renderGlobalHistory();
      if(selectedBarcode)await showProductHistoryForBarcode(selectedBarcode,refreshedLog);
      if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
    }catch(e){
      showMessage("スマレジ手動確認エラー\n"+e.message,"err");
    }
  },{button});
}

function replaceEquipmentConfirmationDom(logId,log){
  const checkedHtml=`<span class="equipment-check-status is-checked">確認済</span><small>${esc(log.equipment_checked_by||"")} / ${fmt(log.equipment_checked_at)}</small>`;
  document.querySelectorAll(".equipment-check-cell").forEach(cell=>{
    if(String(cell.dataset.logId||"")===String(logId))cell.innerHTML=checkedHtml;
  });
  document.querySelectorAll(".equipment-confirm-btn").forEach(button=>{
    if(String(button.dataset.logId||"")!==String(logId))return;
    const cell=button.closest("td");
    if(cell)cell.innerHTML=`<div class="equipment-check-cell" data-log-id="${esc(logId)}">${checkedHtml}</div>`;
  });
}

function getEquipmentConfirmationStaff(){
  return String(
    el("staff")?.value||
    el("smaregiCheckerName")?.value||
    localStorage.getItem("arico_smaregi_checker")||
    ""
  ).trim();
}

function getEquipmentTransferSmaregiContext(){
  if(typeof getCurrentSmaregiContext==="function")return getCurrentSmaregiContext();
  return {accountKey:"production",accountName:"スマレジ本番接続",storeCode:"tokyo",storeName:"東京"};
}

async function adjustEquipmentTransferSmaregiStock(product,quantity,memo){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
  const context=getEquipmentTransferSmaregiContext();
  const res=await fetch("about:blank",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      storeCode:context.storeCode,
      currentStore:context.storeCode,
      smaregiProductId:product.smaregi_product_id,
      productId:product.smaregi_product_id,
      delta:-Math.abs(Number(quantity||0)),
      memo: memo||`ARICO備品転用 ${product.name||""}`.slice(0,100)
    })
  });
  const body=await res.json().catch(()=>({}));
  if(!res.ok||body?.error){
    throw new Error(body?.error||`スマレジ在庫更新API ${res.status}`);
  }
  return body;
}

async function reverseEquipmentTransferSmaregiStock(product,quantity,memo){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
  try{
    const context=getEquipmentTransferSmaregiContext();
    await fetch("about:blank",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        storeCode:context.storeCode,
        currentStore:context.storeCode,
        smaregiProductId:product.smaregi_product_id,
        productId:product.smaregi_product_id,
        delta:Math.abs(Number(quantity||0)),
        memo: memo||`ARICO備品転用ロールバック ${product.name||""}`.slice(0,100)
      })
    });
  }catch(_){}
}

function showEquipmentTransferConfirmPopup({log,product,quantity,checkedBy,onOk}){
  const context=getEquipmentTransferSmaregiContext();
  const popup=document.createElement("div");
  popup.className="app-popup app-confirm-popup";
  popup.style.display="flex";
  popup.innerHTML=`<div class="app-popup-card">
    <div class="app-popup-title">商品転用確認</div>
    <div class="app-popup-body">この商品を商品転用として処理します。
スマレジ在庫が減算されます。

商品名：${esc(product.name||log.product_name||"-")}
棚番：${esc(getProductShelfLabel(product))}
バーコード：${esc(log.barcode||product.barcode||"-")}
数量：${esc(quantity)}
担当者：${esc(checkedBy)}
店舗：${esc(context.storeName||"-")}
接続先：${esc(context.accountName||"-")}

よろしいですか？</div>
    <div class="app-confirm-actions">
      <button type="button" class="secondary app-equipment-transfer-cancel-btn">キャンセル</button>
      <button type="button" class="app-equipment-transfer-ok-btn">実行</button>
    </div>
  </div>`;
  const close=()=>{try{document.body.removeChild(popup);}catch(_){}};
  popup.querySelector(".app-equipment-transfer-cancel-btn")?.addEventListener("click",close);
  popup.querySelector(".app-equipment-transfer-ok-btn")?.addEventListener("click",()=>{
    close();
    onOk();
  });
  popup.addEventListener("click",event=>{
    if(event.target===popup)close();
  });
  document.body.appendChild(popup);
}

async function executeEquipmentTransferConfirmation({log,product=null,quantity,checkedBy,button}){
  const logId=String(log.id||"").trim();
  let smaregiAdjusted=false;
  let productUpdated=false;
  let currentStock=null;

  await runWithSmaregiAutoRefreshPaused(async()=>{
    try{
      const latestRows=await sb(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`);
      const latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : null;
      if(!latestLog)throw new Error(`商品転用履歴が見つかりません。inventory_logs.id=${logId}`);
      if(isEquipmentTransferChecked(latestLog))throw new Error("この商品転用は確認済みです。");
      if(latestLog.type!=="備品転用")throw new Error("商品転用の履歴ではありません。");

      quantity=Number(latestLog.quantity||quantity||0);
      if(!Number.isInteger(quantity)||quantity<=0)throw new Error("数量は1以上で入力してください。");

      product=product&&product.smaregi_product_id ? product : await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      if(!product.smaregi_product_id)throw new Error("スマレジ商品IDが未登録です。商品マスターを再取り込みしてください。");

      currentStock=Number(product.base_stock||0);
      const nextStock=currentStock-quantity;
      if(nextStock<0)throw new Error(`在庫不足：${product.name} / 現在庫 ${currentStock} / 商品転用数 ${quantity}`);

      await adjustEquipmentTransferSmaregiStock(product,quantity,`ARICO備品転用 ${log.product_name||product.name||""}`);
      smaregiAdjusted=true;

      await updateProductCurrentStock(latestLog.barcode,nextStock);
      productUpdated=true;

      const equipment_checked_at=new Date().toISOString();
      const patchPayload={
        type:"equipment_transfer",
        equipment_checked:true,
        equipment_checked_by:checkedBy,
        equipment_checked_at,
        affects_smaregi:true,
        smaregi_delta:-quantity
      };
      const patchedRows=await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}&select=*`,{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify(patchPayload)
      });
      const refreshedLog=Array.isArray(patchedRows)&&patchedRows[0] ? patchedRows[0] : null;
      if(!refreshedLog)throw new Error(`商品転用履歴を更新できませんでした。inventory_logs.id=${logId}`);

      const displayLog={...refreshedLog,type:"備品転用"};
      equipmentTransferLogCache.set(logId,displayLog);
      replaceEquipmentConfirmationDom(logId,displayLog);
      logs=(logs||[]).some(item=>String(item.id)===String(logId))
        ? logs.map(item=>String(item.id)===String(logId) ? displayLog : item)
        : [displayLog,...logs];

      showMessage(`商品転用を確定しました：${product.name} / 数量 ${quantity}`,"ok");
      showPopup("商品転用完了",`商品名：${product.name}\n棚番：${getProductShelfLabel(product)}\nバーコード：${latestLog.barcode}\n数量：${quantity}\n現在庫：${nextStock}\nスマレジ在庫：減算済み`);
      renderGlobalHistory();
      if(selectedBarcode)await showProductHistoryForBarcode(selectedBarcode,displayLog);
      replaceEquipmentConfirmationDom(logId,displayLog);
      if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
    }catch(e){
      if(productUpdated){
        try{await updateProductCurrentStock(log.barcode,currentStock);}catch(_){}
      }
      if(smaregiAdjusted){
        await reverseEquipmentTransferSmaregiStock(product,quantity,`ARICO備品転用ロールバック ${log.product_name||product.name||""}`);
      }
      showMessage("商品転用確認エラー。\n"+e.message,"err");
    }
  },{button});
}

async function confirmEquipmentTransfer(logId,button=null){
  logId=String(logId||"").trim();
  console.log("[Equipment Transfer Confirm Click]",{logId});
  if(typeof requireInventoryPrivilegedAccess==="function"&&!requireInventoryPrivilegedAccess())return;
  const checkedBy=getEquipmentConfirmationStaff();
  if(!checkedBy){
    showMessage("確認する担当者を選択してください。","err");
    el("staffPicker")?.querySelector(".staff-picker-toggle")?.focus();
    return;
  }
  if(typeof enforceStaffStoreMatch==="function"&&!enforceStaffStoreMatch(checkedBy,"店舗確認エラー","staff")){
    return;
  }
  if(!logId){
    showMessage("商品転用履歴IDが見つかりません。再読み込みしてください。","err");
    return;
  }
  try{
    const log=equipmentTransferLogCache.get(logId)||null;
    if(!log)throw new Error("画面上の商品転用履歴を取得できません。再読み込みしてください。");
    if(isEquipmentTransferChecked(log)){
      showMessage("この商品転用は確認済みです。","err");
      replaceEquipmentConfirmationDom(logId,log);
      return;
    }
    if(isGachaInventoryLog(log)){
      const quantity=Number(log.quantity||0);
      if(!Number.isInteger(quantity)||quantity<=0)throw new Error("数量は1以上で入力してください。");
      showManualSmaregiConfirmPopup({
        log,
        quantity,
        checkedBy,
        onOk:()=>executeManualSmaregiConfirmation({log,checkedBy,button})
      });
      return;
    }
    if(log.type!=="備品転用")throw new Error("商品転用の履歴ではありません。");

    const quantity=Number(log.quantity||0);
    if(!Number.isInteger(quantity)||quantity<=0)throw new Error("数量は1以上で入力してください。");

    showEquipmentTransferConfirmPopup({
      log,
      product:{name:log.product_name,barcode:log.barcode},
      quantity,
      checkedBy,
      onOk:()=>executeEquipmentTransferConfirmation({log,quantity,checkedBy,button})
    });
  }catch(e){
    showMessage("商品転用確認エラー。\n"+e.message,"err");
  }
}

function bindEquipmentConfirmButtons(){
  document.querySelectorAll(".equipment-confirm-btn").forEach(button=>{
    button.onclick=()=>{
      console.log("[Equipment Confirm Button]",{logId:button.dataset.logId||""});
      confirmEquipmentTransfer(button.dataset.logId,button);
    };
  });
}

async function handleScannedCode(code){
  code=String(code||"").trim();
  if(!code)return;

  const t=Date.now();
  if(code===lastScan&&t-lastScanAt<1800)return;

  lastScan=code;
  lastScanAt=t;

  el("barcodeInput").value=code;
  if(el("productHistoryBarcodeInput"))el("productHistoryBarcodeInput").value=code;
  if(el("productNameSearchInput"))el("productNameSearchInput").value="";
  if(el("productSearchResults"))el("productSearchResults").classList.remove("is-active");
  await syncHistoryFromScanBarcode();
  await stopCamera();
}


function loadScriptOnce(src){
  return new Promise((resolve,reject)=>{
    const existing=[...document.scripts].find(s=>s.src===src);
    if(existing){
      if(existing.dataset.loaded==="true")resolve();
      else existing.addEventListener("load",resolve,{once:true});
      return;
    }

    const s=document.createElement("script");
    s.src=src;
    s.async=true;
    s.dataset.dynamic="true";
    s.onload=()=>{
      s.dataset.loaded="true";
      resolve();
    };
    s.onerror=()=>reject(new Error("読取ライブラリの読み込みに失敗しました。通信環境を確認してください。"));
    document.head.appendChild(s);
  });
}

async function ensureZXing(){
  if(window.ZXing)return true;
  await loadScriptOnce("https://unpkg.com/@zxing/library@latest/umd/index.min.js");
  return !!window.ZXing;
}


async function tryImproveCameraTrack(videoEl){
  try{
    const stream=videoEl && videoEl.srcObject;
    const track=stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if(!track)return;

    const caps=track.getCapabilities ? track.getCapabilities() : {};
    const constraints={advanced:[]};

    if(caps.focusMode && caps.focusMode.includes("continuous")){
      constraints.advanced.push({focusMode:"continuous"});
    }

    if(caps.zoom){
      const z=Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1.5));
      constraints.advanced.push({zoom:z});
    }

    if(constraints.advanced.length){
      await track.applyConstraints(constraints);
    }
  }catch(_){}
}


let currentVideoTrack=null;

function getCameraZoomValue(){
  const range=el("cameraZoomRange");
  const v=range ? Number(range.value||1.5) : 1.5;
  return Number.isFinite(v) ? v : 1.5;
}

function updateCameraZoomLabel(){
  const label=el("cameraZoomValue");
  if(label)label.textContent=`${getCameraZoomValue().toFixed(1)}x`;
}

async function applyCameraZoom(){
  try{
    updateCameraZoomLabel();
    if(!currentVideoTrack || !currentVideoTrack.getCapabilities)return;
    const caps=currentVideoTrack.getCapabilities();
    if(!caps.zoom)return;
    const desired=getCameraZoomValue();
    const zoom=Math.min(caps.zoom.max,Math.max(caps.zoom.min,desired));
    await currentVideoTrack.applyConstraints({advanced:[{zoom}]});
  }catch(_){}
}

async function improveCameraTrack(videoEl){
  try{
    const stream=videoEl && videoEl.srcObject;
    const track=stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    if(!track)return;
    currentVideoTrack=track;
    const caps=track.getCapabilities ? track.getCapabilities() : {};
    const advanced=[];
    if(caps.focusMode && caps.focusMode.includes("continuous"))advanced.push({focusMode:"continuous"});
    if(caps.exposureMode && caps.exposureMode.includes("continuous"))advanced.push({exposureMode:"continuous"});
    if(caps.whiteBalanceMode && caps.whiteBalanceMode.includes("continuous"))advanced.push({whiteBalanceMode:"continuous"});
    if(caps.zoom){
      const desired=getCameraZoomValue();
      const zoom=Math.min(caps.zoom.max,Math.max(caps.zoom.min,desired));
      advanced.push({zoom});
    }
    if(advanced.length)await track.applyConstraints({advanced});
  }catch(_){}
}

async function startCamera(){
  try{
    showMessage("カメラを起動しています...");

    const v=el("video");
    const qr=el("qr-reader");

    if(qr)qr.style.display="none";
    if(v)v.style.display="block";
    showCameraGuide();

    await ensureZXing();
    if(window.ZXing){
      if(!zxingReader){
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
        zxingReader=new ZXing.BrowserMultiFormatReader(hints,50);
      }

      zxingRunning=true;

      await zxingReader.decodeFromConstraints(
        {video:{
          facingMode:{ideal:"environment"},
          width:{ideal:2560},
          height:{ideal:1440},
          focusMode:{ideal:"continuous"},
          exposureMode:{ideal:"continuous"}
        }},
        v,
        async(result)=>{
          if(result&&zxingRunning){
            await handleScannedCode(result.getText());
          }
        }
      );

      tryImproveCameraTrack(v);
      improveCameraTrack(v);
      showMessage("カメラ読取中です。赤枠いっぱいにバーコードを横向きで写してください。近すぎる場合は少し離してください。","ok");
      return;
    }

    if("BarcodeDetector"in window){
      detector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","code_39","qr_code"]});
      videoStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
      v.srcObject=videoStream;
      await v.play();
      scanning=true;
      showMessage("カメラ読取中です。バーコードを写してください。","ok");
      scanLoop();
      return;
    }

    showMessage("このブラウザはカメラバーコード読取に未対応です。手入力欄または外付けスキャナを使ってください。","err");
  }catch(e){
    zxingRunning=false;
    showMessage("カメラ起動エラー。\nカメラ許可を確認してください。\n"+e.message,"err");
  }
}

async function stopCamera(){
  scanning=false;
  zxingRunning=false;

  if(zxingReader){
    try{zxingReader.reset();}catch(_){}
  }

  if(videoStream){
    videoStream.getTracks().forEach(t=>t.stop());
    videoStream=null;
  }

  const v=el("video");
  const qr=el("qr-reader");

  if(v){
    try{v.pause();}catch(_){}
    v.srcObject=null;
    v.style.display="none";
  }

  if(qr)qr.style.display="none";

  hideCameraGuide();
  showMessage("カメラを停止しました。","ok");
}

async function scanLoop(){
  if(!scanning||!detector)return;

  try{
    const codes=await detector.detect(el("video"));
    if(codes.length)await handleScannedCode(codes[0].rawValue);
  }catch(_){}

  requestAnimationFrame(scanLoop);
}

/* ===== v59 camera guide ===== */
function showCameraGuide(){
  const g=document.getElementById("cameraGuideOverlay");
  if(g)g.classList.add("is-active");
}

function hideCameraGuide(){
  const g=document.getElementById("cameraGuideOverlay");
  if(g)g.classList.remove("is-active");
}

/* v72 camera zoom bind */
function bindCameraZoomControls(){
  const range=document.getElementById("cameraZoomRange");
  if(range){
    range.oninput=()=>{
      updateCameraZoomLabel();
      applyCameraZoom();
    };
    updateCameraZoomLabel();
  }
}
