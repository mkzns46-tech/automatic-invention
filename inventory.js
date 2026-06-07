/* ARICO TOKYO inventory app: inventory.js */

let products=[];
let logs=[];
let staffMembers=[];
let selectedBarcode="";
let dataLoaded=false;
let dataLoadError=false;
let eventPickEvents=[];

let videoStream=null;
let detector=null;
let scanning=false;
let lastScan="";
let lastScanAt=0;
let zxingReader=null;
let zxingRunning=false;

function render(){
  renderStaffOptions();
  renderEventPickOptions();
  renderStaffList();
  renderProductCount();
  renderRecentRegistrationHistory();
  renderGlobalHistory();
  renderSelectedProductHistory();
  if(typeof applyLang==='function')setTimeout(applyLang,0);
}

function updateEquipmentMemoUi(){
  const required=el("equipmentMemoRequired");
  const memo=el("memo");
  const isEquipment=el("type")?.value==="備品転用";
  const isEventPick=el("type")?.value==="event_pick";
  if(required)required.hidden=!isEquipment;
  if(memo)memo.required=isEquipment;
  const eventLabel=el("eventPickEventLabel");
  if(eventLabel)eventLabel.hidden=!isEventPick;
  if(isEventPick&&typeof loadEventPickEvents==="function"&&!eventPickEvents.length){
    loadEventPickEvents().then(renderEventPickOptions).catch(()=>{});
  }
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

function renderProductCount(){
  const badge=el("productCountBadge");
  if(badge)badge.textContent="登録数：高速モード";
}

function renderStaffOptions(){
  const options='<option value="">担当者を選択</option>'+staffMembers.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");

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
    smaregiChecker.innerHTML='<option value="">担当者を選択</option>'+staffMembers.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
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
  picker.innerHTML=`
    <button type="button" class="staff-picker-toggle" aria-expanded="false">${esc(selected||"担当者を選択")}</button>
    <div class="staff-picker-list" hidden>
      ${staffMembers.map(member=>`<button type="button" class="staff-picker-option${member.name===selected?" is-selected":""}" data-staff-name="${esc(member.name)}">${esc(member.name)}</button>`).join("")}
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
});

function renderStaffList(){
  const badge=el("staffCountBadge");
  const body=el("staffListBody");

  if(badge)badge.textContent=`担当者：${staffMembers.length}人`;
  if(!body)return;

  body.innerHTML=staffMembers.map(s=>`
    <tr>
      <td>${esc(s.name)}</td>
      <td>
        <div class="staff-action-group">
          <button type="button" class="staff-edit-btn secondary" data-staff-id="${s.id}" data-staff-name="${esc(s.name)}">編集</button>
          <button type="button" class="staff-delete-btn" data-staff-id="${s.id}">削除</button>
        </div>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".staff-edit-btn").forEach(btn=>{
    btn.onclick=()=>editStaff(btn.dataset.staffId,btn.dataset.staffName);
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
    if(!name){
      showMessage("担当者名を入力してください。","err");
      return;
    }

    await sb("staff_members?on_conflict=name",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify([{name}])
    });

    el("staffNameInput").value="";
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

async function editStaff(id,currentName){
  if(!requireInventoryPrivilegedAccess())return;
  try{
    const name=String(prompt("変更後の担当者名を入力してください。",currentName||"")||"").trim();
    if(!name||name===currentName)return;
    await sb(`staff_members?id=eq.${encodeURIComponent(id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({name})
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
    return;
  }

  info.textContent="商品確認中...";
  info.className="message";

  try{
    const p=await fetchProductByBarcode(barcode);
    if(!p){
      info.textContent=`未登録バーコード：${barcode}`;
      info.className="message err";
      showMessage(`未登録バーコード：${barcode}`,"err");
      return;
    }

    info.textContent=`商品名：${p.name} / 現在庫：${Number(p.base_stock||0)}`;
    info.className="message ok";
  }catch(e){
    info.textContent="商品確認エラー。\n"+e.message;
    info.className="message err";
    showMessage("商品確認エラー。\n"+e.message,"err");
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

  info.textContent=`登録済み：${p.name} / 現在庫：${Number(p.base_stock||0)}`;
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
    showPopup("商品登録完了", `商品名：${name}\nバーコード：${barcode}\n現在庫：${base_stock}`);

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

async function upsertEventPickEventItem(event,product,qty){
  const eventId=encodeURIComponent(event.id);
  const barcode=encodeURIComponent(product.barcode);
  const rows=await sb(`booth_event_items?select=id,taken_qty,normal_takeout_qty,storage_takeout_qty&event_id=eq.${eventId}&barcode=eq.${barcode}&item_type=eq.normal&limit=1`);
  const now=new Date().toISOString();
  if(Array.isArray(rows)&&rows[0]){
    const currentTaken=Number(rows[0].taken_qty||0);
    const currentNormal=Number(rows[0].normal_takeout_qty||0);
    await sb(`booth_event_items?id=eq.${encodeURIComponent(rows[0].id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        product_name:product.name||"",
        taken_qty:currentTaken+qty,
        normal_takeout_qty:currentNormal+qty,
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
      normal_takeout_qty:qty,
      storage_takeout_qty:0,
      updated_at:now
    }])
  });
}

async function insertEventPickMovement(event,product,qty,staff,memo){
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
      takeout_source:"normal",
      affects_smaregi:false,
      smaregi_delta:0
    }])
  });
}

