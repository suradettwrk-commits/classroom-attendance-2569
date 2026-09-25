/* Supabase Auth bridge for the static build. Uses GoTrue REST directly so the
 * login does not depend on a third-party SDK bundle loading from a CDN. */
(function () {
  const SUPABASE_URL = 'https://jvyxnsokfpnepshyyzpg.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_oTJWgjNgk8Oe9i8kaAUaDw_sloavHyq';
  const STORAGE_KEY = 'wrk_supabase_auth_session';
  const PKCE_KEY = 'wrk_supabase_pkce_verifier';
  let currentUser = null;
  window.__SUPABASE_AUTH_USER = null;
  window.__AUTH_EMAIL = '';
  const publish = (session) => {
    currentUser = session?.user || null;
    window.__SUPABASE_AUTH_USER = currentUser;
    window.__AUTH_EMAIL = String(currentUser?.email || '').trim().toLowerCase();
    return session || null;
  };
  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { return null; }
  };
  const base64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const createVerifier = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const createChallenge = async (verifier) => base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const exchangeCode = async (code) => {
    // GitHub Pages performs a top-level redirect through Google. Keep a
    // sessionStorage copy for normal tabs and a short-lived localStorage
    // fallback for browsers/extensions that recreate the document context.
    const verifier = sessionStorage.getItem(PKCE_KEY) || localStorage.getItem(PKCE_KEY);
    if (!verifier) { console.error('Supabase PKCE verifier missing'); return null; }
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_code: code, code_verifier: verifier })
      });
      const body = await response.text();
      if (!response.ok) { console.error('Supabase PKCE exchange failed', response.status, body); return null; }
      return writeSession(JSON.parse(body));
    } catch (error) {
      console.error('Supabase PKCE exchange exception', String(error));
      return null;
    } finally {
      sessionStorage.removeItem(PKCE_KEY);
      localStorage.removeItem(PKCE_KEY);
    }
  };
  const writeSession = (session) => {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
    return publish(session);
  };
  const refreshSession = async (session) => {
    if (!session?.refresh_token) return null;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: PUBLIC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!response.ok) return null;
    return writeSession(await response.json());
  };
  window.supabaseAuthReady = async function () {
    const query = new URLSearchParams(window.location.search || '');
    if (query.get('code')) {
      await exchangeCode(query.get('code'));
      history.replaceState({}, document.title, window.location.pathname);
    }
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    if (hash.get('access_token')) {
      const expiresIn = Number(hash.get('expires_in') || 3600);
      writeSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') || '', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn, token_type: hash.get('token_type') || 'bearer' });
      history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
    let session = readSession();
    if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) session = await refreshSession(session);
    if (!session?.access_token) return publish(null);
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) return writeSession(null);
    const user = await response.json();
    return publish({ ...session, user });
  };
  window.supabaseSignInWithGoogle = async function () {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const verifier = createVerifier();
    sessionStorage.setItem(PKCE_KEY, verifier);
    localStorage.setItem(PKCE_KEY, verifier);
    const challenge = await createChallenge(verifier);
    const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
    url.searchParams.set('provider', 'google');
    url.searchParams.set('redirect_to', redirectTo);
    url.searchParams.set('apikey', PUBLIC_KEY);
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    window.location.assign(url.toString());
  };
  window.supabaseSignOut = async function () {
    const session = readSession();
    if (session?.access_token) await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${session.access_token}` } }).catch(() => {});
    writeSession(null);
  };
  window.__SUPABASE_AUTH_READY = window.supabaseAuthReady();
  window.__SUPABASE_CLIENT = { auth: { getSession: async () => ({ data: { session: readSession() } }) } };
})();
