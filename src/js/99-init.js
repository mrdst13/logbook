// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// Build version stamp — bump every push so user can verify fresh load
const BUILD_VERSION = 'v3a-2026-05-14-settings-tabs';

// Demo mode banner injector — runs early so the visitor immediately
// sees the "this is a demo" affordance before the rest of the UI loads.
function injectDemoBanner() {
 if (typeof DEMO_MODE === 'undefined' || !DEMO_MODE) return;
 const banner = document.createElement('div');
 banner.id = 'demoBanner';
 banner.innerHTML = `
 <div style="display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap; padding:10px 16px;">
 <span style="font-weight:700;"> DEMO MODE</span>
 <span style="opacity:0.85;">Try anything — your changes won't persist. Reload to reset.</span>
 <a href="logbook.html" style="color:white; text-decoration:underline; font-weight:600;">Exit demo →</a>
 <a href="index.html" style="color:white; text-decoration:underline; font-weight:600;">Home</a>
 </div>
 `;
 banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:linear-gradient(90deg,#3884ff,#5fa0ff);color:white;font-size:13px;letter-spacing:0.01em;box-shadow:0 2px 12px rgba(0,0,0,0.18);';
 document.body.appendChild(banner);
 // Push the rest of the page down so the banner doesn't overlap content.
 document.body.style.paddingTop = (banner.offsetHeight || 44) + 'px';
}

(function init() {
 applyDarkMode();
 injectDemoBanner();
 // NOTE (2026-05-14): a previous version of init() ran a "migration"
 // that copied legacy std_utc → atd_utc. That was an approximation —
 // labelling a schedule as actual. REMOVED. Legacy std_utc values are
 // left untouched in old flights; the user must re-import their PDF
 // roster (which has the actuals) or manually edit per flight to
 // populate atd_utc / ata_utc. Cf. feedback_never_approximate_certifiable_data.md.
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