/**
 * CLASSROOM MANAGEMENT SYSTEM (DIRECT CRUD v1.2 - ID ROBUST FIX)
 * โรงเรียนวัดไร่ขิงวิทยา
 * Architect: Senior Google Apps Script Engineer
 * * [CHANGELOG v1.2]
 * - Fixed: getStudentById uses robust ID comparison (String & Trim)
 * - Fixed: getUsers ensures IDs are strings to prevent frontend mismatches
 * - Refactor: Clean Direct CRUD implementation
 */

const CONFIG = {
  SPREADSHEET_ID: '13vrrsDAXc1EEm7FIVqFvuE_lOmA_1OyyVX3nP0zf6H4', 
  FOLDER_ID: '1N6YPe3vGpLw5KS2lB6wyaDpLGYYCPz7U', 
  
  SHEET_NAMES: {
    CONFIG: 'Config',
    STUDENTS: 'Students',
    ATTENDANCE: 'Attendance',
    ASSIGNMENTS: 'Assignments',
    SCORES: 'Scores',
    SUBJECTS: 'Subjects',
    USERS: 'Users',
    TEACHER_CLASSES: 'TeacherClasses',
    ATTENDANCE_ASSISTANTS: 'AttendanceAssistants',
    TERMS: 'Terms',
    SYSTEM_SETTINGS: 'SystemSettings',
    AUDIT: 'AuditLog'
  },
  
  HEADERS: {
    CONFIG: ['Key', 'Value'],
    SUBJECTS: ['SubjectCode', 'SubjectName', 'Term', 'Status', 'CreatedAt', 'UpdatedAt', 'Teacher', 'Classes'],
    STUDENTS: ['StudentID', 'Prefix', 'FirstName', 'LastName', 'Level', 'Room', 'No', 'Status', 'ProfileImage', 'Icon', 'Term'],
    ASSIGNMENTS: ['AssignmentID', 'Title', 'MaxScore', 'SubjectCode', 'Type', 'DateCreated', 'Term', 'DueDate', 'Level', 'Room'],
    SCORES: ['Timestamp', 'AssignmentID', 'StudentID', 'Score', 'IsSubmitted', 'Term', 'ScoreID'],
    USERS: ['UserID', 'Username', 'Password', 'Name', 'Role', 'Status', 'ProfileImage', 'Prefix', 'LastName', 'Position', 'School', 'Group'],
    TEACHER_CLASSES: ['TeacherID', 'SubjectCode', 'Level', 'Room', 'TermID', 'Status'],
    ATTENDANCE_ASSISTANTS: ['AssistantID', 'AssistantStudentID', 'SubjectCode', 'Level', 'Room', 'TermID', 'Status', 'AssignedBy', 'UpdatedAt'],
    TERMS: ['TermID', 'AcademicYear', 'TermNo', 'Status', 'SpreadsheetId', 'FolderId', 'CreatedAt', 'CreatedBy'],
    SYSTEM_SETTINGS: ['Key', 'Value'],
    ATTENDANCE: ['Timestamp', 'Date', 'SubjectCode', 'Level', 'Room', 'StudentID', 'Status', 'Recorder', 'Term', 'Note', 'RecordID'],
    AUDIT: ['Timestamp', 'UserID', 'Action', 'Target', 'Detail', 'Term']
  },
  
  ADMIN_PASS_DEFAULT: '1234'
};

let _SS_INSTANCE = null;

// --- CORE FUNCTIONS ---

function doGet(e) {
  if (e && e.parameter && e.parameter.debug) {
    var debugType = String(e.parameter.debug || '').trim().toLowerCase();
    var debugResult;
    if (debugType === 'db' || debugType === 'location') {
      debugResult = DEBUG_DATABASE_LOCATION();
    } else if (debugType === 'duplicates') {
      debugResult = DEBUG_duplicateSaveDiag_({
        attendance: {
          term: e.parameter.term || '',
          date: e.parameter.date || '',
          subject: e.parameter.subject || e.parameter.subjectCode || '',
          level: e.parameter.level || '',
          room: e.parameter.room || ''
        },
        score: {
          term: e.parameter.term || '',
          assignmentId: e.parameter.assignmentId || '',
          studentId: e.parameter.studentId || ''
        }
      });
    } else if (debugType === 'assistant_diag') {
      debugResult = DEBUG_assistantDiag_(e.parameter.uid || e.parameter.sid, e.parameter.term);
    } else {
      debugResult = { success: false, message: 'Unknown debug type: ' + debugType };
    }
    return ContentService
      .createTextOutput(JSON.stringify(debugResult, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var page = e && e.parameter ? String(e.parameter.page || e.parameter.view || '').toLowerCase() : '';
  var isAssistantEntry = page === 'assistant' || page === 'attendance-assistant';
  var templateName = isAssistantEntry ? 'assistant' : 'index';
  var template = HtmlService.createTemplateFromFile(templateName);
  if (isAssistantEntry) {
    template.ASSISTANT_PARAMS = encodeURIComponent(JSON.stringify((e && e.parameter) ? e.parameter : {}));
  }
  return template
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      .setTitle(isAssistantEntry ? 'ผู้ช่วยเช็คชื่อ' : 'ระบบจัดการชั้นเรียน - ครูสุรเดช ธรรมประโชติ')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDb() {
  if (_SS_INSTANCE) return _SS_INSTANCE;
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active && active.getId()) {
      _SS_INSTANCE = active;
      return _SS_INSTANCE;
    }
  } catch (e) {
    console.warn("Cannot get active spreadsheet: " + e.message);
  }
  if (CONFIG.SPREADSHEET_ID) {
    try {
      _SS_INSTANCE = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      return _SS_INSTANCE;
    } catch (e) {
      console.warn("Cannot open by ID, falling back to active spreadsheet.");
    }
  }
  return null;
}

// --- HELPER FUNCTIONS ---

function normalizeSubjectCode(code) {
  if (!code) return "";
  return String(code)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeAttendanceRecordId_(term, date, subject, studentId) {
  return [
    'ATT',
    normalizeTermFast_(term, ''),
    normalizeDateFast_(date),
    normalizeSubjectCode(subject).toLowerCase(),
    String(studentId || '').trim().toLowerCase()
  ].join('|');
}

function makeScoreRecordId_(term, assignmentId, studentId) {
  return [
    'SCORE',
    sanitizeTerm_(term),
    String(assignmentId || '').trim().toLowerCase(),
    String(studentId || '').trim().toLowerCase()
  ].join('|');
}

function makeAttendanceAssistantId_(term, subject, level, room, studentId) {
  return [
    'ASST',
    sanitizeTerm_(term),
    normalizeSubjectCode(subject).toLowerCase(),
    normalizeLevelForCompare_(level),
    String(room || '').trim().toLowerCase(),
    String(studentId || '').trim().toLowerCase()
  ].join('|');
}

function formatDate(date) {
  if (!date) return "";
  return Utilities.formatDate(new Date(date), "GMT+7", "yyyy-MM-dd");
}

function getCurrentTerm() {
  try {
    var ss = getDb();
    var settingsSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SYSTEM_SETTINGS);
    if (settingsSheet && settingsSheet.getLastRow() > 1) {
      var settingsData = settingsSheet.getRange(1, 1, settingsSheet.getLastRow(), 2).getDisplayValues();
      for (var si = 0; si < settingsData.length; si++) {
        if (String(settingsData[si][0]).trim() === 'active_term' && String(settingsData[si][1]).trim()) {
          return normalizeTermIdForFrontend_(settingsData[si][1]);
        }
      }
    }
    var configSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
    if (!configSheet) return '1/2569';
    var lastRow = configSheet.getLastRow();
    if (lastRow < 1) return '1/2569';
    var data = configSheet.getRange(1, 1, lastRow, 2).getDisplayValues(); 
    var termRow = null;
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === 'CURRENT_TERM') {
        termRow = data[i];
        break;
      }
    }
    return termRow ? normalizeTermIdForFrontend_(termRow[1]) : '1/2569';
  } catch(e) {
    return '1/2569';
  }
}

function sanitizeTerm_(term) {
  return normalizeTermIdForFrontend_(term);
}

function inferTermFromDate_(dateObj) {
  var d = new Date(dateObj);
  if (isNaN(d.getTime())) return '';
  var month = d.getMonth() + 1;
  var yearAd = d.getFullYear();
  var yearTh = yearAd >= 2400 ? yearAd : (yearAd + 543);
  var termNo = '1';
  if (month >= 10 || month <= 3) {
    termNo = '2';
    if (month <= 3) yearTh = yearTh - 1;
  }
  return termNo + '/' + yearTh;
}

function isValidTermId_(value) {
  var s = String(value || '').trim();
  return /^[12]\/25\d{2}$/.test(s);
}

function normalizeTermIdForFrontend_(value) {
  if (value !== null && value !== undefined) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      var termDate = normalizeTermDateCell_(value);
      if (termDate) return termDate;
      var inferred = inferTermFromDate_(value);
      if (inferred) return inferred;
    } else {
      var s = String(value).trim();
      if (isValidTermId_(s)) return s;
      if (s.indexOf('GMT') > -1 || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) {
        var inferred = inferTermFromDate_(s);
        if (inferred) return inferred;
      }
      var compactTerm = normalizeLegacyThreePartTerm_(s);
      if (compactTerm) return compactTerm;
      var m = s.match(/([12])\s*\/\s*(25\d{2})/);
      if (m) return m[1] + '/' + m[2];
      var inferredFromText = inferTermFromDate_(s);
      if (inferredFromText) return inferredFromText;
    }
  }

  // Lazy evaluation and caching of activeTerm fallback
  var activeTerm = '';
  if (globalThis._CACHED_ACTIVE_TERM) {
    activeTerm = globalThis._CACHED_ACTIVE_TERM;
  } else {
    try {
      activeTerm = getSystemSetting_('active_term', '');
      globalThis._CACHED_ACTIVE_TERM = activeTerm;
    } catch (e) {}
  }
  return isValidTermId_(activeTerm) ? String(activeTerm).trim() : '1/2569';
}

function normalizeTermIdStrict_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var termDate = normalizeTermDateCell_(value);
    if (termDate) return termDate;
    var inferredDate = inferTermFromDate_(value);
    return isValidTermId_(inferredDate) ? inferredDate : '';
  }
  var s = String(value).trim();
  if (!s) return '';
  if (isValidTermId_(s)) return s;
  var compactTerm = normalizeLegacyThreePartTerm_(s);
  if (compactTerm) return compactTerm;
  var m = s.match(/([12])\s*\/\s*(25\d{2})/);
  if (m) return m[1] + '/' + m[2];
  if (s.indexOf('GMT') > -1 || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) {
    var inferredText = inferTermFromDate_(s);
    return isValidTermId_(inferredText) ? inferredText : '';
  }
  var inferredGeneric = inferTermFromDate_(s);
  return isValidTermId_(inferredGeneric) ? inferredGeneric : '';
}

function isBlankOrInvalidTerm_(term) {
  if (!term) return true;
  if (Object.prototype.toString.call(term) === '[object Date]') return true;
  var s = String(term).trim();
  if (s === '') return true;
  if (s.indexOf('GMT') > -1 || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) return true;
  return !/^[12]\/\d{4}$/.test(s);
}

function rowTermMatches_(rowTerm, selectedTerm) {
  var normalizedSelected = normalizeTermIdForFrontend_(selectedTerm);
  if (rowTerm === null || rowTerm === undefined || String(rowTerm).trim() === '') return true;
  var normalizedRow = normalizeTermIdStrict_(rowTerm);
  if (!isValidTermId_(normalizedRow)) return false;
  return normalizedRow === normalizedSelected;
}

function normalizeTermFast_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback || '';
  // BUG-007 FIX: handle both instanceof Date and [object Date] toString check
  if (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]') {
    var termDate = normalizeTermDateCell_(value);
    if (termDate) return termDate;
    var d = new Date(value);
    if (isNaN(d.getTime())) return fallback || '';
    var mth = d.getMonth() + 1;
    var y = d.getFullYear();
    var th = y >= 2400 ? y : y + 543;
    var t = '1';
    if (mth >= 10 || mth <= 3) {
      t = '2';
      if (mth <= 3) th = th - 1;
    }
    return t + '/' + th;
  }
  var s = String(value || '').trim();
  if (!s) return fallback || '';
  var compactTerm = normalizeLegacyThreePartTerm_(s);
  if (compactTerm) return compactTerm;
  var m = s.match(/([12])\s*\/\s*(25\d{2})/);
  if (m) return m[1] + '/' + m[2];
  var m2 = s.match(/เทอม\s*([12]).*?(25\d{2})|ภาคเรียน(?:ที่)?\s*([12]).*?(25\d{2})/);
  if (m2) return (m2[1] || m2[3]) + '/' + (m2[2] || m2[4]);
  return fallback || '';
}

function normalizeLegacyThreePartTerm_(value) {
  var s = String(value || '').trim();
  var m = s.match(/^([12])\s*\/\s*\d{1,2}\s*\/\s*(25\d{2})$/);
  return m ? (m[1] + '/' + m[2]) : '';
}

function normalizeTermDateCell_(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  var parts = [];
  try {
    parts = Utilities.formatDate(d, 'GMT+7', 'd/M/yyyy').split('/');
  } catch (e) {
    parts = [String(d.getDate()), String(d.getMonth() + 1), String(d.getFullYear())];
  }
  var day = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var year = parseInt(parts[2], 10);
  if (day !== 1 || (month !== 1 && month !== 2)) return '';
  var yearTh = year >= 2400 ? year : year + 543;
  return month + '/' + yearTh;
}

function rowTermMatchesFast_(rowTerm, selectedTerm) {
  var target = normalizeTermFast_(selectedTerm, '');
  if (!target) return true;
  if (rowTerm === null || rowTerm === undefined || String(rowTerm).trim() === '') return true;
  var row = normalizeTermFast_(rowTerm, '');
  return row === target;
}

function normalizeDateFast_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, 'GMT+7', 'yyyy-MM-dd');
  }

  var s = String(value || '').trim();
  if (!s) return '';

  if (s.indexOf('T') > -1 || s.indexOf('GMT') > -1 || s.indexOf('Z') > -1) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'GMT+7', 'yyyy-MM-dd');
    }
  }

  var mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (mIso) {
    return mIso[1] + '-' + ('0' + mIso[2]).slice(-2) + '-' + ('0' + mIso[3]).slice(-2);
  }

  var mSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mSlash) {
    var dSlash = ('0' + mSlash[1]).slice(-2);
    var moSlash = ('0' + mSlash[2]).slice(-2);
    var ySlash = String(mSlash[3]);
    var yNum = parseInt(ySlash, 10);
    if (yNum >= 2400) {
      ySlash = String(yNum - 543);
    }
    return ySlash + '-' + moSlash + '-' + dSlash;
  }

  return s;
}

function sameDateFast_(a, b) {
  var aa = normalizeDateFast_(a);
  var bb = normalizeDateFast_(b);
  return aa && bb && aa === bb;
}

function normalizeSubmittedFast_(value) {
  var s = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'ส่งแล้ว' || s === 'ส่ง') return 1;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === 'ยังไม่ส่ง' || s === '') return 0;
  return value ? 1 : 0;
}

function _safeCachePut_(cache, cacheKey, response) {
  try {
    var payload = JSON.stringify(response);
    if (payload.length < 90000) {
      cache.put(cacheKey, payload, 120);
    } else {
      Logger.log('cache skip large payload bytes=' + payload.length);
    }
  } catch (cacheErr) {
    Logger.log('cache skip ' + String(cacheErr));
  }
}

function _isFastAdminUser_(user) {
  var effectiveUser = getEffectiveUser_(user);
  var role = String(effectiveUser.role || '').toLowerCase();
  var id = String(effectiveUser.id || '').trim();
  return role === 'admin' || id === 'ADMIN_MASTER';
}

function normalizeIcon_(icon, prefix) {
  var p = String(prefix || '').trim();
  if (p === 'เด็กชาย' || p === 'นาย') return 'fa-person';
  if (p === 'เด็กหญิง' || p === 'นางสาว') return 'fa-person-dress';
  var s = String(icon || '').trim();
  if (!s || s.indexOf('fa-') !== 0) return 'fa-user-graduate';
  return s;
}

function getActiveTerm_() {
  return getCurrentTerm();
}

function resolveTerm_(inputTerm) {
  if (inputTerm) return sanitizeTerm_(inputTerm);
  return getCurrentTerm();
}

function ensureSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  if (!headers || headers.length === 0) return sheet;

  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e2e8f0');
    sheet.setFrozenRows(1);
    return sheet;
  }

  var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headerMap = {};
  for (var i = 0; i < currentHeaders.length; i++) {
    headerMap[String(currentHeaders[i]).trim()] = true;
  }
  var missing = [];
  for (var j = 0; j < headers.length; j++) {
    if (!headerMap[String(headers[j]).trim()]) missing.push(headers[j]);
  }
  if (missing.length > 0) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function ensureCoreSheets_() {
  var ss = getDb();
  var keys = Object.keys(CONFIG.SHEET_NAMES);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    ensureSheet_(ss, CONFIG.SHEET_NAMES[key], CONFIG.HEADERS[key] || []);
  }
  return ss;
}

function logAudit_(userId, action, target, detail, term) {
  try {
    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.AUDIT, CONFIG.HEADERS.AUDIT);
    sheet.appendRow([new Date(), userId || '', action || '', target || '', detail || '', sanitizeTerm_(term)]);
  } catch (e) {
    console.warn('Audit log failed: ' + e.message);
  }
}

function setSystemSetting_(key, value) {
  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.SYSTEM_SETTINGS, CONFIG.HEADERS.SYSTEM_SETTINGS);
  var lastRow = sheet.getLastRow();
  var data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(key).trim()) {
      sheet.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getSystemSetting_(key, fallback) {
  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.SYSTEM_SETTINGS, CONFIG.HEADERS.SYSTEM_SETTINGS);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(key).trim()) {
        return data[i][1];
      }
    }
  }
  return fallback || '';
}

function getSystemSetting(key) {
  try {
    return { success: true, key: key, value: getSystemSetting_(key, '') };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  }
}

function setSystemSetting(key, value, userOpt) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var admin = requireAdmin_(userOpt);
    setSystemSetting_(key, value);
    invalidateTermCaches_(getCurrentTerm());
    _clearAdminSettingsCache(getCurrentTerm(), admin);
    if (String(key || '').trim() === 'active_term') invalidateTermsListCache_();
    logAudit_(admin.id, 'SET_SYSTEM_SETTING', key, String(value || ''), getCurrentTerm());
    return { success: true, key: key, value: value };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function syncLegacyCurrentTerm_(termId) {
  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.CONFIG, CONFIG.HEADERS.CONFIG);
  var lastRow = sheet.getLastRow();
  var data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 2).getValues() : [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'CURRENT_TERM') {
      sheet.getRange(i + 1, 2).setValue(termId);
      return;
    }
  }
  sheet.appendRow(['CURRENT_TERM', termId]);
}

function invalidateTermCaches_(termId) {
  try {
    var normalizedTerm = normalizeTermIdForFrontend_(termId);
    var cache = CacheService.getScriptCache();
    var keys = [
      'TERM_' + normalizedTerm,
      'DASHBOARD_' + normalizedTerm,
      'INITIAL_' + normalizedTerm,
      'STUDENTS_' + normalizedTerm,
      'SYSTEM_DB_' + normalizedTerm,
      'STUDENT_SNAPSHOT_VERSION_' + normalizedTerm,
      'global_dropdowns_data_v2_' + normalizedTerm
    ];
    cache.removeAll(keys);
    PropertiesService.getScriptProperties().setProperty('GIS_VERSION_' + normalizedTerm, String(Date.now()));
    PropertiesService.getScriptProperties().setProperty('INITIAL_VERSION_' + normalizedTerm, String(Date.now()));
    invalidateStudentSnapshotCaches_(normalizedTerm);
  } catch (e) {
    console.warn('invalidateTermCaches_ failed: ' + e.message);
  }
}

function invalidateStudentSnapshotCaches_(term) {
  var cache = CacheService.getScriptCache();
  var versionKey = 'STUDENT_SNAPSHOT_VERSION_' + term;
  cache.put(versionKey, Date.now().toString(), 21600);
}

function invalidateAllCaches() {
  var cache = CacheService.getScriptCache();
  var term = getCurrentTerm() || '1/2569';
  var normalizedTerm = normalizeTermIdForFrontend_(term);
  var keys = [
    'TERM_' + normalizedTerm,
    'DASHBOARD_' + normalizedTerm,
    'INITIAL_' + normalizedTerm,
    'STUDENTS_' + normalizedTerm,
    'SYSTEM_DB_' + normalizedTerm,
    'global_dropdowns_data_v2_' + normalizedTerm
  ];
  keys.push('SCHEMA_OK');
  cache.removeAll(keys);
  invalidateTermsListCache_();
  invalidateTeacherClassesCache_(normalizedTerm);
  _clearAdminSettingsCache(normalizedTerm, 'admin');
  _clearAdminSettingsCache(normalizedTerm, 'ADMIN_MASTER');
  PropertiesService.getScriptProperties().setProperty('GIS_VERSION_' + normalizedTerm, String(Date.now()));
  PropertiesService.getScriptProperties().setProperty('INITIAL_VERSION_' + normalizedTerm, String(Date.now()));
  invalidateStudentSnapshotCaches_(normalizedTerm);
  _SCHEMA_ENSURED = false;
  return { success: true };
}

function getInitialSystemCacheKey_(termId, userId) {
  var normalizedTerm = normalizeTermIdForFrontend_(termId);
  var uid = String(userId || 'anonymous').trim() || 'anonymous';
  var version = '';
  try {
    version = PropertiesService.getScriptProperties().getProperty('INITIAL_VERSION_' + normalizedTerm) || '0';
  } catch (e) {
    version = '0';
  }
  return 'INITIAL_' + normalizedTerm + '_' + uid + '_' + version;
}

function invalidateTermsListCache_() {
  try {
    CacheService.getScriptCache().remove('TERMS_LIST');
  } catch (e) {
    console.warn('invalidateTermsListCache_ failed: ' + e.message);
  }
}

function invalidateTeacherClassesCache_(termId) {
  try {
    CacheService.getScriptCache().remove('TEACHER_CLASSES_' + normalizeTermIdForFrontend_(termId));
  } catch (e) {
    console.warn('invalidateTeacherClassesCache_ failed: ' + e.message);
  }
}

function _clearAdminSettingsCache(term, user) {
  try {
    var normalizedTerm = normalizeTermIdForFrontend_(term || getCurrentTerm());
    var userId = '';
    if (user && typeof user === 'object') userId = String(user.id || '').trim();
    else userId = String(user || '').trim();
    var keys = [
      'ADMIN_SETTINGS_BOOTSTRAP_' + normalizedTerm + '_admin',
      'ADMIN_SETTINGS_BOOTSTRAP_' + normalizedTerm + '_ADMIN_MASTER',
      'ADMIN_SETTINGS_BOOTSTRAP_V2_' + normalizedTerm + '_admin',
      'ADMIN_SETTINGS_BOOTSTRAP_V2_' + normalizedTerm + '_ADMIN_MASTER'
    ];
    if (userId) {
      keys.push('ADMIN_SETTINGS_BOOTSTRAP_' + normalizedTerm + '_' + userId);
      keys.push('ADMIN_SETTINGS_BOOTSTRAP_V2_' + normalizedTerm + '_' + userId);
    }
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) {
    console.warn('_clearAdminSettingsCache failed: ' + e.message);
  }
}

function requireAdmin_(tokenOrUser) {
  var user = getEffectiveUser_(tokenOrUser);
  if (String(user.role || '').toLowerCase() !== 'admin') {
    throw new Error('Admin permission required');
  }
  return user;
}

function getTerms_() {
  if (globalThis._CACHED_TERMS_LIST) return globalThis._CACHED_TERMS_LIST;
  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TERMS, CONFIG.HEADERS.TERMS);
  if (sheet.getLastRow() < 2) {
    globalThis._CACHED_TERMS_LIST = [];
    return [];
  }
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  var terms = [];
  var map = {};
  for (var i = 0; i < data.length; i++) {
    var normalizedTerm = normalizeTermIdStrict_(data[i][0]);
    if (!isValidTermId_(normalizedTerm)) continue;
    var status = String(data[i][3] || '').trim() || 'Inactive';
    var item = {
      row: i + 2,
      termId: normalizedTerm,
      academicYear: String(data[i][1] || '').trim() || normalizedTerm.split('/')[1],
      termNo: String(data[i][2] || '').trim() || normalizedTerm.split('/')[0],
      status: status,
      spreadsheetId: data[i][4],
      folderId: data[i][5],
      createdAt: data[i][6],
      createdBy: data[i][7]
    };
    if (!map[normalizedTerm]) {
      map[normalizedTerm] = item;
      terms.push(item);
    } else {
      var prev = map[normalizedTerm];
      var prevScore = String(prev.status || '').toLowerCase() === 'active' ? 2 : (String(prev.status || '').toLowerCase() === 'prepared' ? 1 : 0);
      var newScore = String(status || '').toLowerCase() === 'active' ? 2 : (String(status || '').toLowerCase() === 'prepared' ? 1 : 0);
      if (newScore > prevScore) {
        map[normalizedTerm] = item;
        for (var k = 0; k < terms.length; k++) {
          if (terms[k].termId === normalizedTerm) {
            terms[k] = item;
            break;
          }
        }
      }
    }
  }
  globalThis._CACHED_TERMS_LIST = terms;
  return terms;
}

function getTermRow_(termId) {
  var target = sanitizeTerm_(termId);
  var terms = getTerms_();
  for (var i = 0; i < terms.length; i++) {
    if (terms[i].termId === target) return terms[i];
  }
  return null;
}

function getTerms() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('TERMS_LIST');
    if (cached) return JSON.parse(cached);
    var activeSetting = '';
    try {
      activeSetting = getSystemSetting_('active_term', '');
    } catch (settingErr) {}
    var activeTerm = normalizeTermIdForFrontend_(activeSetting || getCurrentTerm());
    var result = { success: true, data: getTerms_(), activeTerm: activeTerm };
    cache.put('TERMS_LIST', JSON.stringify(result), 300);
    return result;
  } catch (e) {
    return { success: false, message: e.message || e.toString(), data: [], activeTerm: normalizeTermIdForFrontend_(getCurrentTerm()) };
  }
}

function isTermArchived_(termId) {
  var row = getTermRow_(termId);
  return row && String(row.status || '').toLowerCase() === 'archived';
}

function guardTermWritable_(termId) {
  if (isTermArchived_(termId)) {
    throw new Error('Term is archived and read-only');
  }
}

function getEffectiveUser_(user) {
  if (!user) return { id: '', role: 'guest' };
  if (typeof user === 'string') user = { id: user };
  var id = String(user.id || user.userId || '').trim();
  var role = String(user.role || '').toLowerCase();
  var result = {
    id: id,
    role: '',
    name: user.name || '',
    level: user.level || '',
    room: user.room || ''
  };
  if (id === 'ADMIN_MASTER') {
    result.role = 'admin';
    return result;
  }

  if (role === 'attendance_assistant' && id) {
    result.role = 'attendance_assistant';
    result.level = user.level || '';
    result.room = user.room || '';
    result.name = user.name || '';
    return result;
  }

  try {
    var ss = getDb();
    var userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    if (userSheet && userSheet.getLastRow() > 1 && id) {
      var rows = userSheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === id && String(rows[i][5]) === 'Active') {
          result.role = String(rows[i][4] || 'teacher').toLowerCase();
          result.name = rows[i][3] || result.name;
          return result;
        }
      }
    }

    var studentSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (studentSheet && studentSheet.getLastRow() > 1 && id) {
      var term = getActiveTerm_();
      var data = studentSheet.getDataRange().getValues();
      for (var s = 1; s < data.length; s++) {
        if (String(data[s][0]).trim() === id && rowTermMatches_(data[s][10], term)) {
          result.role = 'student';
          result.level = data[s][4];
          result.room = data[s][5];
          return result;
        }
      }
    }
  } catch (e) {
    console.warn('getEffectiveUser_ failed: ' + e.message);
  }
  return result;
}

function canAccessClass_(user, arg2, arg3, arg4, arg5) {
  // Support both (user, subject, level, room, term) and (user, term, subject, level, room)
  var subject, level, room, term;
  var isTermSecond = false;
  if (typeof arg2 === 'string' && (arg2.indexOf('/') > -1 || /^\d+\/\d+$/.test(arg2.trim()))) {
    isTermSecond = true;
  }

  if (isTermSecond) {
    term = arg2;
    subject = arg3;
    level = arg4;
    room = arg5;
  } else {
    subject = arg2;
    level = arg3;
    room = arg4;
    term = arg5;
  }

  // Resolve the role from server-side data. Never trust a client-supplied role.
  var effectiveUser = getEffectiveUser_(user);
  var role = String(effectiveUser.role || '').toLowerCase();
  if (role === 'admin') return true;

  // 2. Normalization
  var targetSubject = normalizeSubjectCode(subject);
  var targetLevel = String(level || '').trim();
  var targetRoom = String(room || '').trim();
  var targetTerm = sanitizeTerm_(term);

  if (role === 'attendance_assistant') {
    return _assistantCanAccessClass_(effectiveUser, targetSubject, targetLevel, targetRoom, targetTerm);
  }

  if (role === 'student') {
    return String(effectiveUser.level || '').trim() === targetLevel &&
      String(effectiveUser.room || '').trim() === targetRoom;
  }

  if (role !== 'teacher' || !effectiveUser.id) {
    Logger.log('[canAccessClass_ DEBUG] Access Denied (Non-Teacher/Guest). Role=' + role + ', Term=' + targetTerm + ', Subject=' + targetSubject + ', Level=' + targetLevel + ', Room=' + targetRoom + ', TeacherClassesMatched=0');
    return false;
  }

  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TEACHER_CLASSES, CONFIG.HEADERS.TEACHER_CLASSES);
  var rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
  var hasTeacherRows = false;
  var matchedTeacherClasses = 0;
  for (var i = 0; i < rows.length; i++) {
    var rowTeacher = String(rows[i][0]).trim();
    var rowSubject = normalizeSubjectCode(rows[i][1]);
    var rowLevel = String(rows[i][2] || '').trim();
    var rowRoom = String(rows[i][3] || '').trim();
    var rowTerm = sanitizeTerm_(rows[i][4]);
    var rowStatus = String(rows[i][5] || '').toLowerCase();
    
    var subjectOk = !targetSubject || rowSubject === targetSubject;
    var levelOk = !targetLevel || isSameLevel_(rowLevel, targetLevel);
    var roomOk = !targetRoom || rowRoom === targetRoom;
    
    if (rowTeacher === effectiveUser.id) {
      if (rowStatus === 'active' && rowTerm === targetTerm) {
        hasTeacherRows = true;
      }
      matchedTeacherClasses++;
    }
    
    if (rowTeacher === effectiveUser.id && rowStatus === 'active' && rowTerm === targetTerm && subjectOk && levelOk && roomOk) {
      return true;
    }
  }

  if (!hasTeacherRows) {
    Logger.log('[canAccessClass_ DEBUG] Access Denied (TeacherClasses missing). Role=' + role + ', Teacher=' + effectiveUser.id + ', Term=' + targetTerm + ', Subject=' + targetSubject + ', Level=' + targetLevel + ', Room=' + targetRoom + ', TeacherClassesMatched=' + matchedTeacherClasses);
    return false;
  }

  Logger.log('[canAccessClass_ DEBUG] Access Denied. Role=' + role + ', Term=' + targetTerm + ', Subject=' + targetSubject + ', Level=' + targetLevel + ', Room=' + targetRoom + ', TeacherClassesMatched=' + matchedTeacherClasses);
  return false;
}

function normalizeLevelForCompare_(level) {
  return String(level || '').trim().replace(/^ม\./, '').replace(/^M\./i, '').replace(/^Grade\s*/i, '');
}

function isSameLevel_(a, b) {
  return normalizeLevelForCompare_(a) === normalizeLevelForCompare_(b);
}

function parseLevelRoomForCompare_(level, room) {
  var levelText = String(level || '').trim();
  var roomText = String(room || '').trim();
  var combined = levelText;
  if (combined.indexOf('/') > -1) {
    var parts = combined.split('/');
    levelText = parts[0] || '';
    if (!roomText && parts.length > 1) roomText = parts[1] || '';
  }
  return {
    level: normalizeLevelForCompare_(levelText),
    room: String(roomText || '').trim().replace(/^0+/, '') || String(roomText || '').trim()
  };
}

function isSameClass_(rowLevel, rowRoom, targetLevel, targetRoom) {
  var row = parseLevelRoomForCompare_(rowLevel, rowRoom);
  var target = parseLevelRoomForCompare_(targetLevel, targetRoom);
  if (!target.level || !target.room) return false;
  return row.level === target.level && row.room === target.room;
}

function normalizeLevelForCompareV2_(level) {
  return String(level || '')
    .replace(/^ม\./, '')
    .replace(/^เธก\./, '')
    .replace(/^M\./i, '')
    .replace(/^Grade\s*/i, '')
    .trim()
    .toLowerCase();
}

normalizeLevelForCompare_ = normalizeLevelForCompareV2_;

function _assistantCanAccessClass_(effectiveUser, subject, level, room, term) {
  var studentId = String(effectiveUser && effectiveUser.id || '').trim();
  if (!studentId) return false;
  var targetSubject = normalizeSubjectCode(subject);
  var targetLevel = String(level || '').trim();
  var targetRoom = String(room || '').trim();
  var targetTerm = sanitizeTerm_(term);
  if (!targetSubject || !targetLevel || !targetRoom || !targetTerm) return false;

  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS, CONFIG.HEADERS.ATTENDANCE_ASSISTANTS);
  var layout = _attendanceAssistantSheetLayout_(sheet);
  var idx = layout.indexes;
  var rows = sheet && sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, layout.colCount).getValues()
    : [];
  var targetAssistantId = makeAttendanceAssistantId_(targetTerm, targetSubject, targetLevel, targetRoom, studentId);

  for (var i = 0; i < rows.length; i++) {
    var rowAssistantId = String(rows[i][idx.assistantId] || '').trim();
    var rowStudent = String(rows[i][idx.studentId] || '').trim();
    var rowSubject = normalizeSubjectCode(rows[i][idx.subject]);
    var rowLevel = String(rows[i][idx.level] || '').trim();
    var rowRoom = String(rows[i][idx.room] || '').trim();
    var rowTerm = sanitizeTerm_(rows[i][idx.term]);
    var rowStatus = String(rows[i][idx.status] || '').toLowerCase();
    var idMatched = rowAssistantId && rowAssistantId === targetAssistantId;
    var fieldsMatched = rowStudent === studentId &&
        rowSubject === targetSubject &&
        isSameClass_(rowLevel, rowRoom, targetLevel, targetRoom) &&
        rowTerm === targetTerm;
    if ((idMatched || fieldsMatched) && rowStatus === 'active') {
      return true;
    }
  }
  return false;
}

function teacherScopeMissing_(user, term) {
  var effectiveUser = getEffectiveUser_(user);
  if (String(effectiveUser.role || '').toLowerCase() !== 'teacher') return false;
  var sheet = ensureSheet_(getDb(), CONFIG.SHEET_NAMES.TEACHER_CLASSES, CONFIG.HEADERS.TEACHER_CLASSES);
  if (!sheet || sheet.getLastRow() < 2) return true;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === effectiveUser.id &&
        rowTermMatches_(rows[i][4], term) &&
        String(rows[i][5] || '').toLowerCase() === 'active') return false;
  }
  return true;
}

function canAccessStudent_(user, studentId, term) {
  var effectiveUser = getEffectiveUser_(user);
  if (String(effectiveUser.role || '').toLowerCase() === 'admin') return true;
  if (String(effectiveUser.role || '').toLowerCase() === 'student') {
    return String(effectiveUser.id).trim() === String(studentId).trim();
  }
  return false;
}

