/* ARICO TOKYO inventory app: product-import.js */

function updateSmaregiProductImportControl(){
  const button=el("importSmaregiProductsBtn");
  if(!button)return;
  button.disabled=false;
  button.textContent="スマレジ商品マスター取込";
  ensureProductMasterImportNotice();
}

function ensureProductMasterImportNotice(){
  const button=el("importSmaregiProductsBtn");
  const card=el("productImportCard");
  if(!button||!card||el("productMasterImportNotice"))return;
  const notice=document.createElement("div");
  notice.id="productMasterImportNotice";
  notice.className="product-master-import-notice";
  notice.innerHTML=`
    <style>
      .product-master-import-notice{
        margin:12px 0;
        padding:14px 16px;
        border:1px solid #9cc9e8;
        border-radius:10px;
        background:#eef8ff;
        color:#12405f;
        line-height:1.65;
        font-size:14px;
      }
      .product-master-import-notice strong{
        display:block;
        margin-bottom:8px;
        color:#0d3552;
        font-size:15px;
      }
      .product-master-import-notice-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px 18px;
      }
      .product-master-import-notice p{
        margin:0 0 4px;
        font-weight:700;
      }
      .product-master-import-notice ul{
        margin:0;
        padding-left:1.2em;
      }
      @media (max-width:800px){
        .product-master-import-notice{
          font-size:13px;
          padding:12px;
        }
        .product-master-import-notice-grid{
          grid-template-columns:1fr;
        }
      }
    </style>
    <strong>ℹ️ 【商品マスター取込について】</strong>
    <div class="product-master-import-notice-grid">
      <div><p>■ 通常の取込</p><ul><li>「スマレジAPIから取得」を使用します</li><li>全ページの商品情報を取得します</li></ul></div>
      <div><p>■ CSV予備取込</p><ul><li>API障害時のみ「CSVから取込」を使用します</li><li>CSVを最新API取得済みとして扱いません</li></ul></div>
      <div><p>■ 新規商品の扱い</p><ul><li>新規商品は登録されます</li><li>初期アプリ在庫は「0」で登録されます</li></ul></div>
      <div><p>■ 既存商品の扱い</p><ul><li>バーコードが一致する商品は商品名のみ更新します</li><li>アプリ在庫は変更しません</li></ul></div>
      <div><p>■ 更新しない項目</p><ul><li>アプリ在庫</li><li>棚番</li><li>価格</li><li>部門</li><li>商品区分</li><li>イベント在庫</li><li>棚卸履歴</li><li>原因確認履歴</li></ul></div>
    </div>
    <p style="margin:10px 0 0;font-weight:700;">■ 注意</p>
    <ul>
      <li>CSV内の在庫数は使用しません。</li>
      <li>在庫数の更新は「スマレジ在庫変動CSV取込」で行います。</li>
      <li>商品マスターCSVは商品情報を管理するための機能です。</li>
    </ul>
  `;
  button.insertAdjacentElement("beforebegin",notice);
}

async function upsertProducts(rows){
  await sb("products?on_conflict=barcode",{
    method:"POST",
    headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify(rows)
  });
}

