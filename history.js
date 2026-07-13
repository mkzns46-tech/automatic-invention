/* ARICO TOKYO inventory app: history.js */

function inventoryTypeLabel(type){
  const labels={
    event_delete_return:"イベント削除戻し",
    event_pick:"イベントピック",
    event_close_return:"イベント締め棚戻し",
    equipment_transfer:"備品転用",
    gacha_pick:"ガチャピック",
    gacha_return:"ガチャ戻り"
  };
  return labels[type]||String(type||"");
}

function isInventoryOutType(type){
  return type==="出荷"||type==="備品転用"||type==="equipment_transfer"||type==="event_pick"||type==="gacha_pick";
}

function isInventoryInType(type){
  if(type==="event_delete_return")return true;
  return type==="入荷"||type==="gacha_return"||type==="event_close_return";
}

function inventoryTypeMatchesFilter(logType,filterType){
  if(!filterType)return true;
  if(filterType==="備品転用")return logType==="備品転用"||logType==="equipment_transfer";
  return logType===filterType;
}

async function loadProductHistoryByBarcode(barcode){
  const productLogs=await sbAll(`inventory_logs?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=created_at.desc`,1000,10000);
  console.log("[Product History Equipment State]",productLogs
    .filter(log=>log.type==="備品転用")
    .map(log=>({
      id:log.id,
      equipment_checked:log.equipment_checked,
      equipment_checked_by:log.equipment_checked_by,
      equipment_checked_at:log.equipment_checked_at
    })));
  return productLogs;
}

async function showProductHistoryForBarcode(barcode,replacementLog=null){
  barcode=String(barcode||"").trim();
  if(!barcode)return;

  const p=await fetchProductByBarcode(barcode);
  if(!p){
    showMessage(`商品別履歴：未登録バーコード ${barcode}`,"err");
    return;
  }

  selectedBarcode=barcode;
  let productLogs=await loadProductHistoryByBarcode(barcode);
  if(replacementLog){
    productLogs=productLogs.map(log=>
      String(log.id)===String(replacementLog.id) ? replacementLog : log
    );
  }
  renderSelectedProductHistoryWithData(productLogs);
}

async function selectProductHistoryByBarcode(){
  const input=el("productHistoryBarcodeInput");
  if(!input)return;
  await showProductHistoryForBarcode(input.value);
}


function normalizeSearchText(s){
  return String(s||"").trim().replace(/\s+/g," ");
}

const INVENTORY_PRODUCT_SEARCH_SORT_KEY="arico_inventory_product_search_sort";

function getInventoryProductSearchSort(){
  const value=String(el("inventoryProductSearchSort")?.value||localStorage.getItem(INVENTORY_PRODUCT_SEARCH_SORT_KEY)||"name");
  return ["name","barcode","location","updated"].includes(value) ? value : "name";
}

function getProductUpdatedTime(product){
  const value=product?.updated_at||product?.modified_at||product?.created_at||"";
  const time=value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortProductsForDisplay(rows,mode="name"){
  const collator=new Intl.Collator("ja-JP",{numeric:true,sensitivity:"base"});
  return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{
    if(mode==="barcode"){
      return collator.compare(String(a?.barcode||""),String(b?.barcode||""));
    }
    if(mode==="location"){
      const al=String(a?.location||"").trim();
      const bl=String(b?.location||"").trim();
      if(!al&&bl)return 1;
      if(al&&!bl)return -1;
      return collator.compare(al,bl)||collator.compare(String(a?.name||""),String(b?.name||""));
    }
    if(mode==="updated"){
      return getProductUpdatedTime(b)-getProductUpdatedTime(a)||collator.compare(String(a?.name||""),String(b?.name||""));
    }
    return collator.compare(String(a?.name||""),String(b?.name||""));
  });
}

window.sortProductsForDisplay=sortProductsForDisplay;

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

let inventoryProductSearchTimer=null;

function renderInventoryProductSearchResults(rows){
  const box=el("inventoryProductSearchResults");
  if(!box)return;
  rows=sortProductsForDisplay(rows,getInventoryProductSearchSort());

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
      const barcodeInput=el("barcodeInput");
      const nameInput=el("inventoryProductNameSearchInput");

      if(barcodeInput)barcodeInput.value=barcode;
      if(nameInput)nameInput.value="";

      box.classList.remove("is-active");
      box.innerHTML="";

      await syncHistoryFromScanBarcode();
      barcodeInput?.focus();
    };
  });
}

function handleInventoryProductNameSearchInput(){
  const input=el("inventoryProductNameSearchInput");
  if(!input)return;

  clearTimeout(inventoryProductSearchTimer);

  const keyword=input.value.trim();
  const box=el("inventoryProductSearchResults");

  if(!keyword){
    if(box){
      box.classList.remove("is-active");
      box.innerHTML="";
    }
    return;
  }

  inventoryProductSearchTimer=setTimeout(async()=>{
    const rows=await searchProductsByName(keyword);
    renderInventoryProductSearchResults(rows);
  },250);
}

function bindInventoryProductSearchSort(){
  const select=el("inventoryProductSearchSort");
  if(!select)return;
  select.value=getInventoryProductSearchSort();
  select.onchange=()=>{
    localStorage.setItem(INVENTORY_PRODUCT_SEARCH_SORT_KEY,select.value||"name");
    handleInventoryProductNameSearchInput();
  };
}

window.addEventListener("DOMContentLoaded",bindInventoryProductSearchSort);
window.addEventListener("load",bindInventoryProductSearchSort);
setTimeout(bindInventoryProductSearchSort,500);

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
  if(!body)return;
  if(!selectedBarcode){
    body.innerHTML="";
  }
}

