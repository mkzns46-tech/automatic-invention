function showSalesMessage(text, type) {
  const box = document.getElementById("salesMessage");
  if (!box) return;
  box.textContent = text || "";
  box.className = "message" + (type === "err" ? " err" : type === "warn" ? " warn" : type === "ok" ? " ok" : "");
}

function playSalesNoticeSound(type = "ok") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = type === "err" ? 220 : type === "warn" ? 440 : 660;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.22);
  } catch (_) {}
}

function showSalesPopup(title, body, type = "ok") {
  const popup = document.getElementById("salesPopup");
  const titleEl = document.getElementById("salesPopupTitle");
  const bodyEl = document.getElementById("salesPopupBody");
  const close = document.getElementById("salesPopupClose");
  if (!popup || !titleEl || !bodyEl || !close) {
    alert(`${title}\n${body || ""}`);
    return;
  }
  titleEl.textContent = title || "完了";
  bodyEl.textContent = body || "";
  popup.dataset.type = type;
  popup.style.display = "flex";
  close.onclick = () => {
    popup.style.display = "none";
  };
  playSalesNoticeSound(type);
}

function settingsCustomerStorage() {
  return window.SalesCustomerStorage || {
    upsertSmaregiCustomers: () => ({ imported: 0, created: 0, updated: 0, skipped: 0, total: 0 })
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

const PDF_LOGO_KEY = "arico_sales_pdf_logo";
const PDF_STAMP_KEY = "arico_sales_pdf_stamp";
let staffDisplayRows = [];

function staffDisplayValue(row) {
  const localValue = window.SalesStaffDisplay?.getStaffDisplayOverride?.(row);
  if (localValue !== undefined) return String(localValue || "").trim();
  return String(
    row?.sales_display_name ||
    row?.salesDisplayName ||
    row?.sales_full_name ||
    row?.salesFullName ||
    row?.display_name ||
    row?.displayName ||
    row?.full_name ||
    row?.fullName ||
    ""
  ).trim();
}

function staffInternalName(row) {
  return window.SalesStaffDisplay?.staffOptionValue?.(row) || (row?.store_name ? `${row.name}（${row.store_name}）` : row?.name || "");
}

function staffRowPatchPath(row) {
  if (row?.id !== undefined && row?.id !== null && row?.id !== "") {
    return `staff_members?id=eq.${encodeURIComponent(row.id)}`;
  }
  const filters = [`name=eq.${encodeURIComponent(row?.name || "")}`];
  if (row?.store_name) filters.push(`store_name=eq.${encodeURIComponent(row.store_name)}`);
  return `staff_members?${filters.join("&")}`;
}

function renderStaffDisplaySettings(rows) {
  const body = document.getElementById("staffDisplaySettingsBody");
  if (!body) return;
  staffDisplayRows = Array.isArray(rows) ? rows : [];
  if (!staffDisplayRows.length) {
    body.innerHTML = '<tr><td colspan="2">スタッフ登録が見つかりません。</td></tr>';
    return;
  }
  body.innerHTML = staffDisplayRows.map((row, index) => `
    <tr>
      <td>${escapeHtml(staffInternalName(row))}</td>
      <td><input class="staff-display-input" data-staff-index="${index}" value="${escapeHtml(staffDisplayValue(row))}" placeholder="例：田中 真人"></td>
    </tr>
  `).join("");
}

async function loadStaffDisplaySettings() {
  const resultBox = document.getElementById("staffDisplayResult");
  if (resultBox) {
    resultBox.textContent = "スタッフ一覧を読み込んでいます。";
    resultBox.className = "message";
  }
  try {
    const rows = await (window.SalesStaffDisplay?.loadStaffDisplays?.() || salesFetch("staff_members?select=*&order=name.asc"));
    renderStaffDisplaySettings(rows || []);
    if (resultBox) {
      resultBox.textContent = `${(rows || []).length}件のスタッフを読み込みました。`;
      resultBox.className = "message ok";
    }
  } catch (error) {
    const message = error?.message || String(error);
    if (resultBox) {
      resultBox.textContent = message;
      resultBox.className = "message err";
    }
    showSalesPopup("読込失敗", message, "err");
  }
}

async function saveStaffDisplaySettings() {
  const resultBox = document.getElementById("staffDisplayResult");
  const inputs = Array.from(document.querySelectorAll(".staff-display-input"));
  if (!inputs.length) {
    showSalesPopup("保存できません", "スタッフ一覧を先に読み込んでください。", "warn");
    return;
  }
  if (resultBox) {
    resultBox.textContent = "担当者表示名を保存しています。";
    resultBox.className = "message";
  }
  try {
    const valuesByKey = {};
    inputs.forEach(input => {
      const row = staffDisplayRows[Number(input.dataset.staffIndex)];
      if (!row) return;
      const key = staffInternalName(row);
      if (key) valuesByKey[key] = String(input.value || "").trim();
    });
    window.SalesStaffDisplay?.saveStaffDisplayOverrides?.(staffDisplayRows, valuesByKey);

    let remoteFailed = false;
    let remoteError = "";
    for (const input of inputs) {
      const row = staffDisplayRows[Number(input.dataset.staffIndex)];
      if (!row) continue;
      const value = String(input.value || "").trim();
      try {
        await salesFetch(staffRowPatchPath(row), {
          method: "PATCH",
          body: JSON.stringify({ sales_display_name: value || null })
        });
      } catch (error) {
        remoteFailed = true;
        remoteError = error?.message || String(error);
      }
      row.sales_display_name = value;
    }
    window.SalesStaffDisplay?.buildMap?.(staffDisplayRows);
    if (resultBox) {
      resultBox.textContent = remoteFailed
        ? "アプリ内に保存しました。Supabase の sales_display_name 列が未設定の場合はDB保存のみ保留されます。"
        : "担当者表示名を保存しました。";
      resultBox.className = remoteFailed ? "message warn" : "message ok";
    }
    showSalesPopup(
      remoteFailed ? "アプリ内保存完了" : "保存完了",
      remoteFailed
        ? "販売管理用の担当者表示名をアプリ内に保存しました。ページを移動しても再表示されます。"
        : "販売管理用の担当者表示名を保存しました。",
      remoteFailed ? "warn" : "ok"
    );
  } catch (error) {
    const raw = error?.message || String(error);
    const message = raw.includes("sales_display_name")
      ? "staff_members に sales_display_name 列がありません。列を追加してから保存してください。"
      : raw;
    if (resultBox) {
      resultBox.textContent = message;
      resultBox.className = "message err";
    }
    showSalesPopup("保存失敗", message, "err");
  }
}

function bindPdfAssetSettings() {
  bindPdfAssetInput("pdfLogoInput", "pdfLogoPreview", PDF_LOGO_KEY);
  bindPdfAssetInput("pdfStampInput", "pdfStampPreview", PDF_STAMP_KEY);
  updatePdfAssetPreview("pdfLogoPreview", PDF_LOGO_KEY);
  updatePdfAssetPreview("pdfStampPreview", PDF_STAMP_KEY);
}

function bindPdfAssetInput(inputId, previewId, storageKey) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        localStorage.setItem(storageKey, String(reader.result || ""));
        updatePdfAssetPreview(previewId, storageKey);
        showSalesMessage("PDF画像設定を保存しました。", "ok");
        showSalesPopup("保存完了", "PDF画像設定を保存しました。", "ok");
      } catch (error) {
        showSalesPopup("保存失敗", error?.message || "PDF画像設定を保存できませんでした。", "err");
      }
    };
    reader.readAsDataURL(file);
  });
}

