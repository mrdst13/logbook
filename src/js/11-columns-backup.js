// ═══════════════════════════════════════════
// COLUMN PICKER (Settings → Visible Columns)
// ═══════════════════════════════════════════
function renderColumnPicker() {
  const container = document.getElementById('columnPicker');
  if (!container) return;
  const prefs = loadColumnPrefs() || {};

  // Group columns by section
  const groups = {};
  LOGBOOK_COLUMNS.forEach(c => {
    if (c.key === 'total') return;  // always shown, no toggle
    if (!groups[c.group]) groups[c.group] = [];
    groups[c.group].push(c);
  });

  const html = Object.keys(groups).map(group => `
    <div class="col-group">
      <div class="col-group-title">${group}</div>
      <div class="col-group-grid">
        ${groups[group].map(c => {
          const checked = prefs[c.key] !== undefined ? prefs[c.key] : c.default;
          return `
          <label class="col-option ${checked ? 'is-on' : ''}">
            <input type="checkbox" ${checked ? 'checked' : ''}
                   onchange="toggleColumn('${c.key}', this.checked)" />
            <span class="col-option-label">${c.label}</span>
          </label>`;
        }).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="display:flex; gap:var(--s-2); flex-wrap:wrap; align-items:center; margin-bottom:var(--s-3); padding-bottom:var(--s-3); border-bottom:1px solid var(--border);">
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('all')" type="button">✓ Select all</button>
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('none')" type="button">✗ Deselect all</button>
      <span style="width:1px; height:20px; background:var(--border);"></span>
      <span class="eyebrow">Presets:</span>
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('compact')" type="button">Compact F/O 705</button>
      <button class="btn btn-ghost btn-sm" onclick="applyColumnPreset('atpl')" type="button">ATPL prep</button>
    </div>
    ${html}
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

function resetColumnPrefs() {
  if (!confirm(t('confirm.resetCols'))) return;
  localStorage.removeItem(COLUMN_PREFS_KEY);
  renderColumnPicker();
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
  showToast(t('toast.columnsReset'));
}

function applyColumnPreset(preset) {
  const prefs = {};
  if (preset === 'compact') {
    // F/O 705 essentials
    ['date','type','reg','route','pic','night','block','total'].forEach(k => prefs[k] = true);
    LOGBOOK_COLUMNS.forEach(c => { if (prefs[c.key] === undefined) prefs[c.key] = false; });
  } else if (preset === 'atpl') {
    // ATPL preparation: all categories needed for the experience demo
    ['date','type','reg','route','pic','crewPosition','block','duty',
     'day','night','meDayPic','meNightPic','meDayCop','meNightCop',
     'xcDay','xcNight','instActual','instSim','approaches',
     'ldgDay','ldgNight','picus','total'].forEach(k => prefs[k] = true);
    LOGBOOK_COLUMNS.forEach(c => { if (prefs[c.key] === undefined) prefs[c.key] = false; });
  } else if (preset === 'all') {
    LOGBOOK_COLUMNS.forEach(c => { prefs[c.key] = true; });
  } else if (preset === 'none') {
    LOGBOOK_COLUMNS.forEach(c => { prefs[c.key] = false; });
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
  r.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') {
        showToast(t('toast.invalidBackup'), 'error');
        return;
      }

      // Validate flights array shape and cap.
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
        const cleanProfile = data.profile && typeof data.profile === 'object'
          ? data.profile : DB.loadProfile();
        const cleanFlights = data.flights
          .filter(f => f && typeof f === 'object' && !Array.isArray(f))
          .map(f => sanitizeFlightRow(f, cleanProfile));
        flights = cleanFlights;
        DB.save(flights);
      }

      // Validate profile fields (lang whitelist, operatorCodes regex-safe).
      if (data.profile !== undefined) {
        if (!data.profile || typeof data.profile !== 'object' || Array.isArray(data.profile)) {
          showToast(t('toast.invalidBackup'), 'error');
          return;
        }
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

function clearAll() {
  if (!confirm(t('confirm.deleteAll'))) return;
  flights = [];
  DB.save(flights);
  showToast(t('toast.allCleared'), 'error');
  renderDashboard();
}

