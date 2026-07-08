/* ARICO TOKYO inventory app: app-inventory-count.js */
(function(){
  "use strict";

  const CURRENT_SESSION_KEY="arico_app_inventory_count_current_session_id";
  const SCAN_COOLDOWN_MS=1300;
  const STATUS_NOT_STARTED="未開始";
  const STATUS_ACTIVE="棚卸中";
  const STATUS_FINISHED="棚卸終了";
  const STATUS_COMPARED="比較済み";

  const STATUS_CLOSED="セッション終了";

  const state={
    sessions:[],
    items:[],
    historyItems:[],
    currentSessionId:"",
    diffs:[],
    duplicateGroups:[]
  };

  let appCountCameraStream=null;
  let appCountDetector=null;
  let appCountScanning=false;
  let appCountZXingReader=null;
  let appCountZXingRunning=false;
  let lastScannedCode="";
  let lastScannedAt=0;
  let selectedProduct=null;
  let searchResultCache=[];

  function safe(value){
    return typeof esc==="function" ? esc(value) : String(value??"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function nowIso(){
    return new Date().toISOString();
  }

  function normalizeKey(value){
    return String(value??"").trim().toLowerCase().replace(/\s/g,"");
  }

  function normalizeSearchText(value){
    return String(value??"")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g,"");
  }

  function formatDate(value){
    if(!value)return "";
    return typeof fmt==="function" ? fmt(value) : new Date(value).toLocaleString("ja-JP");
  }

  function getStaffValue(){
    return String(document.getElementById("appInventoryCountStaff")?.value||"").trim();
  }

  function currentSession(){
    return state.sessions.find(session=>session.id===state.currentSessionId)||null;
  }

  function hasAppInventoryAdminAccess(){
    if(typeof hasInventoryPrivilegedAccess==="function")return hasInventoryPrivilegedAccess();
    if(typeof isInventoryAdminAuthenticated==="function")return isInventoryAdminAuthenticated();
    return false;
  }

  function requireAppInventoryAdminAccess(){
    if(hasAppInventoryAdminAccess())return true;
    if(typeof showPopup==="function")showPopup("管理者限定","管理者のみ操作できます");
    if(typeof showMessage==="function")showMessage("管理者のみ操作できます","err");
    setMessage("appInventoryCountProductInfo","管理者のみ操作できます","err");
    return false;
  }

  function showEndedSessions(){
    return !!document.getElementById("appInventoryShowEndedSessions")?.checked;
  }

  function showReflectedDiffs(){
    return !!document.getElementById("appInventoryShowReflectedDiffs")?.checked;
  }

  function isClosedSession(session){
    return session?.status===STATUS_CLOSED;
  }

  function visibleSessions(){
    return state.sessions.filter(session=>showEndedSessions()||!isClosedSession(session));
  }

  function itemKey(item){
    return normalizeKey(item.product_code||item.barcode||item.product_name);
  }

  function itemDisplay(item){
    return {
      id:item.id,
      key:itemKey(item),
      barcode:item.barcode||"",
      productCode:item.product_code||item.barcode||"",
      productId:item.product_id||"",
      name:item.product_name||"",
      count:Number(item.count_qty||0),
      beforeStock:Number(item.before_stock||0),
      staff:item.staff||"",
      updatedAt:item.counted_at||item.created_at||"",
      memo:item.memo||"",
      adopted:!!item.adopted,
      reflectedAt:item.reflected_at||"",
      reflectedBy:item.reflected_by||""
    };
  }

  function setMessage(id,text,type=""){
    const node=document.getElementById(id);
    if(!node)return;
    node.textContent=text;
    node.className=`message${type?` ${type}`:""}`;
  }

  function setRemoteError(error){
    setMessage(
      "appInventoryCountProductInfo",
      "アプリ内棚卸の共有テーブルに接続できません。SQLを先に実行してください。\n"+(error?.message||error),
      "err"
    );
  }

  async function loadSessions(){
    try{
      const rows=await sbAll("inventory_count_sessions?select=*&order=started_at.desc",1000,5000);
      state.sessions=Array.isArray(rows) ? rows : [];
      const saved=localStorage.getItem(CURRENT_SESSION_KEY)||"";
      const selectable=visibleSessions();
      state.currentSessionId=selectable.some(row=>row.id===saved) ? saved : (selectable[0]?.id||"");
      if(state.currentSessionId)localStorage.setItem(CURRENT_SESSION_KEY,state.currentSessionId);
      else localStorage.removeItem(CURRENT_SESSION_KEY);
    }catch(error){
      state.sessions=[];
      state.currentSessionId="";
      setRemoteError(error);
    }
  }

  async function loadItems(){
    const session=currentSession();
    if(!session){
      state.items=[];
      return;
    }
    try{
      const rows=await sbAll(`inventory_count_items?select=*&session_id=eq.${encodeURIComponent(session.id)}&order=counted_at.desc`,1000,10000);
      state.items=Array.isArray(rows) ? rows : [];
    }catch(error){
      state.items=[];
      setRemoteError(error);
    }
  }

  async function loadHistoryItems(){
    try{
      const rows=await sbAll("inventory_count_items?select=*&order=counted_at.desc",1000,20000);
      state.historyItems=Array.isArray(rows) ? rows : [];
    }catch(_){
      state.historyItems=[];
    }
  }

  async function refreshRemote(){
    await loadSessions();
    await loadItems();
    await loadHistoryItems();
  }

  function duplicateKeySet(){
    const grouped=new Map();
    state.items.map(itemDisplay).forEach(row=>{
      if(!row.key)return;
      if(!grouped.has(row.key))grouped.set(row.key,[]);
      grouped.get(row.key).push(row);
    });
    const keys=new Set();
    grouped.forEach((rows,key)=>{
      if(rows.length>1)keys.add(key);
    });
    return keys;
  }

  function duplicateGroups(){
    const grouped=new Map();
    state.items.map(itemDisplay).forEach(row=>{
      if(!row.key)return;
      if(!grouped.has(row.key))grouped.set(row.key,[]);
      grouped.get(row.key).push(row);
    });
    return [...grouped.entries()]
      .filter(([,rows])=>rows.length>1)
      .map(([key,rows])=>({key,rows}));
  }

  function compareItems(){
    const groups=duplicateGroups();
    const duplicateKeys=new Set(groups.map(group=>group.key));
    const adoptedByKey=new Map();
    groups.forEach(group=>{
      const adopted=group.rows.find(row=>row.adopted);
      if(adopted)adoptedByKey.set(group.key,adopted);
    });
    const rows=[];
    const seen=new Set();
    state.items.map(itemDisplay).forEach(row=>{
      if(!row.key||seen.has(row.key))return;
      if(duplicateKeys.has(row.key)){
        const adopted=adoptedByKey.get(row.key);
        if(!adopted)return;
        rows.push(adopted);
      }else{
        rows.push(row);
      }
      seen.add(row.key);
    });
    state.duplicateGroups=groups.filter(group=>!adoptedByKey.has(group.key));
    return rows;
  }

  function renderStaffSelect(){
    const select=document.getElementById("appInventoryCountStaff");
    if(!select)return;
    const session=currentSession();
    const current=select.value||localStorage.getItem("arico_current_staff_name")||session?.staff||"";
    const members=Array.isArray(window.staffMembers) ? window.staffMembers : (typeof staffMembers!=="undefined" ? staffMembers : []);
    const staffLabel=member=>typeof getStaffDisplayName==="function" ? getStaffDisplayName(member) : (member.name||"");
    select.innerHTML='<option value="">担当者を選択</option>'+members.map(member=>`<option value="${safe(staffLabel(member))}">${safe(staffLabel(member))}</option>`).join("");
    if(current)select.value=current;
    if(select.value&&typeof setCurrentStaffName==="function")setCurrentStaffName(select.value);
    if(typeof renderScrollableStaffPicker==="function")renderScrollableStaffPicker("appInventoryCountStaff","appInventoryCountStaffPicker");
    const currentStaff=document.getElementById("appInventoryCurrentStaffName");
    if(currentStaff)currentStaff.textContent=select.value||"未選択";
  }

  function renderSessionControls(){
    const session=currentSession();
    const select=document.getElementById("appInventorySessionSelect");
    const selectable=visibleSessions();
    if(select){
      select.innerHTML='<option value="">セッションを選択</option>'+selectable
        .map(row=>`<option value="${safe(row.id)}">${safe(row.name)}（${safe(row.status)}）</option>`)
        .join("");
      select.value=state.currentSessionId||"";
    }
    const nameInput=document.getElementById("appInventorySessionName");
    const memoInput=document.getElementById("appInventorySessionMemo");
    if(nameInput&&!nameInput.value&&session)nameInput.value=session.name||"";
    if(memoInput&&session)memoInput.value=session.memo||"";
    const currentName=document.getElementById("appInventoryCurrentSessionName");
    if(currentName)currentName.textContent=session ? `${session.name} / ${session.status}` : "セッション未選択";
    const adminOnlyTitle=hasAppInventoryAdminAccess() ? "" : "管理者のみ操作できます";
    ["startAppInventoryCountBtn","deleteAppInventorySessionBtn","closeAppInventorySessionBtn"].forEach(id=>{
      const button=document.getElementById(id);
      if(!button)return;
      button.title=adminOnlyTitle;
      button.classList.toggle("admin-required",!hasAppInventoryAdminAccess());
    });
  }

  function renderStatus(){
    const session=currentSession();
    const badge=document.getElementById("appInventoryCountStatus");
    if(!badge)return;
    badge.className=`badge ${session?.status===STATUS_ACTIVE?"":"muted"}`;
    badge.textContent=session ? `${session.status} ${state.items.length}件` : STATUS_NOT_STARTED;
  }

  function renderCountedRows(){
    const body=document.getElementById("appInventoryCountBody");
    const summary=document.getElementById("appInventoryCountSummary");
    const dupKeys=duplicateKeySet();
    const rows=state.items.map(itemDisplay).sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
    if(summary)summary.textContent=`${rows.length}件`;
    if(!body)return;
    body.innerHTML=rows.length ? rows.map(row=>`
      <tr class="${dupKeys.has(row.key)?"app-count-duplicate-row":""}">
        <td>${safe(row.name)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.staff)}</td>
        <td>${safe(formatDate(row.updatedAt))}</td>
        <td>${dupKeys.has(row.key)?'<span class="app-count-duplicate-badge">重複あり</span>':(row.adopted?'<span class="badge muted">採用</span>':"")}</td>
      </tr>`).join("") : '<tr><td colspan="6" class="app-count-empty">カウント済み商品はありません。</td></tr>';
  }

  function renderDuplicateRows(){
    const host=document.getElementById("appInventoryDuplicateBody");
    const summary=document.getElementById("appInventoryDuplicateSummary");
    const groups=duplicateGroups();
    if(summary)summary.textContent=groups.length ? `要確認 ${groups.length}商品` : "重複なし";
    if(!host)return;
    host.innerHTML=groups.length ? groups.map(group=>group.rows.map(row=>`
      <tr>
        <td>${safe(row.name)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.staff)}</td>
        <td>${safe(formatDate(row.updatedAt))}</td>
        <td><button type="button" class="app-count-adopt-btn" data-id="${safe(row.id)}">${row.adopted?"採用中":"この数を採用"}</button></td>
      </tr>`).join("")).join("") : '<tr><td colspan="6" class="app-count-empty">重複カウントはありません。</td></tr>';
    host.querySelectorAll(".app-count-adopt-btn").forEach(button=>{
      button.onclick=()=>adoptDuplicateItem(button.dataset.id,button);
    });
  }

  function renderDiffRows(){
    const body=document.getElementById("appInventoryDiffBody");
    const summary=document.getElementById("appInventoryDiffSummary");
    if(summary){
      const duplicateText=state.duplicateGroups.length ? ` / 要確認 ${state.duplicateGroups.length}商品` : "";
      const compared=currentSession()?.status===STATUS_COMPARED||state.diffs.length;
      summary.textContent=compared ? `差異 ${state.diffs.length}件${duplicateText}` : "未比較";
    }
    if(!body)return;
    body.innerHTML=state.diffs.length ? state.diffs.map(row=>`
      <tr>
        <td>${safe(row.name)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.beforeStock)}</td>
        <td><strong class="${row.diff<0?"stock-minus":"stock-plus"}">${safe(row.diff)}</strong></td>
        <td>${row.reflectedAt?'<span class="badge muted">反映済み</span>':`<button type="button" class="app-count-update-btn" data-id="${safe(row.id)}">更新</button>`}</td>
      </tr>`).join("") : '<tr><td colspan="6" class="app-count-empty">差異のある商品はありません。</td></tr>';
    body.querySelectorAll(".app-count-update-btn").forEach(button=>{
      button.onclick=()=>updateCountedProductStock(button.dataset.id,button);
    });
  }

  function renderHistoryRows(){
    const body=document.getElementById("appInventoryHistoryBody");
    const summary=document.getElementById("appInventoryHistorySummary");
    if(!body)return;
    const nameFilter=normalizeSearchText(document.getElementById("appInventoryHistoryNameFilter")?.value||"");
    const staffFilter=normalizeSearchText(document.getElementById("appInventoryHistoryStaffFilter")?.value||"");
    const dateFilter=String(document.getElementById("appInventoryHistoryDateFilter")?.value||"").trim();
    const itemsBySession=new Map();
    state.historyItems.forEach(item=>{
      const sid=String(item.session_id||"");
      if(!sid)return;
      if(!itemsBySession.has(sid))itemsBySession.set(sid,[]);
      itemsBySession.get(sid).push(itemDisplay(item));
    });
    const rows=state.sessions.map(session=>{
      const items=itemsBySession.get(String(session.id))||[];
      const grouped=new Map();
      items.forEach(item=>{
        if(!item.key)return;
        if(!grouped.has(item.key))grouped.set(item.key,[]);
        grouped.get(item.key).push(item);
      });
      let duplicateCount=0;
      grouped.forEach(group=>{if(group.length>1)duplicateCount+=1;});
      const diffCount=items.filter(item=>Number(item.count)!==Number(item.beforeStock)).length;
      const reflectedCount=items.filter(item=>item.reflectedAt).length;
      return {session,items,duplicateCount,diffCount,reflectedCount};
    }).filter(row=>{
      const session=row.session;
      const targetDate=[session.started_at,session.finished_at,session.ended_at,session.created_at].filter(Boolean).map(value=>String(value).slice(0,10));
      if(nameFilter&&!normalizeSearchText(session.name).includes(nameFilter))return false;
      if(staffFilter&&!normalizeSearchText(session.staff).includes(staffFilter))return false;
      if(dateFilter&&!targetDate.includes(dateFilter))return false;
      return true;
    });
    if(summary)summary.textContent=`${rows.length}件`;
    body.innerHTML=rows.length ? rows.map(row=>`
      <tr>
        <td>${safe(row.session.name||"")}</td>
        <td>${safe(row.session.staff||"")}</td>
        <td>${safe(formatDate(row.session.started_at))}</td>
        <td>${safe(formatDate(row.session.finished_at))}</td>
        <td>${safe(formatDate(row.session.ended_at))}</td>
        <td>${safe(row.items.length)}</td>
        <td>${safe(row.duplicateCount)}</td>
        <td>${safe(row.diffCount)}</td>
        <td>${safe(row.reflectedCount)}</td>
        <td>${safe(row.session.status||"")}</td>
      </tr>`).join("") : '<tr><td colspan="10" class="app-count-empty">棚卸履歴はありません。</td></tr>';
  }

  function renderAll(){
    renderStaffSelect();
    renderSessionControls();
    renderStatus();
    renderCountedRows();
    renderDuplicateRows();
    renderDiffRows();
    renderHistoryRows();
  }

  window.renderAppInventoryCount=async function(){
    await refreshRemote();
    renderAll();
  };

  function requireSession(){
    const session=currentSession();
    if(!session||session.status!==STATUS_ACTIVE){
      setMessage("appInventoryCountProductInfo","棚卸中のセッションを選択してから登録してください。","err");
      return false;
    }
    return true;
  }

  function defaultSessionName(){
    const date=new Date();
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,"0");
    const d=String(date.getDate()).padStart(2,"0");
    const hh=String(date.getHours()).padStart(2,"0");
    const mm=String(date.getMinutes()).padStart(2,"0");
    return `${y}/${m}/${d} ${hh}:${mm} 棚卸`;
  }

  async function startCount(){
    if(!requireAppInventoryAdminAccess())return;
    const staff=getStaffValue();
    const name=String(document.getElementById("appInventorySessionName")?.value||"").trim()||defaultSessionName();
    const memo=String(document.getElementById("appInventorySessionMemo")?.value||"").trim();
    if(!staff){
      setMessage("appInventoryCountProductInfo","担当者を選択してください。","err");
      document.getElementById("appInventoryCountStaff")?.focus();
      return;
    }
    try{
      const inserted=await sb("inventory_count_sessions",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({name,staff,memo,status:STATUS_ACTIVE,started_at:nowIso()})
      });
      const session=Array.isArray(inserted) ? inserted[0] : inserted;
      state.currentSessionId=session.id;
      localStorage.setItem(CURRENT_SESSION_KEY,state.currentSessionId);
      state.diffs=[];
      state.duplicateGroups=[];
      await refreshRemote();
      clearScanForm("棚卸を開始しました。商品をスキャンまたは検索してください。","ok");
      renderAll();
    }catch(error){
      setRemoteError(error);
    }
  }

  async function finishCount(){
    const session=currentSession();
    if(!session){
      setMessage("appInventoryCountProductInfo","終了するセッションがありません。","err");
      return;
    }
    if(session.status!==STATUS_ACTIVE){
      setMessage("appInventoryCountCsvInfo","このセッションは棚卸終了済みです。差異比較を実行できます。","ok");
      return;
    }
    if(!state.items.length){
      setMessage("appInventoryCountProductInfo","カウント済み商品がありません。","err");
      return;
    }
    try{
      await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({status:STATUS_FINISHED,finished_at:nowIso(),memo:document.getElementById("appInventorySessionMemo")?.value||session.memo||""})
      });
      await refreshRemote();
      setMessage("appInventoryCountCsvInfo","棚卸を終了しました。差異比較を押すと、カウント数と棚卸前在庫を比較します。","ok");
      renderAll();
    }catch(error){
      setRemoteError(error);
    }
  }

  async function deleteCurrentSession(){
    if(!requireAppInventoryAdminAccess())return;
    const session=currentSession();
    if(!session){
      setMessage("appInventoryCountProductInfo","削除するセッションを選択してください。","err");
      return;
    }
    const ok=confirm(`棚卸セッション『${session.name}』を削除します。このセッションのカウント履歴も削除されます。よろしいですか？`);
    if(!ok)return;
    try{
      await stopAppInventoryCamera(false);
      await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}`,{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      state.currentSessionId="";
      state.items=[];
      state.diffs=[];
      state.duplicateGroups=[];
      localStorage.removeItem(CURRENT_SESSION_KEY);
      await refreshRemote();
      clearScanForm(`棚卸セッション『${session.name}』を削除しました。`,"ok");
      setMessage("appInventoryCountCsvInfo","選択中セッションの差異一覧をクリアしました。","ok");
      renderAll();
    }catch(error){
      setRemoteError(error);
    }
  }

  async function closeCurrentSession(){
    if(!requireAppInventoryAdminAccess())return;
    const session=currentSession();
    if(!session){
      setMessage("appInventoryCountCsvInfo","終了するセッションを選択してください。","err");
      return;
    }
    if(session.status===STATUS_ACTIVE){
      setMessage("appInventoryCountCsvInfo","先に棚卸終了を押してからセッション終了してください。","err");
      return;
    }
    if(isClosedSession(session)){
      setMessage("appInventoryCountCsvInfo","このセッションは終了済みです。","ok");
      return;
    }
    const ok=confirm("この棚卸セッションを終了します。通常のセッション一覧には表示されなくなります。よろしいですか？");
    if(!ok)return;
    try{
      await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({status:STATUS_CLOSED,ended_at:nowIso()})
      });
      state.currentSessionId="";
      state.items=[];
      state.diffs=[];
      state.duplicateGroups=[];
      localStorage.removeItem(CURRENT_SESSION_KEY);
      await refreshRemote();
      setMessage("appInventoryCountCsvInfo","セッション終了にしました。通常一覧では非表示になります。","ok");
      renderAll();
    }catch(error){
      setRemoteError(error);
    }
  }

  async function findProductsByName(keyword){
    keyword=String(keyword||"").trim();
    if(!keyword)return [];
    const normalizedKeyword=normalizeSearchText(keyword);
    const localRows=[];
    const localProducts=Array.isArray(window.products) ? window.products : (typeof products!=="undefined"&&Array.isArray(products) ? products : []);
    localProducts.forEach(row=>{
      if(!row)return;
      const values=Object.values(row).filter(value=>["string","number"].includes(typeof value));
      const haystack=normalizeSearchText(values.join(" "));
      if(haystack.includes(normalizedKeyword))localRows.push(row);
    });
    if(typeof searchProductsByName==="function"){
      const remoteRows=await searchProductsByName(keyword).catch(()=>[]);
      const merged=[...localRows,...(Array.isArray(remoteRows)?remoteRows:[])];
      const seen=new Set();
      return merged.filter(row=>{
        const key=String(row?.barcode||row?.smaregi_product_id||row?.name||"");
        if(!key||seen.has(key))return false;
        seen.add(key);
        return true;
      }).slice(0,80);
    }
    const q=encodeURIComponent(`*${keyword}*`);
    const rows=await sb(`products?select=*&or=(name.ilike.${q},barcode.ilike.${q},smaregi_product_id.ilike.${q})&order=name.asc&limit=120`).catch(()=>[]);
    if(Array.isArray(rows)){
      rows.forEach(row=>{if(row&&row.barcode&&!gp(row.barcode))products.push(row);});
      const merged=[...localRows,...rows];
      const seen=new Set();
      return merged.filter(row=>{
        const key=String(row?.barcode||row?.smaregi_product_id||row?.name||"");
        if(!key||seen.has(key))return false;
        seen.add(key);
        return true;
      }).slice(0,80);
    }
    return localRows.slice(0,80);
  }

  async function findProductByCode(code){
    code=String(code||"").trim();
    if(!code)return null;
    let product=await fetchProductByBarcode(code).catch(()=>null);
    if(product)return product;
    const rows=await sbAll(`products?select=*&barcode=eq.${encodeURIComponent(code)}`,1000,1).catch(()=>[]);
    product=Array.isArray(rows)&&rows[0] ? rows[0] : null;
    if(product&&product.barcode&&!gp(product.barcode))products.push(product);
    return product;
  }

  function showProduct(product,resetQty=false){
    if(!product)return;
    if(resetQty)document.getElementById("appInventoryCountQty").value="";
    setMessage(
      "appInventoryCountProductInfo",
      `商品名：${product.name||""}\nバーコード：${product.barcode||""}\n現在のアプリ在庫：${Number(product.base_stock||0)}`,
      "ok"
    );
  }

  async function previewBarcode(resetQty=false){
    const code=String(document.getElementById("appInventoryCountBarcode")?.value||"").trim();
    if(!code){
      if(selectedProduct){
        showProduct(selectedProduct,resetQty);
        return selectedProduct;
      }
      setMessage("appInventoryCountProductInfo",currentSession()?.status===STATUS_ACTIVE?"商品をスキャンまたは検索してください。":"棚卸開始後、商品をスキャンまたは検索してください。");
      return null;
    }
    selectedProduct=null;
    const product=await findProductByCode(code);
    if(!product){
      setMessage("appInventoryCountProductInfo",`未登録バーコード：${code}\nバーコードがない商品は商品名検索から選択してください。`,"err");
      return null;
    }
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
    if(results)results.innerHTML="";
    selectedProduct=null;
    if(message)setMessage("appInventoryCountProductInfo",message,type);
    barcode?.focus();
  }

  async function saveCount(){
    if(!requireSession())return;
    const product=selectedProduct||await previewBarcode();
    if(!product)return;
    const staff=getStaffValue();
    if(!staff){
      setMessage("appInventoryCountProductInfo","担当者を選択してください。","err");
      if(typeof showMessage==="function")showMessage("担当者を選択してください。","err");
      return;
    }
    const qtyRaw=String(document.getElementById("appInventoryCountQty")?.value??"").trim();
    if(qtyRaw===""){
      setMessage("appInventoryCountProductInfo","カウント数を入力してください","err");
      if(typeof showMessage==="function")showMessage("カウント数を入力してください","err");
      document.getElementById("appInventoryCountQty")?.focus();
      return;
    }
    const qty=Number(qtyRaw);
    if(!Number.isInteger(qty)||qty<0){
      setMessage("appInventoryCountProductInfo","カウント数は0以上の整数で入力してください。","err");
      return;
    }
    const session=currentSession();
    try{
      await sb("inventory_count_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          session_id:session.id,
          product_code:String(product.barcode||""),
          barcode:String(product.barcode||""),
          product_id:String(product.smaregi_product_id||""),
          product_name:product.name||"",
          count_qty:qty,
          before_stock:Number(product.base_stock||0),
          staff,
          memo:"",
          counted_at:nowIso(),
          adopted:false
        })
      });
      state.diffs=[];
      state.duplicateGroups=[];
      await loadItems();
      renderAll();
      clearScanForm(`登録しました：${product.name||""} / ${qty}`);
    }catch(error){
      setRemoteError(error);
    }
  }

  async function compareCountedWithAppStock(){
    const session=currentSession();
    if(!session){
      setMessage("appInventoryCountCsvInfo","比較するセッションを選択してください。","err");
      return;
    }
    if(session.status===STATUS_ACTIVE){
      setMessage("appInventoryCountCsvInfo","棚卸終了後に比較してください。","err");
      return;
    }
    await loadItems();
    const compareRows=compareItems();
    if(!compareRows.length){
      setMessage("appInventoryCountCsvInfo","比較できるカウント済み商品がありません。重複がある場合は採用するカウントを選んでください。","err");
      renderAll();
      return;
    }
    if(state.duplicateGroups.length){
      setMessage("appInventoryCountCsvInfo",`重複カウントが ${state.duplicateGroups.length} 商品あります。採用するカウントを選んでから再度比較してください。`,"err");
      renderAll();
      return;
    }
    state.diffs=[];
    compareRows.forEach(counted=>{
      const beforeStock=Number(counted.beforeStock||0);
      const diff=Number(counted.count)-beforeStock;
      if(diff===0)return;
      if(counted.reflectedAt&&!showReflectedDiffs())return;
      state.diffs.push({
        ...counted,
        beforeStock,
        diff
      });
    });
    await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({status:STATUS_COMPARED,compared_at:nowIso()})
    }).catch(()=>{});
    await loadSessions();
    setMessage("appInventoryCountCsvInfo",`比較完了：差異 ${state.diffs.length}件。カウント数と棚卸前在庫だけを比較しています。`,"ok");
    renderAll();
  }

  async function adoptDuplicateItem(itemId,button){
    const row=state.items.find(item=>String(item.id)===String(itemId));
    if(!row)return;
    const key=itemKey(row);
    const same=state.items.filter(item=>itemKey(item)===key);
    try{
      if(button)button.disabled=true;
      await Promise.all(same.map(item=>sb(`inventory_count_items?id=eq.${encodeURIComponent(item.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({adopted:String(item.id)===String(itemId)})
      })));
      await loadItems();
      state.diffs=[];
      state.duplicateGroups=[];
      renderAll();
      setMessage("appInventoryCountCsvInfo","採用するカウントを保存しました。差異比較を再実行してください。","ok");
    }catch(error){
      if(button)button.disabled=false;
      setRemoteError(error);
    }
  }

  async function updateCountedProductStock(itemId,button){
    const row=state.diffs.find(item=>String(item.id)===String(itemId));
    if(!row)return;
    const session=currentSession();
    const staff=getStaffValue()||row.staff||session?.staff;
    if(!staff){
      setMessage("appInventoryCountCsvInfo","担当者を選択してください。","err");
      return;
    }
    const product=await findProductByCode(row.barcode||row.productCode);
    if(!product){
      setMessage("appInventoryCountCsvInfo",`商品が見つかりません：${row.barcode||row.productCode}`,"err");
      return;
    }
    const before=Number(product.base_stock||0);
    const after=Number(row.count||0);
    const diff=after-before;
    const ok=confirm(`この商品だけアプリ在庫を更新します。\n\n商品名：${row.name}\nバーコード：${row.barcode||row.productCode}\n更新前在庫：${before}\n更新後在庫：${after}\n差分：${diff}\n\n実行しますか？`);
    if(!ok)return;
    try{
      if(button)button.disabled=true;
      await updateProductCurrentStock(product.barcode,after);
      const memo=`アプリ内棚卸 / セッション:${session?.name||""} / 棚卸前在庫:${row.beforeStock} / 更新前:${before} / 更新後:${after} / バーコード:${row.barcode||row.productCode}`;
      const inserted=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({type:"在庫修正",staff,barcode:product.barcode,product_name:row.name,quantity:diff,memo})
      });
      const savedLog=Array.isArray(inserted)&&inserted[0] ? inserted[0] : null;
      try{
        if(Array.isArray(logs))logs.unshift(savedLog||{created_at:nowIso(),type:"在庫修正",staff,barcode:product.barcode,product_name:row.name,quantity:diff,memo});
      }catch(_){}
      await sb(`inventory_count_items?id=eq.${encodeURIComponent(row.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({reflected_at:nowIso(),reflected_by:staff})
      });
      state.diffs=state.diffs.filter(item=>String(item.id)!==String(row.id));
      await loadItems();
      renderAll();
      if(typeof renderGlobalHistory==="function")renderGlobalHistory();
      setMessage("appInventoryCountCsvInfo",`更新完了：${row.name} / ${before} → ${after}`,"ok");
    }catch(error){
      if(button)button.disabled=false;
      setMessage("appInventoryCountCsvInfo","更新エラー\n"+error.message,"err");
    }
  }

  async function handleSearchInput(){
    const host=document.getElementById("appInventoryCountSearchResults");
    const keyword=document.getElementById("appInventoryCountSearch")?.value||"";
    if(!host)return;
    if(String(keyword).trim().length<2){
      host.innerHTML="";
      return;
    }
    const rows=await findProductsByName(keyword);
    searchResultCache=rows.slice(0,20);
    host.innerHTML=searchResultCache.length ? searchResultCache.map((row,index)=>`
      <div class="product-search-item" data-index="${safe(index)}">
        <div>
          <strong>${safe(row.name)}</strong>
          <span>バーコード：${safe(row.barcode||"なし")} / 現在のアプリ在庫：${safe(Number(row.base_stock||0))}</span>
        </div>
        <button type="button">選択</button>
      </div>
    `).join("") : '<div class="product-search-item"><strong>該当商品なし</strong><span>別のキーワードで検索してください</span></div>';
    host.classList.add("is-active");
    host.querySelectorAll(".product-search-item[data-index]").forEach(item=>{
      item.onclick=()=>{
        selectedProduct=searchResultCache[Number(item.dataset.index)]||null;
        const barcodeInput=document.getElementById("appInventoryCountBarcode");
        const searchInput=document.getElementById("appInventoryCountSearch");
        if(barcodeInput)barcodeInput.value=selectedProduct?.barcode||"";
        if(searchInput)searchInput.value="";
        host.classList.remove("is-active");
        host.innerHTML="";
        if(selectedProduct)showProduct(selectedProduct,true);
        document.getElementById("appInventoryCountQty")?.focus();
      };
    });
  }

  function isDuplicateScan(code){
    const now=Date.now();
    if(code===lastScannedCode&&now-lastScannedAt<SCAN_COOLDOWN_MS)return true;
    lastScannedCode=code;
    lastScannedAt=now;
    return false;
  }

  async function handleAppInventoryScannedCode(code){
    code=String(code||"").trim();
    if(!code||isDuplicateScan(code))return;
    const input=document.getElementById("appInventoryCountBarcode");
    if(input)input.value=code;
    const product=await previewBarcode(true);
    if(product){
      await stopAppInventoryCamera(false);
      document.getElementById("appInventoryCountQty")?.focus();
      setMessage("appInventoryCameraMessage","読み取りました。カメラを停止しました。カウント数を入力してください。","ok");
    }else{
      setMessage("appInventoryCameraMessage",`読み取りましたが商品が見つかりません：${code}`,"err");
    }
  }

  async function startAppInventoryCamera(){
    if(!requireSession())return;
    const video=document.getElementById("appInventoryCountVideo");
    const area=document.getElementById("appInventoryCameraArea");
    if(!video||!navigator.mediaDevices?.getUserMedia){
      setMessage("appInventoryCameraMessage","この端末ではカメラを起動できません。HTTPS接続とカメラ許可を確認してください。","err");
      return;
    }
    try{
      await stopAppInventoryCamera(false);
      area.hidden=false;
      video.style.display="block";
      setMessage("appInventoryCameraMessage","カメラを起動しています。許可ダイアログが出たら許可してください。","ok");
      await ensureZXing();
      if(!window.ZXing)throw new Error("バーコード読取ライブラリを読み込めませんでした。");
      if(!appCountZXingReader){
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
        appCountZXingReader=new ZXing.BrowserMultiFormatReader(hints,50);
      }
      appCountZXingRunning=true;
      await appCountZXingReader.decodeFromConstraints(
        {video:{
          facingMode:{ideal:"environment"},
          width:{ideal:2560},
          height:{ideal:1440},
          focusMode:{ideal:"continuous"},
          exposureMode:{ideal:"continuous"}
        }},
        video,
        async(result)=>{
          if(result&&appCountZXingRunning){
            await handleAppInventoryScannedCode(result.getText ? result.getText() : result.text);
          }
        }
      );
      if(typeof tryImproveCameraTrack==="function")tryImproveCameraTrack(video);
      if(typeof improveCameraTrack==="function")improveCameraTrack(video);
      setMessage("appInventoryCameraMessage","カメラ読取中です。赤線にバーコードを横向きで合わせてください。","ok");
    }catch(error){
      await stopAppInventoryCamera(false);
      setMessage("appInventoryCameraMessage","カメラ起動エラー\nHTTPS接続、ブラウザのカメラ許可、別アプリでカメラを使用していないか確認してください。\n"+error.message,"err");
    }
  }

  async function stopAppInventoryCamera(showMessage=true){
    appCountScanning=false;
    appCountZXingRunning=false;
    if(appCountZXingReader){
      try{appCountZXingReader.reset();}catch(_){}
    }
    if(appCountCameraStream){
      appCountCameraStream.getTracks().forEach(track=>track.stop());
      appCountCameraStream=null;
    }
    const video=document.getElementById("appInventoryCountVideo");
    if(video){
      try{video.pause();}catch(_){}
      video.srcObject=null;
      video.style.display="none";
    }
    const area=document.getElementById("appInventoryCameraArea");
    if(area)area.hidden=true;
    if(showMessage)setMessage("appInventoryCameraMessage","カメラを終了しました。","ok");
  }

  function bindAppInventoryCountEvents(){
    document.getElementById("startAppInventoryCountBtn")?.addEventListener("click",startCount);
    document.getElementById("finishAppInventoryCountBtn")?.addEventListener("click",finishCount);
    document.getElementById("deleteAppInventorySessionBtn")?.addEventListener("click",deleteCurrentSession);
    document.getElementById("closeAppInventorySessionBtn")?.addEventListener("click",closeCurrentSession);
    document.getElementById("saveAppInventoryCountBtn")?.addEventListener("click",saveCount);
    document.getElementById("compareAppInventoryCountBtn")?.addEventListener("click",compareCountedWithAppStock);
    document.getElementById("appInventoryCameraBtn")?.addEventListener("click",startAppInventoryCamera);
    document.getElementById("appInventoryCloseCameraBtn")?.addEventListener("click",()=>stopAppInventoryCamera(true));
    document.getElementById("appInventoryCountBarcode")?.addEventListener("input",()=>previewBarcode());
    document.getElementById("appInventoryCountBarcode")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        event.preventDefault();
        saveCount();
      }
    });
    document.getElementById("appInventoryCountQty")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        event.preventDefault();
        saveCount();
      }
    });
    document.getElementById("appInventoryCountSearch")?.addEventListener("input",handleSearchInput);
    document.getElementById("appInventoryCountStaff")?.addEventListener("change",event=>{
      const staff=event.target.value||"";
      if(typeof applyStoreFromStaffValue==="function")applyStoreFromStaffValue(staff);
      else if(typeof setCurrentStaffName==="function")setCurrentStaffName(staff);
      const currentStaff=document.getElementById("appInventoryCurrentStaffName");
      if(currentStaff)currentStaff.textContent=staff||"未選択";
      if(typeof renderScrollableStaffPicker==="function")renderScrollableStaffPicker("appInventoryCountStaff","appInventoryCountStaffPicker");
    });
    ["appInventoryHistoryNameFilter","appInventoryHistoryStaffFilter","appInventoryHistoryDateFilter"].forEach(id=>{
      document.getElementById(id)?.addEventListener("input",renderHistoryRows);
      document.getElementById(id)?.addEventListener("change",renderHistoryRows);
    });
    document.getElementById("appInventoryShowEndedSessions")?.addEventListener("change",async ()=>{
      await refreshRemote();
      state.diffs=[];
      state.duplicateGroups=[];
      renderAll();
    });
    document.getElementById("appInventoryShowReflectedDiffs")?.addEventListener("change",()=>{
      if(currentSession())compareCountedWithAppStock();
      else renderAll();
    });
    document.getElementById("appInventorySessionSelect")?.addEventListener("change",async event=>{
      state.currentSessionId=event.target.value||"";
      localStorage.setItem(CURRENT_SESSION_KEY,state.currentSessionId);
      state.diffs=[];
      state.duplicateGroups=[];
      const session=currentSession();
      const nameInput=document.getElementById("appInventorySessionName");
      const memoInput=document.getElementById("appInventorySessionMemo");
      if(nameInput)nameInput.value=session?.name||"";
      if(memoInput)memoInput.value=session?.memo||"";
      await loadItems();
      renderAll();
    });
    window.addEventListener("beforeunload",()=>stopAppInventoryCamera(false));
    renderAppInventoryCount();
  }

  window.addEventListener("DOMContentLoaded",bindAppInventoryCountEvents);
})();
