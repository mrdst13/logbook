// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// Build version stamp — bump every push so user can verify fresh load
const BUILD_VERSION = 'v3a-2026-05-26-atmosphere-everywhere';

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
 // Restore last-used Settings tab so the page opens where the user left off
 if (typeof restoreSettingsTab === 'function') restoreSettingsTab();
 // NOTE (2026-05-14): a previous version of init() ran a "migration"
 // that copied legacy std_utc → atd_utc. That was an approximation —
 // labelling a schedule as actual. REMOVED. Legacy std_utc values are
 // left untouched in old flights; the user must re-import their PDF
 // roster (which has the actuals) or manually edit per flight to
 // populate atd_utc / ata_utc. Cf. feedback_never_approximate_certifiable_data.md.
 // Apply i18n translations (must happen before anything reads textContent)
 if (typeof applyTranslations === 'function') applyTranslations();
 // Visible version badge bottom-right — only on localhost or when explicitly
 // requested with ?debug=1. In production it overlapped the dashboard hero
 // card on mobile (audit 2026-05-28).
 const showBadge = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
   new URLSearchParams(location.search).has('debug');
 if (showBadge) {
   const vBadge = document.createElement('div');
   vBadge.id = 'buildVersion';
   vBadge.textContent = BUILD_VERSION;
   vBadge.style.cssText = 'position:fixed;bottom:6px;right:8px;z-index:9999;font-family:var(--font-mono);font-size:9px;color:rgba(120,120,120,0.6);pointer-events:none;letter-spacing:0.04em;';
   document.body.appendChild(vBadge);
 }
 // Wire hamburger, overlay, and delegated nav-item clicks
 wireNav();
 const p = DB.loadProfile();
 if (p.fname) updateProfileDisplay(p);
 renderDashboard();
 // `dashDate` was removed in a redesign (the date now lives in the dashboard
 // eyebrow rendered by renderDashboard). This orphaned line was throwing
 // "Cannot set textContent of null", which aborted the ENTIRE init() before
 // it reached the Supabase bootstrap below — silently disabling cloud sync,
 // Navblue auto-sync, form validation, and onboarding. Guarded 2026-06-10.
 const dashDateEl = document.getElementById('dashDate');
 if (dashDateEl) {
   dashDateEl.textContent =
     new Date().toLocaleDateString('en-CA', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
 }
 // Non-critical UI wiring — wrapped so a single orphaned DOM reference
 // can never again abort init() before the Supabase/sync bootstrap runs.
 try {
 loadNavblueUI();
 // Update relative-time status every minute
 setInterval(updateNavblueStatus, 60000);

 // ── Auto-sync Navblue iCal ──────────────────────────────────────
 // Fire ~1.2s after init (don't block first paint or onboarding modal).
 // The auto wrapper is itself gated by NAVBLUE_AUTO_SYNC_INIT_MS so it
 // only actually hits the worker when the last sync is stale.
 if (typeof syncNavblueAuto === 'function') {
   setTimeout(() => syncNavblueAuto('init'), 1200);
 }
 // Re-sync when the user comes back to the tab after being away. The
 // 'focus' threshold (15 min) is shorter than 'init' (30 min) because
 // pilots often switch between tabs/apps and the friction of opening
 // Settings to click Sync is exactly what we're removing here.
 if (typeof syncNavblueAuto === 'function') {
   document.addEventListener('visibilitychange', () => {
     if (document.visibilityState === 'visible') {
       syncNavblueAuto('focus');
     }
   });
 }
 // Defensive flush on tab hide.
 //
 // Some sync paths mutate the in-memory `flights` array in place — for
 // example Sync.pullFlights iterates a remote-row batch with flights.push
 // before its DB.save call at the end. If the user closes the tab between
 // those two steps, the next page load reads stale localStorage and the
 // "Synced ✓" toast they saw was a lie.
 //
 // Listening for visibilitychange→'hidden' is the right hook here:
 //   - It fires reliably on iOS Safari (beforeunload often doesn't)
 //   - It fires on tab close, OS-level app switch, and screen lock
 //   - It's free of side effects — calling DB.save twice in a row is a
 //     no-op past the first call, so the cost of running it pre-emptively
 //     is zero
 // Wrapped in try/catch because if the page is already tearing down we
 // can't safely surface UI errors — silent persistence is the goal.
 document.addEventListener('visibilitychange', () => {
   if (document.visibilityState !== 'hidden') return;
   try {
     if (typeof flights !== 'undefined'
         && Array.isArray(flights)
         && typeof DB !== 'undefined'
         && typeof DB.save === 'function') {
       DB.save(flights);
     }
   } catch (e) {
     // Best-effort flush — we're on the way out, can't recover here.
   }
 });

 // Cross-tab safety: when ANOTHER tab writes the logbook, adopt its version
 // into this tab's in-memory `flights` and re-render. Without this, a stale
 // background tab's hidden-save (above) could clobber a flight added in the
 // other tab. (Opus audit — cross-tab concurrency.)
 window.addEventListener('storage', (e) => {
   if (!e || e.key !== DB.key || e.newValue == null) return;
   if (typeof DEMO_MODE !== 'undefined' && DEMO_MODE) return;
   try {
     flights = DB.load();
     if (typeof renderDashboard === 'function') renderDashboard();
     if (typeof renderLogbook === 'function') renderLogbook();
     if (typeof updateUndoButton === 'function') updateUndoButton();
   } catch (e2) {
     // Best-effort cross-tab refresh — ignore if a render isn't ready yet.
   }
 });
 // Wire form validation + HHMM masks on the Add Flight form. Safe to call
 // even before the page is visible — listeners attach to existing IDs.
 if (typeof wireFlightFormValidation === 'function') wireFlightFormValidation();
 // First-launch onboarding (only if no profile name set)
 if (shouldShowOnboarding()) {
 setTimeout(startOnboarding, 400);
 }
 } catch (initExtrasErr) {
   // A non-critical setup step threw — log it but DO NOT let it stop the
   // Supabase bootstrap below. (This whole class of bug is what the
   // dashDate guard above fixed; this is belt-and-suspenders.)
   console.error('[init] non-critical setup error (continuing to Supabase):', initExtrasErr);
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
 // Also pull the profile on a restored session so cross-device profile
 // data (medical, iCal URL, prefs) lands without a fresh sign-in.
 if (Sync.pullProfile) Sync.pullProfile();
 if (Sync.pullOpeningBalances) Sync.pullOpeningBalances();
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