async function importSmaregiProducts(){
  if(!requireInventoryPrivilegedAccess())return;
  showMessage("現在はCSV運用中です。スマレジAPIには接続しません。商品マスターCSVを選択してください。","ok");
  const csvInput=el("csvFile");
  if(csvInput){
    csvInput.value="";
    csvInput.click();
  }
  return;
  const smaregiContext=typeof getSmaregiRequestContext==="function" ? getSmaregiRequestContext() : {};
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction(
      "商品マスター取込確認",
      typeof getSmaregiOperationContextText==="function"
        ? getSmaregiOperationContextText("スマレジの商品マスターを取得し、商品情報を更新します。\n在庫数は変更しません。")
        : "スマレジの商品マスターを取得し、商品情報を更新します。在庫数は変更しません。",
      {okText:"取込"}
    );
    if(!ok)return;
  }
  try{
    console.log("[Smaregi product master import] start");
    showMessage("スマレジ商品マスターを取り込み中...");
    console.log("[Smaregi product master import] context",smaregiContext);
    const res=await fetch("about:blank",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(smaregiContext)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`APIエラー ${res.status}`);
    const rows=Array.isArray(data.products)?data.products:[];
    const existingRows=await sbAll("products?select=barcode,name,category,genre,department,location,smaregi_product_id,price",1000,50000);
    const existingBarcodes=new Set((existingRows||[]).map(row=>String(row.barcode||"")));
    const existingProductsByBarcode=new Map((existingRows||[]).map(row=>[String(row.barcode||""),row]));
    const normalizeProductInfo=(row,current={})=>({
      barcode:String(row.barcode||""),
      name:String(row.name||current.name||""),
      category:String(row.category||current.category||""),
      genre:String(row.genre||current.genre||""),
      department:String(row.department||current.department||""),
      location:String(row.location||current.location||""),
      smaregi_product_id:String(row.smaregi_product_id||current.smaregi_product_id||"").trim()||null,
      price:Number(row.price||current.price||0)
    });
    const existingProductRows=[];
    const newProductRows=[];
    rows.forEach(row=>{
      const productInfo=normalizeProductInfo(row,existingProductsByBarcode.get(String(row.barcode||"")));
      if(existingBarcodes.has(productInfo.barcode)){
        existingProductRows.push(productInfo);
      }else{
        newProductRows.push({...productInfo,base_stock:0});
      }
    });
    const payloadSampleRows=[...existingProductRows,...newProductRows];
    console.log("[Smaregi Product Master Upsert Payload Sample]",payloadSampleRows.slice(0,3));
    for(const payloadRows of [existingProductRows,newProductRows]){
      for(let i=0;i<payloadRows.length;i+=500){
        await upsertProducts(payloadRows.slice(i,i+500));
      }
    }
    products=[];
    console.log("[Smaregi product master import] success",{count:rows.length});
    showMessage(`スマレジ商品マスター取込完了：${rows.length}件。在庫数は変更していません。`,"ok");
    showPopup("スマレジ商品マスター取込完了",`商品情報を更新しました。\n取込件数：${rows.length}件\n在庫数は変更していません。`);
  }catch(e){
    console.error("[Smaregi product master import] error",e);
    showMessage("スマレジ商品マスター取込エラー："+e.message,"err");
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

    if(!barcode&&!name)continue;
    if(!barcode||!name)throw new Error(`${i+1}行目：バーコードまたは商品名が空です。`);

    rows.push({barcode,name});
  }

  if(!rows.length)throw new Error("取り込み対象データがありません。");
  return rows;
}

async function importCsvFile(file){
  const startedAt=new Date().toISOString();
  try{
    if(!requireInventoryPrivilegedAccess())return;
    if(!file)return;
    showMessage("CSV取り込み中...");

    const buffer=await file.arrayBuffer();
    const text=decodeCsvBuffer(buffer);

    const rows=csvToRows(text);
    await fetchProductsByBarcodes(rows.map(row=>row.barcode));

    const existingRows=[];
    const newRows=[];
    rows.forEach(row=>{
      const current=gp(row.barcode);
      if(current){
        existingRows.push({
          barcode:row.barcode,
          name:row.name
        });
      }else{
        newRows.push({
          barcode:row.barcode,
          name:row.name,
          base_stock:0
        });
      }
    });

    for(const payloadRows of [existingRows,newRows]){
      for(let i=0;i<payloadRows.length;i+=500){
        await upsertProducts(payloadRows.slice(i,i+500));
      }
    }

    // 取り込み後、キャッシュを更新
    for(const r of rows){
      const old=gp(r.barcode);
      if(old){
        old.name=r.name;
      }else{
        products.push({...r,base_stock:0});
      }
    }

    showMessage(`CSV取り込み完了：${rows.length}件の商品を登録・更新しました。既存商品の在庫数は変更していません。`,"ok");
    saveSmaregiProductImportHistory({source:"csv",started_at:startedAt,finished_at:new Date().toISOString(),new_count:newRows.length,updated_count:existingRows.length,unchanged_count:0,failure_count:0,store_code:""});
    render();
  }catch(e){
    saveSmaregiProductImportHistory({source:"csv",started_at:startedAt,finished_at:new Date().toISOString(),result:"failure",failure_count:1,failures:[{reason:e.message||"CSV取込失敗"}],store_code:""});
    showMessage("CSV取り込みエラー。\n"+e.message,"err");
  }finally{
    const input=el("csvFile");
    if(input)input.value="";
  }
}



function downloadSampleCsv(){
  const csv="\uFEFFbarcode,name\n4901234567890,サンプル商品A\n4909876543210,サンプル商品B\n";
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="product_import_sample.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function getSmaregiProductImportHistory(){
  try{
    const value=JSON.parse(localStorage.getItem("arico_smaregi_product_import_history")||"[]");
    return Array.isArray(value)?value:[];
  }catch(_){return [];}
}

