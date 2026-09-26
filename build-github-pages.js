const fs = require('fs');
const path = require('path');
const root = __dirname;
const docs = path.join(root, 'docs');
const assetVersion = process.env.BUILD_VERSION || Date.now().toString();
fs.mkdirSync(docs, { recursive: true });
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const firebaseBridge = fs.readFileSync(path.join(root, 'firebase-bridge.js'), 'utf8');
const supabaseConfig = fs.readFileSync(path.join(root, 'supabase-config.js'), 'utf8');
const supabaseCompat = fs.readFileSync(path.join(root, 'supabase-compat.js'), 'utf8');
const supabaseAuth = fs.readFileSync(path.join(root, 'supabase-auth.js'), 'utf8');
for (const name of ['loader', 'admin', 'student', 'assistant']) {
  const source = fs.readFileSync(path.join(root, `${name}.html`), 'utf8');
  html = html.replace(new RegExp(`<\\?!= include\\(['"]${name}['"]\\);? \\?\\>`,'g'), source);
}
html = html.replace(/<base target="_top">/g, '<base target="_self">');
const firebaseScripts = `\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n<script>${supabaseConfig}</script>\n<script>${supabaseCompat}</script>\n<script>${firebaseBridge}</script>\n<script>${supabaseAuth}</script>\n`;
html = html.replace('</head>', `${firebaseScripts}</head>`);
fs.writeFileSync(path.join(docs, 'index.html'), html, 'utf8');
fs.copyFileSync(path.join(root, 'firebase-bridge.js'), path.join(docs, 'firebase-bridge.js'));
console.log(`Built ${path.join(docs, 'index.html')} (${Buffer.byteLength(html)} bytes)`);