function updatePdfAssetPreview(previewId, storageKey) {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  const value = localStorage.getItem(storageKey) || "";
  preview.src = value;
  preview.hidden = !value;
}

function clearPdfAssetSettings() {
  localStorage.removeItem(PDF_LOGO_KEY);
  localStorage.removeItem(PDF_STAMP_KEY);
  updatePdfAssetPreview("pdfLogoPreview", PDF_LOGO_KEY);
  updatePdfAssetPreview("pdfStampPreview", PDF_STAMP_KEY);
  showSalesPopup("クリア完了", "PDF画像設定をクリアしました。", "ok");
}

async function importSettingsSmaregiCustomers() {
  const button = document.getElementById("customerSmaregiImportBtn");
  const resultBox = document.getElementById("customerImportResult");
  if (button) button.disabled = true;
  if (resultBox) {
    resultBox.textContent = "スマレジ会員データを取り込んでいます。";
    resultBox.className = "message";
  }
  showSalesMessage("スマレジ会員データを取り込んでいます。");
  try {
    const response = await fetch("/api/smaregi-customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const text = await response.text();
    console.log("[smaregi-customers]", response.status, text);
    if (!text) throw new Error(`API応答が空です。HTTP ${response.status}`);
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error(`JSON解析に失敗しました。HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    if (!response.ok || !data.ok) {
      throw new Error(data?.error || `スマレジ会員データ取込に失敗しました。HTTP ${response.status}`);
    }
    const result = settingsCustomerStorage().upsertSmaregiCustomers(data.customers || []);
    const skipped = Number(data.skipped || 0) + Number(result.skipped || 0);
    const skipReasons = data.diagnostics?.skipReasons || {};
    const message = [
      "スマレジ会員データを取り込みました。",
      `取得件数：${data.count || 0}件`,
      `取込可能件数：${data.importableCount || 0}件`,
      `新規：${result.created}件`,
      `更新：${result.updated}件`,
      `スキップ：${skipped}件`,
      `顧客名なし：${skipReasons.customerNameMissing || 0}件`,
      `会員コードなし：${skipReasons.smaregiMemberCodeMissing || 0}件`,
      `会員IDなし：${skipReasons.smaregiMemberIdMissing || 0}件`
    ].join("\n");
    if (resultBox) {
      resultBox.textContent = message;
      resultBox.className = "message ok";
    }
    showSalesMessage(message, "ok");
    showSalesPopup("取込完了", message, "ok");
  } catch (error) {
    const message = error?.message || String(error);
    if (resultBox) {
      resultBox.textContent = message;
      resultBox.className = "message err";
    }
    showSalesMessage(message, "err");
    showSalesPopup("取込失敗", message, "err");
  } finally {
    if (button) button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof requireSalesAuth === "function" && !requireSalesAuth()) return;
  bindPdfAssetSettings();
  loadStaffDisplaySettings();
});
