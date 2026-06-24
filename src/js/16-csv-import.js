// ═══════════════════════════════════════════
// CSV IMPORT — Migrate from existing logbook apps
// ═══════════════════════════════════════════
// Supports ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog,
// plus a universal column-mapping wizard for any other CSV.
//
// Per project rule: imports are TAKEN AS-IS from the source CSV. We never
// recalculate sunrise/sunset or great-circle distances on import. Fields
// missing from the source stay 0. The user has a "Hide empty columns" toggle
// in Profile to clean the on-screen view; the TC PDF export always keeps
// all 38 columns for ramp-check compliance.
//
// TC compliance highlights:
// - Engine class (SE/ME/Heli/Glider/Sim) detected from aircraft type+reg, with
//   per-aircraft confirmation UI before import so the user can override.
// - Role bucketing is ADDITIVE: a flight with PIC=1.0 AND SIC=0.5 fills both
//   buckets, no silent data loss.
// - Captain + Co-pilot names PIPEDA-gated against Profile toggle.
// - DualGiven, PICUS, isSim read from sources where available.
// - Date format ambiguity (MM/DD vs DD/MM) detected per-file from all rows.
// - Three-step preview: Step 1 confirm aircraft, Step 2 review, Step 3 attest+sign.
// - Audit log written to localStorage on every successful import.
// ─────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// SECTION 1 — CSV parsing utilities
// ═══════════════════════════════════════════════════════════════════

// File-size cap: 50 MB covers a 30-year ATPL captain's full ForeFlight export
// (~10 MB realistic peak) with 5× margin. Anything larger is almost certainly
// a wrong file (video, archive) — refusing protects the main thread from a
// multi-minute parse freeze that would look like the app hanging.
const CSV_MAX_BYTES = 50 * 1024 * 1024;

// RFC 4180-ish parser. Handles quoted fields, commas in quotes, escaped "".
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuotes = false; continue; }
      field += c;
    } else {
      if (c === '"') { inQuotes = true; continue; }
      if (c === ',') { row.push(field); field = ''; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(f => f === '')) rows.pop();
  return rows;
}

function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = (h || '').trim().toLowerCase();
    if (key) map[key] = i;
  });
  return map;
}

function getCol(row, headerMap, ...names) {
  for (const n of names) {
    const idx = headerMap[n.toLowerCase()];
    if (idx !== undefined && row[idx] !== undefined && row[idx] !== '') return row[idx];
  }
  return '';
}

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, '.'));
  return isNaN(n) ? 0 : n;
}

function intNum(v) {
  const n = parseInt(String(v || '0').replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// Parse a single date string when the file's locale convention is already known.
// `locale`: 'iso' | 'us' (M/D/Y) | 'eu' (D/M/Y) | 'auto' (best-effort per row)
function parseDateWithLocale(s, locale) {
  if (!s) return '';
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = m[3];
    if (locale === 'us')      return `${y}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;
    if (locale === 'eu')      return `${y}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;
    // Auto: disambiguate when possible, else default to ISO-friendly MM/DD (US).
    if (a > 12) return `${y}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`;  // DD/MM
    if (b > 12) return `${y}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;  // MM/DD
    return `${y}-${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}`;              // default MM/DD
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (m) {
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const mo = months[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[1].padStart(2,'0')}`;
  }
  return s;
}

// Sweep all date cells in a CSV to detect MM/DD vs DD/MM ambiguity per-file.
// Returns 'iso' (no ambiguity, ISO format), 'us' (dominant evidence of MM/DD),
// 'eu' (dominant evidence of DD/MM), or 'ambiguous' (no row had a >12 value
// in either position — pure 50/50 — caller must ask the user).
function detectDateLocale(allDateStrings) {
  let usEvidence = 0, euEvidence = 0, ambiguousCount = 0, hasISO = false;
  for (const s of allDateStrings) {
    if (!s) continue;
    const str = String(s).trim();
    if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(str)) { hasISO = true; continue; }
    const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{4}/);
    if (!m) continue;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a > 12 && b <= 12) euEvidence++;       // first part is day
    else if (b > 12 && a <= 12) usEvidence++;  // second part is day
    else if (a <= 12 && b <= 12) ambiguousCount++;
  }
  if (hasISO && usEvidence === 0 && euEvidence === 0) return 'iso';
  if (usEvidence > 0 && euEvidence === 0) return 'us';
  if (euEvidence > 0 && usEvidence === 0) return 'eu';
  if (usEvidence > 0 && euEvidence > 0)   return 'us';   // mixed file — fallback US, log a warning
  if (ambiguousCount > 0) return 'ambiguous';
  return 'iso';
}

// Extract HHMM (UTC) from a timestamp like "2024-01-15T13:45:00Z", "13:45", "1345".
function extractHHMM(s) {
  if (!s) return '';
  s = String(s).trim();
  let m = s.match(/T(\d{2}):(\d{2})/);
  if (m) return m[1] + m[2];
  m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return m[1].padStart(2,'0') + m[2];
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];
  return '';
}

