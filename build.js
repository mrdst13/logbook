#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Cumulo build script
// Concatenates src/* into a single logbook.html ready for deployment.
//
// Usage:
//   node build.js                  → writes logbook.html
//   node build.js --check          → writes logbook.built.html, then diffs
//                                    against logbook.html (verification only)
//
// Source layout:
//   src/head.html              → <head> meta tags + CDN scripts (before <style>)
//   src/styles/NN-*.css        → CSS, concatenated alphabetically into <style>
//   src/body.html              → </head> + <body>...</body></html> incl. inline JS
//
// The build output is byte-identical to the previous logbook.html when no
// source files have changed. CI can verify this with `git diff --exit-code`.
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const STYLES_DIR = path.join(SRC, 'styles');

const checkMode = process.argv.includes('--check');
const OUT = path.join(ROOT, checkMode ? 'logbook.built.html' : 'logbook.html');

// Read head + body
const head = fs.readFileSync(path.join(SRC, 'head.html'), 'utf8');
const body = fs.readFileSync(path.join(SRC, 'body.html'), 'utf8');

// Read CSS files in alphabetical order (the numeric prefixes enforce order)
const styleFiles = fs
  .readdirSync(STYLES_DIR)
  .filter(f => f.endsWith('.css'))
  .sort();

const styles = styleFiles
  .map(f => fs.readFileSync(path.join(STYLES_DIR, f), 'utf8'))
  .join('');

// Detect line ending from source so the build matches the original convention.
// Windows checkouts get CRLF (\r\n); Unix gets LF (\n). Either way, output stays
// consistent with the source files.
const EOL = head.includes('\r\n') ? '\r\n' : '\n';

// Assemble
const output = head + '<style>' + EOL + styles + '</style>' + EOL + body;

fs.writeFileSync(OUT, output);

console.log(`Built ${path.relative(ROOT, OUT)}`);
console.log(`  ${output.length.toLocaleString()} bytes`);
console.log(`  ${output.split('\n').length.toLocaleString()} lines`);
console.log(`  ${styleFiles.length} CSS files: ${styleFiles.join(', ')}`);

if (checkMode) {
  const original = fs.readFileSync(path.join(ROOT, 'logbook.html'), 'utf8');
  if (output === original) {
    console.log('\nCheck: PASS — built output is byte-identical to logbook.html');
  } else {
    console.log('\nCheck: FAIL — built output differs from logbook.html');
    console.log(`  Original: ${original.length.toLocaleString()} bytes`);
    console.log(`  Built:    ${output.length.toLocaleString()} bytes`);
    process.exit(1);
  }
}
