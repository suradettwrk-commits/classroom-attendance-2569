/* Supabase Auth facade used by the existing staff login flow. */
(function () {
  if (!window.__SUPABASE_CLIENT__) return;

  function redirectToGoogle() {
    const redirectTarget = new URL(window.location.href);
    redirectTarget.hash = '';
    const authorizeUrl = `${window.supabaseConfig.url}/auth/v1/authorize?provider=google&flow_type=implicit&redirect_to=${encodeURIComponent(redirectTarget.toString())}&prompt=select_account`;
    window.location.assign(authorizeUrl);
    return { success: false, redirecting: true };
  }

  window.firebaseSignInWithGoogle = async function () {
    const supabase = window.__SUPABASE_CLIENT__;
    const hash = String(window.location.hash || '');
    const hasOAuthCallback = /(?:^|#|&)access_token=/.test(hash) || /(?:^|#|&)code=/.test(hash);
    const bridgeUser = window.firebase && window.firebase.auth ? window.firebase.auth().currentUser : null;
    const current = (supabase.auth && supabase.auth.currentUser) || bridgeUser;
    // First click starts OAuth immediately; callback/restore resolves the session.
    if (!current && !hasOAuthCallback) return redirectToGoogle();

    const sessionResult = await supabase.auth.getSession();
    const authUser = sessionResult.data?.session?.user || supabase.auth.currentUser;
    if (!authUser) return redirectToGoogle();

    const email = String(authUser.email || '').trim().toLowerCase();
    const { data: match, error: profileError } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle();
    if (profileError) throw profileError;
    if (match && ['admin', 'teacher', 'attendance_assistant'].includes(String(match.Role || match.role || '').toLowerCase()) && String(match.Status || match.status || '').toLowerCase() !== 'inactive') {
      return { success: true, user: { id: match.UserID || match.userId || match.user_id, username: match.Username || match.username || email, name: match.Name || match.name || email, role: String(match.Role || match.role).toLowerCase(), email, imageUrl: authUser.user_metadata?.avatar_url || '', authUser } };
    }
    return { success: true, needsSetup: true, uid: authUser.id, email, name: authUser.user_metadata?.full_name || email };
  };
})();