function getAttendanceAssistantScopeByStudent_(studentId, termInput) {
  var term = sanitizeTerm_(termInput || getCurrentTerm());
  var sid = String(studentId || '').trim();
  if (!sid || !term) return [];
  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS, CONFIG.HEADERS.ATTENDANCE_ASSISTANTS);
  var layout = _attendanceAssistantSheetLayout_(sheet);
  var idx = layout.indexes;
  var rows = sheet && sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, layout.colCount).getValues()
    : [];
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var rowSid = String(rows[i][idx.studentId] || '').trim();
    var rowTerm = sanitizeTerm_(rows[i][idx.term]);
    var rowStatus = String(rows[i][idx.status] || '').toLowerCase();
    if (rowSid === sid && rowTerm === term && rowStatus === 'active') {
      var subject = normalizeSubjectCode(rows[i][idx.subject]);
      var level = String(rows[i][idx.level] || '').trim();
      var room = String(rows[i][idx.room] || '').trim();
      result.push({
        assistantId: String(rows[i][idx.assistantId] || '').trim() || makeAttendanceAssistantId_(rowTerm, subject, level, room, rowSid),
        studentId: rowSid,
        subjectCode: subject,
        level: level,
        room: room,
        term: rowTerm,
        status: rows[i][idx.status] || 'Active'
      });
    }
  }
  return result;
}

function getAttendanceAssistantScopeResolved_(studentId, preferredTerm) {
  var sid = String(studentId || '').trim();
  if (!sid) return { scope: [], term: '' };
  var ss = getDb();
  var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS, CONFIG.HEADERS.ATTENDANCE_ASSISTANTS);
  var layout = _attendanceAssistantSheetLayout_(sheet);
  var idx = layout.indexes;
  var rows = sheet && sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, layout.colCount).getValues()
    : [];
  var activeRows = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idx.studentId] || '').trim() !== sid) continue;
    if (String(rows[i][idx.status] || '').toLowerCase() !== 'active') continue;
    activeRows.push(rows[i]);
  }
  if (!activeRows.length) return { scope: [], term: '' };

  var pref = sanitizeTerm_(preferredTerm);
  var pickTerm = pref;
  var prefRows = pref ? activeRows.filter(function(r) { return sanitizeTerm_(r[idx.term]) === pref; }) : [];
  if (!prefRows.length) {
    // Pick latest term by academic year then term no.
    var terms = {};
    activeRows.forEach(function(r) { terms[sanitizeTerm_(r[idx.term])] = true; });
    var termList = Object.keys(terms);
    termList.sort(function(a, b) {
      var pa = String(a).split('/'); var pb = String(b).split('/');
      var ta = parseInt(pa[0], 10) || 0; var ya = parseInt(pa[1], 10) || 0;
      var tb = parseInt(pb[0], 10) || 0; var yb = parseInt(pb[1], 10) || 0;
      if (ya !== yb) return yb - ya;
      return tb - ta;
    });
    pickTerm = termList[0] || '';
  }
  var scopeRows = activeRows.filter(function(r) { return sanitizeTerm_(r[idx.term]) === pickTerm; });
  var scope = scopeRows.map(function(r) {
    var subject = normalizeSubjectCode(r[idx.subject]);
    var level = String(r[idx.level] || '').trim();
    var room = String(r[idx.room] || '').trim();
    var term = sanitizeTerm_(r[idx.term]);
    var studentId = String(r[idx.studentId] || '').trim();
    return {
      assistantId: String(r[idx.assistantId] || '').trim() || makeAttendanceAssistantId_(term, subject, level, room, studentId),
      studentId: studentId,
      subjectCode: subject,
      level: level,
      room: room,
      term: term,
      status: r[idx.status] || 'Active'
    };
  });
  return { scope: scope, term: pickTerm };
}

function getAttendanceAssistants(payload) {
  try {
    payload = payload || {};
    var user = getEffectiveUser_(payload.user || payload.admin || payload.token);
    var role = String(user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'teacher') return { success: false, message: 'Access denied', data: [] };
    var term = sanitizeTerm_(payload.term || getCurrentTerm());
    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS, CONFIG.HEADERS.ATTENDANCE_ASSISTANTS);
    var layout = _normalizeAttendanceAssistantSheet_(sheet);
    var idx = layout.indexes;
    var rows = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, layout.colCount).getValues()
      : [];
    var data = [];
    for (var i = 0; i < rows.length; i++) {
      var rowTerm = sanitizeTerm_(rows[i][idx.term]);
      if (rowTerm !== term) continue;
      var studentId = String(rows[i][idx.studentId] || '').trim();
      var subject = normalizeSubjectCode(rows[i][idx.subject]);
      var level = String(rows[i][idx.level] || '').trim();
      var room = String(rows[i][idx.room] || '').trim();
      if (role === 'teacher' && !canAccessClass_(user, subject, level, room, term)) continue;
      data.push({
        assistantId: String(rows[i][idx.assistantId] || '').trim() || makeAttendanceAssistantId_(rowTerm, subject, level, room, studentId),
        studentId: studentId,
        subjectCode: subject,
        level: level,
        room: room,
        term: rowTerm,
        status: rows[i][idx.status] || 'Active',
        assignedBy: String(rows[i][idx.assignedBy] || '').trim(),
        updatedAt: rows[i][idx.updatedAt] || ''
      });
    }
    return { success: true, data: data, term: term };
  } catch (e) {
    return { success: false, message: e.message || String(e), data: [] };
  }
}

function saveAttendanceAssistant(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var user = getEffectiveUser_(payload.user || payload.admin || payload.token);
    var role = String(user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'teacher') return { success: false, message: 'Access denied' };

    var term = sanitizeTerm_(payload.term || getCurrentTerm());
    var studentId = String(payload.studentId || '').trim();
    var subject = normalizeSubjectCode(payload.subjectCode || payload.subject);
    var level = String(payload.level || '').trim();
    var room = String(payload.room || '').trim();
    var status = String(payload.status || 'Active').trim() || 'Active';
    if (!studentId || !subject || !level || !room || !term) throw new Error('studentId, subjectCode, level, room and term are required');
    if (role === 'teacher' && !canAccessClass_(user, subject, level, room, term)) return { success: false, message: 'Access denied' };

    var ss = getDb();
    var stSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (!stSheet || stSheet.getLastRow() < 2) throw new Error('Student data not found');
    var stRows = stSheet.getRange(2, 1, stSheet.getLastRow() - 1, 11).getValues();
    var matchedStudent = null;
    var fallbackStudent = null;
    for (var i = 0; i < stRows.length; i++) {
      if (String(stRows[i][0] || '').trim() === studentId) fallbackStudent = stRows[i];
      if (String(stRows[i][0] || '').trim() === studentId && rowTermMatches_(stRows[i][10], term)) {
        matchedStudent = stRows[i];
        break;
      }
    }
    if (!matchedStudent) matchedStudent = fallbackStudent;
    if (!matchedStudent) throw new Error('ไม่พบนักเรียนในระบบ');
    if (!isSameClass_(matchedStudent[4], matchedStudent[5], level, room)) {
      throw new Error('นักเรียนต้องอยู่ห้องเดียวกับที่กำหนด');
    }

    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS, CONFIG.HEADERS.ATTENDANCE_ASSISTANTS);
    var layout = _attendanceAssistantSheetLayout_(sheet);
    var idx = layout.indexes;
    var colCount = layout.colCount;
    var assistantId = makeAttendanceAssistantId_(term, subject, level, room, studentId);
    var lastRow = sheet.getLastRow();
    var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, colCount).getValues() : [];
    var rowIndex = -1;
    for (var r = 0; r < rows.length; r++) {
      var rowAssistantId = String(rows[r][idx.assistantId] || '').trim();
      var legacyMatch = String(rows[r][idx.studentId] || '').trim() === studentId &&
          normalizeSubjectCode(rows[r][idx.subject]) === subject &&
          isSameClass_(String(rows[r][idx.level] || '').trim(), String(rows[r][idx.room] || '').trim(), level, room) &&
          sanitizeTerm_(rows[r][idx.term]) === term;
      if (rowAssistantId === assistantId || legacyMatch) {
        rowIndex = r + 2;
        break;
      }
    }
    var rowData = rowIndex > -1 ? rows[rowIndex - 2].slice() : _blankMappedRow_(colCount);
    _setMappedValue_(rowData, idx.assistantId, assistantId, colCount);
    _setMappedValue_(rowData, idx.studentId, studentId, colCount);
    _setMappedValue_(rowData, idx.subject, subject, colCount);
    _setMappedValue_(rowData, idx.level, level, colCount);
    _setMappedValue_(rowData, idx.room, room, colCount);
    _setMappedValue_(rowData, idx.term, term, colCount);
    _setMappedValue_(rowData, idx.status, status, colCount);
    _setMappedValue_(rowData, idx.assignedBy, String(user.id || ''), colCount);
    _setMappedValue_(rowData, idx.updatedAt, new Date(), colCount);
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, colCount).setValues([rowData.slice(0, colCount)]);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, colCount).setValues([rowData.slice(0, colCount)]);
    try {
      invalidateTermCaches_(term);
    } catch (cacheErr) {
      console.warn('Attendance assistant saved, but cache invalidation failed: ' + cacheErr);
    }
    return { success: true, assistantId: String(assistantId), term: String(term) };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  } finally {
    try { lock.releaseLock(); } catch (unlockErr) {}
  }
}

function deleteAttendanceAssistant(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var user = getEffectiveUser_(payload.user || payload.admin || payload.token);
    var role = String(user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'teacher') return { success: false, message: 'Access denied' };

    var term = sanitizeTerm_(payload.term || getCurrentTerm());
    var studentId = String(payload.studentId || '').trim();
    var subject = normalizeSubjectCode(payload.subjectCode || payload.subject);
    var level = String(payload.level || '').trim();
    var room = String(payload.room || '').trim();
    if (!studentId || !subject || !level || !room || !term) throw new Error('Missing required fields');
    if (role === 'teacher' && !canAccessClass_(user, subject, level, room, term)) return { success: false, message: 'Access denied' };

    var sheet = ensureSheet_(getDb(), CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS, CONFIG.HEADERS.ATTENDANCE_ASSISTANTS);
    var layout = _normalizeAttendanceAssistantSheet_(sheet);
    var idx = layout.indexes;
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, layout.colCount).getValues() : [];
    var assistantId = String(payload.assistantId || '').trim() || makeAttendanceAssistantId_(term, subject, level, room, studentId);
    var deleted = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      var rowAssistantId = String(rows[i][idx.assistantId] || '').trim();
      var legacyMatch = String(rows[i][idx.studentId] || '').trim() === studentId &&
          normalizeSubjectCode(rows[i][idx.subject]) === subject &&
          isSameClass_(String(rows[i][idx.level] || '').trim(), String(rows[i][idx.room] || '').trim(), level, room) &&
          sanitizeTerm_(rows[i][idx.term]) === term;
      if (rowAssistantId === assistantId || legacyMatch) {
        sheet.deleteRow(i + 2);
        deleted++;
      }
    }
    try {
      invalidateTermCaches_(term);
    } catch (cacheErr) {
      console.warn('Attendance assistant deleted, but cache invalidation failed: ' + cacheErr);
    }
    return { success: true, deleted: Number(deleted), term: String(term), assistantId: String(assistantId) };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  } finally {
    try { lock.releaseLock(); } catch (unlockErr) {}
  }
}

function openAttendanceAssistantLink(payload) {
  try {
    payload = payload || {};
    var studentId = String(payload.uid || payload.studentId || '').trim();
    var preferredTerm = sanitizeTerm_(payload.term || getCurrentTerm());
    var preferredSubject = normalizeSubjectCode(payload.subject || payload.subjectCode);
    var preferredLevel = String(payload.level || '').trim();
    var preferredRoom = String(payload.room || '').trim();
    if (!studentId) return { success: false, message: 'Missing student id' };

    var resolved = getAttendanceAssistantScopeResolved_(studentId, preferredTerm);
    var scope = resolved.scope || [];
    var prefParsed = parseLevelRoomForCompare_(preferredLevel, preferredRoom);
    if (preferredSubject && prefParsed.level && prefParsed.room) {
      scope = scope.filter(function(item) {
        return normalizeSubjectCode(item.subjectCode) === preferredSubject &&
          isSameClass_(item.level, item.room, preferredLevel, preferredRoom) &&
          (!preferredTerm || sanitizeTerm_(item.term) === preferredTerm);
      }).concat((resolved.scope || []).filter(function(item) {
        return !(normalizeSubjectCode(item.subjectCode) === preferredSubject &&
          isSameClass_(item.level, item.room, preferredLevel, preferredRoom) &&
          (!preferredTerm || sanitizeTerm_(item.term) === preferredTerm));
      }));
    }
    if (!scope.length) return { success: false, message: 'ยังไม่มีสิทธิ์ผู้ช่วยเช็คชื่อ หรือสิทธิ์หมดอายุ' };

    var ss = getDb();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    var profile = null;
    if (sheet && sheet.getLastRow() > 1) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() !== studentId) continue;
        if (preferredTerm && !rowTermMatches_(rows[i][10], preferredTerm)) continue;
        profile = rows[i];
        break;
      }
      if (!profile) {
        for (var j = 0; j < rows.length; j++) {
          if (String(rows[j][0] || '').trim() === studentId) {
            profile = rows[j];
            break;
          }
        }
      }
    }
    var user = {
      id: studentId,
      role: 'attendance_assistant',
      name: profile ? String((profile[1] || '') + (profile[2] || '') + ' ' + (profile[3] || '')).trim() : studentId,
      prefix: profile ? profile[1] : '',
      level: profile ? profile[4] : '',
      room: profile ? profile[5] : '',
      term: sanitizeTerm_(resolved.term || preferredTerm || (scope[0] && scope[0].term)),
      imageUrl: profile ? (profile[8] || '') : '',
      assistantScope: scope
    };
    return { success: true, user: user, scope: scope };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

function createNewTerm(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var academicYear = String(payload.academicYear || '').trim();
    var termNo = String(payload.termNo || '').trim();
    if (!academicYear || !termNo) throw new Error('academicYear and termNo are required');
    var termId = normalizeTermIdForFrontend_(termNo + '/' + academicYear);
    var ss = ensureCoreSheets_();
    var termsSheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TERMS, CONFIG.HEADERS.TERMS);
    termsSheet.getRange(2, 1, Math.max(termsSheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    if (getTermRow_(termId)) throw new Error('Duplicate TermID: ' + termId);

    var previousTerm = getCurrentTerm();
    var folderId = '';
    var folderUrl = '';
    try {
      var baseFolderId = String(payload.targetFolderId || payload.folderId || getSystemSetting_('system_folder_id', CONFIG.FOLDER_ID) || CONFIG.FOLDER_ID || '').trim();
      var parent = baseFolderId ? DriveApp.getFolderById(baseFolderId) : DriveApp.getRootFolder();
      var folder = parent.createFolder('Term_' + termId.replace('/', '-'));
      folderId = folder.getId();
      folderUrl = folder.getUrl();
    } catch (driveErr) {
      folderUrl = 'Drive folder not created: ' + driveErr.message;
    }

    ensureSchemaAndHeaders();

    if (payload.copySubjects) {
      ensureSubjectsSheetSchema_(ss);
      var subjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
      if (subjSheet && subjSheet.getLastRow() > 1) {
        var subjData = subjSheet.getDataRange().getDisplayValues();
        var subjHeaders = subjData[0].map(function(h) { return String(h).trim(); });
        var idxTerm = subjHeaders.indexOf('Term');
        var idxStatus = subjHeaders.indexOf('Status');
        var newSubjRows = [];
        for (var si = 1; si < subjData.length; si++) {
          var rowTerm = idxTerm > -1 ? normalizeTermFast_(subjData[si][idxTerm], '') : '';
          var rowStatus = idxStatus > -1 ? (subjData[si][idxStatus] || 'Active') : 'Active';
          if ((!rowTerm || rowTerm === previousTerm) && rowStatus === 'Active') {
            var newRow = subjData[si].slice();
            if (idxTerm > -1) newRow[idxTerm] = termId;
            if (idxStatus > -1) newRow[idxStatus] = 'Active';
            if (subjHeaders.indexOf('CreatedAt') > -1) newRow[subjHeaders.indexOf('CreatedAt')] = new Date();
            if (subjHeaders.indexOf('UpdatedAt') > -1) newRow[subjHeaders.indexOf('UpdatedAt')] = new Date();
            newSubjRows.push(newRow);
          }
        }
        if (newSubjRows.length > 0) {
          subjSheet.getRange(subjSheet.getLastRow() + 1, 1, newSubjRows.length, subjHeaders.length).setValues(newSubjRows);
        }
      }
    }

    if (payload.copyTeacherClasses) {
      var tcSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_CLASSES);
      if (tcSheet && tcSheet.getLastRow() > 1) {
        tcSheet.getRange(2, 5, Math.max(tcSheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
        var tcRows = tcSheet.getRange(2, 1, tcSheet.getLastRow() - 1, 6).getValues();
        var newTcRows = [];
        for (var i = 0; i < tcRows.length; i++) {
          if (sanitizeTerm_(tcRows[i][4]) === previousTerm && String(tcRows[i][5] || '').toLowerCase() === 'active') {
            newTcRows.push([tcRows[i][0], tcRows[i][1], tcRows[i][2], tcRows[i][3], termId, tcRows[i][5]]);
          }
        }
        if (newTcRows.length > 0) tcSheet.getRange(tcSheet.getLastRow() + 1, 1, newTcRows.length, 6).setValues(newTcRows);
      }
    }

    termsSheet.appendRow([termId, academicYear, termNo, payload.setActive ? 'Active' : 'Prepared', ss.getId(), folderId, new Date(), admin.id]);
    if (payload.setActive) {
      var terms = getTerms_();
      for (var ti = 0; ti < terms.length; ti++) {
        var status = terms[ti].termId === termId ? 'Active' : (String(terms[ti].status || '').toLowerCase() === 'archived' ? 'Archived' : 'Inactive');
        termsSheet.getRange(terms[ti].row, 4).setValue(status);
      }
      setSystemSetting_('active_term', termId);
      syncLegacyCurrentTerm_(termId);
    }
    invalidateTermCaches_(termId);
    invalidateTermsListCache_();
    invalidateTeacherClassesCache_(termId);
    _clearAdminSettingsCache(termId, admin);
    _clearAdminSettingsCache(previousTerm, admin);
    logAudit_(admin.id, 'CREATE_TERM', termId, JSON.stringify({ copyUsers: !!payload.copyUsers, copySubjects: !!payload.copySubjects, copyTeacherClasses: !!payload.copyTeacherClasses }), termId);
    return { success: true, termId: termId, folderUrl: folderUrl, spreadsheetUrl: ss.getUrl(), message: folderUrl || 'Term created' };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function setActiveTerm(termInput) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var payload = typeof termInput === 'string' ? { termId: termInput } : (termInput || {});
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var termId = normalizeTermIdForFrontend_(payload.termId || payload.term);
    var row = getTermRow_(termId);
    if (!row) throw new Error('Term not found: ' + termId);
    var previousTerm = getCurrentTerm();

    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TERMS, CONFIG.HEADERS.TERMS);
    var terms = getTerms_();
    for (var i = 0; i < terms.length; i++) {
      var status = terms[i].termId === termId ? 'Active' : (String(terms[i].status || '').toLowerCase() === 'archived' ? 'Archived' : 'Inactive');
      sheet.getRange(terms[i].row, 4).setValue(status);
    }
    setSystemSetting_('active_term', termId);
    syncLegacyCurrentTerm_(termId);
    invalidateTermCaches_(termId);
    invalidateTermsListCache_();
    _clearAdminSettingsCache(termId, admin);
    if (previousTerm && previousTerm !== termId) _clearAdminSettingsCache(previousTerm, admin);
    logAudit_(admin.id, 'SET_ACTIVE_TERM', termId, '', termId);
    return { success: true, termId: termId };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function backupTerm(termInput) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var payload = typeof termInput === 'string' ? { termId: termInput } : (termInput || {});
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var termId = sanitizeTerm_(payload.termId || payload.term);
    var termRow = getTermRow_(termId);
    if (!termRow) throw new Error('Term not found: ' + termId);

    var ss = getDb();
    var backupFile = null;
    var backupFolder = null;
    try {
      var parent = CONFIG.FOLDER_ID ? DriveApp.getFolderById(CONFIG.FOLDER_ID) : DriveApp.getRootFolder();
      backupFolder = parent.createFolder('Backup_' + termId.replace('/', '-') + '_' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss'));
      backupFile = DriveApp.getFileById(ss.getId()).makeCopy('Backup_' + ss.getName() + '_' + termId.replace('/', '-'), backupFolder);
    } catch (driveErr) {
      throw new Error('Backup failed: ' + driveErr.message);
    }

    invalidateTermCaches_(termId);
    _clearAdminSettingsCache(termId, admin);
    logAudit_(admin.id, 'BACKUP_TERM', termId, backupFile ? backupFile.getUrl() : '', termId);
    return { success: true, termId: termId, backupUrl: backupFile ? backupFile.getUrl() : '', folderUrl: backupFolder ? backupFolder.getUrl() : '' };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function archiveTerm(termInput) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var payload = typeof termInput === 'string' ? { termId: termInput } : (termInput || {});
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var termId = sanitizeTerm_(payload.termId || payload.term);
    var termRow = getTermRow_(termId);
    if (!termRow) throw new Error('Term not found: ' + termId);
    if (termId === getCurrentTerm() && !payload.force) {
      throw new Error('Cannot archive the active term without force');
    }

    var sheet = ensureSheet_(getDb(), CONFIG.SHEET_NAMES.TERMS, CONFIG.HEADERS.TERMS);
    sheet.getRange(termRow.row, 4).setValue('Archived');
    invalidateTermCaches_(termId);
    invalidateTermsListCache_();
    _clearAdminSettingsCache(termId, admin);
    logAudit_(admin.id, 'ARCHIVE_TERM', termId, payload.force ? 'force=true' : '', termId);
    return { success: true, termId: termId };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getTeacherClasses(termInput) {
  try {
    var term = normalizeTermIdForFrontend_(termInput || getCurrentTerm());
    var cache = CacheService.getScriptCache();
    var cacheKey = 'TEACHER_CLASSES_' + term;
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TEACHER_CLASSES, CONFIG.HEADERS.TEACHER_CLASSES);
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
    var teacherNames = {};
    var userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    if (userSheet && userSheet.getLastRow() > 1) {
      var userRows = userSheet.getRange(2, 1, userSheet.getLastRow() - 1, 6).getValues();
      for (var u = 0; u < userRows.length; u++) {
        teacherNames[String(userRows[u][0] || '').trim()] = userRows[u][3] || userRows[u][1] || '';
      }
    }
    var subjectNames = {};
    var subjectSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    if (subjectSheet && subjectSheet.getLastRow() > 1) {
      var subjectRows = subjectSheet.getRange(2, 1, subjectSheet.getLastRow() - 1, 2).getValues();
      for (var s = 0; s < subjectRows.length; s++) {
        subjectNames[normalizeSubjectCode(subjectRows[s][0])] = subjectRows[s][1] || '';
      }
    }
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var rowTerm = normalizeTermIdStrict_(rows[i][4]);
      if (!isValidTermId_(rowTerm)) continue;
      if (rowTerm !== term) continue;
      var teacherId = String(rows[i][0] || '').trim();
      var subjectCode = normalizeSubjectCode(rows[i][1]);
      result.push({
        teacherId: teacherId,
        teacherName: teacherNames[teacherId] || teacherId,
        subjectCode: subjectCode,
        subjectName: subjectNames[subjectCode] || subjectCode,
        level: String(rows[i][2] || '').trim(),
        room: String(rows[i][3] || '').trim(),
        term: rowTerm,
        status: rows[i][5] || 'Active'
      });
    }
    var response = { success: true, data: result, term: term };
    cache.put(cacheKey, JSON.stringify(response), 300);
    return response;
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  }
}

function getAdminSettingsBootstrap(payload) {
  var started = Date.now();
  var term = '';
  var uid = '';
  try {
    payload = payload || {};
    var effectiveUser = getEffectiveUser_(payload.user || payload.admin || payload.token);
    var role = String(effectiveUser.role || '').toLowerCase();
    var isAdmin = role === 'admin' || String(effectiveUser.id || '').trim() === 'ADMIN_MASTER';
    term = normalizeTermFast_(payload.term, '') || normalizeTermFast_(getCurrentTerm(), '');
    uid = String(effectiveUser.id || (isAdmin ? 'admin' : 'anonymous')).trim() || 'anonymous';
    Logger.log('ADMIN_BOOTSTRAP START term=' + term + ' user=' + uid);
    var cacheKey = 'ADMIN_SETTINGS_BOOTSTRAP_V2_' + term + '_' + uid;
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      var cachedResponse = JSON.parse(cached);
      cachedResponse.meta = cachedResponse.meta || {};
      cachedResponse.meta.cached = true;
      return cachedResponse;
    }

    var ss = getDb();
    var sheets = {};
    ss.getSheets().forEach(function(sheet) {
      sheets[sheet.getName()] = sheet;
    });
    var readRows = function(name) {
      var sheet = sheets[name];
      if (!sheet || sheet.getLastRow() < 2) return [];
      return sheet.getDataRange().getDisplayValues().slice(1);
    };

    var rawUsers = readRows(CONFIG.SHEET_NAMES.USERS);
    var rawTerms = readRows(CONFIG.SHEET_NAMES.TERMS);
    var rawTeacherClasses = readRows(CONFIG.SHEET_NAMES.TEACHER_CLASSES);
    var rawSubjects = readRows(CONFIG.SHEET_NAMES.SUBJECTS);
    var rawStudents = readRows(CONFIG.SHEET_NAMES.STUDENTS);
    var rawSettings = readRows(CONFIG.SHEET_NAMES.SYSTEM_SETTINGS);
    var rawConfig = readRows(CONFIG.SHEET_NAMES.CONFIG);

    var settingsMap = {};
    rawSettings.forEach(function(r) {
      var key = String(r[0] || '').trim();
      if (!key) return;
      settingsMap[key] = r[1] || '';
    });
    var configMap = {};
    rawConfig.forEach(function(r) {
      var key = String(r[0] || '').trim();
      if (key) configMap[key] = r[1] || '';
    });
    var activeTerm = normalizeTermFast_(settingsMap.active_term, '') || normalizeTermFast_(configMap.CURRENT_TERM, '') || term;

    var users = [];
    var teacherNames = {};
    var hasAdmin = false;
    rawUsers.forEach(function(r) {
      var id = String(r[0] || '').trim();
      if (!id) return;
      teacherNames[id] = r[3] || r[1] || id;
      if (String(r[4] || '').toLowerCase() === 'admin' || id === 'ADMIN_MASTER') hasAdmin = true;
      var item = { id: id, username: r[1], name: r[3], role: r[4], status: r[5], imageUrl: r[6], prefix: r[7], lastName: r[8], position: r[9], school: r[10], group: r[11] };
      if (isAdmin) {
        users.push(item);
      } else if (id === String(effectiveUser.id || '').trim()) {
        users.push(item);
      }
    });
    if (isAdmin && !hasAdmin) {
      users.unshift({ id: 'ADMIN_MASTER', username: 'admin', name: 'ผู้ดูแลระบบ', role: 'admin', status: 'Active', imageUrl: '', prefix: '', lastName: '', position: '', school: '', group: '' });
      teacherNames.ADMIN_MASTER = 'ผู้ดูแลระบบ';
    }

    var terms = [];
    var termMap = {};
    rawTerms.forEach(function(r, idx) {
      var normalized = normalizeTermFast_(r[0], '');
      if (!isValidTermId_(normalized)) return;
      var item = {
        row: idx + 2,
        termId: normalized,
        academicYear: String(r[1] || '').trim() || normalized.split('/')[1],
        termNo: String(r[2] || '').trim() || normalized.split('/')[0],
        status: String(r[3] || '').trim() || 'Inactive',
        spreadsheetId: r[4],
        folderId: r[5],
        createdAt: r[6],
        createdBy: r[7]
      };
      if (!termMap[normalized]) {
        termMap[normalized] = item;
        terms.push(item);
      }
    });
    if (!termMap[activeTerm] && isValidTermId_(activeTerm)) {
      terms.push({ termId: activeTerm, academicYear: activeTerm.split('/')[1], termNo: activeTerm.split('/')[0], status: 'Active', spreadsheetId: ss.getId(), folderId: settingsMap.system_folder_id || configMap.EXPORT_FOLDER_ID || CONFIG.FOLDER_ID || '', createdAt: '', createdBy: 'system' });
    }

    var subjectMap = {};
    var subjects = [];
    var subjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    if (subjSheet && subjSheet.getLastRow() > 0) {
      var subjData = subjSheet.getDataRange().getDisplayValues();
      var subjHeaders = subjData[0].map(function(h) { return String(h).trim(); });
      var subjRows = subjData.slice(1);
      
      // [SUBJECTS-FIX] header-based index lookup (รองรับ layout ทุกแบบ)
      var idxCode   = subjHeaders.indexOf('SubjectCode');   if (idxCode   < 0) idxCode   = 0;
      var idxName   = subjHeaders.indexOf('SubjectName');   if (idxName   < 0) idxName   = 1;
      var idxTerm   = subjHeaders.indexOf('Term');          // -1 ถ้าไม่มี
      var idxStatus = subjHeaders.indexOf('Status');        // -1 ถ้าไม่มี
      var idxTeacher= subjHeaders.indexOf('Teacher');       // optional
      var idxClasses= subjHeaders.indexOf('Classes');       // optional
      
      subjRows.forEach(function(r) {
        var code = normalizeSubjectCode(r[idxCode]);
        if (!code) return;
        
        var rowTerm = idxTerm > -1 ? normalizeTermFast_(r[idxTerm], '') : '';
        // [SUBJECTS-FIX] filter ตาม term ที่ขอ (term empty = ไม่กรอง)
        if (term && rowTerm && rowTerm !== term) return;
        
        // [SUBJECTS-FIX] dedup ด้วย code+term เพื่อรองรับวิชาเดียวข้ามเทอม
        var dedupKey = code + '|' + rowTerm;
        if (subjectMap[dedupKey]) return;
        
        var status = idxStatus > -1 ? (String(r[idxStatus] || 'Active')) : 'Active';
        var name   = String(r[idxName] || '');
        
        var item = { 
          code: code,
          name: name,
          term: rowTerm,
          status: status,
          teacher: idxTeacher > -1 ? String(r[idxTeacher] || '') : '',
          classes: idxClasses > -1 ? String(r[idxClasses] || '') : '',
          displayLabel: code + ' ' + name
        };
        subjectMap[dedupKey] = item;
        subjects.push(item);
      });
    }

    var levels = {};
    var rooms = {};
    rawStudents.forEach(function(r) {
      if (!rowTermMatchesFast_(r[10], term)) return;
      if (r[4]) levels[String(r[4])] = true;
      if (r[5]) rooms[String(r[5])] = true;
    });

    var teacherClasses = [];
    rawTeacherClasses.forEach(function(r) {
      var rowTerm = normalizeTermFast_(r[4], '');
      if (!isValidTermId_(rowTerm) || rowTerm !== term) return;
      var teacherId = String(r[0] || '').trim();
      if (!isAdmin && teacherId !== String(effectiveUser.id || '').trim()) return;
      var subjectCode = normalizeSubjectCode(r[1]);
      if (r[2]) levels[String(r[2])] = true;
      if (r[3]) rooms[String(r[3])] = true;
      teacherClasses.push({
        teacherId: teacherId,
        teacherName: teacherNames[teacherId] || teacherId,
        subjectCode: subjectCode,
        subjectName: subjectMap[subjectCode] ? subjectMap[subjectCode].name : subjectCode,
        level: String(r[2] || '').trim(),
        room: String(r[3] || '').trim(),
        term: rowTerm,
        status: r[5] || 'Active'
      });
    });
    rawTeacherClasses.forEach(function(r) {
      if (r[2]) levels[String(r[2])] = true;
      if (r[3]) rooms[String(r[3])] = true;
    });
    if (!isAdmin) {
      var allowedSubjects = {};
      var allowedLevels = {};
      var allowedRooms = {};
      teacherClasses.forEach(function(tc) {
        if (tc.subjectCode) allowedSubjects[normalizeSubjectCode(tc.subjectCode)] = true;
        if (tc.level) allowedLevels[String(tc.level)] = true;
        if (tc.room) allowedRooms[String(tc.room)] = true;
      });
      subjects = subjects.filter(function(s) {
        return allowedSubjects[normalizeSubjectCode(s.code)];
      });
      levels = allowedLevels;
      rooms = allowedRooms;
    }

    var response = {
      success: true,
      term: term,
      users: users,
      terms: isAdmin ? terms : [],
      activeTerm: activeTerm,
      teacherClasses: teacherClasses,
      // [SUBJECTS-FIX] ส่ง subjects ที่ field ตรงๆ เพื่อให้ frontend อ่านได้จาก res.subjects
      subjects: subjects,
      dropdowns: {
        levels: Object.keys(levels).sort(),
        rooms: Object.keys(rooms).sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10) || String(a).localeCompare(String(b)); }),
        subjects: subjects  // backward compat: ยังส่งใน dropdowns ด้วย
      },
      settings: isAdmin ? {
        system_folder_id: settingsMap.system_folder_id || configMap.EXPORT_FOLDER_ID || CONFIG.FOLDER_ID || '',
        grading_system_url: settingsMap.grading_system_url || '',
        active_term: activeTerm
      } : {},
      meta: {
        cached: false,
        ts: Date.now(),
        counts: { users: users.length, terms: terms.length, teacherClasses: teacherClasses.length, subjects: subjects.length, levels: Object.keys(levels).length, rooms: Object.keys(rooms).length }
      }
    };
    _safeCachePut_(cache, cacheKey, response);
    Logger.log('ADMIN_BOOTSTRAP END users=' + users.length + ' terms=' + terms.length + ' classes=' + teacherClasses.length + ' subjects=' + subjects.length + ' ms=' + (Date.now() - started));
    return response;
  } catch (e) {
    Logger.log('ADMIN_BOOTSTRAP ERROR term=' + term + ' user=' + uid + ' err=' + String(e));
    return { success: false, message: e.message || e.toString(), users: [], terms: [], teacherClasses: [], dropdowns: { levels: [], rooms: [], subjects: [] }, settings: {}, meta: { cached: false, ts: Date.now(), counts: { users: 0, terms: 0, teacherClasses: 0, subjects: 0, levels: 0, rooms: 0 } } };
  }
}

