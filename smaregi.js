/* ARICO TOKYO inventory app: smaregi.js */

/* ===== v72 Smaregi stock check ===== */
let smaregiSnapshot=null;
let smaregiStockItems=[];
let smaregiStockChecks=[];
let smaregiCurrentEventStockByBarcode=new Map();
let smaregiEventStorageStockByBarcode=new Map();
let smaregiOngoingEventSalesByBarcode=new Map();
let smaregiEventInventoryStoreCode="";
const SMAREGI_DIFFERENCE_REASON_CATEGORIES=["入力ミス","出荷処理漏れ","入荷処理漏れ","商品転用","サンプル使用","商品持ち出し","返品処理漏れ","スマレジ登録ミス","棚違い","不明"];
let smaregiAutoRefreshTimer=null;
let smaregiAutoRefreshBusy=false;
let smaregiMutationBusy=false;
let smaregiReasonSummaryRows=[];

function parseSavedSmaregiStockNumber(value){
  if(value===null||value===undefined||String(value).trim()==="")return null;
  const number=Number(String(value).replace(/,/g,""));
  return Number.isFinite(number) ? number : null;
}

function getSavedSmaregiStockValue(item){
  const fields=[
    "smaregi_stock",
    "smaregi_stock_quantity",
    "stock_amount",
    "stock_quantity",
    "quantity_after",
    "store_stock",
    "在庫数"
  ];
  for(const field of fields){
    const value=parseSavedSmaregiStockNumber(item?.[field]);
    if(value!==null)return value;
  }
  const barcode=String(item?.barcode||item?.jan_code||item?.product_code||"").trim();
  const change=barcode&&smaregiLatestChangeByBarcode instanceof Map ? smaregiLatestChangeByBarcode.get(barcode) : null;
  for(const field of fields){
    const value=parseSavedSmaregiStockNumber(change?.[field]);
    if(value!==null)return value;
  }
  return null;
}

function getSavedSmaregiStockNumber(item,fallback=0){
  const value=getSavedSmaregiStockValue(item);
  return value===null ? fallback : value;
}

function getComparableSmaregiStockNumber(itemOrValue,fallback=0){
  const raw=typeof itemOrValue==="number" || typeof itemOrValue==="string"
    ? parseSavedSmaregiStockNumber(itemOrValue)
    : getSavedSmaregiStockValue(itemOrValue);
  const value=raw===null ? fallback : raw;
  // Keep the API value as-is. Non-positive stock is handled by the
  // difference rule below, while the displayed value must remain accurate.
  return value;
}

function normalizeInventoryQuantity(value,fallback=0){
  if(value===null||value===undefined||String(value).trim()==="")return fallback;
  const number=Number(String(value).replace(/,/g,""));
  return Number.isFinite(number) ? number : fallback;
}

function calculateInventoryDifference({aricoStock,eventNormalStock,smaregiStock}={}){
  const normalizedAricoStock=normalizeInventoryQuantity(aricoStock);
  const normalizedEventNormalStock=normalizeInventoryQuantity(eventNormalStock);
  const normalizedSmaregiStock=normalizeInventoryQuantity(smaregiStock);
  const comparisonStock=normalizedAricoStock+normalizedEventNormalStock;
  const difference=comparisonStock-normalizedSmaregiStock;
  const nonPositiveNoIssue=comparisonStock<=0&&normalizedSmaregiStock<=0;
  return {
    aricoStock:normalizedAricoStock,
    eventNormalStock:normalizedEventNormalStock,
    comparisonStock,
    smaregiStock:normalizedSmaregiStock,
    difference,
    isNoIssue:difference===0||nonPositiveNoIssue,
    nonPositiveNoIssue
  };
}

function isSmaregiNonPositiveNoIssue({comparisonStock,smaregiStock}={}){
  return normalizeInventoryQuantity(comparisonStock)<=0
    && normalizeInventoryQuantity(smaregiStock)<=0;
}

function createSmaregiDifferenceSnapshot({appStock,eventShelfStock,smaregiStock}={}){
  const calculation=calculateInventoryDifference({
    aricoStock:appStock,
    eventNormalStock:eventShelfStock,
    smaregiStock
  });
  return {
    appStockAtCheck:calculation.aricoStock,
    eventShelfStockAtCheck:calculation.eventNormalStock,
    comparisonStockAtCheck:calculation.comparisonStock,
    smaregiStockAtCheck:calculation.smaregiStock,
    differenceAtCheck:calculation.difference,
    isAutoNoIssueAtCheck:calculation.isNoIssue===true,
    snapshotVersion:2
  };
}

function getSmaregiSnapshotFields({item,barcode,appStock,eventShelfStock,smaregiStock,manualNoIssue=false}={}){
  const snapshot=createSmaregiDifferenceSnapshot({appStock,eventShelfStock,smaregiStock});
  const product=typeof gp==="function" ? (gp(barcode)||{}) : {};
  const context=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
  const currentStoreCode=typeof getSmaregiCurrentStoreCode==="function" ? getSmaregiCurrentStoreCode() : null;
  const rawStoreId=item?.store_id ?? context?.storeId ?? context?.store_id ?? currentStoreCode;
  return {
    store_id:rawStoreId===undefined||rawStoreId===null||String(rawStoreId).trim()==="" ? null : String(rawStoreId),
    product_id:item?.product_id ?? product?.product_id ?? product?.id ?? null,
    product_name:item?.product_name ?? product?.product_name ?? product?.name ?? null,
    app_stock_at_check:snapshot.appStockAtCheck,
    event_shelf_stock_at_check:snapshot.eventShelfStockAtCheck,
    comparison_stock_at_check:snapshot.comparisonStockAtCheck,
    smaregi_stock_at_check:snapshot.smaregiStockAtCheck,
    difference_at_check:snapshot.differenceAtCheck,
    is_auto_no_issue_at_check:snapshot.isAutoNoIssueAtCheck,
    is_manual_no_issue:manualNoIssue===true,
    snapshot_version:snapshot.snapshotVersion
  };
}

const SMAREGI_SNAPSHOT_FIELDS=[
  "store_id","product_id","product_name","app_stock_at_check",
  "event_shelf_stock_at_check","comparison_stock_at_check",
  "smaregi_stock_at_check","difference_at_check",
  "is_auto_no_issue_at_check","is_manual_no_issue","snapshot_version"
];

function isMissingSmaregiSnapshotColumnError(error){
  const message=String(error?.message||error||"");
  return /column .* does not exist|could not find the .* column|schema cache|PGRST204|unknown field/i.test(message);
}

function removeSmaregiSnapshotFields(payload){
  const legacy={...(payload||{})};
  SMAREGI_SNAPSHOT_FIELDS.forEach(field=>delete legacy[field]);
  return legacy;
}

