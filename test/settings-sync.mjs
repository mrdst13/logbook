// ═══════════════════════════════════════════════════════════════════
// DEVICE-SETTINGS CROSS-DEVICE SYNC TEST
//
// 2026-08-01, Martin: his iPhone's Duty page told him to "connect your schedule
// via iCal" while his computer was connected on the SAME account. Two causes,
// both proven here:
//
//   1. NEVER PUSHED. saveNavblueUrl() wrote localStorage and nothing else, and
//      pushProfile — the only writer of navblue_url — fires exclusively from the
//      DB.saveProfile patch. A pilot who pasted the feed in Settings > Sync and
//      never afterwards edited their Profile had it on that one device forever.
//      Fix: Sync.pushDeviceSettingsIfAny() on save, on sign-in and on every launch.
//
//   2. BLANKED. pushProfile sent `navblue_url: null` (plus signature: null,
//      onboarded: false, a default pilot_type, ac_configs, lang, dark_mode…)
//      from a device that simply had none. upsert applies every column in the
//      payload, so ONE profile edit on a fresh phone wiped what the computer had
//      uploaded. Fix: omit those columns unless this device holds a real value.
//      (Exactly the hazard the 2026-07-09 custom-validities fix closed; it was
//      never limited to those two columns.)
//
// Plus the two things that made the fix visible: the pull now re-renders the
// screens that read localStorage synchronously, and a deliberate disconnect on
// one device is remembered so the restore can't silently undo it.
//
// Drives the REAL Sync module against an in-memory Supabase mock whose upsert
// MERGES provided columns (models PostgREST ON CONFLICT DO UPDATE SET).
//
// Run:  node test/settings-sync.mjs   (also part of `npm test`)
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

const URL_A = 'https://porter.navblue.cloud/roster/martin.ics';
const URL_B = 'https://porter.navblue.cloud/roster/other.ics';
const KEY = w.eval('NAVBLUE_URL_KEY');
const RMKEY = w.eval('NAVBLUE_REMOVED_KEY');
const THEMEKEY = w.eval('THEME_CHOSEN_KEY');
const PKEY = w.eval('DB.profileKey');

// Cloud mock: upsert MERGES only the columns present in the payload, so a
// column that is OMITTED keeps whatever another device already stored — the
// behaviour the whole omit-when-blank rule depends on.
w.eval(`
  window.__cloud = { profiles: [] };
  Auth.isAuthenticated = () => true;
  Auth.currentUserId = () => 'user-1';
  Auth.client = { from: (table) => ({
    upsert: async (row) => {
      const arr = window.__cloud[table] || (window.__cloud[table] = []);
      const i = arr.findIndex(r => r.id === row.id);
      if (i >= 0) arr[i] = Object.assign({}, arr[i], row); else arr.push(Object.assign({}, row));
      window.__lastUpsert = Object.assign({}, row);
      return { error: null };
    },
    select: () => {
      const data = window.__cloud[table] || [];
      const pr = Promise.resolve({ data, error: null });
      pr.eq = (col, val) => Promise.resolve({ data: data.filter(r => r[col] === val), error: null });
      return pr;
    },
  }) };
  Sync._suppressAutoSync = true;              // don't let DB.saveProfile re-trigger pushes
  window.confirm = () => true;
  window.__toasts = [];
  showToast = function (m) { window.__toasts.push(String(m)); };
  syncNavblueAuto = function () {};            // no network in tests
`);

const cloud = () => w.eval('window.__cloud.profiles[0] || null');
const lastUpsert = () => w.eval('window.__lastUpsert ? JSON.stringify(window.__lastUpsert) : "null"');
const setCloud = (row) => w.eval(`window.__cloud.profiles = [${JSON.stringify(row)}];`);
const localUrl = () => w.localStorage.getItem(KEY);

