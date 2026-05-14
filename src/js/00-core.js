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
// PIPEDA — Captain-name anonymization (context-aware model, 2026-05-13)
//
// MODEL (validated by 4-expert panel: PIPEDA federal, Loi 25 Quebec,
// retired TC inspector, UX designer):
//
//   - The user (pilot) is the OWNER of their own logbook. Personal-use
//     exception under PIPEDA s.4(2)(b) AND Loi 25 art. 1 covers their
//     local-device storage of crew names imported from their own employer's
//     roster.
//   - Cumulo Inc. (the vendor) is NOT a controller for data that stays on
//     the user's device. It BECOMES one when data leaves: cloud sync,
//     PDF export to a third party, JSON backup, share.
//   - TC regulatory disclosure (CAR 401.08 / ramp check) is permitted
//     without consent under PIPEDA s.7(3)(c.1)(i). Full names in a TC PDF
//     export are lawful and arguably required for record integrity.
//
// RESULT: store full names locally, anonymize ONLY at egress (outbound),
// keep full names in the TC PDF export. The user controls a toggle that
// says "Keep full crew names when sharing / syncing" — default OFF.
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
  // PRESERVE what the pilot wrote (TC TP 14052 accepts "SELF" in the PIC
  // column — the retired inspector on the 2026-05-13 panel confirmed). The
  // resolver's job is ONLY to record the user's seat in crewPosition; we
  // never overwrite the text the pilot recorded in their paper logbook.
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
// DATA LAYER
// ═══════════════════════════════════════════
const DB = {
  key: 'logbook_v1',
  profileKey: 'logbook_profile_v1',

  load() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
    catch { return []; }
  },
  save(flights) {
    localStorage.setItem(this.key, JSON.stringify(flights));
  },
  loadProfile() {
    try { return JSON.parse(localStorage.getItem(this.profileKey) || '{}'); }
    catch { return {}; }
  },
  saveProfile(p) {
    localStorage.setItem(this.profileKey, JSON.stringify(p));
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