async function registerEventPickFromInventory({event,product,barcode,qty,staff,memo,currentStock,newStock}){
  let productUpdated=false;
  let insertedLogId="";
  let insertedLog=null;
  try{
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
        affects_smaregi:false,
        smaregi_delta:0
      })
    });
    insertedLogId=Array.isArray(insertedLog)&&insertedLog[0]?String(insertedLog[0].id||""):"";

    await insertEventPickMovement(event,product,qty,staff,memo);
    await upsertEventPickEventItem(event,product,qty);

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

    showMessage(`イベントピック登録：${product.name} / イベント：${event.name||"-"} / 数量 ${qty} / 通常棚在庫 ${newStock}`,"ok");
    showPopup("イベントピック登録完了",`イベント名：${event.name||"-"}\n商品名：${product.name}\n数量：${qty}\n通常棚在庫：${newStock}\n担当者：${staff}\nスマレジ在庫：変更しません`);

    el("barcodeInput").value="";
    el("qty").value="";
    await renderScanPreview();
    await showProductHistoryForBarcode(barcode);
    el("barcodeInput").focus();
  }catch(e){
    if(productUpdated){
      try{await updateProductCurrentStock(barcode,currentStock);}catch(_){}
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

async function registerBarcode(barcode){
  try{
    barcode=String(barcode||"").trim();
    if(!barcode)return;

    const type=el("type").value;
    const staff=el("staff").value.trim();
    const qtyRaw=el("qty").value.trim();
    const qty=Number(qtyRaw);
    const memo=el("memo").value.trim();
    const isEventPick=type==="event_pick";
    const eventPickEventId=String(el("eventPickEventSelect")?.value||"").trim();
    const eventPickEvent=isEventPick?findEventPickEvent(eventPickEventId):null;

    if(!staff){
      showMessage("担当者を選択してください。","err");
      el("staff").focus();
      return;
    }

    if(isEventPick&&!eventPickEvent){
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
      showMessage("備品転用は備考入力が必須です","err");
      el("memo").focus();
      return;
    }

    const p=await fetchProductByBarcode(barcode);

    if(!p){
      showMessage(`未登録バーコード：${barcode}。PCで商品登録してください。`,"err");
      return;
    }

    const currentStock=Number(p.base_stock||0);
    let newStock=currentStock;

    if(type==="入荷")newStock=currentStock+qty;
    if(type==="出荷")newStock=currentStock-qty;
    if(type==="備品転用")newStock=currentStock-qty;
    if(type==="在庫修正")newStock=qty;
    if(isEventPick)newStock=currentStock-qty;

    if((type==="出荷"||type==="備品転用"||isEventPick)&&newStock<0){
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
        newStock
      });
      return;
    }

    const insertedLog=await sb("inventory_logs",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({
        type,
        staff,
        barcode,
        product_name:p.name,
        quantity:qty,
        memo
      })
    });

    await updateProductCurrentStock(barcode,newStock);

    logs.unshift({
      id:(typeof insertedLog!=="undefined" && Array.isArray(insertedLog) && insertedLog[0]) ? insertedLog[0].id : "",
      created_at:(typeof insertedLog!=="undefined" && Array.isArray(insertedLog) && insertedLog[0]) ? insertedLog[0].created_at : new Date().toISOString(),
      type,
      staff,
      barcode,
      product_name:p.name,
      quantity:qty,
      memo
    });

    showMessage(type==="在庫修正"
      ?`在庫修正：${p.name} / 現在庫を ${qty} に上書き / 担当者：${staff}`
      :`${type}登録：${p.name} / 担当者：${staff} / 数量 ${qty} / 現在庫 ${newStock}`
    ,"ok");

    showPopup("登録完了",
      type==="在庫修正"
        ? `在庫修正\n商品名：${p.name}\n現在庫：${newStock}\n担当者：${staff}`
        : `${type}登録\n商品名：${p.name}\n数量：${qty}\n現在庫：${newStock}\n担当者：${staff}`
    );

    el("barcodeInput").value="";
    el("qty").value="";
    await renderScanPreview();
    await showProductHistoryForBarcode(barcode);
    el("barcodeInput").focus();
  }catch(e){
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
  return `<div class="memo-cell">
    <span class="memo-text">${esc(memo)}</span>
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

function equipmentCheckHtml(log){
  if(log.type!=="備品転用")return "";
  const logId=esc(log.id||"");
  if(isEquipmentTransferChecked(log)){
    return `<div class="equipment-check-cell" data-log-id="${logId}"><span class="equipment-check-status is-checked">確認済</span><small>${esc(log.equipment_checked_by||"")} / ${fmt(log.equipment_checked_at)}</small></div>`;
  }
  return `<div class="equipment-check-cell" data-log-id="${logId}"><span class="equipment-check-status is-unchecked">未確認</span><button type="button" class="equipment-confirm-btn" data-log-id="${logId}">確認</button></div>`;
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

async function confirmEquipmentTransfer(logId,button=null){
  logId=String(logId||"").trim();
  console.log("[Equipment Transfer Confirm Click]",{logId});
  const checkedBy=getEquipmentConfirmationStaff();
  if(!checkedBy){
    showMessage("確認する担当者を選択してください。","err");
    el("staffPicker")?.querySelector(".staff-picker-toggle")?.focus();
    return;
  }
  if(!logId){
    showMessage("備品転用履歴IDが見つかりません。再読み込みしてください。","err");
    return;
  }
  await runWithSmaregiAutoRefreshPaused(async()=>{
   try{
    const equipment_checked_at=new Date().toISOString();
    const patchPath=`inventory_logs?id=eq.${encodeURIComponent(logId)}&select=id,equipment_checked,equipment_checked_by,equipment_checked_at`;
    const patchPayload={equipment_checked:true,equipment_checked_by:checkedBy,equipment_checked_at};
    console.log("[Equipment Transfer Confirm PATCH Request]",{
      url:SUPABASE_URL.replace(/\/+$/,"")+"/rest/v1/"+patchPath,
      payload:patchPayload
    });
    const patchedRows=await sb(patchPath,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(patchPayload)
    });
    console.log("[Equipment Transfer Confirm PATCH Response]",patchedRows);
    const patchedLog=Array.isArray(patchedRows)&&patchedRows[0] ? patchedRows[0] : null;
    if(!patchedLog)throw new Error(`備品転用履歴を更新できませんでした。inventory_logs.id=${logId}\nSupabaseのinventory_logs UPDATEポリシーを確認してください。`);
    const refreshedRows=await sb(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`);
    const refreshedLog=Array.isArray(refreshedRows)&&refreshedRows[0] ? refreshedRows[0] : null;
    if(!refreshedLog)throw new Error(`更新後の備品転用履歴を再取得できませんでした。inventory_logs.id=${logId}`);
    if(!isEquipmentTransferChecked(refreshedLog)||!refreshedLog.equipment_checked_by||!refreshedLog.equipment_checked_at){
      throw new Error(`備品転用確認がSupabaseに保存されていません。追加SQLとinventory_logsの更新権限を確認してください。inventory_logs.id=${logId}`);
    }
    const displayLog=refreshedLog;
    console.log("[Equipment Transfer Confirm PATCH Verified]",{logId,checkedBy,equipment_checked_at,patchedLog});
    replaceEquipmentConfirmationDom(logId,displayLog);
    logs=(logs||[]).some(log=>String(log.id)===String(logId))
      ? logs.map(log=>String(log.id)===String(logId) ? displayLog : log)
      : [displayLog,...logs];
    console.log("[Equipment Transfer Confirm Refetched]",{
      id:refreshedLog.id,
      equipment_checked:refreshedLog.equipment_checked,
      equipment_checked_by:refreshedLog.equipment_checked_by,
      equipment_checked_at:refreshedLog.equipment_checked_at
    });
    showMessage(`備品転用を確認済みにしました：${checkedBy}`,"ok");
    renderGlobalHistory();
    if(selectedBarcode)await showProductHistoryForBarcode(selectedBarcode,displayLog);
    replaceEquipmentConfirmationDom(logId,displayLog);
  }catch(e){
    showMessage("備品転用確認エラー。\nSQL追加済みか確認してください。\n"+e.message,"err");
  }
  },{button});
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
