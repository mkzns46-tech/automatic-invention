const SUPABASE_URL=process.env.SUPABASE_URL||"https://ihsbkknysozkstvylqff.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_API_KEY||process.env.SUPABASE_ANON_KEY||"sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

function required(name){
  const value=String(process.env[name]||"").trim();
  if(!value)throw new Error(`Vercel環境変数 ${name} を設定してください。`);
  return value;
}

async function readJson(res,label){
  const text=await res.text();
  let body=null;
  try{body=text?JSON.parse(text):null;}catch{body=text;}
  if(!res.ok){
    const detail=typeof body==="string"?body:JSON.stringify(body);
    throw new Error(`${label}に失敗しました (${res.status}) ${detail||""}`);
  }
  return body;
}

async function supabase(path,opt={}){
  return readJson(await fetch(`${SUPABASE_URL.replace(/\/+$/,"")}/rest/v1/${path}`,{
    ...opt,
    headers:{
      apikey:SUPABASE_KEY,
      Authorization:`Bearer ${SUPABASE_KEY}`,
      "Content-Type":"application/json",
      Accept:"application/json",
      ...(opt.headers||{})
    }
  }),"Supabase処理");
}

async function smaregiFetch(base,token,path,params={}){
  const url=new URL(`${base}${path}`);
  Object.entries(params).forEach(([key,value])=>{
    if(value!==undefined&&value!==null&&value!=="")url.searchParams.set(key,String(value));
  });
  return readJson(await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}}),`スマレジAPI ${path}`);
}

async function fetchAll(base,token,path,params={}){
  const all=[];
  for(let page=1;page<=100;page++){
    const rows=await smaregiFetch(base,token,path,{...params,limit:1000,page});
    if(!Array.isArray(rows))throw new Error(`スマレジAPI ${path} の応答形式が不正です。`);
    all.push(...rows);
    if(rows.length<1000)break;
  }
  return all;
}

function splitDateRanges(from,to){
  const ranges=[];
  let start=new Date(from);
  const end=new Date(to);
  while(start<end){
    const next=new Date(Math.min(end.getTime(),start.getTime()+30*24*60*60*1000));
    ranges.push([start.toISOString(),next.toISOString()]);
    start=next;
  }
  return ranges;
}

async function mapLimit(rows,limit,fn){
  const results=new Array(rows.length);
  let cursor=0;
  async function worker(){
    while(cursor<rows.length){
      const index=cursor++;
      results[index]=await fn(rows[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,rows.length)},worker));
  return results;
}

async function fetchChanges(base,token,productId,storeId,since){
  const rows=[];
  for(let page=1;page<=10;page++){
    const part=await smaregiFetch(base,token,`/stock/changes/${encodeURIComponent(productId)}/${encodeURIComponent(storeId)}`,{
      sort:"updDateTime:desc",limit:1000,page
    });
    if(!Array.isArray(part))break;
    const current=part.filter(row=>new Date(row.updDateTime)>=new Date(since));
    rows.push(...current);
    if(part.length<1000||current.length<part.length)break;
  }
  return rows;
}

module.exports=async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POSTのみ利用できます。"});
  try{
    const contractId=required("SMAREGI_CONTRACT_ID");
    const clientId=required("SMAREGI_CLIENT_ID");
    const clientSecret=required("SMAREGI_CLIENT_SECRET");
    const storeId=required("SMAREGI_STORE_ID");
    const sandbox=process.env.SMAREGI_ENV==="sandbox"||contractId.startsWith("sb_");
    const idBase=sandbox?"https://id.smaregi.dev":"https://id.smaregi.jp";
    const apiBase=`${sandbox?"https://api.smaregi.dev":"https://api.smaregi.jp"}/${encodeURIComponent(contractId)}/pos`;
    const scope="pos.stock:read pos.products:read pos.stock-changes:read";
    const tokenBody=new URLSearchParams({grant_type:"client_credentials",scope});
    const tokenData=await readJson(await fetch(`${idBase}/app/${encodeURIComponent(contractId)}/token`,{
      method:"POST",
      headers:{
        Authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type":"application/x-www-form-urlencoded"
      },
      body:tokenBody.toString()
    }),"スマレジOAuth認証");
    const token=tokenData.access_token;
    if(!token)throw new Error("スマレジOAuth認証でアクセストークンを取得できませんでした。");

    const completed=await supabase("smaregi_stock_snapshots?select=completed_at&completed_at=not.is.null&order=completed_at.desc&limit=1");
    const now=new Date();
    const since=completed[0]?.completed_at||new Date(now.getTime()-7*24*60*60*1000).toISOString();
    const changed=[];
    for(const [from,to] of splitDateRanges(since,now.toISOString())){
      changed.push(...await fetchAll(apiBase,token,"/stock",{
        store_id:storeId,
        "upd_date_time-from":from,
        "upd_date_time-to":to
      }));
    }

    const latestByProduct=new Map();
    changed.forEach(row=>{
      const old=latestByProduct.get(String(row.productId));
      if(!old||new Date(row.updDateTime)>new Date(old.updDateTime))latestByProduct.set(String(row.productId),row);
    });
    const stockRows=[...latestByProduct.values()];
    const products=await mapLimit(stockRows,8,row=>smaregiFetch(apiBase,token,`/products/${encodeURIComponent(row.productId)}`,{
      fields:"productId,productCode,productName"
    }));
    const changes=await mapLimit(stockRows,4,row=>fetchChanges(apiBase,token,row.productId,storeId,since));
    const items=stockRows.map((stock,index)=>({
      barcode:String(products[index].productCode||products[index].productId),
      product_name:String(products[index].productName||""),
      smaregi_stock:Math.trunc(Number(stock.stockAmount||0)),
      product_id:String(stock.productId),
      store_id:String(storeId),
      latest_change_at:stock.updDateTime,
      change_count:changes[index].length
    }));

    const snapshots=await supabase("smaregi_stock_snapshots",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([{source:"api",note:"スマレジAPI同期",range_from:since,range_to:now.toISOString()}])
    });
    const snapshot=snapshots[0];
    if(!snapshot)throw new Error("スナップショットを作成できませんでした。");
    for(let index=0;index<items.length;index+=500){
      await supabase("smaregi_stock_items",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(items.slice(index,index+500).map(item=>({...item,snapshot_id:snapshot.id})))
      });
    }
    const changeRows=[];
    changes.forEach((rows,index)=>{
      rows.forEach(change=>changeRows.push({
        snapshot_id:snapshot.id,
        smaregi_change_id:String(change.id),
        product_id:String(stockRows[index].productId),
        store_id:String(storeId),
        barcode:items[index].barcode,
        changed_at:change.updDateTime||change.targetDateTime||null,
        amount:Math.trunc(Number(change.amount||0)),
        stock_amount:Math.trunc(Number(change.stockAmount||0)),
        stock_division:String(change.stockDivision||""),
        memo:String(change.memo||"")
      }));
    });
    for(let index=0;index<changeRows.length;index+=500){
      await supabase("smaregi_stock_changes",{
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify(changeRows.slice(index,index+500))
      });
    }
    return res.status(200).json({
      snapshot_id:snapshot.id,
      item_count:items.length,
      change_count:changes.reduce((sum,rows)=>sum+rows.length,0),
      range_from:since,
      range_to:now.toISOString(),
      initial_sync:!completed.length
    });
  }catch(error){
    return res.status(500).json({error:error.message||String(error)});
  }
};
