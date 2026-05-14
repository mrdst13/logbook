// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// Build version stamp — bump every push so user can verify fresh load
const BUILD_VERSION = 'v3a-2026-05-14-heli-cfi';

(function init() {
  applyDarkMode();
  // Apply i18n translations (must happen before anything reads textContent)
  if (typeof applyTranslations === 'function') applyTranslations();
  // Visible version badge bottom-right — verifies fresh page load on iOS
  const vBadge = document.createElement('div');
  vBadge.id = 'buildVersion';
  vBadge.textContent = BUILD_VERSION;
  vBadge.style.cssText = 'position:fixed;bottom:6px;right:8px;z-index:9999;font-family:var(--font-mono);font-size:9px;color:rgba(120,120,120,0.6);pointer-events:none;letter-spacing:0.04em;';
  document.body.appendChild(vBadge);
  // Wire hamburger, overlay, and delegated nav-item clicks
  wireNav();
  const p = DB.loadProfile();
  if (p.fname) updateProfileDisplay(p);
  renderDashboard();
  document.getElementById('dashDate').textContent =
    new Date().toLocaleDateString('en-CA', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  loadNavblueUI();
  // Update relative-time status every minute
  setInterval(updateNavblueStatus, 60000);
  // First-launch onboarding (only if no profile name set)
  if (shouldShowOnboarding()) {
    setTimeout(startOnboarding, 400);
  }

  // ── Supabase bootstrap (skeleton-safe: no-ops if keys missing) ─────
  // Auth.init() awaits getSession() so we do it async without blocking
  // the rest of init. Any errors are logged inside Auth.init itself.
  if (typeof Auth !== 'undefined' && Auth.init) {
    Auth.init().then(() => {
      if (typeof renderAuthStateUI === 'function') renderAuthStateUI();
      if (typeof wireSyncEvents === 'function') wireSyncEvents();
      // GC pre-migration backup if it's older than 90 days.
      if (typeof Sync !== 'undefined' && Sync.gcPremigrationBackup) Sync.gcPremigrationBackup();
      // If user is already authenticated (session restored from storage),
      // attempt to drain the offline queue and pull remote flights.
      if (Auth.isAuthenticated()) {
        if (typeof Sync !== 'undefined') {
          Sync.drainQueue();
          Sync.pullFlights();
        }
      }
      // Subscribe to auth state changes so the header updates after
      // signin/signout from any code path.
      Auth.onAuthChange(() => {
        if (typeof renderAuthStateUI === 'function') renderAuthStateUI();
      });
    });
  }
})();