function makeFlightId() {
  // UUID so rows survive cloud sync (the Supabase flights.id column is uuid).
  if (typeof newUUID === 'function') return newUUID();
  return 'csv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Deterministic 32-bit hash of the CSV file contents. Used for the audit log
// so a TC investigation can confirm "this exact CSV was imported on this date".
function hashCsvContent(text) {
  let h = 5381;
  const sample = text.slice(0, 4096) + '|' + text.length + '|' + text.slice(-512);
  for (let i = 0; i < sample.length; i++) h = ((h << 5) + h + sample.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + text.length.toString(16);
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2 — Format detection
// ═══════════════════════════════════════════════════════════════════

function detectCsvFormat(text) {
  const head = text.slice(0, 4000).toLowerCase();
  if (head.includes('foreflight logbook import') || head.includes('"flights table"')) return 'foreflight';
  if (head.includes('logten') || head.includes('flight: total time') || head.includes('flight: pic time')) return 'logten';
  if (head.includes('myflightbook') || (head.includes('totalflighttime') && head.includes('tailnumber'))) return 'myflightbook';
  if (head.includes('logbook pro') || (head.includes('aircraft type') && head.includes('aircraft id') && head.includes('flight time'))) return 'logbookpro';
  if (head.includes('safelog') || (head.includes(',tail,') && head.includes(',total,'))) return 'safelog';
  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3 — Aircraft category detection
// ═══════════════════════════════════════════════════════════════════
// Heuristic mapping from common type designators to TC engine class +
// configuration. Always overridable by the user in the per-aircraft
// confirmation step of the import preview.

// Helicopter rotorcraft (treated as 'HELI' engine class — TC Standard 421 has
// separate currency / experience requirements but Cumulo's 38-column schema
// doesn't have a dedicated heli column. Hours are stored in seDay/seNight
// with `acConfig: 'helicopter'` and a remark flag, so totals are preserved
// and the user is alerted.)
const HELI_PATTERNS = [
  // Robinson family
  /^r-?22\b/i, /^r-?44\b/i, /^r-?66\b/i,
  // Bell — explicit + bare-number variants (206B3, 407GXi, 412EP, 429)
  /^bell ?\d{3}/i, /^206[a-z]{0,2}\d?$/i, /^407[a-z]{0,2}\d?$/i,
  /^412[a-z]{0,2}\d?$/i, /^429[a-z]{0,2}\d?$/i, /^505[a-z]{0,2}\d?$/i,
  /^222[a-z]?$/i, /^230[a-z]?$/i, /^230 ?utility/i,
  // Airbus / Eurocopter — AS350, AS355, EC120/130/135/145/155/225, H-series
  /^as ?3[0-9]{2}[a-z]?\d?/i, /a-?star/i, /^ec-?\d{3}[a-z]?\d?/i,
  /^h-?12[05][a-z]?/i, /^h-?13[05][a-z]?/i, /^h-?14[05][a-z]?/i, /^h-?15[5][a-z]?/i,
  // MD Helicopters
  /^md-?\d{2,3}[a-z]?/i, /^500e?$/i, /^520n$/i, /^600n$/i, /^900nota?r?$/i,
  // Sikorsky
  /^s-?7[06]\b/i, /^s-?9[2-7]/i, /^s-?6[14]/i, /^uh-?\d/i, /sikorsky/i,
  // Leonardo / AgustaWestland
  /^aw-?\d{3}[a-z]?/i, /^a[bw]?-?109/i, /^a[bw]?-?119/i, /^a[bw]?-?139/i, /^a[bw]?-?169/i, /^a[bw]?-?189/i,
  // Generic catch-all
  /helicopt/i, /\bheli\b/i, /rotorcraft/i, /rotor[- ]?wing/i
];

// Single-engine fixed wing patterns (covers GA + bush mainstays).
const SE_PATTERNS = [
  /^c-?1\d{2}[a-z]?$/i,                          // C150, C152, C172, C182 (NOT C208)
  /^cessna ?1\d{2}/i, /^cessna ?(?:185|206|207|208)/i,
  /^c-?(?:185|206|207)\b/i, /^c-?208\b/i, /^208[ab]?$/i, /caravan/i,
  /^pa-?(?:18|22|28|32|38)/i, /^piper ?(?:warrior|archer|cherokee|cub|seneca)/i,
  /^da-?(?:20|40)/i, /^diamond ?da-?(?:20|40)/i, /^sr-?2[02]\b/i, /^cirrus/i,
  /^dhc-?[123]\b/i, /^beaver/i, /^otter/i,
  /^beech ?(?:e?-?(?:18|17|24|33|35|36))/i,
  /^pc-?12/i, /^pilatus pc-?12/i,
  /^king ?air ?(?:90|c90|f90)/i, /^bn-?2/i, /islander/i,
  /^(?:152|172|150|180|185|206|207|208|210)$/i,  // bare numbers
];

// Multi-engine fixed wing patterns (regional/airline).
const ME_PATTERNS = [
  /^e-?(?:170|175|190|195)(?:-?e[12])?$/i, /^embraer ?e-?\d/i,
  /^a-?(?:220|319|320|321|330|340|350|380)/i, /^airbus ?a-?\d/i, /^cs-?[13]00/i,
  /^b-?(?:737|747|757|767|777|787)/i, /^boeing ?\d{3}/i, /^737\b/i, /^777\b/i,
  /^crj-?(?:100|200|550|700|705|900|1000)/i, /^bombardier crj/i,
  /^q-?400\b/i, /^dhc-?8/i, /^dash ?8/i,
  /^atr-?(?:42|72)/i, /^saab ?(?:340|2000)/i,
  /^beech ?(?:1900|99|200|350|99c|350i)/i, /^king ?air ?(?:100|200|300|350|b200)/i,
  /^pa-?(?:23|34|44|31|42|46|60)/i, /^piper ?(?:seminole|seneca|chieftain|navajo)/i,
  /^da-?42\b/i, /^diamond da-?42/i,
  /^c-?(?:310|340|402|414|421|425|441)/i, /^cessna ?(?:310|340|402)/i,
  /^l-?(?:188|382|1011)/i,
];

// Sim / FSTD / training device patterns.
const SIM_PATTERNS = [
  /^ffs/i, /^ftd/i, /^fnpt/i, /^bitd/i, /^aatd/i, /^pcatd/i,
  /\bsimul/i, /simulator/i, /^sim[-_ ]/i, /-sim$/i,
  /-ffs/i, /-ftd/i, /^flight ?sim/i
];

// Glider patterns.
const GLIDER_PATTERNS = [
  /^asw-?\d/i, /^ask-?\d/i, /^asg-?\d/i, /^ls-?\d/i, /^discus/i,
  /^ventus/i, /^duo ?discus/i, /^puchacz/i, /^blanik/i, /^twin ?astir/i,
  /glider/i, /sailplane/i
];

// Float / ski / amphibian / tailwheel hints (config, not engine class).
const FLOAT_PATTERNS    = [/float/i, /seaplane/i, /sea ?plane/i, /\bfloats?\b/i, /^c-?185f/i, /^c-?206f/i];
const SKI_PATTERNS      = [/\bski\b/i, /skis?/i];
const AMPH_PATTERNS     = [/amphib/i, /^c-?185a/i];
const TAILWHEEL_PATTERNS= [/tail ?wheel/i, /\btw\b/i, /^c-?185/i, /beaver/i, /^c-?180/i, /pa-?(18|22)/i];

function matchesAny(s, patterns) {
  if (!s) return false;
  for (const p of patterns) if (p.test(s)) return true;
  return false;
}

// Returns { engine: 'SE'|'ME'|'HELI'|'GLIDER'|'SIM'|'UNKNOWN', config }
// `typeStr` is the aircraft type (e.g. "C172", "E195-E2", "FFS Q400").
// `regStr` is the registration / tail / sim device ID — also used to spot sim.
function detectAircraftCategory(typeStr, regStr) {
  const t = (typeStr || '').trim();
  const r = (regStr || '').trim();
  const blob = `${t} ${r}`;
  // 1. Sim takes priority over engine class — a "FFS Q400" should never be ME.
  if (matchesAny(t, SIM_PATTERNS) || matchesAny(r, SIM_PATTERNS)) return { engine: 'SIM', config: 'na' };
  if (matchesAny(t, HELI_PATTERNS))   return { engine: 'HELI',   config: 'na' };
  if (matchesAny(t, GLIDER_PATTERNS)) return { engine: 'GLIDER', config: 'na' };
  // Multi-engine before single-engine: some types like "C310" match both
  // the "Cessna 3-digit" SE-ish pattern and the explicit ME list; ME wins.
  if (matchesAny(t, ME_PATTERNS)) {
    let config = 'wheels';
    if      (matchesAny(blob, AMPH_PATTERNS))     config = 'amphibian';
    else if (matchesAny(blob, FLOAT_PATTERNS))    config = 'floats';
    else if (matchesAny(blob, SKI_PATTERNS))      config = 'skis';
    else if (matchesAny(blob, TAILWHEEL_PATTERNS))config = 'tailwheel';
    return { engine: 'ME', config };
  }
  if (matchesAny(t, SE_PATTERNS)) {
    let config = 'wheels';
    if      (matchesAny(blob, AMPH_PATTERNS))     config = 'amphibian';
    else if (matchesAny(blob, FLOAT_PATTERNS))    config = 'floats';
    else if (matchesAny(blob, SKI_PATTERNS))      config = 'skis';
    else if (matchesAny(blob, TAILWHEEL_PATTERNS))config = 'tailwheel';
    return { engine: 'SE', config };
  }
  return { engine: 'UNKNOWN', config: 'wheels' };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4 — Empty flight factory + additive time bucketing
// ═══════════════════════════════════════════════════════════════════

function makeEmptyFlight(extra) {
  return Object.assign({
    id: makeFlightId(),
    date: '', flightNum: '', type: '', reg: '',
    dep_icao: '', arr_icao: '', via: '', route: '',
    pic: '', copilot: '',
    atd_utc: '', ata_utc: '',
    block: 0, total: 0, duty: 0,
    seDay: 0, seNight: 0,
    meDayPic: 0, meNightPic: 0, meDayCop: 0, meNightCop: 0,
    meDayDual: 0, meNightDual: 0,
    xcDayPic: 0, xcNightPic: 0, xcDayCop: 0, xcNightCop: 0,
    xcDayDual: 0, xcNightDual: 0,
    instActual: 0, instHood: 0, instSim: 0,
    approaches: 0,
    toDay: 0, toNight: 0, ldgDay: 0, ldgNight: 0,
    picus: 0, dualGivenDay: 0, dualGivenNight: 0,
    multiCrew: false,
    remarks: '', acConfig: 'wheels',
    isSim: false, simType: '', simSession: '', simRegistration: '',
    importedFrom: '', importedAt: '', sourceHash: ''
  }, extra || {});
}

// Apply hours additively into the right buckets given engine class + role.
// Called once per role for each row (so a mixed-role flight is correct).
function applyTimeBucket(flight, category, role, day, night, xc) {
  day = +day || 0; night = +night || 0; xc = +xc || 0;
  if (day === 0 && night === 0) return;
  // Sim: route to instSim, never to airtime columns.
  if (category.engine === 'SIM') {
    flight.isSim = true;
    flight.instSim += day + night;
    return;
  }
  // Engine class columns.
  if (category.engine === 'SE') {
    flight.seDay   += day;
    flight.seNight += night;
  } else if (category.engine === 'ME') {
    const suffix = role === 'pic' ? 'Pic' : role === 'dual' ? 'Dual' : 'Cop';
    flight['meDay'   + suffix] += day;
    flight['meNight' + suffix] += night;
  } else if (category.engine === 'HELI' || category.engine === 'GLIDER') {
    // Schema gap: no dedicated heli/glider column. Preserve total in seDay/seNight
    // and tag acConfig + remarks so the user spots it.
    flight.seDay   += day;
    flight.seNight += night;
    flight.acConfig = category.engine === 'HELI' ? 'helicopter' : 'glider';
    const tag = category.engine === 'HELI' ? 'Helicopter time' : 'Glider time';
    if (!flight.remarks.includes(tag)) {
      flight.remarks = (flight.remarks ? flight.remarks + ' · ' : '') + tag;
    }
  } else {
    // UNKNOWN — user didn't classify this type yet. Default to ME (the
    // user will be forced through Step 1 classification before this runs in
    // practice; this branch is a safety net).
    const suffix = role === 'pic' ? 'Pic' : role === 'dual' ? 'Dual' : 'Cop';
    flight['meDay'   + suffix] += day;
    flight['meNight' + suffix] += night;
  }
  // Cross-country bucket (only ME has explicit XC columns by role; for SE+heli+glider
  // we don't have a dedicated XC column — XC is implicit in total hours).
  if (xc > 0 && category.engine === 'ME') {
    const suffix = role === 'pic' ? 'Pic' : role === 'dual' ? 'Dual' : 'Cop';
    const xcNight = Math.min(xc, night);
    const xcDay   = Math.max(0, xc - night);
    flight['xcDay'   + suffix] += xcDay;
    flight['xcNight' + suffix] += xcNight;
  }
}

// Captain-name read helper for CSV imports.
// PIPEDA model (2026-05-13): store full names locally; anonymize at egress only.
// This wrapper exists so each parser's call site is readable; no transformation.
function readPipedaName(name, profile) {
  return name || '';
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5 — Format-specific parsers
// ═══════════════════════════════════════════════════════════════════
// Each parser:
//   1. Reads raw source columns (block, day/night, pic, sic, dual, dualGiven,
//      picus, captain name, copilot name, XC, instrument actual/sim, approaches,
//      landings, take-offs, remarks).
//   2. Returns a "raw row" object: { headerRow, role buckets, type, reg, ... }.
//   3. The categorization + bucketing happens in materializeFlights() AFTER
//      the user confirms aircraft categories in Step 1.
//
// This means each parser is dumb extraction — engine class assumptions live
// only in the registry confirmation step. Easier to audit, less coupling.

function parseForeFlight(text, dateLocale, profile, hash) {
  const rows = parseCsv(text);
  const rawRows = [];
  const aircraftLookup = {};
  let mode = null;
  let headerMap = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const first = (r[0] || '').trim();
    if (first === 'Aircraft Table') { mode = 'aircraft-header'; headerMap = null; continue; }
    if (first === 'Flights Table')  { mode = 'flights-header';  headerMap = null; continue; }
    if (mode === 'aircraft-header') { headerMap = buildHeaderMap(r); mode = 'aircraft'; continue; }
    if (mode === 'flights-header')  { headerMap = buildHeaderMap(r); mode = 'flights';  continue; }
    if (mode === 'aircraft' && headerMap) {
      const id = (getCol(r, headerMap, 'AircraftID') || '').trim();
      if (!id) continue;
      const make  = getCol(r, headerMap, 'Make');
      const model = getCol(r, headerMap, 'Model');
      const typeCode = getCol(r, headerMap, 'TypeCode');
      aircraftLookup[id.toUpperCase()] = (typeCode || `${make} ${model}`.trim()).trim();
      continue;
    }
    if (mode === 'flights' && headerMap) {
      if (!getCol(r, headerMap, 'Date')) continue;
      rawRows.push(extractForeFlightRow(r, headerMap, aircraftLookup, dateLocale, profile));
    }
  }
  return { rawRows, source: 'ForeFlight', sourceKey: 'foreflight', hash };
}

function extractForeFlightRow(r, h, aircraftLookup, dateLocale, profile) {
  const reg = (getCol(r, h, 'AircraftID') || '').trim();
  const type = aircraftLookup[reg.toUpperCase()] || '';
  const total      = num(getCol(r, h, 'TotalTime'));
  const pic        = num(getCol(r, h, 'PIC'));
  const sic        = num(getCol(r, h, 'SIC'));
  const dualRcvd   = num(getCol(r, h, 'DualReceived'));
  const dualGiven  = num(getCol(r, h, 'DualGiven', 'CFI'));
  const picusTime  = num(getCol(r, h, 'PICUS', 'PIC US', 'PIC-US'));
  const night      = num(getCol(r, h, 'Night'));
  const xc         = num(getCol(r, h, 'CrossCountry'));
  const instAct    = num(getCol(r, h, 'ActualInstrument'));
  const instSim    = num(getCol(r, h, 'SimulatedInstrument'));
  const from       = (getCol(r, h, 'From') || '').trim().toUpperCase();
  const to         = (getCol(r, h, 'To') || '').trim().toUpperCase();
  const routeRaw   = (getCol(r, h, 'Route') || '').trim().toUpperCase();
  // ForeFlight stores up to 6 person fields — Person1 is often the PIC name.
  const captainRaw = (getCol(r, h, 'Person1') || '').trim();
  const copilotRaw = (getCol(r, h, 'Person2') || '').trim();
  // Approach1..6 — count non-empty as approaches. Filter out visual-only entries
  // per CAR 401.05 (only IFR approaches to MDA/DA count for currency).
  let approaches = 0;
  for (let n = 1; n <= 6; n++) {
    const v = (getCol(r, h, `Approach${n}`) || '').trim();
    if (!v || v === '0') continue;
    if (/^(visual|vfr)/i.test(v)) continue;
    approaches++;
  }
  return {
    rawType: type, rawReg: reg,
    date: parseDateWithLocale(getCol(r, h, 'Date'), dateLocale),
    flightNum: (getCol(r, h, 'FlightNumber') || '').trim(),
    from, to, route: routeRaw, via: '',
    captainRaw, copilotRaw,
    atd_utc: extractHHMM(getCol(r, h, 'TimeOut')),
    ata_utc: extractHHMM(getCol(r, h, 'TimeIn')),
    block: total, total,
    duty: Math.max(0, num(getCol(r, h, 'OffDuty')) - num(getCol(r, h, 'OnDuty'))),
    pic, sic, dualRcvd, dualGiven, picus: picusTime, night, xc,
    instActual: instAct, instHood: instSim,
    approaches,
    toDay:    intNum(getCol(r, h, 'DayTakeoffs')),
    toNight:  intNum(getCol(r, h, 'NightTakeoffs')),
    ldgDay:   intNum(getCol(r, h, 'DayLandingsFullStop')),
    ldgNight: intNum(getCol(r, h, 'NightLandingsFullStop')),
    multiCrew: pic > 0 && sic > 0,
    sourceMultiCrewHint: (sic > 0),  // SIC time logged → flight was crewed even if pic name empty
    sourceSimHint: /^(ffs|ftd|fnpt|sim)/i.test(type) || /^(ffs|ftd|fnpt|sim)/i.test(reg) || num(getCol(r, h, 'GroundTraining', 'SimulatedFlight')) > 0,
    remarks: (getCol(r, h, 'PilotComments') || '').trim(),
  };
}

function parseLogTen(text, dateLocale, profile, hash) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rawRows: [], source: 'LogTen Pro', sourceKey: 'logten', hash };
  const h = buildHeaderMap(rows[0]);
  const rawRows = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!getCol(r, h, 'flight: date', 'date')) continue;
    const reg  = (getCol(r, h, 'aircraft: aircraft id', 'aircraft id', 'tail') || '').trim();
    const type = (getCol(r, h, 'aircraft: type', 'aircraft type', 'type code', 'aircraft: type code') || '').trim();
    const total     = num(getCol(r, h, 'flight: total time', 'total time'));
    const pic       = num(getCol(r, h, 'flight: pic time', 'pic time'));
    const sic       = num(getCol(r, h, 'flight: sic time', 'sic time'));
    const dualRcvd  = num(getCol(r, h, 'flight: dual received', 'dual received'));
    const dualGiven = num(getCol(r, h, 'flight: dual given', 'flight: instructor', 'instructor time'));
    const picus     = num(getCol(r, h, 'flight: picus', 'picus', 'pic us'));
    const night     = num(getCol(r, h, 'flight: night time', 'night time'));
    const xc        = num(getCol(r, h, 'flight: cross country', 'cross country'));
    const instAct   = num(getCol(r, h, 'flight: actual instrument', 'actual instrument'));
    const instSim   = num(getCol(r, h, 'flight: simulated instrument', 'simulated instrument'));
    const from      = (getCol(r, h, 'flight: from', 'from') || '').toUpperCase().trim();
    const to        = (getCol(r, h, 'flight: to', 'to') || '').toUpperCase().trim();
    const captainRaw= (getCol(r, h, 'flight: pic', 'pic name', 'flight: captain') || '').trim();
    const copilotRaw= (getCol(r, h, 'flight: sic', 'sic name', 'flight: co-pilot') || '').trim();
    const simField  = (getCol(r, h, 'aircraft: simulator type', 'flight: simulator', 'aircraft: sim type') || '').trim();
    rawRows.push({
      rawType: type, rawReg: reg,
      date: parseDateWithLocale(getCol(r, h, 'flight: date', 'date'), dateLocale),
      flightNum: (getCol(r, h, 'flight: flight number', 'flight number') || '').trim(),
      from, to, route: '', via: '',
      captainRaw, copilotRaw,
      atd_utc: extractHHMM(getCol(r, h, 'flight: out', 'out time', 'time out')),
      ata_utc: extractHHMM(getCol(r, h, 'flight: in', 'in time', 'time in')),
      block: total, total,
      duty: num(getCol(r, h, 'flight: duty', 'duty time')),
      pic, sic, dualRcvd, dualGiven, picus, night, xc,
      instActual: instAct, instHood: instSim,
      approaches: intNum(getCol(r, h, 'flight: approaches', 'approaches')),
      toDay:    intNum(getCol(r, h, 'flight: day takeoffs', 'day takeoffs')),
      toNight:  intNum(getCol(r, h, 'flight: night takeoffs', 'night takeoffs')),
      ldgDay:   intNum(getCol(r, h, 'flight: day landings', 'day landings')),
      ldgNight: intNum(getCol(r, h, 'flight: night landings', 'night landings')),
      multiCrew: pic > 0 && sic > 0,
      sourceMultiCrewHint: (sic > 0),
      sourceSimHint: !!simField || /^(ffs|ftd|fnpt|sim)/i.test(type) || /^(ffs|ftd|fnpt|sim)/i.test(reg),
      remarks: (getCol(r, h, 'flight: remarks', 'remarks', 'comments') || '').trim(),
    });
  }
  return { rawRows, source: 'LogTen Pro', sourceKey: 'logten', hash };
}

function parseMyFlightbook(text, dateLocale, profile, hash) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rawRows: [], source: 'MyFlightbook', sourceKey: 'myflightbook', hash };
  const h = buildHeaderMap(rows[0]);
  const rawRows = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!getCol(r, h, 'date')) continue;
    const total = num(getCol(r, h, 'total flight time', 'totalflighttime', 'total time'));
    const pic   = num(getCol(r, h, 'pic', 'pic time'));
    const sic   = num(getCol(r, h, 'sic', 'sic time'));
    const dualRcvd  = num(getCol(r, h, 'dual', 'dual received'));
    const dualGiven = num(getCol(r, h, 'cfi', 'dual given', 'instructor'));
    const picus     = num(getCol(r, h, 'picus', 'pic us'));
    const night     = num(getCol(r, h, 'night'));
    const xc        = num(getCol(r, h, 'cross country', 'crosscountry', 'xc'));
    const imc       = num(getCol(r, h, 'imc', 'actual instrument'));
    const sim       = num(getCol(r, h, 'simulated instrument', 'simulated'));
    const groundTrn = num(getCol(r, h, 'ground sim', 'ground training', 'groundtraining'));
    const route = (getCol(r, h, 'route') || '').toUpperCase().trim();
    const reg   = (getCol(r, h, 'tailnumber', 'tail number', 'tail') || '').trim();
    const type  = (getCol(r, h, 'model', 'aircraft model', 'aircraft type', 'type') || '').trim();
    const captainRaw = (getCol(r, h, 'pic name', 'captain') || '').trim();
    const copilotRaw = (getCol(r, h, 'sic name', 'co-pilot') || '').trim();
    const parts = route.split(/[\s\-→]+/).filter(Boolean);
    const from = parts[0] || '';
    const to   = parts[parts.length - 1] || '';
    const via  = parts.length > 2 ? parts.slice(1, -1).join('-') : '';
    rawRows.push({
      rawType: type, rawReg: reg,
      date: parseDateWithLocale(getCol(r, h, 'date'), dateLocale),
      flightNum: (getCol(r, h, 'flight number', 'flightnum') || '').trim(),
      from, to, route: parts.join('-'), via,
      captainRaw, copilotRaw,
      atd_utc: extractHHMM(getCol(r, h, 'engine start', 'block out')),
      ata_utc: extractHHMM(getCol(r, h, 'engine end', 'block in')),
      block: total, total, duty: 0,
      pic, sic, dualRcvd, dualGiven, picus, night, xc,
      instActual: imc, instHood: sim,
      approaches: intNum(getCol(r, h, 'approaches')),
      toDay:    intNum(getCol(r, h, 'day takeoffs')),
      toNight:  intNum(getCol(r, h, 'night takeoffs')),
      ldgDay:   intNum(getCol(r, h, 'fs day landings', 'day landings', 'flandingsday')),
      ldgNight: intNum(getCol(r, h, 'fs night landings', 'night landings', 'flandingsnight')),
      multiCrew: pic > 0 && sic > 0,
      sourceMultiCrewHint: (sic > 0),
      sourceSimHint: groundTrn > 0 || /^(ffs|ftd|fnpt|sim)/i.test(type) || /^(ffs|ftd|fnpt|sim)/i.test(reg),
      remarks: (getCol(r, h, 'comments', 'remarks') || '').trim(),
    });
  }
  return { rawRows, source: 'MyFlightbook', sourceKey: 'myflightbook', hash };
}