function ensureDefaultAdminUser(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.USERS, CONFIG.HEADERS.USERS);
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), CONFIG.HEADERS.USERS.length)).getDisplayValues() : [];
    var hasAdmin = false;
    for (var i = 0; i < rows.length; i++) {
      var id = String(rows[i][0] || '').trim();
      var username = String(rows[i][1] || '').trim().toLowerCase();
      var role = String(rows[i][4] || '').trim().toLowerCase();
      if (role === 'admin' || id === 'ADMIN_MASTER' || username === 'admin') {
        hasAdmin = true;
        break;
      }
    }
    if (!hasAdmin) {
      sheet.appendRow(['ADMIN_MASTER', 'admin', '1234', 'ผู้ดูแลระบบ', 'admin', 'Active', '', '', '', '', '', '']);
    }
    var term = normalizeTermFast_(payload.term, '') || normalizeTermFast_(getCurrentTerm(), '');
    _clearAdminSettingsCache(term, admin);
    return getAdminSettingsBootstrap({ term: term, user: admin });
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function ensureDefaultTerm(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var term = normalizeTermFast_(payload.term || payload.termId, '') || normalizeTermFast_(getCurrentTerm(), '');
    if (!isValidTermId_(term)) throw new Error('Invalid term');
    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TERMS, CONFIG.HEADERS.TERMS);
    var exists = false;
    if (sheet.getLastRow() > 1) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getDisplayValues();
      for (var i = 0; i < rows.length; i++) {
        if (normalizeTermFast_(rows[i][0], '') === term) {
          exists = true;
          break;
        }
      }
    }
    if (!exists) {
      sheet.appendRow([term, term.split('/')[1], term.split('/')[0], 'Active', ss.getId(), getSystemSetting_('system_folder_id', CONFIG.FOLDER_ID || ''), new Date(), admin.id || 'ADMIN_MASTER']);
    }
    setSystemSetting_('active_term', term);
    syncLegacyCurrentTerm_(term);
    invalidateTermsListCache_();
    invalidateTermCaches_(term);
    _clearAdminSettingsCache(term, admin);
    return getAdminSettingsBootstrap({ term: term, user: admin });
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function saveTeacherClass(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var term = normalizeTermIdForFrontend_(payload.term || payload.termId);
    guardTermWritable_(term);
    var teacherId = String(payload.teacherId || payload.TeacherID || '').trim();
    var subjectCode = normalizeSubjectCode(payload.subjectCode || payload.SubjectCode);
    var level = String(payload.level || payload.Level || '').trim();
    var status = payload.status || payload.Status || 'Active';
    var roomInputs = payload.rooms && payload.rooms.length ? payload.rooms : [payload.room || payload.Room];
    var rooms = [];
    var seenRooms = {};
    for (var r = 0; r < roomInputs.length; r++) {
      var roomVal = String(roomInputs[r] || '').trim();
      if (roomVal && !seenRooms[roomVal]) {
        rooms.push(roomVal);
        seenRooms[roomVal] = true;
      }
    }
    if (!teacherId || !subjectCode || !level || rooms.length === 0 || !term) throw new Error('Teacher, subject, level, room and term are required');

    var sheet = ensureSheet_(getDb(), CONFIG.SHEET_NAMES.TEACHER_CLASSES, CONFIG.HEADERS.TEACHER_CLASSES);
    sheet.getRange(2, 5, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    var data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
    var existingMap = {};
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === teacherId &&
          normalizeSubjectCode(data[i][1]) === subjectCode &&
          String(data[i][2] || '').trim() === level &&
          rowTermMatches_(data[i][4], term)) {
        existingMap[String(data[i][3] || '').trim()] = i + 2;
      }
    }
    var newRows = [];
    var inserted = 0;
    var updated = 0;
    var skipped = 0;
    for (var x = 0; x < rooms.length; x++) {
      var room = rooms[x];
      var rowData = [teacherId, subjectCode, level, room, term, status];
      if (existingMap[room]) {
        sheet.getRange(existingMap[room], 1, 1, 6).setValues([rowData]);
        updated++;
      } else {
        newRows.push(rowData);
        inserted++;
      }
    }
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 6).setValues(newRows);
    }
    invalidateTermCaches_(term);
    invalidateTeacherClassesCache_(term);
    _clearAdminSettingsCache(term, admin);
    logAudit_(admin.id, 'SAVE_TEACHER_CLASS', teacherId, JSON.stringify({ subjectCode: subjectCode, level: level, rooms: rooms, status: status, inserted: inserted, updated: updated, skipped: skipped }), term);
    return { success: true, inserted: inserted, updated: updated, skipped: skipped, term: term, rooms: rooms, data: getTeacherClasses(term).data };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteTeacherClass(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var term = normalizeTermIdForFrontend_(payload.term || payload.termId);
    var items = payload.items && payload.items.length ? payload.items : [payload];
    var deleteMap = {};
    for (var p = 0; p < items.length; p++) {
      var item = items[p] || {};
      var teacherId = String(item.teacherId || item.TeacherID || '').trim();
      var subjectCode = normalizeSubjectCode(item.subjectCode || item.SubjectCode);
      var level = String(item.level || item.Level || '').trim();
      var room = String(item.room || item.Room || '').trim();
      var itemTerm = normalizeTermIdForFrontend_(item.term || item.termId || term);
      if (teacherId && subjectCode && level && room && itemTerm) {
        deleteMap[teacherId + '|' + subjectCode + '|' + level + '|' + room + '|' + itemTerm] = true;
      }
    }
    var sheet = ensureSheet_(getDb(), CONFIG.SHEET_NAMES.TEACHER_CLASSES, CONFIG.HEADERS.TEACHER_CLASSES);
    var data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];
    var deleted = 0;
    for (var i = data.length - 1; i >= 0; i--) {
      var rowTerm = normalizeTermIdStrict_(data[i][4]);
      if (!isValidTermId_(rowTerm)) continue;
      var key = String(data[i][0]).trim() + '|' + normalizeSubjectCode(data[i][1]) + '|' + String(data[i][2] || '').trim() + '|' + String(data[i][3] || '').trim() + '|' + rowTerm;
      if (deleteMap[key]) {
        sheet.deleteRow(i + 2);
        deleted++;
      }
    }
    invalidateTermCaches_(term);
    invalidateTeacherClassesCache_(term);
    _clearAdminSettingsCache(term, admin);
    logAudit_(admin.id, 'DELETE_TEACHER_CLASS', 'TeacherClasses', JSON.stringify({ deleted: deleted, requested: items.length }), term);
    return { success: true, deleted: deleted, term: term, data: getTeacherClasses(term).data };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getGradingIntegrationPayload(userOpt, termOpt) {
  try {
    var user = getEffectiveUser_(userOpt);
    var term = sanitizeTerm_(termOpt || getCurrentTerm());
    return {
      success: true,
      data: {
        url: getSystemSetting_('grading_system_url', ''),
        uid: user.id || '',
        name: user.name || '',
        role: user.role || '',
        term: term
      }
    };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  }
}

function getWebAppUrl() {
  try {
    return { success: true, url: ScriptApp.getService().getUrl() };
  } catch (e) {
    return { success: false, message: e.message || String(e), url: '' };
  }
}

var _SCHEMA_ENSURED = false;

function ensureSchemaAndHeaders() {
  if (_SCHEMA_ENSURED) return;
  try {
    var cached = CacheService.getScriptCache().get('SCHEMA_OK');
    if (cached === '1') { _SCHEMA_ENSURED = true; return; }
  } catch(e) {}
  _SCHEMA_ENSURED = true;

  var ss = ensureCoreSheets_();
  Object.keys(CONFIG.SHEET_NAMES).forEach(key => {
    var sheetName = CONFIG.SHEET_NAMES[key];
    var requiredHeaders = CONFIG.HEADERS[key];

    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    var currentHeaders = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];

    if (requiredHeaders && currentHeaders.length === 0) {
        sheet.appendRow(requiredHeaders);
        sheet.getRange(1, 1, 1, requiredHeaders.length).setFontWeight('bold').setBackground('#e2e8f0');
        sheet.setFrozenRows(1);
    }
  });

  const sConfig = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
  if (sConfig.getLastRow() < 2) {
     sConfig.appendRow(['CURRENT_TERM', '1/2569']);
     sConfig.appendRow(['ADMIN_PASSWORD', '1234']);
  }

  const sUsers = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
  if (sUsers && sUsers.getLastRow() < 2) {
     sUsers.appendRow(['U001', 'admin', '1234', 'ผู้ดูแลระบบ', 'admin', 'Active', '', 'นาย', 'คุมระบบ', 'ผู้ดูแลระบบ', 'โรงเรียนวัดไร่ขิงวิทยา', '']);
     sUsers.appendRow(['T001', 'teacher', '1234', 'ครูทดสอบ ระบบใหม่', 'teacher', 'Active', '', 'นาย', 'สอนดี', 'ครูผู้สอน', 'โรงเรียนวัดไร่ขิงวิทยา', '']);
  }

  var activeTerm = getCurrentTerm();
  setSystemSetting_('active_term', activeTerm);
  var termsSheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.TERMS, CONFIG.HEADERS.TERMS);
  if (!getTermRow_(activeTerm)) {
    var parts = String(activeTerm).split('/');
    termsSheet.appendRow([activeTerm, parts[1] || '', parts[0] || '', 'Active', ss.getId(), CONFIG.FOLDER_ID || '', new Date(), 'system']);
  }
  try { CacheService.getScriptCache().put('SCHEMA_OK', '1', 600); } catch(e) {}
}

// --- AUTH SYSTEM ---

function loginSystem(username, password) {
  ensureSchemaAndHeaders();
  var ss = getDb();
  
  var configSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
  var configData = configSheet ? configSheet.getDataRange().getValues() : [];
  var adminPass = '1234';
  for (var c = 0; c < configData.length; c++) {
    if (configData[c][0] === 'ADMIN_PASSWORD') {
      adminPass = configData[c][1] || '1234';
      break;
    }
  }
  
  if (String(username).toLowerCase() === 'admin' && String(password) === String(adminPass)) {
     var userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
     var userDetails = { role: 'admin', name: 'ผู้ดูแลระบบ', id: 'ADMIN_MASTER', imageUrl: '' };
     if(userSheet && userSheet.getLastRow() > 1) {
       var userRows = userSheet.getDataRange().getValues();
       var found = null;
       for (var u = 0; u < userRows.length; u++) {
         if (String(userRows[u][1]).toLowerCase() === 'admin') {
           found = userRows[u];
           break;
         }
       }
       if(found) { 
         userDetails.name = found[3]; 
         userDetails.imageUrl = found[6];
       }
     }
     return { success: true, user: userDetails };
  }

  var userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
  if (userSheet && userSheet.getLastRow() > 1) {
    var users = userSheet.getDataRange().getValues().slice(1);
    var foundUser = null;
    for (var i = 0; i < users.length; i++) {
      if (String(users[i][1]) === String(username) && String(users[i][2]) === String(password) && users[i][5] === 'Active') {
        foundUser = users[i];
        break;
      }
    }
    if (foundUser) {
        return { 
          success: true, 
          user: { 
            role: foundUser[4] || 'teacher', 
            name: foundUser[3], 
            id: String(foundUser[0]), 
            imageUrl: foundUser[6] || ''
          } 
        };
    }
  }

  var isStudentPassword = (String(password) === ('wrk' + username)) || (String(password) === String(username));
  if (isStudentPassword) {
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if(sheet && sheet.getLastRow() > 1) {
      var data = sheet.getDataRange().getValues();
      var activeTerm = getActiveTerm_();
      var student = null;
      for (var s = 1; s < data.length; s++) {
        if (String(data[s][0]) === String(username) && rowTermMatches_(data[s][10], activeTerm)) {
          student = data[s];
          break;
        }
      }
      if (!student) {
        for (var s2 = 1; s2 < data.length; s2++) {
          if (String(data[s2][0]) === String(username)) {
            student = data[s2];
            break;
          }
        }
      }
      if (student) {
        var loginTerm = rowTermMatches_(student[10], activeTerm) ? activeTerm : sanitizeTerm_(student[10]);
        var resolved = getAttendanceAssistantScopeResolved_(String(student[0]), loginTerm);
        var assistantScope = resolved.scope || [];
        var assistantEnabled = String(password) === String(username) && assistantScope.length > 0;
        if (assistantEnabled && resolved.term) loginTerm = sanitizeTerm_(resolved.term);
        return { 
          success: true, 
          user: { 
            role: assistantEnabled ? 'attendance_assistant' : 'student', 
            id: String(student[0]), 
            name: `${student[1]}${student[2]} ${student[3]}`, 
	            level: student[4], 
	            room: student[5], 
	            term: loginTerm,
	            imageUrl: student[8] || '', 
	            icon: normalizeIcon_(student[9], student[1]),
              assistantScope: assistantScope
          } 
        };
      }
    }
  }
  return { success: false, message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' };
}

function getCurrentUserProfile(id) {
  try {
    const ss = getDb();
    const userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const studentSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    const targetId = String(id).trim();

    if (userSheet && userSheet.getLastRow() > 1) {
      const data = userSheet.getDataRange().getValues();
      const user = data.slice(1).find(r => String(r[0]).trim() === targetId);
      if (user) {
        return {
          success: true,
          data: {
            id: String(user[0]), username: user[1], name: user[3], role: user[4],
            imageUrl: user[6], prefix: user[7], lastName: user[8],
            position: user[9], school: user[10], group: user[11]
          }
        };
      }
    }
    
    if (studentSheet && studentSheet.getLastRow() > 1) {
      const data = studentSheet.getDataRange().getValues();
      const activeTerm = getActiveTerm_();
      let st = null;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === targetId && rowTermMatches_(data[i][10], activeTerm)) {
          st = data[i];
          break;
        }
      }
      if (st) {
        const imageUrl = st[8] || '';
        const name = `${st[1]}${st[2]} ${st[3]}`;
        const loginTerm = rowTermMatches_(st[10], activeTerm) ? activeTerm : sanitizeTerm_(st[10]);
        const resolved = getAttendanceAssistantScopeResolved_(String(st[0]), loginTerm);
        const assistantScope = resolved.scope || [];
        var effectiveTerm = resolved.term ? sanitizeTerm_(resolved.term) : loginTerm;
        return {
          success: true,
          data: {
            id: String(st[0]), role: assistantScope.length > 0 ? 'attendance_assistant' : 'student', name: name, prefix: st[1],
            first: st[2], last: st[3], level: st[4], room: st[5],
            term: effectiveTerm, imageUrl: imageUrl, assistantScope: assistantScope
          }
        };
      }
    }
    return { success: false, message: "User not found" };
  } catch (e) { return { success: false, message: e.toString() }; }
}

// --- USER MANAGEMENT (DIRECT CRUD) ---

function getUsers() {
  try {
    const ss = getDb();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    let result = [];
    
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getRange(2, 1, sheet.getLastRow()-1, 12).getValues();
      result = data.map(u => ({
        id: String(u[0]), // Ensure ID is string
        username: u[1], 
        name: u[3], 
        role: u[4], 
        status: u[5], 
        imageUrl: u[6]
      }));
    }
    // Debug log just in case
    console.log("Found " + result.length + " users.");
    return { success: true, data: result };
  } catch (e) { 
    console.error("getUsers Error: " + e.toString());
    return { success: false, message: e.toString() }; 
  }
}

function saveUser(user) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    user = user || {};
    requireAdmin_(user.user || user.admin || user.token);
    const ss = getDb();
    ensureSchemaAndHeaders(); 
    let sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    
    if (!user.id || !String(user.id).trim()) {
      user.id = 'USR-' + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss");
    }
    
    const targetId = String(user.id).trim();
    const lastRow = sheet.getLastRow();
    let data = [];
    if (lastRow > 1) { data = sheet.getRange(2, 1, lastRow-1, 12).getValues(); }
    
    let rowIndex = -1;
    for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === targetId) { rowIndex = i + 2; break; }
    }
    
    let currentImg = '', pBx='', pLn='', pPos='', pSch='', pGrp='';
    let finalPassword = user.password;
    let finalStatus = user.status || 'Active';

    if(rowIndex > -1) { 
      const r = data[rowIndex-2]; 
      if (!user.password || String(user.password).trim() === '') finalPassword = r[2];
      currentImg = r[6]; pBx = r[7]; pLn = r[8]; pPos = r[9]; pSch = r[10]; pGrp = r[11];
      if (!user.status) finalStatus = r[5];
    }
    
    const rowData = [targetId, user.username, finalPassword, user.name, user.role, finalStatus, currentImg, pBx, pLn, pPos, pSch, pGrp];
    
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, 12).setValues([rowData]);
    else sheet.appendRow(rowData);
    var currentTerm = getCurrentTerm();
    invalidateTermCaches_(currentTerm);
    _clearAdminSettingsCache(currentTerm, user.user || user.admin || user.token || 'admin');

    return { success: true, id: targetId };
  } catch (e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function deleteUser(id) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        const payload = (id && typeof id === 'object') ? id : { id: id };
        requireAdmin_(payload.user || payload.admin || payload.token);
        const ss = getDb();
        const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
        const data = sheet.getDataRange().getValues();
        const targetId = String(payload.id).trim();
        
        for (let i = 1; i < data.length; i++) {
            if (String(data[i][0]).trim() === targetId) {
              sheet.deleteRow(i + 1);
              var currentTerm = getCurrentTerm();
              invalidateTermCaches_(currentTerm);
              _clearAdminSettingsCache(currentTerm, payload.user || payload.admin || payload.token || 'admin');
              return { success: true };
            }
        }
        return { success: false, message: "User not found" };
    } catch (e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

// --- SUBJECT MANAGEMENT ---

function getSubjectsList(payload) {
  try {
    var payload = payload || {};
    var term = normalizeTermFast_(payload.term, '') || getCurrentTerm();
    var ss = getDb();
    ensureSubjectsSheetSchema_(ss);
    
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, data: [] };
    
    var data = sheet.getDataRange().getDisplayValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var rows = data.slice(1);
    
    var idxCode = headers.indexOf('SubjectCode');   if (idxCode < 0) idxCode = 0;
    var idxName = headers.indexOf('SubjectName');   if (idxName < 0) idxName = 1;
    var idxTerm = headers.indexOf('Term');
    var idxStatus = headers.indexOf('Status');

    var result = [];
    rows.forEach(function(r) {
      var rowTerm = idxTerm > -1 ? normalizeTermFast_(r[idxTerm], '') : '';
      if (term && rowTerm && rowTerm !== term) return;

      var code = normalizeSubjectCode(r[idxCode]);
      if (!code) return;
      var name = r[idxName] || '';
      var status = idxStatus > -1 ? (r[idxStatus] || 'Active') : 'Active';
      
      result.push({
        code: code,
        name: name,
        term: rowTerm,
        status: status,
        displayLabel: code + ' ' + name
      });
    });
    
    return { success: true, data: result, term: term };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function saveSubject(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var ss = getDb();
    ensureSubjectsSheetSchema_(ss);
    
    var code = normalizeSubjectCode(payload.code || payload.SubjectCode);
    var name = String(payload.name || payload.SubjectName || '').trim();
    var term = normalizeTermFast_(payload.term, '');
    var status = payload.status || 'Active';
    
    if (!code || !name || !term) throw new Error('กรุณากรอกรหัสวิชา ชื่อวิชา และเทอมให้ครบถ้วน');
    
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    var data = sheet.getDataRange().getDisplayValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    
    var idxCode = headers.indexOf('SubjectCode');
    var idxTerm = headers.indexOf('Term');
    if (idxCode < 0) idxCode = 0;
    if (idxTerm < 0) idxTerm = 2;

    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (normalizeSubjectCode(data[i][idxCode]) === code && normalizeTermFast_(data[i][idxTerm], '') === term) {
        foundRow = i + 1;
        break;
      }
    }
    
    var now = new Date();
    var rowData = [];
    headers.forEach(function(h) {
      switch(h) {
        case 'SubjectCode': rowData.push(code); break;
        case 'SubjectName': rowData.push(name); break;
        case 'Term': rowData.push(term); break;
        case 'Status': rowData.push(status); break;
        case 'CreatedAt': rowData.push(foundRow > -1 ? data[foundRow-1][headers.indexOf('CreatedAt')] : now); break;
        case 'UpdatedAt': rowData.push(now); break;
        default: rowData.push(foundRow > -1 ? data[foundRow-1][headers.indexOf(h)] : '');
      }
    });
    
    if (foundRow > -1) {
      sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    invalidateTermCaches_(term);
    _clearAdminSettingsCache(term);
    return { success: true, message: 'บันทึกรายวิชาสำเร็จ' };
  } catch (e) {
    return { success: false, message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteSubject(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var ss = getDb();
    var code = normalizeSubjectCode(payload.code);
    var term = normalizeTermFast_(payload.term, '');
    
    if (!code || !term) throw new Error('Missing Code or Term');
    
    var tcSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_CLASSES);
    if (tcSheet && tcSheet.getLastRow() > 1) {
      var tcRows = tcSheet.getRange(2, 2, tcSheet.getLastRow()-1, 4).getDisplayValues();
      for (var i = 0; i < tcRows.length; i++) {
        if (normalizeSubjectCode(tcRows[i][0]) === code && normalizeTermFast_(tcRows[i][3], '') === term) {
          throw new Error('รายวิชานี้มีการใช้งานอยู่ในการจับคู่ครู-ห้องเรียน ไม่สามารถลบได้ (แนะนำให้เปลี่ยนสถานะเป็น Inactive)');
        }
      }
    }
    
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    var data = sheet.getDataRange().getDisplayValues();
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var idxCode = headers.indexOf('SubjectCode');
    var idxTerm = headers.indexOf('Term');
    var idxStatus = headers.indexOf('Status');
    
    for (var j = 1; j < data.length; j++) {
      if (normalizeSubjectCode(data[j][idxCode]) === code && normalizeTermFast_(data[j][idxTerm], '') === term) {
        if (idxStatus > -1) {
          sheet.getRange(j + 1, idxStatus + 1).setValue('Inactive');
          invalidateTermCaches_(term);
          _clearAdminSettingsCache(term);
          return { success: true, message: 'เปลี่ยนสถานะเป็น Inactive สำเร็จ' };
        } else {
          sheet.deleteRow(j + 1);
          invalidateTermCaches_(term);
          _clearAdminSettingsCache(term);
          return { success: true, message: 'ลบรายวิชาสำเร็จ' };
        }
      }
    }
    throw new Error('ไม่พบรายวิชาที่ต้องการลบ');
  } catch (e) {
    return { success: false, message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function ensureSubjectsSheetSchema_(ss) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAMES.SUBJECTS);
    sheet.appendRow(CONFIG.HEADERS.SUBJECTS);
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.SUBJECTS.length).setFontWeight('bold').setBackground('#e2e8f0');
    sheet.setFrozenRows(1);
    return;
  }
  
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
  var required = CONFIG.HEADERS.SUBJECTS;
  var missing = [];
  required.forEach(function(h) {
    if (headers.indexOf(h) === -1) missing.push(h);
  });
  
  if (missing.length > 0) {
    var lastCol = sheet.getLastColumn();
    sheet.insertColumnsAfter(lastCol, missing.length);
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e2e8f0');
  }
}

function uploadFileToDrive(base64Data, filename) {
  try {
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    const decoded = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decoded, MimeType.JPEG, filename);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1000";
  } catch (e) { throw new Error("Upload failed: " + e.message); }
}

function saveUserProfile(data, imageBase64) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    data = data || {};
    const targetId = String(data.id || '').trim();
    const authUser = getEffectiveUser_(data.authUser);
    const authRole = String(authUser.role || '').toLowerCase();
    if (!targetId || !authUser.id || (authRole !== 'admin' && String(authUser.id) !== targetId)) {
      return { success: false, message: 'Access denied' };
    }
    const ss = getDb();
    let imageUrl = null;
    if (imageBase64 && String(imageBase64).trim() !== '') { 
      imageUrl = uploadFileToDrive(imageBase64, `Profile_${data.id}_${Date.now()}.jpg`); 
    }
    
    const userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
    const usersData = userSheet.getDataRange().getValues();
    let userFound = false;
    let isAdminMaster = (data.id === 'ADMIN_MASTER');
    // targetId was validated above against the authenticated user.
    
    for(let i=1; i<usersData.length; i++) {
      let isMatch = false;
      if (String(usersData[i][0]).trim() === targetId) isMatch = true;
      else if (isAdminMaster && String(usersData[i][0]).trim() === 'ADMIN_MASTER') isMatch = true;
      else if (isAdminMaster && !userFound && String(usersData[i][1]).toLowerCase() === 'admin' && String(usersData[i][4] || '').toLowerCase() === 'admin') isMatch = true;
      
      if(isMatch) {
        if(imageUrl) userSheet.getRange(i+1, 7).setValue(imageUrl); 
        if(data.name) userSheet.getRange(i+1, 4).setValue(data.name);
        if(data.prefix) userSheet.getRange(i+1, 8).setValue(data.prefix);
        if(data.lastName) userSheet.getRange(i+1, 9).setValue(data.lastName);
        if(data.position) userSheet.getRange(i+1, 10).setValue(data.position);
        if(data.school) userSheet.getRange(i+1, 11).setValue(data.school);
        if(data.group) userSheet.getRange(i+1, 12).setValue(data.group);
        if(data.password) userSheet.getRange(i+1, 3).setValue(data.password);
        userFound = true; break;
      }
    }
    
    if (isAdminMaster && !userFound) {
         userSheet.appendRow(['ADMIN001', 'admin', '1234', 'Admin', 'admin', 'Active', imageUrl || '', '', '', '', '', '']); 
         userFound = true;
    }
    
    if (!userFound) {
      const studSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
      if (studSheet && studSheet.getLastRow() > 1) {
        const studData = studSheet.getDataRange().getValues();
        for(let j=1; j<studData.length; j++) {
          if (String(studData[j][0]).trim() === targetId) {
            if(imageUrl) studSheet.getRange(j+1, 9).setValue(imageUrl);
            userFound = true; break;
          }
        }
      }
    }
    
    if (!userFound) return { success: false, message: "User ID not found in system." };
    return { success: true, imageUrl: imageUrl };
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

// --- STUDENT MANAGEMENT (DIRECT) ---

function getStudentsByFilter(filter) {
  try {
    const ss = getDb();
    const sSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    let filteredData = [];
    let rowCountBeforeFilter = 0;
    let rowCountAfterTerm = 0;
    
    const term = resolveTerm_(filter && filter.term);
    const user = filter && filter.user ? filter.user : null;
    const effectiveUser = getEffectiveUser_(user);
    const subject = filter && (filter.subject || filter.subjectCode) ? normalizeSubjectCode(filter.subject || filter.subjectCode) : '';
    const level = filter.level ? String(filter.level).trim() : "";
    const room = filter.room ? String(filter.room).trim() : "";
    const search = filter.q ? String(filter.q).toLowerCase().trim() : "";
    var scopeMissing = teacherScopeMissing_(user, term);
    if (!canAccessClass_(user, subject, level, room, term)) {
      return { success: false, message: scopeMissing ? 'Teacher scope missing' : 'Access denied', teacherScopeMissing: scopeMissing };
    }
    var studentScope = (String(effectiveUser.role || '').toLowerCase() === 'teacher' || String(effectiveUser.role || '').toLowerCase() === 'attendance_assistant')
      ? _readTeacherClassScopeLite_(ss, term, user, 1500)
      : { role: String(effectiveUser.role || '').toLowerCase(), hasRows: false, skipScope: true, subjects: {}, levels: {}, rooms: {}, combos: {} };
    
    if (sSheet && sSheet.getLastRow() > 1) {
      const sData = sSheet.getRange(2, 1, sSheet.getLastRow()-1, 11).getValues();
      rowCountBeforeFilter = sData.length;
      for (let i = 0; i < sData.length; i++) {
        const row = sData[i];
        if (!rowTermMatches_(row[10], term)) continue;
        rowCountAfterTerm++;
        if (String(effectiveUser.role || '').toLowerCase() === 'student' && String(row[0]).trim() !== String(effectiveUser.id).trim()) continue;
        if (level && !isSameLevel_(row[4], level)) continue;
        if (room && parseLevelRoomForCompare_('', row[5]).room !== parseLevelRoomForCompare_('', room).room) continue;
        if (search) {
             const idStr = String(row[0]);
             const fullName = (String(row[1]) + String(row[2]) + " " + String(row[3])).toLowerCase();
             if (!idStr.includes(search) && !fullName.includes(search)) continue;
        }
        var studentItem = {
            id: String(row[0]), prefix: row[1], first: row[2], last: row[3], 
            level: row[4], room: row[5], no: row[6], status: row[7], 
            imageUrl: row[8], icon: normalizeIcon_(row[9], row[1]), term: rowTermMatches_(row[10], term) ? term : sanitizeTerm_(row[10])
        };
        if (!_studentAllowedByLiteScope_(studentItem, studentScope)) continue;
        filteredData.push(studentItem);
      }
    }
    
    filteredData.sort((a,b) => (parseInt(a.no)||0) - (parseInt(b.no)||0));
    
    return {
      success: true,
      term: term,
      students: filteredData,
      debug: { rowCountBeforeFilter: rowCountBeforeFilter, rowCountAfterTerm: rowCountAfterTerm, level: level, room: room },
      teacherScopeMissing: scopeMissing,
      message: (filteredData.length === 0 && scopeMissing) ? 'TeacherClasses is not configured for this teacher.' : ''
    };

  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// [FIXED] Robust ID Comparison (String/Trim)
function getStudentById(id, termOpt) {
  try {
    const ss = getDb();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (!sheet) return null;
    
    const targetId = String(id).trim(); // Normalize input
    const targetTerm = sanitizeTerm_(termOpt);
    
    // Read directly from sheet
    const data = sheet.getDataRange().getValues();
    // Assuming row 1 is header
    for (let i = 1; i < data.length; i++) {
      // Normalize sheet ID
      const sheetId = String(data[i][0]).trim();
      
      if (sheetId === targetId && sanitizeTerm_(data[i][10]) === targetTerm) {
        return {
          id: data[i][0],
          prefix: data[i][1],
          first: data[i][2],
          last: data[i][3],
          level: data[i][4],
          room: data[i][5],
          no: data[i][6],
          status: data[i][7],
          imageUrl: data[i][8],
          icon: normalizeIcon_(data[i][9], data[i][1]),
          term: data[i][10]
        };
      }
    }
    return null;
  } catch (e) {
    console.error("getStudentById error: " + e.toString());
    return null;
  }
}

function saveStudent(form) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = getDb();
    ensureSchemaAndHeaders();
    let sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    const lastRow = sheet.getLastRow();
    const data = lastRow > 1 ? sheet.getRange(2, 1, lastRow-1, 11).getValues() : [];
    
    const id = String(form.id).trim();
    let term = sanitizeTerm_(form && form.term);
    guardTermWritable_(term);
    let rowIndex = -1;
    
    for (let i = 0; i < data.length; i++) { 
      if (String(data[i][0]).trim() === id && rowTermMatches_(data[i][10], term)) { rowIndex = i + 2; break; } 
    }
    
    let status = form.status || 'Active', profileImage = '', icon = normalizeIcon_(form.icon, form.prefix);
    if(rowIndex > -1) {
        status = data[rowIndex-2][7] || 'Active';
        if (form.status && form.status !== 'Active') status = form.status;
        profileImage = form.imageUrl || data[rowIndex-2][8] || '';
        icon = normalizeIcon_(form.icon || data[rowIndex-2][9], form.prefix);
    }
    
    const rowData = [id, form.prefix, form.first, form.last, form.level, form.room, form.no, status, profileImage, icon, term];
    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, 11).setValues([rowData]); 
    else sheet.appendRow(rowData);
    invalidateTermCaches_(term);
    
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function deleteStudent(studentInput) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        const ss = getDb();
        const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
        const data = sheet.getDataRange().getValues();
        const targetId = String((studentInput && studentInput.id) ? studentInput.id : studentInput).trim();
        const targetTerm = sanitizeTerm_(studentInput && studentInput.term);
        guardTermWritable_(targetTerm);
        
        for(let i=1; i<data.length; i++) {
            if(String(data[i][0]).trim() === targetId && rowTermMatches_(data[i][10], targetTerm)) {
                sheet.deleteRow(i+1);
                invalidateTermCaches_(targetTerm);
                return { success: true };
            }
        }
        return { success: false };
    } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function extractSpreadsheetId_(value) {
  if (!value) return '';
  var s = String(value).trim();
  var match = s.match(/[-\w]{25,}/);
  return match ? match[0] : s;
}

function parseCsvText_(csvText) {
  if (!csvText) return [];
  var sText = String(csvText);
  if (sText.indexOf('"') === -1) {
    var lines = sText.split(/\r?\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) {
        rows.push(line.split(','));
      }
    }
    return rows;
  }
  var text = sText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var rows = [];
  var row = [];
  var cell = '';
  var inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var next = text.charAt(i + 1);
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function getImportRawRows_(payload) {
  payload = payload || {};
  if (payload.csvText) return parseCsvText_(payload.csvText);
  var sheetId = extractSpreadsheetId_(payload.sheetId || payload.sheetUrl);
  if (!sheetId) return [];
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheets()[0];
  return sheet.getDataRange().getDisplayValues();
}

function normalizeStudentImportRow_(cols, targetTerm) {
  return {
    id: String(cols[0] || '').trim(),
    prefix: String(cols[1] || '').trim(),
    first: String(cols[2] || '').trim(),
    last: String(cols[3] || '').trim(),
    level: String(cols[4] || '').trim(),
    room: String(cols[5] || '').trim(),
    no: String(cols[6] || '').trim(),
    term: sanitizeTerm_(cols[7] || targetTerm)
  };
}

function previewStudentImport(payload) {
  try {
    payload = payload || {};
    var targetTerm = sanitizeTerm_(payload.targetTerm || payload.term || payload.termOpt);
    var rawRows = getImportRawRows_(payload);
    var ss = getDb();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    var existing = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues() : [];
    var existingMap = {};
    for (var e = 0; e < existing.length; e++) {
      existingMap[String(existing[e][0]).trim() + '|' + sanitizeTerm_(existing[e][10])] = true;
    }

    var rows = [];
    var errors = [];
    var seen = {};
    var inserted = 0;
    var updated = 0;
    var duplicated = 0;
    var skipped = 0;
    var start = 0;
    if (rawRows.length > 0 && String(rawRows[0][0] || '').toLowerCase().indexOf('student') > -1) start = 1;

    for (var i = start; i < rawRows.length; i++) {
      var cols = rawRows[i] || [];
      if (cols.join('').trim() === '') continue;
      var row = normalizeStudentImportRow_(cols, targetTerm);
      var line = i + 1;
      var rowErrors = [];
      if (!row.id) rowErrors.push('StudentID required');
      if (!row.prefix) rowErrors.push('Prefix required');
      if (!row.first) rowErrors.push('First required');
      if (!row.last) rowErrors.push('Last required');
      if (!row.level) rowErrors.push('Level required');
      if (!row.room) rowErrors.push('Room required');
      if (!row.no) rowErrors.push('No required');
      var key = row.id + '|' + row.term;
      if (seen[key]) {
        row.action = 'duplicate';
        duplicated++;
        rowErrors.push('Duplicate in import');
      } else {
        seen[key] = true;
        row.action = existingMap[key] ? 'update' : 'insert';
        if (row.action === 'update') updated++;
        else inserted++;
      }
      row.line = line;
      row.key = key;
      if (rowErrors.length > 0) {
        row.errors = rowErrors;
        errors.push({ line: line, studentId: row.id, term: row.term, errors: rowErrors });
        if (row.action !== 'duplicate') skipped++;
      }
      rows.push(row);
    }

    return {
      success: true,
      summary: { total: rows.length, inserted: inserted, updated: updated, duplicates: duplicated, errors: errors.length, skipped: skipped },
      rows: rows,
      errors: errors
    };
  } catch (e) {
    return { success: false, message: e.message || e.toString(), summary: {}, rows: [], errors: [{ errors: [e.message || e.toString()] }] };
  }
}

