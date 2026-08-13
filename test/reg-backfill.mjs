// ═══════════════════════════════════════════════════════════════════
// REGISTRATION BACKFILL FROM THE ROSTER FEED (08-flight-form.js)
//
// Martin 2026-08-12: "on parle de quelque chose qui est requis dans le logbook
// et la je dois passer des heures a le taper a la main ? non non non ...
// refouille dans les flux navblue". CAR 401.08(2)(b) puts "the type of aircraft
// and its registration mark" in the mandatory content of every entry (raw text
// verified 2026-08-12 — see docs/REGISTRE-REGLEMENTAIRE.md), so a blank is not
// cosmetic and hand-typing hundreds of them is not an answer.
//
// The feed prints the tail on the Aircraft line only ONCE THE AIRCRAFT IS
// ASSIGNED ("Aircraft: 295 - 295XX - 295XX - C-GZQW"); a leg imported from the
// published schedule carries a bare "Aircraft: 295". The ordinary sync fills
// blanks on a later pass, but only for events it accepts as flights — it
// rejects anything without block hours or completion proof. Those gates stop
// unproven legs being LOGGED; they must not stop a registration reaching a
// flight the pilot already has.
//
// These drive the two pure helpers, so no network and no DOM are involved.
//
// Run:  node test/reg-backfill.mjs   (also part of `npm test`)
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

chk('the backfill helpers exist (fails on pre-fix code)',
  w.eval("typeof rosterRegistrationsFromEvents === 'function' && typeof applyRosterRegistrations === 'function'"));

// Real Navblue shapes, including the two the feed actually alternates between.
const EVENTS = JSON.stringify([
  { SUMMARY: 'PD325 YOW-YLW', DTSTART: '20260801T120000Z',
    DESCRIPTION: 'PD325 YOW - YLW\nCI 1200Z / 0800L\nSTD 1300Z / 0900L\nDuration: 06:00, BLH: 05:00\nAircraft: 295 - 295XX - 295XX - C-GZQW\n' },
  // Check-in the civil day BEFORE the departure: the feed dates by check-in.
  { SUMMARY: 'PD326 YLW-YOW', DTSTART: '20260802T230000Z',
    DESCRIPTION: 'PD326 YLW - YOW\nCI 2300Z\nSTD 0020Z\nDuration: 05:00, BLH: 04:30\nAircraft: 295 - 295XX - 295XX - C-GKQA\n' },
  // Published before the aircraft was assigned: fleet code only, no tail.
  { SUMMARY: 'PD400 YOW-YYZ', DTSTART: '20260803T120000Z',
    DESCRIPTION: 'PD400 YOW - YYZ\nSTD 1300Z\nDuration: 02:00, BLH: 01:00\nAircraft: 295\n' },
  // Same leg reported under two different tails (swap): must never be guessed.
  { SUMMARY: 'PD500 YOW-YUL', DTSTART: '20260804T120000Z',
    DESCRIPTION: 'PD500 YOW - YUL\nDuration: 01:30, BLH: 01:00\nAircraft: 295 - C-GZQC\n' },
  { SUMMARY: 'PD500 YOW-YUL', DTSTART: '20260804T190000Z',
    DESCRIPTION: 'PD500 YOW - YUL\nDuration: 01:30, BLH: 01:00\nAircraft: 295 - C-GKYN\n' },
]);

const out = JSON.parse(w.eval(`(function(){
  const idx = rosterRegistrationsFromEvents(${EVENTS});
  const list = [
    { id:'a', date:'2026-08-01', flightNum:'PD325', route:'YOW-YLW', reg:'' },
    { id:'b', date:'2026-08-03', flightNum:'PD326', route:'YLW-YOW', reg:'' },
    { id:'c', date:'2026-08-03', flightNum:'PD400', route:'YOW-YYZ', reg:'' },
    { id:'d', date:'2026-08-04', flightNum:'PD500', route:'YOW-YUL', reg:'' },
    { id:'e', date:'2026-08-01', flightNum:'PD325', route:'YOW-YLW', reg:'C-XXXX' },
    { id:'f', date:'2026-01-05', flightNum:'PD325', route:'YOW-YLW', reg:'' },
    { id:'g', date:'2026-08-01', flightNum:'PD325', route:'YOW-YLW' }
  ];
  const res = applyRosterRegistrations(list, idx);
  return JSON.stringify({ idx: { from: idx.from, to: idx.to }, res: res,
    regs: list.map(f => f.id + '=' + (f.reg === undefined ? '(undef)' : (f.reg || '(blank)'))) });
})()`));

const reg = id => (out.regs.find(r => r.indexOf(id + '=') === 0) || '').split('=')[1];

// What the feed answers
chk('a tail on the Aircraft line reaches the flight', reg('a') === 'C-GZQW');
chk('a leg whose check-in falls the day before still matches', reg('b') === 'C-GKQA');
chk('the feed date span is reported', out.idx.from === '2026-08-01' && out.idx.to === '2026-08-04');

// What it must NOT do — this is a certifiable field
chk('a leg the feed publishes with no tail stays blank, never guessed', reg('c') === '(blank)');
chk('two different tails for one leg is refused, not picked', reg('d') === '(blank)');
chk('the ambiguous leg is counted as such', out.res.ambiguous === 1);
chk('a registration the pilot already has is never overwritten', reg('e') === 'C-XXXX');
chk('a flight seven months outside the feed is untouched', reg('f') === '(blank)');
chk('an undefined registration is filled like an empty one', reg('g') === 'C-GZQW');
chk('the count matches what was actually written', out.res.filled === 3);
chk('what could not be answered is reported, not hidden', out.res.stillMissing === 3);

// The button that runs it, and the report the pilot reads
const body = readFileSync(join(root, 'src/body.html'), 'utf8');
chk('the pilot has a control for it', body.indexOf('backfillRegistrationsFromRoster()') !== -1);
const i18n = readFileSync(join(root, 'src/js/17-i18n.js'), 'utf8');
['sync.navblue.backfillBtn', 'sync.backfill.report', 'toast.backfillFilled', 'toast.backfillNone']
  .forEach(k => chk(`both languages carry ${k}`, (i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "'", 'g')) || []).length === 2));

// The citation this feature rests on. 401.08(2)(b) is the registration mark;
// (2)(h) is the launch method of a GLIDER and was quoted by mistake for years.
const reg08 = readFileSync(join(root, 'docs/REGISTRE-REGLEMENTAIRE.md'), 'utf8');
chk('the register carries the verified 401.08(2) text',
  reg08.indexOf('registration mark') !== -1 && reg08.indexOf('401.08(2)') !== -1);
['src/js/12-pdf-export.js', 'src/js/20-opening-balances.js', 'src/js/21-dash-drilldown.js'].forEach(p => {
  chk(`no glider-launch citation left in ${p}`,
    readFileSync(join(root, p), 'utf8').indexOf('401.08(2)(h)') === -1);
});

if (failures.length) {
  console.error('reg-backfill: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('reg-backfill: all assertions passed (feed tails filled, blanks never guessed, ambiguity refused, pilot values untouched)');
process.exit(0);
