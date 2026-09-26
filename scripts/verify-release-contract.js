const fs = require('fs');

const admin = fs.readFileSync('admin.html', 'utf8');
const bridge = fs.readFileSync('firebase-bridge.js', 'utf8');
const compat = fs.readFileSync('supabase-compat.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260926_harden_staff_rls.sql', 'utf8');
const indexMigration = fs.readFileSync('supabase/migrations/20260926_add_term_activity_indexes.sql', 'utf8');

const checks = [
  ['attendance renderer uses explicit status buttons', /data-attendance-status/],
  ['attendance supports all four status colors', /attendance-status-green[\s\S]*attendance-status-yellow[\s\S]*attendance-status-blue[\s\S]*attendance-status-red/],
  ['dashboard warning is beyond the 30s read circuit breaker', /setTimeout\(\(\) => \{[\s\S]*Dashboard stats still running[\s\S]*\}, 35000\)/],
  ['student writes retain a durable timeout', /STUDENT_WRITE_CALL_TIMEOUT_MS\s*=\s*45000/],
  ['term-scoped activity reads exist', /const termScoped = \['assignments', 'attendance', 'scores'\]/],
  ['activity reads use bounded projections', /const projections = \{[\s\S]*assignments:[\s\S]*attendance:[\s\S]*scores:/],
  ['activity indexes are part of the migration', /idx_app_users_lower_email[\s\S]*idx_assignments_term_subject_class[\s\S]*idx_attendance_term_date_class[\s\S]*idx_scores_term_assignment_student/],
  ['RLS migration keeps staff-only policy', /create policy staff_select_/],
];

const source = `${admin}\n${bridge}\n${compat}\n${migration}\n${indexMigration}`;
const failures = checks.filter(([, pattern]) => !pattern.test(source));
if (failures.length) {
  console.error('Release contract failed:');
  failures.forEach(([label]) => console.error(`- ${label}`));
  process.exit(1);
}
console.log(`Release contract passed (${checks.length} checks)`);
