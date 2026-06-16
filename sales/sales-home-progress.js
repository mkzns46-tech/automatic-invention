const HOME_PROGRESS_KEYS = {
  quotes: "arico_sales_quotes_v1",
  invoices: "arico_sales_invoices_v1",
  deliveries: "arico_sales_deliveries_v1",
  receipts: "arico_sales_receipts_v1",
  payments: "arico_sales_payments_v1",
  customers: "arico_sales_customers_v1"
};

const HOME_TRANSACTION_OPTIONS = ["", "通常販売", "交換", "返金", "無償提供", "その他"];
const HOME_STATUS_OPTIONS = ["", "下書き", "請求書変換済", "請求書発行済", "未発行", "納品書発行済", "発送済", "手渡し済", "担当者手持ち済", "発行済", "入金待ち", "一部入金", "入金済み", "入金不要", "支払期限超過", "納品待ち", "発送待ち", "未納品", "納品済み", "キャンセル"];

const homeTicketFilters = {
  status: "",
  transaction: "",
  organization: "",
  customer: "",
  dateFrom: "",
  dateTo: ""
};

function homeReadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (_) {
    return [];
  }
}

function homeEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function homeMoney(value) {
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
}

function homeNormalizeSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/[ \u3000\r\n\t-]/g, "").trim();
}

function homeTextMatches(value, search) {
  const needle = homeNormalizeSearchText(search);
  if (!needle) return true;
  return homeNormalizeSearchText(value).includes(needle);
}

function homeNormalizeDate(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) return text.slice(0, 10).replaceAll("/", "-");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function homeNormalizeDateTime(value) {
  return homeNormalizeDate(value) || String(value || "");
}

function homeNormalizeTransactionType(type) {
  const value = String(type || "").trim();
  if (!value) return "通常販売";
  if (value === "返品") return "返金";
  return value;
}

function homeStatusLabel(status, kind = "") {
  const value = String(status || "").trim();
  const lower = value.toLowerCase();
  if (!value) return "未作成";
  if (lower === "draft" || value === "下書き") return kind === "delivery" || kind === "receipt" ? "未発行" : "下書き";
  if (lower === "issued") return kind === "delivery" ? "納品書発行済" : "発行済";
  if (value === "発行済") return kind === "delivery" ? "納品書発行済" : "発行済";
  if (lower === "shipped" || value === "発送済") return "発送済";
  if (lower === "hand_delivered" || lower === "hand_delivery" || value === "手渡し済") return "手渡し済";
  if (lower === "staff_carry" || lower === "staff_carried" || value === "担当者手持ち済") return "担当者手持ち済";
  if (value === "納品書発行済" || value === "発送準備中") return "納品書発行済";
  if (lower === "waiting_payment" || lower === "payment_waiting" || value === "入金待ち") return "入金待ち";
  if (lower === "partial_payment" || lower === "partially_paid" || value === "一部入金") return "一部入金";
  if (lower === "paid" || value === "入金済" || value === "入金済み") return "入金済み";
  if (lower === "no_payment_required" || lower === "no_payment" || lower === "payment_not_required" || value === "入金不要") return "入金不要";
  if (lower === "cancel" || lower === "cancelled" || lower === "canceled" || value === "キャンセル" || value === "キャンセル済") return "キャンセル";
  if (lower === "converted" || lower === "invoiced" || value === "請求書変換済") return "請求書変換済";
  if (lower === "invoice_issued" || value === "請求書発行済") return "請求書発行済";
  if (["未発行", "納品待ち", "発送待ち", "未納品", "納品済み", "支払期限超過", "請求書未変換", "未入金", "未発送", "領収済"].includes(value)) return value;
  return value;
}

function homeStatusBadge(status, kind = "") {
  const label = homeStatusLabel(status, kind);
  let type = "muted";
  if (["発行済", "請求書発行済", "入金済み", "納品済み", "発送済", "手渡し済", "担当者手持ち済", "領収済"].includes(label)) type = "ok";
  if (["入金待ち", "一部入金", "支払期限超過", "下書き", "未発行", "納品書発行済", "請求書変換済", "納品待ち", "発送待ち", "未納品", "請求書未変換", "未入金", "未発送"].includes(label)) type = "warn";
  if (label === "入金不要") type = "info";
  if (label === "キャンセル") type = "danger";
  return '<span class="status-badge ' + type + '">' + homeEscapeHtml(label) + '</span>';
}

