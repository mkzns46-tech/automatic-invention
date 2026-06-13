const ARICO_SUPABASE_URL = "https://ihsbkknysozkstvylqff.supabase.co";
const ARICO_SUPABASE_API_KEY = "sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";

async function salesFetch(path, options = {}) {
  const url = `${ARICO_SUPABASE_URL}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: ARICO_SUPABASE_API_KEY,
      Authorization: `Bearer ${ARICO_SUPABASE_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text().catch(() => "");
  console.log("[Sales Supabase response]", {
    url,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    empty: !text,
    body: text
  });

  if (!response.ok) {
    throw new Error(text || `Supabase API error ${response.status}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error?.message || String(error);
    throw new Error(`Supabase JSON parse failed ${response.status}: ${message}: ${text.slice(0, 500)}`);
  }
}
