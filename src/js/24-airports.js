// ═══════════════════════════════════════════
//  AIRPORT TYPEAHEAD — Route field autocomplete
//  Pilots fly worldwide, so this is an INTERNATIONAL curated list (ICAO + IATA
//  + name), not Canada-only. Intentionally simple: a lightweight autocomplete
//  on the last airport code being typed in the multi-leg Route field. No
//  external data / network — the list is embedded and easy to extend.
//  Matching is by ICAO or IATA prefix, or a name substring; picking inserts
//  the matched code (ICAO by default, IATA when that's what you typed).
// ═══════════════════════════════════════════
const AIRPORTS = [
  // ── Canada (major + Porter/regional network) ──
  ['CYYZ','YYZ','Toronto Pearson'],['CYTZ','YTZ','Toronto Billy Bishop'],['CYUL','YUL','Montréal-Trudeau'],
  ['CYMX','YMX','Montréal Mirabel'],['CYOW','YOW','Ottawa Macdonald-Cartier'],['CYND','YND','Gatineau'],
  ['CYVR','YVR','Vancouver'],['CYYC','YYC','Calgary'],['CYEG','YEG','Edmonton'],['CYWG','YWG','Winnipeg'],
  ['CYHZ','YHZ','Halifax Stanfield'],['CYQB','YQB','Québec Jean-Lesage'],['CYYT','YYT','St. John’s'],
  ['CYXE','YXE','Saskatoon'],['CYQR','YQR','Regina'],['CYYJ','YYJ','Victoria'],['CYLW','YLW','Kelowna'],
  ['CYHM','YHM','Hamilton'],['CYKF','YKF','Kitchener-Waterloo'],['CYQM','YQM','Moncton'],['CYFC','YFC','Fredericton'],
  ['CYQT','YQT','Thunder Bay'],['CYXS','YXS','Prince George'],['CYZF','YZF','Yellowknife'],['CYXY','YXY','Whitehorse'],
  ['CYFB','YFB','Iqaluit'],['CYGK','YGK','Kingston'],['CYSB','YSB','Sudbury'],['CYXU','YXU','London ON'],
  ['CYQG','YQG','Windsor'],['CYAM','YAM','Sault Ste. Marie'],['CYQY','YQY','Sydney NS'],['CYYR','YYR','Goose Bay'],
  ['CYYG','YYG','Charlottetown'],['CYBG','YBG','Bagotville'],['CYVO','YVO','Val-d’Or'],['CYQL','YQL','Lethbridge'],
  ['CYXX','YXX','Abbotsford'],['CYCD','YCD','Nanaimo'],['CYZV','YZV','Sept-Îles'],['CYUY','YUY','Rouyn-Noranda'],
  // ── United States ──
  ['KJFK','JFK','New York JFK'],['KLGA','LGA','New York LaGuardia'],['KEWR','EWR','Newark'],['KBOS','BOS','Boston Logan'],
  ['KORD','ORD','Chicago O’Hare'],['KMDW','MDW','Chicago Midway'],['KLAX','LAX','Los Angeles'],['KSFO','SFO','San Francisco'],
  ['KSEA','SEA','Seattle-Tacoma'],['KDEN','DEN','Denver'],['KDFW','DFW','Dallas-Fort Worth'],['KATL','ATL','Atlanta'],
  ['KMIA','MIA','Miami'],['KMCO','MCO','Orlando'],['KFLL','FLL','Fort Lauderdale'],['KTPA','TPA','Tampa'],
  ['KLAS','LAS','Las Vegas'],['KPHX','PHX','Phoenix'],['KIAD','IAD','Washington Dulles'],['KDCA','DCA','Washington Reagan'],
  ['KBWI','BWI','Baltimore'],['KPHL','PHL','Philadelphia'],['KDTW','DTW','Detroit'],['KMSP','MSP','Minneapolis-St. Paul'],
  ['KIAH','IAH','Houston Bush'],['KHOU','HOU','Houston Hobby'],['KCLT','CLT','Charlotte'],['KSAN','SAN','San Diego'],
  ['KPDX','PDX','Portland OR'],['KSLC','SLC','Salt Lake City'],['KBNA','BNA','Nashville'],['KAUS','AUS','Austin'],
  ['KMCI','MCI','Kansas City'],['KRDU','RDU','Raleigh-Durham'],['KBUF','BUF','Buffalo'],['KHNL','HNL','Honolulu'],
  // ── Mexico, Caribbean, Central & South America ──
  ['MMMX','MEX','Mexico City'],['MMUN','CUN','Cancún'],['MMPR','PVR','Puerto Vallarta'],['MMSD','SJD','San José del Cabo'],
  ['MYNN','NAS','Nassau'],['MDPC','PUJ','Punta Cana'],['MDSD','SDQ','Santo Domingo'],['MDPP','POP','Puerto Plata'],
  ['MKJS','MBJ','Montego Bay'],['MKJP','KIN','Kingston JM'],['TBPB','BGI','Barbados'],['MBPV','PLS','Providenciales'],
  ['MUVR','VRA','Varadero'],['MUHA','HAV','Havana'],['MPTO','PTY','Panama City'],['MROC','SJO','San José CR'],
  ['SBGR','GRU','São Paulo Guarulhos'],['SBGL','GIG','Rio de Janeiro'],['SAEZ','EZE','Buenos Aires Ezeiza'],
  ['SKBO','BOG','Bogotá'],['SPJC','LIM','Lima'],['SCEL','SCL','Santiago'],
  // ── Europe ──
  ['EGLL','LHR','London Heathrow'],['EGKK','LGW','London Gatwick'],['EGGW','LTN','London Luton'],['EGSS','STN','London Stansted'],
  ['LFPG','CDG','Paris Charles de Gaulle'],['LFPO','ORY','Paris Orly'],['EHAM','AMS','Amsterdam Schiphol'],
  ['EDDF','FRA','Frankfurt'],['EDDM','MUC','Munich'],['EDDB','BER','Berlin Brandenburg'],['LEMD','MAD','Madrid'],
  ['LEBL','BCN','Barcelona'],['LIRF','FCO','Rome Fiumicino'],['LIMC','MXP','Milan Malpensa'],['LSZH','ZRH','Zürich'],
  ['LSGG','GVA','Geneva'],['LOWW','VIE','Vienna'],['EBBR','BRU','Brussels'],['EKCH','CPH','Copenhagen'],
  ['ESSA','ARN','Stockholm Arlanda'],['ENGM','OSL','Oslo'],['EFHK','HEL','Helsinki'],['EIDW','DUB','Dublin'],
  ['LPPT','LIS','Lisbon'],['LGAV','ATH','Athens'],['LTFM','IST','Istanbul'],['UUEE','SVO','Moscow Sheremetyevo'],
  ['EPWA','WAW','Warsaw'],['LKPR','PRG','Prague'],['LHBP','BUD','Budapest'],['EGCC','MAN','Manchester'],
  // ── Middle East, Africa, Asia-Pacific ──
  ['OMDB','DXB','Dubai'],['OMAA','AUH','Abu Dhabi'],['OTHH','DOH','Doha'],['OERK','RUH','Riyadh'],['OEJN','JED','Jeddah'],
  ['LLBG','TLV','Tel Aviv'],['HECA','CAI','Cairo'],['FAOR','JNB','Johannesburg'],['FACT','CPT','Cape Town'],
  ['DNMM','LOS','Lagos'],['HKJK','NBO','Nairobi'],['GMMN','CMN','Casablanca'],
  ['RJTT','HND','Tokyo Haneda'],['RJAA','NRT','Tokyo Narita'],['RKSI','ICN','Seoul Incheon'],['ZBAA','PEK','Beijing Capital'],
  ['ZSPD','PVG','Shanghai Pudong'],['VHHH','HKG','Hong Kong'],['RCTP','TPE','Taipei Taoyuan'],['WSSS','SIN','Singapore Changi'],
  ['VTBS','BKK','Bangkok Suvarnabhumi'],['WMKK','KUL','Kuala Lumpur'],['WIII','CGK','Jakarta'],['VIDP','DEL','Delhi'],
  ['VABB','BOM','Mumbai'],['YSSY','SYD','Sydney'],['YMML','MEL','Melbourne'],['YBBN','BNE','Brisbane'],['NZAA','AKL','Auckland']
];

