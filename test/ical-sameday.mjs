// ═══════════════════════════════════════════════════════════════════
// SAME-DAY iCAL IMPORT TEST
//
// Feature (Martin 2026-07-25): "jai fait 2 vols, jai terminé il y a quelques
// heures et je les vois pas". The import gate was `date < today`, so a leg
// flown today never appeared until the next calendar day.
//
// A today-dated leg is now OFFERED FOR IMPORT only on the one sound proof a
// roster feed can give: an explicitly labelled ACTUAL ARRIVAL time
// (ATA/ALDT/AIBT). A moved block figure is a SIGNAL, not a proof, because an
// operator makes the same edit when it re-plans a leg in the morning as when
// it closes one out after landing; signalled legs are surfaced for the pilot
// to confirm, never logged for him.
//
// The adversarial review of 2026-07-25 killed the first design and this test
// encodes what it found:
//  - a departure stamp (ATD/ATOT/AOBT) is stamped at PUSH-BACK, so it can
//    never prove a leg is down;
//  - a block revised BEFORE departure, on a leg then delayed, made the old
//    rule import a flight sitting at the gate;
//  - a leg that crosses local midnight was admitted on its date alone while
//    still airborne.
// Each of those is a named case below.
//
// Also proves: a future leg is never offered; calibration is measured on
// planned legs, never assumed; actual times reach the flight only when the
// source labels them ACTUAL; and a past-dated leg still imports normally.
//
// Run:  node test/ical-sameday.mjs   (also part of `npm test`)
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
const evalJSON = (expr) => JSON.parse(w.eval(`JSON.stringify(${expr})`));

// ── Fixtures ───────────────────────────────────────────────────────
// Fixed instants so the test never depends on the wall clock.
const TODAY = '2026-07-25';
// A leg that departs CYOW 12:30Z and is scheduled 1h45 to CYYZ.
const OFF = '20260725T123000Z';
const NOW_AFTER  = Date.UTC(2026, 6, 25, 20, 0, 0);   // hours after it landed
const NOW_DURING = Date.UTC(2026, 6, 25, 13, 0, 0);   // still airborne

// STD 1230Z -> STA 1415Z is a 1h45 schedule = 1.75 h.
const descPlanned = (blh) => `Duration: 02:30\\nSTD 1230Z\\nSTA 1415Z\\nBLH: ${blh}\\nAircraft: 295\\nCO 1130Z\\nCI 1445Z\\nC-GKQA`;
const evPlanned = (blh, uid, dtstart) => ({
  SUMMARY: 'PD274 YOW-YYZ',
  DESCRIPTION: descPlanned(blh).replace(/\\n/g, '\n'),
  DTSTART: dtstart || OFF,
  UID: uid || 'uid-today-1'
});
// Same leg, but the operator also published explicit ACTUAL times.
const evActuals = () => ({
  SUMMARY: 'PD274 YOW-YYZ',
  DESCRIPTION: (descPlanned('1:45') + '\\nATD 1236Z\\nATA 1428Z').replace(/\\n/g, '\n'),
  DTSTART: OFF,
  UID: 'uid-today-1'
});
// Push-back stamped, nothing else: the aircraft is climbing out.
const evOffOnly = (blh) => ({
  SUMMARY: 'PD274 YOW-YYZ',
  DESCRIPTION: (descPlanned(blh || '1:45') + '\\nAOBT 1420Z').replace(/\\n/g, '\n'),
  DTSTART: OFF,
  UID: 'uid-today-1'
});

const toFlight = (ev) => evalJSON(`navblueEventToFlight(${JSON.stringify(ev)}, true, true)`);
const decide = (ev, today, ctx) =>
  evalJSON(`rosterImportDecision(${JSON.stringify(ev)}, ${JSON.stringify(toFlight(ev))}, ${JSON.stringify(today)}, ${JSON.stringify(ctx)})`);

// ── 0. The fixture itself must parse the way the app reads it ──────
const baseFlight = toFlight(evPlanned('1:45'));
chk('fixture: a planned PD leg maps to a flight', baseFlight && baseFlight.date === TODAY);
chk('fixture: BLH 1:45 reads as 1.75 h block', baseFlight && Math.abs(baseFlight.block - 1.75) < 1e-9);
chk('fixture: schedule span STD->STA reads as 1.75 h',
  Math.abs(w.eval(`icalScheduledSpanHours(${JSON.stringify(evPlanned('1:45').DESCRIPTION)})`) - 1.75) < 1e-9);
