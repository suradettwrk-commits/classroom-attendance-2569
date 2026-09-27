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

  // Profile writes must target the existing app_users row. CURRENT_USER.id
  // can be a legacy UserID and is not guaranteed to equal app_users.user_id;
  // using it as an upsert key would turn a profile edit into an INSERT.
  async function saveOwnProfile(arg, imageData) {
    const sessionResult = await client.auth.getSession();
    const sessionUser = sessionResult.data?.session?.user || client.auth.currentUser;
    const email = text(sessionUser?.email).toLowerCase();
    if (!email) throw new Error('ไม่พบอีเมล Google ของผู้ใช้ปัจจุบัน');
    const { data: existing, error: readError } = await client.from('app_users')
      .select('user_id,email,role,status,legacy_data')
      .eq('email', email)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing || !text(existing.user_id)) throw new Error('ไม่พบแถวโปรไฟล์ของอีเมล Google นี้ใน app_users');
    const legacy = existing.legacy_data && typeof existing.legacy_data === 'object' ? existing.legacy_data : {};
    const profileImage = text(imageData)
      ? (text(imageData).startsWith('data:image/') ? text(imageData) : `data:image/jpeg;base64,${text(imageData)}`)
      : text(legacy.ProfileImage || legacy.profileImage || legacy.profile_image);
    const nextLegacy = {
      ...legacy,
      Username: text(arg?.username) || text(legacy.Username || legacy.username),
      Name: text(arg?.name) || text(legacy.Name || legacy.name),
      Prefix: text(arg?.prefix) || text(legacy.Prefix || legacy.prefix),
      LastName: text(arg?.lastName) || text(legacy.LastName || legacy.lastName),
      Position: text(arg?.position) || text(legacy.Position || legacy.position),
      School: text(arg?.school) || text(legacy.School || legacy.school),
      Group: text(arg?.group) || text(legacy.Group || legacy.group)
    };
    if (profileImage) nextLegacy.ProfileImage = profileImage;
    const { data: updated, error: updateError } = await client.from('app_users')
      .update({ legacy_data: nextLegacy, updated_at: new Date().toISOString() })
      .eq('user_id', existing.user_id)
      .select('user_id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new Error('ไม่สามารถยืนยันการอัปเดตโปรไฟล์ใน app_users ได้');
    return { success: true, message: 'อัปเดตโปรไฟล์สำเร็จ' };
  }

  window.__SUPABASE_SAVE_USER_PROFILE__ = saveOwnProfile;

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
    const active = (termRows || []).find(row => text(row && (row.status || row.Status)).toLowerCase() === 'active') || (termRows || [])[0];
    const requestedRaw = text(requestedTerm) || text(active && (active.display_label || active.term || active.Term)) || text(active && (active.term_id || active.TermID || active.termId));
    if (!requestedRaw) return [];
    // The display label is a UI value, not a database key. Once the term row
    // resolves it, query activity tables by canonical term_id only. This
    // avoids a second full/RLS scan for an unindexed legacy label.
    const requestedRow = (termRows || []).find(row => {
      const legacy = row && row.legacy_data && typeof row.legacy_data === 'object' ? row.legacy_data : {};
      const termId = text(row && (row.term_id || row.termId || row.TermID));
      const labels = [
        row && (row.display_label || row.term || row.Term),
        row && `${row.term_no || row.termNo || row.TermNo || ''}/${row.academic_year || row.academicYear || row.AcademicYear || ''}`,
        legacy.display_label || legacy.term || legacy.Term,
        `${legacy.term_no || legacy.termNo || legacy.TermNo || ''}/${legacy.academic_year || legacy.academicYear || legacy.AcademicYear || ''}`
      ].map(text).filter(Boolean);
      return (termId && sameTerm(termId, requestedRaw)) || labels.some(label => sameTerm(label, requestedRaw));
    });
    const candidates = new Set([text(requestedRow && (requestedRow.term_id || requestedRow.termId || requestedRow.TermID)) || requestedRaw]);
    (termRows || []).forEach(row => {
      const legacy = row && row.legacy_data && typeof row.legacy_data === 'object' ? row.legacy_data : {};
      const termId = text(row && (row.term_id || row.termId || row.TermID));
      const labels = [
        row && (row.display_label || row.term || row.Term),
        row && `${row.term_no || row.termNo || row.TermNo || ''}/${row.academic_year || row.academicYear || row.AcademicYear || ''}`,
        legacy.display_label || legacy.term || legacy.Term,
        `${legacy.term_no || legacy.termNo || legacy.TermNo || ''}/${legacy.academic_year || legacy.academicYear || legacy.AcademicYear || ''}`
      ].map(text).filter(Boolean);
      if (termId && labels.some(label => sameTerm(label, requestedRaw)) && !requestedRow) candidates.add(termId);
    });
    return [...candidates];
  }
  async function readAllRows(name, termCandidates) {
    const rows = [];
    const pageSize = 500;
    // Activity tables can carry a large legacy_data JSON payload. The UI only
    // needs the canonical columns below; selecting the whole row makes a cold
    // PostgREST/RLS read much more likely to hit the server statement budget.
    const projections = {
      assignments: 'assignment_id,term_id,teacher_class_id,subject_code,title,assignment_type,max_score,due_date,level,room,status',
      attendance: 'record_id,term_id,student_id,subject_code,attendance_date,status,note,recorder,legacy_data',
      scores: 'score_id,term_id,assignment_id,student_id,subject_code,score,is_submitted,legacy_data'
    };
    // These tables grow with every lesson and score entry. Reading the whole
    // history on every page load causes PostgREST statement timeouts. The
    // compatibility layer is always consumed for one active term at a time,
    // so keep the same legacy shape while restricting the database read to
    // that term. This is read-only and does not alter stored data.
    const termScoped = ['students', 'assignments', 'attendance', 'scores'].includes(name);
    const term = termScoped ? activeTermHint() : '';
    const terms = termScoped ? (termCandidates && termCandidates.length ? termCandidates : (term ? [term] : [])) : [''];
    if (termScoped && !terms.length) return { data: [], error: null };
    // Avoid one large IN(...) statement. On the live dataset that query can
    // exceed PostgREST's statement timeout even when each term-specific read
    // is small enough. Reading each canonical/legacy term separately keeps
    // the compatibility layer read-only and allows both aliases to coexist.
    for (const termValue of terms) {
      for (let offset = 0; ; offset += pageSize) {
        let query = client.from(tableName(name)).select(projections[name] || '*');
        if (termValue) query = query.eq('term_id', termValue);
        const result = name === 'assignments'
          ? await query.limit(pageSize)
          : await query.range(offset, offset + pageSize - 1);
        let { data, error } = result;
        // Keep bootstrap resilient to a problematic optional assignment
        // column/legacy projection. Retry the smallest canonical projection
        // before surfacing a real RLS/database error to the UI.
        if (error && name === 'assignments') {
          let fallback = client.from(tableName(name)).select('assignment_id,term_id,subject_code,title,max_score,level,room');
          if (termValue) fallback = fallback.eq('term_id', termValue);
          ({ data, error } = await fallback.limit(pageSize));
        }
        if (error) return { data: null, error };
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
    }
    return { data: rows, error: null };
  }
  function keyOf(row, name) {
    const candidates = {
      terms: ['TermID', 'term_id', 'termId'], students: ['StudentID', 'student_id', 'studentId'],
      subjects: ['SubjectCode', 'subject_code', 'subjectCode'], teacherClasses: ['TeacherClassID', 'teacher_class_id', 'teacherClassId'],
      assignments: ['AssignmentID', 'assignment_id', 'assignmentId'], attendance: ['RecordID', 'record_id', 'recordId'],
      scores: ['ScoreID', 'score_id', 'scoreId'], users: ['UserID', 'user_id', 'userId'], authProfiles: ['id', 'legacy_user_id'], settings: ['setting_key', 'Key', 'key']
    }[name] || [];
    return text(candidates.map(k => row && row[k]).find(Boolean));
  }
  function first(row, keys) { return keys.map(k => row && row[k]).find(v => v !== undefined && v !== null); }
  function legacyRow(name, row) {
    const base = row && row.legacy_data && typeof row.legacy_data === 'object' ? clone(row.legacy_data) : {};
    const out = { ...base, ...clone(row) };
    if (name === 'settings') {
      const value = row && row.value && typeof row.value === 'object' ? clone(row.value) : {};
      Object.assign(out, value, { Key: first(row, ['setting_key', 'Key', 'key']) || value.Key, TermID: first(row, ['term_id', 'TermID']) || value.TermID });
    }
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
    // Keep the stored term primary key as the only database identity. Labels
    // such as 1/2569 are for display and must not be written as a second key.
    return found ? text(found.term_id || found.TermID || found.termId) : raw;
  }
  // Scores are a high fan-out read: one class needs its roster, assignment
  // columns, and scores for those assignments. Read those sets directly so
  // the static Supabase build does not emulate a Firebase child listener or
  // reread the full scores table once per assignment.
  window.__SUPABASE_SCORE_GRID__ = async (context = {}) => {
    const requestedTerm = text(context.term || context.termId || activeTermHint());
    const { data: termRows, error: termError } = await client.from('terms').select('*');
    if (termError) throw termError;
    const termIds = termFilterCandidates(termRows || [], requestedTerm);
    const scopedTerms = termIds.length ? termIds : [requestedTerm];
    const readScoped = async (table, columns, filter) => {
      const rows = [];
      for (const termId of scopedTerms) {
        let query = client.from(table).select(columns).eq('term_id', termId);
        if (filter) query = filter(query);
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data || []));
      }
      return rows;
    };
    const [studentRows, assignmentRows] = await Promise.all([
      readScoped('students', 'student_id,term_id,student_no,prefix,first_name,last_name,level,room,status,legacy_data', query => query.eq('level', text(context.level)).eq('room', text(context.room))),
      readScoped('assignments', 'assignment_id,term_id,teacher_class_id,subject_code,title,assignment_type,max_score,due_date,level,room,status,legacy_data', query => query.eq('subject_code', text(context.subjectCode || context.subject)).eq('level', text(context.level)).eq('room', text(context.room)))
    ]);
    const assignmentIds = [...new Set(assignmentRows.map(row => text(row.assignment_id)).filter(Boolean))];
    const scoreRows = [];
    for (const termId of scopedTerms) {
      if (!assignmentIds.length) break;
      const { data, error } = await client.from('scores')
        .select('score_id,term_id,assignment_id,student_id,subject_code,score,is_submitted,legacy_data')
        .eq('term_id', termId).in('assignment_id', assignmentIds);
      if (error) throw error;
      scoreRows.push(...(data || []));
    }
    const students = studentRows.map(row => {
      const value = legacyRow('students', row);
      const firstName = text(value.FirstName), lastName = text(value.LastName);
      return { id: text(value.StudentID), studentId: text(value.StudentID), prefix: text(value.Prefix), first: firstName, last: lastName, firstName, lastName, name: [text(value.Prefix), firstName, lastName].filter(Boolean).join(' '), no: value.StudentNo, level: text(value.Level), room: text(value.Room), status: text(value.Status), term: text(value.TermID || value.Term), termId: text(value.TermID || value.Term) };
    });
    const assignments = assignmentRows.map(row => {
      const value = legacyRow('assignments', row);
      return { id: text(value.AssignmentID), assignmentId: text(value.AssignmentID), title: text(value.Title), maxScore: Number(value.MaxScore || 0), subjectCode: text(value.SubjectCode), type: text(value.AssignmentType || value.Type), dateCreated: value.DateCreated, term: text(value.TermID || value.Term), termId: text(value.TermID || value.Term), classId: text(value.TeacherClassID || value.ClassID || value.classId), dueDate: value.DueDate, level: text(value.Level), room: text(value.Room), displayOrder: Number(value.DisplayOrder ?? value.displayOrder ?? 0) };
    });
    const scores = {};
    scoreRows.forEach(row => {
      const value = legacyRow('scores', row);
      const score = { id: text(value.ScoreID), scoreId: text(value.ScoreID), assignmentId: text(value.AssignmentID), studentId: text(value.StudentID), teacherClassId: text(value.TeacherClassID), classId: text(value.ClassID || value.classId), termId: text(value.TermID || value.term_id), score: value.Score, isSubmitted: value.IsSubmitted, term: text(value.TermID || value.Term) };
      if (score.assignmentId && score.studentId) scores[`${score.assignmentId}_${score.studentId}`] = score;
    });
    return { success: true, data: { term: requestedTerm, subject: text(context.subjectCode || context.subject), subjectCode: text(context.subjectCode || context.subject), level: text(context.level), room: text(context.room), students, assignments, scores, orphanScores: [] } };
  };
  function pathParts(path) { return String(path || '').split('/').filter(Boolean); }
  function payloadFor(name, key, value) {
    const table = tableName(name);
    if (name === 'settings' || name === 'systemSettings') {
      // Firebase-style update paths escape characters such as `/` and `|`.
      // Persist the canonical setting key from the payload instead, otherwise
      // gradingData cannot find the row after reload even when the upsert
      // itself succeeds.
      const settingKey = text(value && (value.Key || value.key)) || key;
      const rawTermId = value && (value.TermID || value.term_id);
      const payload = { setting_key: settingKey, term_id: rawTermId ? canonicalTermId(rawTermId) : null, value: value && (value.Value ?? value.value ?? value), updated_at: new Date().toISOString() };
      return { table: 'settings', idCol: 'setting_key', payload };
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
    return { table, idCol, payload: p };
  }
  async function persist(name, key, value) { const item = payloadFor(name, key, value); const { error } = await client.from(item.table).upsert(item.payload); if (error) throw error; }
  async function remove(name, key) { const idCol = { terms:'term_id',students:'student_id',subjects:'subject_code',teacherClasses:'teacher_class_id',assignments:'assignment_id',attendance:'record_id',scores:'score_id',users:'user_id',authProfiles:'id' }[name]; if (!idCol) throw new Error(`ไม่รองรับการลบตาราง ${name}`); const { error } = await client.from(tableName(name)).delete().eq(idCol,key); if (error) throw error; }
  async function batchUpdate(values) {
    const grouped = new Map();
    for (const [path, value] of Object.entries(values || {})) {
      const parts = pathParts(path); if (parts.length < 2) continue;
      const name = reverseTableMap[parts[0]] || parts[0], key = parts[1];
      const group = grouped.get(name) || { upserts: [], deletes: [], item: null };
      if (value === null) group.deletes.push(key);
      else { const item = payloadFor(name, key, value); group.item = item; group.upserts.push(item.payload); }
      grouped.set(name, group);
    }
    for (const [name, group] of grouped) {
      if (group.upserts.length) { const { error } = await client.from(group.item.table).upsert(group.upserts); if (error) throw error; }
      if (group.deletes.length) {
        const idCol = ({ terms:'term_id',students:'student_id',subjects:'subject_code',teacherClasses:'teacher_class_id',assignments:'assignment_id',attendance:'record_id',scores:'score_id',users:'user_id',authProfiles:'id' })[name];
        if (!idCol) throw new Error(`ไม่รองรับการลบตาราง ${name}`);
        const { error } = await client.from(tableName(name)).delete().in(idCol, group.deletes); if (error) throw error;
      }
    }
  }
  function applyRootUpdate(values) {
    if (!rootCache) return;
    for (const [path, value] of Object.entries(values || {})) {
      const parts = pathParts(path); if (parts.length < 2) continue;
      const name = reverseTableMap[parts[0]] || parts[0], key = parts[1];
      rootCache[name] = rootCache[name] || {};
      if (value === null) delete rootCache[name][key];
      else rootCache[name][key] = clone(value);
      if (name === 'settings') {
        rootCache.systemSettings = rootCache.systemSettings || {};
        if (value === null) delete rootCache.systemSettings[key];
        else rootCache.systemSettings[key] = { Key: key, Value: value.Value ?? value.value ?? value };
      }
    }
  }
  function notifyListenersFromCache() {
    listeners.slice().forEach(({ ref, handler }) => {
      let value = rootCache || {};
      for (const part of pathParts(ref.path)) value = value == null ? undefined : value[part];
      if (ref.order && value && typeof value === 'object') value = Object.fromEntries(Object.entries(value).filter(([, row]) => text(row && (row[ref.order] ?? row[ref.order[0]?.toUpperCase() + ref.order.slice(1)])) === text(ref.equal)));
      handler({ val: () => clone(value || {}) });
    });
  }
  function commitRootCache(values) {
    applyRootUpdate(values);
    rootPromise = Promise.resolve(clone(rootCache || {}));
    notifyListenersFromCache();
  }
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
        if (!rootCache) await loadRoot();
        await batchUpdate(values);
        // The database acknowledgement is authoritative. Patch the local
        // read cache only after the batch succeeds; a second full-root read
        // would add latency and consume quota without improving correctness.
        commitRootCache(values);
        return;
      }
      if (pathParts(this.path).length >= 2) {
        const current = await this.value();
        await this.set({ ...(current || {}), ...(values || {}) });
        return;
      }
      for (const [key,value] of Object.entries(values||{})) await this.write(value, key);
    }
    async write(value, child, refresh = true) { const parts=pathParts(this.path); const name=reverseTableMap[parts[0]] || parts[0]; const key=child ? pathParts(child)[0] : parts[1]; if (!name) return; if (!rootCache) await loadRoot(); if (value === null) await remove(name,key); else await persist(name,key,value); if (refresh) commitRootCache({ [`${parts[0]}/${key}`]: value }); }
    remove() { return this.set(null); }
  }
  const auth = { currentUser: null, Auth:{Persistence:{LOCAL:'local'}}, setPersistence:()=>Promise.resolve(), onAuthStateChanged(cb){ let active=true; let unsubscribe=()=>{ active=false; }; (async()=>{ try { await callbackReady; } catch (error) { console.error('SUPABASE_CALLBACK_SESSION_FAILED', error); } const {data,error}=await client.auth.getSession(); if (error) console.error('SUPABASE_GET_SESSION_FAILED', error); auth.currentUser=data?.session?.user||null; if (auth.currentUser) window.__SUPABASE_SESSION_READY__ = true; if (!active) return; setTimeout(()=>{ if (active) cb(auth.currentUser); },0); const {data:sub}=client.auth.onAuthStateChange((_event,session)=>{auth.currentUser=session?.user||null; if (auth.currentUser) window.__SUPABASE_SESSION_READY__ = true; if (active) cb(auth.currentUser); }); unsubscribe=()=>{ active=false; sub.subscription.unsubscribe(); }; })(); return ()=>unsubscribe(); }, async signInAnonymously(){ throw new Error('Supabase anonymous auth is disabled'); }, async signInWithPopup(){ const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.href}}); if(error) throw error; return {user:auth.currentUser,data}; }, async signOut(){ const {error}=await client.auth.signOut(); if(error) throw error; auth.currentUser=null; window.__SUPABASE_SESSION_READY__ = false; } };
  window.firebase = { initializeApp:()=>({}), auth:()=>auth, database:()=>({ref:path=>new Ref(path)}) };
  window.__SUPABASE_MODE__ = true;
  window.firebase.auth.Auth=auth.Auth; window.firebase.auth.GoogleAuthProvider=function GoogleAuthProvider(){};
  window.__SUPABASE_CLIENT__=client; window.__SUPABASE_ROOT__=()=>loadRoot();
})();
