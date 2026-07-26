// ═══════════════════════════════════════════════════════════════════
// iCAL FLIGHT-DATE (LOCAL vs UTC) TEST
//
// Bug (Martin 2026-07-10): icsDate() dated an iCal flight by the UTC day of
// DTSTART. A late-evening LOCAL departure has a UTC timestamp already past
// midnight, so the flight was logged one day LATE. Fix: icsLocalDate() converts
// the UTC instant back to the departure airport's local zone (via AIRPORT_TZ +
// Intl, which handles daylight saving) before taking the date.
//
// Proves: evening departures across every Canadian/US zone stay on the correct
// local day; daylight-saving is applied in summer and NOT in winter or in
// Saskatchewan; midday flights are unchanged; and an unknown airport safely
// falls back to the old UTC-date behaviour (no regression, no new bug).
//
// Run:  node test/ical-date.mjs   (also part of `npm test`)
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
const localDate = (dt, icao) => w.eval(`icsLocalDate(${JSON.stringify(dt)}, ${JSON.stringify(icao)})`);
const chk = (label, got, want) => { if (got !== want) failures.push(`${label}: got ${got}, want ${want}`); };

// Sanity: Intl time-zone support must be present in this runtime, else the fix
// silently falls back and the test would be meaningless.
const intlOk = w.eval(`(function(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.UTC(2026,4,30,1,0,0)));}catch(e){return 'ERR:'+e.message;}})()`);
if (!/2026-05-29/.test(intlOk)) failures.push(`Intl timeZone unsupported in runtime (got ${intlOk}) — cannot validate fix`);

// ── Core bug: a 21:00 local departure (past UTC midnight) stays the SAME day ──
chk('YOW 21:00 EDT (summer) stays May 29', localDate('20260530T010000Z', 'CYOW'), '2026-05-29'); // 01:00Z = 21:00 EDT (UTC-4)
chk('YYC 22:00 MDT (summer) stays May 29', localDate('20260530T040000Z', 'CYYC'), '2026-05-29'); // 04:00Z = 22:00 MDT (UTC-6)
chk('YVR 22:00 PDT (summer) stays May 29', localDate('20260530T050000Z', 'CYVR'), '2026-05-29'); // 05:00Z = 22:00 PDT (UTC-7)
chk('YYT 23:00 NDT (summer) stays May 29', localDate('20260530T013000Z', 'CYYT'), '2026-05-29'); // 01:30Z = 23:00 NDT (UTC-2:30)
chk('YWG 22:00 CDT (summer) stays May 29', localDate('20260530T030000Z', 'CYWG'), '2026-05-29'); // 03:00Z = 22:00 CDT (UTC-5)

// ── Saskatchewan: NO daylight saving (UTC-6 year-round) ──
chk('YQR 23:30 CST (no DST) stays May 29', localDate('20260530T053000Z', 'CYQR'), '2026-05-29'); // 05:30Z = 23:30 CST (UTC-6). DST would wrongly give May 30.

// ── Winter: daylight saving OFF (EST = UTC-5) ──
chk('YOW 22:30 EST (winter) stays Jan 14', localDate('20260115T033000Z', 'CYOW'), '2026-01-14'); // 03:30Z = 22:30 EST (UTC-5)

// ── Midday flights: UTC day == local day, must be UNCHANGED ──
chk('YYZ 12:22 EDT midday unchanged', localDate('20260529T162200Z', 'CYYZ'), '2026-05-29'); // Martin's real PD235 departure
chk('YYZ 08:36 EDT morning unchanged', localDate('20260529T123600Z', 'CYYZ'), '2026-05-29');

// ── US zones ──
chk('KLAX 23:00 PDT stays May 29', localDate('20260530T060000Z', 'KLAX'), '2026-05-29'); // 06:00Z = 23:00 PDT
chk('KORD 22:00 CDT stays May 29', localDate('20260530T030000Z', 'KORD'), '2026-05-29'); // 06:00... 03:00Z = 22:00 CDT

// ── Fallbacks: unknown airport / no airport → OLD UTC-date behaviour ──
chk('unknown airport falls back to UTC date', localDate('20260530T010000Z', 'ZZZZ'), '2026-05-30');
chk('missing airport falls back to UTC date', localDate('20260530T010000Z', ''), '2026-05-30');

// ── Regression guard: plain icsDate still returns the UTC date ──
chk('icsDate unchanged (still UTC date)', w.eval(`icsDate('20260530T010000Z')`), '2026-05-30');

// ═══════════════════════════════════════════════════════════════════
// BLOCK-OFF ANCHOR (2026-07-26)
//
// DTSTART is the DUTY window start, not the departure. Martin's own feed,
// PD589: DTSTART 20260725T100000Z with CI 1000Z and STD 1100Z, so DTSTART
// is the CHECK-IN, an hour before the aircraft moves. Using it as
// block-off anchored the RAC 101.01 day/night split an hour early on the
// first leg of every duty, and could date a leg on the wrong local day.
// Block-off now comes from STD, dated from DTSTART.
// ═══════════════════════════════════════════════════════════════════
const blockOff = (ev) => {
  const iso = w.eval(`(function(){ const d = icalBlockOffUTC(${JSON.stringify(ev)}); return d ? d.toISOString() : ''; })()`);
  return iso;
};
const flightOf = (ev) => JSON.parse(w.eval(`JSON.stringify(navblueEventToFlight(${JSON.stringify(ev)}, true, true))`));

