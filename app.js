window.addEventListener("error",(e)=>{
  try{
    const m=document.getElementById("message");
    if(m){
      m.textContent="起動エラー。\n"+(e.message||"");
      m.className="message err";
    }
  }catch(_){}
});

window.addEventListener("unhandledrejection",(e)=>{
  try{
    const m=document.getElementById("message");
    if(m){
      m.textContent="通信または処理エラー。\n"+(e.reason?.message||e.reason||"");
      m.className="message err";
    }
  }catch(_){}
});

const SUPABASE_URL="https://ihsbkknysozkstvylqff.supabase.co";
const SUPABASE_API_KEY="sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

let products=[];
let logs=[];
let checks=[];
let staffMembers=[];
let selectedBarcode="";
let selectedHistoryMode="all";
let dataLoaded=false;
let dataLoadError=false;

let videoStream=null;
let detector=null;
let scanning=false;
let lastScan="";
let lastScanAt=0;
let zxingReader=null;
let zxingRunning=false;

const el=(id)=>document.getElementById(id);


function showPopup(title, body){
  const popup=el("appPopup");
  const t=el("appPopupTitle");
  const b=el("appPopupBody");
  if(t)t.textContent=title||"完了";
  if(b)b.textContent=body||"";
  if(popup)popup.style.display="flex";
}

function hidePopup(){
  const popup=el("appPopup");
  if(popup)popup.style.display="none";
}

function showMessage(text,type=""){
  const m=el("message");
  if(!m)return;
  m.textContent=text;
  m.className="message "+type;
}


function beep(ok=true){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.value = ok ? 880 : 220;

    gain.gain.setValueAtTime(ok ? 0.14 : 0.08, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + (ok ? 0.12 : 0.22)
    );

    setTimeout(() => {
      try{ osc.stop(); }catch(_){}
      try{ ctx.close(); }catch(_){}
    }, ok ? 140 : 240);

  } catch (_) {}
}


async function sb(path,opt={}){
  const headers={
    apikey:SUPABASE_API_KEY,
    Authorization:"Bearer "+SUPABASE_API_KEY,
    "Content-Type":"application/json",
    Accept:"application/json",
    ...(opt.headers||{})
  };

  const res=await fetch(SUPABASE_URL.replace(/\/+$/,"")+"/rest/v1/"+path,{...opt,headers});
  const text=await res.text();

  let body=null;
  try{body=text?JSON.parse(text):null;}catch{body=text;}

  if(!res.ok){
    const detail=typeof body==="object"?JSON.stringify(body):String(body||"");
    throw new Error(`Supabaseエラー ${res.status}\n${detail}`);
  }
  return body;
}

