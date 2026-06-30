(function(){
  const STORAGE_KEY = "arico_backorder_items_v1";
  function nowIso(){ return new Date().toISOString(); }
  function makeId(){ if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); return `bo_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  function toNumber(value, fallback){ const n = Number(String(value ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : fallback; }
  function normalize(row){
    const orderQty = Math.max(0, toNumber(row.orderQty, 0));
    const receivedQty = Math.max(0, toNumber(row.receivedQty, 0));
    return {
      id: row.id || makeId(),
      source: row.source || "手動",
      orderDate: row.orderDate || "",
      orderNumber: row.orderNumber || "",
      customerName: row.customerName || "",
      productName: row.productName || "",
      variation: row.variation || "",
      productCode: row.productCode || "",
      janCode: row.janCode || "",
      orderQty,
      receivedQty,
      remainingQty: Math.max(0, orderQty - receivedQty),
      status: row.status || "未手配",
      supplier: row.supplier || "",
      staff: row.staff || "",
      arrangementDate: row.arrangementDate || "",
      expectedArrivalDate: row.expectedArrivalDate || "",
      arrivalDate: row.arrivalDate || "",
      completedDate: row.completedDate || "",
      cancelReason: row.cancelReason || "",
      memo: row.memo || "",
      duplicateKey: row.duplicateKey || "",
      sourceRaw: row.sourceRaw || {},
      createdAt: row.createdAt || nowIso(),
      updatedAt: row.updatedAt || nowIso(),
      history: Array.isArray(row.history) ? row.history : []
    };
  }
  function load(){ try { const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(rows) ? rows.map(normalize) : []; } catch(error){ console.error("[backorder] load failed", error); return []; } }
  function save(rows){ localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.map(normalize))); }
  function addHistory(row, action, detail){ const at = nowIso(); return { ...row, updatedAt: at, history: [...(row.history || []), { at, action, detail: detail || "" }] }; }
  function mergeNewRows(existingRows, incomingRows){
    const keys = new Set(existingRows.map(row => row.duplicateKey).filter(Boolean));
    const next = [...existingRows];
    let added = 0, skipped = 0;
    incomingRows.forEach(incoming => {
      const row = normalize(incoming);
      if (row.duplicateKey && keys.has(row.duplicateKey)) { skipped += 1; return; }
      next.push(addHistory(row, "新規登録", `${row.source} CSVから登録`));
      if (row.duplicateKey) keys.add(row.duplicateKey);
      added += 1;
    });
    save(next);
    return { rows: next, added, skipped };
  }
  window.BackorderStorage = { load, save, normalize, addHistory, mergeNewRows, toNumber };
})();

