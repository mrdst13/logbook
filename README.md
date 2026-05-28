# Cumulo Flight Deck

**A modern pilot logbook, built by a pilot.**

A digital logbook with Transport Canada PDF format (TP 14052), automatic Night calculation per RAC 101.01, Cross-Country detection per CAR 401.34, and iCal roster sync for airlines that publish a webcal:// feed.

Local-first storage on your device. Optional cloud backup hosted in Canada — subject to Canadian privacy law.

**Live**: [flycumulo.ca](https://flycumulo.ca) · [Demo (no signup)](https://flycumulo.ca/demo) · [Security whitepaper](https://flycumulo.ca/security)

---

## Status

**Phase 0bis Lean Validation** (May 2026). Pre-launch beta with 5-10 Porter Airlines pilots before public launch.

This repo is currently the property of [mrdst13](https://github.com/mrdst13). Closed-source during commercial validation. May open-source client-side TC compliance code post-launch.

---

## Features

- **Auto-sync your schedule** from Navblue iCal (Porter), plus PDF roster import for Jazz CrewTrac, WestJet Sabre, Air Canada AIMS, and any 703/704/705 carrier
- **Night & Cross-Country auto-calculated** per RAC 101.01 and CAR 401.34
- **TC-ready PDF export** in 38-column TP 14052 format with cumulative totals, signature line, and currency annex
- **All pilot types** — Airline F/O / Captain · Bush (floats/skis/amphib) · Helicopter · Flight Instructor · Private GA · Student
- **Bilingual EN / FR** with Quebec-correct terminology (LPRPDE, OACI, copilote)
- **Offline-first** — log a flight in the cockpit between duties, syncs when back online
- **Captain-name privacy** — third-party crew names anonymized at egress per PIPEDA Principle 4.3
- **Your data, your ownership** — export to JSON or PDF anytime, delete anytime

---

## Tech stack

- **Frontend**: Vanilla JavaScript, no framework. 21 source files in `src/` concatenated by `build.js` into a single `logbook.html` (~520 KB, ~11,500 lines)
- **Build**: `node build.js` (zero dependencies, no npm install required for production builds)
- **Hosting**: [Cloudflare Pages](https://pages.cloudflare.com) (auto-deploy on push to `main`)
- **Worker**: [Cloudflare Worker](https://workers.cloudflare.com) (proxies Anthropic API + Navblue iCal CORS)
- **Database** (in development): [Supabase](https://supabase.com) ca-central-1 (Montréal)
- **Auth**: Supabase Auth — email + password + TOTP 2FA + email backup code + trust device (no SMS)
- **PDF export**: client-side via [jsPDF](https://github.com/parallax/jsPDF)
- **PDF parser**: client-side via [pdf.js](https://mozilla.github.io/pdf.js/)
- **OCR**: [Anthropic Claude API](https://docs.anthropic.com) via Cloudflare Worker proxy
- **CSS**: 8 stylesheet files using CSS custom properties (no preprocessor)

---

## Local development

```sh
git clone https://github.com/mrdst13/logbook.git
cd logbook
node build.js
# Open logbook.html in browser
```

Production deploy happens automatically when you push to `main` (Cloudflare Pages watches the repo).

### Source structure

```
src/
├── head.html <!-- <head> + CDN scripts -->
├── body.html <!-- HTML markup -->
├── styles/
│ ├── 01-tokens.css Design tokens (colors, spacing, radius)
│ ├── 02-base.css Reset + base elements
│ ├── 03-layout.css Header, sidebar, page layout
│ ├── 04-content.css Hero, cards, content blocks
│ ├── 05-components.css Tables, modals, forms, pills
│ ├── 06-features.css Feature-specific styles (import, recap, glossary)
│ ├── 07-responsive.css Mobile breakpoints
│ └── 08-auth.css Supabase auth modal
└── js/
 ├── 00-core.js DB module, anonymizeCaptainName, esc helper, demo mode
 ├── 01-router.js Page routing (showPage)
 ├── 02-data.js calcStats, recalc engine, snapshots, undo
 ├── 03-dashboard.js Dashboard render + alerts + currency cards
 ├── 04-logbook.js Logbook table render + flight detail
 ├── 05-form-helpers.js Flight form save/edit/delete
 ├── 06-photo-import.js Photo OCR import via Anthropic Vision
 ├── 07-profile.js Profile management + pilot type adaptation
 ├── 08-flight-form.js LOGBOOK_COLUMNS schema + Navblue iCal sync + crew extraction
 ├── 09-onboarding.js First-launch wizard (4 steps)
 ├── 10-pdf-roster.js PDF roster import (Navblue / CrewTrac / Sabre / AIMS)
 ├── 11-columns-backup.js Column picker + backup/restore + deleteAccountPurge
 ├── 12-pdf-export.js TC TP 14052 PDF generator
 ├── 13-qa-signature-glossary.js Q&A + signature pad + 53-acronym glossary
 ├── 14-recap.js Year recap statistics + chart
 ├── 15-dark-toast.js Dark mode + toast notifications
 ├── 16-csv-import.js CSV import (ForeFlight, LogTen Pro, MyFlightbook, Logbook Pro, Safelog + wizard)
 ├── 17-i18n.js Bilingual EN/FR dictionary + lang switcher
 ├── 18-supabase.js Supabase Auth module + auth modal (skeleton — needs project URL+key)
 ├── 19-sync.js Supabase sync + offline queue + migration
 └── 99-init.js App bootstrap
```

---

## Configuration

To run the full Supabase sync features:

1. Create a Supabase project in `ca-central-1` (Montréal). [See setup guide →](SUPABASE-SETUP-GUIDE.md)
2. Edit `src/js/18-supabase.js` and fill in your `SUPABASE_URL` and `SUPABASE_ANON_KEY` constants.
3. Run the SQL from `supabase/schema.sql` in your Supabase SQL editor.
4. Rebuild (`node build.js`) and push.

The app runs in **localStorage-only mode** if the keys are blank — Supabase code is no-op until configured. This is intentional: you can develop and demo without a Supabase project.

### Demo mode

Append `?demo=1` to the logbook URL to enter sandbox mode: 5 pre-filled flights, all writes silently swallowed. Used for the public-facing `demo.html` so curious pilots can try without signup.

---

## Compliance basis

- **CAR 401.08** — Personal logbook requirements (record-keeping, retention 5 years)
- **CAR 401.05** — Recency requirements (5 TO/LDG / 6 months, IFR 6 approaches / 6 months)
- **CAR 401.34** — Cross-country flight (> 25 NM)
- **CAR 421.34** — ATPL experience requirements (including dual-given for CFI)
- **TC Standard 421** — Personnel Licensing Standards
- **TP 14052** — Personal log sample format
- **RAC 101.01** — Night definition (sunrise/sunset based)
- **PIPEDA** — Personal Information Protection and Electronic Documents Act (federal)
- **Loi 25** — Quebec privacy law (Bill 64, in force Sept 2024)

---

## License

All rights reserved. © 2026 Cumulo Inc.

Commercial use, redistribution, modification, or copying without explicit written permission is prohibited.

---

## Contact

- **Email**: flycumulo@gmail.com
- **Security issues**: same email, subject "Security"
- **Domain**: [flycumulo.ca](https://flycumulo.ca)
