const fs = require('fs');
const path = require('path');

const root = __dirname;
const outDir = process.env.LOCAL_TEST_OUTPUT_DIR
  ? path.resolve(process.env.LOCAL_TEST_OUTPUT_DIR)
  : path.join(root, 'scratch', 'local-test');
const backupPath = process.argv[2] || path.join(root, '_BACKUP_FIREBASE_LIVE_20260925_1030.json');
fs.mkdirSync(outDir, { recursive: true });

const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
fs.writeFileSync(path.join(outDir, 'local-test-data.json'), JSON.stringify(backup), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html
  .replace(/<script\s+src="https:\/\/cdn\.tailwindcss\.com\"><\/script>/g, '')
  .replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/sweetalert2@11"><\/script>/g, '')
  .replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js"><\/script>/g, '')
  .replace(/<link[^>]+href="https:\/\/cdnjs\.cloudflare\.com[^>]+>/g, '')
  .replace(/<link[^>]+href="https:\/\/fonts\.googleapis\.com[^>]+>/g, '');
// Keep local test composition identical to the staff-only production entry
// point. Student/assistant pages remain available as source data for staff
// features, but must not be injected into this login flow.
for (const name of ['loader', 'admin']) {
  const source = fs.readFileSync(path.join(root, `${name}.html`), 'utf8');
  html = html.replace(new RegExp(`<\\?!= include\\(['"]${name}['"]\\);? \\?\\>`, 'g'), source);
}
html = html
  .replace(/<script\s+src="https:\/\/[^"\n]+"><\/script>/gi, '')
  .replace(/<link[^>]+href="https:\/\/[^>]+>/gi, '')
  .replace(/url\(['"]https:\/\/[^'"]+['"]\)/gi, 'none')
  .replace(/src="https:\/\/[^"\n]+"/gi, 'src=""')
  // Keep the local test truly offline: broken-image fallbacks and export
  // links must not reach avatar or Google Sheets services.
  .replace(/https:\/\/ui-avatars\.com\/[^"'\s<>]+/gi, '')
  .replace(/https:\/\/docs\.google\.com\/spreadsheets\/create/gi, '#');
// Restore the original dependency tags after the data/link sanitizing pass.
// The Firebase adapter remains local and in-memory, while the UI stays
// visually identical to the production staff entry point.
html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const name of ['loader', 'admin']) {
  const source = fs.readFileSync(path.join(root, `${name}.html`), 'utf8');
  html = html.replace(new RegExp(`<\\?!= include\\(['"]${name}['"]\\);? \\?\\>`, 'g'), source);
}
html = html
  .replace(/https:\/\/ui-avatars\.com\/[^"'\s<>]+/gi, '')
  .replace(/https:\/\/docs\.google\.com\/spreadsheets\/create/gi, '#');
html = html.replace(/<base target="_top">/g, '<base target="_self">');
html = html.replace(/ทำงานบนฐานข้อมูล Firebase เดียวกับนักเรียน งาน และคะแนนของระบบหลัก/g, 'ทำงานบนฐานข้อมูลสำรองจำลองในเครื่อง (Local Test)');
html = html.replace('<head>', '<head><script>window.__LOCAL_TEST_MODE__=true;</script>');
const localScripts = `
<script>window.__LOCAL_TEST_MODE__=true;(function(){var r=new XMLHttpRequest();r.open('GET','/local-test-data.json',false);r.send(null);if(r.status>=200&&r.status<300)window.__LOCAL_TEST_DATA__=JSON.parse(r.responseText);else throw new Error('โหลด local test data ไม่สำเร็จ: '+r.status);})();</script>
<script>${fs.readFileSync(path.join(root, 'local-test-ui.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(root, 'local-test-firebase.js'), 'utf8')}</script>
<script>${fs.readFileSync(path.join(root, 'firebase-bridge.js'), 'utf8')}</script>
`;
html = html.replace('</head>', `${localScripts}</head>`);
// Ensure the login button always has a deterministic local-only path after
// all source handlers have been parsed. This never exists in production.
const localLoginOverride = `<script>
window.firebaseSignInWithGoogle = async function () {
  const role = new URLSearchParams(window.location.search || '').get('localRole') || 'admin';
  const auth = window.firebase.auth();
  const authResult = await auth.signInWithPopup(new window.firebase.auth.GoogleAuthProvider());
  const email = role === 'teacher' ? 'suradett.wrk@eisth.org' : 'suradet.t@wrk.ac.th';
  return { success: true, user: {
    id: role === 'teacher' ? 'USR-20260616-144217' : 'admin',
    username: email,
    name: role === 'teacher' ? 'ครูสุรเดช ธรรมประโชติ' : 'ผู้ดูแลระบบทดสอบ',
    role, email, status: 'Active', imageUrl: '',
    authUser: authResult.user
  }};
};
if (new URLSearchParams(window.location.search || '').get('localRole')) {
  const localAutoLogin = function () {
    setTimeout(async function () {
      try {
        const result = await window.firebaseSignInWithGoogle();
        CURRENT_USER = result.user;
        if (typeof saveSession === 'function') saveSession(CURRENT_USER);
        if (typeof renderAppByRole === 'function') renderAppByRole();
      } catch (error) {
        console.error('Local auto-login failed', error);
      }
    }, 50);
  };
  // Run directly as this script is appended at the end of the document; the
  // load event is not reliable in every embedded browser harness.
  localAutoLogin();
}
</script>`;
html = html.replace('</body>', `${localLoginOverride}</body>`);
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
if (fs.existsSync(path.join(root, 'docs', 'tailwind.css'))) {
  fs.copyFileSync(path.join(root, 'docs', 'tailwind.css'), path.join(outDir, 'tailwind.css'));
}
fs.copyFileSync(path.join(root, 'local-test-firebase.js'), path.join(outDir, 'local-test-firebase.js'));
fs.copyFileSync(path.join(root, 'firebase-bridge.js'), path.join(outDir, 'firebase-bridge.js'));
console.log(`Built local test app at ${outDir}`);
console.log(`Backup: ${backupPath}`);
