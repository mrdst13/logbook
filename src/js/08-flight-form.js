// ═══════════════════════════════════════════
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
    case 'day':         return ((+f.meDayPic||0)+(+f.meDayCop||0)+(+f.meDayDual||0)+(+f.seDay||0));
    case 'night':       return ((+f.meNightPic||0)+(+f.meNightCop||0)+(+f.meNightDual||0)+(+f.seNight||0));
    case 'ifr':         return ((+f.instActual||0)+(+f.instHood||0));
    case 'vfr':         {
      const total = +f.total || +f.block || 0;
      const ifr = (+f.instActual||0)+(+f.instHood||0);
      return Math.max(0, total - ifr);
    }
    case 'xcDay':       return ((+f.xcDayPic||0)+(+f.xcDayCop||0)+(+f.xcDayDual||0));
    case 'xcNight':     return ((+f.xcNightPic||0)+(+f.xcNightCop||0)+(+f.xcNightDual||0));
    case 'crewPosition': {
      if ((+f.meDayPic||0)+(+f.meNightPic||0)+(+f.seDay||0) > 0) return 'PIC';
      if ((+f.meDayDual||0)+(+f.meNightDual||0) > 0) return 'Dual';
      if ((+f.meDayCop||0)+(+f.meNightCop||0) > 0) return 'SIC';
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
const WORKER_URL = 'https://logbook-api.martindaoust33.workers.dev';

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

// ─────────────────────────────────────────────────────────────────
//  GEO / DISTANCE — Haversine + Cross-Country detection
//  CAR 401.34 : cross-country = straight-line distance > 25 NM (46.3 km)
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
  if (!dep || !arr) {
    // Unknown airports — conservative: assume XC if ICAO codes differ
    return depICAO !== arrICAO;
  }
  return haversineKM(dep.lat, dep.lon, arr.lat, arr.lon) > 46.3;
}

