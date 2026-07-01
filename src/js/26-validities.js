// ═══════════════════════════════════════════════════════════════════
// VALIDITIES — edit an existing validity's date, or add one to track
// ─────────────────────────────────────────────────────────────────
// Two behaviours on the Dashboard "Current validities" card:
//   • Click a DATE-based validity (PPC, Medical, or a custom one) → edit
//     its date in place (editValidity).
//   • Click "+ Add a validity" → a PICKER of things a pilot might track
//     (openValidityPicker), pick one or "Custom", then set a date.
// Count-based validities (Recent experience, IFR currency) are computed
// from the logbook, so they stay info-only (openDashDrill) — nothing to edit.
//
// Dates are ALWAYS pilot-entered — never computed or inferred (certifiable
// rule). Custom validities live on the profile object (profile.customValidities)
// so they persist locally; cross-device cloud sync of custom validities needs a
// dedicated column (not yet provisioned) — built-in PPC/Medical already sync.
//
// The UI reuses the existing dash drill-down modal (dashDrillOverlay) so it
// inherits the same styling, backdrop, and close handling (closeDashDrill).
// ═══════════════════════════════════════════════════════════════════

// Suggested trackables for the picker. Just labels — the pilot enters the date,
// and can rename any of them (or use "Custom"). Not regulatory definitions.
const VALIDITY_PRESETS = [
  { key: 'ifr',        en: 'IFR / instrument renewal',    fr: 'IFR / renouvellement instrument' },
  { key: 'typeRating', en: 'Type rating',                 fr: 'Qualification de type' },
  { key: 'lineCheck',  en: 'Line check',                  fr: 'Contrôle en ligne' },
  { key: 'tdg',        en: 'Dangerous goods',             fr: 'Marchandises dangereuses' },
  { key: 'firstAid',   en: 'First aid',                   fr: 'Secourisme' },
  { key: 'radio',      en: 'Radio licence (ROC-A)',       fr: 'Licence radio (ROC-A)' },
  { key: 'lang',       en: 'Language proficiency',        fr: 'Compétence linguistique' },
  { key: 'passport',   en: 'Passport',                    fr: 'Passeport' },
  { key: 'raic',       en: 'Security pass (RAIC)',        fr: 'Laissez-passer (ZRD/RAIC)' },
  { key: 'company',    en: 'Company recurrent',           fr: 'Formation périodique entreprise' },
];

// Name of the preset chosen in the picker, carried into the "new" editor.
let _pendingValidityName = '';

function _valFr() { return (typeof getLang === 'function') && getLang() === 'fr'; }

// Read/normalise the pilot's custom validities from the profile object.
function getCustomValidities() {
  const p = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
  return Array.isArray(p.customValidities) ? p.customValidities : [];
}

function _saveCustomValidities(list) {
  const p = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
  p.customValidities = list;
  DB.saveProfile(p);
}