async function persistSmaregiCheckRecord({snapshotId,barcode,payload}={}){
  await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(snapshotId)}&barcode=eq.${encodeURIComponent(barcode)}`,{
    method:"DELETE",
    headers:{Prefer:"return=minimal"}
  });
  try{
    const rows=await sb("smaregi_stock_checks",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([payload])
    });
    return {rows,usedSnapshot:true};
  }catch(error){
    if(!SMAREGI_SNAPSHOT_FIELDS.some(field=>Object.prototype.hasOwnProperty.call(payload||{},field))
      || !isMissingSmaregiSnapshotColumnError(error))throw error;
    console.warn("[Smaregi snapshot columns are not applied]",error);
    const legacyPayload=removeSmaregiSnapshotFields(payload);
    const rows=await sb("smaregi_stock_checks",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([legacyPayload])
    });
    if(typeof showMessage==="function"){
      showMessage("チェック時点スナップショット用SQLが未適用のため、旧形式で保存しました。SQL適用後に新規チェックを保存してください。","warn");
    }
    return {rows,usedSnapshot:false};
  }
}

async function patchSmaregiCheckRecord({snapshotId,barcode,payload}={}){
  const endpoint=`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(snapshotId)}&barcode=eq.${encodeURIComponent(barcode)}`;
  try{
    return await sb(endpoint,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(payload||{})
    });
  }catch(error){
    if(!SMAREGI_SNAPSHOT_FIELDS.some(field=>Object.prototype.hasOwnProperty.call(payload||{},field))
      || !isMissingSmaregiSnapshotColumnError(error))throw error;
    const rows=await sb(endpoint,{
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(removeSmaregiSnapshotFields(payload))
    });
    if(typeof showMessage==="function"){
      showMessage("チェック時点スナップショット用SQLが未適用のため、旧形式で更新しました。SQL適用後に新規チェックを保存してください。","warn");
    }
    return rows;
  }
}

window.getSavedSmaregiStockValue=getSavedSmaregiStockValue;
window.getSavedSmaregiStockNumber=getSavedSmaregiStockNumber;
window.getComparableSmaregiStockNumber=getComparableSmaregiStockNumber;
window.calculateInventoryDifference=calculateInventoryDifference;
window.isSmaregiNonPositiveNoIssue=isSmaregiNonPositiveNoIssue;
window.createSmaregiDifferenceSnapshot=createSmaregiDifferenceSnapshot;
window.getSmaregiSnapshotFields=getSmaregiSnapshotFields;
window.persistSmaregiCheckRecord=persistSmaregiCheckRecord;
window.patchSmaregiCheckRecord=patchSmaregiCheckRecord;

function getSmaregiCheck(barcode){
  const matches=(smaregiStockChecks||[]).filter(c=>String(c.barcode)===String(barcode));
  if(!matches.length)return null;
  return matches.sort((a,b)=>new Date(b.checked_at||0)-new Date(a.checked_at||0))[0];
}

function isSmaregiExcludedCheck(check){
  return check?.excluded===true
    || String(check?.excluded||"").toLowerCase()==="true"
    || String(check?.checked_by||"").startsWith("除外:");
}

function isSmaregiNoIssueCheck(check){
  if(!check)return false;
  const value=String(check.no_issue ?? "").trim().toLowerCase();
  return check.no_issue===true
    || check.no_issue===1
    || value==="true"
    || value==="1"
    || value==="yes"
    || Boolean(check.no_issue_at)
    || Boolean(String(check.no_issue_by||"").trim())
    || Boolean(String(check.no_issue_reason||"").trim());
}

function isSmaregiAutoNoIssueCheck(item,check=getSmaregiCheck(item?.barcode)){
  if(!item||!check||isSmaregiExcludedCheck(check)||isSmaregiNoIssueCheck(check))return false;
  const breakdown=getSmaregiInventoryBreakdown(item,check);
  return breakdown.isNoIssue===true;
}

function isSmaregiEffectiveNoIssueCheck(item,check=getSmaregiCheck(item?.barcode)){
  return isSmaregiNoIssueCheck(check)||isSmaregiAutoNoIssueCheck(item,check);
}

window.isSmaregiAutoNoIssueCheck=isSmaregiAutoNoIssueCheck;
window.isSmaregiEffectiveNoIssueCheck=isSmaregiEffectiveNoIssueCheck;

function getSmaregiDisplayCheckedBy(check){
  return String(check?.checked_by||"").replace(/^除外:/,"");
}

function getSmaregiSheetDifference(item){
  // 参考用：スマレジ在庫とシート在庫の差。棚卸差異の判定には使わない。
  return getSavedSmaregiStockNumber(item,0)-Number(getSmaregiAppStock(item.barcode)||0);
}

function getSmaregiActualDifference(item){
  const check=getSmaregiCheck(item.barcode);
  if(!check||isSmaregiExcludedCheck(check)||isSmaregiEffectiveNoIssueCheck(item,check))return null;
  if(check.actual_stock===null||check.actual_stock===undefined||String(check.actual_stock)==="")return null;

  return getSmaregiInventoryBreakdown(item,check).difference;
}

function calculateSmaregiDifference(smaregiStock,actualStock){
  const parsed=typeof smaregiStock==="number"||typeof smaregiStock==="string"
    ? parseSavedSmaregiStockNumber(smaregiStock)
    : getSavedSmaregiStockValue(smaregiStock);
  const smaregi=parsed===null?0:parsed;
  const actual=Number(actualStock||0);
  // スマレジ在庫がマイナスでも現物が0なら、棚卸上は差異なしとして扱う。
  return calculateInventoryDifference({aricoStock:actual,eventNormalStock:0,smaregiStock:smaregi}).difference;
}

function getSmaregiCurrentStoreCode(){
  const context=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
  return String(context.storeCode||window.currentStore||"tokyo").trim()||"tokyo";
}

function buildSmaregiInFilter(values){
  return [...new Set((values||[]).map(value=>String(value||"").trim()).filter(Boolean))]
    .map(value=>value.replace(/[(),]/g,""))
    .filter(Boolean)
    .join(",");
}

function normalizeSmaregiStoreCodeForStorage(value){
  const text=String(value||"").trim();
  if(!text)return "";
  if(typeof getStoreCodeFromName==="function"){
    const fromName=getStoreCodeFromName(text);
    if(fromName)return fromName;
  }
  const lower=text.toLowerCase();
  if(lower==="tokyo"||lower==="東京"||lower==="tokyo店")return "tokyo";
  if(lower==="aichi"||lower==="愛知"||lower==="aichi店")return "aichi";
  if(lower==="nagano"||lower==="長野"||lower==="nagano店")return "nagano";
  return lower;
}

function addSmaregiMapValue(map,barcode,value){
  const key=String(barcode||"").trim();
  if(!key)return;
  map.set(key,Number(map.get(key)||0)+Number(value||0));
}

function getSmaregiCurrentEventStock(barcode){
  // The event shelf is store-common. Keep this legacy accessor at zero so
  // old event-specific data cannot be added a second time.
  return 0;
}

function getSmaregiEventStorageStock(barcode){
  if(smaregiEventInventoryStoreCode!==normalizeSmaregiStoreCodeForStorage(getSmaregiCurrentStoreCode()))return 0;
  return Number(smaregiEventStorageStockByBarcode.get(String(barcode||"").trim())||0);
}

function getSmaregiEventShelfStock(barcode){
  return getSmaregiEventStorageStock(barcode);
}

function getSmaregiOngoingEventSalesQty(barcode){
  return Number(smaregiOngoingEventSalesByBarcode.get(String(barcode||"").trim())||0);
}

function getSmaregiEventShelfProvisionalStock(barcode){
  const current=getSmaregiEventStorageStock(barcode);
  const pending=getSmaregiOngoingEventSalesQty(barcode);
  return Math.max(0,current-pending);
}

function getSmaregiInventoryBreakdown(item,check=getSmaregiCheck(item?.barcode)){
  const actualStock=check&&check.actual_stock!==null&&check.actual_stock!==undefined&&String(check.actual_stock)!==""
    ? Number(check.actual_stock||0)
    : null;
  const currentEventStock=0;
  const eventStorageStock=getSmaregiEventStorageStock(item?.barcode);
  const ongoingSalesQty=getSmaregiOngoingEventSalesQty(item?.barcode);
  const eventShelfStock=getSmaregiEventShelfProvisionalStock(item?.barcode);
  const savedSmaregiStock=getSavedSmaregiStockValue(item);
  const smaregiStock=savedSmaregiStock===null ? null : savedSmaregiStock;
  const smaregiStockForComparison=smaregiStock===null ? null : getComparableSmaregiStockNumber(item,0);
  const ongoingSalesState=window.__smaregiOngoingSalesState;
  const ongoingSalesUnavailable=ongoingSalesState?.hasOngoingEvent===true&&ongoingSalesState?.ok===false;
  const calculation=actualStock===null||smaregiStockForComparison===null||ongoingSalesUnavailable ? null : calculateInventoryDifference({
    aricoStock:actualStock,
    eventNormalStock:eventShelfStock,
    smaregiStock:smaregiStockForComparison
  });
  return {
    actualStock,
    currentEventStock,
    eventStorageStock,
    ongoingSalesQty,
    ongoingSalesUnavailable,
    eventShelfStock,
    eventNormalStock:eventShelfStock,
    comparisonStock:calculation?.comparisonStock??null,
    smaregiStock,
    smaregiStockForComparison,
    difference:calculation?.difference??null,
    isNoIssue:calculation?.isNoIssue===true,
    calculation
  };
}

function getSmaregiMovementQuantity(row){
  return Math.max(0,normalizeInventoryQuantity(row?.quantity));
}

function sumSmaregiMovementQuantities(rows,predicate){
  const seenIds=new Set();
  return (Array.isArray(rows)?rows:[]).reduce((sum,row)=>{
    if(!predicate(row))return sum;
    const id=String(row?.id||"").trim();
    if(id&&seenIds.has(id))return sum;
    if(id)seenIds.add(id);
    return sum+getSmaregiMovementQuantity(row);
  },0);
}

function getSmaregiEventShelfCurrentQty(item,movements=[],salesQty=null){
  const eventPickQty=sumSmaregiMovementQuantities(movements,row=>{
    const type=String(row?.movement_type||"").trim();
    return String(row?.item_type||"normal")==="normal"
      && (type==="event_pick"||type==="take_out");
  });
  const legacyDepartureQty=eventPickQty>0 ? 0 : sumSmaregiMovementQuantities(movements,row=>{
    return String(row?.item_type||"normal")==="normal"
      && String(row?.movement_type||"").trim()==="departure_count";
  });
  const fallbackTakeoutQty=normalizeInventoryQuantity(item?.normal_takeout_qty)
    +normalizeInventoryQuantity(item?.storage_takeout_qty);
  const movementTakeoutQty=eventPickQty>0 ? eventPickQty : legacyDepartureQty;
  const eventTakeoutQty=movementTakeoutQty>0
    ? movementTakeoutQty
    : (fallbackTakeoutQty>0 ? fallbackTakeoutQty : normalizeInventoryQuantity(item?.taken_qty));

  // A normal-shelf return is explicit when the return workflow has recorded
  // shelf_return_qty. Storage returns remain event stock and are not removed.
  const returnedQty=normalizeInventoryQuantity(item?.returned_qty);
  const storageReturnedQty=normalizeInventoryQuantity(item?.event_storage_qty);
  const shelfReturnQty=normalizeInventoryQuantity(item?.shelf_return_qty)>0
    ? normalizeInventoryQuantity(item?.shelf_return_qty)
    : Math.max(0,returnedQty-storageReturnedQty);
  const sold= salesQty===null
    ? normalizeInventoryQuantity(item?.sold_qty)
    : normalizeInventoryQuantity(salesQty);

  return Math.max(0,eventTakeoutQty-sold-shelfReturnQty);
}

window.calculateSmaregiEventShelfCurrentQty=getSmaregiEventShelfCurrentQty;

async function loadSmaregiEventInventoryCache(barcodes=[]){
  smaregiCurrentEventStockByBarcode=new Map();
  smaregiEventStorageStockByBarcode=new Map();
  smaregiOngoingEventSalesByBarcode=new Map();
  smaregiEventInventoryStoreCode="";
  const uniqueBarcodes=[...new Set((barcodes||[]).map(value=>String(value||"").trim()).filter(Boolean))];
  if(!uniqueBarcodes.length)return;

  const barcodeFilter=buildSmaregiInFilter(uniqueBarcodes);
  if(!barcodeFilter)return;

  const storeCode=normalizeSmaregiStoreCodeForStorage(getSmaregiCurrentStoreCode());
  smaregiEventInventoryStoreCode=storeCode;
  let activeEventIds=[];
  // Pending sales are a read-only adjustment for comparison only.
  try{
    const now=new Date();
    const events=await sbAll(`booth_events?select=id,event_start,event_end,status,store_code&store_code=eq.${encodeURIComponent(storeCode)}&limit=1000`,1000,5000);
    activeEventIds=(Array.isArray(events)?events:[]).filter(event=>{
      if(String(event.status||"").toLowerCase()==="closed")return false;
      const start=String(event.event_start||"").slice(0,10);
      const end=String(event.event_end||event.event_start||"").slice(0,10);
      const today=now.toISOString().slice(0,10);
      return (!start||today>=start)&&(!end||today<=end);
    }).map(event=>String(event.id||"").trim()).filter(Boolean);
    const ongoingSalesState=window.__smaregiOngoingSalesState;
    if(activeEventIds.length&&(!ongoingSalesState||ongoingSalesState.ok!==false)){
      const eventFilter=buildSmaregiInFilter(activeEventIds);
      const pendingSales=await sbAll(`event_sales_imports?select=event_id,barcode,quantity,import_status&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&import_status=eq.pending&limit=50000`,1000,50000).catch(()=>[]);
      (Array.isArray(pendingSales)?pendingSales:[]).forEach(row=>{
        addSmaregiMapValue(smaregiOngoingEventSalesByBarcode,row.barcode,Number(row.quantity||0));
      });
    }
  }catch(error){
    console.warn("[Smaregi ongoing event sales lookup failed]",error);
  }

  // event_storage_stocks is the fallback current stock for the store-common
  // event shelf. An event pick is recorded in booth_event_items, so the
  // event-specific remaining quantity must take precedence when it exists.
  try{
    const commonStocks=await sbAll(`event_storage_stocks?select=store_code,barcode,product_name,storage_qty,updated_at&store_code=eq.${encodeURIComponent(storeCode)}&barcode=in.(${barcodeFilter})`,1000,50000);
    (Array.isArray(commonStocks)?commonStocks:[]).forEach(row=>{
      if(normalizeSmaregiStoreCodeForStorage(row.store_code)!==storeCode)return;
      smaregiEventStorageStockByBarcode.set(String(row.barcode||"").trim(),Number(row.storage_qty||0));
    });
  }catch(error){
    console.warn("[Smaregi common event shelf lookup failed]",error);
  }

  if(activeEventIds.length){
    const eventItemStockByBarcode=new Map();
    const eventItemStockKeys=new Set();
    try{
      const eventFilter=buildSmaregiInFilter(activeEventIds);
      const [eventItems,movementRows,salesRows]=await Promise.all([
      sbAll(`booth_event_items?select=id,event_id,barcode,item_type,taken_qty,normal_takeout_qty,storage_takeout_qty,sold_qty,returned_qty,shelf_return_qty,event_storage_qty,consumed_qty,updated_at&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&item_type=eq.normal`,1000,50000),
       sbAll(`booth_stock_movements?select=id,event_id,barcode,movement_type,item_type,quantity,takeout_source&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&movement_type=in.(departure_count,take_out,event_pick,return,event_close_return)`,1000,50000).catch(()=>[]),
      sbAll(`event_sales_imports?select=id,event_id,barcode,quantity,import_status&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&import_status=eq.confirmed`,1000,50000).catch(()=>[])
      ]);
      const eventItemByKey=new Map();
      (Array.isArray(eventItems)?eventItems:[]).forEach(row=>{
      if(String(row.item_type||"normal")!=="normal")return;
      const key=`${row.event_id}::${row.barcode}`;
      const existing=eventItemByKey.get(key);
      if(!existing||new Date(row.updated_at||0).getTime()>=new Date(existing.updated_at||0).getTime()){
        eventItemByKey.set(key,row);
      }
      });
      const movementByKey=new Map();
      (Array.isArray(movementRows)?movementRows:[]).forEach(row=>{
      const key=`${row.event_id}::${row.barcode}`;
      const rows=movementByKey.get(key)||[];
      rows.push(row);
      movementByKey.set(key,rows);
      });
      const confirmedSalesByKey=new Map();
      (Array.isArray(salesRows)?salesRows:[]).forEach(row=>{
      const key=`${row.event_id}::${row.barcode}`;
      const rows=confirmedSalesByKey.get(key)||[];
      rows.push(row);
      confirmedSalesByKey.set(key,rows);
      });
      eventItemByKey.forEach(row=>{
      const key=`${row.event_id}::${row.barcode}`;
      const movements=movementByKey.get(key)||[];
      const confirmedSales=confirmedSalesByKey.get(key)||[];
      const savedSoldQty=normalizeInventoryQuantity(row.sold_qty);
      const importedSoldQty=confirmedSales.reduce((sum,sale)=>sum+normalizeInventoryQuantity(sale.quantity),0);
      // booth_event_items.sold_qty is updated when a sale import is applied.
      // Use confirmed imports only for older rows where that denormalized
      // value has not been written yet, avoiding a double subtraction.
      const salesQty=savedSoldQty>0 ? savedSoldQty : (importedSoldQty>0 ? importedSoldQty : 0);
      const qty=getSmaregiEventShelfCurrentQty(row,movements,salesQty);
      const barcode=String(row.barcode||"").trim();
      if(!barcode)return;
      const hasEventActivity=[
        row.taken_qty,row.normal_takeout_qty,row.storage_takeout_qty,
        row.sold_qty,row.returned_qty,row.consumed_qty
      ].some(value=>normalizeInventoryQuantity(value)>0)
        || movements.some(movement=>["event_pick","take_out","departure_count"].includes(String(movement?.movement_type||"").trim()));
      if(!hasEventActivity)return;
      const current=Number(eventItemStockByBarcode.get(barcode)||0);
      eventItemStockByBarcode.set(barcode,current+qty);
      eventItemStockKeys.add(barcode);
      });

      // Do not add event_storage_stocks and booth_event_items together. The
      // event item row already represents the picked quantity's current event
      // shelf balance, while the common row is only the fallback source.
      eventItemStockKeys.forEach(barcode=>{
       if(!smaregiEventStorageStockByBarcode.has(barcode)){
         smaregiEventStorageStockByBarcode.set(barcode,Number(eventItemStockByBarcode.get(barcode)||0));
       }
      });
    }catch(error){
      console.warn("[Smaregi event shelf item lookup failed]",error);
    }
  }

}

function getSmaregiDifference(item){
  return getSmaregiActualDifference(item);
}

function getSmaregiDiffItems(){
  const keyword=String(el("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
  return smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    if(!check||isSmaregiExcludedCheck(check))return false;
    if(isSmaregiEffectiveNoIssueCheck(item,check))return false;
    if(keyword&&!String(item.product_name||"").toLowerCase().includes(keyword))return false;
    const stockBreakdown=getSmaregiInventoryBreakdown(item,check);
    const difference=stockBreakdown.difference;
    return difference!==null&&difference!==0;
  });
}

function scrollToSmaregiDiffPanel(){
  const panel=el("smaregiDiffOnlyPanel");
  if(panel)panel.scrollIntoView({behavior:"smooth",block:"start"});
}

function getSmaregiAppStock(barcode){
  const product=gp(barcode);
  if(!product)return "";
  return Number(product.base_stock||0)+getSmaregiEventShelfStock(barcode);
}

function getSmaregiCheckerName(){
  return String(el("smaregiCheckerName")?.value||"").trim();
}

function getSmaregiItemGroup(item){
  const product=gp(item.barcode)||{};
  return String(
    item.category||item.genre||item.department||item.location||
    product.category||product.genre||product.department||product.location||
    "未分類"
  ).trim()||"未分類";
}

function isSmaregiManager(){
  return typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
}

function updateSmaregiManagerControls(){
  const manager=isSmaregiManager();
  const settingsAccess=typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess();
  const analyticsActive=document.body.dataset.inventoryScreen==="analytics";
  const sync=el("syncSmaregiStockBtn");
  const complete=el("completeSmaregiStockCheckBtn");
  const reset=el("resetSmaregiCompletionBtn");
  if(sync){
    sync.disabled=!settingsAccess;
    sync.hidden=!settingsAccess;
    sync.classList.add("smaregi-manager-control");
  }
  if(complete){
    complete.disabled=!manager;
    complete.hidden=!manager;
    complete.classList.add("smaregi-manager-control");
    complete.textContent="今回のチェックを完了";
  }
  const diffPanel=el("smaregiDiffOnlyPanel");
  if(diffPanel)diffPanel.hidden=!(manager&&analyticsActive);
  const reasonSummaryPanel=el("smaregiReasonSummaryPanel");
  if(reasonSummaryPanel)reasonSummaryPanel.hidden=!(manager&&analyticsActive);
  if(reset){
    reset.disabled=!manager;
    reset.hidden=!manager;
    reset.classList.add("smaregi-manager-control");
    reset.textContent="チェック完了解除";
  }
  const resetPanel=el("resetSmaregiCompletionBtn")?.closest(".smaregi-reset-panel");
  if(resetPanel)resetPanel.hidden=!manager;
}

function formatDateTimeLocal(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  const pad=n=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getSmaregiStats(){
  const total=smaregiStockItems.length;
  const excluded=smaregiStockItems.filter(item=>isSmaregiExcludedCheck(getSmaregiCheck(item.barcode))).length;
  const completed=smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    return isSmaregiExcludedCheck(check)
      || (check?.actual_stock!==null&&check?.actual_stock!==undefined&&String(check.actual_stock)!=="");
  }).length;
  const unchecked=Math.max(0,total-completed);
  const diffCount=getSmaregiDiffItems().length;
  const targetTotal=total;
  const percent=total>0?Math.round((completed/total)*100):0;
  return {total,completed,unchecked,excluded,diffCount,targetTotal,percent};
}

function getSmaregiStatsText(){
  const stats=getSmaregiStats();
  return `完了：${stats.completed} / ${stats.targetTotal}（${stats.percent}%） / 未入力：${stats.unchecked} / 除外：${stats.excluded}`;
}

function getSmaregiProgressHtml(){
  const stats=getSmaregiStats();
  const checker=getSmaregiCheckerName()||"未選択";
  return `
    <div class="smaregi-progress-card-inner">
      <div class="smaregi-progress-checker">チェック担当者：<strong>${esc(checker)}</strong></div>
      <div class="smaregi-progress-main">チェック済み <span>${stats.completed} / ${stats.total}</span></div>
      <div class="smaregi-progress-sub">除外 ${stats.excluded}　残り ${stats.unchecked}件</div>
      <div class="smaregi-progress-area">
        <div id="smaregiProgressGraph" class="smaregi-progress-graph" role="progressbar" aria-label="棚卸進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.percent}">
          <div id="smaregiProgressFill" class="smaregi-progress-fill" style="width:${stats.percent}%"></div>
        </div>
        <div id="smaregiProgressText" class="smaregi-progress-text">進捗 ${stats.percent}%</div>
      </div>
    </div>`;
}

function updateSmaregiProgressGraph(){
  const stats=getSmaregiStats();
  const graph=el("smaregiProgressGraph");
  const fill=el("smaregiProgressFill");
  const text=el("smaregiProgressText");
  if(graph)graph.setAttribute("aria-valuenow",String(stats.percent));
  if(fill)fill.style.width=`${stats.percent}%`;
  if(text)text.textContent=`進捗 ${stats.percent}%`;
}

function getFocusedSmaregiInputState(){
  const active=document.activeElement;
  if(active&&active.classList&&(active.classList.contains("smaregi-row-actual-input")||active.classList.contains("smaregi-diff-actual-input"))){
    return {barcode:String(active.dataset.barcode||""),value:active.value,selectionStart:active.selectionStart,selectionEnd:active.selectionEnd,inputClass:active.classList.contains("smaregi-diff-actual-input")?"smaregi-diff-actual-input":"smaregi-row-actual-input"};
  }
  return null;
}

function restoreFocusedSmaregiInputState(state){
  if(!state||!state.barcode)return;
  const input=[...document.querySelectorAll(`.${state.inputClass||"smaregi-row-actual-input"}`)].find(el=>String(el.dataset.barcode||"")===String(state.barcode));
  if(!input)return;
  input.value=state.value;
  input.focus();
  try{input.setSelectionRange(state.selectionStart??state.value.length,state.selectionEnd??state.value.length);}catch(_){}
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
  if(progress)progress.innerHTML=getSmaregiProgressHtml();
  updateSmaregiProgressGraph();
  updateSmaregiManagerControls();
  const resetInput=el("resetSmaregiCompletedAtInput");
  if(resetInput&&smaregiSnapshot?.completed_at&&!resetInput.value){
    resetInput.value=formatDateTimeLocal(smaregiSnapshot.completed_at);
  }

  const keyword=String(el("smaregiStockSearchInput")?.value||"").trim().toLowerCase();
  const visible=smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    if(check)return false;
    return !keyword || String(item.product_name||"").toLowerCase().includes(keyword);
  }).sort((a,b)=>{
    const groupCompare=getSmaregiItemGroup(a).localeCompare(getSmaregiItemGroup(b),"ja");
    if(groupCompare)return groupCompare;
    return String(a.product_name||"").localeCompare(String(b.product_name||""),"ja");
  });

  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="5" class="smaregi-empty">「スマレジデータ取り込み」で最新データを表示してください。</td></tr>';
    renderSmaregiDiffOnlyPanel();
    return;
  }

  if(!visible.length){
    body.innerHTML='<tr><td colspan="5" class="smaregi-empty">表示する商品がありません。</td></tr>';
    renderSmaregiDiffOnlyPanel();
    return;
  }

  let lastGroup="";
  body.innerHTML=visible.map(item=>{
    const check=getSmaregiCheck(item.barcode);
    const excluded=isSmaregiExcludedCheck(check);
    const actualDifference=getSmaregiActualDifference(item);
    const status="未チェック";
    const statusClass="";
    const group=getSmaregiItemGroup(item);
    const heading=group!==lastGroup ? `<tr class="smaregi-group-row"><td colspan="5">【${esc(group)}】</td></tr>` : "";
    lastGroup=group;
    return `${heading}<tr class="smaregi-product-row">
      <td><span class="smaregi-status${statusClass}">${status}</span></td>
      <td class="smaregi-product-name-cell"><strong>${esc(item.product_name||"")}</strong>${getSmaregiMovementSummaryHtml(item)}</td>
      <td><input type="number" class="smaregi-row-actual-input" data-barcode="${esc(item.barcode)}" min="0" step="1" inputmode="numeric" value="${excluded ? "" : (check?.actual_stock??"")}" placeholder="手入力" ${excluded?"disabled":""}/></td>
      <td><button type="button" class="smaregi-row-save-btn" data-barcode="${esc(item.barcode)}" ${excluded?"disabled":""}>${check&&!excluded?"更新":"保存"}</button></td>
      <td class="smaregi-row-actions">
        ${isSmaregiManager()&&actualDifference!==null&&actualDifference!==0&&!excluded ? `<button type="button" class="secondary smaregi-cause-btn" data-barcode="${esc(item.barcode)}">原因確認</button>` : ""}
        ${isSmaregiManager() ? (excluded ? `<button type="button" class="secondary smaregi-clear-btn" data-barcode="${esc(item.barcode)}">除外解除</button>` : `<button type="button" class="secondary smaregi-exclude-btn" data-barcode="${esc(item.barcode)}">除外</button>`) : ""}
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll(".smaregi-row-save-btn").forEach(button=>{
    button.onclick=()=>handleSmaregiRowSave(button);
  });
  body.querySelectorAll(".smaregi-row-actual-input").forEach(input=>{
    input.onkeydown=e=>{
      if(e.key!=="Enter")return;
      e.preventDefault();
      const button=input.closest("tr")?.querySelector(".smaregi-row-save-btn");
      if(button&&!button.disabled)handleSmaregiRowSave(button);
    };
  });
  body.querySelectorAll(".smaregi-exclude-btn").forEach(button=>{
    button.onclick=()=>runWithSmaregiAutoRefreshPaused(
      ()=>excludeSmaregiStockItem(button.dataset.barcode),
      {button}
    );
  });
  body.querySelectorAll(".smaregi-clear-btn").forEach(button=>{
    button.onclick=()=>runWithSmaregiAutoRefreshPaused(
      ()=>clearSmaregiStockCheck(button.dataset.barcode),
      {button}
    );
  });
  body.querySelectorAll(".smaregi-cause-btn").forEach(button=>{
    button.onclick=()=>showSmaregiCauseDetail(button.dataset.barcode);
  });
  renderSmaregiDiffOnlyPanel();
}

