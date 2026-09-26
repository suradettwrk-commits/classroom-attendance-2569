/* Supabase data/auth bridge for the static GitHub Pages build.
 * The firebase-shaped API below is only a legacy application interface;
 * supabase-compat.js supplies it and no Firebase SDK or Firebase data source
 * is initialized in the production build.
 */
(function () {
  const app = firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.database();
  // Keep Google Auth across reloads so Supabase RLS sees the same identity
  // that the UI session represents.
  const persistenceReady = Promise.race([
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
      console.warn('Supabase Auth persistence unavailable', error && error.code ? error.code : error);
    }),
    new Promise((resolve) => setTimeout(resolve, 2500))
  ]);
  let snapshotPromise;
  let authReadyPromise;
  let termsPromise;
  // Do not let a stalled Supabase connection block the application forever.
  // These are client-side circuit breakers only; they never delete or alter
  // records. A failed read is surfaced to the UI so the teacher can retry.
  const READ_CALL_TIMEOUT_MS = 15000;
  const READ_CALL_RETRIES = 1;
  // Google Auth persistence can be slow on a cold browser/profile. Do not
  // fall through to anonymous access before the saved teacher session has
  // had a real chance to restore.
  const AUTH_RESTORE_TIMEOUT_MS = 20000;
  const AUTH_SIGN_IN_TIMEOUT_MS = 12000;
  const SCORE_REALTIME_BOOT_TIMEOUT_MS = 18000;
  // Writes must fail back to the durable local queue instead of leaving the
  // UI in a permanent "saving" state when Supabase never completes a request.
  const STUDENT_WRITE_CALL_TIMEOUT_MS = 20000;

  function readTerms() {
    // All realtime and one-shot reads must wait for Supabase Auth restoration.
    // Starting a listener before auth is ready produces a denied/empty first
    // snapshot and leaves the UI waiting even though the account is valid.
    if (!termsPromise) termsPromise = ready().then(() => db.ref('/terms').once('value')).catch((error) => {
      // An offline/auth failure must not poison every later score request.
      termsPromise = null;
      throw error;
    });
    return termsPromise;
  }

  function ready() {
    // Supabase can briefly expose currentUser=null while LOCAL persistence is
    // still restoring Google Auth. Waiting for persistence prevents admin calls
    // from falling through to Anonymous and receiving an empty/denied snapshot.
    return persistenceReady.then(() => {
      if (auth.currentUser) return auth.currentUser;
      if (!authReadyPromise) authReadyPromise = new Promise((resolve) => {
        let unsubscribe = null;
        const finish = (user) => {
          if (unsubscribe) unsubscribe();
          resolve(user || null);
        };
        // Supabase emits an initial null while LOCAL persistence is being
        // restored. Do not treat that transient event as a real logout.
        const timeout = setTimeout(() => finish(auth.currentUser || null), AUTH_RESTORE_TIMEOUT_MS);
        unsubscribe = auth.onAuthStateChanged((user) => {
          if (!user) return;
          clearTimeout(timeout);
          finish(user);
        });
      });
      return authReadyPromise.then((user) => {
        if (user) return user;
        // Supabase Auth is the only production identity provider. Never
        // manufacture an anonymous Firebase identity here: it makes the UI
        // appear logged in while every protected CRUD write is rejected.
        if (window.__SUPABASE_MODE__) return null;
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('หมดเวลายืนยันการเชื่อมต่อ Supabase');
            error.code = 'client/auth-timeout';
            reject(error);
          }, AUTH_SIGN_IN_TIMEOUT_MS);
        });
        if (window.__SUPABASE_MODE__) {
          return Promise.race([
            window.__SUPABASE_CLIENT__?.auth?.getSession().then((result) => {
              const user = result?.data?.session?.user || null;
              if (!user) throw new Error('กรุณาเข้าสู่ระบบด้วย Google ของบัญชีครูก่อนบันทึกข้อมูล');
              auth.currentUser = user;
              return user;
            }),
            timeout
          ]).finally(() => clearTimeout(timer));
        }
        return Promise.race([auth.signInAnonymously().then((result) => result.user), timeout]).finally(() => clearTimeout(timer));
      });
    });
  }

  function rawMap(value) { return value && typeof value === 'object' ? value : {}; }
  function values(name, root) { return Object.values(rawMap(root[name])); }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function withoutUndefined(value) {
    if (Array.isArray(value)) return value.map(withoutUndefined);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, withoutUndefined(v)]));
    }
    return value;
  }
  function firebaseKey(value) {
    return text(value).replace(/[.#$\[\]\/]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  }
  function loginKey(value) { return text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ''); }
  function emailKey(value) {
    return encodeURIComponent(text(value).toLowerCase()).replace(/[.#$\[\]\/]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  }
  function numericPart(value) { const match = text(value).match(/\d+(?:\.\d+)?/); return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER; }
  function classSort(a, b) { return numericPart(a.level) - numericPart(b.level) || numericPart(a.room) - numericPart(b.room) || text(a.level).localeCompare(text(b.level), 'th') || text(a.room).localeCompare(text(b.room), 'th'); }
  function termLabel(record) {
    if (!record) return '';
    const termNo = text(record.TermNo || record.termNo);
    const academicYear = text(record.AcademicYear || record.academicYear);
    if (termNo && academicYear) return `${termNo}/${academicYear}`;
    return text(record.TermID || record.term || record.Term);
  }

  function canonicalTermId(value, root) {
    const raw = text(value);
    if (!root || !raw) return raw;
    const found = values('terms', root).find((t) => text(t.TermID) === raw || termLabel(t) === raw || `${text(t.TermNo)}/${text(t.AcademicYear)}` === raw);
    if (!found) return raw;
    // TermID is the persisted database key. The visible label (for example
    // 1/2569) is only a presentation value and must never be replaced by a
    // synthetic key such as TERM_2569_1. Older rows use a timestamp-shaped
    // TermID, so every read/write path must resolve back to this exact value.
    return text(found.TermID || found.term_id || found.CanonicalTermID || found.TermKey) || raw;
  }
  function classScopeKey(term, level, room, root) {
    const termId = canonicalTermId(term, root);
    return termId && text(level) && text(room) ? firebaseKey(`CLASS_${termId}_${text(level)}_${text(room)}`) : '';
  }
  function student(row, root) {
    const first = text(row.FirstName || row.firstName || row.first);
    const last = text(row.LastName || row.lastName || row.last);
    const prefix = text(row.Prefix || row.prefix);
    const level = text(row.Level || row.level);
    const room = text(row.Room || row.room);
    const rawTerm = text(row.TermID || row.Term || row.term);
    const termId = canonicalTermId(rawTerm, root);
    return { id: text(row.StudentID || row.studentId || row.id), studentId: text(row.StudentID || row.studentId || row.id), prefix, first, last, firstName: first, lastName: last, name: [prefix, first, last].filter(Boolean).join(' '), level, room, no: row.No ?? row.no, status: text(row.Status ?? row.status), imageUrl: text(row.ProfileImage || row.profileImage), profileImage: text(row.ProfileImage || row.profileImage), icon: text(row.Icon || row.icon), term: rawTerm, termId, classId: text(row.ClassID || row.classId) || classScopeKey(termId, level, room, root) };
  }
  function user(row) {
    return { id: text(row.UserID || row.id), username: text(row.Username || row.username), email: text(row.Email || row.email), name: text(row.Name || row.name), role: text(row.Role || row.role).toLowerCase(), status: text(row.Status || row.status), imageUrl: text(row.ProfileImage || row.imageUrl), prefix: text(row.Prefix || row.prefix), lastName: text(row.LastName || row.lastName), position: text(row.Position || row.position), school: text(row.School || row.school), group: text(row.Group || row.group) };
  }
  function normalizedTerm(value, root) {
    const raw = text(value);
    if (!root || !raw) return raw;
    const found = values('terms', root).find((t) => text(t.TermID) === raw || termLabel(t) === raw || `${text(t.TermNo)}/${text(t.AcademicYear)}` === raw);
    return found ? termLabel(found) : raw;
  }
  function canonicalTerm(value, root) {
    const raw = text(value);
    if (!root || !raw) return raw;
    return normalizedTerm(raw, root);
  }
  // Firebase contains both the display label (`1/2569`) and the historical
  // Terms.TermID timestamp. Treat every record as belonging to the same
  // canonical term at the read boundary; never rewrite the source rows here.
  function recordTerm(row) {
    return row && (row.Term || row.TermID || row.term || row.termId);
  }
  function subject(row, root) { return { code: text(row.SubjectCode), name: text(row.SubjectName), term: normalizedTerm(row.Term, root), status: text(row.Status), teacher: text(row.Teacher), classes: text(row.Classes) }; }
  function assignment(row, root) { const rawTerm = row.TermID || row.Term || row.term; return { id: text(row.AssignmentID), assignmentId: text(row.AssignmentID), title: text(row.Title), maxScore: Number(row.MaxScore || 0), subjectCode: text(row.SubjectCode), type: text(row.Type), dateCreated: row.DateCreated, term: normalizedTerm(rawTerm, root), termId: canonicalTermId(rawTerm, root), classId: text(row.ClassID || row.classId), dueDate: row.DueDate, level: text(row.Level), room: text(row.Room), displayOrder: Number(row.DisplayOrder ?? row.displayOrder ?? 0) }; }
  function attendance(row, root) { const rawTerm = row.TermID || row.Term || row.term; return { id: text(row.RecordID), recordId: text(row.RecordID), timestamp: row.Timestamp, date: text(row.Date), subject: text(row.SubjectCode), subjectCode: text(row.SubjectCode), level: text(row.Level), room: text(row.Room), studentId: text(row.StudentID), status: text(row.Status), recorder: text(row.Recorder), term: normalizedTerm(rawTerm, root), termId: canonicalTermId(rawTerm, root), classId: text(row.ClassID || row.classId), note: text(row.Note) }; }
  function score(row) {
    return {
      id: text(row.ScoreID),
      scoreId: text(row.ScoreID),
      timestamp: row.Timestamp,
      assignmentId: text(row.AssignmentID),
      studentId: text(row.StudentID),
      teacherClassId: text(row.TeacherClassID || row.teacherClassId),
      classId: text(row.ClassID || row.classId),
      termId: text(row.TermID || row.termId),
      // Read legacy camelCase records as well as canonical Firebase fields.
      score: row.Score !== undefined ? row.Score : row.score,
      isSubmitted: row.IsSubmitted !== undefined ? row.IsSubmitted : row.isSubmitted,
      term: text(row.Term || row.term)
    };
  }
  function teacherClass(row, root) {
    const rooms = Array.isArray(row.rooms) ? row.rooms : [];
    const teacherId = text(row.TeacherID || row.teacherId);
    const subjectCode = text(row.SubjectCode || row.subjectCode || row.subject);
    const teacherRecord = values('users', root).find((u) => text(u.UserID || u.id) === teacherId) || {};
    const subjectRecord = values('subjects', root).find((s) => text(s.SubjectCode || s.subjectCode) === subjectCode) || {};
    return {
      id: text(row.TeacherClassID || row.teacherClassId || row.id),
      teacherClassId: text(row.TeacherClassID || row.teacherClassId || row.id),
      classId: text(row.ClassID || row.classId),
      termId: text(row.TermID || row.termId),
      teacherId,
      teacherName: text(row.TeacherName || row.teacherName || teacherRecord.Name || teacherRecord.name),
      subjectCode,
      subjectName: text(row.SubjectName || row.subjectName || subjectRecord.SubjectName || subjectRecord.name),
      level: text(row.Level || row.level),
      room: text(row.Room || row.room || rooms[0]),
      term: normalizedTerm(row.TermID || row.term || row.Term, root),
      status: text(row.Status || row.status) || 'Active'
    };
  }
  function teacherClasses(root) { return values('teacherClasses', root).map((row) => teacherClass(row, root)); }
  function assistant(row, root) { return { id: text(row.AssistantID), assistantId: text(row.AssistantID), studentId: text(row.AssistantStudentID || row.StudentID || row.studentId), subjectCode: text(row.SubjectCode || row.subjectCode), level: text(row.Level || row.level), room: text(row.Room || row.room), term: normalizedTerm(row.TermID || row.term || row.Term, root), status: text(row.Status || row.status), assignedBy: text(row.AssignedBy), updatedAt: row.UpdatedAt }; }
  function allowedScopeRows(root, identity, term, subjectCode) {
    const role = text(identity && (identity.role || identity.Role)).toLowerCase();
    const userId = text(identity && (identity.id || identity.userId || identity.UserID));
    const wantedSubject = text(subjectCode);
    return values('teacherClasses', root).filter((row) =>
      text(row.Status || row.status).toLowerCase() !== 'inactive' &&
      matchesTerm(row.TermID || row.Term || row.term, term, root) &&
      (role === 'admin' || text(row.TeacherID || row.teacherId) === userId) &&
      (!wantedSubject || text(row.SubjectCode || row.subjectCode || row.subject) === wantedSubject)
    );
  }
  function findTeacherClass(root, teacherId, subjectCode, level, room, term, classId) {
    const wantedClassId = text(classId);
    return allowedScopeRows(root, { id: teacherId, role: 'teacher' }, term, subjectCode).find((row) =>
      (!wantedClassId || text(row.ClassID || row.classId) === wantedClassId) &&
      text(row.Level || row.level) === text(level) &&
      text(row.Room || row.room) === text(room)
    ) || null;
  }
  function teacherClassKey(teacherId, subjectCode, level, room, term) {
    return firebaseKey([term, teacherId, subjectCode, level, room].map(text).join('_'));
  }

  function data() {
    if (!snapshotPromise) snapshotPromise = ready().then((currentUser) => {
      const publicPaths = ['students', 'subjects', 'assignments', 'attendance', 'scores', 'terms', 'teacherClasses', 'classScopes', 'attendanceAssistants'];
      const adminPaths = ['config', 'systemSettings', 'settings', 'users', 'auditLog'];
      const paths = String(currentUser && currentUser.email || '').toLowerCase() === 'suradet.t@wrk.ac.th' ? publicPaths.concat(adminPaths) : publicPaths;
      // Optional/admin-only nodes must not make the whole public dataset
      // fail. A denied /users or /settings read should degrade that node to
      // an empty object while students, classes and records still load.
      return Promise.all(paths.map((pathName) => db.ref(`/${pathName}`).once('value').catch((error) => {
        console.warn(`Firebase read skipped: /${pathName}`, error && error.code ? error.code : error);
        return null;
      }))).then((snapshots) => {
        return snapshots.reduce((root, snap, index) => { root[paths[index]] = snap ? (snap.val() || {}) : {}; return root; }, {});
      });
    });
    return snapshotPromise;
  }

  function resetReadCaches() {
    snapshotPromise = null;
    termsPromise = null;
  }

  function isReadCall(name) {
    return new Set(['getCurrentUserProfile', 'getInitialSystemData', 'getInitialDropdowns', 'getTeacherSetupOptions', 'getTeacherAccessRequests', 'loginSystem', 'getDashboardStats', 'getStudents', 'getStudentsByFilter', 'getStudentById', 'getStudentSyncSnapshot', 'getUsers', 'getTerms', 'getAttendance', 'getAttendanceForCheck', 'getStudentModeData', 'getGradingData', 'loadScoresGrid']).has(name);
  }

  function callReadWithRecovery(name, args, options) {
    const timeoutMs = Number(options && options.timeoutMs) || READ_CALL_TIMEOUT_MS;
    const retries = options && options.retries !== undefined ? Number(options.retries) : READ_CALL_RETRIES;
    let attempt = 0;
    const run = () => {
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`หมดเวลารอข้อมูล (${name})`);
          error.code = 'client/read-timeout';
          reject(error);
        }, timeoutMs);
      });
      return Promise.race([call(name, args), deadline]).finally(() => clearTimeout(timer)).catch((error) => {
        if (attempt++ < retries) {
          resetReadCaches();
          console.warn(`Firebase read retry ${attempt}/${READ_CALL_RETRIES}: ${name}`, error && error.code ? error.code : error);
          return new Promise((resolve) => setTimeout(resolve, 800 * attempt)).then(run);
        }
        resetReadCaches();
        throw error;
      });
    };
    return run();
  }
  function callWithWriteTimeout(name, args) {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`หมดเวลาบันทึกข้อมูล (${String(name)})`);
        error.code = 'client/write-timeout';
        reject(error);
      }, STUDENT_WRITE_CALL_TIMEOUT_MS);
    });
    return Promise.race([call(name, args), deadline]).finally(() => clearTimeout(timer));
  }
  async function readTermScoped(pathName, selectedTerm, termRoot) {
    const root = termRoot || { terms: {} };
    const queryValues = termQueryValues(root, selectedTerm, pathName);
    const snapshots = await Promise.all(queryValues.map((value) =>
      db.ref(`/${pathName}`).orderByChild('Term').equalTo(value).once('value')
    ));
    const scopedValue = {};
    snapshots.forEach((snapshot) => Object.assign(scopedValue, snapshot.val() || {}));
    // Keep compatibility with legacy rows that have no indexed Term field.
    return Object.keys(scopedValue).length ? scopedValue : ((await db.ref(`/${pathName}`).once('value')).val() || {});
  }
  // Score entry only needs these nodes. Keeping attendance, audit, users and
  // settings out of this request makes reload-after-save much lighter.
  // Scope score reads at Firebase instead of reading every record and
  // filtering only after the response reaches the browser.
  async function scoreData(request, includeScores = true) {
    await ready();
    const requestedTerm = text(request && request.term);
    const termPromise = readTerms();
    const subjectCode = text(request && (request.subjectCode || request.subject));
    const studentsPromise = termPromise.then((snapshot) => {
      const root = { terms: snapshot.val() || {} };
      const selected = activeTerm(root, requestedTerm);
      return db.ref('/students').orderByChild('Term').equalTo(termQueryValue(root, selected, 'students')).once('value');
    });
    const assignmentsPromise = subjectCode
      ? db.ref('/assignments').orderByChild('SubjectCode').equalTo(subjectCode).once('value')
      : (requestedTerm
        ? db.ref('/assignments').orderByChild('Term').equalTo(requestedTerm).once('value')
        : termPromise.then((snapshot) => {
          const root = { terms: snapshot.val() || {} };
          return db.ref('/assignments').orderByChild('Term').equalTo(activeTerm(root, '')).once('value');
        }));
    const [termSnapshot, studentsSnapshot, assignmentsSnapshot] = await Promise.all([termPromise, studentsPromise, assignmentsPromise]);
    const termRoot = { terms: termSnapshot.val() || {} };
    const selected = activeTerm(termRoot, requestedTerm);
    let studentsRoot = studentsSnapshot.val() || {};
    if (!Object.keys(studentsRoot).length && requestedTerm && selected !== requestedTerm) {
      studentsRoot = (await db.ref('/students').orderByChild('Term').equalTo(selected).once('value')).val() || {};
    }
    let assignmentRoot = assignmentsSnapshot.val() || {};
    if (!Object.keys(assignmentRoot).length && requestedTerm && selected !== requestedTerm) {
      assignmentRoot = (await db.ref('/assignments').orderByChild('Term').equalTo(selected).once('value')).val() || {};
    }
    if (!Object.keys(assignmentRoot).length) assignmentRoot = (await db.ref('/assignments').once('value')).val() || {};
    const wantedLevel = text(request && request.level);
    const wantedRoom = text(request && request.room);
    assignmentRoot = Object.fromEntries(Object.entries(assignmentRoot).filter(([, row]) =>
      (!subjectCode || text(row.SubjectCode || row.subjectCode) === subjectCode) &&
      matchesTerm(row.Term || row.TermID || row.term, selected, termRoot) &&
      (!wantedLevel || text(row.Level || row.level) === wantedLevel) &&
      (!wantedRoom || text(row.Room || row.room) === wantedRoom)
    ));
    // Preserve old records lacking Term before choosing which score IDs to read.
    if (!Object.keys(studentsRoot).length) studentsRoot = (await db.ref('/students').once('value')).val() || {};
    if (!Object.keys(assignmentRoot).length) {
      const legacyAssignments = (await db.ref('/assignments').once('value')).val() || {};
      assignmentRoot = Object.fromEntries(Object.entries(legacyAssignments).filter(([, row]) =>
        (!subjectCode || text(row.SubjectCode || row.subjectCode) === subjectCode) &&
        matchesTerm(row.Term || row.TermID || row.term, selected, termRoot) &&
        (!wantedLevel || text(row.Level || row.level) === wantedLevel) &&
        (!wantedRoom || text(row.Room || row.room) === wantedRoom)
      ));
    }
    let scoreRoot = {};
    if (includeScores) {
      // AssignmentID is indexed. Never download an entire term of scores to
      // show one class; retain legacy records regardless of their Term field.
      const assignmentIds = [...new Set(Object.values(assignmentRoot).map((row) => text(row.AssignmentID || row.assignmentId)).filter(Boolean))];
      const scoreSnapshots = await Promise.all(assignmentIds.map((id) => db.ref('/scores').orderByChild('AssignmentID').equalTo(id).once('value')));
      scoreSnapshots.forEach((snapshot) => { Object.assign(scoreRoot, snapshot.val() || {}); });
    }
    const root = {
      students: studentsRoot,
      assignments: assignmentRoot,
      scores: scoreRoot,
      terms: termRoot.terms,
      teacherClasses: {}
    };
    return root;
  }
  // Write path: only load the authorization context. It must not wait for
  // students, assignments or score history before sending a score update.
  async function saveScoreContext(request) {
    await ready();
    const [termSnapshot, teacherClassesSnapshot] = await Promise.all([
      readTerms(),
      db.ref('/teacherClasses').once('value')
    ]);
    return { terms: termSnapshot.val() || {}, teacherClasses: teacherClassesSnapshot.val() || {} };
  }
  // Dashboard only needs the selected term. Avoid downloading the full score
  // table and attendance history on every landing-page load.
  async function dashboardData(requestedTerm) {
    await ready();
    const terms = (await readTerms()).val() || {};
    const selected = activeTerm({ terms }, requestedTerm);
    const [students, assignments, teacherClasses, attendance] = await Promise.all([
      readTermScoped('students', selected, { terms }),
      readTermScoped('assignments', selected, { terms }),
      db.ref('/teacherClasses').once('value').then((snapshot) => snapshot.val() || {}),
      Promise.all(termQueryValues({ terms }, selected, 'attendance').map((value) => db.ref('/attendance').orderByChild('Term').equalTo(value).once('value'))).then((snapshots) => Object.assign({}, ...snapshots.map((snapshot) => snapshot.val() || {})))
    ]);
    return { students, assignments, terms, teacherClasses, attendance };
  }
  // Bootstrap is used for menus and class context only. Attendance and scores
  // are intentionally excluded; those large collections are loaded lazily by
  // the active tab instead of blocking the whole application at startup.
  async function bootstrapData() {
    await ready();
    const terms = (await readTerms()).val() || {};
    const selected = activeTerm({ terms }, '');
    const [students, subjects, assignments, teacherClasses] = await Promise.all([
      db.ref('/students').orderByChild('Term').equalTo(termQueryValue({ terms }, selected, 'students')).once('value').then((snapshot) => snapshot.val() || {}),
      db.ref('/subjects').once('value').then((snapshot) => snapshot.val() || {}),
      readTermScoped('assignments', selected, { terms }),
      db.ref('/teacherClasses').once('value').then((snapshot) => snapshot.val() || {})
    ]);
    return { students, subjects, assignments, terms, teacherClasses };
  }

  // Subscribe only to the active term. This is the real-time path used by
  // the client cache; it avoids downloading the whole database on every tab.
  function subscribeTermData(term, currentUser, onChange, onError) {
    let stopped = false;
    const readyNames = new Set();
    const state = {};
    const subscriptions = [];
    const attach = (selectedTerm, termRoot) => {
      if (stopped) return;
      const attachTermFamily = (name, pathName) => {
        const queryValues = termQueryValues(termRoot, selectedTerm, pathName);
        const refs = queryValues.length
          ? queryValues.map((value) => db.ref(`/${pathName}`).orderByChild('Term').equalTo(value))
          : [db.ref(`/${pathName}`)];
        const sourceRows = refs.map(() => ({}));
        const sourceReady = refs.map(() => false);
        let readyCount = 0;
        refs.forEach((ref, index) => {
          const handler = (snapshot) => {
            if (stopped) return;
            sourceRows[index] = snapshot.val() || {};
            if (!sourceReady[index]) {
              sourceReady[index] = true;
              readyCount += 1;
            }
            state[name] = Object.assign({}, ...sourceRows);
            if (readyCount === refs.length) readyNames.add(name);
            emit();
          };
          subscriptions.push({ ref, handler });
          ref.on('value', handler, (error) => {
            console.error('FIREBASE_REALTIME_ERROR', name, error && error.code ? error.code : error);
            if (!stopped && typeof onError === 'function') onError(error, name);
          });
        });
      };
      const specs = [
        ['subjects', db.ref('/subjects')],
        ['terms', db.ref('/terms')],
        ['teacherClasses', db.ref('/teacherClasses')]
      ];
      const emit = () => {
        // Attendance can be large and is not needed to build subject/room
        // filters. Do not make the entire UI wait for its first snapshot.
        const filtersReady = ['students', 'subjects', 'assignments', 'teacherClasses'].every((name) => readyNames.has(name));
        if (!stopped && filtersReady) onChange(initial({ ...state }, selectedTerm, currentUser), { term: selectedTerm, initial: true });
      };
      attachTermFamily('students', 'students');
      attachTermFamily('assignments', 'assignments');
      attachTermFamily('attendance', 'attendance');
      specs.forEach(([name, ref]) => {
        const handler = (snapshot) => {
          if (stopped) return;
          state[name] = snapshot.val() || {};
          readyNames.add(name);
          emit();
        };
        subscriptions.push({ ref, handler });
        ref.on('value', handler, (error) => {
          console.error('FIREBASE_REALTIME_ERROR', name, error && error.code ? error.code : error);
          if (!stopped && typeof onError === 'function') onError(error, name);
        });
      });
    };
    readTerms().then((snapshot) => {
      const root = { terms: snapshot.val() || {} };
      const selectedTerm = activeTerm(root, term);
      attach(selectedTerm, root);
    }).catch((error) => {
      if (!stopped && typeof onError === 'function') onError(error, 'terms');
    });
    return () => {
      stopped = true;
      subscriptions.forEach(({ ref, handler }) => ref.off('value', handler));
    };
  }

  // Score grids are live per selected subject/class. Scores are subscribed by
  // AssignmentID, so opening one class never downloads the whole score table.
  function subscribeScoreGrid(request, onChange, onError) {
    let stopped = false;
    const subscriptions = [];
    const scoreSubscriptions = new Map();
    let readyTimer = null;
    let errorNotified = false;
    const state = { students: {}, assignments: {}, scores: {} };
    let studentsReady = false;
    let assignmentsReady = false;
    let scoresReady = false;
    let termRoot = { terms: {} };
    let selectedTerm = text(request && request.term);
    const subjectCode = text(request && (request.subjectCode || request.subject));
    const level = text(request && request.level);
    const room = text(request && request.room);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (readyTimer) clearTimeout(readyTimer);
      subscriptions.forEach(({ ref, handler }) => ref.off('value', handler));
      scoreSubscriptions.forEach(({ ref, handler }) => ref.off('value', handler));
      scoreSubscriptions.clear();
    };
    const fail = (error, pathName) => {
      if (stopped || errorNotified) return;
      errorNotified = true;
      stop();
      if (typeof onError === 'function') onError(error, pathName);
    };
    const emit = (force) => {
      if (stopped) return;
      if (!force && (!studentsReady || !assignmentsReady || !scoresReady)) return;
      if (readyTimer) clearTimeout(readyTimer);
      const students = Object.values(state.students).filter((r) => (!level || text(r.Level) === level) && (!room || text(r.Room) === room)).map((r) => student(r, termRoot));
      const assignments = Object.values(state.assignments).filter((r) => matchesTerm(r.Term || r.TermID || r.term, selectedTerm, termRoot) && (!subjectCode || text(r.SubjectCode || r.subjectCode) === subjectCode) && (!level || text(r.Level || r.level) === level) && (!room || text(r.Room || r.room) === room)).map((r) => assignment(r, termRoot));
      const assignmentIds = new Set(assignments.map((r) => r.id));
      const studentIds = new Set(students.map((s) => s.id));
      const scores = {};
      Object.values(state.scores).forEach((r) => {
        const aid = text(r.AssignmentID || r.assignmentId), sid = text(r.StudentID || r.studentId);
        if (assignmentIds.has(aid) && studentIds.has(sid)) scores[`${aid}_${sid}`] = score(r);
      });
      onChange({ success: true, data: { term: selectedTerm, subject: subjectCode, subjectCode, level, room, students, assignments, scores } });
    };
    const attach = (ref, handler, name) => {
      subscriptions.push({ ref, handler });
      ref.on('value', handler, (error) => fail(error, name));
    };
    // A single denied/stalled child listener must not leave the score tab
    // spinning forever. The UI will use its bounded one-shot fallback.
    readyTimer = setTimeout(() => {
      const error = new Error('หมดเวลารอข้อมูลคะแนนแบบเรียลไทม์');
      error.code = 'client/realtime-timeout';
      fail(error, 'score-grid');
    }, SCORE_REALTIME_BOOT_TIMEOUT_MS);
    const termsReady = readTerms().then((snapshot) => { termRoot = { terms: snapshot.val() || {} }; selectedTerm = activeTerm(termRoot, selectedTerm); });
    termsReady.then(() => {
      if (stopped) return;
      attach(db.ref('/students').orderByChild('Term').equalTo(termQueryValue(termRoot, selectedTerm, 'students')), (snapshot) => { state.students = snapshot.val() || {}; studentsReady = true; emit(); }, 'students');
      const assignmentRef = subjectCode ? db.ref('/assignments').orderByChild('SubjectCode').equalTo(subjectCode) : db.ref('/assignments').orderByChild('Term').equalTo(selectedTerm);
      attach(assignmentRef, (snapshot) => {
        state.assignments = snapshot.val() || {};
        assignmentsReady = true;
        const wanted = new Set(Object.values(state.assignments).filter((r) =>
          matchesTerm(r.Term || r.TermID || r.term, selectedTerm, termRoot) &&
          (!subjectCode || text(r.SubjectCode || r.subjectCode) === subjectCode) &&
          (!level || text(r.Level || r.level) === level) &&
          (!room || text(r.Room || r.room) === room)
        ).map((r) => text(r.AssignmentID || r.assignmentId)).filter(Boolean));
        scoreSubscriptions.forEach((subscription, id) => {
          if (wanted.has(id)) return;
          subscription.ref.off('value', subscription.handler);
          scoreSubscriptions.delete(id);
        });
        scoresReady = false;
        wanted.forEach((id) => {
          if (scoreSubscriptions.has(id)) return;
          const ref = db.ref('/scores').orderByChild('AssignmentID').equalTo(id);
          const subscription = { ref, handler: null, rows: {}, ready: false };
          subscription.handler = (scoreSnapshot) => {
            if (stopped) return;
            subscription.rows = scoreSnapshot.val() || {};
            subscription.ready = true;
            state.scores = {};
            scoreSubscriptions.forEach((entry) => Object.assign(state.scores, entry.rows));
            scoresReady = [...scoreSubscriptions.values()].every((entry) => entry.ready);
            emit();
          };
          scoreSubscriptions.set(id, subscription);
          ref.on('value', subscription.handler, (error) => fail(error, 'scores'));
        });
        scoresReady = [...scoreSubscriptions.values()].every((entry) => entry.ready);
        state.scores = {};
        scoreSubscriptions.forEach((entry) => Object.assign(state.scores, entry.rows));
        emit();
      }, 'assignments');
    }).catch((error) => fail(error, 'terms'));
    return stop;
  }

  // Grading uses the same central Firebase snapshot as the score tab. Keep
  // the whole selected class atomic so students, assignments, raw scores and
  // grading components never render from different revisions.
  function subscribeGradingData(request, onChange, onError) {
    let stopped = false;
    const subscriptions = [];
    let readyTimer = null;
    let errorNotified = false;
    const state = { students: {}, assignments: {}, scores: {}, settings: {}, teacherClasses: {}, terms: {} };
    let readyCount = 0;
    let termRoot = { terms: {} };
    let selectedTerm = text(request && request.term);
    const filter = { ...request };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (readyTimer) clearTimeout(readyTimer);
      subscriptions.forEach(({ ref, handler }) => ref.off('value', handler));
    };
    const fail = (error, pathName) => {
      if (stopped || errorNotified) return;
      errorNotified = true;
      stop();
      if (typeof onError === 'function') onError(error, pathName);
    };
    const emit = () => {
      if (stopped || readyCount < 6) return;
      if (readyTimer) clearTimeout(readyTimer);
      const root = { ...state };
      const data = gradingData(root, filter);
      onChange({ success: true, data });
    };
    const attach = (name, ref) => {
      const handler = (snapshot) => {
        if (stopped) return;
        state[name] = snapshot.val() || {};
        readyCount += 1;
        emit();
      };
      subscriptions.push({ ref, handler });
      ref.on('value', handler, (error) => {
        fail(error, name);
      });
    };
    const attachTermFamily = (name, pathName) => {
      const queryValues = termQueryValues(termRoot, selectedTerm, pathName);
      const refs = queryValues.length
        ? queryValues.map((value) => db.ref(`/${pathName}`).orderByChild('Term').equalTo(value))
        : [db.ref(`/${pathName}`)];
      const sourceRows = refs.map(() => ({}));
      const sourceReady = refs.map(() => false);
      let familyReady = false;
      refs.forEach((ref, index) => {
        const handler = (snapshot) => {
          if (stopped) return;
          sourceRows[index] = snapshot.val() || {};
          if (!sourceReady[index]) sourceReady[index] = true;
          state[name] = Object.assign({}, ...sourceRows);
          if (!familyReady && sourceReady.every(Boolean)) {
            familyReady = true;
            readyCount += 1;
          }
          emit();
        };
        subscriptions.push({ ref, handler });
        ref.on('value', handler, (error) => fail(error, name));
      });
    };
    readyTimer = setTimeout(() => {
      const error = new Error('หมดเวลารอข้อมูลตัดเกรดแบบเรียลไทม์');
      error.code = 'client/realtime-timeout';
      fail(error, 'grading');
    }, SCORE_REALTIME_BOOT_TIMEOUT_MS);
    readTerms().then((snapshot) => {
      if (stopped) return;
      termRoot = { terms: snapshot.val() || {} };
      selectedTerm = activeTerm(termRoot, selectedTerm);
      filter.term = selectedTerm;
      attachTermFamily('students', 'students');
      attachTermFamily('assignments', 'assignments');
      attachTermFamily('scores', 'scores');
      attach('settings', db.ref('/settings'));
      attach('teacherClasses', db.ref('/teacherClasses'));
      attach('terms', db.ref('/terms'));
    }).catch((error) => fail(error, 'terms'));
    return stop;
  }
  function activeTerm(root, requested) {
    const wanted = canonicalTerm(requested, root);
    const terms = values('terms', root);
    return wanted || termLabel(terms.find((t) => text(t.Status).toLowerCase() === 'active') || terms[0]) || '1/2569';
  }
  function termQueryValue(root, selected, pathName) {
    const wanted = canonicalTerm(selected, root);
    // The legacy migration stores students (and some record families) with
    // the active TermID timestamp, while assignments use the visible label
    // such as `1/2569`. Query each family using the value it actually stores.
    if (pathName === 'students') {
      const terms = values('terms', root);
      const active = terms.find((t) => termLabel(t) === wanted) || terms.find((t) => text(t.Status).toLowerCase() === 'active') || terms[0];
      return text(active && active.TermID) || wanted;
    }
    return wanted;
  }
  function termQueryValues(root, selected, pathName) {
    // Historical migrations stored the visible term label in some families
    // and the Terms.TermID timestamp in others. Read both representations
    // and merge by Firebase key without changing the source data.
    const wanted = canonicalTerm(selected, root);
    const candidates = [];
    const add = (value) => {
      const normalized = text(value);
      if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
    };
    add(termQueryValue(root, selected, pathName));
    add(wanted);
    values('terms', root).forEach((record) => {
      if (termLabel(record) === wanted) {
        add(record.TermID);
        add(record.TermKey);
        add(record.CanonicalTermID);
      }
    });
    return candidates;
  }
  function matchesTerm(value, selected, root) {
    const v = canonicalTerm(value, root); const wanted = canonicalTerm(selected, root);
    return !v || !wanted || v === wanted;
  }
  function initial(root, term, currentUser) {
    const selectedTerm = activeTerm(root, term);
    const termMatches = (value) => matchesTerm(value, selectedTerm, root);
    const role = text(currentUser && currentUser.role).toLowerCase();
    const allTeacherClasses = values('teacherClasses', root).filter((r) => termMatches(r.TermID || r.Term || r.term) && text(r.Status || r.status).toLowerCase() !== 'inactive');
    const scopedTeacherClasses = allowedScopeRows(root, currentUser, selectedTerm);
    const allowedClasses = scopedTeacherClasses.map((r) => ({ subject: text(r.SubjectCode || r.subjectCode), level: text(r.Level || r.level), room: text(r.Room || r.room) })).filter((r) => r.subject && r.level && r.room);
    const isAllowedStudent = (r) => role === 'admin' || allowedClasses.some((x) => x.level === text(r.Level || r.level) && x.room === text(r.Room || r.room));
    const isAllowedAssignment = (r) => role === 'admin' || allowedClasses.some((x) => x.level === text(r.Level || r.level) && x.room === text(r.Room || r.room) && x.subject === text(r.SubjectCode || r.subjectCode));
    const students = values('students', root).filter((r) => termMatches(recordTerm(r)) && isAllowedStudent(r)).map((r) => ({ ...student(r, root), term: selectedTerm }));
    const subjects = values('subjects', root).filter((r) => termMatches(recordTerm(r)) && (role === 'admin' || allowedClasses.some((x) => x.subject === text(r.SubjectCode)))).map((r) => ({ ...subject(r, root), term: selectedTerm }));
    const assignments = values('assignments', root).filter((r) => termMatches(recordTerm(r)) && isAllowedAssignment(r)).map((r) => ({ ...assignment(r, root), term: selectedTerm }));
    const termAssignmentCount = values('assignments', root).filter((r) => termMatches(recordTerm(r))).length;
    const users = String(currentUser && currentUser.role).toLowerCase() === 'admin' ? values('users', root).map(user) : [];
    const combos = [...new Map(allowedClasses.map((x) => [`${x.subject}|${x.level}|${x.room}`, { subject: x.subject, level: x.level, room: x.room }])).values()];
    return { success: true, data: { meta: { term: selectedTerm, requestedTerm: selectedTerm, generatedAt: Date.now(), termAssignmentCount, counts: { students: students.length, subjects: subjects.length, assignments: assignments.length } }, students, subjects, assignments, users, combos, levels: [...new Set(students.map((r) => r.level).filter(Boolean))].sort((a,b) => numericPart(a)-numericPart(b) || text(a).localeCompare(text(b), 'th')), rooms: [...new Set(students.map((r) => r.room).filter(Boolean))].sort((a,b) => numericPart(a)-numericPart(b) || text(a).localeCompare(text(b), 'th')), attendance: values('attendance', root).map((r) => attendance(r, root)), scores: values('scores', root).map(score), teacherClasses: scopedTeacherClasses.map((r) => teacherClass(r, root)), terms: values('terms', root), settings: { ...rawMap(root.settings), ...rawMap(root.systemSettings) } } };
  }
  function resultError(message) { return { success: false, message }; }
  async function adminOnly() {
    const identityUser = await verifiedIdentityUser();
    if (String(identityUser && identityUser.email || '').trim().toLowerCase() !== 'suradet.t@wrk.ac.th') throw new Error('ฟังก์ชันนี้อนุญาตเฉพาะผู้ดูแลระบบ suradet.t@wrk.ac.th');
  }
  async function verifiedIdentityUser() {
    let identityUser = auth.currentUser || window.__FIREBASE_AUTH_USER || window.__SUPABASE_CLIENT__?.auth?.currentUser || null;
    if (window.__SUPABASE_MODE__ && window.__SUPABASE_CLIENT__?.auth?.getSession) {
      const result = await window.__SUPABASE_CLIENT__.auth.getSession();
      identityUser = result?.data?.session?.user || identityUser;
      if (identityUser) {
        auth.currentUser = identityUser;
        window.__FIREBASE_AUTH_USER = identityUser;
      }
    }
    if (!identityUser) {
      await ready();
      identityUser = auth.currentUser || window.__FIREBASE_AUTH_USER || window.__SUPABASE_CLIENT__?.auth?.currentUser || null;
    }
    if (!identityUser || identityUser.isAnonymous || (!identityUser.id && !identityUser.uid) || !text(identityUser.email)) {
      throw new Error('กรุณาเข้าสู่ระบบด้วย Google ของบัญชีครูก่อนบันทึกข้อมูล');
    }
    return identityUser;
  }
  async function staffProfileForIdentity(identityUser) {
    const email = text(identityUser && identityUser.email).toLowerCase();
    if (window.__SUPABASE_MODE__ && window.__SUPABASE_CLIENT__) {
      const { data: row, error } = await window.__SUPABASE_CLIENT__.from('app_users').select('*').eq('email', email).maybeSingle();
      if (error) throw error;
      const legacy = row && row.legacy_data && typeof row.legacy_data === 'object' ? row.legacy_data : {};
      return { ...legacy, ...(row || {}) };
    }
    const usersRoot = (await db.ref('/users').once('value')).val() || {};
    return Object.values(usersRoot).find((row) =>
      text(row.Email || row.email).toLowerCase() === email ||
      text(row.AuthUID || row.auth_uid || row.uid).toLowerCase() === text(identityUser.id || identityUser.uid).toLowerCase()
    ) || {};
  }
  async function teacherOrAdmin(payload) {
    const identityUser = await verifiedIdentityUser();
    const email = String(identityUser && identityUser.email || '').trim().toLowerCase();
    if (email === 'suradet.t@wrk.ac.th') return { admin: true, teacherId: 'admin', email };
    // Supabase app_users is the single source of staff identity. Do not use
    // the retired Firebase authProfiles/authEmailIndex nodes for authorization.
    const profile = await staffProfileForIdentity(identityUser);
    const role = text(profile.Role || profile.role).toLowerCase();
    const status = text(profile.Status || profile.status).toLowerCase();
    if (status === 'inactive' || role !== 'teacher') throw new Error('บัญชี Google นี้ยังไม่มีสิทธิ์ครูที่อนุมัติแล้ว');
    return { admin: false, teacherId: text(profile.UserID || profile.user_id || profile.id), supabaseUserId: identityUser.id || identityUser.uid, email };
  }
  async function teacherAssignmentOrAdmin(payload) {
    const authz = await teacherOrAdmin(payload);
    if (authz.admin) return authz;
    const root = await data();
    const candidate = payload && payload.user;
    const teacherId = text(candidate && candidate.id);
    const subjectCode = text(payload && (payload.subjectCode || payload.subject));
    const level = text(payload && payload.level);
    const room = text(payload && payload.room);
    const term = text(payload && payload.term);
    const teacherClass = findTeacherClass(root, teacherId, subjectCode, level, room, term);
    if (!teacherClass) throw new Error('ครูไม่มีสิทธิ์เพิ่มงานในวิชา ชั้น ห้อง หรือเทอมนี้');
    return { ...authz, teacherClass };
  }
  async function teacherStudentOrAdmin(payload) {
    const authz = await teacherOrAdmin(payload);
    if (authz.admin) return authz;
    // Authorization for a status-only student update must stay lightweight.
    // Reading the full public snapshot here also reads scores and can exceed
    // the write timeout before the actual Status update is sent.
    const studentId = text(payload && (payload.id || payload.studentId || payload.StudentID));
    const [classesSnapshot, termsSnapshot, studentSnapshot] = await Promise.all([
      db.ref('/teacherClasses').once('value'),
      db.ref('/terms').once('value'),
      studentId ? db.ref(`students/${firebaseKey(studentId)}`).once('value') : Promise.resolve({ val: () => ({}) })
    ]);
    const root = { teacherClasses: classesSnapshot.val() || {}, terms: termsSnapshot.val() || {} };
    const existing = studentSnapshot.val() || {};
    // A queued task can contain an old UI room/term after the student roster
    // was corrected. Authorize against the canonical student record so a
    // valid pending status change can recover without trusting stale payload.
    const level = text(existing.Level || existing.level || (payload && payload.level));
    const room = text(existing.Room || existing.room || (payload && payload.room));
    const term = text(existing.Term || existing.term || (payload && payload.term));
    const existingTeacherClassId = text(existing.TeacherClassID || existing.teacherClassId);
    const teacherClassById = existingTeacherClassId && values('teacherClasses', root).find((row) =>
      text(row.TeacherClassID || row.teacherClassId || row.id) === existingTeacherClassId &&
      text(row.TeacherID || row.teacherId) === authz.teacherId &&
      text(row.Status || row.status).toLowerCase() !== 'inactive'
    );
    const teacherClass = teacherClassById || values('teacherClasses', root).find((row) =>
      text(row.TeacherID || row.teacherId) === authz.teacherId &&
      text(row.Level || row.level) === level &&
      text(row.Room || row.room) === room &&
      matchesTerm(row.TermID || row.Term || row.term, term, root) &&
      text(row.Status || row.status).toLowerCase() !== 'inactive'
    ) || values('teacherClasses', root).find((row) =>
      text(row.TeacherID || row.teacherId) === authz.teacherId &&
      text(row.Level || row.level) === text(payload && payload.level) &&
      text(row.Room || row.room) === text(payload && payload.room) &&
      matchesTerm(row.TermID || row.Term || row.term, text(payload && payload.term), root) &&
      text(row.Status || row.status).toLowerCase() !== 'inactive'
    );
    if (!teacherClass) throw new Error('ครูไม่มีสิทธิ์แก้สถานะนักเรียนในชั้น/ห้องนี้');
    return { ...authz, teacherClass };
  }
  function recordKey(name, p) {
    if (name === 'saveStudent') return text(p.id || p.studentId || p.StudentID);
    if (name === 'saveUser') return text(p.id || p.userId || p.UserID);
    if (name === 'saveSubject') return text(p.code || p.subjectCode || p.SubjectCode);
    if (name === 'saveAssignment') return text(p.id || p.assignmentId || p.AssignmentID);
    return text(p.id || p.recordId || p.RecordID);
  }
  function storedRecord(name, p, key) {
    const out = { ...p };
    if (name === 'saveStudent') out.StudentID = key;
    if (name === 'saveUser') out.UserID = key;
    if (name === 'saveSubject') out.SubjectCode = key;
    if (name === 'saveAssignment') out.AssignmentID = key;
    return out;
  }

  function gradeKey(term, subjectCode, studentId, component) {
    return ['GRADE', text(term), text(subjectCode), text(studentId), text(component)].join('|').replace(/[.#$\[\]/]/g, '_');
  }
  function gradeComponentFromAssignmentId(id) {
    const m = text(id).match(/^__GRADE_(pre|mid|post|final|att|read)$/i);
    return m ? m[1].toLowerCase() : '';
  }
  function gradingData(root, filter) {
    const term = activeTerm(root, filter.term);
    const subjectCode = text(filter.subject);
    const level = text(filter.level);
    const room = text(filter.room);
    const students = values('students', root).filter((r) => matchesTerm(r.Term || r.TermID || r.term, term, root) && text(r.Level) === level && text(r.Room) === room).map((r) => student(r, root)).sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
    const assignments = values('assignments', root).filter((r) => matchesTerm(r.Term || r.TermID || r.term, term, root) && text(r.SubjectCode || r.subjectCode) === subjectCode && (!level || text(r.Level || r.level) === level) && (!room || text(r.Room || r.room) === room)).map((r) => assignment(r, root));
    const studentIds = new Set(students.map((s) => s.id));
    const exams = {};
    values('scores', root).forEach((r) => {
      const component = gradeComponentFromAssignmentId(r.AssignmentID);
      if (component && matchesTerm(r.Term || r.TermID || r.term, term, root) && text(r.SubjectCode || r.subjectCode) === subjectCode && studentIds.has(text(r.StudentID || r.studentId))) {
        exams[text(r.StudentID || r.studentId)] = exams[text(r.StudentID || r.studentId)] || {};
        exams[text(r.StudentID || r.studentId)][component] = r.Score === '' || r.Score == null ? '' : Number(r.Score);
      }
    });
    const rawScores = {};
    values('scores', root).filter((r) => matchesTerm(r.Term || r.TermID || r.term, term, root) && text(r.AssignmentID || r.assignmentId) && !gradeComponentFromAssignmentId(r.AssignmentID || r.assignmentId)).forEach((r) => {
      rawScores[`${text(r.AssignmentID || r.assignmentId)}_${text(r.StudentID || r.studentId)}`] = { score: r.Score, isSubmitted: r.IsSubmitted == 1 || String(r.IsSubmitted).toLowerCase() === 'true' };
    });
    const settingKey = [term, subjectCode, level, room].join('|');
    const settingName = `grading_${settingKey}`;
    const rawSetting = rawMap(root.settings)[settingName] || rawMap(root.settings)[firebaseKey(settingName)] || {};
    return { term, students, assignments, rawScores, settings: { weightPre: Number(rawSetting.WeightPre ?? 20), weightMid: Number(rawSetting.WeightMid ?? 20), weightPost: Number(rawSetting.WeightPost ?? 20), weightFinal: Number(rawSetting.WeightFinal ?? 40), goalPercent: Number(rawSetting.GoalPercent ?? 66) }, exams, adjustments: {}, overallTargetPercent: 0, isLocked: false };
  }

  async function call(name, args) {
    const arg = args[0] || {};
    // Profile verification must not wait for the complete application dataset.
    // This is on the login critical path and only needs the authenticated
    // teacher/admin identity record.
    if (name === 'getCurrentUserProfile') {
      const identityUser = await verifiedIdentityUser();
      const id = text(args[0]);
      const email = String(identityUser?.email || '').trim().toLowerCase();
      let record = null;
      if (window.__SUPABASE_MODE__) {
        record = await staffProfileForIdentity(identityUser);
        if (email === 'suradet.t@wrk.ac.th' && (id === 'admin' || !record || !Object.keys(record).length)) record = { UserID: 'admin', Username: email, Email: email, Name: identityUser.displayName || 'สุรเดช ธรรมประโชติ', Role: 'admin', Status: 'Active' };
        if (record && id && text(record.UserID || record.userId || record.user_id || record.id) !== id && email !== 'suradet.t@wrk.ac.th') record = null;
        return record ? { success: true, data: user(record) } : resultError('ไม่พบผู้ใช้');
      }
      if (email === 'suradet.t@wrk.ac.th') {
        if (id === 'admin') {
          record = { UserID: 'admin', Username: email, Email: email, Name: auth.currentUser.displayName || 'สุรเดช ธรรมประโชติ', Role: 'admin', Status: 'Active' };
        } else {
          record = (await db.ref(`users/${firebaseKey(id)}`).once('value')).val() || null;
        }
      } else if (email) {
        const indexedRoot = (await db.ref('authEmailIndex').orderByChild('Email').equalTo(email).once('value')).val() || {};
        const indexed = Object.values(indexedRoot)[0] || null;
        if (text(indexed.UserID) === id) record = indexed;
      }
      return record ? { success: true, data: user(record) } : resultError('ไม่พบผู้ใช้');
    }
    // Staff access is Google-only. Student credentials are intentionally not
    // accepted by this application; student records remain data used by staff.
    if (name === 'loginSystem') {
      await ready();
      const login = text(args[0]);
      const password = text(args[1]);
      const usersSnapshot = await db.ref('/users').once('value');
      const loginId = loginKey(login);
      const configured = Object.values(rawMap(usersSnapshot.val())).find((row) => {
        const identities = [row.Username, row.username, row.Email, row.email, row.UserID, row.userId, row.Name, row.name].map(loginKey).filter(Boolean);
        const identityMatches = identities.some((value) => value === loginId || (loginId.length >= 3 && value.includes(loginId)));
        return identityMatches && text(row.Password || row.password) === password && text(row.Status || row.status).toLowerCase() !== 'inactive' && ['admin', 'teacher'].includes(text(row.Role || row.role).toLowerCase());
      });
      return configured ? { success: true, user: user(configured) } : resultError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const root = name === 'getDashboardStats'
      ? await dashboardData(arg.term)
      : ((name === 'getInitialSystemData' || name === 'getInitialDropdowns')
        ? await bootstrapData()
        : await (name === 'loadScoresGrid'
          ? scoreData(arg, true)
          : name === 'saveScoresBatch'
            ? saveScoreContext(arg)
            // Student status authorization reads only the teacher class,
            // term, and target student. Do not block the write on the full
            // application snapshot (which includes scores and attendance).
            : (name === 'saveStudent' || name === 'setStudentStatus')
              ? Promise.resolve({ terms: {}, teacherClasses: {} })
              : data()));
    if (name === 'getTeacherSetupOptions') {
      const subjects = values('subjects', root).filter((r) => text(r.Status || r.status).toLowerCase() !== 'inactive').map((r) => subject(r, root));
      const classes = values('teacherClasses', root).filter((r) => text(r.Status || r.status).toLowerCase() !== 'inactive');
      const combos = [...new Map(classes.map((r) => { const subjectCode = text(r.SubjectCode || r.subjectCode), level = text(r.Level || r.level), room = text(r.Room || r.room), key = `${subjectCode}|${level}|${room}`; const found = subjects.find((s) => s.code === subjectCode); return [key, { key, subjectCode, subjectName: found?.name || subjectCode, level, room }]; }).filter(([, value]) => value.subjectCode && value.level && value.room))].map(([, value]) => value).sort((a, b) => text(a.subjectCode).localeCompare(text(b.subjectCode), 'th') || numericPart(a.level) - numericPart(b.level) || numericPart(a.room) - numericPart(b.room));
      return { success: true, data: { combos } };
    }
    if (name === 'submitTeacherAccessRequest') {
      const current = await ready();
      if (!current || !current.email) throw new Error('กรุณาเข้าสู่ระบบด้วย Google ก่อน');
      if (String(current.email).toLowerCase() === 'suradet.t@wrk.ac.th') throw new Error('บัญชีผู้ดูแลระบบไม่ต้องส่งคำขอ');
      const subjectCode = text(arg.subjectCode), level = text(arg.level), room = text(arg.room);
      if (!subjectCode || !level || !room) throw new Error('กรุณาระบุวิชา ระดับชั้น และห้อง');
      const classes = values('teacherClasses', root); const validCombo = classes.some((r) => text(r.SubjectCode || r.subjectCode) === subjectCode && text(r.Level || r.level) === level && text(r.Room || r.room) === room && text(r.Status || r.status).toLowerCase() !== 'inactive');
      if (!validCombo) throw new Error('ไม่พบชุดวิชา–ชั้น–ห้องนี้ในรายการตั้งค่าปัจจุบัน');
      const request = { UID: current.uid, Email: text(current.email).toLowerCase(), Name: text(current.displayName), SubjectCode: subjectCode, Level: level, Room: room, Status: 'Pending', CreatedAt: new Date().toISOString() };
      await db.ref(`teacherAccessRequests/${firebaseKey(current.uid)}`).set(request); snapshotPromise = null;
      return { success: true, message: 'ส่งคำขอผูกสิทธิ์แล้ว รอผู้ดูแลระบบอนุมัติ' };
    }
    if (name === 'getTeacherAccessRequests') {
      await adminOnly();
      return { success: true, data: Object.values(rawMap((await db.ref('/teacherAccessRequests').once('value')).val())).filter((r) => text(r.Status).toLowerCase() === 'pending') };
    }
    if (name === 'approveTeacherAccessRequest') {
      await adminOnly();
      const uid = text(arg.uid), request = (await db.ref(`/teacherAccessRequests/${firebaseKey(uid)}`).once('value')).val() || {};
      if (!uid || !request.Email || !request.SubjectCode || !request.Level || !request.Room) throw new Error('ไม่พบคำขอผูกสิทธิ์ที่สมบูรณ์');
      const profile = { UserID: uid, Username: request.Email, Email: request.Email, Name: request.Name || request.Email, Role: 'teacher', Status: 'Active' };
      const safeKey = firebaseKey(`TC_${text(request.SubjectCode)}_${text(request.Level)}_${text(request.Room)}_${uid}`);
      const updates = {}; updates[`authProfiles/${firebaseKey(uid)}`] = profile; updates[`teacherClasses/${safeKey}`] = { TeacherClassID: safeKey, TeacherID: uid, SubjectCode: request.SubjectCode, Level: request.Level, Room: request.Room, TermID: activeTerm(root, ''), Status: 'Active' }; updates[`teacherAccessRequests/${firebaseKey(uid)}/Status`] = 'Approved'; updates[`teacherAccessRequests/${firebaseKey(uid)}/ApprovedAt`] = new Date().toISOString();
      await db.ref('/').update(updates); snapshotPromise = null;
      return { success: true, message: 'อนุมัติและผูกสิทธิ์ครูเรียบร้อย' };
    }
    if (name === 'getInitialSystemData') return initial(root, args[0], args[1]);
    if (name === 'getInitialDropdowns') {
      const payload = initial(root, '', args[0]).data;
      return { success: true, term: payload.meta.term, levels: payload.levels, rooms: payload.rooms, subjects: payload.subjects, combos: payload.combos, teacherClasses: payload.teacherClasses, studentsLite: payload.students, data: payload };
    }
    if (name === 'getStudents' || name === 'getStudentsByFilter') {
      const p = arg || {};
      const filtered = values('students', root).map((r) => student(r, root)).filter((s) => {
        const termOk = !p.term || matchesTerm(s.term, p.term, root);
        const levelOk = !p.level || text(s.level) === text(p.level);
        const roomOk = !p.room || text(s.room) === text(p.room);
        const q = text(p.q || p.search).toLowerCase();
        const qOk = !q || [s.id, s.first, s.last, s.firstName, s.lastName].some(v => text(v).toLowerCase().includes(q));
        return termOk && levelOk && roomOk && qOk;
      });
      return { success: true, data: filtered };
    }
    if (name === 'getStudentById') {
      const id = text(args[0] && typeof args[0] === 'object' ? args[0].studentId : args[0]);
      const found = values('students', root).find((s) => text(s.StudentID) === id);
      return found ? { success: true, data: student(found, root), student: student(found, root) } : resultError('ไม่พบนักเรียน');
    }
    if (name === 'getStudentSyncSnapshot') {
      const payload = initial(root, text(arg.term), args[0]).data;
      return { success: true, term: payload.meta.term, levels: payload.levels, rooms: payload.rooms, subjects: payload.subjects, studentsLite: payload.students, data: payload, meta: payload.meta };
    }
    if (name === 'getUsers') {
      await adminOnly();
      const usersRoot = (await db.ref('/users').once('value')).val() || {};
      return { success: true, data: Object.values(usersRoot).map(user) };
    }
    if (name === 'getTerms') return { success: true, data: values('terms', root) };
    if (name === 'getAttendance') return { success: true, data: values('attendance', root).map((r) => attendance(r, root)) };
    if (name === 'getAttendanceForCheck') {
      // The attendance screen needs the complete class roster even when the
      // selected date has no saved attendance rows yet. Returning only the
      // existing attendance records makes a valid empty day look like an
      // empty class, so build the roster and merge the day's records here.
      const p = arg || {};
      const selectedTerm = activeTerm(root, p.term);
      const identity = p.user || currentUser || {};
      const role = text(identity && (identity.role || identity.Role)).toLowerCase();
      const userId = text(identity && (identity.id || identity.userId || identity.UserID));
      const subjectCode = text(p.subjectCode || p.subject);
      const level = text(p.level);
      const room = text(p.room);
      const date = text(p.date).slice(0, 10);
      const scopeRows = allowedScopeRows(root, identity, selectedTerm, subjectCode);
      const allowed = role === 'admin' || scopeRows.some((row) =>
        text(row.Level || row.level) === level && text(row.Room || row.room) === room
      );
      if (role !== 'admin' && !userId) return resultError('ไม่พบตัวตนครูสำหรับตรวจสอบสิทธิ์');
      if (role !== 'admin' && !allowed) return resultError('ครูไม่มีสิทธิ์เช็คชั้น/ห้อง/วิชานี้');
      const roster = values('students', root)
        .filter((row) => matchesTerm(row.TermID || row.Term || row.term, selectedTerm, root))
        .filter((row) => text(row.Level || row.level) === level && text(row.Room || row.room) === room)
        .map((row) => student(row, root))
        .sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0) || String(a.id).localeCompare(String(b.id), 'th'));
      const dayRows = values('attendance', root)
        .map((row) => attendance(row, root))
        .filter((row) => matchesTerm(row.termId || row.term, selectedTerm, root))
        .filter((row) => (!subjectCode || row.subjectCode === subjectCode) && (!level || row.level === level) && (!room || row.room === room) && (!date || String(row.date || '').slice(0, 10) === date));
      const byStudent = new Map(dayRows.map((row) => [String(row.studentId), row]));
      const students = roster.map((row) => {
        const saved = byStudent.get(String(row.id));
        const savedStatus = saved ? text(saved.status) : '';
        return {
          ...row,
          attStatus: savedStatus,
          attNote: saved ? saved.note : '',
          attRecorder: savedStatus ? saved.recorder : '',
          attTime: savedStatus ? saved.timestamp : '',
          isChecked: !!savedStatus
        };
      });
      return { success: true, students, count: dayRows.length, matched: students.length, term: selectedTerm };
    }
    if (name === 'getStudentModeData') {
      const id = text(args[0]); const s = values('students', root).find((r) => text(r.StudentID) === id);
      return { success: true, data: { student: s ? student(s, root) : null, students: s ? [student(s, root)] : [], attendance: values('attendance', root).map((r) => attendance(r, root)).filter((r) => r.studentId === id), scores: values('scores', root).map(score).filter((r) => r.studentId === id), assignments: values('assignments', root).map((r) => assignment(r, root)), subjects: values('subjects', root).map(subject) } };
    }
    if (name === 'getGradingData') {
      const gradingAuthz = await teacherOrAdmin(arg);
      if (!gradingAuthz.admin && !findTeacherClass(root, gradingAuthz.teacherId, text(arg.subject), text(arg.level), text(arg.room), activeTerm(root, arg.term))) {
        throw new Error('ครูไม่มีสิทธิ์ดูข้อมูลตัดเกรดของวิชา ชั้น ห้อง หรือเทอมนี้');
      }
      return { success: true, data: gradingData(root, { ...arg, teacherId: gradingAuthz.teacherId, isAdmin: gradingAuthz.admin }) };
    }
    if (name === 'saveGradingBatch') {
      const authz = await teacherOrAdmin(arg);
      const term = activeTerm(root, arg.term);
      const subjectCode = text(arg.subject), level = text(arg.level), room = text(arg.room);
      const scope = authz.admin ? null : findTeacherClass(root, authz.teacherId, subjectCode, level, room, term);
      if (!authz.admin && !scope) throw new Error('ครูไม่มีสิทธิ์บันทึกคะแนนในวิชา ชั้น ห้อง หรือเทอมนี้');
      const teacherClassId = scope ? (text(scope.TeacherClassID || scope.teacherClassId) || teacherClassKey(authz.teacherId, subjectCode, level, room, term)) : '';
      const weights = ['weightPre', 'weightMid', 'weightPost', 'weightFinal'].map((key) => Number(arg[key]));
      if (weights.some((value) => !Number.isFinite(value) || value < 0 || value > 100) || Math.round(weights.reduce((sum, value) => sum + value, 0) * 100) / 100 !== 100) throw new Error('สัดส่วนคะแนนต้องเป็นตัวเลข 0 ถึง 100 และรวมกันเท่ากับ 100');
      const goalPercent = Number(arg.goalPercent);
      if (!Number.isFinite(goalPercent) || goalPercent < 0 || goalPercent > 100) throw new Error('เป้าหมายเกรดต้องอยู่ระหว่าง 0 ถึง 100');
      const currentScores = rawMap(root.scores), conflicts = [], updates = {}, records = arg.records || {};
      Object.entries(records).forEach(([studentId, scores]) => {
        if (!text(studentId)) throw new Error('ไม่พบรหัสนักเรียนในข้อมูลคะแนน');
        ['pre', 'mid', 'post', 'final', 'att', 'read'].forEach((component) => {
          if (!scores || !Object.prototype.hasOwnProperty.call(scores, component)) return;
          const value = scores[component];
          if (value === undefined || (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100))) throw new Error(`คะแนน ${component} ของนักเรียน ${studentId} ต้องอยู่ระหว่าง 0 ถึง 100`);
          const key = gradeKey(term, subjectCode, studentId, component), expected = arg.baseRecords?.[studentId]?.[component], actual = currentScores[key]?.Score ?? '';
          if (expected !== undefined && text(actual) !== text(expected)) { conflicts.push({ studentId, component, expected, actual }); return; }
          updates[`scores/${firebaseKey(key)}`] = { ScoreID: key, AssignmentID: `__GRADE_${component}`, TeacherClassID: teacherClassId, SubjectCode: subjectCode, Level: level, Room: room, StudentID: studentId, Score: value, IsSubmitted: value !== '' ? 1 : 0, TermID: canonicalTermId(term, root), Term: term, Timestamp: new Date().toISOString() };
        });
      });
      if (conflicts.length) return { success: false, conflict: true, conflicts, message: `พบข้อมูลถูกแก้ไขจากอุปกรณ์อื่น ${conflicts.length} ช่อง จึงไม่เขียนทับข้อมูลเดิม` };
      const settingKey = [term, subjectCode, level, room].join('|');
      updates[`settings/${firebaseKey(`grading_${settingKey}`)}`] = { Key: `grading_${settingKey}`, WeightPre: weights[0], WeightMid: weights[1], WeightPost: weights[2], WeightFinal: weights[3], GoalPercent: goalPercent, UpdatedAt: new Date().toISOString() };
      await db.ref('/').update(updates);
      snapshotPromise = null;
      return { success: true, saved: Object.keys(updates).filter((key) => key.startsWith('scores/')).length, message: 'บันทึกคะแนนและสัดส่วนสำเร็จ' };
    }
    if (name === 'saveGradingScores') {
      const authz = await teacherOrAdmin(arg);
      const updates = {};
      const term = activeTerm(root, arg.term);
      const subjectCode = text(arg.subject);
      const level = text(arg.level);
      const room = text(arg.room);
      const scope = authz.admin ? null : findTeacherClass(root, authz.teacherId, subjectCode, level, room, term);
      if (!authz.admin && !scope) throw new Error('ครูไม่มีสิทธิ์บันทึกคะแนนในวิชา ชั้น ห้อง หรือเทอมนี้');
      const teacherClassId = scope ? (text(scope.TeacherClassID || scope.teacherClassId) || teacherClassKey(authz.teacherId, subjectCode, level, room, term)) : '';
      const currentScores = rawMap(root.scores);
      const conflicts = [];
      Object.entries(arg.records || {}).forEach(([studentId, scores]) => {
        if (!text(studentId)) throw new Error('ไม่พบรหัสนักเรียนในข้อมูลคะแนน');
        ['pre', 'mid', 'post', 'final', 'att', 'read'].forEach((component) => {
          if (scores && Object.prototype.hasOwnProperty.call(scores, component)) {
            if (scores[component] === undefined) throw new Error(`คะแนน ${component} ของนักเรียน ${studentId} ไม่ถูกต้อง`);
            if (scores[component] !== '' && (!Number.isFinite(Number(scores[component])) || Number(scores[component]) < 0 || Number(scores[component]) > 100)) {
              throw new Error(`คะแนน ${component} ของนักเรียน ${studentId} ต้องอยู่ระหว่าง 0 ถึง 100`);
            }
            const key = gradeKey(term, subjectCode, studentId, component);
            const expected = arg.baseRecords?.[studentId]?.[component];
            const actual = currentScores[key]?.Score ?? '';
            if (expected !== undefined && text(actual) !== text(expected)) { conflicts.push({ studentId, component, expected, actual }); return; }
            updates[`scores/${firebaseKey(key)}`] = { ScoreID: key, AssignmentID: `__GRADE_${component}`, TeacherClassID: teacherClassId, SubjectCode: subjectCode, Level: level, Room: room, StudentID: studentId, Score: scores[component], IsSubmitted: scores[component] !== '' ? 1 : 0, TermID: canonicalTermId(term, root), Term: term, Timestamp: new Date().toISOString() };
          }
        });
      });
      if (conflicts.length) return { success: false, conflict: true, conflicts, message: `พบข้อมูลถูกแก้ไขจากอุปกรณ์อื่น ${conflicts.length} ช่อง จึงไม่เขียนทับข้อมูลเดิม` };
      if (Object.keys(updates).length) await db.ref('/').update(updates);
      snapshotPromise = null;
      return { success: true, saved: Object.keys(updates).length };
    }
    if (name === 'saveGradingSettings') {
      const settingsAuthz = await teacherOrAdmin(arg);
      const term = activeTerm(root, arg.term);
      if (!settingsAuthz.admin && !findTeacherClass(root, settingsAuthz.teacherId, text(arg.subject), text(arg.level), text(arg.room), term)) {
        throw new Error('ครูไม่มีสิทธิ์แก้ไขการตั้งค่าตัดเกรดของวิชา ชั้น ห้อง หรือเทอมนี้');
      }
      const weights = ['weightPre', 'weightMid', 'weightPost', 'weightFinal'].map((key) => Number(arg[key]));
      if (weights.some((value) => !Number.isFinite(value) || value < 0 || value > 100) || Math.round(weights.reduce((sum, value) => sum + value, 0) * 100) / 100 !== 100) {
        throw new Error('สัดส่วนคะแนนต้องเป็นตัวเลข 0 ถึง 100 และรวมกันเท่ากับ 100');
      }
      const goalPercent = Number(arg.goalPercent);
      if (!Number.isFinite(goalPercent) || goalPercent < 0 || goalPercent > 100) throw new Error('เป้าหมายเกรดต้องอยู่ระหว่าง 0 ถึง 100');
      const key = [term, text(arg.subject), text(arg.level), text(arg.room)].join('|');
      await db.ref(`settings/${firebaseKey(`grading_${key}`)}`).set({ Key: `grading_${key}`, WeightPre: weights[0], WeightMid: weights[1], WeightPost: weights[2], WeightFinal: weights[3], GoalPercent: goalPercent, UpdatedAt: new Date().toISOString() });
      snapshotPromise = null;
      return { success: true };
    }
    if (name === 'getDashboardStats') {
      const selected = activeTerm(root, arg.term);
      const role = text(arg.user && arg.user.role).toLowerCase();
      const teacherScope = values('teacherClasses', root).filter((r) => matchesTerm(r.TermID || r.Term || r.term, selected, root) && text(r.TeacherID || r.teacherId) === text(arg.user && arg.user.id) && text(r.Status || r.status).toLowerCase() !== 'inactive');
      const allowedStudent = (r) => role === 'admin' || teacherScope.some((x) => text(x.Level || x.level) === text(r.Level) && text(x.Room || x.room) === text(r.Room));
      const allowedAssignment = (r) => role === 'admin' || teacherScope.some((x) => text(x.SubjectCode || x.subjectCode) === text(r.SubjectCode) && text(x.Level || x.level) === text(r.Level) && text(x.Room || x.room) === text(r.Room));
      const students = values('students', root).filter((r) => matchesTerm(recordTerm(r), selected, root) && allowedStudent(r));
      const studentIds = new Set(students.map((r) => text(r.StudentID)));
      const assignments = values('assignments', root).filter((r) => matchesTerm(recordTerm(r), selected, root) && allowedAssignment(r));
      const attendanceRows = values('attendance', root).filter((r) => matchesTerm(recordTerm(r), selected, root) && (role === 'admin' || studentIds.has(text(r.StudentID))));
      const date = text(arg.date);
      const dayRows = date ? attendanceRows.filter((r) => text(r.Date).slice(0, 10) === date) : attendanceRows;
      const status = (value) => text(value).toLowerCase();
      const countStatus = (rows, names) => rows.filter((r) => names.includes(status(r.Status))).length;
      const present = countStatus(dayRows, ['present', 'มา', 'มาเรียน']);
      const late = countStatus(dayRows, ['late', 'สาย']);
      const leave = countStatus(dayRows, ['leave', 'ลา']);
      const absent = countStatus(dayRows, ['absent', 'ขาด']);
      const byId = {}; students.forEach((r) => { byId[text(r.StudentID)] = r; });
      const absentByStudent = {};
      attendanceRows.forEach((r) => { if (['absent', 'ขาด'].includes(status(r.Status))) absentByStudent[text(r.StudentID)] = (absentByStudent[text(r.StudentID)] || 0) + 1; });
      const riskList = Object.entries(absentByStudent).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ name: byId[id] ? [byId[id].Prefix, byId[id].FirstName, byId[id].LastName].filter(Boolean).join(' ') : id, absentCount: count, status: count > 3 ? 'เฝ้าระวัง' : 'ติดตาม' }));
      const classMap = {};
      students.forEach((r) => { const key = `${text(r.Level)}|${text(r.Room)}`; classMap[key] = classMap[key] || { level: text(r.Level), room: text(r.Room), totalStudents: 0, present: 0, late: 0, leave: 0, absent: 0 }; classMap[key].totalStudents++; });
      attendanceRows.forEach((r) => { const studentRow = byId[text(r.StudentID)]; if (!studentRow) return; const key = `${text(studentRow.Level)}|${text(studentRow.Room)}`; const c = classMap[key]; if (!c) return; const s = status(r.Status); if (['present', 'มา', 'มาเรียน'].includes(s)) c.present++; else if (['late', 'สาย'].includes(s)) c.late++; else if (['leave', 'ลา'].includes(s)) c.leave++; else if (['absent', 'ขาด'].includes(s)) c.absent++; });
      const classSummary = Object.values(classMap).sort(classSort).map((c) => ({ ...c, attendanceRate: (c.present + c.late + c.leave + c.absent) ? Math.round((c.present + c.late) / (c.present + c.late + c.leave + c.absent) * 100) : 0 }));
      const termSummary = classSummary.reduce((a, c) => { ['present', 'late', 'leave', 'absent'].forEach(k => a[k] += c[k]); return a; }, { present: 0, late: 0, leave: 0, absent: 0 });
      return { success: true, totalStudents: students.length, presentToday: present, totalAssignments: assignments.length, riskStudents: Object.values(absentByStudent).filter((n) => n > 3).length, stats: { present, late, leave, absent }, riskList, classSummary, termSummary };
    }
    if (name === 'loadScoresGrid') {
      const selected = activeTerm(root, arg.term);
      const students = values('students', root).filter((r) => matchesTerm(recordTerm(r), selected, root) && (!arg.level || text(r.Level) === text(arg.level)) && (!arg.room || text(r.Room) === text(arg.room))).map((r) => student(r, root));
      const assignments = values('assignments', root).filter((r) => matchesTerm(recordTerm(r), selected, root) && text(r.SubjectCode) === text(arg.subjectCode || arg.subject) && text(r.Level) === text(arg.level) && text(r.Room) === text(arg.room)).map((r) => assignment(r, root));
      const assignmentIds = new Set(assignments.map((a) => a.id)); const studentIds = new Set(students.map((s) => s.id)); const scores = {};
      const orphanScores = [];
      values('scores', root).filter((r) => matchesTerm(recordTerm(r), selected, root) && studentIds.has(text(r.StudentID))).forEach((r) => {
        const assignmentId = text(r.AssignmentID || r.assignmentId);
        if (assignmentIds.has(assignmentId)) scores[`${assignmentId}_${text(r.StudentID)}`] = score(r);
        else orphanScores.push({ scoreId: text(r.ScoreID || r.scoreId), assignmentId, studentId: text(r.StudentID || r.studentId), subjectCode: text(r.SubjectCode || r.subjectCode), term: text(r.TermID || r.Term || r.term), score: r.Score ?? r.score ?? '', isSubmitted: r.IsSubmitted ?? r.isSubmitted ?? '' });
      });
      return { success: true, data: { term: selected, students, assignments, scores, orphanScores } };
    }
    if (name === 'getAttendanceAssistants') return { success: true, data: values('attendanceAssistants', root).map(assistant) };
    if (name === 'getTeacherClasses') return { success: true, data: values('teacherClasses', root).map((r) => teacherClass(r, root)) };
    if (name === 'getSubjects') return { success: true, data: values('subjects', root).map((r) => subject(r, root)) };
    if (name === 'getWebAppUrl') return { success: true, url: window.location.origin + window.location.pathname };
    if (name === 'getSystemSetting' || name === 'getSavedFolderId') {
      const key = name === 'getSavedFolderId' ? 'system_folder_id' : text(args[0]);
      const setting = rawMap(root.systemSettings)[key] || rawMap(root.systemSettings)[firebaseKey(key)] || rawMap(root.settings)[key] || rawMap(root.settings)[firebaseKey(key)] || {};
      const value = text(setting.Value || setting.value || setting);
      return { success: true, value, folderId: value };
    }
    if (name === 'getAdminSettingsBootstrap') {
      const isAdmin = String(auth.currentUser && auth.currentUser.email || '').trim().toLowerCase() === 'suradet.t@wrk.ac.th';
      const term = activeTerm(root, text(arg.term));
      const scoped = initial(root, term, arg.user).data;
      const settings = {};
      if (isAdmin) Object.entries(rawMap(root.systemSettings)).forEach(([key, value]) => { settings[key] = text(value && (value.Value || value.value) || value); });
      const allTeacherClasses = values('teacherClasses', root).map((r) => teacherClass(r, root));
      const allSubjects = values('subjects', root).map((r) => subject(r, root));
      return { success: true, authRequired: !isAdmin, term, activeTerm: term, users: isAdmin ? values('users', root).map(user) : [], terms: values('terms', root), subjects: isAdmin ? allSubjects : scoped.subjects, teacherClasses: isAdmin ? allTeacherClasses : scoped.teacherClasses, attendanceAssistants: values('attendanceAssistants', root).map((r) => assistant(r, root)), settings, dropdowns: scoped, meta: { counts: { users: isAdmin ? values('users', root).length : 0, teacherClasses: isAdmin ? allTeacherClasses.length : scoped.teacherClasses.length } } };
    }
    if (name === 'saveAttendanceAssistant') {
      await adminOnly();
      if (!text(arg.term) || !text(arg.studentId) || !text(arg.subjectCode) || !text(arg.level) || !text(arg.room)) return resultError('ข้อมูลผู้ช่วยเช็คชื่อไม่ครบ');
      const rawKey = [arg.term, arg.studentId, arg.subjectCode, arg.level, arg.room].map(text).join('_');
      const key = firebaseKey(rawKey);
      await db.ref(`attendanceAssistants/${key}`).set(withoutUndefined({ ...arg, AssistantID: rawKey })); snapshotPromise = null;
      return { success: true, message: 'บันทึกผู้ช่วยเช็คชื่อสำเร็จ' };
    }
    if (name === 'saveTeacherClass') {
      await adminOnly();
      if (!text(arg.teacherId) || !text(arg.subjectCode) || !text(arg.level) || !text(arg.term)) return resultError('ข้อมูลครู-วิชา-ห้องเรียนไม่ครบ');
      const rooms = (Array.isArray(arg.rooms) ? arg.rooms : [arg.room]).map(text).filter(Boolean);
      if (!rooms.length) return resultError('กรุณาระบุห้องเรียนอย่างน้อย 1 ห้อง');
      const root = await data();
      const existingEntries = Object.entries(rawMap(root.teacherClasses));
      const updates = {};
      rooms.forEach((room) => {
        const same = existingEntries.find(([, row]) =>
          text(row.TermID || row.term || row.Term) === text(arg.term) &&
          text(row.TeacherID || row.teacherId) === text(arg.teacherId) &&
          text(row.SubjectCode || row.subjectCode) === text(arg.subjectCode) &&
          text(row.Level || row.level) === text(arg.level) &&
          text(row.Room || row.room) === room
        );
        const rawKey = same ? same[0] : [arg.term, arg.teacherId, arg.subjectCode, arg.level, room].map(text).join('_');
        const key = firebaseKey(rawKey);
        updates[`teacherClasses/${key}`] = {
          TeacherClassID: key,
          TeacherID: text(arg.teacherId),
          SubjectCode: text(arg.subjectCode),
          Level: text(arg.level),
          Room: room,
          TermID: text(arg.term),
          Status: text(arg.status) || 'Active'
        };
      });
      await db.ref('/').update(updates); snapshotPromise = null;
      const fresh = await data();
      return { success: true, term: arg.term, inserted: rooms.length, updated: 0, data: teacherClasses(fresh) };
    }
    if (name === 'createNewTerm') {
      await adminOnly();
      const termId = `${text(arg.termNo)}/${text(arg.academicYear)}`;
      await db.ref(`terms/${firebaseKey(termId)}`).set({ TermID: termId, TermNo: text(arg.termNo), AcademicYear: text(arg.academicYear), Status: arg.setActive ? 'Active' : 'Planned' });
      snapshotPromise = null; termsPromise = null;
      return { success: true, termId, message: 'สร้างภาคเรียนสำเร็จ' };
    }
    if (name === 'saveAttendance') {
      const p = arg || {};
      const authz = await teacherOrAdmin(p);
      const date = text(p.date), subjectCode = text(p.subjectCode || p.subject), level = text(p.level), room = text(p.room), term = text(p.term);
      const records = Array.isArray(p.records) ? p.records : [p];
      if (!date || !subjectCode || !level || !room || !term) return resultError('ข้อมูลเช็คชื่อไม่ครบ: วันที่ วิชา ชั้น ห้อง หรือเทอม');
      const root = await data();
      const scope = authz.admin ? null : findTeacherClass(root, authz.teacherId, subjectCode, level, room, term);
      if (!authz.admin && !scope) throw new Error('ครูไม่มีสิทธิ์เช็คชั้น/ห้อง/วิชานี้');
      const scopeId = scope ? (text(scope.TeacherClassID || scope.teacherClassId || scope.id) || teacherClassKey(authz.teacherId, subjectCode, level, room, term)) : '';
      const classId = scope ? text(scope.ClassID || scope.classId) : '';
      const termId = scope ? text(scope.TermID || scope.termId) : '';
      const updates = {};
      records.forEach((record) => {
        const studentId = text(record && (record.studentId || record.StudentID || record.id));
        if (!studentId) throw new Error('ไม่พบรหัสนักเรียนในข้อมูลเช็คชื่อ');
        const rawId = text(record.recordId || record.RecordID || `${date}_${studentId}_${subjectCode}`);
        updates[`attendance/${firebaseKey(rawId)}`] = withoutUndefined({
          RecordID: rawId, TeacherClassID: scopeId, ClassID: classId || undefined, TermID: canonicalTermId(term, root), Date: date, SubjectCode: subjectCode, Level: level, Room: room, Term: term, StudentID: studentId,
          Status: Object.prototype.hasOwnProperty.call(record || {}, 'status') || Object.prototype.hasOwnProperty.call(record || {}, 'Status')
            ? text(record.status !== undefined ? record.status : record.Status)
            : 'มา',
          Note: text(record.note || record.Note), Recorder: text(p.recorder || p.Recorder), Timestamp: new Date().toISOString()
        });
      });
      await db.ref('/').update(updates); snapshotPromise = null;
      return { success: true, saved: Object.keys(updates).length, message: 'บันทึกการเช็คชื่อสำเร็จ' };
    }
    if (name === 'saveScoresBatch') {
      const authz = await teacherOrAdmin(arg);
      const batch = arg.records || arg.scores || [];
      const updates = {};
      batch.forEach((p) => {
        const assignmentId = text(p.assignmentId || p.AssignmentID), studentId = text(p.studentId || p.StudentID);
        if (!assignmentId || !studentId) throw new Error('ข้อมูลคะแนนขาดรหัสงานหรือรหัสนักเรียน');
        const id = text(p.scoreId || p.id || `${assignmentId}_${studentId}`);
        const subjectCode = text(p.subjectCode || p.SubjectCode || arg.subjectCode || arg.subject);
        const level = text(p.level || p.Level || arg.level);
        const room = text(p.room || p.Room || arg.room);
        const term = activeTerm(root, p.term || p.Term || arg.term);
        const scope = authz.admin ? null : findTeacherClass(root, authz.teacherId, subjectCode, level, room, term);
        if (!authz.admin && !scope) throw new Error(`ครูไม่มีสิทธิ์บันทึกคะแนนของนักเรียน ${studentId}`);
        const teacherClassId = scope ? (text(scope.TeacherClassID || scope.teacherClassId || scope.id) || teacherClassKey(authz.teacherId, subjectCode, level, room, term)) : '';
        const classId = scope ? text(scope.ClassID || scope.classId) : '';
        const termId = scope ? text(scope.TermID || scope.termId) : '';
        updates[`scores/${firebaseKey(id)}`] = withoutUndefined({
          ...p,
          ScoreID: id,
          AssignmentID: assignmentId,
          StudentID: studentId,
          TeacherClassID: teacherClassId,
          ClassID: classId || undefined,
          TermID: canonicalTermId(term, root),
          SubjectCode: subjectCode,
          Level: level,
          Room: room,
          Term: term,
          // The UI sends camelCase, while the Firebase reader uses the
          // canonical database field names. Keep both paths compatible.
          Score: p.score !== undefined ? p.score : p.Score,
          IsSubmitted: p.isSubmitted !== undefined ? p.isSubmitted : p.IsSubmitted
        });
      });
      await db.ref('/').update(updates); snapshotPromise = null;
      return { success: true, saved: Object.keys(updates).length, message: 'บันทึกคะแนนสำเร็จ' };
    }
    if (name === 'setStudentStatus') {
      const authz = await teacherStudentOrAdmin(arg || {});
      const key = recordKey('saveStudent', arg || {});
      const requestedStatus = text(arg && (arg.status || arg.Status));
      if (!key) return resultError('ไม่พบรหัสนักเรียน');
      if (!['Active', 'Inactive', 'ลาออกแล้ว', 'พักการเรียน'].includes(requestedStatus)) return resultError('สถานะนักเรียนไม่ถูกต้อง');
      const current = (await db.ref(`students/${firebaseKey(key)}`).once('value')).val() || {};
      const scope = authz.teacherClass || {};
      const teacherClassId = text(current.TeacherClassID || current.teacherClassId || scope.TeacherClassID || scope.teacherClassId);
      const updates = { Status: requestedStatus };
      const classId = text(current.ClassID || current.classId || scope.ClassID || scope.classId);
      const termId = text(current.TermID || current.termId || scope.TermID || scope.termId);
      if (teacherClassId && !(classId && termId)) updates.TeacherClassID = teacherClassId;
      if (classId) updates.ClassID = classId;
      if (classId && termId) updates.TermID = termId;
      await db.ref(`students/${firebaseKey(key)}`).update(updates);
      const persisted = (await db.ref(`students/${firebaseKey(key)}`).once('value')).val() || {};
      const actualStatus = text(persisted.Status || persisted.status) || 'Active';
      if (actualStatus !== requestedStatus) throw new Error(`ยืนยันสถานะไม่สำเร็จ (ต้องการ ${requestedStatus} แต่ฐานข้อมูลตอบกลับ ${actualStatus})`);
      snapshotPromise = null;
      return { success: true, message: 'เปลี่ยนสถานะและยืนยันจากฐานข้อมูลแล้ว', data: student(persisted) };
    }
    if (['saveStudent', 'saveUser', 'saveSubject', 'saveAssignment'].includes(name)) {
       let assignmentAuthz;
       let studentAuthz;
       if (name === 'saveAssignment') assignmentAuthz = await teacherAssignmentOrAdmin(arg);
       else if (name === 'saveStudent') studentAuthz = await teacherStudentOrAdmin(arg);
       else await adminOnly();
      const key = recordKey(name, arg) || (name === 'saveUser' ? `USR-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}` : '');
      if (!key) return resultError('ไม่พบรหัสข้อมูล');
      const storageKey = firebaseKey(key);
      const pathName = { saveStudent: 'students', saveUser: 'users', saveSubject: 'subjects', saveAssignment: 'assignments' }[name];
       let record = withoutUndefined(storedRecord(name, arg, key));
       if (name === 'saveStudent') {
         const existing = (await db.ref(`students/${storageKey}`).once('value')).val() || {};
         const requestedStatus = text(arg.status || arg.Status);
         if (!studentAuthz.admin) {
           const scope = studentAuthz.teacherClass || {};
           const scopeLevel = text(scope.Level || scope.level);
           const scopeRoom = text(scope.Room || scope.room);
           // Teachers may change only the status of a student in a class they
           // teach. Never let a teacher overwrite identity, room, or term data.
           const classId = text(existing.ClassID || existing.classId || scope.ClassID || scope.classId);
           const termId = text(existing.TermID || existing.termId || scope.TermID || scope.termId);
           const legacyTeacherClassId = text(existing.TeacherClassID || existing.teacherClassId) || (classId && termId ? '' : text(scope.TeacherClassID || scope.teacherClassId || scope.id));
           record = withoutUndefined({ ...existing, StudentID: key, TeacherClassID: legacyTeacherClassId || undefined, ClassID: classId || undefined, TermID: canonicalTermId(termId || arg.term, root), Status: requestedStatus || text(existing.Status || existing.status) || 'Active' });
         } else {
           record = withoutUndefined({
             ...existing,
             StudentID: key,
             FirstName: text(arg.first || arg.FirstName) || text(existing.FirstName || existing.firstName),
             LastName: text(arg.last || arg.LastName) || text(existing.LastName || existing.lastName),
             Prefix: text(arg.prefix || arg.Prefix) || text(existing.Prefix || existing.prefix),
             No: arg.no ?? arg.No ?? existing.No,
             Level: text(arg.level || arg.Level) || text(existing.Level || existing.level),
             Room: text(arg.room || arg.Room) || text(existing.Room || existing.room),
             Term: text(arg.term || arg.Term) || text(existing.Term || existing.term),
             TermID: (text(arg.classId || arg.ClassID) || text(existing.ClassID || existing.classId)) && (text(arg.termId || arg.TermID) || text(existing.TermID || existing.termId)) || undefined,
             ClassID: text(arg.classId || arg.ClassID) || text(existing.ClassID || existing.classId) || undefined,
             Status: requestedStatus || text(existing.Status || existing.status) || 'Active',
             Icon: text(arg.icon || arg.Icon) || text(existing.Icon || existing.icon),
             ProfileImage: text(arg.profileImage || arg.ProfileImage) || text(existing.ProfileImage || existing.profileImage)
           });
         }
       }
      if (name === 'saveAssignment') {
        record = withoutUndefined({
          ...record,
          AssignmentID: key,
          Title: text(arg.title || arg.Title),
          Type: text(arg.type || arg.Type) || 'Score',
          MaxScore: Number(arg.maxScore ?? arg.MaxScore ?? 0),
          SubjectCode: text(arg.subjectCode || arg.subject || arg.SubjectCode),
          Level: text(arg.level || arg.Level),
          Room: text(arg.room || arg.Room),
          Term: text(arg.term || arg.Term),
          DueDate: text(arg.dueDate || arg.DueDate),
          DisplayOrder: Number(arg.displayOrder ?? arg.DisplayOrder ?? 0),
          DateCreated: arg.dateCreated || arg.DateCreated || new Date().toISOString()
        });
        if (!assignmentAuthz.admin) {
          record.TeacherClassID = text(assignmentAuthz.teacherClass && (assignmentAuthz.teacherClass.TeacherClassID || assignmentAuthz.teacherClass.teacherClassId || assignmentAuthz.teacherClass.id)) || teacherClassKey(assignmentAuthz.teacherId, record.SubjectCode, record.Level, record.Room, record.Term);
          record.ClassID = text(assignmentAuthz.teacherClass && (assignmentAuthz.teacherClass.ClassID || assignmentAuthz.teacherClass.classId)) || undefined;
          record.TermID = record.ClassID ? (text(assignmentAuthz.teacherClass && (assignmentAuthz.teacherClass.TermID || assignmentAuthz.teacherClass.termId)) || undefined) : undefined;
        }
      }
      if (name === 'saveUser') {
        const existing = (await db.ref(`users/${storageKey}`).once('value')).val() || {};
        record = withoutUndefined({ ...existing, UserID: key, Username: text(arg.username), Email: text(arg.email).toLowerCase(), Name: text(arg.name), Role: text(arg.role).toLowerCase(), Status: text(arg.status) || 'Active' });
        if (text(arg.password)) record.Password = text(arg.password);
        const oldEmail = text(existing.Email || existing.email).toLowerCase(), newEmail = text(arg.email).toLowerCase();
        const emailUpdates = {}; if (oldEmail && oldEmail !== newEmail) emailUpdates[`authEmailIndex/${emailKey(oldEmail)}`] = null; if (newEmail) emailUpdates[`authEmailIndex/${emailKey(newEmail)}`] = { ...user(record), Email: newEmail, UserID: key };
        await db.ref('/').update(emailUpdates);
      }
      await db.ref(`${pathName}/${storageKey}`).set(record);
      const persistedSnapshot = await db.ref(`${pathName}/${storageKey}`).once('value');
      const persistedRecord = persistedSnapshot.val() || {};
      if (name === 'saveStudent') {
        const expectedStatus = text(record.Status) || 'Active';
        const actualStatus = text(persistedRecord.Status || persistedRecord.status) || 'Active';
        if (actualStatus !== expectedStatus) throw new Error(`ยืนยันสถานะนักเรียนไม่สำเร็จ (ต้องการ ${expectedStatus} แต่ฐานข้อมูลตอบกลับ ${actualStatus})`);
      }
      snapshotPromise = null;
      return name === 'saveStudent'
        ? { success: true, message: 'บันทึกข้อมูลสำเร็จ', data: student(persistedRecord) }
        : { success: true, message: 'บันทึกข้อมูลสำเร็จ' };
    }
    if (name === 'saveUserProfile') {
      await teacherOrAdmin(arg); const key = text(arg.id || arg.userId); if (!key) return resultError('ไม่พบรหัสผู้ใช้');
      const existing = (await db.ref(`users/${firebaseKey(key)}`).once('value')).val() || {};
      const record = {
        UserID: key,
        Email: text(existing.Email || existing.email).toLowerCase(),
        Username: text(arg.username) || text(existing.Username || existing.username),
        Name: text(arg.name) || text(existing.Name || existing.name),
        Role: text(existing.Role || existing.role || arg.role).toLowerCase(),
        Status: text(existing.Status || existing.status || arg.status) || 'Active',
        ProfileImage: text(existing.ProfileImage || existing.imageUrl),
        Prefix: text(arg.prefix || existing.Prefix || existing.prefix), LastName: text(arg.lastName || existing.LastName || existing.lastName), Position: text(arg.position || existing.Position || existing.position),
        School: text(arg.school || existing.School || existing.school), Group: text(arg.group || existing.Group || existing.group)
      };
      if (text(arg.password)) record.Password = text(arg.password);
      const imageData = text(args[1]);
      if (imageData) record.ProfileImage = imageData.startsWith('data:image/') ? imageData : `data:image/jpeg;base64,${imageData}`;
       await db.ref(`users/${firebaseKey(key)}`).set(record); snapshotPromise = null; return { success: true, message: 'อัปเดตโปรไฟล์สำเร็จ' };
    }
    if (name === 'deleteStudent' || name === 'deleteUser' || name === 'deleteSubject' || name === 'deleteAssignment' || name === 'deleteTeacherClass' || name === 'deleteAttendanceAssistant') {
      // Teachers may delete only assignments in their assigned class. The old
      // implementation used adminOnly(), leaving teacher deletes stuck.
      let assignmentToDelete = null;
      let assignmentDeleteAuthz = null;
      if (name === 'deleteAssignment') {
        const requestedId = text(arg && typeof arg === 'object' ? (arg.id || arg.assignmentId || arg.AssignmentID) : arg);
        if (!requestedId) return resultError('ไม่พบรหัสงานที่ต้องการลบ');
        assignmentToDelete = values('assignments', root).find((row) => text(row.AssignmentID || row.assignmentId) === requestedId) || null;
        if (!assignmentToDelete) return resultError('ไม่พบงานที่ต้องการลบ หรืออาจถูกลบไปแล้ว');
        assignmentDeleteAuthz = await teacherAssignmentOrAdmin({
          ...(typeof arg === 'object' ? arg : {}),
          id: requestedId,
          subjectCode: text(assignmentToDelete.SubjectCode || assignmentToDelete.subjectCode),
          level: text(assignmentToDelete.Level || assignmentToDelete.level),
          room: text(assignmentToDelete.Room || assignmentToDelete.room),
          term: activeTerm(root, assignmentToDelete.Term || assignmentToDelete.term),
          user: (typeof arg === 'object' && arg.user) || args[1]
        });
      } else {
        await adminOnly();
      }
      const pathName = { deleteStudent: 'students', deleteUser: 'users', deleteSubject: 'subjects', deleteAssignment: 'assignments', deleteTeacherClass: 'teacherClasses', deleteAttendanceAssistant: 'attendanceAssistants' }[name];
      if (name === 'deleteTeacherClass' && Array.isArray(arg.items)) {
        const root = await data(); const entries = Object.entries(rawMap(root.teacherClasses)); const updates = {};
        arg.items.forEach((item) => {
          const same = entries.find(([, row]) => text(row.TermID || row.term || row.Term) === text(item.term) && text(row.TeacherID || row.teacherId) === text(item.teacherId) && text(row.SubjectCode || row.subjectCode) === text(item.subjectCode) && text(row.Level || row.level) === text(item.level) && text(row.Room || row.room) === text(item.room));
          const key = same ? same[0] : firebaseKey([item.term, item.teacherId, item.subjectCode, item.level, item.room].map(text).join('_'));
          updates[`teacherClasses/${key}`] = null;
        });
        await db.ref('/').update(updates); snapshotPromise = null;
        const fresh = await data();
        return { success: true, deleted: arg.items.length, term: arg.term, data: teacherClasses(fresh) };
      }
      if (name === 'deleteTeacherClass') {
        const root = await data();
        const same = Object.entries(rawMap(root.teacherClasses)).find(([, row]) =>
          text(row.TermID || row.term || row.Term) === text(arg.term) &&
          text(row.TeacherID || row.teacherId) === text(arg.teacherId) &&
          text(row.SubjectCode || row.subjectCode) === text(arg.subjectCode) &&
          text(row.Level || row.level) === text(arg.level) &&
          text(row.Room || row.room) === text(arg.room)
        );
        if (!same) return resultError('ไม่พบรายการครู-วิชา-ห้องเรียนที่ต้องการลบ');
        await db.ref(`teacherClasses/${same[0]}`).remove(); snapshotPromise = null;
        const fresh = await data();
        return { success: true, message: 'ลบข้อมูลสำเร็จ', term: arg.term, data: teacherClasses(fresh) };
      }
       const key = text(arg && (arg.id || arg.studentId || arg.userId || arg.code || arg.assignmentId || arg.teacherClassId || arg.assistantId)); if (!key) return resultError('ไม่พบรหัสข้อมูล');
       // Legacy assignments may predate TeacherClassID. Normalize only the
       // authorized record before deleting it so the Rules can verify the
       // delete from the existing record without widening teacher access.
       if (name === 'deleteAssignment' && assignmentDeleteAuthz && !assignmentDeleteAuthz.admin) {
         const scopeId = text(assignmentDeleteAuthz.teacherClass && (assignmentDeleteAuthz.teacherClass.TeacherClassID || assignmentDeleteAuthz.teacherClass.teacherClassId));
         if (scopeId && text(assignmentToDelete.TeacherClassID || assignmentToDelete.teacherClassId) !== scopeId) {
           await db.ref(`assignments/${firebaseKey(key)}`).update({ TeacherClassID: scopeId, Term: activeTerm(root, assignmentToDelete.Term || assignmentToDelete.term) });
         }
       }
       const updates = {};
       updates[`${pathName}/${firebaseKey(key)}`] = null;
       if (name === 'deleteAssignment' && (!assignmentDeleteAuthz || assignmentDeleteAuthz.admin)) {
         Object.entries(rawMap(root.scores)).forEach(([scoreKey, row]) => {
           if (text(row.AssignmentID || row.assignmentId) === key) updates[`scores/${scoreKey}`] = null;
         });
       }
       await db.ref('/').update(updates); snapshotPromise = null; return { success: true, message: 'ลบข้อมูลสำเร็จ', deletedScores: name === 'deleteAssignment' ? Object.keys(updates).length - 1 : 0 };
    }
    if (name === 'setSystemSetting' || name === 'saveFolderSetting') { await adminOnly(); const key = text(arg.key || arg.name); await db.ref(`systemSettings/${firebaseKey(key)}`).set({ Key: key, Value: arg.value || arg.folderId || '' }); snapshotPromise = null; return { success: true }; }
    return { success: true, data: [] };
  }

  window.firebaseSignInWithGoogle = async function () {
    await persistenceReady;
    const result = await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    snapshotPromise = null;
    authReadyPromise = Promise.resolve(result.user);
    const email = String(result.user.email || '').trim().toLowerCase();
    if (email === 'suradet.t@wrk.ac.th') return { success: true, user: { id: 'admin', username: email, name: result.user.displayName || 'สุรเดช ธรรมประโชติ', role: 'admin', email, imageUrl: result.user.photoURL || '' } };
    const profile = (await db.ref(`authProfiles/${firebaseKey(result.user.uid)}`).once('value')).val();
    if (profile && profile.UserID && ['admin', 'teacher'].includes(text(profile.Role || profile.role).toLowerCase()) && text(profile.Status || profile.status).toLowerCase() !== 'inactive') return { success: true, user: user(profile) };
    const indexedRoot = (await db.ref('authEmailIndex').orderByChild('Email').equalTo(email).once('value')).val() || {};
    const indexed = Object.values(indexedRoot)[0];
  if (indexed && indexed.UserID && text(indexed.Role || indexed.role).toLowerCase() === 'teacher' && text(indexed.Status || indexed.status).toLowerCase() !== 'inactive') {
      const linkedProfile = { ...indexed, UID: result.user.uid, EmailKey: emailKey(email), UserID: indexed.UserID, Email: email, Role: 'teacher', Status: 'Active' };
      await db.ref(`authProfiles/${firebaseKey(result.user.uid)}`).set(linkedProfile);
      return { success: true, user: user(linkedProfile) };
    }
    return { success: true, needsSetup: true, uid: result.user.uid, email, name: result.user.displayName || email };
  };

  // One repository contract for the staff tabs. The UI may still use the
  // legacy Google Apps Script-shaped transport during the migration, but all
  // new CRUD calls now receive the same scope context and return the server
  // result directly. This prevents each tab from inventing its own term,
  // subject, level, room and identity combination.
  const repositoryContext = (context = {}) => {
    const user = context.user || {};
    return {
      ...context,
      userId: text(context.userId || user.id || user.userId || user.UserID),
      termId: text(context.termId || context.term || window.CURRENT_SERVER_TERM),
      term: text(context.term || context.termId || window.CURRENT_SERVER_TERM),
      subjectCode: text(context.subjectCode || context.subject),
      level: text(context.level),
      room: text(context.room),
      user
    };
  };
  const repositoryRead = (name, payload, options) => callReadWithRecovery(name, [payload], options);
  const repositoryWrite = (name, payload) => callWithWriteTimeout(name, [payload]);
  window.classroomRepository = {
    normalizeContext: repositoryContext,
    getAllowedScopes: (context = {}) => {
      const normalized = repositoryContext(context);
      return callReadWithRecovery('getInitialSystemData', [normalized.termId, normalized.user], { timeoutMs: 30000, retries: 0 }).then(result => {
        const payload = result && result.data ? result.data : {};
        return {
          success: !!(result && result.success),
          term: payload.meta && payload.meta.term || normalized.termId,
          levels: payload.levels || [],
          rooms: payload.rooms || [],
          subjects: payload.subjects || [],
          combos: payload.combos || [],
          teacherClasses: payload.teacherClasses || [],
          studentsLite: payload.students || [],
          data: payload
        };
      });
    },
    getDashboard: (context = {}) => {
      const normalized = repositoryContext(context);
      return callReadWithRecovery('getDashboardStats', [normalized.term], { timeoutMs: 30000, retries: 0 });
    },
    getStudents: (context = {}) => repositoryRead('getStudentsByFilter', repositoryContext(context)),
    getAssignments: (context = {}) => {
      const normalized = repositoryContext(context);
      return callReadWithRecovery('getInitialSystemData', [normalized.termId, normalized.user], { timeoutMs: 30000, retries: 0 })
        .then(result => {
          const rows = result && result.data && Array.isArray(result.data.assignments) ? result.data.assignments : [];
          return { ...result, data: rows.filter(row =>
            (!normalized.subjectCode || text(row.subjectCode || row.SubjectCode) === normalized.subjectCode) &&
            (!normalized.level || text(row.level || row.Level) === normalized.level) &&
            (!normalized.room || text(row.room || row.Room) === normalized.room)
          ) };
        });
    },
    getAttendance: (context = {}) => repositoryRead('getAttendanceForCheck', repositoryContext(context)),
    getScoreGrid: (context = {}) => repositoryRead('loadScoresGrid', repositoryContext(context)),
    getGradingRoster: (context = {}) => repositoryRead('getGradingData', repositoryContext(context)),
    saveAttendance: (context = {}) => repositoryWrite('saveAttendance', repositoryContext(context)),
    saveScores: (context = {}) => repositoryWrite('saveScoresBatch', repositoryContext(context)),
    saveScore: (context = {}) => repositoryWrite('saveScoresBatch', repositoryContext(context)),
    saveGrades: (context = {}) => repositoryWrite('saveGradingBatch', repositoryContext(context))
  };

  window.firebaseAuthReady = ready;
  window.firebaseSubscribeTermData = subscribeTermData;
  window.firebaseSubscribeScoreGrid = subscribeScoreGrid;
  window.firebaseSubscribeGradingData = subscribeGradingData;
  // Bounded read fallback used only when the realtime score bootstrap cannot
  // complete. It reads the same central Firebase data and never writes.
  window.firebaseLoadScoresGrid = (request) => window.classroomRepository.getScoreGrid(request);

  const base = { withSuccessHandler(fn) { this._success = fn; return this; }, withFailureHandler(fn) { this._failure = fn; return this; } };
  window.google = window.google || {}; window.google.script = window.google.script || {};
  const repositoryRoutes = {
    getStudentsByFilter: (args) => window.classroomRepository.getStudents(args[0] || {}),
    getAttendanceForCheck: (args) => window.classroomRepository.getAttendance(args[0] || {}),
    loadScoresGrid: (args) => window.classroomRepository.getScoreGrid(args[0] || {}),
    getGradingData: (args) => window.classroomRepository.getGradingRoster(args[0] || {}),
    getDashboardStats: (args) => window.classroomRepository.getDashboard({ term: args[0] }),
    getInitialDropdowns: (args) => window.classroomRepository.getAllowedScopes({ termId: window.CURRENT_SERVER_TERM, user: args[0] }),
    saveAttendance: (args) => window.classroomRepository.saveAttendance(args[0] || {}),
    saveScoresBatch: (args) => window.classroomRepository.saveScores(args[0] || {}),
    saveGradingBatch: (args) => window.classroomRepository.saveGrades(args[0] || {})
  };
  window.google.script.run = new Proxy(base, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const success = target._success;
      const failure = target._failure;
      target._success = target._failure = null;
      const name = String(prop);
      const request = repositoryRoutes[name]
        ? repositoryRoutes[name](args)
        : (isReadCall(prop) ? callReadWithRecovery(prop, args) : (name === 'saveStudent' || name === 'setStudentStatus' ? callWithWriteTimeout(prop, args) : call(prop, args)));
      request.then((value) => success && success(value)).catch((error) => failure && failure(error));
      return target;
    };
  } });
})();
