// ═══════════════════════════════════════════════════════════════════
// ACCEPTANCE STAMP TEST
//
// 2026-08-01, Martin, on the dashboard's "Declaration sealed and verified"
// card: "ça enlève ça aussi, c'est fatigant […] tout ce que je veux c'est un
// timestamp et mes initiales après que j'ai accepté un changement dans le
// logbook."
//
// So: the standing card is gone, and every row the pilot knowingly accepts
// carries acceptedAt + acceptedBy instead. This pins the parts that are easy to
// get wrong:
//   - the stamp is written by the paths the pilot actually confirms, and by
//     nothing else (a cloud pull must not mint a local acceptance);
//   - initials come from the profile and are NEVER invented;
//   - it is NOT signedBy/signedAt — those mean a formal attestation and the
//     day/night recheck refuses to touch a row carrying them, so reusing them
//     would have frozen the logbook against its own repair tools;
//   - a database without the new columns keeps syncing everything else.
//
// Run:  node test/accepted-stamp.mjs   (also part of `npm test`)
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
const PKEY = w.eval('DB.profileKey');
// A real UUID: localFlightToRow mints a fresh id for any row that lacks one.
const F1 = '11111111-1111-4111-8111-111111111111';

w.eval(`
  showToast = function () {};
  window.confirm = () => true;
`);

// ── 1. The signature comes from the profile, and is never invented ──────
//     ONE spelling everywhere (Martin 2026-08-12: "defois tu met self defois
//     m.d defois m.daoust, je veux toujours m.daoust").
w.localStorage.setItem(PKEY, JSON.stringify({ fname: 'Martin', lname: 'Daoust' }));
chk('the signature is built from the profile name', w.eval('pilotShortName()') === 'M.Daoust');
chk('a profile with no name yields no signature, never a guess',
  w.eval("pilotShortName({ fname: '', lname: '' })") === '');
chk('a half-filled name yields what is actually known',
  w.eval("pilotShortName({ fname: 'Martin', lname: '' })") === 'Martin');

// Whatever spelling a row carries, the owner reads one way — and a third
// party is never rewritten into it.
const MP = "{ fname: 'Martin', lname: 'Daoust' }";
chk('"self" reads as the owner', w.eval(`displayCrewName('self', ${MP})`) === 'M.Daoust');
chk('"moi" reads as the owner', w.eval(`displayCrewName('moi', ${MP})`) === 'M.Daoust');
chk('the full name reads as the owner', w.eval(`displayCrewName('Martin Daoust', ${MP})`) === 'M.Daoust');
chk('a spaced initial reads as the owner', w.eval(`displayCrewName('M. Daoust', ${MP})`) === 'M.Daoust');
chk('another pilot is never renamed', w.eval(`displayCrewName('BOUCHARD', ${MP})`) === 'BOUCHARD');
chk('with no profile name nothing is rewritten', w.eval("displayCrewName('self', { fname: '', lname: '' })") === 'self');
chk('the crew column of the logbook resolves it too',
  w.eval("computeCellValue({ pic: 'self' }, 'pic')") === 'M.Daoust');
chk('the crew column leaves another pilot alone',
  w.eval("computeCellValue({ pic: 'BOUCHARD' }, 'pic')") === 'BOUCHARD');
// Rows stamped before 2026-08-12 carry two bare letters: same pilot, shown the
// current way — but a third party's stored name is still never touched.
chk('a legacy two-letter stamp reads as the owner', w.eval(`acceptedByDisplay('MD', ${MP})`) === 'M.Daoust');
chk('a dotted legacy stamp reads as the owner', w.eval(`acceptedByDisplay('M.D.', ${MP})`) === 'M.Daoust');
chk('a stamp that is not the owner is left alone', w.eval(`acceptedByDisplay('ZZ', ${MP})`) === 'ZZ');