// Martin's real PD589, verbatim from his 2026-07-26 diagnostic.
const PD589 = {
  UID: '6784051', DTSTART: '20260725T100000Z', DTEND: '20260725T140400Z', SUMMARY: 'PD589 YOW-MCO',
  DESCRIPTION: 'PD589 YOW - MCO\nCI 1000Z / 0600L\nSTD 1100Z / 0700L\nSTA 1419Z / 1019L\nDuration: 04:04, BLH: 02:57\nAircraft: 295 - 295XX - 295XX - C-GZQW\n'
};
chk('PD589 anchors on STD, not on check-in', blockOff(PD589), '2026-07-25T11:00:00.000Z');
chk('PD589 stores the scheduled block-off', flightOf(PD589).dtstart_utc, '2026-07-25T11:00:00.000Z');
chk('PD589 block time still comes from BLH', String(flightOf(PD589).block), '2.95');

// Real PD590, a continuing leg where DTSTART is a turnaround marker.
const PD590 = {
  UID: '6784050', DTSTART: '20260725T150700Z', SUMMARY: 'PD590 MCO-YOW',
  DESCRIPTION: 'PD590 MCO - YOW\nSTD 1520Z / 1120L\nSTA 1835Z / 1435L\nCO 1834Z / 1434L\nDuration: 03:27, BLH: 03:12\nAircraft: 295 - 295XX - 295XX - C-GZQW\n'
};
chk('PD590 anchors on STD, not on the turnaround marker', blockOff(PD590), '2026-07-25T15:20:00.000Z');

// Check-in before UTC midnight, departure after: the block-off belongs to
// the NEXT UTC day, and the logbook date follows the DEPARTURE.
const WRAP = {
  UID: 'w1', DTSTART: '20260725T233000Z', SUMMARY: 'PD900 YOW-YYZ',
  DESCRIPTION: 'PD900 YOW - YYZ\nCI 2330Z\nSTD 0020Z\nSTA 0140Z\nDuration: 03:00, BLH: 01:20\nAircraft: 295\n'
};
chk('check-in before UTC midnight, STD after: block-off rolls to the next day',
  blockOff(WRAP), '2026-07-26T00:20:00.000Z');
chk('the logbook date follows the departure, not the check-in',
  flightOf(WRAP).date, '2026-07-25');   // 00:20Z = 20:20 EDT on the 25th

// No STD published: keep the old anchor rather than invent a departure.
const NOSTD = {
  UID: 'n1', DTSTART: '20260725T100000Z', SUMMARY: 'PD901 YOW-YYZ',
  DESCRIPTION: 'PD901 YOW - YYZ\nDuration: 02:00, BLH: 01:20\nAircraft: 295\n'
};
chk('no STD in the feed: falls back to DTSTART', blockOff(NOSTD), '2026-07-25T10:00:00.000Z');

// Implausible check-in to departure gap: refuse rather than guess.
const FARSTD = {
  UID: 'f1', DTSTART: '20260725T100000Z', SUMMARY: 'PD902 YOW-YYZ',
  DESCRIPTION: 'PD902 YOW - YYZ\nSTD 2330Z\nSTA 0050Z\nDuration: 02:00, BLH: 01:20\nAircraft: 295\n'
};
chk('a 13 h gap is not a check-in: falls back to DTSTART', blockOff(FARSTD), '2026-07-25T10:00:00.000Z');
chk('malformed DTSTART yields no anchor at all', blockOff({ DTSTART: 'nope', DESCRIPTION: 'STD 1100Z' }), '');

// ── UID dedup: a re-dated leg must never become a second row ────────
// Every other matcher tier keys on the date, so the block-off correction
// could otherwise mint a duplicate for a leg already logged under its old
// check-in date.
const uidMatch = w.eval(`(function(){
  flights = [{ id: 'x1', date: '2026-07-25', flightNum: 'PD900', route: 'YOW-YYZ', block: 1.33, navblueUid: 'w1' }];
  const m = findMatchingExistingFlight({ date: '2026-07-26', flightNum: 'PD900', route: 'YOW-YYZ', block: 1.33, navblueUid: 'w1' });
  return m ? m.matchType : 'NO MATCH';
})()`);
chk('same roster UID on a different date still matches', uidMatch, 'navblue-uid');
const uidNoFalse = w.eval(`(function(){
  flights = [{ id: 'x1', date: '2026-07-25', flightNum: 'PD900', route: 'YOW-YYZ', block: 1.33, navblueUid: 'w1' }];
  const m = findMatchingExistingFlight({ date: '2026-08-02', flightNum: 'PD777', route: 'YYZ-YUL', block: 0.9, navblueUid: 'w2' });
  return m ? m.matchType : 'NO MATCH';
})()`);
chk('a different UID never matches', uidNoFalse, 'NO MATCH');

if (failures.length) {
  console.error(`\n✗ ical-date test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ ical-date passed — iCal flights dated by LOCAL departure day (DST-aware) across zones; midday unchanged; unknown airport falls back to UTC');
process.exit(0);
