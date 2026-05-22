# Supabase setup guide — Cumulo Flight Deck

À faire par Martin **après cette session**, avant de tester l'auth end-to-end.
Estimé : **15–25 minutes**, écran par écran.

Le code skeleton est déjà commité — il tourne en mode "skeleton" (no-op) tant que les 2 valeurs ci-dessous ne sont pas remplies. Aucun risque de casser la production.

---

## Étape 1 — Créer le project Supabase (5 min)

1. Ouvrir https://supabase.com et se connecter (créer un compte avec **flycumulo@gmail.com** si pas encore fait — utiliser Bitdefender pour générer + stocker le mot de passe).
2. Cliquer **New project**.
3. Remplir :
   - **Name** : `cumulo-flight-deck`
   - **Database password** : générer via Bitdefender (16+ caractères). **Stocker dans le coffre Bitdefender** sous "Supabase DB password — cumulo-flight-deck". Cumulo n'utilise jamais ce password directement (les requêtes passent par l'anon key), mais on en a besoin pour la console SQL et le futur backup.
   - **Region** : **`Central Canada (ca-central-1)`** ← non-négociable (data residency PIPEDA)
   - **Pricing plan** : Free (suffit pour Phase 1 + 2 ; on upgradera quand on dépasse les limites)
4. Cliquer **Create new project**. Attendre ~2 min que le provisioning finisse.

---

## Étape 2 — Exécuter le schema SQL (3 min)

1. Dans le dashboard Supabase, menu gauche → **SQL Editor**.
2. Cliquer **New query**.
3. Ouvrir le fichier `supabase/schema.sql` (dans le repo Cumulo) avec VS Code. Copier **tout** le contenu.
4. Coller dans le SQL Editor.
5. Cliquer **Run** (en bas à droite). Vérifier que le résultat dit `Success. No rows returned`.
6. (Optionnel mais recommandé) Coller et exécuter les 3 requêtes de vérification commentées en bas du fichier — confirme que RLS est ON et que les policies sont créées.

**Si erreur** : copier le message d'erreur exact et le partager à la prochaine session Claude. Ne pas continuer.

---

## Étape 3 — Récupérer URL + anon key (2 min)

1. Dans le dashboard Supabase, menu gauche → **Settings** (icône engrenage) → **API**.
2. Copier **2 valeurs** :
   - **Project URL** : ressemble à `https://abcdefghijk.supabase.co`
   - **anon public** key (dans "Project API keys") : long JWT qui commence par `eyJhbGciOi...`

3. Ouvrir `src/js/18-supabase.js` dans VS Code.
4. Trouver les 2 lignes :
   ```js
   const SUPABASE_URL = '';
   const SUPABASE_ANON_KEY = '';
   ```
