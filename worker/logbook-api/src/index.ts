// Cumulo Worker — hardened
// Source of truth for the Worker deployed at:
//   https://logbook-api.martindaoust33.workers.dev
//
// Security guarantees (defense in depth — hardened audit 2026-06-09):
//   - Origin allow-list           → blocks browser abuse from other sites
//   - IP rate limit (binding)     → bounds request volume per client
//   - Model allow-list            → bounds cost per request
//   - max_tokens cap              → bounds cost per request
//   - 5 MB body size limit        → measured on actual bytes, not the
//                                   client-supplied Content-Length header
//   - Field whitelist + server-side system prompt → the key cannot be
//     repurposed as a general LLM (no client tools/system passthrough)
//   - Generic error messages      → no env/key leak via error reflection
//   - iCal proxy: HTTPS-only + size cap + global_fetch_strictly_public
//                                 → any airline's public feed, no internal SSRF
//
// Auth posture (decided 2026-06-26): the Anthropic path is deliberately NOT
// gated behind a Supabase JWT. The paid AI call powers PDF-roster extraction,
// which pilots run during onboarding BEFORE they have an account — a JWT gate
// would break that core import flow (Cumulo is local-first; cloud is optional).
// The financial worst case is bounded by THREE layers: the Anthropic daily
// spend cap (set in the Anthropic console), the per-IP rate limit, and the
// origin allow-list. The /delete-account path below DOES require a verified
// Supabase user token (it's a destructive, per-user action).

const ALLOWED_ORIGINS = new Set([
  // Production
  'https://flycumulo.ca',
  'https://www.flycumulo.ca',
  // Cloudflare Pages canonical URL — this is what the app actually serves
  // from in prod today (flycumulo.ca custom domain isn't wired through to
  // Pages yet — audit 2026-05-29). Without this entry, the browser sends
  // Origin: https://logbook-cxy.pages.dev and the Worker rejects with 403
  // ("Forbidden — origin not allowed"), which breaks Navblue iCal sync.
  'https://logbook-cxy.pages.dev',
  // Legacy GitHub Pages preview (kept while DNS migration finishes — remove after)
  'https://mrdst13.github.io',
  // Dev origins:
  'http://localhost',
  'http://localhost:8080',
  'http://localhost:8181',
  'http://127.0.0.1',
  'http://127.0.0.1:8080'
  // 'null' (file://) intentionally NOT allowed: sandboxed iframes on any
  // website also send Origin: null, which would let drive-by pages call
  // this worker from victims' browsers (audit 2026-06-09). For local dev,
  // serve over http://localhost instead of opening the file directly.
]);

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001'
]);

// 8192 covers the largest real client request (Navblue PDF extraction asks
// for 8000) while still bounding the per-request output cost. The previous
// 2048 cap silently broke photo import (client asks for 4000).
const MAX_TOKENS_CAP = 8192;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — fits photo/PDF imports
const MAX_ICS_BYTES = 5 * 1024 * 1024;  // 5 MB — bounds the iCal proxy

// System prompt is pinned SERVER-SIDE. Any `system` sent by the client is
// ignored, so a spoofed-origin caller cannot repurpose the key as a
// general-purpose assistant.
const SYSTEM_PROMPT =
  'You are a data extraction API for a pilot logbook app. You ONLY output ' +
  'valid JSON arrays. Never include explanations, markdown, or text outside ' +
  'the JSON array. If you cannot extract anything, return [].';

// Cloudflare rate-limiting binding (see wrangler.jsonc). Optional so the
// worker keeps running if the binding is absent in a dev environment.
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function pickCorsOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  return (origin && ALLOWED_ORIGINS.has(origin)) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || 'https://flycumulo.ca',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonError(message: string, status: number, origin: string | null): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    // Rate limit per client IP (binding configured in wrangler.jsonc).
    const limiter = (env as Env & { RATE_LIMITER?: RateLimiter }).RATE_LIMITER;
    if (limiter) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      try {
        const { success } = await limiter.limit({ key: ip });
        if (!success) {
          return jsonError('Too many requests — slow down', 429, origin);
        }
      } catch (e: any) {
        // Limiter outage must not take the API down — log and continue.
        console.error('[Worker] rate limiter error:', e?.message);
      }
    }

    // Body size guard. Cheap fast-path reject on the declared length, then
    // enforce on the ACTUAL bytes read — Content-Length is client-supplied
    // and can be omitted or understated (audit 2026-06-09).
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonError('Request body too large', 413, origin);
    }
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return jsonError('Unreadable request body', 400, origin);
    }
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonError('Request body too large', 413, origin);
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonError('Invalid JSON', 400, origin);
    }

    if (body.action === 'fetch-ics') {
      return await handleFetchICS(body, origin);
    }
    if (body.action === 'delete-account') {
      return await handleDeleteAccount(body, env, origin);
    }
    return await handleAnthropic(body, env, origin);
  }
} satisfies ExportedHandler<Env>;

