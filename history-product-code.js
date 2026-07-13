/* ARICO inventory app: compact history rows without product-code display. */

function buildHistoryProductCell(barcode,productName=""){
  const product=gp(barcode);
  const name=String(product?.name||productName||"商品名なし");
  const barcodeLabel=String(barcode||"バーコードなし");
  return `<div class="product-history-identity">
    <strong>${esc(name)}</strong>
    <small>棚番：${esc(getProductShelfLabel(product||{location:""}))}</small>
    <small>バーコード：${esc(barcodeLabel)}</small>
  </div>`;
}

function isHistoryDecreaseType(type){
  const text=String(type||"").trim();
  return isInventoryOutType(text)
    || text==="出荷"
    || text==="売上"
    || text==="備品転用"
    || text==="イベント持出"
    || text==="棚卸減算"
    || text==="stock_out"
    || text==="equipment_transfer"
    || text==="event_pick";
}

function isHistoryIncreaseType(type){
  const text=String(type||"").trim();
  return isInventoryInType(text)
    || text==="入荷"
    || text==="仕入"
    || text==="商品転用キャンセル"
    || text==="イベント戻し"
    || text==="stock_in"
    || text==="equipment_transfer_cancel"
    || text==="event_return";
}

function getHistorySignedDelta(type,quantity){
  const value=Number(quantity||0);
  if(!Number.isFinite(value))return 0;
  if(isHistoryDecreaseType(type))return value<0 ? value : -Math.abs(value);
  if(isHistoryIncreaseType(type))return Math.abs(value);
  return value;
}

function formatHistorySignedQuantity(value){
  const number=Number(value||0);
  if(!Number.isFinite(number)||number===0)return "";
  return number>0 ? `+${number}` : String(number);
}

function historyQuantityClass(value){
  const number=Number(value||0);
  if(number<0)return "history-qty-negative";
  if(number>0)return "history-qty-positive";
  return "";
}

function buildProductHistoryRowsFromLogs(barcode,selectedLogs,allLogsForBarcode){
  const product=gp(barcode);
  let running=Number(product?.base_stock||0);
  const allDesc=allLogsForBarcode.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const rowsByKey=new Map();

  for(const log of allDesc){
    const rawQuantity=Number(log.quantity||0);
    const displayType=String(log.memo||"").includes("備品転用キャンセル") ? "equipment_transfer_cancel" : log.type;
    const delta=getHistorySignedDelta(displayType,rawQuantity);
    let beforeStock="";
    let afterStock=running;
    let inQty="";
    let outQty="";

    if(delta>0){
      beforeStock=running-delta;
      inQty=formatHistorySignedQuantity(delta);
      running-=delta;
    }else if(delta<0){
      beforeStock=running-delta;
      outQty=formatHistorySignedQuantity(delta);
      running-=delta;
    }else if(String(log.type||"").trim()==="在庫修正" || String(log.type||"").trim()==="蝨ｨ蠎ｫ菫ｮ豁｣"){
      beforeStock="-";
      afterStock=rawQuantity;
    }

    const key=String(log.id||log.created_at+log.type+log.quantity+log.memo);
    rowsByKey.set(key,{log,beforeStock,afterStock,inQty,outQty});
  }

  return selectedLogs.map(log=>{
    const key=String(log.id||log.created_at+log.type+log.quantity+log.memo);
    const row=rowsByKey.get(key);
    if(!row)return "";
    return `<tr>
      <td>${fmt(row.log.created_at)}</td>
      <td>${esc(String(row.log.memo||"").includes("備品転用キャンセル") ? "商品転用キャンセル" : inventoryTypeLabel(row.log.type))}</td>
      <td>${esc(row.log.staff||"-")}</td>
      <td>${buildHistoryProductCell(barcode,row.log.product_name||"")}</td>
      <td>${row.beforeStock}</td>
      <td class="${historyQuantityClass(row.inQty)}">${row.inQty}</td>
      <td class="${historyQuantityClass(row.outQty)}">${row.outQty}</td>
      <td>${row.afterStock}</td>
      <td>${memoCellHtml(row.log)}</td>
      <td>${equipmentCheckHtml(row.log)}</td>
    </tr>`;
  }).join("");
}

function buildGlobalHistoryRows(sourceLogs=logs){
  return sourceLogs.map(log=>{
    const rawQuantity=Number(log.quantity||0);
    const displayType=String(log.memo||"").includes("備品転用キャンセル") ? "equipment_transfer_cancel" : log.type;
    const delta=getHistorySignedDelta(displayType,rawQuantity);
    let beforeStock="";
    let afterStock="";
    let inQty="";
    let outQty="";
    const current=Number(gp(log.barcode)?.base_stock||0);

    if(delta>0){
      beforeStock=current-delta;
      afterStock=current;
      inQty=formatHistorySignedQuantity(delta);
    }else if(delta<0){
      beforeStock=current-delta;
      afterStock=current;
      outQty=formatHistorySignedQuantity(delta);
    }else if(String(log.type||"").trim()==="在庫修正" || String(log.type||"").trim()==="蝨ｨ蠎ｫ菫ｮ豁｣"){
      beforeStock="-";
      afterStock=rawQuantity;
    }

    return `<tr>
      <td>${fmt(log.created_at)}</td>
      <td>${esc(String(log.memo||"").includes("備品転用キャンセル") ? "商品転用キャンセル" : inventoryTypeLabel(log.type))}</td>
      <td>${esc(log.staff||"-")}</td>
      <td>${buildHistoryProductCell(log.barcode,log.product_name||"")}</td>
      <td>${beforeStock}</td>
      <td class="${historyQuantityClass(inQty)}">${inQty}</td>
      <td class="${historyQuantityClass(outQty)}">${outQty}</td>
      <td>${afterStock}</td>
      <td>${memoCellHtml(log)}</td>
      <td>${equipmentCheckHtml(log)}</td>
    </tr>`;
  }).join("");
}
