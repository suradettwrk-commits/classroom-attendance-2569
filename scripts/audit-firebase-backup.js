#!/usr/bin/env node

// Read-only audit for a Firebase RTDB export. This script never connects to
// Firebase and never writes to the database or to the input file.
const fs = require('fs');

const input = process.argv[2] || '_BACKUP_FIREBASE_LIVE_20260925_1030.json';
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = (name) => Object.values(data[name] || {});
const text = (value) => String(value ?? '').trim();
const first = (row, ...keys) => {
  for (const key of keys) {
    const value = text(row && row[key]);
    if (value) return value;
  }
  return '';
};
const idSet = (name, ...keys) => new Set(rows(name).map((row) => first(row, ...keys)).filter(Boolean));

const students = rows('students');
const assignments = rows('assignments');
const scores = rows('scores');
const attendance = rows('attendance');
const studentIds = idSet('students', 'StudentID', 'studentId');
const assignmentIds = idSet('assignments', 'AssignmentID', 'assignmentId', 'id');
const pseudoGrade = /^__GRADE_(pre|mid|post|final|att|read)$/i;
const assignmentRows = assignments.map((row) => ({
  id: first(row, 'AssignmentID', 'assignmentId', 'id'),
  subjectCode: first(row, 'SubjectCode', 'subjectCode'),
  level: first(row, 'Level', 'level'),
  room: first(row, 'Room', 'room'),
  term: first(row, 'TermID', 'Term', 'term'),
  teacherClassId: first(row, 'TeacherClassID', 'teacherClassId')
}));

const scoreIssues = [];
for (const row of scores) {
  const assignmentId = first(row, 'AssignmentID', 'assignmentId');
  const studentId = first(row, 'StudentID', 'studentId');
  const issues = [];
  if (studentId && !studentIds.has(studentId)) issues.push('missing-student');
  if (assignmentId && pseudoGrade.test(assignmentId)) issues.push('grade-component');
  else if (assignmentId && !assignmentIds.has(assignmentId)) issues.push('missing-assignment');
  if (issues.length) {
    scoreIssues.push({
      scoreId: first(row, 'ScoreID', 'scoreId'),
      assignmentId,
      studentId,
      term: first(row, 'TermID', 'Term', 'term'),
      subjectCode: first(row, 'SubjectCode', 'subjectCode'),
      score: row.Score ?? row.score ?? '',
      submitted: row.IsSubmitted ?? row.isSubmitted ?? '',
      issues
    });
  }
}

const attendanceIssues = attendance
  .map((row) => ({
    recordId: first(row, 'RecordID', 'recordId'),
    studentId: first(row, 'StudentID', 'studentId'),
    term: first(row, 'TermID', 'Term', 'term'),
    issues: !studentIds.has(first(row, 'StudentID', 'studentId')) ? ['missing-student'] : []
  }))
  .filter((row) => row.issues.length);

// Read-only mapping evidence for orphan assignments. A candidate is never
// selected automatically: even one candidate still requires human review
// before any production write is considered.
const orphanGroups = new Map();
for (const row of scores) {
  const assignmentId = first(row, 'AssignmentID', 'assignmentId');
  if (!assignmentId || assignmentIds.has(assignmentId) || pseudoGrade.test(assignmentId)) continue;
  const group = orphanGroups.get(assignmentId) || { assignmentId, rows: 0, nonEmpty: 0, subjects: new Set(), classes: new Set(), teacherClassIds: new Set() };
  const student = students.find((item) => first(item, 'StudentID', 'studentId') === first(row, 'StudentID', 'studentId'));
  const subjectCode = first(row, 'SubjectCode', 'subjectCode');
  const teacherClassId = first(row, 'TeacherClassID', 'teacherClassId');
  group.rows += 1;
  if (text(row.Score ?? row.score) !== '') group.nonEmpty += 1;
  if (subjectCode) group.subjects.add(subjectCode);
  if (student) group.classes.add(`${first(student, 'Level', 'level')}/${first(student, 'Room', 'room')}`);
  if (teacherClassId) group.teacherClassIds.add(teacherClassId);
  orphanGroups.set(assignmentId, group);
}
const mappingDryRun = [...orphanGroups.values()].map((group) => {
  const candidates = assignmentRows.filter((assignment) => {
    const subjectOk = !group.subjects.size || group.subjects.has(assignment.subjectCode);
    const classOk = !group.classes.size || [...group.classes].some((value) => value === `${assignment.level}/${assignment.room}`);
    const teacherClassOk = !group.teacherClassIds.size || group.teacherClassIds.has(assignment.teacherClassId);
    return subjectOk && classOk && teacherClassOk;
  }).map((assignment) => assignment.id).filter(Boolean);
  return {
    assignmentId: group.assignmentId,
    rows: group.rows,
    nonEmpty: group.nonEmpty,
    subjects: [...group.subjects].sort(),
    classes: [...group.classes].sort(),
    candidateAssignmentIds: candidates,
    status: candidates.length === 1 ? 'review-required-single-candidate' : candidates.length ? 'conflict-multiple-candidates' : 'orphan-no-candidate'
  };
});

const byIssue = (items) => items.reduce((result, item) => {
  for (const issue of item.issues) result[issue] = (result[issue] || 0) + 1;
  return result;
}, {});

const report = {
  input,
  readOnly: true,
  counts: Object.fromEntries(['students', 'assignments', 'scores', 'attendance', 'terms', 'teacherClasses', 'subjects', 'users'].map((name) => [name, rows(name).length])),
  scoreIssues: {
    total: scoreIssues.length,
    byIssue: byIssue(scoreIssues),
    withNonEmptyScore: scoreIssues.filter((row) => text(row.score) !== '').length,
    assignmentIds: [...new Set(scoreIssues.filter((row) => row.issues.includes('missing-assignment')).map((row) => row.assignmentId))].sort(),
    mappingDryRun,
    samples: scoreIssues.slice(0, 20)
  },
  attendanceIssues: {
    total: attendanceIssues.length,
    byIssue: byIssue(attendanceIssues),
    samples: attendanceIssues.slice(0, 20)
  },
  terms: rows('terms').map((row) => ({
    termId: first(row, 'TermID', 'termId'),
    termNo: row.TermNo ?? row.termNo ?? '',
    academicYear: row.AcademicYear ?? row.academicYear ?? '',
    status: first(row, 'Status', 'status')
  }))
};

console.log(JSON.stringify(report, null, 2));
