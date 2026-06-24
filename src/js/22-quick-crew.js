// ═══════════════════════════════════════════════════════════════════
// QUICK CREW-FILL — fast bulk-edit of crew names on newly imported flights
// ─────────────────────────────────────────────────────────────────
// Why this exists: Navblue iCal usually doesn't include crew names.
// After an iCal sync, the pilot ends up with 5-30 new flights all
// missing the PIC field (or copilot, if the user is captain). Editing
// each flight one-by-one through the full detail panel is tedious.
//
// Pattern: a single modal that lists the just-imported flights in a
// table, one input per row with autocomplete from recent names, plus
// "Apply to all" for the common case where the same captain flew all
// legs of a duty.
//
// Triggered automatically by confirmImport() and syncNavblueNow() when
// they detect crewless flights among the newly-saved entries.
// ═══════════════════════════════════════════════════════════════════

let _quickCrewIds = [];

// Detect crew that's missing OR a self-reference. F/O fills PIC; PIC fills copilot.
function _crewIsMissing(value) {
  if (!value) return true;
  const v = String(value).trim().toLowerCase();
  return v === '' || v === 'self' || v === 'moi' || v === '—';
}

// Determine which field the user fills based on profile.
// Returns 'pic' (user is F/O, needs to type captain) or 'copilot' (user is
// PIC, needs to type F/O). Defaults to 'pic' since Martin = F/O.
function _quickCrewTargetField() {
  if (typeof DB === 'undefined' || !DB.loadProfile) return 'pic';
  const p = DB.loadProfile();
  const rank = (p.rank || '').toLowerCase();
  if (rank === 'cpt.' || rank === 'cpt' || rank === 'captain' || rank === 'pic') {
    return 'copilot';
  }
  return 'pic';
}

// Public entry point — call with a list of just-imported flight IDs.
// Auto-filters to only the ones that actually need crew, opens the modal
// if any remain. No-op if every flight already has crew.
function openQuickCrewFill(flightIds) {
  if (!Array.isArray(flightIds) || flightIds.length === 0) return false;
  const field = _quickCrewTargetField();
  const needsCrew = flightIds
    .map(id => (Array.isArray(flights) ? flights.find(f => f.id === id) : null))
    .filter(f => f && _crewIsMissing(f[field]));
  if (needsCrew.length === 0) return false;

  _quickCrewIds = needsCrew.map(f => f.id);
  _renderQuickCrewModal(needsCrew, field);
  return true;
}

