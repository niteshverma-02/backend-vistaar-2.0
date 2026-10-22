/**
 * The one check every test-data seed makes before it touches Mongo. NODE_ENV
 * alone is not enough: a laptop with NODE_ENV=development and the production
 * URI pasted into `.env` would write test rows into shared production data.
 * So the URI's hosts must also be listed in `SEED_ALLOW_HOSTS`, which only the
 * beta and local `.env` set.
 */
export function refuseUnlessTestDb(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Test data is for beta and local only — NODE_ENV is production.',
    );
  }
  const allowed = (env.SEED_ALLOW_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const hosts = mongoHosts(env.MONGODB_URI ?? '');
  if (hosts.length === 0 || !hosts.every((h) => allowed.includes(h))) {
    throw new Error(
      `Refused: Mongo host ${hosts.join(', ') || '(none)'} is not in SEED_ALLOW_HOSTS.`,
    );
  }
}

/** Host names of a `mongodb://` or `mongodb+srv://` URI (seed lists too), no ports or credentials. */
export function mongoHosts(uri: string): string[] {
  const authority = uri
    .replace(/^mongodb(\+srv)?:\/\//i, '')
    .split(/[/?]/)[0]
    .replace(/^.*@/, '');
  return authority
    .split(',')
    .map((h) => h.replace(/:\d+$/, '').trim().toLowerCase())
    .filter(Boolean);
}
