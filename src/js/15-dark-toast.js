// ═══════════════════════════════════════════
// FEATURE 6 — DARK MODE
// ═══════════════════════════════════════════
// Marks that the pilot PICKED a theme, as opposed to the app writing the
// default on first boot. applyDarkMode() runs setTheme('light') on every virgin
// device, so 'logbook_dark' exists everywhere and its presence proves nothing.
// Without this marker an untouched phone pushed "light" to the account and
// undid a deliberate dark mode on the computer. (Independent review 2026-08-01.)
const THEME_CHOSEN_KEY = 'cumulo_theme_chosen_v1';

// opts.explicit — the pilot clicked the toggle. Only then is the choice recorded
// as theirs and carried to the account.
function setTheme(theme, opts) {
  const on = theme === 'dark';
  document.body.classList.toggle('dark', on);
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('logbook_dark', on ? '1' : '0');
  const explicit = !!(opts && opts.explicit);
  if (explicit) { try { localStorage.setItem(THEME_CHOSEN_KEY, '1'); } catch (e) {} }
  // Sync topbar toggle buttons
  const btnLight = document.getElementById('themeBtnLight');
  const btnDark  = document.getElementById('themeBtnDark');
  if (btnLight && btnDark) {
    btnLight.classList.toggle('active', !on);
    btnDark.classList.toggle('active', on);
  }
  // Sync legacy checkbox in Settings page
  const cb = document.getElementById('darkModeToggle');
  if (cb) cb.checked = on;
  // Re-render chart so colors adapt
  if (typeof monthlyChartInst !== 'undefined' && monthlyChartInst) renderChart();
  // Carry it to the account. Saved settings used to be one localStorage write
  // and nothing else, so each one stayed on the device that set it. Only a real
  // choice is pushed: the boot-time default must not travel.
  if (explicit) {
    try { if (typeof Sync !== 'undefined' && Sync.pushDeviceSettingsIfAny) Sync.pushDeviceSettingsIfAny({ intent: true }); } catch (e) {}
  }
}

function applyDarkMode() {
  const on = localStorage.getItem('logbook_dark') === '1';
  setTheme(on ? 'dark' : 'light');   // no opts: restoring is not choosing
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