// ── 1. Saving the URL in Settings carries it to the ACCOUNT, not just here ──
w.localStorage.removeItem(KEY);
w.localStorage.removeItem(RMKEY);
w.eval('window.__cloud.profiles = [];');
w.eval(`document.getElementById('navblueUrl').value = ${JSON.stringify(URL_A)};`);
// saveNavblueUrl must do the uploading ITSELF. Calling the pusher from the test
// as well would have made the next assertion true no matter what the product
// code did — the exact tautology this file exists to rule out.
w.eval('saveNavblueUrl();');
await new Promise(r => setTimeout(r, 30));
chk('saving the iCal URL stores it on this device', localUrl() === URL_A);
chk('saving the iCal URL uploads it to the account', (cloud() || {}).navblue_url === URL_A);
chk('the upload never sends a column this device has no answer for', (() => {
  const r = JSON.parse(lastUpsert()) || {};
  if (r.id !== 'user-1' || r.navblue_url !== URL_A) return false;
  return Object.values(r).every(v => v !== null && v !== '');
})());

// ── 2. A device WITHOUT the URL must not blank the cloud copy ───────────
//     (one profile edit on a fresh phone used to wipe it)
setCloud({ id: 'user-1', navblue_url: URL_A, signature: 'data:image/png;base64,AAA', onboarded: true, pilot_type: 'flightschool', lang: 'fr' });
w.localStorage.removeItem(KEY);
w.localStorage.removeItem('logbook_signature');
w.localStorage.removeItem('cumulo_onboarded_v1');
w.localStorage.removeItem('cumulo_lang');
await w.eval(`Sync.pushProfile({ fname: 'Fresh', lname: 'Phone' })`);
let c = cloud() || {};
chk('an empty device never blanks the cloud iCal URL', c.navblue_url === URL_A);
chk('an empty device never blanks the cloud signature', c.signature === 'data:image/png;base64,AAA');
chk('an empty device never un-onboards the account', c.onboarded === true);
chk('an empty device never overwrites pilot type with the default', c.pilot_type === 'flightschool');
chk('an empty device never overwrites the language', c.lang === 'fr');
chk('a real profile edit still reaches the cloud', c.fname === 'Fresh');

// ── 2b. A field the pilot genuinely CLEARED still propagates as null ────
//     (omit-when-blank must not swallow a deliberate erase on the form)
setCloud({ id: 'user-1', medical: '2027-03-31', navblue_url: URL_A });
await w.eval(`Sync.pushProfile({ fname: 'Fresh', medical: '' })`);
c = cloud() || {};
chk('clearing a profile field still clears it in the cloud', c.medical === null);

// ── 3. The second device pulls and adopts the URL ───────────────────────
setCloud({ id: 'user-1', navblue_url: URL_A });
w.localStorage.removeItem(KEY);
w.localStorage.removeItem(RMKEY);
w.localStorage.setItem(PKEY, JSON.stringify({ fname: 'Phone' }));
chk('before the pull, the Duty gate reports NOT connected', w.eval('_navblueConfigured()') === false);
await w.eval('Sync.pullProfile()');
chk('the second device adopts the account iCal URL', localUrl() === URL_A);
chk('after the pull, the Duty gate reports connected', w.eval('_navblueConfigured()') === true);

// ── 4. A URL already set on THIS device is never overwritten by the cloud ──
w.localStorage.setItem(KEY, URL_B);
setCloud({ id: 'user-1', navblue_url: URL_A });
await w.eval('Sync.pullProfile()');
chk('the pull never overwrites a URL set on this device', localUrl() === URL_B);

// ── 5. Launch self-heal: the device that HAS it re-uploads; an empty one no-ops ──
setCloud({ id: 'user-1' });                         // cloud column never written (pre-fix state)
w.localStorage.setItem(KEY, URL_A);
w.localStorage.removeItem(RMKEY);
await w.eval('Sync.pushDeviceSettingsIfAny()');
chk('a URL saved before this build self-heals to the cloud on launch', (cloud() || {}).navblue_url === URL_A);
setCloud({ id: 'user-1', navblue_url: URL_A });
w.localStorage.removeItem(KEY);
await w.eval('Sync.pushDeviceSettingsIfAny()');
chk('a device with no URL never blanks the cloud on launch', (cloud() || {}).navblue_url === URL_A);

