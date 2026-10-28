import Fastify from 'fastify';

import {
  appRoute,
  intentUrl,
  openPage,
  PLAY_STORE_URL,
  registerAppLinks,
} from './app-links';

describe('app links', () => {
  it('keeps a plain app path, refuses anything else', () => {
    expect(appRoute('/open/products/BK-629')).toBe('/products/BK-629');
    expect(appRoute('/open/analytics?tab=activity&period=day')).toBe(
      '/analytics?tab=activity&period=day',
    );
    expect(appRoute('/open//evil.example')).toBeNull();
    expect(appRoute('/open/x"><script>')).toBeNull();
    expect(appRoute('/open/x;end')).toBeNull();
  });

  it('opens the app on Android, the Play Store elsewhere', () => {
    expect(intentUrl('/products/BK-629')).toBe(
      'intent://app/products/BK-629#Intent;scheme=vistaar;package=com.kss.katyayani.vistar;' +
        `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`,
    );
    expect(openPage('/products/BK-629', true)).toContain(
      'intent://app/products/BK-629',
    );
    expect(openPage('/products/BK-629', false)).not.toContain('intent://');
    expect(openPage(null, true)).not.toContain('intent://');
  });

  it('serves assetlinks.json and the /open page', async () => {
    const app = Fastify();
    registerAppLinks(app, ['AA:BB']);

    const links = await app.inject({ url: '/.well-known/assetlinks.json' });
    expect(links.json<{ target: unknown }[]>()[0].target).toEqual({
      namespace: 'android_app',
      package_name: 'com.kss.katyayani.vistar',
      sha256_cert_fingerprints: ['AA:BB'],
    });

    const page = await app.inject({
      url: '/open/products/BK-629',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' },
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('intent://app/products/BK-629');
    await app.close();
  });
});
