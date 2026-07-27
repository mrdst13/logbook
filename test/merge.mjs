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

// ── Converting a logged flight to a simulator session ────────────────
// A sim session carries no block time, so zeroing it on conversion is
// correct. What was not correct: the entry-type buttons stay live while
// editing, so one misclick on a real leg discarded recorded flight time
// on save with nothing asked. Flagged 2026-06-27, closed 2026-07-27.
const convert = (answer) => JSON.parse(w.eval(`(function(){
  localStorage.setItem('logbook_v1', JSON.stringify([{ id: 'r1', date: '2026-06-01', flightNum: 'PD100', route: 'YOW-YYZ', block: 1.2, total: 1.2, meDayCop: 1.2, isSim: false }]));
  flights = DB.load();
  editingId = 'r1';
  currentEntryType = 'sim';
  window.confirm = function () { return ${answer}; };
  showPage('add');
  document.getElementById('f-date').value = '2026-06-01';
  saveFlight();
  const f = DB.load()[0];
  return JSON.stringify({ block: f.block, isSim: !!f.isSim });
})()`));
const declined = convert('false');
chk('declining the conversion keeps the recorded flight time', declined.block === 1.2 && declined.isSim === false);
const accepted = convert('true');
chk('accepting the conversion still works', accepted.block === 0 && accepted.isSim === true);
chk('the warning names the hours at risk', /1\.2/.test(w.eval("t('confirm.convertToSim', { h: '1.2' })")));

if (failures.length) {
  console.error(`\n✗ merge test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ merge test passed — fillEmptyStrict keeps explicit 0, fillEmptyNumeric fills 0-buckets, neither overwrites, and converting a logged flight to a sim asks before discarding its hours');
process.exit(0);
