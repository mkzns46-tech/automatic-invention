const SUPABASE_URL="https://ihsbkknysozkstvylqff.supabase.co";const SUPABASE_API_KEY="sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
let products=[],logs=[],checks=[],staffMembers=[],selectedBarcode="",selectedHistoryMode="all",videoStream=null,detector=null,scanning=false,lastScan="",lastScanAt=0;let dataLoaded=false;let dataLoadError=false;const el=id=>document.getElementById(id);
function showMessage(t,c=""){const m=el("message");if(m){m.textContent=t;m.className="message "+c}}function beep(ok=true){try{const c=new(window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.value=ok?880:220;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close()},ok?90:220)}catch(_){}}
async function sb(path,opt={}){const h={apikey:SUPABASE_API_KEY,Authorization:"Bearer "+SUPABASE_API_KEY,"Content-Type":"application/json",Accept:"application/json",...(opt.headers||{})},r=await fetch(SUPABASE_URL.replace(/\/+$/,"")+"/rest/v1/"+path,{...opt,headers:h}),txt=await r.text();let b=null;try{b=txt?JSON.parse(txt):null}catch{b=txt}if(!r.ok)throw new Error(`Supabaseエラー ${r.status}\n${typeof b==="object"?JSON.stringify(b):String(b||"")}`);return b}
async function reloadAll(){try{dataLoaded=false;dataLoadError=false;showMessage("商品データ読み込み中...");products=await sb("products?select=*&order=name.asc");logs=await sb("inventory_logs?select=*&order=created_at.desc&limit=2000");try{checks=await sb("inventory_checks?select=*&order=checked_at.desc&limit=2000")}catch{checks=[]}try{staffMembers=await sb("staff_members?select=*&order=name.asc")}catch{staffMembers=[]}dataLoaded=true;dataLoadError=false;render();showMessage(`準備OK。商品データ ${products.length} 件を読み込みました。`,"ok")}catch(e){dataLoaded=false;dataLoadError=true;showMessage("データ取得エラー。\n再読み込みしてください。\n"+e.message,"err")}}
function calcStock(){const m=new Map();for(const p of products)m.set(p.barcode,{barcode:p.barcode,name:p.name,location:p.location||"",base_stock:Number(p.base_stock||0),inQty:0,outQty:0,adjustQty:"",stock:Number(p.base_stock||0)});for(const l of logs){const i=m.get(l.barcode);if(!i)continue;const q=Number(l.quantity||0);if(l.type==="入荷")i.inQty+=q;if(l.type==="出荷")i.outQty+=q;if(l.type==="在庫修正")i.adjustQty=q}return[...m.values()]}
const gp=b=>products.find(p=>p.barcode===b),gs=b=>calcStock().find(s=>s.barcode===b)?.stock??0,gc=b=>checks.filter(c=>c.barcode===b),fmt=x=>{try{return new Date(x).toLocaleString("ja-JP")}catch{return x}},esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function render(){renderProductCount();renderStaffOptions();renderStaffList();renderStockTable();renderGlobalHistory();renderSelectedProductHistory();renderScanPreview();renderProductStockInfo()}
function renderStaffOptions(){
  const select=el("staff");
  if(!select)return;
  const current=select.value;
  select.innerHTML='<option value="">担当者を選択</option>'+staffMembers.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join("");
  if(current)select.value=current;
}

function renderStaffList(){
  const badge=el("staffCountBadge"),body=el("staffListBody");
  if(badge)badge.textContent=`担当者：${staffMembers.length}人`;
  if(!body)return;
  body.innerHTML=staffMembers.map(s=>`<tr><td>${esc(s.name)}</td><td><button type="button" class="staff-delete-btn" data-staff-id="${s.id}">削除</button></td></tr>`).join("");
  document.querySelectorAll(".staff-delete-btn").forEach(btn=>{
    btn.addEventListener("click",()=>deleteStaff(btn.dataset.staffId));
  });
}

