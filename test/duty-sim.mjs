// ═══════════════════════════════════════════════════════════════════
// FLIGHT SWAP SIMULATOR TEST (Duty page)
//
// Feature (Martin 2026-07-17): "si scheduling m'appelle et dit on t'enlève de
// tel vol et te met sur celui-ci, j'aimerais pouvoir entrer les heures de vol
// pour voir la différence et si je suis legal de le faire" — then: "ok pas
// besoin de se compliquer la vie ce n'est pas un document legal je veux juste
// un estimé". The CEREMONY is light; the ARITHMETIC is not. This pins the
// arithmetic:
//   • _dutySwapCandidates — the removable flights = exactly the upcoming
//        schedule flights the projection engine counts in (future only,
//        already-logged de-duped)
//   • _dutySwapHours      — garbage / negative / zero → "no flight added"
//   • _dutySwapModel      — remove-only lowers, add-only raises, a swap moves
//        the net delta, on a COPY that never touches flights or storage
//   • _dutySwapResultHtml — the over-limit verdict names the right window and
//        the right number of excess hours, and the breach date moved by the
//        swap is stated
//
// Every date is passed in explicitly (todayOverride) so the test is stable on
// any day it runs. The one render test uses far-future roster dates so that it
// too is date-independent.
//
// Run:  node test/duty-sim.mjs   (also part of `npm test`)
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
const eq = (label, got, want) => { if (got !== want) failures.push(`${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); };
const has = (label, hay, needle) => { if (String(hay).indexOf(needle) === -1) failures.push(`${label}: missing ${JSON.stringify(needle)} in ${JSON.stringify(String(hay).slice(0, 400))}`); };
const not = (label, hay, needle) => { if (String(hay).indexOf(needle) !== -1) failures.push(`${label}: should NOT contain ${JSON.stringify(needle)}`); };

const TODAY = '2026-07-14';

// ── Fixture ──────────────────────────────────────────────────────────
// Logged: 30 h on Jul 10 + 30 h on Jul 12 = 60 h inside the 28-day window.
// Schedule ahead: 10 h on Jul 16 (PD3) + 8 h on Jul 18 (PD4).
// Rolling 28-day peak over [Jul 14 … Jul 18] = 78.0 h on Jul 18.
function fixture() {
  w.eval("flights = [" +
    "{date:'2026-07-10', flightNum:'PD1', total:30}," +
    "{date:'2026-07-12', flightNum:'PD2', total:30}" +
  "];");
  w.eval("localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ts:1, today:'2026-07-14', flights:[" +
    "{date:'2026-07-16', flightNum:'PD3', route:'YYZ-YOW', block:10, estimated:false}," +
    "{date:'2026-07-18', flightNum:'PD4', route:'YOW-YYZ', block:8, estimated:false}" +
  "]}));");
}
const model = (sel, today) => JSON.parse(w.eval(
  `JSON.stringify(_dutySwapModel(${JSON.stringify(sel || {})}, ${JSON.stringify(today || TODAY)}))`));
const html = (sel, fr, today) => w.eval(
  `_dutySwapResultHtml(_dutySwapModel(${JSON.stringify(sel || {})}, ${JSON.stringify(today || TODAY)}), ${fr ? 'true' : 'false'})`);
const w28 = m => m.rows.find(r => r.lim.days === 28);

fixture();

// ── Hours parsing: never a guessed value ─────────────────────────────
eq('hours 2.1 → 2.1', w.eval("_dutySwapHours('2.1')"), 2.1);
eq('hours 2,1 (comma) → 2.1', w.eval("_dutySwapHours('2,1')"), 2.1);
eq('hours negative → 0', w.eval("_dutySwapHours('-3')"), 0);
eq('hours garbage → 0', w.eval("_dutySwapHours('nope')"), 0);
eq('hours empty → 0', w.eval("_dutySwapHours('')"), 0);
eq('hours null → 0', w.eval("_dutySwapHours(null)"), 0);
eq('hours zero → 0', w.eval("_dutySwapHours('0')"), 0);

// ── Candidates = the schedule flights the engine counts in ───────────
const cands = JSON.parse(w.eval(`JSON.stringify(_dutySwapCandidates('${TODAY}'))`));
eq('2 removable flights', cands.length, 2);
eq('candidate key = date|flightNum', cands[0].key, '2026-07-16|PD3');
eq('candidate carries its block', cands[0].block, 10);
eq('candidate carries its route', cands[0].route, 'YYZ-YOW');

// A schedule flight already flown & logged is NOT offered for removal (its
// hours are counted once, as an actual — same de-dup as computeDutyProjection).
w.eval("localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ts:1, today:'2026-07-14', flights:[" +
  "{date:'2026-07-12', flightNum:'PD2', route:'YYZ-YOW', block:30, estimated:false}" +   // already in flights
"]}));");
eq('already-logged schedule flight not offered', w.eval(`_dutySwapCandidates('${TODAY}').length`), 0);
fixture();

// ── Baseline: no swap = no verdict, the panel just states where he stands ──
const base = model({});
eq('baseline 28-day peak 78.0', w28(base).after, 78);
eq('baseline delta 0', w28(base).delta, 0);
eq('baseline hasChange false', base.hasChange, false);
not('baseline shows no verdict', html({}, true), 'Ça passe');
not('baseline shows no verdict (over)', html({}, true), 'Ça dépasse');
not('baseline shows no arrow (nothing moved)', html({}, true), '→');
not('baseline shows no delta chip', html({}, true), 'sw-delta');
// 78.0 / 112 = 69.6% → still under the 70% "watch" threshold.
has('baseline states one clean number per window', html({}, true), '28 jours&nbsp;: <strong class="ok">78,0 h</strong> sur 112 h (34,0 h de marge)');
eq('baseline severity ok at 69.6% of the limit', w28(base).sev, 'ok');
has('baseline still footed as an estimate', html({}, true), 'Estimé selon ton horaire et tes vols enregistrés.');

// ── (a) Removal only LOWERS the total, by exactly the flight's block ──
const rem = model({ outKey: '2026-07-16|PD3' });
eq('(a) before 78.0', w28(rem).before, 78);
eq('(a) after 68.0 (−10 h block)', w28(rem).after, 68);
eq('(a) delta −10.0', w28(rem).delta, -10);
eq('(a) margin 44.0 of 112', w28(rem).margin, 44);
eq('(a) 90-day window follows too', rem.rows.find(r => r.lim.days === 90).delta, -10);
// A drop is rendered with a real minus sign (U+2212), never a hyphen.
has('(a) FR delta chip reads −10,0 h', html({ outKey: '2026-07-16|PD3' }, true), '<span class="sw-delta num">−10,0 h</span>');
has('(a) FR verdict gains the freed room', html({ outKey: '2026-07-16|PD3' }, true), 'Ça passe&nbsp;: il te resterait 44,0 h sur 28 jours.');

// ── (b) Addition only RAISES the total, by exactly the hours typed ────
const add = model({ addDate: '2026-07-20', addHours: '5' });
eq('(b) before 78.0', w28(add).before, 78);
eq('(b) after 83.0 (+5 h)', w28(add).after, 83);
eq('(b) delta +5.0', w28(add).delta, 5);
eq('(b) horizon extended to the added date', add.horizon, '2026-07-20');

// ── (c) A real swap = the exact NET delta ────────────────────────────
// Off PD3 (10.0 h), on a 12.5 h flight the same day → net +2.5 h.
const swap = model({ outKey: '2026-07-16|PD3', addDate: '2026-07-16', addHours: '12.5' });
eq('(c) after 80.5', w28(swap).after, 80.5);
eq('(c) net delta +2.5', w28(swap).delta, 2.5);
eq('(c) removed flight identified', swap.removed && swap.removed.flightNum, 'PD3');
// Displayed before + displayed delta must land exactly on displayed after.
swap.rows.forEach(r => eq(`(c) ${r.lim.days}-day: before + delta = after`,
  Math.round((r.before + r.delta) * 10) / 10, r.after));
// …and displayed after + displayed margin must land exactly on the limit.
swap.rows.forEach(r => eq(`(c) ${r.lim.days}-day: after + margin = limit`,
  Math.round((r.after + r.margin) * 10) / 10, r.lim.limit));

// ── (d) An addition that busts 112 h: the over verdict, with the right count ──
// 37.2 h added on Jul 16 → 28-day peak on Jul 18 = 30+30+37.2+8 = 115.2 h,
// i.e. 3.2 h past the 112 h limit.
const over = model({ addDate: '2026-07-16', addHours: '37.2' });
eq('(d) after 115.2', w28(over).after, 115.2);
eq('(d) margin −3.2 (over)', w28(over).margin, -3.2);
eq('(d) severity over', w28(over).sev, 'over');
eq('(d) binding window is the 28-day one', over.bind.lim.days, 28);
eq('(d) 90-day window still has room', over.rows.find(r => r.lim.days === 90).margin, 184.8);
const overFr = html({ addDate: '2026-07-16', addHours: '37.2' }, true);
has('(d) FR verdict names the excess + window + reg', overFr, 'Ça dépasse&nbsp;: 3,2 h de trop sur 28 jours (RAC 700.27).');
has('(d) FR verdict is tinted danger', overFr, '<p class="sw-verdict over num">');
has('(d) FR line shows before → after of the limit', overFr, '28 jours&nbsp;: 78,0 h → <strong class="over">115,2 h</strong> sur 112 h (3,2 h de trop)');
has('(d) FR delta shown', overFr, '+37,2 h');
// A peak that lands in the [limit, limit+0.05) band displays as "112,0 h · 0,0 h"
// yet TRULY exceeds 112 h: the verdict is decided on the unrounded peak, so it
// must read "over" (with the red dot), never "fits". 34.04 h on Jul 16 →
// 28-day peak on Jul 18 = 30+30+(10+34.04)+8 = 112.04 h.
const edge = model({ addDate: '2026-07-16', addHours: '34.04' });
eq('(d2) peak rounds to the cap', w28(edge).after, 112);
eq('(d2) severity over at the boundary', w28(edge).sev, 'over');
const edgeFr = html({ addDate: '2026-07-16', addHours: '34.04' }, true);
has('(d2) FR verdict is over at the boundary', edgeFr, 'Ça dépasse');
not('(d2) never "fits" while the dot is red', edgeFr, 'Ça passe');

const overEn = html({ addDate: '2026-07-16', addHours: '37.2' }, false);
has('(d) EN verdict', overEn, 'Over: 3.2 h too many in 28 days (CAR 700.27).');
has('(d) EN line', overEn, '28 days: 78.0 h → <strong class="over">115.2 h</strong> of 112 h (3.2 h over)');
has('(d) EN footer', overEn, 'Estimated from your schedule and logged flights.');

// The change moves the breach date: it did not exist before, it does now.
eq('(d) breach date after = Jul 18', w28(over).hitAfter, '2026-07-18');
eq('(d) no breach date before', w28(over).hitBefore, null);
// Add-only (nothing removed) is NOT a swap: the hit line says "change", not "swap".
has('(d) FR breach line (add-only → change)', overFr, 'Avec ce changement, tu atteindrais 112 h le 18 juillet.');
has('(d) EN breach line (add-only → change)', overEn, 'With this change, you would reach 112 h on July 18.');
// The SAME breach WITH a real removal keeps "échange"/"swap" — that word is
// reserved for an actual removal. Off PD3 (10 h), on 47.2 h the same day gives the
// identical 115.2 h peak on Jul 18, but now a flight was genuinely swapped out.
const swapOver = html({ outKey: '2026-07-16|PD3', addDate: '2026-07-16', addHours: '47.2' }, true);
has('(d) a real removal keeps "échange"', swapOver, 'Avec cet échange, tu atteindrais 112 h le 18 juillet.');

// A swap that moves an EXISTING breach date earlier says so ("instead of").
// 42 h on Jul 16 → the window hits 112 on Jul 16 itself (30+30+42 = 102 → no);
// use 52 h: Jul 16 window = 112.0 → breach Jul 16 instead of Jul 18.
w.eval("localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ts:1, today:'2026-07-14', flights:[" +
  "{date:'2026-07-16', flightNum:'PD3', route:'YYZ-YOW', block:10, estimated:false}," +
  "{date:'2026-07-18', flightNum:'PD4', route:'YOW-YYZ', block:42, estimated:false}" +   // 30+30+10+42 = 112 on Jul 18
"]}));");
eq('breach exists before the swap (Jul 18)', model({}).rows[0].hitBefore, '2026-07-18');
const earlier = html({ addDate: '2026-07-16', addHours: '42' }, true);   // 30+30+10+42 = 112 on Jul 16
has('FR breach line names the date it moves FROM', earlier, 'Avec ce changement, tu atteindrais 112 h le 16 juillet (au lieu du 18 juillet).');
fixture();

// ── (e) No schedule loaded at all: no crash, no fabricated flight ─────
w.eval("localStorage.removeItem('cumulo_roster_forecast_v1');");
const noFc = model({ addDate: '2026-07-20', addHours: '5' });
eq('(e) no candidates', noFc.candidates.length, 0);
eq('(e) no forecast cache flagged', noFc.hasForecastCache, false);
eq('(e) 28-day before = logged only (60.0)', w28(noFc).before, 60);
eq('(e) 28-day after = 65.0', w28(noFc).after, 65);
has('(e) FR says no schedule imported', w.eval("_dutySwapNoneTxt(true, false)"), 'Aucun horaire importé&nbsp;: entre seulement le vol ajouté.');
// A connected schedule with nothing upcoming must NEVER be told it was never
// imported (same honesty guarantee as the forecast notice).
has('(e) FR distinguishes "connected but empty"', w.eval("_dutySwapNoneTxt(true, true)"), 'Aucun vol à venir à ton horaire');
// An unknown outKey (e.g. the schedule changed under a stale panel) is ignored.
eq('(e) unknown outKey ignored', model({ outKey: 'nope|PDX' }).removed, null);
// Empty logbook + empty schedule: still no crash, everything at zero.
w.eval("flights = [];");
const empty = model({});
eq('(e) empty logbook → 0.0 h', w28(empty).after, 0);
eq('(e) empty logbook → full margin', w28(empty).margin, 112);
eq('(e) empty logbook → severity ok', w28(empty).sev, 'ok');
has('(e) empty logbook renders', html({}, true), 'sw-lines');
fixture();

// ── (f) The simulation writes NOTHING: not the logbook, not storage ───
const flightsBefore = w.eval("JSON.stringify(flights)");
const storeBefore = w.eval("JSON.stringify(Object.keys(localStorage).sort().map(function(k){return k+'='+localStorage.getItem(k);}))");
w.eval("_dutySwapModel({outKey:'2026-07-16|PD3', addDate:'2026-07-16', addHours:'12.5'}, '2026-07-14');");
w.eval("_dutySwapResultHtml(_dutySwapModel({addDate:'2026-07-16', addHours:'37.2'}, '2026-07-14'), true);");
eq('(f) flights unchanged by the simulation', w.eval("JSON.stringify(flights)"), flightsBefore);
eq('(f) storage unchanged by the simulation', w.eval("JSON.stringify(Object.keys(localStorage).sort().map(function(k){return k+'='+localStorage.getItem(k);}))"), storeBefore);
// The source day-hours map handed out by the engine is not mutated either.
eq('(f) engine source map untouched', w.eval(
  "(function(){var a=JSON.stringify(_dutyDrillData(28,'2026-07-14').combined);" +
  "_dutySwapModel({outKey:'2026-07-16|PD3', addDate:'2026-07-16', addHours:'99'}, '2026-07-14');" +
  "return JSON.stringify(_dutyDrillData(28,'2026-07-14').combined)===a;})()"), true);
// And the projection the rest of the page shows is unaffected.
eq('(f) page projection still 78.0 after simulating', w.eval("computeDutyProjection(28,112,'2026-07-14').peak"), 78);

// ═══════════════════════════════════════════════════════════════════
// PAIRING (multi-day) — Martin 2026-07-20: "j'aimerais aussi pouvoir simuler si
// j'ajoute un pairing disons de 2 jours en overtime entre tel date et tel date".
// A total of block hours spread evenly across [start … end], stacking onto the
// same non-destructive copy as the single-flight swap. "Overtime" is a PAY word;
// RAC 700.27 counts the hours regardless, so a pairing moves the flight-time
// windows exactly like any other hours (the pay side stays on the Pay page).
// ═══════════════════════════════════════════════════════════════════

// (a) A 2-day, 10 h pairing spreads 5 h onto EACH day; with both days inside the
//     28-day window it lifts every window by the full 10 h. Jul 20–21 sit past
//     the roster (horizon extends) and collide with nothing, so the delta is clean.
const pairA = model({ pairStart: '2026-07-20', pairEnd: '2026-07-21', pairHours: '10' });
eq('(a) pairing spans 2 days', pairA.pairing.count, 2);
eq('(a) 5.0 h on day 1', pairA.pairing.perByDate['2026-07-20'], 5);
eq('(a) 5.0 h on day 2', pairA.pairing.perByDate['2026-07-21'], 5);
eq('(a) the parts sum to the entered total', pairA.pairing.perByDate['2026-07-20'] + pairA.pairing.perByDate['2026-07-21'], 10);
eq('(a) horizon extended to the pairing end', pairA.horizon, '2026-07-21');
eq('(a) 28-day before 78.0', w28(pairA).before, 78);
eq('(a) 28-day after 88.0 (+10 h, both days in the window)', w28(pairA).after, 88);
eq('(a) 28-day delta +10.0', w28(pairA).delta, 10);
eq('(a) 90-day gains the full 10 h too', pairA.rows.find(r => r.lim.days === 90).delta, 10);
eq('(a) 365-day gains the full 10 h too', pairA.rows.find(r => r.lim.days === 365).delta, 10);

// (b) A pairing longer than the 28-day window: only the hours that fit inside a
//     28-day span reach the 28-day total, while the 90- and 365-day windows (wide
//     enough to hold the whole pairing) gain ALL of it. Empty logbook + no
//     schedule isolates the pairing. Jul 14 → Aug 14 = 32 days, 32 h → 1 h/day.
w.eval("flights = []; localStorage.removeItem('cumulo_roster_forecast_v1');");
const pairB = model({ pairStart: '2026-07-14', pairEnd: '2026-08-14', pairHours: '32' });
eq('(b) pairing spans 32 days', pairB.pairing.count, 32);
eq('(b) 1.0 h on the first day', pairB.pairing.perByDate['2026-07-14'], 1);
eq('(b) 1.0 h on the last day', pairB.pairing.perByDate['2026-08-14'], 1);
eq('(b) 28-day window catches only the inside 28 h', w28(pairB).after, 28);
eq('(b) 28-day delta +28.0 (not the full 32)', w28(pairB).delta, 28);
eq('(b) 90-day window holds the whole pairing: 32 h', pairB.rows.find(r => r.lim.days === 90).after, 32);
eq('(b) 90-day delta +32.0', pairB.rows.find(r => r.lim.days === 90).delta, 32);
eq('(b) 365-day delta +32.0', pairB.rows.find(r => r.lim.days === 365).delta, 32);
fixture();

// (c) End before start is not rejected — a date range is the same set of days
//     either way — it is normalised (start ≤ end) and spread as usual.
const pairC = model({ pairStart: '2026-07-18', pairEnd: '2026-07-16', pairHours: '6' });
eq('(c) start normalised to the earlier date', pairC.pairing.start, '2026-07-16');
eq('(c) end normalised to the later date', pairC.pairing.end, '2026-07-18');
eq('(c) spans 3 days', pairC.pairing.count, 3);
eq('(c) same result as the correctly-ordered range',
  w28(pairC).delta, w28(model({ pairStart: '2026-07-16', pairEnd: '2026-07-18', pairHours: '6' })).delta);

// (c2) Nonsense pairings are ignored (never a fabricated flight), same honesty as
//      the single-flight hours parser: garbage / zero hours, a missing date, or a
//      span far too long to be a pairing (a two-day trip typed as two years).
eq('(c2) garbage hours → no pairing', model({ pairStart: '2026-07-16', pairEnd: '2026-07-18', pairHours: 'nope' }).pairing, null);
eq('(c2) zero hours → no pairing', model({ pairStart: '2026-07-16', pairEnd: '2026-07-18', pairHours: '0' }).pairing, null);
eq('(c2) missing end date → no pairing', model({ pairStart: '2026-07-16', pairEnd: '', pairHours: '6' }).pairing, null);
eq('(c2) absurdly long span → no pairing', model({ pairStart: '2026-07-16', pairEnd: '2028-07-18', pairHours: '6' }).pairing, null);

// (d) A swap AND a pairing combine into ONE net delta on the copy. Off PD3
//     (10 h), on a Jul 20–21 pairing of 12 h → net −10 + 12 = +2 h.
const pairD = model({ outKey: '2026-07-16|PD3', pairStart: '2026-07-20', pairEnd: '2026-07-21', pairHours: '12' });
eq('(d) the removed flight is still identified', pairD.removed.flightNum, 'PD3');
eq('(d) the pairing rides along', pairD.pairing.count, 2);
eq('(d) 28-day before 78.0', w28(pairD).before, 78);
eq('(d) 28-day after 80.0 (−10 removed + 12 pairing)', w28(pairD).after, 80);
eq('(d) 28-day net delta +2.0', w28(pairD).delta, 2);

// (e) The pairing simulation writes NOTHING — not the logbook, not the day-hours
//     map the engine hands out.
const flightsBeforeP = w.eval("JSON.stringify(flights)");
const combinedBeforeP = w.eval("JSON.stringify(_dutyDrillData(28,'2026-07-14').combined)");
w.eval("_dutySwapModel({pairStart:'2026-07-20', pairEnd:'2026-07-25', pairHours:'99'}, '2026-07-14');");
eq('(e) flights untouched by the pairing sim', w.eval("JSON.stringify(flights)"), flightsBeforeP);
eq('(e) engine day-hours map untouched by the pairing sim', w.eval("JSON.stringify(_dutyDrillData(28,'2026-07-14').combined)"), combinedBeforeP);

// The estimate + pay-page notes show only when a pairing is entered, and only
// the spread note for a real (≥2-day) range. FR keeps the &nbsp; before colons.
const pairFr = html({ pairStart: '2026-07-20', pairEnd: '2026-07-21', pairHours: '12' }, true);
has('(e) FR spread note names the day count', pairFr, 'Réparti également sur 2 jours (estimé).');
has('(e) FR pay pointer', pairFr, 'Effet sur la paie&nbsp;: voir la page Paie.');
const pairEn = html({ pairStart: '2026-07-20', pairEnd: '2026-07-21', pairHours: '12' }, false);
has('(e) EN spread note', pairEn, 'Spread evenly across 2 days (estimate).');
has('(e) EN pay pointer', pairEn, 'Pay impact: see the Pay page.');
// A single-day pairing has nothing to spread: pay pointer stays, spread note goes.
const pair1 = html({ pairStart: '2026-07-20', pairEnd: '2026-07-20', pairHours: '5' }, true);
not('(e) 1-day pairing drops the spread note', pair1, 'Réparti également');
has('(e) 1-day pairing keeps the pay pointer', pair1, 'voir la page Paie');
// No pairing at all → neither note (single-flight mode unchanged).
not('(e) no pairing → no pay pointer', html({ addDate: '2026-07-20', addHours: '5' }, true), 'voir la page Paie');
not('(e) no pairing → no spread note', html({ addDate: '2026-07-20', addHours: '5' }, true), 'Réparti également');
fixture();

// ── Render: the panel is collapsed, the select is pre-filled from the roster ──
// Far-future roster dates keep this independent of the day the test runs.
w.eval("localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ts:1, today:'2099-01-01', flights:[" +
  "{date:'2099-03-01', flightNum:'PD447', route:'YOW-YYZ', block:2.1, estimated:false}" +
"]}));");
w.eval("localStorage.setItem('cumulo_lang','fr'); renderDutySwap();");
const panel = w.document.getElementById('dutySwapPanel');
eq('panel exists', !!panel, true);
eq('panel is COLLAPSED by default', panel && panel.open, false);
has('panel title FR', panel.querySelector('.sw-title').textContent, 'Simuler un échange de vol');
has('panel subtitle FR', panel.querySelector('.sw-sub').textContent, 'Scheduling t’appelle ? Vois l’effet sur tes cumuls en dix secondes.');
const sel = w.document.getElementById('swap-out');
eq('select present with 1 flight + the "none" default', sel && sel.options.length, 2);
eq('default option = none (adding only)', sel.options[0].textContent, 'Aucun (ajout seulement)');
eq('option reads date · flight · route · block', sel.options[1].textContent, '1er mars · PD447 · YOW-YYZ · 2,1 h');
eq('option value = the stable key', sel.options[1].value, '2099-03-01|PD447');
eq('hours field is decimal, step 0.1', w.document.getElementById('swap-hrs').getAttribute('step'), '0.1');
eq('hours field carries the decimal keypad', w.document.getElementById('swap-hrs').getAttribute('inputmode'), 'decimal');
// The optional pairing group: two dates + a total, decimal keypad, blank by
// default (a pre-filled date would read as a pairing that isn't there).
has('pairing group is labelled FR', w.document.querySelector('#dutySwap .sw-group').textContent, 'Ajouter un pairing');
eq('pairing start field present', !!w.document.getElementById('pair-start'), true);
eq('pairing end field present', !!w.document.getElementById('pair-end'), true);
eq('pairing hours field is decimal, step 0.1', w.document.getElementById('pair-hrs').getAttribute('step'), '0.1');
eq('pairing hours field carries the decimal keypad', w.document.getElementById('pair-hrs').getAttribute('inputmode'), 'decimal');
eq('pairing dates blank by default (optional group)', w.document.getElementById('pair-start').value, '');
eq('answer repainted on render', w.document.getElementById('swapOut').innerHTML.indexOf('sw-lines') !== -1, true);

// Picking the removed flight pre-fills the added flight's date (same-day swap).
sel.value = '2099-03-01|PD447';
sel.onchange();
eq('picking a removed flight pre-fills the date', w.document.getElementById('swap-date').value, '2099-03-01');

// A re-render (page revisit, language toggle) must not wipe a call in progress.
w.document.getElementById('swap-hrs').value = '3.4';
w.document.getElementById('pair-start').value = '2099-03-05';
w.document.getElementById('pair-end').value = '2099-03-06';
w.document.getElementById('pair-hrs').value = '11.5';
panel.open = true;
w.eval("localStorage.setItem('cumulo_lang','en'); renderDutySwap();");
eq('open state survives a re-render', w.document.getElementById('dutySwapPanel').open, true);
eq('typed hours survive a re-render', w.document.getElementById('swap-hrs').value, '3.4');
eq('picked flight survives a re-render', w.document.getElementById('swap-out').value, '2099-03-01|PD447');
eq('date survives a re-render', w.document.getElementById('swap-date').value, '2099-03-01');
eq('pairing start survives a re-render', w.document.getElementById('pair-start').value, '2099-03-05');
eq('pairing end survives a re-render', w.document.getElementById('pair-end').value, '2099-03-06');
eq('pairing hours survive a re-render', w.document.getElementById('pair-hrs').value, '11.5');
has('re-render switched language', w.document.querySelector('.sw-title').textContent, 'Simulate a flight swap');
has('pairing group re-rendered in EN', w.document.querySelector('#dutySwap .sw-group').textContent, 'Add a pairing');

// No schedule → no select at all, and the honest line instead.
w.eval("localStorage.removeItem('cumulo_roster_forecast_v1'); localStorage.setItem('cumulo_lang','fr'); renderDutySwap();");
eq('no schedule → no select', !!w.document.getElementById('swap-out'), false);
has('no schedule → honest line', w.document.querySelector('#dutySwap .sw-none').textContent, 'Aucun horaire importé : entre seulement le vol ajouté.');
eq('no schedule → the added-flight fields stay', !!w.document.getElementById('swap-hrs'), true);

// ── House style: no em dash, no emoji in the rendered copy ───────────
fixture();
const allCopy = html({ outKey: '2026-07-16|PD3', addDate: '2026-07-16', addHours: '37.2' }, true) +
  html({ outKey: '2026-07-16|PD3', addDate: '2026-07-16', addHours: '37.2' }, false) +
  html({ pairStart: '2026-07-16', pairEnd: '2026-07-19', pairHours: '20' }, true) +
  html({ pairStart: '2026-07-16', pairEnd: '2026-07-19', pairHours: '20' }, false) +
  w.document.getElementById('dutySwap').innerHTML;
if (/—/.test(allCopy)) failures.push('rendered copy contains an em dash (—)');
if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(allCopy)) failures.push('rendered copy contains an emoji');

// ── Report ───────────────────────────────────────────────────────────
if (failures.length) {
  console.error('FAIL duty-sim.mjs');
  failures.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('PASS duty-sim.mjs');
process.exit(0);   // the loaded app keeps a setInterval alive; exit so the suite advances