function commitStudentImport(payload) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) return { success: false, message: 'System busy, please retry this chunk' };
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var preview = payload.rows ? { success: true, rows: payload.rows, errors: payload.errors || [] } : previewStudentImport(payload);
    if (!preview.success) return preview;

    var ss = getDb();
    ensureSchemaAndHeaders();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (!sheet) return { success: false, message: 'Students sheet not found' };
    var allData = sheet.getDataRange().getValues();
    var headers = allData.length ? allData[0] : CONFIG.HEADERS.STUDENTS;
    var headerMap = _liteHeaderMap_(headers);
    var colCount = Math.max(sheet.getLastColumn(), headers.length, CONFIG.HEADERS.STUDENTS.length);
    var idxId = _liteIndex_(headerMap, ['studentid', 'id', 'studentId'], 0);
    var idxPrefix = _liteIndex_(headerMap, ['prefix'], 1);
    var idxFirst = _liteIndex_(headerMap, ['firstname', 'first'], 2);
    var idxLast = _liteIndex_(headerMap, ['lastname', 'last'], 3);
    var idxLevel = _liteIndex_(headerMap, ['level'], 4);
    var idxRoom = _liteIndex_(headerMap, ['room'], 5);
    var idxNo = _liteIndex_(headerMap, ['no', 'number'], 6);
    var idxStatus = _liteIndex_(headerMap, ['status'], 7);
    var idxImage = _liteIndex_(headerMap, ['profileimage', 'imageurl', 'image'], 8);
    var idxIcon = _liteIndex_(headerMap, ['icon'], 9);
    var idxTerm = _liteIndex_(headerMap, ['term'], 10);
    var existingMap = {};
    for (var i = 1; i < allData.length; i++) {
      var existingRow = allData[i] || [];
      var existingId = String(existingRow[idxId] || '').trim();
      var existingTerm = sanitizeTerm_(existingRow[idxTerm]);
      if (existingId) existingMap[existingId + '|' + existingTerm] = { index: i - 1, rowNumber: i + 1, row: existingRow };
    }

    var newRows = [];
    var updates = [];
    var inserted = 0;
    var updated = 0;
    var skipped = 0;
    var errors = [];
    var seen = {};
    var affectedTerms = {};

    for (var r = 0; r < preview.rows.length; r++) {
      var row = preview.rows[r];
      var rowErrors = row.errors || [];
      var studentId = String(row.id || row.StudentID || row.studentId || '').trim();
      var rowTerm = sanitizeTerm_(row.term || row.Term || payload.targetTerm || payload.term);
      var key = studentId + '|' + rowTerm;
      if (!studentId || rowErrors.length > 0 || seen[key]) {
        skipped++;
        if (rowErrors.length > 0) errors.push({ line: row.line, studentId: row.id, term: row.term, errors: rowErrors });
        continue;
      }
      seen[key] = true;
      guardTermWritable_(rowTerm);
      affectedTerms[rowTerm] = true;
      var first = String(row.first || row.First || row.FirstName || row.firstName || '').trim();
      var last = String(row.last || row.Last || row.LastName || row.lastName || '').trim();
      var prefix = String(row.prefix || row.Prefix || '').trim();
      var level = String(row.level || row.Level || '').trim();
      var room = String(row.room || row.Room || '').trim();
      var no = String(row.no || row.No || row.Number || '').trim();
      var status = String(row.status || row.Status || '').trim();
      var imageUrl = String(row.imageUrl || row.ProfileImage || row.profileImage || '').trim();
      var icon = String(row.icon || row.Icon || '').trim();
      var values = new Array(colCount);
      if (existingMap[key]) {
        var old = existingMap[key].row;
        for (var c = 0; c < colCount; c++) values[c] = old[c] || '';
        if (idxId >= 0) values[idxId] = studentId;
        if (idxPrefix >= 0) values[idxPrefix] = prefix;
        if (idxFirst >= 0) values[idxFirst] = first;
        if (idxLast >= 0) values[idxLast] = last;
        if (idxLevel >= 0) values[idxLevel] = level;
        if (idxRoom >= 0) values[idxRoom] = room;
        if (idxNo >= 0) values[idxNo] = no;
        if (idxStatus >= 0) values[idxStatus] = status || old[idxStatus] || 'Active';
        if (idxImage >= 0) values[idxImage] = imageUrl || old[idxImage] || '';
        if (idxIcon >= 0) values[idxIcon] = icon || normalizeIcon_(old[idxIcon], prefix);
        if (idxTerm >= 0) values[idxTerm] = rowTerm;
        updates.push({ rowNumber: existingMap[key].rowNumber, values: values });
        updated++;
      } else {
        for (var nc = 0; nc < colCount; nc++) values[nc] = '';
        if (idxId >= 0) values[idxId] = studentId;
        if (idxPrefix >= 0) values[idxPrefix] = prefix;
        if (idxFirst >= 0) values[idxFirst] = first;
        if (idxLast >= 0) values[idxLast] = last;
        if (idxLevel >= 0) values[idxLevel] = level;
        if (idxRoom >= 0) values[idxRoom] = room;
        if (idxNo >= 0) values[idxNo] = no;
        if (idxStatus >= 0) values[idxStatus] = status || 'Active';
        if (idxImage >= 0) values[idxImage] = imageUrl || '';
        if (idxIcon >= 0) values[idxIcon] = icon || normalizeIcon_('', prefix);
        if (idxTerm >= 0) values[idxTerm] = rowTerm;
        newRows.push(values);
        inserted++;
      }
    }

    updates.sort(function(a, b) { return a.rowNumber - b.rowNumber; });
    var groupStart = -1;
    var groupValues = [];
    var prevRow = -1;
    for (var u = 0; u < updates.length; u++) {
      if (groupStart === -1) {
        groupStart = updates[u].rowNumber;
        groupValues = [updates[u].values];
      } else if (updates[u].rowNumber === prevRow + 1) {
        groupValues.push(updates[u].values);
      } else {
        sheet.getRange(groupStart, 1, groupValues.length, colCount).setValues(groupValues);
        groupStart = updates[u].rowNumber;
        groupValues = [updates[u].values];
      }
      prevRow = updates[u].rowNumber;
    }
    if (groupStart !== -1) sheet.getRange(groupStart, 1, groupValues.length, colCount).setValues(groupValues);
    if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, colCount).setValues(newRows);
    SpreadsheetApp.flush();

    var affectedList = Object.keys(affectedTerms);
    for (var at = 0; at < affectedList.length; at++) invalidateTermCaches_(affectedList[at]);
    var auditTerm = affectedList[0] || payload.targetTerm || payload.term || getCurrentTerm();
    logAudit_(admin.id, 'COMMIT_STUDENT_IMPORT', auditTerm, JSON.stringify({ inserted: inserted, updated: updated, skipped: skipped, terms: affectedList }), auditTerm);
    return {
      success: true,
      inserted: inserted,
      updated: updated,
      skipped: skipped,
      total: preview.rows.length,
      chunkStart: payload.chunkStart || 0,
      chunkSize: payload.chunkSize || preview.rows.length,
      totalRows: payload.totalRows || preview.rows.length,
      errors: errors
    };
  } catch (e) {
    return { success: false, inserted: 0, updated: 0, skipped: 0, errors: [{ errors: [e.message || e.toString()] }], message: e.message || e.toString() };
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function importStudentsCSV(csvText, termOpt, userOpt) {
  try {
    var result = commitStudentImport({ csvText: csvText, targetTerm: termOpt, user: userOpt });
    if (result.success) result.message = 'Updated ' + result.updated + ', Inserted ' + result.inserted;
    return result;
  } catch(e) { return { success: false, message: e.toString() }; }
}

// --- ATTENDANCE MANAGEMENT (DIRECT) ---

function getAttendanceForCheck(filter) {
  var started = Date.now();
  var term = '';
  var targetDate = '';
  var targetSubj = '';
  var level = '';
  var room = '';
  var attendanceRows = 0;
  var matchedCount = 0;
  try {
    filter = filter || {};
    term = normalizeTermFast_(filter.term || filter.termOpt, '') || normalizeTermFast_(resolveTerm_(filter.term || filter.termOpt), '');
    targetDate = normalizeDateFast_(filter.date || new Date());
    targetSubj = normalizeSubjectCode(filter.subject || filter.subjectCode);
    var normClass = parseLevelRoomForCompare_(filter.level || '', filter.room || '');
    level = normClass.level;
    room = normClass.room;
    Logger.log('ATT_LOAD START term=' + term + ' date=' + targetDate + ' subject=' + targetSubj + ' level=' + level + ' room=' + room);
    var isFastAdmin = _isFastAdminUser_(filter.user);
    if (!isFastAdmin && !canAccessClass_(filter.user, targetSubj, level, room, term)) {
      var eff = getEffectiveUser_(filter.user);
      return {
        success: false,
        message: 'Access denied',
        debug: {
          userId: eff.id || '',
          role: eff.role || '',
          term: term,
          subject: targetSubj,
          level: level,
          room: room,
          assistantScope: eff.assistantScope || []
        }
      };
    }
    var cache = CacheService.getScriptCache();
    var cacheKey = 'ATT_CHECK_V7_' + term + '_' + targetDate + '_' + targetSubj + '_' + level + '_' + room;
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    var ss = getDb();
    var studentsAll = _readStudentsLite_(ss, term, { id: 'ADMIN_MASTER', role: 'admin' });
    var students = [];
    for (var si = 0; si < studentsAll.length; si++) {
      var student = studentsAll[si];
      if (isSameClass_(student.level, student.room, level, room)) students.push(student);
    }

    // Fallback for attendance assistant when level/room formats mismatch in scoped cache path.
    if (students.length === 0) {
      var stuSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
      if (stuSheet && stuSheet.getLastRow() > 1) {
        var stuValues = stuSheet.getDataRange().getDisplayValues();
        var stuHeaders = stuValues[0] || [];
        var stuMap = _liteHeaderMap_(stuHeaders);
        var stuIdxId = _liteIndex_(stuMap, ['studentid', 'รหัส', 'รหัสนักเรียน'], 0);
        var stuIdxPrefix = _liteIndex_(stuMap, ['prefix', 'คำนำหน้า'], 1);
        var stuIdxFirst = _liteIndex_(stuMap, ['firstname', 'first', 'ชื่อ'], 2);
        var stuIdxLast = _liteIndex_(stuMap, ['lastname', 'last', 'สกุล', 'นามสกุล'], 3);
        var stuIdxLevel = _liteIndex_(stuMap, ['level', 'ระดับ', 'ชั้น'], 4);
        var stuIdxRoom = _liteIndex_(stuMap, ['room', 'ห้อง'], 5);
        var stuIdxNo = _liteIndex_(stuMap, ['no', 'เลขที่'], 6);
        var stuIdxStatus = _liteIndex_(stuMap, ['status', 'สถานะ'], 7);
        var stuIdxImage = _liteIndex_(stuMap, ['profileimage', 'image', 'รูป'], 8);
        var stuIdxIcon = _liteIndex_(stuMap, ['icon'], 9);
        var stuIdxTerm = _liteIndex_(stuMap, ['term', 'termid', 'เทอม'], 10);
        var seenStudentIds = {};
        var classOnlyRows = [];
        var fallbackRowsScanned = Math.max(0, stuValues.length - 1);
        var fallbackClassMatched = 0;
        var fallbackTermMatched = 0;
        for (var sx = 1; sx < stuValues.length; sx++) {
          var sr = stuValues[sx];
          if (!isSameClass_(sr[stuIdxLevel], sr[stuIdxRoom], level, room)) continue;
          fallbackClassMatched++;
          classOnlyRows.push(sr);
          if (!rowTermMatches_(sr[stuIdxTerm], term)) continue;
          fallbackTermMatched++;
          var sid = String(sr[stuIdxId] || '').trim();
          if (!sid || seenStudentIds[sid]) continue;
          seenStudentIds[sid] = true;
          students.push({
            id: sid,
            prefix: String(sr[stuIdxPrefix] || '').trim(),
            first: String(sr[stuIdxFirst] || '').trim(),
            last: String(sr[stuIdxLast] || '').trim(),
            level: String(sr[stuIdxLevel] || '').trim(),
            room: String(sr[stuIdxRoom] || '').trim(),
            no: parseInt(sr[stuIdxNo], 10) || 0,
            status: String(sr[stuIdxStatus] || '').trim(),
            profileImage: String(sr[stuIdxImage] || '').trim(),
            imageUrl: String(sr[stuIdxImage] || '').trim(),
            icon: normalizeStudentIconByPrefix_(String(sr[stuIdxPrefix] || '').trim(), sr[stuIdxIcon]),
            term: String(sr[stuIdxTerm] || '').trim()
          });
        }
        if (students.length === 0 && classOnlyRows.length > 0) {
          for (var sy = 0; sy < classOnlyRows.length; sy++) {
            var cr = classOnlyRows[sy];
            var cid = String(cr[stuIdxId] || '').trim();
            if (!cid || seenStudentIds[cid]) continue;
            seenStudentIds[cid] = true;
            students.push({
              id: cid,
              prefix: String(cr[stuIdxPrefix] || '').trim(),
              first: String(cr[stuIdxFirst] || '').trim(),
              last: String(cr[stuIdxLast] || '').trim(),
              level: String(cr[stuIdxLevel] || '').trim(),
              room: String(cr[stuIdxRoom] || '').trim(),
              no: parseInt(cr[stuIdxNo], 10) || 0,
              status: String(cr[stuIdxStatus] || '').trim(),
              profileImage: String(cr[stuIdxImage] || '').trim(),
              imageUrl: String(cr[stuIdxImage] || '').trim(),
              icon: normalizeStudentIconByPrefix_(String(cr[stuIdxPrefix] || '').trim(), cr[stuIdxIcon]),
              term: String(cr[stuIdxTerm] || '').trim(),
              termFallbackUsed: true
            });
          }
        }
        Logger.log('ATT_LOAD fallback students scanned=' + fallbackRowsScanned + ' classMatched=' + fallbackClassMatched + ' termMatched=' + fallbackTermMatched + ' loaded=' + students.length);
      }
    }
    students.sort(function(a, b) { return (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0); });

    var attSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ATTENDANCE);
    var attMap = {};
    var sampleTermMatches = [];
    var sampleDateMatches = [];
    
    if (attSheet && attSheet.getLastRow() > 1) {
      var data = attSheet.getDataRange().getDisplayValues();
      attendanceRows = data.length - 1;
      var headers = data[0] || [];
      var map = _liteHeaderMap_(headers);
      var idxTimestamp = _liteIndex_(map, ['timestamp'], 0);
      var idxDate = _liteIndex_(map, ['date', 'วันที่'], 1);
      var idxSubject = _liteIndex_(map, ['subjectcode', 'subject', 'รหัสวิชา'], 2);
      var idxLevel = _liteIndex_(map, ['level', 'ระดับ', 'ชั้น'], 3);
      var idxRoom = _liteIndex_(map, ['room', 'ห้อง'], 4);
      var idxStudent = _liteIndex_(map, ['studentid', 'รหัส', 'รหัสนักเรียน'], 5);
      var idxStatus = _liteIndex_(map, ['status', 'สถานะ'], 6);
      var idxRecorder = _liteIndex_(map, ['recorder', 'ผู้บันทึก'], 7);
      var idxTerm = _liteIndex_(map, ['term', 'termid', 'เทอม'], 8);
      var idxNote = _liteIndex_(map, ['note', 'หมายเหตุ'], 9);
      for (var i = 1; i < data.length; i++) {
        var r = data[i];
        var rowTerm = normalizeTermFast_(r[idxTerm], '');
        var rowDateRaw = String(r[idxDate] || '').trim() ? r[idxDate] : r[idxTimestamp];
        var rowDate = normalizeDateFast_(rowDateRaw);
        var rowSubject = normalizeSubjectCode(r[idxSubject]);
        var rowLevel = String(r[idxLevel] || '').trim();
        var rowRoom = String(r[idxRoom] || '').trim();
        var stdId = String(r[idxStudent] || '').trim();
        var termOk = !rowTerm || rowTerm === term;
        var dateOk = rowDate === targetDate;
        if (termOk && sampleTermMatches.length < 5) sampleTermMatches.push(r);
        if (dateOk && sampleDateMatches.length < 5) sampleDateMatches.push(r);
        if (termOk &&
            dateOk &&
            rowSubject.toLowerCase() === targetSubj.toLowerCase() &&
            isSameClass_(rowLevel, rowRoom, level, room) &&
            stdId) {
          matchedCount++;
          var attKey = term + '|' + targetDate + '|' + targetSubj + '|' + stdId;
          attMap[attKey] = {
            status: r[idxStatus],
            recorder: r[idxRecorder],
            note: r[idxNote],
            time: String(r[idxTimestamp] || '')
          };
        }
      }
    }

    if (matchedCount === 0) {
      Logger.log('ATT_LOAD sampleTermMatches=' + JSON.stringify(sampleTermMatches).substring(0, 2000));
      Logger.log('ATT_LOAD sampleDateMatches=' + JSON.stringify(sampleDateMatches).substring(0, 2000));
    }
    var count = 0;
    var result = students.map(function(s) {
      var attKey = term + '|' + targetDate + '|' + targetSubj + '|' + String(s.id).trim();
      var att = attMap[attKey];
      if (att) {
        count++;
        var checkedStudent = {};
        Object.keys(s).forEach(function(k) { checkedStudent[k] = s[k]; });
        checkedStudent.attStatus = att.status;
        checkedStudent.attNote = att.note;
        checkedStudent.attRecorder = att.recorder;
        checkedStudent.attTime = att.time;
        checkedStudent.isChecked = true;
        return checkedStudent;
      } else {
        var emptyStudent = {};
        Object.keys(s).forEach(function(k) { emptyStudent[k] = s[k]; });
        emptyStudent.attStatus = 'มา';
        emptyStudent.attNote = '';
        emptyStudent.attRecorder = '';
        emptyStudent.attTime = '';
        emptyStudent.isChecked = false;
        return emptyStudent;
      }
    });

    var debug = { term: term, date: targetDate, subject: targetSubj, level: level, room: room, attendanceRows: attendanceRows, matched: matchedCount, students: students.length, skippedPermission: isFastAdmin, ms: Date.now() - started };
    if (students.length === 0) {
      var eff = getEffectiveUser_(filter.user);
      var studentsAllObj = _readStudentsLiteResult_(ss, term, { id: 'ADMIN_MASTER', role: 'admin' });
      var studentsAllCount = studentsAllObj && studentsAllObj.items ? studentsAllObj.items.length : 0;
      debug.zeroStudentsDiag = {
        requestedClassCanonical: level + '/' + room,
        studentsAllLength: studentsAllCount,
        userRole: eff.role,
        userId: eff.id,
        assistantScope: eff.assistantScope || [],
        studentsAllDebug: studentsAllObj.debug || null
      };
      Logger.log('getAttendanceForCheck 0 students debug: ' + JSON.stringify(debug.zeroStudentsDiag));
    }
    Logger.log('ATT_LOAD END rows=' + attendanceRows + ' matched=' + matchedCount + ' students=' + students.length + ' ms=' + (Date.now() - started));
    var response = { success: true, students: result, count: count, date: targetDate, subject: targetSubj, matched: matchedCount, debug: debug };
    _safeCachePut_(cache, cacheKey, response);
    return response;
  } catch(e) {
    Logger.log('ATT_LOAD ERROR rows=' + attendanceRows + ' matched=' + matchedCount + ' ms=' + (Date.now() - started) + ' err=' + String(e));
    return { success: false, message: e.toString(), debug: { term: term, date: targetDate, subject: targetSubj, level: level, room: room, attendanceRows: attendanceRows, matched: matchedCount, ms: Date.now() - started } };
  }
}

function saveAttendance(payload) {
  const lock = LockService.getScriptLock();
  let hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) return { success: false, message: 'System busy, retrying' };
    const ss = getDb();
    ensureSchemaAndHeaders();

    const sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE, CONFIG.HEADERS.ATTENDANCE);
    const attLayout = _attendanceSheetLayout_(sheet);
    const attIdx = attLayout.indexes;
    const term = normalizeTermFast_(payload.term, '') || normalizeTermFast_(resolveTerm_(payload.term), '');
    guardTermWritable_(term);
    const timestamp = new Date();
    const targetDate = normalizeDateFast_(payload.date);
    const subject = normalizeSubjectCode(payload.subject || payload.subjectCode);
    const level = String(payload.level || '').trim();
    const room = String(payload.room || '').trim();
    const recorder = payload.recorder || 'Unknown';
    const writeUser = getEffectiveUser_(payload.user);
    if (String(writeUser.role || '').toLowerCase() === 'student') {
      return { success: false, message: 'Access denied' };
    }
    if (!canAccessClass_(payload.user, subject, level, room, term)) {
      return { success: false, message: 'Access denied' };
    }

    const normalizedRecordsForFingerprint = (payload.records || []).map(function(record) {
      return {
        id: String(record.id || '').trim(),
        status: String(record.status || ''),
        note: String(record.note || '')
      };
    }).filter(function(record) {
      return record.id;
    }).sort(function(a, b) {
      return a.id.localeCompare(b.id);
    });
    const requestFingerprint = JSON.stringify({
      term: term,
      date: targetDate,
      subject: subject,
      level: level,
      room: room,
      records: normalizedRecordsForFingerprint
    });
    const requestDigest = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, requestFingerprint)
    ).substring(0, 48);
    const requestCache = CacheService.getScriptCache();
    const requestCacheKey = 'ATT_SAVE_DONE_V7_' + requestDigest;
    if (requestCache.get(requestCacheKey)) {
      Logger.log('ATT_SAVE_IDEMPOTENT_SKIP key=' + requestCacheKey);
      return {
        success: true,
        saved: (payload.records || []).length,
        skippedDuplicateRequest: true,
        key: { term: term, targetDate: targetDate, subject: subject, level: level, room: room },
        trace: { codeSignature: 'attendance-recordid-upsert-v7', idempotent: true }
      };
    }

    const mappedColCount = attLayout.colCount || CONFIG.HEADERS.ATTENDANCE.length;
    const buildAttendanceRowData = function(record) {
      const stdId = String(record.id || '').trim();
      const recordId = makeAttendanceRecordId_(term, targetDate, subject, stdId);
      const rowData = _blankMappedRow_(mappedColCount);
      _setMappedValue_(rowData, attIdx.timestamp, timestamp, mappedColCount);
      _setMappedValue_(rowData, attIdx.date, targetDate, mappedColCount);
      _setMappedValue_(rowData, attIdx.subject, subject, mappedColCount);
      _setMappedValue_(rowData, attIdx.level, level, mappedColCount);
      _setMappedValue_(rowData, attIdx.room, room, mappedColCount);
      _setMappedValue_(rowData, attIdx.studentId, stdId, mappedColCount);
      _setMappedValue_(rowData, attIdx.status, record.status, mappedColCount);
      _setMappedValue_(rowData, attIdx.recorder, recorder, mappedColCount);
      _setMappedValue_(rowData, attIdx.term, term, mappedColCount);
      _setMappedValue_(rowData, attIdx.note, record.note || '', mappedColCount);
      _setMappedValue_(rowData, attIdx.recordId, recordId, mappedColCount);
      return { recordId: recordId, studentId: stdId, data: rowData };
    };

    if ((payload.records || []).length === 1 && attIdx.recordId >= 0 && sheet.getLastRow() > 1) {
      const singleItem = buildAttendanceRowData((payload.records || [])[0] || {});
      if (singleItem.studentId) {
        const recordIdRange = sheet.getRange(2, attIdx.recordId + 1, sheet.getLastRow() - 1, 1);
        const matches = recordIdRange.createTextFinder(singleItem.recordId).matchEntireCell(true).findAll();
        if (matches.length === 1) {
          const targetRow = matches[0].getRow();
          sheet.getRange(targetRow, 1, 1, mappedColCount).setValues([singleItem.data.slice(0, mappedColCount)]);
          invalidateTermCaches_(term);
          var normClass = parseLevelRoomForCompare_(level, room);
          var fastAttCacheKey = 'ATT_CHECK_V7_' + term + '_' + targetDate + '_' + subject + '_' + normClass.level + '_' + normClass.room;
          CacheService.getScriptCache().remove(fastAttCacheKey);
          CacheService.getScriptCache().remove('DASHBOARD_' + term);
          requestCache.put(requestCacheKey, '1', 2);
          Logger.log('ATT_SAVE_FAST_UPDATE recordId=' + singleItem.recordId + ' row=' + targetRow);
          return {
            success: true,
            saved: 1,
            key: { term: term, targetDate: targetDate, subject: subject, level: level, room: room },
            trace: {
              updated: 1,
              inserted: 0,
              fastPath: true,
              recordId: singleItem.recordId,
              sheetRow: targetRow,
              codeSignature: 'attendance-recordid-upsert-v7'
            }
          };
        }
      }
    }
    
    const dataRange = sheet.getDataRange();
    const rawValues = dataRange.getValues();
    const displayValues = dataRange.getDisplayValues();
    const headerRow = rawValues[0] || attLayout.headers || CONFIG.HEADERS.ATTENDANCE;
    const colCount = Math.max(mappedColCount, headerRow.length);

    const padRow = function(row) {
      while (row.length < colCount) row.push('');
      return row.slice(0, colCount);
    };
    const makeAttendanceKey = function(rowTerm, rowDate, rowSubject, studentId) {
      return makeAttendanceRecordId_(rowTerm, rowDate, rowSubject, studentId);
    };
    const rowValueAt = function(rawRow, displayRow, idx) {
      if (idx < 0) return '';
      const rawValue = rawRow ? rawRow[idx] : '';
      if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') return rawValue;
      return displayRow ? displayRow[idx] : '';
    };
    const makeAttendanceKeyFromRow = function(rawRow, displayRow) {
      const rowTerm = rowValueAt(rawRow, displayRow, attIdx.term) || term;
      const rawDate = rowValueAt(rawRow, null, attIdx.date) || rowValueAt(rawRow, null, attIdx.timestamp);
      const displayDate = rowValueAt(null, displayRow, attIdx.date) || rowValueAt(null, displayRow, attIdx.timestamp);
      const rowDate = normalizeDateFast_(rawDate) || normalizeDateFast_(displayDate);
      const rowSubject = rowValueAt(rawRow, displayRow, attIdx.subject);
      const rowStudentId = rowValueAt(rawRow, displayRow, attIdx.studentId);
      const existingRecordId = String(rowValueAt(rawRow, displayRow, attIdx.recordId) || '').trim();
      return existingRecordId || makeAttendanceKey(rowTerm, rowDate, rowSubject, rowStudentId);
    };
    const isAttendanceDataRow = function(row) {
      const studentId = String(row[attIdx.studentId] || '').trim().toLowerCase();
      const subjectCode = String(row[attIdx.subject] || '').trim().toLowerCase();
      return studentId && studentId !== 'studentid' && subjectCode !== 'subjectcode';
    };
    const incomingAttendanceByKey = new Map();
    (payload.records || []).forEach(function(record) {
      const builtItem = buildAttendanceRowData(record);
      if (!builtItem.studentId) return;
      incomingAttendanceByKey.set(builtItem.recordId, {
        record: record,
        studentId: builtItem.studentId,
        data: padRow(builtItem.data.slice())
      });
    });

    const latestRowByKey = new Map();
    const duplicateRowIndexes = {};
    for (let i = 1; i < rawValues.length; i++) {
        const r = rawValues[i];
        if (!isAttendanceDataRow(r)) continue;
        const key = makeAttendanceKeyFromRow(r, displayValues[i]);
        if (latestRowByKey.has(key)) duplicateRowIndexes[latestRowByKey.get(key)] = true;
        latestRowByKey.set(key, i);
    }
    let duplicatesRemoved = Object.keys(duplicateRowIndexes).length;

    let updated = 0, inserted = 0;
    const originalLastRow = sheet.getLastRow();

    if (duplicatesRemoved > 0) {
      // Case A: Rewrite sheet to clear duplicates
      const values = [padRow(headerRow.slice())];
      const writtenIncomingKeys = new Set();
      for (let i = 1; i < rawValues.length; i++) {
        const r = rawValues[i];
        if (!isAttendanceDataRow(r)) continue;
        const key = makeAttendanceKeyFromRow(r, displayValues[i]);
        if (latestRowByKey.get(key) !== i) {
          continue;
        }
        if (incomingAttendanceByKey.has(key)) {
          values.push(padRow(incomingAttendanceByKey.get(key).data.slice()));
          writtenIncomingKeys.add(key);
          updated++;
        } else {
          var keptRow = padRow(r.slice());
          _setMappedValue_(keptRow, attIdx.recordId, key, colCount);
          values.push(keptRow);
        }
      }
      incomingAttendanceByKey.forEach(function(item, key) {
        if (!writtenIncomingKeys.has(key)) {
          values.push(padRow(item.data.slice()));
          inserted++;
        }
      });

      sheet.getRange(1, 1, values.length, colCount).setValues(values);
      if (originalLastRow > values.length) {
        sheet.getRange(values.length + 1, 1, originalLastRow - values.length, colCount).clearContent();
      }
      Logger.log('ATT_SAVE_DEDUP_REWRITE originalLastRow=' + originalLastRow + ' finalLastRow=' + sheet.getLastRow());
    } else {
      // Case B: No duplicates, do targeted updates & appends
      const attUpdatesList = [];
      const attAppendList = [];
      incomingAttendanceByKey.forEach(function(item, key) {
        if (latestRowByKey.has(key)) {
          const sheetRow = latestRowByKey.get(key) + 1;
          attUpdatesList.push({ sheetRow: sheetRow, data: item.data });
          updated++;
        } else {
          attAppendList.push(item.data);
          inserted++;
        }
      });

      // Targeted updates
      attUpdatesList.forEach(function(upd) {
        if (upd.sheetRow > 1) {
          sheet.getRange(upd.sheetRow, 1, 1, colCount).setValues([upd.data.slice(0, colCount)]);
        }
      });

      // Appends
      if (attAppendList.length > 0) {
        const lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, attAppendList.length, colCount)
             .setValues(attAppendList.map(function(r) { return r.slice(0, colCount); }));
      }
    }

    invalidateTermCaches_(term);
    
    var normClass = parseLevelRoomForCompare_(level, room);
    var attCacheKey = 'ATT_CHECK_V7_' + term + '_' + targetDate + '_' + subject + '_' + normClass.level + '_' + normClass.room;
    CacheService.getScriptCache().remove(attCacheKey);
    CacheService.getScriptCache().remove('DASHBOARD_' + term);
    Logger.log('ATT_CACHE_CLEAR key=' + attCacheKey);

    var attTrace = {
      dbId: ss.getId(),
      scriptId: (function(){ try { return ScriptApp.getScriptId(); } catch(e) { return ''; } })(),
      webAppUrl: (function(){ try { return ScriptApp.getService().getUrl(); } catch(e) { return ''; } })(),
      originalLastRow: originalLastRow,
      finalLastRow: sheet.getLastRow(),
      rawRows: Math.max(0, rawValues.length - 1),
      incomingRecords: (payload.records || []).length,
      incomingKeys: incomingAttendanceByKey.size,
      updated: updated,
      inserted: inserted,
      duplicatesRemoved: duplicatesRemoved,
      keptRows: duplicatesRemoved > 0 ? sheet.getLastRow() : originalLastRow,
      codeSignature: 'attendance-recordid-upsert-v7'
    };
    Logger.log('ATT_SAVE_TRACE ' + JSON.stringify(attTrace));
    requestCache.put(requestCacheKey, '1', 2);

    return { 
      success: true, 
      saved: payload.records.length,
      key: { term: term, targetDate: targetDate, subject: subject, level: level, room: room },
      trace: attTrace
    };
  } catch (e) { return { success: false, message: e.message }; } finally { if (hasLock) lock.releaseLock(); }
}

function clearAttendanceForClass(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    ensureSchemaAndHeaders();
    var ss = getDb();
    var sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ATTENDANCE, CONFIG.HEADERS.ATTENDANCE);
    var term = normalizeTermFast_(payload.term, '') || normalizeTermFast_(resolveTerm_(payload.term), '');
    guardTermWritable_(term);
    var targetDate = normalizeDateFast_(payload.date);
    var subject = normalizeSubjectCode(payload.subject || payload.subjectCode);
    var level = String(payload.level || '').trim();
    var room = String(payload.room || '').trim();
    var targetRecordIds = {};
    (payload.studentIds || []).forEach(function(studentId) {
      var sid = String(studentId || '').trim();
      if (sid) targetRecordIds[makeAttendanceRecordId_(term, targetDate, subject, sid)] = true;
    });
    var hasTargetRecordIds = Object.keys(targetRecordIds).length > 0;
    var user = getEffectiveUser_(payload.user);
    if (String(user.role || '').toLowerCase() === 'student') return { success: false, message: 'Access denied' };
    if (!canAccessClass_(payload.user, subject, level, room, term)) return { success: false, message: 'Access denied' };
    if (!targetDate || !subject || !level || !room) throw new Error('Date, subject, level and room are required');

    var attLayout = _attendanceSheetLayout_(sheet);
    var attIdx = attLayout.indexes;
    var dataRange = sheet.getDataRange();
    var rawValues = dataRange.getValues();
    var displayValues = dataRange.getDisplayValues();
    var headerRow = rawValues[0] || attLayout.headers || CONFIG.HEADERS.ATTENDANCE;
    var colCount = attLayout.colCount || headerRow.length;

    const padRow = function(row) {
      while (row.length < colCount) row.push('');
      return row.slice(0, colCount);
    };
    var rowValueAt = function(rawRow, displayRow, idx) {
      if (idx < 0) return '';
      var rawValue = rawRow ? rawRow[idx] : '';
      if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') return rawValue;
      return displayRow ? displayRow[idx] : '';
    };

    var values = [padRow(headerRow.slice())];
    var deleted = 0;

    for (var i = 1; i < rawValues.length; i++) {
      var r = rawValues[i];
      var d = displayValues[i] || [];
      var stdId = String(rowValueAt(r, d, attIdx.studentId) || '').trim();
      if (!stdId) continue;
      
      var rawDate = rowValueAt(r, null, attIdx.date) || rowValueAt(r, null, attIdx.timestamp);
      var displayDate = rowValueAt(null, d, attIdx.date) || rowValueAt(null, d, attIdx.timestamp);
      var rowDate = normalizeDateFast_(rawDate) || normalizeDateFast_(displayDate);
      var rowSubject = normalizeSubjectCode(rowValueAt(r, d, attIdx.subject));
      var rowLevel = String(rowValueAt(r, d, attIdx.level) || '').trim();
      var rowRoom = String(rowValueAt(r, d, attIdx.room) || '').trim();
      var rowTerm = rowValueAt(r, d, attIdx.term);
      var rowRecordId = String(rowValueAt(r, d, attIdx.recordId) || '').trim() ||
        makeAttendanceRecordId_(rowTerm || term, rowDate, rowSubject, stdId);
      
      if ((hasTargetRecordIds && targetRecordIds[rowRecordId]) ||
          (!hasTargetRecordIds &&
          rowTermMatchesFast_(rowTerm, term) &&
          rowDate === targetDate &&
          rowSubject.toLowerCase() === subject.toLowerCase() &&
          isSameClass_(rowLevel, rowRoom, level, room))) {
        deleted++;
      } else {
        var keptRow = padRow(r.slice());
        _setMappedValue_(keptRow, attIdx.recordId, rowRecordId, colCount);
        values.push(keptRow);
      }
    }
    
    var originalLastRow = sheet.getLastRow();
    if (deleted > 0) {
      sheet.getRange(1, 1, values.length, colCount).setValues(values);
      if (originalLastRow > values.length) {
        sheet.getRange(values.length + 1, 1, originalLastRow - values.length, colCount).clearContent();
      }
    }
    
    SpreadsheetApp.flush();
    
    var debugInfo = {
      term: term, targetDate: targetDate, subject: subject, level: level, room: room,
      attendanceLastRow: sheet.getLastRow(),
      deleted: deleted
    };

    Logger.log('CLEAR_ATT_START ' + JSON.stringify(debugInfo));
    Logger.log('CLEAR_ATT_DELETE deleted=' + deleted);

    if (deleted === 0) {
      return {
        success: true,
        message: 'ไม่พบแถวเช็คชื่อที่ตรงกับเงื่อนไขในชีท Attendance',
        deleted: 0,
        debug: debugInfo
      };
    }

    var normClass = parseLevelRoomForCompare_(level, room);
    var attCacheKey = 'ATT_CHECK_V7_' + term + '_' + targetDate + '_' + subject + '_' + normClass.level + '_' + normClass.room;
    var cache = CacheService.getScriptCache();
    cache.remove(attCacheKey);
    cache.remove('DASHBOARD_' + term);
    cache.remove('INITIAL_' + term);
    cache.remove('SYSTEM_DB_' + term);
    invalidateTermCaches_(term);
    
    logAudit_(user.id, 'CLEAR_ATTENDANCE', subject, JSON.stringify({ date: targetDate, level: level, room: room, deleted: deleted }), term);
    return { success: true, deleted: deleted, remaining: 0 };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// --- SCORES MANAGEMENT (DIRECT) ---

