/* Bilingual toggle for the public static pages (privacy / security / landing).
 * CSP-safe: loaded as a same-origin script (default-src 'self'). No inline JS.
 * Content is duplicated in the page inside [data-l="en"] / [data-l="fr"] blocks
 * (shown/hidden by the body.en / body.fr class). Loi 25: French is available.
 *
 * The page provides FR/EN <title> via <body data-title-en="..." data-title-fr="...">.
 * Default <body class="en"> avoids a flash before this runs. Choice persists in
 * localStorage and otherwise follows the browser language.
 */
(function () {
  var KEY = 'cumulo_lang';
  function apply(l) {
    document.body.className = document.body.className.replace(/\b(en|fr)\b/g, '').trim();
    document.body.classList.add(l);
    document.documentElement.lang = l;
    var btn = document.getElementById('langBtn');
    if (btn) {
      btn.textContent = (l === 'fr' ? 'EN' : 'FR');
      btn.setAttribute('aria-label', l === 'fr' ? 'Switch to English' : 'Passer en français');
    }
    var tEn = document.body.getAttribute('data-title-en');
    var tFr = document.body.getAttribute('data-title-fr');
    if (tEn && tFr) document.title = (l === 'fr' ? tFr : tEn);
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  var lang = saved || (((navigator.language || 'en').toLowerCase().indexOf('fr') === 0) ? 'fr' : 'en');
  apply(lang);
  var btn = document.getElementById('langBtn');
  if (btn) btn.addEventListener('click', function () {
    var nl = document.body.classList.contains('fr') ? 'en' : 'fr';
    try { localStorage.setItem(KEY, nl); } catch (e) {}
    apply(nl);
  });
})();
