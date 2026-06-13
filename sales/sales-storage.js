const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
const SALES_QUOTES_KEY = "arico_sales_quotes_v1";
const PRODUCT_UNITS_KEY = "arico_sales_product_units_v1";

function salesFetch(path, options = {}) {
  return fetch(`${ARICO_SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ARICO_SUPABASE_API_KEY,
      Authorization: `Bearer ${ARICO_SUPABASE_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  }).then(async res => {
    if (!res.ok) throw new Error(await res.text());
    return res.status === 204 ? null : res.json();
  });
}

function salesReadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

function salesWriteJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function salesUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function quoteNo(n) {
  return "Q-" + String(n).padStart(6, "0");
}

function normalizeQuote(row) {
  if (!row) return null;
  if (row.lines) return row;
  return {
    id: row.id,
    quoteNo: row.quote_no,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    customerName: row.customer_name,
    customerType: row.customer_type,
    address: row.customer_address,
    phone: row.customer_phone,
    email: row.customer_email,
    subject: row.subject,
    quoteDate: row.quote_date,
    validUntil: row.valid_until,
    staff: row.staff,
    memo: row.memo,
    discountTemplate: row.discount_template,
    lines: (row.sales_quote_items || []).map(item => ({
      id: item.id,
      barcode: item.barcode,
      smaregiProductId: item.smaregi_product_id,
      name: item.product_name,
      stock: item.stock_snapshot,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.unit_price,
      discountValue: item.discount_value,
      discountAmount: item.discount_amount,
      amount: item.amount,
      memo: item.memo
    }))
  };
}

function serializeQuote(quote) {
  const totals = calcQuoteTotals(quote);
  return {
    id: quote.id,
    quote_no: quote.quoteNo,
    status: quote.status || "下書き",
    customer_name: quote.customerName,
    customer_type: quote.customerType,
    customer_address: quote.address,
    customer_phone: quote.phone,
    customer_email: quote.email,
    subject: quote.subject,
    quote_date: quote.quoteDate,
    valid_until: quote.validUntil,
    staff: quote.staff,
    memo: quote.memo,
    discount_template: quote.discountTemplate,
    subtotal: totals.subtotal,
    discount_total: totals.discount,
    total: totals.total,
    tax_total: totals.tax,
    updated_at: new Date().toISOString()
  };
}

function serializeQuoteItem(quoteId, line, index) {
  return {
    quote_id: quoteId,
    line_no: index + 1,
    barcode: line.barcode || "",
    smaregi_product_id: line.smaregiProductId || null,
    product_name: line.name || "",
    stock_snapshot: Number(line.stock || 0),
    qty: Number(line.qty || 0),
    unit: line.unit || "個",
    unit_price: Number(line.unitPrice || 0),
    discount_value: Number(line.discountValue || 0),
    discount_amount: Number(line.discountAmount || 0),
    amount: Number(line.amount || 0),
    memo: line.memo || ""
  };
}

const salesQuoteStore = {
  useSupabase: true,

  async listQuotes() {
    if (this.useSupabase) {
      try {
        const rows = await salesFetch("sales_quotes?select=*,sales_quote_items(*)&order=created_at.desc");
        return rows.map(normalizeQuote);
      } catch (e) {
        console.warn("Supabase quotes read failed. Falling back to localStorage.", e);
      }
    }
    return salesReadJson(SALES_QUOTES_KEY, []);
  },

  async getQuote(id) {
    const quotes = await this.listQuotes();
    return quotes.find(q => q.id === id) || null;
  },

  async nextQuoteNo() {
    if (this.useSupabase) {
      try {
        const rows = await salesFetch("rpc/next_sales_number", {
          method: "POST",
          body: JSON.stringify({ sequence_name: "quote" })
        });
        return Array.isArray(rows) ? rows[0] : rows;
      } catch (e) {
        console.warn("Supabase sequence read failed. Falling back to localStorage.", e);
      }
    }
    const quotes = await this.listQuotes();
    const max = quotes.reduce((num, quote) => {
      const match = String(quote.quoteNo || "").match(/^Q-(\d+)$/);
      return Math.max(num, match ? Number(match[1]) : 0);
    }, 0);
    return quoteNo(max + 1);
  },

  async saveQuote(quote) {
    const now = new Date().toISOString();
    const saved = {
      ...quote,
      id: quote.id || salesUuid(),
      quoteNo: quote.quoteNo || await this.nextQuoteNo(),
      createdAt: quote.createdAt || now,
      updatedAt: now,
      status: quote.status || "下書き",
      lines: quote.lines || []
    };
    saved.lines.forEach(recalcSalesLine);

    if (this.useSupabase) {
      try {
        await salesFetch("sales_quotes", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(serializeQuote(saved))
        });
        await salesFetch(`sales_quote_items?quote_id=eq.${encodeURIComponent(saved.id)}`, { method: "DELETE" });
        if (saved.lines.length) {
          await salesFetch("sales_quote_items", {
            method: "POST",
            body: JSON.stringify(saved.lines.map((line, index) => serializeQuoteItem(saved.id, line, index)))
          });
        }
        return saved;
      } catch (e) {
        console.warn("Supabase quote save failed. Falling back to localStorage.", e);
      }
    }

    const quotes = salesReadJson(SALES_QUOTES_KEY, []);
    const index = quotes.findIndex(q => q.id === saved.id);
    if (index >= 0) quotes[index] = saved;
    else quotes.push(saved);
    salesWriteJson(SALES_QUOTES_KEY, quotes);
    return saved;
  },

  duplicateQuoteDraft(quote) {
    return {
      ...JSON.parse(JSON.stringify(quote)),
      id: null,
      quoteNo: "",
      createdAt: "",
      updatedAt: "",
      status: "下書き",
      quoteDate: new Date().toISOString().slice(0, 10)
    };
  }
};

function readUnits() {
  return salesReadJson(PRODUCT_UNITS_KEY, {});
}

function writeUnits(units) {
  salesWriteJson(PRODUCT_UNITS_KEY, units);
}