function renderSmaregiDiffOnlyPanel(){
  const panel=el("smaregiDiffOnlyPanel");
  const body=el("smaregiDiffOnlyBody");
  const summary=el("smaregiDiffSummary");
  if(!panel||!body)return;

  if(!isSmaregiManager()){
    panel.hidden=true;
    body.innerHTML="";
    if(summary)summary.textContent="";
    return;
  }

  const diffItems=getSmaregiDiffItems();
  const stats=getSmaregiStats();
  const checkedCount=stats.completed;
  if(summary)summary.textContent=`差異：${diffItems.length}件 / 完了：${stats.completed}件 / 未入力：${stats.unchecked}件 / 除外：${stats.excluded}件`;

  if(!smaregiSnapshot){
    body.innerHTML='<tr><td colspan="7" class="smaregi-empty">スマレジデータ取り込みを実行してください。</td></tr>';
    return;
  }

  if(!diffItems.length){
    body.innerHTML='<tr><td colspan="7" class="smaregi-empty">差異のある商品はありません。</td></tr>';
    console.log("[Smaregi Diff List Rendered]",{diffCount:0,totalCheckedCount:checkedCount});
    return;
  }

  body.innerHTML=diffItems.map(item=>{
    const check=getSmaregiCheck(item.barcode);
    const stockBreakdown=getSmaregiInventoryBreakdown(item,check);
    const difference=stockBreakdown.difference;
    const differenceClass=difference<0 ? " is-negative" : " is-positive";
    return `<tr>
      <td>${esc(item.product_name||"")}</td>
      <td><input type="number" class="smaregi-diff-actual-input" data-barcode="${esc(item.barcode)}" min="0" step="1" inputmode="numeric" value="${esc(check?.actual_stock??"")}"/>${check?.actual_corrected===true?'<span class="smaregi-corrected-badge">修正済</span>':""}</td>
      <td>${stockBreakdown.eventShelfStock}</td>
      <td>${stockBreakdown.comparisonStock}</td>
      <td>${stockBreakdown.smaregiStock}</td>
      <td><span class="smaregi-difference${differenceClass}">${difference}</span></td>
      <td>${esc(getSmaregiDisplayCheckedBy(check))}</td>
      <td>${check?.checked_at ? fmt(check.checked_at) : ""}</td>
      <td><div class="diff-action-group"><button type="button" class="secondary smaregi-diff-cause-btn" data-barcode="${esc(item.barcode)}">原因確認</button><button type="button" class="smaregi-diff-save-btn" data-barcode="${esc(item.barcode)}">保存</button><button type="button" class="secondary smaregi-no-issue-btn" data-barcode="${esc(item.barcode)}">問題なし</button>${check?.difference_reason_category?`<small class="smaregi-reason-note" title="${esc(check.difference_reason_memo||"")}">${esc(check.difference_reason_category)}</small>`:""}</div></td>
    </tr>`;
  }).join("");
  body.querySelectorAll(".smaregi-diff-save-btn").forEach(button=>{
    button.onclick=()=>handleSmaregiDiffSave(button);
  });
  body.querySelectorAll(".smaregi-no-issue-btn").forEach(button=>{
    button.onclick=()=>markSmaregiDifferenceNoIssue(button.dataset.barcode,button);
  });
  body.querySelectorAll(".smaregi-diff-cause-btn").forEach(button=>{
    button.onclick=()=>showSmaregiCauseDetail(button.dataset.barcode);
  });
  body.querySelectorAll(".smaregi-diff-actual-input").forEach(input=>{
    input.addEventListener("keydown",event=>{
      if(event.key!=="Enter")return;
      event.preventDefault();
      input.closest("tr")?.querySelector(".smaregi-diff-save-btn")?.click();
    });
  });
  console.log("[Smaregi Diff List Rendered]",{diffCount:diffItems.length,totalCheckedCount:checkedCount});
}

function showSmaregiDiffOnlyPanel(){
  if(!isSmaregiManager()){
    showMessage("差異一覧は分析画面のパスワード認証後に確認できます。","err");
    return;
  }
  const panel=el("smaregiDiffOnlyPanel");
  if(!panel)return;
  panel.hidden=false;
  renderSmaregiDiffOnlyPanel();
  scrollToSmaregiDiffPanel();
  showMessage("今回の差異一覧を表示しました。","ok");
}

async function handleSmaregiRowSave(button){
  const barcode=String(button.dataset.barcode||"");
  const value=button.closest("tr")?.querySelector(".smaregi-row-actual-input")?.value;
  const saved=await runWithSmaregiAutoRefreshPaused(
    ()=>saveSmaregiActualStock(barcode,value),
    {button}
  );
  if(!saved)renderSmaregiStockChecks();
}