// ─────────────────────────────────────────────────────────────────
//  SUNRISE / SUNSET — NOAA solar position algorithm
//  Returns { sunriseUTC, sunsetUTC, polar } for the given UTC date + coords
// ─────────────────────────────────────────────────────────────────
function calcSunriseSunset(date, lat, lon) {
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
  const zenith = 90.833 * Math.PI / 180;
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

// "Is this UTC time considered night under RAC 101.01 at this location?"
// Night = from 30 min after sunset to 30 min before sunrise.
function isNightUTC(utcTime, lat, lon) {
  const ss = calcSunriseSunset(utcTime, lat, lon);
  if (ss.polar === 'night') return true;
  if (ss.polar === 'day')   return false;
  const halfHour = 30 * 60 * 1000;
  const nightStart = new Date(ss.sunsetUTC.getTime() + halfHour);
  const nightEndMorning = new Date(ss.sunriseUTC.getTime() - halfHour);
  // RAC night spans midnight: it's night either after nightStart (today)
  // or before nightEndMorning (today, early hours).
  return utcTime >= nightStart || utcTime <= nightEndMorning;
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

  const stepMs = 60000;
  let nightMs = 0;
  for (let t = blockOffUTC.getTime(); t < blockOnUTC.getTime(); t += stepMs) {
    if (isNightUTC(new Date(t), lat, lon)) nightMs += stepMs;
  }
  // Account for the final partial minute
  const remainder = (blockOnUTC.getTime() - blockOffUTC.getTime()) % stepMs;
  if (remainder > 0 && isNightUTC(new Date(blockOnUTC.getTime() - 1), lat, lon)) {
    nightMs += remainder;
  }
  const nightHours = +(nightMs / 3600000).toFixed(2);
  const dayHours = +(totalHours - nightHours).toFixed(2);
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
  if (summary.includes('(D)')) return null;

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
  const dateStr = icsDate(ev.DTSTART);

  // ── Block-off / Block-on UTC times ──
  // SOURCE OF TRUTH = DTSTART (full ISO UTC, no ambiguity).
  // Falls back to buildUTCDateTime(date, STD) only if DTSTART is malformed.
  const depCoords = AIRPORT_COORDS[depICAO];
  const arrCoords = AIRPORT_COORDS[arrICAO];
  const blockOffUTC = icsDateTime(ev.DTSTART)
                  || (stdMatch ? buildUTCDateTime(dateStr, stdMatch[1]) : null);
  const blockOnUTC = blockOffUTC ? new Date(blockOffUTC.getTime() + block * 3600000) : null;

  // ── Day/Night split (RAC 101.01) ──
  let dayHours = block, nightHours = 0;
  if (depCoords && arrCoords && blockOffUTC && blockOnUTC) {
    const split = calculateDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords);
    dayHours = split.dayHours;
    nightHours = split.nightHours;
  }

  // ── Cross-Country detection (CAR 401.34: > 25 NM) ──
  const isXC = isCrossCountry(depICAO, arrICAO);

  // ── Landing day/night based on arrival UTC time + arrival airport coords ──
  let ldgDay = 1, ldgNight = 0;
  if (arrCoords && blockOnUTC && isNightUTC(blockOnUTC, arrCoords.lat, arrCoords.lon)) {
    ldgDay = 0; ldgNight = 1;
  }

  // F/O: block goes to SIC columns. Split into day/night, and XC variants.
  const role = isFO ? 'cop' : 'pic';
  const meDayPic    = role === 'pic' ? dayHours   : 0;
  const meNightPic  = role === 'pic' ? nightHours : 0;
  const meDayCop    = role === 'cop' ? dayHours   : 0;
  const meNightCop  = role === 'cop' ? nightHours : 0;
  const xcDayPic    = isXC && role === 'pic' ? dayHours   : 0;
  const xcNightPic  = isXC && role === 'pic' ? nightHours : 0;
  const xcDayCop    = isXC && role === 'cop' ? dayHours   : 0;
  const xcNightCop  = isXC && role === 'cop' ? nightHours : 0;

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
  const selfFullName  = `${profileForNav.fname || 'Martin'} ${profileForNav.lname || 'Daoust'}`.trim();
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
    // dtstart_utc = full ISO timestamp (source of truth for all time math)
    dtstart_utc: blockOffUTC ? blockOffUTC.toISOString() : '',
    std_utc: stdMatch ? stdMatch[1] : '',
    sta_utc: staMatch ? staMatch[1] : '',
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
    ldgDay, ldgNight,
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
  input.value = url;
  showToast(t('toast.urlSaved'), 'success');
  updateNavblueStatus();
}

function clearNavblueUrl() {
  if (!confirm(t('confirm.removeNavblue'))) return;
  localStorage.removeItem(NAVBLUE_URL_KEY);
  localStorage.removeItem(NAVBLUE_LAST_SYNC_KEY);
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
  if (!url) { status.textContent = 'NOT CONFIGURED'; return; }
  if (!last) { status.textContent = 'NEVER SYNCED'; return; }
  const minutes = Math.floor((Date.now() - +last) / 60000);
  if (minutes < 1) status.textContent = 'JUST SYNCED';
  else if (minutes < 60) status.textContent = `${minutes}M AGO`;
  else if (minutes < 1440) status.textContent = `${Math.floor(minutes/60)}H AGO`;
  else status.textContent = `${Math.floor(minutes/1440)}D AGO`;
}

