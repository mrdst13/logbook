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
  navblue_uid: 'navblue_uid',
  signedBy: 'signed_by',
  signedAt: 'signed_at',
};

const FLIGHT_FIELD_MAP_INV = (() => {
  const inv = {};
  for (const [local, remote] of Object.entries(FLIGHT_FIELD_MAP)) inv[remote] = local;
  return inv;
})();

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
  if (typeof DB !== 'undefined' && typeof gateCaptainName === 'function') {
    const profile = DB.loadProfile();
    if (profile && !profile.consentCaptainNames) {
      if (typeof row.pic === 'string')     row.pic = gateCaptainName(row.pic, profile);
      if (typeof row.copilot === 'string') row.copilot = gateCaptainName(row.copilot, profile);
    }
  }
  // Mint id if missing
  if (!row.id) row.id = newUUID();
  // Sync metadata
  row.client_updated_at = new Date().toISOString();
  row.device_id = getDeviceId();
  row.op_id = opId || newUUID();
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
    if (dirty) {
      this._suppressAutoSync = true;
      try { DB.save(flights); } finally { this._suppressAutoSync = false; }
    }
  },

  async deleteFlight(flightId) {
    if (!Auth.isAuthenticated()) return;
    const { error } = await Auth.client.from('flights').delete().eq('id', flightId);
    if (error) {
      console.warn('[Sync] deleteFlight failed, queuing:', error.message);
      this._enqueue({ type: 'delete_flight', payload: { id: flightId } });
    }
  },

  // Pull remote flights for cross-device sync. MERGE strategy: remote rows
  // not in local → append; both exist → keep the higher updated_at.
  // Note: delete reconciliation is NOT wired (skeleton). A flight deleted
  // on device A will continue to appear on device B until we add a
  // soft-delete (deleted_at) column + filter. TODO before pilot users.
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
    let added = 0, updated = 0;
    data.forEach(row => {
      const remote = rowToLocalFlight(row);
      const local = byId.get(remote.id);
      if (!local) {
        remote._updated_at = row.updated_at || row.client_updated_at || '';
        flights.push(remote);
        byId.set(remote.id, remote);
        added++;
        return;
      }
      // LWW: remote row wins iff its updated_at is strictly later than
      // the local _updated_at marker (stamped on every successful push).
      // First-ever local edit has _updated_at='' so any remote wins —
      // intentional: we trust the cloud after migration completion.
      const lU = local._updated_at || '';
      const rU = row.updated_at || row.client_updated_at || '';
      if (rU > lU) {
        Object.assign(local, remote);
        local._updated_at = rU;
        updated++;
      }
    });

    if (added || updated) {
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
      navblue_url: profile.navblueUrl || null,
      pilot_type: profile.pilotType || 'airline705',
      auto_count_ifr: profile.autoCountIfr !== false,
      consent_captain_names: !!profile.consentCaptainNames,
      hide_zero_columns: !!profile.hideZeroColumns,
      lang: profile.lang || 'en',
      dark_mode: !!profile.darkMode,
      ac_configs: profile.acConfigs || ['wheels'],
      column_prefs: profile.columnPrefs || {},
    };
    const { error } = await Auth.client.from('profiles').upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn('[Sync] pushProfile failed, queuing:', error.message);
      this._enqueue({ type: 'upsert_profile', payload: row });
    }
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

    if (!confirm(t('sync.migration.prompt', { n: flights.length }))) {
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

    // 3. Mint stable ids for any flight missing one (persist back to local)
    let mintedCount = 0;
    flights.forEach(f => { if (!f.id) { f.id = newUUID(); mintedCount++; } });
    if (mintedCount) DB.save(flights);

    // 4. Batched upserts — resume from previously-saved cursor if we
    //    were interrupted (network drop) on a prior attempt.
    const userId = Auth.currentUserId();
    let uploaded = 0, failedBatches = 0;
    const startedAt = Date.now();
    const startCursor = (state && Number.isFinite(state.batchCursor)) ? state.batchCursor : 0;
    if (startCursor > 0) {
      console.log(`[Sync] resuming migration at batch cursor ${startCursor}/${flights.length}`);
    }
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
      // Stamp the LWW marker on each successfully-uploaded flight so a
      // subsequent pull doesn't clobber the just-pushed state.
      slice.forEach((f, k) => {
        const ts = rows[k].client_updated_at;
        f._updated_at = ts;
      });
    }

    // 5. Signature verify — pull remote count back and compare.
    const { count: remoteCount, error: cntErr } = await Auth.client
      .from('flights').select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (cntErr) {
      console.warn('[Sync] migration verify failed:', cntErr.message);
    }
    const signatureOK = !cntErr && remoteCount === flights.length;

    // 6. Migration audit log (same standard as 16-csv-import.js)
    const log = JSON.parse(localStorage.getItem(MIGRATION_LOG_KEY) || '[]');
    log.unshift({
      timestamp: new Date().toISOString(),
      buildVersion: typeof BUILD_VERSION !== 'undefined' ? BUILD_VERSION : 'unknown',
      uploaded: uploaded,
      failedBatches,
      flightCountLocal: flights.length,
      remoteCount: remoteCount,
      signatureOK,
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
        signature: 'count-match',
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
    for (const op of q) {
      try {
        if (op.type === 'upsert_flight') {
          const { error } = await Auth.client.from('flights').upsert(op.payload, { onConflict: 'id' });
          if (error) { op.attempts++; remaining.push(op); }
        } else if (op.type === 'delete_flight') {
          const { error } = await Auth.client.from('flights').delete().eq('id', op.payload.id);
          if (error) { op.attempts++; remaining.push(op); }
        } else if (op.type === 'upsert_profile') {
          const { error } = await Auth.client.from('profiles').upsert(op.payload, { onConflict: 'id' });
          if (error) { op.attempts++; remaining.push(op); }
        }
      } catch (e) {
        op.attempts++;
        remaining.push(op);
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

Sync._scheduleAutoSync = function () {
  if (!Auth.isAuthenticated() || this._suppressAutoSync) return;
  if (this._autoSyncTimer) clearTimeout(this._autoSyncTimer);
  this._autoSyncTimer = setTimeout(() => {
    this._autoSyncTimer = null;
    this.pushAllFlights().catch(e => console.warn('[Sync] auto-sync error:', e));
  }, 800);
};

// Push every local flight via batched upsert. Idempotent (ON CONFLICT id).
// TODO post-skeleton: diff against last-pushed snapshot and push only
// changed rows. For skeleton + low-volume users this is acceptably cheap.
Sync.pushAllFlights = async function () {
  if (!Auth.isAuthenticated() || !flights.length) return;
  const userId = Auth.currentUserId();
  for (let i = 0; i < flights.length; i += MIGRATION_BATCH_SIZE) {
    const slice = flights.slice(i, i + MIGRATION_BATCH_SIZE);
    const rows = slice.map(f => localFlightToRow(f, userId));
    try {
      const { error } = await Auth.client.from('flights').upsert(rows, { onConflict: 'id' });
      if (error) {
        console.warn('[Sync] auto-sync batch failed, queuing rows:', error.message);
        rows.forEach(row => this._enqueue({ type: 'upsert_flight', payload: row }));
        return;
      }
    } catch (e) {
      console.warn('[Sync] auto-sync threw, queuing rows:', e);
      rows.forEach(row => this._enqueue({ type: 'upsert_flight', payload: row }));
      return;
    }
    // Persist any newly-minted ids + stamp the LWW marker so pulls
    // won't clobber what we just pushed.
    slice.forEach((f, k) => {
      if (!f.id) f.id = rows[k].id;
      f._updated_at = rows[k].client_updated_at;
    });
  }
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
  window.addEventListener('online', () => {
    if (Auth.isAuthenticated()) Sync.drainQueue();
  });
}
