#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'docs'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|html|ts|sql|md|json)$/.test(entry.name)) files.push(full);
  }
}
walk(root);
const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  if (/service_role\s*[:=]|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|ghp_[A-Za-z0-9_]+/.test(text)) violations.push(`${rel}: possible secret material`);
  if (/TermID\s*[:=]\s*['"`]20\d{2}-\d{2}-\d{2}T/.test(text)) violations.push(`${rel}: timestamp used as TermID`);
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`repository safety check passed (${files.length} files scanned)`);
}
