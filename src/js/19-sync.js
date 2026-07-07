// ═══════════════════════════════════════════
// SYNC — flights + profile (Phase 2)
// ═══════════════════════════════════════════
//
// Status: SKELETON. Becomes active once Auth.isReady() (i.e. SUPABASE_URL
// + SUPABASE_ANON_KEY are filled in 18-supabase.js).
//
// Contracts:
//   - Local writes always happen FIRST (write-through to localStorage),
//     then enqueue + push to Supabase. Offline-first by design.
//   - LWW on updated_at server-side (DB trigger). Client sends
//     client_updated_at + op_id for idempotency and conflict tie-break.
//   - Migration is one-shot per device, gated by cumulo_migration_state_v1.
//   - Pre-flight snapshot via snapshotBeforeOperation('Cloud migration').
//   - localStorage retained 90 days post-migration as read-only fallback.
//   - Audit log written to cumulo_migration_log_v1 (same standard as
//     16-csv-import.js audit log).
//
// Offline queue: skeleton uses localStorage. TODO move to IndexedDB once
// the first beta user accumulates >100 pending mutations (localStorage's
// 5 MB cap becomes a real risk only at that scale).

const MIGRATION_STATE_KEY = 'cumulo_migration_state_v1';
const MIGRATION_LOG_KEY   = 'cumulo_migration_log_v1';
const PENDING_OPS_KEY     = 'cumulo_pending_ops_v1';
const DEVICE_ID_KEY       = 'cumulo_device_id_v1';
const PREMIGRATION_BACKUP_KEY = 'cumulo_premigration_backup_v1';
// Per-flight fingerprint of what we last synced to the cloud (id → hash).
// Lets auto-sync push ONLY changed rows instead of re-pushing the whole table
// on every local save. Re-pushing an unchanged row re-stamps its updated_at
// and can overwrite a newer edit made on another device (audit item 7 —
// cross-device data loss). Persisted so it survives reloads; refreshed on
// every push and pull.
const SYNCED_SIG_KEY = 'cumulo_synced_sig_v1';

const MIGRATION_BATCH_SIZE = 200;
const PREMIGRATION_RETENTION_DAYS = 90;

