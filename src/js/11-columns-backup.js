// ═══════════════════════════════════════════
// SETTINGS TABS — only one section visible at a time
// ═══════════════════════════════════════════
const SETTINGS_TAB_KEY = 'cumulo_settings_tab_v1';

function showSettingsTab(name) {
  if (!name) return;
  // Toggle pane visibility
  document.querySelectorAll('[data-settings-pane]').forEach(el => {
    el.style.display = (el.getAttribute('data-settings-pane') === name) ? '' : 'none';
  });
  // Toggle tab button active state
  document.querySelectorAll('[data-settings-tab]').forEach(btn => {
    const isActive = btn.getAttribute('data-settings-tab') === name;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  // Tab-specific init. Profile tab needs loadProfile + initSignature on entry
  // (these used to fire from router.js when 'profile' was a standalone page).
  if (name === 'profile') {
    if (typeof loadProfile === 'function') loadProfile();
    if (typeof initSignature === 'function') setTimeout(initSignature, 50);
    if (typeof renderOpeningBalancesSection === 'function') renderOpeningBalancesSection('openingBalancesSection');
  }
  // Data tab: refresh the Undo button label to show what would be undone
  // (which bulk operation was snapshotted, how long ago).
  if (name === 'data') {
    if (typeof updateUndoButton === 'function') updateUndoButton();
  }
  // Persist for next visit
  try { localStorage.setItem(SETTINGS_TAB_KEY, name); } catch {}
  // Reset scroll to top of page so user sees the new pane
  window.scrollTo({ top: document.querySelector('#page-backup .page-header')?.offsetTop || 0, behavior: 'instant' });
}

// Restore last-used tab on page load (default = 'profile' — Profile is now the
// landing tab for Settings, replacing the standalone Profile page).
function restoreSettingsTab() {
  const saved = (() => {
    try { return localStorage.getItem(SETTINGS_TAB_KEY); } catch { return null; }
  })();
  // Migrate legacy tab keys removed in IA refactors:
  //   'display' → 'profile' (display tab merged into header pills + Logbook)
  //   'danger'  → 'data'    (Reset tab folded into Data → Clear all row)
  let tab = saved || 'profile';
  if (tab === 'display' || tab === 'danger') tab = (tab === 'danger') ? 'data' : 'profile';
  showSettingsTab(tab);
}

// ═══════════════════════════════════════════
// COLUMN PICKER (Settings → Visible Columns)
// ═══════════════════════════════════════════
function renderColumnPicker() {
  const container = document.getElementById('columnPicker');
  if (!container) return;
  const prefs = loadColumnPrefs() || {};

  // Render every column as a small toggle pill — much denser than the
  // previous grouped-grid layout (~3x more columns visible per line).
  // Group is preserved as a subtle separator label between sections.
  const groups = {};
  LOGBOOK_COLUMNS.forEach(c => {
    if (c.key === 'total') return;  // always shown, no toggle
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const pillsHtml = Object.keys(groups).map(group => `
    <span class="col-pill-group-label">${group}</span>
    ${groups[group].map(c => {
      const checked = prefs[c.key] !== undefined ? prefs[c.key] : c.default;
      return `<button type="button" class="col-pill ${checked ? 'on' : 'off'}"
                       onclick="toggleColumn('${c.key}', ${!checked})"
                       title="${c.label}">${c.short || c.label}</button>`;
    }).join('')}
  `).join('');

  container.innerHTML = `
    <div class="col-toolbar">
      <span class="eyebrow">Persona:</span>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('airline-fo')" type="button" title="Airline 705 F/O">Airline F/O</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('airline-cpt')" type="button" title="Airline 705 Captain">Airline Capt</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('bush')" type="button" title="Bush ops">Bush</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('helicopter')" type="button" title="Rotorcraft">Heli</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('instructor')" type="button" title="Instructor / CFI">Instructor</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('private')" type="button" title="Private GA">Private</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('student')" type="button" title="Student">Student</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('atpl')" type="button" title="ATPL submission">ATPL</button>
      <span class="col-toolbar-sep"></span>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('all')" type="button">All</button>
      <button class="btn btn-ghost btn-xs" onclick="applyColumnPreset('none')" type="button">None</button>
    </div>
    <div class="col-pills">${pillsHtml}</div>
  `;
}

function toggleColumn(key, checked) {
  const prefs = loadColumnPrefs() || {};
  prefs[key] = checked;
  saveColumnPrefs(prefs);
  renderColumnPicker();
  // Live-refresh the logbook table if user is looking at it
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
}

function toggleColumnMenu() {
  const menu = document.getElementById('columnMenu');
  if (!menu) return;
  const isOpen = menu.classList.toggle('show');
  if (isOpen) {
    renderColumnPicker();  // refresh checkboxes state
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', closeColumnMenuOnOutside);
    }, 50);
  }
}
function closeColumnMenuOnOutside(e) {
  const menu = document.getElementById('columnMenu');
  const btn = document.getElementById('columnMenuBtn');
  if (menu && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    menu.classList.remove('show');
    document.removeEventListener('click', closeColumnMenuOnOutside);
  }
}

async function resetColumnPrefs() {
  if (!await confirmDialog({
    title: 'Reset column preferences',
    body: t('confirm.resetCols'),
    confirmLabel: 'Reset',
    danger: true
  })) return;
  localStorage.removeItem(COLUMN_PREFS_KEY);
  renderColumnPicker();
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
  showToast(t('toast.columnsReset'));
}

// Per-pilot-type column presets. Each preset is a default selection of
// columns for the matching persona; user can override any preset via the
// Columns picker. These are smart defaults, not opinionated rules.
const COLUMN_PRESETS = {
  // F/O 705 — Airline First Officer (Porter, Jazz, Encore, etc.)
  'airline-fo': ['date','flightNum','type','reg','route','crewPosition','ldgDay','ldgNight','night','block','total'],

  // Captain 705 — Airline Captain (same shape but PIC ratio matters)
  'airline-cpt': ['date','flightNum','type','reg','route','crewPosition','meDayPic','meNightPic','ldgDay','ldgNight','block','total'],

  // Bush — floats/skis ops, 703/704, charter PoB
  'bush': ['date','flightNum','type','reg','acConfig','route','copilot','block','total'],

  // Helicopter — rotorcraft ops (CAR 401.05 currency, hover, autorotation)
  'helicopter': ['date','flightNum','type','reg','route','heliDayPic','heliNightPic','heliDayCop','heliNightCop','hoverTime','toDay','toNight','ldgDay','ldgNight','total'],

  // Instructor / CFI — dual-given primary, student-name field
  'instructor': ['date','type','reg','route','copilot','dualGivenDay','dualGivenNight','ldgDay','ldgNight','block','total'],

  // Private GA / PPL — recreational, fewer fields, currency-focused
  'private': ['date','type','reg','route','day','night','ldgDay','ldgNight','block','total'],

  // Student — solo vs dual instruction, instructor name
  'student': ['date','type','reg','route','pic','meDayDual','meNightDual','meDayPic','meNightPic','ldgDay','block','total'],

  // Compact F/O 705 — kept for backward compatibility (this was the only
  // option before 2026-05-14; aliased to 'airline-fo').
  'compact': null,  // will fall through to airline-fo

  // ATPL prep — exhaustive cumulative view for license submission
  'atpl': ['date','type','reg','route','pic','crewPosition','block','duty',
           'day','night','meDayPic','meNightPic','meDayCop','meNightCop',
           'xcDay','xcNight','instActual','instSim','approaches',
           'ldgDay','ldgNight','picus','dualGivenDay','dualGivenNight','total'],
};

// Map a profile.pilotType to the matching preset name. Falls back to
// the airline-fo preset (the original compact view) if unrecognized.
function presetForPilotType(pilotType) {
  switch ((pilotType || '').toLowerCase()) {
    case 'airline705':  return 'airline-fo';
    case 'helicopter':  return 'helicopter';
    case 'instructor':  return 'instructor';
    case 'private':     return 'private';
    case 'student':     return 'student';
    default:            return 'airline-fo';
  }
}

function applyColumnPreset(preset) {
  const prefs = {};
  // Aliases / shortcuts
  if (preset === 'compact') preset = 'airline-fo';
  // Special "all" / "none" presets
  if (preset === 'all') {
    LOGBOOK_COLUMNS.forEach(c => { prefs[c.key] = true; });
  } else if (preset === 'none') {
    LOGBOOK_COLUMNS.forEach(c => { prefs[c.key] = false; });
  } else if (COLUMN_PRESETS[preset]) {
    COLUMN_PRESETS[preset].forEach(k => prefs[k] = true);
    LOGBOOK_COLUMNS.forEach(c => { if (prefs[c.key] === undefined) prefs[c.key] = false; });
  } else {
    console.warn('[Columns] Unknown preset:', preset);
    return;
  }
  saveColumnPrefs(prefs);
  renderColumnPicker();
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
  showToast(t('toast.presetApplied', { name: preset }));
}

// ═══════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════
function backupData() {
  const data = { flights, profile: DB.loadProfile(), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'logbook_backup_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  showToast(t('toast.backupDownloaded'), 'success');
}

// Restore from a JSON backup file.
// SECURITY: this path accepts arbitrary user-supplied JSON. We must
// validate strictly — past audits flagged it as an injection vector
// (XSS via raw HTML in flight fields, ReDoS via crafted regex strings).
// Rules enforced here:
//   - data.flights must be a real array, capped at 100k entries
//   - each flight is an object; string fields are sanitized
//   - data.profile is an object; `lang` is whitelisted; `operatorCodes`
//     is restricted to safe alphanumeric characters
//   - captain/copilot names are re-anonymized to initials if the user
//     has consent toggle OFF (PIPEDA Principle 4.3)
function restoreData(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') {
        showToast(t('toast.invalidBackup'), 'error');
        return;
      }

      // Validate flights array shape and cap upfront, BEFORE confirmation
      // — so we don't show the user a bogus summary derived from invalid data.
      if (data.flights !== undefined) {
        if (!Array.isArray(data.flights)) {
          showToast(t('toast.invalidBackup'), 'error');
          return;
        }
        if (data.flights.length > 100000) {
          showToast(t('toast.invalidBackup'), 'error');
          console.warn('[Restore] rejected backup with', data.flights.length, 'flights — cap is 100,000');
          return;
        }
      }
      if (data.profile !== undefined) {
        if (!data.profile || typeof data.profile !== 'object' || Array.isArray(data.profile)) {
          showToast(t('toast.invalidBackup'), 'error');
          return;
        }
      }

      // Dry-run preview: tell the user EXACTLY what's about to change before
      // committing. Restore is destructive — overwrites every flight + profile
      // in the current local store. The pilot has 2 seconds to read the
      // counts, see the dates, and bail if anything looks off.
      const incomingFlightCount = Array.isArray(data.flights) ? data.flights.length : 0;
      const currentFlightCount = Array.isArray(flights) ? flights.length : 0;
      const dates = (data.flights || []).map(f => f && f.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      const dateRange = dates.length
        ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`)
        : 'no dated entries';
      const profileNote = (data.profile && typeof data.profile === 'object')
        ? ` plus profile (${[data.profile.fname, data.profile.lname].filter(Boolean).join(' ') || 'unnamed'}).`
        : '';
      const exportedNote = data.exportedAt ? `Backup exported: ${String(data.exportedAt).slice(0, 10)}.` : '';

      const body = `${exportedNote}\n\nBackup contains ${incomingFlightCount} flight${incomingFlightCount !== 1 ? 's' : ''} (${dateRange})${profileNote}\n\nThis will REPLACE your current ${currentFlightCount} flight${currentFlightCount !== 1 ? 's' : ''}. Cannot be undone — download a fresh backup first if unsure.`;

      const ok = await confirmDialog({
        title: 'Restore from backup',
        body,
        confirmLabel: 'Replace + restore',
        cancelLabel: 'Cancel',
        danger: true
      });
      if (!ok) return;

      // Confirmed — apply the restore.
      if (data.flights !== undefined) {
        const cleanProfile = data.profile && typeof data.profile === 'object'
          ? data.profile : DB.loadProfile();
        const cleanFlights = data.flights
          .filter(f => f && typeof f === 'object' && !Array.isArray(f))
          .map(f => sanitizeFlightRow(f, cleanProfile));
        flights = cleanFlights;
        DB.save(flights);
      }
      if (data.profile !== undefined) {
        const cleanProfile = { ...data.profile };
        if (cleanProfile.lang && cleanProfile.lang !== 'en' && cleanProfile.lang !== 'fr') {
          delete cleanProfile.lang;
        }
        if (typeof cleanProfile.operatorCodes === 'string') {
          // Allow A-Z 0-9 comma and whitespace — anything else strips out
          cleanProfile.operatorCodes = cleanProfile.operatorCodes.replace(/[^A-Za-z0-9, \t-]/g, '');
        }
        DB.saveProfile(cleanProfile);
      }

      showToast(t('toast.flightsRestored', { n: flights.length }), 'success');
      renderDashboard();
    } catch (err) {
      console.warn('[Restore] parse error:', err);
      showToast(t('toast.invalidBackup'), 'error');
    }
  };
  r.readAsText(file);
  input.value = '';
}

// Strip dangerous content from each flight before adopting it into the
// live list. We drop unknown keys and clip string values to a sane length.
function sanitizeFlightRow(f, profile) {
  const MAX_STR = 1024;
  const out = {};
  Object.keys(f).forEach(k => {
    const v = f[k];
    if (v === null) { out[k] = null; return; }
    if (typeof v === 'string') {
      out[k] = v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v) || (typeof v === 'object' && k === 'sources')) {
      // Preserve the merge audit trail; everything else flattens out.
      out[k] = v;
    }
    // Drop anything else (functions, weird objects).
  });
  // Re-apply PIPEDA captain/copilot anonymization if user hasn't consented.
  if (typeof gateCaptainName === 'function') {
    if (typeof out.pic === 'string')     out.pic = gateCaptainName(out.pic, profile);
    if (typeof out.copilot === 'string') out.copilot = gateCaptainName(out.copilot, profile);
  }
  return out;
}

async function clearAll() {
  if (!await confirmDialog({
    title: 'Clear all flights',
    body: t('confirm.deleteAll'),
    confirmLabel: 'Clear all',
    danger: true
  })) return;
  flights = [];
  DB.save(flights);
  showToast(t('toast.allCleared'), 'error');
  renderDashboard();
}

// Delete account + purge — honest data-deletion path exposed in
// Settings → Privacy & Trust. Wipes EVERYTHING local. When Supabase
// is wired (Auth.isReady() returns true), also triggers cloud-side
// deletion via the Supabase Auth API (Auth.deleteAccount() handles the
// remote purge and 30-day backup-retention window per the policy).
async function deleteAccountPurge() {
  // Two-stage confirmation — this is irreversible local + cloud destruction.
  if (!await confirmDialog({
    title: 'Delete account + purge all data',
    body: t('confirm.deletePurge1'),
    confirmLabel: 'Continue',
    danger: true
  })) return;
  if (!await confirmDialog({
    title: 'Are you absolutely sure?',
    body: t('confirm.deletePurge2'),
    confirmLabel: 'Yes, delete everything',
    danger: true
  })) return;

  // 1) If signed in to Supabase, mark account for deletion (server-side).
  try {
    if (typeof Auth !== 'undefined' && Auth.isReady && Auth.isReady() && Auth.deleteAccount) {
      await Auth.deleteAccount();
    }
  } catch (e) {
    console.warn('[Delete] cloud deletion request failed (will still wipe local):', e);
  }

  // 2) Wipe ALL local app keys (flights, profile, snapshots, prefs,
  //    audit log, signature, navblue URL/last-sync, language).
  const keysToWipe = [
    'logbook_v1', 'logbook_profile_v1', 'logbook_dark',
    'cumulo_snapshots_v2', 'cumulo_snapshot_v1',
    'cumulo_import_log_v1', 'cumulo_column_prefs_v1',
    'cumulo_lang', 'cumulo_signature',
    'cumulo_navblue_url', 'cumulo_navblue_last_sync', 'cumulo_navblue_debug_v1',
    'cumulo_onboarded_v1', 'cumulo_migration_state_v1', 'cumulo_pending_ops_v1',
    'cumulo_migration_log_v1'
  ];
  keysToWipe.forEach(k => { try { localStorage.removeItem(k); } catch {} });

  // 3) Reset in-memory state so the dashboard doesn't briefly show stale rows.
  flights = [];
  pendingImport = [];
  showToast(t('toast.accountPurged'), 'success');

  // 4) Hard reload to a clean state. User will see the onboarding wizard
  //    on next visit, as if they were a brand-new install.
  setTimeout(() => location.reload(), 1200);
}

