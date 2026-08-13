// ═══════════════════════════════════════════════════════════════════
// REGISTRATION BACKFILL FROM THE ROSTER FEED (08-flight-form.js)
//
// Martin 2026-08-12: "on parle de quelque chose qui est requis dans le logbook
// et la je dois passer des heures a le taper a la main ? non non non ...
// refouille dans les flux navblue". CAR 401.08(2)(b) puts "the type of aircraft
// and its registration mark" in the mandatory content of every entry (raw text
// verified 2026-08-12 — see docs/REGISTRE-REGLEMENTAIRE.md), so a blank is not
// cosmetic and hand-typing hundreds of them is not an answer.
//
// The feed prints the tail on the Aircraft line only ONCE THE AIRCRAFT IS
// ASSIGNED ("Aircraft: 295 - 295XX - 295XX - C-GZQW"); a leg imported from the
// published schedule carries a bare "Aircraft: 295". The ordinary sync fills
// blanks on a later pass, but only for events it accepts as flights — it
// rejects anything without block hours or completion proof. Those gates stop
// unproven legs being LOGGED; they must not stop a registration reaching a
// flight the pilot already has.
//
// These drive the two pure helpers, so no network and no DOM are involved.
//
// Run:  node test/reg-backfill.mjs   (also part of `npm test`)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dom = new JSDOM(readFileSync(join(root, 'logbook.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'https://logbook-cxy.pages.dev/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    const c = function () { return { destroy() {}, update() {}, resize() {} }; }; c.register = () => {}; w.Chart = c;
    if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
  },
});
const w = dom.window;
const failures = [];
const chk = (label, cond) => { if (!cond) failures.push(label); };

chk('the backfill helpers exist (fails on pre-fix code)',
  w.eval("typeof rosterRegistrationsFromEvents === 'function' && typeof applyRosterRegistrations === 'function'"));

// Real Navblue shapes, including the two the feed actually alternates between.
const EVENTS = JSON.stringify([
  { SUMMARY: 'PD325 YOW-YLW', DTSTART: '20260801T120000Z',
    DESCRIPTION: 'PD325 YOW - YLW\nCI 1200Z / 0800L\nSTD 1300Z / 0900L\nDuration: 06:00, BLH: 05:00\nAircraft: 295 - 295XX - 295XX - C-GZQW\n' },
  // Check-in the civil day BEFORE the departure: the feed dates by check-in.
  { SUMMARY: 'PD326 YLW-YOW', DTSTART: '20260802T230000Z',
    DESCRIPTION: 'PD326 YLW - YOW\nCI 2300Z\nSTD 0020Z\nDuration: 05:00, BLH: 04:30\nAircraft: 295 - 295XX - 295XX - C-GKQA\n' },
  // Published before the aircraft was assigned: fleet code only, no tail.
  { SUMMARY: 'PD400 YOW-YYZ', DTSTART: '20260803T120000Z',
    DESCRIPTION: 'PD400 YOW - YYZ\nSTD 1300Z\nDuration: 02:00, BLH: 01:00\nAircraft: 295\n' },
  // Same leg reported under two different tails (swap): must never be guessed.
  { SUMMARY: 'PD500 YOW-YUL', DTSTART: '20260804T120000Z',
    DESCRIPTION: 'PD500 YOW - YUL\nDuration: 01:30, BLH: 01:00\nAircraft: 295 - C-GZQC\n' },
  { SUMMARY: 'PD500 YOW-YUL', DTSTART: '20260804T190000Z',
    DESCRIPTION: 'PD500 YOW - YUL\nDuration: 01:30, BLH: 01:00\nAircraft: 295 - C-GKYN\n' },
]);

