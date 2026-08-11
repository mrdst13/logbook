// ═══════════════════════════════════════════════════════════════════
// HOURS-OF-WORK FLOOR (RAC 700.29) + FDP PREFILL TEST
//
// Martin, 2026-08-02: "je veux que tu code dans le duty le 60 heures max dans
// 7 jours de duty time ... donc check in to check out" and "le duty devrait
// etre deja pre remplis a l'heure de mon check in du jour ... au besoin je le
// change".
//
// The register (docs/REGISTRE-REGLEMENTAIRE.md, 700.29, verified 2026-07-17)
// forbids showing a weekly ceiling as one number: it is 60 h OR 70 h depending
// on what the operator granted, and "hours of work" is not a defined term. So
// the card shows a FLOOR — recorded duty periods only, report (ci_utc) to
// release (co_utc), no fallback — and this test pins exactly that:
//   - a turn (two legs, one check-in) is ONE period, counted check-in to
//     check-out, not per-leg;
//   - a period whose last leg has no recorded release is skipped and counted
//     out loud, never approximated;
//   - the card never presents 60 as THE limit, and flags a floor >= 60 / >= 70
//     with conditional wording only;
//   - the FDP calculator pre-fills today's check-in and flight count from the
//     roster cache once, and never overwrites a value the pilot changed.
//
// Run:  node test/duty-work.mjs   (also part of `npm test`)
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
    w.fetch = () => Promise.reject(new Error('network disabled in test'));
  },
});
const w = dom.window;
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

const p2 = (n) => (n < 10 ? '0' : '') + n;
const now = new Date();
const todayStr = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
const dayShift = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate()); };
const y1 = dayShift(now, -1), y2 = dayShift(now, -2), old = dayShift(now, -9);

const setFlights = (arr) => w.eval(`
  localStorage.setItem('logbook_v1', ${JSON.stringify(JSON.stringify(arr))});
  flights = DB.load();
`);
const floor = () => JSON.parse(w.eval('JSON.stringify(_dutyWorkFloor(7))'));

// ── 1. A turn is ONE duty period, check-in to check-out ─────────────────
//     11:25 of duty (1300Z report → 0025Z release), not the sum of the legs.
setFlights([
  { id: 'a1', date: y2, dtstart_utc: y2 + 'T13:00:00.000Z', route: 'YOW-YLW', block: 4.9, total: 4.9, ci_utc: '1300' },
  { id: 'a2', date: y2, dtstart_utc: y2 + 'T19:50:00.000Z', route: 'YLW-YOW', block: 4.3, total: 4.3, co_utc: '0025' },
]);
{
  const f = floor();
  chk('a turn is one duty period', f.periods === 1);
  chk('counted check-in to check-out (11.4 h), not per-leg', Math.abs(f.hours - 11.4) <= 0.1);
  chk('nothing skipped', f.skippedLegs === 0);
}

// ── 2. A period with no recorded release is skipped, never approximated ──
setFlights([
  { id: 'b1', date: y1, dtstart_utc: y1 + 'T13:00:00.000Z', route: 'YOW-YYZ', block: 1.0, total: 1.0, ci_utc: '1200' },
  { id: 'b2', date: y1, dtstart_utc: y1 + 'T16:00:00.000Z', route: 'YYZ-YOW', block: 1.0, total: 1.0 },
]);
{
  const f = floor();
  chk('an unclosed period contributes zero hours', f.hours === 0 && f.periods === 0);
  chk('and its legs are counted as skipped', f.skippedLegs === 2);
}

// ── 3. The window is 7 local dates: an old period is out ────────────────
setFlights([
  { id: 'c1', date: old, dtstart_utc: old + 'T13:00:00.000Z', route: 'YOW-YYZ', block: 1, total: 1, ci_utc: '1200', co_utc: '1600' },
]);
chk('a duty period 9 days ago is outside the 7-day window', floor().periods === 0 && floor().hours === 0);

// ── 4. The card: floor wording, never a single ceiling ──────────────────
const renderCard = () => {
  w.eval("showPage('duty'); renderDutyTracker();");
  return w.eval("(document.getElementById('duty-work-floor') || { textContent: '' }).textContent");
};
setFlights([
  { id: 'd1', date: y1, dtstart_utc: y1 + 'T13:00:00.000Z', route: 'YOW-YLW', block: 4.9, total: 4.9, ci_utc: '1300', co_utc: '2039' },
]);
{
  const txt = renderCard();
  chk('the card exists on the Duty page', txt.length > 0);
  chk('the card says "at least"', /at least|au moins/i.test(txt));
  chk('the card cites RAC 700.29', /700\.29/.test(txt));
  chk('the card gives BOTH possible ceilings, never one', /60 h or 70 h|60 h ou 70 h/.test(txt));
  chk('the card says a floor does not prove compliance', /does not prove compliance|ne prouve pas la conformité/i.test(txt));
  chk('no warning below 60 h', !/reaches 60 h|exceeds BOTH/i.test(txt));
}

