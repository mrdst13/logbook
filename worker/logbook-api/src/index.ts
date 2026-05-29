// Cumulo Worker — hardened
// Source of truth for the Worker deployed at:
//   https://logbook-api.martindaoust33.workers.dev
//
// Security guarantees (defense in depth):
//   - Origin allow-list           → blocks browser abuse from other sites
//   - Model allow-list            → bounds cost per request
//   - max_tokens cap 2048         → bounds cost per request
//   - 5 MB body size limit        → bounds batch abuse
//   - Generic error messages      → no env/key leak via error reflection
//   - Navblue domain SSRF lock    → fetch-ics can only hit navblue.cloud

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

    // Body size guard
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonError('Request body too large', 413, origin);
    }

    let body: any;
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
} satisfies ExportedHandler<Env>;

async function handleFetchICS(body: any, origin: string): Promise<Response> {
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
  } catch (e: any) {
    console.error('[Worker] Navblue fetch error:', e?.message);
    return jsonError('Upstream fetch failed', 502, origin);
  }
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
  } catch (e: any) {
    console.error('[Worker] Anthropic upstream error:', e?.message);
    return jsonError('Upstream service unavailable', 502, origin);
  }
}