const out = JSON.parse(w.eval(`(function(){
  const idx = rosterRegistrationsFromEvents(${EVENTS});
  const list = [
    { id:'a', date:'2026-08-01', flightNum:'PD325', route:'YOW-YLW', reg:'' },
    { id:'b', date:'2026-08-03', flightNum:'PD326', route:'YLW-YOW', reg:'' },
    { id:'c', date:'2026-08-03', flightNum:'PD400', route:'YOW-YYZ', reg:'' },
    { id:'d', date:'2026-08-04', flightNum:'PD500', route:'YOW-YUL', reg:'' },
    { id:'e', date:'2026-08-01', flightNum:'PD325', route:'YOW-YLW', reg:'C-XXXX' },
    { id:'f', date:'2026-01-05', flightNum:'PD325', route:'YOW-YLW', reg:'' },
    { id:'g', date:'2026-08-01', flightNum:'PD325', route:'YOW-YLW' }
  ];
  const res = applyRosterRegistrations(list, idx);
  return JSON.stringify({ idx: { from: idx.from, to: idx.to }, res: res,
    regs: list.map(f => f.id + '=' + (f.reg === undefined ? '(undef)' : (f.reg || '(blank)'))) });
})()`));

const reg = id => (out.regs.find(r => r.indexOf(id + '=') === 0) || '').split('=')[1];

// What the feed answers
chk('a tail on the Aircraft line reaches the flight', reg('a') === 'C-GZQW');
chk('a leg whose check-in falls the day before still matches', reg('b') === 'C-GKQA');
chk('the feed date span is reported', out.idx.from === '2026-08-01' && out.idx.to === '2026-08-04');

// What it must NOT do — this is a certifiable field
chk('a leg the feed publishes with no tail stays blank, never guessed', reg('c') === '(blank)');
chk('two different tails for one leg is refused, not picked', reg('d') === '(blank)');
chk('the ambiguous leg is counted as such', out.res.ambiguous === 1);
chk('a registration the pilot already has is never overwritten', reg('e') === 'C-XXXX');
chk('a flight seven months outside the feed is untouched', reg('f') === '(blank)');
chk('an undefined registration is filled like an empty one', reg('g') === 'C-GZQW');
chk('the count matches what was actually written', out.res.filled === 3);
chk('what could not be answered is reported, not hidden', out.res.stillMissing === 3);

// The button that runs it, and the report the pilot reads
const body = readFileSync(join(root, 'src/body.html'), 'utf8');
chk('the pilot has a control for it', body.indexOf('backfillRegistrationsFromRoster()') !== -1);
const i18n = readFileSync(join(root, 'src/js/17-i18n.js'), 'utf8');
['sync.navblue.backfillBtn', 'sync.backfill.report', 'toast.backfillFilled', 'toast.backfillNone']
  .forEach(k => chk(`both languages carry ${k}`, (i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "'", 'g')) || []).length === 2));