async function sbAll(path,pageSize=1000,maxRows=20000){
  const all=[];
  let offset=0;

  while(true){
    const url=path+(path.includes("?")?"&":"?")+`limit=${pageSize}&offset=${offset}`;
    const rows=await sb(url);
    if(!Array.isArray(rows))return rows;

    all.push(...rows);
    if(rows.length<pageSize)break;

    offset+=pageSize;
    if(offset>=maxRows)break;
  }
  return all;
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,(c)=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function fmt(iso){
  try{return new Date(iso).toLocaleString("ja-JP");}
  catch{return iso;}
}

function gp(barcode){
  return products.find(p=>String(p.barcode)===String(barcode));
}

async function fetchProductByBarcode(barcode){
  barcode=String(barcode||"").trim();
  if(!barcode)return null;

  const cached=gp(barcode);
  if(cached)return cached;

  const rows=await sb(`products?select=*&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
  const p=Array.isArray(rows)&&rows.length?rows[0]:null;

  if(p&&!gp(p.barcode)){
    products.push(p);
  }

  return p;
}

function getCurrentStock(barcode){
  const p=gp(barcode);
  return Number(p?.base_stock||0);
}

async function reloadAll(){
  try{
    dataLoaded=false;
    dataLoadError=false;
    showMessage("起動中...");

    products=[];

    try{
      logs=await sb("inventory_logs?select=*&order=created_at.desc&limit=50");
    }catch(_){
      logs=[];
    }

    try{
      checks=await sb("inventory_checks?select=*&order=checked_at.desc&limit=50");
    }catch(_){
      checks=[];
    }

    try{
      staffMembers=await sb("staff_members?select=*&order=name.asc");
    }catch(_){
      staffMembers=[];
    }

    await enrichRecentLogProductNames();
    dataLoaded=true;
    dataLoadError=false;
    render();
    showMessage("準備OK。商品はバーコード入力時に確認します。","ok");
  }catch(e){
    dataLoaded=false;
    dataLoadError=true;
    showMessage("起動エラー。\n"+e.message,"err");
  }
}

function render(){
  renderStaffOptions();
  renderStaffList();
  renderProductCount();
  renderGlobalHistory();
  renderSelectedProductHistory();
  if(typeof applyLang==='function')setTimeout(applyLang,0);
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

  const checker=el("checkerName");
  if(checker){
    const cur=checker.value;
    checker.innerHTML='<option value="">チェック者を選択</option>'+staffMembers.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
    if(cur)checker.value=cur;
  }

  const smaregiChecker=el("smaregiCheckerName");
  if(smaregiChecker){
    const cur=smaregiChecker.value||localStorage.getItem("arico_smaregi_checker")||"";
    smaregiChecker.innerHTML='<option value="">担当者を選択</option>'+staffMembers.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
    if(cur)smaregiChecker.value=cur;
  }
}

function renderStaffList(){
  const badge=el("staffCountBadge");
  const body=el("staffListBody");

  if(badge)badge.textContent=`担当者：${staffMembers.length}人`;
  if(!body)return;

  body.innerHTML=staffMembers.map(s=>`
    <tr>
      <td>${esc(s.name)}</td>
      <td><button type="button" class="staff-delete-btn" data-staff-id="${s.id}">削除</button></td>
    </tr>
  `).join("");

  document.querySelectorAll(".staff-delete-btn").forEach(btn=>{
    btn.onclick=()=>deleteStaff(btn.dataset.staffId);
  });
}

async function saveStaff(e){
  e.preventDefault();
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

async function renderScanPreview(){
  const info=el("scanProductInfo");
  const input=el("barcodeInput");
  if(!info||!input)return;

  const barcode=input.value.trim();

  if(!barcode){
    info.textContent="バーコード入力後、商品名と現在庫を表示します";
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
      return;
    }

    info.textContent=`商品名：${p.name} / 現在庫：${Number(p.base_stock||0)}`;
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
    selectedHistoryMode="all";
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

async function upsertProducts(rows){
  await sb("products?on_conflict=barcode",{
    method:"POST",
    headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify(rows)
  });
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

async function registerBarcode(barcode){
  try{
    barcode=String(barcode||"").trim();
    if(!barcode)return;

    const type=el("type").value;
    const staff=el("staff").value.trim();
    const qtyRaw=el("qty").value.trim();
    const qty=Number(qtyRaw);
    const memo=el("memo").value.trim();

    if(!staff){
      beep(false);
      showMessage("担当者を選択してください。","err");
      el("staff").focus();
      return;
    }

    if(qtyRaw==="" || !Number.isFinite(qty) || (type==="在庫修正" ? qty < 0 : qty <= 0)){
      beep(false);
      showMessage(type==="在庫修正" ? "在庫修正は0以上の数字を入力してください。" : "数量を入力してください。","err");
      el("qty").focus();
      return;
    }

    const p=await fetchProductByBarcode(barcode);

    if(!p){
      beep(false);
      showMessage(`未登録バーコード：${barcode}。PCで商品登録してください。`,"err");
      return;
    }

    const currentStock=Number(p.base_stock||0);
    let newStock=currentStock;

    if(type==="入荷")newStock=currentStock+qty;
    if(type==="出荷")newStock=currentStock-qty;
    if(type==="在庫修正")newStock=qty;

    if(type==="出荷"&&newStock<0){
      beep(false);
      showMessage(`在庫不足：${p.name} / 現在庫 ${currentStock} / 出荷数 ${qty}`,"err");
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

    beep(true);
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
    beep(false);
    showMessage("登録エラー。\n"+e.message,"err");
  }
}

async function loadProductHistoryByBarcode(barcode){
  return await sbAll(`inventory_logs?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=created_at.desc`,1000,10000);
}

async function loadProductChecksByBarcode(barcode){
  try{
    return await sbAll(`inventory_checks?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=checked_at.desc`,1000,10000);
  }catch(_){
    return [];
  }
}

async function showProductHistoryForBarcode(barcode){
  barcode=String(barcode||"").trim();
  if(!barcode)return;

  const p=await fetchProductByBarcode(barcode);
  if(!p){
    showMessage(`商品別履歴：未登録バーコード ${barcode}`,"err");
    return;
  }

  selectedBarcode=barcode;
  const productLogs=await loadProductHistoryByBarcode(barcode);
  const productChecks=await loadProductChecksByBarcode(barcode);

  renderSelectedProductHistoryWithData(productLogs,productChecks);
}

async function selectProductHistoryByBarcode(){
  const input=el("productHistoryBarcodeInput");
  if(!input)return;
  await showProductHistoryForBarcode(input.value);
}


function normalizeSearchText(s){
  return String(s||"").trim().replace(/\s+/g," ");
}

async function searchProductsByName(keyword){
  keyword=normalizeSearchText(keyword);
  if(!keyword || keyword.length<2)return [];

  try{
    const q=encodeURIComponent(`*${keyword}*`);
    const rows=await sb(`products?select=*&name=ilike.${q}&order=name.asc&limit=80`);

    if(Array.isArray(rows)){
      rows.forEach(p=>{
        if(p && !gp(p.barcode))products.push(p);
      });
      return rows;
    }

    return [];
  }catch(e){
    showMessage("商品名検索エラー。\n"+e.message,"err");
    return [];
  }
}


let productFormSearchTimer=null;

function renderProductFormSearchResults(rows){
  const box=el("productFormSearchResults");
  if(!box)return;

  if(!rows || !rows.length){
    box.innerHTML='<div class="product-search-item"><strong>該当商品なし</strong><span>新規商品として登録できます</span></div>';
    box.classList.add("is-active");
    return;
  }

  box.innerHTML=rows.map(p=>`
    <div class="product-search-item" data-barcode="${esc(p.barcode)}">
      <div>
        <strong>${esc(p.name)}</strong>
        <span>バーコード：${esc(p.barcode)} / 現在庫：${Number(p.base_stock||0)} / 棚番：${esc(p.location||"")}</span>
      </div>
      <button type="button">選択</button>
    </div>
  `).join("");

  box.classList.add("is-active");

  box.querySelectorAll(".product-search-item[data-barcode]").forEach(item=>{
    item.onclick=async()=>{
      const barcode=item.dataset.barcode;
      const p=await fetchProductByBarcode(barcode);

      if(p){
        if(el("productBarcode"))el("productBarcode").value=p.barcode||"";
        if(el("productName"))el("productName").value=p.name||"";
        if(el("baseStock"))el("baseStock").value=Number(p.base_stock||0);
        if(el("location"))el("location").value=p.location||"";
      }

      const input=el("productFormNameSearchInput");
      if(input)input.value="";

      box.classList.remove("is-active");
      box.innerHTML="";

      if(typeof renderProductStockInfo==="function"){
        await renderProductStockInfo();
      }

      showMessage("商品登録フォームに商品情報を反映しました。","ok");
    };
  });
}

function handleProductFormNameSearchInput(){
  const input=el("productFormNameSearchInput");
  if(!input)return;

  clearTimeout(productFormSearchTimer);

  const keyword=input.value.trim();
  const box=el("productFormSearchResults");

  if(!keyword){
    if(box){
      box.classList.remove("is-active");
      box.innerHTML="";
    }
    return;
  }

  productFormSearchTimer=setTimeout(async()=>{
    const rows=await searchProductsByName(keyword);
    renderProductFormSearchResults(rows);
  },250);
}

function renderProductSearchResults(rows){
  const box=el("productSearchResults");
  if(!box)return;

  if(!rows || !rows.length){
    box.innerHTML='<div class="product-search-item"><strong>該当商品なし</strong><span>別のキーワードで検索してください</span></div>';
    box.classList.add("is-active");
    return;
  }

  box.innerHTML=rows.map(p=>`
    <div class="product-search-item" data-barcode="${esc(p.barcode)}">
      <div>
        <strong>${esc(p.name)}</strong>
        <span>バーコード：${esc(p.barcode)} / 現在庫：${Number(p.base_stock||0)} / 棚番：${esc(p.location||"")}</span>
      </div>
      <button type="button">選択</button>
    </div>
  `).join("");

  box.classList.add("is-active");

  box.querySelectorAll(".product-search-item[data-barcode]").forEach(item=>{
    item.onclick=async()=>{
      const barcode=item.dataset.barcode;
      const historyInput=el("productHistoryBarcodeInput");
      const nameInput=el("productNameSearchInput");

      if(historyInput)historyInput.value=barcode;
      if(nameInput)nameInput.value="";

      box.classList.remove("is-active");
      box.innerHTML="";

      await showProductHistoryForBarcode(barcode);
    };
  });
}

let productSearchTimer=null;

function handleProductNameSearchInput(){
  const input=el("productNameSearchInput");
  if(!input)return;

  clearTimeout(productSearchTimer);

  const keyword=input.value.trim();
  const box=el("productSearchResults");

  if(!keyword){
    if(box){
      box.classList.remove("is-active");
      box.innerHTML="";
    }
    return;
  }

  productSearchTimer=setTimeout(async()=>{
    const rows=await searchProductsByName(keyword);
    renderProductSearchResults(rows);
  },250);
}

function renderSelectedProductHistory(){
  const body=el("selectedHistoryBody");
  const cb=el("checkHistoryBody");
  if(!body||!cb)return;
  if(!selectedBarcode){
    body.innerHTML="";
    cb.innerHTML="";
  }
}

function renderSelectedProductHistoryWithData(productLogs,productChecks){
  const badge=el("selectedProductBadge");
  const range=el("historyRangeBadge");
  const body=el("selectedHistoryBody");
  const cb=el("checkHistoryBody");

  if(!body||!cb)return;

  const p=gp(selectedBarcode);

  if(badge)badge.textContent=p?`${p.name} / 全履歴：${productLogs.length}件`:"商品を選択してください";
  if(range)range.textContent=`全履歴：${productLogs.length}件`;

  body.innerHTML=buildProductHistoryRowsFromLogs(selectedBarcode,productLogs,productLogs);

  bindMemoEditButtons();

  cb.innerHTML=productChecks.map(c=>`<tr>
    <td>${fmt(c.checked_at)}</td>
    <td>${esc(c.checked_by)}</td>
    <td>${esc(c.stock_at_check)}</td>
    <td>${esc(c.memo||"")}</td>
  </tr>`).join("");
}

function buildProductHistoryRowsFromLogs(barcode,selectedLogs,allLogsForBarcode){
  const p=gp(barcode);
  let running=Number(p?.base_stock||0);

  const allDesc=allLogsForBarcode.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const rowsByKey=new Map();

  for(const log of allDesc){
    const q=Number(log.quantity||0);

    let beforeStock="";
    let afterStock=running;
    let inQty="";
    let outQty="";

    if(log.type==="入荷"){
      beforeStock=running-q;
      inQty=q;
      running-=q;
    }else if(log.type==="出荷"){
      beforeStock=running+q;
      outQty=q;
      running+=q;
    }else if(log.type==="在庫修正"){
      beforeStock="-";
      afterStock=q;
    }

    const key=String(log.id||log.created_at+log.type+log.quantity+log.memo);

    rowsByKey.set(key,{
      log,
      beforeStock,
      afterStock,
      inQty,
      outQty
    });
  }

  return selectedLogs.map(log=>{
    const key=String(log.id||log.created_at+log.type+log.quantity+log.memo);
    const r=rowsByKey.get(key);

    if(!r)return "";

    return `<tr>
      <td>${fmt(r.log.created_at)}</td>
      <td>${esc(r.log.type)}</td>
      <td>${esc(r.log.staff)}</td>
      <td>${esc(p?.name||r.log.product_name||"")}</td>
      <td>${r.beforeStock}</td>
      <td>${r.inQty}</td>
      <td>${r.outQty}</td>
      <td>${r.afterStock}</td>
      <td>${memoCellHtml(r.log)}</td>
    </tr>`;
  }).join("");
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

function renderGlobalHistory(){
  const body=el("historyBody");
  if(!body)return;
  body.innerHTML=buildGlobalHistoryRows();
  bindMemoEditButtons();
}

function buildGlobalHistoryRows(){
  return logs.map(log=>{
    const q=Number(log.quantity||0);

    let beforeStock="";
    let afterStock="";
    let inQty="";
    let outQty="";

    const current=Number(gp(log.barcode)?.base_stock||0);

    if(log.type==="入荷"){
      beforeStock=current-q;
      afterStock=current;
      inQty=q;
    }else if(log.type==="出荷"){
      beforeStock=current+q;
      afterStock=current;
      outQty=q;
    }else if(log.type==="在庫修正"){
      beforeStock="-";
      afterStock=q;
    }

    return `<tr>
      <td>${fmt(log.created_at)}</td>
      <td>${esc(log.type)}</td>
      <td>${esc(log.staff)}</td>
      <td>${esc(gp(log.barcode)?.name||log.product_name||"")}</td>
      <td>${beforeStock}</td>
      <td>${inQty}</td>
      <td>${outQty}</td>
      <td>${afterStock}</td>
      <td>${memoCellHtml(log)}</td>
    </tr>`;
  }).join("");
}


async function bulkStockCheckVisible(){
  try{
    if(!selectedBarcode){
      showMessage("商品を選択してください。","err");
      return;
    }
    const checked_by=el("checkerName") ? el("checkerName").value.trim() : "";
    if(!checked_by){
      showMessage("チェック者名を選択してください。","err");
      if(el("checkerName"))el("checkerName").focus();
      return;
    }
    const p=await fetchProductByBarcode(selectedBarcode);
    const stock_at_check=Number(p?.base_stock||0);
    await sb("inventory_checks",{
      method:"POST",
      headers:{Prefer:"return:minimal"},
      body:JSON.stringify({
        barcode:selectedBarcode,
        product_name:p?.name||"",
        checked_by,
        stock_at_check,
        memo:"表示中履歴を一括チェック"
      })
    });
    showMessage(`一括チェック記録：${p?.name||selectedBarcode} / ${checked_by} / 現在庫 ${stock_at_check}`,"ok");
    if(typeof showPopup==="function"){
      showPopup("一括チェック完了",`商品名：${p?.name||selectedBarcode}\nチェック者：${checked_by}\n現在庫：${stock_at_check}`);
    }
    await showProductHistoryForBarcode(selectedBarcode);
  }catch(e){
    showMessage("一括チェックエラー。\n"+e.message,"err");
  }
}

async function saveStockCheck(){
  try{
    if(!selectedBarcode){
      showMessage("商品別履歴から商品を選択してください。","err");
      return;
    }

    const checked_by=el("checkerName").value.trim();

    if(!checked_by){
      showMessage("チェック者名を選択してください。","err");
      el("checkerName").focus();
      return;
    }

    const p=gp(selectedBarcode);
    const stock_at_check=Number(p?.base_stock||0);

    await sb("inventory_checks",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        barcode:selectedBarcode,
        product_name:p?.name||"",
        checked_by,
        stock_at_check,
        memo:""
      })
    });

    showMessage(`在庫チェック記録：${p?.name||selectedBarcode} / ${checked_by} / 現在庫 ${stock_at_check}`,"ok");
    await showProductHistoryForBarcode(selectedBarcode);
  }catch(e){
    showMessage("チェック記録エラー。\n"+e.message,"err");
  }
}


function mojibakeScore(text){
  text=String(text||"");
  let score=0;
  score += (text.match(/�/g)||[]).length * 10;
  score += (text.match(/縺|荳|蜊|譁|繧|繝|逕|譛|髱|窶/g)||[]).length * 5;
  score += (text.match(/ｿ|｡|｣|､|･/g)||[]).length * 3;
  return score;
}

function decodeCsvBuffer(buffer){
  let utf8="";
  let sjis="";

  try{
    utf8=new TextDecoder("utf-8",{fatal:false}).decode(buffer);
  }catch(_){
    utf8="";
  }

  try{
    sjis=new TextDecoder("shift_jis",{fatal:false}).decode(buffer);
  }catch(_){
    sjis="";
  }

  if(!sjis)return utf8;
  if(!utf8)return sjis;

  return mojibakeScore(sjis) < mojibakeScore(utf8) ? sjis : utf8;
}

async function fetchProductsByBarcodes(barcodes){
  const unique=[...new Set((barcodes||[]).filter(Boolean).map(String))].filter(b=>!gp(b));
  if(!unique.length)return;

  for(let i=0;i<unique.length;i+=100){
    const chunk=unique.slice(i,i+100);
    const inList=chunk.map(b=>`"${b.replace(/"/g,'\\"')}"`).join(",");
    try{
      const rows=await sb(`products?select=*&barcode=in.(${encodeURIComponent(inList)})`);
      if(Array.isArray(rows)){
        rows.forEach(p=>{
          if(p && !gp(p.barcode))products.push(p);
        });
      }
    }catch(_){}
  }
}