function saveSmaregiProductImportHistory(entry){
  const history=getSmaregiProductImportHistory();
  history.unshift({created_at:new Date().toISOString(),...entry});
  try{localStorage.setItem("arico_smaregi_product_import_history",JSON.stringify(history.slice(0,30)));}catch(_){ }
}

function updateSmaregiProductImportControl(){
  const button=el("importSmaregiProductsBtn");
  if(!button)return;
  button.disabled=false;
  button.textContent="スマレジAPIから取得";
  button.title="スマレジAPIから商品マスターを取得します";
  ensureProductMasterImportNotice();
}

function getSmaregiImportMatch(row,existingById,existingByBarcode,existingByCode){
  const id=String(row.smaregi_product_id||"").trim();
  const barcode=String(row.barcode||"").trim();
  const code=String(row.product_code||"").trim();
  return (id&&existingById.get(id))
    || (barcode&&existingByBarcode.get(barcode))
    || (code&&existingByCode.get(code))
    || null;
}

function buildSmaregiProductPayload(row,current,isNew){
  const payload={
    barcode:String(row.barcode||current?.barcode||"").trim(),
    name:String(row.name||current?.name||"").trim()
  };
  const apiFields=[
    ["smaregi_product_id",row.smaregi_product_id],
    ["product_code",row.product_code],
    ["product_type",row.product_type],
    ["color",row.color],
    ["size",row.size],
    ["price",row.price],
    ["cost",row.cost],
    ["category",row.category],
    ["genre",row.genre],
    ["department",row.department],
    ["smaregi_active",row.smaregi_active],
    ["smaregi_updated_at",row.smaregi_updated_at]
  ];
  apiFields.forEach(([key,value])=>{
    if(value!==undefined&&value!==null&&value!=="")payload[key]=value;
  });
  if(isNew)payload.base_stock=0;
  return payload;
}

async function upsertSmaregiProductRows(rows){
  if(!rows.length)return;
  try{
    await upsertProducts(rows);
    return;
  }catch(firstError){
    // 古いDBに未追加の任意項目があっても、商品名・バーコード取込は継続する。
    const legacyKeys=["barcode","name","smaregi_product_id","price","category","genre","department","base_stock"];
    const legacyRows=rows.map(row=>Object.fromEntries(legacyKeys.filter(key=>Object.prototype.hasOwnProperty.call(row,key)).map(key=>[key,row[key]])));
    try{
      await upsertProducts(legacyRows);
    }catch(secondError){
      const minimal=rows.map(row=>({barcode:row.barcode,name:row.name,...(row.base_stock===0?{base_stock:0}:{})}));
      try{await upsertProducts(minimal);}catch(_){throw secondError||firstError;}
    }
  }
}

