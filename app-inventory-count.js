/* ARICO TOKYO inventory app: app-inventory-count.js */
(function(){
  "use strict";

  const STORAGE_KEY="arico_app_inventory_count_sessions_v1";
  const LEGACY_KEY="arico_app_inventory_count_v1";
  const SCAN_COOLDOWN_MS=1300;

  const state={
    sessions:[],
    currentSessionId:"",
    csvRows:[],
    csvHeaderInfo:null,
    diffs:[],
    unmatched:[]
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

  function makeId(){
    return `session_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
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

  function getStaffValue(){
    return String(document.getElementById("appInventoryCountStaff")?.value||"").trim();
  }

  function currentSession(){
    return state.sessions.find(session=>session.id===state.currentSessionId)||null;
  }

  function countedMap(session=currentSession()){
    return new Map((session?.items||[]).map(row=>[String(row.barcode||row.productCode||row.name),row]));
  }

  function setCountedMap(map,session=currentSession()){
    if(!session)return;
    session.items=[...map.values()];
  }

  function migrateLegacySession(){
    if(localStorage.getItem(STORAGE_KEY))return null;
    try{
      const legacy=JSON.parse(localStorage.getItem(LEGACY_KEY)||"{}");
      const counted=Array.isArray(legacy.counted) ? legacy.counted : [];
      if(!counted.length&&!legacy.startedAt)return null;
      return {
        id:makeId(),
        name:"移行済み棚卸",
        staff:legacy.staff||"",
        memo:"",
        status:legacy.active?"棚卸中":(legacy.finishedAt?"棚卸終了":"未開始"),
        startedAt:legacy.startedAt||nowIso(),
        finishedAt:legacy.finishedAt||null,
        comparedAt:null,
        items:counted
      };
    }catch(_){
      return null;
    }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify({
      currentSessionId:state.currentSessionId,
      sessions:state.sessions
    }));
  }

  function loadState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
      state.sessions=Array.isArray(saved.sessions) ? saved.sessions : [];
      state.currentSessionId=saved.currentSessionId||"";
      const migrated=migrateLegacySession();
      if(migrated){
        state.sessions=[migrated];
        state.currentSessionId=migrated.id;
        saveState();
      }
      if(!currentSession()&&state.sessions[0])state.currentSessionId=state.sessions[0].id;
    }catch(_){
      state.sessions=[];
      state.currentSessionId="";
    }
  }

  function setMessage(id,text,type=""){
    const node=document.getElementById(id);
    if(!node)return;
    node.textContent=text;
    node.className=`message${type?` ${type}`:""}`;
  }

  function formatDate(value){
    if(!value)return "";
    return typeof fmt==="function" ? fmt(value) : new Date(value).toLocaleString("ja-JP");
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
        .slice()
        .sort((a,b)=>String(b.startedAt||"").localeCompare(String(a.startedAt||"")))
        .map(row=>`<option value="${safe(row.id)}">${safe(row.name)}（${safe(row.status)} / ${safe(row.items?.length||0)}件）</option>`)
        .join("");
      select.value=state.currentSessionId||"";
    }
    const nameInput=document.getElementById("appInventorySessionName");
    const memoInput=document.getElementById("appInventorySessionMemo");
    if(nameInput&&!nameInput.value&&session)nameInput.value=session.name||"";
    if(memoInput&&session)memoInput.value=session.memo||"";
    const currentName=document.getElementById("appInventoryCurrentSessionName");
    if(currentName){
      currentName.textContent=session ? `${session.name} / ${session.status}` : "セッション未選択";
    }
  }

  function renderStatus(){
    const session=currentSession();
    const badge=document.getElementById("appInventoryCountStatus");
    if(!badge)return;
    badge.className=`badge ${session?.status==="棚卸中"?"":"muted"}`;
    if(!session)badge.textContent="未開始";
    else badge.textContent=`${session.status} ${session.items?.length||0}件`;
  }

  function renderCountedRows(){
    const session=currentSession();
    const body=document.getElementById("appInventoryCountBody");
    const summary=document.getElementById("appInventoryCountSummary");
    const rows=(session?.items||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
    if(summary)summary.textContent=`${rows.length}件`;
    if(!body)return;
    body.innerHTML=rows.length ? rows.map(row=>`
      <tr>
        <td>${safe(row.name)}</td>
        <td>${safe(row.productCode||row.barcode)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.appStock)}</td>
        <td>${safe(formatDate(row.updatedAt))}</td>
      </tr>`).join("") : '<tr><td colspan="6" class="app-count-empty">カウント済み商品はありません。</td></tr>';
  }

  function renderDiffRows(){
    const body=document.getElementById("appInventoryDiffBody");
    const summary=document.getElementById("appInventoryDiffSummary");
    if(summary){
      const unmatchedText=state.unmatched.length ? ` / CSV該当なし ${state.unmatched.length}件` : "";
      summary.textContent=state.csvRows.length ? `差異 ${state.diffs.length}件${unmatchedText}` : "未比較";
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
        <td><button type="button" class="app-count-update-btn" data-key="${safe(row.key)}">更新</button></td>
      </tr>`).join("") : '<tr><td colspan="7" class="app-count-empty">差異のあるカウント済み商品はありません。</td></tr>';
    body.querySelectorAll(".app-count-update-btn").forEach(button=>{
      button.onclick=()=>updateCountedProductStock(button.dataset.key,button);
    });
  }

  window.renderAppInventoryCount=function(){
    loadState();
    renderStaffSelect();
    renderSessionControls();
    renderStatus();
    renderCountedRows();
    renderDiffRows();
  };

  function requireSession(){
    const session=currentSession();
    if(!session||session.status!=="棚卸中"){
      setMessage("appInventoryCountProductInfo","棚卸中のセッションを開始してから登録してください。","err");
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

  function startCount(){
    const staff=getStaffValue();
    const name=String(document.getElementById("appInventorySessionName")?.value||"").trim()||defaultSessionName();
    const memo=String(document.getElementById("appInventorySessionMemo")?.value||"").trim();
    if(!staff){
      setMessage("appInventoryCountProductInfo","担当者を選択してください。","err");
      document.getElementById("appInventoryCountStaff")?.focus();
      return;
    }
    const running=state.sessions.find(session=>session.status==="棚卸中");
    if(running&&!confirm(`棚卸中のセッション「${running.name}」があります。新しいセッションを開始しますか？`))return;
    if(running){
      running.status="棚卸終了";
      running.finishedAt=running.finishedAt||nowIso();
    }
    const session={
      id:makeId(),
      name,
      staff,
      memo,
      status:"棚卸中",
      startedAt:nowIso(),
      finishedAt:null,
      comparedAt:null,
      items:[]
    };
    state.sessions.unshift(session);
    state.currentSessionId=session.id;
    state.csvRows=[];
    state.csvHeaderInfo=null;
    state.diffs=[];
    state.unmatched=[];
    saveState();
    clearScanForm("棚卸を開始しました。商品をスキャンまたは検索してください。","ok");
    renderAppInventoryCount();
  }

  function finishCount(){
    const session=currentSession();
    if(!session){
      setMessage("appInventoryCountProductInfo","終了するセッションがありません。","err");
      return;
    }
    if(session.status!=="棚卸中"){
      setMessage("appInventoryCountCsvInfo","このセッションは棚卸終了済みです。CSVを読み込んで比較してください。","ok");
      return;
    }
    if(!session.items.length){
      setMessage("appInventoryCountProductInfo","カウント済み商品がありません。","err");
      return;
    }
    session.status="棚卸終了";
    session.finishedAt=nowIso();
    session.staff=getStaffValue()||session.staff;
    session.memo=String(document.getElementById("appInventorySessionMemo")?.value||"").trim();
    saveState();
    setMessage("appInventoryCountCsvInfo","棚卸を終了しました。スマレジ在庫一覧CSVを読み込んでください。","ok");
    renderAppInventoryCount();
  }

  async function findProductsByName(keyword){
    keyword=String(keyword||"").trim();
    if(!keyword)return [];
    const rows=await sbAll(`products?select=*&name=ilike.*${encodeURIComponent(keyword)}*&order=name.asc`,1000,30).catch(()=>[]);
    rows.forEach(row=>{if(row&&row.barcode&&!gp(row.barcode))products.push(row);});
    return rows||[];
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

  function showProduct(product){
    if(!product)return;
    document.getElementById("appInventoryCountQty").value="1";
    setMessage(
      "appInventoryCountProductInfo",
      `商品名：${product.name||""}\n商品コード：${product.barcode||""}\nバーコード：${product.barcode||""}\n現在のアプリ在庫：${Number(product.base_stock||0)}`,
      "ok"
    );
  }

  async function previewBarcode(){
    const code=String(document.getElementById("appInventoryCountBarcode")?.value||"").trim();
    if(!code){
      if(selectedProduct){
        showProduct(selectedProduct);
        return selectedProduct;
      }
      setMessage("appInventoryCountProductInfo",currentSession()?.status==="棚卸中"?"商品をスキャンまたは検索してください。":"棚卸開始後、商品をスキャンまたは検索してください。");
      return null;
    }
    selectedProduct=null;
    const product=await findProductByCode(code);
    if(!product){
      setMessage("appInventoryCountProductInfo",`未登録バーコード・商品コード：${code}\nバーコードがない商品は商品名検索から選択してください。`,"err");
      return null;
    }
    showProduct(product);
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
    const qty=Number(document.getElementById("appInventoryCountQty")?.value||0);
    if(!Number.isInteger(qty)||qty<0){
      setMessage("appInventoryCountProductInfo","カウント数は0以上の整数で入力してください。","err");
      return;
    }
    const session=currentSession();
    const map=countedMap(session);
    const barcode=String(product.barcode||"");
    const key=barcode||String(product.name||"");
    const row={
      key,
      sessionId:session.id,
      barcode,
      productCode:barcode,
      productId:String(product.smaregi_product_id||""),
      name:product.name||"",
      count:qty,
      appStock:Number(product.base_stock||0),
      updatedAt:nowIso()
    };
    map.set(key,row);
    setCountedMap(map,session);
    state.diffs=[];
    state.unmatched=[];
    saveState();
    renderSessionControls();
    renderStatus();
    renderCountedRows();
    renderDiffRows();
    clearScanForm(`登録しました：${row.name} / ${qty}`);
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
      stock:findIndex(["在庫数","stock","stock_quantity","quantity","在庫"]),
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
      if(row.productCode)byProductCode.set(normalizeKey(row.productCode),row);
      if(row.productId)byProductId.set(normalizeKey(row.productId),row);
      if(row.barcode)byBarcode.set(normalizeKey(row.barcode),row);
      const detail=normalizeTextKey(`${row.name}${row.color}${row.size}`);
      if(detail)byNameDetail.set(detail,row);
      if(row.name)byNameDetail.set(normalizeTextKey(row.name),row);
    });
    return {byProductCode,byProductId,byBarcode,byNameDetail};
  }

  function findCsvRowForCount(counted,indexes){
    return indexes.byProductCode.get(normalizeKey(counted.productCode||counted.barcode))
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
      setMessage("appInventoryCountCsvInfo",`CSV読込完了：${state.csvRows.length}行 / 利用列：${state.csvHeaderInfo.used.join("、")}`,"ok");
      renderDiffRows();
    }catch(error){
      setMessage("appInventoryCountCsvInfo","CSV読込エラー\n"+error.message,"err");
    }
  }

  function compareCountedWithCsv(){
    const session=currentSession();
    if(!session){
      setMessage("appInventoryCountCsvInfo","比較するセッションを選択してください。","err");
      return;
    }
    if(session.status==="棚卸中"){
      setMessage("appInventoryCountCsvInfo","棚卸終了後に比較してください。","err");
      return;
    }
    if(!session.items.length){
      setMessage("appInventoryCountCsvInfo","カウント済み商品がありません。","err");
      return;
    }
    if(!state.csvRows.length){
      setMessage("appInventoryCountCsvInfo","スマレジ在庫一覧CSVを読み込んでください。","err");
      return;
    }
    const indexes=makeCsvIndexes(state.csvRows);
    state.diffs=[];
    state.unmatched=[];
    session.items.forEach(counted=>{
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
    session.status="比較済み";
    session.comparedAt=nowIso();
    saveState();
    setMessage("appInventoryCountCsvInfo",`比較完了：差異 ${state.diffs.length}件 / CSV該当なし ${state.unmatched.length}件。未カウント商品とCSVだけの商品は対象外です。`,"ok");
    renderSessionControls();
    renderStatus();
    renderDiffRows();
  }

  async function updateCountedProductStock(key,button){
    const row=state.diffs.find(item=>String(item.key)===String(key));
    if(!row)return;
    const session=currentSession();
    const staff=getStaffValue()||session?.staff;
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
        body:JSON.stringify({
          type:"在庫修正",
          staff,
          barcode:product.barcode,
          product_name:row.name,
          quantity:diff,
          memo
        })
      });
      const savedLog=Array.isArray(inserted)&&inserted[0] ? inserted[0] : null;
      try{
        if(Array.isArray(logs))logs.unshift(savedLog||{
          created_at:nowIso(),
          type:"在庫修正",
          staff,
          barcode:product.barcode,
          product_name:row.name,
          quantity:diff,
          memo
        });
      }catch(_){}
      const map=countedMap(session);
      const counted=map.get(row.key);
      if(counted)counted.appStock=after;
      setCountedMap(map,session);
      state.diffs=state.diffs.filter(item=>String(item.key)!==String(row.key));
      saveState();
      renderCountedRows();
      renderDiffRows();
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
    host.innerHTML=searchResultCache.length ? searchResultCache.map((row,index)=>`<button type="button" class="product-search-result" data-index="${safe(index)}"><strong>${safe(row.name)}</strong><small>バーコード：${safe(row.barcode||"なし")} / 現在庫：${Number(row.base_stock||0)}</small></button>`).join("") : '<div class="product-search-empty">該当商品がありません。</div>';
    host.querySelectorAll(".product-search-result").forEach(button=>{
      button.onclick=async ()=>{
        selectedProduct=searchResultCache[Number(button.dataset.index)]||null;
        document.getElementById("appInventoryCountBarcode").value=selectedProduct?.barcode||"";
        host.innerHTML="";
        if(selectedProduct)showProduct(selectedProduct);
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

  async function handleScannedCode(code){
    code=String(code||"").trim();
    if(!code||isDuplicateScan(code))return;
    const input=document.getElementById("appInventoryCountBarcode");
    if(input)input.value=code;
    const product=await previewBarcode();
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
      setMessage("appInventoryCameraMessage","この端末ではカメラを起動できません。","err");
      return;
    }
    try{
      await stopAppInventoryCamera(false);
      area.hidden=false;
      video.style.display="block";
      setMessage("appInventoryCameraMessage","カメラ起動中です。赤線にバーコードを合わせてください。","ok");
      if(typeof ensureZXing==="function"){
        await ensureZXing().catch(()=>false);
      }
      if(window.ZXing){
        if(!appCountZXingReader){
          const hints=new ZXing.Map();
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
          {video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}},
          video,
          (result)=>{
            if(result&&appCountZXingRunning)handleScannedCode(result.text||String(result));
          }
        );
        return;
      }
      if("BarcodeDetector"in window){
        appCountDetector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","code_39","itf","upc_a","upc_e"]});
        appCountCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});
        video.srcObject=appCountCameraStream;
        await video.play();
        appCountScanning=true;
        requestAnimationFrame(scanLoop);
        return;
      }
      throw new Error("バーコード読取に対応していないブラウザです。");
    }catch(error){
      await stopAppInventoryCamera(false);
      setMessage("appInventoryCameraMessage","カメラ起動エラー\n"+error.message,"err");
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

  async function scanLoop(){
    if(!appCountScanning||!appCountDetector)return;
    try{
      const video=document.getElementById("appInventoryCountVideo");
      const codes=video ? await appCountDetector.detect(video) : [];
      if(codes&&codes[0])await handleScannedCode(codes[0].rawValue);
    }catch(_){}
    if(appCountScanning)requestAnimationFrame(scanLoop);
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
    document.getElementById("appInventoryCountStaff")?.addEventListener("change",event=>{
      const session=currentSession();
      if(session)session.staff=event.target.value||"";
      saveState();
    });
    document.getElementById("appInventorySessionMemo")?.addEventListener("change",event=>{
      const session=currentSession();
      if(session)session.memo=event.target.value||"";
      saveState();
    });
    document.getElementById("appInventorySessionSelect")?.addEventListener("change",event=>{
      state.currentSessionId=event.target.value||"";
      state.csvRows=[];
      state.csvHeaderInfo=null;
      state.diffs=[];
      state.unmatched=[];
      const session=currentSession();
      const nameInput=document.getElementById("appInventorySessionName");
      const memoInput=document.getElementById("appInventorySessionMemo");
      if(nameInput)nameInput.value=session?.name||"";
      if(memoInput)memoInput.value=session?.memo||"";
      saveState();
      renderAppInventoryCount();
    });
    window.addEventListener("beforeunload",()=>stopAppInventoryCamera(false));
    renderAppInventoryCount();
  }

  window.getAppInventoryCountCsvHeaderReport=function(){
    return state.csvHeaderInfo;
  };

  window.addEventListener("DOMContentLoaded",bindAppInventoryCountEvents);
})();