// ── 5b. The launch self-heal fills a gap; it must NEVER revert ──────────
//     A device still holding the OLD URL used to push it back over the new one
//     on every launch, so correcting the feed on the computer was undone by the
//     phone forever and no device ever converged. The self-heal now reads the
//     cloud first and only sends what the cloud has no answer for; only the
//     pilot's own save (intent) overwrites. (Independent review 2026-08-01.)
setCloud({ id: 'user-1', navblue_url: URL_B });      // the corrected feed, set elsewhere
w.localStorage.setItem(KEY, URL_A);                  // this device still holds the old one
w.localStorage.removeItem(RMKEY);
await w.eval('Sync.pushDeviceSettingsIfAny()');
chk('the launch self-heal never reverts a URL corrected on another device',
  (cloud() || {}).navblue_url === URL_B);
// …but the pilot pasting a URL HERE is the newest fact and does overwrite.
w.eval(`document.getElementById('navblueUrl').value = ${JSON.stringify(URL_A)};`);
w.eval('saveNavblueUrl();');
await new Promise(r => setTimeout(r, 30));
chk('saving on this device does overwrite the account copy', (cloud() || {}).navblue_url === URL_A);

// ── 6. A deliberate disconnect on this device is remembered ─────────────
w.localStorage.setItem(KEY, URL_A);
w.localStorage.removeItem(RMKEY);
w.eval('clearNavblueUrl()');
chk('Remove clears the URL on this device', localUrl() === null);
chk('Remove records that this device was disconnected on purpose', !!w.localStorage.getItem(RMKEY));
setCloud({ id: 'user-1', navblue_url: URL_A });
await w.eval('Sync.pullProfile()');
chk('the pull does not undo a deliberate disconnect', localUrl() === null);
setCloud({ id: 'user-1' });
w.localStorage.setItem(KEY, URL_A);                 // stale value with the tombstone still set
await w.eval('Sync.pushDeviceSettingsIfAny()');
chk('a disconnected device does not re-upload', (cloud() || {}).navblue_url === undefined);
// …and pasting a URL again cancels the disconnect
w.localStorage.removeItem(KEY);
w.eval(`document.getElementById('navblueUrl').value = ${JSON.stringify(URL_A)};`);
w.eval('saveNavblueUrl()');
chk('saving a URL again cancels the disconnect marker', w.localStorage.getItem(RMKEY) === null);

// ── 7. The Duty page never claims it checked a schedule it never read ───
w.localStorage.setItem(KEY, URL_A);
w.localStorage.removeItem(RMKEY);
w.localStorage.removeItem('cumulo_roster_forecast_v1');
w.eval("_dutyRenderNotice(null, false, false)");
let notice = w.eval("document.getElementById('dutyNotice').textContent");
chk('with the feed never read, the notice does not assert there are no flights',
  !/no upcoming flight was detected/i.test(notice) && /not been read on this device/i.test(notice));
w.localStorage.setItem('cumulo_roster_forecast_v1', JSON.stringify({ flights: [] }));
w.eval("_dutyRenderNotice(null, false, false)");
notice = w.eval("document.getElementById('dutyNotice').textContent");
chk('with the feed read and empty, the notice says there is nothing upcoming',
  /no upcoming flight was detected/i.test(notice));
w.localStorage.removeItem(KEY);
w.eval("_dutyRenderNotice(null, false, false)");
notice = w.eval("document.getElementById('dutyNotice').textContent");
chk('with no feed at all, the notice asks the pilot to connect one',
  /import your schedule/i.test(notice));