function loadScoresGrid(filter) {
  var started = Date.now();
  var term = '';
  var requestedAssignmentId = '';
  var scoreRows = 0;
  var matchedCount = 0;
  var assignments = [];
  var students = [];
  try {
    filter = filter || {};
    var ss = getDb();
    term = normalizeTermFast_(filter.term, '') || normalizeTermFast_(resolveTerm_(filter.term), '');
    requestedAssignmentId = String(filter.assignmentId || filter.id || '').trim();
    if (requestedAssignmentId === 'ALL') requestedAssignmentId = '';
    var subject = normalizeSubjectCode(filter.subject || filter.subjectCode);
    var level = String(filter.level || '').trim();
    var room = String(filter.room || '').trim();
    Logger.log('SCORE_LOAD START term=' + term + ' assignmentId=' + (requestedAssignmentId || 'ALL'));

    var isFastAdmin = _isFastAdminUser_(filter.user);
    if (!isFastAdmin && !canAccessClass_(filter.user, subject, level, room, term)) {
      return { success: false, message: 'Access denied' };
    }

    var cache = CacheService.getScriptCache();
    var cacheKey = 'SCORE_GRID_V4_' + term + '_' + (requestedAssignmentId || (subject + '_' + level + '_' + room));
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    var studentsAll = _readStudentsLite_(ss, term, filter.user);
    for (var si = 0; si < studentsAll.length; si++) {
      var student = studentsAll[si];
      if ((!level || String(student.level || '').trim() === level) && (!room || String(student.room || '').trim() === room)) students.push(student);
    }
    students.sort(function(a, b) { return (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0); });

    var asnResult = _readAssignmentsLiteResult_(ss, term, filter.user, 20000);
    var allAssignments = asnResult.items || [];
    for (var ai = 0; ai < allAssignments.length; ai++) {
      var asn = allAssignments[ai];
      var asnId = String(asn.id || '').trim();
      var asnSubject = normalizeSubjectCode(asn.subject);
      var asnLevel = String(asn.level || '').trim();
      var asnRoom = String(asn.room || '').trim();
      if (!asnId) continue;
      if (requestedAssignmentId && asnId !== requestedAssignmentId) continue;
      if (requestedAssignmentId) {
        if (!subject) subject = asnSubject;
        if (!level) level = asnLevel;
        if (!room) room = asnRoom;
      }
      if (subject && asnSubject !== subject) continue;
      if (level && asnLevel && asnLevel !== level) continue;
      if (room && asnRoom && asnRoom !== room) continue;
      assignments.push(asn);
    }

    var assignmentMap = {};
    for (var am = 0; am < assignments.length; am++) {
      var canonicalId = String(assignments[am].id || '').trim();
      assignmentMap[canonicalId.toLowerCase()] = canonicalId;
    }

    var scSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
    var flatScores = {};
    var sampleAssignmentIds = [];
    if (scSheet && scSheet.getLastRow() > 1) {
      var scData = scSheet.getDataRange().getDisplayValues();
      scoreRows = scData.length - 1;
      var scHeaders = scData[0] || [];
      var scMap = _liteHeaderMap_(scHeaders);
      var idxAssignment = _liteIndex_(scMap, ['assignmentid', 'assignment', 'id'], 1);
      var idxStudent = _liteIndex_(scMap, ['studentid', 'รหัส', 'รหัสนักเรียน'], 2);
      var idxScore = _liteIndex_(scMap, ['score', 'คะแนน'], 3);
      var idxSubmitted = _liteIndex_(scMap, ['issubmitted', 'submitted', 'ส่งแล้ว'], 4);
      var idxTerm = _liteIndex_(scMap, ['term', 'termid', 'เทอม'], 5);
      for (var i = 1; i < scData.length; i++) {
        var r = scData[i];
        if (!rowTermMatchesFast_(r[idxTerm], term)) continue;
        var scoreAsnId = String(r[idxAssignment] || '').trim();
        if (sampleAssignmentIds.length < 10) sampleAssignmentIds.push(scoreAsnId);
        var canonicalAsnId = assignmentMap[scoreAsnId.toLowerCase()];
        if (!canonicalAsnId) continue;
        var stdId = String(r[idxStudent] || '').trim();
        if (!stdId) continue;
        if (requestedAssignmentId && scoreAsnId.toLowerCase() !== requestedAssignmentId.toLowerCase()) continue;
        matchedCount++;
        flatScores[canonicalAsnId + '_' + stdId] = {
          score: r[idxScore],
          isSubmitted: normalizeSubmittedFast_(r[idxSubmitted])
        };
      }
    }
    if (matchedCount === 0) {
      Logger.log('SCORE_LOAD sampleAssignmentIds=' + JSON.stringify(sampleAssignmentIds));
    }
    var debug = { term: term, subject: subject, level: level, room: room, assignmentId: requestedAssignmentId || 'ALL', scoreRows: scoreRows, matchedScores: matchedCount, assignments: assignments.length, students: students.length, skippedPermission: isFastAdmin, ms: Date.now() - started };
    Logger.log('SCORE_LOAD END scoreRows=' + scoreRows + ' matchedScores=' + matchedCount + ' assignments=' + assignments.length + ' students=' + students.length + ' ms=' + (Date.now() - started));

    var response = { success: true, data: { students: students, assignments: assignments, scores: flatScores, term: term, subject: subject, matched: matchedCount }, debug: debug };
    _safeCachePut_(cache, cacheKey, response);
    return response;
  } catch (e) {
    Logger.log('SCORE_LOAD ERROR scoreRows=' + scoreRows + ' matchedScores=' + matchedCount + ' assignments=' + assignments.length + ' students=' + students.length + ' ms=' + (Date.now() - started) + ' err=' + String(e));
    return { success: false, message: e.toString(), debug: { term: term, assignmentId: requestedAssignmentId || 'ALL', scoreRows: scoreRows, matchedScores: matchedCount, assignments: assignments.length, students: students.length, ms: Date.now() - started } };
  }
}

function normalizeScoreForSave_(value, maxScore) {
  if (value === '' || value === null || value === undefined) return '';
  var n = Number(value);
  if (!isFinite(n)) return '';
  var max = Number(maxScore);
  if (!isFinite(max) || max < 0) max = n;
  return Math.max(0, Math.min(Math.round(n), max));
}

function saveScoresBatch(payload) {
  payload = payload || {};
  // Accept both the durable browser queue shape (`records`) and the legacy
  // Apps Script shape (`scores`). This prevents a successful empty response
  // when a rapid-click batch arrives through the queue.
  if (!Array.isArray(payload.scores) && Array.isArray(payload.records)) payload.scores = payload.records;
  const lock = LockService.getScriptLock();
  let hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) {
      Logger.log('SCORE_SAVE_LOCK_BUSY records=' + (payload.scores || []).length);
      return { success: false, message: 'System busy, retrying' };
    }
    const ss = getDb();
    ensureSchemaAndHeaders();

    const sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.SCORES, CONFIG.HEADERS.SCORES);
    const scoreLayout = _scoreSheetLayout_(sheet);
    const scoreIdx = scoreLayout.indexes;
    const term = sanitizeTerm_(payload.term);
    guardTermWritable_(term);
    const timestamp = new Date();
    const writeUser = getEffectiveUser_(payload.user);
    if (['student', 'attendance_assistant'].includes(String(writeUser.role || '').toLowerCase())) {
      return { success: false, message: 'Access denied' };
    }
    const accessByAssignment = {};
    const asnSheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ASSIGNMENTS, CONFIG.HEADERS.ASSIGNMENTS);
    if (asnSheet && asnSheet.getLastRow() > 1) {
      const asnLayout = _assignmentSheetLayout_(asnSheet);
      const asnIdx = asnLayout.indexes;
      const asnRows = asnSheet.getDataRange().getValues();
      for (let a = 1; a < asnRows.length; a++) {
        if (rowTermMatches_(asnRows[a][asnIdx.term], term)) {
          accessByAssignment[String(asnRows[a][asnIdx.id] || '').trim()] = {
            subject: normalizeSubjectCode(asnRows[a][asnIdx.subject]),
            level: String(asnRows[a][asnIdx.level] || payload.level || ''),
            room: String(asnRows[a][asnIdx.room] || payload.room || ''),
            maxScore: Number(asnRows[a][asnIdx.maxScore])
          };
        }
      }
    }

    const mappedColCount = scoreLayout.colCount || CONFIG.HEADERS.SCORES.length;
    const makeScoreKey = function(rowTerm, assignmentId, studentId) {
      return makeScoreRecordId_(rowTerm, assignmentId, studentId);
    };
    const buildScoreRowData = function(s, colCount) {
      const incomingAssignmentId = String(s.assignmentId || '').trim();
      const incomingStudentId = String(s.studentId || '').trim();
      const scoreId = makeScoreKey(term, incomingAssignmentId, incomingStudentId);
      const rowData = _blankMappedRow_(colCount);
      _setMappedValue_(rowData, scoreIdx.timestamp, timestamp, colCount);
      _setMappedValue_(rowData, scoreIdx.assignmentId, incomingAssignmentId, colCount);
      _setMappedValue_(rowData, scoreIdx.studentId, incomingStudentId, colCount);
      var access = accessByAssignment[incomingAssignmentId] || {};
      var normalizedScore = normalizeScoreForSave_(s.score, access.maxScore);
      _setMappedValue_(rowData, scoreIdx.score, normalizedScore, colCount);
      _setMappedValue_(rowData, scoreIdx.isSubmitted, normalizedScore === '' ? 0 : (s.isSubmitted ? 1 : 0), colCount);
      _setMappedValue_(rowData, scoreIdx.term, term, colCount);
      _setMappedValue_(rowData, scoreIdx.scoreId, scoreId, colCount);
      return { scoreId: scoreId, assignmentId: incomingAssignmentId, studentId: incomingStudentId, data: rowData };
    };

    if ((payload.scores || []).length === 1 && scoreIdx.scoreId >= 0 && sheet.getLastRow() > 1) {
      const singleScore = (payload.scores || [])[0] || {};
      const singleBuilt = buildScoreRowData(singleScore, mappedColCount);
      if (singleBuilt.assignmentId && singleBuilt.studentId) {
        const access = accessByAssignment[singleBuilt.assignmentId] || { subject: normalizeSubjectCode(payload.subject), level: String(payload.level || ''), room: String(payload.room || '') };
        if (!canAccessClass_(payload.user, access.subject, access.level, access.room, term)) {
          return { success: false, message: 'Access denied' };
        }
        const scoreIdRange = sheet.getRange(2, scoreIdx.scoreId + 1, sheet.getLastRow() - 1, 1);
        const matches = scoreIdRange.createTextFinder(singleBuilt.scoreId).matchEntireCell(true).findAll();
        if (matches.length === 1) {
          const targetRow = matches[0].getRow();
          sheet.getRange(targetRow, 1, 1, mappedColCount).setValues([singleBuilt.data.slice(0, mappedColCount)]);
          try {
            const cache = CacheService.getScriptCache();
            cache.remove('SCORE_GRID_V4_' + term + '_' + singleBuilt.assignmentId);
            cache.remove('SCORE_GRID_V4_' + term + '_' + (access.subject + '_' + access.level + '_' + access.room));
            cache.remove('DASHBOARD_' + term);
          } catch (cacheErr) {
            console.warn('saveScoresBatch fast cache clear failed: ' + cacheErr.message);
          }
          invalidateTermCaches_(term);
          Logger.log('SCORE_SAVE_FAST_UPDATE scoreId=' + singleBuilt.scoreId + ' row=' + targetRow);
            return {
              success: true,
              message: 'Scores Saved',
              inserted: 0,
              updated: 1,
              skipped: 0,
              duplicatesRemoved: 0,
              itemResults: [{ assignmentId: singleBuilt.assignmentId, studentId: singleBuilt.studentId, score: singleBuilt.data[scoreIdx.score], success: true, status: 'updated' }],
              trace: { fastPath: true, scoreId: singleBuilt.scoreId, sheetRow: targetRow, codeSignature: 'scoreid-upsert-v7' }
            };
        }
      }
    }

    const dataRange = sheet.getDataRange();
    const rawValues = dataRange.getValues();
    const displayValues = dataRange.getDisplayValues();
    const headerRow = rawValues[0] || scoreLayout.headers || CONFIG.HEADERS.SCORES;
    const colCount = Math.max(mappedColCount, headerRow.length);

    const padScoreRow = function(row) {
      while (row.length < colCount) row.push('');
      return row.slice(0, colCount);
    };
    const rowValueAt = function(rawRow, displayRow, idx) {
      if (idx < 0) return '';
      const rawValue = rawRow ? rawRow[idx] : '';
      if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') return rawValue;
      return displayRow ? displayRow[idx] : '';
    };
    const makeScoreKeyFromRow = function(rawRow, displayRow) {
      const existingScoreId = String(rowValueAt(rawRow, displayRow, scoreIdx.scoreId) || '').trim();
      if (existingScoreId) return existingScoreId;
      return makeScoreKey(
        rowValueAt(rawRow, displayRow, scoreIdx.term) || term,
        rowValueAt(rawRow, displayRow, scoreIdx.assignmentId),
        rowValueAt(rawRow, displayRow, scoreIdx.studentId)
      );
    };
    const isScoreDataRow = function(row) {
      const assignmentId = String(row[scoreIdx.assignmentId] || '').trim().toLowerCase();
      const studentId = String(row[scoreIdx.studentId] || '').trim().toLowerCase();
      return assignmentId && studentId && assignmentId !== 'assignmentid' && studentId !== 'studentid';
    };
    let inserted = 0, updated = 0, skipped = 0;
    const incomingScoresByKey = new Map();
    const itemResults = [];
    (payload.scores || []).forEach(function(s) {
      const incomingAssignmentId = String(s.assignmentId || '').trim();
      const incomingStudentId = String(s.studentId || '').trim();
      if (!incomingAssignmentId || !incomingStudentId) { skipped++; itemResults.push({ assignmentId: incomingAssignmentId, studentId: incomingStudentId, success: false, status: 'skipped', message: 'Missing identity' }); return; }
      const access = accessByAssignment[incomingAssignmentId] || { subject: normalizeSubjectCode(payload.subject), level: String(payload.level || ''), room: String(payload.room || '') };
      if (!canAccessClass_(payload.user, access.subject, access.level, access.room, term)) { skipped++; itemResults.push({ assignmentId: incomingAssignmentId, studentId: incomingStudentId, success: false, status: 'skipped', message: 'Access denied' }); return; }

      const builtScore = buildScoreRowData(s, colCount);
      const candidate = {
        source: s,
        assignmentId: incomingAssignmentId,
        studentId: incomingStudentId,
        data: padScoreRow(builtScore.data.slice())
      };
      const previous = incomingScoresByKey.get(builtScore.scoreId);
      const candidateScore = candidate.data[scoreIdx.score] === '' ? -1 : Number(candidate.data[scoreIdx.score]);
      const previousScore = previous && previous.data[scoreIdx.score] !== '' ? Number(previous.data[scoreIdx.score]) : -1;
      if (!previous || candidateScore >= previousScore) incomingScoresByKey.set(builtScore.scoreId, candidate);
    });

    // [FIX-SCORE-DEDUP] Build scoreMap keeping LAST occurrence per key (handles pre-existing duplicates)
    const seenForWrite = new Map();
    const duplicateScoreRowIndexes = {};
    for (let i = 1; i < rawValues.length; i++) {
      if (!isScoreDataRow(rawValues[i])) continue;
      const key = makeScoreKeyFromRow(rawValues[i], displayValues[i]);
      if (seenForWrite.has(key)) {
        const previousIndex = seenForWrite.get(key);
        const previousScoreRaw = rowValueAt(rawValues[previousIndex], displayValues[previousIndex], scoreIdx.score);
        const currentScoreRaw = rowValueAt(rawValues[i], displayValues[i], scoreIdx.score);
        const previousScore = previousScoreRaw === '' ? -1 : Number(previousScoreRaw);
        const currentScore = currentScoreRaw === '' ? -1 : Number(currentScoreRaw);
        if (currentScore >= previousScore) {
          duplicateScoreRowIndexes[previousIndex] = true;
          seenForWrite.set(key, i);
        } else {
          duplicateScoreRowIndexes[i] = true;
        }
      } else {
        seenForWrite.set(key, i);
      }
    }

    let duplicatesRemoved = Object.keys(duplicateScoreRowIndexes).length;

    const originalLastRow = sheet.getLastRow();

    if (duplicatesRemoved > 0) {
      // Case A: Rewrite sheet to clear duplicates
      const values = [padScoreRow(headerRow.slice())];
      const writtenIncomingKeys = new Set();
      for (let i = 1; i < rawValues.length; i++) {
        if (!isScoreDataRow(rawValues[i])) continue;
        const key = makeScoreKeyFromRow(rawValues[i], displayValues[i]);
        if (seenForWrite.get(key) !== i) {
          continue;
        }
        if (incomingScoresByKey.has(key)) {
          values.push(padScoreRow(incomingScoresByKey.get(key).data.slice()));
          writtenIncomingKeys.add(key);
          updated++;
        } else {
          const keptRow = padScoreRow(rawValues[i].slice());
          _setMappedValue_(keptRow, scoreIdx.scoreId, key, colCount);
          values.push(keptRow);
        }
      }
      incomingScoresByKey.forEach(function(item, key) {
        if (!writtenIncomingKeys.has(key)) {
          values.push(padScoreRow(item.data.slice()));
          inserted++;
        }
      });

      sheet.getRange(1, 1, values.length, colCount).setValues(values);
      if (originalLastRow > values.length) {
        sheet.getRange(values.length + 1, 1, originalLastRow - values.length, colCount).clearContent();
      }
      Logger.log('SCORE_SAVE_DEDUP_REWRITE originalLastRow=' + originalLastRow + ' finalLastRow=' + sheet.getLastRow());
    } else {
      // Case B: No duplicates, do targeted updates & appends
      const updatesList = [];
      const appendList = [];
      incomingScoresByKey.forEach(function(item, key) {
        if (seenForWrite.has(key)) {
          const sheetRow = seenForWrite.get(key) + 1;
          updatesList.push({ sheetRow: sheetRow, data: item.data });
          updated++;
        } else {
          appendList.push(item.data);
          inserted++;
        }
      });

      // Batch contiguous rows to avoid one Apps Script spreadsheet call per score.
      // Scores are normally stored in assignment/student order, so this reduces
      // a classroom save from hundreds of remote calls to a few range writes.
      updatesList.sort(function(a, b) { return a.sheetRow - b.sheetRow; });
      let updateGroup = [];
      const flushUpdateGroup = function() {
        if (!updateGroup.length) return;
        const firstRow = updateGroup[0].sheetRow;
        sheet.getRange(firstRow, 1, updateGroup.length, colCount)
             .setValues(updateGroup.map(function(item) { return item.data.slice(0, colCount); }));
        updateGroup = [];
      };
      updatesList.forEach(function(upd) {
        if (upd.sheetRow <= 1) return;
        const previous = updateGroup[updateGroup.length - 1];
        if (previous && upd.sheetRow !== previous.sheetRow + 1) flushUpdateGroup();
        updateGroup.push(upd);
      });
      flushUpdateGroup();

      // Appends
      if (appendList.length > 0) {
        const lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, appendList.length, colCount)
             .setValues(appendList.map(function(r) { return r.slice(0, colCount); }));
      }
    }

    var scoreTrace = {
      dbId: ss.getId(),
      scriptId: (function(){ try { return ScriptApp.getScriptId(); } catch(e) { return ''; } })(),
      webAppUrl: (function(){ try { return ScriptApp.getService().getUrl(); } catch(e) { return ''; } })(),
      originalLastRow: originalLastRow,
      finalLastRow: sheet.getLastRow(),
      rawRows: Math.max(0, rawValues.length - 1),
      incomingRecords: (payload.scores || []).length,
      incomingKeys: incomingScoresByKey.size,
      updated: updated,
      inserted: inserted,
      skipped: skipped,
      duplicatesRemoved: duplicatesRemoved,
      keptRows: duplicatesRemoved > 0 ? sheet.getLastRow() : originalLastRow,
      codeSignature: 'scoreid-upsert-v7'
    };
    Logger.log('SCORE_SAVE_SUCCESS inserted=' + inserted + ' updated=' + updated + ' skipped=' + skipped + ' duplicatesRemoved=' + duplicatesRemoved);
    Logger.log('SCORE_SAVE_TRACE ' + JSON.stringify(scoreTrace));

    const scoreGridCacheKeys = {};
    const payloadSubject = normalizeSubjectCode(payload.subject);
    const payloadLevel = String(payload.level || '').trim();
    const payloadRoom = String(payload.room || '').trim();
    if (payloadSubject || payloadLevel || payloadRoom) {
      scoreGridCacheKeys['SCORE_GRID_V4_' + term + '_' + (payloadSubject + '_' + payloadLevel + '_' + payloadRoom)] = true;
    }
    (payload.scores || []).forEach(s => {
      const assignmentId = String(s.assignmentId || '').trim();
      if (!assignmentId) return;
      scoreGridCacheKeys['SCORE_GRID_V4_' + term + '_' + assignmentId] = true;
      const access = accessByAssignment[assignmentId];
      if (access) {
        scoreGridCacheKeys['SCORE_GRID_V4_' + term + '_' + (access.subject + '_' + access.level + '_' + access.room)] = true;
      }
    });
    const scoreGridCacheKeyList = Object.keys(scoreGridCacheKeys);
    if (scoreGridCacheKeyList.length) {
      try {
        CacheService.getScriptCache().removeAll(scoreGridCacheKeyList);
      } catch (cacheErr) {
        console.warn('saveScoresBatch SCORE_GRID cache clear failed: ' + cacheErr.message);
      }
    }
    invalidateTermCaches_(term);

    incomingScoresByKey.forEach(function(item, key) {
      itemResults.push({
        assignmentId: item.assignmentId,
        studentId: item.studentId,
        score: item.data[scoreIdx.score],
        success: true,
        status: seenForWrite.has(key) ? 'updated' : 'inserted'
      });
      var oldScore = '';
      if (seenForWrite.has(key)) {
        var oldRowIndex = seenForWrite.get(key);
        oldScore = rowValueAt(rawValues[oldRowIndex], displayValues[oldRowIndex], scoreIdx.score);
      }
      Logger.log('SCORE_SAVE_ITEM term=' + term + ' subject=' + payloadSubject + ' room=' + payloadRoom + ' studentId=' + item.studentId + ' old=' + oldScore + ' new=' + item.data[scoreIdx.score] + ' result=success time=' + timestamp.toISOString());
    });

    return { success: true, message: "Scores Saved", inserted: inserted, updated: updated, skipped: skipped, duplicatesRemoved: duplicatesRemoved, itemResults: itemResults, trace: scoreTrace };
  } catch(e) { return { success: false, message: e.message }; } finally { if (hasLock) lock.releaseLock(); }
}

function cleanupScoresDuplicates(payload) {
  const lock = LockService.getScriptLock();
  let hasLock = false;
  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) return { success: false, message: 'System busy, retrying' };
    const ss = getDb();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, message: 'No data to clean', before: 0, after: 0, removed: 0 };
    const scoreLayout = _scoreSheetLayout_(sheet);
    const scoreIdx = scoreLayout.indexes;

    const dataRange = sheet.getDataRange();
    const rawValues = dataRange.getValues();
    const displayValues = dataRange.getDisplayValues();
    const headerRow = rawValues[0];
    const before = rawValues.length - 1;
    const colCount = scoreLayout.colCount || Math.max(headerRow.length, CONFIG.HEADERS.SCORES.length);
    const padScoreRow = function(row) {
      while (row.length < colCount) row.push('');
      return row.slice(0, colCount);
    };
    const rowValueAt = function(rawRow, displayRow, idx) {
      if (idx < 0) return '';
      const rawValue = rawRow ? rawRow[idx] : '';
      if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '') return rawValue;
      return displayRow ? displayRow[idx] : '';
    };
    const makeCleanupScoreKey = function(rawRow, displayRow) {
      return String(rowValueAt(rawRow, displayRow, scoreIdx.scoreId) || '').trim() ||
        makeScoreRecordId_(
          rowValueAt(rawRow, displayRow, scoreIdx.term),
          rowValueAt(rawRow, displayRow, scoreIdx.assignmentId),
          rowValueAt(rawRow, displayRow, scoreIdx.studentId)
        );
    };

    // Create backup sheet - abort cleanup if backup fails
    try {
      const backupName = 'Scores_Backup_' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss');
      const backupSheet = ss.insertSheet(backupName);
      backupSheet.getRange(1, 1, rawValues.length, rawValues[0].length).setValues(rawValues);
    } catch (backupErr) {
      Logger.log('SCORE_DUP_CLEANUP backup failed: ' + backupErr.message);
      return { success: false, message: 'Backup failed, cleanup aborted: ' + backupErr.message, before: before, after: before, removed: 0 };
    }

    // Keep last occurrence per term|assignmentId|studentId
    const seenMap = new Map(); // key -> last index in rawValues
    for (let i = 1; i < rawValues.length; i++) {
      const row = rawValues[i];
      if (!row[scoreIdx.assignmentId] || !row[scoreIdx.studentId]) continue;
      const key = makeCleanupScoreKey(row, displayValues[i]);
      seenMap.set(key, i);
    }

    const values = [padScoreRow(headerRow.slice())];
    for (let i = 1; i < rawValues.length; i++) {
      const row = rawValues[i];
      if (!row[scoreIdx.assignmentId] || !row[scoreIdx.studentId]) continue;
      const key = makeCleanupScoreKey(row, displayValues[i]);
      if (seenMap.get(key) === i) {
        const keptRow = padScoreRow(row.slice());
        _setMappedValue_(keptRow, scoreIdx.scoreId, key, colCount);
        values.push(keptRow);
      }
    }

    const after = values.length - 1;
    const removed = before - after;

    sheet.clearContents();
    sheet.getRange(1, 1, values.length, colCount).setValues(values);

    Logger.log('SCORE_DUP_CLEANUP_DONE before=' + before + ' after=' + after + ' removed=' + removed);

    // Invalidate all score caches
    try {
      const cache = CacheService.getScriptCache();
      const keys = [];
      const termsSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TERMS);
      if (termsSheet && termsSheet.getLastRow() > 1) {
        const termRows = termsSheet.getDataRange().getValues();
        for (let t = 1; t < termRows.length; t++) {
          const tId = sanitizeTerm_(String(termRows[t][0] || ''));
          if (tId) keys.push('SCORE_GRID_V4_' + tId + '_all');
        }
      }
      if (keys.length) cache.removeAll(keys);
    } catch (e) { /* non-fatal */ }

    return { success: true, message: 'Cleanup complete', before: before, after: after, removed: removed };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

function saveAssignment(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = getDb();
    const sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ASSIGNMENTS, CONFIG.HEADERS.ASSIGNMENTS);
    const asnLayout = _assignmentSheetLayout_(sheet);
    const asnIdx = asnLayout.indexes;
    const asnColCount = asnLayout.colCount;
    const id = data.id || 'ASN-' + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss");
    const term = sanitizeTerm_(data.term);
    guardTermWritable_(term);
    const writeUser = getEffectiveUser_(data.user);
    if (['student', 'attendance_assistant'].includes(String(writeUser.role || '').toLowerCase())) {
      return { success: false, message: 'Access denied' };
    }
    if (!canAccessClass_(data.user, data.subject, data.level, data.room, term)) {
      return { success: false, message: 'Access denied' };
    }
    
    const allData = sheet.getDataRange().getValues();
    let rowIndex = -1;
    let existingRow = null;
    for(let i=1; i<allData.length; i++) {
      if(String(allData[i][asnIdx.id]).trim() === String(id).trim()) { rowIndex = i + 1; existingRow = allData[i]; break; }
    }

    const createdDate = (rowIndex > -1 && existingRow) ? existingRow[asnIdx.dateCreated] : new Date();
    const rowData = rowIndex > -1 && existingRow ? existingRow.slice() : _blankMappedRow_(asnColCount);
    _setMappedValue_(rowData, asnIdx.id, id, asnColCount);
    _setMappedValue_(rowData, asnIdx.title, data.title, asnColCount);
    _setMappedValue_(rowData, asnIdx.maxScore, data.maxScore, asnColCount);
    _setMappedValue_(rowData, asnIdx.subject, normalizeSubjectCode(data.subject), asnColCount);
    _setMappedValue_(rowData, asnIdx.type, data.type, asnColCount);
    _setMappedValue_(rowData, asnIdx.dateCreated, createdDate, asnColCount);
    _setMappedValue_(rowData, asnIdx.term, term, asnColCount);
    _setMappedValue_(rowData, asnIdx.dueDate, data.dueDate || '', asnColCount);
    _setMappedValue_(rowData, asnIdx.level, data.level || '', asnColCount);
    _setMappedValue_(rowData, asnIdx.room, data.room || '', asnColCount);

    if (rowIndex > -1) sheet.getRange(rowIndex, 1, 1, asnColCount).setValues([rowData.slice(0, asnColCount)]);
    else sheet.appendRow(rowData);
    
    // Invalidate SCORE_GRID caches
    try {
      const cache = CacheService.getScriptCache();
      const subject = normalizeSubjectCode(data.subject);
      const level = String(data.level || '').trim();
      const room = String(data.room || '').trim();
      const classCacheKey = 'SCORE_GRID_V4_' + term + '_' + (subject + '_' + level + '_' + room);
      cache.remove(classCacheKey);
      cache.remove('SCORE_GRID_V4_' + term + '_' + id);
      cache.remove('DASHBOARD_' + term);
    } catch(cacheErr) {
      console.warn('saveAssignment cache clear failed: ' + cacheErr.message);
    }
    
    invalidateTermCaches_(term);
    
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

function deleteAssignment(id, user) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = getDb();
    const sheet = ensureSheet_(ss, CONFIG.SHEET_NAMES.ASSIGNMENTS, CONFIG.HEADERS.ASSIGNMENTS);
    const asnLayout = _assignmentSheetLayout_(sheet);
    const asnIdx = asnLayout.indexes;
    const data = sheet.getDataRange().getValues();
    const writeUser = getEffectiveUser_(user);
    if (String(writeUser.role || '').toLowerCase() === 'student') {
      return { success: false, message: 'Access denied' };
    }
    
    for(let i=1; i<data.length; i++) {
      if(String(data[i][asnIdx.id]) === String(id)) {
        if (!canAccessClass_(user, data[i][asnIdx.subject], data[i][asnIdx.level], data[i][asnIdx.room], data[i][asnIdx.term])) {
          return { success: false, message: 'Access denied' };
        }
        const deletedTerm = sanitizeTerm_(data[i][asnIdx.term]);
        const deletedSubj = normalizeSubjectCode(data[i][asnIdx.subject]);
        const deletedLevel = String(data[i][asnIdx.level] || '').trim();
        const deletedRoom = String(data[i][asnIdx.room] || '').trim();
        
        sheet.deleteRow(i+1);
        const scSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
        if (scSheet && scSheet.getLastRow() > 1) {
          const scoreLayout = _scoreSheetLayout_(scSheet);
          const scoreIdx = scoreLayout.indexes;
          const scData = scSheet.getDataRange().getValues();
          for(let j=scData.length-1; j>=1; j--) {
             if(String(scData[j][scoreIdx.assignmentId]).trim() === String(id).trim()) scSheet.deleteRow(j+1);
          }
        }
        
        // Invalidate SCORE_GRID caches
        try {
          const cache = CacheService.getScriptCache();
          const classCacheKey = 'SCORE_GRID_V4_' + deletedTerm + '_' + (deletedSubj + '_' + deletedLevel + '_' + deletedRoom);
          cache.remove(classCacheKey);
          cache.remove('SCORE_GRID_V4_' + deletedTerm + '_' + id);
          cache.remove('DASHBOARD_' + deletedTerm);
        } catch(cacheErr) {
          console.warn('deleteAssignment cache clear failed: ' + cacheErr.message);
        }
        
        invalidateTermCaches_(deletedTerm);
        return { success: true };
      }
    }
    return { success: false, message: "Not found" };
  } catch(e) { return { success: false, message: e.message }; } finally { lock.releaseLock(); }
}

// --- COMMON & DROPDOWNS ---

function getInitialDropdowns(userOpt) {
  try {
    var started = Date.now();
    var user = getEffectiveUser_(userOpt);
    var role = String(user.role || '').toLowerCase();
    var term = resolveTerm_(userOpt && userOpt.term) || getCurrentTerm() || '1/2569';
    if (role === 'attendance_assistant' && user.id) {
      var resolvedScope = getAttendanceAssistantScopeResolved_(user.id, term);
      if (resolvedScope && resolvedScope.term) term = sanitizeTerm_(resolvedScope.term);
      if (resolvedScope && resolvedScope.scope) user.assistantScope = resolvedScope.scope;
      user.term = term;
    }
    
    Logger.log('getInitialDropdowns SNAPSHOT START term=%s user=%s', term, user.id);
    
    var snapshot = getStudentSyncSnapshot({ term: term, user: user });
    if (!snapshot || !snapshot.success) throw new Error(snapshot ? snapshot.message : 'Snapshot failed');
    
    var ss = getDb();
    var response = { 
      success: true,
      levels: snapshot.levels || [], 
      rooms: snapshot.rooms || [], 
      subjects: snapshot.subjects || [], 
      studentsLite: snapshot.studentsLite || [],
      term: snapshot.term || term,
      combos: getClassCombos_(ss, user, term),
      teacherScopeMissing: role === 'teacher' && snapshot.subjects.length === 0
    };
    
    Logger.log('getInitialDropdowns SNAPSHOT END %sms', Date.now() - started);
    return response;
  } catch (e) {
    Logger.log('getInitialDropdowns ERROR %s', e.toString());
    return { levels: [], rooms: [], subjects: [], term: '1/2569', combos: [], error: e.toString(), message: e.toString(), success: false };
  }
}

function getClassCombos_(ss, user, term) {
  var role = String(user.role || '').toLowerCase();
  var uid = String(user.id || '').trim();
  var combos = [];
  var seen = {};

  if (role === 'admin') {
    var tcSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_CLASSES);
    if (tcSheet && tcSheet.getLastRow() > 1) {
      var rows = tcSheet.getRange(2, 1, tcSheet.getLastRow() - 1, 6).getDisplayValues();
      rows.forEach(function(r) {
        if (!rowTermMatches_(r[4], term)) return;
        if (String(r[5] || '').toLowerCase() !== 'active') return;
        var subject = normalizeSubjectCode(r[1]);
        var level = String(r[2] || '').trim();
        var room = String(r[3] || '').trim();
        if (subject && level && room) {
          var key = subject + '|' + level + '|' + room;
          if (!seen[key]) {
            seen[key] = true;
            combos.push({ subject: subject, level: level, room: room });
          }
        }
      });
    }
  } else if (role === 'teacher') {
    var tcSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_CLASSES);
    if (tcSheet && tcSheet.getLastRow() > 1) {
      var rows = tcSheet.getRange(2, 1, tcSheet.getLastRow() - 1, 6).getDisplayValues();
      rows.forEach(function(r) {
        if (String(r[0]).trim() !== uid) return;
        if (!rowTermMatches_(r[4], term)) return;
        if (String(r[5] || '').toLowerCase() !== 'active') return;
        var subject = normalizeSubjectCode(r[1]);
        var level = String(r[2] || '').trim();
        var room = String(r[3] || '').trim();
        if (subject && level && room) {
          var key = subject + '|' + level + '|' + room;
          if (!seen[key]) {
            seen[key] = true;
            combos.push({ subject: subject, level: level, room: room });
          }
        }
      });
    }
  } else if (role === 'attendance_assistant') {
    var scope = user.assistantScope || [];
    scope.forEach(function(a) {
      if (a.subjectCode && a.level && a.room) {
        var subject = normalizeSubjectCode(a.subjectCode);
        var level = String(a.level).trim();
        var room = String(a.room).trim();
        var key = subject + '|' + level + '|' + room;
        if (!seen[key]) {
          seen[key] = true;
          combos.push({ subject: subject, level: level, room: room });
        }
      }
    });
  }
  return combos;
}

