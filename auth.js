/* ARICO TOKYO inventory app: auth.js */

const SUPABASE_URL="https://ihsbkknysozkstvylqff.supabase.co";
const SUPABASE_API_KEY="sb_publishable_8f005IzGsMeOZktqtNtTRQ_ms6bzvze";
const ARICO_AUTH_TOKEN_KEY="arico_auth_token";
const ARICO_AUTH_USER_KEY="arico_auth_user";
const ARICO_AUTH_EXPIRES_KEY="arico_auth_expires";
const ARICO_AUTH_DURATION_MS=12*60*60*1000;
const ARICO_LOGIN_URL="https://arico-portal.vercel.app/index.html";
let inventoryAuthReady=false;

function clearAuthSession(){
  localStorage.removeItem(ARICO_AUTH_TOKEN_KEY);
  localStorage.removeItem(ARICO_AUTH_USER_KEY);
  localStorage.removeItem(ARICO_AUTH_EXPIRES_KEY);
}

function createAuthSession(userName,token="",expiresAt=Date.now()+ARICO_AUTH_DURATION_MS){
  const authToken=token||(crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now())+"_"+Math.random().toString(36).slice(2));
  localStorage.setItem(ARICO_AUTH_TOKEN_KEY,authToken);
  localStorage.setItem(ARICO_AUTH_USER_KEY,userName||"");
  localStorage.setItem(ARICO_AUTH_EXPIRES_KEY,String(expiresAt));
  console.log("[AUTH LOGIN SAVED]", {
    token: localStorage.getItem("arico_auth_token"),
    user: localStorage.getItem("arico_auth_user"),
    expires: localStorage.getItem("arico_auth_expires")
  });
}

async function consumePortalSession(token){
  const res=await fetch(SUPABASE_URL.replace(/\/+$/,"")+"/rest/v1/rpc/consume_portal_session",{
    method:"POST",
    headers:{
      apikey:SUPABASE_API_KEY,
      Authorization:"Bearer "+SUPABASE_API_KEY,
      "Content-Type":"application/json",
      Accept:"application/json"
    },
    body:JSON.stringify({session_token:token})
  });
  if(!res.ok)return false;
  return (await res.json().catch(()=>false))===true;
}

async function checkAuthOrRedirect(){
  const token=localStorage.getItem(ARICO_AUTH_TOKEN_KEY);
  const expires=Number(localStorage.getItem(ARICO_AUTH_EXPIRES_KEY)||0);
  console.log("[AUTH CHECK START]", {
    token: localStorage.getItem("arico_auth_token"),
    user: localStorage.getItem("arico_auth_user"),
    expires: localStorage.getItem("arico_auth_expires")
  });
  console.log("[AUTH CHECK]", {token,expires,now:Date.now()});
  if(token&&expires&&Date.now()<expires)return true;

  clearAuthSession();
  const params=new URLSearchParams(location.search);
  const incomingAuthToken=params.get("auth_token")||"";
  const incomingAuthUser=params.get("auth_user")||"";
  const incomingAuthExpires=Number(params.get("auth_expires")||0);
  if(incomingAuthToken&&incomingAuthExpires&&Date.now()<incomingAuthExpires){
    createAuthSession(incomingAuthUser,incomingAuthToken,incomingAuthExpires);
    history.replaceState(null,"",location.pathname);
    return true;
  }

  const incomingToken=params.get("session")||"";
  if(incomingToken&&await consumePortalSession(incomingToken)){
    createAuthSession("portal",incomingToken);
    history.replaceState(null,"",location.pathname);
    return true;
  }

  location.replace(ARICO_LOGIN_URL);
  return false;
}

function logout(){
  clearAuthSession();
  location.href=ARICO_LOGIN_URL;
}