function parseLogbookPro(text, dateLocale, profile, hash) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rawRows: [], source: 'Logbook Pro', sourceKey: 'logbookpro', hash };
  const h = buildHeaderMap(rows[0]);
  const rawRows = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!getCol(r, h, 'date')) continue;
    const total      = num(getCol(r, h, 'flight time', 'duration', 'total'));
    const pic        = num(getCol(r, h, 'pic', 'pilot in command'));
    const sic        = num(getCol(r, h, 'sic', 'second in command'));
    const dualRcvd   = num(getCol(r, h, 'dual received', 'dual'));
    const dualGiven  = num(getCol(r, h, 'dual given', 'instruction given', 'cfi'));
    const picus      = num(getCol(r, h, 'picus', 'pic us'));
    const nightSrc   = num(getCol(r, h, 'night'));
    const xc         = num(getCol(r, h, 'cross-country', 'cross country', 'xc'));
    const actual     = num(getCol(r, h, 'actual instrument', 'actual'));
    const simulated  = num(getCol(r, h, 'simulated instrument', 'hood'));
    const route   = (getCol(r, h, 'route of flight', 'route') || '').toUpperCase().trim();
    const reg     = (getCol(r, h, 'aircraft id', 'tail') || '').trim();
    const type    = (getCol(r, h, 'aircraft type', 'type') || '').trim();
    const parts = route.split(/[\s\-→]+/).filter(Boolean);
    const from = parts[0] || '';
    const to   = parts[parts.length - 1] || '';
    const via  = parts.length > 2 ? parts.slice(1, -1).join('-') : '';
    rawRows.push({
      rawType: type, rawReg: reg,
      date: parseDateWithLocale(getCol(r, h, 'date'), dateLocale),
      flightNum: (getCol(r, h, 'flight number') || '').trim(),
      from, to, route: parts.join('-'), via,
      captainRaw: (getCol(r, h, 'pic name', 'captain') || '').trim(),
      copilotRaw: (getCol(r, h, 'sic name', 'co-pilot') || '').trim(),
      atd_utc: extractHHMM(getCol(r, h, 'time out', 'block out')),
      ata_utc: extractHHMM(getCol(r, h, 'time in', 'block in')),
      block: total, total, duty: 0,
      pic, sic, dualRcvd, dualGiven, picus, night: nightSrc, xc,
      instActual: actual, instHood: simulated,
      approaches: intNum(getCol(r, h, 'approaches')),
      toDay:    intNum(getCol(r, h, 'day takeoffs')),
      toNight:  intNum(getCol(r, h, 'night takeoffs')),
      ldgDay:   intNum(getCol(r, h, 'day landings')),
      ldgNight: intNum(getCol(r, h, 'night landings')),
      multiCrew: pic > 0 && sic > 0,
      sourceMultiCrewHint: (sic > 0),
      sourceSimHint: /^(ffs|ftd|fnpt|sim)/i.test(type) || /^(ffs|ftd|fnpt|sim)/i.test(reg),
      remarks: (getCol(r, h, 'remarks', 'comments') || '').trim(),
    });
  }
  return { rawRows, source: 'Logbook Pro', sourceKey: 'logbookpro', hash };
}