chk('fixture: a schedule-only leg carries no actual times',
  w.eval(`icalActualTimes(${JSON.stringify(evPlanned('1:45').DESCRIPTION)}) === null`));

// ── 1. REGRESSION GUARD (2026-07-01): today + no proof = never ─────
const noProofCtx = { nowMs: NOW_AFTER, calibrated: true, blockSeen: {} };
const d1 = decide(evPlanned('1:45'), TODAY, noProofCtx);
chk('today, block matches schedule, calibrated: NOT eligible', d1.eligible === false);
chk('today, no proof but past its arrival: flagged pending', d1.pending === true);

// ── 2. Still airborne: never eligible, never even pending ──────────
const d2 = decide(evPlanned('1:52'), TODAY, { nowMs: NOW_DURING, calibrated: true, blockSeen: {} });
chk('mid-flight leg with a divergent block: NOT eligible', d2.eligible === false);
chk('mid-flight leg: not pending either (not due down yet)', d2.pending === false);

// ── 3. A MOVED BLOCK IS A SIGNAL, NEVER A PROOF ────────────────────
// Review finding, reproduced: the operator republished this leg's block
// this morning (aircraft swap), then departure slipped two hours and the
// jet is still at the gate. The old rule imported it. It must not.
const d3 = decide(evPlanned('1:52'), TODAY, { nowMs: NOW_AFTER, calibrated: true, blockSeen: {} });
chk('today, block revised away from schedule: NOT eligible', d3.eligible === false);
chk('today, block revised: surfaced as pending instead', d3.pending === true);
chk('today, block revised: signal reported as block-revised', d3.signal === 'block-revised');

// Same for a block that moved since the baseline we recorded while pending.
const seenCtx = { nowMs: NOW_AFTER, calibrated: false, blockSeen: { 'uid-today-1': { block: 1.75, ts: NOW_DURING } } };
const d4 = decide(evPlanned('1:52', 'uid-today-1'), TODAY, seenCtx);
chk('today, block changed since baseline: NOT eligible', d4.eligible === false);
chk('today, block changed since baseline: signal reported as block-changed', d4.signal === 'block-changed');
const d4b = decide(evPlanned('1:45', 'uid-today-1'), TODAY, seenCtx);
chk('today, block unchanged since baseline: no signal', d4b.signal === '');

// ── 5. Two minutes of rounding is noise, not even a signal ─────────
const d5 = decide(evPlanned('1:47'), TODAY, { nowMs: NOW_AFTER, calibrated: true, blockSeen: {} });
chk('today, block differs by exactly 2 min: no signal (rounding noise)', d5.signal === '');
chk('today, block differs by exactly 2 min: NOT eligible', d5.eligible === false);

// ── 6. Only an ACTUAL ARRIVAL proves the leg is down ───────────────
const d6 = decide(evActuals(), TODAY, { nowMs: NOW_AFTER, calibrated: false, blockSeen: {} });
chk('today with a published ATA: eligible', d6.eligible === true);
chk('today with a published ATA: proof reported as actual-arrival', d6.proof === 'actual-arrival');
const act = evalJSON(`icalActualTimes(${JSON.stringify(evActuals().DESCRIPTION)})`);
chk('actual times parsed off/on', act && act.atd === '1236' && act.ata === '1428');
// A schedule token must never be mistaken for an actual one.
chk('STD/STA/CO/CI are never read as actuals',
  w.eval(`icalActualTimes('STD 1230Z\\nSTA 1415Z\\nCO 1130Z\\nCI 1445Z') === null`));

// ── 6a. Runway times are actuals, but not BLOCK times ──────────────
// Review finding, reproduced: in a chronological OOOI list ALDT (touchdown)
// always precedes AIBT (on-blocks), so a combined pattern picked touchdown
// and recorded it as block-on, minutes early. atd_utc/ata_utc mean
// off-blocks and on-blocks here, so only those two may ever be written.
const ooooi = 'AOBT 1236Z\nATOT 1249Z\nALDT 1421Z\nAIBT 1428Z';
const actOooi = evalJSON(`icalActualTimes(${JSON.stringify(ooooi)})`);
chk('full OOOI set: on-blocks taken from AIBT, not from touchdown',
  actOooi && actOooi.ata === '1428');