async function syncNavblueNow() {
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  if (!url) { showToast(t('toast.saveUrlFirst'), 'error'); return; }

  const btn = document.getElementById('syncNowBtn');
  const details = document.getElementById('navblueDetails');
  btn.disabled = true;
  btn.textContent = '⏳ Syncing...';

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

    // Diagnostic dump: stash the first three DESCRIPTION strings + a SUMMARY
    // sample so Martin can inspect via the "Navblue iCal diagnostic" button
    // in Settings — no dev-console required. Useful when the regex doesn't
    // pick up crew names from a new airline's tenant.
    try {
      const dump = {
        ts: Date.now(),
        totalEvents: events.length,
        samples: events.slice(0, 3).map(e => ({
          summary: (e.SUMMARY || '').substring(0, 200),
          description: (e.DESCRIPTION || '').substring(0, 1200)
        }))
      };
      localStorage.setItem('cumulo_navblue_debug_v1', JSON.stringify(dump));
    } catch (e) { /* non-fatal */ }

    const syncProfile = DB.loadProfile();
    const isFO = (syncProfile.role || '').toLowerCase().includes('officer')
              || (syncProfile.role || '').toLowerCase().includes('fo')
              || true;  // default Martin = F/O
    // Per-profile toggle: when set, fresh imported flights default to 1 IFR approach.
    // Falls back to 705-airline inference for profiles saved before the field existed.
    const autoCountIFR = (syncProfile.autoCountIFR !== undefined)
      ? !!syncProfile.autoCountIFR
      : isAirline705(syncProfile.airline);

    const today = new Date().toISOString().split('T')[0];
    const mapped = events
      .map(ev => navblueEventToFlight(ev, isFO, autoCountIFR))
      .filter(f => f && f.date && f.date < today);

    console.log(`[Navblue Sync] ${mapped.length} flights eligible for import (date < today, block > 0)`);

    // SNAPSHOT before any modification — pilot data is precious
    snapshotBeforeOperation('Navblue iCal sync');
    updateUndoButton();

    // Smart matching :
    //   1. Try exact match (date + flightNum + route)
    //   2. Fall back to fuzzy match (date + route + block within 0.15h)
    //   3. Fall back to date+block match (PDF imports may have no flightNum/route)
    // Goal: NEVER duplicate a flight that already exists, even when imported via PDF.
    const fresh = [];
    let mergedCount = 0;
    // Added 2026-05-14: pic / copilot / crewPosition are now eligible for merge
    // because the iCal extractor pulls them. The if-empty guard below still
    // protects any value the user typed manually — we only fill blanks.
    const mergeFields = ['dtstart_utc','std_utc','sta_utc','co_utc','ci_utc',
                         'dep_icao','arr_icao','reg','type','flightNum','multiCrew',
                         'pic','copilot','crewPosition'];
    mapped.forEach(f => {
      const match = findMatchingExistingFlight(f);
      if (!match) {
        fresh.push(f);
        return;
      }
      // Existing flight matched — enrich missing fields without overwriting user data.
      // Never overwrite: pic (capitaine), total, block (user may have corrected)
      const e = flights[match.idx];
      let changed = false;
      const merged = { ...e };
      mergeFields.forEach(k => {
        if ((merged[k] === undefined || merged[k] === '' || merged[k] === 0 || merged[k] === null) && f[k] !== undefined && f[k] !== '' && f[k] !== 0) {
          merged[k] = f[k];
          changed = true;
        }
      });
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

    // Persist any merged changes (so the recalc below sees them)
    if (mergedCount > 0) DB.save(flights);

    // Auto-recalc night/XC for the now-enriched existing flights
    let recalcStats = { updated: 0, skippedNoUTC: 0, skippedNoCoords: 0, skippedNoBlock: 0 };
    if (mergedCount > 0 || fresh.length === 0) {
      recalcStats = recalculateAllFlightsInternal();
      DB.save(flights);
    }

    localStorage.setItem(NAVBLUE_LAST_SYNC_KEY, Date.now().toString());

    details.style.display = 'block';
    const detailLines = [
      `Calendar: <strong>${events.length}</strong> events · <strong>${mapped.length}</strong> completed flights`
    ];
    if (mergedCount > 0) detailLines.push(`<strong>${mergedCount}</strong> existing flight${mergedCount !== 1 ? 's' : ''} enriched with UTC times + coords`);
    if (recalcStats.updated > 0) detailLines.push(`<strong>${recalcStats.updated}</strong> flight${recalcStats.updated !== 1 ? 's' : ''} got Night/XC recalculated`);
    if (fresh.length > 0) detailLines.push(`<strong>${fresh.length}</strong> new flight${fresh.length !== 1 ? 's' : ''} ready to review`);
    if (fresh.length === 0 && mergedCount === 0) detailLines.push('Logbook is up to date.');
    details.innerHTML = detailLines.join('<br>');

    updateNavblueStatus();
    renderDashboard();

    if (fresh.length > 0) {
      showImportPreview(fresh, `${fresh.length} new Navblue flight${fresh.length !== 1 ? 's' : ''} found — select what to import`);
      showToast(t('toast.syncFreshEnriched', { fresh: fresh.length, merged: mergedCount }));
    } else if (mergedCount > 0) {
      showToast(t('toast.syncEnrichedRecalc', { merged: mergedCount, updated: recalcStats.updated }), 'success');
    } else {
      showToast(t('toast.alreadyUpToDate'));
    }

  } catch(e) {
    console.error('[Navblue Sync] Error:', e);
    details.style.display = 'block';
    details.innerHTML = `<span style="color:var(--danger);">Error: ${esc(e.message)}</span>`;
    showToast(e.message || 'Sync failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Sync now';
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
    showToast('No diagnostic data yet — run a Navblue sync first, then click Diagnostic again.', 'error');
    return;
  }
  let dump;
  try { dump = JSON.parse(raw); }
  catch { showToast('Diagnostic data corrupted — run a fresh sync.', 'error'); return; }

  const ageMin = Math.round((Date.now() - dump.ts) / 60000);
  const samplesHtml = (dump.samples || []).map((s, i) => `
    <div style="margin-bottom:var(--s-4);">
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted); margin-bottom:6px;">— Sample ${i + 1} —</div>
      <div style="font-family:var(--font-mono); font-size:11px;"><strong>SUMMARY:</strong> ${esc(s.summary || '(empty)')}</div>
      <div style="margin-top:6px;"><strong style="font-family:var(--font-mono); font-size:11px;">DESCRIPTION:</strong></div>
      <pre style="background:var(--bg-subtle); padding:var(--s-3); border-radius:var(--r-sm); font-family:var(--font-mono); font-size:11px; white-space:pre-wrap; word-break:break-word; margin-top:4px; max-height:240px; overflow:auto;">${esc(s.description || '(empty)')}</pre>
    </div>
  `).join('');

  const copyPayload = JSON.stringify(dump, null, 2);
  const overlay = document.getElementById('importPreview');
  if (!overlay) {
    // Fallback: dump to console + alert
    console.log('[Navblue diagnostic]', dump);
    alert('Diagnostic data printed to console. Press Ctrl+Shift+J to view.');
    return;
  }
  document.getElementById('importSubtitle').textContent =
    `Navblue iCal diagnostic · synced ${ageMin} min ago · ${dump.totalEvents || 0} events`;
  document.getElementById('extractedList').innerHTML = `
    <p style="font-size:13px; color:var(--text-secondary); line-height:1.55; margin-bottom:var(--s-3);">
      Below are the first ${dump.samples ? dump.samples.length : 0} flight entries Porter's Navblue iCal sent us, raw.
      If you see captain names in the DESCRIPTION blocks but they aren't showing up in your Logbook PIC column,
      paste this whole block in chat with Claude and the extraction regex will be tuned to match Porter's format.
    </p>
    ${samplesHtml}
    <details style="margin-top:var(--s-3);">
      <summary style="cursor:pointer; font-size:12px; color:var(--text-secondary);">Full JSON (advanced)</summary>
      <pre style="background:var(--bg-subtle); padding:var(--s-3); border-radius:var(--r-sm); font-family:var(--font-mono); font-size:10px; white-space:pre-wrap; word-break:break-word; max-height:300px; overflow:auto;">${esc(copyPayload)}</pre>
    </details>
  `;
  const confirmBtn = document.getElementById('importConfirmBtn');
  confirmBtn.textContent = '📋 Copy all';
  confirmBtn.disabled = false;
  confirmBtn.onclick = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copyPayload).then(
        () => showToast('Diagnostic data copied to clipboard — paste it in chat.', 'success'),
        () => showToast('Copy failed — select the JSON block and copy manually.', 'error')
      );
    } else {
      showToast('Clipboard not available — select the JSON block manually.', 'error');
    }
  };
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

