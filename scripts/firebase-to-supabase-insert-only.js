#!/usr/bin/env node
/*
 * Insert-only staging importer. It never updates or deletes Supabase rows.
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_BACKUP_PATH.
 * Run with DRY_RUN=1 first; Firebase remains the source of truth.
 */
const fs = require('fs');
const backupPath = process.env.FIREBASE_BACKUP_PATH;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.DRY_RUN !== '0';
const batchSize = Number(process.env.BATCH_SIZE || 250);
const concurrency = Math.max(1, Number(process.env.IMPORT_CONCURRENCY || 4));
const onlyTables = process.env.ONLY_TABLES ? new Set(process.env.ONLY_TABLES.split(',').map(x => x.trim()).filter(Boolean)) : null;
if (!backupPath || !supabaseUrl || !serviceKey) throw new Error('Set FIREBASE_BACKUP_PATH, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
const data = JSON.parse(fs.readFileSync(backupPath));

// Keep the original Firebase record for auditability, but never duplicate
// embedded data URLs (which can make a REST request unnecessarily huge).
const safeLegacy = (legacyId, record) => {
  const copy = { legacy_id: legacyId, ...record };
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === 'string' && value.startsWith('data:image/')) copy[key] = '[omitted data URL]';
  }
  return copy;
};

const terms = Object.entries(data.terms || {});
const termMap = new Map();
const rows = {
  terms: terms.map(([legacyKey, r]) => {
    const termId = `AY${r.AcademicYear}_T${r.TermNo}`;
    termMap.set(r.TermID || legacyKey, termId);
    termMap.set(`${r.TermNo}/${r.AcademicYear}`, termId);
    termMap.set(`${r.TermNo}_${r.AcademicYear}`, termId);
    return { term_id: termId, display_label: `${r.TermNo}/${r.AcademicYear}`, academic_year: Number(r.AcademicYear), term_no: Number(r.TermNo), status: r.Status || 'active', legacy_term_key: legacyKey, legacy_data: r, created_at: r.CreatedAt || null };
  }),
  app_users: Object.entries(data.users || {}).map(([legacyId, r]) => ({ user_id: r.UserID || legacyId, username: r.Username || null, email: r.Email || null, role: r.Role || null, status: r.Status || null, legacy_data: safeLegacy(legacyId, r) })),
  auth_profiles: Object.entries(data.authProfiles || {}).map(([legacyId, r]) => ({ legacy_user_id: r.UserID || legacyId, email: r.Email || r.email || null, role: r.Role || r.role || null, status: r.Status || r.status || null, legacy_data: safeLegacy(legacyId, r) })),
};
const canonicalTerm = (r, legacyKey = '') => {
  const value = String(r?.TermID || r?.Term || r?.termId || r?.term || legacyKey);
  if (value.startsWith('TC_1_2569_')) return termMap.get('1_2569');
  return termMap.get(value) || null;
};
const legacyRows = (table, mapper) => Object.entries(data[table] || {}).map(([legacyId, r]) => mapper(legacyId, r)).filter(Boolean);
rows.subjects = legacyRows('subjects', (id,r) => { const termId=canonicalTerm(r); return termId && {subject_code:r.SubjectCode||id, term_id:termId, subject_name:r.SubjectName||null, teacher:r.Teacher||null, status:r.Status||null, legacy_data:safeLegacy(id,r)}; });
rows.students = legacyRows('students', (id,r) => { const termId=canonicalTerm(r); return termId && {student_id:r.StudentID||id, term_id:termId, student_no:r.No == null ? null : String(r.No), prefix:r.Prefix||null, first_name:r.FirstName||null, last_name:r.LastName||null, level:r.Level||null, room:r.Room||null, status:r.Status||null, legacy_data:safeLegacy(id,r)}; });
rows.teacher_classes = legacyRows('teacherClasses', (id,r) => { const decodedId=decodeURIComponent(id); const keyTerm=decodedId.startsWith('TC_1_2569_') ? '1_2569' : decodedId.split('_')[0]; const termId=canonicalTerm(r, keyTerm); return termId && {teacher_class_id:r.TeacherClassID||id, term_id:termId, teacher_id:r.TeacherID||null, subject_code:r.SubjectCode||null, level:r.Level||null, room:r.Room||null, status:r.Status||null, legacy_data:safeLegacy(id,r)}; });
rows.assignments = legacyRows('assignments', (id,r) => { const termId=canonicalTerm(r); const dueDate=r.DueDate||r.dueDate||null; return termId && {assignment_id:r.AssignmentID||id, term_id:termId, teacher_class_id:r.TeacherClassID||null, subject_code:r.SubjectCode||null, title:r.Title||null, assignment_type:r.Type||null, max_score:r.MaxScore == null ? null : Number(r.MaxScore), due_date:dueDate || null, level:r.Level||null, room:r.Room||null, status:r.Status||null, legacy_data:safeLegacy(id,r)}; });
rows.attendance = legacyRows('attendance', (id,r) => { const termId=canonicalTerm(r); return termId && {record_id:r.RecordID||id, term_id:termId, student_id:r.StudentID||null, subject_code:r.SubjectCode||null, attendance_date:r.Date||null, status:r.Status||null, note:r.Note||null, recorder:r.Recorder||null, legacy_data:safeLegacy(id,r)}; });
rows.scores = legacyRows('scores', (id,r) => { const termId=canonicalTerm(r); return termId && {score_id:r.ScoreID||id, term_id:termId, assignment_id:r.AssignmentID||null, student_id:r.StudentID||null, subject_code:r.SubjectCode||null, score:r.Score == null || r.Score === '' ? null : Number(r.Score), is_submitted:Boolean(r.IsSubmitted), legacy_data:safeLegacy(id,r)}; });
rows.settings = Object.entries(data.settings || {}).map(([legacyId, r]) => ({ setting_key:r.Key || legacyId, term_id:canonicalTerm(r) || 'GLOBAL', value:r.Value ?? null, updated_by:r.UpdatedBy || null, updated_at:r.UpdatedAt || null }));
rows.audit_log = (Array.isArray(data.auditLog) ? data.auditLog : Object.values(data.auditLog || {})).map((r) => ({ action:r.Action || r.action || null, target:r.Target || r.target || null, term_id:canonicalTerm(r) || null, user_id:r.UserID || r.userId || null, detail:r.Detail || r.detail || r, occurred_at:r.OccurredAt || r.occurredAt || r.Timestamp || null }));

