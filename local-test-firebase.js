/* Local-only Firebase-compatible in-memory adapter. Never used by production builds. */
(function () {
  const clone = (value) => JSON.parse(JSON.stringify(value == null ? null : value));
  const rootData = clone(window.__LOCAL_TEST_DATA__ || {});
  if (new URLSearchParams(window.location.search || '').get('localRole') === 'teacher') {
    rootData.authProfiles = rootData.authProfiles || {};
    rootData.authProfiles['local-teacher-uid'] = {
      UserID: 'USR-20260616-144217', Email: 'suradett.wrk@eisth.org', Role: 'teacher', Status: 'Active',
      DisplayName: 'ครูสุรเดช ธรรมประโชติ', Name: 'ครูสุรเดช ธรรมประโชติ'
    };
  }
  const listeners = [];
  let authUser = { uid: 'local-anonymous', isAnonymous: true, email: null, displayName: 'Local test' };
  try { const savedAuth = localStorage.getItem('__LOCAL_TEST_AUTH__'); if (savedAuth) authUser = JSON.parse(savedAuth); } catch (error) { console.warn('local test auth restore skipped', error); }
  const authCallbacks = new Set();

  function parts(pathName) {
    return String(pathName || '').split('/').filter(Boolean);
  }
  function read(pathName) {
    let value = rootData;
    for (const key of parts(pathName)) value = value == null ? undefined : value[key];
    return clone(value);
  }
  function write(pathName, value) {
    const keys = parts(pathName);
    if (!keys.length) {
      Object.keys(rootData).forEach((key) => delete rootData[key]);
      Object.assign(rootData, clone(value || {}));
      return;
    }
    let target = rootData;
    keys.slice(0, -1).forEach((key) => { target[key] = target[key] && typeof target[key] === 'object' ? target[key] : {}; target = target[key]; });
    const last = keys[keys.length - 1];
    if (value === null) delete target[last]; else target[last] = clone(value);
  }
  function applyUpdates(updates) { Object.entries(updates || {}).forEach(([key, value]) => write(key, value)); }
  function snapshot(value) { return { val: () => clone(value) }; }
  function emit() {
    listeners.slice().forEach((item) => item.handler(snapshot(item.value())));
  }
  function queryValue(pathName, orderChild, equalValue) {
    const value = read(pathName) || {};
    if (!orderChild) return value;
    return Object.fromEntries(Object.entries(value).filter(([, row]) => String(row && row[orderChild]) === String(equalValue)));
  }
  class Ref {
    constructor(pathName, orderChild, equalValue) { this.pathName = String(pathName || '').replace(/^\/+|\/+$/g, ''); this.orderChild = orderChild; this.equalValue = equalValue; }
    orderByChild(child) { return new Ref(this.pathName, child, this.equalValue); }
    equalTo(value) { return new Ref(this.pathName, this.orderChild, value); }
    value() { return this.orderChild ? queryValue(this.pathName, this.orderChild, this.equalValue) : read(this.pathName); }
    once() { return Promise.resolve(snapshot(this.value())); }
    on(event, handler) { const item = { pathName: this.pathName, orderChild: this.orderChild, equalValue: this.equalValue, handler, value: () => this.value() }; listeners.push(item); setTimeout(() => handler(snapshot(item.value())), 0); return handler; }
    off(event, handler) { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].handler === handler && listeners[i].pathName === this.pathName) listeners.splice(i, 1); }
    set(value) { write(this.pathName, value); emit(); return Promise.resolve(); }
    update(value) { applyUpdates(Object.fromEntries(Object.entries(value || {}).map(([key, item]) => [`${this.pathName}/${key}`, item]))); emit(); return Promise.resolve(); }
    remove() { return this.set(null); }
  }
  const auth = {
    currentUser: authUser,
    setPersistence: () => Promise.resolve(),
    onAuthStateChanged(callback) { authCallbacks.add(callback); setTimeout(() => callback(authUser), 0); return () => authCallbacks.delete(callback); },
    signInAnonymously() { authUser = { uid: 'local-anonymous', isAnonymous: true, email: null, displayName: 'Local test' }; auth.currentUser = authUser; authCallbacks.forEach((callback) => callback(authUser)); return Promise.resolve({ user: authUser }); },
    signInWithPopup() {
      const role = new URLSearchParams(window.location.search || '').get('localRole') || 'admin';
      authUser = role === 'teacher'
        ? { uid: 'local-teacher-uid', isAnonymous: false, email: 'suradett.wrk@eisth.org', displayName: 'ครูสุรเดช ธรรมประโชติ', photoURL: '' }
        : { uid: 'local-admin-uid', isAnonymous: false, email: 'suradet.t@wrk.ac.th', displayName: 'ผู้ดูแลระบบทดสอบ', photoURL: '' };
      auth.currentUser = authUser;
      try { localStorage.setItem('__LOCAL_TEST_AUTH__', JSON.stringify(authUser)); } catch (error) {}
      authCallbacks.forEach((callback) => callback(authUser));
      return Promise.resolve({ user: authUser });
    },
    signOut() { authUser = null; auth.currentUser = null; try { localStorage.removeItem('__LOCAL_TEST_AUTH__'); } catch (error) {} authCallbacks.forEach((callback) => callback(null)); return Promise.resolve(); }
  };
  auth.Auth = { Persistence: { LOCAL: 'local' } };
  window.firebase = { initializeApp: () => ({}), auth: () => auth, database: () => ({ ref: (pathName) => new Ref(pathName) }) };
  window.firebase.auth.Auth = auth.Auth;
  window.firebase.auth.GoogleAuthProvider = function GoogleAuthProvider() {};
  window.__LOCAL_TEST_DB__ = { root: rootData, reset: () => location.reload() };
})();