async function importSmaregiProducts(){
  if(!requireInventoryPrivilegedAccess())return;
  const context=typeof getSmaregiRequestContext==="function"?getSmaregiRequestContext():{};
  if(typeof confirmAppAction==="function"){
    const ok=await confirmAppAction("スマレジ商品マスター取込",typeof getSmaregiOperationContextText==="function"
      ?getSmaregiOperationContextText("スマレジAPIから商品情報を取得し、商品名・コード・価格などのAPI管理項目だけを更新します。ARICO在庫・棚番・履歴は変更しません。")
      :"スマレジAPIから商品情報を取得します。ARICO在庫・棚番・履歴は変更しません。",{okText:"APIから取得"});
    if(!ok)return;
  }
  const startedAt=new Date().toISOString();
  try{
    showMessage("スマレジ商品マスターを取得しています…");
    const response=await fetch("/api/smaregi-products",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(context)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok===false)throw new Error(data.error||`APIエラー (${response.status})`);
    const rows=Array.isArray(data.products)?data.products:[];
    const existingRows=typeof sbAll==="function"
      ?await sbAll("products?select=*",1000,50000)
      :await sb("products?select=*&limit=50000");
    const existing=Array.isArray(existingRows)?existingRows:[];
    const byId=new Map(existing.filter(row=>String(row.smaregi_product_id||"").trim()).map(row=>[String(row.smaregi_product_id).trim(),row]));
    const byBarcode=new Map(existing.filter(row=>String(row.barcode||"").trim()).map(row=>[String(row.barcode).trim(),row]));
    const byCode=new Map(existing.filter(row=>String(row.product_code||"").trim()).map(row=>[String(row.product_code).trim(),row]));
    const duplicateBarcodes=new Set((data.warnings||[]).map(w=>String(w.barcode||"")).filter(Boolean));
    const seenIds=new Set();
    const updates=[];
    const inserts=[];
    let unchanged=0;
    const failures=[];
    const comparisonFields=["barcode","name","smaregi_product_id","product_code","product_type","color","size","price","cost","category","genre","department","smaregi_active","smaregi_updated_at"];
    rows.forEach(row=>{
      const barcode=String(row.barcode||"").trim();
      if(!barcode||!String(row.name||"").trim()){
        failures.push({name:row.name||"",id:row.smaregi_product_id||"",reason:"バーコードまたは商品名がありません"});
        return;
      }
      const id=String(row.smaregi_product_id||"").trim();
      if(id&&seenIds.has(id))return;
      if(id)seenIds.add(id);
      if(duplicateBarcodes.has(barcode)){
        failures.push({name:row.name,id,reason:"同一バーコードに複数の商品IDがあるため自動統合しません"});
        return;
      }
      const current=getSmaregiImportMatch(row,byId,byBarcode,byCode);
      const payload=buildSmaregiProductPayload(row,current,!current);
      if(current&&comparisonFields.every(key=>String(current[key]??"")===String(payload[key]??""))){
        unchanged++;
      }else{
        (current?updates:inserts).push(payload);
      }
    });
    const ok=typeof confirmAppAction==="function"
      ?await confirmAppAction("商品マスター更新確認",`新規 ${inserts.length}件 / 更新 ${updates.length}件 / 変更なし ${unchanged}件 / 要確認 ${failures.length}件`,{okText:"保存"})
      :true;
    if(!ok)return;
    for(const batch of [updates,inserts])for(let i=0;i<batch.length;i+=500)await upsertSmaregiProductRows(batch.slice(i,i+500));
    const returnedIds=new Set(rows.map(row=>String(row.smaregi_product_id||"").trim()).filter(Boolean));
    let inactiveCount=0;
    for(const current of existing){
      const id=String(current.smaregi_product_id||"").trim();
      if(id&&returnedIds.size&&!returnedIds.has(id)&&Object.prototype.hasOwnProperty.call(current,"smaregi_active")){
        try{
          await sb(`products?barcode=eq.${encodeURIComponent(current.barcode)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({smaregi_active:false})});
          inactiveCount++;
        }catch(_){ }
      }
    }
    saveSmaregiProductImportHistory({source:"api",started_at:startedAt,finished_at:new Date().toISOString(),page_count:Number(data.page_count||0),new_count:inserts.length,updated_count:updates.length,unchanged_count:unchanged,inactive_count:inactiveCount,failure_count:failures.length,failures:warningsToHistory(failures,data.warnings||[]),store_code:context.storeCode||"",contract_id:context.contractId||""});
    if(typeof loadProducts==="function")await loadProducts();
    else if(typeof render==="function")render();
    const warningCount=failures.length+(Array.isArray(data.warnings)?data.warnings.length:0);
    showMessage(`スマレジAPI取込完了：新規${inserts.length}件／更新${updates.length}件／変更なし${unchanged}件／停止${inactiveCount}件${warningCount?`／要確認${warningCount}件`:""}`,"ok");
    if(warningCount&&typeof showPopup==="function"){
      const details=warningsToHistory(failures,data.warnings||[]).slice(0,20).map(item=>`${item.name||item.id||"商品"}：${item.reason}`).join("\n");
      showPopup("商品マスター取込の要確認",details||`${warningCount}件の確認が必要です。`);
    }
  }catch(error){
    saveSmaregiProductImportHistory({source:"api",started_at:startedAt,finished_at:new Date().toISOString(),result:"failure",failure_count:1,failures:[{reason:error.message||"API取込失敗"}],store_code:context.storeCode||"",contract_id:context.contractId||""});
    showMessage(`スマレジAPI取込失敗：${error.message||"取得できませんでした"}`,"err");
  }
}

function warningsToHistory(failures,warnings){
  return [...failures,...warnings.map(w=>({name:w.name||"",id:w.product_id||w.smaregi_product_id||"",reason:w.reason||"同一バーコードの商品が複数あります"}))].slice(0,100);
}
