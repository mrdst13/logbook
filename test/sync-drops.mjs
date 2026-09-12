// ═══════════════════════════════════════════════════════════════════
// THE SYNC MAY NOT CLAIM THE LOGBOOK IS UP TO DATE WHEN IT IS NOT
//
// Martin 2026-08-13: "mes vols dhier napairaisse pas meme sy je fais sync ca
// dit a jour mais non il me manque deux vols" — then, after the first fix,
// 2026-09-12: "non ca fonctionne pas".
//
// Two distinct defects sat behind those two sentences.
//
// 1. SILENT REFUSALS. An event the mapper could not build (no block time in the
//    feed, a deadhead marker, no route) hit `if (!f || !f.date) continue` and
//    vanished before the decision stage — no preview, no outstanding-legs note,
//    no diagnostic. A flight he had deleted once was skipped by the resurrect
//    guard into a counter nothing read.
//
// 2. THE PANEL LIED WHILE THE TOAST TOLD THE TRUTH. The details panel was
//    written BEFORE the outstanding legs were counted and looked only at
//    fresh/merged, so it printed "Logbook is up to date" with flights still
//    waiting. The toast said the opposite and vanished; the panel stayed on
//    screen. The panel is what a pilot reads.
//
// FIXTURE RULE — the mistake that made this file pass for the wrong reason:
// a real Navblue DESCRIPTION is ONE ICS line whose newlines are escaped as \n
// (RFC 5545). A fixture built with REAL newlines splits into separate ICS lines
// and parseICS keeps only the first, silently discarding BLH, the times and the
// aircraft — so every leg looked like "no block time" no matter what the code
// did. Fixtures below use an EXPLICIT backslash, and the first assertion proves
// the fixture survived parsing before any behaviour is judged.
//
// Run:  node test/sync-drops.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

const BS = String.fromCharCode(92);   // one backslash, immune to any escaping
const NL = BS + 'n';                  // the two-character ICS newline escape

const ev = (uid, dtstart, summary, descParts) =>
  ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTART:' + dtstart, 'SUMMARY:' + summary,
   'DESCRIPTION:' + descParts.join(NL), 'END:VEVENT'].join('\n');
const cal = (...e) => ['BEGIN:VCALENDAR', ...e, 'END:VCALENDAR'].join('\n');

function boot() {
  const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
    runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
      if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
    },
  });
  return dom.window;
}

async function runSync(w, ics, seed) {
  w.__ics = ics;
  w.eval(`
    localStorage.clear();
    localStorage.setItem('cumulo_navblue_url','https://feed');
    if(!document.getElementById('navblueDetails')) document.body.insertAdjacentHTML('beforeend','<div id="navblueDetails"></div>');
    flights=[]; DB.save(flights);
    window.__toasts=[]; showToast=function(m,k){window.__toasts.push((k||'info')+': '+m);};
    showImportPreview=function(list,title){ window.__offered=(list||[]).length; };
    openRosterNotLoggedReview=function(){ window.__review=true; };
    window.fetch=function(){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve(window.__ics);}});};
    if(!window.__RealDate){window.__RealDate=Date;var F=new window.__RealDate('2026-09-12T15:00:00Z').getTime();
      function FD(){if(arguments.length===0)return new window.__RealDate(F);return new (Function.prototype.bind.apply(window.__RealDate,[null].concat([].slice.call(arguments))));}
      FD.now=function(){return F;};FD.parse=window.__RealDate.parse;FD.UTC=window.__RealDate.UTC;FD.prototype=window.__RealDate.prototype;Date=FD;}
    window.__offered=0; window.__review=false;
    ${seed || ''}
  `);
  const parsedDesc = w.eval('String((parseICS(window.__ics)[0]||{}).DESCRIPTION||"")');
  await w.eval('syncNavblueNow({})');
  return {
    parsedDesc,
    toasts: JSON.parse(w.eval('JSON.stringify(window.__toasts)')),
    panel: w.eval("document.getElementById('navblueDetails').textContent"),
    offered: w.eval('window.__offered'),
    review: w.eval('window.__review'),
    logged: w.eval('flights.length'),
    dropped: JSON.parse(w.eval("JSON.stringify((JSON.parse(localStorage.getItem('cumulo_navblue_debug_v1')||'{}').dropped)||[])")),
  };
}

