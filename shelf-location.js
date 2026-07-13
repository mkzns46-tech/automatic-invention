/* ARICO inventory app: shelf location registration */
(function(){
  const STORAGE={
    staff:"arico_shelf_location_staff",
    shelf:"arico_shelf_location_shelf",
    column:"arico_shelf_location_column",
    sort:"arico_product_search_sort_shelf_location"
  };
  const state={
    product:null,
    locations:[],
    logs:[],
    historyMode:"today",
    camera:{stream:null,reader:null,running:false,lastCode:"",lastAt:0}
  };

  function $(id){return document.getElementById(id);}
  function safe(s){return typeof esc==="function" ? esc(s) : String(s??"");}
  function staffName(){
    const value=$("shelfLocationStaff")?.value||localStorage.getItem(STORAGE.staff)||"";
    const staff=typeof findStaffMemberByValue==="function" ? findStaffMemberByValue(value) : null;
    return staff && typeof getStaffDisplayName==="function" ? getStaffDisplayName(staff) : String(value||"").trim();
  }
  function isAdmin(){return typeof hasInventoryPrivilegedAccess==="function" && hasInventoryPrivilegedAccess();}
  function requireAdmin(){
    if(isAdmin())return true;
    showMessage?.("管理者のみ操作できます","err");
    return false;
  }
  function showShelfMessage(text,type=""){
    const box=$("shelfLocationMessage");
    if(box){
      box.textContent=text||"";
      box.className=`message ${type||""}`.trim();
    }
    if(typeof showMessage==="function" && text)showMessage(text,type);
  }
  function shelfCode(){
    const shelf=String($("shelfLocationShelf")?.value||localStorage.getItem(STORAGE.shelf)||"3").trim();
    const col=Number($("shelfLocationColumn")?.value||localStorage.getItem(STORAGE.column)||1);
    return `${shelf}-${Math.max(1,Math.min(30,Number.isFinite(col)?col:1))}`;
  }
  function setColumn(value){
    const next=Math.max(1,Math.min(30,Number(value)||1));
    const select=$("shelfLocationColumn");
    if(select)select.value=String(next);
    localStorage.setItem(STORAGE.column,String(next));
    renderCurrentShelfCode();
  }
  function renderCurrentShelfCode(){
    const code=shelfCode();
    const current=$("shelfLocationCurrentCode");
    if(current)current.textContent=code;
    const target=$("shelfLocationProductTarget");
    if(target)target.textContent=code;
    renderSummary();
    return code;
  }
  function renderSummary(){
    const code=shelfCode();
    const todayKey=new Date().toISOString().slice(0,10);
    const today=state.logs.filter(log=>String(log.created_at||"").slice(0,10)===todayKey);
    const atCode=today.filter(log=>log.after_shelf_code===code && !log.cancelled_at);
    const last=today.find(log=>!log.cancelled_at);
    const summary=$("shelfLocationWorkSummary");
    if(summary){
      summary.innerHTML=`
        <div><span>現在の登録先</span><strong>${safe(code)}</strong></div>
        <div><span>今回登録</span><strong>${atCode.length}商品</strong></div>
        <div><span>最終登録商品</span><strong>${safe(last?.product_name||"-")}</strong></div>
        <div><span>最終登録時刻</span><strong>${last?.created_at?fmt(last.created_at):"-"}</strong></div>
      `;
    }
    const counts=new Map();
    today.filter(log=>!log.cancelled_at && log.after_shelf_code).forEach(log=>{
      counts.set(log.after_shelf_code,(counts.get(log.after_shelf_code)||0)+1);
    });
    const countBox=$("shelfLocationShelfCounts");
    if(countBox){
      countBox.innerHTML=[...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0],"ja",{numeric:true})).map(([k,v])=>`<span class="shelf-location-pill">${safe(k)}：${v}商品</span>`).join("")||'<span class="muted-text">今回作業の登録はまだありません</span>';
    }
  }
  function resetProductOnly(){
    state.product=null;
    state.locations=[];
    ["shelfLocationBarcode","shelfLocationSearch"].forEach(id=>{const input=$(id); if(input)input.value="";});
    const results=$("shelfLocationSearchResults");
    if(results){results.innerHTML=""; results.classList.remove("is-active");}
    renderProductInfo();
  }
  function productKey(product){return String(product?.barcode||product?.smaregi_product_id||product?.id||"");}
  async function loadProductLocations(product){
    const barcode=productKey(product);
    if(!barcode)return [];
    const rows=await sbAll(`product_locations?select=*&barcode=eq.${encodeURIComponent(barcode)}&order=is_primary.desc,created_at.asc`,1000,5000).catch(error=>{
      showShelfMessage("棚番テーブルを確認してください。SQL未実行の可能性があります。\n"+error.message,"err");
      return [];
    });
    state.locations=Array.isArray(rows)?rows:[];
    return state.locations;
  }
  async function selectProduct(product){
    state.product=product;
    if(product && product.barcode && !gp(product.barcode))products.push(product);
    await loadProductLocations(product);
    renderProductInfo();
    const barcodeInput=$("shelfLocationBarcode");
    if(barcodeInput)barcodeInput.value=product?.barcode||"";
  }
  function renderProductInfo(){
    const box=$("shelfLocationProductInfo");
    if(!box)return;
    const product=state.product;
    if(!product){
      box.innerHTML="商品をスキャンまたは検索してください。";
      return;
    }
    const current=state.locations.length
      ? state.locations.map(loc=>`<li><span>${safe(loc.shelf_code)}${loc.is_primary?"（主棚番）":""}</span> <button type="button" class="secondary" data-shelf-primary="${safe(loc.id)}">主棚番に設定</button> <button type="button" class="danger" data-shelf-delete="${safe(loc.id)}">削除</button></li>`).join("")
      : "<li>未登録</li>";
    box.innerHTML=`
      <div class="shelf-product-info">
        <strong>${safe(product.name||product.product_name||"商品名なし")}</strong>
        <span>バーコード：${safe(product.barcode||"なし")}</span>
        <div>現在の棚番</div>
        <ul>${current}</ul>
        <div>今回の登録先</div>
        <ul><li id="shelfLocationProductTarget">${safe(shelfCode())}</li></ul>
      </div>`;
    box.querySelectorAll("[data-shelf-primary]").forEach(btn=>btn.onclick=()=>setPrimaryLocation(btn.dataset.shelfPrimary));
    box.querySelectorAll("[data-shelf-delete]").forEach(btn=>btn.onclick=()=>deleteLocation(btn.dataset.shelfDelete));
  }
  async function findProductByCode(code){
    code=String(code||"").trim();
    if(!code)return null;
    const cached=gp(code);
    if(cached)return cached;
    if(typeof fetchProductByBarcode==="function"){
      const fetched=await fetchProductByBarcode(code).catch(()=>null);
      if(fetched)return fetched;
    }
    const q=encodeURIComponent(code);
    const rows=await sb(`products?select=*&or=(barcode.eq.${q},smaregi_product_id.eq.${q})&limit=1`).catch(()=>[]);
    const product=Array.isArray(rows)&&rows[0]?rows[0]:null;
    if(product && product.barcode && !gp(product.barcode))products.push(product);
    return product;
  }
  async function handleBarcodeInput(code){
    const product=await findProductByCode(code);
    if(!product){
      showShelfMessage(`未登録バーコード：${code}`,"err");
      return;
    }
    await selectProduct(product);
    showShelfMessage(`商品を選択しました：${product.name||product.barcode}`,"ok");
  }
  function getSortMode(){
    return $("shelfLocationProductSearchSort")?.value||localStorage.getItem(STORAGE.sort)||"name";
  }
  let searchTimer=null;
  function handleSearchInput(){
    clearTimeout(searchTimer);
    const input=$("shelfLocationSearch");
    const keyword=String(input?.value||"").trim();
    const box=$("shelfLocationSearchResults");
    if(!keyword){
      if(box){box.innerHTML=""; box.classList.remove("is-active");}
      return;
    }
    searchTimer=setTimeout(async()=>{
      const rows=typeof searchProductsByName==="function" ? await searchProductsByName(keyword) : [];
      renderSearchResults(rows);
    },250);
  }
  function renderSearchResults(rows){
    const box=$("shelfLocationSearchResults");
    if(!box)return;
    const sorted=typeof sortProductsForDisplay==="function" ? sortProductsForDisplay(rows,getSortMode()) : rows;
    if(!sorted.length){
      box.innerHTML='<div class="product-search-item"><strong>該当商品なし</strong><span>別のキーワードで検索してください</span></div>';
      box.classList.add("is-active");
      return;
    }
    box.innerHTML=sorted.slice(0,80).map(product=>`
      <div class="product-search-item" data-barcode="${safe(product.barcode)}">
        <div>
          <strong>${safe(product.name||"")}</strong>
          <span>バーコード：${safe(product.barcode||"なし")} / 棚番：${safe(product.location||"棚番未設定")}</span>
        </div>
        <button type="button">選択</button>
      </div>`).join("");
    box.classList.add("is-active");
    box.querySelectorAll("[data-barcode]").forEach(item=>{
      item.onclick=async()=>{
        const product=sorted.find(row=>String(row.barcode)===String(item.dataset.barcode));
        if(product)await selectProduct(product);
        $("shelfLocationSearch").value="";
        box.innerHTML="";
        box.classList.remove("is-active");
      };
    });
  }
  async function insertLocationLog(payload){
    const rows=await sb("product_location_logs?select=*",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify(payload)
    });
    return Array.isArray(rows)?rows[0]:rows;
  }
  async function upsertLocation(payload){
    const rows=await sb("product_locations?on_conflict=barcode,shelf_code&select=*",{
      method:"POST",
      headers:{Prefer:"resolution=ignore-duplicates,return=representation"},
      body:JSON.stringify(payload)
    });
    return Array.isArray(rows)?rows[0]:rows;
  }
  async function patchProductLocation(product,location){
    if(!product?.barcode)return;
    await sb(`products?barcode=eq.${encodeURIComponent(product.barcode)}`,{
      method:"PATCH",
      body:JSON.stringify({location,updated_at:new Date().toISOString()})
    });
    product.location=location;
  }
  async function registerShelfLocation(){
    const staff=staffName();
    if(!staff){showShelfMessage("担当者を選択してください","err"); return;}
    const product=state.product;
    if(!product){showShelfMessage("商品を選択してください","err"); return;}
    const code=shelfCode();
    await loadProductLocations(product);
    if(state.locations.some(loc=>loc.shelf_code===code && !loc.deleted_at)){
      showShelfMessage(`この商品はすでに${code}へ登録されています`,"err");
      return;
    }
    const isFirst=state.locations.length===0 && !String(product.location||"").trim();
    const payload={
      product_id:product.id||null,
      barcode:product.barcode,
      shelf_code:code,
      shelf_group:String($("shelfLocationShelf")?.value||""),
      shelf_column:Number($("shelfLocationColumn")?.value||1),
      is_primary:isFirst,
      created_by:staff,
      updated_by:staff
    };
    const inserted=await upsertLocation(payload);
    if(!inserted){
      showShelfMessage(`この商品はすでに${code}へ登録されています`,"err");
      return;
    }
    if(isFirst)await patchProductLocation(product,code);
    await insertLocationLog({
      product_id:product.id||null,
      barcode:product.barcode,
      product_name:product.name||"",
      action_type:"棚番追加",
      before_shelf_code:"",
      after_shelf_code:code,
      staff
    });
    await loadProductLocations(product);
    await loadShelfLocationLogs();
    showPopup?.("棚番登録完了",`${product.name||product.barcode}を${code}へ登録しました`);
    showShelfMessage(`${product.name||product.barcode}を${code}へ登録しました`,"ok");
    resetProductOnly();
  }
  async function setPrimaryLocation(locationId){
    if(!requireAdmin())return;
    const loc=state.locations.find(row=>String(row.id)===String(locationId));
    if(!loc||!state.product)return;
    const staff=staffName()||"管理者";
    const old=state.locations.find(row=>row.is_primary);
    await sb(`product_locations?barcode=eq.${encodeURIComponent(loc.barcode)}`,{method:"PATCH",body:JSON.stringify({is_primary:false,updated_by:staff,updated_at:new Date().toISOString()})});
    await sb(`product_locations?id=eq.${encodeURIComponent(loc.id)}`,{method:"PATCH",body:JSON.stringify({is_primary:true,updated_by:staff,updated_at:new Date().toISOString()})});
    await patchProductLocation(state.product,loc.shelf_code);
    await insertLocationLog({product_id:state.product.id||null,barcode:loc.barcode,product_name:state.product.name||"",action_type:"主棚番変更",before_shelf_code:old?.shelf_code||"",after_shelf_code:loc.shelf_code,staff});
    await selectProduct(state.product);
    await loadShelfLocationLogs();
    showShelfMessage(`主棚番を${loc.shelf_code}に変更しました`,"ok");
  }
  async function deleteLocation(locationId){
    if(!requireAdmin())return;
    const loc=state.locations.find(row=>String(row.id)===String(locationId));
    if(!loc||!state.product)return;
    if(!confirm(`${loc.shelf_code}を削除します。よろしいですか？`))return;
    const staff=staffName()||"管理者";
    const others=state.locations.filter(row=>String(row.id)!==String(locationId));
    if(loc.is_primary && others.length){
      showShelfMessage("主棚番を削除する前に、他の棚番を主棚番に設定してください。","err");
      return;
    }
    await sb(`product_locations?id=eq.${encodeURIComponent(loc.id)}`,{method:"DELETE"});
    if(loc.is_primary)await patchProductLocation(state.product,"");
    await insertLocationLog({product_id:state.product.id||null,barcode:loc.barcode,product_name:state.product.name||"",action_type:"棚番削除",before_shelf_code:loc.shelf_code,after_shelf_code:"",staff});
    await selectProduct(state.product);
    await loadShelfLocationLogs();
    showShelfMessage(`${loc.shelf_code}を削除しました`,"ok");
  }
  async function cancelLog(logId){
    const log=state.logs.find(row=>String(row.id)===String(logId));
    if(!log)return;
    const currentStaff=staffName();
    if(log.staff!==currentStaff && !requireAdmin())return;
    if(!confirm("この履歴を取消し、棚番状態を戻します。よろしいですか？"))return;
    const staff=currentStaff||"担当者";
    await revertLogChange(log,staff);
    await sb(`product_location_logs?id=eq.${encodeURIComponent(log.id)}`,{method:"PATCH",body:JSON.stringify({cancelled_at:new Date().toISOString(),cancelled_by:staff})});
    await insertLocationLog({product_id:log.product_id||null,barcode:log.barcode,product_name:log.product_name||"",action_type:"取消",before_shelf_code:log.after_shelf_code||"",after_shelf_code:log.before_shelf_code||"",staff,source_log_id:log.id});
    await loadShelfLocationLogs();
    if(state.product?.barcode===log.barcode)await selectProduct(state.product);
    showShelfMessage("取消しました","ok");
  }
  async function revertLogChange(log,staff){
    const product=await findProductByCode(log.barcode);
    if(log.action_type==="棚番追加"){
      await sb(`product_locations?barcode=eq.${encodeURIComponent(log.barcode)}&shelf_code=eq.${encodeURIComponent(log.after_shelf_code)}`,{method:"DELETE"});
      const locations=await sbAll(`product_locations?select=*&barcode=eq.${encodeURIComponent(log.barcode)}&order=is_primary.desc,created_at.asc`,1000,100);
      if(!locations.length)await patchProductLocation(product,"");
      else if(!locations.some(loc=>loc.is_primary)){
        await sb(`product_locations?id=eq.${encodeURIComponent(locations[0].id)}`,{method:"PATCH",body:JSON.stringify({is_primary:true,updated_by:staff})});
        await patchProductLocation(product,locations[0].shelf_code);
      }
    }else if(log.action_type==="棚番変更"||log.action_type==="一括棚番変更"||log.action_type==="主棚番変更"){
      await changeProductShelf(product,log.after_shelf_code,log.before_shelf_code,staff,{log:false});
    }else if(log.action_type==="棚番削除" && log.before_shelf_code){
      await upsertLocation({product_id:product?.id||null,barcode:log.barcode,shelf_code:log.before_shelf_code,shelf_group:String(log.before_shelf_code).split("-")[0],shelf_column:Number(String(log.before_shelf_code).split("-")[1]||1),is_primary:!product?.location,created_by:staff,updated_by:staff});
    }
  }
  async function changeProductShelf(product,fromShelf,toShelf,staff,{bulk=false,log=true}={}){
    if(!product||!fromShelf||!toShelf||fromShelf===toShelf)return false;
    const existing=await sbAll(`product_locations?select=*&barcode=eq.${encodeURIComponent(product.barcode)}&shelf_code=eq.${encodeURIComponent(toShelf)}`,1000,1);
    if(existing.length)return false;
    const rows=await sbAll(`product_locations?select=*&barcode=eq.${encodeURIComponent(product.barcode)}&shelf_code=eq.${encodeURIComponent(fromShelf)}`,1000,1);
    const loc=rows[0];
    if(!loc)return false;
    await sb(`product_locations?id=eq.${encodeURIComponent(loc.id)}`,{method:"PATCH",body:JSON.stringify({shelf_code:toShelf,shelf_group:String(toShelf).split("-")[0],shelf_column:Number(String(toShelf).split("-")[1]||1),updated_by:staff,updated_at:new Date().toISOString()})});
    if(loc.is_primary)await patchProductLocation(product,toShelf);
    if(log)await insertLocationLog({product_id:product.id||null,barcode:product.barcode,product_name:product.name||"",action_type:bulk?"一括棚番変更":"棚番変更",before_shelf_code:fromShelf,after_shelf_code:toShelf,staff});
    return true;
  }
  async function promptChangeFromLog(logId,bulk=false){
    const log=state.logs.find(row=>String(row.id)===String(logId));
    if(!log)return;
    if(bulk && !requireAdmin())return;
    const to=prompt("変更先棚番を入力してください（例：3-2、B-4）",shelfCode());
    const normalized=normalizeShelfCode(to);
    if(!normalized){showShelfMessage("棚番形式が正しくありません","err"); return;}
    const staff=staffName()||"担当者";
    if(!bulk){
      const product=await findProductByCode(log.barcode);
      const ok=await changeProductShelf(product,log.after_shelf_code,normalized,staff);
      if(ok)showShelfMessage(`${product.name||log.product_name}を${normalized}へ変更しました`,"ok");
    }else{
      const day=String(log.created_at||"").slice(0,10);
      const targets=state.logs.filter(row=>!row.cancelled_at && row.staff===log.staff && String(row.created_at||"").slice(0,10)===day && row.after_shelf_code===log.after_shelf_code && new Date(row.created_at)>=new Date(log.created_at));
      const names=targets.map(row=>`・${row.product_name||row.barcode}`).join("\n");
      if(!confirm(`${targets.length}件の商品を${log.after_shelf_code}から${normalized}へ変更します。\n\n${names}`))return;
      let count=0;
      for(const row of targets){
        const product=await findProductByCode(row.barcode);
        if(await changeProductShelf(product,row.after_shelf_code,normalized,staff,{bulk:true}))count++;
      }
      showShelfMessage(`${count}件を${normalized}へ変更しました`,"ok");
    }
    await loadShelfLocationLogs();
    if(state.product)await selectProduct(state.product);
  }
  function normalizeShelfCode(value){
    const text=String(value||"").normalize("NFKC").toUpperCase().replace(/\s+/g,"").replace(/[ー－―]/g,"-");
    const m=text.match(/^([1-9]|1[0-5]|[A-Z])-([1-9]|[12][0-9]|30)$/);
    return m ? `${m[1]}-${Number(m[2])}` : "";
  }
  async function loadShelfLocationLogs(){
    const params=["select=*","order=created_at.desc","limit=500"];
    const rows=await sbAll(`product_location_logs?${params.join("&")}`,1000,5000).catch(error=>{
      const body=$("shelfLocationHistoryBody");
      if(body)body.innerHTML=`<tr><td colspan="7">棚番履歴テーブルを確認してください：${safe(error.message)}</td></tr>`;
      return [];
    });
    state.logs=Array.isArray(rows)?rows:[];
    renderHistory();
    renderSummary();
  }
  function filteredLogs(){
    const product=String($("shelfLocationHistoryProductFilter")?.value||"").toLowerCase();
    const shelf=String($("shelfLocationHistoryShelfFilter")?.value||"");
    const col=String($("shelfLocationHistoryColumnFilter")?.value||"");
    const staff=String($("shelfLocationHistoryStaffFilter")?.value||"").toLowerCase();
    const date=String($("shelfLocationHistoryDateFilter")?.value||"");
    const action=String($("shelfLocationHistoryActionFilter")?.value||"").toLowerCase();
    const today=new Date().toISOString().slice(0,10);
    return state.logs.filter(log=>{
      const hay=`${log.product_name||""} ${log.barcode||""}`.toLowerCase();
      const code=String(log.after_shelf_code||log.before_shelf_code||"");
      return (!product||hay.includes(product))
        &&(!shelf||code.split("-")[0]===shelf)
        &&(!col||code.split("-")[1]===String(Number(col)))
        &&(!staff||String(log.staff||"").toLowerCase().includes(staff))
        &&(!date||String(log.created_at||"").slice(0,10)===date)
        &&(!action||String(log.action_type||"").toLowerCase().includes(action))
        &&(state.historyMode==="all"||String(log.created_at||"").slice(0,10)===today);
    });
  }
  function renderHistory(){
    const rows=filteredLogs();
    const body=$("shelfLocationHistoryBody");
    const summary=$("shelfLocationHistorySummary");
    if(summary)summary.textContent=`${rows.length}件`;
    if(!body)return;
    if(!rows.length){
      body.innerHTML='<tr><td colspan="8">履歴はありません。</td></tr>';
      return;
    }
    body.innerHTML=rows.map(log=>`
      <tr class="${log.cancelled_at?"is-cancelled":""}">
        <td>${fmt(log.created_at)}</td>
        <td class="shelf-history-product"><strong>${safe(log.product_name||"")}</strong><small>バーコード：${safe(log.barcode||"")}</small></td>
        <td>${safe(log.before_shelf_code||"未登録")}</td>
        <td>${safe(log.after_shelf_code||"")}</td>
        <td><span class="badge muted">${safe(log.action_type||"")}</span>${log.cancelled_at?'<span class="badge">取消済</span>':""}</td>
        <td>${safe(log.staff||"")}</td>
        <td class="shelf-history-actions">
          <button type="button" data-shelf-cancel="${safe(log.id)}" class="secondary">取消</button>
          <button type="button" data-shelf-change="${safe(log.id)}" class="secondary">棚番変更</button>
          <button type="button" data-shelf-bulk="${safe(log.id)}" class="secondary">この時点以降を棚番変更</button>
        </td>
      </tr>`).join("");
    body.querySelectorAll("[data-shelf-cancel]").forEach(btn=>btn.onclick=()=>cancelLog(btn.dataset.shelfCancel));
    body.querySelectorAll("[data-shelf-change]").forEach(btn=>btn.onclick=()=>promptChangeFromLog(btn.dataset.shelfChange,false));
    body.querySelectorAll("[data-shelf-bulk]").forEach(btn=>btn.onclick=()=>promptChangeFromLog(btn.dataset.shelfBulk,true));
  }
  function renderStaffSelect(){
    const select=$("shelfLocationStaff");
    if(!select)return;
    const current=localStorage.getItem(STORAGE.staff)||window.currentStaffName||"";
    const label=member=>typeof getStaffDisplayName==="function" ? getStaffDisplayName(member) : (member.name||"");
    select.innerHTML='<option value="">担当者を選択</option>'+(staffMembers||[]).map(member=>`<option value="${safe(label(member))}">${safe(label(member))}</option>`).join("");
    if(current)select.value=current;
  }
  function renderShelfOptions(){
    const shelf=$("shelfLocationShelf");
    const col=$("shelfLocationColumn");
    if(shelf && !shelf.options.length){
      const shelves=[...Array.from({length:15},(_,i)=>String(i+1)),...Array.from({length:26},(_,i)=>String.fromCharCode(65+i))];
      shelf.innerHTML=shelves.map(v=>`<option value="${v}">${v}</option>`).join("");
    }
    if(col && !col.options.length){
      col.innerHTML=Array.from({length:30},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
    }
    if(shelf)shelf.value=localStorage.getItem(STORAGE.shelf)||"3";
    if(col)col.value=localStorage.getItem(STORAGE.column)||"1";
  }
  async function startShelfCamera(){
    try{
      showShelfMessage("カメラを起動しています...");
      const area=$("shelfLocationCameraArea");
      const video=$("shelfLocationVideo");
      if(area)area.hidden=false;
      if(video)video.style.display="block";
      await ensureZXing?.();
      state.camera.running=true;
      if(window.ZXing){
        const hints=new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13,ZXing.BarcodeFormat.EAN_8,ZXing.BarcodeFormat.CODE_128,ZXing.BarcodeFormat.CODE_39,ZXing.BarcodeFormat.ITF]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
        state.camera.reader=new ZXing.BrowserMultiFormatReader(hints,50);
        await state.camera.reader.decodeFromConstraints({video:{facingMode:{ideal:"environment"},width:{ideal:2560},height:{ideal:1440}}},video,async(result)=>{
          if(result&&state.camera.running)await handleShelfScannedCode(result.getText());
        });
        showShelfMessage("カメラ読取中です。バーコードを写してください。","ok");
        return;
      }
      if("BarcodeDetector"in window){
        const detector=new BarcodeDetector({formats:["ean_13","ean_8","code_128","code_39"]});
        state.camera.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
        video.srcObject=state.camera.stream;
        await video.play();
        const loop=async()=>{
          if(!state.camera.running)return;
          const codes=await detector.detect(video).catch(()=>[]);
          if(codes.length)await handleShelfScannedCode(codes[0].rawValue);
          requestAnimationFrame(loop);
        };
        loop();
        showShelfMessage("カメラ読取中です。バーコードを写してください。","ok");
        return;
      }
      showShelfMessage("このブラウザはカメラ読取に未対応です。手入力してください。","err");
    }catch(error){
      showShelfMessage("カメラ起動エラー。\nカメラ許可を確認してください。\n"+error.message,"err");
    }
  }
  async function handleShelfScannedCode(code){
    code=String(code||"").trim();
    const now=Date.now();
    if(!code || (code===state.camera.lastCode && now-state.camera.lastAt<1500))return;
    state.camera.lastCode=code;
    state.camera.lastAt=now;
    const input=$("shelfLocationBarcode");
    if(input)input.value=code;
    await stopShelfCamera(false);
    await handleBarcodeInput(code);
  }
  async function stopShelfCamera(message=true){
    state.camera.running=false;
    if(state.camera.reader){try{state.camera.reader.reset();}catch(_){}}
    if(state.camera.stream){state.camera.stream.getTracks().forEach(track=>track.stop()); state.camera.stream=null;}
    const video=$("shelfLocationVideo");
    if(video){try{video.pause();}catch(_){} video.srcObject=null; video.style.display="none";}
    const area=$("shelfLocationCameraArea");
    if(area)area.hidden=true;
    if(message)showShelfMessage("カメラを停止しました。","ok");
  }
  function bindShelfLocationEvents(){
    renderStaffSelect();
    renderShelfOptions();
    renderCurrentShelfCode();
    $("shelfLocationStaff")?.addEventListener("change",e=>{localStorage.setItem(STORAGE.staff,e.target.value); if(typeof applyStoreFromStaffValue==="function")applyStoreFromStaffValue(e.target.value);});
    $("shelfLocationShelf")?.addEventListener("change",e=>{localStorage.setItem(STORAGE.shelf,e.target.value); renderCurrentShelfCode(); renderProductInfo();});
    $("shelfLocationColumn")?.addEventListener("change",e=>{localStorage.setItem(STORAGE.column,e.target.value); renderCurrentShelfCode(); renderProductInfo();});
    $("shelfLocationPrevColumnBtn")?.addEventListener("click",()=>{setColumn(Number($("shelfLocationColumn")?.value||1)-1); showShelfMessage(`登録先を${shelfCode()}に変更しました`,"ok");});
    $("shelfLocationNextColumnBtn")?.addEventListener("click",()=>{setColumn(Number($("shelfLocationColumn")?.value||1)+1); showShelfMessage(`登録先を${shelfCode()}に変更しました`,"ok");});
    $("shelfLocationBarcode")?.addEventListener("change",e=>handleBarcodeInput(e.target.value));
    $("shelfLocationSearch")?.addEventListener("input",handleSearchInput);
    $("shelfLocationProductSearchSort")?.addEventListener("change",e=>{localStorage.setItem(STORAGE.sort,e.target.value); handleSearchInput();});
    $("shelfLocationRegisterBtn")?.addEventListener("click",registerShelfLocation);
    $("shelfLocationCameraBtn")?.addEventListener("click",startShelfCamera);
    $("shelfLocationCloseCameraBtn")?.addEventListener("click",()=>stopShelfCamera(true));
    ["shelfLocationHistoryProductFilter","shelfLocationHistoryShelfFilter","shelfLocationHistoryColumnFilter","shelfLocationHistoryStaffFilter","shelfLocationHistoryDateFilter","shelfLocationHistoryActionFilter"].forEach(id=>$(id)?.addEventListener("input",renderHistory));
    $("shelfLocationShowTodayBtn")?.addEventListener("click",()=>{state.historyMode="today"; renderHistory();});
    $("shelfLocationShowAllBtn")?.addEventListener("click",()=>{state.historyMode="all"; renderHistory();});
    loadShelfLocationLogs();
  }
  function renderShelfLocation(){
    renderStaffSelect();
    renderShelfOptions();
    renderCurrentShelfCode();
    renderProductInfo();
    loadShelfLocationLogs();
  }
  window.bindShelfLocationEvents=bindShelfLocationEvents;
  window.renderShelfLocation=renderShelfLocation;
})();