async function enrichRecentLogProductNames(){
  try{
    await fetchProductsByBarcodes((logs||[]).map(l=>l.barcode));
  }catch(_){}
}

function parseCsv(text){
  text=String(text||"").replace(/^\uFEFF/,"");
  const rows=[];
  let row=[];
  let field="";
  let inQuotes=false;

  for(let i=0;i<text.length;i++){
    const c=text[i];
    const n=text[i+1];

    if(inQuotes){
      if(c==='"'&&n==='"'){
        field+='"';
        i++;
      }else if(c==='"'){
        inQuotes=false;
      }else{
        field+=c;
      }
    }else{
      if(c==='"'){
        inQuotes=true;
      }else if(c===","){
        row.push(field);
        field="";
      }else if(c==="\n"){
        row.push(field);
        rows.push(row);
        row=[];
        field="";
      }else if(c!=="\r"){
        field+=c;
      }
    }
  }

  row.push(field);
  rows.push(row);

  return rows.filter(r=>r.some(v=>String(v).trim()!==""));
}

function normalizeHeader(h){
  return String(h||"").trim().toLowerCase().replace(/\s/g,"");
}

function getCsvValue(obj,keys){
  for(const k of keys){
    if(obj[k]!==undefined)return obj[k];
  }
  return "";
}

function csvToRows(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");

  const headers=parsed[0].map(normalizeHeader);
  const rows=[];

  for(let i=1;i<parsed.length;i++){
    const raw={};
    headers.forEach((h,idx)=>{raw[h]=(parsed[i][idx]??"").trim();});

    const barcode=String(getCsvValue(raw,["barcode","バーコード","jan","jancode","janコード","品番"])).trim();
    const name=String(getCsvValue(raw,["name","商品名","productname","product_name","品名"])).trim();
    const stockRaw=String(getCsvValue(raw,["base_stock","basestock","現在庫","現在在庫","在庫","原在庫","stock","quantity","数量"])).replace(/,/g,"").trim();
    const location=String(getCsvValue(raw,["location","棚番","ロケーション","場所"])).trim();

    if(!barcode&&!name)continue;
    if(!barcode||!name)throw new Error(`${i+1}行目：バーコードまたは商品名が空です。`);

    const base_stock=Number(stockRaw||0);
    if(!Number.isFinite(base_stock))throw new Error(`${i+1}行目：在庫数が数字ではありません。`);

    rows.push({barcode,name,base_stock,location});
  }

  if(!rows.length)throw new Error("取り込み対象データがありません。");
  return rows;
}

