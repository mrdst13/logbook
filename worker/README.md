# Cumulo Worker

Hardened Cloudflare Worker that fronts the Anthropic API + a Navblue iCal
fetch proxy for the Cumulo Flight Deck PWA.

Deployed at: `https://logbook-api.martindaoust33.workers.dev`

## Why this exists

The browser PWA can't call `api.anthropic.com` directly:
- the API key would be exposed in client JS
- the iCal endpoint at `*.navblue.cloud` has no CORS headers, so a browser
  fetch is blocked

This Worker is the thin server-side layer that:
1. Holds the Anthropic API key as a Cloudflare Secret (never in client)
2. Proxies POST requests to `api.anthropic.com/v1/messages`
3. Server-side fetches the user's Navblue iCal feed and streams it back
   with proper CORS headers

## Security guarantees (defense in depth)

| Guard | What it does |
|---|---|
| Origin allow-list | Only requests with `Origin: https://flycumulo.ca` (+ www, legacy GH Pages, dev localhosts) pass — blocks browser abuse from other sites |
| Model allow-list | Only `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5*` accepted — bounds cost per request |
| `max_tokens` cap | Hard-coded ceiling of 2048 — bounds cost per request |
| Body size limit | 5 MB max (Content-Length check) — fits photo/PDF imports, blocks batch abuse |
| Generic error messages | No `env.X` reflection — keys can't leak through reflected error strings |
| Navblue SSRF lock | `fetch-ics` action only accepts URLs matching `https://*.navblue.cloud/` |
| Account-level spend cap | Anthropic console enforces a $/month ceiling — last-resort safety net |

## Files

```
logbook-api/
├── src/
│   └── index.ts          # Worker source (this is the only file with logic)
├── wrangler.jsonc        # Wrangler config — name, compatibility date, flags
├── package.json          # Wrangler + types
├── tsconfig.json         # TypeScript compiler config
├── worker-configuration.d.ts  # Auto-generated types from `wrangler types`
├── public/               # (empty — not serving static assets)
├── test/                 # (empty — no tests yet)
└── vitest.config.mts     # Vitest config (when tests get written)
```

## Required Cloudflare Secret

The Worker reads `env.ANTHROPIC_API_KEY` at runtime. Set it via:

```bash
cd worker/logbook-api
npx wrangler secret put ANTHROPIC_API_KEY
# paste the sk-ant-… key when prompted
```

Or via Cloudflare dashboard → Workers & Pages → logbook-api → Settings →
Variables and Secrets → Add (Type: Secret).

## Deploy

```bash
cd worker/logbook-api
npx wrangler deploy
```

Wrangler must be authenticated (`npx wrangler login`).

## Verify after deploy

```bash
# 1. Without Origin → 403
curl -X POST https://logbook-api.martindaoust33.workers.dev \
     -H "Content-Type: application/json" -d "{}"
# Expected: {"error":{"message":"Forbidden — origin not allowed"}}

# 2. With evil Origin → 403
curl -X POST https://logbook-api.martindaoust33.workers.dev \
     -H "Content-Type: application/json" -H "Origin: https://evil.com" -d "{}"
# Expected: same 403

# 3. With production Origin → 400 "Model not allowed"
#    (proves origin check passes AND the API key is wired)
curl -X POST https://logbook-api.martindaoust33.workers.dev \
     -H "Content-Type: application/json" -H "Origin: https://flycumulo.ca" -d "{}"
# Expected: {"error":{"message":"Model not allowed"}}
```

If test 3 returns `Service misconfigured` instead, the `ANTHROPIC_API_KEY`
secret is missing — re-run `wrangler secret put`.

## To do (future)

- Add `RATE_LIMITER` binding (Cloudflare's per-IP rate limit) for the
  Anthropic POST path
- Add a Supabase JWT verification step once the cloud backend is wired up
  (Phase 1 of the auth plan)
- Centralise logs via `console.log` → Workers Logs (already enabled in
  Cloudflare dashboard)

## Notes

- Source was pulled from the Cloudflare dashboard via
  `wrangler init --from-dash logbook-api` on 2026-05-28 (commit that adds
  this directory). Before that, the Worker source was tracked only as a
  fenced code block in `private/worker-update-INSTRUCTIONS.md` (moved out of the deployed tree, audit 2026-06-09) — a
  bus-factor / no-rollback risk flagged in the audit.
- Every deploy of this Worker preserves existing Cloudflare Secrets. The
  one time secrets were lost (2026-05-28 morning) was during the initial
  `wrangler deploy` from a fresh local project structure; subsequent
  deploys from this repo will keep them.
