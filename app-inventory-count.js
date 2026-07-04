/* ARICO TOKYO inventory app: app-inventory-count.js */
(function(){
  "use strict";

  const CURRENT_SESSION_KEY="arico_app_inventory_count_current_session_id";
  const SCAN_COOLDOWN_MS=1300;
  const STATUS_NOT_STARTED="未開始";
  const STATUS_ACTIVE="棚卸中";
  const STATUS_FINISHED="棚卸終了";
  const STATUS_COMPARED="比較済み";

  const state={
    sessions:[],
    items:[],
    currentSessionId:"",
    csvRows:[],
    csvHeaderInfo:null,
    diffs:[],
    unmatched:[],
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

  function normalizeTextKey(value){
    return String(value??"").trim().toLowerCase().replace(/\s+/g,"");
  }

  function numberValue(value){
    const text=String(value??"").replace(/,/g,"").trim();
    if(text==="")return null;
    const number=Number(text);
    return Number.isFinite(number) ? number : null;
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
      staff:item.staff||"",
      updatedAt:item.counted_at||item.created_at||"",
      memo:item.memo||"",
      adopted:!!item.adopted
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
      state.currentSessionId=state.sessions.some(row=>row.id===saved) ? saved : (state.sessions[0]?.id||"");
      if(state.currentSessionId)localStorage.setItem(CURRENT_SESSION_KEY,state.currentSessionId);
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

  async function refreshRemote(){
    await loadSessions();
    await loadItems();
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
    const current=select.value||session?.staff||localStorage.getItem("arico_current_staff_name")||"";
    const members=Array.isArray(window.staffMembers) ? window.staffMembers : (typeof staffMembers!=="undefined" ? staffMembers : []);
    const staffLabel=member=>typeof getStaffDisplayName==="function" ? getStaffDisplayName(member) : (member.name||"");
    select.innerHTML='<option value="">担当者を選択</option>'+members.map(member=>`<option value="${safe(staffLabel(member))}">${safe(staffLabel(member))}</option>`).join("");
    if(current)select.value=current;
  }

  function renderSessionControls(){
    const session=currentSession();
    const select=document.getElementById("appInventorySessionSelect");
    if(select){
      select.innerHTML='<option value="">セッションを選択</option>'+state.sessions
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
        <td>${safe(row.productCode)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.staff)}</td>
        <td>${safe(formatDate(row.updatedAt))}</td>
        <td>${dupKeys.has(row.key)?'<span class="app-count-duplicate-badge">重複あり</span>':(row.adopted?'<span class="badge muted">採用</span>':"")}</td>
      </tr>`).join("") : '<tr><td colspan="7" class="app-count-empty">カウント済み商品はありません。</td></tr>';
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
        <td>${safe(row.productCode)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.staff)}</td>
        <td>${safe(formatDate(row.updatedAt))}</td>
        <td><button type="button" class="app-count-adopt-btn" data-id="${safe(row.id)}">${row.adopted?"採用中":"この数を採用"}</button></td>
      </tr>`).join("")).join("") : '<tr><td colspan="7" class="app-count-empty">重複カウントはありません。</td></tr>';
    host.querySelectorAll(".app-count-adopt-btn").forEach(button=>{
      button.onclick=()=>adoptDuplicateItem(button.dataset.id,button);
    });
  }

  function renderDiffRows(){
    const body=document.getElementById("appInventoryDiffBody");
    const summary=document.getElementById("appInventoryDiffSummary");
    if(summary){
      const duplicateText=state.duplicateGroups.length ? ` / 要確認 ${state.duplicateGroups.length}商品` : "";
      const unmatchedText=state.unmatched.length ? ` / CSV該当なし ${state.unmatched.length}件` : "";
      summary.textContent=state.csvRows.length ? `差異 ${state.diffs.length}件${duplicateText}${unmatchedText}` : "未比較";
    }
    if(!body)return;
    body.innerHTML=state.diffs.length ? state.diffs.map(row=>`
      <tr>
        <td>${safe(row.name)}</td>
        <td>${safe(row.productCode)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.smaregiStock)}</td>
        <td><strong class="${row.diff<0?"stock-minus":"stock-plus"}">${safe(row.diff)}</strong></td>
        <td><button type="button" class="app-count-update-btn" data-id="${safe(row.id)}">更新</button></td>
      </tr>`).join("") : '<tr><td colspan="7" class="app-count-empty">差異のある商品はありません。</td></tr>';
    body.querySelectorAll(".app-count-update-btn").forEach(button=>{
      button.onclick=()=>updateCountedProductStock(button.dataset.id,button);
    });
  }

  function renderAll(){
    renderStaffSelect();
    renderSessionControls();
    renderStatus();
    renderCountedRows();
    renderDuplicateRows();
    renderDiffRows();
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
      state.csvRows=[];
      state.csvHeaderInfo=null;
      state.diffs=[];
      state.unmatched=[];
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
      setMessage("appInventoryCountCsvInfo","このセッションは棚卸終了済みです。CSVを読み込んで比較してください。","ok");
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
      setMessage("appInventoryCountCsvInfo","棚卸を終了しました。スマレジ在庫一覧CSVを読み込んでください。","ok");
      renderAll();
    }catch(error){
      setRemoteError(error);
    }
  }

  async function findProductsByName(keyword){
    keyword=String(keyword||"").trim();
    if(!keyword)return [];
    if(typeof searchProductsByName==="function"){
      return await searchProductsByName(keyword);
    }
    const q=encodeURIComponent(`*${keyword}*`);
    const rows=await sb(`products?select=*&name=ilike.${q}&order=name.asc&limit=80`).catch(()=>[]);
    if(Array.isArray(rows)){
      rows.forEach(row=>{if(row&&row.barcode&&!gp(row.barcode))products.push(row);});
      return rows;
    }
    return [];
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
    if(resetQty)document.getElementById("appInventoryCountQty").value="1";
    setMessage(
      "appInventoryCountProductInfo",
      `商品名：${product.name||""}\n商品コード：${product.barcode||""}\nバーコード：${product.barcode||""}`,
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
      setMessage("appInventoryCountProductInfo",`未登録バーコード・商品コード：${code}\nバーコードがない商品は商品名検索から選択してください。`,"err");
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
    if(qty)qty.value="1";
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
      return;
    }
    const qty=Number(document.getElementById("appInventoryCountQty")?.value||0);
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
          staff,
          memo:"",
          counted_at:nowIso(),
          adopted:false
        })
      });
      state.csvRows=[];
      state.csvHeaderInfo=null;
      state.diffs=[];
      state.unmatched=[];
      state.duplicateGroups=[];
      await loadItems();
      renderAll();
      clearScanForm(`登録しました：${product.name||""} / ${qty}`);
    }catch(error){
      setRemoteError(error);
    }
  }

  function headersToMap(headers){
    const normalized=headers.map(normalizeKey);
    const findIndex=aliases=>aliases.map(normalizeKey).map(key=>normalized.indexOf(key)).find(idx=>idx>=0) ?? -1;
    return {
      productId:findIndex(["商品ID","productid","product_id","id"]),
      productCode:findIndex(["商品コード","productcode","product_code","code"]),
      barcode:findIndex(["バーコード","JAN","JANコード","jancode","jan_code"]),
      name:findIndex(["商品名","productname","product_name","name","品名"]),
      color:findIndex(["カラー","color"]),
      size:findIndex(["サイズ","size"]),
      stock:findIndex(["在庫数","在庫","stock","stock_quantity","quantity"]),
      headers
    };
  }

  function parseSmaregiInventoryCsv(text){
    const parsed=typeof parseCsv==="function" ? parseCsv(text) : [];
    if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
    const headers=parsed[0].map(value=>String(value||"").trim());
    const map=headersToMap(headers);
    const required=[];
    if(map.productCode<0)required.push("商品コード");
    if(map.name<0)required.push("商品名");
    if(map.stock<0)required.push("在庫数");
    if(required.length)throw new Error(`必要なヘッダーが不足しています：${required.join("、")}`);
    const rows=[];
    for(let i=1;i<parsed.length;i+=1){
      const row=parsed[i];
      const productCode=String(row[map.productCode]??"").trim();
      const productId=map.productId>=0 ? String(row[map.productId]??"").trim() : "";
      const barcode=map.barcode>=0 ? String(row[map.barcode]??"").trim() : "";
      const name=String(row[map.name]??"").trim();
      const color=map.color>=0 ? String(row[map.color]??"").trim() : "";
      const size=map.size>=0 ? String(row[map.size]??"").trim() : "";
      const stock=numberValue(row[map.stock]);
      if(!productCode&&!productId&&!barcode&&!name)continue;
      rows.push({productCode,productId,barcode,name,color,size,stock:Number(stock||0),raw:row});
    }
    const used=new Set([map.productId,map.productCode,map.barcode,map.name,map.color,map.size,map.stock].filter(idx=>idx>=0).map(idx=>headers[idx]));
    state.csvHeaderInfo={
      headers,
      used:[...used],
      unused:headers.filter(header=>!used.has(header)),
      missing:[map.barcode<0?"バーコード(JAN)":null].filter(Boolean)
    };
    return rows;
  }

  function makeCsvIndexes(rows){
    const byProductCode=new Map();
    const byProductId=new Map();
    const byBarcode=new Map();
    const byNameDetail=new Map();
    rows.forEach(row=>{
      const productCodeKey=normalizeKey(row.productCode);
      const productIdKey=normalizeKey(row.productId);
      const barcodeKey=normalizeKey(row.barcode);
      if(productCodeKey&&!byProductCode.has(productCodeKey))byProductCode.set(productCodeKey,row);
      if(productIdKey&&!byProductId.has(productIdKey))byProductId.set(productIdKey,row);
      if(barcodeKey&&!byBarcode.has(barcodeKey))byBarcode.set(barcodeKey,row);
      const detail=normalizeTextKey(`${row.name}${row.color}${row.size}`);
      if(detail&&!byNameDetail.has(detail))byNameDetail.set(detail,row);
      const nameKey=normalizeTextKey(row.name);
      if(nameKey&&!byNameDetail.has(nameKey))byNameDetail.set(nameKey,row);
    });
    return {byProductCode,byProductId,byBarcode,byNameDetail};
  }

  function findCsvRowForCount(counted,indexes){
    return indexes.byProductCode.get(normalizeKey(counted.productCode))
      || indexes.byProductCode.get(normalizeKey(counted.barcode))
      || indexes.byProductId.get(normalizeKey(counted.productId))
      || indexes.byBarcode.get(normalizeKey(counted.barcode))
      || indexes.byNameDetail.get(normalizeTextKey(counted.name))
      || null;
  }

  async function loadSmaregiInventoryCsv(file){
    if(!file)return;
    try{
      const buffer=await file.arrayBuffer();
      const text=typeof decodeCsvBuffer==="function" ? decodeCsvBuffer(buffer) : new TextDecoder("utf-8").decode(buffer);
      state.csvRows=parseSmaregiInventoryCsv(text);
      state.diffs=[];
      state.unmatched=[];
      state.duplicateGroups=[];
      setMessage("appInventoryCountCsvInfo",`CSV読込完了：${state.csvRows.length}行 / 利用列：${state.csvHeaderInfo.used.join("、")}`,"ok");
      renderDiffRows();
    }catch(error){
      setMessage("appInventoryCountCsvInfo","CSV読込エラー\n"+error.message,"err");
    }
  }

  async function compareCountedWithCsv(){
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
    if(!state.csvRows.length){
      setMessage("appInventoryCountCsvInfo","スマレジ在庫一覧CSVを読み込んでください。","err");
      return;
    }
    const indexes=makeCsvIndexes(state.csvRows);
    state.diffs=[];
    state.unmatched=[];
    compareRows.forEach(counted=>{
      const csvRow=findCsvRowForCount(counted,indexes);
      if(!csvRow){
        state.unmatched.push(counted);
        return;
      }
      const diff=Number(counted.count)-Number(csvRow.stock);
      if(diff===0)return;
      state.diffs.push({
        ...counted,
        productCode:csvRow.productCode||counted.productCode||counted.barcode,
        productId:csvRow.productId||counted.productId||"",
        smaregiStock:Number(csvRow.stock||0),
        diff
      });
    });
    await sb(`inventory_count_sessions?id=eq.${encodeURIComponent(session.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({status:STATUS_COMPARED,compared_at:nowIso()})
    }).catch(()=>{});
    await loadSessions();
    setMessage("appInventoryCountCsvInfo",`比較完了：差異 ${state.diffs.length}件 / CSV該当なし ${state.unmatched.length}件。未カウント商品とCSVだけの商品は対象外です。`,"ok");
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
      state.unmatched=[];
      state.duplicateGroups=[];
      renderAll();
      setMessage("appInventoryCountCsvInfo","採用するカウントを保存しました。CSV比較を再実行してください。","ok");
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
    const ok=confirm(`この商品だけアプリ在庫を更新します。\n\n商品名：${row.name}\n商品コード：${row.productCode}\n更新前在庫：${before}\n更新後在庫：${after}\n差分：${diff}\n\n実行しますか？`);
    if(!ok)return;
    try{
      if(button)button.disabled=true;
      await updateProductCurrentStock(product.barcode,after);
      const memo=`アプリ内棚卸 / セッション:${session?.name||""} / 更新前:${before} / 更新後:${after} / スマレジ在庫:${row.smaregiStock} / 商品コード:${row.productCode}`;
      const inserted=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({type:"在庫修正",staff,barcode:product.barcode,product_name:row.name,quantity:diff,memo})
      });
      const savedLog=Array.isArray(inserted)&&inserted[0] ? inserted[0] : null;
      try{
        if(Array.isArray(logs))logs.unshift(savedLog||{created_at:nowIso(),type:"在庫修正",staff,barcode:product.barcode,product_name:row.name,quantity:diff,memo});
      }catch(_){}
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
          <span>バーコード：${safe(row.barcode||"なし")} / 棚番：${safe(row.location||"")}</span>
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
      document.getElementById("appInventoryCountQty")?.focus();
      setMessage("appInventoryCameraMessage","読み取りました。数量を確認してEnterまたは登録を押してください。","ok");
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
    document.getElementById("saveAppInventoryCountBtn")?.addEventListener("click",saveCount);
    document.getElementById("compareAppInventoryCountBtn")?.addEventListener("click",compareCountedWithCsv);
    document.getElementById("appInventoryCountCsvFile")?.addEventListener("change",event=>loadSmaregiInventoryCsv(event.target.files&&event.target.files[0]));
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
    document.getElementById("appInventorySessionSelect")?.addEventListener("change",async event=>{
      state.currentSessionId=event.target.value||"";
      localStorage.setItem(CURRENT_SESSION_KEY,state.currentSessionId);
      state.csvRows=[];
      state.csvHeaderInfo=null;
      state.diffs=[];
      state.unmatched=[];
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

  window.getAppInventoryCountCsvHeaderReport=function(){
    return state.csvHeaderInfo;
  };

  window.addEventListener("DOMContentLoaded",bindAppInventoryCountEvents);
})();
