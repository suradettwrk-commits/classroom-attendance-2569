/* Supabase Auth bridge for the static build. The publishable key is safe to
 * expose in browser code; no service-role or secret key belongs here. */
(function () {
  const client = window.__SUPABASE_CLIENT = window.supabase.createClient(
    'https://jvyxnsokfpnepshyyzpg.supabase.co',
    'sb_publishable_oTJWgjNgk8Oe9i8kaAUaDw_sloavHyq',
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
  let currentUser = null;
  window.__SUPABASE_AUTH_USER = null;
  window.__AUTH_EMAIL = '';
  const publish = (session) => {
    currentUser = session?.user || null;
    window.__SUPABASE_AUTH_USER = currentUser;
    window.__AUTH_EMAIL = String(currentUser?.email || '').trim().toLowerCase();
    return session || null;
  };
  window.supabaseAuthReady = async function () {
    const { data } = await client.auth.getSession();
    return publish(data?.session || null);
  };
  window.supabaseSignInWithGoogle = async function () {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } }
    });
    if (error) throw error;
  };
  window.supabaseSignOut = async function () {
    await client.auth.signOut();
    publish(null);
  };
  client.auth.onAuthStateChange((_event, session) => publish(session));
  window.__SUPABASE_AUTH_READY = window.supabaseAuthReady();
})();
