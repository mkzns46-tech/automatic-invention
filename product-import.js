/* ARICO TOKYO inventory app: product-import.js */

function updateSmaregiProductImportControl(){
  const button=el("importSmaregiProductsBtn");
  if(!button)return;
  button.disabled=false;
  button.textContent="スマレジ商品マスター取込";
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
    const res=await fetch("/api/smaregi-products",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(smaregiContext)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`APIエラー ${res.status}`);
    const rows=Array.isArray(data.products)?data.products:[];
    const existingRows=await sbAll("products?select=barcode,name,category,genre,department,location,smaregi_product_id",1000,50000);
    const existingBarcodes=new Set((existingRows||[]).map(row=>String(row.barcode||"")));
    const existingProductsByBarcode=new Map((existingRows||[]).map(row=>[String(row.barcode||""),row]));
    const normalizeProductInfo=(row,current={})=>({
      barcode:String(row.barcode||""),
      name:String(row.name||current.name||""),
      category:String(row.category||current.category||""),
      genre:String(row.genre||current.genre||""),
      department:String(row.department||current.department||""),
      location:String(row.location||current.location||""),
      smaregi_product_id:String(row.smaregi_product_id||current.smaregi_product_id||"").trim()||null
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
    if(!requireInventoryPrivilegedAccess())return;
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
