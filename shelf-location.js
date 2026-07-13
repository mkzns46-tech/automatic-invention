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
  function shelfChoices(){
    return [...Array.from({length:15},(_,i)=>String(i+1)),...Array.from({length:26},(_,i)=>String.fromCharCode(65+i))];
  }
  function columnChoices(){
    return Array.from({length:30},(_,i)=>String(i+1));
  }
  function buildShelfCode(shelf,column){
    return `${String(shelf||"").trim()}-${Math.max(1,Math.min(30,Number(column)||1))}`;
  }
  function playShelfSuccess(){
    if(typeof playSuccessSound==="function")playSuccessSound();
  }
  function isLatestOwnAddLog(log){
    if(!log || log.cancelled_at || log.action_type!=="棚番追加")return false;
    const staff=staffName();
    if(!staff || log.staff!==staff)return false;
    const latest=state.logs
      .filter(row=>!row.cancelled_at && row.staff===staff && row.action_type==="棚番追加")
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
    return latest && String(latest.id)===String(log.id);
  }
  function canCancelLog(log){
    return !!log && !log.cancelled_at && log.action_type!=="取消" && (isAdmin() || isLatestOwnAddLog(log));
  }
  function canUseAdminHistoryAction(log){
    return !!log && !log.cancelled_at && log.action_type!=="取消" && !!log.after_shelf_code && isAdmin();
  }
  function requestShelfSelection({title,summary="",initialShelf=null,initialColumn=null,confirmText="実行"}={}){
    return new Promise(resolve=>{
      const overlay=document.createElement("div");
      overlay.className="shelf-location-dialog-backdrop";
      const shelves=shelfChoices();
      const columns=columnChoices();
      const current=normalizeShelfCode(initialShelf&&initialColumn?buildShelfCode(initialShelf,initialColumn):shelfCode())||shelfCode();
      const [currentShelf,currentColumn]=current.split("-");
      overlay.innerHTML=`
        <div class="shelf-location-dialog" role="dialog" aria-modal="true">
          <h3>${safe(title||"棚番を選択")}</h3>
          <div class="shelf-location-dialog-summary">${summary}</div>
          <div class="shelf-location-dialog-grid">
            <label>棚<select data-shelf-dialog-shelf>${shelves.map(v=>`<option value="${v}" ${v===currentShelf?"selected":""}>${v}</option>`).join("")}</select></label>
            <label>列<select data-shelf-dialog-column>${columns.map(v=>`<option value="${v}" ${v===String(Number(currentColumn||1))?"selected":""}>${v}</option>`).join("")}</select></label>
            <div class="shelf-location-dialog-target">変更先：<strong data-shelf-dialog-target></strong></div>
          </div>
          <div class="button-row shelf-location-dialog-actions">
            <button type="button" class="secondary" data-shelf-dialog-cancel>キャンセル</button>
            <button type="button" data-shelf-dialog-ok>${safe(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const shelfSelect=overlay.querySelector("[data-shelf-dialog-shelf]");
      const columnSelect=overlay.querySelector("[data-shelf-dialog-column]");
      const target=overlay.querySelector("[data-shelf-dialog-target]");
      const update=()=>{target.textContent=buildShelfCode(shelfSelect.value,columnSelect.value);};
      const close=value=>{overlay.remove(); resolve(value);};
      shelfSelect.addEventListener("change",update);
      columnSelect.addEventListener("change",update);
      overlay.querySelector("[data-shelf-dialog-cancel]").onclick=()=>close("");
      overlay.querySelector("[data-shelf-dialog-ok]").onclick=()=>close(buildShelfCode(shelfSelect.value,columnSelect.value));
      update();
      shelfSelect.focus();
    });
  }
  function requestPrimaryReplacement(loc,others){
    return new Promise(resolve=>{
      const overlay=document.createElement("div");
      overlay.className="shelf-location-dialog-backdrop";
      overlay.innerHTML=`
        <div class="shelf-location-dialog" role="dialog" aria-modal="true">
          <h3>次の主棚番を選択してください</h3>
          <div class="shelf-location-dialog-summary">
            <p>この棚番は主棚番です。削除後に主棚番にする棚番を選択してください。</p>
            <p><strong>削除する棚番：</strong>${safe(loc.shelf_code)}</p>
          </div>
          <label>次の主棚番
            <select data-shelf-primary-next>${others.map(row=>`<option value="${safe(row.id)}">${safe(row.shelf_code)}</option>`).join("")}</select>
          </label>
          <div class="button-row shelf-location-dialog-actions">
            <button type="button" class="secondary" data-shelf-dialog-cancel>キャンセル</button>
            <button type="button" class="danger" data-shelf-dialog-ok>削除して主棚番を変更</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const select=overlay.querySelector("[data-shelf-primary-next]");
      const close=value=>{overlay.remove(); resolve(value);};
      overlay.querySelector("[data-shelf-dialog-cancel]").onclick=()=>close("");
      overlay.querySelector("[data-shelf-dialog-ok]").onclick=()=>close(select.value);
      select.focus();
    });
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
        <div class="shelf-summary-hero"><span>現在の登録先</span><strong>${safe(code)}</strong></div>
        <div><span>今回</span><strong>${atCode.length}件</strong></div>
        <div class="shelf-summary-last-product"><span>最終商品</span><strong>${safe(last?.product_name||"-")}</strong></div>
        <div><span>最終登録</span><strong>${last?.created_at?fmt(last.created_at):"-"}</strong></div>
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
    const admin=isAdmin();
    const current=state.locations.length
      ? state.locations.map(loc=>`<li><span>${safe(loc.shelf_code)}${loc.is_primary?"（主棚番）":""}</span>${admin?` <button type="button" class="secondary" data-shelf-primary="${safe(loc.id)}">主棚番に設定</button> <button type="button" class="danger" data-shelf-delete="${safe(loc.id)}">削除</button>`:""}</li>`).join("")
      : "<li>未登録</li>";
    box.innerHTML=`
      <div class="shelf-product-info">
        <strong>${safe(product.name||product.product_name||"商品名なし")}</strong>
        <span>棚番：${safe(getProductShelfLabel(product,state.locations))}</span>
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
          <span>棚番：${safe(getProductShelfLabel(product))}</span>
          <span>バーコード：${safe(product.barcode||"なし")}</span>
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
      body:JSON.stringify({location})
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
    const staff=staffName()||"管理者";
    const others=state.locations.filter(row=>String(row.id)!==String(locationId));
    let nextPrimary=null;
    if(loc.is_primary && others.length){
      const nextId=await requestPrimaryReplacement(loc,others);
      if(!nextId)return;
      nextPrimary=others.find(row=>String(row.id)===String(nextId));
      if(!nextPrimary){showShelfMessage("次の主棚番が見つかりません。","err"); return;}
      if(!confirm(`${loc.shelf_code}を削除し、${nextPrimary.shelf_code}を主棚番にします。よろしいですか？`))return;
    }else if(!confirm(`${loc.shelf_code}を削除します。よろしいですか？`)){
      return;
    }
    try{
      if(nextPrimary){
        await sb(`product_locations?barcode=eq.${encodeURIComponent(loc.barcode)}`,{method:"PATCH",body:JSON.stringify({is_primary:false,updated_by:staff,updated_at:new Date().toISOString()})});
        await sb(`product_locations?id=eq.${encodeURIComponent(nextPrimary.id)}`,{method:"PATCH",body:JSON.stringify({is_primary:true,updated_by:staff,updated_at:new Date().toISOString()})});
        await sb(`product_locations?id=eq.${encodeURIComponent(loc.id)}`,{method:"DELETE"});
        await patchProductLocation(state.product,nextPrimary.shelf_code);
      }else{
        await sb(`product_locations?id=eq.${encodeURIComponent(loc.id)}`,{method:"DELETE"});
        if(loc.is_primary)await patchProductLocation(state.product,"");
      }
    }catch(error){
      if(nextPrimary){
        await sb(`product_locations?id=eq.${encodeURIComponent(loc.id)}`,{method:"PATCH",body:JSON.stringify({is_primary:true,updated_by:staff,updated_at:new Date().toISOString()})}).catch(()=>null);
        await patchProductLocation(state.product,loc.shelf_code).catch(()=>null);
      }
      showShelfMessage("棚番削除エラー。\n"+error.message,"err");
      return;
    }
    await insertLocationLog({product_id:state.product.id||null,barcode:loc.barcode,product_name:state.product.name||"",action_type:"棚番削除",before_shelf_code:loc.shelf_code,after_shelf_code:nextPrimary?.shelf_code||"",staff});
    await selectProduct(state.product);
    await loadShelfLocationLogs();
    showShelfMessage(`${loc.shelf_code}を削除しました`,"ok");
  }
  async function cancelLog(logId){
    const log=state.logs.find(row=>String(row.id)===String(logId));
    if(!log)return;
    if(log.cancelled_at){showShelfMessage("この履歴は取消済みです。","err"); return;}
    const currentStaff=staffName();
    if(!canCancelLog(log)){
      if(isAdmin())showShelfMessage("取消できない履歴です。","err");
      else showShelfMessage("通常担当者が取消できるのは、自分の直前の棚番追加のみです。","err");
      return;
    }
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
    if(!requireAdmin())return;
    if(log.cancelled_at){showShelfMessage("取消済み履歴は変更できません。","err"); return;}
    const [initialShelf,initialColumn]=String(log.after_shelf_code||shelfCode()).split("-");
    const normalized=await requestShelfSelection({
      title:bulk ? "この時点以降を棚番変更" : "棚番変更",
      initialShelf,
      initialColumn,
      summary:bulk
        ? `<p>変更元：<strong>${safe(log.after_shelf_code||"")}</strong></p><p>対象条件：同じ担当者、同じ作業日、同じ変更前棚番、選択した履歴日時以降</p>`
        : `<p><strong>${safe(log.product_name||"")}</strong></p><p>棚番：${safe(log.after_shelf_code||"棚番未設定")}</p><p>バーコード：${safe(log.barcode||"")}</p><p>変更前棚番：${safe(log.after_shelf_code||"")}</p><p>担当者：${safe(log.staff||"")}</p>`,
      confirmText:"変更先を選択"
    });
    if(!normalized){showShelfMessage("棚番形式が正しくありません","err"); return;}
    const staff=staffName()||"担当者";
    if(!bulk){
      const product=await findProductByCode(log.barcode);
      if(!confirm(`棚番を変更します。\n\n商品名：${product?.name||log.product_name||""}\n棚番：${getProductShelfLabel(product)}\nバーコード：${log.barcode||""}\n変更前棚番：${log.after_shelf_code||""}\n変更後棚番：${normalized}\n担当者：${staff}`))return;
      const ok=await changeProductShelf(product,log.after_shelf_code,normalized,staff);
      if(ok)showShelfMessage(`${product.name||log.product_name}を${normalized}へ変更しました`,"ok");
    }else{
      const day=String(log.created_at||"").slice(0,10);
      const targets=state.logs.filter(row=>!row.cancelled_at && row.staff===log.staff && String(row.created_at||"").slice(0,10)===day && row.after_shelf_code===log.after_shelf_code && new Date(row.created_at)>=new Date(log.created_at));
      const names=targets.map(row=>`・${row.product_name||row.barcode}`).join("\n");
      const start=targets[targets.length-1]?.created_at||log.created_at;
      const end=targets[0]?.created_at||log.created_at;
      if(!confirm(`一括棚番変更を実行します。\n\n変更前棚番：${log.after_shelf_code}\n変更後棚番：${normalized}\n対象件数：${targets.length}件\n対象担当者：${log.staff||""}\n対象日時範囲：${fmt(start)} ～ ${fmt(end)}\n\n${names}`))return;
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
      if(body)body.innerHTML=`<tr><td colspan="6">棚番履歴テーブルを確認してください：${safe(error.message)}</td></tr>`;
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
    $("shelfLocationShowTodayBtn")?.classList.toggle("is-active",state.historyMode==="today");
    $("shelfLocationShowAllBtn")?.classList.toggle("is-active",state.historyMode==="all");
    if(!body)return;
    if(!rows.length){
      body.innerHTML='<tr><td colspan="6">履歴はありません。</td></tr>';
      return;
    }
    body.innerHTML=rows.map(log=>{
      const actions=[];
      if(canCancelLog(log))actions.push(`<button type="button" data-shelf-cancel="${safe(log.id)}" class="secondary">取消</button>`);
      if(canUseAdminHistoryAction(log)){
        actions.push(`<button type="button" data-shelf-change="${safe(log.id)}" class="secondary">棚番変更</button>`);
        actions.push(`<button type="button" data-shelf-bulk="${safe(log.id)}" class="secondary">この時点以降を変更</button>`);
      }
      const product={name:log.product_name||"",barcode:log.barcode||"",location:log.after_shelf_code||log.before_shelf_code||""};
      const actionClass=String(log.action_type||"").includes("削除")?"is-delete":String(log.action_type||"").includes("主棚番")?"is-primary":String(log.action_type||"").includes("取消")?"is-cancel":String(log.action_type||"").includes("一括")?"is-bulk":"is-add";
      return `
      <tr class="${log.cancelled_at?"is-cancelled":""}">
        <td>${fmt(log.created_at)}</td>
        <td class="shelf-history-product">${buildProductIdentityHtml(product)}</td>
        <td class="shelf-history-change"><span class="shelf-before">${safe(log.before_shelf_code||"未登録")}</span><span class="shelf-arrow">↓</span><span class="shelf-after">${safe(log.after_shelf_code||"")}</span></td>
        <td><span class="shelf-action-badge ${actionClass}">${safe(log.action_type||"")}</span>${log.cancelled_at?'<span class="shelf-action-badge is-cancelled">取消済み</span>':""}</td>
        <td>${safe(log.staff||"")}</td>
        <td class="shelf-history-actions">${actions.join("")||'<span class="muted-text">操作なし</span>'}</td>
      </tr>`;
    }).join("");
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
      shelf.innerHTML=shelfChoices().map(v=>`<option value="${v}">${v}</option>`).join("");
    }
    if(col && !col.options.length){
      col.innerHTML=columnChoices().map(v=>`<option value="${v}">${v}</option>`).join("");
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
