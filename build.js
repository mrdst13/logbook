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
const JS_DIR = path.join(SRC, 'js');

const checkMode = process.argv.includes('--check');
const OUT = path.join(ROOT, checkMode ? 'logbook.built.html' : 'logbook.html');

// Read head + body
const head = fs.readFileSync(path.join(SRC, 'head.html'), 'utf8');
let body = fs.readFileSync(path.join(SRC, 'body.html'), 'utf8');

// Detect line ending from source so the build matches the original convention.
// Windows checkouts get CRLF (\r\n); Unix gets LF (\n). Either way, output stays
// consistent with the source files.
const EOL = head.includes('\r\n') ? '\r\n' : '\n';

// Read CSS files in alphabetical order (the numeric prefixes enforce order)
const styleFiles = fs
  .readdirSync(STYLES_DIR)
  .filter(f => f.endsWith('.css'))
  .sort();
const styles = styleFiles
  .map(f => fs.readFileSync(path.join(STYLES_DIR, f), 'utf8'))
  .join('');

// Read JS files in alphabetical order. Currently a single app.js; numeric
// prefixes (00-util.js, 01-db.js, 02-domain.js, etc.) enforce order when
// the JS is split further in later phases.
const jsFiles = fs.existsSync(JS_DIR)
  ? fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort()
  : [];
const jsContent = jsFiles
  .map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8'))
  .join('');

// Inject <script>...</script> into body.html at the marker
const SCRIPT_MARKER = '<!-- INJECT_JS -->';
const scriptBlock = '<script>' + EOL + jsContent + EOL + '</script>';
body = body.replace(SCRIPT_MARKER, scriptBlock);

// Strip diagnostic console.log / console.info / console.debug from the
// production build. console.warn and console.error stay — they signal real
// problems and we want them visible in DevTools.
//
// We replace `console.X(` with `void(` rather than removing the line,
// because removing leaves `if (cond) ;` artefacts and breaks expression-
// level usage (e.g. `(console.log(x), x + 1)`). `void(...)` is a no-op
// expression that swallows any argument list.
//
// Skipped in --check mode so byte-identical diffs still work for CI
// verification of un-stripped builds.
if (!checkMode) {
  body = body.replace(/console\.(log|info|debug)\s*\(/g, 'void(');
}

// Assemble
const output = head + '<style>' + EOL + styles + '</style>' + EOL + body;

fs.writeFileSync(OUT, output);

console.log(`Built ${path.relative(ROOT, OUT)}`);
console.log(`  ${output.length.toLocaleString()} bytes`);
console.log(`  ${output.split('\n').length.toLocaleString()} lines`);
console.log(`  ${styleFiles.length} CSS files: ${styleFiles.join(', ')}`);
console.log(`  ${jsFiles.length} JS files:  ${jsFiles.join(', ')}`);

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
