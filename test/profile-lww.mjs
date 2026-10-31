// ═══════════════════════════════════════════════════════════════════
// THE PROFILE MUST RECONCILE ACROSS DEVICES, NOT DIVERGE FOREVER
//
// Martin 2026-10-26: "pourquoi sur mon iphone ca dit pas ppc expired mais sur
// le portable oui ?"
//
// Because every pilot-entered profile field was FILL-EMPTY-ONLY on pull:
//
//     if (!isBlank(remoteVal) && isBlank(local[localKey])) { ... }
//
// Once both devices held a value, neither could ever correct the other. His
// laptop reported the PPC expired, his phone showed nothing, and no amount of
// syncing could resolve it — on a currency tracker, the two devices disagreeing
// about a check date is the worst possible failure. The same held for his
// medical, his ECG, his booklet and his licence.
//
// Flights have always been last-write-wins on updated_at. The profile now
// follows the same rule: profiles.updated_at is maintained by a database
// trigger on every write, and DB.saveProfile stamps profileUpdatedAt locally,
// so the two sides are comparable.
//
// The guarantees pinned here, in order of how badly they would hurt:
//   - an edit the pilot just made is NEVER replaced by an older cloud value
//   - when neither side can be dated, nothing is clobbered (old behaviour)
//   - adopting a certifiable date is never silent
//   - identical content writes nothing, so two devices cannot echo forever
//
// Drives the REAL Sync module against an in-memory Supabase mock.
//
// Run:  node test/profile-lww.mjs   (also part of `npm test`)
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

w.eval(`
  window.__cloud = { profiles: [] };
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = { from: (table) => ({
    upsert: async (row) => {
      const arr = window.__cloud[table] || (window.__cloud[table] = []);
      const i = arr.findIndex(r => r.id === row.id);
      if (i >= 0) arr[i] = Object.assign({}, arr[i], row); else arr.push(Object.assign({}, row));
      window.__pushCount = (window.__pushCount || 0) + 1;
      return { error: null };
    },
    select: () => {
      const data = window.__cloud[table] || [];
      const pr = Promise.resolve({ data, error: null });
      pr.eq = (col, val) => Promise.resolve({ data: data.filter(r => r[col] === val), error: null });
      return pr;
    },
  }) };
  Sync._suppressAutoSync = true;
  window.__toasts = [];
  showToast = function (m) { window.__toasts.push(String(m)); };
  syncNavblueAuto = function () {};
`);

const OLD = '2026-09-01T10:00:00.000Z';
const NEW = '2026-10-20T10:00:00.000Z';

const setup = (localProfile, cloudRow) => {
  w.eval(`
    window.__toasts = []; window.__pushCount = 0;
    localStorage.setItem(DB.profileKey, ${JSON.stringify(JSON.stringify(localProfile))});
    window.__cloud.profiles = ${JSON.stringify(cloudRow ? [cloudRow] : [])};
  `);
};
const profile = () => JSON.parse(w.eval('JSON.stringify(DB.loadProfile())'));
const toasts = () => JSON.parse(w.eval('JSON.stringify(window.__toasts)')).join(' | ');
const pushes = () => w.eval('window.__pushCount || 0');

// ── 1. His exact case: the other device holds a newer PPC date ──────────────
{
  setup({ ppcDueDate: '2027-03-31', profileUpdatedAt: OLD },
        { id: 'user-1', ppc_due_date: '2026-10-15', updated_at: NEW });
  await w.eval('Sync.pullProfile()');
  const p = profile();
  chk('1 the newer cloud PPC date is adopted', p.ppcDueDate === '2026-10-15');
  chk('1 the device records the age of what it adopted', p.profileUpdatedAt === NEW);
  chk('1 adopting a certifiable date is not silent', /PPC/.test(toasts()));
}

// ── 2. The edit he JUST made is never replaced by an older cloud value ──────
// This is the one that must never regress: losing a value he typed seconds ago
// would be far worse than the divergence this whole change is fixing.
{
  setup({ ppcDueDate: '2027-03-31', profileUpdatedAt: NEW },
        { id: 'user-1', ppc_due_date: '2026-10-15', updated_at: OLD });
  await w.eval('Sync.pullProfile()');
  const p = profile();
  chk('2 a fresh local edit survives an older cloud row', p.ppcDueDate === '2027-03-31');
  chk('2 nothing is announced when nothing was adopted', !/PPC/.test(toasts()));
  chk('2 the newer device pushes so the other can catch up', pushes() > 0);
}