chk('full OOOI set: off-blocks taken from AOBT, not from wheels-up',
  actOooi && actOooi.atd === '1236');
// Runway times ALONE prove the leg is down but give us no block time, so
// the fields stay empty rather than holding the wrong quantity.
chk('runway times alone prove arrival',
  w.eval(`icalHasActualArrival('ATOT 1249Z\\nALDT 1421Z') === true`));
chk('runway times alone are never written as block times',
  w.eval(`icalActualTimes('ATOT 1249Z\\nALDT 1421Z') === null`));

// ── 6b. A DEPARTURE stamp is not an arrival ────────────────────────
// Review finding, reproduced: AOBT/ATD/ATOT are stamped at push-back. The
// aircraft is airborne, so this must never be eligible however late it is.
const d6b = decide(evOffOnly('1:45'), TODAY, { nowMs: NOW_AFTER, calibrated: true, blockSeen: {} });
chk('today with only a push-back stamp: NOT eligible', d6b.eligible === false);
chk('today with only a push-back stamp: surfaced as pending', d6b.pending === true);
chk('a push-back stamp alone is not an arrival',
  w.eval(`icalHasActualArrival('AOBT 1420Z\\nATD 1236Z\\nATOT 1245Z') === false`));
chk('an arrival stamp is an arrival',
  w.eval(`icalHasActualArrival('AIBT 1428Z') === true`));
// Even combined with a moved block, push-back only is still not down.
chk('push-back stamp plus a revised block: still NOT eligible',
  decide(evOffOnly('1:52'), TODAY, { nowMs: NOW_AFTER, calibrated: true, blockSeen: {} }).eligible === false);

// ── 7. A leg that crossed local midnight is not "yesterday, done" ──
// Review finding, reproduced: departs 21:00 EDT so it is dated yesterday
// the moment the device rolls over, while the jet is still airborne.
const crossing = {
  SUMMARY: 'PD274 YOW-YYZ',
  DESCRIPTION: 'Duration: 03:00\nSTD 0100Z\nSTA 0315Z\nBLH: 2:15\nAircraft: 295',
  DTSTART: '20260726T010000Z',
  UID: 'uid-crossing'
};
const crossFlight = toFlight(crossing);
chk('fixture: the midnight-crossing leg is dated by its LOCAL departure day',
  crossFlight && crossFlight.date === '2026-07-25');
const d7 = evalJSON(`rosterImportDecision(${JSON.stringify(crossing)}, ${JSON.stringify(crossFlight)}, "2026-07-26", ${JSON.stringify({ nowMs: Date.UTC(2026, 6, 26, 2, 30, 0), calibrated: false, blockSeen: {} })})`);
chk('dated yesterday but still airborne: NOT eligible', d7.eligible === false);
const d7b = evalJSON(`rosterImportDecision(${JSON.stringify(crossing)}, ${JSON.stringify(crossFlight)}, "2026-07-26", ${JSON.stringify({ nowMs: Date.UTC(2026, 6, 26, 4, 0, 0), calibrated: false, blockSeen: {} })})`);
chk('dated yesterday and down: eligible again on the next sync', d7b.eligible === true);

// ── 7b. The airborne guard uses the same block-off as the logbook ──
// Review finding, reproduced: the guard was anchored on DTSTART while the
// logbook row moved to STD, so for a whole check-in-to-departure gap the
// app held a scheduled on-block of 06:30Z on the flight it was writing
// while asking whether 05:30Z had passed, and offered a leg still in the
// air, preticked and with no warning badge.
const lateLeg = {
  SUMMARY: 'PD950 YYZ-YWG', UID: 'late-1', DTSTART: '20261110T033000Z',
  DESCRIPTION: 'PD950 YYZ - YWG\nCI 0330Z\nSTD 0430Z\nSTA 0630Z\nDuration: 03:00, BLH: 02:00\nAircraft: 295\n'
};
const lateFlight = toFlight(lateLeg);
const decideAt = (ms) => evalJSON(`rosterImportDecision(${JSON.stringify(lateLeg)}, ${JSON.stringify(lateFlight)}, "2026-11-10", ${JSON.stringify({ nowMs: ms, calibrated: false, blockSeen: {} })})`);
chk('fixture: the late leg is dated by its departure', lateFlight && lateFlight.date === '2026-11-09');
chk('airborne on the old anchor but not yet down: NOT eligible',
  decideAt(Date.UTC(2026, 10, 10, 5, 35, 0)).eligible === false);
