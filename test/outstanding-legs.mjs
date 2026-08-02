// ═══════════════════════════════════════════════════════════════════
// OUTSTANDING-LEGS NOTE TEST
//
// 2026-08-01, Martin: "pourquoi je vois pas mon vol d'aujourd'hui qui a fini
// il y a plus de 6h". His roster diagnostic showed the sync had judged the leg
// correctly — PD325 YOW-YLW, pending: true — while his dashboard showed no card
// at all. The app knew, and said nothing.
//
// Cause: the note that feeds that card was written near the END of the sync,
// after the undo snapshot, the match loop and two DB.save calls. Anything that
// threw in between (a full localStorage above all) left the note unwritten, so
// the leg existed only in a diagnostic nobody opens. It is now written the
// instant the decision is made, before anything that can fail, and merged in
// rather than replaced so a partial write cannot erase older outstanding legs.
//
// Drives the REAL syncNavblueNow against a stubbed worker, with the feed shape
// Martin's own Porter roster publishes: scheduled times and a check-out, and
// NO actual arrival stamp anywhere.
//
// Run:  node test/outstanding-legs.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

// Today, in the same local terms the app uses, and a leg that landed hours ago.
const now = new Date();
const p2 = (n) => (n < 10 ? '0' : '') + n;
const todayStr = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);
const basic = (d) => d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
  'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + '00Z';
const hhmmZ = (d) => p2(d.getUTCHours()) + p2(d.getUTCMinutes());

// Check-in 8h ago, off 7h ago, scheduled arrival 2h ago, released 1h ago.
const ci = hoursAgo(8), std = hoursAgo(7), sta = hoursAgo(2), co = hoursAgo(1);
// A leg from yesterday, already in the logbook but missing its crew: the sync
// enriches it, which is what makes the run reach its DB.save.
const yCi = hoursAgo(30), yStd = hoursAgo(29), ySta = hoursAgo(26), yCo = hoursAgo(25);
const PAST_EVENT = [
  'BEGIN:VEVENT',
  'UID:6900001',
  'DTSTART:' + basic(yCi),
  'DTEND:' + basic(yCo),
  'SUMMARY:PD100 YOW-YYZ',
  'DESCRIPTION:PD100 YOW - YYZ\\nCI ' + hhmmZ(yCi) + 'Z\\nSTD ' + hhmmZ(yStd) + 'Z\\nSTA ' + hhmmZ(ySta) +
    'Z\\nCO ' + hhmmZ(yCo) + 'Z\\nDuration: 04:00\\, BLH: 03:00\\nActivity notes:\\nRC LC L.Poulin & M\\,Daoust',
  'END:VEVENT',
].join('\r\n');
const yesterdayStr = (function () {
  const d = hoursAgo(30);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
})();

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:6930664',
  'DTSTART:' + basic(ci),
  'DTEND:' + basic(co),
  'SUMMARY:PD325 YOW-YLW',
  'DESCRIPTION:PD325 YOW - YLW\\nCI ' + hhmmZ(ci) + 'Z\\nSTD ' + hhmmZ(std) + 'Z\\nSTA ' + hhmmZ(sta) +
    'Z\\nCO ' + hhmmZ(co) + 'Z\\nDuration: 06:09\\, BLH: 04:57\\nAircraft: 295 - 295XX - 295XX - C-GZQC',
  'END:VEVENT',
  PAST_EVENT,
  'END:VCALENDAR',
].join('\r\n');

const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
    w.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
  },
});
const w = dom.window;

w.eval(`
  showToast = function () {};
  localStorage.setItem('cumulo_navblue_url', 'https://porter.navblue.cloud/roster/x.ics');
  localStorage.setItem('logbook_v1', JSON.stringify([]));
  localStorage.removeItem('cumulo_roster_pending_today_v1');
  flights = DB.load();
  // The pilot's own operator code, so the leg is recognised as his.
  DB.saveProfile({ fname: 'Martin', lname: 'Daoust', rank: 'F/O', operatorCodes: 'PD' });
  // THE FAILURE: the undo snapshot blows up mid-sync, exactly as a full
  // localStorage would. Everything after it used to be skipped.
  window.__snapCalls = 0;
  snapshotBeforeOperation = function () { window.__snapCalls++; throw new Error('QuotaExceededError'); };
`);

await w.eval('syncNavblueNow({ silent: true })');

