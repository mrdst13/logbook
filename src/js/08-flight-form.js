// ═══════════════════════════════════════════
// QUICK-ENTRY HELPERS (Add Flight form)
// ═══════════════════════════════════════════

// Toggle the advanced fields wrapper (Multi-Engine / Cross Country / Instrument).
// Default state on form open = collapsed. Pilots who need the breakdown open
// it with one click; daily quick-log pilots never see these 16 fields.
function toggleAdvancedFormFields() {
  const wrap = document.getElementById('advancedFormFields');
  const btn = document.getElementById('formAdvancedToggle');
  if (!wrap || !btn) return;
  const opening = wrap.style.display === 'none' || !wrap.style.display;
  wrap.style.display = opening ? '' : 'none';
  btn.textContent = opening
    ? (typeof t === 'function' ? t('flight.hideAdvanced') : 'Hide advanced fields')
    : (typeof t === 'function' ? t('flight.showAdvanced') : 'Show advanced fields (ME · XC · Instrument)');
}

// Populate PIC + Co-Pilot <datalist> autocomplete suggestions from the most
// recent 90 days of flights. Captains rotate — a Porter F/O sees the same
// ~20 names month after month. Cuts ~5 seconds of typing per entry.
function populateRecentNames() {
  if (!Array.isArray(flights)) return;
  const cutoff = shiftDateStr(localTodayStr(), -89);   // last 90 local dates
  const recent = flights.filter(f => f.date && f.date >= cutoff);
  const fillDatalist = (id, values) => {
    const dl = document.getElementById(id);
    if (!dl) return;
    const unique = [...new Set(values.filter(v => v && String(v).trim()))]
      .map(v => String(v).trim()).slice(0, 50);
    dl.innerHTML = unique.map(v => `<option value="${esc(v)}">`).join('');
  };
  fillDatalist('recentPics', recent.map(f => f.pic));
  fillDatalist('recentCops', recent.map(f => f.copilot));
}

