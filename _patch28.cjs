const fs = require('fs');
function patch(file, find, repl, label) {
  let s = fs.readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  const F = crlf ? find.replace(/\n/g, '\r\n') : find;
  const R = crlf ? repl.replace(/\n/g, '\r\n') : repl;
  if (!s.includes(F)) { console.error('ANCHOR MISS ' + label); process.exit(1); }
  const b = s; s = s.split(F).join(R);
  if (s === b) { console.error('NO-OP ' + label); process.exit(1); }
  fs.writeFileSync(file, s);
  console.log('ok ' + label);
}

// ── Day VFR band out of the FDP calculator: a 705 multi-crew E195 F/O can
//    never use 700.28(9), and offering it invited a wrong (larger) maximum.
//    The register keeps the (9) citation; only the UI band goes.
patch('src/body.html',
  ' <button type="button" data-dur="vfr" aria-pressed="false" data-i18n="fdp.dur.vfr">Day VFR</button>\n',
  '',
  'vfr button');
patch('src/js/27-fdp-calc.js',
  "function _fdpColIndex(band, flights) {\n  if (band === 'vfr') return 0;                     // 700.28(9) single column = column-2 values\n  const th = FDP_COLS[band]; return flights <= th[0] ? 0 : (flights <= th[1] ? 1 : 2);\n}",
  "function _fdpColIndex(band, flights) {\n  // The day-VFR band (700.28(9)) was removed from the UI 2026-08-02: a 705\n  // multi-crew F/O can never use it, and offering it invited a wrong maximum.\n  const th = FDP_COLS[band] || FDP_COLS.ge50;\n  return flights <= th[0] ? 0 : (flights <= th[1] ? 1 : 2);\n}",
  'vfr colIndex');
patch('src/js/27-fdp-calc.js',
  "function _fdpBandLabel(band, fr) {\n  if (band === 'vfr') return fr ? 'VFR de jour' : 'day VFR';\n  if (band === 'lt30')",
  "function _fdpBandLabel(band, fr) {\n  if (band === 'lt30')",
  'vfr band label');
patch('src/js/27-fdp-calc.js',
  "  const parts = [rowPart];\n  if (band !== 'vfr') parts.push(_fdpColRange(band, col, fr));\n  parts.push(_fdpBandLabel(band, fr));",
  "  const parts = [rowPart];\n  parts.push(_fdpColRange(band, col, fr));\n  parts.push(_fdpBandLabel(band, fr));",
  'vfr breakdown');
patch('src/js/27-fdp-calc.js',
  "  const single = band === 'vfr';\n  const cols = single ? [0] : [0, 1, 2];\n  const heads = single\n    ? [fr ? 'VFR de jour' : 'Day VFR']\n    : cols.map(c => _fdpColRange(band, c, fr));\n  const activeCol = single ? 0 : col;",
  "  const cols = [0, 1, 2];\n  const heads = cols.map(c => _fdpColRange(band, c, fr));\n  const activeCol = col;",
  'vfr ref cols');
patch('src/js/27-fdp-calc.js',
  "    const durTxt = band === 'vfr' ? (fr ? 'VFR de jour' : 'day VFR')\n      : band === 'lt30' ? '< 30 min'",
  "    const durTxt = band === 'lt30' ? '< 30 min'",
  'vfr ref durTxt');
patch('src/js/27-fdp-calc.js',
  "    const yourBand = single\n      ? (fr ? 'Ta bande : présentation à ' + _fdpClock(acclimMin) + '.' : 'Your row: report at ' + _fdpClock(acclimMin) + '.')\n      : (fr ? 'Ta bande : présentation à ' + _fdpClock(acclimMin) + ', ' + _fdpColRange(band, col, fr) + '.'\n            : 'Your row: report at ' + _fdpClock(acclimMin) + ', ' + _fdpColRange(band, col, fr) + '.');",
  "    const yourBand = fr\n      ? 'Ta bande : présentation à ' + _fdpClock(acclimMin) + ', ' + _fdpColRange(band, col, fr) + '.'\n      : 'Your row: report at ' + _fdpClock(acclimMin) + ', ' + _fdpColRange(band, col, fr) + '.';",
  'vfr ref note');

// ── Licence tracker: only the target he is progressing toward.
patch('src/js/23-licence-tracker.js',
  "const LICENCE_TARGETS = [",
  "// Trimmed to the ATPL on 2026-08-02 (Martin's go on the audit suggestions):\n// PPL, CPL, night and IFR are licences and ratings he already holds, and a\n// page of green Met bars for them was decoration. The register keeps every\n// verified figure should another target ever matter again.\nconst LICENCE_TARGETS = [",
  'licence intro');

console.log('done');
