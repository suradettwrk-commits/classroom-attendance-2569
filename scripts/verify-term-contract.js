#!/usr/bin/env node

/* Read-only check for the canonical term contract used by every staff tab. */
const fs = require('fs');
const path = require('path');

const input = process.argv[2] || process.env.TERM_CONTRACT_INPUT || path.join(__dirname, 'fixtures', 'term-contract-fixture.json');
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = value => Array.isArray(value) ? value : Object.values(value || {});
const text = value => String(value == null ? '' : value).trim();
const field = (row, names) => names.map(name => row && row[name]).find(value => value !== undefined && value !== null && text(value) !== '');
const terms = rows(source.terms);
const termByLabel = new Map();
const termIds = new Set();

for (const term of terms) {
  const id = text(field(term, ['TermID', 'term_id', 'termId']));
  const no = text(field(term, ['TermNo', 'term_no', 'termNo']));
  const year = text(field(term, ['AcademicYear', 'academic_year', 'academicYear']));
  if (!id) continue;
  termIds.add(id);
  if (no && year) termByLabel.set(`${no}/${year}`, id);
  termByLabel.set(id, id);
}

const report = { input, termCount: terms.length, canonicalTerms: [...termIds], tables: {}, errors: [] };
for (const [name, values] of Object.entries(source)) {
  if (!['students', 'subjects', 'teacherClasses', 'assignments', 'attendance', 'scores'].includes(name)) continue;
  const table = { rows: 0, resolvableTermRefs: 0, missingTermRefs: 0, syntheticTermRefs: 0 };
  for (const row of rows(values)) {
    table.rows += 1;
    const ref = text(field(row, ['TermID', 'term_id', 'termId', 'Term', 'term']));
    if (!ref) { table.missingTermRefs += 1; continue; }
    if (/^TERM_\d+_\d+$/i.test(ref)) { table.syntheticTermRefs += 1; report.errors.push(`${name}: synthetic term key ${ref}`); continue; }
    if (termByLabel.has(ref)) table.resolvableTermRefs += 1;
    else report.errors.push(`${name}: unknown term reference ${ref}`);
  }
  report.tables[name] = table;
}

console.log(JSON.stringify(report, null, 2));
if (report.termCount === 0 || report.canonicalTerms.length === 0 || report.errors.length) process.exitCode = 1;