// ── 2. The stamp records an instant and the signature ───────────────────
{
  const r = JSON.parse(w.eval("JSON.stringify(stampFlightAccepted({ id: 'x' }, '2026-08-01T18:32:00.000Z'))"));
  chk('the stamp records the instant it was given', r.acceptedAt === '2026-08-01T18:32:00.000Z');
  chk('the stamp records the signature', r.acceptedBy === 'M.Daoust');
}
{
  // A pilot with no name still gets a timestamp; acceptedBy is an explicit
  // empty (which propagates as a real clear) rather than stale initials.
  const r = JSON.parse(w.eval("JSON.stringify(stampFlightAccepted({ id: 'y', acceptedBy: 'ZZ' }, '2026-08-01T18:32:00.000Z', { fname: '', lname: '' }))"));
  chk('an unknown pilot still gets a timestamp', r.acceptedAt === '2026-08-01T18:32:00.000Z');
  chk('stale initials are cleared, never left beside a fresh timestamp', r.acceptedBy === '');
}

// ── 3. It is NOT the attestation pair ───────────────────────────────────
//     30-night-recheck.js refuses to touch a row carrying signedBy/signedAt.
//     Stamping acceptance into those would have made every accepted row
//     permanently unrepairable.
{
  const r = JSON.parse(w.eval("JSON.stringify(stampFlightAccepted({ id: 'z' }, '2026-08-01T18:32:00.000Z'))"));
  chk('accepting a change never sets signedBy', r.signedBy === undefined);
  chk('accepting a change never sets signedAt', r.signedAt === undefined);
  const _row = {
    id: 'z', acceptedAt: '2026-08-01T18:32:00.000Z', acceptedBy: 'MD',
    date: '2026-06-01', dtstart_utc: '2026-06-01T12:00:00Z',
    dep_icao: 'CYOW', arr_icao: 'CYYZ', block: 1, meDayCop: 1, meNightCop: 0,
  };
  const _plan = {
    cols: { day: 'meDayCop', night: 'meNightCop' }, fromDay: 1, fromNight: 0,
    block: 1, dep: 'CYOW', arr: 'CYYZ', oldAnchor: '2026-06-01T12:00:00Z',
  };
  chk('an accepted row is still repairable by the recheck',
    w.eval('_nightRecheckStillValid(' + JSON.stringify(_row) + ',' + JSON.stringify(_plan) + ')') === true);
  chk('a formally SIGNED row is still refused, as before',
    w.eval('_nightRecheckStillValid(' + JSON.stringify({ ..._row, signedBy: 'MD' }) + ',' + JSON.stringify(_plan) + ')') === false);
}

// ── 4. Saving the flight form stamps the row ────────────────────────────
w.eval(`
  localStorage.setItem('logbook_v1', JSON.stringify([]));
  flights = DB.load();
  editingId = null;
  currentEntryType = 'flight';
  showPage('add');
  document.getElementById('f-date').value = '2026-06-02';
  document.getElementById('f-route').value = 'YOW-YYZ';
  document.getElementById('f-block').value = '1.5';
  saveFlight();
`);
{
  const saved = JSON.parse(w.localStorage.getItem('logbook_v1') || '[]')[0] || {};
  chk('saving the form stamps the row', !!saved.acceptedAt);
  chk('saving the form records the signature', saved.acceptedBy === 'M.Daoust');
  chk('the stamp is a real instant', !isNaN(Date.parse(saved.acceptedAt || '')));
}

// ── 5. Confirming an import stamps every accepted row, with ONE instant ──
w.eval(`
  localStorage.setItem('logbook_v1', JSON.stringify([]));
  flights = DB.load();
  pendingImport = [
    { selected: true, date: '2026-06-03', flightNum: 'PD100', route: 'YOW-YYZ', block: 1.2, total: 1.2 },
    { selected: true, date: '2026-06-04', flightNum: 'PD101', route: 'YYZ-YOW', block: 1.3, total: 1.3 },
  ];
  confirmImport();
`);
{
  const rows = JSON.parse(w.localStorage.getItem('logbook_v1') || '[]');
  chk('every imported row is stamped', rows.length === 2 && rows.every(f => !!f.acceptedAt));
  chk('an import shares one instant across the batch',
    rows.length === 2 && rows[0].acceptedAt === rows[1].acceptedAt);
  chk('imported rows carry the signature', rows.every(f => f.acceptedBy === 'M.Daoust'));
}

