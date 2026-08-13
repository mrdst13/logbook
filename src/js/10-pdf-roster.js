// ═══════════════════════════════════════════
// NAVBLUE PDF ROSTER PARSER — captain name capture
// ═══════════════════════════════════════════
// Parses an HrRosterReport PDF entirely client-side using pdf.js.
// Extracts flight legs + crew names, then merges PIC name into existing
// logbook entries (matched on date + flight#).
// Zero data leaves the browser.

async function handleRosterFile(file) {
  if (!file) return;
  if (typeof pdfjsLib === 'undefined') {
    showToast(t('toast.pdfLibNotLoaded'), 'error');
    return;
  }
  const details = document.getElementById('rosterDetails');
  details.style.display = 'block';
  details.innerHTML = `Reading <strong>${esc(file.name)}</strong>…`;

  try {
    // Read the file as ArrayBuffer (client-side, no upload)
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    details.innerHTML = `Parsing ${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}…`;

    // Extract all text from all pages, page by page, preserving structure
    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Group items by Y position to approximate text lines
      const lines = groupTextByLines(content.items);
      allText += lines.join('\n') + '\n';
    }

    // Kept in memory for the "what Cumulo read" panel. Never persisted: the
    // extracted text carries crew names. Not logged either — a console dump of
    // a roster is the same PII, just somewhere else.
    _lastRosterText = allText;

    // Detect TimeMode header (Navblue PDFs can be downloaded in Local or UTC).
    // We extract ATD/ATA verbatim; if Local mode, the user should re-download
    // the PDF in UTC to avoid timezone conversion. We refuse to silently
    // approximate (cf. feedback_never_approximate_certifiable_data.md).
    const timeModeMatch = allText.match(/TimeMode\s+(Local time|UTC|Zulu)/i);
    const pdfTimeMode = timeModeMatch ? timeModeMatch[1].toLowerCase() : 'unknown';
    const isLocalTime = pdfTimeMode.includes('local');
    // FAIL-SAFE gate: only touch ACTUAL times (enrich atd/ata, add missing legs)
    // when the PDF is POSITIVELY confirmed UTC/Zulu. An undetected header
    // (pdfTimeMode === 'unknown', e.g. a layout the regex missed) must NOT be
    // treated as UTC — station-local clocks stored as UTC would fabricate the
    // day/night split. "unknown" is treated like "local": we refuse.
    const isUTCConfirmed = pdfTimeMode.includes('utc') || pdfTimeMode.includes('zulu');

    // Parse the text to extract flight legs with their crew AND ATD/ATA actuals
    const extracted = parseNavblueRosterText(allText);
    console.log(`[Roster] Extracted ${extracted.length} flights from PDF (TimeMode: ${pdfTimeMode})`);

    if (extracted.length === 0) {
      details.innerHTML = `<span style="color:var(--danger);">${esc(t('roster.noLegs'))}</span>` +
        `<br><button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="showRosterParseDiagnostic()">${esc(t('roster.diag.btn'))}</button>`;
      showToast(t('toast.noFlightsInPdf'), 'error');
      return;
    }

    // SNAPSHOT before bulk modification (zero-data-loss policy)
    snapshotBeforeOperation('Crew names enrichment from PDF');
    updateUndoButton();

    // PIPEDA: read consent toggle BEFORE looping so we apply the same policy
    // to every captain name in this import batch.
    const rosterProfile = DB.loadProfile();
    // One instant for every row this import touches.
    const _rosterAcceptedAt = new Date().toISOString();

    // Merge crew names + ATD/ATA actuals into existing flights.
    // Strict rule (2026-05-14): only write atd_utc/ata_utc when (a) the PDF
    // is in UTC TimeMode and (b) the values are non-zero. Local-time PDFs
    // are NOT silently converted — we refuse to approximate.
    let matched = 0, alreadyHad = 0, noMatch = 0, atdAdded = 0, ataAdded = 0, regAdded = 0;
    const stillMissing = [];
    // Each logbook row may be claimed by ONE extracted leg. The old matcher's
    // route fallback let both legs of an out-and-back day (YOW-YYZ then
    // YYZ-YOW, or two same-route rotations) land on the FIRST row: the second
    // leg's crew and actuals were silently swallowed or misfiled onto the
    // wrong leg. Flight number matches are tried for the WHOLE batch first,
    // so a route-fallback from one leg can never steal a row whose own
    // flight number match is coming. (Final audit 2026-08-02.)
    const _claimed = new Set();
    const _findRow = (item, allowRouteFallback) => {
      for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        if (_claimed.has(i) || !f || f.date !== item.date) continue;
        if (f.flightNum === item.flightNum) return i;
        if (allowRouteFallback && !item.flightNum && f.route && f.route.toUpperCase() === item.route) return i;
      }
      return -1;
    };
    const _byNum = [], _byRoute = [];
    extracted.forEach(item => { (item.flightNum ? _byNum : _byRoute).push(item); });
    _byNum.concat(_byRoute).forEach(item => {
      const idx = _findRow(item, !item.flightNum);
      if (idx === -1) { noMatch++; stillMissing.push(item); return; }
      _claimed.add(idx);
      const existing = flights[idx];
      const merged = { ...existing };
      let changed = false;
      // Captain name — don't overwrite if user already has one
      if (item.pic && (!existing.pic || !existing.pic.trim() || existing.pic === '—')) {
        merged.pic = item.pic;
        changed = true;
        matched++;
      } else if (item.pic) {
        alreadyHad++;
      }
      // Registration — mandatory logbook content (CAR 401.08(2)(b)) that the
      // iCal feed can no longer supply for an older flight: it publishes a
      // rolling window only. Fill-empty, like every other import: a value the
      // pilot entered is never touched. Not gated on the PDF's time mode —
      // that gate exists for CLOCK values, and a tail number is not a time.
      if (item.reg && (!existing.reg || !String(existing.reg).trim())) {
        merged.reg = item.reg;
        changed = true;
        regAdded++;
      }
      // ATD/ATA — only if PDF is in UTC mode AND values are non-zero AND
      // the flight doesn't already have manually-entered actuals.
      if (isUTCConfirmed && item.atd_utc && item.atd_utc !== '0000' && !existing.atd_utc) {
        merged.atd_utc = item.atd_utc;
        changed = true;
        atdAdded++;
      }
      if (isUTCConfirmed && item.ata_utc && item.ata_utc !== '0000' && !existing.ata_utc) {
        merged.ata_utc = item.ata_utc;
        changed = true;
        ataAdded++;   // an ATA-only batch must still hit DB.save below
      }
      if (changed) {
        if (typeof stampFlightAccepted === 'function') stampFlightAccepted(merged, _rosterAcceptedAt, rosterProfile);
        flights[idx] = merged;
      }
    });

    // ataAdded gates the save too: a re-import whose ONLY news is the actual
    // arrival of a leg that was airborne last time mutated the array in memory
    // and never persisted — the recorded ATA vanished on reload.
    // (Final audit r3, 2026-08-02.)
    if (matched > 0 || atdAdded > 0 || ataAdded > 0 || regAdded > 0) {
      DB.save(flights);
      renderDashboard();
    }

    // ── Add legs the logbook doesn't have yet ────────────────────────────────
    // The roster PDF is the certifiable source of ACTUAL times, so a leg the
    // pilot flew but never logged should be ADDED with its real block — not
    // dropped as "no match". Build full flights from the actuals and route them
    // through the SHARED import preview (dedup + undo + add), the same gate the
    // iCal / photo / CSV imports use. STRICT: UTC PDFs only — a Local-time PDF
    // is never auto-added (that would approximate a timezone).
    let newLegs = [];
    if (isUTCConfirmed && stillMissing.length > 0) {
      const rankLower = (rosterProfile.rank || '').toLowerCase();
      const isFO = !(rankLower === 'cpt.' || rankLower === 'cpt'
                  || rankLower === 'captain' || rankLower === 'pic'
                  || rankLower === 'commander');
      const autoCountIFR = (rosterProfile.autoCountIFR !== undefined)
        ? !!rosterProfile.autoCountIFR
        : (typeof isAirline705 === 'function' && isAirline705(rosterProfile.airline));
      newLegs = stillMissing
        .map(leg => navbluePdfLegToFlight(leg, isFO, autoCountIFR))
        .filter(Boolean);
    }

    const detailLines = [
      t('roster.detail.extracted', { n: `<strong>${extracted.length}</strong>` }),
      t('roster.detail.captains', { n: `<strong style="color:var(--success);">${matched}</strong>` }),
    ];
    if (atdAdded > 0) {
      detailLines.push(t('roster.detail.times', { n: `<strong style="color:var(--success);">${atdAdded}</strong>` }));
    }
    if (regAdded > 0) {
      detailLines.push(t('roster.detail.regs', { n: `<strong style="color:var(--success);">${regAdded}</strong>` }));
    }
    if (newLegs.length > 0) {
      detailLines.push(t('roster.detail.newAdded', { n: `<strong style="color:var(--success);">${newLegs.length}</strong>` }));
    }
    // Local OR unconfirmed TimeMode → actual times and missing legs were NOT
    // imported. Same actionable warning for both: re-download in UTC / Zulu.
    if (!isUTCConfirmed) {
      detailLines.push(`<span style="color:var(--warning);">${t(isLocalTime ? 'roster.detail.localTime' : 'roster.detail.unknownTime')}</span>`);
    }
    if (alreadyHad > 0) detailLines.push(`<span>${t('roster.detail.alreadyHad', { n: alreadyHad })}</span>`);
    // "No match" now only covers legs we could NOT stage as new flights
    // (Local-time PDF, or a leg still lacking real ATD/ATA — e.g. in progress).
    const notAdded = noMatch - newLegs.length;
    if (notAdded > 0) detailLines.push(`<span style="color:var(--warning);">${t('roster.detail.noMatch', { n: notAdded })}</span>`);
    // A way to see what the parser actually read, without asking anyone to open
    // a console (which this app never does) and without exposing a single name.
    detailLines.push(`<button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="showRosterParseDiagnostic()">${esc(t('roster.diag.btn'))}</button>`);
    details.innerHTML = detailLines.join('<br>');

    if (newLegs.length > 0) {
      // The import-preview modal (opened below) is the feedback for added legs.
    } else if (matched > 0) {
      showToast(t(matched === 1 ? 'toast.captainsAdded' : 'toast.captainsAddedPl', { n: matched }), 'success');
    } else if (alreadyHad === extracted.length) {
      showToast(t('toast.allHadPic'));
    } else {
      showToast(t('toast.noCaptainsAdded'), 'error');
    }

    // Open the shared preview LAST so the details panel above is already drawn.
    if (newLegs.length > 0 && typeof showImportPreview === 'function') {
      showImportPreview(newLegs, t('roster.preview.newFromPdf', { n: newLegs.length }));
    }
  } catch (e) {
    console.error('[Roster] Parse error:', e);
    details.innerHTML = `<span style="color:var(--danger);">${t('sync.detail.error', { msg: esc(e.message) })}</span>`;
    showToast(t('toast.pdfParseFailed', { err: e.message }), 'error');
  }
}

