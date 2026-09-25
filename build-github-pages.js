const fs = require('fs');
const path = require('path');
const root = __dirname;
const docs = path.join(root, 'docs');
const assetVersion = process.env.BUILD_VERSION || Date.now().toString();
fs.mkdirSync(docs, { recursive: true });
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const firebaseBridge = fs.readFileSync(path.join(root, 'firebase-bridge.js'), 'utf8');
const supabaseScoreClient = fs.readFileSync(path.join(root, 'supabase-score-client.js'), 'utf8');
const supabaseAuthClient = fs.readFileSync(path.join(root, 'supabase-auth-client.js'), 'utf8');
for (const name of ['loader', 'admin', 'student', 'assistant']) {
  const source = fs.readFileSync(path.join(root, `${name}.html`), 'utf8');
  html = html.replace(new RegExp(`<\\?!= include\\(['"]${name}['"]\\);? \\?\\>`,'g'), source);
}
html = html.replace(/<base target="_top">/g, '<base target="_self">');
	const firebaseScripts = `\n<script src="https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js"></script>\n<script src="https://www.gstatic.com/firebasejs/11.10.0/firebase-auth-compat.js"></script>\n<script src="https://www.gstatic.com/firebasejs/11.10.0/firebase-database-compat.js"></script>\n<script>window.firebaseConfig=${JSON.stringify({apiKey:'AIzaSyAvkpNC0MjZjJZk_MAr1CS9wFRYlcEYR18',authDomain:'classroom-attendance-2569.firebaseapp.com',databaseURL:'https://classroom-attendance-2569-default-rtdb.asia-southeast1.firebasedatabase.app',projectId:'classroom-attendance-2569',storageBucket:'classroom-attendance-2569.firebasestorage.app',messagingSenderId:'932800813506',appId:'1:932800813506:web:316e5ffea3a3a96775de5b'})};</script>\n<script>\n${firebaseBridge}\n</script>\n`;
const supabaseScripts = `\n<script src="./supabase-auth-client.js?v=${assetVersion}"></script>\n<script>\n${supabaseScoreClient}\n</script>\n`;
html = html.replace('</head>', `${firebaseScripts}${supabaseScripts}</head>`);
fs.writeFileSync(path.join(docs, 'index.html'), html, 'utf8');
fs.copyFileSync(path.join(root, 'firebase-bridge.js'), path.join(docs, 'firebase-bridge.js'));
fs.copyFileSync(path.join(root, 'supabase-auth-client.js'), path.join(docs, 'supabase-auth-client.js'));
fs.copyFileSync(path.join(root, 'supabase-score-client.js'), path.join(docs, 'supabase-score-client.js'));
console.log(`Built ${path.join(docs, 'index.html')} (${Buffer.byteLength(html)} bytes)`);
