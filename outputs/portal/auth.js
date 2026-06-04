const ARICO_AUTH_TOKEN_KEY = "arico_auth_token";
const ARICO_AUTH_USER_KEY = "arico_auth_user";
const ARICO_AUTH_EXPIRES_KEY = "arico_auth_expires";
const ARICO_AUTH_DURATION_MS = 12 * 60 * 60 * 1000;

function createAuthSession(userName){
  const token = crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + "_" + Math.random().toString(36).slice(2);
  const expiresAt = Date.now() + ARICO_AUTH_DURATION_MS;
  localStorage.setItem(ARICO_AUTH_TOKEN_KEY,token);
  localStorage.setItem(ARICO_AUTH_USER_KEY,userName||"");
  localStorage.setItem(ARICO_AUTH_EXPIRES_KEY,String(expiresAt));
  console.log("[AUTH LOGIN SAVED]", {
    token: localStorage.getItem("arico_auth_token"),
    user: localStorage.getItem("arico_auth_user"),
    expires: localStorage.getItem("arico_auth_expires")
  });
  return token;
}

function clearAuthSession(){
  localStorage.removeItem(ARICO_AUTH_TOKEN_KEY);
  localStorage.removeItem(ARICO_AUTH_USER_KEY);
  localStorage.removeItem(ARICO_AUTH_EXPIRES_KEY);
}

function checkAuthOrRedirect(loginUrl="index.html"){
  const token=localStorage.getItem(ARICO_AUTH_TOKEN_KEY);
  const expires=Number(localStorage.getItem(ARICO_AUTH_EXPIRES_KEY)||0);
  if(!token||!expires||Date.now()>expires){
    clearAuthSession();
    location.replace(loginUrl);
    return false;
  }
  return true;
}

function buildInventoryAuthUrl(inventoryUrl){
  const url=new URL(inventoryUrl);
  url.searchParams.set("auth_token",localStorage.getItem(ARICO_AUTH_TOKEN_KEY)||"");
  url.searchParams.set("auth_user",localStorage.getItem(ARICO_AUTH_USER_KEY)||"");
  url.searchParams.set("auth_expires",localStorage.getItem(ARICO_AUTH_EXPIRES_KEY)||"");
  return url.toString();
}