async function handleSmaregiDiffSave(button){
  if(!isSmaregiManager()){
    showMessage("差異一覧の数量修正はパスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  const barcode=String(button.dataset.barcode||"");
  const value=button.closest("tr")?.querySelector(".smaregi-diff-actual-input")?.value;
  const saved=await runWithSmaregiAutoRefreshPaused(
    ()=>saveSmaregiActualStock(barcode,value,{markCorrected:true}),
    {button}
  );
  if(!saved)renderSmaregiDiffOnlyPanel();
}

async function markSmaregiDifferenceNoIssue(barcode,button=null){
  if(!isSmaregiManager()){
    showMessage("差異の問題なし処理はパスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  if(!smaregiSnapshot||!confirm("この差異を問題なしとして処理しますか？"))return;
  await runWithSmaregiAutoRefreshPaused(async()=>{
    const checkedBy=getSmaregiCheckerName();
    const no_issue_at=new Date().toISOString();
    try{
     const manualNoIssuePayload={no_issue:true,no_issue_by:checkedBy,no_issue_at,no_issue_reason:"",is_manual_no_issue:true};
     try{
       await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
         method:"PATCH",
         headers:{Prefer:"return=minimal"},
         body:JSON.stringify(manualNoIssuePayload)
       });
     }catch(error){
       if(!isMissingSmaregiSnapshotColumnError(error))throw error;
       await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
         method:"PATCH",
         headers:{Prefer:"return=minimal"},
         body:JSON.stringify(removeSmaregiSnapshotFields(manualNoIssuePayload))
       });
       showMessage("手動問題なしは保存しました。スナップショットSQL適用後に新規チェックを保存してください。","warn");
     }
     smaregiStockChecks.forEach(check=>{
       if(String(check.barcode)===String(barcode)){
         check.no_issue=true;
        check.no_issue_by=checkedBy;
         check.no_issue_at=no_issue_at;
         check.no_issue_reason="";
         check.is_manual_no_issue=true;
       }
     });
    renderSmaregiStockChecks();
    showMessage("差異を問題なしとして処理しました。","ok");
  }catch(e){
    showMessage("問題なし処理エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
  },{button});
}

async function loadLatestSmaregiSnapshot(){
  try{
    showMessage("スマレジ在庫変動データを取得中...");
    const snapshots=await sb("smaregi_stock_snapshots?select=*&order=imported_at.desc&limit=1");
    smaregiSnapshot=Array.isArray(snapshots)&&snapshots.length ? snapshots[0] : null;
    const resetInput=el("resetSmaregiCompletedAtInput");
    if(resetInput)resetInput.value=smaregiSnapshot?.completed_at ? formatDateTimeLocal(smaregiSnapshot.completed_at) : "";
    smaregiStockItems=[];
    smaregiStockChecks=[];

    if(smaregiSnapshot){
      const snapshotId=encodeURIComponent(smaregiSnapshot.id);
      smaregiStockItems=await sbAll(`smaregi_stock_items?select=*&snapshot_id=eq.${snapshotId}&order=product_name.asc`,1000,20000);
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
      await loadSmaregiEventInventoryCache(smaregiStockItems.map(item=>item.barcode));
    }else{
      smaregiCurrentEventStockByBarcode=new Map();
      smaregiEventStorageStockByBarcode=new Map();
      smaregiEventInventoryStoreCode="";
    }

    renderSmaregiStockChecks();
    showMessage(smaregiSnapshot
      ? `スマレジ在庫変動データを取得しました：${smaregiStockItems.length}件`
      : "スマレジ在庫変動データはまだありません。在庫変動CSVを取り込んでください。",smaregiSnapshot?"ok":"");
  }catch(e){
    showMessage("スマレジ在庫変動データ取得エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
}

async function syncSmaregiStockFromApi(){
  showCsvOperationMessage("現在はCSV運用中です。スマレジAPIには接続しません。スマレジ在庫変動CSVを選択してください。");
  const csvInput=el("smaregiStockCsvFile");
  if(csvInput){
    csvInput.value="";
    csvInput.click();
  }
  return;
  if(!(typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess())){
    showMessage("スマレジ変動商品データ取り込みは設定画面のパスワード認証後に操作できます。","err");
    return;
  }
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "スマレジ変動商品チェック確認",
      typeof getSmaregiOperationContextText==="function"
        ? getSmaregiOperationContextText("前回チェック以降の変動商品を取得します。")
        : "前回チェック以降の変動商品を取得します。",
      {okText:"取込"}
    );
    if(!ok)return;
  }

  try{
    showMessage("スマレジデータを取り込み中...");
    const smaregiContext=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
    console.log("[Smaregi stock sync] context",smaregiContext);
    const res=await fetch("about:blank",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(smaregiContext)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`APIエラー ${res.status}`);
    await loadLatestSmaregiSnapshot();
    showPopup("スマレジデータ取り込み完了",`前回チェック以降の変動商品を取得しました。\n対象商品：${Number(data.item_count||0)}件\n変動履歴：${Number(data.change_count||0)}件${data.warning ? `\n\n注意：${data.warning}` : ""}`);
  }catch(e){
    showMessage("スマレジデータ取り込みエラー。\n"+e.message,"err");
  }
}

async function prepareSmaregiActualStockTargets(targets){
  const prepared=[];
  const missing=[];
  for(const item of targets){
    const barcode=String(item?.barcode??"").trim();
    if(!barcode){
      missing.push({barcode:"",productName:item?.product_name||""});
      continue;
    }
    const actualStock=Number(getSmaregiCheck(barcode)?.actual_stock||0);
    if(!Number.isFinite(actualStock)||actualStock<0)continue;
    const product=await fetchProductByBarcode(barcode);
    if(!product){
      missing.push({barcode,productName:item?.product_name||""});
      continue;
    }
    prepared.push({
      item,
      barcode,
      actualStock,
      product,
      beforeStock:Number(product.base_stock||0)
    });
  }
  if(missing.length){
    const details=missing.map(row=>[
      "商品マスター未登録",
      `バーコード：${row.barcode||"（空欄）"}`,
      `商品名：${row.productName||"（不明）"}`
    ].join("\n")).join("\n\n");
    if(typeof showPopup==="function")showPopup("商品マスター未登録",details);
    throw new Error(details);
  }
  return prepared;
}

async function applySmaregiActualStocksToSheet(completedBy){
  const targets=smaregiStockItems.filter(item=>{
    const check=getSmaregiCheck(item.barcode);
    return check
      && !isSmaregiExcludedCheck(check)
      && !isSmaregiNoIssueCheck(check)
      && check.actual_corrected===true
      && check.actual_stock!==null
      && check.actual_stock!==undefined
      && String(check.actual_stock)!=="";
  });
  const prepared=await prepareSmaregiActualStockTargets(targets);
  const operations=[];
  try{
    for(const row of prepared){
      if(row.beforeStock===row.actualStock)continue;
      const operation={...row,inventoryLogId:null};
      operations.push(operation);
      const inserted=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"在庫修正",
          staff:completedBy,
          barcode:row.barcode,
          product_name:row.item.product_name||row.product?.name||"",
          quantity:row.actualStock,
          memo:`スマレジ変動商品チェック完了時に実在庫反映（前在庫 ${row.beforeStock}）`
        })
      });
      operation.inventoryLogId=Array.isArray(inserted)&&inserted[0]?.id ? inserted[0].id : null;
      await updateProductCurrentStock(row.barcode,row.actualStock);
    }
  }catch(error){
    for(const operation of operations.reverse()){
      try{await updateProductCurrentStock(operation.barcode,operation.beforeStock);}catch(rollbackError){console.warn("[smaregi stock rollback failed]",rollbackError);}
      if(operation.inventoryLogId){
        try{await sb(`inventory_logs?id=eq.${encodeURIComponent(operation.inventoryLogId)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});}catch(rollbackError){console.warn("[smaregi log rollback failed]",rollbackError);}
      }
    }
    throw error;
  }

  console.log("[Smaregi Actual Stocks Applied]",{
    appliedBy:completedBy,
    targetCount:targets.length,
    appliedCount:operations.length
  });

  return operations.length;
}

async function completeSmaregiStockCheck(){
  if(!isSmaregiManager()){
    showMessage("パスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  if(!smaregiSnapshot){
    showMessage("完了するスマレジ在庫チェックがありません。","err");
    return;
  }
  const stats=getSmaregiStats();
  const warning=stats.unchecked>0?`\n\n未入力商品が${stats.unchecked}件あります。\n本当にチェック完了しますか？`:"";
  const message=[
    `チェック対象　${stats.targetTotal}件`,
    `完了　　　　${stats.completed}件`,
    `未入力　　　${stats.unchecked}件`,
    `除外　　　　${stats.excluded}件`,
    "",
    "チェック完了後、差異一覧で明示的に修正保存した実在庫のみシート在庫へ反映します。",
    "このままチェック完了しますか？",
    warning
  ].join("\n");
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "チェック完了確認",
      typeof getSmaregiOperationContextText==="function"
        ? getSmaregiOperationContextText(message)
        : message,
      {okText:"完了"}
    );
    if(!ok)return;
  }else if(!confirm(message))return;
  try{
    const completedBy=getSmaregiCheckerName();
    if(typeof enforceStaffStoreMatch==="function"&&!enforceStaffStoreMatch(completedBy,"店舗確認エラー","smaregiCheckerName")){
      return;
    }
    const appliedCount=await applySmaregiActualStocksToSheet(completedBy);
    const completed_at=new Date().toISOString();
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return:minimal"},
      body:JSON.stringify({completed_at})
    });
    smaregiSnapshot.completed_at=completed_at;
    renderSmaregiStockChecks();
    console.log("[Smaregi Check Completed]",{
      completedBy,
      completedAt:completed_at,
      appliedCount,
      stats
    });
    showPopup("チェック完了",`今回のチェックを完了しました。\nシート在庫へ反映：${appliedCount}件\n差異がある商品は今回の差異一覧で確認できます。`);
    showMessage(`今回のチェックを完了しました。シート在庫へ反映：${appliedCount}件`,"ok");
    showSmaregiDiffOnlyPanel();
  }catch(e){
    showMessage("チェック完了保存エラー。\n追加SQLを実行済みか確認してください。\n"+e.message,"err");
  }
}

async function resetSmaregiStockCheckCompletion(){
  if(!isSmaregiManager()){
    showMessage("パスワード認証済みの管理者のみ操作できます。","err");
    return;
  }
  if(!smaregiSnapshot){
    showMessage("戻すスマレジ在庫チェックがありません。","err");
    return;
  }
  const input=el("resetSmaregiCompletedAtInput");
  const selected=String(input?.value||"").trim();
  if(!selected){
    showMessage("戻す日時を選択してください。","err");
    input?.focus();
    return;
  }
  const date=new Date(selected);
  if(Number.isNaN(date.getTime())){
    showMessage("戻す日時を正しく選択してください。","err");
    input?.focus();
    return;
  }
  if(!confirm("チェック完了日時を選択した日時に戻します。よろしいですか？"))return;
  try{
    const resetTo=date.toISOString();
    await sb(`smaregi_stock_snapshots?completed_at=gt.${encodeURIComponent(resetTo)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at:null})
    });
    await sb(`smaregi_stock_snapshots?id=eq.${encodeURIComponent(smaregiSnapshot.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({completed_at:resetTo})
    });
    smaregiSnapshot.completed_at=resetTo;
    renderSmaregiStockChecks();
    console.log("[Smaregi Check Completion Reset]",{
      resetBy:getSmaregiCheckerName(),
      resetTo
    });
    showPopup("チェック完了解除","チェック完了日時を選択した日時に戻しました。");
    showMessage("チェック完了を解除しました。","ok");
  }catch(e){
    showMessage("チェック完了解除エラー。\n"+e.message,"err");
  }
}

async function saveSmaregiActualStock(barcode,value,{markCorrected=false}={}){
  if(!smaregiSnapshot)return false;
  if(!String(barcode||"").trim()){
    showMessage("対象商品が見つかりません。","err");
    return false;
  }
  const valueText=String(value ?? "").trim();
  if(valueText===""){
    showMessage("実在庫を入力してください。0の場合は 0 と入力してください。","err");
    return false;
  }

  if(!/^\d+$/.test(valueText)){
    showMessage("実在庫は0以上の整数で入力してください。","err");
    return false;
  }

  const actual_stock=parseInt(valueText,10);
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item || !Number.isInteger(actual_stock) || actual_stock<0){
    showMessage("実在庫は0以上の整数で入力してください。","err");
    return false;
  }

  try{
    const previousCheck=getSmaregiCheck(barcode);
    const isUpdate=!!previousCheck;
    const stockBreakdown=getSmaregiInventoryBreakdown(item,{...previousCheck,actual_stock});
    const difference=Number.isFinite(Number(stockBreakdown?.difference)) ? Number(stockBreakdown.difference) : null;
    const checked_by=getSmaregiCheckerName();
    if(!checked_by){
      showMessage("担当者を選択してください","err");
      el("smaregiCheckerName")?.focus();
      return false;
    }
    if(typeof enforceStaffStoreMatch==="function"&&!enforceStaffStoreMatch(checked_by,"店舗確認エラー","smaregiCheckerName")){
      return false;
    }
    if(typeof confirmAppAction==="function"){
      const ok=await confirmAppAction(
        "実在庫保存確認",
        typeof getSmaregiOperationContextText==="function"
          ? getSmaregiOperationContextText(`商品：${item.product_name||barcode}\n棚番：${getProductShelfLabel(gp(barcode)||{location:item.location||""})}\nバーコード：${barcode}\n実在庫：${actual_stock}`)
          : `商品：${item.product_name||barcode}\n実在庫：${actual_stock}`,
        {okText:"保存"}
      );
      if(!ok)return false;
    }
    const checked_at=new Date().toISOString();
    const correctedNow=markCorrected||isUpdate;
    const snapshotFields=getSmaregiSnapshotFields({
      item,
      barcode,
      appStock:actual_stock,
      eventShelfStock:stockBreakdown?.eventShelfStock,
      smaregiStock:stockBreakdown?.smaregiStock,
      manualNoIssue:isSmaregiNoIssueCheck(previousCheck)
    });
    const payload={
      snapshot_id:smaregiSnapshot.id,
      barcode,
      actual_stock,
      difference,
      checked_by,
      checked_at,
      excluded:false,
      no_issue:isSmaregiNoIssueCheck(previousCheck),
      no_issue_by:previousCheck?.no_issue_by||null,
      no_issue_at:previousCheck?.no_issue_at||null,
      no_issue_reason:previousCheck?.no_issue_reason||"",
      difference_reason_category:previousCheck?.difference_reason_category||null,
      difference_reason_memo:previousCheck?.difference_reason_memo||"",
      difference_reason_by:previousCheck?.difference_reason_by||null,
      difference_reason_at:previousCheck?.difference_reason_at||null,
      actual_corrected:correctedNow||previousCheck?.actual_corrected===true,
      actual_corrected_by:correctedNow ? checked_by : (previousCheck?.actual_corrected_by||null),
      actual_corrected_at:correctedNow ? checked_at : (previousCheck?.actual_corrected_at||null),
      ...snapshotFields
    };

    // 保存済みの実在庫も確実に更新できるよう、同じ snapshot_id + barcode の旧チェックを削除してから登録します。
    // unique 制約が無いSupabase環境でも、古い実在庫が残って表示される問題を防ぎます。
    const {rows:savedRows}=await persistSmaregiCheckRecord({
      snapshotId:smaregiSnapshot.id,
      barcode,
      payload
    });

    const savedRow=Array.isArray(savedRows)&&savedRows[0] ? savedRows[0] : payload;
    const next={...savedRow,snapshot_id:smaregiSnapshot.id,barcode,actual_stock,difference,checked_by,checked_at};
    smaregiStockChecks=smaregiStockChecks.filter(c=>String(c.barcode)!==String(barcode));
    smaregiStockChecks.push(next);
    renderSmaregiStockChecks();
    console.log("[Smaregi Row Check Saved]",{
      barcode,
      productName:item.product_name||"",
      actualStock:actual_stock,
      smaregiStock:getSavedSmaregiStockNumber(item,0),
      appStock:getSmaregiAppStock(barcode),
      difference,
      checkedBy:checked_by
    });
    showMessage(`実在庫を${isUpdate?"更新":"保存"}しました：${item.product_name||barcode}`,"ok");
    return true;
  }catch(e){
    showMessage("実在庫保存エラー。\n"+e.message,"err");
    return false;
  }
}

async function excludeSmaregiStockItem(barcode){
  if(!isSmaregiManager()){
    showMessage("除外はパスワード認証済みの管理者のみ操作できます。","err");
    return false;
  }
  if(!smaregiSnapshot)return false;
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item){
    showMessage("対象商品が見つかりません。","err");
    return false;
  }
  const checked_by=getSmaregiCheckerName();
  if(!checked_by){
    showMessage("除外する担当者を選択してください。","err");
    el("smaregiCheckerName")?.focus();
    return false;
  }
  if(!confirm(`${item.product_name||barcode} を今回のチェック対象から除外しますか？`))return false;
  try{
    const checked_at=new Date().toISOString();
    const old=getSmaregiCheck(barcode);
    const hasExistingActualStock=old?.actual_stock!==null&&old?.actual_stock!==undefined&&String(old.actual_stock)!=="";
    const actual_stock=hasExistingActualStock ? Number(old.actual_stock) : 0;
    const stockBreakdown=hasExistingActualStock
      ? getSmaregiInventoryBreakdown(item,{...old,actual_stock})
      : null;
    const difference=Number.isFinite(Number(stockBreakdown?.difference)) ? Number(stockBreakdown.difference) : 0;
    const next={
      snapshot_id:smaregiSnapshot.id,
      barcode,
      actual_stock:Number.isFinite(actual_stock) ? actual_stock : 0,
      difference:Number.isFinite(difference) ? difference : 0,
      checked_by:`除外:${checked_by}`,
      checked_at,
      excluded:true,
      no_issue:isSmaregiNoIssueCheck(old),
      no_issue_by:old?.no_issue_by||null,
      no_issue_at:old?.no_issue_at||null,
      no_issue_reason:old?.no_issue_reason||"",
      difference_reason_category:old?.difference_reason_category||null,
      difference_reason_memo:old?.difference_reason_memo||"",
      difference_reason_by:old?.difference_reason_by||null,
      difference_reason_at:old?.difference_reason_at||null,
      actual_corrected:old?.actual_corrected===true,
      actual_corrected_by:old?.actual_corrected_by||null,
      actual_corrected_at:old?.actual_corrected_at||null
    };
    await persistSmaregiCheckRecord({
      snapshotId:smaregiSnapshot.id,
      barcode,
      payload:next
    });
    smaregiStockChecks=smaregiStockChecks.filter(c=>String(c.barcode)!==String(barcode));
    smaregiStockChecks.push(next);
    renderSmaregiStockChecks();
    console.log("[Smaregi Row Excluded]",{barcode,productName:item.product_name||"",excludedBy:checked_by});
    showMessage(`除外しました：${item.product_name||barcode} / 担当者：${checked_by}`,"ok");
    return true;
  }catch(e){
    showMessage("除外保存エラー。\n"+e.message,"err");
    return false;
  }
}

async function clearSmaregiStockCheck(barcode){
  if(!isSmaregiManager()){
    showMessage("除外解除はパスワード認証済みの管理者のみ操作できます。","err");
    return false;
  }
  const item=smaregiStockItems.find(row=>String(row.barcode)===String(barcode));
  if(!item||!smaregiSnapshot)return;
  if(!confirm(`${item.product_name||barcode} のチェック済み状態を解除しますか？`))return;
  try{
    const old=getSmaregiCheck(barcode);
    const hasActualStock=old?.actual_stock!==null&&old?.actual_stock!==undefined&&String(old.actual_stock)!=="";
    if(hasActualStock){
      const checked_by=getSmaregiDisplayCheckedBy(old);
      await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({checked_by,excluded:false})
      });
      if(old){
        old.checked_by=checked_by;
        old.excluded=false;
      }
    }else{
      await sb(`smaregi_stock_checks?snapshot_id=eq.${encodeURIComponent(smaregiSnapshot.id)}&barcode=eq.${encodeURIComponent(barcode)}`,{
        method:"DELETE",
        headers:{Prefer:"return=minimal"}
      });
      smaregiStockChecks=smaregiStockChecks.filter(check=>String(check.barcode)!==String(barcode));
    }
    renderSmaregiStockChecks();
    showMessage(`チェックを解除しました：${item.product_name||barcode}`,"ok");
  }catch(e){
    showMessage("チェック解除エラー。\n"+e.message,"err");
  }
}

async function openHistoryFromSmaregi(barcode){
  const input=el("productHistoryBarcodeInput");
  if(input)input.value=barcode;
  showInventoryProductHistory();
  await showProductHistoryForBarcode(barcode);
  el("productHistoryCard")?.scrollIntoView({behavior:"smooth",block:"start"});
}

function getSmaregiCsvStatus(check,difference,item=null){
  if(!check)return "未チェック";
  if(isSmaregiExcludedCheck(check))return "除外";
  if(isSmaregiEffectiveNoIssueCheck(item,check)||difference===0)return "問題なし";
  if(check.actual_corrected===true)return "修正済";
  return "チェック済み";
}

function isSmaregiDifferenceCsvRow({check,item=null,difference,snapshotValues=null,calculation=null}={}){
  if(!check||isSmaregiExcludedCheck(check))return false;
  if(isSmaregiNoIssueCheck(check))return false;
  if(snapshotValues?.isAutoNoIssue===true)return false;
  if(snapshotValues&&isSmaregiNonPositiveNoIssue(snapshotValues))return false;
  if(calculation?.isNoIssue===true)return false;
  if(!snapshotValues&&item&&isSmaregiEffectiveNoIssueCheck(item,check))return false;
  const numericDifference=Number.isFinite(Number(difference))
    ? Number(difference)
    : Number(snapshotValues?.savedDifference);
  return Number.isFinite(numericDifference)&&numericDifference!==0;
}

const SMAREGI_DIFFERENCE_CSV_HEADER=[
  "チェック日時","店舗","商品名","バーコード","アプリ在庫","イベント棚在庫",
  "比較用在庫","スマレジ在庫","差異","自動問題なし","手動問題なし",
  "原因カテゴリ","差異要因","備考","確認状態","確認者","確認日時","データ状態"
];

function buildSmaregiDifferenceCsvRow({
  check=null,
  item={},
  snapshot=null,
  snapshotValues=null,
  breakdown=null,
  difference=null
}={}){
  const barcode=String(check?.barcode||item?.barcode||"").trim();
  const isReliable=snapshotValues ? snapshotValues.isReliable!==false : true;
  const savedDifference=snapshotValues?.savedDifference;
  const csvDifference=isReliable
    ? (difference ?? snapshotValues?.difference ?? breakdown?.difference ?? "")
    : (savedDifference===null||savedDifference===undefined||String(savedDifference).trim()==="" ? "不明" : savedDifference);
  const appStock=snapshotValues?.appStock ?? getSmaregiAppStock(barcode);
  const eventShelfStock=isReliable
    ? (snapshotValues?.eventShelfStock ?? breakdown?.eventShelfStock ?? "")
    : "不明";
  const comparisonStock=isReliable
    ? (snapshotValues?.comparisonStock ?? breakdown?.comparisonStock ?? "")
    : "不明";
  const smaregiStock=snapshotValues?.smaregiStock
    ?? breakdown?.smaregiStock
    ?? getSavedSmaregiStockValue(item)
    ?? "";
  const autoNoIssue=snapshotValues?.isAutoNoIssue===true||(!snapshotValues&&breakdown?.isNoIssue===true);
  const manualNoIssue=snapshotValues?.manualNoIssue===true||(!snapshotValues&&isSmaregiNoIssueCheck(check));
  const confirmation=getSmaregiCsvConfirmation(check);
  const dataState=snapshotValues?.dataState
    || (snapshot ? "保存済みスナップショット" : "イベント棚在庫未保存");
  return [
    check?.checked_at ? fmt(check.checked_at) : "",
    getSmaregiCsvStoreLabel({check,item,snapshot,snapshotValues}),
    item.product_name||item.productName||"",
    barcode,
    appStock??"",
    eventShelfStock,
    comparisonStock,
    smaregiStock,
    csvDifference,
    autoNoIssue ? "はい" : "いいえ",
    manualNoIssue ? "はい" : "いいえ",
    String(check?.difference_reason_category||""),
    String(check?.difference_reason_memo||""),
    getSmaregiCsvNote(check),
    confirmation.status,
    confirmation.by,
    confirmation.at,
    getSmaregiCsvDataStateLabel(dataState)
  ];
}

function smaregiCsvRows(differenceOnly=false){
  const rows=[SMAREGI_DIFFERENCE_CSV_HEADER];
  smaregiStockItems.forEach(item=>{
    const check=getSmaregiCheck(item.barcode);
    const breakdown=check ? getSmaregiInventoryBreakdown(item,check) : null;
    const difference=breakdown?.difference??(check ? getSmaregiDifference(item) : "");
    if(differenceOnly&&!isSmaregiDifferenceCsvRow({
      check,
      item,
      difference,
      calculation:breakdown?.calculation
    }))return;
    rows.push(buildSmaregiDifferenceCsvRow({
      check,
      item,
      snapshot:smaregiSnapshot,
      breakdown,
      difference
    }));
  });
  return rows;
}

function getSmaregiDifferenceDateRange(fromId="smaregiDiffCsvFromDate",toId="smaregiDiffCsvToDate"){
  const from=String(el(fromId)?.value||"").trim();
  const to=String(el(toId)?.value||"").trim();
  return {
    from,
    to,
    fromTime:from ? new Date(`${from}T00:00:00`).getTime() : null,
    toTime:to ? new Date(`${to}T23:59:59.999`).getTime() : null
  };
}

function isInSmaregiDifferenceDateRange(value,range=getSmaregiDifferenceDateRange()){
  const time=new Date(value).getTime();
  if(!Number.isFinite(time))return false;
  if(Number.isFinite(range.fromTime)&&time<range.fromTime)return false;
  if(Number.isFinite(range.toTime)&&time>range.toTime)return false;
  return true;
}

const SMAREGI_CSV_DATA_STATE_LABELS=Object.freeze({
  event_history_reconstructed:"イベント履歴から復元",
  saved_snapshot:"保存済みスナップショット",
  snapshot_saved:"保存済みスナップショット",
  no_valid_events:"有効なイベントなし",
  no_shared_event_shelf_history:"共通イベント棚履歴なし",
  incomplete_event_history:"イベント履歴不足",
  incomplete_shared_event_shelf_history:"共通イベント棚履歴不足",
  invalid_check_time:"チェック日時不明",
  event_shelf_unavailable:"イベント棚在庫未保存",
  event_shelf_not_saved:"イベント棚在庫未保存"
});

function getSmaregiCsvDataStateLabel(value){
  const text=String(value||"").trim();
  if(!text)return "イベント棚在庫未保存";
  if(Object.prototype.hasOwnProperty.call(SMAREGI_CSV_DATA_STATE_LABELS,text)){
    return SMAREGI_CSV_DATA_STATE_LABELS[text];
  }
  // Already-localized values should remain readable; unknown internal codes are
  // made explicit instead of leaking an opaque status into the CSV.
  if(/[ぁ-んァ-ヶ一-龯]/.test(text))return text;
  return `不明（状態: ${text}）`;
}

function getSmaregiHistoricalStoreReference(check={},item={},snapshot={}){
  const note=String(snapshot?.note||"");
  const storeCodeFromNote=note.match(/store_code:([^/\s]+)/)?.[1]||"";
  const storeIdFromNote=note.match(/store_id:([^/\s]+)/)?.[1]||"";
  const rawStoreCode=String(
    storeCodeFromNote
      || check?.store_code
      || item?.store_code
      || snapshot?.store_code
      || ""
  ).trim();
  const rawStoreId=String(
    storeIdFromNote
      || check?.store_id
      || item?.store_id
      || snapshot?.store_id
      || ""
  ).trim();
  return {
    storeCode:rawStoreCode ? normalizeSmaregiStoreCodeForStorage(rawStoreCode) : "",
    storeId:rawStoreId
  };
}

function getSmaregiCsvKnownStoreInfo(storeCode){
  const normalized=normalizeSmaregiStoreCodeForStorage(storeCode);
  const stores=typeof SMAREGI_CONTEXT_OPTIONS!=="undefined"&&Array.isArray(SMAREGI_CONTEXT_OPTIONS.stores)
    ? SMAREGI_CONTEXT_OPTIONS.stores
    : [];
  return stores.find(store=>store.key===normalized)||null;
}

function formatSmaregiCsvStoreLabel(storeInfo){
  const label=String(storeInfo?.label||"").trim();
  return label ? (label.endsWith("店") ? label : `${label}店`) : "";
}

function getSmaregiCsvStoreLabel({check=null,item=null,snapshot=null,snapshotValues=null}={}){
  const reference=getSmaregiHistoricalStoreReference(check||{},item||{},snapshot||{});
  const directInfo=getSmaregiCsvKnownStoreInfo(reference.storeCode)
    || getSmaregiCsvKnownStoreInfo(snapshotValues?.storeKey||"");
  if(directInfo)return formatSmaregiCsvStoreLabel(directInfo);

  // API snapshots contain the store ID and store code together. This also
  // handles older rows that kept only the numeric ID when the current snapshot
  // proves which configured store that ID belongs to.
  const currentReference=getSmaregiHistoricalStoreReference({}, {}, smaregiSnapshot||{});
  const currentInfo=getSmaregiCsvKnownStoreInfo(getSmaregiCurrentStoreCode());
  if(reference.storeId&&currentReference.storeId
    && reference.storeId===currentReference.storeId&&currentInfo){
    return formatSmaregiCsvStoreLabel(currentInfo);
  }

  const rawStoreId=reference.storeId||String(snapshotValues?.storeKey||"").trim();
  return rawStoreId ? `不明（店舗ID: ${rawStoreId}）` : "不明（店舗ID: 不明）";
}

function getSmaregiSnapshotStoreCode(snapshot){
  return getSmaregiHistoricalStoreReference({}, {}, snapshot).storeCode;
}

function getSmaregiCsvNote(check){
  return [check?.note,check?.memo,check?.no_issue_reason]
    .map(value=>String(value||"").trim())
    .filter(Boolean)
    .join(" / ");
}

function getSmaregiCsvConfirmation(check){
  if(!check)return {status:"未確認",by:"",at:""};
  const equipmentChecked=check.equipment_checked===true
    || String(check.equipment_checked||"").toLowerCase()==="true";
  if(equipmentChecked){
    return {
      status:"確認済み",
      by:String(check.equipment_checked_by||"").trim(),
      at:check.equipment_checked_at ? fmt(check.equipment_checked_at) : ""
    };
  }
  if(isSmaregiNoIssueCheck(check)){
    return {
      status:"問題なし確認済み",
      by:String(check.no_issue_by||getSmaregiDisplayCheckedBy(check)||"").trim(),
      at:check.no_issue_at ? fmt(check.no_issue_at) : (check.checked_at ? fmt(check.checked_at) : "")
    };
  }
  if(String(check.difference_reason_by||"").trim()||check.difference_reason_at){
    return {
      status:"原因入力済み",
      by:String(check.difference_reason_by||"").trim(),
      at:check.difference_reason_at ? fmt(check.difference_reason_at) : ""
    };
  }
  return {
    status:"チェック済み",
    by:getSmaregiDisplayCheckedBy(check),
    at:check.checked_at ? fmt(check.checked_at) : ""
  };
}

function getSmaregiHistoricalNumericValue(objects,keys){
  for(const object of objects||[]){
    for(const key of keys||[]){
      const raw=object?.[key];
      if(raw===null||raw===undefined||String(raw).trim()==="")continue;
      const value=Number(String(raw).replace(/,/g,""));
      if(Number.isFinite(value))return value;
    }
  }
  return null;
}

function getSmaregiHistoricalCheckKey(check){
  const id=String(check?.id||"").trim();
  if(id)return id;
  return [check?.snapshot_id,check?.barcode,check?.checked_at].map(value=>String(value||"")).join("::");
}

function getSmaregiHistoricalEventTime(row,field="created_at"){
  const time=new Date(row?.[field]||"").getTime();
  return Number.isFinite(time) ? time : null;
}

function getSmaregiHistoricalMovementType(row){
  return String(row?.movement_type||"").trim().toLowerCase();
}

function getSmaregiHistoricalMovementItemType(row){
  return String(row?.item_type||"normal").trim().toLowerCase();
}

function getSmaregiHistoricalMovementSource(row){
  return String(row?.takeout_source||"").trim().toLowerCase();
}

function getSmaregiHistoricalMovementQty(row){
  return Math.max(0,normalizeInventoryQuantity(row?.quantity));
}

function sumSmaregiHistoricalRows(rows,predicate){
  const seenIds=new Set();
  return (Array.isArray(rows)?rows:[]).reduce((sum,row)=>{
    const id=String(row?.id||"").trim();
    if(id&&seenIds.has(id))return sum;
    if(id)seenIds.add(id);
    return predicate(row) ? sum+getSmaregiHistoricalMovementQty(row) : sum;
  },0);
}

function calculateSmaregiHistoricalEventShelfQty({normalItems=[],movements=[],sales=[]}={},checkedAt){
  const checkedTime=new Date(checkedAt||"").getTime();
  if(!Number.isFinite(checkedTime))return {eventShelfStock:null,isReliable:false,reason:"invalid_check_time"};

  const itemByKey=new Map();
  (Array.isArray(normalItems)?normalItems:[]).forEach(row=>{
    if(String(row?.item_type||"normal").trim().toLowerCase()!=="normal")return;
    const key=`${row?.event_id||""}::${row?.barcode||""}`;
    if(key.endsWith("::"))return;
    const previous=itemByKey.get(key);
    const previousTime=getSmaregiHistoricalEventTime(previous,"updated_at")??-1;
    const currentTime=getSmaregiHistoricalEventTime(row,"updated_at")??-1;
    if(!previous||currentTime>=previousTime)itemByKey.set(key,row);
  });

  const movementByKey=new Map();
  (Array.isArray(movements)?movements:[]).forEach(row=>{
    const type=getSmaregiHistoricalMovementType(row);
    const itemType=getSmaregiHistoricalMovementItemType(row);
    const isNormal= itemType==="normal"
      && ["event_pick","take_out","departure_count","return","event_close_return"].includes(type);
    if(!isNormal)return;
    const key=`${row?.event_id||""}::${row?.barcode||""}`;
    if(key.endsWith("::"))return;
    const rows=movementByKey.get(key)||[];
    rows.push(row);
    movementByKey.set(key,rows);
  });

  const salesByKey=new Map();
  (Array.isArray(sales)?sales:[]).forEach(row=>{
    if(String(row?.import_status||"").trim().toLowerCase()!=="confirmed")return;
    const key=`${row?.event_id||""}::${row?.barcode||""}`;
    if(key.endsWith("::"))return;
    const rows=salesByKey.get(key)||[];
    rows.push(row);
    salesByKey.set(key,rows);
  });

  let eventShelfStock=0;
  let isReliable=true;
  const keys=new Set([...itemByKey.keys()]);
  movementByKey.forEach((rows,key)=>{
    if(itemByKey.has(key))keys.add(key);
    else if(rows.some(row=>getSmaregiHistoricalMovementItemType(row)==="normal"))isReliable=false;
  });
  salesByKey.forEach((rows,key)=>{
    if(itemByKey.has(key))keys.add(key);
    else if(rows.some(row=>Number(row?.quantity||0)!==0))isReliable=false;
  });

  keys.forEach(key=>{
    const item=itemByKey.get(key)||{};
    const rows=movementByKey.get(key)||[];
    const beforeRows=[];
    rows.forEach(row=>{
      const type=getSmaregiHistoricalMovementType(row);
      const time=getSmaregiHistoricalEventTime(row);
      if(time===null){
        isReliable=false;
        return;
      }
      if(time<=checkedTime)beforeRows.push(row);
    });

    const normalRows=beforeRows.filter(row=>getSmaregiHistoricalMovementItemType(row)==="normal");
    const eventPickRows=normalRows.filter(row=>["event_pick","take_out"].includes(getSmaregiHistoricalMovementType(row)));
    const departureRows=normalRows.filter(row=>getSmaregiHistoricalMovementType(row)==="departure_count");
    const picked=eventPickRows.length
      ? sumSmaregiHistoricalRows(eventPickRows,()=>true)
      : sumSmaregiHistoricalRows(departureRows,()=>true);
    const normalReturnQty=sumSmaregiHistoricalRows(normalRows,row=>[
      "return","event_close_return"
    ].includes(getSmaregiHistoricalMovementType(row)));
    const itemTaken=normalizeInventoryQuantity(item?.taken_qty);
    if(itemTaken>0&&!eventPickRows.length&&!departureRows.length)isReliable=false;
    const itemUpdatedTime=getSmaregiHistoricalEventTime(item,"updated_at");
    if(itemTaken>0&&itemUpdatedTime===null)isReliable=false;

    let soldQty=0;
    (salesByKey.get(key)||[]).forEach(sale=>{
      const soldTime=getSmaregiHistoricalEventTime(sale,"sold_at");
      if(soldTime===null){
        isReliable=false;
        return;
      }
      if(soldTime<=checkedTime) soldQty+=Number(sale?.quantity||0);
    });

    eventShelfStock+=Math.max(0,picked-soldQty-normalReturnQty);
  });

  return {
    eventShelfStock:isReliable?Math.max(0,eventShelfStock):null,
    isReliable,
    reason:isReliable?"event_history":"incomplete_event_history"
  };
}

window.calculateSmaregiHistoricalEventShelfQty=calculateSmaregiHistoricalEventShelfQty;

async function loadSmaregiLegacyHistoricalEventShelfReconstruction(checks,itemMap,storeCode){
  const targets=(checks||[]).filter(check=>{
    const item=itemMap.get(`${check.snapshot_id}::${check.barcode}`)||{};
    const hasSnapshot=[
      check.app_stock_at_check,
      check.event_shelf_stock_at_check,
      check.comparison_stock_at_check,
      check.smaregi_stock_at_check,
      check.difference_at_check
    ].every(value=>value!==null&&value!==undefined&&String(value).trim()!=="")
      && (check.snapshot_version===null||check.snapshot_version===undefined||Number(check.snapshot_version)>=2);
    const appStock=getSmaregiHistoricalNumericValue([check],["actual_stock","app_stock_at_check"]);
    const smaregiStock=getSmaregiHistoricalNumericValue([check,item],["smaregi_stock_at_check","smaregi_stock","stock_amount","stock_quantity"]);
    return !hasSnapshot&&appStock!==null&&smaregiStock!==null&&String(check.barcode||"").trim()!=="";
  });
  const result=new Map();
  if(!targets.length)return result;
  const barcodes=[...new Set(targets.map(check=>String(check.barcode||"").trim()).filter(Boolean))];
  const barcodeFilter=buildSmaregiInFilter(barcodes);
  if(!barcodeFilter)return result;

  try{
    const events=await sbAll(`booth_events?select=id,status,store_code&store_code=eq.${encodeURIComponent(storeCode)}`,1000,50000);
    const validEventIds=(Array.isArray(events)?events:[])
      .filter(event=>!new Set(["cancelled","canceled","invalid","deleted"]).has(String(event?.status||"").trim().toLowerCase()))
      .map(event=>String(event?.id||"").trim()).filter(Boolean);
    if(!validEventIds.length){
      targets.forEach(check=>result.set(getSmaregiHistoricalCheckKey(check),{
        eventShelfStock:0,isReliable:true,reason:"no_valid_events"
      }));
      return result;
    }
    const eventFilter=buildSmaregiInFilter(validEventIds);
    const [eventItems,movementRows,salesRows]=await Promise.all([
      sbAll(`booth_event_items?select=id,event_id,barcode,item_type,taken_qty,updated_at&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&item_type=eq.normal`,1000,50000),
       sbAll(`booth_stock_movements?select=id,event_id,barcode,movement_type,item_type,quantity,takeout_source,created_at&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&movement_type=in.(departure_count,take_out,event_pick,return,event_close_return)`,1000,50000),
      sbAll(`event_sales_imports?select=id,event_id,barcode,quantity,import_status,sold_at,created_at&event_id=in.(${eventFilter})&barcode=in.(${barcodeFilter})&import_status=eq.confirmed`,1000,50000)
    ]);
    targets.forEach(check=>{
      const barcode=String(check.barcode||"").trim();
      const normalItems=(Array.isArray(eventItems)?eventItems:[]).filter(row=>String(row?.barcode||"").trim()===barcode);
      const movements=(Array.isArray(movementRows)?movementRows:[]).filter(row=>String(row?.barcode||"").trim()===barcode);
      const sales=(Array.isArray(salesRows)?salesRows:[]).filter(row=>String(row?.barcode||"").trim()===barcode);
      const calculation=calculateSmaregiHistoricalEventShelfQty({normalItems,movements,sales},check.checked_at);
      result.set(getSmaregiHistoricalCheckKey(check),calculation);
    });
  }catch(error){
    console.warn("[Smaregi historical event reconstruction skipped]",error);
  }
  return result;
}

// Ver 2.37: reconstruct the shared event shelf by store + barcode.  The
// event id is retained only as an audit reference on each movement.
async function loadSmaregiHistoricalEventShelfReconstruction(checks,itemMap,storeCode){
  const targets=(checks||[]).filter(check=>{
    const item=itemMap.get(`${check.snapshot_id}::${check.barcode}`)||{};
    const hasSnapshot=[
      check.app_stock_at_check,
      check.event_shelf_stock_at_check,
      check.comparison_stock_at_check,
      check.smaregi_stock_at_check,
      check.difference_at_check
    ].every(value=>value!==null&&value!==undefined&&String(value).trim()!=="")
      && (check.snapshot_version===null||check.snapshot_version===undefined||Number(check.snapshot_version)>=2);
    const appStock=getSmaregiHistoricalNumericValue([check], ["actual_stock","app_stock_at_check"]);
    const smaregiStock=getSmaregiHistoricalNumericValue([check,item], ["smaregi_stock_at_check","smaregi_stock","stock_amount","stock_quantity"]);
    return !hasSnapshot&&appStock!==null&&smaregiStock!==null&&String(check.barcode||"").trim()!=="";
  });
  const result=new Map();
  if(!targets.length)return result;
  const barcodes=[...new Set(targets.map(check=>String(check.barcode||"").trim()).filter(Boolean))];
  const barcodeFilter=buildSmaregiInFilter(barcodes);
  if(!barcodeFilter)return result;

  let commonRows=[];
  try{
    const storeFilter=encodeURIComponent(String(storeCode||""));
    commonRows=await sbAll(`event_storage_movements?select=id,store_code,barcode,movement_type,quantity,memo,created_at&store_code=eq.${storeFilter}&barcode=in.(${barcodeFilter})&order=created_at.asc`,1000,50000);
  }catch(error){
    console.warn("[Smaregi shared event shelf history lookup failed]",error);
  }

  const currentStore=normalizeSmaregiStoreCodeForStorage(storeCode);
  const rowsByBarcode=new Map();
  (Array.isArray(commonRows)?commonRows:[]).forEach(row=>{
    const rowStore=normalizeSmaregiStoreCodeForStorage(row?.store_code||"");
    const barcode=String(row?.barcode||"").trim();
    if(!barcode||rowStore!==currentStore)return;
    const rows=rowsByBarcode.get(barcode)||[];
    rows.push(row);
    rowsByBarcode.set(barcode,rows);
  });

  const legacyTargets=targets.filter(check=>!rowsByBarcode.has(String(check.barcode||"").trim()));
  const legacy=legacyTargets.length
    ? await loadSmaregiLegacyHistoricalEventShelfReconstruction(legacyTargets,itemMap,storeCode)
    : new Map();

  targets.forEach(check=>{
    const key=getSmaregiHistoricalCheckKey(check);
    const barcode=String(check.barcode||"").trim();
    const rows=rowsByBarcode.get(barcode)||[];
    if(!rows.length){
      const fallback=legacy.get(key);
      result.set(key,fallback||{eventShelfStock:0,isReliable:true,reason:"no_shared_event_shelf_history"});
      return;
    }

    const checkedTime=new Date(check.checked_at||"").getTime();
    if(!Number.isFinite(checkedTime)){
      result.set(key,{eventShelfStock:null,isReliable:false,reason:"invalid_check_time"});
      return;
    }
    let stock=0;
    let isReliable=true;
    const seenIds=new Set();
    rows.forEach(row=>{
      const id=String(row?.id||"").trim();
      if(id&&seenIds.has(id))return;
      if(id)seenIds.add(id);
      const createdTime=getSmaregiHistoricalEventTime(row);
      if(createdTime===null){isReliable=false;return;}
      if(createdTime>checkedTime)return;
      const type=getSmaregiHistoricalMovementType(row);
      const quantity=Math.abs(Number(row?.quantity||0));
      if(!Number.isFinite(quantity)){isReliable=false;return;}
      if(type==="storage_in")stock+=quantity;
      else if(type==="storage_out")stock-=quantity;
      else if(type==="adjustment"){
        const match=String(row?.memo||"").match(/(-?\d+)\s*->\s*(-?\d+)/);
        if(!match){isReliable=false;return;}
        stock+=Number(match[2])-Number(match[1]);
      }
    });
    result.set(key,{
      eventShelfStock:Math.max(0,stock),
      isReliable,
      reason:isReliable?"shared_event_shelf_history":"incomplete_shared_event_shelf_history"
    });
  });
  return result;
}

function getSmaregiHistoricalStoreKey(check,item,snapshot){
  const reference=getSmaregiHistoricalStoreReference(check,item,snapshot);
  if(reference.storeId)return normalizeSmaregiStoreCodeForStorage(reference.storeId);
  if(reference.storeCode)return reference.storeCode;
  return `snapshot:${String(check?.snapshot_id||"unknown")}`;
}

function getSmaregiHistoricalSnapshotValues(check,item,snapshot,reconstructed=null){
  const appStock=getSmaregiHistoricalNumericValue([check],["app_stock_at_check"])
    ?? getSmaregiHistoricalNumericValue([check],["actual_stock"]);
  const eventShelfStock=getSmaregiHistoricalNumericValue([check],["event_shelf_stock_at_check"]);
  const comparisonStock=getSmaregiHistoricalNumericValue([check],["comparison_stock_at_check"]);
  const smaregiStock=getSmaregiHistoricalNumericValue([check],["smaregi_stock_at_check"])
    ?? getSmaregiHistoricalNumericValue([item],["smaregi_stock","stock_amount","stock_quantity"]);
  const savedDifference=getSmaregiHistoricalNumericValue([check],["difference"]);
  const snapshotDifference=getSmaregiHistoricalNumericValue([check],["difference_at_check"]);
  const snapshotVersion=getSmaregiHistoricalNumericValue([check],["snapshot_version"]);
  const hasSnapshot=[appStock,eventShelfStock,comparisonStock,smaregiStock,snapshotDifference]
    .every(value=>value!==null)
    && (snapshotVersion===null||snapshotVersion>=2);
  const difference=hasSnapshot ? snapshotDifference : null;
  const snapshotCalculation=hasSnapshot ? calculateInventoryDifference({
    aricoStock:appStock,
    eventNormalStock:eventShelfStock,
    smaregiStock
  }) : null;
  const isAutoNoIssue=hasSnapshot && (
    check?.is_auto_no_issue_at_check===true
    || String(check?.is_auto_no_issue_at_check||"").toLowerCase()==="true"
    || snapshotDifference===0
    || snapshotCalculation?.isNoIssue===true
  );
  const manualNoIssue=check?.is_manual_no_issue===true
    || String(check?.is_manual_no_issue||"").toLowerCase()==="true"
    || isSmaregiNoIssueCheck(check);
  if(!hasSnapshot&&appStock!==null&&smaregiStock!==null&&reconstructed?.isReliable===true){
    const calculation=calculateInventoryDifference({
      aricoStock:appStock,
      eventNormalStock:reconstructed.eventShelfStock,
      smaregiStock
    });
    return {
      appStock,
      eventShelfStock:reconstructed.eventShelfStock,
      comparisonStock:calculation.comparisonStock,
      smaregiStock,
      difference:calculation.difference,
      savedDifference,
      isAutoNoIssue:calculation.isNoIssue===true,
      manualNoIssue,
      isReliable:true,
      dataState:"event_history_reconstructed",
      storeKey:getSmaregiHistoricalStoreKey(check,item,snapshot),
      ...getSmaregiHistoricalStoreReference(check,item,snapshot),
      snapshotId:String(check?.snapshot_id||snapshot?.id||"")
    };
  }
  return {
    appStock,
    eventShelfStock,
    comparisonStock,
    smaregiStock,
    difference,
    savedDifference,
    isAutoNoIssue,
    manualNoIssue,
    isReliable:hasSnapshot,
    dataState:hasSnapshot ? "保存済みスナップショット" : "イベント棚在庫未保存",
    storeKey:getSmaregiHistoricalStoreKey(check,item,snapshot),
    ...getSmaregiHistoricalStoreReference(check,item,snapshot),
    snapshotId:String(check?.snapshot_id||snapshot?.id||"")
  };
}

function getSmaregiHistoricalGroupKey(row){
  const values=row?.snapshotValues||{};
  const barcode=String(row?.check?.barcode||row?.item?.barcode||"").trim();
  return `${values.storeKey||"unknown"}::${barcode}`;
}

function getSmaregiHistoricalRowsInRange(historical,range=getSmaregiDifferenceDateRange()){
  const groups=new Map();
  (historical||[]).forEach(row=>{
    if(!row?.check||!isInSmaregiDifferenceDateRange(row.check.checked_at,range))return;
    const key=getSmaregiHistoricalGroupKey(row);
    if(key.endsWith("::"))return;
    const current=groups.get(key)||{row:null,checkCount:0};
    current.checkCount+=1;
    const currentTime=new Date(row.check.checked_at||0).getTime();
    const previousTime=new Date(current.row?.check?.checked_at||0).getTime();
    if(!current.row||currentTime>previousTime||(currentTime===previousTime&&String(row.check.id||"")>String(current.row.check.id||""))){
      current.row=row;
    }
    groups.set(key,current);
  });
  return [...groups.values()]
    .filter(group=>group.row)
    .map(group=>({...group.row,checkCount:group.checkCount,groupKey:getSmaregiHistoricalGroupKey(group.row)}));
}

window.getSmaregiHistoricalRowsInRange=getSmaregiHistoricalRowsInRange;

async function loadSmaregiHistoricalDifferenceRows(){
  const storeCode=normalizeSmaregiStoreCodeForStorage(getSmaregiCurrentStoreCode());
  const context=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
  const currentStoreId=String(context?.storeId||context?.store_id||"").trim();
  const currentStoreKeys=new Set([storeCode,currentStoreId].filter(Boolean).map(value=>normalizeSmaregiStoreCodeForStorage(value)));
  const snapshots=await sbAll("smaregi_stock_snapshots?select=*&order=imported_at.desc",1000,50000).catch(()=>[]);
  const currentSnapshot=smaregiSnapshot
    || (snapshots||[]).find(snapshot=>getSmaregiSnapshotStoreCode(snapshot)===storeCode)
    || null;
  const currentSnapshotReference=getSmaregiHistoricalStoreReference({}, {}, currentSnapshot||{});
  if(currentSnapshotReference.storeId){
    currentStoreKeys.add(normalizeSmaregiStoreCodeForStorage(currentSnapshotReference.storeId));
  }
  const snapshotMap=new Map((snapshots||[]).map(snapshot=>[String(snapshot.id),snapshot]));
  const items=await sbAll("smaregi_stock_items?select=*",1000,50000);
  const itemMap=new Map(items.map(item=>[`${item.snapshot_id}::${item.barcode}`,item]));
  const checks=(await sbAll("smaregi_stock_checks?select=*&order=checked_at.desc",1000,50000)).filter(check=>{
    const snapshot=snapshotMap.get(String(check.snapshot_id));
    const item=itemMap.get(`${check.snapshot_id}::${check.barcode}`);
    const snapshotStoreCode=getSmaregiSnapshotStoreCode(snapshot);
    if(snapshotStoreCode)return snapshotStoreCode===storeCode;
    const rowStoreKey=getSmaregiHistoricalStoreKey(check,item,snapshot);
    return currentStoreKeys.size===0||currentStoreKeys.has(rowStoreKey);
  });
  const historicalReconstruction=await loadSmaregiHistoricalEventShelfReconstruction(
    checks,
    itemMap,
    storeCode
  );
  return checks.map(check=>{
    const snapshot=snapshotMap.get(String(check.snapshot_id));
    const item={
      ...(itemMap.get(`${check.snapshot_id}::${check.barcode}`)||{}),
      barcode:check.barcode,
      product_id:check.product_id ?? itemMap.get(`${check.snapshot_id}::${check.barcode}`)?.product_id,
      product_name:check.product_name ?? itemMap.get(`${check.snapshot_id}::${check.barcode}`)?.product_name,
      store_id:check.store_id ?? itemMap.get(`${check.snapshot_id}::${check.barcode}`)?.store_id
    };
    const snapshotValues=getSmaregiHistoricalSnapshotValues(
      check,
      item,
      snapshot,
      historicalReconstruction.get(getSmaregiHistoricalCheckKey(check))||null
    );
    const calculation=snapshotValues.difference===null ? null : {
      aricoStock:snapshotValues.appStock,
      eventNormalStock:snapshotValues.eventShelfStock,
      comparisonStock:snapshotValues.comparisonStock,
      smaregiStock:snapshotValues.smaregiStock,
      difference:snapshotValues.difference,
      isNoIssue:snapshotValues.isAutoNoIssue
    };
    const stockBreakdown={
      actualStock:snapshotValues.appStock,
      eventShelfStock:snapshotValues.eventShelfStock,
      comparisonStock:snapshotValues.comparisonStock,
      smaregiStock:snapshotValues.smaregiStock,
      difference:snapshotValues.difference,
      isNoIssue:snapshotValues.isAutoNoIssue,
      calculation,
      isHistoricalSnapshot:true
    };
    return {check,item,snapshot,snapshotValues,difference:snapshotValues.difference,stockBreakdown,calculation};
  });
}

async function smaregiHistoricalDifferenceCsvRows(){
  const range=getSmaregiDifferenceDateRange("smaregiDiffCsvFromDate","smaregiDiffCsvToDate");
  const historical=await loadSmaregiHistoricalDifferenceRows();
  const rows=[SMAREGI_DIFFERENCE_CSV_HEADER];
  getSmaregiHistoricalRowsInRange(historical,range).forEach(({check,item,snapshot,difference,calculation,snapshotValues})=>{
    const csvDifference=snapshotValues?.isReliable===false
      ? (snapshotValues.savedDifference===null ? "不明" : snapshotValues.savedDifference)
      : difference;
    if(!isSmaregiDifferenceCsvRow({check,item,difference:csvDifference,snapshotValues,calculation}))return;
    rows.push(buildSmaregiDifferenceCsvRow({
      check,
      item,
      snapshot,
      snapshotValues,
      calculation,
      difference:csvDifference
    }));
  });
  return rows;
}

async function exportSmaregiCheckCsv(differenceOnly=false){
  if(differenceOnly&&!isSmaregiManager()){
    showMessage("差異のみCSVはパスワード認証済みの管理者のみダウンロードできます。","err");
    return;
  }
  if(!differenceOnly&&!smaregiSnapshot){
    showMessage("出力するスマレジ在庫がありません。","err");
    return;
  }
  try{
    const rows=differenceOnly ? await smaregiHistoricalDifferenceCsvRows() : smaregiCsvRows(false);
    const today=new Date();
    const ymd=`${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
    downloadCsvFile(
      differenceOnly?`差異一覧${ymd}.csv`:"smaregi_stock_check_all.csv",
      rows,
      {excelTextColumns:[3]}
    );
    showMessage(`${differenceOnly?"差異のみ":"全体"}CSVを出力しました：${rows.length-1}件`,"ok");
  }catch(e){
    showMessage("差異CSV出力エラー。\n"+e.message,"err");
  }
}

async function refreshSmaregiChecksFromSupabase(){
  if(!smaregiSnapshot)return;
  const snapshotId=encodeURIComponent(smaregiSnapshot.id);
  smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
  await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
  renderSmaregiStockChecks();
}

async function runWithSmaregiAutoRefreshPaused(task,{button=null,refresh=true}={}){
  if(smaregiMutationBusy)return false;
  smaregiMutationBusy=true;
  if(button)button.disabled=true;
  stopSmaregiAutoRefresh();
  try{
    while(smaregiAutoRefreshBusy){
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return await task();
  }finally{
    try{
      if(refresh&&smaregiSnapshot)await refreshSmaregiChecksFromSupabase();
    }catch(e){
      console.warn("[Smaregi Mutation Refresh Error]",e);
      showMessage("最新状態の再取得エラー。\n"+e.message,"err");
    }
    smaregiMutationBusy=false;
    if(button)button.disabled=false;
    if(!el("smaregiStockCheckCard")?.hidden)startSmaregiAutoRefresh();
  }
}

async function refreshSmaregiCheckStateSilently(){
  const smaregiVisible=!el("smaregiStockCheckCard")?.hidden;
  if(smaregiMutationBusy||smaregiAutoRefreshBusy||!smaregiSnapshot||!smaregiVisible)return;
  smaregiAutoRefreshBusy=true;
  const focused=smaregiVisible ? getFocusedSmaregiInputState() : null;
  try{
    await refreshSmaregiChecksFromSupabase();
    restoreFocusedSmaregiInputState(focused);
    if(!el("smaregiAccuracyPanel")?.hidden)await loadSmaregiAccuracy();
    console.log("[Smaregi Auto Refresh]",getSmaregiStats());
  }catch(e){
    console.warn("[Smaregi Auto Refresh Error]",e);
    showMessage("自動更新エラー。\n"+e.message,"err");
  }finally{
    smaregiAutoRefreshBusy=false;
  }
}

function startSmaregiAutoRefresh(){
  stopSmaregiAutoRefresh();
  smaregiAutoRefreshTimer=setInterval(refreshSmaregiCheckStateSilently,5000);
}

function stopSmaregiAutoRefresh(){
  if(smaregiAutoRefreshTimer){
    clearInterval(smaregiAutoRefreshTimer);
    smaregiAutoRefreshTimer=null;
  }
}

/* CSV operation mode: Smaregi stock APIs are disabled. */
function showCsvOperationMessage(message){
  const text=message||"現在はCSV運用中です。スマレジAPIには接続しません。";
  showMessage(text,"ok");
  if(typeof showPopup==="function")showPopup("API停止中／CSV運用中",text);
}

function pickSmaregiCsvValue(row,keys){
  for(const key of keys){
    const normalized=typeof normalizeHeader==="function" ? normalizeHeader(key) : String(key||"").toLowerCase();
    if(row[normalized]!==undefined&&row[normalized]!==null&&String(row[normalized]).trim()!=="")return String(row[normalized]).trim();
  }
  return "";
}

function smaregiStockCsvToItems(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
  const headers=parsed[0].map(header=>typeof normalizeHeader==="function" ? normalizeHeader(header) : String(header||"").trim().toLowerCase());
  const items=[];
  for(let i=1;i<parsed.length;i++){
    const row={};
    headers.forEach((header,index)=>{row[header]=String(parsed[i][index]??"").trim();});
    const barcode=pickSmaregiCsvValue(row,["barcode","バーコード","JAN","JANコード","商品コード","品番"]);
    const productName=pickSmaregiCsvValue(row,["product_name","productName","name","商品名","品名"]);
    const stockRaw=pickSmaregiCsvValue(row,["smaregi_stock","stock","在庫","現在庫","在庫数","数量"]).replace(/,/g,"");
    if(!barcode&&!productName)continue;
    if(!barcode)throw new Error(`${i+1}行目：バーコードまたは商品コードが空です。`);
    const smaregiStock=Number(stockRaw||0);
    if(!Number.isFinite(smaregiStock))throw new Error(`${i+1}行目：在庫数が数値ではありません。`);
    items.push({
      barcode,
      product_name:productName,
      smaregi_stock:smaregiStock
    });
  }
  if(!items.length)throw new Error("取込対象の在庫変動データがありません。");
  return items;
}

async function importSmaregiStockCsvFile(file){
  try{
    if(!(typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess())){
      showMessage("スマレジ在庫変動CSV取込は管理者のみ操作できます。","err");
      return;
    }
    if(!file)return;
    showMessage("スマレジ在庫変動CSVを取込中...");
    const text=decodeCsvBuffer(await file.arrayBuffer());
    const items=smaregiStockCsvToItems(text);
    const snapshotId=(typeof crypto!=="undefined"&&crypto.randomUUID) ? crypto.randomUUID() : `csv-${Date.now()}`;
    const now=new Date().toISOString();
    await sb("smaregi_stock_snapshots",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        id:snapshotId,
        imported_at:now,
        range_from:null,
        completed_at:now
      })
    });
    for(let i=0;i<items.length;i+=500){
      await sb("smaregi_stock_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(items.slice(i,i+500).map(item=>({
          snapshot_id:snapshotId,
          barcode:item.barcode,
          product_name:item.product_name,
          smaregi_stock:getSavedSmaregiStockNumber(item,0)
        })))
      });
    }
    await loadLatestSmaregiSnapshot();
    showMessage(`スマレジ在庫変動CSVを取込ました：${items.length}件（API通信なし）`,"ok");
  }catch(e){
    showMessage("スマレジ在庫変動CSV取込エラー。\n"+e.message,"err");
  }finally{
    const input=el("smaregiStockCsvFile");
    if(input)input.value="";
  }
}