chk('still not eligible a minute before scheduled on-block',
  decideAt(Date.UTC(2026, 10, 10, 6, 29, 0)).eligible === false);
chk('eligible once it is actually due down',
  decideAt(Date.UTC(2026, 10, 10, 6, 30, 0)).eligible === true);

// ── 8. Future legs are never eligible ──────────────────────────────
const future = evPlanned('1:52', 'uid-future', '20260801T123000Z');
const d8 = decide(future, TODAY, { nowMs: NOW_AFTER, calibrated: true, blockSeen: {} });
chk('a future leg is never eligible', d8.eligible === false);
chk('a future leg is never pending', d8.pending === false);

// ── 9. Past legs unchanged: eligible on their date alone ───────────
const past = evPlanned('1:45', 'uid-past', '20260724T123000Z');
const d9 = decide(past, TODAY, { nowMs: NOW_AFTER, calibrated: false, blockSeen: {} });
chk('a past-dated leg stays eligible with no proof', d9.eligible === true && d9.proof === 'past-date');
// An event with no usable arrival keeps the old date-only behaviour rather
// than silently vanishing from the import.
const noArrival = { SUMMARY: 'PD274 YOW-YYZ', DESCRIPTION: 'BLH: 1:45\nAircraft: 295', DTSTART: '' , UID: 'uid-noarr' };
const naFlight = toFlight(noArrival);
if (naFlight && naFlight.date) {
  const dNa = evalJSON(`rosterImportDecision(${JSON.stringify(noArrival)}, ${JSON.stringify(naFlight)}, ${JSON.stringify(TODAY)}, ${JSON.stringify({ nowMs: NOW_AFTER, calibrated: false, blockSeen: {} })})`);
  chk('a past leg whose arrival cannot be computed is still eligible',
    naFlight.date >= TODAY || dNa.eligible === true);
}

// ── 10. Feed calibration is measured, never assumed ────────────────
// Three future legs whose BLH equals their own schedule = clean baseline.
const cleanFeed = [
  evPlanned('1:45', 'f1', '20260801T123000Z'),
  evPlanned('1:45', 'f2', '20260802T123000Z'),
  evPlanned('1:45', 'f3', '20260803T123000Z')
];
const calClean = evalJSON(`rosterFeedCalibration(${JSON.stringify(cleanFeed)}, ${JSON.stringify(TODAY)})`);
chk('clean feed: calibration usable', calClean.usable === true && calClean.samples === 3 && calClean.diverged === 0);

// One planned leg already diverges: the whole test is untrustworthy.
const dirtyFeed = cleanFeed.concat([evPlanned('2:05', 'f4', '20260804T123000Z')]);
const calDirty = evalJSON(`rosterFeedCalibration(${JSON.stringify(dirtyFeed)}, ${JSON.stringify(TODAY)})`);
chk('feed whose planned legs already diverge: calibration NOT usable', calDirty.usable === false);

// Too few samples to conclude anything.
const thinFeed = [evPlanned('1:45', 'f1', '20260801T123000Z')];
const calThin = evalJSON(`rosterFeedCalibration(${JSON.stringify(thinFeed)}, ${JSON.stringify(TODAY)})`);
chk('one future leg is not a baseline: calibration NOT usable', calThin.usable === false);

// Today's own leg must never be used to calibrate the feed it judges.
const selfFeed = cleanFeed.concat([evPlanned('1:52', 'today', OFF)]);
const calSelf = evalJSON(`rosterFeedCalibration(${JSON.stringify(selfFeed)}, ${JSON.stringify(TODAY)})`);
chk('a today-dated leg is excluded from calibration', calSelf.samples === 3);

