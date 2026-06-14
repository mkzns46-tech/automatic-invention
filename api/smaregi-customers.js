const DEFAULT_LIMIT = 1000;

function sendJson(res, status, payload) {
  try {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
  } catch (_) {}
  return res.status(status).json(payload);
}

function env(...names) {
  for (const name of names) {
    if (name && process.env[name]) return process.env[name];
  }
  return "";
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function joinAddress(row) {
  const direct = firstString(row.address, row.addr, row.customerAddress, row.customer_address);
  if (direct) return direct;
  return [
    row.prefecture,
    row.prefectureName,
    row.prefecture_name,
    row.city,
    row.address1,
    row.address_1,
    row.address2,
    row.address_2,
    row.address3,
    row.address_3
  ].map(value => String(value ?? "").trim()).filter(Boolean).join("");
}

function normalizeCustomer(row) {
  const smaregiMemberId = firstString(
    row.customerId,
    row.customer_id,
    row.memberId,
    row.member_id,
    row.id
  );
  const smaregiMemberCode = firstString(
    row.customerCode,
    row.customer_code,
    row.memberCode,
    row.member_code,
    row.code
  );
  const customerName = firstString(
    row.customerName,
    row.customer_name,
    row.memberName,
    row.member_name,
    row.name,
    row.fullName,
    row.full_name
  );

  return {
    smaregiMemberId,
    smaregiMemberCode,
    customerName,
    kana: firstString(row.customerKana, row.customer_kana, row.memberKana, row.member_kana, row.kana, row.nameKana, row.name_kana),
    phone: firstString(row.phoneNumber, row.phone_number, row.tel, row.telephone, row.mobilePhoneNumber, row.mobile_phone_number, row.mobile),
    email: firstString(row.email, row.mailAddress, row.mail_address, row.emailAddress, row.email_address),
    postalCode: firstString(row.postalCode, row.postal_code, row.zipCode, row.zip_code, row.zip),
    address: joinAddress(row),
    gender: firstString(row.gender, row.sex),
    birthDate: firstString(row.birthDate, row.birth_date, row.birthday),
    memo: firstString(row.note, row.notes, row.memo, row.remarks),
    registeredAt: firstString(row.registeredAt, row.registered_at, row.createdAt, row.created_at, row.entryDate, row.entry_date),
    updatedAt: firstString(row.updatedAt, row.updated_at, row.modifiedAt, row.modified_at, row.updateDate, row.update_date)
  };
}

function resolveSmaregiContext() {
  const clientId = env("SMAREGI_NEW_CLIENT_ID", "NEW_SMAREGI_CLIENT_ID", "SMAREGI_CLIENT_ID");
  const clientSecret = env("SMAREGI_NEW_CLIENT_SECRET", "NEW_SMAREGI_CLIENT_SECRET", "SMAREGI_CLIENT_SECRET");
  const contractId = env(
    "SMAREGI_NEW_CONTRACT_ID",
    "SMAREGI_NEW_CONTRACTID",
    "NEW_SMAREGI_CONTRACT_ID",
    "NEW_SMAREGI_CONTRACTID",
    "SMAREGI_CONTRACT_ID",
    "SMAREGI_CONTRACTID"
  );
  const apiBase = env("SMAREGI_NEW_POS_API_BASE_URL", "NEW_SMAREGI_POS_API_BASE_URL", "SMAREGI_POS_API_BASE_URL");
  const customerPath = env("SMAREGI_CUSTOMERS_PATH", "SMAREGI_NEW_CUSTOMERS_PATH");
  const customerScope = env("SMAREGI_CUSTOMERS_SCOPE", "SMAREGI_NEW_CUSTOMERS_SCOPE") || "pos.customers:read";

  return {
    accountKey: "new",
    accountName: "new Smaregi",
    storeCode: "common",
    storeName: "common",
    clientId,
    clientSecret,
    contractId,
    apiBase,
    customerPath,
    customerScope
  };
}

async function getAccessToken(context) {
  const { contractId, clientId, clientSecret, customerScope } = context;
  if (!contractId || !clientId || !clientSecret) {
    throw new Error(`Smaregi OAuth settings are missing: ${context.accountName} / customer master`);
  }

  const tokenUrl = `https://id.smaregi.jp/app/${contractId}/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: customerScope
    }).toString()
  });
  const responseText = await response.text().catch(() => "");
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
    throw new Error(`Smaregi OAuth JSON parse failed ${response.status}: ${responseText.slice(0, 500)}`);
  }
  if (!response.ok || !body?.access_token) {
    throw new Error(`Smaregi OAuth error ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function fetchAll(baseUrl, path, token) {
  const rows = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(baseUrl + path);
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const responseText = await response.text().catch(() => "");
    let body = null;
    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
      throw new Error(`${path} API ${response.status}: JSON parse failed: ${responseText.slice(0, 500)}`);
    }
    if (!response.ok) {
      const error = new Error(`${path} API ${response.status}: ${JSON.stringify(body)}`);
      error.status = response.status;
      throw error;
    }
    if (!Array.isArray(body)) throw new Error(`${path} API response is not an array`);
    rows.push(...body);
    if (body.length < DEFAULT_LIMIT) break;
  }
  return rows;
}

async function fetchCustomerRows(apiBase, configuredPath, token) {
  const paths = configuredPath ? [configuredPath] : ["/customers", "/members"];
  const attempts = [];
  for (const path of paths) {
    try {
      const rows = await fetchAll(apiBase, path, token);
      return { rows, path, attempts };
    } catch (error) {
      attempts.push({ path, error: error.message || String(error), status: error.status || null });
      if (configuredPath) throw error;
      if (![404, 405].includes(error.status)) throw error;
    }
  }
  const message = attempts.map(attempt => `${attempt.path}: ${attempt.error}`).join(" / ");
  throw new Error(`Smaregi customer endpoint was not found: ${message}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      error: "POST only",
      step: "method_check",
      status: 405
    });
  }

  let step = "init";
  try {
    step = "parse_body";
    parseBody(req);
    step = "resolve_context";
    const context = resolveSmaregiContext();
    step = "oauth_token";
    const token = await getAccessToken(context);
    const apiBase = context.apiBase || `https://api.smaregi.jp/${context.contractId}/pos`;
    step = "customers_fetch";
    const { rows, path, attempts } = await fetchCustomerRows(apiBase, context.customerPath, token);
    step = "normalize";
    let skipped = 0;
    const customers = rows.map(normalizeCustomer).filter(customer => {
      const keep = Boolean(customer.customerName);
      if (!keep) skipped += 1;
      return keep;
    });

    step = "response";
    return sendJson(res, 200, {
      ok: true,
      customers,
      count: customers.length,
      skipped,
      source: {
        path,
        rawCount: rows.length,
        attempts
      },
      context: {
        accountKey: context.accountKey,
        accountName: context.accountName,
        storeCode: context.storeCode,
        storeName: context.storeName,
        contractId: context.contractId,
        scope: context.customerScope
      }
    });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[smaregi-customers] failed", {
      message,
      stack: error?.stack || "",
      method: req.method,
      step
    });
    return sendJson(res, 500, {
      ok: false,
      error: message,
      errorType: message.includes("OAuth") ? "smaregi_auth_failed" : "smaregi_customers_failed",
      step,
      status: 500
    });
  }
};