function getStudentSyncSnapshot(payload) {
  var started = Date.now();
  try {
    var term = payload && payload.term ? String(payload.term).trim() : (getCurrentTerm() || '1/2569');
    var userOpt = payload && payload.user ? payload.user : payload;
    var user = getEffectiveUser_(userOpt);
    var uid = String(user.id || 'anonymous').trim();
    var role = String(user.role || '').toLowerCase();
    if (role === 'attendance_assistant' && uid) {
      var resolvedScope = getAttendanceAssistantScopeResolved_(uid, term);
      if (resolvedScope && resolvedScope.term) term = sanitizeTerm_(resolvedScope.term);
      if (resolvedScope && resolvedScope.scope) user.assistantScope = resolvedScope.scope;
      user.term = term;
    }
    
    var versionKey = 'STUDENT_SNAPSHOT_VERSION_' + term;
    var cache = CacheService.getScriptCache();
    var version = cache.get(versionKey) || 'v1';
    var cacheKey = 'STUDENT_SYNC_SNAPSHOT_V4_' + term + '_' + uid + '_' + version;
    
    var cached = getCachedChunked_(cache, cacheKey);
    if (cached) {
      var res = JSON.parse(cached);
      res.meta.cached = true;
      res.meta.ms = Date.now() - started;
      Logger.log('STUDENT_SNAPSHOT cache hit %sms', res.meta.ms);
      return res;
    }
    
    var ss = getDb();
    
    // Read subjects
    var subjects = [];
    var subjectMap = {};
    var subjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    if (subjSheet && subjSheet.getLastRow() > 0) {
      var subjData = subjSheet.getDataRange().getDisplayValues();
      var subjHeaders = subjData[0].map(function(h) { return String(h).trim(); });
      var subjRows = subjData.slice(1);
      
      var idxCode = subjHeaders.indexOf('SubjectCode');
      var idxName = subjHeaders.indexOf('SubjectName');
      var idxTerm = subjHeaders.indexOf('Term');
      var idxStatus = subjHeaders.indexOf('Status');
      
      subjRows.forEach(function(r) {
        var code = idxCode > -1 ? normalizeSubjectCode(r[idxCode]) : normalizeSubjectCode(r[0]);
        if (!code || subjectMap[code]) return;
        
        var rowTerm = idxTerm > -1 ? normalizeTermFast_(r[idxTerm], '') : '';
        // Filter by term
        if (term && rowTerm && rowTerm !== term) return;
        
        var status = idxStatus > -1 ? (r[idxStatus] || 'Active') : 'Active';
        if (status !== 'Active') return; // Only active in dropdowns
        
        var name = idxName > -1 ? (r[idxName] || '') : (r[1] || '');
        var subj = { 
          code: code, 
          name: name,
          term: rowTerm,
          status: status,
          displayLabel: code + ' ' + name
        };
        subjectMap[code] = subj;
        subjects.push(subj);
      });
    }

    // Read students
    var studentsLite = [];
    var levelsSet = new Set();
    var roomsSet = new Set();
    var stuSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (stuSheet && stuSheet.getLastRow() > 1) {
      var stuRows = stuSheet.getRange(2, 1, stuSheet.getLastRow()-1, 11).getDisplayValues();
      stuRows.forEach(function(r) {
        var rowTerm = normalizeTermFast_(r[10], '');
        if (rowTerm && rowTerm !== term) return; // Must match term
        var sid = String(r[0] || '').trim();
        if (!sid) return;
        
        var prefix = String(r[1] || '').trim();
        var icon = normalizeStudentIconByPrefix_(prefix, r[9]);
        
        var level = String(r[4] || '').trim();
        var room = String(r[5] || '').trim();
        
        studentsLite.push({
          id: sid,
          prefix: prefix,
          first: String(r[2] || '').trim(),
          last: String(r[3] || '').trim(),
          level: level,
          room: room,
          no: parseInt(r[6], 10) || 0,
          status: String(r[7] || '').trim(),
          profileImage: String(r[8] || '').trim(),
          imageUrl: String(r[8] || '').trim(),
          icon: icon,
          term: rowTerm || term
        });
        
        if (level) levelsSet.add(level);
        if (room) roomsSet.add(room);
      });
    }
    
    // Filter by role scope
    var finalSubjects = subjects;
    var finalRooms = Array.from(roomsSet);
    var finalLevels = Array.from(levelsSet);
    
    if (role === 'teacher') {
      var tcSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TEACHER_CLASSES);
      var tcLevels = new Set();
      var tcRooms = new Set();
      var tcSubjects = {};
      if (tcSheet && tcSheet.getLastRow() > 1) {
        var tcRows = tcSheet.getRange(2, 1, tcSheet.getLastRow()-1, 6).getDisplayValues();
        tcRows.forEach(function(r) {
          if (String(r[0]).trim() !== uid) return;
          if (!rowTermMatches_(r[4], term)) return;
          if (String(r[5] || '').toLowerCase() !== 'active') return;
          
          if (r[2]) tcLevels.add(String(r[2]).trim());
          if (r[3]) tcRooms.add(String(r[3]).trim());
          var sc = normalizeSubjectCode(r[1]);
          if (sc) tcSubjects[sc] = true;
        });
      }
      finalLevels = Array.from(tcLevels);
      finalRooms = Array.from(tcRooms);
      finalSubjects = subjects.filter(function(s) { return tcSubjects[s.code]; });
      studentsLite = studentsLite.filter(function(s) {
        return _studentAllowedByLiteScope_(s, {
          role: 'teacher',
          hasRows: Object.keys(tcSubjects).length > 0,
          skipScope: false,
          subjects: tcSubjects,
          levels: Array.from(tcLevels).reduce(function(map, item) { map[item] = true; return map; }, {}),
          rooms: Array.from(tcRooms).reduce(function(map, item) { map[item] = true; return map; }, {}),
          combos: {}
        });
      });
    } else if (role === 'attendance_assistant') {
      var assistantScope = getAttendanceAssistantScopeByStudent_(uid, term);
      var asLevels = new Set();
      var asRooms = new Set();
      var asSubjects = {};
      assistantScope.forEach(function(a) {
        if (a.level) asLevels.add(String(a.level));
        if (a.room) asRooms.add(String(a.room));
        if (a.subjectCode) asSubjects[normalizeSubjectCode(a.subjectCode)] = true;
      });
      finalLevels = Array.from(asLevels);
      finalRooms = Array.from(asRooms);
      finalSubjects = subjects.filter(function(s) { return asSubjects[s.code]; });
      studentsLite = studentsLite.filter(function(s) {
        return asLevels.has(String(s.level || '')) && asRooms.has(String(s.room || ''));
      });
    } else if (role === 'student') {
      finalLevels = user.level ? [String(user.level)] : [];
      finalRooms = user.room ? [String(user.room)] : [];
      studentsLite = studentsLite.filter(function(s) { return String(s.id).trim() === uid; });
    }
    
    finalRooms = sortRoomsNumeric_(finalRooms);
    studentsLite = sortStudentsLite_(studentsLite);
    
    var response = {
      success: true,
      term: term,
      levels: finalLevels.sort(),
      rooms: finalRooms,
      subjects: finalSubjects,
      studentsLite: studentsLite,
      totalStudents: studentsLite.length,
      generatedAt: Date.now(),
      meta: {
        cached: false,
        source: 'Students',
        ms: Date.now() - started
      }
    };
    
    putCachedChunked_(cache, cacheKey, JSON.stringify(response), 600);
    Logger.log('STUDENT_SNAPSHOT generation %sms', Date.now() - started);
    return response;
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

function normalizeStudentIconByPrefix_(prefix, icon) {
  var p = String(prefix || '').trim();
  if (p === 'เด็กชาย' || p === 'นาย') return 'fa-person';
  if (p === 'เด็กหญิง' || p === 'นางสาว') return 'fa-person-dress';
  var s = String(icon || '').trim();
  if (s.indexOf('fa-') === 0) return s;
  return 'fa-user-graduate';
}

function sortRoomsNumeric_(rooms) {
  return rooms.sort(function(a, b) {
    return parseInt(a, 10) - parseInt(b, 10) || String(a).localeCompare(String(b));
  });
}

function sortStudentsLite_(students) {
  return students.sort(function(a, b) {
    var l = String(a.level || '').localeCompare(String(b.level || ''));
    if (l !== 0) return l;
    var r = parseInt(a.room, 10) - parseInt(b.room, 10);
    if (r !== 0) return r;
    var n = parseInt(a.no, 10) - parseInt(b.no, 10);
    if (n !== 0) return n;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}


function getDashboardStats(filter) {
  var started = Date.now();
  var term = '';
  var targetDate = '';
  try {
    filter = filter || {};
    term = normalizeTermFast_(filter.term, '') || normalizeTermFast_(resolveTerm_(filter.term), '');
    targetDate = normalizeDateFast_(filter.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    var user = filter.user || null;
    var effectiveUser = getEffectiveUser_(user);
    var uid = String(effectiveUser.id || 'anonymous').trim() || 'anonymous';
    Logger.log('DASH_FAST START term=' + term + ' date=' + targetDate);
    var cache = CacheService.getScriptCache();
    var cacheKey = 'DASH_FAST_V2_' + term + '_' + targetDate + '_' + uid;
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    var ss = getDb();
    var students = _readStudentsLite_(ss, term, user);
    var dashRole = String(effectiveUser.role || '').toLowerCase();
    var dashScope = (dashRole === 'teacher' || dashRole === 'attendance_assistant')
      ? _readTeacherClassScopeLite_(ss, term, user, 1500)
      : { role: dashRole, hasRows: false, skipScope: true, subjects: {}, levels: {}, rooms: {}, combos: {} };
    var attendanceAllowedForDashboard = function(rowSubject, rowLevel, rowRoom, fallbackStudent) {
      if (dashRole === 'admin') return true;
      if (dashRole !== 'teacher' && dashRole !== 'attendance_assistant') return true;
      var subj = normalizeSubjectCode(rowSubject);
      if (!subj) return false;
      return _assignmentAllowedByLiteScope_({
        subject: subj,
        level: String(rowLevel || (fallbackStudent && fallbackStudent.level) || ''),
        room: String(rowRoom || (fallbackStudent && fallbackStudent.room) || '')
      }, dashScope);
    };
    var totalStudents = students.length;
    var studentMap = {};
    for (var s = 0; s < students.length; s++) {
      var sid = String(students[s].id || '').trim();
      if (sid) studentMap[sid] = students[s];
    }
    var asnResult = _readAssignmentsLiteResult_(ss, term, user, 7000);
    var totalAssignments = asnResult.items ? asnResult.items.length : 0;
    var stats = { present: 0, late: 0, leave: 0, absent: 0 };
    var unknownStatus = {};
    var todayStatusByStudent = {};
    var absentByStudent = {};
    var attendanceRows = 0;
    var attSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ATTENDANCE);
    // BUG-005 FIX: declare rows ก่อน if block เพื่อให้ใช้ได้ใน loop ด้านล่าง (บรรทัด classMap loop)
    var rows = [];
    var headers = [], map = {}, idxTimestamp = 0, idxDate = 1, idxSubject = 2, idxLevel = 3, idxRoom = 4, idxStudent = 5, idxStatus = 6, idxTerm = 8;
    if (attSheet && attSheet.getLastRow() > 1) {
      rows = attSheet.getDataRange().getDisplayValues();
      attendanceRows = rows.length - 1;
      headers = rows[0] || [];
      map = _liteHeaderMap_(headers);
      idxTimestamp = _liteIndex_(map, ['timestamp'], 0);
      idxDate = _liteIndex_(map, ['date', 'วันที่'], 1);
      idxSubject = _liteIndex_(map, ['subjectcode', 'subject', 'รายวิชา', 'รหัสวิชา'], 2);
      idxLevel = _liteIndex_(map, ['level', 'ระดับ', 'ชั้น'], 3);
      idxRoom = _liteIndex_(map, ['room', 'ห้อง'], 4);
      idxStudent = _liteIndex_(map, ['studentid', 'รหัส', 'รหัสนักเรียน'], 5);
      idxStatus = _liteIndex_(map, ['status', 'สถานะ'], 6);
      idxTerm = _liteIndex_(map, ['term', 'termid', 'เทอม'], 8);
      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var rowTerm = normalizeTermFast_(r[idxTerm], '');
        if (rowTerm && rowTerm !== term) continue;
        var studentId = String(r[idxStudent] || '').trim();
        if (!studentId || !studentMap[studentId]) continue;
        if (!attendanceAllowedForDashboard(r[idxSubject], r[idxLevel], r[idxRoom], studentMap[studentId])) continue;
        var rowDateRaw = String(r[idxDate] || '').trim() ? r[idxDate] : r[idxTimestamp];
        var rowDate = normalizeDateFast_(rowDateRaw);
        var status = String(r[idxStatus] || '').trim();
        if (status === 'ขาด') absentByStudent[studentId] = (absentByStudent[studentId] || 0) + 1;
        if (rowDate === targetDate) todayStatusByStudent[studentId] = status;
      }
    }
    Object.keys(todayStatusByStudent).forEach(function(studentId) {
      var status = todayStatusByStudent[studentId];
      if (status === 'มา') stats.present++;
      else if (status === 'สาย') stats.late++;
      else if (status === 'ลา') stats.leave++;
      else if (status === 'ขาด') stats.absent++;
      else if (status) unknownStatus[status] = (unknownStatus[status] || 0) + 1;
    });

    var riskAll = [];
    var termSummary = { present: 0, late: 0, leave: 0, absent: 0 };
    Object.keys(absentByStudent).forEach(function(studentId) {
      var absentCount = absentByStudent[studentId];
      termSummary.absent += absentCount;
      if (absentCount > 3) {
        var st = studentMap[studentId] || {};
        var name = String((st.prefix || '') + (st.first || '') + ' ' + (st.last || '')).trim() || studentId;
        riskAll.push({ id: studentId, name: name, level: st.level || '', room: st.room || '', absentCount: absentCount, count: absentCount, status: 'เฝ้าระวัง' });
      }
    });

    // We can compute more term summary if we want but this satisfies the basic need without slow queries.
    // For a real full termSummary, we need to iterate all rows and count all statuses.
    var classMap = {};
    for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var rowTerm = normalizeTermFast_(r[idxTerm], '');
        if (rowTerm && rowTerm !== term) continue;
        var studentId = String(r[idxStudent] || '').trim();
        if (!studentId || !studentMap[studentId]) continue;
        if (!attendanceAllowedForDashboard(r[idxSubject], r[idxLevel], r[idxRoom], studentMap[studentId])) continue;
        
        var st = studentMap[studentId];
        var status = String(r[idxStatus] || '').trim();
        if (status === 'มา') termSummary.present++;
        else if (status === 'สาย') termSummary.late++;
        else if (status === 'ลา') termSummary.leave++;
        
        var classKey = String(st.level || '') + '_' + String(st.room || '');
        if (!classMap[classKey]) classMap[classKey] = { level: st.level, room: st.room, totalStudents: 0, present: 0, late: 0, leave: 0, absent: 0 };
        if (status === 'มา') classMap[classKey].present++;
        else if (status === 'สาย') classMap[classKey].late++;
        else if (status === 'ลา') classMap[classKey].leave++;
        else if (status === 'ขาด') classMap[classKey].absent++;
    }

    var classSummary = Object.keys(classMap).map(k => {
      var c = classMap[k];
      c.totalStudents = students.filter(s => s.level == c.level && s.room == c.room).length;
      var total = c.present + c.late + c.leave + c.absent;
      c.attendanceRate = total > 0 ? Math.round((c.present + c.late) / total * 100) : 0;
      return c;
    }).sort((a,b) => String(a.level).localeCompare(String(b.level)) || parseInt(a.room) - parseInt(b.room));

    riskAll.sort(function(a, b) { return b.absentCount - a.absentCount || String(a.id).localeCompare(String(b.id)); });

    var response = {
      success: true,
      totalStudents: totalStudents,
      presentToday: stats.present,
      totalAssignments: totalAssignments,
      riskStudents: riskAll.length,
      stats: stats,
      termSummary: termSummary,
      classSummary: classSummary,
      assignmentSummary: asnResult.items || [],
      riskList: riskAll.slice(0, 10),
      teacherScopeMissing: teacherScopeMissing_(user, term),
      debug: { term: term, date: targetDate, attendanceRows: attendanceRows, todayRecords: Object.keys(todayStatusByStudent).length, unknownStatus: unknownStatus, ms: Date.now() - started }
    };
    _safeCachePut_(cache, cacheKey, response);
    Logger.log('DASH_FAST END students=' + totalStudents + ' assignments=' + totalAssignments + ' risk=' + riskAll.length + ' ms=' + (Date.now() - started));
    return response;
  } catch (err) {
    Logger.log('DASH_FAST ERROR term=' + term + ' date=' + targetDate + ' err=' + String(err));
    return { success: false, message: String(err), totalStudents: 0, presentToday: 0, totalAssignments: 0, riskStudents: 0, stats: { present: 0, late: 0, leave: 0, absent: 0 }, termSummary: {}, classSummary: [], assignmentSummary: [], riskList: [], debug: { term: term, date: targetDate, ms: Date.now() - started } };
  }
}

function getDashboardStateFast(filter) {
  return getDashboardStats(filter);
}

// --- STUDENT PORTAL SYNC (DIRECT) ---

function getStudentModeData(studentId, userOpt) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000); 
    const ss = getDb();
    const term = getActiveTerm_();
    const targetId = String(studentId).trim();
    const accessUser = userOpt || { id: targetId, role: 'student' };
    if (!canAccessStudent_(accessUser, targetId, term)) {
      return { success: false, message: 'Access denied' };
    }
    const cacheKey = 'STUDENT_MODE_' + term + '_' + targetId;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
    
    // 1. Profile
    const sSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    const sData = sSheet.getDataRange().getValues();
    let profile = null;
    for (let i = 1; i < sData.length; i++) {
        if (String(sData[i][0]).trim() === targetId && rowTermMatches_(sData[i][10], term)) {
            profile = {
	                id: sData[i][0], prefix: sData[i][1], first: sData[i][2], last: sData[i][3],
	                level: sData[i][4], room: sData[i][5], no: sData[i][6],
	                imageUrl: sData[i][8], status: sData[i][7], term: sanitizeTerm_(sData[i][10])
	            };
            break;
        }
    }
    if (!profile) return { success: false, message: "ไม่พบข้อมูลนักเรียน" };

    // 2. Scores & Assignments (Direct)
    const aSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ASSIGNMENTS);
    const scSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
    
    const assignments = [];
    if (aSheet && aSheet.getLastRow() > 1) {
        const asnLayout = _assignmentSheetLayout_(aSheet);
        const asnIdx = asnLayout.indexes;
        const aData = aSheet.getDataRange().getValues();
        for(let i=1; i<aData.length; i++) {
            const r = aData[i];
            if (rowTermMatches_(r[asnIdx.term], term)) {
                 const rLevel = String(r[asnIdx.level]||"");
                 const rRoom = String(r[asnIdx.room]||"");
                 if ((!rLevel || rLevel === String(profile.level)) && (!rRoom || rRoom === String(profile.room))) {
                     assignments.push({ 
                         id: r[asnIdx.id], title: r[asnIdx.title], maxScore: r[asnIdx.maxScore], 
                         subject: r[asnIdx.subject], type: r[asnIdx.type], dueDate: formatDate(r[asnIdx.dueDate]) 
                     });
                 }
            }
        }
    }
    
    const myScores = {};
    if (scSheet && scSheet.getLastRow() > 1) {
        const scoreLayout = _scoreSheetLayout_(scSheet);
        const scoreIdx = scoreLayout.indexes;
        const scData = scSheet.getDataRange().getValues();
        for(let i=1; i<scData.length; i++) {
            const r = scData[i];
            if (String(r[scoreIdx.studentId]).trim() === targetId && rowTermMatches_(r[scoreIdx.term], term)) {
                myScores[`${r[scoreIdx.assignmentId]}_${targetId}`] = { score: r[scoreIdx.score], isSubmitted: r[scoreIdx.isSubmitted] };
            }
        }
    }

    // 3. Attendance (Direct)
    const attSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ATTENDANCE);
    const attendance = [];
    if (attSheet && attSheet.getLastRow() > 1) {
        const attData = attSheet.getDataRange().getValues();
        for (let i = attData.length - 1; i >= 1; i--) {
            const r = attData[i];
            if (String(r[5]).trim() === targetId && rowTermMatches_(r[8], term)) {
                attendance.push({
                    date: formatDate(r[1]),
                    subject: r[2],
                    status: r[6]
                });
            }
        }
    }

    // 4. Subject Map
    const subjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    const subjectMap = {};
    const allowedSubjectMap = {};
    assignments.forEach(a => { if (a.subject) allowedSubjectMap[normalizeSubjectCode(a.subject)] = true; });
    attendance.forEach(a => { if (a.subject) allowedSubjectMap[normalizeSubjectCode(a.subject)] = true; });
    if (subjSheet && subjSheet.getLastRow() > 0) {
        const sData = subjSheet.getDataRange().getValues();
        const sHeaders = sData[0].map(h => String(h).trim());
        const sRows = sData.slice(1);
        const idxCode = sHeaders.indexOf('SubjectCode') === -1 ? 0 : sHeaders.indexOf('SubjectCode');
        const idxName = sHeaders.indexOf('SubjectName') === -1 ? 1 : sHeaders.indexOf('SubjectName');
        const idxTeacher = sHeaders.indexOf('Teacher') === -1 ? 2 : sHeaders.indexOf('Teacher');
        
        for(let i=0; i<sRows.length; i++) {
            const row = sRows[i];
            const code = normalizeSubjectCode(row[idxCode]);
            if (!allowedSubjectMap[code]) continue;
            subjectMap[code] = {
                name: row[idxName] || '',
                teacher: row[idxTeacher] || ''
            };
        }
    }

    const result = {
        success: true,
        data: {
            profile: profile,
            assignments: assignments,
            scores: myScores, 
            attendance: attendance,
            term: term,
            subjectMap: subjectMap
        }
    };
    cache.put(cacheKey, JSON.stringify(result), 300);
    return result;

  } catch (e) {
    return { success: false, message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// --- [ADD] GOOGLE SHEETS GENERATOR (NEW - FOLDER SAVE SUPPORT) ---

// 1. Create Student List Sheet
function createStudentSheet(data) {
  try {
    const { level, room, term, folderId } = data;
    
    const targetLevel = String(level).trim();
    const targetRoom = String(room).trim();
    const targetTerm = sanitizeTerm_(term);
    if (!canAccessClass_(data.user, '', targetLevel, targetRoom, targetTerm)) {
      return { success: false, message: 'Access denied' };
    }

    // ---- เร่งความเร็ว: สร้างใน Folder ตั้งแต่แรก ไม่ต้อง moveTo ----
    const fileName = `รายชื่อนักเรียน_${targetLevel}_${targetRoom}_${targetTerm.replace('/','-')}`;
    
    // หา Folder ID: ใช้จาก argument ก่อน → ถ้าไม่มีใช้จาก Config
    const targetFolderId = (folderId && String(folderId).trim()) 
      ? String(folderId).trim() 
      : getActiveFolderId_();
    
    let ss;
    ss = SpreadsheetApp.create(fileName);
    if (targetFolderId) {
      try {
        const folder = DriveApp.getFolderById(targetFolderId);
        const file = DriveApp.getFileById(ss.getId());
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch(e) {
        console.warn('Folder move error: ' + e.message);
      }
    }
    // ---------------------------------------------------------------

    const sheet = ss.getSheets()[0];
    sheet.setName('รายชื่อนักเรียน');
    
    sheet.appendRow(["ลำดับ", "รหัสประจำตัว", "คำนำหน้า", "ชื่อ", "นามสกุล", "ระดับชั้น", "ห้อง", "สถานะ"]);
    sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#4e73df").setFontColor("white");

    const db = getDb().getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (!db) throw new Error("ไม่พบชีท Students");

    const rows = db.getDataRange().getValues();
    const students = [];
    
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (String(r[4]).trim() === targetLevel && String(r[5]).trim() === targetRoom && sanitizeTerm_(r[10]) === targetTerm) {
        students.push([r[6], r[0], r[1], r[2], r[3], r[4], r[5], r[7]]);
      }
    }
    
    students.sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0));

    if (students.length > 0) {
      sheet.getRange(2, 2, students.length, 1).setNumberFormat("@");
      sheet.getRange(2, 1, students.length, 8).setValues(students);
    }
    
    // ปิด autoResizeColumns เพื่อความรวดเร็ว
    // sheet.autoResizeColumns(1, 8);
    
    // บันทึก Folder ID ที่ใช้ลง Config ถ้ามี
    if (targetFolderId) saveFolderIdToConfig_(targetFolderId);
    
    return { success: true, url: ss.getUrl(), folderId: targetFolderId };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// 2. Create Score Sheet (Advanced: Dual Mode - Check & Score)
function createScoreSheet(data) {
  try {
    const { level, room, subject, term } = data;

    // Normalize Input
    const targetLevel = String(level).trim();
    const targetRoom = String(room).trim();
    const targetSubject = normalizeSubjectCode(subject); 
    const targetTerm = sanitizeTerm_(term);
    if (!canAccessClass_(data.user, targetSubject, targetLevel, targetRoom, targetTerm)) {
      return { success: false, message: 'Access denied' };
    }

    // Get DB
    const ssDb = getDb();
    const asnSheet = ssDb.getSheetByName(CONFIG.SHEET_NAMES.ASSIGNMENTS);
    const scoreSheet = ssDb.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
    const studentSheet = ssDb.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    const asnLayout = _assignmentSheetLayout_(asnSheet);
    const asnIdx = asnLayout.indexes;

    // 1. Filter Assignments & Get Type
    const asnRows = asnSheet.getDataRange().getValues();
    const assignments = [];
    for(let i=1; i<asnRows.length; i++) {
       const r = asnRows[i];
       const rowSubj = normalizeSubjectCode(r[asnIdx.subject]);
       const rowTerm = sanitizeTerm_(r[asnIdx.term]);
       const rowLevel = String(r[asnIdx.level] || "").trim();
       const rowRoom = String(r[asnIdx.room] || "").trim();
       const rowType = r[asnIdx.type]; 

       const isLevelMatch = (rowLevel === "" || rowLevel === targetLevel);
       const isRoomMatch = (rowRoom === "" || rowRoom === targetRoom);

       if (rowSubj === targetSubject && rowTerm === targetTerm && isLevelMatch && isRoomMatch) {
           assignments.push({ 
               id: r[asnIdx.id], 
               title: r[asnIdx.title], 
               max: r[asnIdx.maxScore], 
               type: rowType 
           });
       }
    }

    // 2. Filter Students
    const stdRows = studentSheet.getDataRange().getValues();
    const students = [];
    for(let i=1; i<stdRows.length; i++) {
        const r = stdRows[i];
        const rowLevel = String(r[4]).trim();
        const rowRoom = String(r[5]).trim();
        const rowTerm = sanitizeTerm_(r[10]);

        if (rowLevel === targetLevel && rowRoom === targetRoom && rowTerm === targetTerm) {
            students.push({ id: String(r[0]).trim(), name: `${r[1]}${r[2]} ${r[3]}`, no: r[6] });
        }
    }
    students.sort((a,b) => (parseInt(a.no)||0) - (parseInt(b.no)||0));

    // 3. Get Scores Map
    const scoreMap = {};
    if (scoreSheet && scoreSheet.getLastRow() > 1) {
        const scoreLayout = _scoreSheetLayout_(scoreSheet);
        const scoreIdx = scoreLayout.indexes;
        const scoreRows = scoreSheet.getDataRange().getValues();
        for(let i=1; i<scoreRows.length; i++) {
            const r = scoreRows[i];
            const rowTerm = sanitizeTerm_(r[scoreIdx.term]);
            if (rowTerm === targetTerm) {
                scoreMap[`${r[scoreIdx.assignmentId]}_${String(r[scoreIdx.studentId]).trim()}`] = {
                    score: r[scoreIdx.score],
                    isSubmitted: r[scoreIdx.isSubmitted]
                };
            }
        }
    }

    // ---- เร่งความเร็ว: สร้างใน Folder ตั้งแต่แรก ----
    const fileName = `คะแนน_${targetSubject}_${targetLevel}_${targetRoom}_${targetTerm.replace('/','-')}`;
    const targetFolderId = (data.folderId && String(data.folderId).trim())
      ? String(data.folderId).trim()
      : getActiveFolderId_();

    let ssOut;
    ssOut = SpreadsheetApp.create(fileName);
    if (targetFolderId) {
      try {
        const folder = DriveApp.getFolderById(targetFolderId);
        const file = DriveApp.getFileById(ssOut.getId());
        folder.addFile(file);
        DriveApp.getRootFolder().removeFile(file);
      } catch(e) {
        console.warn('Folder move error: ' + e.message);
      }
    }
    const sheet = ssOut.getSheets()[0];
    // --------------------------------------------------

    // Build Header
    const header = ["เลขที่", "รหัส", "ชื่อ-สกุล"];
    assignments.forEach(a => {
        if (a.type === 'Check') {
            header.push(`${a.title} (ส่ง)`);
        } else {
            header.push(`${a.title} (${a.max})`);
        }
    });
    header.push("รวมคะแนน");
    header.push("รวมงาน(ชิ้น)");

    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length)
         .setFontWeight("bold")
         .setBackground("#4e73df")
         .setFontColor("white")
         .setHorizontalAlignment("center");

    // Build Rows
    const outputRows = [];
    students.forEach(std => {
        const row = [std.no, std.id, std.name];
        let totalScore = 0;
        let totalChecks = 0;

        assignments.forEach(asn => {
            const data = scoreMap[`${asn.id}_${std.id}`];
            let cellVal = "";

            if (asn.type === 'Check') {
                const scoreValue = data ? data.score : "";
                const isSubmitted = (data && (data.isSubmitted == 1 || String(data.isSubmitted).toLowerCase() === 'true' || (scoreValue !== "" && scoreValue !== null && !isNaN(Number(scoreValue)) && Number(scoreValue) > 0)));
                if (isSubmitted) {
                    cellVal = "ส่ง"; 
                    totalChecks++;
                }
            } else {
                const rawScore = (data) ? data.score : "";
                if (rawScore !== "" && rawScore !== null) {
                    cellVal = Number(rawScore);
                    totalScore += cellVal;
                }
            }
            row.push(cellVal);
        });

        row.push(totalScore);  
        row.push(totalChecks); 
        outputRows.push(row);
    });

    if (outputRows.length > 0) {
        sheet.getRange(2, 2, outputRows.length, 1).setNumberFormat("@");
        sheet.getRange(2, 1, outputRows.length, header.length).setValues(outputRows);
        sheet.getRange(2, 1, outputRows.length, 2).setHorizontalAlignment("center"); 
        if (header.length > 3) {
            sheet.getRange(2, 4, outputRows.length, header.length - 3).setHorizontalAlignment("center");
        }
    }
    
    // ปิด autoResizeColumns เพื่อหลีกเลี่ยงคอขวดที่ทำให้ช้า
    // sheet.autoResizeColumns(1, header.length);
    
    if (targetFolderId) saveFolderIdToConfig_(targetFolderId);
    return { success: true, url: ssOut.getUrl(), folderId: targetFolderId };

  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// Helper: ดึง Folder ID ที่บันทึกไว้ใน Config Sheet
function getActiveFolderId_() {
  try {
    const ss = getDb();
    const configSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
    if (!configSheet) return CONFIG.FOLDER_ID || '';
    const data = configSheet.getDataRange().getValues();
    const row = data.find(r => r[0] === 'EXPORT_FOLDER_ID');
    if (row && row[1]) return String(row[1]).trim();
    return CONFIG.FOLDER_ID || '';
  } catch(e) {
    return CONFIG.FOLDER_ID || '';
  }
}

// Helper: บันทึก Folder ID ที่ user เลือกลง Config Sheet
function saveFolderIdToConfig_(folderId) {
  try {
    const ss = getDb();
    const configSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
    if (!configSheet) return;
    const data = configSheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === 'EXPORT_FOLDER_ID') {
        configSheet.getRange(i + 1, 2).setValue(folderId);
        return;
      }
    }
    // ถ้ายังไม่มี row นี้ ให้ append
    configSheet.appendRow(['EXPORT_FOLDER_ID', folderId]);
  } catch(e) {
    console.warn('saveFolderIdToConfig_ error:', e.message);
  }
}

// ให้ frontend เรียกดู Folder ID ที่บันทึกไว้
function getSavedFolderId() {
  return { success: true, folderId: getActiveFolderId_() };
}

// ให้ frontend ตรวจสอบว่า Folder ID ที่พิมพ์มาถูกต้องมั้ย
function validateFolderId(folderId) {
  try {
    const folder = DriveApp.getFolderById(String(folderId).trim());
    return { success: true, folderName: folder.getName(), folderId: folder.getId(), folderUrl: folder.getUrl() };
  } catch(e) {
    return { success: false, message: 'ไม่พบโฟลเดอร์นี้ กรุณาตรวจสอบ ID อีกครั้ง' };
  }
}

function validateFolder(folderId) {
  return validateFolderId(folderId);
}

function saveFolderSetting(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    payload = payload || {};
    var admin = requireAdmin_(payload.user || payload.admin || payload.token);
    var folderId = String(payload.folderId || payload.id || '').trim();
    if (!folderId) throw new Error('Folder ID is required');
    var check = validateFolderId(folderId);
    if (!check.success) return check;
    setSystemSetting_('system_folder_id', folderId);
    saveFolderIdToConfig_(folderId);
    invalidateTermCaches_(getCurrentTerm());
    _clearAdminSettingsCache(getCurrentTerm(), admin);
    logAudit_(admin.id, 'SAVE_FOLDER_SETTING', folderId, check.folderName || '', getCurrentTerm());
    return { success: true, folderId: folderId, folderName: check.folderName, folderUrl: check.folderUrl };
  } catch (e) {
    return { success: false, message: e.message || e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function _liteHeaderMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').trim().toLowerCase();
    if (key) map[key] = i;
  }
  return map;
}

function _liteIndex_(map, names, fallback) {
  for (var i = 0; i < names.length; i++) {
    var key = String(names[i] || '').trim().toLowerCase();
    if (map[key] !== undefined) return map[key];
  }
  return fallback;
}

function _ensureHeaderGroups_(sheet, headerGroups) {
  if (!sheet) throw new Error('Sheet not found');
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(headerGroups.map(function(group) { return group.canonical; }));
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  var map = _liteHeaderMap_(headers);
  var missing = [];

  headerGroups.forEach(function(group) {
    var idx = _liteIndex_(map, group.aliases || [group.canonical], -1);
    if (idx < 0) {
      missing.push(group.canonical);
      map[String(group.canonical).trim().toLowerCase()] = headers.length + missing.length - 1;
    }
  });

  if (missing.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, headers.length + 1, 1, missing.length).setFontWeight('bold').setBackground('#e2e8f0');
    headers = headers.concat(missing);
    map = _liteHeaderMap_(headers);
  }

  var indexes = {};
  headerGroups.forEach(function(group) {
    indexes[group.key] = _liteIndex_(map, group.aliases || [group.canonical], -1);
  });

  return { headers: headers, indexes: indexes, colCount: headers.length };
}

function _scoreSheetLayout_(sheet) {
  return _ensureHeaderGroups_(sheet, [
    { key: 'timestamp', canonical: 'Timestamp', aliases: ['timestamp', 'datecreated', 'createdat'] },
    { key: 'assignmentId', canonical: 'AssignmentID', aliases: ['assignmentid', 'assignment', 'id'] },
    { key: 'studentId', canonical: 'StudentID', aliases: ['studentid', 'รหัส', 'รหัสนักเรียน'] },
    { key: 'score', canonical: 'Score', aliases: ['score', 'คะแนน'] },
    { key: 'isSubmitted', canonical: 'IsSubmitted', aliases: ['issubmitted', 'submitted', 'ส่งแล้ว', 'ส่งงาน'] },
    { key: 'term', canonical: 'Term', aliases: ['term', 'termid', 'เทอม', 'ภาคเรียน'] },
    { key: 'scoreId', canonical: 'ScoreID', aliases: ['scoreid', 'score_id', 'recordid', 'record_id', 'id', 'รหัสคะแนน'] }
  ]);
}

function _assignmentSheetLayout_(sheet) {
  return _ensureHeaderGroups_(sheet, [
    { key: 'id', canonical: 'AssignmentID', aliases: ['assignmentid', 'id', 'รหัสงาน'] },
    { key: 'title', canonical: 'Title', aliases: ['title', 'ชื่องาน', 'งาน'] },
    { key: 'maxScore', canonical: 'MaxScore', aliases: ['maxscore', 'คะแนนเต็ม'] },
    { key: 'subject', canonical: 'SubjectCode', aliases: ['subjectcode', 'subject', 'รายวิชา', 'รหัสวิชา'] },
    { key: 'type', canonical: 'Type', aliases: ['type', 'ประเภท'] },
    { key: 'dateCreated', canonical: 'DateCreated', aliases: ['datecreated', 'createdat'] },
    { key: 'term', canonical: 'Term', aliases: ['term', 'termid', 'เทอม', 'ภาคเรียน'] },
    { key: 'dueDate', canonical: 'DueDate', aliases: ['duedate', 'กำหนดส่ง'] },
    { key: 'level', canonical: 'Level', aliases: ['level', 'ระดับ', 'ชั้น'] },
    { key: 'room', canonical: 'Room', aliases: ['room', 'ห้อง'] }
  ]);
}