async function importCsvFile(file){
  try{
    if(!file)return;
    showMessage("CSV取り込み中...");

    const buffer=await file.arrayBuffer();
    const text=decodeCsvBuffer(buffer);

    const rows=csvToRows(text);

    for(let i=0;i<rows.length;i+=500){
      await upsertProducts(rows.slice(i,i+500));
    }

    // 取り込み後、キャッシュを更新
    for(const r of rows){
      const old=gp(r.barcode);
      if(old){
        old.name=r.name;
        old.base_stock=r.base_stock;
        old.location=r.location;
      }else{
        products.push(r);
      }
    }

    showMessage(`CSV取り込み完了：${rows.length}件の商品を登録・更新しました。履歴表示は商品マスター名を優先します。`,"ok");
    render();
  }catch(e){
    showMessage("CSV取り込みエラー。\n"+e.message,"err");
  }finally{
    const input=el("csvFile");
    if(input)input.value="";
  }
}



function downloadSampleCsv(){
  const csv="\uFEFFbarcode,name,base_stock,location\n4901234567890,サンプル商品A,10,A-01\n4909876543210,サンプル商品B,5,B-01\n";
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="product_import_sample.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCsvFile(filename,rows){
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  a.style.display="none";
  document.body.appendChild(a);
  setTimeout(()=>{
    a.click();
    setTimeout(()=>{
      try{document.body.removeChild(a);}catch(_){}
      URL.revokeObjectURL(url);
    },1000);
  },0);
}



function buildHistoryExportRows(sourceLogs){
  const rows=[["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","備考"]];

  const grouped=new Map();

  for(const log of sourceLogs||[]){
    const barcode=String(log.barcode||"");
    if(!grouped.has(barcode))grouped.set(barcode,[]);
    grouped.get(barcode).push(log);
  }

  const resultRows=[];

  for(const [barcode,list] of grouped.entries()){
    const p=gp(barcode);
    let running=Number(p?.base_stock||0);

    const desc=list.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));

    for(const log of desc){
      const q=Number(log.quantity||0);

      let beforeStock="";
      let afterStock=running;
      let inQty="";
      let outQty="";

      if(log.type==="入荷"){
        beforeStock=running-q;
        inQty=q;
        running-=q;
      }else if(log.type==="出荷"){
        beforeStock=running+q;
        outQty=q;
        running+=q;
      }else if(log.type==="在庫修正"){
        beforeStock="-";
        afterStock=q;
      }

      resultRows.push({
        created_at:log.created_at,
        row:[
          fmt(log.created_at),
          log.type||"",
          log.staff||"",
          gp(log.barcode)?.name || log.product_name || "",
          beforeStock,
          inQty,
          outQty,
          afterStock,
          log.memo||""
        ]
      });
    }
  }

  resultRows
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
    .forEach(r=>rows.push(r.row));

  return rows;
}


function exportProductHistoryCsv(){
  try{
    if(!selectedBarcode){
      showMessage("商品を選択してください。","err");
      return;
    }

    const table=document.getElementById("selectedHistoryBody");
    const rows=[["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","備考"]];

    if(table){
      [...table.querySelectorAll("tr")].forEach(tr=>{
        const cols=[...tr.querySelectorAll("td")].map(td=>td.textContent.trim());
        if(cols.length)rows.push(cols);
      });
    }

    if(rows.length<=1){
      showMessage("出力する商品履歴がありません。","err");
      return;
    }

    downloadCsvFile("product_history.csv",rows);
    showMessage("商品履歴CSVを出力しました。","ok");
  }catch(e){
    showMessage("商品履歴CSV出力エラー。\n"+e.message,"err");
  }
}

function exportCsv(){
  const rows=buildHistoryExportRows(logs);
  downloadCsvFile("inventory_history_latest.csv",rows);
}