// ── 10b. The "not logged yet" card must not lose a real leg ────────
// Review finding, reproduced: on a four-leg turn day, logging two legs
// made the card claim all four were done, because each logged row was
// counted once by the strict matcher AND once again by the route pool.
const TURN = [
  { date: TODAY, flightNum: 'PD100', route: 'YOW-YYZ', block: 1.10 },
  { date: TODAY, flightNum: 'PD101', route: 'YYZ-YOW', block: 1.15 },
  { date: TODAY, flightNum: 'PD102', route: 'YOW-YYZ', block: 1.45 },
  { date: TODAY, flightNum: 'PD103', route: 'YYZ-YOW', block: 1.50 }
];
const pendingAfterLogging = (logged) => {
  const setup = `
    localStorage.setItem('cumulo_roster_pending_today_v1', JSON.stringify({ ts: 0, today: ${JSON.stringify(TODAY)}, flights: ${JSON.stringify(TURN)} }));
    flights = ${JSON.stringify(logged)};
    localTodayStr = function () { return ${JSON.stringify(TODAY)}; };
    JSON.stringify(_dashPendingTodayLegs().map(function (g) { return g.flightNum; }));
  `;
  return JSON.parse(w.eval(setup));
};
chk('nothing logged: all four legs still listed',
  pendingAfterLogging([]).join(',') === 'PD100,PD101,PD102,PD103');
chk('two legs logged: exactly the other two remain',
  pendingAfterLogging(TURN.slice(0, 2)).join(',') === 'PD102,PD103');
chk('all four logged: nothing remains',
  pendingAfterLogging(TURN).length === 0);
// A leg he typed himself, no flight number: the strict matcher still
// recognises it when the block is close to a roster figure, and picks the
// leg it actually matches rather than the first one on the route.
chk('a hand-typed leg matching a roster block clears THAT leg',
  pendingAfterLogging([{ date: TODAY, flightNum: '', route: 'YOW-YYZ', block: 1.45 }]).join(',') === 'PD100,PD101,PD103');
// And when his real block is nowhere near the roster figure, the route
// pass clears exactly one entry on that route, never both.
chk('a hand-typed leg with a block unlike any roster figure clears one entry, not two',
  pendingAfterLogging([{ date: TODAY, flightNum: '', route: 'YOW-YYZ', block: 2.00 }]).join(',') === 'PD101,PD102,PD103');

// ── 10c. Outstanding legs must OUTLIVE the import modal ────────────
// Martin, 2026-07-25: his logbook stopped at 2026-07-19 and his career
// total was wrong. The import only writes when the modal is confirmed,
// and closing it left no trace anywhere, so five days of flying went
// nowhere while the same modal reopened and closed. The list now lives in
// the cache and the dashboard keeps asking.
const OUTSTANDING = [
  { date: '2026-07-20', flightNum: 'PD202', route: 'YHZ-YYZ', block: 2.35 },
  { date: '2026-07-20', flightNum: 'PD423', route: 'YYZ-YWG', block: 3.02 },
  { date: '2026-07-20', flightNum: 'PD294', route: 'YWG-YOW', block: 2.52 }
];
const notLogged = (cache, logged) => JSON.parse(w.eval(`
  localStorage.setItem('cumulo_roster_pending_today_v1', JSON.stringify(${JSON.stringify(cache)}));
  flights = ${JSON.stringify(logged)};
  localTodayStr = function () { return ${JSON.stringify(TODAY)}; };
  JSON.stringify(_dashRosterLegsNotLogged().map(function (g) { return g.flightNum; }));
`));
chk('past-dated legs left unconfirmed stay on the list',
  notLogged({ ts: 0, today: TODAY, flights: [], eligible: OUTSTANDING }, []).join(',') === 'PD202,PD423,PD294');
chk('the list survives a cache whose today has rolled over',
  notLogged({ ts: 0, today: '2026-07-19', flights: [], eligible: OUTSTANDING }, []).length === 3);
chk('logging them clears the list',
  notLogged({ ts: 0, today: TODAY, flights: [], eligible: OUTSTANDING }, OUTSTANDING).length === 0);
chk('logging one of them clears exactly that one',
  notLogged({ ts: 0, today: TODAY, flights: [], eligible: OUTSTANDING }, [OUTSTANDING[1]]).join(',') === 'PD202,PD294');
// Today's unproven legs still age out, and both halves are counted once.
chk('proven past legs and today\'s unproven legs are listed together',
  notLogged({ ts: 0, today: TODAY, flights: TURN.slice(0, 1), eligible: OUTSTANDING }, []).length === 4);
