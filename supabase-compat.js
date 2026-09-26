/*
 * Supabase-backed compatibility layer.
 *
 * The existing application bridge already centralizes authorization,
 * normalization, filtering, and CRUD behind Firebase-compatible refs. This
 * layer keeps that contract while replacing the storage/auth implementation
 * for the GitHub Pages build. Firebase is not initialized in this mode.
 */
(function () {
  const cfg = window.supabaseConfig || {};
  if (!window.supabase || !cfg.url || !cfg.publishableKey) {
    throw new Error('Supabase client/config is not available');
  }
  const callbackUrl = new URL(window.location.href);
  const callbackCode = callbackUrl.searchParams.get('code');
  const callbackHash = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
  const callbackAccessToken = callbackHash.get('access_token');
  const callbackRefreshToken = callbackHash.get('refresh_token');
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
  });
  const callbackReady = callbackAccessToken && callbackRefreshToken
    ? client.auth.setSession({ access_token: callbackAccessToken, refresh_token: callbackRefreshToken }).then(({ error }) => {
        if (error) throw error;
        window.__SUPABASE_SESSION_READY__ = true;
        const clean = new URL(window.location.href);
        clean.hash = '';
        window.history.replaceState({}, document.title, clean.toString());
      })
    : callbackCode
    ? client.auth.exchangeCodeForSession(callbackCode).then(({ error }) => {
        if (error) throw error;
        window.__SUPABASE_SESSION_READY__ = true;
        const clean = new URL(window.location.href);
        clean.searchParams.delete('code');
        clean.searchParams.delete('state');
        window.history.replaceState({}, document.title, clean.toString());
      })
    : Promise.resolve();
  // Expose OAuth callback settlement so the app auth bootstrap cannot race
  // the session exchange and require a second login click.
  window.__SUPABASE_CALLBACK_READY__ = callbackReady.catch(error => {
    console.error('SUPABASE_CALLBACK_SESSION_FAILED', error);
    return null;
  });
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const text = value => String(value == null ? '' : value).trim();
  const tableNames = ['terms', 'students', 'subjects', 'teacherClasses', 'assignments', 'attendance', 'scores', 'users', 'authProfiles', 'settings'];
  const tableMap = { teacherClasses: 'teacher_classes', authProfiles: 'auth_profiles', users: 'app_users' };
  const reverseTableMap = Object.fromEntries(Object.entries(tableMap).map(([a, b]) => [b, a]));
  let rootPromise = null;
  let rootCache = null;
  const listeners = [];

  function tableName(name) { return tableMap[name] || name; }
  function activeTermHint() {
    const fromWindow = text(window.CURRENT_SERVER_TERM);
    if (fromWindow) return fromWindow;
    try {
      const fromStorage = text(localStorage.getItem('CURRENT_SERVER_TERM') || localStorage.getItem('ACTIVE_TERM'));
      if (fromStorage) return fromStorage;
    } catch (error) {}
    return text(new URL(window.location.href).searchParams.get('term'));
  }
  function sameTerm(a, b) {
    return text(a) === text(b) || text(a).replace(/\s+/g, '') === text(b).replace(/\s+/g, '');
  }
  function termFilterCandidates(termRows, requestedTerm) {
    const requested = text(requestedTerm);
    if (!requested) return [];
    const candidates = new Set([requested]);
    (termRows || []).forEach(row => {
      const legacy = row && row.legacy_data && typeof row.legacy_data === 'object' ? row.legacy_data : {};
      const termId = text(row && (row.term_id || row.termId || row.TermID));
      const labels = [
        row && (row.display_label || row.term || row.Term),
        row && `${row.term_no || row.termNo || row.TermNo || ''}/${row.academic_year || row.academicYear || row.AcademicYear || ''}`,
        legacy.display_label || legacy.term || legacy.Term,
        `${legacy.term_no || legacy.termNo || legacy.TermNo || ''}/${legacy.academic_year || legacy.academicYear || legacy.AcademicYear || ''}`
      ].map(text).filter(Boolean);
      if (termId && labels.some(label => sameTerm(label, requested))) candidates.add(termId);
    });
    return [...candidates];
  }
  async function readAllRows(name, termCandidates) {
    const rows = [];
    const pageSize = 1000;
    // These tables grow with every lesson and score entry. Reading the whole
    // history on every page load causes PostgREST statement timeouts. The
    // compatibility layer is always consumed for one active term at a time,
    // so keep the same legacy shape while restricting the database read to
    // that term. This is read-only and does not alter stored data.
    const termScoped = ['assignments', 'attendance', 'scores'].includes(name);
    const term = termScoped ? activeTermHint() : '';
    const terms = termScoped ? (termCandidates && termCandidates.length ? termCandidates : (term ? [term] : [])) : [];
    for (let offset = 0; ; offset += pageSize) {
      let query = client.from(tableName(name)).select('*');
      if (terms.length > 1) query = query.in('term_id', terms);
      else if (terms.length === 1) query = query.eq('term_id', terms[0]);
      const { data, error } = await query.range(offset, offset + pageSize - 1);
      if (error) return { data: null, error };
      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return { data: rows, error: null };
  }
  function keyOf(row, name) {
    const candidates = {
      terms: ['TermID', 'term_id', 'termId'], students: ['StudentID', 'student_id', 'studentId'],
      subjects: ['SubjectCode', 'subject_code', 'subjectCode'], teacherClasses: ['TeacherClassID', 'teacher_class_id', 'teacherClassId'],
      assignments: ['AssignmentID', 'assignment_id', 'assignmentId'], attendance: ['RecordID', 'record_id', 'recordId'],
      scores: ['ScoreID', 'score_id', 'scoreId'], users: ['UserID', 'user_id', 'userId'], authProfiles: ['id', 'legacy_user_id']
    }[name] || [];
    return text(candidates.map(k => row && row[k]).find(Boolean));
  }
  function first(row, keys) { return keys.map(k => row && row[k]).find(v => v !== undefined && v !== null); }
  function legacyRow(name, row) {
    const base = row && row.legacy_data && typeof row.legacy_data === 'object' ? clone(row.legacy_data) : {};
    const out = { ...base, ...clone(row) };
    if (name === 'terms') Object.assign(out, { TermID: first(row, ['term_id', 'termId', 'TermID']), TermNo: first(row, ['term_no', 'termNo', 'TermNo']), AcademicYear: first(row, ['academic_year', 'academicYear', 'AcademicYear']), Status: first(row, ['status', 'Status']) });
    if (name === 'students') Object.assign(out, { StudentID: first(row, ['student_id', 'studentId', 'StudentID']), TermID: first(row, ['term_id', 'termId', 'TermID']), Term: first(row, ['display_term', 'term', 'Term', 'term_id']), StudentNo: first(row, ['student_no', 'studentNo', 'StudentNo']), Prefix: first(row, ['prefix', 'Prefix']), FirstName: first(row, ['first_name', 'firstName', 'FirstName']), LastName: first(row, ['last_name', 'lastName', 'LastName']), Level: first(row, ['level', 'Level']), Room: first(row, ['room', 'Room']), Status: first(row, ['status', 'Status']) });
    if (name === 'subjects') Object.assign(out, { SubjectCode: first(row, ['subject_code', 'subjectCode', 'SubjectCode']), TermID: first(row, ['term_id', 'termId', 'TermID']), SubjectName: first(row, ['subject_name', 'subjectName', 'SubjectName']), Teacher: first(row, ['teacher', 'Teacher']), Status: first(row, ['status', 'Status']) });
    if (name === 'teacherClasses') Object.assign(out, { TeacherClassID: first(row, ['teacher_class_id', 'teacherClassId', 'TeacherClassID']), TermID: first(row, ['term_id', 'termId', 'TermID']), TeacherID: first(row, ['teacher_id', 'teacherId', 'TeacherID']), SubjectCode: first(row, ['subject_code', 'subjectCode', 'SubjectCode']), Level: first(row, ['level', 'Level']), Room: first(row, ['room', 'Room']), Status: first(row, ['status', 'Status']) });
    if (name === 'assignments') Object.assign(out, { AssignmentID: first(row, ['assignment_id', 'assignmentId', 'AssignmentID']), TermID: first(row, ['term_id', 'termId', 'TermID']), Term: first(row, ['term', 'Term', 'term_id']), TeacherClassID: first(row, ['teacher_class_id', 'teacherClassId', 'TeacherClassID']), SubjectCode: first(row, ['subject_code', 'subjectCode', 'SubjectCode']), Title: first(row, ['title', 'Title']), AssignmentType: first(row, ['assignment_type', 'assignmentType', 'AssignmentType']), MaxScore: first(row, ['max_score', 'maxScore', 'MaxScore']), Level: first(row, ['level', 'Level']), Room: first(row, ['room', 'Room']), Status: first(row, ['status', 'Status']) });
    if (name === 'attendance') Object.assign(out, { RecordID: first(row, ['record_id', 'recordId', 'RecordID']), TermID: first(row, ['term_id', 'termId', 'TermID']), Term: first(row, ['term', 'Term', 'term_id']), StudentID: first(row, ['student_id', 'studentId', 'StudentID']), SubjectCode: first(row, ['subject_code', 'subjectCode', 'SubjectCode']), Date: first(row, ['attendance_date', 'date', 'Date']), Status: first(row, ['status', 'Status']), Note: first(row, ['note', 'Note']), Recorder: first(row, ['recorder', 'Recorder']) });
    if (name === 'scores') Object.assign(out, { ScoreID: first(row, ['score_id', 'scoreId', 'ScoreID']), TermID: first(row, ['term_id', 'termId', 'TermID']), Term: first(row, ['term', 'Term', 'term_id']), AssignmentID: first(row, ['assignment_id', 'assignmentId', 'AssignmentID']), StudentID: first(row, ['student_id', 'studentId', 'StudentID']), SubjectCode: first(row, ['subject_code', 'subjectCode', 'SubjectCode']), Score: first(row, ['score', 'Score']), IsSubmitted: first(row, ['is_submitted', 'isSubmitted', 'IsSubmitted']) });
    if (name === 'users') Object.assign(out, { UserID: first(row, ['user_id', 'userId', 'UserID']), Username: first(row, ['username', 'Username']), Email: first(row, ['email', 'Email']), Role: first(row, ['role', 'Role']), Status: first(row, ['status', 'Status']), Name: first(row, ['name', 'Name']) });
    return out;
  }
  async function loadRoot(force) {
    if (!force && rootPromise) return rootPromise;
    rootPromise = (async () => {
      // Resolve the display term to every canonical term_id used by the
      // migrated rows before reading the large activity tables. The live UI
      // uses labels such as 1/2569, while older Supabase rows can reference
      // the timestamp-shaped term primary key. Both belong to one active
      // term and must be read together without scanning all history.
      const termResult = await readAllRows('terms');
      const termCandidates = termResult.error ? [] : termFilterCandidates(termResult.data || [], activeTermHint());
      const entries = [
        ['terms', termResult],
        ...(await Promise.all(tableNames.filter(name => name !== 'terms').map(async name => {
          const { data, error } = await readAllRows(name, termCandidates);
          return [name, { data, error }];
        })))
      ].map(async ([name, result]) => {
        const { data, error } = result;
        // A denied/optional table must not hide the core classroom data.
        // Keep that table empty and let students, classes and records load.
        if (error) {
          console.warn(`SUPABASE_READ_SKIPPED:${tableName(name)}`, error.message || error);
          return [name, {}];
        }
        const map = {};
        (data || []).forEach(row => { const key = keyOf(row, name); if (key) map[key] = legacyRow(name, row); });
        return [name, map];
      });
      const root = Object.fromEntries(await Promise.all(entries));
      root.systemSettings = {};
      (root.settings && Object.values(root.settings) || []).forEach(row => { const key = text(row.setting_key || row.Key || row.key); if (key) root.systemSettings[key] = { Key: key, Value: row.value ?? row.Value ?? '' }; });
      rootCache = root;
      return clone(root);
    })().catch(error => { rootPromise = null; throw error; });
    return rootPromise;
  }
  function canonicalTermId(value) {
    const raw = text(value);
    const terms = rootCache && Object.values(rootCache.terms || {}) || [];
    const found = terms.find(row => raw === text(row.TermID || row.term_id || row.termId) || raw === `${text(row.TermNo || row.term_no)}/${text(row.AcademicYear || row.academic_year)}` || raw === text(row.display_label));
    return found ? text(found.TermID || found.term_id || found.termId) : raw;
  }
  function pathParts(path) { return String(path || '').split('/').filter(Boolean); }
  async function persist(name, key, value) {
    const table = tableName(name);
    if (name === 'settings' || name === 'systemSettings') {
      const settingKey = key || text(value && (value.Key || value.key));
      const payload = { setting_key: settingKey, term_id: value && (value.TermID || value.term_id || null), value: value && (value.Value ?? value.value ?? value), updated_at: new Date().toISOString() };
      const { error } = await client.from('settings').upsert(payload); if (error) throw error; return;
    }
    const columns = { terms: 'term_id', students: 'student_id', subjects: 'subject_code', teacherClasses: 'teacher_class_id', assignments: 'assignment_id', attendance: 'record_id', scores: 'score_id', users: 'user_id', authProfiles: 'id' };
    const idCol = columns[name];
    if (!idCol) throw new Error(`ไม่รองรับการบันทึกตาราง ${name}`);
    const p = { legacy_data: value, updated_at: new Date().toISOString() };
    const set = (col, keys) => { const v = first(value, keys); if (v !== undefined && v !== null && v !== '') p[col] = v; };
    if (name === 'terms') { p.term_id = key; set('display_label', ['display_label']); set('academic_year', ['AcademicYear','academicYear','academic_year']); set('term_no', ['TermNo','termNo','term_no']); set('status', ['Status','status']); }
    if (name === 'students') { p.student_id=key; set('term_id',['TermID','termId','term_id','Term']); set('student_no',['StudentNo','studentNo','student_no']); set('prefix',['Prefix','prefix']); set('first_name',['FirstName','firstName','first_name']); set('last_name',['LastName','lastName','last_name']); set('level',['Level','level']); set('room',['Room','room']); set('status',['Status','status']); }
    if (name === 'subjects') { p.subject_code=key; set('term_id',['TermID','termId','term_id']); set('subject_name',['SubjectName','subjectName','subject_name']); set('teacher',['Teacher','teacher']); set('status',['Status','status']); }
    if (name === 'teacherClasses') { p.teacher_class_id=key; set('term_id',['TermID','termId','term_id']); set('teacher_id',['TeacherID','teacherId','teacher_id']); set('subject_code',['SubjectCode','subjectCode','subject_code']); set('level',['Level','level']); set('room',['Room','room']); set('status',['Status','status']); }
    if (name === 'assignments') { p.assignment_id=key; set('term_id',['TermID','termId','term_id','Term']); set('teacher_class_id',['TeacherClassID','teacherClassId','teacher_class_id']); set('subject_code',['SubjectCode','subjectCode','subject_code']); set('title',['Title','title']); set('assignment_type',['AssignmentType','assignmentType','assignment_type']); set('max_score',['MaxScore','maxScore','max_score']); set('level',['Level','level']); set('room',['Room','room']); set('status',['Status','status']); }
    if (name === 'attendance') { p.record_id=key; set('term_id',['TermID','termId','term_id','Term']); set('student_id',['StudentID','studentId','student_id']); set('subject_code',['SubjectCode','subjectCode','subject_code']); set('attendance_date',['Date','date','attendance_date']); set('status',['Status','status']); set('note',['Note','note']); set('recorder',['Recorder','recorder']); }
    if (name === 'scores') { p.score_id=key; set('term_id',['TermID','termId','term_id','Term']); set('assignment_id',['AssignmentID','assignmentId','assignment_id']); set('student_id',['StudentID','studentId','student_id']); set('subject_code',['SubjectCode','subjectCode','subject_code']); set('score',['Score','score']); set('is_submitted',['IsSubmitted','isSubmitted','is_submitted']); }
    if (name === 'users') { p.user_id=key; set('username',['Username','username']); set('email',['Email','email']); set('role',['Role','role']); set('status',['Status','status']); }
    if (p.term_id && name !== 'terms') p.term_id = canonicalTermId(p.term_id);
    // Let PostgREST use the table's declared primary key. Several migrated
    // tables intentionally use composite (term_id, legacy_id) keys.
    const { error } = await client.from(table).upsert(p); if (error) throw error;
  }
  async function remove(name, key) { const idCol = { terms:'term_id',students:'student_id',subjects:'subject_code',teacherClasses:'teacher_class_id',assignments:'assignment_id',attendance:'record_id',scores:'score_id',users:'user_id',authProfiles:'id' }[name]; if (!idCol) throw new Error(`ไม่รองรับการลบตาราง ${name}`); const { error } = await client.from(tableName(name)).delete().eq(idCol,key); if (error) throw error; }
  class Ref {
    constructor(path, order, equal) { this.path=String(path||'').replace(/^\/+|\/+$/g,''); this.order=order; this.equal=equal; }
    orderByChild(child) { return new Ref(this.path, child, this.equal); }
    equalTo(value) { return new Ref(this.path, this.order, value); }
    async value() { const root = await loadRoot(); let value = root; for (const part of pathParts(this.path)) value = value == null ? undefined : value[part]; if (this.order && value && typeof value === 'object') value = Object.fromEntries(Object.entries(value).filter(([, row]) => text(row && (row[this.order] ?? row[this.order[0]?.toUpperCase()+this.order.slice(1)])) === text(this.equal))); return value || {}; }
    async once() { const value = await this.value(); return { val: () => clone(value) }; }
    on(event, handler) { const item={ref:this,handler}; listeners.push(item); this.once().then(s=>handler(s)).catch(()=>{}); return handler; }
    off(event, handler) { const i=listeners.findIndex(x=>x.handler===handler && x.ref===this); if(i>=0) listeners.splice(i,1); }
    async set(value) { await this.write(value); }
    async update(values) {
      if (!this.path) {
        for (const [path, value] of Object.entries(values || {})) {
          const parts = pathParts(path);
          if (parts.length >= 2) await new Ref(`${parts[0]}/${parts[1]}`).set(value);
        }
        return;
      }
      if (pathParts(this.path).length >= 2) {
        const current = await this.value();
        await this.set({ ...(current || {}), ...(values || {}) });
        return;
      }
      for (const [key,value] of Object.entries(values||{})) await this.write(value, key);
    }
    async write(value, child) { const parts=pathParts(this.path); const name=reverseTableMap[parts[0]] || parts[0]; const key=child ? pathParts(child)[0] : parts[1]; if (!name) return; if (value === null) await remove(name,key); else await persist(name,key,value); rootPromise=null; await loadRoot(true); listeners.slice().forEach(x=>x.ref.once().then(s=>x.handler(s)).catch(()=>{})); }
    remove() { return this.set(null); }
  }
  const auth = { currentUser: null, Auth:{Persistence:{LOCAL:'local'}}, setPersistence:()=>Promise.resolve(), onAuthStateChanged(cb){ let active=true; let unsubscribe=()=>{ active=false; }; (async()=>{ try { await callbackReady; } catch (error) { console.error('SUPABASE_CALLBACK_SESSION_FAILED', error); } const {data,error}=await client.auth.getSession(); if (error) console.error('SUPABASE_GET_SESSION_FAILED', error); auth.currentUser=data?.session?.user||null; if (auth.currentUser) window.__SUPABASE_SESSION_READY__ = true; if (!active) return; setTimeout(()=>{ if (active) cb(auth.currentUser); },0); const {data:sub}=client.auth.onAuthStateChange((_event,session)=>{auth.currentUser=session?.user||null; if (auth.currentUser) window.__SUPABASE_SESSION_READY__ = true; if (active) cb(auth.currentUser); }); unsubscribe=()=>{ active=false; sub.subscription.unsubscribe(); }; })(); return ()=>unsubscribe(); }, async signInAnonymously(){ throw new Error('Supabase anonymous auth is disabled'); }, async signInWithPopup(){ const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.href}}); if(error) throw error; return {user:auth.currentUser,data}; }, async signOut(){ const {error}=await client.auth.signOut(); if(error) throw error; auth.currentUser=null; window.__SUPABASE_SESSION_READY__ = false; } };
  window.firebase = { initializeApp:()=>({}), auth:()=>auth, database:()=>({ref:path=>new Ref(path)}) };
  window.__SUPABASE_MODE__ = true;
  window.firebase.auth.Auth=auth.Auth; window.firebase.auth.GoogleAuthProvider=function GoogleAuthProvider(){};
  window.__SUPABASE_CLIENT__=client; window.__SUPABASE_ROOT__=()=>loadRoot();
})();
