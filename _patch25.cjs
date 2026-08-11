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

// 1) The buckets carry the OT UNITS and RATE, not just the dollars.
patch('src/js/29-pay-stub.js',
  "    overtime: { amount: sum(amt('005'), amt('030')), ot10: amt('005'), draft: amt('030') },",
  "    overtime: { amount: sum(amt('005'), amt('030')), ot10: amt('005'), draft: amt('030'),\n      ot10Units: (by['005'] && by['005'].units != null) ? by['005'].units : null,\n      ot10Rate: (by['005'] && by['005'].rate != null) ? by['005'].rate : null,\n      draftUnits: (by['030'] && by['030'].units != null) ? by['030'].units : null },",
  'ot units in buckets');

// 2) The reference row becomes a REAL check — of what is verifiable without
//    inventing semi-monthly rules.
patch('src/js/28-pay.js',
  `  // 6. Flight pay + overtime — for reference only (semi-monthly rules to confirm).
  const baseCheck = {
    id: 'base', status: 'info',
    name: fr ? 'Base et temps supplémentaire' : 'Flight pay and overtime',
    desc: fr ? 'À titre indicatif : les règles semi-mensuelles restent à confirmer.' : 'For reference: the semi-monthly rules remain to be confirmed.',
    rows: [
      tr((fr ? 'Base et temps supp. (base)' : 'Flight pay and overtime (flight pay)') + '<span class="sub">' + (fr ? 'Règles semi-mensuelles à confirmer' : 'Semi-monthly rules to confirm') + '</span>',
        tdM(DASH) + tdN(baseAmt != null ? money(baseAmt) : DASH) + tdP(pill('info')), false),
      tr(fr ? 'Base et temps supp. (temps supp.)' : 'Flight pay and overtime (overtime)',
        tdM(DASH) + tdN(otAmt != null ? money(otAmt) : DASH) + tdP(pill('info')), false)
    ]
  };`,
  `  // 6. Flight pay + overtime — a REAL check now (Martin's go, 2026-08-02),
  // built only from what is verifiable without inventing semi-monthly rules:
  //
  //   a) CREDITED HOURS. The stub prints the hours it paid (regular units +
  //      overtime units); the schedule yields the period's credits
  //      (computeCredits: max(flight, duty/2, 4:00) per day — the FOAG rig
  //      already pinned by test/pay.mjs). Fewer hours PAID than flown is the
  //      error this page exists to catch and flags red. MORE hours paid than
  //      computed is NOT flagged: the monthly guarantee, credits from legs not
  //      in the logbook, and semi-monthly proration all legitimately land
  //      there, and none of them is a rule this app may guess at.
  //   b) OVERTIME PRICING. OT units × hourly rate × multiplier must equal the
  //      OT amount on the stub. The multiplier is 1.5, or 2.0 inside the
  //      summer LOA window (isSummerLOA — the 2.0x rule the tests have pinned
  //      since the FOAG extraction). Only compared when the rate itself is
  //      comparable (same gate as the rate check).
  const baseCheck = {
    id: 'base',
    name: fr ? 'Base et temps supplémentaire' : 'Flight pay and overtime',
    rows: []
  };
  {
    const paidStraightU = (bk.regular && bk.regular.units != null) ? +bk.regular.units : null;
    const paidOtU = (bk.overtime && bk.overtime.ot10Units != null) ? +bk.overtime.ot10Units : null;
    const paidHours = (paidStraightU == null && paidOtU == null) ? null : (+(paidStraightU || 0) + +(paidOtU || 0));
    const scopedLegs = (range && Array.isArray(allFls))
      ? allFls.filter(f => f.date && f.date >= range.start && f.date <= range.end) : [];
    const credits = scopedLegs.length ? computeCredits(scopedLegs) : null;
    const creditH = credits ? +credits.total || 0 : null;
    const problems = [];
    const notes = [];

    if (paidHours != null && creditH != null && scopedLegs.length) {
      if (paidHours + 1.0 < creditH) {
        problems.push(fr
          ? 'Ton horaire donne <strong>' + hL(creditH) + ' h</strong> de crédits pour la période, mais le talon n’en paie que <strong>' + hL(paidHours) + ' h</strong>.'
          : 'Your schedule gives <strong>' + hL(creditH) + ' h</strong> of credits for the period, but the stub pays only <strong>' + hL(paidHours) + ' h</strong>.');
      } else if (paidHours > creditH + 1.0) {
        notes.push(fr
          ? 'Le talon paie ' + hL(paidHours) + ' h contre ' + hL(creditH) + ' h calculées : la garantie mensuelle ou des vols pas encore au carnet expliquent normalement cet écart, il n’est pas signalé.'
          : 'The stub pays ' + hL(paidHours) + ' h against ' + hL(creditH) + ' h computed: the monthly guarantee or legs not yet in the logbook normally explain this direction, so it is not flagged.');
      }
    }

    if (paidOtU != null && paidOtU > 0 && bk.overtime.ot10 != null && st.rate && _rateComparable) {
      const otMult = (typeof isSummerLOA === 'function' && range && isSummerLOA(range.end)) ? 2.0 : 1.5;
      const expectedOt = paidOtU * st.rate * otMult;
      const tol = 0.02 + 1.0 * st.rate;
      if (Math.abs(expectedOt - bk.overtime.ot10) > tol) {
        problems.push(fr
          ? hL(paidOtU) + ' h de temps supplémentaire à ' + money(st.rate) + '/h × ' + otMult + ' devraient donner <strong>' + money(expectedOt) + '</strong> ; le talon montre <strong>' + money(bk.overtime.ot10) + '</strong>.'
          : hL(paidOtU) + ' h of overtime at ' + money(st.rate) + '/h × ' + otMult + ' should come to <strong>' + money(expectedOt) + '</strong>; the stub shows <strong>' + money(bk.overtime.ot10) + '</strong>.');
      }
    }

    if (paidHours == null) {
      baseCheck.status = 'info';
      baseCheck.desc = fr ? 'Heures payées non lues sur le talon.' : 'Paid hours not read from the stub.';
    } else if (!scopedLegs.length) {
      baseCheck.status = 'info';
      baseCheck.desc = fr ? 'Aucun vol enregistré dans cette période : rien à comparer.' : 'No logged flights in this period: nothing to compare against.';
    } else if (problems.length) {
      baseCheck.status = 'bad';
      baseCheck.desc = problems.join(' ');
    } else {
      baseCheck.status = 'ok';
      baseCheck.desc = (fr
        ? 'Heures payées et crédits concordent (' + hL(paidHours) + ' h payées, ' + hL(creditH) + ' h calculées).'
        : 'Paid hours and credits agree (' + hL(paidHours) + ' h paid, ' + hL(creditH) + ' h computed).') +
        (notes.length ? ' ' + notes.join(' ') : '');
      if (notes.length) baseCheck.desc = notes.join(' ');
    }

    baseCheck.rows = [
      tr(fr ? 'Heures créditées' : 'Credited hours',
        tdN(creditH != null ? hL(creditH) + ' h' : DASH) + tdN(paidHours != null ? hL(paidHours) + ' h' : DASH) +
        (baseCheck.status === 'bad' && paidHours != null && creditH != null && paidHours + 1.0 < creditH
          ? tdBad(sgnH(Math.round((paidHours - creditH) * 100) / 100)) : tdP(pill(baseCheck.status))), baseCheck.status === 'bad'),
      tr(fr ? 'Base et temps supp. (montants)' : 'Flight pay and overtime (amounts)',
        tdM(DASH) + tdN(sum2(baseAmt, otAmt) != null ? money(sum2(baseAmt, otAmt)) : DASH) + tdP(pill(baseCheck.status === 'bad' ? 'bad' : 'ok')), false)
    ];
  }`,
  'real base check');

// sum2 helper next to the other small helpers in that scope.
patch('src/js/28-pay.js',
  "  const sgnH = v => (v < 0 ? '−' : '+') + hL(Math.abs(v)) + ' h';",
  "  const sgnH = v => (v < 0 ? '−' : '+') + hL(Math.abs(v)) + ' h';\n  const sum2 = (a, b) => (a == null && b == null) ? null : (+(a || 0) + +(b || 0));",
  'sum2 helper');

console.log('done');