chk('yesterday\'s unproven legs age out while the proven ones do not',
  notLogged({ ts: 0, today: '2026-07-24', flights: TURN.slice(0, 1), eligible: OUTSTANDING }, []).length === 3);
// A leg he deleted on purpose must never be nagged about again.
w.eval(`recordTombstone(${JSON.stringify(OUTSTANDING[0])})`);
chk('a deliberately deleted leg is never nagged about again',
  notLogged({ ts: 0, today: TODAY, flights: [], eligible: OUTSTANDING }, []).join(',') === 'PD423,PD294');

// ── 10d. The card must not keep counting legs already imported ─────
// Review finding, reproduced: iCal legs arrive crewless, so importing
// them opens the quick crew-fill, which skips the navigation to the
// logbook. Nothing re-rendered the dashboard, so the card behind the
// modal kept reporting flights that were now in the logbook. Same
// confusion mode as the original incident, pointing the other way.
const cardText = () => {
  const el = w.document.getElementById('dashNextColumn');
  const card = el && el.querySelector('.dash-next-card');
  return card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
};
// Distinct legs: the tombstone recorded above must not bleed into this case.
const CARD_LEGS = [
  { date: '2026-07-21', flightNum: 'PD801', route: 'YOW-YQB', block: 1.10 },
  { date: '2026-07-21', flightNum: 'PD802', route: 'YQB-YOW', block: 1.15 },
  { date: '2026-07-21', flightNum: 'PD803', route: 'YOW-YTZ', block: 0.90 }
];
w.eval(`
  localStorage.setItem('cumulo_roster_pending_today_v1', JSON.stringify({ ts: 0, today: ${JSON.stringify(TODAY)}, flights: [], eligible: ${JSON.stringify(CARD_LEGS)} }));
  flights = [];
  localTodayStr = function () { return ${JSON.stringify(TODAY)}; };
  setLang('en');
  showPage('dashboard');
`);
chk('card announces the outstanding legs before import', /3 roster flights to review/.test(cardText()));
w.eval(`openRosterNotLoggedReview(); confirmImport();`);
chk('the legs really landed in the logbook', w.eval('flights.length') === 3);
chk('card is cleared as soon as the import lands, without leaving the page',
  cardText() === '' || !/roster flights? to review/.test(cardText()));
w.eval('closeQuickCrewFill();');
chk('card stays cleared after skipping the crew-fill',
  cardText() === '' || !/roster flights? to review/.test(cardText()));

// ── 10e. Day-relative badges must not survive into another day ─────
// Review finding, reproduced: a leg proven yesterday keeps _flownToday in
// the cache, and the review modal badged it "Flown today" days later.
const badgeFor = (legDate, today) => JSON.parse(w.eval(`
  localStorage.setItem('cumulo_roster_pending_today_v1', JSON.stringify({ ts: 0, today: ${JSON.stringify(TODAY)}, flights: [], eligible: [{ date: ${JSON.stringify(legDate)}, flightNum: 'PD274', route: 'YOW-YYZ', block: 1.75, _flownToday: true, _proof: 'actual-arrival' }] }));
  flights = [];
  localTodayStr = function () { return ${JSON.stringify(today)}; };
  JSON.stringify(_dashRosterLegsNotLogged().map(function (g) { return !!g._flownToday; }));
`));
chk('a leg proven TODAY still reads as flown today', badgeFor(TODAY, TODAY)[0] === true);
chk('the same leg replayed tomorrow no longer claims it was flown today', badgeFor(TODAY, '2026-07-26')[0] === false);
chk('nor three days later', badgeFor(TODAY, '2026-07-28')[0] === false);

// ── 11. A deadhead is still never a flight, on any path ────────────
const dh = { SUMMARY: 'PD274 YOW-YYZ (D)', DESCRIPTION: evPlanned('1:52').DESCRIPTION, DTSTART: OFF, UID: 'uid-dh' };
chk('a deadhead leg never maps to a flight', toFlight(dh) === null);

if (failures.length) {
  console.error(`\n✗ ical-sameday test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ ical-sameday passed — only a published ARRIVAL time imports a same-day leg; a moved block only signals; gate-delay, push-back-stamp and midnight-crossing legs all stay out');
process.exit(0);
