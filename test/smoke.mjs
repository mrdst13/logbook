// ═══════════════════════════════════════════════════════════════════
// SMOKE TEST — loads the real built app in a headless DOM and visits
// every page, the way a pilot's browser would.
//
// Why this exists: a shipped bug (showPage('dash') — a page id that does
// not exist) left the pilot staring at a blank screen, because every
// `.page` gets hidden before the (missing) target is shown. Nothing in the
// build caught it. This test drives the router across every navigable page
// and fails if any navigation leaves the app blank or throws — exactly the
// class of failure that reached production. Audit 2026-07, item 10.
//
// Deliberately dependency-light (jsdom only) and robust: external CDN
// scripts are NOT fetched, so the app runs on its own typeof guards (the
// same way it must degrade offline). We never treat console.error/warn as a
// failure — only a thrown exception or an actually-blank screen fails.
//
// Run:  npm test   (or  node test/smoke.mjs)
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'logbook.html'), 'utf8');

const failures = [];
const fail = (msg) => failures.push(msg);

// Surface jsdom-level script errors (uncaught throws during load) but keep
// ordinary console noise out of the pass/fail decision.
const vconsole = new VirtualConsole();
vconsole.on('jsdomError', (e) => fail('script error at load: ' + (e && (e.message || e))));

let dom;
try {
  dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://logbook-cxy.pages.dev/',
    virtualConsole: vconsole,
    beforeParse(window) {
      // The built page loads Chart.js / pdf.js / jsPDF / supabase-js from a
      // CDN via <script src>. jsdom does not fetch them; the app guards each
      // with `typeof`, except Chart, which renderDashboard() touches on load.
      // Stub Chart to a no-op so a missing CDN doesn't masquerade as a bug.
      const noopChart = function () { return { destroy() {}, update() {}, resize() {}, data: {}, options: {} }; };
      noopChart.register = () => {};
      window.Chart = noopChart;
      // jsdom lacks matchMedia; the app reads prefers-color-scheme / reduced-motion.
      if (!window.matchMedia) {
        window.matchMedia = () => ({
          matches: false, media: '', onchange: null,
          addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
        });
      }
      window.scrollTo = () => {};
    },
  });
} catch (e) {
  console.error('FATAL: the app threw before it could boot —', e && e.message);
  process.exit(1);
}

const { window } = dom;
const { document } = window;

// ── The app must have booted its router ──────────────────────────────
if (typeof window.showPage !== 'function') {
  fail('window.showPage is not a function — the bundle did not boot');
}

// ── One page must be active on first paint (never a blank screen) ────
const activeAtBoot = document.querySelectorAll('.page.active');
if (activeAtBoot.length !== 1) {
  fail(`on load: expected exactly 1 active page, found ${activeAtBoot.length}`);
}

// ── Visit every navigable page + the Add-Flight form ─────────────────
// Discover nav targets straight from the DOM so the test can't drift out
// of sync with the markup.
const navIds = [...new Set(
  [...document.querySelectorAll('[data-page]')].map((n) => n.dataset.page)
)];
const pagesToVisit = [...new Set([...navIds, 'add'])];

if (typeof window.showPage === 'function') {
  for (const id of pagesToVisit) {
    try {
      window.showPage(id);
    } catch (e) {
      fail(`showPage('${id}') threw: ${e && e.message}`);
      continue;
    }
    const active = document.querySelectorAll('.page.active');
    if (active.length === 0) {
      fail(`showPage('${id}') left a BLANK screen (no active page)`);
    } else if (active.length > 1) {
      fail(`showPage('${id}') left ${active.length} pages active`);
    } else if (active[0].id !== 'page-' + id) {
      fail(`showPage('${id}') activated '${active[0].id}', expected 'page-${id}'`);
    }
  }

  // ── Regression: the exact shipped bug ──────────────────────────────
  // An unknown page id must fall back to the dashboard, never blank out.
  try {
    window.showPage('dash'); // the id that shipped and blanked the screen
    const active = document.querySelectorAll('.page.active');
    if (active.length !== 1 || active[0].id !== 'page-dashboard') {
      fail(`showPage('dash') did not fall back to the dashboard (got ${active.length} active: ${[...active].map(a => a.id).join(',')})`);
    }
  } catch (e) {
    fail(`showPage('dash') threw instead of falling back: ${e && e.message}`);
  }
}

// ── Report ───────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ smoke test: ${failures.length} failure(s)\n`);
  for (const f of failures) console.error('  • ' + f);
  console.error('');
  process.exit(1);
}
console.log(`✓ smoke test passed — booted + visited ${pagesToVisit.length} pages, unknown-id fallback OK`);
process.exit(0);