// ── Second source: the monthly roster PDF ───────────────────────────────────
// Martin's feed publishes a rolling window only (2026-08-13: 2026-07-14 to
// 2026-08-28), so all 52 of his blanks are older than anything the feed still
// carries. The roster PDF is the one document he still holds for those months.
// The tail is read from the SAME row window as the crew names, and only when
// that window names exactly one aircraft.
{
  const rosterSrc = readFileSync(join(root, 'src/js/10-pdf-roster.js'), 'utf8');
  chk('the roster parser reads the tail from the flight own line first',
    rosterSrc.indexOf('regsOnLine') !== -1 && rosterSrc.indexOf('regsOnLine.length === 1') !== -1);
  chk('a continuation line stops at the next flight number',
    rosterSrc.indexOf('flightNumTest.test(lines[k])) break;') !== -1);
  chk('a continuation naming more than one aircraft is refused',
    rosterSrc.indexOf('belowRegs.length === 1') !== -1);
  chk('the roster import fills an empty registration',
    rosterSrc.indexOf('merged.reg = item.reg;') !== -1);
  chk('it never overwrites one the pilot has',
    rosterSrc.indexOf("if (item.reg && (!existing.reg || !String(existing.reg).trim()))") !== -1);
  chk('a registration-only import still persists', rosterSrc.indexOf('|| regAdded > 0') !== -1);
  const parse = w.eval(`(function(){
    const txt = [
      '2026-05-02  PD325  YOW-YLW  FO  BOUCHARD, J  12:05 17:30 05:00 05:00  C-GZQW',
      '',
      '2026-05-03  PD326  YLW-YOW  FO  TREMBLAY, L  01:10 06:20 04:30 04:30  C-GKQA',
      '',
      '2026-05-04  PD400  YOW-YYZ  FO  GAGNON, M  13:00 14:00 01:00 01:00'
    ].join('\\n');
    const legs = parseNavblueRosterText(txt);
    return JSON.stringify(legs.map(l => l.flightNum + '=' + (l.reg || '(blank)')));
  })()`);
  const legs = JSON.parse(parse);
  chk('a roster row carries its tail into the leg', legs.indexOf('PD325=C-GZQW') !== -1);
  chk('each row keeps its own tail, not its neighbour\'s', legs.indexOf('PD326=C-GKQA') !== -1);
  chk('a row with no tail stays blank', legs.indexOf('PD400=(blank)') !== -1);
  // A tail printed on the line BELOW its own row (pdf.js splits visual rows)
  // is accepted only while nothing else could claim it.
  const split = JSON.parse(w.eval(`(function(){
    const txt = ['2026-06-01  PD700  YOW-YHZ  FO  LAVOIE, P  10:00 12:00 02:00 02:00',
                 '            C-GKYN',
                 '2026-06-02  PD701  YHZ-YOW  FO  ROY, S  13:00 15:00 02:00 02:00',
                 '            C-GZQC   C-GKQZ'].join('\\n');
    return JSON.stringify(parseNavblueRosterText(txt).map(l => l.flightNum + '=' + (l.reg || '(blank)')));
  })()`));
  chk('a tail on the continuation line reaches its own leg', split.indexOf('PD700=C-GKYN') !== -1);
  chk('a continuation naming two aircraft is refused', split.indexOf('PD701=(blank)') !== -1);
}