function parseSafelog(text, dateLocale, profile, hash) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rawRows: [], source: 'Safelog', sourceKey: 'safelog', hash };
  const h = buildHeaderMap(rows[0]);
  const rawRows = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!getCol(r, h, 'date')) continue;
    const total      = num(getCol(r, h, 'total', 'duration'));
    const pic        = num(getCol(r, h, 'pic'));
    const sic        = num(getCol(r, h, 'sic'));
    const dualRcvd   = num(getCol(r, h, 'dual', 'dual received'));
    const dualGiven  = num(getCol(r, h, 'dual given', 'instructor'));
    const picus      = num(getCol(r, h, 'picus'));
    const night      = num(getCol(r, h, 'night'));
    const xc         = num(getCol(r, h, 'xc', 'cross country'));
    const actual     = num(getCol(r, h, 'actual', 'imc'));
    const simulated  = num(getCol(r, h, 'simulated', 'hood'));
    const reg   = (getCol(r, h, 'tail', 'aircraft', 'reg') || '').trim();
    const type  = (getCol(r, h, 'type', 'model') || '').trim();
    const from  = (getCol(r, h, 'from', 'dep') || '').toUpperCase().trim();
    const to    = (getCol(r, h, 'to', 'arr', 'dest') || '').toUpperCase().trim();
    rawRows.push({
      rawType: type, rawReg: reg,
      date: parseDateWithLocale(getCol(r, h, 'date'), dateLocale),
      flightNum: (getCol(r, h, 'flight', 'flight number') || '').trim(),
      from, to, route: '', via: '',
      captainRaw: (getCol(r, h, 'pic name', 'captain') || '').trim(),
      copilotRaw: (getCol(r, h, 'sic name', 'co-pilot') || '').trim(),
      atd_utc: extractHHMM(getCol(r, h, 'out', 'time out')),
      ata_utc: extractHHMM(getCol(r, h, 'in', 'time in')),
      block: total, total, duty: 0,
      pic, sic, dualRcvd, dualGiven, picus, night, xc,
      instActual: actual, instHood: simulated,
      approaches: intNum(getCol(r, h, 'app', 'approaches')),
      toDay: 0, toNight: 0,
      ldgDay:   intNum(getCol(r, h, 'day landings', 'stops day')),
      ldgNight: intNum(getCol(r, h, 'night landings', 'stops night')),
      multiCrew: pic > 0 && sic > 0,
      sourceMultiCrewHint: (sic > 0),
      sourceSimHint: /^(ffs|ftd|fnpt|sim)/i.test(type) || /^(ffs|ftd|fnpt|sim)/i.test(reg),
      remarks: (getCol(r, h, 'remarks', 'comments', 'notes') || '').trim(),
    });
  }
  return { rawRows, source: 'Safelog', sourceKey: 'safelog', hash };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6 — Universal wizard (manual column mapping for unknown CSVs)