async function exportAllDataCsv(){
  try{
    showMessage("全履歴CSVを作成中...");
    const allLogs=await sbAll("inventory_logs?select=*&order=created_at.desc",1000,50000);
    try{
      if(typeof fetchProductsByBarcodes==="function"){
        await fetchProductsByBarcodes(allLogs.map(l=>l.barcode));
      }
    }catch(_){}
    const rows=buildHistoryExportRows(allLogs);
    if(rows.length<=1){
      showMessage("出力する履歴がありません。","err");
      return;
    }
    downloadCsvFile("all_inventory_history.csv",rows);
    showMessage(`全履歴CSVを出力しました：${rows.length-1}件`,"ok");
  }catch(e){
    showMessage("全履歴CSV出力エラー。\n"+e.message,"err");
  }
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
  beep(true);
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

function on(id,event,fn){
  const x=el(id);
  if(x)x.addEventListener(event,fn);
}

function bindEvents(){
  on("appPopupClose","click",hidePopup);
  on("reloadBtn","click",reloadAll);
  on("productForm","submit",saveProduct);
  on("staffForm","submit",saveStaff);

  on("manualForm","submit",e=>{
    e.preventDefault();
    registerBarcode(el("barcodeInput").value);
  });

  on("barcodeInput","input",()=>syncHistoryFromScanBarcode());
  on("productBarcode","input",()=>renderProductStockInfo());
  on("productHistoryBarcodeInput","input",()=>selectProductHistoryByBarcode());
  on("productNameSearchInput","input",handleProductNameSearchInput);
  on("productFormNameSearchInput","input",handleProductFormNameSearchInput);

  on("startCameraBtn","click",startCamera);
  on("historyCameraBtn","click",startCamera);
  on("stopCameraBtn","click",stopCamera);

  on("csvBtn","click",exportCsv);
  on("allDataCsvBtn","click",exportAllDataCsv);
  on("exportAllCsvBtn","click",exportAllDataCsv);
  on("productHistoryCsvBtn","click",exportProductHistoryCsv);
  on("csvFile","change",e=>importCsvFile(e.target.files&&e.target.files[0]));
  on("downloadSampleCsvBtn","click",downloadSampleCsv);

  on("bulkStockCheckBtn","click",bulkStockCheckVisible);
  on("stockCheckBtn","click",saveStockCheck);
  on("showAllSelectedHistoryBtn","click",()=>showProductHistoryForBarcode(selectedBarcode));
  on("showAfterOldestCheckBtn","click",()=>{
    selectedHistoryMode="afterOldestCheck";
    showProductHistoryForBarcode(selectedBarcode);
  });
}

bindEvents();
reloadAll();


/* ===== v50 Japanese / Korean UI toggle ===== */
const I18N = {
  ja: {
    "ARICO TOKYO 在庫変動確認シート":"ARICO TOKYO 在庫変動確認シート",
    
    "再読み込み":"再読み込み",
    "在庫変動登録":"在庫変動登録",
    "持ち出し・入荷・在庫修正を記録します":"持ち出し・入荷・在庫修正を記録します",
    "区分":"区分",
    "担当者":"担当者",
    "数量":"数量",
    "備考（自由入力・連続スキャン中は保持）":"備考（自由入力・連続スキャン中は保持）",
    "📷 カメラでバーコード読み取り":"📷 カメラでバーコード読み取り",
    "停止":"停止",
    "バーコード入力":"バーコード入力",
    "登録":"登録",
    "担当者設定":"担当者設定",
    "スマホ側の担当者プルダウンに反映されます":"スマホ側の担当者プルダウンに反映されます",
    "担当者名":"担当者名",
    "担当者を追加":"担当者を追加",
    "操作":"操作",
    "削除":"削除",
    "商品登録":"商品登録",
    "バーコード":"バーコード",
    "商品名":"商品名",
    "現在庫":"現在庫",
    "棚番":"棚番",
    "商品を登録 / 更新":"商品を登録 / 更新",
    "CSV取り込み":"CSV取り込み",
    "商品マスターをまとめて登録・更新できます":"商品マスターをまとめて登録・更新できます",
    "簡単インポート":"簡単インポート",
    "上書き対応":"上書き対応",
    "サンプルあり":"サンプルあり",
    "⬆ 追加・更新で取り込み":"⬆ 追加・更新で取り込み",
    "サンプルCSVをダウンロード":"サンプルCSVをダウンロード",
    "商品別履歴":"商品別履歴",
    "商品履歴検索":"商品履歴検索",
    "在庫チェック":"在庫チェック",
    "チェック記録":"チェック記録",
    "全履歴を表示":"全履歴を表示",
    "チェック以降を表示":"チェック以降を表示",
    "入力日時":"入力日時",
    "在庫数":"在庫数",
    "入荷":"入荷",
    "出荷":"出荷",
    "全体履歴":"全体履歴",
    "履歴CSV":"履歴CSV",
    "全データCSV":"全データCSV",
    "検索をクリア":"検索をクリア"
  },
  ko: {
    "ARICO TOKYO 在庫変動確認シート":"ARICO TOKYO 재고 변동 확인 시트",
    
    "再読み込み":"다시 불러오기",
    "在庫変動登録":"재고 변동 등록",
    "持ち出し・入荷・在庫修正を記録します":"반출・입고・재고 수정을 기록합니다",
    "区分":"구분",
    "担当者":"담당자",
    "数量":"수량",
    "備考（自由入力・連続スキャン中は保持）":"비고（자유 입력・연속 스캔 중 유지）",
    "📷 カメラでバーコード読み取り":"📷 카메라로 바코드 읽기",
    "停止":"정지",
    "バーコード入力":"바코드 입력",
    "登録":"등록",
    "担当者設定":"담당자 설정",
    "スマホ側の担当者プルダウンに反映されます":"스마트폰 담당자 선택 목록에 반영됩니다",
    "担当者名":"담당자명",
    "担当者を追加":"담당자 추가",
    "操作":"작업",
    "削除":"삭제",
    "商品登録":"상품 등록",
    "バーコード":"바코드",
    "商品名":"상품명",
    "現在庫":"현재 재고",
    "棚番":"선반 번호",
    "商品を登録 / 更新":"상품 등록 / 업데이트",
    "CSV取り込み":"CSV 가져오기",
    "商品マスターをまとめて登録・更新できます":"상품 마스터를 일괄 등록・업데이트합니다",
    "簡単インポート":"간단 가져오기",
    "上書き対応":"덮어쓰기 지원",
    "サンプルあり":"샘플 제공",
    "⬆ 追加・更新で取り込み":"⬆ 추가・업데이트 가져오기",
    "サンプルCSVをダウンロード":"샘플 CSV 다운로드",
    "商品別履歴":"상품별 이력",
    "商品履歴検索":"상품 이력 검색",
    "在庫チェック":"재고 확인",
    "チェック記録":"확인 기록",
    "全履歴を表示":"전체 이력 표시",
    "チェック以降を表示":"확인 이후 표시",
    "入力日時":"입력 일시",
    "在庫数":"작업 전 재고",
    "入荷":"입고",
    "出荷":"출고",
    "全体履歴":"전체 이력",
    "履歴CSV":"이력 CSV",
    "全データCSV":"전체 데이터 CSV",
    "検索をクリア":"검색 초기화"
  }
};

const I18N_REVERSE = {};
for(const lang of Object.keys(I18N)){
  for(const [ja,ko] of Object.entries(I18N.ko)){
    I18N_REVERSE[ko]=ja;
  }
}

function getLang(){return localStorage.getItem("arico_lang")||"ja";}

function setLang(lang){
  localStorage.setItem("arico_lang",lang);
  applyLang();
}

function translateText(raw,lang){
  const t=String(raw||"").trim();
  const ja=I18N_REVERSE[t]||t;
  return I18N[lang][ja]||ja;
}

function walkTextNodes(root,lang){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      const parent=node.parentElement;
      if(!parent)return NodeFilter.FILTER_REJECT;
      if(["SCRIPT","STYLE","TEXTAREA","OPTION"].includes(parent.tagName))return NodeFilter.FILTER_REJECT;
      if(parent.closest(".table-wrap tbody"))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    const original=node.nodeValue;
    const trimmed=original.trim();
    if(!trimmed)return;
    const translated=translateText(trimmed,lang);
    if(translated!==trimmed){
      node.nodeValue=original.replace(trimmed,translated);
    }
  });
}

function applyPlaceholders(lang){
  const map={
    ja:{
      staffNameInput:"例：田中",
      barcodeInput:"バーコードをスキャン、または手入力",
      memo:"例：棚卸差異、サンプル使用、不良返品など",
      productBarcode:"バーコードを入力",
      productName:"商品名を必ず入力",
      location:"例：A-01",
      productHistoryBarcodeInput:"バーコードを入力またはスキャン"
    },
    ko:{
      staffNameInput:"예：다나카",
      barcodeInput:"바코드를 스캔하거나 직접 입력",
      memo:"예：재고 차이, 샘플 사용, 불량 반품 등",
      productBarcode:"바코드를 입력",
      productName:"상품명을 반드시 입력",
      location:"예：A-01",
      productHistoryBarcodeInput:"바코드를 입력 또는 스캔"
    }
  };
  const m=map[lang];
  Object.keys(m).forEach(id=>{
    const x=document.getElementById(id);
    if(x)x.placeholder=m[id];
  });
}

function applySelectLabels(lang){
  const labels=lang==="ko"
    ?{staff:"담당자를 선택",checkerName:"확인자를 선택"}
    :{staff:"担当者を選択",checkerName:"チェック者を選択"};
  const staff=document.getElementById("staff");
  if(staff&&staff.options.length)staff.options[0].textContent=labels.staff;
  const checker=document.getElementById("checkerName");
  if(checker&&checker.options.length)checker.options[0].textContent=labels.checkerName;
}

function applyLang(){
  const lang=getLang();
  walkTextNodes(document.body,lang);
  applyPlaceholders(lang);
  applySelectLabels(lang);

  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.classList.toggle("active",lang==="ja");
  if(ko)ko.classList.toggle("active",lang==="ko");
}

window.addEventListener("DOMContentLoaded",()=>{
  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.onclick=()=>setLang("ja");
  if(ko)ko.onclick=()=>setLang("ko");
  setTimeout(applyLang,50);
});


/* v51 language button fallback */
function bindLanguageButtons(){
  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.onclick=()=>setLang("ja");
  if(ko)ko.onclick=()=>setLang("ko");
  if(typeof applyLang==="function")applyLang();
}
window.addEventListener("load",bindLanguageButtons);
setTimeout(bindLanguageButtons,300);


/* v58 direct bind for product history csv */
window.addEventListener("DOMContentLoaded",()=>{
  const btn=document.getElementById("productHistoryCsvBtn");
  if(btn)btn.onclick=exportProductHistoryCsv;
});
setTimeout(()=>{
  const btn=document.getElementById("productHistoryCsvBtn");
  if(btn)btn.onclick=exportProductHistoryCsv;
},500);



/* ===== v59 camera guide ===== */
function showCameraGuide(){
  const g=document.getElementById("cameraGuideOverlay");
  if(g)g.classList.add("is-active");
}

function hideCameraGuide(){
  const g=document.getElementById("cameraGuideOverlay");
  if(g)g.classList.remove("is-active");
}

/* v62 all csv fallback */
window.addEventListener("DOMContentLoaded",()=>{
  ["allDataCsvBtn","exportAllCsvBtn"].forEach(id=>{
    const b=document.getElementById(id);
    if(b)b.onclick=exportAllDataCsv;
  });
  const hb=document.getElementById("historyCameraBtn");
  if(hb)hb.onclick=startCamera;
});

/* v67 product form search fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
});
setTimeout(()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
},500);

/* v68 product form search fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
});
setTimeout(()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
},500);

/* v69 product form search fallback */
function bindProductFormSearchInput(){
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
}
window.addEventListener("DOMContentLoaded",bindProductFormSearchInput);
window.addEventListener("load",bindProductFormSearchInput);
setTimeout(bindProductFormSearchInput,500);
setTimeout(bindProductFormSearchInput,1500);