// ── The real Porter roster row ──────────────────────────────────────────────
// Martin dropped his monthly roster on 2026-08-13 and got "Flight legs
// extracted from PDF: 1". A Navblue HrRosterReport dates each row by DAY OF
// MONTH plus a weekday ("01 Fri"), the shape written in this file's own row
// sample since 2026-05-14 — and extractDate() never handled it, so nearly every
// leg was dropped before crew, times or registration could be read.
{
  const ROSTER = [
    'HrRosterReport   Crew: DAOUST M   TimeMode Local time',
    'Period 01May26 - 31May26',
    'Date Des. Code Req LE CI Dep STD Arr STA CO AC WA Func Rank ATD ATA BLH Credit Pairing',
    '01 Fri        PD448         1055 YYJ 1155 YOW 1933 2002 295   C-GZQW   FO   12:07 19:47 04:40 04:40 O3049',
    '02 Sat        PD325         0800 YOW 0900 YLW 1400 1430 295   C-GKQA   FO   08:05 14:02 05:00 05:00 O3050',
    '31 Sun        PD500         1300 YOW 1400 YUL 1500 1530 295   C-GKYN   FO   13:02 15:01 01:30 01:30 O3060',
  ].join('\n');
  const legs = JSON.parse(w.eval(`JSON.stringify(parseNavblueRosterText(${JSON.stringify(ROSTER)}))`));
  chk('every row of a real roster month is read, not just one', legs.length === 3);
  chk('the day column is resolved against the roster period',
    legs[0] && legs[0].date === '2026-05-01' && legs[2] && legs[2].date === '2026-05-31');
  chk('the registration on the row reaches the leg', legs[0] && legs[0].reg === 'C-GZQW');
  chk('the route survives the "Dep STD Arr STA" layout', legs[0] && legs[0].route === 'YYJ-YOW');
  chk('the actual times are still read', legs[0] && legs[0].atd_utc === '1207' && legs[0].ata_utc === '1947');

  // A period must READ like a period. A lone print date must never date a
  // month of flying — that would be a wrong date on every certifiable entry.
  chk('a period spanning two months maps the days to the right one', (() => {
    const p = JSON.parse(w.eval("JSON.stringify(rosterPeriodContext('Period 28Jun26 - 04Jul26'))"));
    const d1 = w.eval("rosterRowDate('28 Sun  PD1', " + JSON.stringify(p) + ")");
    const d2 = w.eval("rosterRowDate('02 Thu  PD2', " + JSON.stringify(p) + ")");
    return d1 === '2026-06-28' && d2 === '2026-07-02';
  })());
  chk('a lone print date is not treated as a period',
    w.eval("JSON.stringify(rosterPeriodContext('Printed 13Aug26  Crew DAOUST'))") === 'null');
  chk('a date outside the stated period is refused', (() => {
    const p = JSON.parse(w.eval("JSON.stringify(rosterPeriodContext('Period 01May26 - 15May26'))"));
    return w.eval("rosterRowDate('20 Wed  PD9', " + JSON.stringify(p) + ")") === '';
  })());
  chk('no period means no invented date',
    w.eval("rosterRowDate('01 Fri  PD448', null)") === '');

  // The diagnostic must show the LAYOUT and none of the content.
  const rep = JSON.parse(w.eval(`JSON.stringify(rosterParseReport(${JSON.stringify(ROSTER)}))`));
  chk('the diagnostic counts what matters',
    rep.withNum === 3 && rep.withDayCol === 3 && rep.withReg === 3);
  chk('the diagnostic reports the period it read', rep.period === '2026-05-01 -> 2026-05-31');
  const shapes = rep.header.concat(rep.samples).join(' ');
  chk('the masked shapes keep the layout', shapes.indexOf('99 AAA') !== -1);
  chk('the masked shapes leak no crew name', shapes.indexOf('DAOUST') === -1);
  chk('the masked shapes leak no flight number', shapes.indexOf('PD448') === -1 && shapes.indexOf('448') === -1);
  chk('the masked shapes leak no registration', shapes.indexOf('GZQW') === -1);
  chk('the roster text is never persisted',
    readFileSync(join(root, 'src/js/10-pdf-roster.js'), 'utf8').indexOf("setItem('cumulo_roster_text") === -1);
}

// Nothing in this app may send a pilot to a browser console.
['toast.noCaptainsAdded'].forEach(k => {
  const line = (readFileSync(join(root, 'src/js/17-i18n.js'), 'utf8').match(new RegExp("'" + k + "':[^\\n]*", 'g')) || []).join(' ');
  chk(`${k} does not send anyone to a console`, !/console/i.test(line));
});

// The citation this feature rests on. 401.08(2)(b) is the registration mark;
// (2)(h) is the launch method of a GLIDER and was quoted by mistake for years.
const reg08 = readFileSync(join(root, 'docs/REGISTRE-REGLEMENTAIRE.md'), 'utf8');
chk('the register carries the verified 401.08(2) text',
  reg08.indexOf('registration mark') !== -1 && reg08.indexOf('401.08(2)') !== -1);
['src/js/12-pdf-export.js', 'src/js/20-opening-balances.js', 'src/js/21-dash-drilldown.js'].forEach(p => {
  chk(`no glider-launch citation left in ${p}`,
    readFileSync(join(root, p), 'utf8').indexOf('401.08(2)(h)') === -1);
});

if (failures.length) {
  console.error('reg-backfill: FAIL\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('reg-backfill: all assertions passed (feed tails filled, blanks never guessed, ambiguity refused, pilot values untouched)');
process.exit(0);