function _renderQuickCrewModal(flightList, field) {
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  // Make sure recent-names datalists are populated — quick-crew inputs
  // share them with the Add Flight form for autocomplete.
  if (typeof populateRecentNames === 'function') populateRecentNames();

  const fieldLabel = field === 'pic'
    ? (fr ? 'Capitaine (PIC)' : 'Captain (PIC)')
    : (fr ? 'Co-pilote (F/O)' : 'Co-Pilot (F/O)');
  const datalistId = field === 'pic' ? 'recentPics' : 'recentCops';

  const rowsHtml = flightList.map((f, i) => {
    const d = f.date ? new Date(f.date + 'T12:00:00') : null;
    const dateStr = d
      ? d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' }).toUpperCase().replace('.', '')
      : '—';
    const flightLabel = `${f.flightNum || ''}`.trim();
    return `
      <div class="qc-row" data-flight-id="${esc(f.id)}">
        <div class="qc-meta">
          <span class="qc-date mono">${esc(dateStr)}</span>
          <span class="qc-route">${esc(f.route || '—')}</span>
          ${flightLabel ? `<span class="qc-flight mono">${esc(flightLabel)}</span>` : ''}
        </div>
        <input type="text" class="qc-input" list="${datalistId}"
               data-qc-idx="${i}"
               placeholder="${esc(fieldLabel)}"
               autocomplete="off"
               spellcheck="false" />
      </div>
    `;
  }).join('');

  const title = fr
    ? `Ajouter ${field === 'pic' ? 'les capitaines' : 'les co-pilotes'} (${flightList.length})`
    : `Add ${field === 'pic' ? 'captain names' : 'co-pilot names'} (${flightList.length})`;
  const desc = fr
    ? "Saisissez vite le nom de l'équipage pour chaque vol. Autocomplete des noms récents. Bouton « Appliquer à tous » copie le 1er nom dans les champs vides — pratique quand vous avez fait toute la journée avec le même capitaine."
    : "Type the crew name for each leg. Autocomplete pulls from recent flights. \"Apply to all\" copies the first name into empty rows — useful when the same captain flew the whole duty day.";

  const overlay = document.createElement('div');
  overlay.className = 'import-overlay show';
  overlay.id = '_quickCrewOverlay';
  overlay.innerHTML = `
    <div class="import-modal qc-modal" style="max-width:680px;">
      <div class="import-modal-head">
        <div>
          <div class="eyebrow" style="margin-bottom:4px;">${esc(fr ? 'AJOUT RAPIDE ÉQUIPAGE' : 'QUICK CREW FILL')}</div>
          <div class="t-title-2">${esc(title)}</div>
          <div style="font-size:12.5px;color:var(--text-secondary);margin-top:6px;line-height:1.5;max-width:520px;">${esc(desc)}</div>
        </div>
        <button class="icon-btn" onclick="closeQuickCrewFill()" aria-label="${esc(fr ? 'Fermer' : 'Close')}" title="${esc(fr ? 'Fermer' : 'Close')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="import-modal-body">
        <div class="qc-grid">${rowsHtml}</div>
      </div>
      <div class="import-modal-foot">
        <button class="btn btn-ghost" onclick="closeQuickCrewFill()">${esc(fr ? 'Passer' : 'Skip')}</button>
        <button class="btn btn-ghost" onclick="quickCrewApplyToAll()">${esc(fr ? 'Appliquer à tous' : 'Apply to all')}</button>
        <button class="btn btn-primary" onclick="saveQuickCrewFill()">${esc(fr ? 'Enregistrer' : 'Save names')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Focus the first input so the pilot can start typing immediately.
  // setTimeout because the overlay element needs to be in the DOM first.
  setTimeout(() => {
    const first = overlay.querySelector('.qc-input');
    if (first) first.focus();
  }, 50);

  // Tab/Enter on the last input wraps to Save — small keyboard nicety.
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const inputs = Array.from(overlay.querySelectorAll('.qc-input'));
    const i = inputs.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    if (i < inputs.length - 1) {
      inputs[i + 1].focus();
    } else {
      saveQuickCrewFill();
    }
  });
}

// Apply the first non-empty value to all empty rows. Common case: same
// captain all day — type once, hit "Apply to all", done.
function quickCrewApplyToAll() {
  const overlay = document.getElementById('_quickCrewOverlay');
  if (!overlay) return;
  const inputs = Array.from(overlay.querySelectorAll('.qc-input'));
  const first = inputs.find(i => i.value && i.value.trim());
  if (!first) {
    if (typeof showToast === 'function') showToast(
      (typeof getLang === 'function' && getLang() === 'fr')
        ? 'Tapez un nom dans la première ligne, puis cliquez « Appliquer à tous ».'
        : 'Type a name in the first row first, then click "Apply to all".',
      'error');
    return;
  }
  const value = first.value.trim();
  inputs.forEach(i => {
    if (!i.value || !i.value.trim()) i.value = value;
  });
}

function closeQuickCrewFill() {
  const ov = document.getElementById('_quickCrewOverlay');
  if (ov) ov.remove();
  document.body.style.overflow = '';
  _quickCrewIds = [];
}

function saveQuickCrewFill() {
  const overlay = document.getElementById('_quickCrewOverlay');
  if (!overlay) return;
  const field = _quickCrewTargetField();
  let updated = 0;

  overlay.querySelectorAll('.qc-row').forEach(row => {
    const id = row.getAttribute('data-flight-id');
    const input = row.querySelector('.qc-input');
    if (!id || !input) return;
    const value = (input.value || '').trim();
    if (!value) return;
    const f = flights.find(x => x.id === id);
    if (!f) return;
    f[field] = value;
    // If this user typed the captain (they're F/O) and the flight didn't
    // have a crewPosition set, default to SIC (consistent with iCal import).
    if (field === 'pic' && !f.crewPosition) f.crewPosition = 'SIC';
    updated++;
  });

  if (updated > 0) {
    DB.save(flights);
    if (typeof showToast === 'function') {
      const fr = (typeof getLang === 'function') && getLang() === 'fr';
      showToast(
        fr ? `${updated} équipage${updated !== 1 ? 's' : ''} ajouté${updated !== 1 ? 's' : ''}.`
           : `Crew added to ${updated} flight${updated !== 1 ? 's' : ''}.`,
        'success');
    }
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderLogbook === 'function') renderLogbook();
  }
  closeQuickCrewFill();
}
