// ═══════════════════════════════════════════
//  FLIGHT-TIME LIMITS TRACKER (page-duty)
//  Rolling-window flight time vs the CAR 700.27 maximums (SOR/2018-269),
//  verified against laws-lois and consigned to docs/REGISTRE-REGLEMENTAIRE.md
//  (2026-06-30):
//     112 h / 28 days · 300 h / 90 days · 1000 h / 365 days
//     (8 h / 24 h applies to SINGLE-PILOT operations only)
//  Applies to commercial operations (Subpart 700). Simulator time is NOT flight
//  time and is excluded. The per-DAY ceiling for multi-crew is the flight duty
//  period (FDP) table, not a simple flight-time number — so the tracker shows
//  the three cumulative limits + a note pointing to the operator's program for
//  the daily FDP. Numbers are never fabricated (see registre).
// ═══════════════════════════════════════════

const DUTY_LIMITS = [
  { days: 28,  limit: 112,  fr: '28 jours',  en: '28 days' },
  { days: 90,  limit: 300,  fr: '90 jours',  en: '90 days' },
  { days: 365, limit: 1000, fr: '365 jours', en: '365 days' }
];

// Flight time (not sim) in the last N days, from logged flights.
function _dutyFlightTimeInDays(days) {
  if (!Array.isArray(flights)) return 0;
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - days);
  const cutStr = cutoff.toISOString().split('T')[0];
  return flights.reduce(function (sum, f) {
    if (f.isSim) return sum;                      // simulator time is not flight time
    if (!f.date || f.date < cutStr) return sum;
    return sum + (+f.total || +f.block || 0);
  }, 0);
}

function renderDutyTracker() {
  const host = document.getElementById('dutyTracker');
  if (!host) return;
  const fr = (typeof getLang === 'function') && getLang() === 'fr';
  const fh = function (n) { return (Math.round((+n || 0) * 10) / 10).toLocaleString(fr ? 'fr-CA' : 'en-CA'); };

  const bars = DUTY_LIMITS.map(function (lim) {
    const have = _dutyFlightTimeInDays(lim.days);
    const ratio = lim.limit > 0 ? have / lim.limit : 0;
    const pctW = Math.min(100, Math.round(ratio * 100));
    const cls = ratio >= 1 ? ' lic-over' : (ratio >= 0.75 ? ' lic-near' : '');
    const spanCls = ratio >= 1 ? 'danger' : (ratio >= 0.75 ? 'warn' : '');
    const remain = Math.max(0, lim.limit - have);
    const foot = ratio >= 1
      ? (fr ? 'Limite atteinte ou dépassée' : 'At or over the limit')
      : (fr ? ('Il reste ' + fh(remain) + ' h avant la limite') : (fh(remain) + ' h before the limit'));
    const name = (fr ? 'Temps de vol · ' + lim.fr : 'Flight time · ' + lim.en);
    return '<div class="lic-req' + cls + '"><div class="lic-top"><div class="lic-name">' + name +
      '</div><div class="lic-val"><b>' + fh(have) + '</b> <span class="lic-of">/ ' + fh(lim.limit) + ' h</span></div></div>' +
      '<div class="lic-bar"><span class="' + spanCls + '" style="width:' + pctW + '%"></span></div>' +
      '<div class="lic-foot"><span class="lic-togo">' + foot + '</span><span class="lic-pct">' + Math.round(ratio * 100) + '%</span></div></div>';
  }).join('');

  const lede = fr
    ? 'Votre temps de vol sur des fenêtres glissantes, comparé aux maximums de Transport Canada (RAC 700.27). Calculé à partir de vos vols enregistrés — le temps sur simulateur ne compte pas.'
    : 'Your flight time over rolling windows, against the Transport Canada maximums (CAR 700.27). Computed from your logged flights — simulator time does not count.';
  const dayNote = fr
    ? '<b>Limite quotidienne :</b> pour un équipage multi-pilote, il n’y a pas de limite simple de temps de vol par jour — le plafond quotidien est la <b>période de service de vol</b> (selon l’heure de présentation et le nombre de vols). Référez-vous au programme approuvé de votre exploitant. La limite de 8 h par 24 h ne s’applique qu’aux exploitations monopilote.'
    : '<b>Daily limit:</b> for a multi-crew flight crew there is no simple per-day flight-time limit — the daily ceiling is the <b>flight duty period</b> (based on report time and number of flights). Refer to your operator’s approved program. The 8 h / 24 h limit applies only to single-pilot operations.';
  const scope = fr
    ? 'S’applique aux exploitations commerciales (Subpartie 700). Source : RAC 700.27 (SOR/2018-269).'
    : 'Applies to commercial operations (Subpart 700). Source: CAR 700.27 (SOR/2018-269).';

  host.innerHTML =
    '<p class="lic-lede">' + lede + '</p>' +
    '<div class="lic-reqs" style="margin-top:18px">' + bars + '</div>' +
    '<div class="tc-note">' + dayNote + '</div>' +
    '<p class="lic-endnote">' + scope + '</p>';
}