async function saveStaff(e){
  e.preventDefault();
  try{
    const name=el("staffNameInput").value.trim();
    if(!name){showMessage("担当者名を入力してください。","err");return}
    await sb("staff_members?on_conflict=name",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([{name}])});
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
    await sb(`staff_members?id=eq.${encodeURIComponent(id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
    showMessage("担当者を削除しました。","ok");
    await reloadAll();
  }catch(e){
    showMessage("担当者削除エラー。\n"+e.message,"err");
  }
}

function renderProductCount(){const b=el("productCountBadge");if(b)b.textContent=`登録数：${products.length}件`}
function renderScanPreview(){const info=el("scanProductInfo"),inp=el("barcodeInput");if(!info||!inp)return;const b=inp.value.trim();if(!b){info.textContent="バーコード入力後、商品名と現在庫を表示します。";info.className="message";return}if(dataLoadError){info.textContent="商品データを取得できていません。再読み込みしてください。";info.className="message err";return}if(!dataLoaded){info.textContent="商品データ読み込み中です。少し待ってください。";info.className="message";return}const p=gp(b);if(!p){info.textContent=`未登録バーコード：${b}`;info.className="message err";return}info.textContent=`商品名：${p.name} / 現在庫：${gs(b)}`;info.className="message ok"}

function renderProductStockInfo(){
  const info=el("productStockInfo"),input=el("productBarcode");
  if(!info||!input)return;
  const barcode=input.value.trim();
  if(!barcode){
    info.textContent="バーコード入力後、現在庫を表示します。";
    info.className="message";
    return;
  }
  const p=gp(barcode);
  if(!p){
    info.textContent="未登録バーコードです。新規商品として登録できます。";
    info.className="message";
    return;
  }
  info.textContent=`登録済み：${p.name} / 現在庫：${gs(barcode)}`;
  info.className="message ok";
}

function renderStockTable(){const stockBody=el("stockBody");if(!stockBody)return;const q=el("searchInput")?.value?.trim()?.toLowerCase()||"",rows=calcStock().filter(r=>!q||r.barcode.toLowerCase().includes(q)||r.name.toLowerCase().includes(q)||String(r.location).toLowerCase().includes(q));stockBody.innerHTML=rows.map(r=>{const lc=gc(r.barcode).sort((a,b)=>new Date(b.checked_at)-new Date(a.checked_at))[0],lt=lc?`${fmt(lc.checked_at)} / ${esc(lc.checked_by)}`:"未チェック";return`<tr class="clickable ${selectedBarcode===r.barcode?"selected-row":""}" data-barcode="${esc(r.barcode)}"><td><button type="button" class="secondary">履歴</button></td><td>${esc(r.barcode)}</td><td>${esc(r.name)}</td><td>${esc(r.location)}</td><td>${r.base_stock}</td><td>${r.inQty}</td><td>${r.outQty}</td><td>${r.adjustQty}</td><td class="${r.stock<0?"stock-minus":"stock-plus"}">${r.stock}</td><td>${lt}</td></tr>`}).join("");document.querySelectorAll("#stockBody tr[data-barcode]").forEach(tr=>tr.addEventListener("click",()=>{selectedBarcode=tr.dataset.barcode;selectedHistoryMode="all";render()}))}
function logRow(l){return`<tr><td>${fmt(l.created_at)}</td><td>${esc(l.type)}</td><td>${esc(l.staff)}</td><td>${esc(l.barcode)}</td><td>${esc(l.product_name||"")}</td><td>${l.quantity}</td><td>${esc(l.memo||"")}</td></tr>`}
function renderGlobalHistory(){const historyBody=el("historyBody");if(!historyBody)return;const q=el("searchInput")?.value?.trim()?.toLowerCase()||"";historyBody.innerHTML=logs.filter(l=>!q||l.barcode.toLowerCase().includes(q)||String(l.product_name).toLowerCase().includes(q)||String(l.staff).toLowerCase().includes(q)||String(l.memo).toLowerCase().includes(q)).map(logRow).join("")}

function selectProductHistoryByBarcode(){
  const input=el("productHistoryBarcodeInput");
  if(!input)return;
  const barcode=input.value.trim();
  if(!barcode)return;
  const product=gp(barcode);
  if(!product){
    showMessage(`商品別履歴：未登録バーコード ${barcode}`,"err");
    return;
  }
  selectedBarcode=barcode;
  selectedHistoryMode="all";
  renderSelectedProductHistory();
  showMessage(`商品別履歴を表示：${product.name}`,"ok");
}

function renderSelectedProductHistory(){const badge=el("selectedProductBadge"),range=el("historyRangeBadge"),body=el("selectedHistoryBody"),cb=el("checkHistoryBody");if(!body||!cb)return;if(!body||!cb)return;if(!selectedBarcode){if(badge)badge.textContent="商品未選択";if(range)range.textContent="商品を選択してください";if(body)body.innerHTML="";if(cb)cb.innerHTML="";return}const p=gp(selectedBarcode),stock=gs(selectedBarcode),cs=gc(selectedBarcode);if(badge)badge.textContent=`${p?.name||""} / 実在庫：${stock}`;let ls=logs.filter(l=>l.barcode===selectedBarcode);if(selectedHistoryMode==="afterOldestCheck"){const oc=cs.sort((a,b)=>new Date(a.checked_at)-new Date(b.checked_at))[0];if(oc){ls=ls.filter(l=>new Date(l.created_at)>=new Date(oc.checked_at));if(range)range.textContent=`最古チェック以降：${fmt(oc.checked_at)} 〜 現在`}else if(range)range.textContent="チェック履歴なし：全履歴を表示"}else if(range)range.textContent=`全履歴：${ls.length}件`;body.innerHTML=`<tr>
<td>${p?.base_stock ?? 0}</td>
<td>${calcStock().find(s=>s.barcode===selectedBarcode)?.inQty ?? 0}</td>
<td>${calcStock().find(s=>s.barcode===selectedBarcode)?.outQty ?? 0}</td>
<td>${calcStock().find(s=>s.barcode===selectedBarcode)?.adjustQty ?? 0}</td>
<td>${stock}</td>
</tr>`;cb.innerHTML=cs.map(c=>`<tr><td>${fmt(c.checked_at)}</td><td>${esc(c.checked_by)}</td><td>${Number(c.stock_at_check??0)}</td><td>${esc(c.memo||"")}</td></tr>`).join("")}
async function upsertProducts(rows){await sb("products?on_conflict=barcode",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)})}
async function updateProductCurrentStock(barcode,newStock){
await sb(`products?barcode=eq.${encodeURIComponent(barcode)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({base_stock:newStock})});
const p=gp(barcode);if(p)p.base_stock=newStock;
}

