// ═══════════════════════════════════════════
// FEATURE 6 — DARK MODE
// ═══════════════════════════════════════════
function setTheme(theme) {
  const on = theme === 'dark';
  document.body.classList.toggle('dark', on);
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('logbook_dark', on ? '1' : '0');
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
}

function applyDarkMode() {
  const on = localStorage.getItem('logbook_dark') === '1';
  setTheme(on ? 'dark' : 'light');
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