// ─── Picker: "what would you like to track?" ─────────────────────────
function openValidityPicker() {
  const overlay = document.getElementById('dashDrillOverlay');
  if (!overlay) return;
  const fr = _valFr();
  const eyebrow = document.getElementById('dashDrillEyebrow');
  const title = document.getElementById('dashDrillTitle');
  const body = document.getElementById('dashDrillBody');
  const foot = document.getElementById('dashDrillFoot');

  if (eyebrow) eyebrow.textContent = fr ? 'AJOUTER' : 'ADD';
  if (title) title.textContent = fr ? 'Que voulez-vous suivre ?' : 'What would you like to track?';

  const rows = VALIDITY_PRESETS.map(pre => {
    const label = fr ? pre.fr : pre.en;
    return '<button type="button" class="btn btn-ghost val-pick-row" ' +
      'onclick="startAddValidity(\'' + pre.key + '\')" ' +
      'style="justify-content:flex-start;width:100%;text-align:left;">' + esc(label) + '</button>';
  }).join('');

  const customRow = '<button type="button" class="btn btn-ghost val-pick-row" ' +
    'onclick="startAddValidity(\'\')" style="justify-content:flex-start;width:100%;text-align:left;">' +
    '<span style="font-weight:700;margin-right:8px;">+</span>' +
    esc(fr ? 'Personnalisé…' : 'Custom…') + '</button>';

  if (body) {
    body.innerHTML =
      '<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">' +
        esc(fr
          ? 'Choisissez un élément à suivre, puis entrez votre date. Vous pourrez la modifier plus tard en cliquant sur la validité.'
          : 'Pick something to track, then enter your date. You can change it later by clicking the validity.') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' + rows + customRow + '</div>';
  }
  if (foot) foot.innerHTML = '';

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

// Picker → editor. presetKey '' means a blank custom validity (editable name).
function startAddValidity(presetKey) {
  const fr = _valFr();
  const pre = VALIDITY_PRESETS.find(p => p.key === presetKey);
  _pendingValidityName = pre ? (fr ? pre.fr : pre.en) : '';
  editValidity('new');
}

// ─── Editor: set / change a validity's date ──────────────────────────
// ref: 'ppc' | 'medical' | 'custom:<id>' | 'new'
function editValidity(ref) {
  const overlay = document.getElementById('dashDrillOverlay');
  if (!overlay) return;
  const fr = _valFr();
  const eyebrow = document.getElementById('dashDrillEyebrow');
  const title = document.getElementById('dashDrillTitle');
  const body = document.getElementById('dashDrillBody');
  const foot = document.getElementById('dashDrillFoot');
  const p = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};

  let nameEditable = false;
  let nameVal = '';
  let dateVal = '';
  let existingCustomId = '';

  if (ref === 'ppc') {
    nameVal = 'PPC';
    dateVal = p.ppcDueDate || '';
  } else if (ref === 'medical') {
    nameVal = fr ? 'Médical' : 'Medical';
    dateVal = p.medical || '';
  } else if (ref && ref.indexOf('custom:') === 0) {
    existingCustomId = ref.slice('custom:'.length);
    const cv = getCustomValidities().find(v => v.id === existingCustomId);
    nameEditable = true;
    nameVal = cv ? (cv.name || '') : '';
    dateVal = cv ? (cv.date || '') : '';
  } else { // 'new'
    nameEditable = true;
    nameVal = _pendingValidityName || '';
    dateVal = '';
  }

  if (eyebrow) eyebrow.textContent = fr ? 'VALIDITÉ' : 'VALIDITY';
  if (title) title.textContent = (ref === 'new')
    ? (fr ? 'Nouvelle validité' : 'New validity')
    : (fr ? 'Modifier la validité' : 'Edit validity');

  const nameField = nameEditable
    ? '<div><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">' +
        esc(fr ? 'Nom' : 'Name') + '</div>' +
        '<input type="text" id="valEditName" value="' + esc(nameVal) + '" ' +
        'placeholder="' + esc(fr ? 'ex. Qualification de type' : 'e.g. Type rating') + '" ' +
        'style="width:100%;box-sizing:border-box;" maxlength="40"></div>'
    : '<div><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">' +
        esc(fr ? 'Validité' : 'Validity') + '</div>' +
        '<div style="font-size:16px;font-weight:700;">' + esc(nameVal) + '</div>' +
        '<input type="hidden" id="valEditName" value="' + esc(nameVal) + '"></div>';

  if (body) {
    body.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:16px;">' +
        nameField +
        '<div><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">' +
          esc(fr ? 'Expire le' : 'Expires on') + '</div>' +
          '<input type="date" id="valEditDate" value="' + esc(dateVal) + '" style="width:100%;box-sizing:border-box;"></div>' +
        '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">' +
          esc(fr
            ? 'Cumulo ne calcule jamais cette date — entrez celle de votre document. Laissez vide pour ne pas suivre.'
            : 'Cumulo never computes this date — enter the one from your document. Leave blank to stop tracking.') +
        '</div>' +
      '</div>';
  }

  const saveBtn = '<button class="btn btn-primary" onclick="saveValidityFromModal(\'' + esc(ref) + '\')">' +
    esc(fr ? 'Enregistrer' : 'Save') + '</button>';
  const cancelBtn = '<button class="btn btn-ghost" onclick="closeDashDrill()">' +
    esc(fr ? 'Annuler' : 'Cancel') + '</button>';
  const deleteBtn = existingCustomId
    ? '<button class="btn btn-ghost" style="color:var(--danger,#E24B4A);margin-right:auto;" ' +
      'onclick="deleteCustomValidity(\'' + esc(existingCustomId) + '\')">' + esc(fr ? 'Supprimer' : 'Delete') + '</button>'
    : '';
  if (foot) foot.innerHTML = deleteBtn + cancelBtn + saveBtn;

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const focusEl = nameEditable && !nameVal
      ? document.getElementById('valEditName')
      : document.getElementById('valEditDate');
    if (focusEl) { try { focusEl.focus(); } catch (e) {} }
  }, 60);
}

function saveValidityFromModal(ref) {
  const fr = _valFr();
  const dateEl = document.getElementById('valEditDate');
  const nameEl = document.getElementById('valEditName');
  const date = dateEl ? (dateEl.value || '') : '';
  const name = nameEl ? (nameEl.value || '').trim() : '';
  const p = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};

  if (ref === 'ppc') {
    p.ppcDueDate = date;
    DB.saveProfile(p);
  } else if (ref === 'medical') {
    p.medical = date;
    DB.saveProfile(p);
  } else {
    // Custom (existing or new)
    if (!name) {
      if (typeof showToast === 'function') showToast(fr ? 'Donnez un nom à la validité.' : 'Give the validity a name.', 'error');
      return;
    }
    const list = getCustomValidities().slice();
    if (ref && ref.indexOf('custom:') === 0) {
      const id = ref.slice('custom:'.length);
      const idx = list.findIndex(v => v.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], name, date };
      else list.push({ id, name, date });
    } else {
      const id = 'cv_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      list.push({ id, name, date });
    }
    _saveCustomValidities(list);
  }

  if (typeof closeDashDrill === 'function') closeDashDrill();
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof showToast === 'function') showToast(fr ? 'Validité enregistrée' : 'Validity saved', 'success');
}

function deleteCustomValidity(id) {
  const fr = _valFr();
  const list = getCustomValidities().filter(v => v.id !== id);
  _saveCustomValidities(list);
  if (typeof closeDashDrill === 'function') closeDashDrill();
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof showToast === 'function') showToast(fr ? 'Validité supprimée' : 'Validity removed', 'success');
}
