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

    if(!qtyRaw||!Number.isFinite(qty)||qty<=0){
      beep(false);
      showMessage("数量を入力してください。","err");
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

    await sb("inventory_logs",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
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
      created_at:new Date().toISOString(),
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
    const stockAfter=running;
    let stockQty="";
    let inQty="";
    let outQty="";

    if(log.type==="入荷"){
      inQty=q;
      running-=q;
    }else if(log.type==="出荷"){
      outQty=q;
      running+=q;
    }else if(log.type==="在庫修正"){
      stockQty=q;
    }

    const key=String(log.id||log.created_at+log.type+log.quantity+log.memo);
    rowsByKey.set(key,{log,stockAfter,stockQty,inQty,outQty});
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
      <td>${r.stockQty}</td>
      <td>${r.inQty}</td>
      <td>${r.outQty}</td>
      <td>${r.stockAfter}</td>
      <td>${esc(r.log.memo||"")}</td>
    </tr>`;
  }).join("");
}

function renderGlobalHistory(){
  const body=el("historyBody");
  if(!body)return;
  body.innerHTML=buildGlobalHistoryRows();
}

function buildGlobalHistoryRows(){
  return logs.map(log=>{
    const q=Number(log.quantity||0);
    const stockQty=log.type==="在庫修正"?q:"";
    const inQty=log.type==="入荷"?q:"";
    const outQty=log.type==="出荷"?q:"";
    return `<tr>
      <td>${fmt(log.created_at)}</td>
      <td>${esc(log.type)}</td>
      <td>${esc(log.staff)}</td>
      <td>${esc(gp(log.barcode)?.name||log.product_name||"")}</td>
      <td>${stockQty}</td>
      <td>${inQty}</td>
      <td>${outQty}</td>
      <td></td>
      <td>${esc(log.memo||"")}</td>
    </tr>`;
  }).join("");
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
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCsv(){
  const rows=[["入力日時","区分","担当者","商品名","数量","備考"]];

  for(const l of logs){
    rows.push([fmt(l.created_at),l.type,l.staff,l.product_name,l.quantity,l.memo||""]);
  }

  downloadCsvFile("inventory_history_latest.csv",rows);
}

async function exportAllDataCsv(){
  try{
    showMessage("全データCSVを作成中...");

    const allLogs=await sbAll("inventory_logs?select=*&order=created_at.desc",1000,50000);
    const rows=[["入力日時","区分","担当者","バーコード","商品名","数量","備考"]];

    for(const l of allLogs){
      rows.push([fmt(l.created_at),l.type,l.staff,l.barcode,l.product_name,l.quantity,l.memo||""]);
    }

    downloadCsvFile("all_inventory_history.csv",rows);
    showMessage("全データCSVを出力しました。","ok");
  }catch(e){
    showMessage("全データCSV出力エラー。\n"+e.message,"err");
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

async function startCamera(){
  try{
    showMessage("カメラを起動しています...");

    const v=el("video");
    const qr=el("qr-reader");

    if(qr)qr.style.display="none";
    if(v)v.style.display="block";

    await ensureZXing();
    if(window.ZXing){
      if(!zxingReader){
        const hints=new Map();
        const formats=[
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8,
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.ITF,
          ZXing.BarcodeFormat.UPC_A,
          ZXing.BarcodeFormat.UPC_E
        ];
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,formats);
        hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
        zxingReader=new ZXing.BrowserMultiFormatReader(hints,500);
      }

      zxingRunning=true;

      await zxingReader.decodeFromConstraints(
        {video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}},
        v,
        async(result)=>{
          if(result&&zxingRunning){
            await handleScannedCode(result.getText());
          }
        }
      );

      showMessage("カメラ読取中です。バーコードを横向きに大きく写してください。","ok");
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

  on("startCameraBtn","click",startCamera);
  on("stopCameraBtn","click",stopCamera);

  on("csvBtn","click",exportCsv);
  on("allDataCsvBtn","click",exportAllDataCsv);
  on("csvFile","change",e=>importCsvFile(e.target.files&&e.target.files[0]));
  on("downloadSampleCsvBtn","click",downloadSampleCsv);

  on("stockCheckBtn","click",saveStockCheck);
  on("showAllSelectedHistoryBtn","click",()=>showProductHistoryForBarcode(selectedBarcode));
  on("showAfterOldestCheckBtn","click",()=>{
    selectedHistoryMode="afterOldestCheck";
    showProductHistoryForBarcode(selectedBarcode);
  });
}

bindEvents();
reloadAll();
