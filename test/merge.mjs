// ═══════════════════════════════════════════════════════════════════
// IMPORT MERGE TEST
//
// Audit item 12: the fill-empty merge was duplicated across photo/iCal/CSV
// imports with drifting field lists. It now lives in two shared helpers with
// two deliberate policies. This test pins both so a future edit can't quietly
// change what imports overwrite (a certifiable-data risk):
//   - fillEmptyStrict:  empty == undefined/null/''   (explicit 0 is REAL)
//   - fillEmptyNumeric: 0 or empty is fillable by a positive incoming value
//
// Run:  node test/merge.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
  },
});
const w = dom.window;
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

// ── fillEmptyStrict ──
chk('strict fills an empty-string slot', w.eval("(()=>{const e={pic:''};fillEmptyStrict(e,{pic:'DAOUST'},['pic']);return e.pic;})()") === 'DAOUST');
chk('strict fills undefined/missing slot', w.eval("(()=>{const e={};fillEmptyStrict(e,{reg:'C-GKYN'},['reg']);return e.reg;})()") === 'C-GKYN');
chk('strict keeps an explicit 0 (real value)', w.eval("(()=>{const e={multiCrew:0};fillEmptyStrict(e,{multiCrew:1},['multiCrew']);return e.multiCrew;})()") === 0);
chk('strict never overwrites existing text', w.eval("(()=>{const e={pic:'ME'};fillEmptyStrict(e,{pic:'OTHER'},['pic']);return e.pic;})()") === 'ME');
chk('strict ignores empty incoming', w.eval("(()=>{const e={pic:''};fillEmptyStrict(e,{pic:''},['pic']);return e.pic;})()") === '');
chk('strict reports changed=true only on a fill', w.eval("fillEmptyStrict({pic:''},{pic:'X'},['pic'])") === true);
chk('strict reports changed=false when nothing fills', w.eval("fillEmptyStrict({pic:'X'},{pic:'Y'},['pic'])") === false);

// ── fillEmptyNumeric ──
chk('numeric fills a 0 hour bucket', w.eval("(()=>{const e={block:0};fillEmptyNumeric(e,{block:1.5},['block']);return e.block;})()") === 1.5);
chk('numeric fills a missing hour bucket', w.eval("(()=>{const e={};fillEmptyNumeric(e,{night:2},['night']);return e.night;})()") === 2);
chk('numeric never overwrites a positive value', w.eval("(()=>{const e={block:3};fillEmptyNumeric(e,{block:9},['block']);return e.block;})()") === 3);
chk('numeric ignores a 0 incoming', w.eval("(()=>{const e={block:0};fillEmptyNumeric(e,{block:0},['block']);return e.block;})()") === 0);

if (failures.length) {
  console.error(`\n✗ merge test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ merge test passed — fillEmptyStrict keeps explicit 0, fillEmptyNumeric fills 0-buckets, neither overwrites');
process.exit(0);