function homeSameKey(a, b) {
  return String(a || "").trim() && String(a || "").trim() === String(b || "").trim();
}

function homeGetOriginNumber(row, fallback = "") {
  return row?.originNumber || row?.masterNumber || row?.quoteNumber || row?.quoteNo || row?.sourceQuoteNo || fallback || "";
}

function homeGetInvoiceOrigin(invoice) {
  return homeGetOriginNumber(invoice, invoice?.invoiceNo || invoice?.invoiceNumber || "");
}

function homeExtractNumber(value) {
  const matches = String(value || "").match(/\d+/g);
  return matches ? Number(matches[matches.length - 1]) : 0;
}

function homeSortNewest(a, b) {
  const aDate = a.sortDate || a.updatedAt || a.createdAt || "";
  const bDate = b.sortDate || b.updatedAt || b.createdAt || "";
  if (aDate || bDate) {
    const diff = String(bDate).localeCompare(String(aDate));
    if (diff) return diff;
  }
  return homeExtractNumber(b.sortNumber || b.origin) - homeExtractNumber(a.sortNumber || a.origin);
}

function homeResolveCustomer(row) {
  const customers = homeReadJson(HOME_PROGRESS_KEYS.customers);
  return customers.find(customer =>
    homeSameKey(customer.id, row?.customerId) ||
    homeSameKey(customer.customerId, row?.customerId) ||
    homeSameKey(customer.customerCode, row?.customerCode) ||
    homeSameKey(customer.code, row?.customerCode) ||
    homeSameKey(customer.smaregiCustomerId, row?.smaregiCustomerId) ||
    homeSameKey(customer.smaregiMemberId, row?.smaregiCustomerId) ||
    homeSameKey(customer.smaregiCustomerCode, row?.smaregiCustomerCode) ||
    homeSameKey(customer.smaregiMemberCode, row?.smaregiCustomerCode)
  ) || null;
}

function homeCustomerView(...rows) {
  for (const row of rows) {
    if (!row) continue;
    const customer = homeResolveCustomer(row) || {};
    const info = row.customerInfo || row.customer_info || row.customerDetail || {};
    const view = {
      customerName: customer.customerName || customer.name || row.customerName || row.name || row.customer || row.clientName || info.customerName || info.name || "",
      organizationName: customer.organizationName || customer.organization || customer.companyName || row.organizationName || row.organization || row.companyName || info.organizationName || info.organization || info.companyName || ""
    };
    if (view.customerName || view.organizationName) return view;
  }
  return { customerName: "", organizationName: "" };
}

function homeGetLines(row) {
  return [row?.lines, row?.items, row?.products, row?.details].find(value => Array.isArray(value) && value.length) || [];
}

function homeLineAmount(line, transactionType) {
  if (Number.isFinite(Number(line?.amount))) return Number(line.amount || 0);
  const qty = Number(line?.qty || line?.quantity || 0);
  const unitPrice = Number(line?.unitPrice || line?.price || 0);
  const gross = Math.round(Math.abs(qty) * Math.abs(unitPrice));
  const rate = Math.min(100, Math.max(0, Number(line?.discountValue ?? line?.discountRate ?? 0)));
  const fixedSource = line?.discountAmount ?? line?.discountAmountInput ?? line?.fixedDiscountAmount ?? line?.manualDiscountAmount ?? 0;
  const fixed = Math.max(0, Number(fixedSource));
  const discount = Math.min(gross, fixed > 0 ? fixed : Math.round(gross * rate / 100));
  const net = Math.max(0, gross - discount);
  return homeNormalizeTransactionType(transactionType || line?.transactionType) === "返金" ? -net : net;
}

function homeTotalAmount(...rows) {
  for (const row of rows) {
    if (!row) continue;
    if (Number.isFinite(Number(row.total))) return Number(row.total || 0);
    if (Number.isFinite(Number(row.amount))) return Number(row.amount || 0);
    const lines = homeGetLines(row);
    if (lines.length) return lines.reduce((total, line) => total + homeLineAmount(line, row.transactionType), 0);
  }
  return 0;
}

function homeActivePayments(invoice) {
  return Array.isArray(invoice?.payments) ? invoice.payments.filter(payment => payment.status !== "canceled") : [];
}

