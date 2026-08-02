// ═══════════════════════════════════════════════════════════════════
// SCHEDULE PAGE TEST
//
// 2026-08-02, Martin: "je vois l'horaire cependant en heure zulu, ça fuck les
// jours de congé, ça dit que j'ai des vols et congé en même temps".
//
// Two mistakes behind that, both mine:
//   1. Times were shown in Zulu on the reasoning that converting would mean
//      guessing a timezone per station. Wrong premise: the feed prints both
//      clocks together ("CI 1430Z / 1030L"), so the local time is PUBLISHED.
//      Reading it also puts each event on the day the pilot would point at —
//      a Kelowna hotel at 0600Z is 2300 the previous evening, not the morning
//      after.
//   2. "GD" was classified as ground duty and painted as work. Porter spells
//      it out: "GD (Guaranteed Day off)". The operator's own words now win
//      over the abbreviation.
//
// Run:  node test/schedule.mjs   (also part of `npm test`)
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
const ev = (o) => JSON.stringify(o);

// ── 1. The published local offset is READ, never computed ───────────────
const off = (desc) => w.eval('icalPublishedLocalOffsetMin(' + JSON.stringify(desc) + ')');
chk('a flight publishes its station offset', off('PD325 YOW - YLW\nCI 1430Z / 1030L\nSTD 1400Z / 1000L') === -240);
chk('a day off publishes its own', off('GD (Guaranteed Day off) YOW\nStart 0401Z / 0001L') === -240);
chk('a layover hotel is on ITS station clock, not the base clock',
  off('HTL (Hotel) YLW\nStart 0600Z / 2300L\nEnd 0900Z / 0200L') === -420);
chk('an event with no published local time yields nothing to guess from',
  off('Some event with 1400Z only') === null);
chk('an east-of-Greenwich offset folds the right way',
  off('Duty LHR\nStart 2300Z / 0000L') === 60);

// ── 2. The day an event lands on follows the roster's own clock ─────────
//     0600Z in Kelowna is 2300 the evening BEFORE. Placing it by UTC put the
//     layover hotel on the wrong calendar square.
{
  const hotel = { summary: 'HTL YLW', start: '2026-08-02T06:00:00.000Z', offMin: -420, note: 'Hotel' };
  chk('the hotel lands on the evening it actually starts',
    w.eval('_schedLocalDay(' + ev(hotel) + ')') === '2026-08-01');
  chk('and shows the roster’s own time', w.eval('_schedHHMM(' + ev(hotel) + ')') === '2300');
  const gd = { summary: 'GD YOW', start: '2026-08-01T04:01:00.000Z', offMin: -240, note: 'Guaranteed Day off' };
  chk('a day off starting 0001 local lands on that day, not the UTC one',
    w.eval('_schedLocalDay(' + ev(gd) + ')') === '2026-08-01');
}

// ── 3. The operator's words beat the abbreviation ───────────────────────
const kind = (o) => w.eval('_schedKind(' + ev(o) + ')');
chk('GD spelled out as a day off is a day off, not ground duty',
  kind({ summary: 'GD YOW', note: 'Guaranteed Day off' }) === 'off');
chk('vacation is a day off', kind({ summary: 'VAC YOW', note: 'Vacation' }) === 'off');
chk('a hotel is its own thing', kind({ summary: 'HTL YLW', note: 'Hotel' }) === 'hotel');
chk('a flight is recognised by its route', kind({ summary: 'PD325 YOW-YLW', note: '' }) === 'flight');
chk('genuine ground duty still reads as ground',
  kind({ summary: 'TRG YOW', note: 'Ground Training' }) === 'ground');
chk('with no expansion, a bare GD is not assumed to be work either',
  kind({ summary: 'GD YOW', note: '' }) !== 'ground');

// ── 4. A day the roster says is BOTH off and flying is shown as both ────
//     Neither is hidden — the contradiction is the operator's, not ours — but
//     the day must not read as "off" with equal weight.
{
  w.eval(`
    localStorage.setItem('cumulo_navblue_url', 'https://porter.navblue.cloud/roster/x.ics');
    localStorage.setItem('cumulo_roster_calendar_v1', JSON.stringify({ ts: Date.now(), events: [
      { uid: '1', summary: 'GD YOW', start: '2026-08-01T04:01:00.000Z', offMin: -240, note: 'Guaranteed Day off' },
      { uid: '2', summary: 'PD325 YOW-YLW', start: '2026-08-01T14:30:00.000Z', offMin: -240, note: '' },
      { uid: '3', summary: 'GD YOW', start: '2026-08-03T04:01:00.000Z', offMin: -240, note: 'Guaranteed Day off' }
    ] }));
    _schedMonth = { y: 2026, m: 7 };
    showPage('schedule');
    renderSchedule();
  `);
  const html = w.eval("document.getElementById('scheduleGrid').innerHTML");
  chk('the contradicted day off is still shown', (html.match(/sched-off/g) || []).length === 2);
  chk('it is marked as overridden', /is-overridden/.test(html));
  chk('the clean day off is NOT marked', (html.match(/is-overridden/g) || []).length === 1);
  chk('the flight keeps its local time', /1030/.test(html));
  chk('no Zulu suffix is printed any more', !/\d{4}Z</.test(html));
  const foot = w.eval("document.getElementById('scheduleFoot').textContent");
  chk('the footer says which clock this is', /Local time at each station/i.test(foot));
  chk('and counts the contradiction instead of leaving him to spot it',
    /1 day carr(y|ies) both a day off and a flight/i.test(foot));
}

if (failures.length) {
  console.error(`\n✗ schedule test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ schedule passed — station-local times read from the feed, events on the right calendar day, GD is a day off, and a roster that says both is shown as both');
process.exit(0);
