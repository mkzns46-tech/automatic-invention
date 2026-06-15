(function () {
  const SHOW_ARCHIVED_KEY = "arico_sales_show_archived_v1";

  function isArchived(record) {
    return record?.is_archived === true || record?.isArchived === true;
  }

  function showArchived() {
    try {
      return localStorage.getItem(SHOW_ARCHIVED_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setShowArchived(value) {
    try {
      localStorage.setItem(SHOW_ARCHIVED_KEY, value ? "1" : "0");
    } catch (_) {}
  }

  function shouldShow(record) {
    return showArchived() || !isArchived(record);
  }

  function markArchived(record, archived = true) {
    if (!record) return record;
    record.is_archived = !!archived;
    record.isArchived = !!archived;
    record.archivedAt = archived ? (record.archivedAt || new Date().toISOString()) : "";
    if (!archived) record.unarchivedAt = new Date().toISOString();
    return record;
  }

  function ensureToggleControls() {
    document.querySelectorAll(".list-header-actions").forEach(container => {
      if (container.querySelector("[data-sales-show-archived]")) return;
      container.insertAdjacentHTML("afterbegin", showArchivedControlHtml());
    });
  }

  function bindToggle(callback) {
    ensureToggleControls();
    document.querySelectorAll("[data-sales-show-archived]").forEach(input => {
      if (input.dataset.archiveBound === "1") return;
      input.dataset.archiveBound = "1";
      input.checked = showArchived();
      input.addEventListener("change", event => {
        setShowArchived(event.target.checked);
        document.querySelectorAll("[data-sales-show-archived]").forEach(other => {
          if (other !== event.target) other.checked = event.target.checked;
        });
        if (typeof callback === "function") callback();
      });
    });
  }

  function showArchivedControlHtml() {
    return `<label class="sales-archive-toggle"><input type="checkbox" data-sales-show-archived> 非表示データも表示</label>`;
  }

  window.SalesArchive = {
    isArchived,
    showArchived,
    setShowArchived,
    shouldShow,
    markArchived,
    bindToggle,
    ensureToggleControls,
    showArchivedControlHtml
  };
})();
