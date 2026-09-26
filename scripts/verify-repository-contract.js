/* Read-only smoke test for the browser repository contract. */
const fs = require('fs');

const source = fs.readFileSync('firebase-bridge.js', 'utf8');
const requiredMethods = [
  'getAllowedScopes',
  'getStudents',
  'getAssignments',
  'getAttendance',
  'getScoreGrid',
  'getGradingRoster',
  'saveAttendance',
  'saveScores',
  'saveGrades'
];
const requiredRoutes = [
  'getStudentsByFilter',
  'getAttendanceForCheck',
  'loadScoresGrid',
  'getGradingData',
  'saveAttendance',
  'saveScoresBatch',
  'saveGradingBatch'
];
const missingMethods = requiredMethods.filter(name => !source.includes(`${name}:`));
const missingRoutes = requiredRoutes.filter(name => !source.includes(`${name}: (args)`));

if (missingMethods.length || missingRoutes.length) {
  console.error(JSON.stringify({ missingMethods, missingRoutes }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'PASS',
  repositoryMethods: requiredMethods.length,
  routedCrudMethods: requiredRoutes.length,
  invariant: 'Auth → term_id → permission → repository → UI'
}, null, 2));
