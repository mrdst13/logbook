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

if (failures.length) {
  console.error(`\n✗ ical-date test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ ical-date passed — iCal flights dated by LOCAL departure day (DST-aware) across zones; midday unchanged; unknown airport falls back to UTC');
process.exit(0);