// ── 6. The stamp is shown, and only once there is one ───────────────────
chk('a row with no stamp renders nothing rather than an unknown date',
  w.eval("acceptedStampText({ id: 'a' })") === '');
// A null or 0 stamp parses as a VALID date (the 1970 epoch), so only the
// explicit emptiness check keeps it off the screen.
chk('a null stamp renders nothing, never 1970',
  w.eval('acceptedStampText({ acceptedAt: null })') === '');
chk('a zero stamp renders nothing, never 1970',
  w.eval('acceptedStampText({ acceptedAt: 0 })') === '');
chk('a malformed stamp renders nothing rather than Invalid Date',
  w.eval("acceptedStampText({ acceptedAt: 'not-a-date' })") === '');
chk('the stamp reads as date, time and signature', (() => {
  const s = w.eval("acceptedStampText({ acceptedAt: '2026-08-01T18:32:00.000Z', acceptedBy: 'M.Daoust' })");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · M\.Daoust$/.test(s);
})());
// A row stamped before the spelling changed shows the current one, so a list
// never mixes two signatures for the same pilot.
chk('a legacy stamp is shown the current way', (() => {
  const s = w.eval("acceptedStampText({ acceptedAt: '2026-08-01T18:32:00.000Z', acceptedBy: 'MD' })");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · M\.Daoust$/.test(s);
})());
chk('with no signature the stamp is just the moment', (() => {
  const s = w.eval("acceptedStampText({ acceptedAt: '2026-08-01T18:32:00.000Z', acceptedBy: '' })");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s);
})());
{
  // …and it reaches the flight-detail panel the pilot actually opens.
  w.eval(`
    localStorage.setItem('logbook_v1', JSON.stringify([
      { id: 'det1', date: '2026-06-05', flightNum: 'PD200', route: 'YOW-YUL', block: 1,
        acceptedAt: '2026-08-01T18:32:00.000Z', acceptedBy: 'MD' }
    ]));
    flights = DB.load();
    openFlightDetail('det1');
  `);
  const body = w.eval("document.getElementById('flightDetailBody').textContent");
  chk('the flight detail shows the acceptance stamp', /·\s*M\.Daoust/.test(body) && /2026-08-01/.test(body));
  w.eval('closeFlightDetail();');
}

// ── 7. The dashboard no longer carries the sealed-declaration card ──────
w.eval(`
  localStorage.setItem('cumulo_opening_balances_v1', JSON.stringify({
    balances: { total: 2781 }, cutoffDate: '2025-11-27',
    attestedBy: 'Test Pilot', attestedAt: '2026-07-07T00:00:00Z', hash: 'seal-abc'
  }));
  _dashRenderBfBanner(true);
`);
{
  const banner = w.document.getElementById('broughtForwardBanner');
  chk('an attested declaration no longer shows a dashboard card',
    banner && banner.style.display === 'none' && banner.innerHTML === '');
  // The phrase must not be RENDERED any more. It survives in a code comment
  // documenting why the card was removed, which is not a screen.
  chk('no dashboard state renders the sealed-declaration wording', (() => {
    for (const hasFlights of [true, false]) {
      w.eval('_dashRenderBfBanner(' + hasFlights + ');');
      const el = w.document.getElementById('broughtForwardBanner');
      if (el && /sealed and verified|scellée et vérifiée/i.test(el.innerHTML)) return false;
    }
    return true;
  })());
}