async function syncSmaregiStockFromApi(){
  showCsvOperationMessage("現在はCSV運用中です。スマレジAPIには接続しません。スマレジ在庫変動CSVを選択してください。");
  const input=el("smaregiStockCsvFile");
  if(input){
    input.value="";
    input.click();
  }
}

async function adjustEquipmentTransferSmaregiStock(){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
}

async function reverseEquipmentTransferSmaregiStock(){
  return {ok:false,disabled:true,mode:"csv",message:"API停止中／CSV運用中"};
}

function showEquipmentTransferConfirmPopup({log,product,quantity,checkedBy,onOk}){
  const popup=document.createElement("div");
  popup.className="app-popup app-confirm-popup";
  popup.style.display="flex";
  popup.innerHTML=`<div class="app-popup-card">
    <div class="app-popup-title">商品転用確認</div>
    <div class="app-popup-body">現在はCSV運用中です。スマレジAPIには接続せず、アプリ内の商品転用確認だけを行います。
商品名：${esc(product?.name||log?.product_name||"-")}
棚番：${esc(getProductShelfLabel(product))}
バーコード：${esc(log?.barcode||product?.barcode||"-")}
数量：${esc(quantity)}
担当者：${esc(checkedBy)}

スマレジ在庫は自動変更されません。</div>
    <div class="app-confirm-actions">
      <button type="button" class="secondary app-equipment-transfer-cancel-btn">キャンセル</button>
      <button type="button" class="app-equipment-transfer-ok-btn">確認する</button>
    </div>
  </div>`;
  const close=()=>{try{document.body.removeChild(popup);}catch(_){}};
  popup.querySelector(".app-equipment-transfer-cancel-btn")?.addEventListener("click",close);
  popup.querySelector(".app-equipment-transfer-ok-btn")?.addEventListener("click",()=>{close();onOk();});
  popup.addEventListener("click",event=>{if(event.target===popup)close();});
  document.body.appendChild(popup);
}

