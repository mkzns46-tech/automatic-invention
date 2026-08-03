function clean(value){
  let text=String(value||"").replace(/^\uFEFF/,"").trim();
  if((text.startsWith('"')&&text.endsWith('"'))||(text.startsWith("'")&&text.endsWith("'")))text=text.slice(1,-1).trim();
  return text;
}

function env(...names){
  for(const name of names){const value=clean(process.env[name]);if(value)return value;}
  return "";
}

function bodyOf(req){
  if(req?.body&&typeof req.body==="object")return req.body;
  try{return req?.body?JSON.parse(req.body):{};}catch(_){return {};}
}

function readRows(value){
  if(Array.isArray(value))return value;
  if(!value||typeof value!=="object")return [];
  for(const key of ["data","items","products","results","records"]){if(Array.isArray(value[key]))return value[key];}
  return [];
}

function pick(row,keys,fallback=""){
  for(const key of keys){if(row?.[key]!==undefined&&row?.[key]!==null&&row?.[key]!=="")return row[key];}
  return fallback;
}

function boolValue(value,defaultValue=true){
  if(value===undefined||value===null||value==="")return defaultValue;
  if(typeof value==="boolean")return value;
  const text=String(value).toLowerCase();
  if(["false","0","inactive","disabled","deleted","deactivated"].includes(text))return false;
  if(["true","1","active","enabled"].includes(text))return true;
  return defaultValue;
}

function normalizeProduct(row){
  const productId=String(pick(row,["productId","product_id","id"])).trim();
  const productCode=String(pick(row,["productCode","product_code","code"])).trim();
  const barcode=String(pick(row,["barcode","janCode","jan_code","jan","productBarcode","product_code","productCode"])).trim();
  const name=String(pick(row,["productName","product_name","name","label"])).trim();
  const active=boolValue(pick(row,["active","isActive","is_active","status"]),!boolValue(pick(row,["deleted","isDeleted","is_deleted"]),false));
  return {
    smaregi_product_id:productId,
    name,
    product_code:productCode,
    barcode,
    product_type:pick(row,["productType","product_type","type"]),
    color:pick(row,["color","colorName","color_name"]),
    size:pick(row,["size","sizeName","size_name"]),
    price:Number(pick(row,["price","sellingPrice","selling_price"],0))||0,
    cost:Number(pick(row,["cost","purchasePrice","purchase_price"],0))||0,
    category:pick(row,["categoryName","category_name","category"]),
    genre:pick(row,["genreName","genre_name","genre"]),
    department:pick(row,["departmentName","department_name","department"]),
    smaregi_active:active,
    smaregi_updated_at:pick(row,["updatedAt","updated_at","updDateTime","upd_date_time"]),
  };
}

async function readJson(response,label){
  const text=await response.text();
  let value=null;
  try{value=text?JSON.parse(text):null;}catch(_){value=text;}
  if(!response.ok)throw new Error(`${label} failed (${response.status}) ${typeof value==="string"?value:JSON.stringify(value)||""}`);
  return value;
}

async function getToken(tokenUrl,clientId,clientSecret,scope){
  const response=await fetch(tokenUrl,{
    method:"POST",
    headers:{
      Authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`,"utf8").toString("base64")}`,
      "Content-Type":"application/x-www-form-urlencoded",
      Accept:"application/json"
    },
    body:new URLSearchParams({grant_type:"client_credentials",scope}).toString()
  });
  const data=await readJson(response,"Smaregi OAuth");
  if(!data?.access_token)throw new Error("Smaregi OAuth did not return an access token.");
  return data.access_token;
}

async function fetchPage(apiBase,token,page){
  const url=new URL(`${apiBase.replace(/\/+$/,"")}/products`);
  url.searchParams.set("limit","1000");
  url.searchParams.set("page",String(page));
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
  return readRows(await readJson(response,"Smaregi products API"));
}

async function fetchAllProducts(apiBase,token){
  const rows=[];
  for(let page=1;page<=100;page++){
    const current=await fetchPage(apiBase,token,page);
    rows.push(...current);
    if(current.length<1000)break;
  }
  return rows;
}

module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  if(req.method!=="POST")return res.status(405).json({ok:false,error:"POST only"});
  try{
    const body=bodyOf(req);
    const contractId=env("SMAREGI_CONTRACT_ID","SMAREGI_CONTRACTID");
    const clientId=env("SMAREGI_CLIENT_ID");
    const clientSecret=env("SMAREGI_CLIENT_SECRET");
    const accessToken=env("SMAREGI_ACCESS_TOKEN");
    const configuredEnv=env("SMAREGI_ENV").toLowerCase();
    const sandbox=contractId.startsWith("sb_")||configuredEnv==="sandbox";
    const idBase=sandbox?"https://id.smaregi.dev":"https://id.smaregi.jp";
    const apiBase=env("SMAREGI_POS_API_BASE_URL")||`${sandbox?"https://api.smaregi.dev":"https://api.smaregi.jp"}/${encodeURIComponent(contractId)}/pos`;
    const tokenUrl=env("SMAREGI_TOKEN_URL","SMAREGI_OAUTH_TOKEN_URL")||`${idBase}/app/${encodeURIComponent(contractId)}/token`;
    if(!accessToken&&(!contractId||!clientId||!clientSecret))throw new Error("Smaregi OAuth settings are incomplete.");
    const token=accessToken||await getToken(tokenUrl,clientId,clientSecret,"pos.products:read");
    const sourceRows=await fetchAllProducts(apiBase,token);
    const products=[];
    const warnings=[];
    const barcodeIds=new Map();
    for(const source of sourceRows){
      const normalized=normalizeProduct(source);
      if(!normalized.barcode||!normalized.name)continue;
      const id=normalized.smaregi_product_id||normalized.product_code||normalized.barcode;
      const ids=barcodeIds.get(normalized.barcode)||new Set();
      ids.add(id);
      barcodeIds.set(normalized.barcode,ids);
      products.push(normalized);
    }
    for(const [barcode,ids] of barcodeIds){
      if(ids.size>1)warnings.push({barcode,product_ids:[...ids],reason:"same barcode has multiple Smaregi product IDs"});
    }
    return res.status(200).json({ok:true,products,warnings,page_count:Math.ceil(sourceRows.length/1000),count:products.length,store_code:body.storeCode||"",environment:sandbox?"sandbox":"production"});
  }catch(error){
    console.error("[smaregi-products]",error);
    return res.status(500).json({ok:false,error:error.message||"Smaregi product import failed"});
  }
};
