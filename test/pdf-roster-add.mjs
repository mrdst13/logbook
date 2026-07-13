// ═══════════════════════════════════════════════════════════════════
// PDF ROSTER — ADD MISSING FLIGHTS TEST
//
// The roster PDF is Cumulo's source of truth for ACTUAL times. A leg the pilot
// flew but never logged must be ADDED with its real block (built from ATD/ATA),
// not dropped. navbluePdfLegToFlight() builds that flight; parseNavblueRosterText
// must NOT emit deadhead/positioning legs.
//
// STRICT (certifiable): UTC-only actuals, both ATD and ATA required, block from
// the real off/on clock (never scheduled), FO seat → SIC, hours always credited
// to a role column (even for unknown airports), and deadhead legs never counted.
//
// Run:  node test/pdf-roster-add.mjs   (also part of `npm test`)
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
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) < 0.02;

// Call the real global builder with a leg shaped like parseNavblueRosterText emits.
const build = (leg, isFO = true, auto = true) =>
  w.eval(`JSON.stringify(navbluePdfLegToFlight(${JSON.stringify(leg)}, ${isFO}, ${auto}))`);

// 1. Basic UTC leg → real block computed from ACTUAL ATD/ATA (17:20 - 12:31 = 4h49m).
const f = JSON.parse(build({ date: '2026-07-12', flightNum: 'PD447', route: 'YYJ-YOW', atd_utc: '1231', ata_utc: '1720', pic: 'Graham, Kyle' }));
chk('basic: returns a flight', !!f);
chk('basic: block from actuals = 4.82', f && f.block === 4.82);
chk('basic: total mirrors block', f && f.total === 4.82);
chk('basic: real ATD/ATA preserved', f && f.atd_utc === '1231' && f.ata_utc === '1720');
chk('basic: FO seat → crewPosition SIC', f && f.crewPosition === 'SIC');
chk('basic: full block credited to SIC (meDayCop+meNightCop = block)', f && near((+f.meDayCop || 0) + (+f.meNightCop || 0), 4.82));
chk('basic: nothing credited to PIC columns', f && (+f.meDayPic || 0) === 0 && (+f.meNightPic || 0) === 0);
chk('basic: logbook date = local departure day', f && f.date === '2026-07-12');
chk('basic: captain kept in pic', f && f.pic === 'Graham, Kyle');
chk('basic: IATA → ICAO derived', f && f.dep_icao === 'CYYJ' && f.arr_icao === 'CYOW');
chk('basic: dtstart_utc stamped from block-off', f && typeof f.dtstart_utc === 'string' && f.dtstart_utc.startsWith('2026-07-12T12:31'));
chk('basic: tagged source navblue-pdf', f && f.source === 'navblue-pdf');
chk('basic: no fabricated type/reg (empty > guessed)', f && f.type === '' && f.reg === '');

// 2. Midnight wrap — arrival clock earlier than departure = next UTC day (23:00 → 01:30 = 2.5h).
const g = JSON.parse(build({ date: '2026-07-12', flightNum: 'PD999', route: 'YVR-YOW', atd_utc: '2300', ata_utc: '0130' }));
chk('wrap: block = 2.5 across midnight', g && g.block === 2.5);

// 3. Unknown airport → block must STILL be credited to the SIC column (fallback = all day),
//    never vanish (recalc returns early on unknown coords, so the builder fills it).
const u = JSON.parse(build({ date: '2026-07-12', flightNum: 'PD4', route: 'ZZZ-YOW', atd_utc: '1200', ata_utc: '1315' }));
chk('unknown airport: returns a flight', !!u);
chk('unknown airport: full block credited to SIC day', u && near(u.meDayCop, u.block) && (+u.meNightCop || 0) === 0);
chk('unknown airport: block still correct (1.25)', u && u.block === 1.25);

// 4. Missing / partial actuals → refuse to build (empty > guessed; never a scheduled fallback).
chk('no ATA → null', build({ date: '2026-07-12', flightNum: 'PD1', route: 'YOW-YYZ', atd_utc: '1200', ata_utc: '' }) === 'null');
chk('no ATD → null', build({ date: '2026-07-12', flightNum: 'PD1', route: 'YOW-YYZ', atd_utc: '', ata_utc: '1300' }) === 'null');
chk('no route → null', build({ date: '2026-07-12', flightNum: 'PD1', route: '', atd_utc: '1200', ata_utc: '1300' }) === 'null');
chk('zero-length block (atd == ata) → null', build({ date: '2026-07-12', flightNum: 'PD1', route: 'YOW-YYZ', atd_utc: '1200', ata_utc: '1200' }) === 'null');

// 5. PIC seat — self becomes PIC, roster "captain" ignored, block to PIC columns.
const h = JSON.parse(build({ date: '2026-07-12', flightNum: 'PD2', route: 'YOW-YYZ', atd_utc: '1200', ata_utc: '1315', pic: 'Someone, X' }, false, true));
chk('PIC seat: crewPosition PIC', h && h.crewPosition === 'PIC');
chk('PIC seat: copilot left empty', h && h.copilot === '');
chk('PIC seat: block credited to PIC, not SIC', h && near((+h.meDayPic || 0) + (+h.meNightPic || 0), h.block) && (+h.meDayCop || 0) === 0);

// 6. autoCountIFR flag flows through.
const noIfr = JSON.parse(build({ date: '2026-07-12', flightNum: 'PD3', route: 'YOW-YYZ', atd_utc: '1200', ata_utc: '1315' }, true, false));
chk('autoCountIFR false → 0 approaches', noIfr && noIfr.approaches === 0);

// 7. CRITICAL — the parser must DROP deadhead / positioning legs so they are never
//    added as SIC time. A "(D)" marker on the row = deadhead.
const rosterText = [
  '2026-07-12 PD167 YYZ-YOW FO(D) 13:00 14:15 01:15 01:15',
  '2026-07-12 PD447 YYJ-YOW FO 12:31 17:20 04:49 04:49',
].join('\n');
const legs = JSON.parse(w.eval(`JSON.stringify(parseNavblueRosterText(${JSON.stringify(rosterText)}))`));
chk('deadhead: PD167 (D) leg is NOT parsed', Array.isArray(legs) && !legs.some(l => l.flightNum === 'PD167'));
chk('deadhead: normal PD447 leg IS parsed', Array.isArray(legs) && legs.some(l => l.flightNum === 'PD447'));

// 8. Regression guard — a NORMAL flown leg whose pairing id looks like 'P30491'
//    (P + 5 digits) must NOT be dropped. The narrower PDF marker set avoids the
//    iCal DEADHEAD_RE's \bP\d{5}\b / \bPAX\b false-positive on the full row.
const rosterText2 = ['2026-07-12 PD200 YOW-YHZ FO 09:00 10:30 01:30 01:30 P30491'].join('\n');
const legs2 = JSON.parse(w.eval(`JSON.stringify(parseNavblueRosterText(${JSON.stringify(rosterText2)}))`));
chk('deadhead regex: normal leg with P30491 pairing is NOT dropped', Array.isArray(legs2) && legs2.some(l => l.flightNum === 'PD200'));

if (failures.length) { console.error('pdf-roster-add FAIL:', failures); process.exit(1); }
console.log(`pdf-roster-add: all checks passed (block from actuals, midnight-wrap, SIC-credit incl. unknown airport, refusals, PIC seat, deadhead dropped)`);
process.exit(0);
