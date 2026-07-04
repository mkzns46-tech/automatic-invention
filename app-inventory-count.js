/* ARICO TOKYO inventory app: app-inventory-count.js */
(function(){
  "use strict";

  const STORAGE_KEY="arico_app_inventory_count_v1";
  const state={
    active:false,
    startedAt:null,
    finishedAt:null,
    staff:"",
    counted:new Map(),
    csvRows:[],
    csvHeaderInfo:null,
    diffs:[],
    unmatched:[]
  };

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

  function getStaffValue(){
    return String(document.getElementById("appInventoryCountStaff")?.value||"").trim();
  }

  function serialize(){
    return {
      active:state.active,
      startedAt:state.startedAt,
      finishedAt:state.finishedAt,
      staff:state.staff,
      counted:[...state.counted.values()]
    };
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(serialize()));
  }

  function loadState(){
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
      state.active=!!saved.active;
      state.startedAt=saved.startedAt||null;
      state.finishedAt=saved.finishedAt||null;
      state.staff=saved.staff||"";
      state.counted=new Map((saved.counted||[]).map(row=>[String(row.barcode),row]));
    }catch(_){}
  }

  function renderStaffSelect(){
    const select=document.getElementById("appInventoryCountStaff");
    if(!select)return;
    const current=select.value||state.staff||localStorage.getItem("arico_current_staff_name")||"";
    const staffLabel=member=>typeof getStaffDisplayName==="function" ? getStaffDisplayName(member) : (member.name||"");
    select.innerHTML='<option value="">担当者を選択</option>'+((window.staffMembers||staffMembers||[]).map(member=>`<option value="${safe(staffLabel(member))}">${safe(staffLabel(member))}</option>`).join(""));
    if(current)select.value=current;
  }

  function setMessage(id,text,type=""){
    const node=document.getElementById(id);
    if(!node)return;
    node.textContent=text;
    node.className=`message${type?` ${type}`:""}`;
  }

  function renderStatus(){
    const badge=document.getElementById("appInventoryCountStatus");
    if(!badge)return;
    badge.className=`badge ${state.active?"":"muted"}`;
    if(state.active)badge.textContent=`棚卸中 ${state.counted.size}件`;
    else if(state.finishedAt)badge.textContent=`終了 ${state.counted.size}件`;
    else badge.textContent="未開始";
  }

  function renderCountedRows(){
    const body=document.getElementById("appInventoryCountBody");
    const summary=document.getElementById("appInventoryCountSummary");
    if(summary)summary.textContent=`${state.counted.size}件`;
    if(!body)return;
    const rows=[...state.counted.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
    body.innerHTML=rows.length ? rows.map(row=>`
      <tr>
        <td>${safe(row.name)}</td>
        <td>${safe(row.productCode||row.barcode)}</td>
        <td>${safe(row.barcode)}</td>
        <td>${safe(row.count)}</td>
        <td>${safe(row.appStock)}</td>
        <td>${row.updatedAt&&typeof fmt==="function" ? safe(fmt(row.updatedAt)) : safe(row.updatedAt||"")}</td>
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
        <td><button type="button" class="app-count-update-btn" data-barcode="${safe(row.barcode)}">更新</button></td>
      </tr>`).join("") : '<tr><td colspan="7" class="app-count-empty">差異のあるカウント済み商品はありません。</td></tr>';
    body.querySelectorAll(".app-count-update-btn").forEach(button=>{
      button.onclick=()=>updateCountedProductStock(button.dataset.barcode,button);
    });
  }

  window.renderAppInventoryCount=function(){
    loadState();
    renderStaffSelect();
    const staff=document.getElementById("appInventoryCountStaff");
    if(staff&&state.staff)staff.value=state.staff;
    renderStatus();
    renderCountedRows();
    renderDiffRows();
  };

  function requireSession(){
    if(!state.active){
      setMessage("appInventoryCountProductInfo","棚卸開始を押してからカウントしてください。","err");
      return false;
    }
    return true;
  }

  function startCount(){
    const staff=getStaffValue();
    if(!staff){
      setMessage("appInventoryCountProductInfo","担当者を選択してください。","err");
      document.getElementById("appInventoryCountStaff")?.focus();
      return;
    }
    if(state.counted.size&&!confirm("現在のカウントをクリアして新しい棚卸を開始しますか？"))return;
    state.active=true;
    state.startedAt=nowIso();
    state.finishedAt=null;
    state.staff=staff;
    state.counted.clear();
    state.csvRows=[];
    state.csvHeaderInfo=null;
    state.diffs=[];
    state.unmatched=[];
    saveState();
    setMessage("appInventoryCountProductInfo","棚卸を開始しました。商品をスキャンまたは検索してください。","ok");
    renderAppInventoryCount();
  }

  function finishCount(){
    if(!state.active&&state.finishedAt){
      setMessage("appInventoryCountCsvInfo","棚卸は終了済みです。CSVを読み込んで比較してください。","ok");
      return;
    }
    if(!state.counted.size){
      setMessage("appInventoryCountProductInfo","カウント済み商品がありません。","err");
      return;
    }
    state.active=false;
    state.finishedAt=nowIso();
    state.staff=getStaffValue()||state.staff;
    saveState();
    setMessage("appInventoryCountCsvInfo","棚卸を終了しました。スマレジ在庫一覧CSVを読み込んでください。","ok");
    renderAppInventoryCount();
  }

  async function findProductsByName(keyword){
    keyword=String(keyword||"").trim();
    if(!keyword)return [];
    const rows=await sbAll(`products?select=*&name=ilike.*${encodeURIComponent(keyword)}*&order=name.asc`,1000,30).catch(()=>[]);
    rows.forEach(row=>{if(row&&!gp(row.barcode))products.push(row);});
    return rows||[];
  }

  async function previewBarcode(){
    const barcode=String(document.getElementById("appInventoryCountBarcode")?.value||"").trim();
    if(!barcode){
      setMessage("appInventoryCountProductInfo",state.active?"商品をスキャンまたは検索してください。":"棚卸開始後、商品をスキャンまたは検索してください。");
      return null;
    }
    const product=await fetchProductByBarcode(barcode);
    if(!product){
      setMessage("appInventoryCountProductInfo",`未登録バーコード：${barcode}`,"err");
      return null;
    }
    setMessage("appInventoryCountProductInfo",`商品名：${product.name} / 現在庫：${Number(product.base_stock||0)}`,"ok");
    return product;
  }

  async function saveCount(){
    if(!requireSession())return;
    const product=await previewBarcode();
    if(!product)return;
    const qty=Number(document.getElementById("appInventoryCountQty")?.value||0);
    if(!Number.isInteger(qty)||qty<0){
      setMessage("appInventoryCountProductInfo","カウント数は0以上の整数で入力してください。","err");
      return;
    }
    const barcode=String(product.barcode||"");
    const row={
      barcode,
      productCode:barcode,
      productId:String(product.smaregi_product_id||""),
      name:product.name||"",
      count:qty,
      appStock:Number(product.base_stock||0),
      updatedAt:nowIso()
    };
    state.counted.set(barcode,row);
    state.diffs=[];
    state.unmatched=[];
    saveState();
    document.getElementById("appInventoryCountBarcode").value="";
    document.getElementById("appInventoryCountQty").value="1";
    setMessage("appInventoryCountProductInfo",`カウント保存：${row.name} / ${qty}`,"ok");
    renderCountedRows();
    renderDiffRows();
    document.getElementById("appInventoryCountBarcode")?.focus();
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
      missing:[
        map.barcode<0?"バーコード(JAN)":null
      ].filter(Boolean)
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
    if(state.active){
      setMessage("appInventoryCountCsvInfo","棚卸終了後に比較してください。","err");
      return;
    }
    if(!state.counted.size){
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
    state.counted.forEach(counted=>{
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
    setMessage("appInventoryCountCsvInfo",`比較完了：差異 ${state.diffs.length}件 / CSV該当なし ${state.unmatched.length}件。未カウント商品とCSVだけの商品は対象外です。`,"ok");
    renderDiffRows();
  }

  async function updateCountedProductStock(barcode,button){
    const row=state.diffs.find(item=>String(item.barcode)===String(barcode));
    if(!row)return;
    const staff=getStaffValue()||state.staff;
    if(!staff){
      setMessage("appInventoryCountCsvInfo","担当者を選択してください。","err");
      return;
    }
    const product=await fetchProductByBarcode(row.barcode);
    if(!product){
      setMessage("appInventoryCountCsvInfo",`商品が見つかりません：${row.barcode}`,"err");
      return;
    }
    const before=Number(product.base_stock||0);
    const after=Number(row.count||0);
    const diff=after-before;
    const ok=confirm(`この商品だけアプリ在庫を更新します。\n\n商品名：${row.name}\n商品コード：${row.productCode}\n更新前在庫：${before}\n更新後在庫：${after}\n差分：${diff}\n\n実行しますか？`);
    if(!ok)return;
    try{
      if(button)button.disabled=true;
      await updateProductCurrentStock(row.barcode,after);
      const memo=`アプリ内棚卸 Ver.1 / 更新前:${before} / 更新後:${after} / スマレジ在庫:${row.smaregiStock} / 商品コード:${row.productCode}`;
      const inserted=await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"在庫修正",
          staff,
          barcode:row.barcode,
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
          barcode:row.barcode,
          product_name:row.name,
          quantity:diff,
          memo
        });
      }catch(_){}
      const counted=state.counted.get(row.barcode);
      if(counted)counted.appStock=after;
      state.diffs=state.diffs.filter(item=>String(item.barcode)!==String(row.barcode));
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
    host.innerHTML=rows.length ? rows.slice(0,20).map(row=>`<button type="button" class="product-search-result" data-barcode="${safe(row.barcode)}"><strong>${safe(row.name)}</strong><small>バーコード：${safe(row.barcode)} / 現在庫：${Number(row.base_stock||0)}</small></button>`).join("") : '<div class="product-search-empty">該当商品がありません。</div>';
    host.querySelectorAll(".product-search-result").forEach(button=>{
      button.onclick=async ()=>{
        document.getElementById("appInventoryCountBarcode").value=button.dataset.barcode||"";
        host.innerHTML="";
        await previewBarcode();
        document.getElementById("appInventoryCountQty")?.focus();
      };
    });
  }

  function bindAppInventoryCountEvents(){
    document.getElementById("startAppInventoryCountBtn")?.addEventListener("click",startCount);
    document.getElementById("finishAppInventoryCountBtn")?.addEventListener("click",finishCount);
    document.getElementById("saveAppInventoryCountBtn")?.addEventListener("click",saveCount);
    document.getElementById("compareAppInventoryCountBtn")?.addEventListener("click",compareCountedWithCsv);
    document.getElementById("appInventoryCountCsvFile")?.addEventListener("change",event=>loadSmaregiInventoryCsv(event.target.files&&event.target.files[0]));
    document.getElementById("appInventoryCountBarcode")?.addEventListener("input",()=>previewBarcode());
    document.getElementById("appInventoryCountBarcode")?.addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        event.preventDefault();
        saveCount();
      }
    });
    document.getElementById("appInventoryCountSearch")?.addEventListener("input",handleSearchInput);
    document.getElementById("appInventoryCountStaff")?.addEventListener("change",event=>{
      state.staff=event.target.value||"";
      saveState();
    });
    renderAppInventoryCount();
  }

  window.getAppInventoryCountCsvHeaderReport=function(){
    return state.csvHeaderInfo;
  };

  window.addEventListener("DOMContentLoaded",bindAppInventoryCountEvents);
})();
