const ARICO_TAX_RATE = 0.10;

function salesNumber(value) {
  return Number(value || 0);
}

function salesYen(value) {
  return salesNumber(value).toLocaleString("ja-JP") + "円";
}

function recalcSalesLine(line) {
  const gross = salesNumber(line.qty) * salesNumber(line.unitPrice);
  line.amount = gross;
  line.discountAmount = Math.floor(gross * salesNumber(line.discountValue) / 100);
  return line;
}

function calcQuoteTotals(quote) {
  const lines = quote.lines || [];
  lines.forEach(recalcSalesLine);
  const subtotal = lines.reduce((sum, line) => sum + salesNumber(line.amount), 0);
  const discount = lines.reduce((sum, line) => sum + salesNumber(line.discountAmount), 0);
  const total = Math.max(0, subtotal - discount);
  const tax = Math.floor(total * ARICO_TAX_RATE / (1 + ARICO_TAX_RATE));
  return { subtotal, discount, total, tax, taxRate: ARICO_TAX_RATE };
}