function renderSelectedProductHistoryWithData(productLogs){
  const badge=el("selectedProductBadge");
  const range=el("historyRangeBadge");
  const body=el("selectedHistoryBody");
  if(!body)return;

  const p=gp(selectedBarcode);

  if(badge)badge.textContent=p?`${p.name} / 全履歴：${productLogs.length}件`:"商品を選択してください";
  if(range)range.textContent=`全履歴：${productLogs.length}件`;
  console.log("[Selected Product History Render]",productLogs
    .filter(log=>log.type==="備品転用")
    .map(log=>({
      id:log.id,
      equipment_checked:log.equipment_checked,
      equipment_checked_by:log.equipment_checked_by,
      equipment_checked_at:log.equipment_checked_at
    })));

  body.innerHTML=buildProductHistoryRowsFromLogs(selectedBarcode,productLogs,productLogs);

  bindMemoEditButtons();
  bindEquipmentConfirmButtons();

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

    if(isInventoryInType(log.type)){
      beforeStock=running-q;
      inQty=q;
      running-=q;
    }else if(isInventoryOutType(log.type)){
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
      <td>${esc(inventoryTypeLabel(r.log.type))}</td>
      <td>${esc(r.log.staff)}</td>
      <td>${esc(p?.name||r.log.product_name||"")}</td>
      <td>${r.beforeStock}</td>
      <td>${r.inQty}</td>
      <td>${r.outQty}</td>
      <td>${r.afterStock}</td>
      <td>${memoCellHtml(r.log)}</td>
      <td>${equipmentCheckHtml(r.log)}</td>
    </tr>`;
  }).join("");
}


function ensureEventDeleteReturnHistoryFilterOption(){
  const select=el("historyTypeFilter");
  if(!select||select.querySelector('option[value="event_delete_return"]'))return;
  const option=document.createElement("option");
  option.value="event_delete_return";
  option.textContent="イベント削除戻し";
  const before=select.querySelector('option[value="gacha_pick"]');
  select.insertBefore(option,before||null);
}

function getFilteredGlobalLogs(){
  ensureEventDeleteReturnHistoryFilterOption();
  const type=String(el("historyTypeFilter")?.value||"");
  const product=String(el("historyProductFilter")?.value||"").trim().toLowerCase();
  const staff=String(el("historyStaffFilter")?.value||"").trim().toLowerCase();
  const memo=String(el("historyMemoFilter")?.value||"").trim().toLowerCase();
  return logs.filter(log=>{
    const productName=String(gp(log.barcode)?.name||log.product_name||"").toLowerCase();
    return inventoryTypeMatchesFilter(log.type,type)
      &&(!product||productName.includes(product))
      &&(!staff||String(log.staff||"").toLowerCase().includes(staff))
      &&(!memo||String(log.memo||"").toLowerCase().includes(memo));
  });
}

function renderGlobalHistory(){
  const body=el("historyBody");
  if(!body)return;
  body.innerHTML=buildGlobalHistoryRows(getFilteredGlobalLogs());
  bindMemoEditButtons();
  bindEquipmentConfirmButtons();
}

function renderRecentRegistrationHistory(){
  const body=el("recentRegistrationHistoryBody");
  if(!body)return;
  body.innerHTML=buildGlobalHistoryRows(logs.slice(0,10));
  bindMemoEditButtons();
  bindEquipmentConfirmButtons();
}

function buildGlobalHistoryRows(sourceLogs=logs){
  return sourceLogs.map(log=>{
    const q=Number(log.quantity||0);

    let beforeStock="";
    let afterStock="";
    let inQty="";
    let outQty="";

    const current=Number(gp(log.barcode)?.base_stock||0);

    if(isInventoryInType(log.type)){
      beforeStock=current-q;
      afterStock=current;
      inQty=q;
    }else if(isInventoryOutType(log.type)){
      beforeStock=current+q;
      afterStock=current;
      outQty=q;
    }else if(log.type==="在庫修正"){
      beforeStock="-";
      afterStock=q;
    }

    return `<tr>
      <td>${fmt(log.created_at)}</td>
      <td>${esc(inventoryTypeLabel(log.type))}</td>
      <td>${esc(log.staff)}</td>
      <td>${esc(gp(log.barcode)?.name||log.product_name||"")}</td>
      <td>${beforeStock}</td>
      <td>${inQty}</td>
      <td>${outQty}</td>
      <td>${afterStock}</td>
      <td>${memoCellHtml(log)}</td>
      <td>${equipmentCheckHtml(log)}</td>
    </tr>`;
  }).join("");
}


function buildHistoryExportRows(sourceLogs){
  const rows=[["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","備考","備品転用確認","確認者","確認日時"]];

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

      if(isInventoryInType(log.type)){
        beforeStock=running-q;
        inQty=q;
        running-=q;
      }else if(isInventoryOutType(log.type)){
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
          inventoryTypeLabel(log.type),
          log.staff||"",
          gp(log.barcode)?.name || log.product_name || "",
          beforeStock,
          inQty,
          outQty,
          afterStock,
          log.memo||"",
          (log.type==="備品転用"||log.type==="equipment_transfer") ? (isEquipmentTransferChecked(log) ? "確認済" : "未確認") : "",
          log.equipment_checked_by||"",
          log.equipment_checked_at ? fmt(log.equipment_checked_at) : ""
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
    const rows=[["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","備考","備品転用確認"]];

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