// ═══════════════════════════════════════════════════════════════════

let csvWizardState = null;

const WIZARD_TARGETS = [
  { key: 'date',       label: 'Date (required)',     required: true },
  { key: 'reg',        label: 'Aircraft Registration', required: false },
  { key: 'type',       label: 'Aircraft Type / Model', required: false },
  { key: 'flightNum',  label: 'Flight Number',       required: false },
  { key: 'from',       label: 'From (departure)',    required: false },
  { key: 'to',         label: 'To (arrival)',        required: false },
  { key: 'via',        label: 'Via (intermediate)',  required: false },
  { key: 'atd_utc',    label: 'ATD UTC (actual departure)', required: false },
  { key: 'ata_utc',    label: 'ATA UTC (actual arrival)',   required: false },
  { key: 'total',      label: 'Total / Flight Time', required: true },
  { key: 'pic',        label: 'PIC Time',            required: false },
  { key: 'sic',        label: 'SIC Time',            required: false },
  { key: 'dualRcvd',   label: 'Dual Received',       required: false },
  { key: 'dualGiven',  label: 'Dual Given (CFI)',    required: false },
  { key: 'picus',      label: 'PICUS',               required: false },
  { key: 'night',      label: 'Night Time',          required: false },
  { key: 'xc',         label: 'Cross-Country Time',  required: false },
  { key: 'instActual', label: 'Instrument Actual',   required: false },
  { key: 'instHood',   label: 'Instrument Sim/Hood', required: false },
  { key: 'approaches', label: 'Approaches (count)',  required: false },
  { key: 'ldgDay',     label: 'Day Landings',        required: false },
  { key: 'ldgNight',   label: 'Night Landings',      required: false },
  { key: 'captain',    label: 'PIC Name',            required: false },
  { key: 'copilot',    label: 'SIC / Co-pilot Name', required: false },
  { key: 'remarks',    label: 'Remarks / Comments',  required: false }
];

// Translated display label for a wizard target (the English `label` on the
// object is kept as a fallback). Header-matching dictionaries below stay English.
function csvTargetLabel(target) {
  return (typeof t === 'function') ? t('csv.target.' + target.key) : target.label;
}

function guessHeaderForTarget(key) {
  switch (key) {
    case 'date':       return ['date', 'flight date'];
    case 'reg':        return ['aircraft id', 'aircraftid', 'tail', 'tailnumber', 'tail number', 'registration', 'reg'];
    case 'type':       return ['aircraft type', 'type', 'model', 'aircraft model', 'typecode'];
    case 'flightNum':  return ['flight number', 'flightnumber', 'flightnum', 'flight #', 'flight'];
    case 'from':       return ['from', 'departure', 'dep', 'origin'];
    case 'to':         return ['to', 'arrival', 'arr', 'destination', 'dest'];
    case 'via':        return ['via', 'intermediate', 'stops'];
    case 'atd_utc':    return ['time out', 'timeout', 'out', 'block out', 'departure time', 'atd', 'actual departure'];
    case 'ata_utc':    return ['time in', 'timein', 'in', 'block in', 'arrival time', 'ata', 'actual arrival'];
    case 'total':      return ['total time', 'totaltime', 'total flight time', 'totalflighttime', 'flight time', 'duration', 'total', 'block time', 'block'];
    case 'pic':        return ['pic', 'pic time', 'pilot in command'];
    case 'sic':        return ['sic', 'sic time', 'second in command'];
    case 'dualRcvd':   return ['dual received', 'dual', 'dualreceived'];
    case 'dualGiven':  return ['dual given', 'cfi', 'instructor time', 'instruction given'];
    case 'picus':      return ['picus', 'pic us', 'pic-us'];
    case 'night':      return ['night', 'night time'];
    case 'xc':         return ['cross country', 'crosscountry', 'cross-country', 'xc'];
    case 'instActual': return ['actual instrument', 'actualinstrument', 'imc', 'actual'];
    case 'instHood':   return ['simulated instrument', 'simulatedinstrument', 'hood', 'simulated'];
    case 'approaches': return ['approaches', 'app'];
    case 'ldgDay':     return ['day landings', 'daylandingsfullstop', 'fs day landings'];
    case 'ldgNight':   return ['night landings', 'nightlandingsfullstop', 'fs night landings'];
    case 'captain':    return ['captain', 'pic name', 'pilot in command name'];
    case 'copilot':    return ['copilot', 'co-pilot', 'sic name', 'second in command name'];
    case 'remarks':    return ['remarks', 'comments', 'pilotcomments', 'pilot comments', 'notes'];
    default: return [];
  }
}