// Group pdf.js text items by Y coordinate → approximate visual lines
function groupTextByLines(items) {
  const lines = {};
  items.forEach(item => {
    if (!item.str || !item.str.trim()) return;
    const y = Math.round(item.transform[5]);  // Y position
    const x = item.transform[4];               // X position
    if (!lines[y]) lines[y] = [];
    lines[y].push({ x, text: item.str });
  });
  // Sort each line by X position then join with spaces
  return Object.keys(lines)
    .sort((a, b) => +b - +a)  // top to bottom (PDF Y is inverted)
    .map(y => lines[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' '));
}

// Parse the extracted text to find flight legs, crew names, AND actual times.
// Navblue HrRosterReport format (confirmed against Porter sample 2026-05-14):
//   Header: Date  Des. Code Req LE  CI   Dep STD  Arr STA  CO   AC  WA Func Rank ATD   ATA   BLH   Credit Pairing
//   Row:    01 Fri        PD448         1055 YYJ 1155 YOW 1933 2002 295               FO   12:07 19:47 04:40 04:40 O3049
//
// Key observations:
//   - CI/STD/STA/CO use HHMM format (no separator) — these are schedule
//   - ATD/ATA use HH:MM format (colon separator) — these are ACTUAL times
//   - 4 HH:MM values appear after rank (FO/CA): ATD, ATA, BLH, Credit
//   - "00:00" in ATD/ATA = not flown yet (future flight) — skip
//   - TimeMode is in the PDF header (Local or UTC); caller decides import policy
function parseNavblueRosterText(text) {
  const flights = [];
  const lines = text.split(/\r?\n/);

  // Strategy : sliding window across lines. For each line containing PD\d{2,4},
  // look for a date (YYYY-MM-DD or DD-MMM-YYYY or DDMMM) nearby, plus capital-name
  // patterns ("LASTNAME, F" or "LASTNAME F").
  // Crew names in Navblue PDFs : usually uppercase last name + first initial.

  // Build a date map : line index → ISO date (for any line that mentions a date)
  // A full date wins; failing that, the row's own "01 Fri" day resolved against
  // the roster period. Without this second form a Porter roster yields almost
  // nothing (Martin 2026-08-13: 1 leg out of a whole month).
  const period = rosterPeriodContext(text);
  const dateOnLine = {};
  for (let i = 0; i < lines.length; i++) {
    const d = extractDate(lines[i]) || rosterRowDate(lines[i], period);
    if (d) dateOnLine[i] = d;
  }

  // Build airline-flight regex from profile operator codes
  const profile = DB.loadProfile();
  const codes = (profile.operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const codesPattern = codes.length > 0 ? codes.join('|') : 'PD';
  const flightNumRegex = new RegExp(`\\b((?:${codesPattern})\\d{2,4})\\b`, 'gi');
  // Same pattern without /g/: used to tell where one roster row stops and the
  // next begins, so a continuation line is never read as the next leg's.
  const flightNumTest = new RegExp(`\\b(?:${codesPattern})\\d{2,4}\\b`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find airline flight numbers in this line (per user's operator codes)
    const flightMatches = [...line.matchAll(flightNumRegex)];
    if (flightMatches.length === 0) continue;

    // Deadhead / positioning legs are NOT flown time — never parse them (same
    // intent as the iCal path, 08-flight-form.js:705). We test a NARROWER marker
    // set than the iCal DEADHEAD_RE on purpose: this is a FULL roster row, which
    // also carries a pairing id (e.g. "P30491") and can carry a "PAX" count, so
    // reusing DEADHEAD_RE's \bP\d{5}\b / \bPAX\b here would silently drop a REAL
    // flown leg. (D)/DH/DHD/DEADHEAD in the crew-function column are unambiguous
    // — and \bDH\b does NOT match the "DH4"/"DH8" Dash-8 fleet codes (no word
    // boundary before the digit).
    if (/\(D\)|\bDH\b|\bDHD\b|\bDEADHEAD\b/i.test(line)) continue;

    flightMatches.forEach(m => {
      const flightNum = m[1];

      // Find a date — look on this line, then walk backwards up to 5 lines
      let date = dateOnLine[i];
      if (!date) {
        for (let back = 1; back <= 5 && !date; back++) {
          date = dateOnLine[i - back];
        }
      }
      if (!date) return;  // can't anchor without a date

      // Find route (YOW-YYZ, YYJ-YOW, etc.) — 3-letter IATAs near the flight number
      // Third shape: the Navblue row prints "Dep STD Arr STA", so the two
      // airports are separated by the scheduled departure time
      // ("... YYJ 1155 YOW ..."). Without this the route came out empty on a
      // real Porter roster and only the flight number could match a logbook row.
      const routeMatch = line.match(/\b([A-Z]{3})\s*[-\/]\s*([A-Z]{3})\b/) ||
                         line.match(/\b([A-Z]{3})\s+([A-Z]{3})\b/) ||
                         line.match(/\b([A-Z]{3})\s+\d{3,4}\s+([A-Z]{3})\b/);
      const route = routeMatch ? `${routeMatch[1]}-${routeMatch[2]}` : '';

      // Find crew names — look on this line + next 2 lines
      // Pattern: LASTNAME, F  or  LASTNAME F.  or  Lastname Firstname
      const window = lines.slice(i, i + 3).join(' ');
      const crewMatches = [...window.matchAll(/\b([A-Z][A-Z\-']{1,30})(?:,\s*|\s+)([A-Z](?:\.|\b))/g)];
      // First crew name = captain (Navblue convention), second = F/O
      let pic = '';
      if (crewMatches.length >= 1) {
        pic = `${crewMatches[0][1]}, ${crewMatches[0][2].replace('.', '')}`;
        // Title Case the last name
        pic = pic.replace(/([A-Z])([A-Z]+)/, (_, h, t) => h + t.toLowerCase());
      }

      // Extract ATD/ATA actual times from the same row. Pattern: after
      // the rank token (FO / CA / CP) there are 4 HH:MM values =
      // ATD, ATA, BLH, Credit. The schedule times before (CI/STD/STA/CO)
      // are HHMM-no-colon, so the colon-separated values are unambiguous.
      let atd_utc = '', ata_utc = '';
      const timeMatches = [...line.matchAll(/(\d{2}):(\d{2})/g)];
      // We expect at least 2 HH:MM matches (ATD then ATA); BLH/Credit follow.
      if (timeMatches.length >= 2) {
        const atdRaw = timeMatches[0][1] + timeMatches[0][2]; // HHMM
        const ataRaw = timeMatches[1][1] + timeMatches[1][2];
        // "0000" = not flown yet (future flight) — skip rather than store zeros.
        // STRICT: never write a value that's not a real actual time.
        if (atdRaw !== '0000') atd_utc = atdRaw;
        if (ataRaw !== '0000') ata_utc = ataRaw;
      }

      // Registration, when the roster prints it. CAR 401.08(2)(b) makes it
      // mandatory logbook content, and the iCal feed only publishes a rolling
      // window (Martin's, 2026-08-13: from 30 days back), so a flight imported
      // before its aircraft was assigned has no other source once it ages out.
      // Read from the SAME row window the crew names come from, and only when
      // that window names exactly ONE aircraft: two legs on two different tails
      // can share a window, and a guess there would put the wrong airframe on a
      // certifiable entry. Nothing found = left empty, exactly as before.
      // The flight's OWN line first: the crew window spans up to three lines and
      // routinely reaches the NEXT leg, whose aircraft is a different airframe.
      const regsOnLine = [...new Set(line.match(/\bC-[A-Z]{4}\b/g) || [])];
      let reg = '';
      if (regsOnLine.length === 1) {
        reg = regsOnLine[0];
      } else if (regsOnLine.length === 0) {
        // pdf.js can split one visual row across lines, so a tail may sit just
        // below its own row. Only the lines BEFORE the next flight number can
        // belong to this leg — stop there rather than reading the next leg's
        // aircraft — and still refuse if those lines name more than one.
        const contin = [];
        for (let k = i + 1; k <= i + 2 && k < lines.length; k++) {
          if (flightNumTest.test(lines[k])) break;
          contin.push(lines[k]);
        }
        const belowRegs = [...new Set(contin.join(' ').match(/\bC-[A-Z]{4}\b/g) || [])];
        if (belowRegs.length === 1) reg = belowRegs[0];
      }

      if (pic || atd_utc || ata_utc || reg) {
        flights.push({ date, flightNum, route, pic, atd_utc, ata_utc, reg });
      }
    });
  }

  // Dedupe (same flight may appear on multiple lines)
  const seen = new Set();
  return flights.filter(f => {
    const key = `${f.date}|${f.flightNum}|${f.route}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Build a COMPLETE certifiable flight from ONE parsed PDF roster leg, using the
// ACTUAL times (ATD/ATA). Used to ADD legs the logbook doesn't have yet — the
// roster PDF is Cumulo's source of truth for actuals, so a leg the pilot flew
// but hasn't logged should appear WITH its real block, not be dropped.
//
// STRICT (certifiable):
//   - Caller passes legs from a UTC-TimeMode PDF only. We NEVER build from a
//     Local-time PDF — converting a station-local clock to UTC would be an
//     approximation (cf. feedback_never_approximate_certifiable_data.md).
//   - Both a real ATD and ATA are required. A leg with "0000" (not flown yet)
//     was already blanked by the parser, so it fails this guard and is skipped.
//   - Field-for-field it mirrors navblueEventToFlight() (the iCal builder): the
//     LOCAL-departure-day date (so both paths dedup), the day/night split with
//     the same coords-unknown fallback, and the role/XC columns — so the two
//     import paths can never disagree on the same leg.
function navbluePdfLegToFlight(leg, isFO, autoCountIFR) {
  if (!leg) return null;
  const [depIATA, arrIATA] = (leg.route || '').split('-');
  if (!depIATA || !arrIATA) return null;
  if (!leg.atd_utc || leg.atd_utc.length !== 4) return null;
  if (!leg.ata_utc || leg.ata_utc.length !== 4) return null;

  const depICAO = iataToIcao(depIATA);
  const arrICAO = iataToIcao(arrIATA);
  const blockOffUTC = buildUTCDateTime(leg.date, leg.atd_utc);
  let blockOnUTC = buildUTCDateTime(leg.date, leg.ata_utc);
  if (!blockOffUTC || !blockOnUTC) return null;
  // Arrival clock earlier than departure = the leg crossed midnight UTC.
  if (blockOnUTC.getTime() <= blockOffUTC.getTime()) blockOnUTC = new Date(blockOnUTC.getTime() + 86400000);
  const block = +((blockOnUTC.getTime() - blockOffUTC.getTime()) / 3600000).toFixed(2);
  if (!(block > 0) || block > 18) return null;  // sanity: a real airline leg

  // Logbook date = LOCAL departure day (SAME as the iCal path, icsLocalDate),
  // so a midnight-crossing leg dedups against the flight iCal already logged
  // instead of creating a duplicate on the UTC day. icsLocalDate takes an
  // ICS-format "YYYYMMDDTHHMMSSZ" string — build one from the UTC block-off.
  const p2 = n => String(n).padStart(2, '0');
  const icsOff = `${blockOffUTC.getUTCFullYear()}${p2(blockOffUTC.getUTCMonth() + 1)}${p2(blockOffUTC.getUTCDate())}T${p2(blockOffUTC.getUTCHours())}${p2(blockOffUTC.getUTCMinutes())}00Z`;
  const dateStr = (typeof icsLocalDate === 'function') ? icsLocalDate(icsOff, depICAO) : leg.date;

  // Day/Night split from the ACTUAL block times. Fallback = credit the whole
  // block to DAY when airport coords are unknown, exactly as navblueEventToFlight
  // does — so the hours land in a role column and never vanish from the SIC/PIC
  // breakdown (recalculateFlightDayNightXC returns early on unknown coords, so we
  // compute the split here rather than delegating to it).
  let dayHours = block, nightHours = 0;
  const depCoords = AIRPORT_COORDS[depICAO];
  const arrCoords = AIRPORT_COORDS[arrICAO];
  if (depCoords && arrCoords) {
    const split = calculateDayNightSplit(blockOffUTC, blockOnUTC, depCoords, arrCoords);
    dayHours = split.dayHours;
    nightHours = split.nightHours;
  }

  // Cross-country (null = unknown airport → leave XC undefined, never guess).
  const isXC = isCrossCountry(depICAO, arrICAO);
  const xcKnown = isXC !== null;
  const role = isFO ? 'cop' : 'pic';
  const meDayPic   = role === 'pic' ? dayHours   : 0;
  const meNightPic = role === 'pic' ? nightHours : 0;
  const meDayCop   = role === 'cop' ? dayHours   : 0;
  const meNightCop = role === 'cop' ? nightHours : 0;
  const xcDayPic   = !xcKnown ? undefined : (isXC && role === 'pic' ? dayHours   : 0);
  const xcNightPic = !xcKnown ? undefined : (isXC && role === 'pic' ? nightHours : 0);
  const xcDayCop   = !xcKnown ? undefined : (isXC && role === 'cop' ? dayHours   : 0);
  const xcNightCop = !xcKnown ? undefined : (isXC && role === 'cop' ? nightHours : 0);

  const prof = DB.loadProfile();
  const self = `${prof.fname || ''} ${prof.lname || ''}`.trim() || 'self';
  return {
    date: dateStr,
    flightNum: leg.flightNum,
    type: '',                       // roster PDF text doesn't reliably carry type — empty > guessed
    reg: '',
    pic: isFO ? (leg.pic || '') : self,
    copilot: isFO ? self : '',
    crewPosition: isFO ? 'SIC' : 'PIC',
    route: `${depIATA}-${arrIATA}`,
    dep_icao: depICAO,
    arr_icao: arrICAO,
    dtstart_utc: blockOffUTC.toISOString(),
    // Cumulo's only time concept = ACTUAL. These ARE the actual block times.
    atd_utc: leg.atd_utc,
    ata_utc: leg.ata_utc,
    block: block,
    duty: 0,
    total: block,
    meDayPic, meNightPic, meDayDual: 0, meNightDual: 0, meDayCop, meNightCop,
    xcDayPic, xcNightPic, xcDayDual: 0, xcNightDual: 0, xcDayCop, xcNightCop,
    instActual: 0, instHood: 0, instSim: 0,
    approaches: autoCountIFR ? 1 : 0,
    picus: 0,
    multiCrew: 1,
    remarks: '',
    source: 'navblue-pdf',
    navblueUid: ''
  };
}

// ─────────────────────────────────────────────────────────────────
//  WHAT CUMULO READ — a diagnostic that carries NO personal data.
//
//  When a roster parses badly there is no way to fix it without seeing the
//  layout, and the extracted text is full of third-party crew names, flight
//  numbers and times. So the panel reports COUNTS plus SHAPE-MASKED samples:
//  every letter becomes A and every digit 9, which preserves the column layout
//  exactly and destroys the content. "01 Fri PD448 1055 YYJ" reads
//  "99 AAA AA999 9999 AAA" — enough to write a parser, impossible to identify
//  a crew member, a flight or a day.
//
//  Held in memory only (never localStorage, never the cloud): the raw text is
//  PII and it dies with the page.
// ─────────────────────────────────────────────────────────────────
let _lastRosterText = '';

function maskRosterShape(line) {
  return String(line || '').replace(/[A-Za-zÀ-ÿ]/g, 'A').replace(/[0-9]/g, '9').slice(0, 110);
}

function rosterParseReport(text) {
  const lines = String(text || '').split(/\r?\n/);
  const codes = (() => {
    try { return ((DB.loadProfile().operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean)).join('|'); }
    catch (e) { return 'PD'; }
  })();
  const numRe = new RegExp('\\b(?:' + (codes || 'PD') + ')\\d{2,4}\\b', 'i');
  const dayRe = /^\s*(\d{1,2})\s*(MON|TUE|WED|THU|FRI|SAT|SUN)\b/i;
  const period = rosterPeriodContext(text);
  let withNum = 0, withFullDate = 0, withDayCol = 0, withReg = 0, deadhead = 0;
  const samples = [];
  lines.forEach(l => {
    const hasNum = numRe.test(l);
    if (hasNum) withNum++;
    if (extractDate(l)) withFullDate++;
    if (dayRe.test(l)) withDayCol++;
    if (/\bC-[A-Z]{4}\b/.test(l)) withReg++;
    if (hasNum && /\(D\)|\bDH\b|\bDHD\b|\bDEADHEAD\b/i.test(l)) deadhead++;
    if (hasNum && samples.length < 4) samples.push(maskRosterShape(l));
  });
  return {
    lines: lines.length, withNum: withNum, withFullDate: withFullDate,
    withDayCol: withDayCol, withReg: withReg, deadhead: deadhead,
    period: period ? (period.from ? period.from + ' -> ' + period.to
                                  : String(period.y1) + '-' + (period.m1 < 10 ? '0' : '') + period.m1) : '',
    header: lines.slice(0, 3).map(maskRosterShape),
    samples: samples
  };
}

function showRosterParseDiagnostic() {
  const details = document.getElementById('rosterDetails');
  if (!details) return;
  if (!_lastRosterText) { showToast(t('roster.diag.none'), 'error'); return; }
  const r = rosterParseReport(_lastRosterText);
  const rows = [
    t('roster.diag.lines', { n: r.lines }),
    t('roster.diag.withNum', { n: r.withNum }),
    t('roster.diag.dates', { full: r.withFullDate, day: r.withDayCol }),
    t('roster.diag.period', { p: r.period || t('roster.diag.noPeriod') }),
    t('roster.diag.regs', { n: r.withReg }),
    t('roster.diag.deadhead', { n: r.deadhead }),
  ].map(esc);
  const shapes = r.header.concat(r.samples).map(esc).join('<br>');
  details.style.display = 'block';
  details.innerHTML = rows.join('<br>') +
    '<div style="margin-top:8px;">' + esc(t('roster.diag.shapeNote')) + '</div>' +
    '<div style="margin-top:6px; white-space:pre; overflow-x:auto;">' + shapes + '</div>';
}

// ─────────────────────────────────────────────────────────────────
//  THE ROSTER'S OWN PERIOD, and the "01 Fri" row date.
//
//  Martin 2026-08-13, dropping his monthly roster: "Flight legs extracted from
//  PDF: 1". A Navblue HrRosterReport dates each row by DAY OF MONTH plus a
//  weekday ("01 Fri  PD448 ..."), exactly as the row sample documented at the
//  top of parseNavblueRosterText — a shape extractDate() never handled. With no
//  date on the row and none in the five lines above it, nearly every leg was
//  dropped before anything else could run.
//
//  The month comes from the roster's own period header, never from today's
//  clock. When the period spans two months, a day at or after the start day
//  belongs to the first month and a lower day to the second — and any date
//  landing outside the stated period is refused rather than guessed, because a
//  wrong date is a wrong logbook entry.
// ─────────────────────────────────────────────────────────────────
const _ROSTER_MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };

function rosterPeriodContext(text) {
  // Header area only. A date further down is a row, not the period, and a
  // print date picked up by accident would date a whole month of flying to the
  // wrong month — the worst possible failure on a certifiable record.
  const s = String(text || '').slice(0, 3000);
  const pad = n => (n < 10 ? '0' : '') + n;
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const found = [];
  [...s.matchAll(/\b(\d{1,2})[\s\-]?([A-Za-z]{3})[\s\-]?(\d{2,4})\b/g)].forEach(m => {
    const mo = _ROSTER_MONTHS[m[2].toUpperCase()];
    if (!mo) return;
    let y = m[3]; if (y.length === 2) y = '20' + y;
    found.push({ at: m.index, d: +m[1], m: mo, y: +y });
  });
  [...s.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].forEach(m => {
    found.push({ at: m.index, d: +m[3], m: +m[2], y: +m[1] });
  });
  found.sort((a, b) => a.at - b.at);
  // A period is a PAIR that reads like one: ascending, and no longer than a
  // roster month or so. The first such pair wins; a lone date (a print date,
  // a licence expiry) is deliberately NOT treated as a period.
  for (let i = 0; i + 1 < found.length; i++) {
    const a = found[i], b = found[i + 1];
    const from = iso(a.y, a.m, a.d), to = iso(b.y, b.m, b.d);
    const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
    if (days >= 0 && days <= 62) {
      return { from: from, to: to, startDay: a.d, m1: a.m, y1: a.y, m2: b.m, y2: b.y };
    }
  }
  // A titled month ("May 2026") is unambiguous on its own.
  const named = s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Za-z]*\s+(20\d{2})\b/i);
  if (named) {
    const mo = _ROSTER_MONTHS[named[1].toUpperCase()];
    return { from: '', to: '', startDay: 1, m1: mo, y1: +named[2], m2: mo, y2: +named[2] };
  }
  return null;
}

// The day-of-month a roster row carries ("01 Fri", "1 Fri", "01Fri"), resolved
// against the period. Returns an ISO date or '' — never a guess.
function rosterRowDate(line, period) {
  if (!period) return '';
  const m = String(line || '').match(/^\s*(\d{1,2})\s*(MON|TUE|WED|THU|FRI|SAT|SUN)\b/i);
  if (!m) return '';
  const day = +m[1];
  if (!(day >= 1 && day <= 31)) return '';
  const spans = (period.m1 !== period.m2) || (period.y1 !== period.y2);
  const useSecond = spans && day < period.startDay;
  const y = useSecond ? period.y2 : period.y1;
  const mo = useSecond ? period.m2 : period.m1;
  const pad = n => (n < 10 ? '0' : '') + n;
  const iso = y + '-' + pad(mo) + '-' + pad(day);
  // Refuse anything the roster itself does not cover.
  if (period.from && iso < period.from) return '';
  if (period.to && iso > period.to) return '';
  return iso;
}

// Extract an ISO date from a line of text. Handles many Navblue date formats.
function extractDate(line) {
  // YYYY-MM-DD
  let m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD-MMM-YYYY (eg 12-Apr-2026 or 12APR2026)
  m = line.match(/\b(\d{1,2})[\s\-]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s\-]?(\d{2,4})\b/i);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' }[m[2].toUpperCase()];
    let year = m[3]; if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }
  // DD/MM/YYYY
  m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

function loadNavblueUI() {
  const url = localStorage.getItem(NAVBLUE_URL_KEY);
  const input = document.getElementById('navblueUrl');
  if (input && url) input.value = url;
  updateNavblueStatus();
  updateUndoButton();
  renderColumnPicker();
}

