/* ARICO TOKYO inventory app: app.js */

async function reloadAll(){
  try{
    dataLoaded=false;
    dataLoadError=false;
    showMessage("起動中...");

    products=[];

    try{
      logs=await sb("inventory_logs?select=*&order=created_at.desc&limit=1000");
    }catch(_){
      logs=[];
    }

    try{
      staffMembers=await sb("staff_members?select=*&order=name.asc");
    }catch(_){
      staffMembers=[];
    }

    await enrichRecentLogProductNames();
    dataLoaded=true;
    dataLoadError=false;
    render();
    showMessage("準備OK。商品はバーコード入力時に確認します。","ok");
  }catch(e){
    dataLoaded=false;
    dataLoadError=true;
    showMessage("起動エラー。\n"+e.message,"err");
  }
}

function bindEvents(){
  on("appPopupClose","click",hidePopup);
  on("reloadBtn","click",reloadAll);
  on("type","change",updateEquipmentMemoUi);
  on("staff","change",updateSmaregiProductImportControl);
  on("productForm","submit",saveProduct);
  on("staffForm","submit",saveStaff);

  on("manualForm","submit",e=>{
    e.preventDefault();
    registerBarcode(el("barcodeInput").value);
  });

  on("barcodeInput","input",()=>syncHistoryFromScanBarcode());
  on("productBarcode","input",()=>renderProductStockInfo());
  on("productHistoryBarcodeInput","input",()=>selectProductHistoryByBarcode());
  on("productNameSearchInput","input",handleProductNameSearchInput);
  on("productFormNameSearchInput","input",handleProductFormNameSearchInput);
  on("inventoryProductNameSearchInput","input",handleInventoryProductNameSearchInput);

  on("startCameraBtn","click",startCamera);
  on("historyCameraBtn","click",startCamera);
  on("stopCameraBtn","click",stopCamera);

  on("csvBtn","click",exportCsv);
  on("allDataCsvBtn","click",exportAllDataCsv);
  on("exportAllCsvBtn","click",exportAllDataCsv);
  on("productHistoryCsvBtn","click",exportProductHistoryCsv);
  on("csvFile","change",e=>importCsvFile(e.target.files&&e.target.files[0]));
  on("downloadSampleCsvBtn","click",downloadSampleCsv);
  on("importSmaregiProductsBtn","click",importSmaregiProducts);
  ["historyTypeFilter","historyProductFilter","historyStaffFilter","historyMemoFilter"].forEach(id=>on(id,"input",renderGlobalHistory));
  on("clearFilterBtn","click",()=>{
    ["historyTypeFilter","historyProductFilter","historyStaffFilter","historyMemoFilter"].forEach(id=>{
      const input=el(id);
      if(input)input.value="";
    });
    renderGlobalHistory();
  });

  on("showAllSelectedHistoryBtn","click",()=>showProductHistoryForBarcode(selectedBarcode));
  on("productHistoryToggleBtn","click",()=>{
    const content=el("productHistoryContent");
    const toggle=el("productHistoryToggleBtn");
    if(!content||!toggle)return;
    content.hidden=!content.hidden;
    toggle.textContent=content.hidden ? "商品別履歴を開く" : "商品別履歴を閉じる";
  });
  updateEquipmentMemoUi();
}

async function startInventoryApp(){
  if(!await checkAuthOrRedirect())return;
  inventoryAuthReady=true;
  bindEvents();
  await reloadAll();
  await loadSmaregiAccuracy();
}

startInventoryApp();
/* v58 direct bind for product history csv */
window.addEventListener("DOMContentLoaded",()=>{
  const btn=document.getElementById("productHistoryCsvBtn");
  if(btn)btn.onclick=exportProductHistoryCsv;
});
setTimeout(()=>{
  const btn=document.getElementById("productHistoryCsvBtn");
  if(btn)btn.onclick=exportProductHistoryCsv;
},500);
/* v62 all csv fallback */
window.addEventListener("DOMContentLoaded",()=>{
  ["allDataCsvBtn","exportAllCsvBtn"].forEach(id=>{
    const b=document.getElementById(id);
    if(b)b.onclick=exportAllDataCsv;
  });
  const hb=document.getElementById("historyCameraBtn");
  if(hb)hb.onclick=startCamera;
});

/* v67 product form search fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
});
setTimeout(()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
},500);

/* v68 product form search fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
});
setTimeout(()=>{
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
},500);

/* v69 product form search fallback */
function bindProductFormSearchInput(){
  const input=document.getElementById("productFormNameSearchInput");
  if(input)input.oninput=handleProductFormNameSearchInput;
}
window.addEventListener("DOMContentLoaded",bindProductFormSearchInput);
window.addEventListener("load",bindProductFormSearchInput);
setTimeout(bindProductFormSearchInput,500);
setTimeout(bindProductFormSearchInput,1500);

