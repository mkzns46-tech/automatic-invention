/* ARICO TOKYO inventory app: core.js */

window.addEventListener("error",(e)=>{
  try{
    if(typeof showMessage==="function")showMessage("起動エラー。\n"+(e.message||""),"err");
  }catch(_){}
});

window.addEventListener("unhandledrejection",(e)=>{
  try{
    if(typeof showMessage==="function")showMessage("通信または処理エラー。\n"+(e.reason?.message||e.reason||""),"err");
  }catch(_){}
});
const el=(id)=>document.getElementById(id);


function showPopup(title, body){
  const popup=el("appPopup");
  const t=el("appPopupTitle");
  const b=el("appPopupBody");
  if(t)t.textContent=title||"完了";
  if(b)b.textContent=body||"";
  if(popup)popup.style.display="flex";
}

function hidePopup(){
  const popup=el("appPopup");
  if(popup)popup.style.display="none";
}

function showMessage(text,type=""){
  const smaregiCard=el("smaregiStockCheckCard");
  const m=smaregiCard&&!smaregiCard.hidden ? el("smaregiMessage") : el("message");
  if(!m)return;
  m.textContent=text;
  m.className="message "+type;
}


function beep(ok=true){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.value = ok ? 880 : 220;

    gain.gain.setValueAtTime(ok ? 0.14 : 0.08, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + (ok ? 0.12 : 0.22)
    );

    setTimeout(() => {
      try{ osc.stop(); }catch(_){}
      try{ ctx.close(); }catch(_){}
    }, ok ? 140 : 240);

  } catch (_) {}
}


async function sb(path,opt={}){
  const headers={
    apikey:SUPABASE_API_KEY,
    Authorization:"Bearer "+SUPABASE_API_KEY,
    "Content-Type":"application/json",
    Accept:"application/json",
    ...(opt.headers||{})
  };

  const res=await fetch(SUPABASE_URL.replace(/\/+$/,"")+"/rest/v1/"+path,{...opt,headers});
  const text=await res.text();

  let body=null;
  try{body=text?JSON.parse(text):null;}catch{body=text;}

  if(!res.ok){
    const detail=typeof body==="object"?JSON.stringify(body):String(body||"");
    throw new Error(`Supabaseエラー ${res.status}\n${detail}`);
  }
  return body;
}

