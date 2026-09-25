/* Supabase score cutover client. Firebase remains the identity provider. */
(function () {
  const endpoint = 'https://jvyxnsokfpnepshyyzpg.functions.supabase.co/score-api';
  const originalRun = window.google?.script?.run;
  if (!originalRun) return;
  const scoreMethods = new Set(['loadScoresGrid', 'saveScoresBatch']);
  const request = async (action, payload) => {
    const user = window.firebase?.auth?.().currentUser;
    if (!user) throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งานคะแนน');
    const token = await user.getIdToken();
    const response = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify({ action, ...payload }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) throw new Error(result.message || `Supabase ${response.status}`);
    return result;
  };
  let success = null, failure = null;
  const proxy = new Proxy({}, { get(_target, prop) {
    if (prop === 'withSuccessHandler') return (fn) => { success = fn; return proxy; };
    if (prop === 'withFailureHandler') return (fn) => { failure = fn; return proxy; };
    if (scoreMethods.has(String(prop))) return (payload) => {
      const onSuccess = success, onFailure = failure; success = failure = null;
      request(String(prop) === 'loadScoresGrid' ? 'load' : 'save', payload || {}).then((value) => onSuccess && onSuccess(value)).catch((error) => onFailure && onFailure(error));
      return proxy;
    };
    return (...args) => {
      let runner = originalRun;
      if (success) runner = runner.withSuccessHandler(success);
      if (failure) runner = runner.withFailureHandler(failure);
      success = failure = null;
      return runner[prop](...args);
    };
  }});
  window.google.script.run = proxy;
})();