/* v70 popup fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const c=document.getElementById("appPopupClose");
  if(c)c.onclick=hidePopup;
});
async function showSmaregiStockCheck(){
  const card=el("smaregiStockCheckCard");
  const main=document.querySelector("main.grid");
  if(!card||!main)return;
  main.classList.add("smaregi-mode");
  card.hidden=false;
  const toggle=el("openSmaregiStockCheckBtn");
  if(toggle)toggle.textContent="在庫確認に戻る";
  renderSmaregiStockChecks();
  startSmaregiAutoRefresh();
  window.scrollTo({top:0,behavior:"smooth"});
  await loadLatestSmaregiSnapshot();
  await loadSmaregiAccuracy();
}

function hideSmaregiStockCheck(){
  const card=el("smaregiStockCheckCard");
  const main=document.querySelector("main.grid");
  if(!card||!main)return;
  card.hidden=true;
  if(el("smaregiDiffOnlyPanel"))el("smaregiDiffOnlyPanel").hidden=true;
  if(el("smaregiReasonSummaryPanel"))el("smaregiReasonSummaryPanel").hidden=true;
  main.classList.remove("smaregi-mode");
  stopSmaregiAutoRefresh();
  const toggle=el("openSmaregiStockCheckBtn");
  if(toggle)toggle.textContent="スマレジ変動商品チェック";
  window.scrollTo({top:0,behavior:"smooth"});
}

function toggleSmaregiStockCheck(){
  if(el("smaregiStockCheckCard")?.hidden)showSmaregiStockCheck();
  else hideSmaregiStockCheck();
}

function goToPortal(){
  stopSmaregiAutoRefresh();
  window.location.href="https://arico-portal.vercel.app/portal.html";
}

function bindSmaregiStockCheckEvents(){
  const now=new Date();
  const pad=n=>String(n).padStart(2,"0");
  const today=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const monthStart=`${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
  ["smaregiDiffCsvFromDate","smaregiReasonFromDate"].forEach(id=>{if(el(id)&&!el(id).value)el(id).value=monthStart;});
  ["smaregiDiffCsvToDate","smaregiReasonToDate"].forEach(id=>{if(el(id)&&!el(id).value)el(id).value=today;});
  on("openSmaregiStockCheckBtn","click",toggleSmaregiStockCheck);
  on("portalTopBtn","click",goToPortal);
  on("syncSmaregiStockBtn","click",e=>runWithSmaregiAutoRefreshPaused(syncSmaregiStockFromApi,{button:e.currentTarget}));
  on("refreshSmaregiChecksBtn","click",loadLatestSmaregiSnapshot);
  on("exportSmaregiCheckCsvBtn","click",()=>exportSmaregiCheckCsv(false));
  on("completeSmaregiStockCheckBtn","click",e=>runWithSmaregiAutoRefreshPaused(completeSmaregiStockCheck,{button:e.currentTarget}));
  on("resetSmaregiCompletionBtn","click",e=>runWithSmaregiAutoRefreshPaused(resetSmaregiStockCheckCompletion,{button:e.currentTarget}));
  on("aggregateSmaregiReasonSummaryBtn","click",showSmaregiReasonSummary);
  on("exportSmaregiDiffCardCsvBtn","click",()=>exportSmaregiCheckCsv(true));
  on("exportSmaregiReasonSummaryCsvBtn","click",exportSmaregiReasonSummaryCsv);
  on("smaregiCheckerName","change",e=>{
    localStorage.setItem("arico_smaregi_checker",e.target.value||"");
    updateSmaregiManagerControls();
    renderSmaregiStockChecks();
  });
  const card=el("smaregiStockCheckCard");
  if(card)card.hidden=true;
  renderSmaregiStockChecks();
}
window.addEventListener("DOMContentLoaded",bindSmaregiStockCheckEvents);

/* v71 popup close fallback */
window.addEventListener("DOMContentLoaded",()=>{
  const close=document.getElementById("appPopupClose");
  if(close)close.onclick=hidePopup;
  const popup=document.getElementById("appPopup");
  if(popup){
    popup.addEventListener("click",(e)=>{
      if(e.target===popup)hidePopup();
    });
  }
});

window.addEventListener("DOMContentLoaded",bindCameraZoomControls);
window.addEventListener("load",bindCameraZoomControls);
setTimeout(bindCameraZoomControls,500);
