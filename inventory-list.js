(function(){
  const PRODUCT_SELECT="barcode,name,smaregi_product_id,base_stock,location,price,category,genre,department,created_at";
  const STORAGE_SELECT="store_code,barcode,product_name,storage_qty";
  const PAGE_SIZE=300;
  const state={
    rows:[],
    filtered:[],
    renderLimit:PAGE_SIZE,
    loading:false,
    bound:false
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
      partNumber:"",
      color:"",
      size:"",
      shelf:shelfLabel(product||{}),
      baseStock,
      eventStock,
      comparisonStock,
      updatedAt:"",
      rawProduct:product||null,
      searchText:""
    };
    row.searchText=[
      row.name,
      row.barcode,
      row.productCode,
      row.partNumber,
      row.color,
      row.size,
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
    if(filter==="has_stock")return row.baseStock!==0||row.eventStock!==0;
    if(filter==="zero")return row.baseStock===0&&row.eventStock===0;
    if(filter==="base_stock")return row.baseStock>0;
    if(filter==="event_stock")return row.eventStock>0;
    if(filter==="no_shelf")return !row.shelf||row.shelf==="棚番未設定"||row.shelf==="未登録";
    if(filter==="negative")return row.baseStock<0;
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
    const totalBase=rows.reduce((sum,row)=>sum+row.baseStock,0);
    const totalEvent=rows.reduce((sum,row)=>sum+row.eventStock,0);
    const totalComparison=rows.reduce((sum,row)=>sum+row.comparisonStock,0);
    const negative=state.rows.filter(row=>row.baseStock<0).length;
    return [
      `表示：${rows.length} / 全${state.rows.length}商品`,
      `通常棚合計：${totalBase}`,
      `共通イベント棚合計：${totalEvent}`,
      `比較用在庫合計：${totalComparison}`,
      `マイナス在庫：${negative}商品`
    ].map(value=>`<span>${safeEsc(value)}</span>`).join("");
  }
  function rowClass(value){
    return value<0 ? "inventory-list-negative" : "";
  }
  function renderTableRow(row){
    const admin=isAdmin()&&row.rawProduct;
    return `<tr>
      <td class="inventory-list-name-cell"><strong>${safeEsc(row.name)}</strong></td>
      <td>${safeEsc(row.barcode)}</td>
      <td>${safeEsc(row.productCode||"-")}</td>
      <td>${safeEsc(row.partNumber||"-")}</td>
      <td>${safeEsc(row.color||"-")}</td>
      <td>${safeEsc(row.size||"-")}</td>
      <td>${safeEsc(row.shelf||"-")}</td>
      <td class="${rowClass(row.baseStock)}">${safeEsc(row.baseStock)}</td>
      <td>${safeEsc(row.eventStock)}</td>
      <td class="${rowClass(row.comparisonStock)}">${safeEsc(row.comparisonStock)}</td>
      <td>${admin?`<button type="button" class="secondary" data-inventory-list-edit="${safeEsc(row.barcode)}">修正</button>`:"-"}</td>
    </tr>`;
  }
  function renderCard(row){
    const admin=isAdmin()&&row.rawProduct;
    return `<article class="inventory-list-card">
      <div><strong>${safeEsc(row.name)}</strong><small>バーコード：${safeEsc(row.barcode)}</small><small>棚番：${safeEsc(row.shelf||"-")}</small></div>
      <dl>
        <div><dt>通常棚</dt><dd class="${rowClass(row.baseStock)}">${safeEsc(row.baseStock)}</dd></div>
        <div><dt>イベント棚</dt><dd>${safeEsc(row.eventStock)}</dd></div>
        <div><dt>比較用</dt><dd class="${rowClass(row.comparisonStock)}">${safeEsc(row.comparisonStock)}</dd></div>
      </dl>
      ${admin?`<button type="button" class="secondary" data-inventory-list-edit="${safeEsc(row.barcode)}">通常棚を修正</button>`:""}
    </article>`;
  }
  function renderInventoryListRows(){
    const summary=byId("inventoryListSummary");
    if(summary)summary.innerHTML=summaryHtml();
    const visible=state.filtered.slice(0,state.renderLimit);
    const body=byId("inventoryListTableBody");
    if(body)body.innerHTML=visible.map(renderTableRow).join("")||`<tr><td colspan="11">条件に一致する商品はありません。</td></tr>`;
    const cards=byId("inventoryListCards");
    if(cards)cards.innerHTML=visible.map(renderCard).join("")||`<div class="booth-empty">条件に一致する商品はありません。</div>`;
    const more=byId("inventoryListMoreBtn");
    if(more){
      more.hidden=state.renderLimit>=state.filtered.length;
      more.textContent=`さらに表示（${Math.min(PAGE_SIZE,state.filtered.length-state.renderLimit)}件）`;
    }
  }
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
    panel.innerHTML=`<div class="inventory-list-edit-grid">
      <div>
        <strong>${safeEsc(row.name)}</strong>
        <small>バーコード：${safeEsc(row.barcode)}</small>
        <small>現在の通常棚在庫：${safeEsc(row.baseStock)}</small>
        <small>共通イベント棚在庫：${safeEsc(row.eventStock)}</small>
      </div>
      <label>修正後の通常棚在庫<input id="inventoryListEditStock" type="number" step="1" inputmode="numeric" value="${safeEsc(row.baseStock)}"></label>
      <label>修正理由（必須）<input id="inventoryListEditReason" type="text" placeholder="例：棚卸差異修正"></label>
      <label>備考<input id="inventoryListEditMemo" type="text" placeholder="任意メモ"></label>
      <div class="inventory-list-edit-actions">
        <button type="button" data-inventory-list-save="${safeEsc(row.barcode)}">在庫修正を保存</button>
        <button type="button" class="secondary" data-inventory-list-cancel>閉じる</button>
      </div>
    </div>`;
    panel.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  async function saveStockCorrection(barcode,button){
    if(!isAdmin()){
      message("在庫修正は管理者認証後に実行できます。","err");
      return;
    }
    const stockRaw=text(byId("inventoryListEditStock")?.value);
    if(!/^-?\d+$/.test(stockRaw)){
      message("修正後在庫は整数で入力してください。","err");
      return;
    }
    const reason=text(byId("inventoryListEditReason")?.value);
    if(!reason){
      message("修正理由を入力してください。","err");
      return;
    }
    const memo=text(byId("inventoryListEditMemo")?.value);
    const nextStock=Number(stockRaw);
    const latestRows=await sb(`products?select=${PRODUCT_SELECT}&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
    const latest=Array.isArray(latestRows)&&latestRows[0]?latestRows[0]:null;
    if(!latest){
      message("商品マスターが見つかりません。","err");
      return;
    }
    const before=num(latest.base_stock);
    if(before===nextStock){
      message("在庫数が変わっていません。","err");
      return;
    }
    const body=[
      latest.name||barcode,
      `通常棚在庫：${before} → ${nextStock}`,
      `差分：${nextStock-before}`,
      `理由：${reason}`,
      memo?`備考：${memo}`:""
    ].filter(Boolean).join("\n");
    const ok=typeof confirmAppAction==="function"
      ? await confirmAppAction("通常棚在庫を修正",body,{okText:"保存",cancelText:"キャンセル"})
      : window.confirm(body);
    if(!ok)return;
    if(button)button.disabled=true;
    let updated=false;
    try{
      await updateProductCurrentStock(barcode,nextStock);
      updated=true;
      const logMemo=[reason,memo,`在庫一覧確認から修正（${before} → ${nextStock}）`].filter(Boolean).join(" / ");
      await sb("inventory_logs",{
        method:"POST",
        headers:{Prefer:"return=representation"},
        body:JSON.stringify({
          type:"在庫修正",
          staff:window.currentStaffName||"管理者",
          barcode,
          product_name:latest.name||"",
          quantity:nextStock,
          memo:logMemo
        })
      });
      closeEditPanel();
      await loadInventoryListData(true);
      message("通常棚在庫を修正しました。","ok");
    }catch(error){
      if(updated){
        try{await updateProductCurrentStock(barcode,before);}catch(_){}
      }
      message(`在庫修正に失敗しました。\n${error.message||error}`,"err");
    }finally{
      if(button)button.disabled=false;
    }
  }
  function exportCsv(){
    const rows=[
      ["商品名","バーコード","商品コード","品番","カラー","サイズ","棚番","通常棚在庫","共通イベント棚在庫","比較用在庫"],
      ...state.filtered.map(row=>[
        row.name,
        row.barcode,
        row.productCode,
        row.partNumber,
        row.color,
        row.size,
        row.shelf,
        row.baseStock,
        row.eventStock,
        row.comparisonStock
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
    byId("inventoryListSearchInput")?.addEventListener("input",()=>{state.renderLimit=PAGE_SIZE;applyInventoryListFilterSort();});
    byId("inventoryListFilter")?.addEventListener("change",()=>{state.renderLimit=PAGE_SIZE;applyInventoryListFilterSort();});
    byId("inventoryListSort")?.addEventListener("change",()=>{state.renderLimit=PAGE_SIZE;applyInventoryListFilterSort();});
    byId("inventoryListMoreBtn")?.addEventListener("click",()=>{state.renderLimit+=PAGE_SIZE;renderInventoryListRows();});
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