async function executeEquipmentTransferConfirmation({log,product=null,quantity,checkedBy,button}){
  const logId=String(log?.id||"").trim();
  let latestLog=null;
  let productUpdated=false;
  let currentStock=null;
  await runWithSmaregiAutoRefreshPaused(async()=>{
    try{
      const latestRows=await sb(`inventory_logs?select=*&id=eq.${encodeURIComponent(logId)}&limit=1`);
      latestLog=Array.isArray(latestRows)&&latestRows[0] ? latestRows[0] : null;
      if(!latestLog)throw new Error(`商品転用履歴が見つかりません。inventory_logs.id=${logId}`);
      if(isEquipmentTransferChecked(latestLog))throw new Error("この商品転用は確認済みです。");
      const type=String(latestLog.type||"");
      if(type!=="備品転用"&&type!=="equipment_transfer")throw new Error("商品転用の履歴ではありません。");
      quantity=Number(latestLog.quantity||quantity||0);
      if(!Number.isInteger(quantity)||quantity<=0)throw new Error("数量は1以上で入力してください。");
      product=product || await fetchProductByBarcode(latestLog.barcode);
      if(!product)throw new Error("商品が見つかりません。");
      currentStock=Number(product.base_stock||0);
      const nextStock=currentStock-quantity;
      if(nextStock<0)throw new Error(`在庫不足：${product.name} / 現在庫 ${currentStock} / 商品転用数 ${quantity}`);
      await updateProductCurrentStock(latestLog.barcode,nextStock);
      productUpdated=true;
      const equipment_checked_at=new Date().toISOString();
      const patchPayload={
        type:"equipment_transfer",
        equipment_checked:true,
        equipment_checked_by:checkedBy,
        equipment_checked_at,
        affects_smaregi:false,
        smaregi_delta:0,
        memo:latestLog.memo||""
      };
      const patchedRows=await sb(`inventory_logs?id=eq.${encodeURIComponent(logId)}&select=*`,{
        method:"PATCH",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify(patchPayload)
      });
      const refreshedLog=Array.isArray(patchedRows)&&patchedRows[0] ? patchedRows[0] : null;
      if(!refreshedLog)throw new Error(`商品転用履歴を更新できませんでした。inventory_logs.id=${logId}`);
      const displayLog={...refreshedLog,type:"備品転用"};
      equipmentTransferLogCache.set(logId,displayLog);
      replaceEquipmentConfirmationDom(logId,displayLog);
      logs=(logs||[]).some(item=>String(item.id)===String(logId))
        ? logs.map(item=>String(item.id)===String(logId) ? displayLog : item)
        : [displayLog,...logs];
      showMessage(`商品転用を確認しました：${product.name} / 数量 ${quantity}（API通信なし）`,"ok");
      showPopup("商品転用完了",`商品名：${product.name}\n棚番：${getProductShelfLabel(product)}\nバーコード：${latestLog.barcode}\n数量：${quantity}\n現在庫：${nextStock}\nスマレジ在庫：自動変更なし（CSV運用中）`);
      renderGlobalHistory();
      if(selectedBarcode)await showProductHistoryForBarcode(selectedBarcode,displayLog);
      replaceEquipmentConfirmationDom(logId,displayLog);
      if(typeof renderSmaregiDiffOnlyPanel==="function")renderSmaregiDiffOnlyPanel();
    }catch(e){
      if(productUpdated&&product&&latestLog?.barcode){
        try{await updateProductCurrentStock(latestLog.barcode,currentStock);}catch(_){}
      }
      showMessage("商品転用確認エラー。\n"+e.message,"err");
    }
  },{button});
}