// ── 8. The other settings saved the same way travel the same way ────────
//     Signature, language, theme and column preferences were each one
//     localStorage write with no cloud call, so each one was stranded on
//     whichever device set it (confirmed by independent review 2026-08-01).
w.localStorage.setItem(KEY, URL_A);
w.localStorage.removeItem(RMKEY);
w.localStorage.setItem('logbook_signature', 'data:image/png;base64,SIG');
w.localStorage.setItem('cumulo_lang', 'fr');
w.localStorage.setItem('logbook_dark', '1');
w.localStorage.setItem(THEMEKEY, '1');                // the pilot actually picked dark
w.localStorage.setItem('cumulo_column_prefs_v1', JSON.stringify({ night: true }));
setCloud({ id: 'user-1' });
await w.eval('Sync.pushDeviceSettingsIfAny()');
c = cloud() || {};
chk('the signature reaches the account', c.signature === 'data:image/png;base64,SIG');
chk('the language reaches the account', c.lang === 'fr');
chk('the theme reaches the account', c.dark_mode === true);
chk('the column preferences reach the account', !!c.column_prefs && c.column_prefs.night === true);
// …and a device that has none of them never blanks what this one uploaded.
['logbook_signature', 'cumulo_lang', 'logbook_dark', 'cumulo_column_prefs_v1', THEMEKEY]
  .forEach(k => w.localStorage.removeItem(k));
await w.eval('Sync.pushDeviceSettingsIfAny()');
c = cloud() || {};
chk('a bare device never blanks the account settings',
  c.signature === 'data:image/png;base64,SIG' && c.lang === 'fr' && c.dark_mode === true);

// ── 8b. A theme nobody chose must not travel ────────────────────────────
//     applyDarkMode() writes 'logbook_dark' on the first boot of EVERY device,
//     so the key's presence proves nothing. Without the chosen-marker an
//     untouched phone pushed "light" and undid a deliberate dark mode.
setCloud({ id: 'user-1' });
w.localStorage.setItem('logbook_dark', '0');          // written by the app at boot
w.localStorage.removeItem(THEMEKEY);                  // never chosen by the pilot
w.localStorage.setItem(KEY, URL_A);                   // something to push, so we still upsert
await w.eval('Sync.pushDeviceSettingsIfAny()');
chk('a theme the pilot never chose is not pushed to the account',
  (cloud() || {}).dark_mode === undefined);
chk('clicking the theme toggle records it as a real choice', (() => {
  w.eval("setTheme('dark', { explicit: true });");
  return w.localStorage.getItem(THEMEKEY) === '1';
})());
chk('restoring the theme at boot is not recorded as a choice', (() => {
  w.localStorage.removeItem(THEMEKEY);
  w.eval('applyDarkMode();');
  return w.localStorage.getItem(THEMEKEY) === null;
})());

// ── 9. The pull must restore localStorage BEFORE its own echo push ──────
//     DB.saveProfile is patched to fire pushProfile, and pushProfile reads
//     these keys straight out of localStorage. Restoring them after the save
//     meant the pull that was supposed to heal this device instead told the
//     cloud it had no roster URL and no signature, a moment before writing
//     them locally from the row it had just read.
w.eval('installAutoSyncPatch(); Sync._suppressAutoSync = false;');
// Spy on the save so the ORDER itself is asserted, not just its outcome: at the
// instant pullProfile fires DB.saveProfile (which is what triggers the echo
// push), localStorage must already hold the restored URL. The omit-when-blank
// rule above makes the wrong order harmless today, so without this the ordering
// fix would be untestable and could silently rot.
w.eval('window.__sawUrlAtSave = "not-called"; window.__origSaveProfile = DB.saveProfile;' +
  'DB.saveProfile = function (p) { window.__sawUrlAtSave = localStorage.getItem(NAVBLUE_URL_KEY); return window.__origSaveProfile.call(DB, p); };');