async function handleFetchICS(body: any, origin: string): Promise<Response> {
  let url = (body.url || '').trim();
  if (!url) return jsonError('Missing url field', 400, origin);

  // webcal:// is the calendar-subscription scheme — https underneath.
  url = url.replace(/^webcal:\/\//i, 'https://');

  // Accept ANY airline's public HTTPS iCal feed (not just Navblue) — Cumulo is
  // for all Canadian pilots. SSRF to internal/private/loopback addresses is
  // blocked by the global_fetch_strictly_public compat flag (wrangler.jsonc).
  // Only HTTPS is allowed and the response size is capped to bound proxy abuse.
  let parsed: URL;
  try { parsed = new URL(url); } catch { return jsonError('Invalid calendar URL', 400, origin); }
  if (parsed.protocol !== 'https:') {
    return jsonError('Calendar URL must start with https:// or webcal://', 400, origin);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Cumulo-Logbook/1.0 (Pilot logbook app)',
        'Accept': 'text/calendar, text/plain, */*'
      },
      redirect: 'follow'
    });
    if (!resp.ok) {
      console.error('[Worker] iCal upstream status:', resp.status);
      return jsonError('Upstream calendar error', 502, origin);
    }
    // Reject if the declared size is over the cap, then enforce on actual bytes
    // in case the header lies or is absent.
    const declared = parseInt(resp.headers.get('Content-Length') || '0', 10);
    if (declared > MAX_ICS_BYTES) return jsonError('Calendar feed too large', 413, origin);
    const ics = await resp.text();
    if (ics.length > MAX_ICS_BYTES) return jsonError('Calendar feed too large', 413, origin);
    return new Response(ics, {
      status: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'text/calendar; charset=utf-8' }
    });
  } catch (e: any) {
    console.error('[Worker] iCal fetch error:', e?.message);
    return jsonError('Could not fetch the calendar feed', 502, origin);
  }
}

// Account deletion — requires a VERIFIED Supabase user token (we never trust a
// client-supplied user id). The FK ON DELETE CASCADE on profiles / flights /
// trusted_devices means deleting the auth user wipes all their data atomically.
async function handleDeleteAccount(body: any, env: Env, origin: string): Promise<Response> {
  const e = env as Env & { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string };
  const token = (typeof body.accessToken === 'string' ? body.accessToken : '').trim();
  if (!token) return jsonError('Missing access token', 401, origin);
  if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY || !e.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Worker] Supabase env missing for delete-account');
    return jsonError('Service misconfigured', 500, origin);
  }
  const base = e.SUPABASE_URL.replace(/\/+$/, '');

  // 1) Verify the token and resolve the real uid server-side.
  let uid = '';
  try {
    const ur = await fetch(`${base}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': e.SUPABASE_ANON_KEY }
    });
    if (!ur.ok) return jsonError('Invalid or expired session', 401, origin);
    const u: any = await ur.json();
    uid = (u && typeof u.id === 'string') ? u.id : '';
  } catch (err: any) {
    console.error('[Worker] verify user failed:', err?.message);
    return jsonError('Could not verify session', 502, origin);
  }
  if (!uid) return jsonError('Invalid session', 401, origin);

  // 2) Hard-delete the auth user with the service-role key. ON DELETE CASCADE
  //    removes profiles, flights and trusted_devices for this uid.
  try {
    const dr = await fetch(`${base}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': e.SUPABASE_SERVICE_ROLE_KEY }
    });
    // 404 = already gone → idempotent success.
    if (!dr.ok && dr.status !== 404) {
      console.error('[Worker] admin delete status:', dr.status);
      return jsonError('Cloud deletion failed', 502, origin);
    }
  } catch (err: any) {
    console.error('[Worker] admin delete error:', err?.message);
    return jsonError('Cloud deletion failed', 502, origin);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
  });
}

async function handleAnthropic(body: any, env: Env, origin: string): Promise<Response> {
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
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError('messages must be a non-empty array', 400, origin);
  }

  // Field whitelist: ONLY model/max_tokens/messages pass through, and the
  // system prompt is pinned server-side. Client-sent `system`, `tools`,
  // `metadata`, etc. are dropped — the raw body is never forwarded.
  const upstreamBody = {
    model: body.model,
    max_tokens: body.max_tokens,
    system: SYSTEM_PROMPT,
    messages: body.messages
  };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(upstreamBody)
    });
    const data = await resp.text();
    return new Response(data, {
      status: resp.status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    console.error('[Worker] Anthropic upstream error:', e?.message);
    return jsonError('Upstream service unavailable', 502, origin);
  }
}