/* CSV operation mode: Smaregi stock movement import. */
let smaregiLatestChangeByBarcode=new Map();

function normalizeSmaregiMovementDate(value){
  const text=String(value||"").trim();
  if(!text)return new Date().toISOString();
  const normalized=text
    .replace(/\//g,"-")
    .replace(" ","T")
    .replace(/年|月/g,"-")
    .replace(/日/g,"")
    .replace(/時/g,":")
    .replace(/分/g,":")
    .replace(/秒/g,"");
  const date=new Date(normalized);
  if(Number.isNaN(date.getTime()))return new Date().toISOString();
  return date.toISOString();
}

function smaregiMovementKey(row){
  const identity=String(row.barcode||row.product_code||row.product_name||"").trim();
  const changedAt=String(row.changed_at||row.movement_datetime||row.updated_at_from_csv||"").trim();
  const amount=String(row.amount??row.movement_quantity??"").trim();
  const storeStock=String(row.stock_amount??row.smaregi_stock_quantity??row.tokyo_stock??row.aichi_stock??"").trim();
  return [identity,changedAt,amount,storeStock].join("|");
/*
  return [
    String(row.barcode||""),
    String(row.changed_at||""),
    String(row.stock_division||""),
    String(row.amount||""),
    String(row.stock_amount||""),
    String(row.memo||"")
  ].join("|");
*/
}

function smaregiStableHash(value){
  const text=String(value||"");
  let hash=2166136261;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(36);
}

function buildSmaregiCsvChangeId(change){
  const identity=String(change.barcode||change.product_code||change.product_name||"").trim();
  const raw=[
    identity,
    String(change.changed_at||"").trim(),
    String(change.amount||"").trim(),
    String(change.stock_amount??change.smaregi_stock_quantity??change.tokyo_stock??change.aichi_stock??"").trim(),
    String(change.stock_division||"").trim(),
    String(change.memo||"").trim()
  ].join("|");
  return `csv_${smaregiStableHash(raw)}`;
}

function smaregiMovementCsvToChanges(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
  const headers=parsed[0].map(header=>typeof normalizeHeader==="function" ? normalizeHeader(header) : String(header||"").trim().toLowerCase());
  const changes=[];
  for(let i=1;i<parsed.length;i++){
    const row={};
    headers.forEach((header,index)=>{row[header]=String(parsed[i][index]??"").trim();});
    const barcode=pickSmaregiCsvValue(row,["barcode","バーコード","JAN","JANコード","商品コード","品番","product_code","productcode"]);
    const productName=pickSmaregiCsvValue(row,["product_name","productName","name","商品名","品名"]);
    const changedAt=normalizeSmaregiMovementDate(pickSmaregiCsvValue(row,["changed_at","changedAt","movement_datetime","movementdatetime","日時","処理日時","変動日時","更新日時","日付"]));
    const stockDivision=pickSmaregiCsvValue(row,["stock_division","stockDivision","movement_type","movementtype","区分","変動区分","処理区分","理由","変動理由"]);
    const amountRaw=pickSmaregiCsvValue(row,["amount","movement_quantity","movementquantity","変動数","数量","増減数","移動数"]).replace(/,/g,"");
    const stockRaw=pickSmaregiCsvValue(row,["stock_amount","stockAmount","quantity_after","quantityafter","在庫数","処理後在庫","現在庫","変動後在庫"]).replace(/,/g,"");
    const memo=pickSmaregiCsvValue(row,["memo","備考","メモ","理由メモ","コメント"]);
    if(!barcode&&!productName)continue;
    if(!barcode)throw new Error(`${i+1}行目：バーコードまたは商品コードが空です。`);
    const amount=Number(amountRaw||0);
    const stockAmount=Number(stockRaw||0);
    if(!Number.isFinite(amount))throw new Error(`${i+1}行目：変動数が数値ではありません。`);
    if(!Number.isFinite(stockAmount))throw new Error(`${i+1}行目：処理後在庫が数値ではありません。`);
    changes.push({
      barcode,
      product_name:productName,
      changed_at:changedAt,
      stock_division:stockDivision,
      amount,
      stock_amount:stockAmount,
      memo
    });
  }
  if(!changes.length)throw new Error("取込対象の在庫変動データがありません。");
  return changes;
}

function latestSmaregiChangesByBarcode(changes){
  const map=new Map();
  (changes||[]).forEach(change=>{
    const barcode=String(change.barcode||"").trim();
    if(!barcode)return;
    const current=map.get(barcode);
    if(!current||new Date(change.changed_at||0)>new Date(current.changed_at||0)){
      map.set(barcode,change);
    }
  });
  return map;
}

function smaregiMovementCsvToChanges(text){
  const parsed=parseCsv(text);
  if(parsed.length<2)throw new Error("CSVにデータ行がありません。");
  const headers=parsed[0].map(header=>typeof normalizeHeader==="function" ? normalizeHeader(header) : String(header||"").trim().toLowerCase());
  const changes=[];
  for(let i=1;i<parsed.length;i++){
    const row={};
    headers.forEach((header,index)=>{row[header]=String(parsed[i][index]??"").trim();});
    const barcode=pickSmaregiCsvValue(row,["barcode","バーコード","JAN","JANコード"]);
    const productCode=pickSmaregiCsvValue(row,["product_code","productcode","商品コード","品番","code"]);
    const productName=pickSmaregiCsvValue(row,["product_name","productName","name","商品名","品名"]);
    const changedAt=normalizeSmaregiMovementDate(pickSmaregiCsvValue(row,["changed_at","changedAt","movement_datetime","movementdatetime","日時","処理日時","変動日時","更新日時","日付"]));
    const stockDivision=pickSmaregiCsvValue(row,["stock_division","stockDivision","movement_type","movementtype","区分","変動区分","処理区分","理由","変動理由"]);
    const amountRaw=pickSmaregiCsvValue(row,["amount","movement_quantity","movementquantity","変動数","数量","増減数","移動数"]).replace(/,/g,"");
    const stockRaw=pickSmaregiCsvValue(row,["stock_amount","stockAmount","quantity_after","quantityafter","在庫数","処理後在庫","現在庫","変動後在庫"]).replace(/,/g,"");
    const memo=pickSmaregiCsvValue(row,["memo","備考","メモ","理由メモ","コメント"]);
    const productIdentity=String(barcode||productCode||productName||"").trim();
    if(!productIdentity)continue;
    const amount=Number(amountRaw||0);
    const stockAmount=Number(stockRaw||0);
    if(!Number.isFinite(amount))throw new Error(`${i+1}行目：変動数が数値ではありません。`);
    if(!Number.isFinite(stockAmount))throw new Error(`${i+1}行目：処理後在庫が数値ではありません。`);
    const change={
      barcode:productIdentity,
      product_code:productCode,
      product_name:productName,
      changed_at:changedAt,
      stock_division:stockDivision,
      amount,
      stock_amount:stockAmount,
      memo
    };
    change.smaregi_change_id=buildSmaregiCsvChangeId(change);
    changes.push(change);
  }
  if(!changes.length)throw new Error("取込対象の在庫変動データがありません。");
  return changes;
}

function dedupeSmaregiMovementChanges(changes,existingKeys=new Set()){
  const seen=new Set();
  const unique=[];
  const duplicates=[];
  (changes||[]).forEach(change=>{
    const key=smaregiMovementKey(change);
    if(existingKeys.has(key)||seen.has(key)){
      duplicates.push(change);
      return;
    }
    seen.add(key);
    unique.push(change);
  });
  return {unique,duplicates};
}

async function importSmaregiStockCsvFile(file){
  try{
    if(!(typeof hasInventoryPrivilegedAccess==="function"&&hasInventoryPrivilegedAccess())){
      showMessage("スマレジ在庫変動CSV取込は管理者のみ操作できます。","err");
      return;
    }
    if(!file)return;
    showMessage("スマレジ在庫変動CSVを取込中...");
    const text=decodeCsvBuffer(await file.arrayBuffer());
    const changes=smaregiMovementCsvToChanges(text);
    const existing=await sbAll("smaregi_stock_changes?select=smaregi_change_id,barcode,changed_at,stock_division,amount,stock_amount,memo",1000,50000).catch(()=>[]);
    const existingKeys=new Set((existing||[]).map(smaregiMovementKey));
    const deduped=dedupeSmaregiMovementChanges(changes,existingKeys);
    const newChanges=deduped.unique;
    const duplicateCount=deduped.duplicates.length;
    const errorCount=0;
    const snapshotId=(typeof crypto!=="undefined"&&crypto.randomUUID) ? crypto.randomUUID() : `csv-movement-${Date.now()}`;
    const now=new Date().toISOString();
    const previousSnapshots=await sb("smaregi_stock_snapshots?select=completed_at&order=imported_at.desc&limit=1").catch(()=>[]);
    const previousCompletedAt=Array.isArray(previousSnapshots)&&previousSnapshots[0]?.completed_at ? previousSnapshots[0].completed_at : null;
    await sb("smaregi_stock_snapshots",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        id:snapshotId,
        imported_at:now,
        range_from:previousCompletedAt,
        completed_at:previousCompletedAt
      })
    });
    for(let i=0;i<newChanges.length;i+=500){
      await sb("smaregi_stock_changes",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(newChanges.slice(i,i+500).map(change=>({
          smaregi_change_id:change.smaregi_change_id||buildSmaregiCsvChangeId(change),
          snapshot_id:snapshotId,
          barcode:change.barcode,
          changed_at:change.changed_at,
          stock_division:change.stock_division,
          amount:change.amount,
          stock_amount:change.stock_amount,
          memo:change.memo
        })))
      });
    }
    const uniqueDisplayChanges=dedupeSmaregiMovementChanges(changes,new Set()).unique;
    const latestMap=latestSmaregiChangesByBarcode(uniqueDisplayChanges);
    const latestItems=[...latestMap.values()].map(change=>({
      snapshot_id:snapshotId,
      barcode:change.barcode,
      product_name:change.product_name,
      smaregi_stock:change.stock_amount
    }));
    for(let i=0;i<latestItems.length;i+=500){
      await sb("smaregi_stock_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(latestItems.slice(i,i+500))
      });
    }
    await loadLatestSmaregiSnapshot();
    showMessage(`\u30b9\u30de\u30ec\u30b8\u5728\u5eab\u5909\u52d5CSV\u3092\u53d6\u8fbc\u307e\u3057\u305f\uff1a\u53d6\u8fbc ${changes.length}\u4ef6 / \u65b0\u898f ${newChanges.length}\u4ef6 / \u91cd\u8907\u9664\u5916 ${duplicateCount}\u4ef6 / \u30a8\u30e9\u30fc ${errorCount}\u4ef6\uff08API\u901a\u4fe1\u306a\u3057\uff09`,"ok");
    if(typeof showPopup==="function")showPopup("\u30b9\u30de\u30ec\u30b8\u5728\u5eab\u5909\u52d5CSV\u53d6\u8fbc\u5b8c\u4e86",`\u53d6\u8fbc\u4ef6\u6570\uff1a${changes.length}\u4ef6\n\u65b0\u898f\u4ef6\u6570\uff1a${newChanges.length}\u4ef6\n\u91cd\u8907\u9664\u5916\u4ef6\u6570\uff1a${duplicateCount}\u4ef6\n\u30a8\u30e9\u30fc\u4ef6\u6570\uff1a${errorCount}\u4ef6`);
    return;
    showMessage(`スマレジ在庫変動CSVを取込ました：代表商品 ${latestItems.length}件 / 新規変動 ${newChanges.length}件（API通信なし）`,"ok");
  }catch(e){
    showMessage("スマレジ在庫変動CSV取込エラー。\n"+e.message,"err");
  }finally{
    const input=el("smaregiStockCsvFile");
    if(input)input.value="";
  }
}