[KEY, RMKEY, 'logbook_signature', 'cumulo_lang', 'logbook_dark', 'cumulo_column_prefs_v1', 'cumulo_onboarded_v1']
  .forEach(k => w.localStorage.removeItem(k));
w.localStorage.setItem(PKEY, JSON.stringify({ lname: 'Phone' }));   // no fname, so the merge marks changed
setCloud({ id: 'user-1', fname: 'Cloud', navblue_url: URL_A, signature: 'data:image/png;base64,SIG', onboarded: true });
await w.eval('Sync.pullProfile()');
await new Promise(r => setTimeout(r, 30));   // let the echo push settle
c = cloud() || {};
chk('the echo push from the pull does not blank the account iCal URL', c.navblue_url === URL_A);
chk('the echo push from the pull does not blank the account signature', c.signature === 'data:image/png;base64,SIG');
chk('the echo push from the pull does not un-onboard the account', c.onboarded === true);
chk('the pull still adopted the URL locally', localUrl() === URL_A);
chk('the profile save inside the pull already sees the restored URL', w.eval('window.__sawUrlAtSave') === URL_A);
w.eval('DB.saveProfile = window.__origSaveProfile;');
w.eval('Sync._suppressAutoSync = true;');


// ── 10. Deleting the account really erases the signature ────────────────
//     The wipe list named 'cumulo_signature', a key nothing has ever written:
//     saveSignature writes 'logbook_signature'. So "delete my account" left the
//     pilot's scanned signature sitting in this browser's storage, while the
//     code and its comment both claimed the signature was gone.
//     (Confirmed by independent review 2026-08-01.)
w.localStorage.setItem('logbook_signature', 'data:image/png;base64,SIG');
w.localStorage.setItem(KEY, URL_A);
w.eval(`
  confirmDialog = async () => true;
  Auth.isReady = () => true;
  Auth.deleteAccount = async () => ({ error: null });
`);
await w.eval('deleteAccountPurge()');
chk('deleting the account erases the stored signature',
  w.localStorage.getItem('logbook_signature') === null);
chk('deleting the account erases the roster feed URL',
  w.localStorage.getItem(KEY) === null);


// ── 11. Adopting the account language actually re-translates the screen ──
//     Writing 'cumulo_lang' alone left every [data-i18n] element in the
//     language of the page load: the nav, headings and buttons stayed English
//     while anything re-rendered afterwards came back in French. pullProfile
//     lands after the first paint, so the write had to be followed by a
//     re-translation. (Independent review 2026-08-01.)
w.eval('Sync._suppressAutoSync = true;');
[KEY, RMKEY, 'logbook_signature'].forEach(k => w.localStorage.removeItem(k));
w.eval("setLang('en');");   // paint the page in English first…
w.localStorage.removeItem('cumulo_lang');   // …then make this device have no stored choice
setCloud({ id: 'user-1', lang: 'fr' });
w.localStorage.setItem(PKEY, JSON.stringify({ fname: 'Phone' }));
const navBefore = w.eval("(document.querySelector('[data-i18n=\"nav.dashboard\"]') || {}).textContent || ''");
await w.eval('Sync.pullProfile()');
const navAfter = w.eval("(document.querySelector('[data-i18n=\"nav.dashboard\"]') || {}).textContent || ''");
chk('the account language is adopted', w.localStorage.getItem('cumulo_lang') === 'fr');
chk('the page is actually re-translated, not just the key written',
  navBefore !== '' && navAfter !== '' && navAfter !== navBefore);
chk('the document language attribute follows', w.eval("document.documentElement.getAttribute('lang')") === 'fr');
w.eval("setLang('en');");

if (failures.length) {
  console.error(`\n✗ settings sync test: ${failures.length} failure(s)`);
  for (const f of failures) console.error('  • ' + f);
  process.exit(1);
}
console.log('✓ settings sync passed — saving uploads to the account, an empty device never blanks it, the 2nd device adopts it, a real clear still propagates, and a deliberate disconnect is not undone');
process.exit(0);
