/* ARICO TOKYO inventory app: history.js */

function inventoryTypeLabel(type){
  const labels={
    event_delete_return:"イベント削除戻し",
    event_pick:"イベント持ち出し",
    event_return:"イベント戻し",
    event_close_return:"イベント締め棚戻し",
    equipment_transfer:"商品転用",
    "備品転用":"商品転用",
    "蛯吝刀霆｢逕ｨ":"商品転用",
    gacha_pick:"ガチャ",
    gacha_return:"ガチャ戻し"
  };
  return labels[type]||String(type||"");
}
function isInventoryOutType(type){
  return type==="出荷"||type==="備品転用"||type==="equipment_transfer"||type==="event_pick"||type==="gacha_pick";
}

function isInventoryInType(type){
  if(type==="event_delete_return"||type==="event_return")return true;
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

const historyEventShelfStockCache=new Map();

function getHistoryCurrentStoreCode(){
  if(typeof getCurrentSmaregiContext==="function"){
    const context=getCurrentSmaregiContext();
    if(context?.storeCode)return String(context.storeCode).trim().toLowerCase();
  }
  if(window.currentStore)return String(window.currentStore).trim().toLowerCase();
  return "tokyo";
}

function historyInFilter(values){
  return [...new Set((values||[]).map(value=>String(value||"").trim()).filter(Boolean))]
    .map(value=>value.replace(/[(),]/g,""))
    .filter(Boolean)
    .join(",");
}

function historyEventShelfCacheKey(storeCode,barcode){
  return `${String(storeCode||"").trim().toLowerCase()}|${String(barcode||"").trim()}`;
}

async function loadHistoryEventShelfStocksForLogs(sourceLogs){
  const storeCode=getHistoryCurrentStoreCode();
  const barcodes=[...new Set((sourceLogs||[]).map(log=>String(log?.barcode||"").trim()).filter(Boolean))];
  if(!storeCode||!barcodes.length)return;

  const filter=historyInFilter(barcodes);
  if(!filter)return;

  try{
    const rows=await sb(`event_storage_stocks?select=store_code,barcode,storage_qty&store_code=eq.${encodeURIComponent(storeCode)}&barcode=in.(${filter})&limit=5000`);
    const found=new Set();
    if(Array.isArray(rows)){
      rows.forEach(row=>{
        const key=historyEventShelfCacheKey(row.store_code||storeCode,row.barcode);
        historyEventShelfStockCache.set(key,Number(row.storage_qty||0));
        found.add(String(row.barcode||"").trim());
      });
    }
    barcodes.forEach(barcode=>{
      if(!found.has(barcode))historyEventShelfStockCache.set(historyEventShelfCacheKey(storeCode,barcode),0);
    });
  }catch(error){
    console.warn("[history event shelf stock load failed]",error);
  }
  await loadHistoryEventShelfFallbackStocks(storeCode,barcodes);
}

async function loadHistoryEventShelfFallbackStocks(storeCode,barcodes){
  const emptyBarcodes=(barcodes||[]).filter(barcode=>{
    const key=historyEventShelfCacheKey(storeCode,barcode);
    return !historyEventShelfStockCache.has(key)||Number(historyEventShelfStockCache.get(key)||0)===0;
  });
  if(!emptyBarcodes.length)return;

  const filter=historyInFilter(emptyBarcodes);
  if(!filter)return;

  try{
    const movementRows=await sb(`event_storage_movements?select=id,store_code,barcode,movement_type,quantity,memo,created_at&store_code=eq.${encodeURIComponent(storeCode)}&barcode=in.(${filter})&order=created_at.asc&limit=5000`);
    const totals=new Map();
    const seen=new Set();
    (Array.isArray(movementRows)?movementRows:[]).forEach(row=>{
      const rowStore=String(row.store_code||"").trim().toLowerCase();
      const barcode=String(row.barcode||"").trim();
      if(rowStore!==storeCode||!barcode)return;
      const id=String(row.id||"");
      if(id&&seen.has(id))return;
      if(id)seen.add(id);
      const quantity=Math.abs(Number(row.quantity||0));
      if(!Number.isFinite(quantity))return;
      const type=String(row.movement_type||"").trim();
      const current=Number(totals.get(barcode)||0);
      if(type==="storage_in")totals.set(barcode,current+quantity);
      else if(type==="storage_out")totals.set(barcode,current-quantity);
      else if(type==="adjustment"){
        const match=String(row.memo||"").match(/(-?\d+)\s*->\s*(-?\d+)/);
        if(match)totals.set(barcode,current+Number(match[2])-Number(match[1]));
      }
    });
    totals.forEach((value,barcode)=>{
      if(value>0)historyEventShelfStockCache.set(historyEventShelfCacheKey(storeCode,barcode),Math.max(0,value));
    });
  }catch(error){
    console.warn("[history event shelf movement fallback failed]",error);
  }

  const stillEmpty=emptyBarcodes.filter(barcode=>Number(historyEventShelfStockCache.get(historyEventShelfCacheKey(storeCode,barcode))||0)===0);
  if(!stillEmpty.length)return;

  try{
    const events=await sb(`booth_events?select=id,store_code,status&store_code=eq.${encodeURIComponent(storeCode)}&limit=5000`);
    const eventIds=(Array.isArray(events)?events:[])
      .filter(event=>!new Set(["cancelled","canceled","invalid","deleted"]).has(String(event.status||"").trim().toLowerCase()))
      .map(event=>String(event.id||"").trim())
      .filter(Boolean);
    if(!eventIds.length)return;
    const eventFilter=historyInFilter(eventIds);
    const barcodeFilter=historyInFilter(stillEmpty);
    if(!eventFilter||!barcodeFilter)return;
    const itemRows=await sb(`booth_event_items?select=id,event_id,barcode,item_type,returned_qty,event_storage_qty,return_process_type&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&item_type=eq.normal&limit=5000`);
    const totals=new Map();
    (Array.isArray(itemRows)?itemRows:[]).forEach(row=>{
      const barcode=String(row.barcode||"").trim();
      if(!barcode)return;
      const savedStorage=Number(row.event_storage_qty||0);
      const keptReturn=String(row.return_process_type||"").trim()==="storage" ? Number(row.returned_qty||0) : 0;
      const quantity=Math.max(savedStorage,keptReturn,0);
      if(quantity>0)totals.set(barcode,Number(totals.get(barcode)||0)+quantity);
    });
    totals.forEach((value,barcode)=>{
      if(value>0)historyEventShelfStockCache.set(historyEventShelfCacheKey(storeCode,barcode),value);
    });
  }catch(error){
    console.warn("[history event shelf event item fallback failed]",error);
  }
}

function getHistoryEventShelfStock(barcode){
  const key=historyEventShelfCacheKey(getHistoryCurrentStoreCode(),barcode);
  return historyEventShelfStockCache.has(key) ? historyEventShelfStockCache.get(key) : "";
}

function ensureHistoryEventShelfHeaders(){
  ["recentRegistrationHistoryBody","historyBody","selectedHistoryBody"].forEach(bodyId=>{
    const body=el(bodyId);
    const table=body?.closest("table");
    const row=table?.querySelector("thead tr");
    if(!row||row.querySelector("[data-history-event-shelf-header]"))return;
    const th=document.createElement("th");
    th.textContent="イベント棚";
    th.dataset.historyEventShelfHeader="true";
    const cells=[...row.children];
    const currentStockHeader=cells[7]||null;
    row.insertBefore(th,currentStockHeader?.nextSibling||null);
  });
}

function getHistoryCsvHeaders(){
  return ["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","イベント棚","備考","商品転用確認","確認者","確認日時"];
}


function normalizeSearchText(s){
  return String(s||"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
}

const PRODUCT_SEARCH_SORT_STORAGE_PREFIX="arico_product_search_sort_";

function getProductSearchSortValue(selectId,storageKey){
  const value=String(el(selectId)?.value||localStorage.getItem(storageKey)||"name");
  return ["name","barcode","location","updated"].includes(value) ? value : "name";
}

function getInventoryProductSearchSort(){
  return getProductSearchSortValue("inventoryProductSearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"inventory");
}

function getProductFormSearchSort(){
  return getProductSearchSortValue("productFormSearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"product_form");
}

function getProductHistorySearchSort(){
  return getProductSearchSortValue("productHistorySearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"product_history");
}

function getProductUpdatedTime(product){
  const value=product?.updated_at||product?.modified_at||product?.created_at||"";
  const time=value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function normalizeShelfSortText(value){
  return String(value||"")
    .normalize("NFKC")
    .toUpperCase()
    .trim()
    .replace(/[ー－―−ｰ–—]/g,"-")
    .replace(/\s+/g,"");
}

function getProductShelfSortValue(product){
  return product?.location||product?.shelf_code||product?.shelf||product?.shelf_no||"";
}

function getShelfSortKey(value){
  const raw=String(value||"").trim();
  if(!raw)return {empty:1,type:9,group:999,column:999,raw:""};

  const text=normalizeShelfSortText(raw);
  const first=text.split(/[、,／/]/)[0]||text;
  const match=first.match(/^([1-9]|1[0-5]|[A-Z])-([1-9]|[12][0-9]|30)$/);
  if(match){
    const group=match[1];
    const isNumeric=/^\d+$/.test(group);
    return {
      empty:0,
      type:isNumeric?0:1,
      group:isNumeric?Number(group):group.charCodeAt(0)-64,
      column:Number(match[2]),
      raw:first
    };
  }

  return {empty:0,type:2,group:999,column:999,raw:text};
}

function compareShelfSortValues(a,b,collator){
  const ak=getShelfSortKey(a);
  const bk=getShelfSortKey(b);
  return (ak.empty-bk.empty)
    || (ak.type-bk.type)
    || (ak.group-bk.group)
    || (ak.column-bk.column)
    || collator.compare(ak.raw,bk.raw);
}

function sortProductsForDisplay(rows,mode="name"){
  const collator=new Intl.Collator("ja-JP",{numeric:true,sensitivity:"base"});
  return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{
    if(mode==="barcode"){
      return collator.compare(String(a?.barcode||""),String(b?.barcode||""));
    }
    if(mode==="location"){
      return compareShelfSortValues(getProductShelfSortValue(a),getProductShelfSortValue(b),collator)
        || collator.compare(String(a?.name||""),String(b?.name||""));
    }
    if(mode==="updated"){
      return getProductUpdatedTime(b)-getProductUpdatedTime(a)||collator.compare(String(a?.name||""),String(b?.name||""));
    }
    return collator.compare(String(a?.name||""),String(b?.name||""));
  });
}

window.sortProductsForDisplay=sortProductsForDisplay;
window.compareShelfSortValues=compareShelfSortValues;

function getProductSearchHaystack(product){
  const fields=[
    product?.name,
    product?.product_name,
    product?.barcode,
    product?.product_code,
    product?.smaregi_product_id,
    product?.item_number,
    product?.part_number,
    product?.model_number,
    product?.color,
    product?.colour,
    product?.size,
    product?.standard,
    product?.spec
  ];
  return normalizeSearchText(fields.filter(value=>value!==null&&value!==undefined).join(" "));
}

function mergeUniqueProducts(...groups){
  const seen=new Set();
  const merged=[];
  groups.flat().forEach(product=>{
    if(!product)return;
    const key=String(product.barcode||product.product_code||product.smaregi_product_id||product.name||"");
    if(!key||seen.has(key))return;
    seen.add(key);
    merged.push(product);
  });
  return merged;
}

async function searchProductsByName(keyword){
  keyword=normalizeSearchText(keyword);
  if(!keyword || keyword.length<2)return [];

  try{
    const localProducts=Array.isArray(window.products) ? window.products : (typeof products!=="undefined"&&Array.isArray(products) ? products : []);
    const localRows=localProducts.filter(product=>getProductSearchHaystack(product).includes(keyword));
    const q=encodeURIComponent(`*${keyword}*`);
    const rows=await sb(`products?select=*&or=(name.ilike.${q},barcode.ilike.${q},location.ilike.${q},smaregi_product_id.ilike.${q})&order=name.asc&limit=200`);

    if(Array.isArray(rows)){
      rows.forEach(p=>{
        if(p && !gp(p.barcode))products.push(p);
      });
      return mergeUniqueProducts(localRows,rows).slice(0,120);
    }

    return localRows.slice(0,120);
  }catch(e){
    const localProducts=Array.isArray(window.products) ? window.products : (typeof products!=="undefined"&&Array.isArray(products) ? products : []);
    const localRows=localProducts.filter(product=>getProductSearchHaystack(product).includes(keyword));
    if(localRows.length)return localRows.slice(0,120);
    showMessage("商品名検索エラー。\n"+e.message,"err");
    return [];
  }
}


let productFormSearchTimer=null;

function renderProductFormSearchResults(rows){
  const box=el("productFormSearchResults");
  if(!box)return;
  rows=sortProductsForDisplay(rows,getProductFormSearchSort());

  if(!rows || !rows.length){
    box.innerHTML='<div class="product-search-item"><strong>該当商品なし</strong><span>新規商品として登録できます</span></div>';
    box.classList.add("is-active");
    return;
  }

  box.innerHTML=rows.map(p=>`
    <div class="product-search-item" data-barcode="${esc(p.barcode)}">
      <div>
        <strong>${esc(p.name)}</strong>
        <span>棚番：${esc(getProductShelfLabel(p))}</span>
        <span>バーコード：${esc(p.barcode)} / 現在庫：${Number(p.base_stock||0)}</span>
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
        <span>棚番：${esc(getProductShelfLabel(p))}</span>
        <span>バーコード：${esc(p.barcode)} / 現在庫：${Number(p.base_stock||0)}</span>
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
  bindProductSearchSortSelect("inventoryProductSearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"inventory",handleInventoryProductNameSearchInput);
}

function bindProductSearchSortSelect(selectId,storageKey,rerender){
  const select=el(selectId);
  if(!select)return;
  select.value=getProductSearchSortValue(selectId,storageKey);
  select.onchange=()=>{
    localStorage.setItem(storageKey,select.value||"name");
    if(typeof rerender==="function")rerender();
  };
}

function ensureProductSearchSortControl(inputId,selectId,storageKey){
  if(el(selectId)||!el(inputId))return;
  const input=el(inputId);
  const label=input.closest("label")||input.parentElement;
  if(!label)return;
  const wrap=document.createElement("div");
  wrap.className="inventory-product-search-controls";
  label.parentNode.insertBefore(wrap,label);
  wrap.appendChild(label);
  const sortLabel=document.createElement("label");
  sortLabel.className="product-search-sort-label";
  sortLabel.innerHTML=`並び順<select id="${selectId}"><option value="name">商品名順</option><option value="barcode">バーコード順</option><option value="location">棚番順</option><option value="updated">最終更新順</option></select>`;
  wrap.appendChild(sortLabel);
  const select=el(selectId);
  if(select)select.value=getProductSearchSortValue(selectId,storageKey);
}

function bindAllProductSearchSortControls(){
  ensureProductSearchSortControl("productFormNameSearchInput","productFormSearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"product_form");
  ensureProductSearchSortControl("productNameSearchInput","productHistorySearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"product_history");
  bindProductSearchSortSelect("inventoryProductSearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"inventory",handleInventoryProductNameSearchInput);
  bindProductSearchSortSelect("productFormSearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"product_form",handleProductFormNameSearchInput);
  bindProductSearchSortSelect("productHistorySearchSort",PRODUCT_SEARCH_SORT_STORAGE_PREFIX+"product_history",handleProductNameSearchInput);
}

window.addEventListener("DOMContentLoaded",bindAllProductSearchSortControls);
window.addEventListener("load",bindAllProductSearchSortControls);
setTimeout(bindAllProductSearchSortControls,500);

function renderProductSearchResults(rows){
  const box=el("productSearchResults");
  if(!box)return;
  rows=sortProductsForDisplay(rows,getProductHistorySearchSort());

  if(!rows || !rows.length){
    box.innerHTML='<div class="product-search-item"><strong>該当商品なし</strong><span>別のキーワードで検索してください</span></div>';
    box.classList.add("is-active");
    return;
  }

  box.innerHTML=rows.map(p=>`
    <div class="product-search-item" data-barcode="${esc(p.barcode)}">
      <div>
        <strong>${esc(p.name)}</strong>
        <span>棚番：${esc(getProductShelfLabel(p))}</span>
        <span>バーコード：${esc(p.barcode)} / 現在庫：${Number(p.base_stock||0)}</span>
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

async function renderSelectedProductHistoryWithData(productLogs){
  const badge=el("selectedProductBadge");
  const range=el("historyRangeBadge");
  const body=el("selectedHistoryBody");
  if(!body)return;

  const p=gp(selectedBarcode);

  if(badge)badge.textContent=p?`${p.name} / 棚番：${getProductShelfLabel(p)} / バーコード：${p.barcode||selectedBarcode} / 全履歴：${productLogs.length}件`:"商品を選択してください";
  if(range)range.textContent=`全履歴：${productLogs.length}件`;
  console.log("[Selected Product History Render]",productLogs
    .filter(log=>log.type==="備品転用")
    .map(log=>({
      id:log.id,
      equipment_checked:log.equipment_checked,
      equipment_checked_by:log.equipment_checked_by,
      equipment_checked_at:log.equipment_checked_at
    })));

  ensureHistoryEventShelfHeaders();
  await loadHistoryEventShelfStocksForLogs(productLogs);
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
      <td>${getHistoryEventShelfStock(r.log.barcode)}</td>
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

async function renderGlobalHistory(){
  const body=el("historyBody");
  if(!body)return;
  const rows=getFilteredGlobalLogs();
  ensureHistoryEventShelfHeaders();
  await loadHistoryEventShelfStocksForLogs(rows);
  body.innerHTML=buildGlobalHistoryRows(rows);
  bindMemoEditButtons();
  bindEquipmentConfirmButtons();
}

async function renderRecentRegistrationHistory(){
  const body=el("recentRegistrationHistoryBody");
  if(!body)return;
  const rows=logs.slice(0,10);
  ensureHistoryEventShelfHeaders();
  await loadHistoryEventShelfStocksForLogs(rows);
  body.innerHTML=buildGlobalHistoryRows(rows);
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
      <td>${getHistoryEventShelfStock(log.barcode)}</td>
      <td>${memoCellHtml(log)}</td>
      <td>${equipmentCheckHtml(log)}</td>
    </tr>`;
  }).join("");
}


function buildHistoryExportRows(sourceLogs){
  const rows=[["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","備考","商品転用確認","確認者","確認日時"]];

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
          String(log.memo||"").replace(/備品転用/g,"商品転用"),
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
    const rows=[["入力日時","区分","担当者","商品名","在庫数","入荷","出荷","現在庫","備考","商品転用確認"]];

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

// Ver 2.79: add current common event shelf quantity to history display/CSV.
function buildHistoryExportRows(sourceLogs){
  const rows=[getHistoryCsvHeaders()];
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
      }else if(log.type==="蝨ｨ蠎ｫ菫ｮ豁｣"){
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
          getHistoryEventShelfStock(log.barcode),
          String(log.memo||"").replace(/蛯吝刀霆｢逕ｨ/g,"蝠・刀霆｢逕ｨ"),
          (log.type==="蛯吝刀霆｢逕ｨ"||log.type==="equipment_transfer") ? (isEquipmentTransferChecked(log) ? "確認済み" : "未確認") : "",
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

async function exportProductHistoryCsv(){
  try{
    if(!selectedBarcode){
      showMessage("商品を選択してください。","err");
      return;
    }

    const table=document.getElementById("selectedHistoryBody");
    await loadHistoryEventShelfStocksForLogs((typeof logs!=="undefined"?logs:[]).filter(log=>String(log.barcode||"")===String(selectedBarcode||"")));
    const rows=[getHistoryCsvHeaders().slice(0,11)];

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

async function exportCsv(){
  await loadHistoryEventShelfStocksForLogs(logs);
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
    await loadHistoryEventShelfStocksForLogs(allLogs);
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