// One-time wiring: auto-sync Total Flight Time to Block Time as user types.
// For 95% of airline / commercial ops, Block === Total. Setting both manually
// is friction with no value. The Total field has its own override: once the
// pilot edits Total directly, auto-sync stops for that entry.
(function wireBlockTotalAutoSync() {
  // Run once after DOM is ready (99-init.js calls this at start).
  const wire = () => {
    const block = document.getElementById('f-block');
    const total = document.getElementById('f-total');
    if (!block || !total) return;
    block.addEventListener('input', () => {
      if (!total.value || total.dataset.autoFromBlock === '1') {
        total.value = block.value;
        total.dataset.autoFromBlock = '1';
      }
    });
    total.addEventListener('input', () => {
      // User explicitly typed in Total → stop auto-syncing
      total.dataset.autoFromBlock = '0';
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();

// ─────────────────────────────────────────────────────────────────
//  LOGBOOK COLUMNS — defined per Transport Canada CAR 401.08(2)
//  + Standard 421 (experience categories needed for ATPL / currency).
//  Each column has:
//    key       — field name in the flight object
//    label     — display name (TC official terminology)
//    short     — compact label for narrow columns
//    group     — section grouping for the Settings UI
//    width     — relative width hint (pdf + table)
//    align     — left | right | center
//    decimal   — hours field (rendered as 0.1h)
//    default   — whether shown by default
//    role      — only relevant for which pilot type
// ─────────────────────────────────────────────────────────────────
const LOGBOOK_COLUMNS = [
  // Identification (CAR 401.08(2)(a)(b)(c)(e)(f))
  { key: 'date',         label: 'Date',                short: 'Date',     group: 'Identification', width: 18, align: 'left',   default: true },
  { key: 'flightNum',    label: 'Flight #',            short: 'Flt#',     group: 'Identification', width: 14, align: 'left',   default: false },
  { key: 'type',         label: 'A/C Type',            short: 'Type',     group: 'Identification', width: 16, align: 'left',   default: true },
  { key: 'reg',          label: 'Registration',        short: 'Reg',      group: 'Identification', width: 16, align: 'left',   default: true },
  { key: 'dep_icao',     label: 'From',                short: 'From',     group: 'Identification', width: 12, align: 'left',   default: false },
  { key: 'via',          label: 'Via (intermediate)',  short: 'Via',      group: 'Identification', width: 14, align: 'left',   default: false },
  { key: 'arr_icao',     label: 'To',                  short: 'To',       group: 'Identification', width: 12, align: 'left',   default: false },
  { key: 'route',        label: 'Route',               short: 'Route',    group: 'Identification', width: 18, align: 'left',   default: true },
  { key: 'pic',          label: 'Pilot in Command',    short: 'PIC',      group: 'Identification', width: 22, align: 'left',   default: true },
  { key: 'copilot',      label: 'Co-pilot',            short: 'Cop',      group: 'Identification', width: 22, align: 'left',   default: false },
  { key: 'crewPosition', label: 'Crew Position',       short: 'Position', group: 'Identification', width: 14, align: 'left',   default: false },

  // Flight conditions (CAR 401.08(2)(d))
  { key: 'day',          label: 'Day',                 short: 'Day',      group: 'Conditions',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'night',        label: 'Night',               short: 'Night',    group: 'Conditions',     width: 10, align: 'right', decimal: true, default: true },
  { key: 'vfr',          label: 'VFR',                 short: 'VFR',      group: 'Conditions',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'ifr',          label: 'IFR',                 short: 'IFR',      group: 'Conditions',     width: 10, align: 'right', decimal: true, default: false },

  // Times (CAR 401.08(2)(g))
  { key: 'block',        label: 'Flight Time',         short: 'Flt Time', group: 'Times',          width: 12, align: 'right', decimal: true, default: true },
  { key: 'duty',         label: 'Duty Time',           short: 'Duty',     group: 'Times',          width: 10, align: 'right', decimal: true, default: false },

  // Engine class (Standard 421)
  { key: 'seDay',        label: 'SE Day',              short: 'SE Day',   group: 'Engine class',   width: 10, align: 'right', decimal: true, default: false },
  { key: 'seNight',      label: 'SE Night',            short: 'SE Ngt',   group: 'Engine class',   width: 10, align: 'right', decimal: true, default: false },
  // SE dual-received (student / training). The form already saves these and
  // calcStats counts them, but there was no column to display them — so a
  // student's logged dual entries appeared to vanish. (Audit panel 2026-06-25.)
  { key: 'seDayDual',    label: 'SE Day Dual',         short: 'SED Dual', group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'seNightDual',  label: 'SE Night Dual',       short: 'SEN Dual', group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meDayPic',     label: 'ME Day PIC',          short: 'MED PIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meNightPic',   label: 'ME Night PIC',        short: 'MEN PIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meDayCop',     label: 'ME Day SIC',          short: 'MED SIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: true },
  { key: 'meNightCop',   label: 'ME Night SIC',        short: 'MEN SIC',  group: 'Engine class',   width: 11, align: 'right', decimal: true, default: true },
  { key: 'meDayDual',    label: 'ME Day Dual',         short: 'MED Dual', group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },
  { key: 'meNightDual',  label: 'ME Night Dual',       short: 'MEN Dual', group: 'Engine class',   width: 11, align: 'right', decimal: true, default: false },

  // Helicopter (own engine class — separate currency rules under CAR 401.05).
  // Routed here when acConfig='helicopter' so heli hours don't contaminate
  // SE/ME totals. Schema-additive — backward compatible with existing rows.
  { key: 'heliDayPic',   label: 'Heli Day PIC',        short: 'HD PIC',   group: 'Helicopter',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'heliNightPic', label: 'Heli Night PIC',      short: 'HN PIC',   group: 'Helicopter',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'heliDayCop',   label: 'Heli Day SIC',        short: 'HD SIC',   group: 'Helicopter',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'heliNightCop', label: 'Heli Night SIC',      short: 'HN SIC',   group: 'Helicopter',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'heliDayDual',  label: 'Heli Day Dual',       short: 'HD Dual',  group: 'Helicopter',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'heliNightDual',label: 'Heli Night Dual',     short: 'HN Dual',  group: 'Helicopter',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'hoverTime',    label: 'Hover Time',          short: 'Hover',    group: 'Helicopter',     width: 10, align: 'right', decimal: true, default: false },

  // Cross-country (Standard 421, CAR 401.34)
  { key: 'xcDay',        label: 'XC Day',              short: 'XC Day',   group: 'Cross-country',  width: 10, align: 'right', decimal: true, default: false },
  { key: 'xcNight',      label: 'XC Night',            short: 'XC Ngt',   group: 'Cross-country',  width: 10, align: 'right', decimal: true, default: false },

  // Instrument (Standard 421 — split per inspector best practice)
  { key: 'instActual',   label: 'Inst Actual',         short: 'InstA',    group: 'Instrument',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'instHood',     label: 'Inst Hood',           short: 'InstH',    group: 'Instrument',     width: 10, align: 'right', decimal: true, default: false },
  { key: 'instSim',      label: 'Inst Sim/FSTD',       short: 'InstSim',  group: 'Instrument',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'approaches',   label: 'Approaches',          short: 'App',      group: 'Instrument',     width: 9,  align: 'right', default: false },

  // Take-offs & Landings (CAR 401.05 currency)
  { key: 'toDay',        label: 'T/O Day',             short: 'T/O D',    group: 'Landings',       width: 9,  align: 'right', default: false },
  { key: 'toNight',      label: 'T/O Night',           short: 'T/O N',    group: 'Landings',       width: 9,  align: 'right', default: false },
  { key: 'ldgDay',       label: 'LDG Day',             short: 'L Day',    group: 'Landings',       width: 9,  align: 'right', default: false },
  { key: 'ldgNight',     label: 'LDG Night',           short: 'L Ngt',    group: 'Landings',       width: 9,  align: 'right', default: false },

  // Simulator (CAR 401.08 + Standard 421 — sim time must be separate from flight time)
  { key: 'isSim',        label: 'Simulator',           short: 'SIM',      group: 'Simulator',      width: 9,  align: 'center', default: false },
  { key: 'simType',      label: 'Sim Type (FFS/FTD)',  short: 'SimType',  group: 'Simulator',      width: 14, align: 'left',   default: false },
  { key: 'simSession',   label: 'Session Type',        short: 'Session',  group: 'Simulator',      width: 16, align: 'left',   default: false },
  { key: 'simRegistration', label: 'Sim Device ID',    short: 'Device',   group: 'Simulator',      width: 14, align: 'left',   default: false },

  // Dual Given (CFI / instructor instruction time — CAR 421.34 ATPL credit).
  // Promoted from "Other" to its own group so it surfaces clearly for
  // instructors. The PDF cover totals now include a Dual Given line.
  { key: 'dualGivenDay',  label: 'Dual Given Day',     short: 'DG Day',   group: 'Dual Given',     width: 11, align: 'right', decimal: true, default: false },
  { key: 'dualGivenNight',label: 'Dual Given Night',   short: 'DG Ngt',   group: 'Dual Given',     width: 11, align: 'right', decimal: true, default: false },

  // Other
  { key: 'picus',         label: 'PICUS',              short: 'PICUS',    group: 'Other',          width: 10, align: 'right', decimal: true, default: false },
  { key: 'multiCrew',     label: 'Multi-Crew',         short: 'MC',       group: 'Other',          width: 9,  align: 'center', default: false },
  { key: 'acConfig',      label: 'AC Config',          short: 'Config',   group: 'Other',          width: 12, align: 'left',  default: false },
  { key: 'remarks',       label: 'Remarks',            short: 'Remarks',  group: 'Other',          width: 24, align: 'left',  default: false },

  // Computed total (always shown)
  { key: 'total',        label: 'Total',               short: 'Total',    group: 'Times',          width: 12, align: 'right', decimal: true, default: true }
];

// Translated accessors for on-screen rendering of column headers / picker.
// The raw English label/short/group are kept on the column objects because
// the TC PDF export (12-pdf-export.js doc.text) must stay English by regulation.
const _COL_GROUP_KEY = {
  'Identification': 'colGroup.identification',
  'Conditions': 'colGroup.conditions',
  'Times': 'flight.section.times',
  'Engine class': 'flight.section.engine',
  'Helicopter': 'colGroup.helicopter',
  'Cross-country': 'flight.section.xc',
  'Instrument': 'flight.section.instrument',
  'Landings': 'flight.section.landings',
  'Simulator': 'flight.section.sim',
  'Dual Given': 'colGroup.dualGiven',
  'Other': 'flight.section.other',
};
function colLabel(c) { return (typeof t === 'function') ? t('col.' + c.key) : c.label; }
function colShort(c) { return (typeof t === 'function') ? t('colShort.' + c.key) : (c.short || c.label); }
function colGroup(c) {
  const k = _COL_GROUP_KEY[c.group];
  return (k && typeof t === 'function') ? t(k) : c.group;
}

const COLUMN_PREFS_KEY = 'cumulo_column_prefs_v1';

function loadColumnPrefs() {
  try {
    const raw = localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveColumnPrefs(prefs) {
  localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs));
  // Carry it to the account. Saved settings used to be one localStorage write
  // and nothing else, so each one stayed on the device that set it.
  try { if (typeof Sync !== 'undefined' && Sync.pushDeviceSettingsIfAny) Sync.pushDeviceSettingsIfAny({ intent: true }); } catch (e) {}
}

function getVisibleColumns(context = 'table') {
  // context: 'table' (logbook page) or 'pdf' (export)
  const prefs = loadColumnPrefs() || {};
  let visible = LOGBOOK_COLUMNS.filter(c => {
    const pref = prefs[c.key];
    return pref === undefined ? c.default : pref === true;
  });
  // Always include 'total' as final column
  if (!visible.find(c => c.key === 'total')) {
    visible.push(LOGBOOK_COLUMNS.find(c => c.key === 'total'));
  }
  // Screen preference: show Flight Time right before Night, so the number a pilot
  // reads most isn't buried off to the right (Martin's ask 2026-07-15). Screen
  // only — the TC PDF export (context='pdf') keeps the CAR 401.08 column order.
  if (context === 'table') {
    const bi = visible.findIndex(c => c.key === 'block');
    const ni = visible.findIndex(c => c.key === 'night');
    if (bi >= 0 && ni >= 0 && bi > ni) {
      const blockCol = visible.splice(bi, 1)[0];
      visible.splice(visible.findIndex(c => c.key === 'night'), 0, blockCol);
    }
  }
  // Screen-only auto-hide of empty numeric columns (profile.hideZeroColumns).
  // The TC PDF export (context='pdf') always keeps the full 38 columns for
  // ramp-check compliance — this branch never runs there.
  if (context === 'table' && typeof flights !== 'undefined' && flights.length > 0 && typeof DB !== 'undefined') {
    const prof = DB.loadProfile();
    if (prof && prof.hideZeroColumns) {
      const numericIntKeys = new Set(['ldgDay','ldgNight','approaches','toDay','toNight']);
      visible = visible.filter(c => {
        if (c.key === 'total') return true;                         // total always shown
        if (!c.decimal && !numericIntKeys.has(c.key)) return true;  // text/boolean columns always shown
        const sum = flights.reduce((s, f) => s + (+computeCellValue(f, c.key) || 0), 0);
        return sum > 0;
      });
    }
  }
  return visible;
}

// Compute derived fields on the fly (sum aggregates)
function computeCellValue(f, key) {
  switch (key) {
    // Day/Night columns of the certifiable PDF + logbook table: total time
    // across EVERY class/role via the shared helpers. Previously excluded
    // helicopter night and seNightDual, so a heli/student pilot's PDF showed
    // 0h of night. (Audit panel 2026-06-25 must-fix #1.)
    case 'day':         return dayHoursOf(f);
    case 'night':       return nightHoursOf(f);
    case 'ifr':         return ((+f.instActual||0)+(+f.instHood||0));
    case 'vfr':         {
      const total = +f.total || +f.block || 0;
      const ifr = (+f.instActual||0)+(+f.instHood||0);
      return Math.max(0, total - ifr);
    }
    case 'xcDay':       return ((+f.xcDayPic||0)+(+f.xcDayCop||0)+(+f.xcDayDual||0));
    case 'xcNight':     return ((+f.xcNightPic||0)+(+f.xcNightCop||0)+(+f.xcNightDual||0));
    case 'crewPosition': {
      // Include helicopter + single-engine buckets so heli/SE pilots get a
      // real crew position instead of '—'. (Audit panel 2026-06-25.)
      if ((+f.meDayPic||0)+(+f.meNightPic||0)+(+f.heliDayPic||0)+(+f.heliNightPic||0)+(+f.seDay||0)+(+f.seNight||0) > 0) return 'PIC';
      if ((+f.meDayDual||0)+(+f.meNightDual||0)+(+f.heliDayDual||0)+(+f.heliNightDual||0)+(+f.seDayDual||0)+(+f.seNightDual||0) > 0) return t('crewPos.dual');
      if ((+f.meDayCop||0)+(+f.meNightCop||0)+(+f.heliDayCop||0)+(+f.heliNightCop||0) > 0) return 'SIC';
      return '—';
    }
    case 'multiCrew':   return f.multiCrew ? '✓' : '—';
    case 'toDay':       return f.toDay !== undefined ? f.toDay : (f.ldgDay || 0);
    case 'toNight':     return f.toNight !== undefined ? f.toNight : (f.ldgNight || 0);
    default:            return f[key];
  }
}

const NAVBLUE_URL_KEY = 'cumulo_navblue_url';
const NAVBLUE_LAST_SYNC_KEY = 'cumulo_navblue_last_sync';
// Set by clearNavblueUrl, cleared by saveNavblueUrl. Marks "this device was
// disconnected on purpose" so the cross-device restore (Sync.pullProfile) and
// the launch-time re-upload (Sync.pushDeviceSettingsIfAny) both leave it alone —
// otherwise Remove would silently undo itself on the next launch.
const NAVBLUE_REMOVED_KEY = 'cumulo_navblue_removed_v1';
const WORKER_URL = 'https://logbook-api.martindaoust33.workers.dev';
// Forward-looking roster FORECAST cache (Duty-page cumulative-limit projection).
// This is PLANNING data, never certifiable logbook data — see rosterForecastFromEvents.
const CUMULO_FORECAST_KEY = 'cumulo_roster_forecast_v1';
// The whole published roster (flights, days off, ground duty, standby) for the
// Schedule page. Planning data only — never counted as logbook time.
const CUMULO_CALENDAR_KEY = 'cumulo_roster_calendar_v1';
// Auto-sync gates — keep us from hammering the worker every page load.
// On init: skip if last sync was less than 30 min ago.
// On visibilitychange (tab refocus): skip if less than 15 min ago.
// Pilots typically open the app a few times a day, so these intervals
// catch new Navblue events within a meaningful window while keeping
// the worker quiet on rapid navigations between tabs.
const NAVBLUE_AUTO_SYNC_INIT_MS    = 30 * 60 * 1000;
const NAVBLUE_AUTO_SYNC_FOCUS_MS   = 15 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────
//  AIRPORT COORDS — needed for night-time (RAC 101.01) and
//  cross-country (CAR 401.34) calculations
// ─────────────────────────────────────────────────────────────────
const AIRPORT_COORDS = {
  // Canada
  CYOW: { lat: 45.3225, lon: -75.6692, name: 'Ottawa' },
  CYYZ: { lat: 43.6777, lon: -79.6248, name: 'Toronto Pearson' },
  CYYC: { lat: 51.1140, lon: -114.0203, name: 'Calgary' },
  CYVR: { lat: 49.1939, lon: -123.1844, name: 'Vancouver' },
  CYYJ: { lat: 48.6469, lon: -123.4258, name: 'Victoria' },
  CYHZ: { lat: 44.8808, lon: -63.5089, name: 'Halifax' },
  CYEG: { lat: 53.3097, lon: -113.5800, name: 'Edmonton' },
  CYYT: { lat: 47.6186, lon: -52.7519, name: "St. John's" },
  CYTZ: { lat: 43.6275, lon: -79.3961, name: 'Toronto Billy Bishop' },
  CYQB: { lat: 46.7911, lon: -71.3933, name: 'Quebec City' },
  CYUL: { lat: 45.4706, lon: -73.7408, name: 'Montreal' },
  CYHM: { lat: 43.1731, lon: -79.9347, name: 'Hamilton' },
  CYQT: { lat: 48.3717, lon: -89.3239, name: 'Thunder Bay' },
  CYQR: { lat: 50.4319, lon: -104.6660, name: 'Regina' },
  CYXE: { lat: 52.1708, lon: -106.6997, name: 'Saskatoon' },
  CYQM: { lat: 46.1122, lon: -64.6786, name: 'Moncton' },
  CYWG: { lat: 49.9100, lon: -97.2398, name: 'Winnipeg' },
  CYFB: { lat: 63.7564, lon: -68.5558, name: 'Iqaluit' },
  CYYG: { lat: 46.2900, lon: -63.1211, name: 'Charlottetown' },
  CYQX: { lat: 48.9369, lon: -54.5681, name: 'Gander' },
  CYDF: { lat: 49.2108, lon: -57.3914, name: 'Deer Lake' },
  CYQY: { lat: 46.1614, lon: -60.0478, name: 'Sydney' },
  CYSJ: { lat: 45.3161, lon: -65.8903, name: 'Saint John' },
  CYQI: { lat: 43.8269, lon: -66.0881, name: 'Yarmouth' },
  CYZF: { lat: 62.4628, lon: -114.4403, name: 'Yellowknife' },
  CYXY: { lat: 60.7095, lon: -135.0672, name: 'Whitehorse' },
  CYXX: { lat: 49.0252, lon: -122.3611, name: 'Abbotsford' },
  CYLW: { lat: 49.9561, lon: -119.3778, name: 'Kelowna' },
  CYKA: { lat: 50.7022, lon: -120.4444, name: 'Kamloops' },
  CYXS: { lat: 53.8894, lon: -122.6789, name: 'Prince George' },
  // USA
  KBOS: { lat: 42.3656, lon: -71.0096, name: 'Boston' },
  KJFK: { lat: 40.6398, lon: -73.7789, name: 'New York JFK' },
  KLGA: { lat: 40.7772, lon: -73.8726, name: 'New York LaGuardia' },
  KEWR: { lat: 40.6925, lon: -74.1687, name: 'Newark' },
  KPHL: { lat: 39.8729, lon: -75.2437, name: 'Philadelphia' },
  KDCA: { lat: 38.8521, lon: -77.0377, name: 'Washington Reagan' },
  KIAD: { lat: 38.9531, lon: -77.4565, name: 'Washington Dulles' },
  KMIA: { lat: 25.7959, lon: -80.2870, name: 'Miami' },
  KMCO: { lat: 28.4312, lon: -81.3081, name: 'Orlando' },
  KFLL: { lat: 26.0726, lon: -80.1527, name: 'Fort Lauderdale' },
  KTPA: { lat: 27.9755, lon: -82.5332, name: 'Tampa' },
  KLAX: { lat: 33.9416, lon: -118.4085, name: 'Los Angeles' },
  KSFO: { lat: 37.6213, lon: -122.3790, name: 'San Francisco' },
  KLAS: { lat: 36.0840, lon: -115.1537, name: 'Las Vegas' },
  KORD: { lat: 41.9742, lon: -87.9073, name: "Chicago O'Hare" },
  KMDW: { lat: 41.7868, lon: -87.7522, name: 'Chicago Midway' },
  KDEN: { lat: 39.8561, lon: -104.6737, name: 'Denver' },
  KPHX: { lat: 33.4373, lon: -112.0078, name: 'Phoenix' },
  // Mexico, Caribbean
  MMUN: { lat: 21.0365, lon: -86.8771, name: 'Cancun' },
  MMPR: { lat: 20.6801, lon: -105.2542, name: 'Puerto Vallarta' },
  MMSD: { lat: 23.1518, lon: -109.7211, name: 'San Jose del Cabo' },
  MYNN: { lat: 25.0390, lon: -77.4661, name: 'Nassau' },
  MDPC: { lat: 18.5675, lon: -68.3634, name: 'Punta Cana' },
  MDPP: { lat: 19.7579, lon: -70.5700, name: 'Puerto Plata' },
  MKJS: { lat: 18.5037, lon: -77.9134, name: 'Montego Bay' },
  TBPB: { lat: 13.0746, lon: -59.4925, name: 'Bridgetown' },
  TNCA: { lat: 12.5014, lon: -70.0152, name: 'Aruba' }
};

// Departure-airport IANA time zone — used to date an iCal flight by its LOCAL
// day of departure, not the UTC day. A late-evening local departure has a UTC
// timestamp that has already rolled past midnight, so dating by UTC logs the
// flight a day late (Martin 2026-07-10 — real bug: icsDate used the UTC date).
// IANA zone NAMES only: Intl applies the correct standard/daylight offset
// automatically, so NO offset is ever hand-coded (that is what avoids DST bugs).
// One entry per airport in AIRPORT_COORDS. Unknown airport → caller falls back
// to the UTC date (unchanged behaviour, never a regression).
const AIRPORT_TZ = {
  // Canada — Eastern
  CYOW:'America/Toronto', CYYZ:'America/Toronto', CYTZ:'America/Toronto',
  CYQB:'America/Toronto', CYUL:'America/Toronto', CYHM:'America/Toronto',
  CYQT:'America/Toronto', CYFB:'America/Toronto',
  // Canada — Atlantic
  CYHZ:'America/Halifax', CYQM:'America/Halifax', CYYG:'America/Halifax',
  CYQY:'America/Halifax', CYSJ:'America/Halifax', CYQI:'America/Halifax',
  // Canada — Newfoundland (UTC-3:30)
  CYYT:'America/St_Johns', CYQX:'America/St_Johns', CYDF:'America/St_Johns',
  // Canada — Central
  CYWG:'America/Winnipeg',
  // Canada — Saskatchewan (NO daylight saving)
  CYQR:'America/Regina', CYXE:'America/Regina',
  // Canada — Mountain
  CYYC:'America/Edmonton', CYEG:'America/Edmonton', CYZF:'America/Edmonton',
  // Canada — Pacific
  CYVR:'America/Vancouver', CYYJ:'America/Vancouver', CYXX:'America/Vancouver',
  CYLW:'America/Vancouver', CYKA:'America/Vancouver', CYXS:'America/Vancouver',
  // Canada — Yukon (permanent UTC-7)
  CYXY:'America/Whitehorse',
  // USA — Eastern
  KBOS:'America/New_York', KJFK:'America/New_York', KLGA:'America/New_York',
  KEWR:'America/New_York', KPHL:'America/New_York', KDCA:'America/New_York',
  KIAD:'America/New_York', KMIA:'America/New_York', KMCO:'America/New_York',
  KFLL:'America/New_York', KTPA:'America/New_York',
  // USA — Central
  KORD:'America/Chicago', KMDW:'America/Chicago',
  // USA — Mountain / Arizona (no DST)
  KDEN:'America/Denver', KPHX:'America/Phoenix',
  // USA — Pacific
  KLAX:'America/Los_Angeles', KSFO:'America/Los_Angeles', KLAS:'America/Los_Angeles',
  // Mexico
  MMUN:'America/Cancun', MMPR:'America/Mexico_City', MMSD:'America/Mazatlan',
  // Caribbean
  MYNN:'America/Nassau', MDPC:'America/Santo_Domingo', MDPP:'America/Santo_Domingo',
  MKJS:'America/Jamaica', TBPB:'America/Barbados', TNCA:'America/Aruba'
};

// ─────────────────────────────────────────────────────────────────
//  GEO / DISTANCE — Haversine + Cross-Country detection
//  Cross-country (CAR 101.01 "cross-country flight time"): destination
//  "at least 25 nautical miles from the point of departure" (≥ 25 NM = 46.3 km).
//  Verified against laws-lois SOR-96-433 s.101.01, 2026-06-25. See
//  docs/REGISTRE-REGLEMENTAIRE.md.
// ─────────────────────────────────────────────────────────────────
function haversineKM(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180)
          * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isCrossCountry(depICAO, arrICAO) {
  if (!depICAO || !arrICAO || depICAO === arrICAO) return false;
  const dep = AIRPORT_COORDS[depICAO];
  const arr = AIRPORT_COORDS[arrICAO];
  // Unknown airport(s): distance can't be measured, so we must NOT assert
  // cross-country from differing ICAO codes alone — two strips 5 NM apart have
  // different codes. Return null = "unknown"; callers leave XC empty rather
  // than fabricate certifiable XC time. (Opus audit — XC over-detection.)
  if (!dep || !arr) return null;
  // "at least 25 NM" = ≥ 25 NM (46.3 km). Inclusive per CAR 101.01.
  return haversineKM(dep.lat, dep.lon, arr.lat, arr.lon) >= 46.3;
}

// ─────────────────────────────────────────────────────────────────
//  SUNRISE / SUNSET — NOAA solar position algorithm
//  Returns { sunriseUTC, sunsetUTC, polar } for the given UTC date + coords
// ─────────────────────────────────────────────────────────────────
function calcSunriseSunset(date, lat, lon, zenithDeg) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const startUTC = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(y, m-1, d) - startUTC) / 86400000) + 1;

  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
  const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma)
             - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma)
             - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma);
  const eot = 229.18 * (0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma)
            - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma));

  const solarNoonMin = 720 - 4*lon - eot;

  const latRad = lat * Math.PI / 180;
  // Default 90.833° = geometric sunrise/sunset (incl. atmospheric refraction).
  // Pass 96° for civil twilight (sun 6° below the horizon) — the boundary the
  // Canadian definition of "night" (CAR 101.01) is built on.
  const zenith = (zenithDeg || 90.833) * Math.PI / 180;
  const cosH = (Math.cos(zenith) - Math.sin(latRad)*Math.sin(decl))
             / (Math.cos(latRad) * Math.cos(decl));

  if (cosH > 1)  return { sunriseUTC: null, sunsetUTC: null, polar: 'night' };
  if (cosH < -1) return { sunriseUTC: null, sunsetUTC: null, polar: 'day' };

  const H_min = Math.acos(cosH) * 180 / Math.PI * 4;
  const sunriseMin = solarNoonMin - H_min;
  const sunsetMin  = solarNoonMin + H_min;

  const dayStart = Date.UTC(y, m-1, d);
  return {
    sunriseUTC: new Date(dayStart + sunriseMin * 60000),
    sunsetUTC:  new Date(dayStart + sunsetMin * 60000),
    polar: null
  };
}

