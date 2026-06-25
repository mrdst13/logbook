# Registre réglementaire — Cumulo

**Règle dure :** aucun chiffre, seuil ou définition réglementaire ne va dans le code
ou le texte de l'app **sans une entrée ici**, avec **citation exacte + lien source +
date de vérification**. Si on ne peut pas citer la source, on ne l'écrit pas : on
demande ou on laisse vide. On **consulte ce registre** avant d'écrire/modifier une
règle — on ne re-devine jamais de mémoire.

Source primaire = laws-lois.justice.gc.ca (CARs SOR/96-433) et tc.canada.ca (Standards/CASS).

## 🔤 GLOSSAIRE TERMINOLOGIQUE FR (termes officiels — copier VERBATIM)
Règle : pour un terme d'aviation FR, **copier le terme officiel ci-dessous mot pour mot**.
Interdit de substituer un terme informel « pour la cohérence » ou de « standardiser plus tard ».
Si le terme n'est pas ici, le vérifier (laws-lois/tc.canada.ca) PUIS l'ajouter ici AVANT de l'écrire dans le code.

| Concept (EN) | Terme officiel FR | Source | Bannis (ne jamais utiliser) |
|---|---|---|---|
| Hood / view-limiting device | **dispositif limitant la vue** | CI 401-004 ; RAC DORS/96-433 (laws-lois, vérifié 2026-06-25) | ❌ « cagoule » (= masque de voleur), ❌ « capot »/« sous capot » (informel) |
| Night | nuit (fin du crépuscule civil → début du crépuscule civil) | CAR/RAC 101.01 | — |
| Cross-country | cross-country (gardé EN, standard Cumulo) | — | — |

| Statut | Sens |
|---|---|
| ✅ vérifié | Cité, conforme au règlement, implémenté correctement |
| ⚠️ écart | Vérifié, mais le code ne correspond pas encore au règlement (à corriger) |
| ⏳ à vérifier | Présent dans le code, pas encore vérifié contre la source |

---

## ✅ Nuit (jour/nuit)
- **Règle (CAR 101.01)** : « *night means the time between the end of evening civil twilight and the beginning of morning civil twilight* ». Jour = entre le début du crépuscule civil du matin et la fin du crépuscule civil du soir.
- **Implémentation** : `isNightUTC()` / `calcSunriseSunset(...,96)` — crépuscule civil = soleil 6° sous l'horizon (zénith 96°). [src/js/08-flight-form.js:413](../src/js/08-flight-form.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-101.01.html
- **Vérifié** : 2026-06-25 ✓ conforme.

## ✅ Cross-country (XC)
- **Règle (CAR 101.01 — déf. « cross-country flight time »)** : route pré-planifiée vers une destination « *at least 25 nautical miles from the point of departure* » (≥ 25 NM).
- **Implémentation** : `isCrossCountry()` → distance haversine ≥ 46,3 km (= 25 NM). [src/js/08-flight-form.js:358](../src/js/08-flight-form.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-101.01.html
- **Vérifié** : 2026-06-25 ✓ (note : « at least » = ≥, code corrigé de `> 46.3` à `>= 46.3`).
- ⚠️ NB : la citation « CAR 401.34 » dans le code/glossaire est imprécise — la définition vit dans **101.01**. À harmoniser dans le copy.

## ✅ Récence passagers — jour (décollages/atterrissages)
- **Règle (CAR 401.05(2)(b))** : 5 décollages + 5 atterrissages dans les **6 mois** précédents, « *in the same category and class of aircraft ... or in a Level B, C or D full-flight simulator of the same category and class* ».
- **Implémentation** : `_dashTakeoffsIn6mo` / `_dashLandingsIn6mo` + `countsTowardRecency()` (FFS niveau B/C/D comptent ; FTD/FNPT/BITD non) + `sixMonthCutoffStr()` (6 mois calendaires). [src/js/02-data.js](../src/js/02-data.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html
- **Vérifié** : 2026-06-25 ✓.

## ✅ Récence IFR (validité instrument)
- **Règle (CAR 401.05(3.1))** : dans les **6 mois**, « *acquired six hours of instrument time* » **ET** « *completed six instrument approaches in an aircraft in actual or simulated IMC, or in a Level B, C or D simulator* ».
- **« instrument time » (CAR 101.01)** : « *(a) instrument ground time, (b) actual instrument flight time, or (c) simulated instrument flight time* » → le temps en **simulateur compte**.
- **Implémentation** : `_dashIFRCurrency()` exige `approaches ≥ 6` **ET** `instrumentTime ≥ 6 h` ; temps = `instActual + instHood + instSim`. Anneau + carte statut + drilldown affichent le facteur limitant. [src/js/02-data.js](../src/js/02-data.js), [src/js/21-dash-drilldown.js](../src/js/21-dash-drilldown.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html + .../section-101.01.html
- **Vérifié** : 2026-06-25 ✓ (unit-testé : 6appr/4h→non à jour, 6appr/6h(sim)→à jour, 3appr/7h→non à jour).

## ✅ Récence passagers — NUIT
- **Règle (CAR 401.05(2)(b)(i)(B))** : 5 décollages de nuit + 5 atterrissages de nuit dans les 6 mois si le vol est « *five night take-offs and five night landings, if the flight is conducted wholly or partly by night* » (aéronef ou FFS niveau B/C/D). NB : exemption existante pour certaines exploitations.
- **Implémentation** : drilldown « Expérience récente » affiche jour ET nuit. Nuit = somme `toNight` / `ldgNight` des vols admissibles (jamais inféré — un décollage de jour peut précéder un atterrissage de nuit) ; sim limité aux FFS via `countsTowardRecency`. Présenté comme indicateur informatif (pas un blocage) + note exemption « référez-vous à votre exploitant ». [src/js/21-dash-drilldown.js](../src/js/21-dash-drilldown.js)
- **Source** : https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-401.05-20251217.html
- **Vérifié** : 2026-06-25 ✓ (donnée décollages jour/nuit ajoutée au formulaire le même jour).

---

## ⏳ À VÉRIFIER (présent dans le code, pas encore confirmé contre la source)
- **CAR 401.08 / 401.08(2)(h)** — contenu obligatoire du carnet (colonnes). [04-logbook, 12-pdf-export, 13-glossaire]
- **CASS 725.106** — validité PPC (705 multi-équipage) : période exacte + intervalle. Le code traite le PPC comme une date saisie par le pilote (`ppcDueDate`) ; l'échelle de l'anneau (180 j) est cosmétique. À confirmer.
- **CAR 401.34 / Standard 421.34** — usage exact (vs 101.01 pour la déf. XC).
- **CAR 401.73** — récence/rafraîchissement (glossaire).
- **CAR 605.x** (605.97 etc.) — exigences carnet de route / documents (glossaire).
- **CAR 401.05(1)** — récence 5 ans / programme de formation.

> Tenir à jour : toute nouvelle règle réglementaire ajoutée au code DOIT apparaître ici
> avec sa source vérifiée le jour où elle est écrite.