5. Coller les 2 valeurs entre les `'` :
   ```js
   const SUPABASE_URL = 'https://abcdefghijk.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
6. Sauvegarder.

**⚠️ La `service_role` key (autre clé dans la même page) ne va JAMAIS dans le code client.** Si tu la vois, ferme la page. Cette clé contourne la RLS et pourrait permettre à n'importe qui de lire toutes les données de tous les pilotes.

---

## Étape 4 — Rebuild + push (2 min)

Dans le worktree Cumulo :

```pwsh
node build.js
git add -A
git commit -m "Supabase auth + sync: fill URL + anon key"
git push
```

Cloudflare Pages auto-déploie en ~30 sec. Refresh `logbook-cxy.pages.dev` après le déploiement.

---

## Étape 5 — Configurer le custom SMTP (5 min) **important**

Sinon Supabase enverra les emails de signup/reset avec son SMTP par défaut qui :
- Rate-limit à 2 emails/heure (bloquant pour le show aux collègues)
- Sender = `noreply@mail.app.supabase.io` (looks unprofessional)

Setup Resend free (3000 emails/mois gratuits) :

1. https://resend.com — sign up avec flycumulo@gmail.com.
2. **Domains** → **Add domain** → `flycumulo.ca`. Suivre les instructions DNS dans Cloudflare (3 records : SPF, DKIM, MX optionnel). Attendre la vérification (5-30 min).
3. **API Keys** → **Create** → name `cumulo-supabase`. Copier la clé (commence par `re_`). Stocker dans Bitdefender.
4. Retour dans Supabase Dashboard → **Settings** → **Auth** → **SMTP Settings** :
   - **Enable Custom SMTP** : ON
   - **Sender email** : `noreply@flycumulo.ca`
   - **Sender name** : `Cumulo`
   - **Host** : `smtp.resend.com`
   - **Port** : `465`
   - **Username** : `resend`
   - **Password** : (la clé Resend `re_...`)
   - **Min interval** : `1` (seconde)
5. **Save**. Tester en cliquant **Send test email** → ton hotmail.

---

## Étape 6 — Premier test end-to-end (3 min)

1. Ouvrir `logbook-cxy.pages.dev` (passer Cloudflare Access avec ton OTP).
2. Tu devrais voir un bouton "Sign in" dans le header (apparaît seulement si Supabase est correctement configuré).
3. Cliquer "Sign in" → "Create an account".
4. Email : flycumulo@gmail.com, password : 12+ caractères (Bitdefender).
5. Vérifier ton inbox → cliquer le lien de confirmation Supabase.
6. Retour dans l'app → "Sign in" avec les mêmes credentials.
7. Si tu as déjà des vols dans localStorage : prompt de migration apparaît. Accepter.
8. Vérifier dans Supabase Dashboard → **Table Editor** → **flights** : tes vols sont là.

---

## En cas de problème

- **"Auth not configured" toast** : tu as oublié de remplir une des 2 valeurs étape 3, ou il y a un typo. Re-vérifier.
- **CSP error dans console** : refresh dur (Ctrl+Shift+R). Si persistant : me dire dans la prochaine session, on ajustera le CSP.
- **"permission denied for table X"** : la GRANT n'a pas été exécutée. Re-faire l'étape 2.
- **Email de confirmation jamais reçu** : étape 5 pas faite, ou domaine Resend pas encore vérifié. Vérifier les spam aussi.

---

## Ce qui reste à coder après que tout ça marche

Le skeleton couvre signup, signin, MFA enrollment, password reset (avec deep-link), migration localStorage → Supabase (avec resume cursor + 24h cooldown sur cancel), et auto-sync débouncé sur DB.save (avec LWW _updated_at marker). **Pas encore** wired, à régler après première démo cross-device réussie :

**Sécurité (Phase 1.1)** :
- **AAL2 enforcement à la RLS** : actuellement les policies RLS acceptent role `authenticated` (= AAL1). Idéalement on devrait exiger AAL2 pour les écritures sur `flights` une fois que TOTP est enrôlé. Le code fait un `signOut` si l'utilisateur abandonne le MFA challenge — mais un meilleur fix server-side existerait.
- **SRI hash sur le script Supabase CDN** dans `head.html`. Pinned version sans intégrité = risque si jsdelivr est compromis. À ajouter dès que le premier déploiement est confirmé bon (le hash sera affiché dans la console du navigateur la première fois).
- **Backup codes post-MFA enrollment** : Supabase n'en émet pas auto. Il faut les générer + hasher nous-mêmes côté schéma (`mfa_backup_codes` table) et forcer le user à les télécharger/imprimer.
- **Trust device 60 jours** : table `trusted_devices` créée dans le SQL, mais flow client absent. Pattern complet documenté dans `18-supabase.js`.

**Data sync (Phase 2.1)** :
- **Delete reconciliation** : un vol supprimé sur Device A ne disparaît PAS de Device B. Pas de tombstones aujourd'hui. Solution : ajouter colonne `deleted_at timestamptz` + UPDATE soft-delete + filtre dans `pullFlights`.
- **Diff sync** : `pushAllFlights` re-pushe tous les vols à chaque débounce. Acceptable < 500 vols, wasteful au-delà. Solution : track `last_pushed_at` per device et n'envoyer que les rows modifiés depuis.
- **Real-time subscriptions** : pour voir un vol pushé par un autre device apparaître sans reload. Supabase Realtime (RLS-aware) est gratuit jusqu'à 200 connexions concurrentes.
- **Custom SMTP via Resend** : étape 5 de ce guide. Sans ça, signup public se fait rate-limit à 2 emails/heure.

**Bugs connus du skeleton** (non-bloquants pour test solo, à régler avant collègues) :
- Migration sur un device frais (0 vols local) tagge "complete" même si Device A a uploadé 4000 vols → pull les récupère ensuite, donc OK en pratique.
- Si user change EN↔FR pendant que l'auth modal est ouvert, le modal garde l'ancienne langue (besoin de re-call `AuthUI.render()` dans `setLang`).
- localStorage cleared mid-session = session perdue + migration re-prompt. Pas catastrophique.
