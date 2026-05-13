// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// Build version stamp — bump every push so user can verify fresh load
const BUILD_VERSION = 'v3a-2026-05-11-stacking-fix';

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
})();