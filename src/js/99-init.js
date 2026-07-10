// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// Build version stamp — bump every push so user can verify fresh load
const BUILD_VERSION = 'v3a-2026-05-26-atmosphere-everywhere';

// ─── Self-update on launch ──────────────────────────────────────────
// There is NO service worker, so a device that cached an old logbook.html
// (especially an iOS home-screen web app, which caches very aggressively)
// keeps booting stale code even after a fresh deploy — cross-device sync
// then looks "broken" when it's really just old JS. build.js writes a tiny
// version.json alongside the bundle on every build. On launch we fetch it
// with no caching; if the deployed version differs from the one we booted
// with, we reload ONCE against a cache-busting URL so the device silently
// pulls fresh code. Guarded against reload loops and disabled in dev.
// (Martin 2026-07-09 — iPhone kept showing an old bundle after deploys.)
async function checkForFreshBuild() {
  try {
    if (typeof fetch !== 'function') return;
    const host = location.hostname;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(host)) return; // never in dev
    const resp = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
    if (!resp || !resp.ok) return;
    const data = await resp.json();
    const latest = data && data.version;
    if (!latest || latest === BUILD_VERSION) {
      try { sessionStorage.removeItem('cumulo_fresh_reload'); } catch (e) {}
      return;                                   // already current
    }
    // Stale. Reload at most once per target version, so a deploy caught
    // mid-flight (version.json ahead of the served HTML for a few seconds)
    // can never spin us in a reload loop.
    let tried = null;
    try { tried = sessionStorage.getItem('cumulo_fresh_reload'); } catch (e) {}
    if (tried === latest) return;
    try { sessionStorage.setItem('cumulo_fresh_reload', latest); } catch (e) {}
    location.replace(location.pathname + '?v=' + encodeURIComponent(latest));
  } catch (e) { /* offline or blocked — non-fatal, keep running old code */ }
}

// ═══════════════════════════════════════════
// GLOBAL ERROR SAFETY NET
// ═══════════════════════════════════════════
// An uncaught exception or rejected promise used to disappear into the
// console (which the pilot never opens). Now anything that escapes gets a
// quiet, non-blocking toast so a broken action is at least visible — and it
// stays logged for debugging. Registered before init() so it also catches
// failures during startup. Kept deliberately light (personal-use net):
// debounced, never throws from inside the handler, ignores benign
// resource-load errors (a failed CDN asset is handled by the app's own
// typeof guards, not a real fault).
(function installGlobalErrorNet() {
  let lastShownAt = -Infinity; // so the very first error always surfaces
  function surface() {
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    if (now - lastShownAt < 4000) return; // then don't spam on error storms
    lastShownAt = now;
    try {
      if (typeof showToast === 'function') {
        showToast('Une erreur inattendue s’est produite. / An unexpected error occurred.', 'error');
      }
    } catch (_) { /* toast unavailable this early — the console log below stands */ }
  }
  window.addEventListener('error', (e) => {
    // Resource-load errors (img/script 404) have no `.error` and target != window.
    if (!e || (!e.error && !e.message)) return;
    if (e.target && e.target !== window) return;
    console.error('[global] uncaught error:', e.message || e.error, e.error);
    surface();
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[global] unhandled promise rejection:', e && e.reason);
    surface();
  });
})();

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
 // Silently pull fresh code if this device booted a stale cached bundle.
 checkForFreshBuild();
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
 // The auto wrapper is gated by NAVBLUE_AUTO_SYNC_INIT_MS so it only
 // actually hits the worker when the last sync is stale.
 //
 // Sequencing: when a cloud session is restored, the init kick must wait
 // for Sync.pullFlights to settle — importing iCal segments before the
 // other device's copies have been pulled mints fresh UUIDs for the same
 // segments (duplicate flights in a certifiable logbook). The Supabase
 // bootstrap below calls window._kickNavblueInitSync() once the pull
 // settles; with no session (or no Auth build at all) we kick after the
 // usual 1.2 s so first paint and the onboarding modal aren't blocked.
 window._navblueInitKicked = false;
 window._kickNavblueInitSync = (delayMs) => {
   if (window._navblueInitKicked) return;
   window._navblueInitKicked = true;
   if (typeof syncNavblueAuto === 'function') {
     setTimeout(() => syncNavblueAuto('init'), delayMs || 0);
   }
 };
 if (typeof Auth === 'undefined' || !Auth.init) {
   window._kickNavblueInitSync(1200);
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
 // iCal auto-import waits for this pull (see the sequencing note above);
 // kick it whether the pull succeeds or fails so it can never be starved.
 Promise.resolve(Sync.pullFlights())
   .catch(() => {})
   .then(() => { if (window._kickNavblueInitSync) window._kickNavblueInitSync(0); });
 // Also pull the profile on a restored session so cross-device profile
 // data (medical, iCal URL, prefs) lands without a fresh sign-in.
 if (Sync.pullProfile) Sync.pullProfile();
 if (Sync.pullOpeningBalances) Sync.pullOpeningBalances();
 // …and re-push: the device holding the paper-logbook attestation re-uploads it
 // every launch, so a one-time push that predated cloud sync (or failed) self-
 // heals. Empty-balances devices skip the push, so this never blanks the cloud.
 if (Sync.pushOpeningBalances) Sync.pushOpeningBalances();
 // Same self-heal for custom validities + per-type goal BF (only the device
 // that has them writes; empty devices no-op, so nothing gets wiped).
 if (Sync.pushCustomValiditiesIfAny) Sync.pushCustomValiditiesIfAny();
 } else {
 if (window._kickNavblueInitSync) window._kickNavblueInitSync(1200);
 }
 } else {
 if (window._kickNavblueInitSync) window._kickNavblueInitSync(1200);
 }
 // Subscribe to auth state changes so the header updates after
 // signin/signout from any code path.
 Auth.onAuthChange(() => {
 if (typeof renderAuthStateUI === 'function') renderAuthStateUI();
 });
 }).catch(() => {
 // Bootstrap died midway: still kick the iCal auto-import so a broken
 // cloud layer can never starve local roster syncing.
 if (window._kickNavblueInitSync) window._kickNavblueInitSync(1200);
 });
 }
})();