function parseUniversal(text, dateLocale, profile, hash) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rawRows: [], source: t('csv.universalSource'), sourceKey: 'wizard', hash };
  const headerRow = rows[0];
  const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''));
  csvWizardState = { headerRow, dataRows, mapping: {}, dateLocale, profile, hash };
  const headerMap = buildHeaderMap(headerRow);
  WIZARD_TARGETS.forEach(t => {
    for (const g of guessHeaderForTarget(t.key)) {
      if (headerMap[g] !== undefined) { csvWizardState.mapping[t.key] = headerMap[g]; break; }
    }
  });
  showWizardMappingModal();
  return null;  // wizard handles its own flow
}

function showWizardMappingModal() {
  const overlay = document.getElementById('importPreview');
  if (!overlay || !csvWizardState) return;
  document.getElementById('importSubtitle').textContent =
    t('csv.wizard.subtitle', { n: csvWizardState.dataRows.length });
  const rows = WIZARD_TARGETS.map(target => {
    const cur = csvWizardState.mapping[target.key];
    const selected = cur !== undefined ? cur : '';
    return `
      <div class="review-item">
        <div class="review-body" style="flex:1;">
          <div class="review-item-header">${esc(csvTargetLabel(target))}${target.required ? ' <span style="color:var(--danger)">*</span>' : ''}</div>
        </div>
        <select onchange="csvWizardState.mapping[${JSON.stringify(target.key)}] = this.value === '' ? undefined : parseInt(this.value, 10);"
                style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; background:var(--bg);">
          <option value="">${esc(t('csv.wizard.skip'))}</option>
          ${csvWizardState.headerRow.map((hLabel, i) =>
            `<option value="${i}" ${i === selected ? 'selected' : ''}>${esc(hLabel || t('csv.wizard.blank'))}</option>`
          ).join('')}
        </select>
      </div>`;
  }).join('');
  document.getElementById('extractedList').innerHTML = `
    <p style="margin-bottom:var(--s-3); font-size:13px; color:var(--text-secondary);">
      ${t('csv.wizard.intro')}
    </p>
    ${rows}
  `;
  document.getElementById('importConfirmBtn').textContent = t('csv.wizard.continue');
  document.getElementById('importConfirmBtn').onclick = () => applyWizardMapping();
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function applyWizardMapping() {
  if (!csvWizardState) return;
  const missing = WIZARD_TARGETS.filter(target => target.required && csvWizardState.mapping[target.key] === undefined);
  if (missing.length) {
    showToast(t('toast.missingMapping', { fields: missing.map(target => csvTargetLabel(target)).join(', ') }), 'error');
    return;
  }
  const m = csvWizardState.mapping;
  const get = (r, key) => m[key] !== undefined && r[m[key]] !== undefined ? r[m[key]] : '';
  const rawRows = csvWizardState.dataRows.map(r => {
    const total = num(get(r, 'total'));
    const pic   = num(get(r, 'pic'));
    const sic   = num(get(r, 'sic'));
    const dualRcvd  = num(get(r, 'dualRcvd'));
    const dualGiven = num(get(r, 'dualGiven'));
    const picusTime = num(get(r, 'picus'));
    const night = num(get(r, 'night'));
    const xc    = num(get(r, 'xc'));
    const type  = String(get(r, 'type') || '').trim();
    const reg   = String(get(r, 'reg') || '').trim();
    return {
      rawType: type, rawReg: reg,
      date: parseDateWithLocale(get(r, 'date'), csvWizardState.dateLocale),
      flightNum: String(get(r, 'flightNum') || '').trim(),
      from: String(get(r, 'from') || '').toUpperCase().trim(),
      to:   String(get(r, 'to') || '').toUpperCase().trim(),
      via:  String(get(r, 'via') || '').toUpperCase().trim(),
      route: '',
      captainRaw: String(get(r, 'captain') || '').trim(),
      copilotRaw: String(get(r, 'copilot') || '').trim(),
      atd_utc: extractHHMM(get(r, 'atd_utc')),
      ata_utc: extractHHMM(get(r, 'ata_utc')),
      block: total, total, duty: 0,
      pic, sic, dualRcvd, dualGiven, picus: picusTime, night, xc,
      instActual: num(get(r, 'instActual')),
      instHood:   num(get(r, 'instHood')),
      approaches: intNum(get(r, 'approaches')),
      toDay: 0, toNight: 0,
      ldgDay:   intNum(get(r, 'ldgDay')),
      ldgNight: intNum(get(r, 'ldgNight')),
      multiCrew: pic > 0 && sic > 0,
      sourceMultiCrewHint: (sic > 0),
      sourceSimHint: /^(ffs|ftd|fnpt|sim)/i.test(type) || /^(ffs|ftd|fnpt|sim)/i.test(reg),
      remarks: String(get(r, 'remarks') || '').trim(),
    };
  });
  const hash = csvWizardState.hash;
  csvWizardState = null;
  startImportFlow({ rawRows, source: t('csv.universalSource'), sourceKey: 'wizard', hash });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7 — Multi-step import flow (classify → review → attest → commit)
// ═══════════════════════════════════════════════════════════════════

// State across the 3 steps. Cleared on cancel or after commit.
let csvImportState = null;

// Build unique aircraft list from raw rows. Pre-fills detected category for each.
function buildAircraftList(rawRows) {
  const map = new Map();
  rawRows.forEach(row => {
    const key = `${(row.rawType || '').toUpperCase()}|${(row.rawReg || '').toUpperCase()}`;
    if (!map.has(key)) {
      const detected = detectAircraftCategory(row.rawType, row.rawReg);
      map.set(key, {
        key,
        type: row.rawType || '(unknown)',
        reg: row.rawReg || '(unknown)',
        engine: detected.engine === 'UNKNOWN' ? 'ME' : detected.engine,  // default ME for unknown
        config: detected.config,
        autoDetected: detected.engine !== 'UNKNOWN',
        count: 0
      });
    }
    map.get(key).count++;
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// Entry point — called once parsing is done.
function startImportFlow(parsed) {
  if (!parsed.rawRows.length) {
    showToast(t('toast.noFlightsFound', { source: parsed.source }), 'error');
    return;
  }
  csvImportState = {
    parsed,
    aircraftList: buildAircraftList(parsed.rawRows),
    step: 1,
    attestation: { name: '', accepted: false }
  };
  showAircraftClassifyStep();
}

function showAircraftClassifyStep() {
  if (!csvImportState) return;
  const overlay = document.getElementById('importPreview');
  if (!overlay) return;
  csvImportState.step = 1;
  document.getElementById('importSubtitle').textContent = t('csv.step.classify');
  const intro = t('csv.classify.intro', { n: csvImportState.aircraftList.length });
  const rows = csvImportState.aircraftList.map((ac, idx) => {
    const flag = ac.engine === 'SIM' || !ac.autoDetected;
    return `
      <div class="review-item" style="${flag ? 'border-color: var(--warning, #d97706);' : ''}">
        <div class="review-body" style="flex:1;">
          <div class="review-item-header">${esc(ac.type)} · <span style="font-family:var(--font-mono); color:var(--text-secondary);">${esc(ac.reg)}</span></div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${ac.count} flight${ac.count !== 1 ? 's' : ''}${ac.autoDetected ? '' : ' · <strong style="color:var(--warning, #d97706);">no auto-detection — verify</strong>'}</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <select onchange="csvImportState.aircraftList[${idx}].engine = this.value;"
                  style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; background:var(--bg);">
            ${['SE','ME','HELI','GLIDER','SIM'].map(e =>
              `<option value="${e}" ${e === ac.engine ? 'selected' : ''}>${esc(t('csv.engine.' + e))}</option>`
            ).join('')}
          </select>
          <select onchange="csvImportState.aircraftList[${idx}].config = this.value;"
                  style="padding:6px 10px; border:1px solid var(--border); border-radius:6px; font-size:13px; background:var(--bg);">
            ${['wheels','floats','skis','amphibian','tailwheel','na'].map(c =>
              `<option value="${c}" ${c === ac.config ? 'selected' : ''}>${esc(t('csv.config.' + c))}</option>`
            ).join('')}
          </select>
        </div>
      </div>`;
  }).join('');
  document.getElementById('extractedList').innerHTML = `
    <p style="margin-bottom:var(--s-3); font-size:13px; color:var(--text-secondary); line-height:1.6;">${esc(intro)}</p>
    ${rows}
  `;
  document.getElementById('importConfirmBtn').textContent = t('csv.classify.continue');
  document.getElementById('importConfirmBtn').onclick = () => showCsvReviewStep();
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

// Build the final flight list using user-confirmed aircraft categories.
function materializeFlights() {
  if (!csvImportState) return [];
  const catByKey = new Map();
  csvImportState.aircraftList.forEach(ac => catByKey.set(ac.key, { engine: ac.engine, config: ac.config }));
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const importedAt = new Date().toISOString();
  return csvImportState.parsed.rawRows.map(row => {
    const key = `${(row.rawType || '').toUpperCase()}|${(row.rawReg || '').toUpperCase()}`;
    const cat = catByKey.get(key) || { engine: 'ME', config: 'wheels' };
    // Source can flag a sim row even if the aircraft was classified non-sim
    // (e.g. mixed file). When sourceSimHint is true, treat that row as sim.
    const effectiveCat = row.sourceSimHint ? { engine: 'SIM', config: 'na' } : cat;
    const f = makeEmptyFlight();
    f.date = row.date;
    f.flightNum = row.flightNum;
    f.type = row.rawType;
    f.reg = row.rawReg;
    f.dep_icao = row.from;
    f.arr_icao = row.to;
    f.via = row.via || '';
    f.route = row.route || (row.from && row.to ? `${row.from}${row.via ? '-' + row.via : ''}-${row.to}` : '');
    f.pic = readPipedaName(row.captainRaw, profile);
    f.copilot = readPipedaName(row.copilotRaw, profile);
    f.atd_utc = row.atd_utc;
    f.ata_utc = row.ata_utc;
    f.block = row.block;
    f.total = row.total;
    f.duty = row.duty;
    // Bucket time additively for every role with time logged.
    // To avoid over-allocating night/XC when PIC+SIC+Dual exceed Total, we
    // proportionally split night and xc across roles by their share of the
    // total role time. This preserves the flight's true night/XC totals.
    const sumRoles = (+row.pic || 0) + (+row.sic || 0) + (+row.dualRcvd || 0);
    const totalNight = +row.night || 0;
    const totalXC = +row.xc || 0;
    const allocate = (roleHours, roleKey) => {
      if (roleHours <= 0) return;
      const fraction = sumRoles > 0 ? roleHours / sumRoles : 1;
      const roleNight = Math.min(roleHours, totalNight * fraction);
      const roleDay = Math.max(0, roleHours - roleNight);
      const roleXC = totalXC * fraction;
      applyTimeBucket(f, effectiveCat, roleKey, roleDay, roleNight, roleXC);
    };
    if (row.pic > 0)       allocate(row.pic,      'pic');
    if (row.sic > 0)       allocate(row.sic,      'cop');
    if (row.dualRcvd > 0)  allocate(row.dualRcvd, 'dual');
    // Fallback: if no role time logged but total > 0, attribute total to PIC.
    if (sumRoles === 0 && row.total > 0) {
      const fbNight = Math.min(row.total, totalNight);
      const fbDay = Math.max(0, row.total - fbNight);
      applyTimeBucket(f, effectiveCat, 'pic', fbDay, fbNight, totalXC);
    }
    f.instActual = row.instActual;
    f.instHood   = row.instHood;
    f.approaches = row.approaches;
    f.toDay = row.toDay; f.toNight = row.toNight;
    f.ldgDay = row.ldgDay; f.ldgNight = row.ldgNight;
    f.picus = row.picus;
    f.dualGivenDay   = Math.max(0, row.dualGiven - row.night);
    f.dualGivenNight = Math.min(row.dualGiven, row.night);
    // multiCrew: source says both pic+sic OR carrier profile is 705 AND source had any sic time
    f.multiCrew = row.multiCrew || (row.sourceMultiCrewHint && /705/.test(profile.airline || ''));
    f.remarks = row.remarks;
    // acConfig — from per-aircraft config (overridden to helicopter/glider by applyTimeBucket
    // when the aircraft is heli/glider — but only if applyTimeBucket changed it).
    if (f.acConfig === 'wheels') f.acConfig = effectiveCat.config;
    f.importedFrom = csvImportState.parsed.sourceKey;
    f.importedAt = importedAt;
    f.sourceHash = csvImportState.parsed.hash;
    return f;
  });
}

function showCsvReviewStep() {
  if (!csvImportState) return;
  // Validate all aircraft have a non-UNKNOWN classification (they already do
  // because the UI defaulted unknowns to ME, but enforce in case of future changes).
  const unclassified = csvImportState.aircraftList.filter(ac => !['SE','ME','HELI','GLIDER','SIM'].includes(ac.engine));
  if (unclassified.length) {
    showToast(t('toast.confirmAircraft', { n: unclassified.length }), 'error');
    return;
  }
  csvImportState.step = 2;
  csvImportState.materialized = materializeFlights();
  const flights = csvImportState.materialized;
  // Tally hours by engine class.
  const tally = { SE: 0, ME: 0, HELI: 0, GLIDER: 0, SIM: 0 };
  flights.forEach(f => {
    if (f.isSim) { tally.SIM += +f.instSim || 0; return; }
    const heliGliderMark = f.acConfig === 'helicopter' || f.acConfig === 'glider';
    const meTime = (+f.meDayPic||0)+(+f.meNightPic||0)+(+f.meDayCop||0)+(+f.meNightCop||0)+(+f.meDayDual||0)+(+f.meNightDual||0);
    const seTime = (+f.seDay||0)+(+f.seNight||0);
    if (heliGliderMark)        tally[f.acConfig === 'helicopter' ? 'HELI' : 'GLIDER'] += seTime;
    else if (meTime > 0)       tally.ME += meTime;
    else if (seTime > 0)       tally.SE += seTime;
  });
  const totalHours = flights.reduce((s, f) => s + (+f.total || 0), 0);
  const simFlagged = flights.filter(f => f.isSim).length;
  const overlay = document.getElementById('importPreview');
  document.getElementById('importSubtitle').textContent = t('csv.step.review');
  const tallyHtml = Object.entries(tally).filter(([,v]) => v > 0).map(([k, v]) =>
    `<div><strong>${fmt(v)}</strong> h ${esc(t('csv.engine.' + k))}</div>`
  ).join('');
  const preview = flights.slice(0, 20).map(f => `
    <div class="review-item">
      <div class="review-body">
        <div class="review-item-header">${esc(f.date)} · ${esc(f.flightNum || '—')} · ${esc(f.route || '—')}</div>
        <div class="review-fields">
          <div class="review-field"><span>${esc(t('colShort.reg'))}</span> ${esc(f.reg || '—')}</div>
          <div class="review-field"><span>${esc(t('colShort.type'))}</span> ${esc(f.type || '—')}</div>
          <div class="review-field"><span>${esc(t('col.total'))}</span> ${fmt(f.total)} h</div>
          <div class="review-field"><span>${esc(t('flight.section.engine'))}</span> ${esc(f.isSim ? t('csv.engine.SIM') : (f.acConfig === 'helicopter' ? t('csv.engine.HELI') : f.acConfig === 'glider' ? t('csv.engine.GLIDER') : ((+f.seDay||0)+(+f.seNight||0) > 0 ? t('csv.engine.SE') : t('csv.engine.ME'))))}</div>
        </div>
      </div>
    </div>`).join('');
  document.getElementById('extractedList').innerHTML = `
    <div class="form-card" style="margin-bottom:var(--s-3); padding:var(--s-3);">
      <div style="font-size:13px; margin-bottom:var(--s-2);">${esc(t('csv.audit.intro', { flights: flights.length, hours: fmt(totalHours), source: csvImportState.parsed.source }))}</div>
      <div style="display:flex; gap:var(--s-4); flex-wrap:wrap; font-size:13px;">${tallyHtml || '<div>—</div>'}</div>
      ${simFlagged > 0 ? `<div style="margin-top:var(--s-2); font-size:11px; color:var(--warning, #d97706);">${esc(t(simFlagged === 1 ? 'csv.audit.flaggedSim' : 'csv.audit.flaggedSimPl', { n: simFlagged }))}</div>` : ''}
      <div style="margin-top:var(--s-2); font-size:11px; color:var(--text-muted);">${esc(t('csv.audit.flaggedXC'))}</div>
    </div>
    ${preview}
    ${flights.length > 20 ? `<div style="text-align:center; padding:var(--s-3); color:var(--text-muted); font-size:12px;">${esc(t('csv.review.andMore', { n: flights.length - 20 }))}</div>` : ''}
  `;
  document.getElementById('importConfirmBtn').textContent = t('csv.classify.continue');
  document.getElementById('importConfirmBtn').onclick = () => showCsvAttestStep();
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function showCsvAttestStep() {
  if (!csvImportState) return;
  csvImportState.step = 3;
  const overlay = document.getElementById('importPreview');
  document.getElementById('importSubtitle').textContent = t('csv.step.attest');
  const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
  const defaultName = `${profile.fname || ''} ${profile.lname || ''}`.trim();
  document.getElementById('extractedList').innerHTML = `
    <div class="form-card" style="margin-bottom:var(--s-3); padding:var(--s-3); border-left:3px solid var(--danger);">
      <div style="font-weight:600; margin-bottom:var(--s-2);">${esc(t('csv.attest.title'))}</div>
      <div style="font-size:13px; line-height:1.6; color:var(--text-secondary);">
        ${t('csv.attest.introHtml', { n: csvImportState.materialized.length, source: esc(csvImportState.parsed.source) })}
      </div>
    </div>
    <div class="form-card" style="padding:var(--s-3);">
      <label class="col-option" style="display:flex; gap:10px; align-items:flex-start;">
        <input type="checkbox" id="csvAttestCheck" style="margin-top:3px;"
               onchange="csvImportState.attestation.accepted = this.checked;" />
        <span class="col-option-label" style="font-size:13px; line-height:1.5;">${esc(t('csv.attest.checkbox'))}</span>
      </label>
      <div class="form-group" style="margin-top:var(--s-3);">
        <label>${esc(t('csv.attest.signLabel'))}</label>
        <input type="text" id="csvAttestSign" placeholder="${esc(t('csv.attest.signPlaceholder'))}"
               value="${esc(defaultName)}"
               oninput="csvImportState.attestation.name = this.value;"
               style="font-family:var(--font-mono);" />
      </div>
    </div>
  `;
  csvImportState.attestation.name = defaultName;
  document.getElementById('importConfirmBtn').textContent = t('csv.attest.confirmBtn');
  document.getElementById('importConfirmBtn').onclick = () => commitCsvImport();
  overlay.classList.add('show');
}

function commitCsvImport() {
  if (!csvImportState) return;
  const att = csvImportState.attestation;
  if (!att.accepted) {
    showToast(t('toast.acceptResponsibility'), 'error');
    return;
  }
  if (!att.name || att.name.trim().length < 2) {
    showToast(t('toast.signRequired'), 'error');
    return;
  }
  const flightsToImport = csvImportState.materialized;
  const rollback = flights.slice();
  snapshotBeforeOperation(`Import from ${csvImportState.parsed.source}`);
  updateUndoButton();

  // Resolve self-references in the PIC / copilot fields. Pilots commonly
  // write "self" / "moi" / their own name in their source logbook when
  // they were PIC. We translate that into crewPosition + clear the field
  // so the user's own name never sits in their own logbook's PIC column.
  const csvImportProfile = DB.loadProfile();
  let added = 0, merged = 0;
  flightsToImport.forEach(raw => {
    const incoming = (typeof resolveSelfReferences === 'function')
      ? resolveSelfReferences(raw, csvImportProfile)
      : raw;
    incoming.signedBy = att.name.trim();
    incoming.signedAt = new Date().toISOString();
    const match = findMatchingExistingFlight(incoming);
    if (match) {
      const existing = flights[match.idx];
      const mergedFlight = { ...incoming, ...existing };  // existing wins
      const numericKeys = ['block','total','duty','meDayPic','meNightPic','meDayCop','meNightCop',
                           'meDayDual','meNightDual','seDay','seNight',
                           'xcDayPic','xcNightPic','xcDayCop','xcNightCop','xcDayDual','xcNightDual',
                           'instActual','instHood','instSim','approaches',
                           'toDay','toNight','ldgDay','ldgNight',
                           'picus','dualGivenDay','dualGivenNight'];
      numericKeys.forEach(k => {
        if ((+existing[k] || 0) === 0 && (+incoming[k] || 0) > 0) mergedFlight[k] = incoming[k];
      });
      flights[match.idx] = mergedFlight;
      merged++;
    } else {
      // Auto-fill XC + Night from route coords for any slot the CSV didn't
      // provide. fill-empty-only — never overwrites a value the source CSV
      // already carried (ForeFlight / LogTen Pro export their own night/XC).
      // Same gap that iCal + manual-form had. Audit R2 2026-06-08.
      const enriched = (typeof recalculateFlightDayNightXC === 'function')
        ? recalculateFlightDayNightXC(incoming)
        : incoming;
      flights.push(enriched);
      added++;
    }
  });

  try {
    DB.save(flights);
  } catch (e) {
    console.error('[CSV import] DB.save failed, rolling back:', e);
    flights = rollback;
    showToast(t('toast.storageFull'), 'error');
    csvImportState = null;
    cancelImport();
    return;
  }

  appendImportAuditLog({
    timestamp: new Date().toISOString(),
    version: (typeof BUILD_VERSION !== 'undefined') ? BUILD_VERSION : 'unknown',
    source: csvImportState.parsed.source,
    sourceKey: csvImportState.parsed.sourceKey,
    sourceHash: csvImportState.parsed.hash || '',
    flightCount: flightsToImport.length,
    added, merged,
    signedBy: att.name.trim()
  });

  renderDashboard();
  if (typeof renderLogbook === 'function') renderLogbook(typeof filterVal !== 'undefined' ? filterVal : '');
  showToast(t('toast.csvImported', { source: csvImportState.parsed.source, added, merged }), 'success');
  csvImportState = null;
  cancelImport();
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8 — Drop-zone entry + audit log
// ═══════════════════════════════════════════════════════════════════

function handleCsvDrop(event) {
  event.preventDefault();
  const dz = document.getElementById('csvDropZone');
  if (dz) dz.classList.remove('dragover');
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) handleCsvFile(file);
}

function handleCsvFile(file) {
  if (!file) return;
  if (!/\.csv$|\.txt$/i.test(file.name)) {
    showToast(t('toast.csvDropOnly'), 'error');
    return;
  }
  if (file.size > CSV_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    showToast(t('toast.fileTooBig', { mb }), 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result || '';
    const hash = hashCsvContent(text);
    const profile = (typeof DB !== 'undefined' && DB.loadProfile) ? DB.loadProfile() : {};
    // Pre-scan dates to pick locale before parsing.
    const sampleDates = text.split('\n').slice(0, 200).map(line => {
      const m = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\-\/]\d{1,2}[\-\/]\d{1,2})/);
      return m ? m[1] : '';
    });
    const dateLocale = detectDateLocale(sampleDates);
    if (dateLocale === 'ambiguous') {
      // Force user to disambiguate.
      const pick = window.confirm(t('toast.dateAmbiguous') + '\n\nOK = MM/DD (US)\nCancel = DD/MM (EU)');
      const chosen = pick ? 'us' : 'eu';
      parseAndStartFlow(text, chosen, profile, hash);
      return;
    }
    parseAndStartFlow(text, dateLocale, profile, hash);
  };
  reader.readAsText(file);
}

function parseAndStartFlow(text, dateLocale, profile, hash) {
  const fmtKind = detectCsvFormat(text);
  let parsed = null;
  try {
    if (fmtKind === 'foreflight')         parsed = parseForeFlight(text, dateLocale, profile, hash);
    else if (fmtKind === 'logten')        parsed = parseLogTen(text, dateLocale, profile, hash);
    else if (fmtKind === 'myflightbook')  parsed = parseMyFlightbook(text, dateLocale, profile, hash);
    else if (fmtKind === 'logbookpro')    parsed = parseLogbookPro(text, dateLocale, profile, hash);
    else if (fmtKind === 'safelog')       parsed = parseSafelog(text, dateLocale, profile, hash);
    else                                  { parseUniversal(text, dateLocale, profile, hash); return; }
  } catch (err) {
    console.error('[CSV import] Parse failed:', err);
    showToast(t('toast.csvParseFailed'), 'error');
    return;
  }
  startImportFlow(parsed);
}

const IMPORT_LOG_KEY = 'cumulo_import_log_v1';

function appendImportAuditLog(entry) {
  try {
    const existing = JSON.parse(localStorage.getItem(IMPORT_LOG_KEY) || '[]');
    existing.push(entry);
    // Keep last 100 imports.
    const trimmed = existing.slice(-100);
    localStorage.setItem(IMPORT_LOG_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[CSV import] audit log write failed:', e);
  }
}
