#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');

const backupPath = process.env.FIREBASE_BACKUP_PATH || process.argv[2];
if (!backupPath) throw new Error('Usage: FIREBASE_BACKUP_PATH=/path/backup.json node scripts/firebase-backup-verify.js');
const raw = fs.readFileSync(backupPath);
const data = JSON.parse(raw);
const counts = {};
for (const [key, value] of Object.entries(data)) {
  counts[key] = value && typeof value === 'object' ? Object.keys(value).length : 1;
}

const termRows = Object.entries(data.terms || {});
const canonicalTerms = termRows.map(([legacyKey, row]) => ({
  legacyKey,
  termId: `AY${row.AcademicYear}_T${row.TermNo}`,
  displayLabel: `${row.TermNo}/${row.AcademicYear}`,
  sourceTermId: row.TermID || null,
}));
const termMap = new Map(canonicalTerms.map(t => [t.sourceTermId || t.legacyKey, t.termId]));
for (const t of canonicalTerms) {
  termMap.set(t.displayLabel, t.termId);
  termMap.set(t.displayLabel.replace('/', '_'), t.termId);
}
const resolveTerm = (row, legacyKey = '') => {
  const value = String(row?.TermID || row?.Term || row?.termId || row?.term || legacyKey);
  if (value.startsWith('TC_1_2569_')) return termMap.get('1_2569');
  return termMap.get(value) || null;
};

const scoreRows = Object.values(data.scores || {});
const assignmentIds = new Set(Object.keys(data.assignments || {}).map(String));
const studentIds = new Set(Object.keys(data.students || {}).map(String));
const scoreChecks = {
  total: scoreRows.length,
  nonBlankScore: scoreRows.filter(r => r.Score !== undefined && r.Score !== null && String(r.Score).trim() !== '').length,
  uniqueScoreIds: new Set(scoreRows.map(r => r.ScoreID).filter(Boolean)).size,
  uniqueAssignmentIds: new Set(scoreRows.map(r => r.AssignmentID).filter(Boolean)).size,
  uniqueStudentIds: new Set(scoreRows.map(r => r.StudentID).filter(Boolean)).size,
  missingAssignmentRows: scoreRows.filter(r => r.AssignmentID && !assignmentIds.has(String(r.AssignmentID)) && !String(r.AssignmentID).startsWith('__GRADE_')).length,
  missingStudentRows: scoreRows.filter(r => r.StudentID && !studentIds.has(String(r.StudentID))).length,
};

const result = {
  backupSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  counts,
  canonicalTerms,
  unresolvedTermRows: ['students','subjects','teacherClasses','assignments','attendance','scores']
    .reduce((out, table) => { out[table] = Object.entries(data[table] || {}).filter(([id,r]) => !resolveTerm(r,id)).length; return out; }, {}),
  scoreChecks,
};
console.log(JSON.stringify(result, null, 2));
if (scoreChecks.missingAssignmentRows || scoreChecks.missingStudentRows) process.exitCode = 2;