// "Is this UTC time night under CAR 101.01 at this location?"
// Canadian "night" = the period between the END of evening civil twilight and
// the BEGINNING of morning civil twilight (sun 6° below the horizon → zenith
// 96°). This replaces the old/repealed "sunset +30 min / sunrise −30 min"
// rule, which materially over- or under-counted night at the high/bush
// latitudes Cumulo serves. (Opus audit C1; confirmed as the official
// Transport Canada definition.)
function isNightUTC(utcTime, lat, lon) {
  const ct = calcSunriseSunset(utcTime, lat, lon, 96);  // civil-twilight boundaries
  if (ct.polar === 'night') return true;   // sun never reaches −6°: always night
  if (ct.polar === 'day')   return false;  // sun never drops to −6°: no civil night
  // ct.sunsetUTC  = end of evening civil twilight; ct.sunriseUTC = beginning of
  // morning civil twilight. Night spans midnight, so it's night when the time
  // is after evening twilight ends OR before morning twilight begins.
  return utcTime >= ct.sunsetUTC || utcTime <= ct.sunriseUTC;
}

// Calculate the day/night split (in hours) of a flight given its
// UTC block-off / block-on times and dep/arr coords.
// Sampling at 1-minute resolution (max 360 samples for a 6h flight = fast).
function calculateDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords) {
  const totalMs = blockOnUTC.getTime() - blockOffUTC.getTime();
  if (totalMs <= 0) return { dayHours: 0, nightHours: 0 };
  const totalHours = totalMs / 3600000;

  // Use midpoint coords (good enough for non-polar flights up to 6h)
  const lat = (depCoords.lat + arrCoords.lat) / 2;
  const lon = (depCoords.lon + arrCoords.lon) / 2;

  // Each sample is charged only the time it actually represents, so the
  // minute the flight ends inside contributes its real remainder and
  // nothing more. The previous version charged that minute in full inside
  // the loop AND added its remainder again afterwards, overstating night
  // by up to a minute on any leg whose block is not a whole number of
  // minutes. On a leg flown entirely at night that pushed night past the
  // block itself and printed a NEGATIVE day figure in a certifiable
  // column (found by review, 2026-07-26: PD478 YTZ-YOW, BLH 00:52, gave
  // day -0.02 against night 0.89 on a 0.87 block).
  const stepMs = 60000;
  const endMs = blockOnUTC.getTime();
  let nightMs = 0;
  for (let t = blockOffUTC.getTime(); t < endMs; t += stepMs) {
    const span = Math.min(stepMs, endMs - t);
    if (isNightUTC(new Date(t), lat, lon)) nightMs += span;
  }
  // Night can never exceed the block, and day can never be negative.
  const nightHours = +(Math.min(nightMs, totalMs) / 3600000).toFixed(2);
  const dayHours = +Math.max(0, totalHours - nightHours).toFixed(2);
  return { dayHours, nightHours };
}

// Build a UTC Date from a flight date "YYYY-MM-DD" + UTC time "HHMM"
function buildUTCDateTime(yyyyMmDd, hhmm) {
  if (!yyyyMmDd || !hhmm || hhmm.length !== 4) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const hh = +hhmm.substring(0, 2);
  const mm = +hhmm.substring(2, 4);
  if (isNaN(y) || isNaN(hh)) return null;
  return new Date(Date.UTC(y, m-1, d, hh, mm));
}

// IATA → ICAO map for destinations Porter operates.
// For unknown IATA codes starting with Y (typically Canadian), we prefix with "C".
const IATA_TO_ICAO = {
  // Canada (most Porter routes — preserving full ICAO)
  YOW:'CYOW', YYZ:'CYYZ', YYC:'CYYC', YVR:'CYVR', YYJ:'CYYJ', YHZ:'CYHZ',
  YEG:'CYEG', YYT:'CYYT', YTZ:'CYTZ', YQB:'CYQB', YUL:'CYUL', YHM:'CYHM',
  YQT:'CYQT', YQR:'CYQR', YXE:'CYXE', YQM:'CYQM', YWG:'CYWG', YFB:'CYFB',
  YYG:'CYYG', YQX:'CYQX', YDF:'CYDF', YQY:'CYQY', YSJ:'CYSJ', YQI:'CYQI',
  YZF:'CYZF', YXY:'CYXY', YXX:'CYXX', YLW:'CYLW', YKA:'CYKA', YXS:'CYXS',
  YBR:'CYBR', YPR:'CYPR', YZT:'CYZT', YOJ:'CYOJ',
  // USA (Porter International)
  BOS:'KBOS', JFK:'KJFK', LGA:'KLGA', EWR:'KEWR', PHL:'KPHL', DCA:'KDCA',
  IAD:'KIAD', MIA:'KMIA', MCO:'KMCO', FLL:'KFLL', TPA:'KTPA', LAX:'KLAX',
  SFO:'KSFO', LAS:'KLAS', ORD:'KORD', MDW:'KMDW', DEN:'KDEN', PHX:'KPHX',
  // Mexico, Caribbean
  CUN:'MMUN', PVR:'MMPR', SJD:'MMSD', NAS:'MYNN', POP:'MDPP', PUJ:'MDPC',
  MBJ:'MKJS', BGI:'TBPB', AUA:'TNCA'
};

function iataToIcao(iata) {
  if (!iata) return '';
  const u = iata.toUpperCase().trim();
  if (u.length === 4) return u;  // already ICAO
  if (IATA_TO_ICAO[u]) return IATA_TO_ICAO[u];
  // Canadian fallback: prefix with C if 3 letters starting with Y
  if (u.length === 3 && u[0] === 'Y') return 'C' + u;
  return u;  // unknown — leave as-is
}

// Parse ICS text (handles RFC 5545 line-folding: continuation lines start with space/tab)
function parseICS(text) {
  // Unfold continuation lines
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT') { if (current) events.push(current); current = null; }
    else if (current) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const keyPart = line.substring(0, colon);
      const value = line.substring(colon + 1);
      const key = keyPart.split(';')[0];  // strip params like ;VALUE=DATE
      current[key] = value;
    }
  }
  return events;
}

// "HH:MM" → decimal hours (e.g. "4:30" → 4.50). Returns 0 if invalid.
function hhmmToDecimal(s) {
  if (!s) return 0;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return +m[1] + (+m[2] / 60);
}

// "YYYYMMDD" or "YYYYMMDDTHHMMSSZ" → "YYYY-MM-DD" (UTC date)
function icsDate(dtstart) {
  if (!dtstart) return '';
  const m = dtstart.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// A flight's logbook DATE = the LOCAL calendar day of departure, not the UTC
// day. DTSTART is UTC, so a late-evening local departure (whose UTC timestamp
// has rolled past midnight) must be converted back to the departure airport's
// local zone before taking the date — otherwise it is logged a day late.
// Intl applies the correct offset AND daylight saving, so nothing is hand-coded.
// Falls back to the UTC date when the airport's zone is unknown or Intl is
// unavailable — never worse than the previous behaviour. (Martin 2026-07-10.)
function icsLocalDate(dtstart, depICAO) {
  const utc = icsDateTime(dtstart);
  const tz = depICAO && (typeof AIRPORT_TZ !== 'undefined') && AIRPORT_TZ[depICAO];
  if (!utc || !tz) return icsDate(dtstart);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(utc);
    const get = t => (parts.find(p => p.type === t) || {}).value;
    const y = get('year'), mo = get('month'), d = get('day');
    return (y && mo && d) ? `${y}-${mo}-${d}` : icsDate(dtstart);
  } catch (e) {
    return icsDate(dtstart);
  }
}

