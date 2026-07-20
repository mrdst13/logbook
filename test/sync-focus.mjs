// ═══════════════════════════════════════════════════════════════════
// PULL-ON-FOREGROUND (focus/visibility) TEST
//
// Bug (Martin 2026-07-18): "le sync est pas parfait encore je dois ouvrir sur
// mon portable en premier pour voir les changements sur mon cell." PUSH rides
// on every local save (auto-sync debounce), but PULL only ran at cold load /
// sign-in — so a device left OPEN in the background (an iOS Safari tab) never
// picked up the OTHER device's new flights until a full reload.
//
// Fix: Sync.pullOnForeground(), wired in 99-init.js on visibilitychange→visible
// and window 'focus'. It drains the offline queue THEN pulls (so an un-pushed
// local edit reaches the cloud before we pull, never the reverse), then
// re-renders. Guards: no-op unless signed in AND online; single-flight; 10 s
// throttle.
//
// Drives the REAL Sync module + the REAL 99-init.js event wiring against a
// mocked Supabase client and proves:
//   (a) an un-pushed local edit is NOT overwritten by a focus-pull that carries
//       an OLDER remote version of the same flight (LWW holds);
//   (b) a flight added on another device APPEARS after a real focus event
//       (this is the assertion that FAILS on the old code — no pull on focus);
//   (c) the 10 s throttle blocks a 2nd pull;
//   (d) offline (navigator.onLine=false) makes ZERO network calls;
//   (e) not authenticated is a no-op;
//   (f) two concurrent foreground events pull at most once (single-flight).
//
// Run:  node test/sync-focus.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Allow pointing the test at an alternate bundle so we can prove it FAILS on the
// pre-fix code:  LOGBOOK_BUNDLE=/path/to/logbook.OLD.html node test/sync-focus.mjs
const bundlePath = process.env.LOGBOOK_BUNDLE || join(root, 'logbook.html');
const dom = new JSDOM(readFileSync(bundlePath, 'utf8'), {
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

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 15) => { for (let i = 0; i < n; i++) await tick(); };

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';

// ── Mocked Supabase client that counts network calls and serves __pullData ──
w.eval(`
  window.__pullData = [];
  window.__net = { select: 0, upsert: 0, update: 0 };
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = {
    from: () => ({
      upsert: async () => { window.__net.upsert++; return { error: null }; },
      select: async () => { window.__net.select++; return { data: window.__pullData, error: null }; },
      update: () => ({ eq: async () => { window.__net.update++; return { error: null }; } }),
    }),
  };
`);

const net = () => JSON.parse(w.eval('JSON.stringify(window.__net)'));
const hasFlight = (id) => w.eval(`flights.some(f => f.id === '${id}')`);
const flightById = (id) => JSON.parse(w.eval(`JSON.stringify(flights.find(f => f.id === '${id}') || null)`));
const setPull = (rows) => w.eval(`window.__pullData = ${JSON.stringify(rows)};`);
const setFlights = (arr) => w.eval(`flights = ${JSON.stringify(arr)};`);
const clearState = () => w.eval(`
  localStorage.removeItem('cumulo_synced_sig_v1');
  localStorage.removeItem('cumulo_pending_ops_v1');
  if (typeof Sync !== 'undefined') { Sync._lastForegroundPullAt = 0; Sync._foregroundPullInFlight = false; }
  window.__net = { select: 0, upsert: 0, update: 0 };
`);
// Old code has no pullOnForeground — resolve to a sentinel instead of throwing,
// so the pre-fix run produces clean chk failures (flight absent) rather than a
// crash. On the fixed code this just calls the method.
const callPull = (reason) => w.eval(
  `(typeof Sync !== 'undefined' && typeof Sync.pullOnForeground === 'function')`
  + ` ? Sync.pullOnForeground(${JSON.stringify(reason)}) : Promise.resolve('NO_METHOD')`
);

const XrowFull = { id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ', user_id: 'user-1', updated_at: '2026-01-01T00:00:00Z' };
const YrowFull = { id: Y, date: '2026-01-02', block: 2, total: 2, route: 'YYZ-YUL', user_id: 'user-1', updated_at: '2026-01-02T00:00:00Z' };

// ── (e) Not authenticated → complete no-op (no network, no adoption) ──
clearState();
setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
setPull([XrowFull, YrowFull]);
w.eval('Auth.isAuthenticated = () => false;');
await callPull('focus');
await settle(4);
chk('(e) unauth: no network call', net().select === 0 && net().upsert === 0 && net().update === 0);
chk('(e) unauth: remote flight NOT adopted', !hasFlight(Y));
w.eval('Auth.isAuthenticated = () => true;');

// ── (d) Offline (navigator.onLine=false) → ZERO network calls ──
clearState();
setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
setPull([XrowFull, YrowFull]);
let onlineOverridable = true;
try { w.eval(`Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });`); }
catch (e) { onlineOverridable = false; }
if (onlineOverridable) {
  chk('(d) offline: navigator.onLine reads false', w.eval('navigator.onLine') === false);
  await callPull('focus');
  await settle(4);
  chk('(d) offline: zero network calls', net().select === 0 && net().upsert === 0);
  chk('(d) offline: remote flight NOT adopted', !hasFlight(Y));
  // Restore online for the remaining scenarios.
  w.eval(`Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });`);
} else {
  // jsdom build without a configurable navigator.onLine — skip rather than lie.
  chk('(d) offline: navigator.onLine overridable (skipped — not configurable in this jsdom)', true);
}

// ── (b) A flight added on another device APPEARS after a REAL focus event ──
//     This exercises the 99-init.js window 'focus' wiring end-to-end. On the
//     OLD code there is no such wiring, so Y never appears → this fails.
clearState();
setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
setPull([XrowFull, YrowFull]);
chk('(b) precondition: remote-added flight not yet local', !hasFlight(Y));
w.eval('window.dispatchEvent(new Event("focus"));');
await settle();
chk('(b) FOCUS EVENT pulls: remote-added flight now appears locally', hasFlight(Y));
chk('(b) focus event actually hit the network', net().select >= 1);

// ── (b2) Same via visibilitychange→visible (best-effort: needs visible state) ──
clearState();
setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
setPull([XrowFull, YrowFull]);
let visForced = true;
try { w.eval(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });`); }
catch (e) { visForced = false; }
if (visForced && w.eval("document.visibilityState") === 'visible') {
  w.eval('document.dispatchEvent(new Event("visibilitychange"));');
  await settle();
  chk('(b2) VISIBILITYCHANGE→visible pulls: remote-added flight appears', hasFlight(Y));
} else {
  chk('(b2) visibilitychange (skipped — visibilityState not forceable in this jsdom)', true);
}

// ── (a) Un-pushed local EDIT is NOT overwritten by an OLDER remote row ──
//     Local X edited to block 2.0 (marker 2026-06); remote still holds block 1.0
//     stamped 2026-05 (older). A focus-pull must keep the local edit (LWW).
clearState();
setFlights([{ id: X, date: '2026-01-01', block: 2.0, total: 2.0, route: 'YOW-YYZ', _updated_at: '2026-06-01T00:00:00Z' }]);
setPull([{ id: X, date: '2026-01-01', block: 1.0, total: 1.0, route: 'YOW-YYZ', user_id: 'user-1', updated_at: '2026-05-01T00:00:00Z', client_updated_at: '2026-05-01T00:00:00Z' }]);
await callPull('focus');
await settle();
chk('(a) older remote does NOT overwrite the un-pushed local edit (block stays 2.0)', flightById(X) && flightById(X).block === 2.0);
chk('(a) local route preserved', flightById(X) && flightById(X).route === 'YOW-YYZ');

// ── (c) Throttle: a 2nd pull within 10 s is blocked (no network) ──
clearState();
setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
setPull([XrowFull, YrowFull]);
await callPull('focus');           // 1st pull: hits network, adopts Y
await settle();
chk('(c) first pull hit the network', net().select >= 1);
chk('(c) first pull adopted the remote flight', hasFlight(Y));
w.eval('window.__net = { select: 0, upsert: 0, update: 0 };');  // reset counters, KEEP throttle timestamp
await callPull('focus');           // 2nd pull immediately after: must be throttled
await settle(4);
chk('(c) throttle blocks the 2nd pull within 10 s (no network)', net().select === 0);

// ── (g) A DEBOUNCED local edit (pending auto-sync timer, NOT yet in the queue)
//        is flushed to the cloud BEFORE the focus-pull, so a newer remote row
//        can't win LWW over an edit that never got its chance to push. ──
if (w.eval("typeof Sync !== 'undefined' && typeof Sync.pullOnForeground === 'function'")) {
  clearState();
  setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
  setPull([]);                       // remote has nothing new
  w.eval('Sync._autoSyncTimer = setTimeout(function(){}, 100000);');  // simulate a pending debounced push
  await callPull('focus');
  await settle();
  chk('(g) pending debounce is flushed before pull (dirty flight pushed)', net().upsert >= 1);
  chk('(g) the pending auto-sync timer was cleared (fired early, not left dangling)', w.eval('Sync._autoSyncTimer === null'));
} else {
  chk('(g) debounce-flush: Sync.pullOnForeground exists', false);
}

// ── (f) Single-flight: two concurrent foreground events pull at most once ──
//     Make select() hang, fire two pulls back-to-back, prove only one select
//     started and the 2nd call was dropped by the in-flight guard.
const hasMethod = w.eval("typeof Sync !== 'undefined' && typeof Sync.pullOnForeground === 'function'");
if (!hasMethod) {
  // Pre-fix code: the feature does not exist at all.
  chk('(f) single-flight: Sync.pullOnForeground exists', false);
} else {
  clearState();
  setFlights([{ id: X, date: '2026-01-01', block: 1, total: 1, route: 'YOW-YYZ' }]);
  w.eval(`
    window.__release = null;
    window.__pullData = [];
    Auth.client.from = () => ({
      upsert: async () => { window.__net.upsert++; return { error: null }; },
      select: () => { window.__net.select++; return new Promise(res => { window.__release = () => res({ data: window.__pullData, error: null }); }); },
      update: () => ({ eq: async () => { window.__net.update++; return { error: null }; } }),
    });
    window.__p1 = Sync.pullOnForeground('focus');   // starts, hangs on select
    window.__p2 = Sync.pullOnForeground('focus');   // in-flight guard should drop this
  `);
  await settle(4);                    // let p1 advance past drainQueue into select (which hangs)
  chk('(f) single-flight: only one select started while a pull is in progress', net().select === 1);
  w.eval('window.__release && window.__release();');
  await Promise.resolve(w.eval('window.__p1'));
  await Promise.resolve(w.eval('window.__p2'));
  await settle();
  chk('(f) single-flight: still only one select after both settle (2nd dropped)', net().select === 1);
}

if (failures.length) {
  console.error(`\n✗ sync-focus test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ sync-focus test passed — foreground pull drains-then-pulls, throttled + single-flight, never clobbers a local edit, no-ops when offline/unauth');
process.exit(0);