async function insert(table, values) {
  if (onlyTables && !onlyTables.has(table)) return {table, count:0, skipped:true};
  if (!values.length) return {table, count:0};
  if (dryRun) return {table, count:values.length, dryRun:true};
  const batches = [];
  for (let i = 0; i < values.length; i += batchSize) batches.push({ index:i, rows:values.slice(i, i + batchSize) });
  for (let start = 0; start < batches.length; start += concurrency) {
    const group = batches.slice(start, start + concurrency);
    await Promise.all(group.map(async ({index, rows:batch}) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, { method:'POST', headers:{ apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json', Prefer:'resolution=ignore-duplicates,return=minimal' }, body:JSON.stringify(batch) });
      if (!response.ok) throw new Error(`${table} batch ${index}-${index + batch.length}: ${response.status} ${await response.text()}`);
    }));
  }
  return {table, count:values.length, batches:batches.length, concurrency};
}
(async()=>{
  const result=[];
  result.push(await insert('terms', rows.terms));
  for (const group of [['app_users','auth_profiles','subjects','students','teacher_classes'], ['assignments','attendance','scores','settings','audit_log']]) {
    const groupResult = await Promise.all(group.map(table => insert(table, rows[table])));
    result.push(...groupResult);
  }
  console.log(JSON.stringify({dryRun, batchSize, concurrency, onlyTables:onlyTables ? [...onlyTables] : null, result}, null, 2));
})().catch(err=>{ console.error(err.stack||err); process.exit(1); });