// ── 1. The note survives a failure that happens after the decision ──────
{
  const raw = w.localStorage.getItem('cumulo_roster_pending_today_v1');
  const note = raw ? JSON.parse(raw) : null;
  chk('the snapshot really did throw (the test proves what it claims)', w.eval('window.__snapCalls') > 0);
  chk('the outstanding-legs note is written despite the failure', !!note);
  chk('it is stamped with today', !!note && note.today === todayStr);
  chk('it holds the leg the feed could not prove', !!note && Array.isArray(note.flights) && note.flights.length === 1);
  chk('the leg is the one that flew', !!note && note.flights && note.flights[0] &&
    note.flights[0].flightNum === 'PD325' && note.flights[0].date === todayStr);
  chk('the leg is marked unproven, never logged as fact', !!note && note.flights && note.flights[0] &&
    note.flights[0]._unproven === true);
  // The sync must not ABORT because the undo snapshot failed. Losing the undo
  // point is worth a warning; losing the rest of the sync is how a flight goes
  // missing. The last-sync stamp is written at the very end, so its presence
  // proves the run reached the finish line.
  chk('the sync still runs to completion without its undo point',
    !!w.localStorage.getItem('cumulo_navblue_last_sync'));
}

// ── 2. …and the dashboard actually asks about it ────────────────────────
{
  const legs = JSON.parse(w.eval('JSON.stringify(_dashRosterLegsNotLogged())'));
  // Both: yesterday's leg (proven by its date) and today's unproven one.
  chk("the dashboard counts the unproven leg from today as outstanding",
    Array.isArray(legs) && legs.some(function (g) { return g.flightNum === 'PD325' && g.date === todayStr; }));
  chk('and the past leg alongside it',
    Array.isArray(legs) && legs.some(function (g) { return g.flightNum === 'PD100'; }));
  w.eval("showPage('dashboard'); renderDashboard();");
  const txt = w.eval("document.getElementById('page-dashboard').textContent");
  chk('the dashboard raises the review card', /roster flight/i.test(txt) || /horaire à revoir/i.test(txt));
}

// ── 3. Nothing was logged: no proof, no entry ───────────────────────────
{
  const logged = JSON.parse(w.localStorage.getItem('logbook_v1') || '[]');
  chk('an unproven leg is never written to the logbook', logged.length === 0);
}

// ── 4. A later partial write must not erase what is already outstanding ──
{
  w.eval(`
    persistOutstandingLegs({ eligible: [{ date: '2026-07-19', flightNum: 'PD100', route: 'YOW-YYZ' }] });
  `);
  const note = JSON.parse(w.localStorage.getItem('cumulo_roster_pending_today_v1'));
  chk('updating one field keeps the other', Array.isArray(note.flights) && note.flights.length === 1);
  chk('and records the new one', Array.isArray(note.eligible) && note.eligible.length === 1);
}


// ── 5. A failure LATER in the sync still leaves the note behind ─────────
//     Guarding the snapshot alone is not enough: anything after it can throw
//     too. This drives a sync whose DB.save gives out partway, which is what
//     a full localStorage actually does, and proves the note was already
//     written by then.
{
  const dom2 = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
    runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
    beforeParse(w2) {
      const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w2.Chart = c;
      if (!w2.matchMedia) w2.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w2.scrollTo = () => {};
      w2.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    },
  });
  const w2 = dom2.window;
  w2.eval(`
    showToast = function () {};
    localStorage.setItem('cumulo_navblue_url', 'https://porter.navblue.cloud/roster/x.ics');
    // Yesterday's leg, already logged but crewless. The sync fills the crew,
    // which is the merge that makes the run reach its DB.save.
    localStorage.setItem('logbook_v1', JSON.stringify([
      { id: '44444444-4444-4444-8444-444444444444', date: '${yesterdayStr}',
        flightNum: 'PD100', route: 'YOW-YYZ', block: 3, total: 3 }
    ]));
    localStorage.removeItem('cumulo_roster_pending_today_v1');
    flights = DB.load();
    DB.saveProfile({ fname: 'Martin', lname: 'Daoust', rank: 'F/O', operatorCodes: 'PD' });
    // Storage gives out on the first write of the merge phase, which sits
    // between the early note write and the late one.
    DB.save = function () { throw new Error('QuotaExceededError'); };
  `);
  await w2.eval('syncNavblueNow({ silent: true })');
  const raw2 = w2.localStorage.getItem('cumulo_roster_pending_today_v1');
  const note2 = raw2 ? JSON.parse(raw2) : null;
  chk('the note is already written when storage gives out later in the sync',
    !!note2 && Array.isArray(note2.flights) && note2.flights.length === 1);
  chk('and it names the right leg',
    !!note2 && note2.flights && note2.flights[0] && note2.flights[0].flightNum === 'PD325');
}
if (failures.length) {
  console.error(`\n✗ outstanding-legs test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ outstanding legs passed — the note survives a mid-sync failure, the dashboard asks about the leg, and nothing unproven is logged');
process.exit(0);