// "YYYYMMDDTHHMMSSZ" → Date object (UTC, never ambiguous)
// This is the SOURCE OF TRUTH for time calculations — always parse the full DTSTART
// instead of reconstructing from date + HHMM (which can drift across UTC midnight
// for flights departing late local time, e.g. CYYC 21:00L → 04:00Z next day).
function icsDateTime(dtstart) {
  if (!dtstart) return null;
  const m = dtstart.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
}

// Date object → "YYYYMMDDTHHMMSSZ", the shape icsDate / icsLocalDate parse.
function isoBasicUTC(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const p2 = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate())
    + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
}

// The SCHEDULED BLOCK-OFF of a roster leg.
//
// DTSTART is NOT the departure. Proven against Martin's own Porter feed
// on 2026-07-26: PD589 carries DTSTART 20260725T100000Z while its own
// DESCRIPTION says CI 1000Z and STD 1100Z, so DTSTART is the CHECK-IN,
// a full hour before the aircraft moves. On a continuing leg it is a
// turnaround marker instead (PD590: DTSTART 1507Z against STD 1520Z).
// DTEND is DTSTART plus Duration, i.e. the duty window, not the block.
//
// Using DTSTART as block-off pushed the RAC 101.01 day/night split up to
// an hour early on the first leg of every duty, and could date a leg on
// the wrong local day when check-in and departure straddle midnight.
//
// STD is the published block-off, but it is a bare HHMM Zulu with no
// date. DTSTART still does the job it is actually good for: fixing the
// calendar. Block-off = the first instant at or after DTSTART whose UTC
// clock reads STD, which lands on the right side of UTC midnight without
// any hand-rolled date arithmetic.
//
// If the feed publishes no STD, or the gap comes out implausible, the old
// DTSTART value is kept rather than inventing a departure time.
const ICAL_MAX_CHECKIN_TO_STD_MS = 12 * 60 * 60 * 1000;

function icalBlockOffUTC(ev) {
  const anchor = icsDateTime(ev && ev.DTSTART);
  if (!anchor) return null;
  const std = String((ev && ev.DESCRIPTION) || '').match(/STD\s+(\d{4})Z/);
  if (!std) return anchor;
  const hh = +std[1].slice(0, 2);
  const mm = +std[1].slice(2);
  if (hh > 23 || mm > 59) return anchor;
  let off = new Date(Date.UTC(
    anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), hh, mm, 0
  ));
  // Departure is never before the duty that precedes it, so a value that
  // lands earlier belongs to the next UTC day.
  if (off.getTime() < anchor.getTime()) off = new Date(off.getTime() + 86400000);
  if (off.getTime() - anchor.getTime() > ICAL_MAX_CHECKIN_TO_STD_MS) return anchor;
  return off;
}

// Build the airline-flight regex from the user's profile operatorCodes
function getOperatorFlightRegex() {
  const p = DB.loadProfile();
  const codes = (p.operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) return /^PD\d+\s/;
  // Build /^(PD|AC|QK|...)\d+\s/
  const pattern = codes.map(c => c.replace(/[^A-Z0-9]/g, '')).join('|');
  return new RegExp(`^(?:${pattern})\\d+\\s`, 'i');
}

// Extract captain + co-pilot names from a Navblue iCal VEVENT
// DESCRIPTION field. Different Navblue tenants format crew lines slightly
// differently — we try multiple patterns and fall back to '' if nothing
// matches. When extraction fails for a flight that HAS crew text, we log
// the raw DESCRIPTION to console so the regex can be refined.
function extractNavblueCrew(desc) {
  if (!desc) return { pic: '', copilot: '' };
  const out = { pic: '', copilot: '' };
  const clean = desc.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');

  // Helper: pull the value after a role keyword. Accepts "Smith, John",
  // "John Smith", "M. Daoust", "SMITH J" etc. — anything up to newline,
  // pipe, slash, or another role keyword.
  const captureAfter = (re) => {
    const m = clean.match(re);
    if (!m) return '';
    return m[1].trim().replace(/\s+/g, ' ').replace(/[|/]+.*$/, '').trim();
  };

  // Pattern set: each tries to find a captain (PIC). Order = most specific first.
  const cptPatterns = [
    /(?:^|\n)\s*(?:CAPT|CPT|Captain|Capitaine|Cmdt)[:\s.]+([^\n|/]+)/i,
    /\b(?:CAPT|CPT|Captain|Capitaine|Cmdt)[:\s.]+([A-Z][^\n|/,]{1,40}(?:,\s*[A-Z][^\n|/]{0,20})?)/i,
    /(?:^|\n)\s*PIC[:\s.]+([^\n|/]+)/i,
    /\bPIC[:\s.]+([A-Z][^\n|/,]{1,40}(?:,\s*[A-Z][^\n|/]{0,20})?)/i,
  ];
  for (const re of cptPatterns) {
    const v = captureAfter(re);
    if (v) { out.pic = v; break; }
  }

  // Co-pilot / F/O patterns
  const foPatterns = [
    /(?:^|\n)\s*(?:F\/O|FO|First Officer|Co[- ]?pilot|Copilote|OPL)[:\s.]+([^\n|/]+)/i,
    /\b(?:F\/O|FO|First Officer|Co[- ]?pilot|Copilote|OPL)[:\s.]+([A-Z][^\n|/,]{1,40}(?:,\s*[A-Z][^\n|/]{0,20})?)/i,
    /(?:^|\n)\s*SIC[:\s.]+([^\n|/]+)/i,
  ];
  for (const re of foPatterns) {
    const v = captureAfter(re);
    if (v) { out.copilot = v; break; }
  }

  // Generic "Crew:" line, e.g. "Crew: CPT Smith / FO Daoust"
  if (!out.pic && !out.copilot) {
    const crewLine = clean.match(/(?:^|\n)\s*Crew[:\s.]+([^\n]+)/i);
    if (crewLine) {
      const inline = crewLine[1];
      const cptM = inline.match(/(?:CAPT|CPT|Captain|Capitaine|Cmdt|PIC)[:\s.]+([A-Z][^/,]{1,40}(?:,\s*[A-Z][^/]{0,20})?)/i);
      if (cptM) out.pic = cptM[1].trim().replace(/\s+/g, ' ').replace(/[|/]+.*$/, '').trim();
      const foM = inline.match(/(?:F\/O|FO|First Officer|Co[- ]?pilot|Copilote|OPL|SIC)[:\s.]+([A-Z][^/,]{1,40}(?:,\s*[A-Z][^/]{0,20})?)/i);
      if (foM) out.copilot = foM[1].trim().replace(/\s+/g, ' ').replace(/[|/]+.*$/, '').trim();
    }
  }

  return out;
}

// Deadhead / positioning markers — shared so the iCal path skips the same
// non-flown legs the PDF roster import does. P\d{5} = Navblue positioning;
// \bP\d{5}\b never matches real flight numbers like PD150 (P then a letter).
const DEADHEAD_RE = /\(D\)|\bDH\b|\bDHD\b|\bDEADHEAD\b|\bPAX\b|\bP\d{5}\b/i;

// Convert one Navblue VEVENT into a Cumulo flight object.
// Returns null if it's not a real flight.
// Now performs proper RAC 101.01 night calculation + CAR 401.34 XC detection.
// Supports multi-airline via the user's operatorCodes profile setting.
function navblueEventToFlight(ev, isFO, autoCountIFR) {
  const summary = (ev.SUMMARY || '').trim();
  const desc = (ev.DESCRIPTION || '').trim();

  // Filter: only flights from the airlines the pilot operates (per profile)
  // Default = PD (Porter). Configurable in Profile > Operator Codes.
  if (!getOperatorFlightRegex().test(summary)) return null;
  // Deadhead / positioning legs are NOT flown time. Exclude them so they are
  // never logged as SIC time in a certifiable logbook. Broadened beyond the
  // bare "(D)" marker to the same codes the PDF roster import skips: DH/DHD/
  // DEADHEAD/PAX and Navblue P##### positioning. (Audit panel 2026-06-25 #7.)
  if (DEADHEAD_RE.test(summary)) return null;

  // Parse SUMMARY: "PD274 YYC-YOW"
  const parts = summary.split(/\s+/);
  const flightNum = parts[0];
  const routeRaw = parts[1] || '';
  const [depIATA, arrIATA] = routeRaw.split('-');
  if (!depIATA || !arrIATA) return null;

  // Parse DESCRIPTION fields
  const blhMatch = desc.match(/BLH:\s*(\d{1,2}:\d{2})/);
  const durMatch = desc.match(/Duration:\s*(\d{1,2}:\d{2})/);
  const stdMatch = desc.match(/STD\s+(\d{4})Z/);
  const staMatch = desc.match(/STA\s+(\d{4})Z/);
  const coMatch  = desc.match(/CO\s+(\d{4})Z/);
  const ciMatch  = desc.match(/CI\s+(\d{4})Z/);
  const acftMatch = desc.match(/Aircraft:\s*([^\s-]+)/);
  const regMatch  = desc.match(/(C-[A-Z]{4})/);

  const block = blhMatch ? +hhmmToDecimal(blhMatch[1]).toFixed(2) : 0;
  const duty  = durMatch ? +hhmmToDecimal(durMatch[1]).toFixed(2) : 0;
  if (block <= 0) return null;  // skip flights without block hours (future or in-progress)

  // Aircraft type mapping
  let acftType = '';
  if (acftMatch) {
    const code = acftMatch[1];
    if (code === '295' || code.startsWith('295')) acftType = 'E195-E2';
    else if (code === 'DH4' || code.startsWith('DH4')) acftType = 'DH4';
    else acftType = code;
  }

  const depICAO = iataToIcao(depIATA);
  const arrICAO = iataToIcao(arrIATA);
  // ── Block-off / Block-on UTC times ──
  // Block-off comes from STD, anchored on DTSTART for the calendar. See
  // icalBlockOffUTC: DTSTART is the DUTY window start, not the departure.
  const depCoords = AIRPORT_COORDS[depICAO];
  const arrCoords = AIRPORT_COORDS[arrICAO];
  const blockOffUTC = icalBlockOffUTC(ev);
  const blockOnUTC = blockOffUTC ? new Date(blockOffUTC.getTime() + block * 3600000) : null;

  // The logbook DATE is the LOCAL day the flight DEPARTS, so it keys off
  // block-off, not off the duty window. A 23:15 local check-in for a 00:20
  // departure belongs to the next day, which is the day the leg was flown.
  const dateStr = blockOffUTC
    ? icsLocalDate(isoBasicUTC(blockOffUTC), depICAO)
    : icsLocalDate(ev.DTSTART, depICAO);

  // ── Day/Night split (RAC 101.01) ──
  let dayHours = block, nightHours = 0;
  if (depCoords && arrCoords && blockOffUTC && blockOnUTC) {
    const split = calculateDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords);
    dayHours = split.dayHours;
    nightHours = split.nightHours;
  }

  // ── Cross-Country detection (CAR 401.34: > 25 NM) ──
  // null = unknown airport(s): leave XC EMPTY (undefined) instead of guessing,
  // so we never fabricate certifiable XC time. (Opus audit — XC over-detection.)
  const isXC = isCrossCountry(depICAO, arrICAO);
  const xcKnown = isXC !== null;

  // ── Landings: NEVER fabricated from a schedule ──
  // The iCal roster carries no landing data, and a multi-crew F/O does not
  // land every leg (PF/PM alternate). Auto-crediting a landing would inflate
  // passenger recency (CAR 401.05(2)), so landings are left empty for the
  // pilot to confirm — the same rule the import recalc now follows. Empty >
  // guessed.

  // F/O: block goes to SIC columns. Split into day/night, and XC variants.
  const role = isFO ? 'cop' : 'pic';
  const meDayPic    = role === 'pic' ? dayHours   : 0;
  const meNightPic  = role === 'pic' ? nightHours : 0;
  const meDayCop    = role === 'cop' ? dayHours   : 0;
  const meNightCop  = role === 'cop' ? nightHours : 0;
  const xcDayPic    = !xcKnown ? undefined : (isXC && role === 'pic' ? dayHours   : 0);
  const xcNightPic  = !xcKnown ? undefined : (isXC && role === 'pic' ? nightHours : 0);
  const xcDayCop    = !xcKnown ? undefined : (isXC && role === 'cop' ? dayHours   : 0);
  const xcNightCop  = !xcKnown ? undefined : (isXC && role === 'cop' ? nightHours : 0);

  // Extract crew names from iCal DESCRIPTION — zero-click captain capture.
  // The user (Porter F/O Martin) does NOT want to upload a PDF roster
  // every month; the iCal feed is the source of truth and should expose
  // captain names if Navblue includes them. Some Navblue tenants do,
  // some don't. We log misses to console so the regex can be refined
  // against real samples without breaking anything.
  const navblueCrew = extractNavblueCrew(desc);
  if (!navblueCrew.pic && !navblueCrew.copilot && desc.length > 0) {
    console.log('[Navblue] No crew extracted from DESCRIPTION for', summary, '— sample:', desc.substring(0, 300));
  }

  // Map crew to logbook fields based on the user's seat.
  // - User is F/O (Porter Martin default): pic = the captain pulled from
  //   the iCal; copilot = user's own name ("self"-style — see
  //   resolveSelfReferences for downstream handling).
  // - User is PIC: copilot = the F/O pulled from the iCal; pic = user's name.
  const profileForNav = DB.loadProfile();
  const selfFullName  = `${profileForNav.fname || ''} ${profileForNav.lname || ''}`.trim();
  const ownerWritesSelfAs = selfFullName || 'self';
  const picField     = isFO ? navblueCrew.pic    : ownerWritesSelfAs;
  const copilotField = isFO ? ownerWritesSelfAs  : navblueCrew.copilot;

  return {
    date: dateStr,
    flightNum,
    type: acftType,
    reg: regMatch ? regMatch[1] : '',
    pic: picField,
    copilot: copilotField,
    crewPosition: isFO ? 'SIC' : 'PIC',
    route: `${depIATA}-${arrIATA}`,
    dep_icao: depICAO,
    arr_icao: arrICAO,
    // dtstart_utc = the SCHEDULED BLOCK-OFF (the leg's own STD, dated from
    // the feed's DTSTART; see icalBlockOffUTC). Used internally for
    // night/XC math ONLY when the user hasn't provided actual times, and
    // NEVER displayed as if it were an actual time. Before 2026-07-26 this
    // held DTSTART itself, which on this feed is the CHECK-IN, so the
    // night split was anchored up to an hour before the aircraft moved.
    dtstart_utc: blockOffUTC ? blockOffUTC.toISOString() : '',
    // Cumulo only tracks ACTUAL times in atd_utc / ata_utc. Navblue iCal
    // publishes the SCHEDULE only — putting STD into atd_utc would be
    // labelling a schedule as actual, which is falsification of a
    // certifiable logbook. STRICT rule: leave atd_utc/ata_utc empty when
    // the source is schedule-only. The user fills them in manually OR
    // imports the monthly PDF roster (which contains the actuals).
    // See: feedback_never_approximate_certifiable_data.md (2026-05-14).
    atd_utc: '',
    ata_utc: '',
    co_utc:  coMatch  ? coMatch[1]  : '',
    ci_utc:  ciMatch  ? ciMatch[1]  : '',
    block,
    duty,
    total: block,
    meDayPic, meNightPic,
    meDayDual: 0, meNightDual: 0,
    meDayCop, meNightCop,
    xcDayPic, xcNightPic,
    xcDayDual: 0, xcNightDual: 0,
    xcDayCop, xcNightCop,
    // ldgDay / ldgNight intentionally omitted — see "Landings" note above.
    instActual: 0, instHood: 0, instSim: 0,
    // CAR 401.05 currency: at 705, virtually every flight terminates with an IAP.
    // Profile toggle `autoCountIFR` controls this default. User can edit per-flight.
    approaches: autoCountIFR ? 1 : 0,
    picus: 0,
    multiCrew: 1,           // 705 ops are always multi-crew
    remarks: '',
    source: 'navblue-ics',
    navblueUid: ev.UID || ''
  };
}

