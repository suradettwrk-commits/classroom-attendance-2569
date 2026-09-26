/* Read-only regression contract for the browser-facing workflows.
 * This is intentionally dependency-free so it runs in CI and before a
 * static GitHub Pages build without a browser or a live database.
 */
const fs = require('fs');

const admin = fs.readFileSync('admin.html', 'utf8');
const bridge = fs.readFileSync('firebase-bridge.js', 'utf8');
const auth = fs.readFileSync('supabase-auth.js', 'utf8');
const compat = fs.readFileSync('supabase-compat.js', 'utf8');

const checks = [
  ['Auth accepts only approved staff roles', [auth, bridge], /admin.*teacher.*attendance_assistant/],
  ['writes verify the signed-in identity', [bridge], /verifiedIdentityUser\(\)[\s\S]*teacherOrAdmin/],
  ['teacher reads are scoped by term and class', [bridge], /allowedScopeRows[\s\S]*matchesTerm[\s\S]*SubjectCode[\s\S]*Level[\s\S]*Room/],
  ['term labels resolve to canonical term ids', [bridge, compat], /canonicalTermId[\s\S]*term_id/],
  ['grading cascades level and room from subject', [admin], /subjectEl\.onchange[\s\S]*refreshOptions[\s\S]*levelEl\.onchange[\s\S]*roomIdEl/],
  ['grading rejects an unmatched teacher subject', [admin], /isTeacher && filteredCombos\.length === 0[\s\S]*updateSelectOptions\(levelEl, \[\]\)[\s\S]*updateSelectOptions\(roomIdEl, \[\]\)/],
  ['attendance toggle clears the selected status', [admin], /currentStatus === String\(newStatus \|\| ''\)[\s\S]*nextStatus[\s\S]*''/],
  ['attendance clear queues the blank status for persistence', [admin, bridge], /queueSync\(id, nextStatus[\s\S]*saveAttendance[\s\S]*Status:/],
  ['attendance renders an empty-day roster', [admin, bridge], /getAttendanceForCheck[\s\S]*state\.students[\s\S]*render\(\)/],
  ['read timeout has a bounded fallback path', [bridge, compat], /callReadWithRecovery[\s\S]*client\/read-timeout[\s\S]*SUPABASE_READ_SKIPPED/]
];

const failures = checks.filter(([, sources, pattern]) => !pattern.test(sources.join('\n')));
if (failures.length) {
  console.error('UI regression contract failed:');
  failures.forEach(([label]) => console.error(`- ${label}`));
  process.exit(1);
}
console.log(`UI regression contract passed (${checks.length} checks)`);
