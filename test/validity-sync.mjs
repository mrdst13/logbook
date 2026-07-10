// ═══════════════════════════════════════════════════════════════════
// CUSTOM-VALIDITY CROSS-DEVICE SYNC TEST
//
// 2026-07-09: after the opening_balances fix, the paper-logbook total synced
// but Martin's CUSTOM validities (Passport / RAIC / Line check) still didn't
// reach his iPhone. Two causes, both fixed and proven here:
//   1. pushProfile only fires on a profile EDIT, never on load — so validities
//      set on the computer before the column existed were never re-uploaded.
//      Fix: Sync.pushCustomValiditiesIfAny() runs on every launch, upserting
//      ONLY id + custom_validities/personal_goal_bf when this device has them.
//   2. pushProfile sent custom_validities:[] for a device with none, which on
//      upsert BLANKED the copy a device WITH them had uploaded. Fix: omit the
//      column entirely when empty (upsert leaves omitted columns untouched).
//
// Drives the REAL Sync module against an in-memory Supabase mock whose upsert
// MERGES provided columns (models PostgREST ON CONFLICT DO UPDATE SET) and
// proves: targeted push uploads only its columns; an empty device never wipes
// the cloud copy; an empty device pulls and adopts (union-by-name) the cloud
// validities.
//
// Run:  node test/validity-sync.mjs   (also part of `npm test`)
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
const PKEY = w.eval('DB.profileKey');

// Cloud mock: upsert MERGES only the columns present in the payload (like a
// real ON CONFLICT DO UPDATE SET col=EXCLUDED.col), so omitting a column
// preserves whatever is already stored.
w.eval(`
  window.__cloud = { profiles: [] };
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = { from: (table) => ({
    upsert: async (row) => {
      const arr = window.__cloud[table] || (window.__cloud[table] = []);
      const kf = row.id !== undefined ? 'id' : 'user_id';
      const i = arr.findIndex(r => r[kf] === row[kf]);
      if (i >= 0) arr[i] = Object.assign({}, arr[i], row); else arr.push(Object.assign({}, row));
      return { error: null };
    },
    select: () => {
      const data = window.__cloud[table] || [];
      const pr = Promise.resolve({ data, error: null });
      pr.eq = (col, val) => Promise.resolve({ data: data.filter(r => r[col] === val), error: null });
      return pr;
    },
  }) };
  Sync._suppressAutoSync = true;  // don't let DB.saveProfile re-trigger pushes
`);

const cloudProfile = () => w.eval('window.__cloud.profiles[0] || null');
const setLocalProfile = (obj) => w.localStorage.setItem(PKEY, JSON.stringify(obj));
const getLocalProfile = () => JSON.parse(w.localStorage.getItem(PKEY) || '{}');

// ── 1. Device A HAS validities → targeted push uploads ONLY that column ──
setLocalProfile({ fname: 'A', customValidities: [{ id: 'cv1', name: 'Passport', expiry: '2030-01-01' }] });
await w.eval('Sync.pushCustomValiditiesIfAny()');
let cp = cloudProfile();
chk('targeted push uploads custom_validities',
  cp && Array.isArray(cp.custom_validities) && cp.custom_validities.length === 1 && cp.custom_validities[0].name === 'Passport');
chk('targeted push touches only id + custom_validities (no other profile columns)',
  cp && cp.id === 'user-1' && cp.fname === undefined && cp.medical === undefined);

// ── 2. An EMPTY device's pushProfile must NOT wipe the cloud validities ──
await w.eval('Sync.pushProfile({ fname: "B" })');   // no customValidities on this device
cp = cloudProfile();
chk('empty-device pushProfile preserves cloud validities (omits column, never sends [])',
  cp && Array.isArray(cp.custom_validities) && cp.custom_validities.length === 1);

// ── 3. Empty device PULLS → adopts (union-by-name) the cloud validities ──
setLocalProfile({ fname: 'B' });                    // local has none
await w.eval('Sync.pullProfile()');
let lp = getLocalProfile();
chk('empty device pulls & merges the cloud validities',
  Array.isArray(lp.customValidities) && lp.customValidities.some(v => v.name === 'Passport'));

// ── 4. Empty device's targeted push is a NO-OP (never blanks the cloud) ──
w.eval(`window.__cloud.profiles = [{ id: 'user-1', custom_validities: [{ id: 'cv1', name: 'Passport' }] }];`);
setLocalProfile({ fname: 'C' });                    // still no validities
await w.eval('Sync.pushCustomValiditiesIfAny()');
cp = cloudProfile();
chk('empty device never blanks cloud validities (targeted push no-ops)',
  cp && Array.isArray(cp.custom_validities) && cp.custom_validities.length === 1);

if (failures.length) {
  console.error(`\n✗ validity sync test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ validity sync passed — targeted push propagates validities; empty device never wipes; pull merges by name');
process.exit(0);