// ── A. Yesterday's two legs, published with NO block time ───────────────────
{
  const w = boot();
  const r = await runSync(w, cal(
    ev('a1', '20260911T120000Z', 'PD325 YOW-YLW',
       ['PD325 YOW - YLW', 'CI 1200Z / 0800L', 'STD 1300Z / 0900L', 'Duration: 06:00', 'Aircraft: 295 - C-GZQW']),
    ev('a2', '20260911T230000Z', 'PD326 YLW-YOW',
       ['PD326 YLW - YOW', 'CI 2300Z / 1900L', 'STD 2350Z / 1950L', 'Duration: 05:00', 'Aircraft: 295 - C-GKQA'])
  ));
  // Fixture sanity FIRST: the whole description must survive parsing, or the
  // rest of this block proves nothing (this is the bug that made it pass once).
  chk('A fixture survives ICS parsing intact', r.parsedDesc.indexOf('Aircraft: 295') !== -1);
  chk('A fixture genuinely carries no BLH', r.parsedDesc.indexOf('BLH') === -1);

  const all = r.toasts.join(' | ');
  chk('A no toast claims the logbook is up to date', all.indexOf('up to date') === -1);
  chk('A the panel does not claim up to date either', r.panel.indexOf('up to date') === -1);
  chk('A it says how many legs could not be logged', /2 legs/.test(all));
  chk('A both legs are named on screen', r.panel.indexOf('PD325') !== -1 && r.panel.indexOf('PD326') !== -1);
  chk('A it says why, in plain words', r.panel.indexOf('no block time') !== -1);
  chk('A nothing unproven is logged', r.logged === 0);
  chk('A the drops reach the diagnostic record',
    r.dropped.length === 2 && r.dropped.every(d => d.reason === 'no-block' && d.date === '2026-09-11'));
}

// ── B. Same two legs WITH block time: offered, and the panel says so ────────
{
  const w = boot();
  const r = await runSync(w, cal(
    ev('b1', '20260911T120000Z', 'PD325 YOW-YLW',
       ['PD325 YOW - YLW', 'CI 1200Z / 0800L', 'STD 1300Z / 0900L', 'Duration: 06:00, BLH: 05:00', 'Aircraft: 295 - C-GZQW']),
    ev('b2', '20260911T230000Z', 'PD326 YLW-YOW',
       ['PD326 YLW - YOW', 'CI 2300Z / 1900L', 'STD 2350Z / 1950L', 'Duration: 05:00, BLH: 04:30', 'Aircraft: 295 - C-GKQA'])
  ));
  chk('B fixture carries BLH through parsing', r.parsedDesc.indexOf('BLH: 05:00') !== -1);
  chk('B the mapper accepts a published block time', r.offered === 2);
  chk('B nothing is dropped', r.dropped.length === 0);
  // Import writes on confirmation only, so they are WAITING, not logged — and
  // the panel must say that rather than "up to date".
  chk('B the panel does not claim up to date', r.panel.indexOf('up to date') === -1);
  chk('B the panel says they are waiting', /waiting to be added/.test(r.panel));
  chk('B nothing is written without confirmation', r.logged === 0);
}

// ── C. A leg flown TODAY the feed cannot prove: waiting, never "up to date" ─
{
  const w = boot();
  const r = await runSync(w, cal(
    ev('c1', '20260912T090000Z', 'PD777 YOW-YYZ',
       ['PD777 YOW - YYZ', 'CI 0900Z / 0500L', 'STD 1000Z / 0600L', 'Duration: 02:00, BLH: 01:00', 'Aircraft: 295 - C-GZQW'])
  ));
  chk('C the review is opened for the pilot', r.review === true);
  chk('C the panel does not claim up to date', r.panel.indexOf('up to date') === -1);
  chk('C the panel says a flight is waiting', /waiting to be added/.test(r.panel));
  chk('C an unproven leg is still not logged', r.logged === 0);
}

