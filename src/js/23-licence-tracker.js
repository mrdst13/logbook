// ═══════════════════════════════════════════
//  LICENCE PROGRESSION TRACKER (page-licence)
//  Career progress vs Transport Canada issuance minimums (CAR 421 standards).
//  Every requirement number is verified against laws-lois / Standard 421 and
//  consigned to docs/REGISTRE-REGLEMENTAIRE.md (2026-06-30). Any requirement
//  Cumulo cannot compute from logged data (e.g. "solo" time — the app has no
//  solo field) is shown as "not tracked", NEVER estimated. Regulatory
//  citations appear only on this page, never on the main dashboard.
// ═══════════════════════════════════════════

let _licenceTarget = 'atpl';

// Career totals for the categories the tracker needs. Base aggregates come
// from calcStats() + brought-forward via totalsWithOpening(); the finer
// buckets (XC-PIC, XC-night-PIC, instrument) are derived by summing the raw
// flight fields, then adding the attested opening balances (which use the
// same field names as a flight).
function _licenceTotals() {
  const merged = (typeof totalsWithOpening === 'function' && typeof calcStats === 'function')
    ? totalsWithOpening(calcStats())
    : (typeof calcStats === 'function' ? calcStats() : {});
  const bal = (typeof loadOpeningBalances === 'function') ? (loadOpeningBalances().balances || {}) : {};
  let xcPic = 0, xcNightPic = 0, instrument = 0;
  (Array.isArray(flights) ? flights : []).forEach(function (f) {
    xcPic      += (+f.xcDayPic || 0) + (+f.xcNightPic || 0);
    xcNightPic += (+f.xcNightPic || 0);
    instrument += (+f.instActual || 0) + (+f.instHood || 0) + (+f.instSim || 0);
  });
  xcPic      += (+bal.xcDayPic || 0) + (+bal.xcNightPic || 0);
  xcNightPic += (+bal.xcNightPic || 0);
  instrument += (+bal.instActual || 0) + (+bal.instHood || 0) + (+bal.instSim || 0);
  return {
    total: +merged.total || +merged.block || 0,
    pic: +merged.pic || 0,
    night: +merged.night || 0,
    dualRcvd: +merged.dualRcvd || 0,
    xcPic: xcPic, xcNightPic: xcNightPic, instrument: instrument
  };
}

// Requirement sets. `key` maps to a computed total; `key: null` = a real TC
// requirement Cumulo does not track (shown, never filled with a fake number).
const LICENCE_TARGETS = [
  { id: 'ppl', label: { fr: 'PPL', en: 'PPL' }, title: { fr: 'Licence de pilote privé — avion', en: 'Private Pilot Licence — Aeroplane' }, cite: 'Norme 421.26(4)', reqs: [
    { label: { fr: 'Temps de vol total', en: 'Total flight time' }, need: 45, key: 'total' },
    { label: { fr: 'Instruction reçue (double)', en: 'Dual instruction received' }, need: 17, key: 'dualRcvd' },
    { label: { fr: 'En solo', en: 'Solo' }, need: 12, key: null },
    { label: { fr: 'Vol-voyage en solo', en: 'Solo cross-country' }, sub: { fr: 'vol ≥ 150 NM', en: 'flight ≥ 150 NM' }, need: 5, key: null },
    { label: { fr: 'Temps aux instruments', en: 'Instrument time' }, need: 5, key: 'instrument' }
  ] },
  { id: 'cpl', label: { fr: 'CPL', en: 'CPL' }, title: { fr: 'Licence de pilote professionnel — avion', en: 'Commercial Pilot Licence — Aeroplane' }, cite: 'Norme 421.30(4)', reqs: [
    { label: { fr: 'Temps de vol total', en: 'Total flight time' }, need: 200, key: 'total' },
    { label: { fr: 'Commandant de bord (PIC)', en: 'Pilot-in-command (PIC)' }, need: 100, key: 'pic' },
    { label: { fr: 'Vol-voyage en PIC', en: 'PIC cross-country' }, need: 20, key: 'xcPic' }
  ] },
  { id: 'ifr', label: { fr: 'Qualif. IFR', en: 'IFR rating' }, title: { fr: 'Qualification de vol aux instruments (groupe 1)', en: 'Instrument rating (Group 1)' }, cite: 'Norme 421.46(2)', reqs: [
    { label: { fr: 'Vol-voyage en PIC', en: 'PIC cross-country' }, need: 50, key: 'xcPic' },
    { label: { fr: 'Temps aux instruments', en: 'Instrument time' }, sub: { fr: 'max 20 h au sol', en: 'max 20 h ground' }, need: 40, key: 'instrument' }
  ] },
  { id: 'night', label: { fr: 'Qualif. nuit', en: 'Night rating' }, title: { fr: 'Qualification de vol de nuit — avion', en: 'Night rating — Aeroplane' }, cite: 'CAR 401.42 / Norme 421.42', reqs: [
    { label: { fr: 'Temps de vol total', en: 'Total flight time' }, need: 20, key: 'total' },
    { label: { fr: 'Temps de nuit', en: 'Night time' }, need: 10, key: 'night' },
    { label: { fr: 'Instruments en double', en: 'Dual instrument time' }, need: 10, key: null }
  ] },
  { id: 'atpl', label: { fr: 'ATPL', en: 'ATPL' }, title: { fr: 'Licence de pilote de ligne — avion', en: 'Airline Transport Pilot Licence — Aeroplane' }, cite: 'CAR 421.34(4)', reqs: [
    { label: { fr: 'Temps de vol total', en: 'Total flight time' }, need: 1500, key: 'total' },
    { label: { fr: 'Commandant de bord (PIC)', en: 'Pilot-in-command (PIC)' }, need: 250, key: 'pic' },
    { label: { fr: 'Vol-voyage en PIC', en: 'PIC cross-country' }, need: 100, key: 'xcPic' },
    { label: { fr: 'Vol-voyage de nuit en PIC', en: 'Night PIC cross-country' }, need: 25, key: 'xcNightPic' },
    { label: { fr: 'Temps de nuit', en: 'Night time' }, need: 100, key: 'night' },
    { label: { fr: 'Temps aux instruments', en: 'Instrument time' }, sub: { fr: 'max 25 h sim', en: 'max 25 h sim' }, need: 75, key: 'instrument' }
  ] }
];

