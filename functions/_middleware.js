// Cloudflare Pages Function — refuse the repository paths.
//
// Added 2026-10-26. The first attempt used _redirects, which does nothing here:
// Pages serves an existing static asset BEFORE consulting redirect rules, and
// the site is built from the repository root, so supabase/, worker/, test/,
// src/ and docs/ all answered with their real contents. A Function runs ahead
// of the asset, and _routes.json limits it to exactly these paths so every
// other request stays a plain static hit with no Function in the way.
//
// Nothing secret lives in those files — that was verified separately — but the
// Worker source states its rate limits and origin allowlist, and the schema
// gives the shape of every table. None of it is part of the app.
const BLOCKED = [
  /^\/supabase(\/|$)/i,
  /^\/worker(\/|$)/i,
  /^\/test(\/|$)/i,
  /^\/src(\/|$)/i,
  /^\/docs(\/|$)/i,
  /^\/node_modules(\/|$)/i,
  /^\/package(-lock)?\.json$/i,
  /^\/build\.js$/i,
];

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (BLOCKED.some((re) => re.test(path))) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });
  }
  return context.next();
}
