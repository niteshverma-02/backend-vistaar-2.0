import { mongoHosts, refuseUnlessTestDb } from './test-db-guard';

describe('refuseUnlessTestDb', () => {
  const env = {
    NODE_ENV: 'development',
    SEED_ALLOW_HOSTS: 'beta-mongo.internal, localhost',
  };

  it('reads hosts from seed lists and SRV URIs, without credentials or ports', () => {
    expect(
      mongoHosts('mongodb://u:p@a.x:27017,B.x:27018/CRM-Database?rs=1'),
    ).toEqual(['a.x', 'b.x']);
    expect(
      mongoHosts('mongodb+srv://u:p%40w@cluster0.abc.mongodb.net'),
    ).toEqual(['cluster0.abc.mongodb.net']);
  });

  it('allows a URI whose every host is listed', () => {
    expect(() =>
      refuseUnlessTestDb({
        ...env,
        MONGODB_URI: 'mongodb://u:p@beta-mongo.internal:27017/db',
      }),
    ).not.toThrow();
  });

  it.each([
    ['an unlisted host', 'mongodb+srv://u:p@prod.abc.mongodb.net/db'],
    ['one unlisted host in a seed list', 'mongodb://localhost,prod.x/db'],
    ['no URI', undefined],
  ])('refuses %s', (_label, uri) => {
    expect(() => refuseUnlessTestDb({ ...env, MONGODB_URI: uri })).toThrow(
      /SEED_ALLOW_HOSTS/,
    );
  });

  it('refuses production even on a listed host', () => {
    expect(() =>
      refuseUnlessTestDb({
        ...env,
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://localhost/db',
      }),
    ).toThrow(/production/);
  });

  it('refuses everything when SEED_ALLOW_HOSTS is unset', () => {
    expect(() =>
      refuseUnlessTestDb({ MONGODB_URI: 'mongodb://localhost/db' }),
    ).toThrow(/SEED_ALLOW_HOSTS/);
  });
});
