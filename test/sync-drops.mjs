// ═══════════════════════════════════════════════════════════════════
// THE SYNC MAY NOT CLAIM "ALREADY UP TO DATE" WHILE DROPPING LEGS
//
// Martin 2026-08-13: "mes vols dhier napairaisse pas meme sy je fais sync ca
// dit a jour mais non il me manque deux vols".
//
// A leg the mapper refused never reached the decision stage, so it appeared in
// no preview, no outstanding-legs note and no diagnostic — and the sync went on
// to announce "already up to date" with two of yesterday's flights missing.
// Three silent refusals existed: no block time in the feed, a deadhead marker,
// and a flight the pilot had deleted before (skipped by the resurrect guard).
//
// The rule these pin: the sync reports what it dropped, names why, and never
// claims the logbook is current when it refused something the roster published.
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
  w.eval(`
    localStorage.setItem('cumulo_navblue_url','https://feed');
    if (!document.getElementById('navblueDetails')) document.body.insertAdjacentHTML('beforeend','<div id="navblueDetails"></div>');
    window.__toasts = [];
    showToast = function(m, k){ window.__toasts.push((k||'info') + ': ' + m); };
    window.fetch = function(){ return Promise.resolve({ ok:true, status:200, text: function(){ return Promise.resolve(${JSON.stringify(ics)}); } }); };
    if (!window.__RealDate) {
      window.__RealDate = Date;
      var FIXED = new window.__RealDate('2026-08-13T15:00:00Z').getTime();
      function FakeDate(){ if(arguments.length===0) return new window.__RealDate(FIXED); return new (Function.prototype.bind.apply(window.__RealDate,[null].concat([].slice.call(arguments)))); }
      FakeDate.now=function(){return FIXED;}; FakeDate.parse=window.__RealDate.parse; FakeDate.UTC=window.__RealDate.UTC;
      FakeDate.prototype=window.__RealDate.prototype; Date=FakeDate;
    }
    ${seed || ''}
  `);
  await w.eval('syncNavblueNow({})');
  return {
    toasts: JSON.parse(w.eval('JSON.stringify(window.__toasts)')),
    panel: w.eval("document.getElementById('navblueDetails').textContent"),
    flights: w.eval('flights.length'),
    dropped: JSON.parse(w.eval("JSON.stringify((JSON.parse(localStorage.getItem('cumulo_navblue_debug_v1')||'{}').dropped)||[])")),
  };
}

const ev = (uid, dtstart, summary, desc) =>
  ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTART:' + dtstart, 'SUMMARY:' + summary, 'DESCRIPTION:' + desc, 'END:VEVENT'].join('\n');
const cal = (...events) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\n');

// ── Yesterday's two legs, published with no block time ──────────────────────
{
  const w = boot();
  const r = await runSync(w, cal(
    ev('a1', '20260812T120000Z', 'PD325 YOW-YLW', 'PD325 YOW - YLW\\nCI 1200Z / 0800L\\nSTD 1300Z / 0900L\\nDuration: 06:00\\nAircraft: 295 - C-GZQW'),
    ev('a2', '20260812T230000Z', 'PD326 YLW-YOW', 'PD326 YLW - YOW\\nCI 2300Z / 1600L\\nSTD 0020Z / 1720L\\nDuration: 05:00\\nAircraft: 295 - C-GKQA')
  ), 'flights = []; DB.save(flights);');

  const all = r.toasts.join(' | ');
  chk('it does not claim the logbook is up to date', all.indexOf('up to date') === -1);
  chk('it says how many legs it could not log', /2 legs/.test(all));
  chk('both legs are named on screen', r.panel.indexOf('PD325') !== -1 && r.panel.indexOf('PD326') !== -1);
  chk('it says WHY, in plain words', r.panel.indexOf('no block time') !== -1);
  chk('it still logs nothing unproven', r.flights === 0);
  chk('the drops reach the diagnostic record',
    r.dropped.length === 2 && r.dropped.every(d => d.reason === 'no-block' && d.date === '2026-08-12'));
}

// ── Nothing dropped: it may say up to date, and says what the feed held ──────
{
  const w = boot();
  const r = await runSync(w, cal(
    ev('c1', '20260810T120000Z', 'PD100 YOW-YYZ', 'PD100 YOW - YYZ\\nCI 1200Z / 0800L\\nSTD 1300Z / 0900L\\nDuration: 02:00, BLH: 01:00\\nAircraft: 295 - C-GZQW')
  ), `flights = [{ id:'x', date:'2026-08-10', flightNum:'PD100', route:'YOW-YYZ', block:1, total:1, reg:'C-GZQW',
                  dep_icao:'CYOW', arr_icao:'CYYZ', type:'E195-E2' }];
      DB.save(flights);`);
  chk('nothing was dropped on a clean feed', r.dropped.length === 0);
  chk('a clean sync still reports something', r.toasts.length > 0);
}

// The classifier itself: reporting only, and it must never mislabel.
{
  const w = boot();
  const why = e => w.eval('rosterEventDropReason(' + JSON.stringify(e) + ')');
  chk('a leg with no block time is named as such',
    why({ SUMMARY: 'PD325 YOW-YLW', DESCRIPTION: 'Duration: 06:00\nAircraft: 295' }) === 'no-block');
  chk('a deadhead is named as such',
    why({ SUMMARY: 'PD900 YOW-YYZ (D)', DESCRIPTION: 'Duration: 02:00, BLH: 01:00' }) === 'deadhead');
  chk('another airline is not his flying and is not reported',
    why({ SUMMARY: 'AC123 YOW-YYZ', DESCRIPTION: 'Duration: 02:00, BLH: 01:00' }) === '');
  chk('a usable leg is not reported as a drop',
    why({ SUMMARY: 'PD326 YLW-YOW', DESCRIPTION: 'Duration: 05:00, BLH: 04:30' }) === 'unknown');
}

// Both languages carry every string this path can show.
{
  const i18n = readFileSync(join(root, 'src/js/17-i18n.js'), 'utf8');
  ['toast.syncDropped', 'sync.drop.title', 'sync.drop.noBlock', 'sync.drop.deadhead',
   'sync.drop.noRoute', 'sync.drop.deletedBefore', 'sync.drop.unknown', 'sync.drop.more',
   'sync.drop.help', 'sync.feedSummary', 'sync.drop.unknownDate'].forEach(k => {
    chk(`both languages carry ${k}`, (i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "'", 'g')) || []).length === 2);
  });
}

// The silent paths this fixes must stay instrumented.
{
  const src = readFileSync(join(root, 'src/js/08-flight-form.js'), 'utf8');
  chk('the mapper refusal is recorded, not skipped', src.indexOf('const why = rosterEventDropReason(ev);') !== -1);
  chk('the deleted-before skip is recorded too', src.indexOf("reason: 'deleted-before'") !== -1);
  chk('the up-to-date claim is guarded by the drop list', src.indexOf('} else if (dropped.length > 0) {') !== -1);
}

if (failures.length) {
  console.error('sync-drops: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('sync-drops: all assertions passed (nothing is dropped in silence, and "up to date" cannot be claimed over a refused leg)');
process.exit(0);