function setLicenceTarget(id) {
  _licenceTarget = id;
  renderLicenceTracker();
}

function renderLicenceTracker() {
  const host = document.getElementById('licenceTracker');
  if (!host) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const L = function (o) { return (o && typeof o === 'object') ? (fr ? o.fr : o.en) : o; };
  const totals = _licenceTotals();
  const cur = LICENCE_TARGETS.find(function (x) { return x.id === _licenceTarget; }) || LICENCE_TARGETS[0];
  const fh = function (n) { return (Math.round((+n || 0) * 10) / 10).toLocaleString(fr ? 'fr-CA' : 'en-CA'); };

  const pills = LICENCE_TARGETS.map(function (tg) {
    const tracked = tg.reqs.filter(function (r) { return r.key; });
    const allMet = tracked.length > 0 && tracked.every(function (r) { return (totals[r.key] || 0) >= r.need; });
    const on = tg.id === cur.id;
    return '<button type="button" class="lic-pill' + (on ? ' on' : '') + (allMet ? ' done' : '') +
      '" onclick="setLicenceTarget(\'' + tg.id + '\')">' + (allMet ? '<span aria-hidden="true">✓</span> ' : '') + esc(L(tg.label)) + '</button>';
  }).join('');

  const primary = cur.reqs.find(function (r) { return r.key === 'total'; }) || cur.reqs.find(function (r) { return r.key; });
  let heroMeta = esc(cur.cite);
  if (primary && primary.key) {
    const have = totals[primary.key] || 0;
    const togo = Math.max(0, primary.need - have);
    heroMeta = fr
      ? esc(cur.cite) + ' · vous avez <b>' + fh(have) + ' h</b> sur ' + fh(primary.need) + ' h · <b>' + fh(togo) + ' h</b> à faire'
      : esc(cur.cite) + ' · you have <b>' + fh(have) + ' h</b> of ' + fh(primary.need) + ' h · <b>' + fh(togo) + ' h</b> to go';
  }

  const bars = cur.reqs.map(function (r) {
    const label = esc(L(r.label)) + (r.sub ? ' <span class="lic-sub">' + esc(L(r.sub)) + '</span>' : '');
    if (!r.key) {
      return '<div class="lic-req lic-untracked"><div class="lic-top"><div class="lic-name">' + label +
        '</div><div class="lic-val">' + fh(r.need) + ' h</div></div><div class="lic-foot"><span class="lic-note">' +
        (fr ? 'Non suivi par Cumulo — voir vos relevés de formation' : 'Not tracked by Cumulo — see your training records') + '</span></div></div>';
    }
    const have = totals[r.key] || 0;
    const pct = Math.min(100, Math.round(have / r.need * 100));
    const met = have >= r.need;
    const togo = Math.max(0, r.need - have);
    const foot = met ? (fr ? 'Atteint' : 'Met') : (fr ? ('Il reste ' + fh(togo) + ' h') : (fh(togo) + ' h to go'));
    return '<div class="lic-req' + (met ? ' lic-met' : '') + '"><div class="lic-top"><div class="lic-name">' + label +
      '</div><div class="lic-val"><b>' + fh(have) + '</b> <span class="lic-of">/ ' + fh(r.need) + ' h</span></div></div>' +
      '<div class="lic-bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="lic-foot"><span class="lic-togo">' + foot + '</span><span class="lic-pct">' + pct + '%</span></div></div>';
  }).join('');

  const lede = fr
    ? 'Où vous en êtes par rapport aux exigences de Transport Canada pour votre prochaine licence ou qualification — alimenté par vos heures enregistrées.'
    : 'Where you stand against Transport Canada requirements for your next licence or rating — fed by your logged hours.';
  const endnote = fr
    ? 'Chaque barre se remplit à partir de vos vols et de vos heures reportées attestées. Les exigences que Cumulo ne peut pas calculer (ex. temps en solo) sont marquées « non suivi » — jamais estimées. Référez-vous à Transport Canada et à votre unité de formation pour l’admissibilité complète.'
    : 'Each bar fills from your flights and attested brought-forward hours. Requirements Cumulo cannot compute (e.g. solo time) are marked “not tracked” — never estimated. Refer to Transport Canada and your training unit for full eligibility.';

  host.innerHTML =
    '<p class="lic-lede">' + lede + '</p>' +
    '<div class="lic-targets" role="tablist">' + pills + '</div>' +
    '<div class="lic-hero"><div class="lic-hero-lbl">' + (fr ? 'Cible' : 'Target') + '</div>' +
    '<div class="lic-hero-tt">' + esc(L(cur.title)) + '</div><div class="lic-hero-meta">' + heroMeta + '</div></div>' +
    '<div class="lic-reqs">' + bars + '</div>' +
    '<p class="lic-endnote">' + endnote + '</p>';
}
