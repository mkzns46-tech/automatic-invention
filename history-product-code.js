/* ARICO inventory app: product-code display for history tables. */
function getHistoryProductCode(barcode,product=null){
  const p=product||gp(barcode);
  return String(p?.product_code||p?.productCode||p?.code||"").trim();
}

function buildHistoryProductCell(barcode,productName=""){
  const p=gp(barcode);
  const name=String(p?.name||productName||"商品名なし");
  const productCode=getHistoryProductCode(barcode,p)||"商品コードなし";
  const barcodeLabel=String(barcode||"バーコードなし");
  return `<div class="product-history-identity">
    <strong>${esc(name)}</strong>
    <small>商品コード：${esc(productCode)}<br>バーコード：${esc(barcodeLabel)}</small>
  </div>`;
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
    rowsByKey.set(key,{log,beforeStock,afterStock,inQty,outQty});
  }

  return selectedLogs.map(log=>{
    const key=String(log.id||log.created_at+log.type+log.quantity+log.memo);
    const r=rowsByKey.get(key);
    if(!r)return "";
    return `<tr>
      <td>${fmt(r.log.created_at)}</td>
      <td>${esc(inventoryTypeLabel(r.log.type))}</td>
      <td>${esc(r.log.staff)}</td>
      <td>${buildHistoryProductCell(barcode,r.log.product_name||"")}</td>
      <td>${r.beforeStock}</td>
      <td>${r.inQty}</td>
      <td>${r.outQty}</td>
      <td>${r.afterStock}</td>
      <td>${memoCellHtml(r.log)}</td>
      <td>${equipmentCheckHtml(r.log)}</td>
    </tr>`;
  }).join("");
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
      <td>${buildHistoryProductCell(log.barcode,log.product_name||"")}</td>
      <td>${beforeStock}</td>
      <td>${inQty}</td>
      <td>${outQty}</td>
      <td>${afterStock}</td>
      <td>${memoCellHtml(log)}</td>
      <td>${equipmentCheckHtml(log)}</td>
    </tr>`;
  }).join("");
}
