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
  if (!confirm('Reset all column visibility to defaults? Your data is not affected.')) return;
  localStorage.removeItem(COLUMN_PREFS_KEY);
  renderColumnPicker();
  if (typeof renderLogbook === 'function') renderLogbook(filterVal || '');
  showToast('Column visibility reset to defaults');
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
  showToast(`Preset "${preset}" applied`);
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
  showToast('Backup downloaded ✓', 'success');
}

function restoreData(input) {
  const file = input.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.flights) { flights = data.flights; DB.save(flights); }
      if (data.profile) { DB.saveProfile(data.profile); }
      showToast(flights.length + ' flights restored ✓', 'success');
      renderDashboard();
    } catch { showToast('Invalid backup file', 'error'); }
  };
  r.readAsText(file);
  input.value = '';
}

function clearAll() {
  if (!confirm('Delete ALL flights? This cannot be undone.')) return;
  flights = [];
  DB.save(flights);
  showToast('All data cleared', 'error');
  renderDashboard();
}