/* v70 popup fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const c=document.getElementById("appPopupClose");
  if(c)c.onclick=hidePopup;
});

/* ===== v72 Smaregi stock check ===== */
let smaregiSnapshot=null;
let smaregiStockItems=[];
let smaregiStockChecks=[];
let smaregiSelectedBarcode="";

function getSmaregiCheck(barcode){
  return smaregiStockChecks.find(c=>String(c.barcode)===String(barcode));
}

function getSmaregiDifference(item){
  const check=getSmaregiCheck(item.barcode);
  return check ? Number(check.actual_stock)-Number(item.smaregi_stock||0) : null;
}

function getSmaregiAppStock(barcode){
  const product=gp(barcode);
  return product ? Number(product.base_stock||0) : "";
}

function getSmaregiCheckerName(){
  return String(el("smaregiCheckerName")?.value||"").trim();
}

function renderSmaregiSelectedProduct(){
  const box=el("smaregiSelectedProduct");
  const input=el("smaregiActualStockInput");
  if(!box||!input)return;
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(smaregiSelectedBarcode));
  if(!item){
    box.textContent=smaregiSelectedBarcode ? `対象商品が見つかりません：${smaregiSelectedBarcode}` : "商品コードを入力してください。";
    box.className="message"+(smaregiSelectedBarcode?" err":"");
    input.value="";
    return;
  }
  const check=getSmaregiCheck(item.barcode);
  box.textContent=`${item.product_name||item.barcode}\nスマレジ在庫：${Number(item.smaregi_stock||0)} / シート在庫：${getSmaregiAppStock(item.barcode)}${check ? ` / チェック済み：${check.actual_stock}` : ""}`;
  box.className="message ok";
  input.value=check ? check.actual_stock : "";
  input.focus();
}

function renderSmaregiStockChecks(){
  const body=el("smaregiStockCheckBody");
  const badge=el("smaregiSnapshotBadge");
  if(!body)return;

  if(badge){
    badge.textContent=smaregiSnapshot
      ? `最終取得日時：${fmt(smaregiSnapshot.imported_at)}${smaregiSnapshot.range_from ? ` / 変動抽出：${fmt(smaregiSnapshot.range_from)} 以降` : ""}`
      : "未取得";
  }
  const progress=el("smaregiProgressBadge");
  const activeItems=smaregiStockItems;
  const checkedCount=activeItems.filter(item=>getSmaregiCheck(item.barcode)).length;
  if(progress)progress.textContent=`チェック済み：${checkedCount} / ${activeItems.length}`;

  const keyword=String(el("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
  const differenceOnly=Boolean(el("smaregiDifferenceOnly")?.checked);
  const visible=smaregiStockItems.filter(item=>{
    const difference=getSmaregiDifference(item);
    const matches=!keyword
      || String(item.product_name||"").toLowerCase().includes(keyword)
      || String(item.barcode||"").toLowerCase().includes(keyword);
    return matches && (!differenceOnly || (difference!==null && difference!==0));
  });

  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="6" class="smaregi-empty">「スマレジAPIから変動商品取得」で最新データを表示するか、テスト用CSVを取り込んでください。</td></tr>';
    return;
  }

  if(!visible.length){
    body.innerHTML='<tr><td colspan="6" class="smaregi-empty">表示する商品がありません。</td></tr>';
    return;
  }

  body.innerHTML=visible.map(item=>{
    const check=getSmaregiCheck(item.barcode);
    const difference=getSmaregiDifference(item);
    const differenceClass=difference===null||difference===0 ? "" : (difference<0 ? " is-negative" : " is-positive");
    const status=check ? "チェック済み" : "未チェック";
    const statusClass=check ? " is-checked" : "";
    return `<tr>
      <td><span class="smaregi-status${statusClass}">${status}</span></td>
      <td>${esc(item.product_name||"")}</td>
      <td>${esc(item.barcode)}</td>
      <td>${Number(item.smaregi_stock||0)}</td>
      <td>${esc(getSmaregiAppStock(item.barcode))}</td>
      <td class="smaregi-row-actions">
        <button type="button" class="smaregi-select-btn" data-barcode="${esc(item.barcode)}">入力</button>
        ${check ? `<button type="button" class="secondary smaregi-uncheck-btn" data-barcode="${esc(item.barcode)}">チェック解除</button>` : ""}
        ${difference!==null&&difference!==0 ? `<button type="button" class="secondary smaregi-cause-btn" data-barcode="${esc(item.barcode)}">原因確認</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".smaregi-select-btn").forEach(button=>{
    button.onclick=()=>selectSmaregiStockItem(button.dataset.barcode);
  });
  body.querySelectorAll(".smaregi-uncheck-btn").forEach(button=>{
    button.onclick=()=>clearSmaregiStockCheck(button.dataset.barcode);
  });
  body.querySelectorAll(".smaregi-cause-btn").forEach(button=>{
    button.onclick=()=>showSmaregiCauseDetail(button.dataset.barcode);
  });
}

function selectSmaregiStockItem(barcode){
  smaregiSelectedBarcode=String(barcode||"").trim();
  if(el("smaregiCheckBarcodeInput"))el("smaregiCheckBarcodeInput").value=smaregiSelectedBarcode;
  renderSmaregiSelectedProduct();
}

async function loadLatestSmaregiSnapshot(){
  try{
    showMessage("スマレジ在庫スナップショットを取得中...");
    const snapshots=await sb("smaregi_stock_snapshots?select=*&order=imported_at.desc&limit=1");
    smaregiSnapshot=Array.isArray(snapshots)&&snapshots.length ? snapshots[0] : null;
    smaregiStockItems=[];
    smaregiStockChecks=[];

    if(smaregiSnapshot){
      const snapshotId=encodeURIComponent(smaregiSnapshot.id);
      smaregiStockItems=await sbAll(`smaregi_stock_items?select=*&snapshot_id=eq.${snapshotId}&order=product_name.asc`,1000,20000);
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
    }

    renderSmaregiStockChecks();
    showMessage(smaregiSnapshot
      ? `スマレジ在庫を取得しました：${smaregiStockItems.length}件`
      : "スマレジ在庫スナップショットはまだありません。CSVを取り込んでください。",smaregiSnapshot?"ok":"");
  }catch(e){
    showMessage("スマレジ在庫取得エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
}

async function syncSmaregiStockFromApi(){
  try{
    showMessage("スマレジAPIから変動商品を取得中...");
    const res=await fetch("/api/smaregi-sync",{method:"POST",headers:{"Content-Type":"application/json"}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`APIエラー ${res.status}`);
    await loadLatestSmaregiSnapshot();
    showPopup("スマレジAPI取得完了",`前回チェック以降の変動商品を取得しました。\n対象商品：${Number(data.item_count||0)}件\n変動履歴：${Number(data.change_count||0)}件${data.warning ? `\n\n注意：${data.warning}` : ""}`);
  }catch(e){
    showMessage("スマレジAPI取得エラー。\n"+e.message,"err");
  }
}

function smaregiCsvToRows(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");

  const headers=parsed[0].map(v=>String(v||"").trim().toLowerCase());
  const rows=[];
  const seen=new Set();
  for(const cols of parsed.slice(1)){
    const raw={};
    headers.forEach((h,i)=>raw[h]=cols[i]??"");
    const barcode=String(getCsvValue(raw,["barcode","バーコード","jan","jancode","janコード"])).trim();
    const product_name=String(getCsvValue(raw,["product_name","productname","name","商品名","品名"])).trim();
    const stockRaw=String(getCsvValue(raw,["smaregi_stock","smaregistock","スマレジ在庫","在庫","stock","quantity"])).trim();
    if(!barcode)continue;
    const smaregi_stock=Number(stockRaw||0);
    if(!Number.isFinite(smaregi_stock))throw new Error(`${barcode} のスマレジ在庫が数値ではありません。`);
    if(seen.has(barcode))throw new Error(`${barcode} がCSV内で重複しています。`);
    seen.add(barcode);
    rows.push({barcode,product_name,smaregi_stock:Math.trunc(smaregi_stock)});
  }
  if(!rows.length)throw new Error("取り込み対象の商品がありません。");
  return rows;
}

async function importSmaregiCsvFile(file){
  if(!file)return;
  try{
    showMessage("スマレジ在庫CSVを取り込み中...");
    const rows=smaregiCsvToRows(decodeCsvBuffer(await file.arrayBuffer()));
    const imported_by=el("checkerName")?.value||el("staff")?.value||"";
    const snapshots=await sb("smaregi_stock_snapshots",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([{imported_by,note:"CSV手動取り込み"}])
    });
    const snapshot=Array.isArray(snapshots)&&snapshots[0];
    if(!snapshot)throw new Error("スナップショットを作成できませんでした。");

    for(let i=0;i<rows.length;i+=500){
      await sb("smaregi_stock_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(rows.slice(i,i+500).map(row=>({...row,snapshot_id:snapshot.id})))
      });
    }

    smaregiSnapshot=snapshot;
    smaregiStockItems=rows.map(row=>({...row,snapshot_id:snapshot.id}));
    smaregiStockChecks=[];
    renderSmaregiStockChecks();
    await loadLatestSmaregiSnapshot();
    showPopup("取り込み完了",`スマレジ在庫CSVを取り込みました。\n対象商品：${rows.length}件`);
  }catch(e){
    showMessage("スマレジ在庫CSV取り込みエラー。\n"+e.message,"err");
  }finally{
    const input=el("smaregiCsvFile");
    if(input)input.value="";
  }
}

async function completeSmaregiStockCheck(){
  if(!smaregiSnapshot){
    showMessage("完了するスマレジ在庫チェックがありません。","err");
    return;
  }
  if(!confirm("今回のチェックを完了しますか？\n次回はこの完了日時以降に変動した商品のみ表示されます。"))return;
  try{
    const completed_at=new Date().toISOString();
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at})
    });
    smaregiSnapshot.completed_at=completed_at;
    renderSmaregiStockChecks();
    showPopup("チェック完了","今回のチェックを完了しました。\n次回取得時は、この時刻以降の在庫変動商品だけを抽出します。");
  }catch(e){
    showMessage("チェック完了保存エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
}

async function saveSmaregiActualStock(barcode,value){
  if(!smaregiSnapshot)return;
  if(!String(barcode||"").trim()){
    showMessage("商品コードを読み込んでください。","err");
    el("smaregiCheckBarcodeInput")?.focus();
    return;
  }
  if(String(value).trim()===""){
    showMessage("実在庫を入力してください。","err");
    renderSmaregiStockChecks();
    return;
  }

  const actual_stock=Number(value);
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item || !Number.isInteger(actual_stock) || actual_stock<0){
    showMessage("実在庫は0以上の整数で入力してください。","err");
    renderSmaregiStockChecks();
    return;
  }

  try{
    const difference=actual_stock-Number(item.smaregi_stock||0);
    const checked_by=getSmaregiCheckerName();
    if(!checked_by){
      showMessage("担当者を選択または入力してください。","err");
      el("smaregiCheckerName")?.focus();
      return;
    }
    const checked_at=new Date().toISOString();
    await sb("smaregi_stock_checks?on_conflict=snapshot_id,barcode",{
      method:"POST",
      headers:{Prefer:"resolution=merge-duplicates,return=representation"},
      body:JSON.stringify([{snapshot_id:smaregiSnapshot.id,barcode,actual_stock,difference,checked_by,checked_at}])
    });

    const old=getSmaregiCheck(barcode);
    const next={...(old||{}),snapshot_id:smaregiSnapshot.id,barcode,actual_stock,difference,checked_by,checked_at};
    smaregiStockChecks=smaregiStockChecks.filter(c=>String(c.barcode)!==String(barcode));
    smaregiStockChecks.push(next);
    renderSmaregiStockChecks();
    console.log("[Stock Check Saved]",{
      productCode:barcode,
      productName:item.product_name||"",
      smaregiStock:Number(item.smaregi_stock||0),
      appStock:getSmaregiAppStock(barcode),
      actualStock:actual_stock,
      diff:difference,
      staffName:checked_by,
      checkedAt:checked_at
    });
    showMessage(`実在庫を保存しました：${item.product_name||barcode} / 差異 ${difference}`,"ok");
    el("smaregiActualStockInput").value="";
    el("smaregiCheckBarcodeInput").value="";
    smaregiSelectedBarcode="";
    renderSmaregiSelectedProduct();
    el("smaregiCheckBarcodeInput").focus();
  }catch(e){
    showMessage("実在庫保存エラー。\n"+e.message,"err");
  }
}