// ── 5. Detection is positive-only, and conditional at 60 ────────────────
//     Six 11-hour recorded days = floor 66 h: over 60, under 70.
{
  const legs = [];
  for (let k = 1; k <= 6; k++) {
    const d = dayShift(now, -k);
    legs.push({ id: 'e' + k, date: d, dtstart_utc: d + 'T12:00:00.000Z', route: 'YOW-YYZ', block: 5, total: 5, ci_utc: '1100', co_utc: '2200' });
  }
  setFlights(legs);
  const txt = renderCard();
  chk('a 66 h floor warns about the 60 h ceiling', /reaches 60 h|atteint 60 h/i.test(txt));
  chk('the 60 h warning stays conditional (if your ceiling is 60 h)', /If your ceiling is 60 h|Si ton plafond est 60 h/i.test(txt));
  chk('a 66 h floor does NOT claim both ceilings are exceeded', !/exceeds BOTH|dépasse déjà les DEUX/i.test(txt));
}
{
  const legs = [];
  for (let k = 1; k <= 7; k++) {
    const d = dayShift(now, -k + 1);
    legs.push({ id: 'g' + k, date: d, dtstart_utc: d + 'T12:00:00.000Z', route: 'YOW-YYZ', block: 5, total: 5, ci_utc: '1000', co_utc: '2100' });
  }
  setFlights(legs);
  const txt = renderCard();
  chk('a 77 h floor exceeds both possible ceilings, and says so', /exceeds BOTH|dépasse déjà les DEUX/i.test(txt));
}

// ── 6. FDP prefill: today's check-in and flight count, once, editable ───
w.eval(`
  localStorage.setItem('cumulo_roster_calendar_v1', JSON.stringify({ ts: 1, events: [
    { uid: '1', summary: 'PD325 YOW-YLW', start: '${todayStr}T14:30:00.000Z', offMin: -240, note: '' },
    { uid: '2', summary: 'PD326 YLW-YOW', start: '${todayStr}T19:50:00.000Z', offMin: -240, note: '' },
    { uid: '3', summary: 'GD YOW', start: '${todayStr}T04:01:00.000Z', offMin: -240, note: 'Guaranteed Day off' }
  ] }));
  _fdpPrefilled = false;
  initFdpCalc();
`);
{
  chk('report hour pre-filled from today\'s first flight (1030 local)',
    w.eval("document.getElementById('fdp-report-h').value") === '10' &&
    w.eval("document.getElementById('fdp-report-m').value") === '30');
  chk('flight count pre-filled (2 flights; the day off is not a flight)',
    w.eval("document.getElementById('fdp-legs').value") === '2');
  chk('the prefill says where the values came from',
    /roster|horaire/i.test(w.eval("document.getElementById('fdp-prefill-note').textContent")));
  chk('the max duty computed itself', w.eval("document.getElementById('fdp-out').textContent").length > 0);
}
// The pilot edits, the page re-inits (router revisit): nothing is overwritten.
w.eval(`
  document.getElementById('fdp-report-h').value = '6';
  document.getElementById('fdp-legs').value = '4';
  initFdpCalc();
`);
chk('a value the pilot changed is never overwritten by a re-init',
  w.eval("document.getElementById('fdp-report-h').value") === '6' &&
  w.eval("document.getElementById('fdp-legs').value") === '4');
// A day with no roster keeps the defaults and says nothing.
w.eval(`
  localStorage.setItem('cumulo_roster_calendar_v1', JSON.stringify({ ts: 1, events: [] }));
  document.getElementById('fdp-report-h').value = '7';
  document.getElementById('fdp-report-m').value = '0';
  document.getElementById('fdp-legs').value = '2';
  document.getElementById('fdp-prefill-note').style.display = 'none';
  _fdpPrefilled = false;
  initFdpCalc();
`);
chk('an empty roster day keeps the defaults',
  w.eval("document.getElementById('fdp-report-h').value") === '7' &&
  w.eval("document.getElementById('fdp-legs').value") === '2');
chk('and shows no prefill note',
  w.eval("document.getElementById('fdp-prefill-note').style.display") === 'none');

if (failures.length) {
  console.error(`\n✗ duty-work test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ duty-work passed — 700.29 floor counts recorded duty periods only, both ceilings always named, positive-only detection, and the FDP calculator pre-fills today\'s check-in without ever overwriting the pilot');
process.exit(0);