function homePaidAmount(invoice) {
  return homeActivePayments(invoice).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function homeEnsureGroup(map, origin) {
  const key = origin || "未採番";
  if (!map.has(key)) map.set(key, { origin: key, quotes: [], invoices: [], deliveries: [], receipts: [] });
  return map.get(key);
}

function homeBuildGroups() {
  const groups = new Map();
  homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.quotes)).forEach(quote => homeEnsureGroup(groups, homeGetOriginNumber(quote, quote.quoteNo)).quotes.push(quote));
  homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.invoices)).forEach(invoice => homeEnsureGroup(groups, homeGetInvoiceOrigin(invoice)).invoices.push(invoice));
  homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.deliveries)).forEach(delivery => homeEnsureGroup(groups, homeGetOriginNumber(delivery, delivery.deliveryNo)).deliveries.push(delivery));
  homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.receipts)).forEach(receipt => homeEnsureGroup(groups, homeGetOriginNumber(receipt, receipt.receiptNo)).receipts.push(receipt));
  return Array.from(groups.values());
}

function homeLatestRow(rows) {
  return rows.slice().sort((a, b) => homeSortNewest(
    { sortDate: a.updatedAt || a.createdAt, sortNumber: a.quoteNo || a.invoiceNo || a.deliveryNo || a.receiptNo },
    { sortDate: b.updatedAt || b.createdAt, sortNumber: b.quoteNo || b.invoiceNo || b.deliveryNo || b.receiptNo }
  ))[0] || null;
}

function homeMakeTicketRow(group) {
  const quote = homeLatestRow(group.quotes);
  const invoice = homeLatestRow(group.invoices);
  const delivery = homeLatestRow(group.deliveries);
  const receipt = homeLatestRow(group.receipts);
  const customer = homeCustomerView(invoice, quote, delivery, receipt);
  const transactionType = homeNormalizeTransactionType(invoice?.transactionType || quote?.transactionType || delivery?.transactionType || receipt?.transactionType);
  const sortDate = [quote, invoice, delivery, receipt]
    .map(row => row?.updatedAt || row?.createdAt || "")
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || "";
  return {
    origin: group.origin,
    quote,
    invoice,
    delivery,
    transactionType,
    organizationName: customer.organizationName,
    customerName: customer.customerName,
    total: homeTotalAmount(invoice, quote, delivery, receipt),
    status: homePrimaryStatus(quote, invoice, delivery),
    quoteStatus: quote ? homeStatusLabel(quote.status, "quote") : "未作成",
    invoiceStatus: invoice ? homeStatusLabel(invoice.status, "invoice") : "未作成",
    deliveryStatus: delivery ? homeStatusLabel(delivery.status, "delivery") : "未発行",
    sortDate,
    sortNumber: group.origin,
    date: homePrimaryDate(quote, invoice, delivery, sortDate),
    shippingMethod: delivery?.shippingMethod || "",
    shipmentDate: delivery?.shipmentDate || delivery?.handoverDate || delivery?.carryOutDate || "",
    shippingCarrier: delivery?.shippingCarrier || "",
    trackingNumber: delivery?.trackingNumber || ""
  };
}

function homePrimaryStatus(quote, invoice, delivery) {
  const deliveryStatus = delivery ? homeStatusLabel(delivery.status, "delivery") : "";
  if (deliveryStatus && deliveryStatus !== "未発行") return deliveryStatus;
  const invoiceStatus = invoice ? homeStatusLabel(invoice.status, "invoice") : "";
  if (invoiceStatus && invoiceStatus !== "未作成") return invoiceStatus;
  return quote ? homeStatusLabel(quote.status, "quote") : "未作成";
}

function homePrimaryDate(quote, invoice, delivery, fallback) {
  return homeNormalizeDate(delivery?.shipmentDate) ||
    homeNormalizeDate(delivery?.handoverDate) ||
    homeNormalizeDate(delivery?.carryOutDate) ||
    homeNormalizeDate(invoice?.invoiceDate) ||
    homeNormalizeDate(invoice?.issuedAt) ||
    homeNormalizeDate(delivery?.deliveryDate) ||
    homeNormalizeDate(delivery?.issuedAt) ||
    homeNormalizeDate(quote?.quoteDate) ||
    homeNormalizeDate(fallback);
}