// STA − STD as decimal hours, wrapping past UTC midnight (arrival next day).
// Returns 0 for a nonsensical span so a missing/garbled time is never guessed.
function scheduledBlockHours(stdHHMM, staHHMM) {
  if (!/^\d{4}$/.test(stdHHMM || '') || !/^\d{4}$/.test(staHHMM || '')) return 0;
  const toMin = s => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2), 10);
  let d = toMin(staHHMM) - toMin(stdHHMM);
  if (d < 0) d += 1440;                    // crossed midnight UTC
  if (d <= 0 || d > 16 * 60) return 0;     // sanity: no zero / absurd block
  return d / 60;
}

// ═══════════════════════════════════════════════════════════════════
//  SAME-DAY IMPORT — proving from the feed that a leg has been FLOWN
// ═══════════════════════════════════════════════════════════════════
// Martin 2026-07-25: "jai fait 2 vols, jai terminé il y a quelques heures
// et je les vois pas". Until now the import gate was `date < today`, so
// nothing dated today was ever offered. That blanket rule replaced a
// broken heuristic: on 2026-07-01 an event whose SCHEDULED arrival had
// passed was imported while he was still airborne, which would have
// written schedule times into a certifiable logbook.
//
// Exactly ONE thing in a roster feed can prove a leg is on the ground: an
// explicitly labelled ACTUAL ARRIVAL time. Everything else the feed
// publishes can change before the aircraft ever moves, so any rule built
// on it collapses straight back into the July heuristic. Hence two tiers,
// deliberately unequal:
//
//   PROOF  (rosterFlightCompletionProof) offered for import, preselected
//     An ATA / ALDT / AIBT stamp carrying a Zulu time. Note the
//     asymmetry: ATD, ATOT and AOBT are stamped at push-back or take-off,
//     so they prove the aircraft MOVED, never that it is down. They are
//     read for their clock value and are never accepted as proof.
//
//   SIGNAL (rosterFlightUpdateSignal) surfaced, never logged for him
//     The block figure moved: either it no longer matches the leg's own
//     STD to STA span on a feed calibrated to normally match
//     (rosterFeedCalibration), or it differs from the value baselined for
//     that UID while the leg was still pending. Usually that means the
//     operator closed the leg out. Sometimes it only means the leg was
//     re-planned this morning and is sitting at the gate, delayed. The
//     app cannot tell those two apart, so it reports what it sees and
//     leaves the row UNCHECKED for the pilot to decide.
//
// Basis: proven 2026-07-12 against Martin's own feed, PD447 YOW-YYJ
// published BLH 5.8 while its own schedule said 5.4, so this feed does
// republish the real block after a flight. That is what makes the SIGNAL
// tier worth surfacing. It is not what would make it a proof.

// Two block figures count as equal within 2 minutes. Navblue publishes
// HH:MM, so a minute of rounding is normal noise, not a signal.
const ICAL_BLOCK_EPSILON_H = 2 / 60;

// Explicitly labelled ACTUAL times. Each token must be followed by a
// 4-digit Zulu time, the same shape the STD/STA parser already relies on,
// so a stray word in a remark can never match. Ambiguous bare words like
// "IN" and "OUT" are deliberately excluded: "CHECK IN 1200Z" is a duty
// time, not an arrival.
const ICAL_ACTUAL_OFF_RE = /\b(?:ATD|ATOT|AOBT)\s+(\d{4})Z/;
const ICAL_ACTUAL_ON_RE  = /\b(?:ATA|ALDT|AIBT)\s+(\d{4})Z/;

// BLOCK boundaries specifically. Cumulo's atd_utc / ata_utc mean off-blocks
// and on-blocks: the PDF roster path derives block time from exactly that
// pair. ATOT is wheels-up and ALDT is touchdown, both real actuals but both
// the WRONG quantity, and in a chronological OOOI list ALDT always appears
// before AIBT, so a combined pattern silently picks touchdown every time.
// They still prove the leg is down; they are simply never written.
const ICAL_BLOCK_OFF_RE = /\b(?:AOBT|ATD)\s+(\d{4})Z/;
const ICAL_BLOCK_ON_RE  = /\b(?:AIBT|ATA)\s+(\d{4})Z/;

// Clock values only, and only the two that mean what Cumulo's fields mean.
// Returns null when the feed publishes no block actual, which is the normal
// case for a schedule-only iCal, and also when it published runway times
// alone: empty beats an on-blocks time we do not actually have. Reading
// this is NOT the same as being proven complete: see icalHasActualArrival.
function icalActualTimes(desc) {
  const d = String(desc || '');
  const off = d.match(ICAL_BLOCK_OFF_RE);
  const on  = d.match(ICAL_BLOCK_ON_RE);
  if (!off && !on) return null;
  return { atd: off ? off[1] : '', ata: on ? on[1] : '' };
}

// The one sound proof that a leg is over. An arrival stamp cannot exist
// before the aircraft is on the ground, whereas a departure stamp
// (ATD/ATOT/AOBT) appears at push-back, while the leg still has its whole
// flight ahead of it. Accepting a departure stamp as completion was the
// July heuristic wearing a different hat.
function icalHasActualArrival(desc) {
  return ICAL_ACTUAL_ON_RE.test(String(desc || ''));
}

// The block the feed publishes for this leg (BLH), decimal hours.
function icalPublishedBlockHours(desc) {
  const m = String(desc || '').match(/BLH:\s*(\d{1,2}:\d{2})/);
  return m ? +hhmmToDecimal(m[1]).toFixed(2) : 0;
}

// The leg's own SCHEDULED span, straight from its own DESCRIPTION.
function icalScheduledSpanHours(desc) {
  const d = String(desc || '');
  const std = d.match(/STD\s+(\d{4})Z/);
  const sta = d.match(/STA\s+(\d{4})Z/);
  if (!std || !sta) return 0;
  return scheduledBlockHours(std[1], sta[1]);
}

// When the leg is due on the ground, from the feed's own numbers. Used as
// the floor described above, and to decide which legs are still pending.
//
// Anchored on the same block-off the logbook row uses. Anchoring it on
// DTSTART instead put this guard a whole check-in-to-departure gap early
// (60 min on the first leg of a duty), so the app could hold a scheduled
// on-block of 06:30Z on the flight it was writing while asking whether
// 05:30Z had passed, and offer a leg that was still airborne. Found by
// review, 2026-07-26.
function icalScheduledArrivalUTC(ev) {
  const off = icalBlockOffUTC(ev);
  if (!off) return null;
  const desc = ((ev && ev.DESCRIPTION) || '').trim();
  const span = Math.max(icalPublishedBlockHours(desc), icalScheduledSpanHours(desc));
  if (span <= 0) return null;
  return new Date(off.getTime() + span * 3600000);
}

// A single future leg is not a baseline. Require a few before trusting P2.
const ICAL_CALIBRATION_MIN_SAMPLES = 3;

// Is P2 usable on THIS feed? Sampled only from legs still in the future,
// which by definition carry planned numbers. If the operator's planned
// BLH already differs from its own STD to STA span, then a divergence
// says nothing about whether a leg flew, and P2 is switched off. Computed
// fresh on every sync, so the app never assumes a feed format it has not
// just measured.
function rosterFeedCalibration(events, todayStr) {
  const res = { usable: false, samples: 0, diverged: 0, maxDeltaMin: 0 };
  if (!Array.isArray(events)) return res;
  for (const ev of events) {
    const summary = (ev.SUMMARY || '').trim();
    if (!getOperatorFlightRegex().test(summary)) continue;
    if (DEADHEAD_RE.test(summary)) continue;
    const routeRaw = (summary.split(/\s+/)[1] || '');
    const depIATA = routeRaw.split('-')[0];
    if (!depIATA) continue;
    const date = icsLocalDate(ev.DTSTART, iataToIcao(depIATA));
    if (!date || date <= todayStr) continue;   // strictly future = planned only
    const desc = (ev.DESCRIPTION || '').trim();
    const blh = icalPublishedBlockHours(desc);
    const sched = icalScheduledSpanHours(desc);
    if (blh <= 0 || sched <= 0) continue;
    res.samples++;
    const deltaMin = Math.abs(blh - sched) * 60;
    if (deltaMin > res.maxDeltaMin) res.maxDeltaMin = +deltaMin.toFixed(1);
    if (deltaMin > ICAL_BLOCK_EPSILON_H * 60) res.diverged++;
  }
  res.usable = res.samples >= ICAL_CALIBRATION_MIN_SAMPLES && res.diverged === 0;
  return res;
}

// P3 store: the block this feed published for a leg while it was still
// pending, keyed by event UID so a schedule change can never be confused
// with a different leg.
const NAVBLUE_BLOCK_SEEN_KEY = 'cumulo_roster_block_seen_v1';
const BLOCK_SEEN_MAX = 400;
const BLOCK_SEEN_TTL_MS = 45 * 24 * 60 * 60 * 1000;