// ── D. A clean feed may still say up to date ────────────────────────────────
// The fix must not simply invert the lie: when the logbook really is current,
// the panel has to be allowed to say so.
{
  const w = boot();
  const r = await runSync(w, cal(
    ev('d1', '20260901T120000Z', 'PD100 YOW-YYZ',
       ['PD100 YOW - YYZ', 'STD 1300Z / 0900L', 'Duration: 02:00, BLH: 01:00', 'Aircraft: 295 - C-GZQW'])
  ), `flights = [{ id:'x', date:'2026-09-01', flightNum:'PD100', route:'YOW-YYZ', block:1, total:1,
                  reg:'C-GZQW', dep_icao:'CYOW', arr_icao:'CYYZ', type:'E195-E2', night:0, xcDayCop:0,
                  atd_utc:'1300', ata_utc:'1400', dtstart_utc:'2026-09-01T13:00:00.000Z' }];
      DB.save(flights);`);
  chk('D a leg already logged is not offered again', r.offered === 0);
  chk('D nothing is dropped on a clean feed', r.dropped.length === 0);
  chk('D no false "waiting" line appears', !/waiting to be added/.test(r.panel));
  chk('D the flight stays in the logbook', r.logged === 1);
}

// ── The classifier: reporting only, and it must never mislabel ──────────────
{
  const w = boot();
  const why = e => w.eval('rosterEventDropReason(' + JSON.stringify(e) + ')');
  chk('a leg with no block time is named as such',
    why({ SUMMARY: 'PD325 YOW-YLW', DESCRIPTION: 'Duration: 06:00 Aircraft: 295' }) === 'no-block');
  chk('a deadhead is named as such',
    why({ SUMMARY: 'PD900 YOW-YYZ (D)', DESCRIPTION: 'Duration: 02:00, BLH: 01:00' }) === 'deadhead');
  chk('another airline is not his flying and is not reported',
    why({ SUMMARY: 'AC123 YOW-YYZ', DESCRIPTION: 'Duration: 02:00, BLH: 01:00' }) === '');
  chk('a usable leg is not reported as a drop',
    why({ SUMMARY: 'PD326 YLW-YOW', DESCRIPTION: 'Duration: 05:00, BLH: 04:30' }) === 'unknown');
}

// ── The code paths these rest on must stay instrumented ─────────────────────
{
  const src = readFileSync(join(root, 'src/js/08-flight-form.js'), 'utf8');
  chk('the mapper refusal is recorded, not skipped', src.indexOf('const why = rosterEventDropReason(ev);') !== -1);
  chk('the deleted-before skip is recorded too', src.indexOf("reason: 'deleted-before'") !== -1);
  chk('the up-to-date TOAST is guarded by the drop list', src.indexOf('} else if (dropped.length > 0) {') !== -1);
  chk('the up-to-date PANEL is guarded by both drops and outstanding',
    src.indexOf("detailLines.push(t('sync.detail.dropped'") !== -1 &&
    src.indexOf("detailLines.push(t('sync.detail.waiting'") !== -1);
  // Ordering is the whole defect: counted after the panel, it could not be used.
  chk('outstanding legs are counted BEFORE the panel is written',
    src.indexOf('outstanding = (typeof _dashRosterLegsNotLogged') < src.indexOf("details.style.display = 'block'"));
}

// ── Both languages carry every string this path can show ────────────────────
{
  const i18n = readFileSync(join(root, 'src/js/17-i18n.js'), 'utf8');
  ['toast.syncDropped', 'sync.drop.title', 'sync.drop.noBlock', 'sync.drop.deadhead',
   'sync.drop.noRoute', 'sync.drop.deletedBefore', 'sync.drop.unknown', 'sync.drop.more',
   'sync.drop.help', 'sync.feedSummary', 'sync.drop.unknownDate',
   'sync.detail.waiting', 'sync.detail.dropped'].forEach(k => {
    chk(`both languages carry ${k}`, (i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "'", 'g')) || []).length === 2);
  });
}

if (failures.length) {
  console.error('sync-drops: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('sync-drops: all assertions passed (nothing dropped in silence; neither toast nor panel can claim "up to date" over a waiting or refused leg; a clean sync still can)');
process.exit(0);