function homeIsCancelledRow(row) {
  return [row.status, row.quoteStatus, row.invoiceStatus, row.deliveryStatus].some(status => homeStatusLabel(status) === "キャンセル");
}

function homeRowDateValues(row) {
  return [
    row.quote?.quoteDate,
    row.quote?.validUntil,
    row.quote?.updatedAt,
    row.quote?.createdAt,
    row.invoice?.invoiceDate,
    row.invoice?.dueDate,
    row.invoice?.issuedAt,
    row.invoice?.updatedAt,
    row.delivery?.deliveryDate,
    row.delivery?.issuedAt,
    row.delivery?.shipmentDate,
    row.delivery?.handoverDate,
    row.delivery?.carryOutDate,
    row.delivery?.updatedAt,
    row.date,
    row.sortDate
  ];
}

function homeMatchesDateRange(row) {
  const from = homeNormalizeDate(homeTicketFilters.dateFrom);
  const to = homeNormalizeDate(homeTicketFilters.dateTo);
  if (!from && !to) return true;
  const dates = homeRowDateValues(row).map(homeNormalizeDate).filter(Boolean);
  if (!dates.length) return false;
  return dates.some(date => (!from || date >= from) && (!to || date <= to));
}

function homeHasActiveFilter() {
  return Object.values(homeTicketFilters).some(Boolean);
}

function homeMatchesFilters(row) {
  if (homeTicketFilters.status && homeStatusLabel(row.status) !== homeTicketFilters.status) return false;
  if (homeTicketFilters.transaction && homeNormalizeTransactionType(row.transactionType) !== homeTicketFilters.transaction) return false;
  if (!homeTextMatches(row.organizationName, homeTicketFilters.organization)) return false;
  if (!homeTextMatches(row.customerName, homeTicketFilters.customer)) return false;
  if (!homeMatchesDateRange(row)) return false;
  return true;
}

function homeAmountClass(row) {
  return homeNormalizeTransactionType(row.transactionType) === "返金" || Number(row.total || 0) < 0 ? "amount-negative refund-amount" : "";
}

function buildHomeTicketRows() {
  return homeBuildGroups()
    .map(homeMakeTicketRow)
    .filter(row => !homeIsCancelledRow(row))
    .sort(homeSortNewest);
}

function renderHomeTicketRows() {
  const body = document.getElementById("homeTicketBody");
  const count = document.getElementById("homeTicketCount");
  if (!body) return;
  const allRows = buildHomeTicketRows();
  const filteredRows = allRows.filter(homeMatchesFilters);
  const displayRows = homeHasActiveFilter() ? filteredRows : filteredRows.slice(0, 50);
  const total = displayRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  if (count) count.textContent = `${displayRows.length}件 / 合計 ${homeMoney(total)}`;
  body.innerHTML = displayRows.length ? displayRows.map(row => `
    <tr>
      <td>${homeEscapeHtml(row.origin)}</td>
      <td>${homeStatusBadge(row.status)}</td>
      <td>${homeEscapeHtml(row.transactionType)}</td>
      <td>${homeEscapeHtml(row.organizationName)}</td>
      <td>${homeEscapeHtml(row.customerName)}</td>
      <td class="${homeAmountClass(row)}">${homeMoney(row.total)}</td>
      <td>${homeEscapeHtml(homeNormalizeDateTime(row.date))}</td>
      <td>${homeEscapeHtml(homeNormalizeDateTime(row.shipmentDate))}</td>
      <td>${homeEscapeHtml(row.shippingCarrier)}</td>
      <td>${homeEscapeHtml(row.trackingNumber)}</td>
    </tr>
  `).join("") : `<tr><td colspan="10">伝票はありません。</td></tr>`;
}

function fillHomeSelect(id, options, allLabel = "全て") {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = options.map(option => `<option value="${homeEscapeHtml(option)}">${homeEscapeHtml(option || allLabel)}</option>`).join("");
}