// ─────────────────────────────────────────────────────────────────
// Device id — stable random per browser. Used for LWW tie-break and
// future trust-device flow.
// ─────────────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function newUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (good enough for client_uuid — server validates uniqueness)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// True for a canonical UUID string. The cloud `flights.id` column is uuid-typed
// and rejects legacy ids ("invalid input syntax for type uuid"). Legacy local
// ids came in several shapes: Date.now().toString(), Date.now()+Math.random(),
// and 'csv-...' — none are UUIDs.
function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Re-key any flight whose id isn't a valid UUID to a fresh UUID, in place, so
// local and cloud share the same id (otherwise migration verify would fail and
// future syncs would never match). Persists with auto-sync suppressed to avoid
// re-entrancy. Returns the count re-keyed. Call before any push/migration.
function normalizeFlightIds() {
  if (typeof flights === 'undefined' || !Array.isArray(flights)) return 0;
  let n = 0;
  flights.forEach(f => { if (f && (!f.id || !isUuid(f.id))) { f.id = newUUID(); n++; } });
  if (n) {
    const prev = (typeof Sync !== 'undefined') ? Sync._suppressAutoSync : false;
    if (typeof Sync !== 'undefined') Sync._suppressAutoSync = true;
    try { DB.save(flights); } catch (e) { /* persisted on next save */ }
    finally { if (typeof Sync !== 'undefined') Sync._suppressAutoSync = prev; }
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────
// Local <-> Supabase field mapping (camelCase ↔ snake_case)
// Single source of truth for what each side calls each column.
// ─────────────────────────────────────────────────────────────────
const FLIGHT_FIELD_MAP = {
  // Identification
  id: 'id',
  date: 'date',
  flightNum: 'flight_num',
  type: 'type',
  reg: 'reg',
  dep_icao: 'dep_icao',
  arr_icao: 'arr_icao',
  via: 'via',
  route: 'route',
  // Crew
  pic: 'pic',
  copilot: 'copilot',
  // Timing
  dtstart_utc: 'dtstart_utc',
  std_utc: 'std_utc',
  sta_utc: 'sta_utc',
  co_utc: 'co_utc',
  ci_utc: 'ci_utc',
  // Hours
  block: 'block',
  duty: 'duty',
  total: 'total',
  meDayPic: 'me_day_pic',
  meNightPic: 'me_night_pic',
  meDayCop: 'me_day_cop',
  meNightCop: 'me_night_cop',
  meDayDual: 'me_day_dual',
  meNightDual: 'me_night_dual',
  seDay: 'se_day',
  seNight: 'se_night',
  seDayDual: 'se_day_dual',
  seNightDual: 'se_night_dual',
  atd_utc: 'atd_utc',
  ata_utc: 'ata_utc',
  heliDayPic: 'heli_day_pic',
  heliNightPic: 'heli_night_pic',
  heliDayCop: 'heli_day_cop',
  heliNightCop: 'heli_night_cop',
  heliDayDual: 'heli_day_dual',
  heliNightDual: 'heli_night_dual',
  hoverTime: 'hover_time',
  xcDayPic: 'xc_day_pic',
  xcNightPic: 'xc_night_pic',
  xcDayCop: 'xc_day_cop',
  xcNightCop: 'xc_night_cop',
  xcDayDual: 'xc_day_dual',
  xcNightDual: 'xc_night_dual',
  instActual: 'inst_actual',
  instHood: 'inst_hood',
  instSim: 'inst_sim',
  approaches: 'approaches',
  picus: 'picus',
  toDay: 'to_day',
  toNight: 'to_night',
  ldgDay: 'ldg_day',
  ldgNight: 'ldg_night',
  dualGivenDay: 'dual_given_day',
  dualGivenNight: 'dual_given_night',
  // Sim
  isSim: 'is_sim',
  simType: 'sim_type',
  simSession: 'sim_session',
  simRegistration: 'sim_registration',
  // Misc
  acConfig: 'ac_config',
  multiCrew: 'multi_crew',
  remarks: 'remarks',
  source: 'source',
  sources: 'sources',
  // Local flights store the iCal UID as camelCase `navblueUid`
  // (navblueEventToFlight). Mapping the wrong local key here left the cloud
  // column NULL and the (user_id, navblue_uid) dedup index inert.
  navblueUid: 'navblue_uid',
  signedBy: 'signed_by',
  signedAt: 'signed_at',
};

const FLIGHT_FIELD_MAP_INV = (() => {
  const inv = {};
  for (const [local, remote] of Object.entries(FLIGHT_FIELD_MAP)) inv[remote] = local;
  return inv;
})();

// Postgres-typed columns that reject an empty string "". Legacy local flights
// stored empty fields as "" (e.g. unflown hours), which Postgres rejects with
// "invalid input syntax for type numeric/timestamp/boolean". We coerce "" (and
// other non-conforming values) to a type-safe value before upload.
const NUMERIC_COLS = new Set([
  'block','duty','total',
  'me_day_pic','me_night_pic','me_day_cop','me_night_cop','me_day_dual','me_night_dual',
  'se_day','se_night','se_day_dual','se_night_dual',
  'heli_day_pic','heli_night_pic','heli_day_cop','heli_night_cop','heli_day_dual','heli_night_dual','hover_time',
  'xc_day_pic','xc_night_pic','xc_day_cop','xc_night_cop','xc_day_dual','xc_night_dual',
  'inst_actual','inst_hood','inst_sim','approaches','picus',
  'to_day','to_night','ldg_day','ldg_night','dual_given_day','dual_given_night',
]);
const TIMESTAMP_COLS = new Set(['dtstart_utc','signed_at','deleted_at']);
const BOOLEAN_COLS = new Set(['is_sim','multi_crew']);
const JSONB_COLS = new Set(['sources']);

// Make a row safe for the typed Supabase columns. Numeric "" → null (honest
// "empty", not a fabricated 0 — cf. never-approximate rule; reads back as 0 in
// math). Timestamp "" → null. Boolean ""/string → real boolean or null. Text
// columns (route, remarks, HHMM strings, etc.) are left untouched, "" included.
function coerceRowTypes(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (NUMERIC_COLS.has(k)) {
      if (v === '' || v === null || v === undefined) { row[k] = null; }
      else { const n = Number(v); row[k] = Number.isFinite(n) ? n : null; }
    } else if (TIMESTAMP_COLS.has(k)) {
      if (v === '' || v === undefined) row[k] = null;
    } else if (BOOLEAN_COLS.has(k)) {
      if (v === '' || v === null || v === undefined) row[k] = null;
      else if (typeof v === 'string') row[k] = (v === 'true' || v === '1');
    } else if (JSONB_COLS.has(k)) {
      // jsonb rejects ""; an array/object is fine. Empty/invalid → null.
      if (v === '' || v === undefined) row[k] = null;
    }
  }
  return row;
}

// Convert local flight (camelCase) → Supabase row (snake_case + user_id + sync cols)
function localFlightToRow(f, userId, opId) {
  const row = { user_id: userId };
  for (const [localKey, remoteKey] of Object.entries(FLIGHT_FIELD_MAP)) {
    // Only skip strictly-undefined values. Empty string is a legitimate
    // user clear (e.g. clearing remarks) and must propagate to remote
    // — otherwise the server keeps the stale non-empty value.
    if (f[localKey] !== undefined) {
      row[remoteKey] = f[localKey];
    }
  }
  // PIPEDA gate: if the user has NOT given consent to keep full captain
  // names, anonymize before sending to Supabase. Belt-and-suspenders —
  // local rows should already be anonymized at write-time, but if any
  // ever slipped through (CSV import edge case, legacy data), we still
  // never push raw third-party PII to the cloud.
  // FAIL CLOSED (audit 2026-06-09): if the anonymizer or profile is
  // unavailable (load-order regression), we cannot prove consent — so blank
  // the crew names rather than push raw PII. Local data is untouched and a
  // later push with the gate present restores the anonymized values.
  const gateProfile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : null;
  const hasConsent = !!(gateProfile && gateProfile.consentCaptainNames);
  if (!hasConsent) {
    if (gateProfile && typeof gateCaptainName === 'function') {
      if (typeof row.pic === 'string')     row.pic = gateCaptainName(row.pic, gateProfile);
      if (typeof row.copilot === 'string') row.copilot = gateCaptainName(row.copilot, gateProfile);
    } else {
      if (typeof row.pic === 'string')     row.pic = '';
      if (typeof row.copilot === 'string') row.copilot = '';
    }
  }
  // navblue_uid: '' must become null — the dedup index
  // (user_id, navblue_uid) WHERE navblue_uid IS NOT NULL ignores nulls but
  // would collide every ''-valued row against the others.
  if (row.navblue_uid === '') row.navblue_uid = null;
  // Mint id if missing
  if (!row.id || !isUuid(row.id)) row.id = newUUID();
  // Sync metadata
  row.client_updated_at = new Date().toISOString();
  row.device_id = getDeviceId();
  row.op_id = opId || newUUID();
  // Final guard: make every typed column Postgres-safe (numeric/timestamp/
  // boolean "" → null/coerced) so legacy empty fields can't fail the upsert.
  coerceRowTypes(row);
  return row;
}

// Convert Supabase row → local flight (snake_case → camelCase)
function rowToLocalFlight(row) {
  const f = {};
  for (const [remoteKey, val] of Object.entries(row)) {
    const localKey = FLIGHT_FIELD_MAP_INV[remoteKey];
    if (localKey) f[localKey] = val;
  }
  return f;
}

// Stable 53-bit hash (cyrb53) for change detection — NOT security.
function _cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Canonicalise ONE field for fingerprinting, per its cloud column TYPE. The
// goal: a field the LOCAL flight OMITS (empty slot deleted at save-time) and
// the SAME field stored with the column's zero/empty default in the cloud must
// produce the identical fingerprint — otherwise push (localFlightToRow omits
// undefined keys) and pull (a full Postgres row) never agree and every flight
// looks permanently dirty (reinstating the cross-device overwrite this targets).
//
// Numeric columns ONLY are compared by numeric value: omitted / '' / null / 0 /
// "0.00" all mean "not logged" → null; "1.50" ≡ 1.5. TEXT columns (HHMM times
// like atd_utc, flightNum, reg, ICAO codes, remarks, names) are compared
// VERBATIM — never Number()-converted — so a real correction like "" → "0000"
// (midnight UTC) or "007" → "7" is detected and synced, not silently collided
// into "no change". (Adversarial review 2026-07, audit item 7.)
function _sigField(remoteKey, v) {
  if (NUMERIC_COLS.has(remoteKey)) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return (!Number.isNaN(n) && n !== 0) ? n : null;
  }
  if (BOOLEAN_COLS.has(remoteKey)) {
    if (v === undefined || v === null || v === '' || v === false || v === 0 || v === '0' || v === 'false') return null;
    return true;
  }
  // Text / timestamp / jsonb: empty ≡ absent, everything else verbatim.
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

// Fingerprint of a flight's SYNCABLE CONTENT, computed from a cloud-shaped row.
// rowToLocalFlight() drops all sync/server metadata (client_updated_at, op_id,
// device_id, updated_at, deleted_at); _sigField() then canonicalises per column
// type so the fingerprint is identical whether it comes from a row we pushed or
// one we pulled — that's what lets pushAllFlights tell a real content change
// from an unchanged row. (Audit item 7.)
function rowSyncSig(row) {
  const f = rowToLocalFlight(row);
  const canon = {};
  for (const k of Object.keys(f).sort()) {
    const out = _sigField(FLIGHT_FIELD_MAP[k], f[k]);
    if (out !== null) canon[k] = out;
  }
  return _cyrb53(JSON.stringify(canon));
}

// ─────────────────────────────────────────────────────────────────
// Sync module — public surface used by 02-data.js, 07-profile.js,
// 08-flight-form.js, 99-init.js.
// ─────────────────────────────────────────────────────────────────
const Sync = {
  // Called from saveFlight() after the local write succeeds.
  async pushFlight(flight) {
    if (!Auth.isAuthenticated()) return;
    const row = localFlightToRow(flight, Auth.currentUserId());
    try {
      const { error } = await Auth.client.from('flights').upsert(row, { onConflict: 'id' });
      if (error) {
        console.warn('[Sync] pushFlight failed, queuing:', error.message);
        this._enqueue({ type: 'upsert_flight', payload: row });
        return;
      }
    } catch (e) {
      console.warn('[Sync] pushFlight threw, queuing:', e);
      this._enqueue({ type: 'upsert_flight', payload: row });
      return;
    }
    // Persist the (possibly minted) id and stamp the LWW marker so a
    // subsequent pullFlights doesn't clobber this fresh local write.
    let dirty = false;
    if (!flight.id) { flight.id = row.id; dirty = true; }
    flight._updated_at = row.client_updated_at;
    // Record the synced fingerprint so the bulk auto-sync won't re-push this
    // same row (which would re-stamp it over another device's later edit).
    const _sm = this._loadSyncedSig();
    _sm[flight.id] = rowSyncSig(row);
    this._saveSyncedSig(_sm);
    if (dirty) {
      this._suppressAutoSync = true;
      try { DB.save(flights); } finally { this._suppressAutoSync = false; }
    }
  },

  // Soft delete (deleted_at) instead of hard DELETE: other devices still
  // hold this flight locally and would re-upsert it on their next auto-sync,
  // resurrecting the row. With deleted_at set, their next pullFlights
  // removes it locally instead. Called from deleteFlight() in
  // 05-form-helpers.js after the local removal succeeds.
  async deleteFlight(flightId) {
    if (!Auth.isAuthenticated() || !flightId) return;
    // Drop the synced fingerprint so the map doesn't leak entries over deletes.
    const _sm = this._loadSyncedSig();
    if (flightId in _sm) { delete _sm[flightId]; this._saveSyncedSig(_sm); }
    const stamp = new Date().toISOString();
    try {
      const { error } = await Auth.client.from('flights')
        .update({ deleted_at: stamp }).eq('id', flightId);
      if (error) {
        console.warn('[Sync] deleteFlight failed, queuing:', error.message);
        this._enqueue({ type: 'delete_flight', payload: { id: flightId, deleted_at: stamp } });
      }
    } catch (e) {
      console.warn('[Sync] deleteFlight threw, queuing:', e);
      this._enqueue({ type: 'delete_flight', payload: { id: flightId, deleted_at: stamp } });
    }
  },

  // Pull remote flights for cross-device sync. MERGE strategy: remote rows
  // not in local → append; both exist → keep the higher updated_at.
  // Delete reconciliation (audit 2026-06-09): rows with deleted_at set are
  // removed locally (+ tombstoned); never re-adopted. Rows matching a local
  // tombstone are skipped — covers the window where this device deleted a
  // flight but the cloud soft-delete is still queued offline.
  async pullFlights() {
    if (!Auth.isAuthenticated()) return;
    let data, error;
    try {
      const resp = await Auth.client.from('flights').select('*');
      data = resp.data; error = resp.error;
    } catch (e) {
      console.warn('[Sync] pullFlights threw:', e);
      return;
    }
    if (error) { console.warn('[Sync] pullFlights failed:', error.message); return; }
    if (!data || !data.length) return;

    const byId = new Map(flights.map(f => [f.id, f]));
    let added = 0, updated = 0, removed = 0;

    // Ids with unpushed local changes — remote LWW must NEVER clobber a local
    // edit that hasn't reached the cloud yet (offline edit loss). (Opus audit.)
    const pendingIds = new Set();
    try {
      this._loadQueue().forEach(op => {
        if ((op.type === 'upsert_flight' || op.type === 'delete_flight') && op.payload && op.payload.id) {
          pendingIds.add(op.payload.id);
        }
      });
    } catch (e) { /* queue unreadable — treat as no pending */ }

    // When crew-name consent is OFF, remote pic/copilot are stored anonymized.
    // We must never let those overwrite the fuller names kept in the local
    // certifiable logbook ("store full locally, anonymize only at egress").
    const _syncProf = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
    const _consentOn = !!_syncProf.consentCaptainNames;
    // Baseline the synced fingerprint from the cloud so auto-sync won't
    // re-push a row we just received (and re-stamp it over another device's
    // edit). Set for every non-deleted remote row below; dropped for deleted.
    const synced = this._loadSyncedSig();
    data.forEach(row => {
      const remote = rowToLocalFlight(row);
      if (row.deleted_at) {
        // Another device deleted this flight. Remove the local copy and
        // record a tombstone so the iCal merge can't resurrect it either.
        const localDeleted = byId.get(remote.id);
        if (localDeleted) {
          if (typeof recordTombstone === 'function') recordTombstone(localDeleted);
          flights = flights.filter(f => f.id !== remote.id);
          byId.delete(remote.id);
          removed++;
        }
        delete synced[remote.id];
        return;
      }
      const local = byId.get(remote.id);
      if (!local) {
        if (typeof isTombstoned === 'function' && isTombstoned(remote)) return;
        remote._updated_at = row.updated_at || row.client_updated_at || '';
        flights.push(remote);
        byId.set(remote.id, remote);
        synced[remote.id] = rowSyncSig(row);
        added++;
        return;
      }
      // LWW: remote row wins iff its updated_at is strictly later than
      // the local _updated_at marker (stamped on every successful push).
      // First-ever local edit has _updated_at='' so any remote wins —
      // intentional: we trust the cloud after migration completion.
      const lU = local._updated_at || '';
      const rU = row.updated_at || row.client_updated_at || '';
      // Remote wins only if strictly newer AND there is no unpushed local edit
      // for this id (otherwise the local change would be silently lost).
      if (rU > lU && !pendingIds.has(remote.id)) {
        const incoming = { ...remote };
        // Protect local full crew names from anonymized remote values.
        if (!_consentOn) { delete incoming.pic; delete incoming.copilot; }
        // Never let a NULL cloud navblue_uid erase a locally-known iCal UID:
        // every cloud row pushed before the field-map fix (2026-07-04) has
        // navblue_uid NULL, and the next push is what backfills it there.
        if (incoming.navblueUid == null) delete incoming.navblueUid;
        Object.assign(local, incoming);
        local._updated_at = rU;
        updated++;
      }
      // Baseline against the cloud content. If remote won, local now matches it
      // (not dirty). If LOCAL won (newer unpushed edit), synced holds the older
      // cloud sig so pushAllFlights still pushes the local change. Either way,
      // an unchanged row is never needlessly re-pushed over another device.
      synced[remote.id] = rowSyncSig(row);
    });

    this._saveSyncedSig(synced);
    if (added || updated || removed) {
      // Suppress auto-sync: this DB.save is purely a download-side
      // reconciliation, not a user edit. Re-pushing here would create
      // a feedback loop with the trigger that just updated `updated_at`.
      this._suppressAutoSync = true;
      try { DB.save(flights); } finally { this._suppressAutoSync = false; }
      if (typeof renderDashboard === 'function') renderDashboard();
      showToast(t('sync.pulled', { added, updated }), 'success');
    }
  },

  async pushProfile(profile) {
    if (!Auth.isAuthenticated()) return;
    // Some settings live in localStorage rather than the profile object
    // (Navblue iCal URL, language, dark mode, column prefs). Read them here
    // so cross-device sync actually carries them — otherwise they push blank
    // and a 2nd device stays empty (audit 2026-06-30 cause #2). These columns
    // already exist in `profiles`; no schema change.
    const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const navblueUrl = profile.navblueUrl || ls('cumulo_navblue_url') || null;
    const lang = profile.lang || ls('cumulo_lang') || 'en';
    const darkMode = (profile.darkMode !== undefined) ? !!profile.darkMode : (ls('logbook_dark') === '1');
    let columnPrefs = profile.columnPrefs;
    if (!columnPrefs) {
      try { columnPrefs = JSON.parse(ls('cumulo_column_prefs_v1') || '{}'); } catch (e) { columnPrefs = {}; }
    }
    const row = {
      id: Auth.currentUserId(),
      fname: profile.fname || null,
      lname: profile.lname || null,
      rank: profile.rank || null,
      airline: profile.airline || null,
      license: profile.license || null,
      medical: profile.medical || null,
      ecg: profile.ecg || null,
      base: profile.base || null,
      fleet: profile.fleet || null,
      operator_codes: profile.operatorCodes || null,
      navblue_url: navblueUrl,
      pilot_type: profile.pilotType || 'airline705',
      // Stored key is `autoCountIFR` (uppercase); the old `autoCountIfr` read
      // was always undefined → always pushed true (audit cause #3).
      auto_count_ifr: profile.autoCountIFR !== false,
      consent_captain_names: !!profile.consentCaptainNames,
      hide_zero_columns: !!profile.hideZeroColumns,
      lang: lang,
      dark_mode: darkMode,
      ac_configs: profile.acConfigs || ['wheels'],
      column_prefs: columnPrefs || {},
      // Fields synced since the 2026-07-01 Supabase ALTER (audit cause #2).
      // ppcDueDate / personalGoal* live on the profile object; signature +
      // onboarded live in localStorage (read via ls()).
      ppc_due_date: profile.ppcDueDate || null,
      personal_goal_hrs: (profile.personalGoalHrs != null && profile.personalGoalHrs !== '') ? +profile.personalGoalHrs : null,
      personal_goal_kind: profile.personalGoalKind || null,
      personal_goal_context: profile.personalGoalContext || null,
      signature: ls('logbook_signature') || null,
      onboarded: !!ls('cumulo_onboarded_v1'),
    };
    const { error } = await Auth.client.from('profiles').upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn('[Sync] pushProfile failed, queuing:', error.message);
      this._enqueue({ type: 'upsert_profile', payload: row });
    }
  },

  // Pull the cloud profile for cross-device sync. FILL-EMPTY merge: a remote
  // value is adopted only when the local one is absent/blank — a pilot-entered
  // value is NEVER overwritten (certifiable rule). Restores the device-scoped
  // localStorage keys (Navblue URL, language, dark mode, column prefs) so the
  // "connect iCal" card (02-data.js) and monthly-PDF routing (06-photo-import.js),
  // which read localStorage directly, stop firing spuriously on a 2nd device.
  // ppcDueDate / personalGoal* / signature / onboarded are also pulled now —
  // their columns were added by the 2026-07-01 Supabase ALTER. Same fill-empty
  // rule (a pilot-entered value is never overwritten).
  async pullProfile() {
    if (!Auth.isAuthenticated()) return;
    let data, error;
    try {
      const resp = await Auth.client.from('profiles')
        .select('*').eq('id', Auth.currentUserId());
      data = resp.data; error = resp.error;
    } catch (e) {
      console.warn('[Sync] pullProfile threw:', e);
      return;
    }
    if (error) { console.warn('[Sync] pullProfile failed:', error.message); return; }
    const row = data && data[0];
    if (!row) return;  // no cloud profile row yet

    const local = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
    let changed = false;
    const isBlank = (v) => v === undefined || v === null || v === '';
    const fillStr = (localKey, remoteVal) => {
      if (!isBlank(remoteVal) && isBlank(local[localKey])) { local[localKey] = remoteVal; changed = true; }
    };
    fillStr('fname', row.fname);
    fillStr('lname', row.lname);
    fillStr('rank', row.rank);
    fillStr('airline', row.airline);
    fillStr('license', row.license);
    fillStr('medical', row.medical);
    fillStr('ecg', row.ecg);
    fillStr('base', row.base);
    fillStr('fleet', row.fleet);
    fillStr('operatorCodes', row.operator_codes);
    fillStr('pilotType', row.pilot_type);
    // Certifiable + tracker fields (columns added 2026-07-01). Fill-empty only —
    // ppcDueDate is certifiable, so a local date is never clobbered.
    fillStr('ppcDueDate', row.ppc_due_date);
    fillStr('personalGoalKind', row.personal_goal_kind);
    fillStr('personalGoalContext', row.personal_goal_context);
    if (isBlank(local.personalGoalHrs) && !isBlank(row.personal_goal_hrs)) {
      local.personalGoalHrs = +row.personal_goal_hrs; changed = true;
    }

    // Booleans / arrays: adopt only when the key is genuinely unset locally,
    // so a pilot who explicitly turned something off keeps that choice.
    if (local.autoCountIFR === undefined && row.auto_count_ifr !== undefined && row.auto_count_ifr !== null) {
      local.autoCountIFR = !!row.auto_count_ifr; changed = true;
    }
    if (local.consentCaptainNames === undefined && row.consent_captain_names !== undefined && row.consent_captain_names !== null) {
      local.consentCaptainNames = !!row.consent_captain_names; changed = true;
    }
    if (local.hideZeroColumns === undefined && row.hide_zero_columns !== undefined && row.hide_zero_columns !== null) {
      local.hideZeroColumns = !!row.hide_zero_columns; changed = true;
    }
    if ((!Array.isArray(local.acConfigs) || !local.acConfigs.length) && Array.isArray(row.ac_configs) && row.ac_configs.length) {
      local.acConfigs = row.ac_configs.slice(); changed = true;
    }

    if (changed) DB.saveProfile(local);

    // Device-scoped settings kept in localStorage — restore only when absent
    // on this device (never overwrite a local choice).
    try {
      const nbKey = (typeof NAVBLUE_URL_KEY !== 'undefined') ? NAVBLUE_URL_KEY : 'cumulo_navblue_url';
      if (!localStorage.getItem(nbKey) && row.navblue_url) {
        localStorage.setItem(nbKey, row.navblue_url);
      }
      if (!localStorage.getItem('cumulo_lang') && row.lang) {
        localStorage.setItem('cumulo_lang', row.lang);
      }
      if (localStorage.getItem('logbook_dark') === null && (row.dark_mode === true || row.dark_mode === false)) {
        localStorage.setItem('logbook_dark', row.dark_mode ? '1' : '0');
      }
      if (!localStorage.getItem('cumulo_column_prefs_v1') && row.column_prefs && Object.keys(row.column_prefs).length) {
        localStorage.setItem('cumulo_column_prefs_v1', JSON.stringify(row.column_prefs));
      }
      // Signature (base64) — restore only if this device has none, so the PDF
      // signature block works on a 2nd device without re-drawing it.
      if (!localStorage.getItem('logbook_signature') && row.signature) {
        localStorage.setItem('logbook_signature', row.signature);
      }
      // Onboarding flag — if the cloud says this pilot already onboarded, don't
      // re-trigger the wizard on a fresh device.
      if (localStorage.getItem('cumulo_onboarded_v1') === null && row.onboarded === true) {
        localStorage.setItem('cumulo_onboarded_v1', 'done');
      }
    } catch (e) { /* storage unavailable — non-fatal */ }

    if (typeof renderDashboard === 'function') renderDashboard();
  },

  // ─── Opening balances (brought-forward hours) cross-device sync ──────
  // The paper-logbook attestation (hours + cutoff + attest date + SHA-256 hash)
  // lived only in localStorage (audit cause #5) → a 2nd device showed 0 h and
  // the career total diverged. Push on save, fill-empty pull on sign-in.
  async pushOpeningBalances() {
    if (!Auth.isAuthenticated()) return;
    if (typeof loadOpeningBalances !== 'function') return;
    const rec = loadOpeningBalances();
    // Only push a real attestation. An empty record must never clobber a cloud
    // attestation made on another device.
    if (!rec || !rec.balances || !Object.keys(rec.balances).length) return;
    const row = {
      user_id: Auth.currentUserId(),
      balances: rec.balances,
      attested_at: rec.attestedAt || null,
      cutoff_date: rec.cutoffDate || null,
      hash: rec.hash || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await Auth.client.from('opening_balances').upsert(row, { onConflict: 'user_id' });
    if (error) {
      console.warn('[Sync] pushOpeningBalances failed, queuing:', error.message);
      this._enqueue({ type: 'upsert_opening_balances', payload: row });
    }
  },

  async pullOpeningBalances() {
    if (!Auth.isAuthenticated()) return;
    if (typeof loadOpeningBalances !== 'function') return;
    // Fill-empty: never clobber a local attestation. Only adopt the cloud
    // record when this device has declared no opening balances of its own.
    const localRec = loadOpeningBalances();
    if (localRec && localRec.balances && Object.keys(localRec.balances).length) return;
    let data, error;
    try {
      const resp = await Auth.client.from('opening_balances')
        .select('*').eq('user_id', Auth.currentUserId());
      data = resp.data; error = resp.error;
    } catch (e) { console.warn('[Sync] pullOpeningBalances threw:', e); return; }
    if (error) { console.warn('[Sync] pullOpeningBalances failed:', error.message); return; }
    const row = data && data[0];
    if (!row || !row.balances || !Object.keys(row.balances).length) return;
    const record = {
      balances: row.balances,
      cutoffDate: row.cutoff_date || null,
      attestedAt: row.attested_at || null,
      hash: row.hash || null,
    };
    try {
      localStorage.setItem(OPENING_BALANCES_KEY, JSON.stringify(record));
    } catch (e) { return; }
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderLogbook === 'function') renderLogbook(typeof filterVal !== 'undefined' ? filterVal : '');
  },

  // ─── Migration (one-shot per device) ────────────────────────────
  async runMigrationIfNeeded() {
    if (!Auth.isAuthenticated()) return;
    const state = this._loadMigrationState();
    if (state && state.completedAt) return;  // already done on this device
    if (!flights.length) {
      // Nothing to migrate — record completion so we don't re-check.
      this._saveMigrationState({ completedAt: new Date().toISOString(), uploaded: 0, signature: '' });
      return;
    }

    // Re-prompt cool-down: if the user already said "later" within the
    // last 24h, skip re-asking. Avoids the modal on every signin.
    if (state && state.deferredAt) {
      const elapsedH = (Date.now() - new Date(state.deferredAt).getTime()) / 3.6e6;
      if (elapsedH < 24) return;
    }

    const migrationOk = await confirmDialog({
      title: getLang && getLang() === 'fr' ? 'Associer les vols au nuage' : 'Link flights to cloud',
      body: t('sync.migration.prompt', { n: flights.length }),
      confirmLabel: t('btn.confirm'),
      cancelLabel: t('btn.cancel'),
    });
    if (!migrationOk) {
      // Persist a "deferred" marker so we don't ask again for 24h.
      this._saveMigrationState({ deferredAt: new Date().toISOString() });
      return;
    }

    // Suppress the auto-sync patch while migration runs — the migration
    // does its own batched upserts and we don't want every internal
    // DB.save to trigger a duplicate full-table push.
    this._suppressAutoSync = true;
    try {
      return await this._runMigrationCore(state);
    } finally {
      this._suppressAutoSync = false;
    }
  },

  async _runMigrationCore(state) {

    // 1. Pre-flight snapshot (reuse existing zero-data-loss primitive)
    if (typeof snapshotBeforeOperation === 'function') {
      snapshotBeforeOperation('Cloud migration to Supabase');
      if (typeof updateUndoButton === 'function') updateUndoButton();
    }

    // 2. Independent pre-migration backup (separate from rolling snapshots)
    try {
      localStorage.setItem(PREMIGRATION_BACKUP_KEY, JSON.stringify({
        timestamp: Date.now(),
        flights: flights,
        retainUntil: Date.now() + PREMIGRATION_RETENTION_DAYS * 86400000,
      }));
    } catch (e) {
      console.warn('[Sync] premigration backup quota exceeded:', e);
    }

    // 3. Normalize ids: re-key any missing OR non-UUID id to a real UUID.
    //    Legacy local ids (Date.now(), 'csv-...', etc.) fail the uuid-typed
    //    cloud column ("invalid input syntax for type uuid"). Re-keyed in
    //    place + persisted so local and remote share the same id.
    normalizeFlightIds();

    // 4. Batched upserts — resume from previously-saved cursor if we
    //    were interrupted (network drop) on a prior attempt.
    const userId = Auth.currentUserId();
    let uploaded = 0, failedBatches = 0;
    const startedAt = Date.now();
    const startCursor = (state && Number.isFinite(state.batchCursor)) ? state.batchCursor : 0;
    if (startCursor > 0) {
      console.log(`[Sync] resuming migration at batch cursor ${startCursor}/${flights.length}`);
    }
    const migSynced = this._loadSyncedSig();
    for (let i = startCursor; i < flights.length; i += MIGRATION_BATCH_SIZE) {
      const slice = flights.slice(i, i + MIGRATION_BATCH_SIZE);
      const rows = slice.map(f => localFlightToRow(f, userId));
      const { error } = await Auth.client.from('flights').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.warn(`[Sync] migration batch ${i}-${i + slice.length} failed:`, error.message);
        failedBatches++;
        // Save resume cursor so a retry continues where we stopped.
        this._saveMigrationState({
          startedAt: new Date(startedAt).toISOString(),
          batchCursor: i,
          lastError: error.message,
        });
        showToast(t('sync.migration.failed') + ' ' + error.message, 'error');
        return;
      }
      uploaded += slice.length;
      // Stamp the LWW marker + record the synced fingerprint on each uploaded
      // flight so the first auto-sync after migration doesn't re-push the whole
      // table (which would re-stamp every row).
      slice.forEach((f, k) => {
        f._updated_at = rows[k].client_updated_at;
        migSynced[f.id] = rowSyncSig(rows[k]);
      });
    }
    this._saveSyncedSig(migSynced);

    // 5. Signature verify — pull the remote id-set back and diff against
    //    local. The previous version just compared `remoteCount` to
    //    `flights.length`, which is a coincidence test: a concurrent
    //    insert from another device, or a partial-row write that landed
    //    without all columns, could pass the count equality while the
    //    data was actually wrong.
    //
    //    Now we compare actual id sets — every local id must appear in
    //    the remote set, otherwise the migration is incomplete and we
    //    don't mark it as done.
    const { data: remoteIds, error: idsErr } = await Auth.client
      .from('flights').select('id')
      .eq('user_id', userId);
    if (idsErr) {
      console.warn('[Sync] migration verify failed:', idsErr.message);
    }
    const remoteCount = remoteIds ? remoteIds.length : 0;
    const remoteIdSet = new Set((remoteIds || []).map(r => r.id));
    const missingFromRemote = [];
    for (const f of flights) {
      if (f && f.id && !remoteIdSet.has(f.id)) missingFromRemote.push(f.id);
    }
    const signatureOK = !idsErr && missingFromRemote.length === 0;
    if (!signatureOK && !idsErr) {
      console.warn(`[Sync] migration verify: ${missingFromRemote.length} local flight id(s) not found in remote — first few:`,
        missingFromRemote.slice(0, 5));
    }

    // 6. Migration audit log (same standard as 16-csv-import.js)
    const log = JSON.parse(localStorage.getItem(MIGRATION_LOG_KEY) || '[]');
    log.unshift({
      timestamp: new Date().toISOString(),
      buildVersion: typeof BUILD_VERSION !== 'undefined' ? BUILD_VERSION : 'unknown',
      uploaded: uploaded,
      failedBatches,
      flightCountLocal: flights.length,
      remoteCount: remoteCount,
      missingFromRemoteCount: missingFromRemote.length,
      missingFromRemoteSample: missingFromRemote.slice(0, 10),
      signatureOK,
      signature: signatureOK ? 'id-set-match' : (idsErr ? 'verify-error' : 'id-set-mismatch'),
      durationMs: Date.now() - startedAt,
      userId,
      deviceId: getDeviceId(),
    });
    localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify(log.slice(0, 50)));

    // 7. Mark migration complete (only if signature verified)
    if (signatureOK) {
      this._saveMigrationState({
        completedAt: new Date().toISOString(),
        uploaded,
        signature: 'id-set-match',
      });
      showToast(t('sync.migration.success', { n: uploaded }), 'success');
    } else {
      showToast(t('sync.migration.partial'), 'error');
    }
  },

  _loadMigrationState() {
    try { return JSON.parse(localStorage.getItem(MIGRATION_STATE_KEY) || 'null'); }
    catch { return null; }
  },

  _saveMigrationState(state) {
    localStorage.setItem(MIGRATION_STATE_KEY, JSON.stringify(state));
  },

  // ─── Offline queue (skeleton: localStorage, TODO IndexedDB) ─────
  _enqueue(op) {
    op.op_id = newUUID();
    op.queuedAt = new Date().toISOString();
    op.attempts = 0;
    const q = this._loadQueue();
    q.push(op);
    try {
      localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(q));
    } catch (e) {
      // QuotaExceeded — drop oldest 25% to make room (same pattern as
      // saveSnapshots in 02-data.js).
      console.warn('[Sync] queue quota exceeded — dropping oldest 25%', e);
      const trim = q.slice(Math.floor(q.length * 0.25));
      try { localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(trim)); }
      catch (e2) { console.warn('[Sync] second-pass quota still failing:', e2); }
    }
  },

  _loadQueue() {
    try { return JSON.parse(localStorage.getItem(PENDING_OPS_KEY) || '[]'); }
    catch { return []; }
  },

  // Drain queue on signin + on `online` event.
  async drainQueue() {
    if (!Auth.isAuthenticated()) return;
    const q = this._loadQueue();
    if (!q.length) return;
    const remaining = [];
    // A poisoned op must never live in the queue forever (silent sync
    // outage). Flights are re-pushed wholesale by pushAllFlights on every
    // local save, so dropping a stuck op after enough attempts never
    // strands data — it just stops the retry noise.
    const MAX_OP_ATTEMPTS = 10;
    const requeue = (op) => {
      op.attempts = (op.attempts || 0) + 1;
      if (op.attempts < MAX_OP_ATTEMPTS) { remaining.push(op); return; }
      console.warn('[Sync] dropping queued op after', op.attempts, 'attempts:', op.type, op.payload && op.payload.id);
    };
    for (const op of q) {
      try {
        if (op.type === 'upsert_flight') {
          coerceRowTypes(op.payload);
          let { error } = await Auth.client.from('flights').upsert(op.payload, { onConflict: 'id' });
          if (error && error.code === '23505' && op.payload.navblue_uid) {
            // Dedup-index collision — same fallback as pushAllFlights:
            // push the row without its navblue_uid rather than fail forever.
            const retry = { ...op.payload };
            delete retry.navblue_uid;
            ({ error } = await Auth.client.from('flights').upsert(retry, { onConflict: 'id' }));
          }
          if (error) requeue(op);
        } else if (op.type === 'delete_flight') {
          // Soft delete — mirror Sync.deleteFlight (see comment there).
          const { error } = await Auth.client.from('flights')
            .update({ deleted_at: op.payload.deleted_at || new Date().toISOString() })
            .eq('id', op.payload.id);
          if (error) requeue(op);
        } else if (op.type === 'upsert_profile') {
          const { error } = await Auth.client.from('profiles').upsert(op.payload, { onConflict: 'id' });
          if (error) requeue(op);
        } else if (op.type === 'upsert_opening_balances') {
          const { error } = await Auth.client.from('opening_balances').upsert(op.payload, { onConflict: 'user_id' });
          if (error) requeue(op);
        }
      } catch (e) {
        requeue(op);
      }
    }
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(remaining));
    if (q.length !== remaining.length) {
      console.log(`[Sync] drained ${q.length - remaining.length}/${q.length} queued ops`);
    }
  },

  // ─── GC for premigration backup (after 90 days) ─────────────────
  gcPremigrationBackup() {
    try {
      const raw = localStorage.getItem(PREMIGRATION_BACKUP_KEY);
      if (!raw) return;
      const bk = JSON.parse(raw);
      if (bk.retainUntil && bk.retainUntil < Date.now()) {
        localStorage.removeItem(PREMIGRATION_BACKUP_KEY);
        console.log('[Sync] premigration backup garbage-collected (>90d old)');
      }
    } catch (e) {
      console.warn('[Sync] gcPremigrationBackup failed:', e);
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// Auto-sync — patches DB.save / DB.saveProfile so every local write
// also enqueues a remote push. Avoids touching the 17 existing DB.save
// callsites. Debounced (800 ms) to coalesce bulk recalc/restore writes
// into a single batch. Suppressed during migration to avoid re-entry.
// ─────────────────────────────────────────────────────────────────
Sync._autoSyncTimer = null;
Sync._suppressAutoSync = false;

// Persisted map: flight id → fingerprint of its content as last seen on the
// cloud (pushed or pulled). pushAllFlights pushes only flights whose current
// fingerprint differs. (Audit item 7.)
Sync._loadSyncedSig = function () {
  try { return JSON.parse(localStorage.getItem(SYNCED_SIG_KEY) || '{}') || {}; }
  catch { return {}; }
};
Sync._saveSyncedSig = function (map) {
  try { localStorage.setItem(SYNCED_SIG_KEY, JSON.stringify(map)); }
  catch (e) { console.warn('[Sync] synced-sig save failed:', e); }
};

Sync._scheduleAutoSync = function () {
  if (!Auth.isAuthenticated() || this._suppressAutoSync) return;
  if (this._autoSyncTimer) clearTimeout(this._autoSyncTimer);
  this._autoSyncTimer = setTimeout(() => {
    this._autoSyncTimer = null;
    this.pushAllFlights().catch(e => console.warn('[Sync] auto-sync error:', e));
  }, 800);
};

// Push only the flights whose content changed since we last synced them.
// Re-pushing an unchanged row re-stamps its updated_at and can clobber a
// newer edit another device made (audit item 7). The per-flight fingerprint
// map is the diff; it's refreshed here and on every pull.
Sync.pushAllFlights = async function () {
  if (!Auth.isAuthenticated() || !flights.length) return;
  // Coerce any legacy/non-UUID ids before upload (cloud id column is uuid).
  normalizeFlightIds();
  const userId = Auth.currentUserId();
  const synced = this._loadSyncedSig();
  // Cold start: no fingerprint map yet (e.g. first run after this update for a
  // user who migrated under the old build). Seeding from flights that already
  // carry an _updated_at marker (= previously synced) avoids re-pushing the
  // whole table, which would re-stamp every row and clobber other devices.
  // The first pull re-baselines everything anyway; genuinely new/edited
  // flights (no marker) are still pushed below.
  const coldStart = Object.keys(synced).length === 0;
  const dirty = [];
  for (const f of flights) {
    const row = localFlightToRow(f, userId);
    const sig = rowSyncSig(row);
    if (synced[f.id] === sig) continue;               // already in sync
    if (coldStart && f._updated_at) { synced[f.id] = sig; continue; }  // presumed already synced
    dirty.push({ f, row, sig });
  }
  if (!dirty.length) { this._saveSyncedSig(synced); return; }   // seed persisted; nothing to push
  for (let i = 0; i < dirty.length; i += MIGRATION_BATCH_SIZE) {
    const slice = dirty.slice(i, i + MIGRATION_BATCH_SIZE);
    const rows = slice.map(p => p.row);
    const failedIds = new Set();
    try {
      const { error } = await Auth.client.from('flights').upsert(rows, { onConflict: 'id' });
      if (error && error.code === '23505') {
        // navblue_uid dedup-index collision: two rows with different ids
        // claim the same UID (e.g. duplicate segments imported by two
        // devices before the field-map fix). The batch upsert is atomic,
        // so retry row-by-row and strip navblue_uid from the offenders —
        // sync must never silently stop for 200 flights because one row
        // is a known duplicate. The duplicate itself is surfaced in the
        // console; resolving it is the Lot 1 sync overhaul's job.
        console.warn('[Sync] navblue_uid collision — retrying batch row-by-row');
        for (const row of rows) {
          let r = await Auth.client.from('flights').upsert(row, { onConflict: 'id' });
          if (r.error && r.error.code === '23505') {
            const retry = { ...row };
            delete retry.navblue_uid;
            r = await Auth.client.from('flights').upsert(retry, { onConflict: 'id' });
            if (!r.error) console.warn('[Sync] pushed flight', row.id, 'without navblue_uid (UID already held by another row — duplicate segment?)');
          }
          if (r.error) {
            failedIds.add(row.id);
            this._enqueue({ type: 'upsert_flight', payload: row });
          }
        }
      } else if (error) {
        console.warn('[Sync] auto-sync batch failed, queuing rows:', error.message);
        rows.forEach(row => this._enqueue({ type: 'upsert_flight', payload: row }));
        return;
      }
    } catch (e) {
      console.warn('[Sync] auto-sync threw, queuing rows:', e);
      rows.forEach(row => this._enqueue({ type: 'upsert_flight', payload: row }));
      return;
    }
    // Persist any newly-minted ids + stamp the LWW marker so pulls won't
    // clobber what we just pushed, and record the synced fingerprint so this
    // row won't be re-pushed until it actually changes again. Rows that failed
    // even the row-by-row fallback keep their old marker/sig (they didn't reach
    // the cloud, so the cloud must still be allowed to win).
    slice.forEach((p, k) => {
      if (!p.f.id) p.f.id = rows[k].id;
      if (!failedIds.has(rows[k].id)) {
        p.f._updated_at = rows[k].client_updated_at;
        synced[p.f.id] = p.sig;
      }
    });
  }
  this._saveSyncedSig(synced);
  // Wrap the trailing local save so it doesn't trigger another debounced
  // push (would create a phantom feedback loop).
  this._suppressAutoSync = true;
  try { DB.save(flights); } finally { this._suppressAutoSync = false; }
};

// Patch DB.save / DB.saveProfile once Auth + Sync are available.
function installAutoSyncPatch() {
  if (typeof DB === 'undefined' || DB._cumuloPatched) return;
  DB._cumuloPatched = true;
  const _origSave = DB.save.bind(DB);
  DB.save = function (flightsArr) {
    _origSave(flightsArr);
    Sync._scheduleAutoSync();
  };
  const _origSaveProfile = DB.saveProfile.bind(DB);
  DB.saveProfile = function (p) {
    _origSaveProfile(p);
    if (Auth.isAuthenticated() && !Sync._suppressAutoSync) {
      Sync.pushProfile(p).catch(e => console.warn('[Sync] pushProfile error:', e));
    }
  };
}

// ─────────────────────────────────────────────────────────────────
// Wire `online` event so we drain the queue when connectivity returns.
// (Safe to call multiple times — the listener is idempotent by reference.)
// ─────────────────────────────────────────────────────────────────
function wireSyncEvents() {
  installAutoSyncPatch();
  if (window.__cumulo_sync_wired) return;
  window.__cumulo_sync_wired = true;
  // One-time purge of the offline queue. Early go-live builds queued rows
  // with legacy ids / empty-string numerics that can never upsert; migration
  // re-uploads everything cleanly, so those queued ops are pure garbage.
  // Version-gated so we never wipe a legitimately-queued offline edit later.
  try {
    if (!localStorage.getItem('cumulo_queue_purged_v1')) {
      localStorage.removeItem(PENDING_OPS_KEY);
      localStorage.setItem('cumulo_queue_purged_v1', new Date().toISOString());
    }
  } catch (e) { /* non-fatal */ }
  window.addEventListener('online', () => {
    if (Auth.isAuthenticated()) Sync.drainQueue();
  });
}
