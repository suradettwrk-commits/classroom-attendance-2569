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

  window.firebaseSignInWithGoogle = async function (options = {}) {
    const supabase = window.__SUPABASE_CLIENT__;
    const hash = String(window.location.hash || '');
    const hasOAuthCallback = /(?:^|#|&)access_token=/.test(hash) || /(?:^|#|&)code=/.test(hash);
    const bridgeUser = window.firebase && window.firebase.auth ? window.firebase.auth().currentUser : null;
    const current = (supabase.auth && supabase.auth.currentUser) || bridgeUser;
    // First click starts OAuth immediately; callback/restore resolves the session.
    const sessionResult = await supabase.auth.getSession();
    const authUser = sessionResult.data?.session?.user || supabase.auth.currentUser;
    if (!authUser) {
      if (options.revalidateOnly) return { success: false, noSession: true };
      if (!current && !hasOAuthCallback) return redirectToGoogle();
      return redirectToGoogle();
    }
    // Make the verified Supabase identity available to the legacy application
    // write queue immediately. Waiting only for the auth-state callback can
    // leave the first save queued as "not connected" even though the user is
    // already signed in.
    window.__FIREBASE_AUTH_USER = authUser;
    if (window.firebase && window.firebase.auth) window.firebase.auth().currentUser = authUser;

    const email = String(authUser.email || '').trim().toLowerCase();
    const { data: match, error: profileError } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle();
    if (profileError) throw profileError;
    const legacy = match && match.legacy_data && typeof match.legacy_data === 'object' ? match.legacy_data : {};
    const profile = { ...legacy, ...(match || {}) };
    const pick = (...keys) => keys.map(key => profile[key]).find(value => value !== undefined && value !== null && String(value).trim() !== '');
    const role = String(pick('Role', 'role') || '').toLowerCase();
    const status = String(pick('Status', 'status') || '').toLowerCase();
    if (match && ['admin', 'teacher', 'attendance_assistant'].includes(role) && status !== 'inactive') {
      return { success: true, user: {
        id: pick('UserID', 'userId', 'user_id', 'id'),
        username: pick('Username', 'username') || email,
        name: pick('Name', 'name', 'fullName', 'full_name') || authUser.user_metadata?.full_name || email,
        prefix: pick('Prefix', 'prefix') || '',
        lastName: pick('LastName', 'lastName', 'last_name') || '',
        position: pick('Position', 'position') || 'ครูผู้สอน',
        school: pick('School', 'school') || '',
        group: pick('Group', 'group') || '',
        role, status: pick('Status', 'status') || 'Active', email,
        imageUrl: authUser.user_metadata?.avatar_url || '', authUser
      } };
    }
    return { success: true, needsSetup: true, uid: authUser.id, email, name: authUser.user_metadata?.full_name || email };
  };
})();
