# Worker Cloudflare — Hardening sécurité (urgent)

## Pourquoi cette mise à jour

L'audit sécurité a identifié que le Worker actuel (`logbook-api.martindaoust33.workers.dev`) est un **proxy Anthropic ouvert** : pas d'auth, CORS `*`, aucun plafond sur `max_tokens` ou le modèle demandé. N'importe qui sur internet peut l'utiliser comme LLM gratuit sur ta clé Anthropic — coût estimé d'une attaque soutenue : **50-150 $/heure** sur ton compte.

## Ce qui change vs version précédente

| Avant | Après |
|---|---|
| `Access-Control-Allow-Origin: *` | Allow-list explicite (`mrdst13.github.io` + localhost) |
| Modèle libre | Allow-list (`claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`) |
| `max_tokens` libre | Cap à 2048 |
| Pas de limite taille body | Cap à 5 MB |
| Messages d'erreur = `e.message` | Messages génériques (pas de leak `env` si modifié plus tard) |

Ces protections sont du **defense in depth** : aucune n'est parfaite seule (curl peut spoofer Origin), mais ensemble + le plafond Anthropic = abus borné à un coût négligeable.

---

## ÉTAPE 1 — Plafond de dépense Anthropic (FAIRE EN PREMIER)

C'est ta safety net. Même si tout le reste lâche, ton compte ne peut pas saigner au-delà du plafond.