async function loadLatestSmaregiSnapshot(){
  try{
    showMessage("スマレジ在庫変動データを取得中...");
    const snapshots=await sb("smaregi_stock_snapshots?select=*&order=imported_at.desc&limit=1");
    smaregiSnapshot=Array.isArray(snapshots)&&snapshots.length ? snapshots[0] : null;
    const resetInput=el("resetSmaregiCompletedAtInput");
    if(resetInput)resetInput.value=smaregiSnapshot?.completed_at ? formatDateTimeLocal(smaregiSnapshot.completed_at) : "";
    smaregiStockItems=[];
    smaregiStockChecks=[];
    smaregiLatestChangeByBarcode=new Map();
    if(smaregiSnapshot){
      const snapshotId=encodeURIComponent(smaregiSnapshot.id);
      smaregiStockItems=await sbAll(`smaregi_stock_items?select=*&snapshot_id=eq.${snapshotId}&order=product_name.asc`,1000,20000);
      smaregiStockChecks=await sbAll(`smaregi_stock_checks?select=*&snapshot_id=eq.${snapshotId}&order=checked_at.desc`,1000,20000);
      const latestChanges=await sbAll(`smaregi_stock_changes?select=*&snapshot_id=eq.${snapshotId}&order=changed_at.desc`,1000,50000).catch(()=>[]);
      smaregiLatestChangeByBarcode=latestSmaregiChangesByBarcode(latestChanges);
      await fetchProductsByBarcodes(smaregiStockItems.map(item=>item.barcode));
      await loadSmaregiEventInventoryCache(smaregiStockItems.map(item=>item.barcode));
    }else{
      smaregiCurrentEventStockByBarcode=new Map();
      smaregiEventStorageStockByBarcode=new Map();
      smaregiEventInventoryStoreCode="";
    }
    renderSmaregiStockChecks();
    showMessage(smaregiSnapshot
      ? `スマレジ在庫変動データを取得しました：${smaregiStockItems.length}件`
      : "スマレジ在庫変動データはまだありません。在庫変動CSVを取り込んでください。",smaregiSnapshot?"ok":"");
  }catch(e){
    showMessage("スマレジ在庫変動データ取得エラー。\n"+e.message,"err");
  }
}

function getSmaregiMovementSummaryHtml(item){
  const change=smaregiLatestChangeByBarcode.get(String(item.barcode||""));
  if(!change)return `<div class="smaregi-movement-note">最終変動：CSV内に変動履歴なし</div>`;
  return `<div class="smaregi-movement-note">
    <span>最終変動：${esc(fmt(change.changed_at))}</span>
    <span>変動数：${Number(change.amount||0)}</span>
    <span>理由：${esc(change.stock_division||"-")}</span>
    <span>備考：${esc(change.memo||"")}</span>
  </div>`;
}

async function syncSmaregiStockFromApi(){
  showCsvOperationMessage("現在はCSV運用中です。スマレジAPIには接続しません。スマレジ在庫変動CSVを選択してください。");
  const input=el("smaregiStockCsvFile");
  if(input){
    input.value="";
    input.click();
  }
}