// ── 8. A database without the new columns keeps syncing everything else ──
//     A provenance nicety must never stop the logbook from reaching the cloud.
w.eval(`
  window.__cloud = { flights: [] };
  window.__rejected = 0;
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = { from: () => ({
    upsert: async (rows) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      // Model a Supabase that has NOT run the 2026-08-01 ALTER.
      if (arr.some(r => 'accepted_at' in r || 'accepted_by' in r)) {
        window.__rejected++;
        return { error: { code: '42703', message: 'column "accepted_at" of relation "flights" does not exist' } };
      }
      arr.forEach(r => window.__cloud.flights.push(r));
      return { error: null };
    },
    select: () => { const p = Promise.resolve({ data: [], error: null }); p.eq = () => Promise.resolve({ data: [], error: null }); return p; },
    update: () => ({ eq: async () => ({ error: null }) }),
  }) };
  localStorage.setItem('logbook_v1', JSON.stringify([
    { id: '${F1}', date: '2026-06-06', route: 'YOW-YYZ', block: 1.4, total: 1.4,
      acceptedAt: '2026-08-01T18:32:00.000Z', acceptedBy: 'MD' }
  ]));
  flights = DB.load();
  Sync._saveSyncedSig({});
`);
await w.eval('Sync.pushAllFlights()');
{
  const rejected = w.eval('window.__rejected');
  const pushed = JSON.parse(w.eval('JSON.stringify(window.__cloud.flights)'));
  chk('the first attempt is refused by a database missing the columns', rejected === 1);
  const _f1 = pushed.filter(r => r.id === F1).pop() || null;
  chk('the flight still reaches the cloud without them', !!_f1);
  chk('what reached the cloud carries no unknown column',
    !!_f1 && !('accepted_at' in _f1) && !('accepted_by' in _f1));
  chk('the flight time is intact in what was pushed', !!_f1 && +_f1.total === 1.4);
  chk('the stamp stays on the device', (JSON.parse(w.localStorage.getItem('logbook_v1'))[0] || {}).acceptedBy === 'MD');
}


// ── 9. Every path the pilot confirms stamps, and only those ─────────────
//     Missed on the first pass and caught by reading every DB.save caller:
//     typing crew names, and committing a CSV, are changes the pilot accepts
//     just as much as saving the form. The iCal auto-sync is NOT: nothing the
//     pilot did not confirm may claim to be accepted by them.
w.eval(`
  localStorage.setItem('logbook_v1', JSON.stringify([
    { id: '33333333-3333-4333-8333-333333333333', date: '2026-06-07', route: 'YOW-YYZ', block: 1.1, total: 1.1 }
  ]));
  flights = DB.load();
`);
{
  const before = JSON.parse(w.localStorage.getItem('logbook_v1'))[0];
  chk('a row nobody has accepted carries no stamp', before.acceptedAt === undefined);
}
w.eval(`
  openQuickCrewFill(['33333333-3333-4333-8333-333333333333']);
  const _row = Array.from(document.querySelectorAll('.qc-row')).filter(function (r) { return r.getAttribute('data-flight-id') === '33333333-3333-4333-8333-333333333333'; }).pop();
  if (_row) _row.querySelector('.qc-input').value = 'BOUCHARD';
  saveQuickCrewFill();
`);
{
  const after = JSON.parse(w.localStorage.getItem('logbook_v1'))[0] || {};
  chk('quick crew fill stamps the row it changed', !!after.acceptedAt);
  chk('quick crew fill records the signature', after.acceptedBy === 'M.Daoust');
  chk('quick crew fill actually wrote the name too', (after.pic || after.copilot) === 'BOUCHARD');
}

// The iCal auto-sync fills blanks on its own schedule; that is not an
// acceptance and must never be stamped as one.
{
  const stampers = readFileSync(join(root, 'src/js/08-flight-form.js'), 'utf8');
  chk('the iCal sync never stamps an acceptance the pilot did not give',
    !/stampFlightAccepted/.test(stampers));
  const puller = readFileSync(join(root, 'src/js/19-sync.js'), 'utf8');
  chk('a cloud pull never mints a local acceptance',
    !/stampFlightAccepted/.test(puller));
}
if (failures.length) {
  console.error(`\n✗ accepted-stamp test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ accepted stamp passed — form/import/recheck stamp the row, initials are never invented, it is not the attestation pair, and a database without the columns still syncs');
process.exit(0);
