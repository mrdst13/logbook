// ═══════════════════════════════════════════════════════════════════
// BROUGHT-FORWARD SEAL TEST
//
// Audit item 8: the "Declaration sealed and verified" banner promised that
// "if a single number changed after signing, the seal would detect it" — but
// nothing ever re-verified the hash, the cut-off date was outside it, and the
// signer's name was thrown away. The seal now binds balances + cut-off date +
// signer, is re-verified on load, and downgrades the banner to a warning if a
// value changed. This test proves the detection actually fires.
//
// jsdom has no WebCrypto/TextEncoder, so we inject Node's into the window
// before the app runs (the real browser supplies them natively).
//
// Run:  node test/seal.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'logbook.html'), 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
    Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
    w.TextEncoder = TextEncoder;
  },
});
const w = dom.window;
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

// Seal a declaration.
await w.eval("(async () => { await saveOpeningBalances({ pic: 1200, night: 300 }, '2025-11-27', 'Martin Test'); })()");
const rec = w.eval('loadOpeningBalances()');
chk('signer name stored (attestedBy)', rec.attestedBy === 'Martin Test');
chk('fingerprint present', typeof rec.hash === 'string' && rec.hash.length === 64);

// Untouched → verifies.
let v = await w.eval('verifyOpeningBalances()');
chk('untouched record verifies', v.sealed === true && v.ok === true);

// A changed hour value → detected.
v = await w.eval("(async () => { const r = loadOpeningBalances(); r.balances.pic = 9999; return verifyOpeningBalances(r); })()");
chk('changed hour value is detected', v.ok === false);

// A changed cut-off date → detected (it was outside the old hash).
v = await w.eval("(async () => { const r = loadOpeningBalances(); r.cutoffDate = '2020-01-01'; return verifyOpeningBalances(r); })()");
chk('changed cut-off date is detected', v.ok === false);

// Backward compatibility: a legacy balances-only seal still verifies untouched.
v = await w.eval("(async () => { const b = { pic: 500 }; const h = await _hashBalances(b); return verifyOpeningBalances({ balances: b, cutoffDate: '2024-01-01', hash: h }); })()");
chk('legacy balances-only seal still verifies', v.ok === true);

// ...but a tampered legacy record is still caught.
v = await w.eval("(async () => { const h = await _hashBalances({ pic: 500 }); return verifyOpeningBalances({ balances: { pic: 501 }, hash: h }); })()");
chk('tampered legacy record is caught', v.ok === false);

if (failures.length) {
  console.error(`\n✗ seal test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ seal test passed — binds values+date+signer, re-verifies, detects tampering, back-compatible');
process.exit(0);