// ── 3. Identical content: no write, no echo between two devices ─────────────
{
  setup({ ppcDueDate: '2027-03-31', profileUpdatedAt: OLD },
        { id: 'user-1', ppc_due_date: '2027-03-31', updated_at: NEW });
  await w.eval('Sync.pullProfile()');
  chk('3 an identical value is left alone', profile().ppcDueDate === '2027-03-31');
  chk('3 identical content announces nothing', !/PPC/.test(toasts()));
  chk('3 identical content does not push back', pushes() === 0);
}

// ── 4. A blank device still gets filled, exactly as before ──────────────────
{
  setup({ profileUpdatedAt: NEW },
        { id: 'user-1', ppc_due_date: '2026-10-15', updated_at: OLD });
  await w.eval('Sync.pullProfile()');
  chk('4 a blank field is filled even from an older row', profile().ppcDueDate === '2026-10-15');
}

// ── 5. Undatable: fall back to fill-empty, never clobber ────────────────────
// A profile saved before this change carries no stamp, and a cloud row could
// lack updated_at. With nothing to compare, the old conservative rule holds.
{
  setup({ ppcDueDate: '2027-03-31' }, { id: 'user-1', ppc_due_date: '2026-10-15' });
  await w.eval('Sync.pullProfile()');
  chk('5 with no timestamps on either side, the local value stands',
    profile().ppcDueDate === '2027-03-31');
}

// ── 6. The other dates a pilot is judged on behave the same way ─────────────
{
  setup({ medical: '2027-05-31', ecg: '2027-01-31', bookletExpiry: '2028-02-28',
          license: 'AA000000', profileUpdatedAt: OLD },
        { id: 'user-1', medical: '2026-11-30', ecg: '2026-12-31',
          booklet_expiry: '2027-06-30', license: 'AA914724', updated_at: NEW });
  await w.eval('Sync.pullProfile()');
  const p = profile();
  chk('6 medical arbitrates', p.medical === '2026-11-30');
  chk('6 ECG arbitrates', p.ecg === '2026-12-31');
  chk('6 booklet arbitrates', p.bookletExpiry === '2027-06-30');
  chk('6 licence arbitrates', p.license === 'AA914724');
  const t = toasts();
  chk('6 every adopted date is named', /medical/.test(t) && /ECG/.test(t) && /booklet/.test(t));
}

// ── 7. A local save stamps itself, so the next pull can be judged ───────────
{
  setup({ ppcDueDate: '2027-03-31', profileUpdatedAt: OLD }, null);
  w.eval("DB.saveProfile(Object.assign({}, DB.loadProfile(), { ppcDueDate: '2028-01-31' }))");
  const p = profile();
  chk('7 an edit re-stamps even when the old stamp was spread in',
    p.profileUpdatedAt !== OLD && !!p.profileUpdatedAt);
  chk('7 the edit itself is stored', p.ppcDueDate === '2028-01-31');
}

// ── 8. The source keeps the guarantees these rest on ────────────────────────
{
  const sync = readFileSync(join(root, 'src/js/19-sync.js'), 'utf8');
  const core = readFileSync(join(root, 'src/js/00-core.js'), 'utf8');
  chk('8 the PPC date is no longer fill-empty-only',
    sync.indexOf("fillStr('ppcDueDate'") === -1 && sync.indexOf("syncStr('ppcDueDate'") !== -1);
  chk('8 adoption requires the cloud to be strictly newer',
    sync.indexOf('_cloudNewer') !== -1 && sync.indexOf('_cloudTs > _localTs') !== -1);
  chk('8 saves are stamped', core.indexOf('profileUpdatedAt = new Date().toISOString()') !== -1);
}

if (failures.length) {
  console.error('profile-lww: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('profile-lww: all assertions passed (newer side wins, a fresh edit is never lost, undatable never clobbers, adoption is announced, identical content never echoes)');
process.exit(0);