async function saveProduct(e){e.preventDefault();try{const barcode=el("productBarcode").value.trim(),name=el("productName").value.trim(),base_stock=Number(el("baseStock").value||0),location=el("location").value.trim();if(!barcode)return showMessage("バーコードは必須です。","err");if(!name){showMessage("商品名は必須です。","err");el("productName").focus();return}await upsertProducts([{barcode,name,base_stock,location}]);beep(true);showMessage(`商品登録・更新：${name}`,"ok");el("productBarcode").value="";el("productName").value="";el("baseStock").value="0";el("location").value="";renderProductStockInfo();await reloadAll()}catch(e){beep(false);showMessage("商品登録エラー。\n"+e.message,"err")}}
async function clearAllData(){await sb("inventory_checks?barcode=not.is.null",{method:"DELETE",headers:{Prefer:"return=minimal"}}).catch(()=>{});await sb("inventory_logs?barcode=not.is.null",{method:"DELETE",headers:{Prefer:"return=minimal"}});await sb("products?barcode=not.is.null",{method:"DELETE",headers:{Prefer:"return=minimal"}})}
async function registerBarcode(barcode){try{barcode=String(barcode||"").trim();if(!barcode)return;const type=el("type").value,staff=el("staff").value.trim(),qtyRaw=el("qty").value.trim(),qty=Number(qtyRaw),memo=el("memo").value.trim();if(!staff){beep(false);showMessage("担当者を入力してください。","err");el("staff").focus();return}if(!qtyRaw||!Number.isFinite(qty)||qty<=0){beep(false);showMessage("数量を入力してください。","err");el("qty").focus();return}const p=gp(barcode);if(!p){beep(false);showMessage(`未登録バーコード：${barcode}。先に商品登録してください。`,"err");el("productBarcode").value=barcode;return}const currentStock=Number(p.base_stock||0);let newStock=currentStock;
if(type==="入荷")newStock=currentStock+qty;
if(type==="出荷")newStock=currentStock-qty;
if(type==="在庫修正")newStock=qty;
if(type==="出荷"&&newStock<0){beep(false);showMessage(`在庫不足：${p.name} / 現在庫 ${currentStock} / 出荷数 ${qty}`,"err");return}
await sb("inventory_logs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({type,staff,barcode,product_name:p.name,quantity:qty,memo})});
await updateProductCurrentStock(barcode,newStock);
beep(true);showMessage(type==="在庫修正"?`在庫修正：${p.name} / 現在庫を ${qty} に上書き / 担当者：${staff}`:`${type}登録：${p.name} / 担当者：${staff} / 数量 ${qty} / 現在庫 ${newStock}`,"ok");el("barcodeInput").value="";el("qty").value="";renderScanPreview();await reloadAll();el("barcodeInput").focus()}catch(e){beep(false);showMessage("登録エラー。\n"+e.message,"err")}}
async function saveStockCheck(){try{if(!selectedBarcode){showMessage("在庫確認の表から商品を選択してください。","err");return}const checked_by=el("checkerName").value.trim();if(!checked_by){showMessage("チェック者名を入力してください。","err");el("checkerName").focus();return}const p=gp(selectedBarcode),stock_at_check=gs(selectedBarcode);await sb("inventory_checks",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({barcode:selectedBarcode,product_name:p?.name||"",checked_by,stock_at_check,memo:""})});beep(true);showMessage(`在庫チェック記録：${p?.name||selectedBarcode} / ${checked_by} / 実在庫 ${stock_at_check}`,"ok");await reloadAll()}catch(e){beep(false);showMessage("チェック記録エラー。\n"+e.message,"err")}}
function parseCsv(text){text=text.replace(/^\uFEFF/,"");const rows=[];let row=[],field="",q=false;for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(q){if(c=='"'&&n=='"'){field+='"';i++}else if(c=='"')q=false;else field+=c}else{if(c=='"')q=true;else if(c==","){row.push(field);field=""}else if(c=="\n"){row.push(field);rows.push(row);row=[];field=""}else if(c!="\r")field+=c}}row.push(field);rows.push(row);return rows.filter(r=>r.some(v=>String(v).trim()!==""))}
const nh=h=>String(h||"").trim().toLowerCase().replace(/\s/g,""),gv=(o,ks)=>{for(const k of ks)if(o[k]!==undefined)return o[k];return""};
function csvToRows(text){const p=parseCsv(text);if(p.length<2)throw new Error("CSVにデータ行がありません。");const hs=p[0].map(nh),rows=[];for(let i=1;i<p.length;i++){const raw={};hs.forEach((h,j)=>raw[h]=(p[i][j]??"").trim());const barcode=String(gv(raw,["barcode","バーコード","jan","jancode","janコード","品番"])).trim(),name=String(gv(raw,["name","商品名","productname","product_name","品名"])).trim(),stockRaw=String(gv(raw,["base_stock","basestock","現在在庫","在庫","原在庫","stock","quantity","数量"])).replace(/,/g,"").trim(),location=String(gv(raw,["location","棚番","ロケーション","場所"])).trim();if(!barcode&&!name)continue;if(!barcode||!name)throw new Error(`${i+1}行目：バーコードまたは商品名が空です。`);const base_stock=Number(stockRaw||0);if(!Number.isFinite(base_stock))throw new Error(`${i+1}行目：在庫数が数字ではありません。`);rows.push({barcode,name,base_stock,location})}if(!rows.length)throw new Error("取り込み対象データがありません。");return rows}
async function importRows(rows){for(let i=0;i<rows.length;i+=500)await upsertProducts(rows.slice(i,i+500))}
async function importCsvFile(file){try{if(!file)return;const rows=csvToRows(await file.text());await importRows(rows);beep(true);showMessage(`CSV取り込み完了：${rows.length}件の商品を登録・更新しました。`,"ok");await reloadAll()}catch(e){beep(false);showMessage("CSV取り込みエラー。\n"+e.message,"err")}finally{el("csvFile").value=""}}
async function overwriteCsvFile(file){try{if(!file)return;const rows=csvToRows(await file.text());if(!confirm(`全データを上書きします。\n商品・入出荷履歴・チェック履歴を削除し、CSVの${rows.length}件で作り直します。\n実行しますか？`))return;showMessage("全データを削除してCSVで上書き中...");await clearAllData();await importRows(rows);beep(true);selectedBarcode="";showMessage(`全データ上書き完了：${rows.length}件で作り直しました。`,"ok");await reloadAll()}catch(e){beep(false);showMessage("全データ上書きエラー。\n"+e.message,"err")}finally{el("overwriteCsvFile").value=""}}
function downloadSampleCsv(){const csv="\uFEFFbarcode,name,base_stock,location\n4901234567890,サンプル商品A,10,A-01\n4909876543210,サンプル商品B,5,B-01\n",blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="product_import_sample.csv";a.click();URL.revokeObjectURL(a.href)}
async function startCamera(){try{if(!("BarcodeDetector"in window)){showMessage("このブラウザはカメラバーコード読取に未対応です。Chrome系ブラウザか、手入力欄＋外付けスキャナを使ってください。","err");return}detector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","code_39","qr_code"]});videoStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});const v=el("video");v.srcObject=videoStream;v.style.display="block";await v.play();scanning=true;scanLoop()}catch(e){showMessage("カメラ起動エラー。\n"+e.message,"err")}}
function stopCamera(){scanning=false;if(videoStream){videoStream.getTracks().forEach(t=>t.stop());videoStream=null}el("video").style.display="none"}async function scanLoop(){if(!scanning||!detector)return;try{const codes=await detector.detect(el("video"));if(codes.length){const code=codes[0].rawValue,t=Date.now();if(code!==lastScan||t-lastScanAt>1800){lastScan=code;lastScanAt=t;await registerBarcode(code)}}}catch(_){}requestAnimationFrame(scanLoop)}

function downloadCsvFile(filename, rows) {
  const csv = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");

  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();

  URL.revokeObjectURL(a.href);
}

function exportAllDataCsv() {
  try {
    const now = new Date();
    const stamp =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "_" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0");

    const productRows = [["barcode", "name", "base_stock", "location"]];
    for (const p of products) {
      productRows.push([
        p.barcode,
        p.name,
        p.base_stock ?? 0,
        p.location || ""
      ]);
    }

    const logRows = [["created_at", "type", "staff", "barcode", "product_name", "quantity", "memo"]];
    for (const l of logs) {
      logRows.push([
        formatDate(l.created_at),
        l.type,
        l.staff,
        l.barcode,
        l.product_name,
        l.quantity,
        l.memo || ""
      ]);
    }

    const checkRows = [["checked_at", "checked_by", "barcode", "product_name", "stock_at_check", "memo"]];
    for (const c of checks) {
      checkRows.push([
        formatDate(c.checked_at),
        c.checked_by,
        c.barcode,
        c.product_name,
        c.stock_at_check ?? 0,
        c.memo || ""
      ]);
    }

    downloadCsvFile(`backup_products_${stamp}.csv`, productRows);
    downloadCsvFile(`backup_inventory_logs_${stamp}.csv`, logRows);
    downloadCsvFile(`backup_inventory_checks_${stamp}.csv`, checkRows);

    beep(true);
    showMessage("全データCSV出力完了：商品マスター・履歴・チェック履歴を出力しました。", "ok");
  } catch (e) {
    beep(false);
    showMessage("全データCSV出力エラー。\n" + e.message, "err");
  }
}

function exportCsv(){const rows=[["日時","区分","担当者","バーコード","商品名","数量","備考"]];for(const l of logs)rows.push([fmt(l.created_at),l.type,l.staff,l.barcode,l.product_name,l.quantity,l.memo||""]);const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n"),blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="inventory_history.csv";a.click();URL.revokeObjectURL(a.href)}
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

  on("barcodeInput","input",renderScanPreview);on("productHistoryBarcodeInput","input",selectProductHistoryByBarcode);
  on("productBarcode","input",renderProductStockInfo);
  on("startCameraBtn","click",startCamera);
  on("stopCameraBtn","click",stopCamera);
  on("searchInput","input",render);

  on("clearFilterBtn","click",()=>{
    if(el("searchInput"))el("searchInput").value="";
    render();
  });

  on("csvBtn","click",exportCsv);
  on("allDataCsvBtn","click",exportAllDataCsv);
  on("csvFile","change",e=>importCsvFile(e.target.files[0]));
  on("overwriteCsvFile","change",e=>overwriteCsvFile(e.target.files[0]));
  on("downloadSampleCsvBtn","click",downloadSampleCsv);

  on("stockCheckBtn","click",saveStockCheck);
  on("showAllSelectedHistoryBtn","click",()=>{
    selectedHistoryMode="all";
    renderSelectedProductHistory();
  });
  on("showAfterOldestCheckBtn","click",()=>{
    selectedHistoryMode="afterOldestCheck";
    renderSelectedProductHistory();
  });
}

bindEvents();
reloadAll();
