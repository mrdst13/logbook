// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const target = document.getElementById('page-' + id);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.dataset.page === id) n.classList.add('active');
  });

  // Close mobile nav whenever a page is selected
  closeMobileNav();

  if (id === 'dashboard') renderDashboard();
  if (id === 'logbook') renderLogbook();
  if (id === 'profile') { loadProfile(); setTimeout(initSignature, 50); }
  if (id === 'backup') {
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = localStorage.getItem('logbook_dark') === '1';
  }
  if (id === 'recap') { initRecapYears(); renderRecap(); }
  if (id === 'glossary') renderGlossary();
  if (id === 'qa') renderQA();
  if (id === 'add' && !editingId) {
    document.getElementById('formTitle').textContent = 'Log a Flight';
    clearForm();
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    setEntryType('flight');   // default to flight when entering a new entry
  }
  if (id === 'add') {
    adaptFormToProfile(DB.loadProfile().pilotType || 'airline705');
  }
}

