import type { FastifyInstance } from 'fastify';

/** The Vistaar partner app (Android). */
export const APP_PACKAGE = 'com.kss.katyayani.vistar';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE}`;

/** `/open/<app route>` — the share links the app sends (a product, an offer, …). */
export const OPEN_PREFIX = '/open';

/**
 * **The app's own share links**, outside `/api/v2`:
 * - `GET /.well-known/assetlinks.json` — Android App Links: with the app's signing
 *   certificates listed ([certSha256]), a tapped `https://<this host>/open/…` opens the
 *   app straight away, with no browser.
 * - `GET /open/<route>` — reached when that did not happen (app not installed, links not
 *   verified, not Android): on Android an `intent://` that opens the app at `<route>`
 *   (its `vistaar://app/<route>` deep link) and else the Play Store; elsewhere the Play Store.
 */
export function registerAppLinks(
  fastify: FastifyInstance,
  certSha256: string[],
): void {
  fastify.get('/.well-known/assetlinks.json', (_request, reply) => {
    void reply.header('Cache-Control', 'public, max-age=3600').send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: APP_PACKAGE,
          sha256_cert_fingerprints: certSha256,
        },
      },
    ]);
  });

  fastify.get(`${OPEN_PREFIX}/*`, (request, reply) => {
    const android = /android/i.test(request.headers['user-agent'] ?? '');

    void reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(openPage(appRoute(request.url), android));
  });
}

/**
 * `/open/products/BK-629?x=1` → `/products/BK-629?x=1`; `null` for anything that is not a
 * plain app path (it goes into an `intent://` URL and the page, so nothing else gets through).
 */
export function appRoute(url: string): string | null {
  const route = url.slice(OPEN_PREFIX.length);

  return /^\/[A-Za-z0-9\-._~%/?=&]*$/.test(route) && !route.startsWith('//')
    ? route
    : null;
}

/** The app at [route] when installed (Chrome falls back to the Play Store by itself). */
export function intentUrl(route: string): string {
  return (
    `intent://app${route}#Intent;scheme=vistaar;package=${APP_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
  );
}

export function openPage(route: string | null, android: boolean): string {
  const target = route !== null && android ? intentUrl(route) : PLAY_STORE_URL;
  // [appRoute] lets no quote or angle bracket through; JSON.stringify for the script anyway.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Katyayani Vistaar</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#f6f8f4;color:#1f2a1f;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
main{padding:24px;max-width:360px}
a{display:block;margin:12px 0;padding:14px;border-radius:12px;text-decoration:none;font-weight:600}
.open{background:#2e7d32;color:#fff}
.store{border:1px solid #2e7d32;color:#2e7d32}
</style>
</head>
<body>
<main>
<h1>Katyayani Vistaar</h1>
<p>Opening the Vistaar app…</p>
<a class="open" href="${target}">Open in the app</a>
<a class="store" href="${PLAY_STORE_URL}">Get it on Google Play</a>
</main>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
}