function _attendanceSheetLayout_(sheet) {
  return _ensureHeaderGroups_(sheet, [
    { key: 'timestamp', canonical: 'Timestamp', aliases: ['timestamp', 'datecreated', 'createdat'] },
    { key: 'date', canonical: 'Date', aliases: ['date', 'วันที่'] },
    { key: 'subject', canonical: 'SubjectCode', aliases: ['subjectcode', 'subject', 'รายวิชา', 'รหัสวิชา'] },
    { key: 'level', canonical: 'Level', aliases: ['level', 'ระดับ', 'ชั้น'] },
    { key: 'room', canonical: 'Room', aliases: ['room', 'ห้อง'] },
    { key: 'studentId', canonical: 'StudentID', aliases: ['studentid', 'รหัส', 'รหัสนักเรียน'] },
    { key: 'status', canonical: 'Status', aliases: ['status', 'สถานะ'] },
    { key: 'recorder', canonical: 'Recorder', aliases: ['recorder', 'ผู้บันทึก'] },
    { key: 'term', canonical: 'Term', aliases: ['term', 'termid', 'เทอม', 'ภาคเรียน'] },
    { key: 'note', canonical: 'Note', aliases: ['note', 'หมายเหตุ'] },
    { key: 'recordId', canonical: 'RecordID', aliases: ['recordid', 'record_id', 'id', 'รหัสรายการ'] }
  ]);
}

function _attendanceAssistantSheetLayout_(sheet) {
  return _ensureHeaderGroups_(sheet, [
    { key: 'assistantId', canonical: 'AssistantID', aliases: ['assistantid', 'assistant_id', 'recordid', 'record_id', 'id', 'รหัสผู้ช่วย'] },
    { key: 'studentId', canonical: 'AssistantStudentID', aliases: ['assistantstudentid', 'studentid', 'รหัสนักเรียน', 'ผู้ช่วย'] },
    { key: 'subject', canonical: 'SubjectCode', aliases: ['subjectcode', 'subject', 'รายวิชา', 'รหัสวิชา'] },
    { key: 'level', canonical: 'Level', aliases: ['level', 'ระดับ', 'ชั้น'] },
    { key: 'room', canonical: 'Room', aliases: ['room', 'ห้อง'] },
    { key: 'term', canonical: 'TermID', aliases: ['termid', 'term', 'เทอม', 'ภาคเรียน'] },
    { key: 'status', canonical: 'Status', aliases: ['status', 'สถานะ'] },
    { key: 'assignedBy', canonical: 'AssignedBy', aliases: ['assignedby', 'createdby', 'ผู้กำหนด'] },
    { key: 'updatedAt', canonical: 'UpdatedAt', aliases: ['updatedat', 'timestamp', 'แก้ไขล่าสุด'] }
  ]);
}

function _normalizeAttendanceAssistantSheet_(sheet) {
  var layout = _attendanceAssistantSheetLayout_(sheet);
  var idx = layout.indexes;
  var colCount = layout.colCount;
  if (!sheet || sheet.getLastRow() < 2) return layout;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();
  var seen = {};
  var deleteRows = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var row = rows[i];
    var studentId = String(row[idx.studentId] || '').trim();
    var subject = normalizeSubjectCode(row[idx.subject]);
    var level = String(row[idx.level] || '').trim();
    var room = String(row[idx.room] || '').trim();
    var term = sanitizeTerm_(row[idx.term]);
    if (!studentId || !subject || !level || !room || !term) continue;
    var assistantId = String(row[idx.assistantId] || '').trim() || makeAttendanceAssistantId_(term, subject, level, room, studentId);
    if (seen[assistantId]) {
      deleteRows.push(i + 2);
      continue;
    }
    seen[assistantId] = true;
    if (String(row[idx.assistantId] || '').trim() !== assistantId) {
      sheet.getRange(i + 2, idx.assistantId + 1).setValue(assistantId);
    }
  }
  deleteRows.sort(function(a, b) { return b - a; }).forEach(function(rowNo) { sheet.deleteRow(rowNo); });
  return _attendanceAssistantSheetLayout_(sheet);
}

function _blankMappedRow_(colCount) {
  var row = [];
  while (row.length < colCount) row.push('');
  return row;
}

function _setMappedValue_(row, idx, value, colCount) {
  while (row.length < colCount) row.push('');
  if (idx >= 0) row[idx] = value;
}

function _readTeacherClassScopeLite_(ss, normalizedTerm, user, maxMs) {
  var started = Date.now();
  var effectiveUser = getEffectiveUser_(user);
  var role = String(effectiveUser.role || '').toLowerCase();
  var scope = { role: role, hasRows: false, skipScope: role === 'admin', subjects: {}, levels: {}, rooms: {}, combos: {} };
  if ((role !== 'teacher' && role !== 'attendance_assistant') || !effectiveUser.id) return scope;
  try {
    var isAssistant = role === 'attendance_assistant';
    var sheet = ss.getSheetByName(isAssistant ? CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS : CONFIG.SHEET_NAMES.TEACHER_CLASSES);
    if (!sheet || sheet.getLastRow() < 2) return scope;
    var assistantLayout = isAssistant ? _attendanceAssistantSheetLayout_(sheet) : null;
    var assistantIdx = assistantLayout ? assistantLayout.indexes : null;
    var colCount = isAssistant ? assistantLayout.colCount : 6;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, colCount).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (Date.now() - started > (maxMs || 1500)) {
        scope.skipScope = true;
        Logger.log('readTeacherClassScopeLite timeout skip scope ms=' + (Date.now() - started));
        return scope;
      }
      var rowUser = isAssistant ? rows[i][assistantIdx.studentId] : rows[i][0];
      var rowSubjectValue = isAssistant ? rows[i][assistantIdx.subject] : rows[i][1];
      var rowLevelValue = isAssistant ? rows[i][assistantIdx.level] : rows[i][2];
      var rowRoomValue = isAssistant ? rows[i][assistantIdx.room] : rows[i][3];
      var rowTermValue = isAssistant ? rows[i][assistantIdx.term] : rows[i][4];
      var rowStatusValue = isAssistant ? rows[i][assistantIdx.status] : rows[i][5];
      if (String(rowUser || '').trim() !== String(effectiveUser.id).trim()) continue;
      if (!rowTermMatches_(rowTermValue, normalizedTerm)) continue;
      if (String(rowStatusValue || '').toLowerCase() !== 'active') continue;
      scope.hasRows = true;
      var subject = normalizeSubjectCode(rowSubjectValue);
      var level = String(rowLevelValue || '').trim();
      var room = String(rowRoomValue || '').trim();
      if (subject) scope.subjects[subject] = true;
      if (level) scope.levels[level] = true;
      if (room) scope.rooms[room] = true;
      scope.combos[subject + '|' + level + '|' + room] = true;
    }
  } catch (err) {
    Logger.log('readTeacherClassScopeLite error ' + String(err));
    scope.skipScope = true;
  }
  return scope;
}

function _studentAllowedByLiteScope_(student, scope) {
  if (!scope || scope.role === 'admin') return true;
  if (scope.role === 'student') return true;
  if ((scope.role === 'teacher' || scope.role === 'attendance_assistant') && (scope.skipScope || !scope.hasRows)) return false;
  var level = String(student.level || '').trim();
  var room = String(student.room || '').trim();
  if (scope.combos) {
    var keys = Object.keys(scope.combos);
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split('|');
      if (isSameClass_(level, room, parts[1] || '', parts[2] || '')) return true;
    }
  }
  var hasLevel = Object.keys(scope.levels || {}).some(function(k) { return isSameLevel_(k, level); });
  var normRoom = parseLevelRoomForCompare_("", room).room;
  var hasRoom = Object.keys(scope.rooms || {}).some(function(k) {
    return parseLevelRoomForCompare_("", k).room === normRoom;
  });
  return hasLevel && hasRoom;
}

function _assignmentAllowedByLiteScope_(assignment, scope) {
  if (!scope || scope.role === 'admin') return true;
  if ((scope.role === 'teacher' || scope.role === 'attendance_assistant') && (scope.skipScope || !scope.hasRows)) return false;
  var subject = normalizeSubjectCode(assignment.subject || '');
  var level = String(assignment.level || '').trim();
  var room = String(assignment.room || '').trim();
  if (subject) {
    var hasSubj = Object.keys(scope.subjects || {}).some(function(k) { return normalizeSubjectCode(k) === subject; });
    if (!hasSubj) return false;
  }
  if (level) {
    var hasLevel = Object.keys(scope.levels || {}).some(function(k) { return isSameLevel_(k, level); });
    if (!hasLevel) return false;
  }
  if (room) {
    var normRoom = parseLevelRoomForCompare_("", room).room;
    var hasRoom = Object.keys(scope.rooms || {}).some(function(k) {
      return parseLevelRoomForCompare_("", k).room === normRoom;
    });
    if (!hasRoom) return false;
  }
  return true;
}

function _sheetDebugLite_(ss, sheetName, termNames, termFallbackIndex) {
  var debug = { sheet: sheetName, found: false, rows: 0, cols: 0, header: [], termHeader: '', sampleTerm: '' };
  try {
    var sheet = ss.getSheetByName(sheetName);
    debug.found = !!sheet;
    if (!sheet) return debug;
    debug.rows = sheet.getLastRow();
    debug.cols = sheet.getLastColumn();
    if (debug.rows < 1 || debug.cols < 1) return debug;
    var header = sheet.getRange(1, 1, 1, debug.cols).getValues()[0] || [];
    debug.header = header.map(function(h) { return String(h || ''); });
    var map = _liteHeaderMap_(header);
    var termIdx = _liteIndex_(map, termNames || ['term', 'termid'], termFallbackIndex || 0);
    debug.termHeader = String(header[termIdx] || '');
    if (debug.rows > 1) {
      debug.sampleTerm = String(sheet.getRange(2, termIdx + 1).getValue() || '');
    }
  } catch (err) {
    debug.error = String(err);
  }
  return debug;
}

function _readStudentsLiteResult_(ss, normalizedTerm, user) {
  var startMs = Date.now();
  var effectiveUser = getEffectiveUser_(user);
  var role = String(effectiveUser.role || '').toLowerCase();
  var uid = String(effectiveUser.id || 'anonymous').trim() || 'anonymous';
  var cache = CacheService.getScriptCache();
  var versionKey = 'STUDENT_SNAPSHOT_VERSION_' + normalizedTerm;
  var version = cache.get(versionKey) || 'v1';

  var scope = (role === 'teacher' || role === 'attendance_assistant')
    ? _readTeacherClassScopeLite_(ss, normalizedTerm, user, 1500)
    : { role: role, hasRows: false, skipScope: true, subjects: {}, levels: {}, rooms: {}, combos: {} };

  var cacheKey = 'STUDENTS_LITE_V12_' + normalizedTerm + '_' + uid + '_' + role + '_' + version;
  if (role === 'attendance_assistant' && scope && scope.combos) {
    var fingerprint = Object.keys(scope.combos).sort().join(',');
    cacheKey += '_' + fingerprint;
  }

  var cached = cache.get(cacheKey);
  if (cached) {
    Logger.log('readStudentsLiteResult cache hit term=' + normalizedTerm);
    return JSON.parse(cached);
  }
  Logger.log('readStudentsLiteResult START term=' + normalizedTerm);
  var debug = _sheetDebugLite_(ss, CONFIG.SHEET_NAMES.STUDENTS, ['term', 'termid', 'เทอม'], 10);
  debug.studentsSheetName = CONFIG.SHEET_NAMES.STUDENTS;
  debug.requestedTerm = normalizedTerm;
  debug.normalizedTerm = normalizeTermFast_(normalizedTerm, '');
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
  Logger.log('readStudentsLiteResult sheet found=' + !!sheet);
  if (!sheet) {
    Logger.log('readStudentsLiteResult missing Students sheet');
    return { items: [], debug: debug };
  }
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  debug.studentsLastRow = lastRow;
  Logger.log('readStudentsLiteResult size rows=' + lastRow + ' cols=' + lastColumn);
  if (lastRow < 2) return { items: [], debug: debug };
  var valuesStart = Date.now();
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  Logger.log('readStudentsLiteResult getValues ms=' + (Date.now() - valuesStart));
  var headers = values[0] || [];
  debug.studentsHeaders = headers.map(function(h) { return String(h || ''); });
  var map = _liteHeaderMap_(headers);
  var idxId = _liteIndex_(map, ['studentid', 'รหัส', 'รหัสนักเรียน'], 0);
  var idxPrefix = _liteIndex_(map, ['prefix', 'คำนำหน้า'], 1);
  var idxFirst = _liteIndex_(map, ['firstname', 'first', 'ชื่อ'], 2);
  var idxLast = _liteIndex_(map, ['lastname', 'last', 'สกุล', 'นามสกุล'], 3);
  var idxLevel = _liteIndex_(map, ['level', 'ระดับ', 'ชั้น'], 4);
  var idxRoom = _liteIndex_(map, ['room', 'ห้อง'], 5);
  var idxNo = _liteIndex_(map, ['no', 'เลขที่'], 6);
  var idxStatus = _liteIndex_(map, ['status', 'สถานะ'], 7);
  var idxImage = _liteIndex_(map, ['profileimage', 'imageurl', 'image', 'รูป'], 8);
  var idxIcon = _liteIndex_(map, ['icon'], 9);
  var idxTerm = _liteIndex_(map, ['term', 'termid', 'เทอม'], 10);
  debug.studentsTermColumnName = String(headers[idxTerm] || '');
  debug.studentsTermSampleValues = [];
  debug.studentsCountBeforeTermFilter = 0;
  debug.studentsCountAfterTermFilter = 0;
  debug.blankTermRows = 0;
  debug.invalidTermRows = 0;
  debug.matchedTermRows = 0;
  debug.firstNonMatchingTerms = [];
  debug.sampleRawStudentObjects = [];
  debug.scopeFilteredOutCount = 0;
  debug.teacherClassScopeCount = scope && scope.combos ? Object.keys(scope.combos).length : 0;
  debug.teacherClassScopeRooms = scope && scope.rooms ? Object.keys(scope.rooms) : [];
  debug.teacherClassScopeSkip = !!(scope && scope.skipScope);
  debug.teacherClassScopeRole = role;
  var targetTermNorm = normalizeTermFast_(normalizedTerm, '');
  var students = [];
  for (var i = 1; i < values.length; i++) {
    if (i % 100 === 0 && Date.now() - startMs > 20000) {
      debug.partial = true;
      debug.timeoutMs = Date.now() - startMs;
      Logger.log('readStudentsLiteResult partial timeout count=' + students.length);
      break;
    }
    var row = values[i];
    var rowTermRaw = row[idxTerm];
    var rowTermBlank = rowTermRaw === null || rowTermRaw === undefined || String(rowTermRaw).trim() === '';
    var rowTermNorm = normalizeTermFast_(rowTermRaw, '');
    var rawStudent = {
      id: String(row[idxId] || '').trim(),
      prefix: row[idxPrefix],
      first: row[idxFirst],
      last: row[idxLast],
      level: row[idxLevel],
      room: row[idxRoom],
      no: row[idxNo],
      status: row[idxStatus],
      imageUrl: row[idxImage],
      rawTerm: row[idxTerm]
    };
    if (debug.sampleRawStudentObjects.length < 3) debug.sampleRawStudentObjects.push(rawStudent);
    if (debug.studentsTermSampleValues.length < 10) debug.studentsTermSampleValues.push(String(row[idxTerm] || ''));
    if (!rawStudent.id) continue;
    debug.studentsCountBeforeTermFilter++;
    if (rowTermBlank) {
      debug.blankTermRows++;
    } else if (!rowTermNorm) {
      debug.invalidTermRows++;
    }
    var termMatched = !targetTermNorm || rowTermBlank || rowTermNorm === targetTermNorm;
    if (termMatched) {
      debug.matchedTermRows++;
    } else {
      if (debug.firstNonMatchingTerms.length < 10) {
        debug.firstNonMatchingTerms.push({ raw: String(rowTermRaw || ''), normalized: rowTermNorm, target: targetTermNorm });
      }
      continue;
    }
    debug.studentsCountAfterTermFilter++;
    if (String(effectiveUser.role || '').toLowerCase() === 'student' && String(row[idxId]).trim() !== String(effectiveUser.id).trim()) continue;
    var student = {
      id: String(row[idxId] || '').trim(),
      prefix: row[idxPrefix],
      first: row[idxFirst],
      last: row[idxLast],
      level: row[idxLevel],
      room: row[idxRoom],
      no: row[idxNo],
      status: row[idxStatus],
      profileImage: row[idxImage],
      imageUrl: row[idxImage],
      icon: normalizeIcon_(row[idxIcon], row[idxPrefix]),
      term: normalizedTerm
    };
    if (!_studentAllowedByLiteScope_(student, scope)) {
      debug.scopeFilteredOutCount++;
      continue;
    }
    students.push(student);
  }
  if (students.length === 0 && debug.studentsCountBeforeTermFilter > 0 && debug.studentsCountAfterTermFilter === 0) {
    debug.termFilterDroppedAllStudents = true;
  }
  if (students.length === 0 && debug.studentsCountAfterTermFilter > 0 && debug.scopeFilteredOutCount >= debug.studentsCountAfterTermFilter) {
    debug.scopeFilteredAllStudents = true;
  }
  var result = { items: students, debug: debug };
  Logger.log('readStudentsLiteResult mapped count=' + students.length + ' ms=' + (Date.now() - startMs));
  try {
    var cachePayload = JSON.stringify(result);
if (cachePayload.length < 90000) {
  cache.put(cacheKey, cachePayload, 120);
} else {
  Logger.log('readStudentsLiteResult cache skip large payload bytes=' + cachePayload.length);
}
  } catch (cacheErr) {
    Logger.log('readStudentsLiteResult cache skip ' + String(cacheErr));
  }
  return result;
}

function _readStudentsLite_(ss, normalizedTerm, user) {
  try {
    var result = _readStudentsLiteResult_(ss, normalizedTerm, user);
    return result && Array.isArray(result.items) ? result.items : [];
  } catch (err) {
    Logger.log('readStudentsLite fallback empty: ' + String(err));
    return [];
  }
}

function _readAssignmentsLiteResult_(ss, normalizedTerm, user, maxMs) {
  var started = Date.now();
  var assignments = [];
  var debug = _sheetDebugLite_(ss, CONFIG.SHEET_NAMES.ASSIGNMENTS, ['term', 'termid', 'เทอม', 'ภาคเรียน'], 6);

  var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ASSIGNMENTS);
  if (!sheet || sheet.getLastRow() < 2) {
    debug.count = 0;
    debug.reason = !sheet ? 'missing Assignments sheet' : 'no assignment rows';
    return { items: assignments, debug: debug };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = Math.min(sheet.getLastColumn(), 10);
  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  var headers = values[0] || [];
  debug.assignmentsHeaders = headers.map(function(h) { return String(h || ''); });

  var map = _liteHeaderMap_(headers);

  var idxId = _liteIndex_(map, ['assignmentid', 'id', 'รหัสงาน'], 0);
  var idxTitle = _liteIndex_(map, ['title', 'ชื่องาน', 'งาน'], 1);
  var idxMax = _liteIndex_(map, ['maxscore', 'คะแนนเต็ม'], 2);
  var idxSubject = _liteIndex_(map, ['subjectcode', 'subject', 'รายวิชา', 'รหัสวิชา'], 3);
  var idxType = _liteIndex_(map, ['type', 'ประเภท'], 4);
  var idxTerm = _liteIndex_(map, ['term', 'termid', 'เทอม', 'ภาคเรียน'], 6);
  var idxDue = _liteIndex_(map, ['duedate', 'กำหนดส่ง'], 7);
  var idxLevel = _liteIndex_(map, ['level', 'ระดับ', 'ชั้น'], 8);
  var idxRoom = _liteIndex_(map, ['room', 'ห้อง'], 9);

  debug.assignmentsSheetName = CONFIG.SHEET_NAMES.ASSIGNMENTS;
  debug.assignmentsLastRow = lastRow;
  debug.assignmentsLastColumn = lastCol;
  debug.assignmentsTermColumnName = String(headers[idxTerm] || '');
  debug.assignmentsTermSampleValues = [];
  debug.assignmentsCountBeforeTermFilter = 0;
  debug.assignmentsCountAfterTermFilter = 0;
  debug.firstNonMatchingAssignmentTerms = [];

  var assignmentScope = _readTeacherClassScopeLite_(ss, normalizedTerm, user, 1500);
  var targetTermNorm = normalizeTermFast_(normalizedTerm, '');

  for (var a = 1; a < values.length; a++) {
    if (Date.now() - started > (maxMs || 7000)) {
      debug.partial = true;
      debug.timeoutMs = Date.now() - started;
      break;
    }

    var r = values[a];
    var rawId = String(r[idxId] || '').trim();
    if (!rawId) continue;

    debug.assignmentsCountBeforeTermFilter++;

    var rawTerm = r[idxTerm];
    if (debug.assignmentsTermSampleValues.length < 10) {
      debug.assignmentsTermSampleValues.push(String(rawTerm || ''));
    }

    var rowTermNorm = normalizeTermFast_(rawTerm, '');
    var termMatched = !targetTermNorm || String(rawTerm || '').trim() === '' || rowTermNorm === targetTermNorm;

    if (!termMatched) {
      if (debug.firstNonMatchingAssignmentTerms.length < 10) {
        debug.firstNonMatchingAssignmentTerms.push({
          raw: String(rawTerm || ''),
          normalized: rowTermNorm,
          target: targetTermNorm
        });
      }
      continue;
    }

    debug.assignmentsCountAfterTermFilter++;

    var assignment = {
      id: rawId,
      title: r[idxTitle],
      maxScore: r[idxMax],
      subject: r[idxSubject],
      type: r[idxType],
      dueDate: formatDate(r[idxDue]),
      level: String(r[idxLevel] || ''),
      room: String(r[idxRoom] || '')
    };

    if (!_assignmentAllowedByLiteScope_(assignment, assignmentScope)) continue;
    assignments.push(assignment);
  }

  debug.count = assignments.length;

  if (assignments.length === 0 && debug.assignmentsCountBeforeTermFilter > 0 && debug.assignmentsCountAfterTermFilter === 0) {
    debug.termFilterDroppedAllAssignments = true;
  }

  return { items: assignments, debug: debug };
}

/**
 * ดึงข้อมูลระบบทั้งหมดในครั้งเดียว (Bulk Fetch)
 * เพื่อนำไปเก็บใน localStorage ฝั่ง Client
 */
function getInitialSystemData(termOpt, userOpt) {
  var started = Date.now();
  var currentStep = 'START';
  var term = '';
  var students = [];
  var subjects = [];
  var assignments = [];
  var users = [];
  var levels = [];
  var rooms = [];
  var debug = {};
  try {
    term = resolveTerm_(termOpt);
    Logger.log('GIS START ' + term);
    var user = userOpt || null;
    var effectiveUser = getEffectiveUser_(user);
    var uid = String(effectiveUser.id || 'anonymous').trim() || 'anonymous';
    var gisVersion = '';
    try {
      gisVersion = PropertiesService.getScriptProperties().getProperty('GIS_VERSION_' + term) || '0';
    } catch(e) { gisVersion = '0'; }
    var cacheKey = 'GIS_V7_' + term + '_' + uid + '_v' + gisVersion;
    var cache = CacheService.getScriptCache();
    var cached = getCachedChunked_(cache, cacheKey);
    if (cached) return JSON.parse(cached);

    currentStep = 'opened spreadsheet';
    var ss = getDb();
    Logger.log('GIS opened ss ms=' + (Date.now() - started));

    var partialResponse = function(stepName) {
      var counts = { students: students.length || 0, subjects: subjects.length || 0, assignments: assignments.length || 0, attendance: 0, scores: 0 };
      return {
        success: true,
        data: {
          meta: { term: term, requestedTerm: term, generatedAt: Date.now(), lazy: true, partial: true, timeoutStep: stepName, counts: counts, debug: debug },
          students: students || [],
          assignments: assignments || [],
          subjects: subjects || [],
          users: users || [],
          levels: levels || [],
          rooms: rooms || [],
          scores: {},
          attendance: {}
        },
        teacherScopeMissing: teacherScopeMissing_(user, term)
      };
    };
    var guard = function(stepName) {
      if (Date.now() - started > 9000) {
        Logger.log('GIS partial return step=' + stepName + ' ms=' + (Date.now() - started));
        return partialResponse(stepName);
      }
      return null;
    };

    currentStep = 'read students lite';
    Logger.log('GIS before readStudentsLite ms=' + (Date.now() - started));
    var studentsResult = _readStudentsLiteResult_(ss, term, user);
    students = studentsResult.items || [];
    debug.students = studentsResult.debug || {};
    Object.keys(debug.students).forEach(function(key) {
      debug[key] = debug.students[key];
    });
    Logger.log('getInitialSystemData students count=' + students.length + ' ms=' + (Date.now() - started));
    var guarded = guard('students');
    if (guarded) return guarded;

    var levelMap = {};
    var roomMap = {};
    students.forEach(function(s) {
      if (s.level) levelMap[String(s.level)] = true;
      if (s.room) roomMap[String(s.room)] = true;
    });
    levels = Object.keys(levelMap).sort();
    rooms = Object.keys(roomMap).sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10) || String(a).localeCompare(String(b)); });

    currentStep = 'read subjects';
    var subjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    debug.subjects = _sheetDebugLite_(ss, CONFIG.SHEET_NAMES.SUBJECTS, ['term', 'termid', 'เทอม'], 0);
    if (subjSheet && subjSheet.getLastRow() > 0) {
      var subjData = subjSheet.getDataRange().getValues();
      var subjHeaders = subjData[0].map(function(h) { return String(h).trim(); });
      var subjRows = subjData.slice(1);
      var idxCode = subjHeaders.indexOf('SubjectCode') === -1 ? 0 : subjHeaders.indexOf('SubjectCode');
      var idxName = subjHeaders.indexOf('SubjectName') === -1 ? 1 : subjHeaders.indexOf('SubjectName');
      var idxTeacher = subjHeaders.indexOf('Teacher') === -1 ? 2 : subjHeaders.indexOf('Teacher');
      var idxClasses = subjHeaders.indexOf('Classes') === -1 ? 3 : subjHeaders.indexOf('Classes');
      var idxTerm = subjHeaders.indexOf('Term');
      
      var seenSubjects = {};
      var scope = _readTeacherClassScopeLite_(ss, term, user, 1500);
      subjRows.forEach(function(r) {
        var code = normalizeSubjectCode(r[idxCode]);
        if (!code || seenSubjects[code]) return;

        // Term filter for GIS
        var rowTerm = idxTerm > -1 ? normalizeTermFast_(r[idxTerm], '') : '';
        if (term && rowTerm && rowTerm !== term) return;

        if (String(effectiveUser.role || '').toLowerCase() === 'admin' || (scope.hasRows && !scope.skipScope && scope.subjects[code])) {
          subjects.push({ code: code, name: r[idxName], teacher: r[idxTeacher], classes: r[idxClasses] });
          seenSubjects[code] = true;
        }
      });
    }
    Logger.log('GIS subjects count=' + subjects.length + ' ms=' + (Date.now() - started));
    guarded = guard('subjects');
    if (guarded) return guarded;

    currentStep = 'read assignments lite';
    var assignmentsResult = _readAssignmentsLiteResult_(ss, term, user, 7000);
    assignments = assignmentsResult.items || [];
    debug.assignments = assignmentsResult.debug || {};
    Logger.log('GIS assignments count=' + assignments.length + ' ms=' + (Date.now() - started));
    guarded = guard('assignments');
    if (guarded) return guarded;
    debug.scores = { sheet: CONFIG.SHEET_NAMES.SCORES, skipped: true, lazy: true };
    debug.attendance = { sheet: CONFIG.SHEET_NAMES.ATTENDANCE, skipped: true, lazy: true };
    Logger.log('SKIP attendance/scores lazy=true ms=' + (Date.now() - started));

    currentStep = 'read users';
    if (String(effectiveUser.role || '').toLowerCase() === 'admin') {
      var userSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
      if (userSheet && userSheet.getLastRow() > 1) {
        var userRows = userSheet.getRange(2, 1, userSheet.getLastRow() - 1, Math.min(userSheet.getLastColumn(), 6)).getValues();
        users = userRows.map(function(r) { return { id: String(r[0]), username: r[1], name: r[3], role: r[4], status: r[5] }; });
      }
    }

    var counts = { students: students.length, subjects: subjects.length, assignments: assignments.length, attendance: 0, scores: 0 };
    var response = {
      success: true,
      data: {
        meta: { term: term, requestedTerm: term, generatedAt: Date.now(), lazy: true, counts: counts, debug: debug },
        students: students,
        assignments: assignments,
        subjects: subjects,
        users: users,
        levels: levels,
        rooms: rooms,
        scores: {},
        attendance: {}
      },
      teacherScopeMissing: teacherScopeMissing_(user, term)
    };
    try {
      var responsePayload = JSON.stringify(response);
      putCachedChunked_(cache, cacheKey, responsePayload, 21600); // cache for 6 hours
    } catch (cacheErr) {
      Logger.log('GIS cache skip ' + String(cacheErr));
    }

    Logger.log('GIS RETURN ms=' + (Date.now() - started));
    return response;
  } catch (err) {
    Logger.log('getInitialSystemData ERROR term=%s step=%s err=%s', term, currentStep, String(err));
    return { success: false, message: String(err), debug: { requestedTerm: term, step: currentStep } };
  }
}

function putCachedChunked_(cache, key, str, exp) {
  var CHUNK_SIZE = 90000;
  if (str.length <= CHUNK_SIZE) {
    cache.put(key, str, exp);
    return;
  }
  var chunks = Math.ceil(str.length / CHUNK_SIZE);
  var meta = { chunks: chunks };
  cache.put(key, JSON.stringify(meta), exp);
  for (var i = 0; i < chunks; i++) {
    cache.put(key + '_' + i, str.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), exp);
  }
}

function getCachedChunked_(cache, key) {
  var cached = cache.get(key);
  if (!cached) return null;
  if (cached.indexOf('{"chunks":') === 0) {
    try {
      var meta = JSON.parse(cached);
      var str = '';
      for (var i = 0; i < meta.chunks; i++) {
        var chunk = cache.get(key + '_' + i);
        if (!chunk) return null;
        str += chunk;
      }
      return str;
    } catch(e) { return null; }
  }
  return cached;
}

function debugServerSpeed(termOpt) {
  var normalizedTerm = '';
  var started = Date.now();
  var ms = { openSpreadsheet: 0, readStudents: 0, readSubjects: 0, readAssignments: 0 };
  var counts = { students: 0, subjects: 0, assignments: 0 };

  try {
    normalizedTerm = resolveTerm_(termOpt);

    var openStart = Date.now();
    var ss = getDb();
    ms.openSpreadsheet = Date.now() - openStart;

    var studentStart = Date.now();
    var students = _readStudentsLite_(ss, normalizedTerm, { id: 'debug', role: 'admin' });
    counts.students = students.length;
    ms.readStudents = Date.now() - studentStart;

    var subjectStart = Date.now();
    var subjSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SUBJECTS);
    if (subjSheet && subjSheet.getLastRow() > 1) {
      counts.subjects = subjSheet.getLastRow() - 1;
    }
    ms.readSubjects = Date.now() - subjectStart;

    var assignmentStart = Date.now();
    var asnResult = _readAssignmentsLiteResult_(ss, normalizedTerm, { id: 'debug', role: 'admin' }, 20000);
    counts.assignments = asnResult.items ? asnResult.items.length : 0;
    ms.readAssignments = Date.now() - assignmentStart;

    return { success: true, term: normalizedTerm, ms: ms, counts: counts };
  } catch (err) {
    return { success: false, term: normalizedTerm, message: String(err), ms: ms, counts: counts };
  }
}


