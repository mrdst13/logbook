# Worker Cloudflare — Mise à jour pour Navblue iCal Sync

## Ce qu'il faut faire

Ton Worker actuel à `logbook-api.martindaoust33.workers.dev` ne sait que proxy vers Anthropic API.
On doit lui ajouter un second comportement : **proxy les requêtes Navblue iCal** (sinon CORS bloque le browser).

## Comment

1. Ouvre [dash.cloudflare.com](https://dash.cloudflare.com) → ton compte
2. Workers & Pages → **logbook-api** → "Edit code"
3. **Remplace tout le code** par celui ci-dessous
4. Clique **"Save and Deploy"**
5. Reviens dans Cumulo → Settings → Navblue iCal → colle ton URL → Sync now

---

## Code à coller (Worker complet)

```javascript
// ─── CORS preflight + response headers ───
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    // Parse incoming body
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON in request body', 400);
    }

    // ─── ROUTE 1: Navblue iCal fetch (proxy) ───
    if (body.action === 'fetch-ics') {
      return await handleFetchICS(body);
    }

    // ─── ROUTE 2: Anthropic API proxy (default — existing behavior) ───
    return await handleAnthropic(body, env);
  }
};

// ────────────────────────────────────────────────────────────────
//  Navblue iCal proxy
// ────────────────────────────────────────────────────────────────
async function handleFetchICS(body) {
  let url = (body.url || '').trim();
  if (!url) return jsonError('Missing url field', 400);

  // Normalize webcal:// → https://
  url = url.replace(/^webcal:\/\//i, 'https://');

  // Whitelist: only Navblue domains
  if (!/^https:\/\/[^/]+\.navblue\.cloud\//i.test(url)) {
    return jsonError('URL must be a navblue.cloud domain', 400);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Cumulo-Logbook/1.0 (Pilot logbook app)',
        'Accept': 'text/calendar, text/plain, */*'
      }
    });

    if (!resp.ok) {
      return jsonError(`Navblue returned ${resp.status}`, 502);
    }

    const ics = await resp.text();

    return new Response(ics, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/calendar; charset=utf-8'
      }
    });
  } catch (e) {
    return jsonError(`Fetch failed: ${e.message}`, 502);
  }
}

// ────────────────────────────────────────────────────────────────
//  Anthropic API proxy (existing — for photo / PDF imports)
// ────────────────────────────────────────────────────────────────
async function handleAnthropic(body, env) {
  // Your Anthropic API key must be set as a Worker secret named ANTHROPIC_API_KEY
  // (via Cloudflare dashboard → Settings → Variables)
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonError('ANTHROPIC_API_KEY not configured in Worker', 500);
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return jsonError(`Anthropic proxy failed: ${e.message}`, 502);
  }
}

// ────────────────────────────────────────────────────────────────
//  Helper
// ────────────────────────────────────────────────────────────────
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}
```

---

## ⚠️ Vérifications avant de cliquer "Save and Deploy"

1. **`ANTHROPIC_API_KEY`** est une variable d'environnement Worker :
   - Settings → Variables → Add variable → name = `ANTHROPIC_API_KEY` → encrypt
   - Sans elle, l'import PDF Anthropic ne marchera plus

2. **Le whitelist** `navblue.cloud` empêche que quelqu'un détourne ton Worker pour proxy n'importe quel site. Sûr.

3. **Pas de stockage** : le Worker ne garde aucune URL ni donnée. Juste relay.

---

## Test après déploiement

Dans Cumulo (recharge la page d'abord) :

1. Va dans **Settings** (icône ⚙ en bas de la sidebar)
2. Section **🔄 Navblue iCal Auto-Sync** tout en haut
3. Colle ton URL Navblue (commence par `webcal://` ou `https://poe.noc.vmc.navblue.cloud/...`)
4. Clique **💾 Save URL** → toast "Navblue URL saved ✓"
5. Clique **🔄 Sync now** → "X new flights ready to review"
6. Aperçu des vols → tu peux cocher/décocher → **✅ Import**

Si erreur, ouvre la **console (F12)** — tous les logs sont préfixés `[Navblue Sync]`.

---

## En cas de problème

- **"Worker error 500: ANTHROPIC_API_KEY not configured"** → ajoute la variable d'env
- **"Response does not look like an iCal calendar"** → le Worker n'a pas le bon code (pas déployé ?)
- **"URL must be a navblue.cloud domain"** → ton URL est mauvaise
- **"Navblue returned 401/403"** → ton token Navblue est invalide, regénère-le