let _acIdx = -1;

function _acToken(input) {
  const pos = (input.selectionStart != null) ? input.selectionStart : input.value.length;
  const before = input.value.slice(0, pos);
  const m = before.match(/[A-Za-z]{1,4}$/);
  return m ? { token: m[0].toUpperCase(), start: pos - m[0].length, pos: pos } : null;
}

function airportAC(input) {
  const menu = document.getElementById('airportAC');
  if (!menu) return;
  const tk = _acToken(input);
  if (!tk || tk.token.length < 2) { airportACHide(); return; }
  const T = tk.token;
  const matches = [];
  for (let i = 0; i < AIRPORTS.length && matches.length < 8; i++) {
    const a = AIRPORTS[i], icao = a[0], iata = a[1], name = a[2];
    let code = null;
    if (icao.indexOf(T) === 0) code = icao;
    else if (iata.indexOf(T) === 0) code = iata;
    else if (name.toUpperCase().indexOf(T) !== -1) code = icao;
    if (code) matches.push({ code: code, icao: icao, iata: iata, name: name });
  }
  if (!matches.length) { airportACHide(); return; }
  _acIdx = -1;
  menu.innerHTML = matches.map(function (m) {
    return '<div class="ac-item" role="option" data-code="' + m.code + '" ' +
      'onmousedown="event.preventDefault()" onclick="airportACPick(\'' + m.code + '\')">' +
      '<b>' + esc(m.icao) + '</b> <span class="ac-iata">' + esc(m.iata) + '</span> ' +
      '<span class="ac-name">' + esc(m.name) + '</span></div>';
  }).join('');
  menu.classList.add('show');
}

function airportACKey(e, input) {
  const menu = document.getElementById('airportAC');
  if (!menu || !menu.classList.contains('show')) return;
  const items = menu.querySelectorAll('.ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); _acIdx = Math.min(items.length - 1, _acIdx + 1); _acHi(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _acIdx = Math.max(0, _acIdx - 1); _acHi(items); }
  else if (e.key === 'Enter') { if (_acIdx >= 0) { e.preventDefault(); airportACPick(items[_acIdx].getAttribute('data-code')); } }
  else if (e.key === 'Escape') { airportACHide(); }
}

function _acHi(items) {
  items.forEach(function (el, i) { el.classList.toggle('on', i === _acIdx); });
  if (_acIdx >= 0 && items[_acIdx]) items[_acIdx].scrollIntoView({ block: 'nearest' });
}

function airportACPick(code) {
  const input = document.getElementById('f-route');
  if (!input) return;
  const tk = _acToken(input);
  const pos = (input.selectionStart != null) ? input.selectionStart : input.value.length;
  if (tk) {
    const v = input.value;
    input.value = v.slice(0, tk.start) + code + v.slice(pos);
    const np = tk.start + code.length;
    try { input.setSelectionRange(np, np); } catch (e) {}
  } else {
    input.value += code;
  }
  airportACHide();
  input.focus();
}

function airportACHide() {
  const menu = document.getElementById('airportAC');
  if (menu) { menu.classList.remove('show'); menu.innerHTML = ''; }
  _acIdx = -1;
}
