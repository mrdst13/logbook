// ═══════════════════════════════════════════
// XSS escape helper — every value interpolated into innerHTML must go
// through this. Most sensitive sources: Navblue iCal parser (captain
// names from rosters), Anthropic OCR output (photo logbook imports),
// PDF roster parser (captain names + flight numbers), JSON backup
// restore (entire flight payload). Failure mode: a single hostile
// backup file or roster image runs arbitrary JS in the pilot's
// browser and exfiltrates localStorage.
// ═══════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ═══════════════════════════════════════════
// PIPEDA — Captain-name anonymization (context-aware model)
//
// Legal anchors:
//   - PIPEDA s.4(2)(b) + Loi 25 art. 1: personal-use exception covers
//     local-device storage of crew names imported from a user's employer roster.
//   - Cumulo Inc. (the vendor) is NOT a controller for data that stays on
//     the user's device. It BECOMES one when data leaves: cloud sync,
//     PDF export to a third party, JSON backup, share.
//   - TC regulatory disclosure (CAR 401.08 / ramp check) is permitted
//     without consent under PIPEDA s.7(3)(c.1)(i). Full names in a TC PDF
//     export are lawful and arguably required for record integrity.
//
// Implementation: store full names locally, anonymize ONLY at egress
// (outbound), keep full names in the TC PDF export. The user controls a
// toggle "Keep full crew names when sharing / syncing" — default OFF.
//
// Format normalization (anonymizeCaptainName helper):
//   "DAOUST, Martin"   → "M.D."  (last, first  →  first.last initials)
//   "Daoust, M"        → "M.D."
//   "Martin Daoust"    → "M.D."
//   "M. Daoust"        → "M.D."
//   "MD"               → "M.D."
//   ""  /  null        → ""
//   "M.D."             → "M.D."  (idempotent — already initials)
// ═══════════════════════════════════════════
function anonymizeCaptainName(name) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  // Already-initial format like "M.D." or "M. D." → return as-is (idempotent)
  if (/^[A-Z]\.\s?[A-Z]\.\s*$/.test(trimmed)) return trimmed.replace(/\s+/g, '');

  // Comma format: "Lastname, Firstname" (Navblue convention)
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',').map(s => s.trim());
    const fi = first ? first.charAt(0).toUpperCase() : '';
    const li = last ? last.charAt(0).toUpperCase() : '';
    return (fi && li) ? `${fi}.${li}.` : (fi ? `${fi}.` : (li ? `${li}.` : ''));
  }

  // Space-separated: "Firstname Lastname" or "Martin Daoust" or "M. Daoust"
  const parts = trimmed.split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) {
    // Single token: take first letter
    return parts[0].charAt(0).toUpperCase() + '.';
  }
  // 2+ tokens: first letter of first + first letter of last
  const fi = parts[0].charAt(0).toUpperCase();
  const li = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${fi}.${li}.`;
}

// Context-aware crew-name resolution.
// Applies equally to PIC (captain) and copilot (F/O) names — both can be
// third-party PII depending on the user's seat that day. Caller decides
// which field is being gated.
// `context` values:
//   'display'    → owner viewing their own logbook (always full)
//   'tc-pdf'     → TC regulatory export (always full — s.7(3)(c.1)(i))
//   'cloud-sync' → push to Supabase / any remote storage (anonymize unless consent)
//   'shareable'  → general PDF / JSON backup for sharing (anonymize unless consent)
function captainNameForContext(name, profile, context) {
  if (!name) return '';
  if (context === 'display' || context === 'tc-pdf') return name;
  // Self-references (the user's own name, "self", "moi", etc.) are NOT
  // third-party PII and never require anonymization regardless of consent.
  if (_isSelfReference(name, profile)) return name;
  // Outbound contexts: anonymize unless the user has explicitly opted in.
  const consented = profile && profile.consentCaptainNames === true;
  return consented ? name : anonymizeCaptainName(name);
}

// Legacy alias: gateCaptainName is now equivalent to the outbound context.
// Kept for backward compatibility — every old call site was already
// "outbound" semantically. Imports no longer call this (they store full).
function gateCaptainName(name, profile) {
  return captainNameForContext(name, profile, 'cloud-sync');
}

// ───────────────────────────────────────────────────────────────────
// "Self" reference resolver for imports.
//
// In paper logbooks, pilots conventionally write either the other pilot's
// name OR "self" / "moi" / their own name in the PIC field — depending
// on which seat they were in that day. Cumulo's data model needs two
// fields kept consistent:
//   - pic      → the actual captain of the flight (always the captain)
//   - crewPosition → the USER's role on that flight: 'PIC' | 'SIC' | 'Dual'
//
// When the OCR extractor returns `pic="self"` (or the user's own name),
// it means the user was the captain. We translate that to:
//   pic = ''           (no third-party name to store; user was PIC)
//   crewPosition = 'PIC'
//
// When `pic` is a real third-party name, we leave it and set
//   crewPosition = 'SIC' (the user was the co-pilot)
//
// Same logic mirrored for `copilot`: "self" there means the user was the
// SIC, and the named captain was actual PIC.
// ───────────────────────────────────────────────────────────────────
function _isSelfReference(token, profile) {
  if (!token || typeof token !== 'string') return false;
  const norm = token.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  if (!norm) return false;
  // Universal self markers
  if (['self', 'moi', 'me', 'myself', 'soi', 'soi-meme', 'moi-meme'].includes(norm)) return true;
  if (!profile) return false;
  const fn = (profile.fname || '').trim().toLowerCase();
  const ln = (profile.lname || '').trim().toLowerCase();
  if (!fn && !ln) return false;
  // Match against various spellings of the user's own name:
  //   "Martin Daoust", "Daoust", "M Daoust", "Daoust M", "M.Daoust", "M. Daoust"
  if (ln && norm === ln) return true;
  if (fn && ln && (norm === `${fn} ${ln}` || norm === `${ln} ${fn}`)) return true;
  if (fn && ln && (norm === `${fn.charAt(0)} ${ln}` || norm === `${ln} ${fn.charAt(0)}`)) return true;
  if (fn && ln && norm === `${fn.charAt(0)}${ln}`) return true;
  return false;
}

function resolveSelfReferences(flight, profile) {
  if (!flight || typeof flight !== 'object') return flight;
  const out = { ...flight };
  const picIsSelf = _isSelfReference(out.pic, profile);
  const copIsSelf = _isSelfReference(out.copilot, profile);
  // PRESERVE what the pilot wrote — TC TP 14052 accepts "SELF" in the PIC
  // column. The resolver's job is ONLY to record the user's seat in
  // crewPosition; we never overwrite the text the pilot recorded in their
  // paper logbook.
  if (picIsSelf) {
    if (!out.crewPosition) out.crewPosition = 'PIC';
  } else if (out.pic) {
    if (!out.crewPosition) out.crewPosition = 'SIC';
  }
  if (copIsSelf) {
    if (!out.crewPosition) out.crewPosition = 'SIC';
  }
  return out;
}

// ═══════════════════════════════════════════
// DEMO MODE — public sandbox (URL param ?demo=1)
//
// When the URL contains ?demo=1, the entire app runs in a read-only
// sandbox: persistent storage is disabled, fake demo data is pre-loaded,
// and a sticky banner warns the visitor that changes won't persist.
// Lets curious pilots try Cumulo without signup — zero friction, zero
// lock-in.
// ═══════════════════════════════════════════
const DEMO_MODE = (() => {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
  } catch { return false; }
})();

const DEMO_FLIGHTS = [
  {
    id: 'demo-1', date: '2026-05-01', flightNum: 'PD150', type: 'E195-E2', reg: 'C-GZQW',
    route: 'YYZ-YOW', dep_icao: 'CYYZ', arr_icao: 'CYOW',
    pic: 'M. Tremblay', copilot: '', crewPosition: 'SIC',
    block: 1.1, duty: 2.2, total: 1.1,
    meDayCop: 1.1, meNightCop: 0, meDayPic: 0, meNightPic: 0,
    xcDayCop: 1.1, xcNightCop: 0,
    ldgDay: 1, ldgNight: 0, approaches: 1,
    multiCrew: 1, source: 'demo'
  },
  {
    id: 'demo-2', date: '2026-04-28', flightNum: 'PD274', type: 'E195-E2', reg: 'C-GKYN',
    route: 'YYC-YOW', dep_icao: 'CYYC', arr_icao: 'CYOW',
    pic: 'J. Bouchard', copilot: '', crewPosition: 'SIC',
    block: 3.9, duty: 5.1, total: 3.9,
    meDayCop: 2.3, meNightCop: 1.6, meDayPic: 0, meNightPic: 0,
    xcDayCop: 2.3, xcNightCop: 1.6,
    ldgDay: 0, ldgNight: 1, approaches: 1,
    multiCrew: 1, source: 'demo'
  },
  {
    id: 'demo-3', date: '2026-04-22', flightNum: 'PD448', type: 'E195-E2', reg: 'C-GKQO',
    route: 'YYJ-YOW', dep_icao: 'CYYJ', arr_icao: 'CYOW',
    pic: 'A. Pelletier', copilot: '', crewPosition: 'SIC',
    block: 4.6, duty: 5.8, total: 4.6,
    meDayCop: 4.6, meNightCop: 0, meDayPic: 0, meNightPic: 0,
    xcDayCop: 4.6, xcNightCop: 0,
    ldgDay: 1, ldgNight: 0, approaches: 1,
    multiCrew: 1, source: 'demo'
  },
  {
    id: 'demo-4', date: '2026-04-15', flightNum: 'PD235', type: 'E195-E2', reg: 'C-GKXV',
    route: 'YYZ-YYT', dep_icao: 'CYYZ', arr_icao: 'CYYT',
    pic: 'D. Lavallée', copilot: '', crewPosition: 'SIC',
    block: 3.1, duty: 4.4, total: 3.1,
    meDayCop: 3.1, meNightCop: 0, meDayPic: 0, meNightPic: 0,
    xcDayCop: 3.1, xcNightCop: 0,
    ldgDay: 1, ldgNight: 0, approaches: 1,
    multiCrew: 1, source: 'demo'
  },
  {
    id: 'demo-5', date: '2026-04-10', flightNum: 'PD447', type: 'E195-E2', reg: 'C-GKXR',
    route: 'YOW-YYJ', dep_icao: 'CYOW', arr_icao: 'CYYJ',
    pic: 'L. Bélanger', copilot: '', crewPosition: 'SIC',
    block: 5.3, duty: 7.0, total: 5.3,
    meDayCop: 4.0, meNightCop: 1.3, meDayPic: 0, meNightPic: 0,
    xcDayCop: 4.0, xcNightCop: 1.3,
    ldgDay: 0, ldgNight: 1, approaches: 1,
    multiCrew: 1, source: 'demo'
  }
];

const DEMO_PROFILE = {
  fname: 'Demo',
  lname: 'Pilot',
  rank: 'F/O',
  airline: 'Demo Airlines',
  base: 'CYOW',
  license: 'XXX-XXXXX',
  medical: '2027-03-15',
  ecg: '',
  fleet: 'E195-E2',
  operatorCodes: 'PD',
  autoCountIFR: true,
  consentCaptainNames: false,
  hideZeroColumns: false,
  pilotType: 'airline705'
};

// ═══════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════
const DB = {
  key: 'logbook_v1',
  profileKey: 'logbook_profile_v1',

  load() {
    if (DEMO_MODE) return JSON.parse(JSON.stringify(DEMO_FLIGHTS));
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
    catch { return []; }
  },
  save(flights) {
    // In demo mode, changes don't persist — silently swallow. The user's
    // in-memory `flights[]` still updates so the UI feels responsive
    // during the demo, but a reload resets to the canned data.
    if (DEMO_MODE) return true;
    return this._persist(this.key, flights, 'vols', 'flights');
  },
  loadProfile() {
    if (DEMO_MODE) return JSON.parse(JSON.stringify(DEMO_PROFILE));
    try { return JSON.parse(localStorage.getItem(this.profileKey) || '{}'); }
    catch { return {}; }
  },
  saveProfile(p) {
    if (DEMO_MODE) return true;
    return this._persist(this.profileKey, p, 'profil', 'profile');
  },

  // Write to localStorage, but NEVER fail silently. A certifiable logbook
  // must not lose a saved entry without telling the pilot. If setItem throws
  // (quota exceeded once the carnet gets large, private-mode storage
  // disabled, disk full…), the old code let the exception escape and the
  // just-entered flight vanished on the next reload. Now we catch it, keep
  // the in-memory data intact, and raise an unmissable persistent banner so
  // the pilot knows to act (export a backup / free space / sign in to sync).
  // Returns true on success, false on failure. Audit 2026-07, item 11.
  _persist(key, value, labelFr, labelEn) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      // Recovered after a prior failure: clear the warning.
      this._clearPersistError();
      return true;
    } catch (e) {
      console.error('[DB] persistence failed for', key, e);
      try { this._showPersistError(labelFr, labelEn); } catch (_) { /* last resort */ }
      return false;
    }
  },

  _showPersistError(labelFr, labelEn) {
    if (typeof document === 'undefined' || !document.body) return;
    let el = document.getElementById('persistError');
    if (!el) {
      el = document.createElement('div');
      el.id = 'persistError';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;' +
        'background:#b42318;color:#fff;padding:12px 44px 12px 16px;' +
        'font-size:14px;line-height:1.4;box-shadow:0 2px 12px rgba(0,0,0,0.25);';
      const close = document.createElement('button');
      close.textContent = '×';
      close.setAttribute('aria-label', 'Fermer / Dismiss');
      close.style.cssText = 'position:absolute;top:8px;right:12px;background:none;' +
        'border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;';
      close.onclick = () => el.remove();
      el.appendChild(close);
      const msg = document.createElement('div');
      msg.id = 'persistErrorMsg';
      el.appendChild(msg);
      document.body.appendChild(el);
    }
    el.querySelector('#persistErrorMsg').textContent =
      'Sauvegarde impossible : votre dernière modification (' + labelFr + ') n’est PAS enregistrée. ' +
      'Exportez une sauvegarde ou libérez de l’espace. — ' +
      'Save failed: your last change (' + labelEn + ') is NOT stored. Export a backup or free up space.';
  },

  _clearPersistError() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('persistError');
    if (el) el.remove();
  }
};

let flights = DB.load();
let pendingImport = [];
let editingId = null;

// ═══════════════════════════════════════════
// MOBILE NAVIGATION
// Pattern: shadcn/ui Sheet / Material-UI Drawer style.
//
//   - Real <button> elements with data-page attributes (no <div role=button>)
//   - Single delegated 'click' listener on <nav> (no touchend, no
//     belt-and-suspenders; click fires reliably on <button> in iOS Safari)
//   - Scroll lock via body.nav-open { overflow:hidden } — no touch-action
//     fiddling with <main> (that was breaking taps on the drawer)
//   - Overlay swallows touchmove to prevent scroll-chaining into <main>
//   - aria-expanded on hamburger reflects state for a11y
// ═══════════════════════════════════════════
function openMobileNav() {
  document.body.classList.add('nav-open');
  const hb = document.getElementById('hamburger');
  if (hb) hb.setAttribute('aria-expanded', 'true');
}

function closeMobileNav() {
  document.body.classList.remove('nav-open');
  const hb = document.getElementById('hamburger');
  if (hb) hb.setAttribute('aria-expanded', 'false');
}

function toggleMobileNav() {
  if (document.body.classList.contains('nav-open')) {
    closeMobileNav();
  } else {
    openMobileNav();
  }
}

function wireNav() {
  // Hamburger
  const hb = document.getElementById('hamburger');
  if (hb) hb.addEventListener('click', toggleMobileNav);

  // Overlay click-to-close
  const ov = document.getElementById('navOverlay');
  if (ov) {
    ov.addEventListener('click', closeMobileNav);
    // Prevent touchmove on overlay from scroll-chaining to <main>.
    // passive:false so preventDefault() is honoured on iOS.
    ov.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  }

  // Delegated nav-item clicks. One listener on <nav> covers every item.
  // Survives re-renders (not that we have any) and is the most reliable
  // mechanism on iOS Safari for <button> children.
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (!btn || !sidebar.contains(btn)) return;
      const page = btn.dataset.page;
      if (!page) return;
      showPage(page);
    });
  }

  // ESC closes drawer (desktop / iPad keyboard users)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
      closeMobileNav();
    }
  });
}

// ═══════════════════════════════════════════
// CONFIRM DIALOG — in-app replacement for native confirm()
// ═══════════════════════════════════════════
// Native browser confirm() looks broken inside a PWA (iOS shows
// "logbook-cxy.pages.dev says:" above the message) and isn't styled.
// This helper renders a Cumulo-styled modal and returns a Promise<boolean>.
//
//   const ok = await confirmDialog({
//     title: 'Clear all flights',
//     body: 'This deletes every flight in your logbook. Cannot be undone.',
//     confirmLabel: 'Clear all',
//     danger: true
//   });
//   if (!ok) return;
//
// Esc key or backdrop click = cancel. The modal removes itself on resolve.
function confirmDialog({ title, body, cancelLabel = (typeof t === 'function' ? t('btn.cancel') : 'Cancel'), confirmLabel = (typeof t === 'function' ? t('btn.confirm') : 'Confirm'), danger = false }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'import-overlay show';
    overlay.dataset.confirmDialog = '1';
    overlay.innerHTML = `
      <div class="import-modal" style="max-width:440px;">
        <div class="import-modal-head">
          <div><div class="t-headline">${esc(title || 'Confirm')}</div></div>
        </div>
        <div class="import-modal-body" style="font-size:13.5px;color:var(--text-secondary);line-height:1.55;white-space:pre-wrap;">${esc(body || '')}</div>
        <div class="import-modal-foot">
          <button class="btn btn-ghost" data-cd="cancel">${esc(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-cd="ok" autofocus>${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    const cleanup = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };
    overlay.addEventListener('click', e => {
      const btn = e.target.closest('[data-cd]');
      if (btn) { cleanup(btn.dataset.cd === 'ok'); return; }
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    // Focus the primary action button so Enter works immediately.
    setTimeout(() => overlay.querySelector('[data-cd="ok"]')?.focus(), 30);
  });
}

// Graceful fallback shown when AI extraction is unavailable: the worker
// normalizes Anthropic 429/529/503 to code:'capacity' (and the per-IP daily
// cap to code:'daily_cap'). The pilot's hours are never lost — the copy
// reassures and points to the other import paths (iCal / CSV / manual entry).
// Single dismiss; we deliberately don't wire fabricated routing buttons.
function showImportFallback(code) {
  const isDaily = code === 'daily_cap';
  const title = (typeof t === 'function')
    ? t(isDaily ? 'import.dailyCap.title' : 'import.capacity.title') : 'Extraction unavailable';
  const body = (typeof t === 'function')
    ? t(isDaily ? 'import.dailyCap.desc' : 'import.capacity.desc') : '';
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay show';
  overlay.dataset.importFallback = '1';
  overlay.innerHTML = `
    <div class="import-modal" style="max-width:440px;">
      <div class="import-modal-head">
        <div><div class="t-headline">${esc(title)}</div></div>
      </div>
      <div class="import-modal-body" style="font-size:13.5px;color:var(--text-secondary);line-height:1.55;">${esc(body)}</div>
      <div class="import-modal-foot">
        <button class="btn btn-primary" data-if="ok" autofocus>${esc(typeof t === 'function' ? t('btn.close') : 'Close')}</button>
      </div>
    </div>
  `;
  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') cleanup(); };
  overlay.addEventListener('click', e => {
    if (e.target.closest('[data-if="ok"]') || e.target === overlay) cleanup();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  setTimeout(() => overlay.querySelector('[data-if="ok"]')?.focus(), 30);
}

// Protective PPC/LOFT date confirmation (Martin 2026-06-30). Fired right after a
// pilot logs a NEW PPC or LOFT (see saveFlight). It asks the pilot to confirm or
// update the date their PPC stays valid until — Cumulo NEVER computes it (the
// interval depends on the operator's approved training program; see registre
// CAR 705.113). The field is pre-filled with the existing ppcDueDate so an
// unchanged value is kept; the pilot attests any change. Merge-save only.
function promptConfirmPPCDate(simType) {
  const tr = (k, v) => (typeof t === 'function') ? t(k, v) : k;
  const prof = (typeof DB !== 'undefined' && DB.loadProfile) ? (DB.loadProfile() || {}) : {};
  const current = prof.ppcDueDate || '';
  const kind = simType === 'LOFT' ? 'LOFT' : 'PPC';
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay show';
  overlay.dataset.ppcPrompt = '1';
  overlay.innerHTML = `
    <div class="import-modal" style="max-width:440px;">
      <div class="import-modal-head"><div><div class="t-headline">${esc(tr('ppcPrompt.title', { kind }))}</div></div></div>
      <div class="import-modal-body" style="font-size:13.5px;color:var(--text-secondary);line-height:1.55;">
        ${esc(tr('ppcPrompt.body'))}
        <div style="margin-top:14px;">
          <label for="ppcPromptDate" style="display:block;font-weight:600;margin-bottom:6px;color:var(--text-primary);">${esc(tr('ppcPrompt.fieldLabel'))}</label>
          <input type="date" id="ppcPromptDate" value="${esc(current)}" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font:inherit;background:var(--surface);color:var(--text-primary);">
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-muted);line-height:1.5;">${esc(tr('ppcPrompt.note'))}</div>
      </div>
      <div class="import-modal-foot">
        <button class="btn btn-ghost" data-ppc="later">${esc(tr('ppcPrompt.later'))}</button>
        <button class="btn btn-primary" data-ppc="save">${esc(tr('ppcPrompt.save'))}</button>
      </div>
    </div>`;
  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const doSave = () => {
    const v = overlay.querySelector('#ppcPromptDate')?.value || '';
    if (v && typeof DB !== 'undefined' && DB.saveProfile && DB.loadProfile) {
      DB.saveProfile({ ...(DB.loadProfile() || {}), ppcDueDate: v });
      if (typeof showToast === 'function') showToast(tr('ppcPrompt.saved'), 'success');
    }
    cleanup();
  };
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); if (e.key === 'Enter') doSave(); };
  overlay.addEventListener('click', e => {
    if (e.target.closest('[data-ppc="save"]')) { doSave(); return; }
    if (e.target.closest('[data-ppc="later"]') || e.target === overlay) cleanup();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  setTimeout(() => overlay.querySelector('#ppcPromptDate')?.focus(), 30);
}