function loadRosterBlockSeen() {
  try {
    const o = JSON.parse(localStorage.getItem(NAVBLUE_BLOCK_SEEN_KEY) || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}

// Baseline every leg that has NOT yet reached its scheduled arrival, and
// only those. A leg already over may be publishing its actual block, and
// baselining that would destroy the very comparison P3 depends on. The
// baseline is refreshed while the leg stays pending, so a genuine
// pre-flight schedule change moves the baseline instead of masquerading
// as a post-flight update.
function recordPendingRosterBlocks(events, nowMs) {
  if (!Array.isArray(events)) return;
  let seen = loadRosterBlockSeen();
  for (const ev of events) {
    const uid = (ev && ev.UID) || '';
    if (!uid) continue;
    const summary = (ev.SUMMARY || '').trim();
    if (!getOperatorFlightRegex().test(summary)) continue;
    if (DEADHEAD_RE.test(summary)) continue;
    const arrival = icalScheduledArrivalUTC(ev);
    if (!arrival || arrival.getTime() <= nowMs) continue;   // already due: never baseline
    const block = icalPublishedBlockHours((ev.DESCRIPTION || '').trim());
    if (block <= 0) continue;
    seen[uid] = { block, ts: nowMs };
  }
  // Prune: drop expired entries, then the oldest ones if still oversized.
  const keys = Object.keys(seen).filter(k => {
    const e = seen[k];
    return e && typeof e === 'object' && (nowMs - (+e.ts || 0)) < BLOCK_SEEN_TTL_MS;
  });
  if (keys.length > BLOCK_SEEN_MAX) {
    keys.sort((a, b) => (+seen[b].ts || 0) - (+seen[a].ts || 0));
    keys.length = BLOCK_SEEN_MAX;
  }
  const pruned = {};
  for (const k of keys) pruned[k] = seen[k];
  try { localStorage.setItem(NAVBLUE_BLOCK_SEEN_KEY, JSON.stringify(pruned)); }
  catch (e) { /* non-fatal: P3 simply will not fire */ }
}

// Does the feed PROVE this leg is on the ground? Only an actual ARRIVAL
// stamp qualifies. `nowMs` is injected so one sync judges every leg
// against a single instant, and so the rule is testable without clocks.
// The due-down check is a cheap sanity floor on top of the proof, never a
// substitute for it.
function rosterFlightCompletionProof(ev, ctx) {
  const o = ctx || {};
  const nowMs = +o.nowMs || 0;
  const arrival = icalScheduledArrivalUTC(ev);
  if (!arrival || arrival.getTime() > nowMs) return '';
  return icalHasActualArrival((ev.DESCRIPTION || '').trim()) ? 'actual-arrival' : '';
}

// Has the operator moved this leg's block figure? Suggestive, never
// conclusive: the same edit is made both when a leg is closed out after
// landing and when it is re-planned in the morning. Callers must treat
// the result as something to SHOW the pilot, never as grounds to log a
// flight for him.
function rosterFlightUpdateSignal(ev, ctx) {
  const o = ctx || {};
  const desc = (ev.DESCRIPTION || '').trim();
  const blh = icalPublishedBlockHours(desc);
  if (blh <= 0) return '';
  const sched = icalScheduledSpanHours(desc);
  if (o.calibrated && sched > 0 && Math.abs(blh - sched) > ICAL_BLOCK_EPSILON_H) {
    return 'block-revised';
  }
  const uid = (ev && ev.UID) || '';
  const prev = (uid && o.blockSeen) ? o.blockSeen[uid] : null;
  const prevBlock = prev ? +prev.block : 0;
  if (prevBlock > 0 && Math.abs(blh - prevBlock) > ICAL_BLOCK_EPSILON_H) {
    return 'block-changed';
  }
  return '';
}

// The import gate, extracted so it can be tested directly.
//
//   future            never eligible: a schedule is not a logbook entry.
//   today             eligible only on a proof. Otherwise `pending` once
//                     the leg is at least due down, carrying whatever
//                     signal we have, for the pilot to confirm himself.
//   before today      eligible on its date alone, EXCEPT while the feed
//                     still shows it airborne. A leg that departs 21:00
//                     local is dated yesterday the moment the device
//                     rolls past midnight, and without this it would be
//                     offered mid-flight on nothing but the calendar.
//                     A leg whose arrival cannot be computed keeps the
//                     old date-only behaviour rather than being lost.
function rosterImportDecision(ev, flight, todayStr, ctx) {
  const o = ctx || {};
  const nowMs = +o.nowMs || 0;
  const none = { eligible: false, proof: '', pending: false, signal: '' };
  if (!flight || !flight.date) return none;
  if (flight.date > todayStr) return none;
  const arrival = icalScheduledArrivalUTC(ev);
  const dueDown = !arrival || arrival.getTime() <= nowMs;
  if (flight.date < todayStr) {
    return dueDown
      ? { eligible: true, proof: 'past-date', pending: false, signal: '' }
      : none;
  }
  const proof = rosterFlightCompletionProof(ev, o);
  if (proof) return { eligible: true, proof, pending: false, signal: '' };
  if (!dueDown) return none;
  return { eligible: false, proof: '', pending: true, signal: rosterFlightUpdateSignal(ev, o) };
}

// Legs flown today that the feed cannot yet prove, cached so the
// dashboard can say so out loud instead of showing nothing.
const CUMULO_PENDING_TODAY_KEY = 'cumulo_roster_pending_today_v1';

// Merge a patch into that note. Never replaces the whole record: a sync that
// only learned about today's unproven legs must not wipe the list of older legs
// a previous sync had already found outstanding.
function persistOutstandingLegs(patch) {
  try {
    const cur = JSON.parse(localStorage.getItem(CUMULO_PENDING_TODAY_KEY) || 'null') || {};
    Object.assign(cur, patch || {});
    cur.ts = Date.now();
    localStorage.setItem(CUMULO_PENDING_TODAY_KEY, JSON.stringify(cur));
  } catch (e) { /* storage full or unavailable — the next sync retries */ }
}

// Roster diagnostic capture window, centred on today rather than on the
// head of the feed. Bounded so the dump can never fill localStorage.
const DIAG_WINDOW_DAYS = 3;
const DIAG_MAX_EVENTS = 40;
const DIAG_FIELD_MAX = 4000;

// ── Roster FORECAST extraction (planning only — NEVER certifiable) ──────────
// The certifiable import (navblueEventToFlight + the `date < today` filter in
// syncNavblueNow) deliberately DROPS future events: an iCal carries the
// SCHEDULE, and schedule ≠ actual, so a future flight must never be logged
// (feedback_never_approximate_certifiable_data). The Duty page's
// cumulative-limit FORECAST, however, is explicitly a projection ("if you fly
// your published roster…"), not a logbook entry — so it is allowed, and needs,
// to read those future events. It uses the planned block (BLH) when the feed
// carries it, else estimates the block from the scheduled STD→STA times, else
// skips the event. Every hour it uses is shown to the pilot in the drill-down,
// and the result is always labelled a forecast. No number is fabricated: an
// event with no usable duration is left out, not guessed. (Martin 2026-07-14.)
function rosterForecastFromEvents(events, todayStr) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const ev of events) {
    const summary = (ev.SUMMARY || '').trim();
    if (!getOperatorFlightRegex().test(summary)) continue;   // only the pilot's own airline(s)
    if (DEADHEAD_RE.test(summary)) continue;                 // deadhead legs are not flown time
    const parts = summary.split(/\s+/);
    const flightNum = parts[0];
    const routeRaw = parts[1] || '';
    const [depIATA, arrIATA] = routeRaw.split('-');
    if (!depIATA || !arrIATA) continue;
    const depICAO = iataToIcao(depIATA);
    // Dated by DEPARTURE, exactly like the logbook import. The duty
    // projection dedupes forecast against logged legs on date + flight
    // number, so if the two paths dated the same leg differently (which
    // they would whenever check-in and departure straddle local midnight)
    // the leg would be counted once as logged and once as forecast, and
    // his CAR 700.27 rolling totals would read high.
    const fOff = icalBlockOffUTC(ev);
    const date = fOff
      ? icsLocalDate(isoBasicUTC(fOff), depICAO)
      : ((typeof icsLocalDate === 'function') ? icsLocalDate(ev.DTSTART, depICAO) : icsDate(ev.DTSTART));
    if (!date || date < todayStr) continue;                  // FUTURE (today included) only
    const desc = (ev.DESCRIPTION || '').trim();
    const blhMatch = desc.match(/BLH:\s*(\d{1,2}:\d{2})/);
    let block = blhMatch ? +hhmmToDecimal(blhMatch[1]).toFixed(2) : 0;
    let estimated = false;
    if (block <= 0) {                                        // no planned block in the feed
      const stdMatch = desc.match(/STD\s+(\d{4})Z/);
      const staMatch = desc.match(/STA\s+(\d{4})Z/);
      const est = scheduledBlockHours(stdMatch && stdMatch[1], staMatch && staMatch[1]);
      if (est > 0) { block = +est.toFixed(2); estimated = true; }
    }
    if (block <= 0) continue;                                // no usable duration → not counted
    out.push({ date, flightNum, route: depIATA + '-' + arrIATA, block, estimated });
  }
  out.sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  return out;
}

function saveNavblueUrl() {
  const input = document.getElementById('navblueUrl');
  let url = (input.value || '').trim();
  if (!url) { showToast(t('toast.enterNavblueUrl'), 'error'); return; }
  // Normalize webcal:// → https://
  url = url.replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\/[^/]*navblue\.cloud\//i.test(url)) {
    showToast(t('toast.invalidNavblueDomain'), 'error');
    return;
  }
  localStorage.setItem(NAVBLUE_URL_KEY, url);
  localStorage.removeItem(NAVBLUE_REMOVED_KEY);   // reconnecting cancels an earlier disconnect
  input.value = url;
  showToast(t('toast.urlSaved'), 'success');
  updateNavblueStatus();
  // Carry it to the account NOW. Saving here used to write localStorage and
  // nothing else, so the feed stayed on whichever device pasted it and every
  // other device kept asking the pilot to connect a schedule that was already
  // connected (Martin, iPhone, 2026-08-01).
  try { if (typeof Sync !== 'undefined' && Sync.pushDeviceSettingsIfAny) Sync.pushDeviceSettingsIfAny({ intent: true }); } catch (e) {}
}

function clearNavblueUrl() {
  if (!confirm(t('confirm.removeNavblue'))) return;
  localStorage.removeItem(NAVBLUE_URL_KEY);
  localStorage.removeItem(NAVBLUE_LAST_SYNC_KEY);
  // Remember the disconnect, or the cross-device restore hands the URL straight
  // back on the next launch and the button looks broken. Device-scoped on
  // purpose: another device that still has the feed connected keeps it.
  try { localStorage.setItem(NAVBLUE_REMOVED_KEY, new Date().toISOString()); } catch (e) {}
  document.getElementById('navblueUrl').value = '';
  document.getElementById('navblueDetails').style.display = 'none';
  updateNavblueStatus();
  showToast(t('toast.urlCleared'));
}

function updateNavblueStatus() {
  const status = document.getElementById('navblueStatus');
  if (!status) return;
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  const last = localStorage.getItem(NAVBLUE_LAST_SYNC_KEY);
  if (!url) { status.textContent = t('sync.status.notConfigured'); return; }
  if (!last) { status.textContent = t('sync.status.neverSynced'); return; }
  const minutes = Math.floor((Date.now() - +last) / 60000);
  if (minutes < 1) status.textContent = t('sync.status.justSynced');
  else if (minutes < 60) status.textContent = t('sync.status.minAgo', { n: minutes });
  else if (minutes < 1440) status.textContent = t('sync.status.hAgo', { n: Math.floor(minutes/60) });
  else status.textContent = t('sync.status.dAgo', { n: Math.floor(minutes/1440) });
}