async function saveSelectedSmaregiActualStock(){
  await saveSmaregiActualStock(smaregiSelectedBarcode,el("smaregiActualStockInput")?.value??"");
}

async function clearSmaregiStockCheck(barcode){
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item||!smaregiSnapshot)return;
  if(!confirm(`${item.product_name||barcode} のチェック済み状態を解除しますか？`))return;
  try{
    await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
      method:"DELETE",
      headers:{Prefer:"return=minimal"}
    });
    smaregiStockChecks=smaregiStockChecks.filter(check=>String(check.barcode)!==String(barcode));
    if(String(smaregiSelectedBarcode)===String(barcode))renderSmaregiSelectedProduct();
    renderSmaregiStockChecks();
    showMessage(`チェックを解除しました：${item.product_name||barcode}`,"ok");
  }catch(e){
    showMessage("チェック解除エラー。\n"+e.message,"err");
  }
}

async function openHistoryFromSmaregi(barcode){
  const input=el("productHistoryBarcodeInput");
  if(input)input.value=barcode;
  await showProductHistoryForBarcode(barcode);
  el("productHistoryCard")?.scrollIntoView({behavior:"smooth",block:"start"});
}

function smaregiCsvRows(differenceOnly=false){
  const rows=[["商品コード","商品名","スマレジ在庫数","在庫管理シート上の在庫数","実在庫数","差異","担当者","チェック日時","チェック済み状態"]];
  smaregiStockItems.forEach(item=>{
    const check=getSmaregiCheck(item.barcode);
    const difference=check ? getSmaregiDifference(item) : "";
    if(differenceOnly&&difference===0)return;
    if(differenceOnly&&!check)return;
    rows.push([
      item.barcode,
      item.product_name||"",
      Number(item.smaregi_stock||0),
      getSmaregiAppStock(item.barcode),
      check?.actual_stock??"",
      difference,
      check?.checked_by||"",
      check?.checked_at ? fmt(check.checked_at) : "",
      check ? "チェック済み" : "未チェック"
    ]);
  });
  return rows;
}

function exportSmaregiCheckCsv(differenceOnly=false){
  if(!smaregiSnapshot){
    showMessage("出力するスマレジ在庫がありません。","err");
    return;
  }
  const rows=smaregiCsvRows(differenceOnly);
  downloadCsvFile(differenceOnly?"smaregi_stock_difference_only.csv":"smaregi_stock_check_all.csv",rows);
  showMessage(`${differenceOnly?"差異のみ":"全体"}CSVを出力しました：${rows.length-1}件`,"ok");
}

function hasSmaregiChangeBefore(log,smaregiChanges){
  const time=new Date(log.created_at).getTime();
  return smaregiChanges.some(change=>{
    const changeTime=new Date(change.changed_at).getTime();
    return Number.isFinite(changeTime)&&changeTime<=time;
  });
}

function hasAppLogAfter(change,appLogs){
  const time=new Date(change.changed_at).getTime();
  return appLogs.some(log=>{
    const logTime=new Date(log.created_at).getTime();
    return Number.isFinite(logTime)&&logTime>=time;
  });
}

