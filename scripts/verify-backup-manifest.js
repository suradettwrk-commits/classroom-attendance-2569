#!/usr/bin/env node

/* Read-only backup integrity check. It never writes to a backup or database. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const manifest = path.resolve(process.argv[2] || process.env.BACKUP_MANIFEST || 'backup-manifest.sha256');
const base = path.dirname(manifest);
const lines = fs.readFileSync(manifest, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const results = lines.map(line => {
  const match = line.match(/^([a-f0-9]{64})\s+\*?(.*)$/i);
  if (!match) return { line, ok: false, error: 'invalid manifest line' };
  const expected = match[1].toLowerCase();
  const file = path.resolve(base, match[2].replace(/^\.\//, ''));
  if (!fs.existsSync(file)) return { file, ok: false, error: 'missing file' };
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { file, expected, actual, ok: expected === actual };
});

console.log(JSON.stringify({ manifest, files: results.length, results }, null, 2));
if (!results.length || results.some(result => !result.ok)) process.exitCode = 1;