1. Va sur [console.anthropic.com](https://console.anthropic.com)
2. Settings → **Limits** (ou "Spend limits", selon la version)
3. **Daily spend limit** → mets `5 $/jour` (ou ce que tu veux comme plafond max). Tu peux le remonter plus tard.
4. **Monthly spend limit** → mets `50 $/mois` au max
5. Save

Ça prend 30 secondes. Fait-le **avant** même de regarder le code en bas.

---

## ÉTAPE 2 — Déployer le nouveau Worker

1. [dash.cloudflare.com](https://dash.cloudflare.com) → ton compte → Workers & Pages → **logbook-api** → "Edit code"
2. **Sélectionne tout** (Ctrl+A) → **Supprime**
3. **Colle le code ci-dessous**
4. **Save and Deploy**

```javascript
// Cumulo Worker — hardened
// Changes from previous version:
//   - Origin allow-list (was CORS *)        → blocks browser abuse from other sites
//   - Model allow-list (was any)            → bounds cost per request
//   - max_tokens cap 2048 (was unbounded)   → bounds cost per request
//   - 5 MB body size limit                  → bounds batch abuse
//   - Generic error messages                → no env/key leak via error reflection

const ALLOWED_ORIGINS = new Set([
  'https://mrdst13.github.io',
  // Dev origins — leave for now, remove once Cumulo is on its own domain:
  'http://localhost',
  'http://localhost:8080',
  'http://127.0.0.1',
  'http://127.0.0.1:8080',
  'null' // file:// — covers local HTML opened directly
]);

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001'
]);

const MAX_TOKENS_CAP = 2048;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — fits photo/PDF imports

function pickCorsOrigin(request) {
  const origin = request.headers.get('Origin');
  return (origin && ALLOWED_ORIGINS.has(origin)) ? origin : null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || 'https://mrdst13.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    const origin = pickCorsOrigin(request);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      if (!origin) return new Response('Forbidden', { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    // Origin enforcement: blocks browser-based abuse from other sites.
    // Server-side curl can still spoof this, but per-request caps + Anthropic
    // daily spend cap bound the worst-case damage.
    if (!origin) {
      return jsonError('Forbidden — origin not allowed', 403, null);
    }

    // Body size guard
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonError('Request body too large', 413, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON', 400, origin);
    }

    if (body.action === 'fetch-ics') {
      return await handleFetchICS(body, origin);
    }
    return await handleAnthropic(body, env, origin);
  }
};

async function handleFetchICS(body, origin) {
  let url = (body.url || '').trim();
  if (!url) return jsonError('Missing url field', 400, origin);

  url = url.replace(/^webcal:\/\//i, 'https://');

  if (!/^https:\/\/[^/]+\.navblue\.cloud\//i.test(url)) {
    return jsonError('URL must be a navblue.cloud domain', 400, origin);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Cumulo-Logbook/1.0 (Pilot logbook app)',
        'Accept': 'text/calendar, text/plain, */*'
      }
    });
    if (!resp.ok) {
      console.error('[Worker] Navblue upstream status:', resp.status);
      return jsonError('Upstream Navblue error', 502, origin);
    }
    const ics = await resp.text();
    return new Response(ics, {
      status: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'text/calendar; charset=utf-8' }
    });
  } catch (e) {
    console.error('[Worker] Navblue fetch error:', e?.message);
    return jsonError('Upstream fetch failed', 502, origin);
  }
}

async function handleAnthropic(body, env, origin) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[Worker] ANTHROPIC_API_KEY missing in env');
    return jsonError('Service misconfigured', 500, origin);
  }

  // Bounded validation — limits cost per request even if origin is spoofed
  if (!body.model || !ALLOWED_MODELS.has(body.model)) {
    return jsonError('Model not allowed', 400, origin);
  }
  if (typeof body.max_tokens !== 'number' || body.max_tokens > MAX_TOKENS_CAP || body.max_tokens < 1) {
    return jsonError(`max_tokens must be 1..${MAX_TOKENS_CAP}`, 400, origin);
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
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('[Worker] Anthropic upstream error:', e?.message);
    return jsonError('Upstream service unavailable', 502, origin);
  }
}
```

---

## ÉTAPE 3 — Vérifier que le hardening fonctionne

Après le deploy, dans **PowerShell** :

```powershell
# Test 1 : sans Origin → doit retourner 403
curl.exe -X POST https://logbook-api.martindaoust33.workers.dev -H "Content-Type: application/json" -d "{}"

# Attendu : {"error":{"message":"Forbidden — origin not allowed"}}
```

```powershell
# Test 2 : avec Origin malicieux → doit retourner 403
curl.exe -X POST https://logbook-api.martindaoust33.workers.dev -H "Content-Type: application/json" -H "Origin: https://evil.com" -d "{}"

# Attendu : {"error":{"message":"Forbidden — origin not allowed"}}
```

```powershell
# Test 3 : avec ton Origin légitime → doit retourner 400 (Invalid model) — preuve que l'origin check passe
curl.exe -X POST https://logbook-api.martindaoust33.workers.dev -H "Content-Type: application/json" -H "Origin: https://mrdst13.github.io" -d "{}"

# Attendu : {"error":{"message":"Model not allowed"}}
```

Si les 3 tests donnent le résultat attendu, le hardening est en place.

---

## ÉTAPE 4 — Tester que l'app marche toujours

1. Recharge https://mrdst13.github.io/logbook/logbook.html
2. Settings → Navblue iCal → **Sync now** → doit marcher
3. (Optionnel) Q&A → pose une question → doit répondre

Si la sync ou Q&A retourne une erreur "Model not allowed", c'est qu'un modèle du client n'est pas dans le allow-list. Regarde la console (F12) pour voir lequel, et ajoute-le à `ALLOWED_MODELS` dans le Worker.

---

## En cas de problème

| Erreur | Cause | Fix |
|---|---|---|
| `Forbidden — origin not allowed` dans le browser | Tu testes depuis un autre domaine ou file:// | Recharge depuis `https://mrdst13.github.io/logbook/logbook.html` |
| `Model not allowed` après sync | Le client envoie un modèle pas dans la liste | Ajouter le modèle à `ALLOWED_MODELS` (ligne 19 du Worker) |
| `max_tokens must be 1..2048` | Le client demande > 2048 tokens | Soit baisser le `max_tokens` côté client, soit augmenter le cap (peser le coût) |
| `ANTHROPIC_API_KEY not configured` | Variable d'env manquante | Cloudflare dashboard → Settings → Variables → ajouter `ANTHROPIC_API_KEY` (encrypted) |

---

## Notes pour plus tard

- **Bearer token client-généré** : pourrait être ajouté plus tard, mais sans serveur d'auth ça reste contournable. La vraie auth viendra avec Supabase (Phase 1 du plan auth/sync).
- **Rate limiting par IP** : Cloudflare Workers a un binding `RATE_LIMITER` à configurer dans le dashboard (Settings → Rate Limiting). Pas urgent ce soir mais à brancher dans la prochaine itération.
- **Logs centralisés** : `console.error` apparaît dans les Workers Logs (dashboard → Logs). Active "Workers Logs" dans les settings du Worker pour les retenir.