// Export Student List as Excel (.xlsx)
function exportStudentSheetAsExcel(data) {
  try {
    const { level, room, term } = data;
    const targetLevel = String(level).trim();
    const targetRoom = String(room).trim();
    const targetTerm = sanitizeTerm_(term);
    if (!canAccessClass_(data.user, '', targetLevel, targetRoom, targetTerm)) {
      return { success: false, message: 'Access denied' };
    }

    const db = getDb().getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (!db) throw new Error("ไม่พบชีท Students");

    const rows = db.getDataRange().getValues();
    const students = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (String(r[4]).trim() === targetLevel && String(r[5]).trim() === targetRoom && sanitizeTerm_(r[10]) === targetTerm) {
        students.push([r[6], r[0], r[1], r[2], r[3], r[4], r[5], r[7]]);
      }
    }
    students.sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0));

    // Build CSV (ง่ายที่สุด ไม่ต้องการ library)
    const header = ['ลำดับ', 'รหัสประจำตัว', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ระดับชั้น', 'ห้อง', 'สถานะ'];
    const csvRows = [header, ...students];
    const csvContent = csvRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = Utilities.newBlob('\ufeff' + csvContent, 'text/csv; charset=utf-8', `รายชื่อนักเรียน_${targetLevel}_${targetRoom}.csv`);
    const encoded = Utilities.base64Encode(blob.getBytes());

    return { success: true, base64: encoded, filename: `รายชื่อนักเรียน_${targetLevel}_${targetRoom}_${targetTerm.replace('/','-')}.csv` };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// Export Score Sheet as Excel (.xlsx)
function exportScoreSheetAsExcel(data) {
  try {
    const { level, room, subject, term } = data;
    const targetLevel = String(level).trim();
    const targetRoom = String(room).trim();
    const targetSubject = normalizeSubjectCode(subject);
    const targetTerm = sanitizeTerm_(term);
    if (!canAccessClass_(data.user, targetSubject, targetLevel, targetRoom, targetTerm)) {
      return { success: false, message: 'Access denied' };
    }

    const ssDb = getDb();
    const asnSheet = ssDb.getSheetByName(CONFIG.SHEET_NAMES.ASSIGNMENTS);
    const scoreSheet = ssDb.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
    const studentSheet = ssDb.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    const asnLayout = _assignmentSheetLayout_(asnSheet);
    const asnIdx = asnLayout.indexes;

    // Assignments
    const assignments = [];
    const asnRows = asnSheet.getDataRange().getValues();
    for (let i = 1; i < asnRows.length; i++) {
      const r = asnRows[i];
      if (normalizeSubjectCode(r[asnIdx.subject]) === targetSubject && sanitizeTerm_(r[asnIdx.term]) === targetTerm &&
          (String(r[asnIdx.level]||'') === '' || String(r[asnIdx.level]) === targetLevel) &&
          (String(r[asnIdx.room]||'') === '' || String(r[asnIdx.room]) === targetRoom)) {
        assignments.push({ id: r[asnIdx.id], title: r[asnIdx.title], max: r[asnIdx.maxScore], type: r[asnIdx.type] });
      }
    }

    // Students
    const students = [];
    const stdRows = studentSheet.getDataRange().getValues();
    for (let i = 1; i < stdRows.length; i++) {
      const r = stdRows[i];
      if (String(r[4]).trim() === targetLevel && String(r[5]).trim() === targetRoom && sanitizeTerm_(r[10]) === targetTerm) {
        students.push({ id: String(r[0]).trim(), name: `${r[1]}${r[2]} ${r[3]}`, no: r[6] });
      }
    }
    students.sort((a,b) => (parseInt(a.no)||0) - (parseInt(b.no)||0));

    // Scores
    const scoreMap = {};
    if (scoreSheet && scoreSheet.getLastRow() > 1) {
      const scoreLayout = _scoreSheetLayout_(scoreSheet);
      const scoreIdx = scoreLayout.indexes;
      const scoreRows = scoreSheet.getDataRange().getValues();
      for (let i = 1; i < scoreRows.length; i++) {
        const r = scoreRows[i];
        if (sanitizeTerm_(r[scoreIdx.term]) === targetTerm) {
          scoreMap[`${r[scoreIdx.assignmentId]}_${String(r[scoreIdx.studentId]).trim()}`] = { score: r[scoreIdx.score], isSubmitted: r[scoreIdx.isSubmitted] };
        }
      }
    }

    // Build CSV
    const header = ['เลขที่', 'รหัส', 'ชื่อ-สกุล',
      ...assignments.map(a => a.type === 'Check' ? `${a.title}(ส่ง)` : `${a.title}(${a.max})`),
      'รวมคะแนน', 'รวมงาน(ชิ้น)'
    ];
    const csvRows = [header];
    students.forEach(std => {
      let totalScore = 0, totalChecks = 0;
      const row = [std.no, std.id, std.name];
      assignments.forEach(asn => {
        const d = scoreMap[`${asn.id}_${std.id}`];
        if (asn.type === 'Check') {
          const sc = d ? d.score : '';
          const checked = d && (d.isSubmitted == 1 || String(d.isSubmitted).toLowerCase() === 'true' || (sc !== '' && sc !== null && !isNaN(Number(sc)) && Number(sc) > 0));
          row.push(checked ? 'ส่ง' : '');
          if (checked) totalChecks++;
        } else {
          const sc = d ? d.score : '';
          row.push(sc !== '' && sc !== null ? Number(sc) : '');
          if (sc !== '' && sc !== null) totalScore += Number(sc);
        }
      });
      row.push(totalScore, totalChecks);
      csvRows.push(row);
    });

    const csvContent = csvRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = Utilities.newBlob('\ufeff' + csvContent, 'text/csv; charset=utf-8');
    const encoded = Utilities.base64Encode(blob.getBytes());
    const filename = `คะแนน_${targetSubject}_${targetLevel}_${targetRoom}_${targetTerm.replace('/','-')}.csv`;

    return { success: true, base64: encoded, filename };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/************************************************************
 * ADMIN SETTINGS BACKEND PATCH
 * Append this block at the bottom of รหัส.gs
 * Purpose:
 * - Support Admin Settings tabs
 * - Support Teacher-Class-Subject multi-room assignment
 * - Support SystemSettings, Terms, Folder setting
 * - Support attendance reset for selected date/class/subject/term
 ************************************************************/

/* =========================
   BASIC HELPERS
========================= */

function CMS_getSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function CMS_now_() {
  return new Date();
}

function CMS_string_(v) {
  return String(v == null ? '' : v).trim();
}

function CMS_norm_(v) {
  return CMS_string_(v).toLowerCase().replace(/\s+/g, '');
}

function CMS_getCurrentTerm_() {
  try {
    if (typeof getCurrentTerm === 'function') {
      return getCurrentTerm();
    }
  } catch (e) {}

  var now = new Date();
  var month = now.getMonth() + 1;
  var year = now.getFullYear() + 543;
  var term = '1';

  if (month >= 10 || month <= 3) {
    term = '2';
    if (month <= 3) year -= 1;
  }

  return term + '/' + year;
}

function CMS_isBlankOrInvalidTerm_(term) {
  var s = CMS_string_(term);
  if (!s) return true;
  if (s.indexOf('GMT') >= 0) return true;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return false;
}

function CMS_termsEqual_(a, b) {
  var ta = CMS_string_(a);
  var tb = CMS_string_(b);
  if (!tb) tb = CMS_getCurrentTerm_();
  if (CMS_isBlankOrInvalidTerm_(ta)) return false;
  return ta === tb;
}

function CMS_safeUser_(user) {
  if (!user) return {};
  if (typeof user === 'string') return { id: user };
  return user;
}

function CMS_isAdmin_(user) {
  user = CMS_safeUser_(user);
  var role = CMS_string_(user.role).toLowerCase();
  return role === 'admin' || role === 'administrator' || role === 'ผู้ดูแลระบบ';
}

function CMS_requireAdmin_(user) {
  if (!CMS_isAdmin_(user)) {
    throw new Error('Permission denied: admin only');
  }
}

function CMS_canAccessClassSafe_(user, subject, level, room, term) {
  user = CMS_safeUser_(user);
  if (CMS_isAdmin_(user)) return true;

  try {
    if (typeof canAccessClass_ === 'function') {
      var result = canAccessClass_(user, subject, level, room, term);
      if (result === true) return true;
      if (result && result.success === true) return true;
      if (result && result.allowed === true) return true;
      return false;
    }
  } catch (e) {
    return false;
  }

  return false;
}

function CMS_headerMap_(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    map[CMS_norm_(headers[i])] = i;
  }
  return map;
}

function CMS_findCol_(map, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    var key = CMS_norm_(aliases[i]);
    if (map[key] !== undefined) return map[key];
  }
  return -1;
}

function testReadStudentsLiteDebug_2_2568() {
  var ss = getDb();
  var res = _readStudentsLiteResult_(ss, '2/2568', { id: 'ADMIN_MASTER', role: 'admin' });
  Logger.log(JSON.stringify({
    count: res.items ? res.items.length : 0,
    debug: res.debug
  }));
}

function testReadAssignmentsLiteDebug_2_2568() {
  var ss = getDb();
  var res = _readAssignmentsLiteResult_(ss, '2/2568', { id: 'ADMIN_MASTER', role: 'admin' }, 20000);
  Logger.log(JSON.stringify({
    count: res.items ? res.items.length : 0,
    debug: res.debug,
    sample: res.items ? res.items.slice(0, 5) : []
  }));
}

function testDebugServerSpeed_2_2568() {
  var res = debugServerSpeed('2/2568');
  Logger.log(JSON.stringify(res).substring(0, 5000));
  return res;
}

function testAttendanceEndpoint_2_2568() {
  var res = getAttendanceForCheck({
    date: '2026-01-05',
    subject: 'ส22103',
    subjectCode: 'ส22103',
    level: 'ม.2',
    room: '4',
    term: '2/2568',
    user: { id: 'ADMIN_MASTER', role: 'admin', name: 'ADMIN_MASTER' }
  });
  Logger.log(JSON.stringify({
    success: res.success,
    count: res.count,
    matched: res.matched,
    students: res.students ? res.students.length : 0,
    debug: res.debug
  }).substring(0, 5000));
  return res;
}

function testScoresEndpoint_2_2568() {
  var res = loadScoresGrid({
    assignmentId: 'ALL',
    subject: 'ส22104',
    subjectCode: 'ส22104',
    level: 'ม.2',
    room: '4',
    term: '2/2568',
    user: { id: 'ADMIN_MASTER', role: 'admin', name: 'ADMIN_MASTER' }
  });
  Logger.log(JSON.stringify({
    success: res.success,
    students: res.data && res.data.students ? res.data.students.length : 0,
    assignments: res.data && res.data.assignments ? res.data.assignments.length : 0,
    scoreKeys: res.data && res.data.scores ? Object.keys(res.data.scores).length : 0,
    debug: res.debug
  }).substring(0, 5000));
  return res;
}

function testDashboardStats_2_2568() {
  var res = getDashboardStats({
    term: '2/2568',
    date: '2026-01-05',
    user: { id: 'ADMIN_MASTER', role: 'admin', name: 'ADMIN_MASTER' }
  });
  Logger.log(JSON.stringify(res).substring(0, 5000));
  return res;
}

function testAdminSettingsBootstrap_2_2568() {
  var res = getAdminSettingsBootstrap({
    term: '2/2568',
    user: { id: 'ADMIN_MASTER', role: 'admin', name: 'ADMIN_MASTER' }
  });
  Logger.log(JSON.stringify({
    success: res.success,
    users: res.users ? res.users.length : 0,
    terms: res.terms ? res.terms.length : 0,
    teacherClasses: res.teacherClasses ? res.teacherClasses.length : 0,
    subjects: res.dropdowns && res.dropdowns.subjects ? res.dropdowns.subjects.length : 0,
    levels: res.dropdowns && res.dropdowns.levels ? res.dropdowns.levels.length : 0,
    rooms: res.dropdowns && res.dropdowns.rooms ? res.dropdowns.rooms.length : 0,
    settings: res.settings,
    meta: res.meta
  }).substring(0, 5000));
  return res;
}

function testAttendanceDirect_2_2568() {
  var started = Date.now();
  var ss = getDb();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ATTENDANCE);

  var targetTerm = '2/2568';
  var targetDate = '2026-01-05';
  var targetSubject = 'ส22103';
  var targetLevel = 'ม.2';
  var targetRoom = '4';

  var result = {
    success: true,
    target: {
      term: targetTerm,
      date: targetDate,
      subject: targetSubject,
      level: targetLevel,
      room: targetRoom
    },
    rows: 0,
    matched: 0,
    sample: [],
    ms: 0
  };

  if (!sheet || sheet.getLastRow() < 2) {
    result.success = false;
    result.message = 'Attendance sheet missing or empty';
    Logger.log(JSON.stringify(result));
    return result;
  }

  var data = sheet.getDataRange().getDisplayValues();
  result.rows = data.length - 1;

  var headers = data[0] || [];
  var map = _liteHeaderMap_(headers);

  var idxTimestamp = _liteIndex_(map, ['timestamp'], 0);
  var idxDate = _liteIndex_(map, ['date', 'วันที่'], 1);
  var idxSubject = _liteIndex_(map, ['subjectcode', 'subject', 'รหัสวิชา'], 2);
  var idxLevel = _liteIndex_(map, ['level', 'ระดับ', 'ชั้น'], 3);
  var idxRoom = _liteIndex_(map, ['room', 'ห้อง'], 4);
  var idxStudent = _liteIndex_(map, ['studentid', 'รหัสนักเรียน'], 5);
  var idxStatus = _liteIndex_(map, ['status', 'สถานะ'], 6);
  var idxTerm = _liteIndex_(map, ['term', 'termid', 'เทอม'], 8);
  var idxNote = _liteIndex_(map, ['note', 'หมายเหตุ'], 9);

  for (var i = 1; i < data.length; i++) {
    var r = data[i];

    var rowTerm = normalizeTermFast_(r[idxTerm], '');
    var rowDateRaw = String(r[idxDate] || '').trim() ? r[idxDate] : r[idxTimestamp];
    var rowDate = normalizeDateFast_(rowDateRaw);
    var rowSubject = normalizeSubjectCode(r[idxSubject]);
    var rowLevel = String(r[idxLevel] || '').trim();
    var rowRoom = String(r[idxRoom] || '').trim();
    var studentId = String(r[idxStudent] || '').trim();

    if (rowTerm === targetTerm &&
        rowDate === targetDate &&
        rowSubject === targetSubject &&
        rowLevel === targetLevel &&
        rowRoom === targetRoom &&
        studentId) {
      result.matched++;
      if (result.sample.length < 10) {
        result.sample.push({
          studentId: studentId,
          status: r[idxStatus],
          note: r[idxNote],
          date: rowDate,
          term: rowTerm
        });
      }
    }
  }

  result.ms = Date.now() - started;
  Logger.log(JSON.stringify(result).substring(0, 5000));
  return result;
}

function testScoresDirect_2_2568() {
  var started = Date.now();
  var ss = getDb();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCORES);

  var targetTerm = '2/2568';
  var targetAssignmentId = 'ASN-20260108-114523';

  var result = {
    success: true,
    target: {
      term: targetTerm,
      assignmentId: targetAssignmentId
    },
    rows: 0,
    matched: 0,
    sample: [],
    ms: 0
  };

  if (!sheet || sheet.getLastRow() < 2) {
    result.success = false;
    result.message = 'Scores sheet missing or empty';
    Logger.log(JSON.stringify(result));
    return result;
  }

  var data = sheet.getDataRange().getDisplayValues();
  result.rows = data.length - 1;

  var headers = data[0] || [];
  var map = _liteHeaderMap_(headers);

  var idxTimestamp = _liteIndex_(map, ['timestamp'], 0);
  var idxAssignment = _liteIndex_(map, ['assignmentid', 'assignment', 'รหัสงาน'], 1);
  var idxStudent = _liteIndex_(map, ['studentid', 'รหัสนักเรียน'], 2);
  var idxScore = _liteIndex_(map, ['score', 'คะแนน'], 3);
  var idxSubmitted = _liteIndex_(map, ['issubmitted', 'submitted', 'ส่งงาน'], 4);
  var idxTerm = _liteIndex_(map, ['term', 'termid', 'เทอม'], 5);

  for (var i = 1; i < data.length; i++) {
    var r = data[i];

    var rowTerm = normalizeTermFast_(r[idxTerm], '');
    var assignmentId = String(r[idxAssignment] || '').trim();
    var studentId = String(r[idxStudent] || '').trim();

    if (rowTerm === targetTerm &&
        assignmentId === targetAssignmentId &&
        studentId) {
      result.matched++;
      if (result.sample.length < 10) {
        result.sample.push({
          assignmentId: assignmentId,
          studentId: studentId,
          score: r[idxScore],
          isSubmitted: normalizeSubmittedFast_(r[idxSubmitted]),
          rawSubmitted: r[idxSubmitted],
          timestamp: r[idxTimestamp],
          term: rowTerm
        });
      }
    }
  }

  result.ms = Date.now() - started;
  Logger.log(JSON.stringify(result).substring(0, 5000));
  return result;
}

function testClearAttendanceForClass_DEBUG() {
  return clearAttendanceForClass({
    term:'1/2569',
    date:'2026-05-13',
    subject:'ส22104',
    level:'ม.2',
    room:'4',
    user:{id:'ADMIN_MASTER', role:'admin'}
  });
}

/**
 * ฟังก์ชันล้างข้อมูลฐานข้อมูลใน Spreadsheet และตั้งค่าเริ่มต้นเป็นระบบเปล่า (Clean Start)
 * ระบบจะลบประวัติเช็คชื่อ คะแนน รายวิชา และรายชื่อนักเรียนเก่าออกทั้งหมด
 * แล้วสร้างบัญชีผู้ใช้งานระบบเริ่มต้น (admin และ teacher รหัสผ่านคือ 1234) สำหรับเทอม 1/2569
 * วิธีใช้: เปิด Apps Script Editor -> เลือกฟังก์ชัน resetDatabaseToDefault -> กดปุ่ม Run (เรียกใช้)
 */
function resetDatabaseToDefault() {
  const ss = getDb();
  Logger.log('=== เริ่มต้นการรีเซ็ตและล้างข้อมูลฐานข้อมูลสำหรับโครงการใหม่ 2569 ===');
  
  const keys = Object.keys(CONFIG.SHEET_NAMES);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var sheetName = CONFIG.SHEET_NAMES[key];
    var headers = CONFIG.HEADERS[key] || [];
    
    var sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      sheet.clear();
      // ลบแถวและคอลัมน์ส่วนเกินออก เพื่อให้แผ่นงานมีขนาดเล็กลงและลื่นไหล
      if (sheet.getMaxRows() > 100) {
        sheet.deleteRows(101, sheet.getMaxRows() - 100);
      }
      if (sheet.getMaxColumns() > 20) {
        sheet.deleteColumns(21, sheet.getMaxColumns() - 20);
      }
    } else {
      sheet = ss.insertSheet(sheetName);
    }
    
    if (headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e2e8f0');
      sheet.setFrozenRows(1);
    }
    Logger.log(`- ล้างข้อมูลแผ่นงาน: "${sheetName}" และสร้างโครงสร้างตารางเรียบร้อย`);
  }
  
  // 1. Seed ข้อมูล Config เริ่มต้น
  const sConfig = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
  sConfig.appendRow(['CURRENT_TERM', '1/2569']);
  sConfig.appendRow(['ADMIN_PASSWORD', '1234']);
  Logger.log('✓ Seed ตาราง Config เริ่มต้นเรียบร้อย');
  
  // 2. Seed ข้อมูล SystemSettings เริ่มต้น
  const sSettings = ss.getSheetByName(CONFIG.SHEET_NAMES.SYSTEM_SETTINGS);
  sSettings.appendRow(['active_term', '1/2569']);
  Logger.log('✓ Seed ตาราง SystemSettings เริ่มต้นเรียบร้อย');
  
  // 3. Seed บัญชีผู้ใช้งานระบบเริ่มต้น (admin และ teacher)
  const sUsers = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
  // USERS: ['UserID', 'Username', 'Password', 'Name', 'Role', 'Status', 'ProfileImage', 'Prefix', 'LastName', 'Position', 'School', 'Group']
  sUsers.appendRow(['U001', 'admin', '1234', 'ผู้ดูแลระบบ', 'admin', 'Active', '', 'นาย', 'คุมระบบ', 'ผู้ดูแลระบบ', 'โรงเรียนวัดไร่ขิงวิทยา', '']);
  sUsers.appendRow(['T001', 'teacher', '1234', 'ครูทดสอบ ระบบใหม่', 'teacher', 'Active', '', 'นาย', 'สอนดี', 'ครูผู้สอน', 'โรงเรียนวัดไร่ขิงวิทยา', '']);
  Logger.log('✓ Seed ตาราง Users บัญชี admin และ teacher เริ่มต้นเรียบร้อย (รหัสผ่านคือ 1234)');
  
  // 4. Seed ตารางเทอมเริ่มต้น
  const sTerms = ss.getSheetByName(CONFIG.SHEET_NAMES.TERMS);
  // TERMS: ['TermID', 'AcademicYear', 'TermNo', 'Status', 'SpreadsheetId', 'FolderId', 'CreatedAt', 'CreatedBy']
  sTerms.appendRow(['1/2569', '2569', '1', 'Active', ss.getId(), CONFIG.FOLDER_ID || '', new Date(), 'system']);
  Logger.log('✓ Seed ตาราง Terms เรียบร้อย');
  
  // 5. เคลียร์ Cache ของระบบทั้งหมด
  invalidateAllCaches();
  Logger.log('✓ เคลียร์แคชระบบเรียบร้อย');
  
  Logger.log('=== การรีเซ็ตฐานข้อมูลทั้งหมดเสร็จสมบูรณ์ ===');
}
function DEBUG_DUPLICATE_SAVE_DIAG() {
  return DEBUG_duplicateSaveDiag_({
    attendance: {
      term: '1/2569',
      date: '2026-06-12',
      subject: 'ส22101',
      level: 'ม.2',
      room: '3'
    },
    score: {
      term: '1/2569',
      assignmentId: 'new_1781228892644_pdpv2'
    }
  });
}

function DEBUG_DATABASE_LOCATION() {
  var out = {
    generatedAt: new Date(),
    configSpreadsheetId: CONFIG.SPREADSHEET_ID || '',
    activeSpreadsheet: null,
    dbSpreadsheet: null,
    webAppUrl: '',
    scriptId: '',
    codeSignature: {
      saveAttendanceHasIncomingMap: false,
      saveScoresBatchHasIncomingMap: false,
      debugLocationVersion: 'recordid-scoreid-upsert-v7'
    },
    sheets: [],
    note: 'READ ONLY. Use this to confirm whether the editor, deployed web app, and real data sheet point to the same spreadsheet.'
  };
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      out.activeSpreadsheet = {
        id: active.getId(),
        name: active.getName(),
        url: active.getUrl()
      };
    }
  } catch (errActive) {
    out.activeSpreadsheet = { error: String(errActive) };
  }
  try {
    _SS_INSTANCE = null;
    var db = getDb();
    out.dbSpreadsheet = {
      id: db.getId(),
      name: db.getName(),
      url: db.getUrl()
    };
    out.sheets = db.getSheets().map(function(sheet) {
      return {
        name: sheet.getName(),
        lastRow: sheet.getLastRow(),
        lastColumn: sheet.getLastColumn(),
        maxRows: sheet.getMaxRows(),
        maxColumns: sheet.getMaxColumns()
      };
    });
  } catch (errDb) {
    out.dbSpreadsheet = { error: String(errDb && errDb.stack ? errDb.stack : errDb) };
  }
  try {
    out.webAppUrl = ScriptApp.getService().getUrl();
  } catch (errUrl) {
    out.webAppUrl = String(errUrl);
  }
  try {
    out.scriptId = ScriptApp.getScriptId();
  } catch (errScript) {
    out.scriptId = String(errScript);
  }
  try {
    out.codeSignature.saveAttendanceHasIncomingMap = String(saveAttendance).indexOf('incomingAttendanceByKey') !== -1;
    out.codeSignature.saveScoresBatchHasIncomingMap = String(saveScoresBatch).indexOf('incomingScoresByKey') !== -1;
  } catch (errSig) {
    out.codeSignature.error = String(errSig);
  }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

function DEBUG_DUPLICATE_SAVE_DIAG_CUSTOM(configJson) {
  var config = {};
  if (typeof configJson === 'string' && configJson.trim()) {
    config = JSON.parse(configJson);
  } else if (configJson && typeof configJson === 'object') {
    config = configJson;
  }
  return DEBUG_duplicateSaveDiag_(config);
}

function DEBUG_duplicateSaveDiag_(config) {
  config = config || {};
  var result = {
    generatedAt: new Date(),
    note: 'READ ONLY. This diagnostic does not write/delete sheet data.',
    attendance: DEBUG_attendanceDuplicateKeys_(config.attendance || {}),
    score: DEBUG_scoreDuplicateKeys_(config.score || {})
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function DEBUG_typeName_(value) {
  return Object.prototype.toString.call(value).replace('[object ', '').replace(']', '');
}

function DEBUG_groupDuplicates_(rows, keyField) {
  var groups = {};
  rows.forEach(function(row) {
    var key = row[keyField] || '';
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row.rowNumber);
  });
  var duplicates = [];
  Object.keys(groups).forEach(function(key) {
    if (groups[key].length > 1) duplicates.push({ key: key, rows: groups[key], count: groups[key].length });
  });
  duplicates.sort(function(a, b) { return b.count - a.count; });
  return duplicates;
}

function DEBUG_attendanceDuplicateKeys_(filter) {
  var out = {
    filter: filter,
    sheetName: CONFIG.SHEET_NAMES.ATTENDANCE,
    error: '',
    headerIndexes: {},
    totalRows: 0,
    matchedRows: 0,
    duplicateBySaveKey: [],
    duplicateByVisibleKey: [],
    rows: [],
    likelyCause: []
  };
  try {
    var ss = getDb();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ATTENDANCE);
    if (!sheet) {
      out.error = 'Attendance sheet not found';
      return out;
    }
    var layout = _attendanceSheetLayout_(sheet);
    var idx = layout.indexes;
    out.headerIndexes = idx;
    var raw = sheet.getDataRange().getValues();
    var display = sheet.getDataRange().getDisplayValues();
    out.totalRows = Math.max(0, raw.length - 1);

    var targetTerm = normalizeTermFast_(filter.term, '') || normalizeTermFast_(resolveTerm_(filter.term), '');
    var targetDate = normalizeDateFast_(filter.date);
    var targetSubject = normalizeSubjectCode(filter.subject || filter.subjectCode);
    var targetLevel = String(filter.level || '').trim();
    var targetRoom = String(filter.room || '').trim();
    var levelKey = function(value) {
      return String(value || '').trim().replace(/^ม\./, '').replace(/^เธก\./, '').replace(/^M\./i, '').replace(/^Grade\s*/i, '');
    };
    var makeSaveKey = function(rowTerm, rowDate, rowSubject, rowLevel, rowRoom, studentId, recordId) {
      return String(recordId || '').trim() ||
        makeAttendanceRecordId_(rowTerm || targetTerm, rowDate, rowSubject, studentId);
    };
    var makeVisibleKey = function(row) {
      return String(row.term || '').trim() + '|' +
        String(row.date || '').trim() + '|' +
        String(row.subject || '').trim() + '|' +
        String(row.level || '').trim() + '|' +
        String(row.room || '').trim() + '|' +
        String(row.studentId || '').trim();
    };
    var isTargetish = function(r, d) {
      var rowTerm = normalizeTermFast_(r[idx.term], '');
      var rowDate = normalizeDateFast_(r[idx.date] || r[idx.timestamp]);
      var rowSubject = normalizeSubjectCode(r[idx.subject]);
      var rowLevel = String(r[idx.level] || '').trim();
      var rowRoom = String(r[idx.room] || '').trim();
      var rowStudent = String(r[idx.studentId] || '').trim();
      if (!rowStudent || rowStudent.toLowerCase() === 'studentid') return false;
      var termOk = !targetTerm || !rowTerm || rowTerm === targetTerm;
      var dateOk = !targetDate || rowDate === targetDate || normalizeDateFast_(d[idx.date] || d[idx.timestamp]) === targetDate;
      var subjectOk = !targetSubject || rowSubject === targetSubject || normalizeSubjectCode(d[idx.subject]) === targetSubject;
      var classOk = true;
      if (targetLevel || targetRoom) {
        classOk = isSameClass_(rowLevel, rowRoom, targetLevel || '', targetRoom || '') ||
                  isSameClass_(d[idx.level], d[idx.room], targetLevel || '', targetRoom || '');
      }
      return termOk && dateOk && subjectOk && classOk;
    };

    for (var i = 1; i < raw.length; i++) {
      var r = raw[i];
      var d = display[i];
      if (!isTargetish(r, d)) continue;
      var rawDateValue = r[idx.date] || r[idx.timestamp];
      var displayDateValue = d[idx.date] || d[idx.timestamp];
      var visibleRow = {
        timestamp: d[idx.timestamp],
        date: d[idx.date],
        subject: d[idx.subject],
        level: d[idx.level],
        room: d[idx.room],
        studentId: d[idx.studentId],
        status: d[idx.status],
        term: d[idx.term]
      };
      var saveKey = makeSaveKey(r[idx.term] || targetTerm, rawDateValue, r[idx.subject], r[idx.level], r[idx.room], r[idx.studentId], r[idx.recordId]);
      var displaySaveKey = makeSaveKey(d[idx.term] || targetTerm, displayDateValue, d[idx.subject], d[idx.level], d[idx.room], d[idx.studentId], d[idx.recordId]);
      out.rows.push({
        rowNumber: i + 1,
        studentId: String(r[idx.studentId] || '').trim(),
        status: String(r[idx.status] || '').trim(),
        rawTypes: {
          timestamp: DEBUG_typeName_(r[idx.timestamp]),
          date: DEBUG_typeName_(r[idx.date]),
          term: DEBUG_typeName_(r[idx.term])
        },
        normalized: {
          term: normalizeTermFast_(r[idx.term], targetTerm),
          date: normalizeDateFast_(rawDateValue),
          subject: normalizeSubjectCode(r[idx.subject]),
          levelKey: levelKey(r[idx.level]),
          room: String(r[idx.room] || '').trim()
        },
        visible: visibleRow,
        recordId: String(r[idx.recordId] || '').trim(),
        saveKey: saveKey,
        displaySaveKey: displaySaveKey,
        visibleKey: makeVisibleKey(visibleRow),
        saveKeyEqualsDisplayKey: saveKey === displaySaveKey
      });
    }

    out.matchedRows = out.rows.length;
    out.duplicateBySaveKey = DEBUG_groupDuplicates_(out.rows, 'saveKey');
    out.duplicateByVisibleKey = DEBUG_groupDuplicates_(out.rows, 'visibleKey');
    if (out.duplicateBySaveKey.length > 0) {
      out.likelyCause.push('Rows are duplicate even by the exact save key. If save all still leaves them, deployed code may not be the latest or another writer runs after saveAttendance.');
    }
    if (out.duplicateByVisibleKey.length > 0 && out.duplicateBySaveKey.length === 0) {
      out.likelyCause.push('Rows look duplicate on screen but normalized save keys differ. Compare saveKey/displaySaveKey in rows to find Date/Term/Level mismatch.');
    }
    if (out.rows.some(function(row) { return !row.saveKeyEqualsDisplayKey; })) {
      out.likelyCause.push('Raw values and display values normalize differently, usually Date or Term format from Google Sheets.');
    }
    if (out.matchedRows === 0) {
      out.likelyCause.push('No rows matched the filter. Check header indexes and filter values.');
    }
    return out;
  } catch (err) {
    out.error = String(err && err.stack ? err.stack : err);
    return out;
  }
}

function DEBUG_scoreDuplicateKeys_(filter) {
  var out = {
    filter: filter,
    sheetName: CONFIG.SHEET_NAMES.SCORES,
    error: '',
    headerIndexes: {},
    totalRows: 0,
    matchedRows: 0,
    duplicateBySaveKey: [],
    duplicateByVisibleKey: [],
    rows: [],
    likelyCause: []
  };
  try {
    var ss = getDb();
    var sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.SCORES);
    if (!sheet) {
      out.error = 'Scores sheet not found';
      return out;
    }
    var layout = _scoreSheetLayout_(sheet);
    var idx = layout.indexes;
    out.headerIndexes = idx;
    var raw = sheet.getDataRange().getValues();
    var display = sheet.getDataRange().getDisplayValues();
    out.totalRows = Math.max(0, raw.length - 1);

    var targetTerm = sanitizeTerm_(filter.term || resolveTerm_(filter.term));
    var targetAssignmentId = String(filter.assignmentId || '').trim();
    var targetStudentId = String(filter.studentId || '').trim();
    var makeSaveKey = function(rowTerm, assignmentId, studentId, scoreId) {
      return String(scoreId || '').trim() || makeScoreRecordId_(rowTerm || targetTerm, assignmentId, studentId);
    };
    var makeVisibleKey = function(row) {
      return String(row.term || '').trim() + '|' + String(row.assignmentId || '').trim() + '|' + String(row.studentId || '').trim();
    };

    for (var i = 1; i < raw.length; i++) {
      var r = raw[i];
      var d = display[i];
      var assignmentId = String(r[idx.assignmentId] || '').trim();
      var studentId = String(r[idx.studentId] || '').trim();
      if (!assignmentId || !studentId || assignmentId.toLowerCase() === 'assignmentid' || studentId.toLowerCase() === 'studentid') continue;
      var rowTerm = sanitizeTerm_(r[idx.term] || targetTerm);
      var displayTerm = sanitizeTerm_(d[idx.term] || targetTerm);
      var termOk = !targetTerm || rowTerm === targetTerm || displayTerm === targetTerm;
      var assignmentOk = !targetAssignmentId || assignmentId === targetAssignmentId || String(d[idx.assignmentId] || '').trim() === targetAssignmentId;
      var studentOk = !targetStudentId || studentId === targetStudentId || String(d[idx.studentId] || '').trim() === targetStudentId;
      if (!termOk || !assignmentOk || !studentOk) continue;

      var visibleRow = {
        timestamp: d[idx.timestamp],
        assignmentId: d[idx.assignmentId],
        studentId: d[idx.studentId],
        score: d[idx.score],
        isSubmitted: d[idx.isSubmitted],
        term: d[idx.term]
      };
      var saveKey = makeSaveKey(r[idx.term] || targetTerm, r[idx.assignmentId], r[idx.studentId], r[idx.scoreId]);
      var displaySaveKey = makeSaveKey(d[idx.term] || targetTerm, d[idx.assignmentId], d[idx.studentId], d[idx.scoreId]);
      out.rows.push({
        rowNumber: i + 1,
        assignmentId: assignmentId,
        studentId: studentId,
        score: r[idx.score],
        isSubmitted: r[idx.isSubmitted],
        rawTypes: {
          timestamp: DEBUG_typeName_(r[idx.timestamp]),
          assignmentId: DEBUG_typeName_(r[idx.assignmentId]),
          studentId: DEBUG_typeName_(r[idx.studentId]),
          term: DEBUG_typeName_(r[idx.term])
        },
        normalized: {
          term: rowTerm,
          assignmentId: assignmentId,
          studentId: studentId,
          submitted: normalizeSubmittedFast_(r[idx.isSubmitted])
        },
        visible: visibleRow,
        scoreId: String(r[idx.scoreId] || '').trim(),
        saveKey: saveKey,
        displaySaveKey: displaySaveKey,
        visibleKey: makeVisibleKey(visibleRow),
        saveKeyEqualsDisplayKey: saveKey === displaySaveKey
      });
    }

    out.matchedRows = out.rows.length;
    out.duplicateBySaveKey = DEBUG_groupDuplicates_(out.rows, 'saveKey');
    out.duplicateByVisibleKey = DEBUG_groupDuplicates_(out.rows, 'visibleKey');
    if (out.duplicateBySaveKey.length > 0) {
      out.likelyCause.push('Rows are duplicate by the exact score save key. If saveScoresBatch does not remove them, deployed code may not be latest or another save call runs after it.');
    }
    if (out.duplicateByVisibleKey.length > 0 && out.duplicateBySaveKey.length === 0) {
      out.likelyCause.push('Rows look duplicate on screen but normalized score keys differ. Compare term/assignmentId/studentId types and values.');
    }
    if (out.rows.some(function(row) { return !row.saveKeyEqualsDisplayKey; })) {
      out.likelyCause.push('Raw values and display values normalize differently, usually numeric StudentID or Term formatting.');
    }
    if (out.matchedRows === 0) {
      out.likelyCause.push('No score rows matched the filter. Check assignment id, term, and header indexes.');
    }
    return out;
  } catch (err) {
    out.error = String(err && err.stack ? err.stack : err);
    return out;
  }
}

function DEBUG_assistantDiag_(studentId, termInput) {
  var out = {
    studentId: studentId,
    termInput: termInput,
    resolvedTerm: '',
    profile: null,
    assistantsRowMatched: [],
    effectiveUser: null,
    resolvedScope: null,
    readScope: null,
    studentLiteResult: null
  };
  try {
    var ss = getDb();
    var term = sanitizeTerm_(termInput || getCurrentTerm());
    out.resolvedTerm = term;
    
    // 1. Check profile in Students
    var studentSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.STUDENTS);
    if (studentSheet && studentSheet.getLastRow() > 1) {
      var data = studentSheet.getDataRange().getValues();
      for (var s = 1; s < data.length; s++) {
        if (String(data[s][0]).trim() === studentId) {
          out.profile = {
            id: data[s][0],
            name: data[s][1] + data[s][2] + ' ' + data[s][3],
            level: data[s][4],
            room: data[s][5],
            term: data[s][10]
          };
          break;
        }
      }
    }
    
    // 2. Check rows in AttendanceAssistants
    var asstSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.ATTENDANCE_ASSISTANTS);
    if (asstSheet && asstSheet.getLastRow() > 1) {
      var rows = asstSheet.getDataRange().getValues();
      var headers = rows[0] || [];
      var map = _liteHeaderMap_(headers);
      var idx = {
        assistantId: _liteIndex_(map, ['assistantid', 'assistant_id'], 0),
        studentId: _liteIndex_(map, ['assistantstudentid', 'studentid', 'รหัสนักเรียน', 'ผู้ช่วย'], 1),
        subject: _liteIndex_(map, ['subjectcode', 'subject'], 2),
        level: _liteIndex_(map, ['level'], 3),
        room: _liteIndex_(map, ['room'], 4),
        term: _liteIndex_(map, ['termid', 'term'], 5),
        status: _liteIndex_(map, ['status'], 6)
      };
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][idx.studentId] || '').trim() === studentId) {
          out.assistantsRowMatched.push({
            rowNo: i + 1,
            assistantId: rows[i][idx.assistantId],
            studentId: rows[i][idx.studentId],
            subject: rows[i][idx.subject],
            level: rows[i][idx.level],
            room: rows[i][idx.room],
            term: rows[i][idx.term],
            status: rows[i][idx.status]
          });
        }
      }
    }
    
    // 3. getEffectiveUser_
    var mockUser = { id: studentId, role: 'attendance_assistant' };
    out.effectiveUser = getEffectiveUser_(mockUser);
    
    // 4. getAttendanceAssistantScopeResolved_
    out.resolvedScope = getAttendanceAssistantScopeResolved_(studentId, term);
    
    // 5. _readTeacherClassScopeLite_
    out.readScope = _readTeacherClassScopeLite_(ss, term, mockUser, 1500);
    
    // 6. _readStudentsLiteResult_
    out.studentLiteResult = _readStudentsLiteResult_(ss, term, mockUser);
    
    return out;
  } catch (err) {
    out.error = String(err && err.stack ? err.stack : err);
    return out;
  }
}
