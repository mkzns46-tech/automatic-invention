/* ARICO TOKYO inventory app: app-inventory-count.js */
(function(){
  "use strict";

  const CURRENT_DRAFT_KEY="arico_app_inventory_count_current_draft_id";
  const APP_INVENTORY_SEARCH_SORT_KEY="arico_product_search_sort_app_inventory";
  const STORE_TAG="ARICO_APP_INVENTORY_STORE:";
  const SCAN_COOLDOWN_MS=1300;
  const STATUS_ACTIVE="棚卸中";
  const STATUS_FINISHED="棚卸終了";
  const STATUS_COMPARED="比較済み";
  const STATUS_CLOSED="セッション終了";

  const state={
    sessions:[],
    items:[],
    historyItems:[],
    currentSessionId:""
  };

  let appCountZXingReader=null;
  let appCountZXingRunning=false;
  let appCountCameraStream=null;
  let lastScannedCode="";
  let lastScannedAt=0;
  let selectedProduct=null;
  let searchResultCache=[];
  let draftCreationPromise=null;
  let refreshPromise=null;
  let draftReady=false;

  function safe(value){
    return typeof esc==="function" ? esc(value) : String(value??"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function nowIso(){return new Date().toISOString();}

  function normalizeKey(value){
    return String(value??"").trim().toLowerCase().replace(/\s/g,"");
  }

  function normalizeSearchText(value){
    return String(value??"").normalize("NFKC").toLowerCase().replace(/\s+/g,"");
  }

  function formatDate(value){
    if(!value)return "";
    return typeof fmt==="function" ? fmt(value) : new Date(value).toLocaleString("ja-JP");
  }

  function currentStoreCode(){
    return String(window.currentStore||"tokyo").trim().toLowerCase()||"tokyo";
  }

  function currentStoreLabel(){
    if(typeof getStoreInfoByCode==="function")return getStoreInfoByCode(currentStoreCode())?.label||currentStoreCode();
    return currentStoreCode();
  }

  function getStaffValue(){
    return String(document.getElementById("appInventoryCountStaff")?.value||"").trim();
  }

  function hasAdminAccess(){
    if(typeof hasInventoryPrivilegedAccess==="function")return hasInventoryPrivilegedAccess();
    if(typeof isInventoryAdminAuthenticated==="function")return isInventoryAdminAuthenticated();
    return false;
  }

  function requireAdmin(){
    if(hasAdminAccess())return true;
    if(typeof showPopup==="function")showPopup("管理者限定","管理者のみ操作できます");
    if(typeof showMessage==="function")showMessage("管理者のみ操作できます","err");
    setMessage("appInventoryCountProductInfo","管理者のみ操作できます","err");
    return false;
  }

  function setMessage(id,text,type=""){
    const node=document.getElementById(id);
    if(!node)return;
    node.textContent=text;
    node.className=`message${type?` ${type}`:""}`;
  }

  function setInventoryControlsEnabled(enabled){
    const controls=[
      "appInventoryCountStaff",
      "appInventoryCountBarcode",
      "appInventoryCountSearch",
      "appInventoryProductSearchSort",
      "appInventoryCountQty",
      "saveAppInventoryCountBtn",
      "appInventoryCameraBtn",
      "appInventoryCloseCameraBtn",
      "appInventoryApplyBtn",
      "appInventoryClearBtn"
    ];
    controls.forEach(id=>{
      const node=document.getElementById(id);
      if(node)node.disabled=!enabled;
    });
    document.querySelectorAll("#appInventoryCountBody .app-count-qty-input,#appInventoryCountBody .app-count-delete-btn").forEach(node=>{
      node.disabled=!enabled;
    });
    const panel=document.getElementById("appInventoryCountPanel");
    if(panel)panel.setAttribute("aria-busy",enabled?"false":"true");
  }

  function getSessionStoreCode(session){
    const memo=String(session?.memo||"");
    const tagged=memo.match(new RegExp(`${STORE_TAG.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(\\w+)`,`i`));
    if(tagged?.[1])return tagged[1].toLowerCase();
    const staff=String(session?.staff||"");
    const contextStores=typeof SMAREGI_CONTEXT_OPTIONS!=="undefined" ? SMAREGI_CONTEXT_OPTIONS.stores : [];
    const stores=Array.isArray(contextStores) ? contextStores : [];
    const found=stores.find(store=>staff.includes(String(store.label||""))||staff.includes(String(store.badge||"")));
    return found?.key||"";
  }

  function storeMemo(storeCode,existing=""){
    const clean=String(existing||"").replace(new RegExp(`(?:^|\\n)${STORE_TAG.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\w+`,"ig"),"").trim();
    return clean ? `${clean}\n${STORE_TAG}${storeCode}` : `${STORE_TAG}${storeCode}`;
  }

  function currentSession(){
    return state.sessions.find(session=>String(session.id)===String(state.currentSessionId))||null;
  }

  function isActiveForStore(session,storeCode=currentStoreCode()){
    return session?.status===STATUS_ACTIVE&&getSessionStoreCode(session)===storeCode;
  }

  function itemKey(item){
    return normalizeKey(item?.barcode||item?.product_code||item?.product_id||item?.product_name);
  }

  function itemDisplay(item){
    return {
      id:item.id,
      key:itemKey(item),
      barcode:String(item.barcode||item.product_code||""),
      productCode:String(item.product_code||item.barcode||""),
      productId:String(item.product_id||""),
      name:String(item.product_name||""),
      count:Number(item.count_qty||0),
      beforeStock:Number(item.before_stock||0),
      staff:String(item.staff||""),
      updatedAt:item.updated_at||item.counted_at||item.created_at||"",
      reflectedAt:item.reflected_at||"",
      reflectedBy:item.reflected_by||""
    };
  }

  function setRemoteError(error){
    setMessage("appInventoryCountProductInfo","アプリ内棚卸の保存先へ接続できません。\n"+(error?.message||error),"err");
  }

  async function createDraft(storeCode){
    if(draftCreationPromise)return draftCreationPromise;
    draftCreationPromise=(async()=>{
      const inserted=await sb("inventory_count_sessions",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          name:`${new Date().toLocaleDateString("ja-JP")} 棚卸`,
          staff:getStaffValue()||localStorage.getItem("arico_current_staff_name")||"",
          memo:storeMemo(storeCode),
          status:STATUS_ACTIVE,
          started_at:nowIso()
        })
      });
      const session=Array.isArray(inserted)?inserted[0]:inserted;
      if(!session?.id)throw new Error("棚卸入力を開始できませんでした。");
      state.currentSessionId=String(session.id);
      localStorage.setItem(CURRENT_DRAFT_KEY,state.currentSessionId);
      return session;
    })().finally(()=>{draftCreationPromise=null;});
    return draftCreationPromise;
  }

  async function loadSessions(){
    try{
      const rows=await sbAll("inventory_count_sessions?select=*&order=started_at.desc",1000,5000);
      state.sessions=Array.isArray(rows)?rows:[];
      const storeCode=currentStoreCode();
      const saved=localStorage.getItem(CURRENT_DRAFT_KEY)||"";
      const savedSession=state.sessions.find(session=>String(session.id)===saved&&isActiveForStore(session,storeCode));
      const active=state.sessions.filter(session=>isActiveForStore(session,storeCode));
      if(savedSession)state.currentSessionId=String(savedSession.id);
      else if(active[0])state.currentSessionId=String(active[0].id);
      else{
        const created=await createDraft(storeCode);
        state.sessions=[created,...state.sessions];
        state.currentSessionId=String(created.id);
      }
      localStorage.setItem(CURRENT_DRAFT_KEY,state.currentSessionId);
    }catch(error){
      state.sessions=[];
      state.currentSessionId="";
      setRemoteError(error);
      throw error;
    }
  }

  async function loadItems(){
    const session=currentSession();
    if(!session){state.items=[];return;}
    try{
      const rows=await sbAll(`inventory_count_items?select=*&session_id=eq.${encodeURIComponent(session.id)}&order=updated_at.desc,counted_at.desc`,1000,10000);
      state.items=Array.isArray(rows)?rows:[];
    }catch(error){
      state.items=[];
      setRemoteError(error);
      throw error;
    }
  }

  async function loadHistoryItems(){
    try{
      const rows=await sbAll("inventory_count_items?select=*&order=counted_at.desc",1000,20000);
      state.historyItems=Array.isArray(rows)?rows:[];
    }catch(_){state.historyItems=[];}
  }

  async function refreshRemote(){
    if(refreshPromise)return refreshPromise;
    setInventoryControlsEnabled(false);
    refreshPromise=(async()=>{
      await loadSessions();
      await loadItems();
      await loadHistoryItems();
      if(!currentSession()?.id)throw new Error("棚卸ドラフトのsession_idを取得できませんでした。");
      draftReady=true;
      return currentSession();
    })().catch(error=>{
      draftReady=false;
      setRemoteError(error);
      throw error;
    }).finally(()=>{
      refreshPromise=null;
      if(draftReady){
        setInventoryControlsEnabled(true);
        renderDraftInfo();
      }
    });
    return refreshPromise;
  }

  function latestRows(rows){
    const map=new Map();
    (Array.isArray(rows)?rows:[]).map(itemDisplay).forEach(row=>{
      const current=map.get(row.key);
      if(!current||String(row.updatedAt)>String(current.updatedAt))map.set(row.key,row);
    });
    return [...map.values()];
  }

  function renderDraftInfo(){
    const session=currentSession();
    const status=document.getElementById("appInventoryCountStatus");
    if(status){
      status.className=`badge ${session?.status===STATUS_ACTIVE?"":"muted"}`;
      status.textContent=session?`${session.status} ${latestRows(state.items).length}商品`:"未接続";
    }
    const store=document.getElementById("appInventoryStoreName");
    if(store)store.textContent=currentStoreLabel();
    const count=document.getElementById("appInventoryDraftCount");
    if(count)count.textContent=`${latestRows(state.items).length}商品`;
    const last=document.getElementById("appInventoryLastSaved");
    const lastItem=[...state.items].sort((a,b)=>String(b.updated_at||b.counted_at||"").localeCompare(String(a.updated_at||a.counted_at||"")))[0];
    if(last)last.textContent=lastItem?formatDate(lastItem.updated_at||lastItem.counted_at):"未保存";
    const apply=document.getElementById("appInventoryApplyBtn");
    const clear=document.getElementById("appInventoryClearBtn");
    [apply,clear].forEach(button=>{
      if(!button)return;
      button.classList.toggle("admin-required",!hasAdminAccess());
      button.title=hasAdminAccess()?"":"管理者のみ操作できます";
      button.disabled=!draftReady||!hasAdminAccess();
    });
  }

  function renderStaffSelect(){
    const select=document.getElementById("appInventoryCountStaff");
    if(!select)return;
    const current=select.value||localStorage.getItem("arico_current_staff_name")||currentSession()?.staff||"";
    const members=Array.isArray(window.staffMembers)?window.staffMembers:(typeof staffMembers!=="undefined"&&Array.isArray(staffMembers)?staffMembers:[]);
    const label=member=>typeof getStaffDisplayName==="function"?getStaffDisplayName(member):String(member?.name||"");
    select.innerHTML='<option value="">担当者を選択</option>'+members.map(member=>`<option value="${safe(label(member))}">${safe(label(member))}</option>`).join("");
    if(current)select.value=current;
    if(select.value&&typeof setCurrentStaffName==="function")setCurrentStaffName(select.value);
    if(typeof renderScrollableStaffPicker==="function")renderScrollableStaffPicker("appInventoryCountStaff","appInventoryCountStaffPicker");
    const currentStaff=document.getElementById("appInventoryCurrentStaffName");
    if(currentStaff)currentStaff.textContent=select.value||"未選択";
  }

  function renderCountedRows(){
    const body=document.getElementById("appInventoryCountBody");
    const summary=document.getElementById("appInventoryCountSummary");
    const rows=latestRows(state.items).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
    if(summary)summary.textContent=`${rows.length}商品`;
    if(!body)return;
    body.innerHTML=rows.length?rows.map(row=>`
      <tr>
        <td class="app-count-name-cell">${safe(row.name)}<small>棚番：${safe(getProductShelfLabel({barcode:row.barcode}))}</small></td>
        <td>${safe(row.barcode)}</td>
        <td><input class="app-count-qty-input" type="number" min="0" step="1" inputmode="numeric" value="${safe(row.count)}" data-id="${safe(row.id)}" aria-label="${safe(row.name)}のカウント数"></td>
        <td>${safe(row.staff||"未選択")}</td>
        <td>${safe(formatDate(row.updatedAt))}</td>
        <td><button type="button" class="app-count-delete-btn danger" data-id="${safe(row.id)}">削除</button></td>
      </tr>`).join(""):'<tr><td colspan="6" class="app-count-empty">まだ入力はありません。</td></tr>';
    body.querySelectorAll(".app-count-qty-input").forEach(input=>{
      input.addEventListener("change",()=>updateDraftItem(input.dataset.id,input.value));
      input.addEventListener("keydown",event=>{
        if(event.key==="Enter"){event.preventDefault();input.blur();}
      });
    });
    body.querySelectorAll(".app-count-delete-btn").forEach(button=>{
      button.addEventListener("click",()=>deleteDraftItem(button.dataset.id,button));
    });
    setInventoryControlsEnabled(draftReady);
  }

  function renderHistoryRows(){
    const body=document.getElementById("appInventoryHistoryBody");
    const summary=document.getElementById("appInventoryHistorySummary");
    if(!body)return;
    const nameFilter=normalizeSearchText(document.getElementById("appInventoryHistoryNameFilter")?.value||"");
    const staffFilter=normalizeSearchText(document.getElementById("appInventoryHistoryStaffFilter")?.value||"");
    const dateFilter=String(document.getElementById("appInventoryHistoryDateFilter")?.value||"").trim();
    const bySession=new Map();
    state.historyItems.forEach(item=>{
      const id=String(item.session_id||"");
      if(!id)return;
      if(!bySession.has(id))bySession.set(id,[]);
      bySession.get(id).push(itemDisplay(item));
    });
    const rows=state.sessions.map(session=>{
      const items=bySession.get(String(session.id))||[];
      const distinct=latestRows(items);
      return {
        session,
        store:getSessionStoreCode(session),
        items:distinct,
        diffCount:distinct.filter(item=>Number(item.count)!==Number(item.beforeStock)).length,
        reflectedCount:distinct.filter(item=>item.reflectedAt).length
      };
    }).filter(row=>{
      const session=row.session;
      const dates=[session.started_at,session.finished_at,session.ended_at,session.created_at].filter(Boolean).map(value=>String(value).slice(0,10));
      if(nameFilter&&!normalizeSearchText(session.name).includes(nameFilter))return false;
      if(staffFilter&&!normalizeSearchText(session.staff).includes(staffFilter))return false;
      if(dateFilter&&!dates.includes(dateFilter))return false;
      return true;
    });
    if(summary)summary.textContent=`${rows.length}件`;
    body.innerHTML=rows.length?rows.map(row=>`
      <tr>
        <td>${safe(row.store?getStoreLabel(row.store):"")}</td>
        <td>${safe(row.session.staff||"")}</td>
        <td>${safe(formatDate(row.session.started_at))}</td>
        <td>${safe(formatDate(row.session.ended_at||row.session.finished_at))}</td>
        <td>${safe(row.items.length)}</td>
        <td>${safe(row.diffCount)}</td>
        <td>${safe(row.reflectedCount)}</td>
        <td>${safe(statusLabel(row.session.status))}</td>
      </tr>`).join(""):'<tr><td colspan="8" class="app-count-empty">棚卸履歴はありません。</td></tr>';
  }

  function getStoreLabel(code){
    if(typeof getStoreInfoByCode==="function")return getStoreInfoByCode(code)?.label||code;
    return code;
  }

  function statusLabel(status){
    if(status===STATUS_ACTIVE)return "入力中";
    if(status===STATUS_FINISHED)return "入力完了";
    if(status===STATUS_COMPARED)return "比較済み";
    if(status===STATUS_CLOSED)return "反映済み";
    return status||"";
  }

  function renderAll(){
    renderStaffSelect();
    renderDraftInfo();
    renderCountedRows();
    renderHistoryRows();
  }

  window.renderAppInventoryCount=async function(){
    try{await refreshRemote();}
    catch(_){renderAll();return false;}
    renderAll();
    return true;
  };

  async function ensureDraftReady(){
    if(draftReady&&currentSession()?.status===STATUS_ACTIVE&&String(currentSession()?.id||""))return true;
    try{await refreshRemote();}
    catch(_){return false;}
    return draftReady&&currentSession()?.status===STATUS_ACTIVE&&String(currentSession()?.id||"")!=="";
  }

  function requireDraft(){
    const session=currentSession();
    if(draftReady&&session?.status===STATUS_ACTIVE&&String(session.id||""))return true;
    setMessage("appInventoryCountProductInfo","棚卸入力を読み込めません。最新状態に更新してください。","err");
    return false;
  }

  async function updateDraftStaff(session,staff){
    const value=String(staff||"").trim();
    if(!session||!value)return;
    await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}&status=eq.${encodeURIComponent(STATUS_ACTIVE)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({staff:value,memo:storeMemo(currentStoreCode(),session.memo),updated_at:nowIso()})
    });
    session.staff=value;
    session.memo=storeMemo(currentStoreCode(),session.memo);
  }

  function validateQty(raw){
    const value=String(raw??"").trim();
    if(value==="")return {error:"数量を入力してください。"};
    const qty=Number(value);
    if(!Number.isInteger(qty)||qty<0)return {error:"数量は0以上の整数で入力してください。"};
    return {qty};
  }

  function productDetails(product){
    return {
      product_code:String(product?.barcode||""),
      barcode:String(product?.barcode||""),
      product_id:String(product?.smaregi_product_id||product?.id||""),
      product_name:String(product?.name||product?.product_name||"")
    };
  }

  async function saveCount(){
    if(!await ensureDraftReady())return;
    if(!requireDraft())return;
    const product=selectedProduct||await previewBarcode();
    if(!product)return;
    const staff=getStaffValue();
    if(!staff){
      setMessage("appInventoryCountProductInfo","担当者を選択してください。","err");
      document.getElementById("appInventoryCountStaff")?.focus();
      return;
    }
    try{await refreshRemote();}catch(_){return;}
    if(!requireDraft())return;
    const existing=latestRows(state.items).find(row=>row.key===normalizeKey(product.barcode));
    const qtyInput=document.getElementById("appInventoryCountQty");
    const raw=String(qtyInput?.value??"").trim();
    const result=raw===""&&existing?{qty:existing.count+1}:validateQty(raw);
    if(result.error){setMessage("appInventoryCountProductInfo",result.error,"err");qtyInput?.focus();return;}
    const session=currentSession();
    const sessionId=String(session?.id||"").trim();
    if(!sessionId){
      draftReady=false;
      setInventoryControlsEnabled(false);
      setMessage("appInventoryCountProductInfo","棚卸データを準備中です。少し待ってから再試行してください。","err");
      return;
    }
    const details=productDetails(product);
    try{
      await updateDraftStaff(session,staff);
      const payload={...details,count_qty:result.qty,staff,counted_at:nowIso(),updated_at:nowIso()};
      if(existing){
        await sb(`inventory_count_items?id=eq.${encodeURIComponent(existing.id)}&session_id=eq.${encodeURIComponent(session.id)}`,{
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify(payload)
        });
      }else{
        await sb("inventory_count_items",{
          method:"POST",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({...payload,session_id:sessionId,before_stock:Number(product.base_stock||0),memo:"",adopted:false})
        });
      }
      state.items=[];
      await refreshRemote();
      renderAll();
      clearScanForm(`保存しました：${details.product_name} / ${result.qty}`,"ok");
    }catch(error){setRemoteError(error);}
  }

  async function updateDraftItem(itemId,rawQty){
    if(!await ensureDraftReady())return;
    if(!requireDraft())return;
    const result=validateQty(rawQty);
    if(result.error){setMessage("appInventoryCountProductInfo",result.error,"err");await refreshRemote();renderAll();return;}
    try{
      await refreshRemote();
      const session=currentSession();
      if(!session?.id)throw new Error("棚卸ドラフトのsession_idを取得できませんでした。");
      const row=latestRows(state.items).find(item=>String(item.id)===String(itemId));
      if(!row)throw new Error("入力行が別端末で変更されています。最新状態を再取得しました。");
      await updateDraftStaff(session,getStaffValue()||row.staff);
      await sb(`inventory_count_items?id=eq.${encodeURIComponent(row.id)}&session_id=eq.${encodeURIComponent(session.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({count_qty:result.qty,staff:getStaffValue()||row.staff,counted_at:nowIso(),updated_at:nowIso()})
      });
      await refreshRemote();
      renderAll();
      setMessage("appInventoryCountProductInfo",`保存しました：${row.name} / ${result.qty}`,"ok");
    }catch(error){setRemoteError(error);}
  }

  async function deleteDraftItem(itemId,button){
    if(!await ensureDraftReady())return;
    if(!requireDraft())return;
    const row=state.items.map(itemDisplay).find(item=>String(item.id)===String(itemId));
    if(!row)return;
    if(!confirm(`${row.name} の入力を削除しますか？`))return;
    try{
      if(button)button.disabled=true;
      await refreshRemote();
      const session=currentSession();
      await sb(`inventory_count_items?id=eq.${encodeURIComponent(itemId)}&session_id=eq.${encodeURIComponent(session.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      await refreshRemote();
      renderAll();
      setMessage("appInventoryCountProductInfo",`削除しました：${row.name}`,"ok");
    }catch(error){if(button)button.disabled=false;setRemoteError(error);}
  }

  async function fetchLatestProducts(rows){
    const barcodes=[...new Set(rows.map(row=>String(row.barcode||"").trim()).filter(Boolean))];
    const result=new Map();
    const local=Array.isArray(window.products)?window.products:(typeof products!=="undefined"&&Array.isArray(products)?products:[]);
    local.forEach(product=>{const code=String(product?.barcode||"").trim();if(code&&barcodes.includes(code))result.set(code,product);});
    if(!barcodes.length)return result;
    try{
      const filter=barcodes.map(code=>`"${code.replace(/"/g,'""')}"`).join(",");
      const remote=await sbAll(`products?select=*&barcode=in.(${filter})`,1000,20000);
      (Array.isArray(remote)?remote:[]).forEach(product=>{const code=String(product?.barcode||"").trim();if(code)result.set(code,product);});
    }catch(_){
      await Promise.all(barcodes.map(async code=>{
        const product=await findProductByCode(code).catch(()=>null);
        if(product)result.set(code,product);
      }));
    }
    return result;
  }

  async function applyCurrentDraft(){
    if(!requireAdmin())return;
    await refreshRemote();
    if(!requireDraft())return;
    const session=currentSession();
    const rows=latestRows(state.items);
    if(!rows.length){setMessage("appInventoryCountCsvInfo","入力済みの商品がありません。","err");return;}
    const productMap=await fetchLatestProducts(rows);
    const operations=[];
    const missing=[];
    rows.forEach(row=>{
      const product=productMap.get(String(row.barcode||""));
      if(!product){missing.push(row);return;}
      const before=Number(product.base_stock||0);
      const after=Number(row.count||0);
      operations.push({row,product,before,after,diff:after-before});
    });
    if(missing.length){
      setMessage("appInventoryCountCsvInfo",`商品マスター未登録：${missing.map(row=>row.barcode||row.name).join("、")}`,"err");
      return;
    }
    const changed=operations.filter(operation=>operation.diff!==0);
    const ok=confirm(`最新の在庫を再取得して反映します。\n\n対象商品：${operations.length}商品\n在庫変更：${changed.length}商品\n差異0：${operations.length-changed.length}商品\n\n管理者として実行しますか？`);
    if(!ok)return;
    const adminStaff=getStaffValue()||session.staff||"管理者";
    const changedProducts=[];
    const logIds=[];
    const previousItemReflection=rows.map(row=>({id:row.id,reflectedAt:row.reflectedAt,reflectedBy:row.reflectedBy}));
    let sessionClosed=false;
    const reflectedAt=nowIso();
    const applyButton=document.getElementById("appInventoryApplyBtn");
    try{
      if(applyButton)applyButton.disabled=true;
      for(const operation of changed){
        await updateProductCurrentStock(operation.product.barcode,operation.after);
        changedProducts.push(operation);
        const inserted=await sb("inventory_logs",{
          method:"POST",
          headers:{Prefer:"return=representation"},
          body:JSON.stringify({
            type:"在庫修正",
            staff:adminStaff,
            barcode:operation.product.barcode,
            product_name:operation.row.name,
            quantity:operation.diff,
            memo:`アプリ内棚卸 / 棚卸日:${formatDate(session.started_at)} / 更新前:${operation.before} / 更新後:${operation.after}`
          })
        });
        const log=Array.isArray(inserted)?inserted[0]:inserted;
        if(log?.id)logIds.push(log.id);
      }
      await sb(`inventory_count_items?session_id=eq.${encodeURIComponent(session.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({reflected_at:reflectedAt,reflected_by:adminStaff})
      });
      await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}&status=eq.${encodeURIComponent(STATUS_ACTIVE)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({status:STATUS_CLOSED,finished_at:reflectedAt,compared_at:reflectedAt,ended_at:reflectedAt,memo:storeMemo(currentStoreCode(),session.memo)})
      });
      sessionClosed=true;
      state.items=[];
      await refreshRemote();
      renderAll();
      setMessage("appInventoryCountCsvInfo",`反映完了：${operations.length}商品（在庫変更 ${changed.length}商品）。新しい入力欄を用意しました。`,"ok");
      setMessage("appInventoryCountProductInfo","在庫へ反映しました。次の棚卸入力を開始できます。","ok");
    }catch(error){
      if(!sessionClosed){
        await Promise.all(previousItemReflection.map(previous=>sb(`inventory_count_items?id=eq.${encodeURIComponent(previous.id)}&session_id=eq.${encodeURIComponent(session.id)}`,{
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({reflected_at:previous.reflectedAt||null,reflected_by:previous.reflectedBy||null})
        }).catch(()=>{})));
      }
      for(const operation of [...changedProducts].reverse()){
        await updateProductCurrentStock(operation.product.barcode,operation.before).catch(()=>{});
      }
      for(const id of logIds){
        await sb(`inventory_logs?id=eq.${encodeURIComponent(id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});
      }
      setMessage("appInventoryCountCsvInfo","反映に失敗したため、変更済みの在庫を可能な範囲で元へ戻しました。\n"+(error?.message||error),"err");
    }finally{
      if(applyButton)applyButton.disabled=false;
    }
  }

  async function clearCurrentDraft(){
    if(!requireAdmin())return;
    await refreshRemote();
    if(!requireDraft())return;
    const session=currentSession();
    if(!confirm("現在の入力内容をすべてクリアします。反映前の入力だけが削除されます。よろしいですか？"))return;
    try{
      await sb(`inventory_count_items?session_id=eq.${encodeURIComponent(session.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}&status=eq.${encodeURIComponent(STATUS_ACTIVE)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      localStorage.removeItem(CURRENT_DRAFT_KEY);
      state.items=[];
      await refreshRemote();
      renderAll();
      setMessage("appInventoryCountProductInfo","入力内容をクリアしました。新しい入力欄を用意しました。","ok");
    }catch(error){setRemoteError(error);}
  }

  async function findProductsByName(keyword){
    keyword=String(keyword||"").trim();
    if(!keyword)return [];
    const normalized=normalizeSearchText(keyword);
    const localProducts=Array.isArray(window.products)?window.products:(typeof products!=="undefined"&&Array.isArray(products)?products:[]);
    const localRows=localProducts.filter(row=>Object.values(row||{}).some(value=>["string","number"].includes(typeof value)&&normalizeSearchText(value).includes(normalized)));
    if(typeof searchProductsByName==="function"){
      const remote=await searchProductsByName(keyword).catch(()=>[]);
      const merged=[...localRows,...(Array.isArray(remote)?remote:[])];
      const seen=new Set();
      return merged.filter(row=>{const key=String(row?.barcode||row?.smaregi_product_id||row?.id||row?.name||"");if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(0,80);
    }
    return localRows.slice(0,80);
  }

  async function findProductByCode(code){
    code=String(code||"").trim();
    if(!code)return null;
    let product=await fetchProductByBarcode(code).catch(()=>null);
    if(product)return product;
    const rows=await sbAll(`products?select=*&barcode=eq.${encodeURIComponent(code)}`,1000,1).catch(()=>[]);
    product=Array.isArray(rows)?rows[0]||null:null;
    return product;
  }

  function showProduct(product,resetQty=false){
    if(!product)return;
    const qty=document.getElementById("appInventoryCountQty");
    if(resetQty&&qty)qty.value="";
    setMessage("appInventoryCountProductInfo",buildProductIdentityText(product),"ok");
  }

  async function previewBarcode(resetQty=false){
    if(!draftReady){
      setMessage("appInventoryCountProductInfo","棚卸データを準備中です。","ok");
      return null;
    }
    const code=String(document.getElementById("appInventoryCountBarcode")?.value||"").trim();
    if(!code){
      if(selectedProduct){showProduct(selectedProduct,resetQty);return selectedProduct;}
      setMessage("appInventoryCountProductInfo","商品をスキャンまたは検索してください。");
      return null;
    }
    selectedProduct=null;
    const product=await findProductByCode(code);
    if(!product){setMessage("appInventoryCountProductInfo",`未登録バーコード：${code}`,"err");return null;}
    selectedProduct=product;
    showProduct(product,resetQty);
    return product;
  }

  function clearScanForm(message,type="ok"){
    const barcode=document.getElementById("appInventoryCountBarcode");
    const search=document.getElementById("appInventoryCountSearch");
    const qty=document.getElementById("appInventoryCountQty");
    const results=document.getElementById("appInventoryCountSearchResults");
    if(barcode)barcode.value="";
    if(search)search.value="";
    if(qty)qty.value="";
    if(results){results.innerHTML="";results.classList.remove("is-active");}
    selectedProduct=null;
    if(message)setMessage("appInventoryCountProductInfo",message,type);
    barcode?.focus();
  }

  async function handleSearchInput(){
    if(!draftReady)return;
    const host=document.getElementById("appInventoryCountSearchResults");
    const keyword=document.getElementById("appInventoryCountSearch")?.value||"";
    if(!host)return;
    if(String(keyword).trim().length<2){host.innerHTML="";host.classList.remove("is-active");return;}
    const rows=await findProductsByName(keyword);
    searchResultCache=(typeof sortProductsForDisplay==="function"?sortProductsForDisplay(rows,getAppInventorySearchSort()):rows).slice(0,20);
    host.innerHTML=searchResultCache.length?searchResultCache.map((row,index)=>`
      <div class="product-search-item" data-index="${safe(index)}"><div><strong>${safe(row.name)}</strong><span>棚番：${safe(getProductShelfLabel(row))}</span><span>バーコード：${safe(row.barcode||"なし")}</span></div><button type="button">選択</button></div>`).join(""):'<div class="product-search-item"><strong>該当商品なし</strong><span>別のキーワードで検索してください</span></div>';
    host.classList.add("is-active");
    host.querySelectorAll(".product-search-item[data-index]").forEach(item=>{
      item.onclick=()=>{
        selectedProduct=searchResultCache[Number(item.dataset.index)]||null;
        const barcode=document.getElementById("appInventoryCountBarcode");
        const search=document.getElementById("appInventoryCountSearch");
        if(barcode)barcode.value=selectedProduct?.barcode||"";
        if(search)search.value="";
        host.innerHTML="";host.classList.remove("is-active");
        if(selectedProduct)showProduct(selectedProduct,true);
        document.getElementById("appInventoryCountQty")?.focus();
      };
    });
  }

  function getAppInventorySearchSort(){
    const value=String(document.getElementById("appInventoryProductSearchSort")?.value||localStorage.getItem(APP_INVENTORY_SEARCH_SORT_KEY)||"name");
    return ["name","barcode","location","updated"].includes(value)?value:"name";
  }

  function isDuplicateScan(code){
    const now=Date.now();
    if(code===lastScannedCode&&now-lastScannedAt<SCAN_COOLDOWN_MS)return true;
    lastScannedCode=code;lastScannedAt=now;return false;
  }

  async function handleScannedCode(code){
    code=String(code||"").trim();
    if(!code||isDuplicateScan(code))return;
    const input=document.getElementById("appInventoryCountBarcode");
    if(input)input.value=code;
    const product=await previewBarcode(true);
    if(product){await stopAppInventoryCamera(false);document.getElementById("appInventoryCountQty")?.focus();setMessage("appInventoryCameraMessage","読み取りました。数量を入力して登録してください。","ok");}
    else setMessage("appInventoryCameraMessage",`読み取りましたが商品が見つかりません：${code}`,"err");
  }

  async function ensureZXing(){
    if(window.ZXing)return;
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";
      script.onload=resolve;script.onerror=()=>reject(new Error("バーコード読取ライブラリを読み込めませんでした。"));
      document.head.appendChild(script);
    });
  }

  async function startAppInventoryCamera(){
    if(!await ensureDraftReady())return;
    if(!requireDraft())return;
    const video=document.getElementById("appInventoryCountVideo");
    const area=document.getElementById("appInventoryCameraArea");
    if(!video||!navigator.mediaDevices?.getUserMedia){setMessage("appInventoryCameraMessage","この端末ではカメラを起動できません。","err");return;}
    try{
      await stopAppInventoryCamera(false);
      area.hidden=false;video.style.display="block";
      setMessage("appInventoryCameraMessage","カメラを起動しています。許可ダイアログが出たら許可してください。","ok");
      await ensureZXing();
      if(!appCountZXingReader){
        const hints=new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13,ZXing.BarcodeFormat.EAN_8,ZXing.BarcodeFormat.UPC_A,ZXing.BarcodeFormat.UPC_E,ZXing.BarcodeFormat.CODE_128,ZXing.BarcodeFormat.CODE_39,ZXing.BarcodeFormat.ITF]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
        appCountZXingReader=new ZXing.BrowserMultiFormatReader(hints,50);
      }
      appCountZXingRunning=true;
      await appCountZXingReader.decodeFromConstraints({video:{facingMode:{ideal:"environment"},width:{ideal:2560},height:{ideal:1440},focusMode:{ideal:"continuous"}}},video,async result=>{
        if(result&&appCountZXingRunning)await handleScannedCode(result.getText?result.getText():result.text);
      });
      if(typeof tryImproveCameraTrack==="function")tryImproveCameraTrack(video);
      if(typeof improveCameraTrack==="function")improveCameraTrack(video);
      setMessage("appInventoryCameraMessage","カメラ読取中です。赤線にバーコードを合わせてください。","ok");
    }catch(error){await stopAppInventoryCamera(false);setMessage("appInventoryCameraMessage","カメラ起動エラー\n"+error.message,"err");}
  }

  async function stopAppInventoryCamera(showMessage=true){
    appCountZXingRunning=false;
    if(appCountZXingReader){try{appCountZXingReader.reset();}catch(_){} }
    if(appCountCameraStream){appCountCameraStream.getTracks().forEach(track=>track.stop());appCountCameraStream=null;}
    const video=document.getElementById("appInventoryCountVideo");
    if(video){try{video.pause();}catch(_){} video.srcObject=null;video.style.display="none";}
    const area=document.getElementById("appInventoryCameraArea");if(area)area.hidden=true;
    if(showMessage)setMessage("appInventoryCameraMessage","カメラを終了しました。","ok");
  }

  async function bindAppInventoryCountEvents(){
    setInventoryControlsEnabled(false);
    setMessage("appInventoryCountProductInfo","棚卸データを準備中...","ok");
    document.getElementById("appInventoryApplyBtn")?.addEventListener("click",applyCurrentDraft);
    document.getElementById("appInventoryClearBtn")?.addEventListener("click",clearCurrentDraft);
    document.getElementById("appInventoryRefreshBtn")?.addEventListener("click",async()=>{
      try{
        await refreshRemote();
        renderAll();
        setMessage("appInventoryCountProductInfo","最新の保存内容を読み込みました。","ok");
      }catch(_){renderAll();}
    });
    document.getElementById("saveAppInventoryCountBtn")?.addEventListener("click",saveCount);
    document.getElementById("appInventoryCameraBtn")?.addEventListener("click",startAppInventoryCamera);
    document.getElementById("appInventoryCloseCameraBtn")?.addEventListener("click",()=>stopAppInventoryCamera(true));
    document.getElementById("appInventoryCountBarcode")?.addEventListener("input",()=>previewBarcode());
    document.getElementById("appInventoryCountBarcode")?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();saveCount();}});
    document.getElementById("appInventoryCountQty")?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();saveCount();}});
    document.getElementById("appInventoryCountSearch")?.addEventListener("input",handleSearchInput);
    const sort=document.getElementById("appInventoryProductSearchSort");
    if(sort){sort.value=getAppInventorySearchSort();sort.addEventListener("change",()=>{localStorage.setItem(APP_INVENTORY_SEARCH_SORT_KEY,sort.value||"name");handleSearchInput();});}
    document.getElementById("appInventoryCountStaff")?.addEventListener("change",event=>{
      const staff=event.target.value||"";
      if(typeof applyStoreFromStaffValue==="function")applyStoreFromStaffValue(staff);
      else if(typeof setCurrentStaffName==="function")setCurrentStaffName(staff);
      const current=document.getElementById("appInventoryCurrentStaffName");if(current)current.textContent=staff||"未選択";
      if(typeof renderScrollableStaffPicker==="function")renderScrollableStaffPicker("appInventoryCountStaff","appInventoryCountStaffPicker");
    });
    ["appInventoryHistoryNameFilter","appInventoryHistoryStaffFilter","appInventoryHistoryDateFilter"].forEach(id=>{
      document.getElementById(id)?.addEventListener("input",renderHistoryRows);
      document.getElementById(id)?.addEventListener("change",renderHistoryRows);
    });
    window.addEventListener("beforeunload",()=>stopAppInventoryCamera(false));
    await window.renderAppInventoryCount();
  }

  window.addEventListener("DOMContentLoaded",bindAppInventoryCountEvents);
})();