function bindHomeTicketFilters() {
  fillHomeSelect("homeTicketStatusFilter", HOME_STATUS_OPTIONS);
  fillHomeSelect("homeTicketTransactionFilter", HOME_TRANSACTION_OPTIONS);
  [
    ["homeTicketStatusFilter", "status"],
    ["homeTicketTransactionFilter", "transaction"],
    ["homeTicketOrganizationFilter", "organization"],
    ["homeTicketCustomerFilter", "customer"],
    ["homeTicketDateFromFilter", "dateFrom"],
    ["homeTicketDateToFilter", "dateTo"]
  ].forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const update = event => {
      homeTicketFilters[key] = event.target.value.trim();
      renderHomeTicketRows();
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
}

function homeWriteJson(key, rows) {
  localStorage.setItem(key, JSON.stringify(rows || []));
}

function homeVisibleRows(rows) {
  return rows || [];
}

function homeStaffName(name) {
  const formatter = window.getSalesStaffDisplayName || window.formatSalesStaffName;
  return formatter ? formatter(name || "") : (name || "");
}

function homeRecordId(row, prefix = "record") {
  return row?.id || row?.invoiceId || row?.quoteId || row?.deliveryId || row?.receiptId ||
    row?.invoiceNo || row?.invoiceNumber || row?.quoteNo || row?.quoteNumber ||
    row?.deliveryNo || row?.deliveryNumber || row?.receiptNo || row?.receiptNumber ||
    `${prefix}-${row?.createdAt || ""}`;
}

function homeCanceled(row) {
  const values = [row?.status, row?.paymentStatus, row?.deliveryStatus, row?.receiptStatus, row?.cancelStatus];
  return values.some(value => {
    const text = String(value || "").toLowerCase();
    return ["canceled", "cancelled", "cancel", "キャンセル", "キャンセル済"].includes(text) || text.includes("cancel");
  });
}

function homeQuoteNumber(quote) {
  return quote?.quoteNo || quote?.quoteNumber || quote?.number || homeRecordId(quote, "quote");
}

function homeInvoiceNumber(invoice) {
  return invoice?.invoiceNo || invoice?.invoiceNumber || invoice?.number || homeRecordId(invoice, "invoice");
}

function homeDeliveryNumber(delivery) {
  return delivery?.deliveryNo || delivery?.deliveryNumber || delivery?.number || homeRecordId(delivery, "delivery");
}

function homeReceiptNumber(receipt) {
  return receipt?.receiptNo || receipt?.receiptNumber || receipt?.number || homeRecordId(receipt, "receipt");
}

function homeInvoiceMatchesQuote(invoice, quote) {
  const quoteId = homeRecordId(quote, "quote");
  const quoteNo = homeQuoteNumber(quote);
  const origin = homeGetOriginNumber(quote, quoteNo);
  return [
    invoice?.quoteId,
    invoice?.sourceQuoteId,
    invoice?.originQuoteId,
    invoice?.quoteNo,
    invoice?.quoteNumber,
    invoice?.sourceQuoteNo,
    invoice?.originNumber,
    invoice?.masterNumber
  ].some(value => homeSameKey(value, quoteId) || homeSameKey(value, quoteNo) || homeSameKey(value, origin));
}

function homeQuoteConverted(quote, invoices) {
  if (homeCanceled(quote)) return true;
  const status = String(quote?.status || "").toLowerCase();
  if (["converted", "invoiced", "invoice_issued"].includes(status) || String(quote?.status || "").includes("請求")) return true;
  return invoices.some(invoice => !homeCanceled(invoice) && homeInvoiceMatchesQuote(invoice, quote));
}

function homeInvoicePaymentStatus(invoice) {
  return String(invoice?.paymentStatus || invoice?.status || "").trim();
}

function homeInvoiceIsNoPayment(invoice) {
  const text = homeInvoicePaymentStatus(invoice).toLowerCase();
  return ["no_payment_required", "no_payment", "payment_not_required", "入金不要"].includes(text);
}

function homeInvoiceIsPaid(invoice) {
  const text = homeInvoicePaymentStatus(invoice).toLowerCase();
  return ["paid", "入金済", "入金済み"].includes(text);
}

function homeInvoiceIsWaiting(invoice) {
  if (homeCanceled(invoice) || homeInvoiceIsPaid(invoice)) return false;
  if (homeInvoiceIsNoPayment(invoice)) return true;
  const text = homeInvoicePaymentStatus(invoice).toLowerCase();
  if (["waiting_payment", "payment_waiting", "partial_payment", "partially_paid", "入金待ち", "一部入金"].includes(text)) return true;
  const total = homeTotalAmount(invoice);
  return total > 0 && homePaidAmount(invoice) < total;
}

function homeDeliveryStatus(delivery) {
  return String(delivery?.deliveryStatus || delivery?.status || "").trim();
}

function homeDeliveryIsShipped(delivery) {
  const text = homeDeliveryStatus(delivery).toLowerCase();
  return ["shipped", "delivered", "completed", "発送済", "納品済", "手渡し済", "担当者手持ち済"].includes(text);
}

function homeReceiptIssued(receipt) {
  const text = String(receipt?.status || receipt?.receiptStatus || "").toLowerCase();
  return ["issued", "completed", "発行済", "領収済"].includes(text);
}

function homeDisplayDate(row, fields) {
  for (const field of fields) {
    const date = homeNormalizeDate(row?.[field]);
    if (date) return date;
  }
  return homeNormalizeDate(row?.updatedAt) || homeNormalizeDate(row?.createdAt) || "";
}

function homeActionLink(label, href, extraClass = "secondary") {
  return `<a class="${extraClass}" href="${homeEscapeHtml(href)}">${homeEscapeHtml(label)}</a>`;
}

function homeActionButton(label, onclick, extraClass = "secondary") {
  return `<button type="button" class="${extraClass}" onclick="${homeEscapeHtml(onclick)}">${homeEscapeHtml(label)}</button>`;
}

function homeOpenActionPdf(type, id) {
  const keyMap = {
    quote: HOME_PROGRESS_KEYS.quotes,
    invoice: HOME_PROGRESS_KEYS.invoices,
    delivery: HOME_PROGRESS_KEYS.deliveries,
    receipt: HOME_PROGRESS_KEYS.receipts
  };
  const rows = homeReadJson(keyMap[type]);
  const row = rows.find(item => homeSameKey(homeRecordId(item, type), id) ||
    homeSameKey(homeQuoteNumber(item), id) ||
    homeSameKey(homeInvoiceNumber(item), id) ||
    homeSameKey(homeDeliveryNumber(item), id) ||
    homeSameKey(homeReceiptNumber(item), id));
  if (!row) {
    alert("PDF対象の伝票が見つかりません。");
    return;
  }
  if (window.SalesPdfFormat?.openPdfActionDialog) {
    window.SalesPdfFormat.openPdfActionDialog(type, row);
    return;
  }
  if (window.SalesPdfFormat?.printSalesDocument) {
    window.SalesPdfFormat.printSalesDocument(type, row);
    return;
  }
  alert("PDF出力機能を読み込めませんでした。");
}

function homeMarkInvoicePaid(id) {
  const invoices = homeReadJson(HOME_PROGRESS_KEYS.invoices);
  const invoice = invoices.find(item => homeSameKey(homeRecordId(item, "invoice"), id) || homeSameKey(homeInvoiceNumber(item), id));
  if (!invoice) {
    alert("対象の請求書が見つかりません。");
    return;
  }
  if (!confirm(`${homeInvoiceNumber(invoice)} を入金済みにしますか？`)) return;
  const now = new Date().toISOString();
  const total = homeTotalAmount(invoice);
  const paid = homePaidAmount(invoice);
  const remaining = Math.max(0, total - paid);
  invoice.status = "入金済み";
  invoice.paymentStatus = "入金済み";
  invoice.paidAt = invoice.paidAt || now;
  invoice.updatedAt = now;
  invoice.payments = Array.isArray(invoice.payments) ? invoice.payments : [];
  if (remaining > 0) {
    invoice.payments.push({
      id: `PAY-${Date.now()}`,
      paymentDate: now.slice(0, 10),
      amount: remaining,
      staff: invoice.staff || invoice.personInCharge || "",
      status: "paid",
      createdAt: now,
      updatedAt: now
    });
  }
  homeWriteJson(HOME_PROGRESS_KEYS.invoices, invoices);
  renderHomeActionList();
  renderHomeTicketRows();
}

function homeMarkDeliveryShipped(id) {
  const deliveries = homeReadJson(HOME_PROGRESS_KEYS.deliveries);
  const delivery = deliveries.find(item => homeSameKey(homeRecordId(item, "delivery"), id) || homeSameKey(homeDeliveryNumber(item), id));
  if (!delivery) {
    alert("対象の納品書が見つかりません。");
    return;
  }
  if (!confirm(`${homeDeliveryNumber(delivery)} を発送済みにしますか？`)) return;
  const now = new Date().toISOString();
  delivery.status = "発送済";
  delivery.deliveryStatus = "発送済";
  delivery.shipmentDate = delivery.shipmentDate || now.slice(0, 10);
  delivery.shippedAt = delivery.shippedAt || now;
  delivery.shippingStaff = delivery.shippingStaff || delivery.staff || delivery.personInCharge || "";
  delivery.updatedAt = now;
  homeWriteJson(HOME_PROGRESS_KEYS.deliveries, deliveries);
  renderHomeActionList();
  renderHomeTicketRows();
}

function homeBuildActionRows() {
  const showCompleted = document.getElementById("homeShowCompletedActions")?.checked;
  const quotes = homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.quotes));
  const invoices = homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.invoices));
  const deliveries = homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.deliveries));
  const receipts = homeVisibleRows(homeReadJson(HOME_PROGRESS_KEYS.receipts));
  const rows = [];

  quotes.forEach(quote => {
    const converted = homeQuoteConverted(quote, invoices);
    const canceled = homeCanceled(quote);
    if (!showCompleted && (converted || canceled)) return;
    if (canceled) return;
    const id = homeRecordId(quote, "quote");
    rows.push({
      kind: "見積",
      number: homeQuoteNumber(quote),
      customer: homeCustomerView(quote).customerName,
      date: homeDisplayDate(quote, ["quoteDate", "createdAt"]),
      amount: homeTotalAmount(quote),
      staff: homeStaffName(quote.staff || quote.personInCharge || quote.owner || ""),
      status: converted ? "請求書変換済" : "請求書未変換",
      sortDate: quote.updatedAt || quote.createdAt || quote.quoteDate || "",
      sortNumber: homeQuoteNumber(quote),
      actions: [
        homeActionLink("編集", `quotes.html?id=${encodeURIComponent(id)}`),
        homeActionButton("PDF", `homeOpenActionPdf('quote','${homeEscapeHtml(id)}')`),
        converted ? "" : homeActionLink("請求書へ変換", `quotes.html?id=${encodeURIComponent(id)}`, "primary-action")
      ].filter(Boolean).join("")
    });
  });

  invoices.forEach(invoice => {
    if (homeCanceled(invoice)) return;
    const waiting = homeInvoiceIsWaiting(invoice);
    const paid = homeInvoiceIsPaid(invoice);
    if (!showCompleted && !waiting) return;
    if (showCompleted || waiting || paid) {
      const id = homeRecordId(invoice, "invoice");
      rows.push({
        kind: "請求書",
        number: homeInvoiceNumber(invoice),
        customer: homeCustomerView(invoice).customerName,
        date: homeDisplayDate(invoice, ["invoiceDate", "issuedAt", "createdAt"]),
        amount: homeTotalAmount(invoice),
        staff: homeStaffName(invoice.staff || invoice.personInCharge || invoice.owner || ""),
        status: paid ? "入金済み" : (homeInvoiceIsNoPayment(invoice) ? "入金不要" : "入金待ち"),
        sortDate: invoice.updatedAt || invoice.issuedAt || invoice.createdAt || "",
        sortNumber: homeInvoiceNumber(invoice),
        actions: [
          homeActionLink("編集", `invoices.html?id=${encodeURIComponent(id)}`),
          homeActionButton("PDF", `homeOpenActionPdf('invoice','${homeEscapeHtml(id)}')`),
          paid ? "" : homeActionLink("入金確認", `payments.html?id=${encodeURIComponent(id)}`, "primary-action")
        ].filter(Boolean).join("")
      });
    }
  });

  invoices.forEach(invoice => {
    if (homeCanceled(invoice) || homeInvoiceIsPaid(invoice) || homeInvoiceIsNoPayment(invoice)) return;
    const total = homeTotalAmount(invoice);
    const unpaid = total - homePaidAmount(invoice);
    if (!showCompleted && unpaid <= 0) return;
    if (unpaid <= 0 && !showCompleted) return;
    const id = homeRecordId(invoice, "invoice");
    rows.push({
      kind: "入金確認",
      number: homeInvoiceNumber(invoice),
      customer: homeCustomerView(invoice).customerName,
      date: homeDisplayDate(invoice, ["dueDate", "invoiceDate", "createdAt"]),
      amount: Math.max(0, unpaid),
      staff: homeStaffName(invoice.staff || invoice.personInCharge || invoice.owner || ""),
      status: unpaid > 0 ? "未入金" : "入金済み",
      sortDate: invoice.updatedAt || invoice.dueDate || invoice.createdAt || "",
      sortNumber: homeInvoiceNumber(invoice),
      actions: unpaid > 0 ? [
        homeActionButton("入金済", `homeMarkInvoicePaid('${homeEscapeHtml(id)}')`, "primary-action"),
        homeActionLink("キャンセル", `payments.html?id=${encodeURIComponent(id)}`)
      ].join("") : homeActionLink("確認", `payments.html?id=${encodeURIComponent(id)}`)
    });
  });

  deliveries.forEach(delivery => {
    if (homeCanceled(delivery)) return;
    const shipped = homeDeliveryIsShipped(delivery);
    if (!showCompleted && shipped) return;
    const id = homeRecordId(delivery, "delivery");
    rows.push({
      kind: "納品書",
      number: homeDeliveryNumber(delivery),
      customer: homeCustomerView(delivery).customerName,
      date: homeDisplayDate(delivery, ["deliveryDate", "shipmentDate", "createdAt"]),
      amount: homeTotalAmount(delivery),
      staff: homeStaffName(delivery.shippingStaff || delivery.staff || delivery.personInCharge || ""),
      status: shipped ? "発送済" : "未発送",
      sortDate: delivery.updatedAt || delivery.shippedAt || delivery.createdAt || "",
      sortNumber: homeDeliveryNumber(delivery),
      actions: [
        homeActionLink("編集", `delivery.html?id=${encodeURIComponent(id)}`),
        homeActionButton("PDF", `homeOpenActionPdf('delivery','${homeEscapeHtml(id)}')`),
        shipped ? "" : homeActionButton("発送済", `homeMarkDeliveryShipped('${homeEscapeHtml(id)}')`, "primary-action")
      ].filter(Boolean).join("")
    });
  });

  if (showCompleted) {
    receipts.forEach(receipt => {
      if (homeCanceled(receipt)) return;
      const id = homeRecordId(receipt, "receipt");
      rows.push({
        kind: "領収書",
        number: homeReceiptNumber(receipt),
        customer: homeCustomerView(receipt).customerName,
        date: homeDisplayDate(receipt, ["receiptDate", "paymentDate", "createdAt"]),
        amount: homeTotalAmount(receipt),
        staff: homeStaffName(receipt.staff || receipt.personInCharge || ""),
        status: homeReceiptIssued(receipt) ? "領収済" : "未発行",
        sortDate: receipt.updatedAt || receipt.createdAt || "",
        sortNumber: homeReceiptNumber(receipt),
        actions: [
          homeActionLink("編集", `receipts.html?id=${encodeURIComponent(id)}`),
          homeActionButton("PDF", `homeOpenActionPdf('receipt','${homeEscapeHtml(id)}')`)
        ].join("")
      });
    });
  }

  return rows.sort(homeSortNewest);
}