function looksLikeOnlineShipment(change,smaregiChanges){
  const amount=Number(change.amount||0);
  if(amount<=0)return false;
  const time=new Date(change.changed_at).getTime();
  return smaregiChanges.some(other=>{
    const otherTime=new Date(other.changed_at).getTime();
    return Number(other.amount||0)<0&&otherTime>=time&&otherTime-time<=24*60*60*1000;
  });
}

function buildSmaregiAppHistoryRows(productLogs,barcode,smaregiChanges){
  const product=gp(barcode);
  let running=Number(product?.base_stock||0);
  const desc=productLogs.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  return desc.map(log=>{
    const qty=Number(log.quantity||0);
    const after=running;
    if(log.type==="入荷")running-=qty;
    if(log.type==="出荷")running+=qty;
    if(log.type==="在庫修正")running=qty;
    const suspicious=smaregiChanges.length>0&&!hasSmaregiChangeBefore(log,smaregiChanges);
    return `<tr class="${suspicious?"smaregi-suspicious-row":""}"><td>${fmt(log.created_at)}</td><td>${esc(log.type)}</td><td>${qty}</td><td>${esc(log.staff||"")}</td><td>${esc(log.memo||"")}${suspicious?'<div class="smaregi-warning">要確認：対応する先行スマレジ変動が見つかりません。</div>':""}</td><td>${after}</td></tr>`;
  }).join("");
}

function buildSmaregiChangeRows(smaregiChanges,appLogs){
  return smaregiChanges.map(change=>{
    const suspicious=!hasAppLogAfter(change,appLogs);
    const online=looksLikeOnlineShipment(change,smaregiChanges);
    return `<tr class="${suspicious?"smaregi-suspicious-row":(online?"smaregi-online-row":"")}"><td>${fmt(change.changed_at)}</td><td>${esc(change.stock_division||"")}</td><td>${Number(change.amount||0)}</td><td>${Number(change.stock_amount||0)}</td><td>${esc(change.memo||"")}${suspicious?'<div class="smaregi-warning">要確認：このスマレジ変動後のシート履歴が見つかりません。</div>':""}${online?'<div class="smaregi-online-note">オンライン注文の発送候補：取り置き解除の在庫増と売上の在庫減が近接しています。</div>':""}</td></tr>`;
  }).join("");
}

async function showSmaregiCauseDetail(barcode){
  const detail=el("smaregiCauseDetail");
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!detail||!item)return;
  detail.hidden=false;
  detail.innerHTML='<div class="message">原因確認データを読み込み中...</div>';
  try{
    await fetchProductByBarcode(barcode);
    const appLogs=await loadProductHistoryByBarcode(barcode);
    let smaregiChanges=[];
    try{
      smaregiChanges=await sbAll(`smaregi_stock_changes?select=*&snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}&order=changed_at.desc`,1000,10000);
    }catch(_){
      smaregiChanges=[];
    }
    const check=getSmaregiCheck(barcode);
    const difference=getSmaregiDifference(item);
    detail.innerHTML=`
      <div class="section-title"><h3>差異原因確認</h3><button type="button" id="closeSmaregiCauseDetailBtn" class="secondary">閉じる</button></div>
      <div class="smaregi-detail-summary">
        <div><strong>商品名</strong><span>${esc(item.product_name||"")}</span></div>
        <div><strong>商品コード</strong><span>${esc(barcode)}</span></div>
        <div><strong>スマレジ在庫</strong><span>${Number(item.smaregi_stock||0)}</span></div>
        <div><strong>シート在庫</strong><span>${esc(getSmaregiAppStock(barcode))}</span></div>
        <div><strong>実在庫</strong><span>${check?.actual_stock??"-"}</span></div>
        <div><strong>差異</strong><span class="smaregi-difference${difference ? " is-negative" : ""}">${difference??"-"}</span></div>
        <div><strong>担当者</strong><span>${esc(check?.checked_by||"")}</span></div>
        <div><strong>チェック日時</strong><span>${check?.checked_at?fmt(check.checked_at):""}</span></div>
      </div>
      <h3>在庫管理シート側の履歴</h3>
      <p class="section-note">赤い行は調査優先です。通常はスマレジ変動の後にシート在庫が動きます。</p>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>担当者</th><th>備考</th><th>処理後在庫</th></tr></thead><tbody>${buildSmaregiAppHistoryRows(appLogs,barcode,smaregiChanges)||'<tr><td colspan="6">履歴なし</td></tr>'}</tbody></table></div>
      <h3>スマレジ側の在庫変動履歴</h3>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>区分</th><th>数量</th><th>在庫数</th><th>理由・備考</th></tr></thead><tbody>${buildSmaregiChangeRows(smaregiChanges,appLogs)||'<tr><td colspan="5">取得可能なスマレジ履歴はありません。</td></tr>'}</tbody></table></div>
    `;
    el("closeSmaregiCauseDetailBtn").onclick=()=>{detail.hidden=true;detail.innerHTML="";};
    detail.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){
    detail.innerHTML=`<div class="message err">原因確認データ取得エラー。\n${esc(e.message)}</div>`;
  }
}

function showSmaregiStockCheck(){
  const card=el("smaregiStockCheckCard");
  const main=document.querySelector("main.grid");
  if(!card||!main)return;
  main.classList.add("smaregi-mode");
  card.hidden=false;
  renderSmaregiStockChecks();
  window.scrollTo({top:0,behavior:"smooth"});
}

function hideSmaregiStockCheck(){
  const card=el("smaregiStockCheckCard");
  const main=document.querySelector("main.grid");
  if(!card||!main)return;
  card.hidden=true;
  main.classList.remove("smaregi-mode");
  window.scrollTo({top:0,behavior:"smooth"});
}

function bindSmaregiStockCheckEvents(){
  on("openSmaregiStockCheckBtn","click",showSmaregiStockCheck);
  on("closeSmaregiStockCheckBtn","click",hideSmaregiStockCheck);
  on("syncSmaregiStockBtn","click",syncSmaregiStockFromApi);
  on("refreshSmaregiChecksBtn","click",loadLatestSmaregiSnapshot);
  on("smaregiCsvFile","change",e=>importSmaregiCsvFile(e.target.files&&e.target.files[0]));
  on("exportSmaregiCheckCsvBtn","click",()=>exportSmaregiCheckCsv(false));
  on("exportSmaregiDifferenceCsvBtn","click",()=>exportSmaregiCheckCsv(true));
  on("completeSmaregiStockCheckBtn","click",completeSmaregiStockCheck);
  on("smaregiStockSearchInput","input",renderSmaregiStockChecks);
  on("smaregiDifferenceOnly","change",renderSmaregiStockChecks);
  on("smaregiCheckBarcodeInput","change",e=>selectSmaregiStockItem(e.target.value));
  on("smaregiCheckBarcodeInput","keydown",e=>{if(e.key==="Enter"){e.preventDefault();selectSmaregiStockItem(e.target.value);}});
  on("saveSmaregiActualStockBtn","click",saveSelectedSmaregiActualStock);
  on("smaregiActualStockInput","keydown",e=>{if(e.key==="Enter"){e.preventDefault();saveSelectedSmaregiActualStock();}});
  on("smaregiCheckerName","change",e=>localStorage.setItem("arico_smaregi_checker",e.target.value||""));
  hideSmaregiStockCheck();
  renderSmaregiStockChecks();
}
window.addEventListener("DOMContentLoaded",bindSmaregiStockCheckEvents);

/* v71 popup close fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const close=document.getElementById("appPopupClose");
  if(close)close.onclick=hidePopup;
  const popup=document.getElementById("appPopup");
  if(popup){
    popup.addEventListener("click",(e)=>{
      if(e.target===popup)hidePopup();
    });
  }
});

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
  const bulk=document.getElementById("bulkStockCheckBtn");
  if(bulk)bulk.onclick=bulkStockCheckVisible;
}
window.addEventListener("DOMContentLoaded",bindCameraZoomControls);
window.addEventListener("load",bindCameraZoomControls);
setTimeout(bindCameraZoomControls,500);
