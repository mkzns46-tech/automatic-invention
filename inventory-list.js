(function(){
  const PRODUCT_SELECT="barcode,name,smaregi_product_id,base_stock,location,price,category,genre,department,created_at";
  const STORAGE_SELECT="id,store_code,barcode,product_name,storage_qty,updated_at";
  const PAGE_SIZE=300;
  const state={
    rows:[],
    filtered:[],
    renderLimit:PAGE_SIZE,
    loading:false,
    bound:false,
    selected:new Set(),
    drafts:new Map()
  };

  function byId(id){return document.getElementById(id);}
  function text(value){return String(value??"").trim();}
  function num(value){
    const n=Number(value||0);
    return Number.isFinite(n)?n:0;
  }
  function safeEsc(value){
    return typeof esc==="function"?esc(value):String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }
  function currentStoreCode(){
    if(typeof getCurrentSmaregiContext==="function"){
      const context=getCurrentSmaregiContext();
      if(context?.storeCode)return String(context.storeCode).toLowerCase();
    }
    return String(window.currentStore||"tokyo").toLowerCase();
  }
  function currentStoreLabel(){
    const code=currentStoreCode();
    if(typeof getStoreInfoByCode==="function"){
      const info=getStoreInfoByCode(code);
      if(info?.label)return `${info.label}店`;
    }
    return code;
  }
  function formatDateTime(value){
    if(!value)return "-";
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return String(value);
    return date.toLocaleString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  }
  function maxDate(a,b){
    return [a,b].filter(Boolean).sort().pop()||"";
  }
  function shelfLabel(product){
    if(typeof getProductShelfLabel==="function"){
      try{return getProductShelfLabel(product)||"棚番未設定";}catch(_){}
    }
    return text(product?.location)||"棚番未設定";
  }
  function isAdmin(){
    try{return typeof isInventoryAdminAuthenticated==="function"&&isInventoryAdminAuthenticated();}catch(_){return false;}
  }
  function message(textValue,kind=""){
    const node=byId("inventoryListMessage");
    if(!node)return;
    node.className=`message ${kind||""}`.trim();
    node.textContent=textValue||"";
  }
  async function fetchProducts(){
    return await sbAll(`products?select=${PRODUCT_SELECT}&order=name.asc`,1000,30000);
  }
  async function fetchEventStorage(storeCode){
    const rows=typeof loadBoothCurrentEventStorageRows==="function"
      ? await loadBoothCurrentEventStorageRows(storeCode)
      : await sbAll(`event_storage_stocks?select=${STORAGE_SELECT}&store_code=eq.${encodeURIComponent(storeCode)}&order=product_name.asc`,1000,30000);
    const map=new Map();
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const barcode=text(row.barcode);
      const quantity=num(row.quantity??row.storage_qty);
      if(!barcode||quantity===0)return;
      const current=map.get(barcode)||{barcode,quantity:0,product_name:""};
      current.quantity+=quantity;
      if(!current.product_name&&row.product_name)current.product_name=row.product_name;
      map.set(barcode,current);
    });
    return map;
  }
  function normalizeProductRow(product,storage){
    const barcode=text(product?.barcode||storage?.barcode);
    const baseStock=num(product?.base_stock);
    const eventStock=num(storage?.quantity);
    const comparisonStock=baseStock+eventStock;
    const row={
      barcode,
      name:text(product?.name||storage?.product_name||"商品名未登録"),
      productCode:text(product?.smaregi_product_id),
      shelf:shelfLabel(product||{}),
      baseStock,
      eventStock,
      comparisonStock,
      storageId:storage?.id||"",
      updatedAt:storage?.updated_at||"",
      rawProduct:product||null,
      searchText:""
    };
    row.searchText=[
      row.name,
      row.barcode,
      row.productCode,
      row.shelf
    ].join(" ").toLowerCase();
    return row;
  }
  async function loadInventoryListData(showSuccess=false){
    if(state.loading)return;
    const card=byId("inventoryListCard");
    if(!card||card.hidden)return;
    state.loading=true;
    message("在庫一覧を読み込み中...");
    const badge=byId("inventoryListStoreBadge");
    if(badge)badge.textContent=`店舗：${currentStoreLabel()}`;
    try{
      const storeCode=currentStoreCode();
      const [productRows,storageMap]=await Promise.all([fetchProducts(),fetchEventStorage(storeCode)]);
      const rows=[];
      const seen=new Set();
      (Array.isArray(productRows)?productRows:[]).forEach(product=>{
        const barcode=text(product.barcode);
        if(!barcode)return;
        rows.push(normalizeProductRow(product,storageMap.get(barcode)));
        seen.add(barcode);
      });
      storageMap.forEach(storage=>{
        if(!seen.has(storage.barcode)){
          rows.push(normalizeProductRow(null,storage));
        }
      });
      state.rows=rows;
      state.renderLimit=PAGE_SIZE;
      applyInventoryListFilterSort();
      message(showSuccess?"在庫一覧を更新しました。":"");
    }catch(error){
      state.rows=[];
      state.filtered=[];
      renderInventoryListRows();
      message(`在庫一覧を読み込めませんでした。\n${error.message||error}`,"err");
    }finally{
      state.loading=false;
    }
  }
  function filterMatches(row,filter){
    if(filter==="has_stock")return row.comparisonStock>0;
    if(filter==="zero")return row.comparisonStock===0;
    if(filter==="base_stock")return row.baseStock>0;
    if(filter==="event_stock")return row.eventStock>0;
    if(filter==="no_shelf")return !row.shelf||row.shelf==="棚番未設定"||row.shelf==="未登録";
    if(filter==="negative")return row.baseStock<0||row.eventStock<0||row.comparisonStock<0;
    return true;
  }
  function sortRows(rows,sortKey){
    const collator=new Intl.Collator("ja-JP",{numeric:true,sensitivity:"base"});
    const textCompare=(a,b)=>collator.compare(a||"",b||"");
    const sorted=[...rows];
    sorted.sort((a,b)=>{
      if(sortKey==="barcode")return textCompare(a.barcode,b.barcode)||textCompare(a.name,b.name);
      if(sortKey==="shelf")return textCompare(a.shelf,b.shelf)||textCompare(a.name,b.name);
      if(sortKey==="base_desc")return b.baseStock-a.baseStock||textCompare(a.name,b.name);
      if(sortKey==="event_desc")return b.eventStock-a.eventStock||textCompare(a.name,b.name);
      if(sortKey==="comparison_desc")return b.comparisonStock-a.comparisonStock||textCompare(a.name,b.name);
      return textCompare(a.name,b.name)||textCompare(a.barcode,b.barcode);
    });
    return sorted;
  }
  function applyInventoryListFilterSort(){
    const query=text(byId("inventoryListSearchInput")?.value).toLowerCase();
    const filter=byId("inventoryListFilter")?.value||"all";
    const sortKey=byId("inventoryListSort")?.value||"name";
    state.filtered=sortRows(state.rows.filter(row=>(!query||row.searchText.includes(query))&&filterMatches(row,filter)),sortKey);
    state.renderLimit=Math.min(Math.max(state.renderLimit,PAGE_SIZE),Math.max(state.filtered.length,PAGE_SIZE));
    renderInventoryListRows();
  }
  function summaryHtml(){
    const rows=state.filtered;
    const totalBase=rows.reduce((sum,row)=>sum+effectiveBase(row),0);
    const totalEvent=rows.reduce((sum,row)=>sum+effectiveEvent(row),0);
    const totalComparison=rows.reduce((sum,row)=>sum+effectiveBase(row)+effectiveEvent(row),0);
    const negative=state.rows.filter(row=>effectiveBase(row)<0||effectiveEvent(row)<0||effectiveBase(row)+effectiveEvent(row)<0).length;
    return [
      `表示：${rows.length} / 全${state.rows.length}商品`,
      `通常棚合計：${totalBase}`,
      `イベント棚合計：${totalEvent}`,
      `比較用在庫合計：${totalComparison}`,
      `マイナス在庫：${negative}商品`
    ].map(value=>`<span>${safeEsc(value)}</span>`).join("");
  }
  function rowClass(value){
    return value<0 ? "inventory-list-negative" : "";
  }
  function draftFor(row){return state.drafts.get(row.barcode)||{base:row.baseStock,event:row.eventStock};}
  function effectiveBase(row){return draftFor(row).base;}
  function effectiveEvent(row){return draftFor(row).event;}
  function isDirty(row){const draft=draftFor(row);return draft.base!==row.baseStock||draft.event!==row.eventStock;}
  function changedRows(){return state.rows.filter(isDirty);}
  function inlineNumber(row,kind){
    const value=kind==="base"?effectiveBase(row):effectiveEvent(row);
    return `<input class="inventory-list-inline-input${isDirty(row)?" is-dirty":""}" data-inline-stock="${kind}" data-inline-barcode="${safeEsc(row.barcode)}" type="number" step="1" inputmode="numeric" value="${safeEsc(value)}" aria-label="${kind==="base"?"通常棚":"イベント棚"} ${safeEsc(row.name)}">`;
  }
  function changedMark(row,kind){
    if(!isDirty(row))return "";
    const before=kind==="base"?row.baseStock:row.eventStock;
    const next=kind==="base"?effectiveBase(row):effectiveEvent(row);
    return `<small class="inventory-list-changed-note">変更あり（元値：${safeEsc(before)}）</small>`;
  }
  function renderTableRow(row){
    const admin=isAdmin()&&row.barcode;
    const base=effectiveBase(row), event=effectiveEvent(row), comparison=base+event;
    return `<tr>
      <td class="inventory-list-name-cell">${admin?`<input type="checkbox" data-inventory-list-select="${safeEsc(row.barcode)}" ${state.selected.has(row.barcode)?"checked":""} aria-label="${safeEsc(row.name)}を選択">`:""}<strong>${safeEsc(row.name)}</strong></td>
      <td>${safeEsc(row.barcode)}</td>
      <td>${safeEsc(row.productCode||"-")}</td>
      <td>${safeEsc(row.shelf||"-")}</td>
      <td class="${rowClass(base)}">${admin?inlineNumber(row,"base"):safeEsc(base)}${changedMark(row,"base")}</td>
      <td class="${rowClass(event)}">${admin?inlineNumber(row,"event"):safeEsc(event)}${changedMark(row,"event")}</td>
      <td class="${rowClass(comparison)}" data-inline-comparison="${safeEsc(row.barcode)}">${safeEsc(comparison)}</td>
      <td>${admin?"一覧上で編集":"-"}</td>
    </tr>`;
  }
  function renderCard(row){
    const admin=isAdmin()&&row.barcode;
    const base=effectiveBase(row), event=effectiveEvent(row), comparison=base+event;
    return `<article class="inventory-list-card">
      ${admin?`<label><input type="checkbox" data-inventory-list-select="${safeEsc(row.barcode)}" ${state.selected.has(row.barcode)?"checked":""}>選択</label>`:""}
      <div><strong>${safeEsc(row.name)}</strong><small>バーコード：${safeEsc(row.barcode)}</small><small>棚番：${safeEsc(row.shelf||"-")}</small></div>
      <dl>
        <div><dt>通常棚</dt><dd class="${rowClass(base)}">${admin?inlineNumber(row,"base"):safeEsc(base)}${changedMark(row,"base")}</dd></div>
        <div><dt>イベント棚</dt><dd class="${rowClass(event)}">${admin?inlineNumber(row,"event"):safeEsc(event)}${changedMark(row,"event")}</dd></div>
        <div><dt>比較用</dt><dd class="${rowClass(comparison)}" data-inline-comparison="${safeEsc(row.barcode)}">${safeEsc(comparison)}</dd></div>
      </dl>
    </article>`;
  }
  function renderInventoryListRows(){
    const summary=byId("inventoryListSummary");
    if(summary)summary.innerHTML=summaryHtml();
    const visible=state.filtered.slice(0,state.renderLimit);
    const body=byId("inventoryListTableBody");
    if(body)body.innerHTML=visible.map(renderTableRow).join("")||`<tr><td colspan="8">条件に一致する商品はありません。</td></tr>`;
    const cards=byId("inventoryListCards");
    if(cards)cards.innerHTML=visible.map(renderCard).join("")||`<div class="booth-empty">条件に一致する商品はありません。</div>`;
    const toolbar=byId("inventoryListBulkToolbar");
    if(toolbar)toolbar.hidden=!isAdmin();
    const count=byId("inventoryListSelectedCount");
    if(count)count.textContent=`選択：${state.selected.size}件`;
    const changed=changedRows();
    const changedCount=byId("inventoryListChangedCount");
    if(changedCount)changedCount.textContent=changed.length?`変更：${changed.length}商品　イベント棚差分：${changed.reduce((sum,row)=>sum+effectiveEvent(row)-row.eventStock,0)}`:"変更なし";
    const save=byId("inventoryListInlineSaveBtn"), discard=byId("inventoryListInlineDiscardBtn");
    if(save)save.disabled=!changed.length||changed.some(row=>effectiveBase(row)<0||effectiveEvent(row)<0);
    if(discard)discard.disabled=!changed.length;
    const more=byId("inventoryListMoreBtn");
    if(more){
      more.hidden=state.renderLimit>=state.filtered.length;
      more.textContent=`さらに表示（${Math.min(PAGE_SIZE,state.filtered.length-state.renderLimit)}件）`;
    }
  }
  function renderBulkPanel(){
    const panel=byId("inventoryListBulkPanel");
    if(panel){panel.hidden=true;panel.innerHTML="";}
  }
  function zeroEventStocks(mode){
    const candidates=(mode==="selected"?state.rows.filter(row=>state.selected.has(row.barcode)):state.filtered.slice(0,state.renderLimit)).filter(row=>effectiveEvent(row)>0);
    if(!candidates.length){message("イベント棚在庫が正数の商品はありません。","err");return;}
    candidates.forEach(row=>state.drafts.set(row.barcode,{base:effectiveBase(row),event:0}));
    renderInventoryListRows();
    message(`画面上で${candidates.length}商品のイベント棚を0にしました。DB保存はまだです。`,`ok`);
  }
  async function saveBulkCorrection(){
    const reason=text(byId("inventoryListInlineReason")?.value)||"イベント終了後の残留在庫整理";
    const changed=changedRows();
    if(!changed.length){message("変更された商品がありません。","err");return;}
    if(changed.some(row=>effectiveBase(row)<0||effectiveEvent(row)<0)){message("マイナス在庫は保存できません。入力値を確認してください。","err");return;}
    const totalEventBefore=changed.reduce((sum,row)=>sum+row.eventStock,0);
    const totalEventAfter=changed.reduce((sum,row)=>sum+effectiveEvent(row),0);
    const ok=typeof confirmAppAction==="function"?await confirmAppAction("在庫変更確認",`対象：${changed.length}商品\n通常棚：変更なし\nイベント棚：${totalEventBefore} → ${totalEventAfter}（差分 ${totalEventAfter-totalEventBefore}）\n修正理由：${reason}`,{okText:"保存する",cancelText:"キャンセル"}):true;
    if(!ok)return;
    const storeCode=currentStoreCode(); const applied=[];
    try{
      for(const row of changed){
        const next=state.drafts.get(row.barcode); const latest=await fetchLatestInventoryRow(row.barcode);
        if(next.base!==latest.baseStock)throw new Error(`${row.name}の通常棚在庫が更新済みです。再読み込みしてください。`);
        if(next.event!==latest.eventStock)await setEventStorageStock(storeCode,row.barcode,latest.name, next.event);
        const delta=next.event-latest.eventStock;
        if(delta)await logEventStorageCorrection({storeCode,barcode:row.barcode,productName:latest.name,before:latest.eventStock,next:next.event,reason,memo:"在庫一覧上の直接編集"});
        if(delta)await sb("inventory_logs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({type:"在庫修正",staff:window.currentStaffName||"管理者",barcode:row.barcode,product_name:latest.name||row.name||"",quantity:delta,memo:["イベント棚在庫修正",reason,"在庫一覧上の直接編集"].join(" / "),store_code:storeCode,inventory_scope:"event_shelf",before_stock:latest.baseStock,after_stock:latest.baseStock,event_shelf_before:latest.eventStock,event_shelf_after:next.event,affects_smaregi:false,smaregi_delta:0})});
        applied.push(row);
      }
      state.drafts.clear();state.selected.clear();await loadInventoryListData(true);message(`${applied.length}商品を保存しました。`,`ok`);
    }catch(error){message(`保存に失敗しました。反映済み：${applied.length}商品。${error.message||error}`,"err");}
  }
  function discardInlineChanges(){state.drafts.clear();renderInventoryListRows();message("画面上の変更を破棄しました。","ok");}
  function closeEditPanel(){
    const panel=byId("inventoryListEditPanel");
    if(!panel)return;
    panel.hidden=true;
    panel.innerHTML="";
  }
  function openEditPanel(barcode){
    const row=state.rows.find(item=>item.barcode===barcode);
    const panel=byId("inventoryListEditPanel");
    if(!row||!panel)return;
    if(!isAdmin()){
      message("在庫修正は管理者認証後に実行できます。","err");
      return;
    }
    panel.hidden=false;
    panel.innerHTML=`<div class="inventory-list-edit-card" data-inventory-list-edit-card data-barcode="${safeEsc(row.barcode)}" data-before-base="${safeEsc(row.baseStock)}" data-before-event="${safeEsc(row.eventStock)}">
      <div class="inventory-list-edit-head">
        <div>
          <strong>${safeEsc(row.name)}</strong>
          <small>バーコード：${safeEsc(row.barcode)} / 商品コード：${safeEsc(row.productCode||"-")}</small>
        </div>
        <button type="button" class="secondary" data-inventory-list-cancel>閉じる</button>
      </div>
      <div class="inventory-list-edit-label">現在在庫</div>
      <div class="inventory-list-edit-current">
        <div class="inventory-stock-card inventory-stock-card-base" data-stock-card="base"><span>通常棚</span><strong>${safeEsc(row.baseStock)}</strong><small data-change-label="base">変更なし</small></div>
        <div class="inventory-stock-card inventory-stock-card-event" data-stock-card="event"><span>イベント棚</span><strong>${safeEsc(row.eventStock)}</strong><small data-change-label="event">変更なし</small></div>
        <div class="inventory-stock-card inventory-stock-card-comparison" data-stock-card="comparison"><span>比較用</span><strong data-inventory-list-comparison>${safeEsc(row.comparisonStock)}</strong><small data-change-label="comparison">修正後比較用在庫：${safeEsc(row.comparisonStock)}</small></div>
      </div>
      <div class="inventory-list-edit-label">修正入力</div>
      <div class="inventory-list-edit-stock-grid">
        <label class="inventory-stock-input-card inventory-stock-input-base" data-stock-input-card="base"><span>通常棚在庫</span><small>現在：${safeEsc(row.baseStock)}</small><input id="inventoryListEditBaseStock" type="number" step="1" inputmode="numeric" value="${safeEsc(row.baseStock)}"><em data-delta-label="base">変更なし</em></label>
        <label class="inventory-stock-input-card inventory-stock-input-event" data-stock-input-card="event"><span>イベント棚在庫</span><small>現在：${safeEsc(row.eventStock)}</small><input id="inventoryListEditEventStock" type="number" step="1" inputmode="numeric" value="${safeEsc(row.eventStock)}"><em data-delta-label="event">変更なし</em></label>
      </div>
      <label>修正理由（必須）<select id="inventoryListEditReason">
        <option value="">選択してください</option>
        <option value="実棚確認">実棚確認</option>
        <option value="入力ミス修正">入力ミス修正</option>
        <option value="過去処理漏れ">過去処理漏れ</option>
        <option value="破損">破損</option>
        <option value="移動処理漏れ">移動処理漏れ</option>
        <option value="その他">その他</option>
      </select></label>
      <label>備考<input id="inventoryListEditMemo" type="text" placeholder="任意メモ"></label>
      <div class="inventory-list-edit-actions">
        <button type="button" data-inventory-list-save="${safeEsc(row.barcode)}">在庫修正を保存</button>
        <button type="button" class="secondary" data-inventory-list-cancel>キャンセル</button>
      </div>
    </div>`;
    syncEditComparison();
    panel.scrollIntoView({behavior:"smooth",block:"nearest"});
  }

  function syncEditComparison(){
    const card=byId("inventoryListEditPanel")?.querySelector("[data-inventory-list-edit-card]");
    const baseRaw=text(byId("inventoryListEditBaseStock")?.value);
    const eventRaw=text(byId("inventoryListEditEventStock")?.value);
    const node=byId("inventoryListEditPanel")?.querySelector("[data-inventory-list-comparison]");
    if(!node)return;
    if(!/^-?\d+$/.test(baseRaw)||!/^-?\d+$/.test(eventRaw)){
      node.textContent="-";
      return;
    }
    const nextBase=Number(baseRaw);
    const nextEvent=Number(eventRaw);
    const beforeBase=Number(card?.dataset.beforeBase||0);
    const beforeEvent=Number(card?.dataset.beforeEvent||0);
    const beforeComparison=beforeBase+beforeEvent;
    const nextComparison=nextBase+nextEvent;
    node.textContent=String(nextComparison);
    const updateChange=(key,before,next)=>{
      const delta=next-before;
      const changed=delta!==0;
      const sign=delta>0?"+":"";
      const textValue=changed?`変更 ${sign}${delta}`:"変更なし";
      card?.querySelector(`[data-stock-card="${key}"]`)?.classList.toggle("is-changed",changed);
      card?.querySelector(`[data-stock-input-card="${key}"]`)?.classList.toggle("is-changed",changed);
      const changeLabel=card?.querySelector(`[data-change-label="${key}"]`);
      if(changeLabel)changeLabel.textContent=textValue;
      const deltaLabel=card?.querySelector(`[data-delta-label="${key}"]`);
      if(deltaLabel)deltaLabel.textContent=changed?`${before} → ${next}（${sign}${delta}）`:"変更なし";
    };
    updateChange("base",beforeBase,nextBase);
    updateChange("event",beforeEvent,nextEvent);
    card?.querySelector(`[data-stock-card="comparison"]`)?.classList.toggle("is-changed",beforeComparison!==nextComparison);
    const comparisonLabel=card?.querySelector(`[data-change-label="comparison"]`);
    if(comparisonLabel){
      const delta=nextComparison-beforeComparison;
      comparisonLabel.textContent=`修正後比較用在庫：${nextComparison}${delta?`（変更 ${delta>0?"+":""}${delta}）`:""}`;
    }
  }

  async function fetchLatestInventoryRow(barcode){
    const storeCode=currentStoreCode();
    const [productRows,storageMap]=await Promise.all([
      sb(`products?select=${PRODUCT_SELECT}&barcode=eq.${encodeURIComponent(barcode)}&limit=1`),
      fetchEventStorage(storeCode)
    ]);
    const product=Array.isArray(productRows)&&productRows[0]?productRows[0]:null;
    const storage=storageMap.get(text(barcode))||null;
    return normalizeProductRow(product,storage);
  }

  async function setEventStorageStock(storeCode,barcode,productName,nextStock){
    const rows=await sb(`event_storage_stocks?select=${STORAGE_SELECT}&store_code=eq.${encodeURIComponent(storeCode)}&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
    const current=Array.isArray(rows)&&rows[0]?rows[0]:null;
    const now=new Date().toISOString();
    if(current){
      await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          product_name:productName||current.product_name||"",
          storage_qty:nextStock,
          updated_at:now
        })
      });
      return {previous:current,created:false};
    }
    const inserted=await sb("event_storage_stocks",{
      method:"POST",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify([{
        store_code:storeCode,
        barcode,
        product_name:productName||"",
        storage_qty:nextStock,
        updated_at:now
      }])
    });
    return {previous:null,created:true,inserted:Array.isArray(inserted)?inserted[0]:null};
  }

  async function restoreEventStorageStock(storeCode,barcode,previous,created){
    const rows=await sb(`event_storage_stocks?select=id&store_code=eq.${encodeURIComponent(storeCode)}&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
    const current=Array.isArray(rows)&&rows[0]?rows[0]:null;
    if(created){
      if(current)await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
      return;
    }
    if(previous&&current){
      await sb(`event_storage_stocks?id=eq.${encodeURIComponent(current.id)}`,{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          product_name:previous.product_name||"",
          storage_qty:Number(previous.storage_qty||0),
          updated_at:previous.updated_at||new Date().toISOString()
        })
      });
    }
  }

  async function logEventStorageCorrection({storeCode,barcode,productName,before,next,reason,memo}){
    const delta=next-before;
    await sb("event_storage_movements",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify([{
        event_id:null,
        store_code:storeCode,
        smaregi_product_id:null,
        barcode,
        product_name:productName||"",
        movement_type:"adjustment",
        quantity:Math.abs(delta),
        staff:window.currentStaffName||"管理者",
        memo:["イベント棚在庫修正",`${before} -> ${next}`,`差分 ${delta}`,reason,memo].filter(Boolean).join(" / "),
        before_qty:before,
        after_qty:next
      }])
    });
  }

  async function saveStockCorrection(barcode,button){
    if(!isAdmin()){
      message("在庫修正は管理者認証後に実行できます。","err");
      return;
    }
    const baseRaw=text(byId("inventoryListEditBaseStock")?.value);
    const eventRaw=text(byId("inventoryListEditEventStock")?.value);
    if(!/^-?\d+$/.test(baseRaw)||!/^-?\d+$/.test(eventRaw)){
      message("修正後在庫は整数で入力してください。","err");
      return;
    }
    const reason=text(byId("inventoryListEditReason")?.value);
    if(!reason){
      message("修正理由を入力してください。","err");
      return;
    }
    const memo=text(byId("inventoryListEditMemo")?.value);
    const nextBase=Number(baseRaw);
    const nextEvent=Number(eventRaw);
    const latestRow=await fetchLatestInventoryRow(barcode);
    const latest=latestRow.rawProduct;
    const beforeBase=num(latestRow.baseStock);
    const beforeEvent=num(latestRow.eventStock);
    const baseChanged=beforeBase!==nextBase;
    const eventChanged=beforeEvent!==nextEvent;
    if(!baseChanged&&!eventChanged){
      message("在庫数が変わっていません。","err");
      return;
    }
    if(baseChanged&&!latest){
      message("通常棚を修正する商品マスターが見つかりません。イベント棚だけ修正できます。","err");
      return;
    }
    if(nextEvent<0){
      const negativeOk=typeof confirmAppAction==="function"
        ? await confirmAppAction("イベント棚在庫がマイナスになります",`イベント棚在庫：${beforeEvent} → ${nextEvent}\nこのまま保存しますか？`,{okText:"保存",cancelText:"キャンセル"})
        : window.confirm(`イベント棚在庫がマイナスになります。\n${beforeEvent} → ${nextEvent}\n保存しますか？`);
      if(!negativeOk)return;
    }
    const body=[
      latestRow.name||barcode,
      baseChanged?`通常棚在庫：${beforeBase} → ${nextBase}（差分 ${nextBase-beforeBase}）`:"",
      eventChanged?`イベント棚在庫：${beforeEvent} → ${nextEvent}（差分 ${nextEvent-beforeEvent}）`:"",
      `比較用在庫：${beforeBase+beforeEvent} → ${nextBase+nextEvent}`,
      `理由：${reason}`,
      memo?`備考：${memo}`:""
    ].filter(Boolean).join("\n");
    const ok=typeof confirmAppAction==="function"
      ? await confirmAppAction("通常棚在庫を修正",body,{okText:"保存",cancelText:"キャンセル"})
      : window.confirm(body);
    if(!ok)return;
    if(button)button.disabled=true;
    let baseUpdated=false;
    let eventUpdateResult=null;
    const storeCode=currentStoreCode();
    try{
      if(baseChanged){
        await updateProductCurrentStock(barcode,nextBase);
        baseUpdated=true;
      }
      if(eventChanged){
        eventUpdateResult=await setEventStorageStock(storeCode,barcode,latestRow.name,nextEvent);
      }
      if(baseChanged){
        const logMemo=[reason,memo,`在庫一覧確認から通常棚修正（${beforeBase} → ${nextBase} / 差分 ${nextBase-beforeBase}）`].filter(Boolean).join(" / ");
        await sb("inventory_logs",{
          method:"POST",
          headers:{Prefer:"return=representation"},
          body:JSON.stringify({
            type:"在庫修正",
            staff:window.currentStaffName||"管理者",
            barcode,
            product_name:latest?.name||latestRow.name||"",
            quantity:nextBase,
            memo:logMemo,
            store_code:storeCode,
            inventory_scope:"normal",
            before_stock:beforeBase,
            after_stock:nextBase,
            event_shelf_before:beforeEvent,
            event_shelf_after:nextEvent
          })
        });
      }
      if(eventChanged){
        await logEventStorageCorrection({storeCode,barcode,productName:latestRow.name,before:beforeEvent,next:nextEvent,reason,memo});
      await sb("inventory_logs",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({type:"在庫修正",staff:window.currentStaffName||"管理者",barcode,product_name:latestRow.name||"",quantity:nextEvent-beforeEvent,memo:["イベント棚在庫修正",reason,memo].filter(Boolean).join(" / "),store_code:storeCode,inventory_scope:"event_shelf",before_stock:beforeBase,after_stock:beforeBase,event_shelf_before:beforeEvent,event_shelf_after:nextEvent,affects_smaregi:false,smaregi_delta:0})});
      }
      closeEditPanel();
      await loadInventoryListData(true);
      message("在庫を修正しました。","ok");
      if(typeof loadSmaregiDifferenceRanking==="function")setTimeout(()=>{try{loadSmaregiDifferenceRanking();}catch(_){}},0);
    }catch(error){
      if(baseUpdated){
        try{await updateProductCurrentStock(barcode,beforeBase);}catch(_){}
      }
      if(eventUpdateResult){
        try{await restoreEventStorageStock(storeCode,barcode,eventUpdateResult.previous,eventUpdateResult.created);}catch(_){}
      }
      message(`在庫修正に失敗しました。\n${error.message||error}`,"err");
    }finally{
      if(button)button.disabled=false;
    }
  }
  function exportCsv(){
    const rows=[
      ["商品名","バーコード","商品コード","棚番","通常棚在庫","イベント棚在庫","比較用在庫"],
      ...state.filtered.map(row=>[
        row.name,
        row.barcode,
        row.productCode,
        row.shelf,
        effectiveBase(row),
        effectiveEvent(row),
        effectiveBase(row)+effectiveEvent(row)
      ])
    ];
    if(typeof downloadCsvFile==="function"){
      downloadCsvFile("inventory_list.csv",rows,{excelTextColumns:[1]});
    }
  }
  function bind(){
    if(state.bound)return;
    byId("inventoryListRefreshBtn")?.addEventListener("click",()=>loadInventoryListData(true));
    byId("inventoryListCsvBtn")?.addEventListener("click",exportCsv);
    byId("inventoryListSearchInput")?.addEventListener("input",()=>{state.selected.clear();state.renderLimit=PAGE_SIZE;applyInventoryListFilterSort();});
    byId("inventoryListFilter")?.addEventListener("change",()=>{state.selected.clear();state.renderLimit=PAGE_SIZE;applyInventoryListFilterSort();});
    byId("inventoryListSort")?.addEventListener("change",()=>{state.renderLimit=PAGE_SIZE;applyInventoryListFilterSort();});
    byId("inventoryListMoreBtn")?.addEventListener("click",()=>{state.renderLimit+=PAGE_SIZE;renderInventoryListRows();});
    byId("inventoryListSelectVisibleBtn")?.addEventListener("click",()=>{state.filtered.slice(0,state.renderLimit).forEach(row=>state.selected.add(row.barcode));renderInventoryListRows();});
    byId("inventoryListClearSelectionBtn")?.addEventListener("click",()=>{state.selected.clear();renderInventoryListRows();});
    byId("inventoryListBulkEditBtn")?.addEventListener("click",renderBulkPanel);
    document.addEventListener("click",event=>{if(event.target.closest("#inventoryListBulkZeroSelectedBtn"))void zeroEventStocks("selected");if(event.target.closest("#inventoryListBulkZeroVisibleBtn"))void zeroEventStocks("visible");});
    document.addEventListener("change",event=>{const checkbox=event.target.closest("[data-inventory-list-select]");if(!checkbox)return;const barcode=checkbox.dataset.inventoryListSelect;if(checkbox.checked)state.selected.add(barcode);else state.selected.delete(barcode);renderInventoryListRows();});
    document.addEventListener("click",event=>{if(event.target.closest("#inventoryListBulkSaveBtn,#inventoryListInlineSaveBtn"))void saveBulkCorrection();if(event.target.closest("#inventoryListBulkCancelBtn"))discardInlineChanges();if(event.target.closest("#inventoryListInlineDiscardBtn"))discardInlineChanges();});
    document.addEventListener("input",event=>{
      const inline=event.target.closest("[data-inline-stock]");
      if(inline){
        const row=state.rows.find(item=>item.barcode===inline.dataset.inlineBarcode);
        const value=text(inline.value);
        if(row&&/^-?\d+$/.test(value)){
          const draft=draftFor(row);draft[inline.dataset.inlineStock]=Number(value);state.drafts.set(row.barcode,draft);
          document.querySelectorAll(`[data-inline-comparison="${CSS.escape(row.barcode)}"]`).forEach(node=>{node.textContent=String(effectiveBase(row)+effectiveEvent(row));node.classList.toggle("inventory-list-negative",effectiveBase(row)+effectiveEvent(row)<0);});
          renderInventoryListRows();
        }
        return;
      }
      if(event.target.closest("#inventoryListEditBaseStock,#inventoryListEditEventStock"))syncEditComparison();
    });
    document.addEventListener("click",event=>{
      const edit=event.target.closest("[data-inventory-list-edit]");
      if(edit){
        openEditPanel(edit.dataset.inventoryListEdit||"");
        return;
      }
      const save=event.target.closest("[data-inventory-list-save]");
      if(save){
        void saveStockCorrection(save.dataset.inventoryListSave||"",save);
        return;
      }
      if(event.target.closest("[data-inventory-list-cancel]"))closeEditPanel();
    });
    state.bound=true;
  }
  async function renderInventoryList(){
    bind();
    await loadInventoryListData(false);
  }
  window.renderInventoryList=renderInventoryList;
})();
