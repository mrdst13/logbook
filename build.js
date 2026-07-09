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
const { execSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const STYLES_DIR = path.join(SRC, 'styles');
const JS_DIR = path.join(SRC, 'js');

const checkMode = process.argv.includes('--check');
const OUT = path.join(ROOT, checkMode ? 'logbook.built.html' : 'logbook.html');

// Compute a deterministic build version: YYYY-MM-DD-<short-sha>.
// Used to (a) stamp BUILD_VERSION inside the built logbook.html so the
// pilot sees which deploy they're on (the small grey badge bottom-right),
// and (b) cache-bust logbook.html links from the landing files so a
// fresh deploy is never served behind a stale CDN/Service-Worker cache.
//
// Computed in both modes so --check produces an output structurally
// identical to a normal build (the BUILD_VERSION line itself will differ
// across commits — the check below normalizes that one line in both
// files before comparing).
let buildVersion;
{
  let sha = 'nogit';
  try {
    sha = execSync('git -C "' + ROOT + '" rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    sha = String(Date.now()).slice(-7); // fallback: timestamp suffix
  }
  const d = new Date();
  const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  buildVersion = ymd + '-' + sha;
}

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
if (!body.includes(SCRIPT_MARKER)) {
  console.error(`build: marker ${SCRIPT_MARKER} not found in body.html — refusing to ship a bundle without its JS.`);
  process.exit(1);
}
// Function replacer only: with a plain string, $&/$`/$'/$$ inside the 700 KB
// of injected JS are treated as replacement patterns (a `$&` literal in
// 17-i18n.js already shipped corrupted to production because of this).
body = body.replace(SCRIPT_MARKER, () => scriptBlock);

// Strip diagnostic console.log / console.info / console.debug from the
// production build. console.warn and console.error stay — they signal real
// problems and we want them visible in DevTools.
//
// We replace `console.X(` with `void(` rather than removing the line,
// because removing leaves `if (cond) ;` artefacts and breaks expression-
// level usage (e.g. `(console.log(x), x + 1)`). `void(...)` is a no-op
// expression that swallows any argument list.
//
// Applied in both normal and --check mode so the check output matches
// the committed bundle (which was produced by a normal build).
body = body.replace(/console\.(log|info|debug)\s*\(/g, 'void(');

// Stamp BUILD_VERSION with the computed git+date version so the badge in
// the bottom-right corner reflects the actual deploy the user is on.
// 99-init.js ships with a hardcoded version literal — we overwrite it in
// the assembled output without touching the source on disk.
//
// Applied in both normal and --check mode so the check output has the
// same shape as the committed bundle. The actual stamp values will
// differ across commits (the CI's HEAD SHA isn't the same as the
// developer's SHA when the bundle was committed), so the comparison
// at the end of this file normalizes the BUILD_VERSION line in both
// files before diffing.
if (buildVersion) {
  body = body.replace(
    /const\s+BUILD_VERSION\s*=\s*['"][^'"]*['"]\s*;/,
    "const BUILD_VERSION = '" + buildVersion + "';"
  );
}

// Assemble
const output = head + '<style>' + EOL + styles + '</style>' + EOL + body;

fs.writeFileSync(OUT, output);

console.log(`Built ${path.relative(ROOT, OUT)}`);
console.log(`  ${output.length.toLocaleString()} bytes`);
console.log(`  ${output.split('\n').length.toLocaleString()} lines`);
console.log(`  ${styleFiles.length} CSS files: ${styleFiles.join(', ')}`);
console.log(`  ${jsFiles.length} JS files:  ${jsFiles.join(', ')}`);
if (buildVersion) console.log(`  Build version: ${buildVersion}`);

// Cache-bust every static landing page that links to logbook.html.
//
// Without this, a pilot whose browser (or Cloudflare's edge cache, or
// their installed PWA shell) has cached an old logbook.html will keep
// being served the stale bundle even after a fresh deploy. The fix is
// to append ?v=<buildVersion> so the URL itself changes each release —
// the browser / CDN treats it as a different resource and re-fetches.
//
// Landing files that we touch:
//   index.html, demo.html, security.html, privacy.html
//
// Rewrite rule:
//   logbook.html              → logbook.html?v=<buildVersion>
//   logbook.html?demo=1       → logbook.html?demo=1&v=<buildVersion>
//   logbook.html?v=<old>      → logbook.html?v=<buildVersion> (replace)
//
// We re-write the file ONLY if there's an actual change, so the git
// working tree stays clean when nothing needs busting.
if (!checkMode && buildVersion) {
  const landingFiles = ['index.html', 'demo.html', 'security.html', 'privacy.html'];
  let touched = 0;
  for (const fname of landingFiles) {
    const fpath = path.join(ROOT, fname);
    if (!fs.existsSync(fpath)) continue;
    const original = fs.readFileSync(fpath, 'utf8');
    // Match logbook.html optionally followed by a ?query string.
    // We deliberately do NOT match logbook.html#anchor since hash
    // fragments don't affect the CDN cache key.
    const rewritten = original.replace(
      /logbook\.html(\?[^"'\s<>]*)?/g,
      (match, query) => {
        if (!query) return 'logbook.html?v=' + buildVersion;
        // Strip any existing v=… so we don't accumulate stale ones
        const cleaned = query.replace(/[?&]v=[^&]*/g, '').replace(/^&/, '?');
        if (cleaned === '' || cleaned === '?') return 'logbook.html?v=' + buildVersion;
        return 'logbook.html' + cleaned + '&v=' + buildVersion;
      }
    );
    if (rewritten !== original) {
      fs.writeFileSync(fpath, rewritten);
      touched++;
      console.log(`  cache-busted: ${fname}`);
    }
  }
  if (!touched) console.log('  no landing files needed cache-bust');
}

// Emit a tiny version marker the running app fetches on launch (no-store) to
// detect that it booted a stale cached bundle and silently self-refresh — see
// checkForFreshBuild() in src/js/99-init.js. Kept out of --check so a bare
// verification never dirties the tree.
if (!checkMode && buildVersion) {
  fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ version: buildVersion }) + '\n');
  console.log(`  wrote version.json: ${buildVersion}`);
}

if (checkMode) {
  const original = fs.readFileSync(path.join(ROOT, 'logbook.html'), 'utf8');
  // The BUILD_VERSION line is stamped with the current HEAD SHA on every
  // build, so a fresh check build will never match the SHA that was
  // committed earlier. Normalize that single line in both files before
  // diffing — everything else must still be byte-identical.
  const normalizeVersion = s => s.replace(
    /const\s+BUILD_VERSION\s*=\s*['"][^'"]*['"]\s*;/,
    "const BUILD_VERSION = '__CHECK__';"
  );
  if (normalizeVersion(output) === normalizeVersion(original)) {
    console.log('\nCheck: PASS — built output matches logbook.html (BUILD_VERSION line normalized)');
  } else {
    console.log('\nCheck: FAIL — built output differs from logbook.html');
    console.log(`  Original: ${original.length.toLocaleString()} bytes`);
    console.log(`  Built:    ${output.length.toLocaleString()} bytes`);
    process.exit(1);
  }
}
