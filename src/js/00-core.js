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
// PIPEDA — Captain-name anonymization
//
// Third-party PII handling: when Cumulo imports flight data from Navblue
// iCal or PDF rosters, it may detect captain names (other pilots — third
// parties who haven't consented to being in this user's logbook).
// PIPEDA Principle 4.3 requires consent from the data subject. To stay
// compliant at scale, captain names are anonymized to initials by default.
//
// The user can opt-in to keep full names via Profile → "I have consent /
// will anonymize" toggle (`profile.consentCaptainNames`). Default: false
// (anonymize). When false, this function is called on every incoming
// captain name before it lands in `flights[]`.
//
// Format normalization:
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

// Convenience: apply captain-name anonymization gate based on profile setting.
// Returns the original name if the user has consented (toggle ON),
// otherwise returns the anonymized version.
function gateCaptainName(name, profile) {
  if (!name) return '';
  // Default OFF (anonymize). User must explicitly opt-in via Profile.
  const consented = profile && profile.consentCaptainNames === true;
  return consented ? name : anonymizeCaptainName(name);
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