function renderHomeActionList() {
  const body = document.getElementById("homeActionBody");
  const count = document.getElementById("homeActionCount");
  if (!body) return;
  const rows = homeBuildActionRows();
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (count) count.textContent = `${rows.length}件 / 合計 ${homeMoney(total)}`;
  body.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${homeEscapeHtml(row.kind)}</td>
      <td>${homeEscapeHtml(row.number)}</td>
      <td>${homeEscapeHtml(row.customer)}</td>
      <td>${homeEscapeHtml(row.date)}</td>
      <td class="${Number(row.amount || 0) < 0 ? "amount-negative refund-amount" : ""}">${homeMoney(row.amount)}</td>
      <td>${homeEscapeHtml(row.staff)}</td>
      <td>${homeStatusBadge(row.status)}</td>
      <td><div class="sales-home-action-buttons">${row.actions}</div></td>
    </tr>
  `).join("") : `<tr><td colspan="8">対応が必要な伝票はありません。</td></tr>`;
}

function bindHomeActionList() {
  const toggle = document.getElementById("homeShowCompletedActions");
  if (toggle) toggle.addEventListener("change", renderHomeActionList);
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireSalesAuth()) return;
  bindHomeActionList();
  renderHomeActionList();
  bindHomeTicketFilters();
  renderHomeTicketRows();
});