async function sbAll(path,pageSize=1000,maxRows=20000){
  const all=[];
  let offset=0;

  while(true){
    const url=path+(path.includes("?")?"&":"?")+`limit=${pageSize}&offset=${offset}`;
    const rows=await sb(url);
    if(!Array.isArray(rows))return rows;

    all.push(...rows);
    if(rows.length<pageSize)break;

    offset+=pageSize;
    if(offset>=maxRows)break;
  }
  return all;
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,(c)=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function fmt(iso){
  try{return new Date(iso).toLocaleString("ja-JP");}
  catch{return iso;}
}

function gp(barcode){
  return products.find(p=>String(p.barcode)===String(barcode));
}

async function fetchProductByBarcode(barcode){
  barcode=String(barcode||"").trim();
  if(!barcode)return null;

  const cached=gp(barcode);
  if(cached)return cached;

  const rows=await sb(`products?select=*&barcode=eq.${encodeURIComponent(barcode)}&limit=1`);
  const p=Array.isArray(rows)&&rows.length?rows[0]:null;

  if(p&&!gp(p.barcode)){
    products.push(p);
  }

  return p;
}

function getCurrentStock(barcode){
  const p=gp(barcode);
  return Number(p?.base_stock||0);
}

function downloadCsvFile(filename,rows){
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  a.style.display="none";
  document.body.appendChild(a);
  setTimeout(()=>{
    a.click();
    setTimeout(()=>{
      try{document.body.removeChild(a);}catch(_){}
      URL.revokeObjectURL(url);
    },1000);
  },0);
}



function on(id,event,fn){
  const x=el(id);
  if(x)x.addEventListener(event,fn);
}

/* ===== v50 Japanese / Korean UI toggle ===== */
const I18N = {
  ja: {
    "ARICO TOKYO 在庫確認アプリ":"ARICO TOKYO 在庫確認アプリ",
    
    "再読み込み":"再読み込み",
    "在庫変動登録":"在庫変動登録",
    "持ち出し・入荷・在庫修正・備品転用を記録します":"持ち出し・入荷・在庫修正・備品転用を記録します",
    "区分":"区分",
    "担当者":"担当者",
    "数量":"数量",
    "備考（自由入力・連続スキャン中は保持）":"備考（自由入力・連続スキャン中は保持）",
    "📷 カメラでバーコード読み取り":"📷 カメラでバーコード読み取り",
    "停止":"停止",
    "バーコード入力":"バーコード入力",
    "登録":"登録",
    "担当者設定":"担当者設定",
    "スマホ側の担当者プルダウンに反映されます":"スマホ側の担当者プルダウンに反映されます",
    "担当者名":"担当者名",
    "担当者を追加":"担当者を追加",
    "操作":"操作",
    "削除":"削除",
    "商品登録":"商品登録",
    "バーコード":"バーコード",
    "商品名":"商品名",
    "現在庫":"現在庫",
    "棚番":"棚番",
    "商品を登録 / 更新":"商品を登録 / 更新",
    "CSV取り込み":"CSV取り込み",
    "商品マスターをまとめて登録・更新できます":"商品マスターをまとめて登録・更新できます",
    "簡単インポート":"簡単インポート",
    "上書き対応":"上書き対応",
    "サンプルあり":"サンプルあり",
    "⬆ 追加・更新で取り込み":"⬆ 追加・更新で取り込み",
    "サンプルCSVをダウンロード":"サンプルCSVをダウンロード",
    "スマレジ商品マスター取込":"スマレジ商品マスター取込",
    "商品別履歴":"商品別履歴",
    "商品履歴検索":"商品履歴検索",
    "在庫チェック":"在庫チェック",
    "チェック記録":"チェック記録",
    "全履歴を表示":"全履歴を表示",
    "チェック以降を表示":"チェック以降を表示",
    "入力日時":"入力日時",
    "在庫数":"在庫数",
    "入荷":"入荷",
    "出荷":"出荷",
    "備品転用":"備品転用",
    "備品転用確認":"備品転用確認",
    "区分検索":"区分検索",
    "商品名検索":"商品名検索",
    "担当者検索":"担当者検索",
    "備考検索":"備考検索",
    "全体履歴":"全体履歴",
    "履歴CSV":"履歴CSV",
    "全データCSV":"全データCSV",
    "検索をクリア":"検索をクリア"
  },
  ko: {
    "ARICO TOKYO 在庫確認アプリ":"ARICO TOKYO 재고 확인 앱",
    
    "再読み込み":"다시 불러오기",
    "在庫変動登録":"재고 변동 등록",
    "持ち出し・入荷・在庫修正・備品転用を記録します":"반출・입고・재고 수정・비품 전용을 기록합니다",
    "区分":"구분",
    "担当者":"담당자",
    "数量":"수량",
    "備考（自由入力・連続スキャン中は保持）":"비고（자유 입력・연속 스캔 중 유지）",
    "📷 カメラでバーコード読み取り":"📷 카메라로 바코드 읽기",
    "停止":"정지",
    "バーコード入力":"바코드 입력",
    "登録":"등록",
    "担当者設定":"담당자 설정",
    "スマホ側の担当者プルダウンに反映されます":"스마트폰 담당자 선택 목록에 반영됩니다",
    "担当者名":"담당자명",
    "担当者を追加":"담당자 추가",
    "操作":"작업",
    "削除":"삭제",
    "商品登録":"상품 등록",
    "バーコード":"바코드",
    "商品名":"상품명",
    "現在庫":"현재 재고",
    "棚番":"선반 번호",
    "商品を登録 / 更新":"상품 등록 / 업데이트",
    "CSV取り込み":"CSV 가져오기",
    "商品マスターをまとめて登録・更新できます":"상품 마스터를 일괄 등록・업데이트합니다",
    "簡単インポート":"간단 가져오기",
    "上書き対応":"덮어쓰기 지원",
    "サンプルあり":"샘플 제공",
    "⬆ 追加・更新で取り込み":"⬆ 추가・업데이트 가져오기",
    "サンプルCSVをダウンロード":"샘플 CSV 다운로드",
    "スマレジ商品マスター取込":"스마레지 상품 마스터 가져오기",
    "商品別履歴":"상품별 이력",
    "商品履歴検索":"상품 이력 검색",
    "在庫チェック":"재고 확인",
    "チェック記録":"확인 기록",
    "全履歴を表示":"전체 이력 표시",
    "チェック以降を表示":"확인 이후 표시",
    "入力日時":"입력 일시",
    "在庫数":"작업 전 재고",
    "入荷":"입고",
    "出荷":"출고",
    "備品転用":"비품 전용",
    "備品転用確認":"비품 전용 확인",
    "区分検索":"구분 검색",
    "商品名検索":"상품명 검색",
    "担当者検索":"담당자 검색",
    "備考検索":"비고 검색",
    "全体履歴":"전체 이력",
    "履歴CSV":"이력 CSV",
    "全データCSV":"전체 데이터 CSV",
    "検索をクリア":"검색 초기화"
  }
};

const I18N_REVERSE = {};
for(const lang of Object.keys(I18N)){
  for(const [ja,ko] of Object.entries(I18N.ko)){
    I18N_REVERSE[ko]=ja;
  }
}

function getLang(){return localStorage.getItem("arico_lang")||"ja";}

function setLang(lang){
  localStorage.setItem("arico_lang",lang);
  applyLang();
}

function translateText(raw,lang){
  const t=String(raw||"").trim();
  const ja=I18N_REVERSE[t]||t;
  return I18N[lang][ja]||ja;
}

function walkTextNodes(root,lang){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(node){
      const parent=node.parentElement;
      if(!parent)return NodeFilter.FILTER_REJECT;
      if(["SCRIPT","STYLE","TEXTAREA","OPTION"].includes(parent.tagName))return NodeFilter.FILTER_REJECT;
      if(parent.closest(".table-wrap tbody"))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(node=>{
    const original=node.nodeValue;
    const trimmed=original.trim();
    if(!trimmed)return;
    const translated=translateText(trimmed,lang);
    if(translated!==trimmed){
      node.nodeValue=original.replace(trimmed,translated);
    }
  });
}

function applyPlaceholders(lang){
  const map={
    ja:{
      staffNameInput:"例：田中",
      barcodeInput:"バーコードをスキャン、または手入力",
      memo:"例：棚卸差異、サンプル使用、不良返品など",
      productBarcode:"バーコードを入力",
      productName:"商品名を必ず入力",
      location:"例：A-01",
      productHistoryBarcodeInput:"バーコードを入力またはスキャン"
    },
    ko:{
      staffNameInput:"예：다나카",
      barcodeInput:"바코드를 스캔하거나 직접 입력",
      memo:"예：재고 차이, 샘플 사용, 불량 반품 등",
      productBarcode:"바코드를 입력",
      productName:"상품명을 반드시 입력",
      location:"예：A-01",
      productHistoryBarcodeInput:"바코드를 입력 또는 스캔"
    }
  };
  const m=map[lang];
  Object.keys(m).forEach(id=>{
    const x=document.getElementById(id);
    if(x)x.placeholder=m[id];
  });
}

function applySelectLabels(lang){
  const labels=lang==="ko"
    ?{staff:"담당자를 선택"}
    :{staff:"担当者を選択"};
  const staff=document.getElementById("staff");
  if(staff&&staff.options.length)staff.options[0].textContent=labels.staff;
}

function applyLang(){
  const lang=getLang();
  walkTextNodes(document.body,lang);
  applyPlaceholders(lang);
  applySelectLabels(lang);

  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.classList.toggle("active",lang==="ja");
  if(ko)ko.classList.toggle("active",lang==="ko");
}

window.addEventListener("DOMContentLoaded",()=>{
  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.onclick=()=>setLang("ja");
  if(ko)ko.onclick=()=>setLang("ko");
  setTimeout(applyLang,50);
});


/* v51 language button fallback */
function bindLanguageButtons(){
  const ja=document.getElementById("langJaBtn");
  const ko=document.getElementById("langKoBtn");
  if(ja)ja.onclick=()=>setLang("ja");
  if(ko)ko.onclick=()=>setLang("ko");
  if(typeof applyLang==="function")applyLang();
}
window.addEventListener("load",bindLanguageButtons);
setTimeout(bindLanguageButtons,300);