// opts.silent      — when true, suppress "already up to date" toast + button
//                    state changes (used by auto-sync on app init / tab focus).
//                    Fresh-flight modal still appears so the pilot is prompted
//                    to review newly-detected events.
// opts.suppressError — when true, network/parse errors only log to console
//                    instead of toast-ing (avoids alarming the user during
//                    silent background syncs).
async function syncNavblueNow(opts) {
  opts = opts || {};
  const silent = !!opts.silent;
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  if (!url) {
    if (!silent) showToast(t('toast.saveUrlFirst'), 'error');
    return;
  }

  // Settings → Sync pane may not be mounted (e.g. user is on Dashboard
  // when auto-sync fires). All DOM refs below are null-safe.
  const btn = document.getElementById('syncNowBtn');
  const details = document.getElementById('navblueDetails');
  if (btn && !silent) {
    btn.disabled = true;
    btn.textContent = t('sync.btn.syncing');
  }

  try {
    const resp = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetch-ics', url })
    });
    const rawText = await resp.text();
    if (!resp.ok) throw new Error(`Worker error ${resp.status}: ${rawText.substring(0, 200)}`);

    // Worker returns either raw ICS text or { ics: "..." } JSON
    let icsText = rawText;
    if (rawText.startsWith('{')) {
      try { const j = JSON.parse(rawText); icsText = j.ics || j.body || rawText; } catch {}
    }
    if (!icsText.includes('BEGIN:VCALENDAR')) {
      throw new Error('Response does not look like an iCal calendar. Worker may not support /fetch-ics yet.');
    }

    const events = parseICS(icsText);
    console.log(`[Navblue Sync] Parsed ${events.length} VEVENTs from iCal`);

    const syncProfile = DB.loadProfile();
    // Detect seat from profile.rank. F/O = SIC seat (block credits to
    // meDayCop / meNightCop). Captain / PIC = PIC seat (credits to PIC
    // columns). The check uses profile.rank since that's where the
    // Settings dropdown writes the seat selection.
    const rankLower = (syncProfile.rank || '').toLowerCase();
    const isFO = !(rankLower === 'cpt.' || rankLower === 'cpt'
                || rankLower === 'captain' || rankLower === 'pic'
                || rankLower === 'commander');
    // Per-profile toggle: when set, fresh imported flights default to 1 IFR approach.
    // Falls back to 705-airline inference for profiles saved before the field existed.
    const autoCountIFR = (syncProfile.autoCountIFR !== undefined)
      ? !!syncProfile.autoCountIFR
      : isAirline705(syncProfile.airline);

    // Eligibility. Anything strictly before today is offered on its date
    // alone. Anything dated TODAY is offered only when the feed PROVES the
    // leg has been flown (see rosterFlightCompletionProof); with no proof
    // it is held back, exactly as before, because a schedule is not an
    // actual. Future legs are never offered.
    // Local civil date: with the UTC date (toISOString) an evening sync
    // would treat today's not-yet-flown flight as "past" and import it.
    const today = localTodayStr();
    const nowMs = Date.now();
    const calibration = rosterFeedCalibration(events, today);
    const proofCtx = {
      nowMs,
      calibrated: calibration.usable,
      blockSeen: loadRosterBlockSeen()
    };

    const mapped = [];
    const pendingToday = [];   // flown today, unproven: shown, never logged
    const decisions = [];      // kept for the diagnostic dump
    for (const ev of events) {
      const f = navblueEventToFlight(ev, isFO, autoCountIFR);
      if (!f || !f.date) continue;
      const d = rosterImportDecision(ev, f, today, proofCtx);
      decisions.push({ date: f.date, flightNum: f.flightNum, route: f.route, block: f.block, uid: f.navblueUid, eligible: d.eligible, proof: d.proof, pending: d.pending, signal: d.signal });
      if (!d.eligible) {
        if (d.pending) {
          // Keep the whole mapped flight: the pilot reviews and confirms
          // these himself, in the same preview the proven ones use, and
          // the day/night and SIC split are already computed here.
          f._flownToday = true;
          f._unproven = true;
          f._signal = d.signal;
          pendingToday.push(f);
        }
        continue;
      }
      if (f.date === today) {
        f._flownToday = true;
        f._proof = d.proof;
        // The proof is an ACTUAL ARRIVAL stamp, so the operator has closed
        // this leg out. That is the only circumstance in which this path
        // may fill atd_utc / ata_utc: both are labelled ACTUAL at source.
        const act = icalActualTimes(ev.DESCRIPTION || '');
        if (act && act.atd) f.atd_utc = act.atd;
        if (act && act.ata) f.ata_utc = act.ata;
      }
      mapped.push(f);
    }

    // Baseline the still-pending legs for the next sync's block comparison.
    recordPendingRosterBlocks(events, nowMs);

    // (The outstanding-legs cache is written further down, once the fresh
    // list is known, so both halves land in one consistent record.)

    console.log(`[Navblue Sync] ${mapped.length} eligible, ${pendingToday.length} flown-today awaiting proof; feed calibration: usable=${calibration.usable} samples=${calibration.samples} diverged=${calibration.diverged}`);

    // Record the unproven legs RIGHT HERE, the instant the decision is made.
    // This used to be written near the end of the sync, after the snapshot, the
    // match loop and two DB.save calls — so anything that threw in between left
    // the pilot with a feed the app had correctly judged "flown, unproven" and a
    // dashboard that said nothing at all. That is how a flight goes missing in
    // plain sight, and it is exactly the failure the outstanding-legs note was
    // built to prevent. (Martin, PD325 of 2026-08-01: the diagnostic showed
    // pending=true while the dashboard showed no card.)
    persistOutstandingLegs({ today: today, flights: pendingToday });

    // Diagnostic dump for the "Roster diagnostic" button in Settings, so
    // the raw feed can be inspected with no dev console (Martin never uses
    // F12). Sampled AROUND TODAY rather than from the head of the feed:
    // the question that actually matters is what the operator publishes
    // for a leg once it has flown, and the head of a roster feed is
    // usually last month. Every property is kept, because DTSTART and UID
    // drive the logbook date and the dedup key yet were invisible before.
    try {
      const diagFrom = shiftDateStr(today, -DIAG_WINDOW_DAYS);
      const diagTo   = shiftDateStr(today,  DIAG_WINDOW_DAYS);
      const windowed = events.filter(e => {
        const d = icsDate(e.DTSTART);
        return d && d >= diagFrom && d <= diagTo;
      });
      // On days off, or right after next month's bid is published, nothing
      // sits near today. Fall back to the head of the feed so the button
      // always shows some raw event: an empty diagnostic is useless
      // precisely when someone is trying to diagnose something.
      const pool = windowed.length ? windowed : events;
      // Flights first. The first run of this panel came back showing three
      // days off, which answers nothing when the question is "where is the
      // flight I just finished". Whatever matches the pilot's operator code
      // is what he needs to see, and the rest only fills the remaining room.
      const isFlightEv = e => {
        const s = (e.SUMMARY || '').trim();
        return getOperatorFlightRegex().test(s) && !DEADHEAD_RE.test(s);
      };
      const near = pool.filter(isFlightEv).concat(pool.filter(e => !isFlightEv(e))).slice(0, DIAG_MAX_EVENTS);
      // A dated index of EVERY event near today, flight or not. Three lines
      // of this would have said immediately whether the feed even carries
      // today's legs, instead of leaving it to be inferred from a sample.
      const index = events.map(e => ({
        date: icsDate(e.DTSTART),
        dtstart: String(e.DTSTART || '').substring(0, 40),
        summary: (e.SUMMARY || '').trim().substring(0, 80),
        flight: isFlightEv(e)
      })).filter(x => x.date && x.date >= diagFrom && x.date <= diagTo)
        .sort((a, b) => (a.dtstart < b.dtstart ? -1 : (a.dtstart > b.dtstart ? 1 : 0)));
      const dump = {
        ts: nowMs,
        today,
        window: { from: diagFrom, to: diagTo },
        totalEvents: events.length,
        eventsNearToday: index.length,
        flightEventsNearToday: index.filter(x => x.flight).length,
        index,
        calibration,
        decisions: decisions.filter(x => x.date >= diagFrom && x.date <= diagTo),
        samples: near.map(e => {
          const props = {};
          for (const k of Object.keys(e)) {
            props[k] = String(e[k] === undefined ? '' : e[k]).substring(0, DIAG_FIELD_MAX);
          }
          const desc = (e.DESCRIPTION || '').trim();
          return {
            summary: (e.SUMMARY || '').substring(0, 300),
            description: desc.substring(0, DIAG_FIELD_MAX),
            props,
            read: {
              blh: icalPublishedBlockHours(desc),
              scheduledSpan: +icalScheduledSpanHours(desc).toFixed(2),
              actualTimes: icalActualTimes(desc),
              proof: rosterFlightCompletionProof(e, proofCtx),
              signal: rosterFlightUpdateSignal(e, proofCtx)
            }
          };
        })
      };
      localStorage.setItem('cumulo_navblue_debug_v1', JSON.stringify(dump));
    } catch (e) { /* non-fatal */ }

    // Cache the forward-looking roster FORECAST for the Duty-page projection.
    // This is planning data, kept in its OWN key — never merged into `flights`,
    // never logged as certifiable time. Refreshed on every sync (incl. the
    // silent auto-sync on app open), so the Duty page always projects against
    // the latest published roster.
    try {
      const forecast = rosterForecastFromEvents(events, today);
      localStorage.setItem(CUMULO_FORECAST_KEY, JSON.stringify({ ts: Date.now(), today, flights: forecast }));
      console.log(`[Navblue Sync] Roster forecast cached: ${forecast.length} future flight(s)`);
    } catch (e) { /* non-fatal — forecast is a convenience layer */ }

    // Cache the WHOLE published roster for the Schedule page: days off, ground
    // duty and standby as well as flights. The forecast cache above cannot serve
    // that view — it keeps only the pilot's own future flight legs (operator
    // regex, deadheads dropped), which is a third of what a roster shows.
    // Schedule data, never logbook data: nothing here is ever counted as time.
    try {
      const cal = [];
      for (const e of events) {
        const start = icsDateTime(e.DTSTART);
        if (!start) continue;
        const end = icsDateTime(e.DTEND);
        cal.push({
          uid: e.UID || '',
          summary: (e.SUMMARY || '').trim(),
          start: start.toISOString(),
          end: end ? end.toISOString() : null,
        });
      }
      cal.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      localStorage.setItem(CUMULO_CALENDAR_KEY, JSON.stringify({ ts: Date.now(), events: cal }));
    } catch (e) { /* non-fatal — the Schedule page says so rather than guessing */ }

    // SNAPSHOT before any modification — pilot data is precious.
    // Guarded: a full-storage failure here used to throw out of the whole sync,
    // taking the outstanding-legs note and the dashboard refresh with it. The
    // undo point is a safety net for the merge below, and the merge is
    // fill-empty only, so losing the net is worth telling the pilot about but
    // not worth abandoning the sync over.
    let _snapOk = false;
    try { _snapOk = snapshotBeforeOperation('Navblue iCal sync') !== false; }
    catch (e) { console.warn('[Navblue Sync] snapshot failed:', e); }
    try { updateUndoButton(); } catch (e) { /* non-fatal */ }

    // Smart matching :
    //   1. Try exact match (date + flightNum + route)
    //   2. Fall back to fuzzy match (date + route + block within 0.15h)
    //   3. Fall back to date+block match (PDF imports may have no flightNum/route)
    // Goal: NEVER duplicate a flight that already exists, even when imported via PDF.
    const fresh = [];
    let mergedCount = 0;
    // pic / copilot / crewPosition are eligible because the iCal extractor
    // pulls them; the shared fillEmptyStrict still only fills blanks.
    let resurrectBlocked = 0;
    mapped.forEach(f => {
      const match = findMatchingExistingFlight(f);
      if (!match) {
        // Don't resurrect a flight the pilot deliberately deleted. Without
        // this guard, every sync re-imports deleted flights as "fresh"
        // (the "vols supprimés ressuscitent" bug). Audit 2026-05-29.
        if (typeof isTombstoned === 'function' && isTombstoned(f)) {
          resurrectBlocked++;
          return;
        }
        fresh.push(f);
        return;
      }
      // Existing flight matched — enrich missing fields without overwriting user data.
      // Never overwrite: pic (capitaine), total, block (user may have corrected)
      const e = flights[match.idx];
      const merged = { ...e };
      // Fill ONLY genuinely-empty slots (undefined/null/''): an explicit 0 the
      // pilot recorded is a REAL value — e.g. multiCrew=0 must not be clobbered
      // to the iCal default of 1. Shared helper, same rule as the recalc.
      let changed = fillEmptyStrict(merged, f, IMPORT_MERGE_FIELDS);
      // Mark source so we know this flight has been enriched from iCal
      if (!merged.sources) merged.sources = [];
      if (e.source && !merged.sources.includes(e.source)) merged.sources.push(e.source);
      if (!merged.sources.includes('navblue-ics')) {
        merged.sources.push('navblue-ics');
        changed = true;
      }
      if (changed) {
        flights[match.idx] = merged;
        mergedCount++;
        console.log(`[Sync] Merged ${match.matchType} match for ${f.date} ${f.flightNum} ${f.route}`);
      }
    });

    // Persist any merged changes (so the fill-empty pass below sees them)
    if (mergedCount > 0) DB.save(flights);

    // Record the outstanding legs so they OUTLIVE the preview modal. The
    // import only ever writes on confirmation, and until now closing that
    // window left no trace anywhere: Martin's logbook silently stopped at
    // 2026-07-19 while the same modal reopened and closed for five days.
    // The dashboard reads this and keeps asking until the legs are logged
    // or deliberately deleted.
    try {
      persistOutstandingLegs({ today: today, flights: pendingToday, eligible: fresh });
    } catch (e) { /* non-fatal */ }

    // Fill empty Night/XC slots on enriched flights — STRICT only-fill-empty,
    // never overwrites a pilot-typed value. See recalculateFlightDayNightXC()
    // header comment for the CAR 401.08 contemporaneous-record rationale.
    // The variable is still called `recalcStats` for compatibility with the
    // toast messaging below; semantically it's "fillStats" now.
    let recalcStats = { updated: 0, skippedNoUTC: 0, skippedNoCoords: 0, skippedNoBlock: 0 };
    if (mergedCount > 0 || fresh.length === 0) {
      recalcStats = recalculateAllFlightsInternal();
      DB.save(flights);
    }

    localStorage.setItem(NAVBLUE_LAST_SYNC_KEY, Date.now().toString());

    if (details) {
      details.style.display = 'block';
      const _w = (n, s, p) => (n === 1 ? t(s) : t(p));
      const detailLines = [
        t('sync.detail.calendar', {
          events: events.length, ew: _w(events.length, 'word.event', 'word.events'),
          flights: mapped.length, fw: _w(mapped.length, 'word.completedFlight', 'word.completedFlights')
        })
      ];
      if (mergedCount > 0) detailLines.push(t('sync.detail.enriched', { n: mergedCount, w: _w(mergedCount, 'word.flight', 'word.flights') }));
      if (recalcStats.updated > 0) detailLines.push(t('sync.detail.filled', { n: recalcStats.updated, w: _w(recalcStats.updated, 'word.flight', 'word.flights') }));
      if (fresh.length > 0) detailLines.push(t('sync.detail.fresh', { n: fresh.length, w: _w(fresh.length, 'word.newFlight', 'word.newFlights') }));
      if (fresh.length === 0 && mergedCount === 0) detailLines.push(t('sync.detail.upToDate'));
      details.innerHTML = detailLines.join('<br>');
    }

    updateNavblueStatus();
    renderDashboard();

    if (fresh.length > 0) {
      // Even in silent/auto-sync mode we surface the import-preview modal —
      // this is the whole point of auto-sync: detect new flights and prompt
      // the pilot. If no new flights, silent mode stays quiet.
      showImportPreview(fresh, t('sync.freshFound', { n: fresh.length, w: (fresh.length === 1 ? t('word.newFlight') : t('word.newFlights')) }));
      showToast(t('toast.syncFreshEnriched', { fresh: fresh.length, merged: mergedCount }));
    } else if (mergedCount > 0) {
      showToast(t('toast.syncEnrichedRecalc', { merged: mergedCount, updated: recalcStats.updated }), 'success');
    } else if (!silent) {
      showToast(t('toast.alreadyUpToDate'));
    }

  } catch(e) {
    console.error('[Navblue Sync] Error:', e);
    if (details) {
      details.style.display = 'block';
      details.innerHTML = `<span style="color:var(--danger);">${t('sync.detail.error', { msg: esc(e.message) })}</span>`;
    }
    // Silent auto-sync errors stay in the console — toasts would alarm the
    // user when nothing actively triggered the sync. They'll see the next
    // manual click fail loudly if the worker is truly down.
    if (!silent) showToast(t('sync.failed'), 'error');
  } finally {
    if (btn && !silent) {
      btn.disabled = false;
      btn.textContent = t('sync.btn.syncNow');
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Auto-sync wrapper — called from 99-init.js on app boot and on
// `visibilitychange` (tab refocus). Gated by elapsed-time thresholds
// so we don't hammer the worker on every page load / tab switch.
//
// Why this exists: Martin's iCal sync was manual-only. Means he had
// to remember to open Settings → Sync → click. With this wrapper, the
// app silently checks for new VEVENTs whenever he opens it; if any
// are found, the existing import-preview modal pops up to prompt
// confirmation (same UX path as a manual sync, but kicked off
// automatically). If nothing new, no toast, no noise.
// ─────────────────────────────────────────────────────────────────
function syncNavblueAuto(reason) {
  try {
    const url = localStorage.getItem(NAVBLUE_URL_KEY);
    if (!url) return;  // not configured — nothing to do
    const lastRaw = localStorage.getItem(NAVBLUE_LAST_SYNC_KEY);
    const last = lastRaw ? +lastRaw : 0;
    const elapsed = Date.now() - last;
    const minInterval = (reason === 'focus') ? NAVBLUE_AUTO_SYNC_FOCUS_MS : NAVBLUE_AUTO_SYNC_INIT_MS;
    if (last && elapsed < minInterval) {
      console.log(`[Navblue Auto-Sync] Skipped (${reason}): last sync ${Math.round(elapsed/60000)}m ago, threshold ${minInterval/60000}m`);
      return;
    }
    // Don't auto-sync while the import-preview modal is already open
    // (avoids stacking two prompts on top of each other if the user
    // happens to refocus the tab mid-review).
    // The real element is #importPreview.import-overlay (src/body.html). The old
  // selector listed three names that exist nowhere in the app, so this guard has
  // never once fired and auto-sync could stack a second import on top of a review
  // the pilot had open. (Independent review 2026-08-01.)
  const _preview = document.getElementById('importPreview');
  if (_preview && _preview.classList.contains('show')) {
      console.log('[Navblue Auto-Sync] Skipped: import preview already open');
      return;
    }
    console.log(`[Navblue Auto-Sync] Triggering (${reason})`);
    syncNavblueNow({ silent: true });
  } catch (e) {
    console.warn('[Navblue Auto-Sync] threw:', e);
  }
}

// Diagnostic view for the Navblue iCal feed. Reads the dump stashed by
// syncNavblueNow into localStorage and renders it in a modal with a
// "Copy all" button. No browser dev-tools required — Martin can copy
// the raw DESCRIPTION sample and paste it in chat so the crew-extraction
// regex can be refined against the real Porter format.
function showNavblueDiagnostic() {
  const raw = localStorage.getItem('cumulo_navblue_debug_v1');
  if (!raw) {
    showToast(t('sync.diag.noData'), 'error');
    return;
  }
  let dump;
  try { dump = JSON.parse(raw); }
  catch { showToast(t('sync.diag.corrupted'), 'error'); return; }

  const ageMin = Math.round((Date.now() - dump.ts) / 60000);
  // Feed-calibration line: says out loud whether same-day detection by
  // block comparison is switched on for this roster, and on what evidence.
  const cal = dump.calibration;
  const calHtml = cal ? `
    <div style="font-size:12px; color:var(--text-secondary); line-height:1.55; margin-bottom:var(--s-3); padding:var(--s-3); background:var(--bg-subtle); border-radius:var(--r-sm);">
      ${esc(t('sync.diag.calibration', {
        samples: cal.samples || 0,
        diverged: cal.diverged || 0,
        state: cal.usable ? t('sync.diag.on') : t('sync.diag.off')
      }))}
    </div>` : '';
  const readLine = (r) => {
    if (!r) return '';
    const act = r.actualTimes
      ? [r.actualTimes.atd ? 'ATD ' + r.actualTimes.atd + 'Z' : '', r.actualTimes.ata ? 'ATA ' + r.actualTimes.ata + 'Z' : ''].filter(Boolean).join(' / ')
      : t('sync.diag.none');
    // Internal identifiers stay internal: the panel reads as a sentence in
    // the reader's own language, not as English tokens dropped into it.
    // noneM, not none: this slot follows a masculine noun in French.
    const signalText = r.signal === 'block-revised' ? t('sync.diag.signalRevised')
                     : r.signal === 'block-changed' ? t('sync.diag.signalChanged')
                     : t('sync.diag.noneM');
    return `<div style="font-family:var(--font-mono); font-size:11px; color:var(--text-secondary); margin-top:6px;">${esc(t('sync.diag.read', {
      blh: r.blh || 0,
      sched: r.scheduledSpan || 0,
      actual: act,
      proof: r.proof === 'actual-arrival' ? t('sync.diag.proofArrival') : t('sync.diag.none'),
      signal: signalText
    }))}</div>`;
  };
  // The dump is only written DURING a sync, so after an app update the
  // panel can be a new reader looking at an old capture. That happened on
  // 2026-07-25: the old capture held the first three events of the whole
  // feed (three days off at the start of the published period) and, read
  // through the new wording, looked like a statement about today. Say it
  // outright instead of quietly rendering a half empty panel.
  const staleShape = !Array.isArray(dump.index);
  const staleHtml = staleShape ? `
    <div style="font-size:13px; color:var(--warning); line-height:1.55; margin-bottom:var(--s-3); padding:var(--s-3); background:var(--warning-soft,rgba(200,140,0,.12)); border-radius:var(--r-sm);">
      ${esc(t('sync.diag.staleShape'))}
    </div>` : '';

  // Dated index of everything near today. This is the first thing to read
  // when a flight is missing: it shows whether the feed carries the leg at
  // all, before anyone starts theorising about the parsing.
  const idx = Array.isArray(dump.index) ? dump.index : null;
  const indexHtml = idx ? `
    <div style="margin-bottom:var(--s-4);">
      <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">${esc(t('sync.diag.indexTitle', { n: idx.length, from: (dump.window || {}).from || '', to: (dump.window || {}).to || '' }))}</div>
      <pre style="background:var(--bg-subtle); padding:var(--s-3); border-radius:var(--r-sm); font-family:var(--font-mono); font-size:11px; white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto;">${esc(idx.map(x => `${x.date}  ${x.flight ? '[vol/flight] ' : ''}${x.summary}`).join('\n') || t('sync.diag.empty'))}</pre>
      ${dump.flightEventsNearToday === 0 ? `<div style="font-size:12px; color:var(--warning); margin-top:6px;">${esc(t('sync.diag.noFlightsNear'))}</div>` : ''}
    </div>` : '';
  const samplesHtml = (dump.samples || []).map((s, i) => `
    <div style="margin-bottom:var(--s-4);">
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted); margin-bottom:6px;">${esc(t('sync.diag.sample', { n: i + 1 }))}</div>
      <div style="font-family:var(--font-mono); font-size:11px;"><strong>SUMMARY:</strong> ${esc(s.summary || t('sync.diag.empty'))}</div>
      <div style="margin-top:6px;"><strong style="font-family:var(--font-mono); font-size:11px;">DESCRIPTION:</strong></div>
      <pre style="background:var(--bg-subtle); padding:var(--s-3); border-radius:var(--r-sm); font-family:var(--font-mono); font-size:11px; white-space:pre-wrap; word-break:break-word; margin-top:4px; max-height:240px; overflow:auto;">${esc(s.description || t('sync.diag.empty'))}</pre>
      ${readLine(s.read)}
    </div>
  `).join('');

  const copyPayload = JSON.stringify(dump, null, 2);
  const overlay = document.getElementById('importPreview');
  if (!overlay) {
    // Fallback: dump to console + alert
    console.log('[Roster diagnostic]', dump);
    alert(t('sync.diag.consoleFallback'));
    return;
  }
  document.getElementById('importSubtitle').textContent =
    t('sync.diag.subtitle', { age: ageMin, events: dump.totalEvents || 0 });
  document.getElementById('extractedList').innerHTML = `
    <p style="font-size:13px; color:var(--text-secondary); line-height:1.55; margin-bottom:var(--s-3);">
      ${esc(t('sync.diag.intro', { n: dump.samples ? dump.samples.length : 0 }))}
    </p>
    ${staleHtml}
    ${indexHtml}
    ${calHtml}
    ${samplesHtml}
    <details style="margin-top:var(--s-3);">
      <summary style="cursor:pointer; font-size:12px; color:var(--text-secondary);">${esc(t('sync.diag.fullJson'))}</summary>
      <pre style="background:var(--bg-subtle); padding:var(--s-3); border-radius:var(--r-sm); font-family:var(--font-mono); font-size:10px; white-space:pre-wrap; word-break:break-word; max-height:300px; overflow:auto;">${esc(copyPayload)}</pre>
    </details>
  `;
  const confirmBtn = document.getElementById('importConfirmBtn');
  confirmBtn.textContent = t('sync.diag.copyAll');
  confirmBtn.disabled = false;
  confirmBtn.onclick = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copyPayload).then(
        () => showToast(t('sync.diag.copied'), 'success'),
        () => showToast(t('sync.diag.copyFailed'), 'error')
      );
    } else {
      showToast('Clipboard not available — select the JSON block manually.', 'error');
    }
  };
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

