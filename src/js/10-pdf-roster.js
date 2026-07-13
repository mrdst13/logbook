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

    console.log('[Roster] First 1500 chars of extracted text:\n' + allText.substring(0, 1500));

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
      details.innerHTML = `<span style="color:var(--danger);">${esc(t('roster.noLegs'))}</span>`;
      showToast(t('toast.noFlightsInPdf'), 'error');
      return;
    }

    // SNAPSHOT before bulk modification (zero-data-loss policy)
    snapshotBeforeOperation('Crew names enrichment from PDF');
    updateUndoButton();

    // PIPEDA: read consent toggle BEFORE looping so we apply the same policy
    // to every captain name in this import batch.
    const rosterProfile = DB.loadProfile();

    // Merge crew names + ATD/ATA actuals into existing flights.
    // Strict rule (2026-05-14): only write atd_utc/ata_utc when (a) the PDF
    // is in UTC TimeMode and (b) the values are non-zero. Local-time PDFs
    // are NOT silently converted — we refuse to approximate.
    let matched = 0, alreadyHad = 0, noMatch = 0, atdAdded = 0;
    const stillMissing = [];
    extracted.forEach(item => {
      // Find existing flight : exact match on date + flightNum
      const idx = flights.findIndex(f =>
        f.date === item.date &&
        (f.flightNum === item.flightNum || (f.route && f.route.toUpperCase() === item.route))
      );
      if (idx === -1) { noMatch++; stillMissing.push(item); return; }
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
      }
      if (changed) flights[idx] = merged;
    });

    if (matched > 0 || atdAdded > 0) {
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
  const dateOnLine = {};
  for (let i = 0; i < lines.length; i++) {
    const d = extractDate(lines[i]);
    if (d) dateOnLine[i] = d;
  }

  // Build airline-flight regex from profile operator codes
  const profile = DB.loadProfile();
  const codes = (profile.operatorCodes || 'PD').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  const codesPattern = codes.length > 0 ? codes.join('|') : 'PD';
  const flightNumRegex = new RegExp(`\\b((?:${codesPattern})\\d{2,4})\\b`, 'gi');

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
      const routeMatch = line.match(/\b([A-Z]{3})\s*[-\/]\s*([A-Z]{3})\b/) ||
                         line.match(/\b([A-Z]{3})\s+([A-Z]{3})\b/);
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

      if (pic || atd_utc || ata_utc) {
        flights.push({ date, flightNum, route, pic, atd_utc, ata_utc });
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

