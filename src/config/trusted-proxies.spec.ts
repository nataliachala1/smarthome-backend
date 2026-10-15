import { getTrustedProxies } from './trusted-proxies';
import { validateRuntimeConfig } from './runtime-config';

describe('trusted proxy configuration', () => {
  it.each([undefined, ''])('disables proxy trust when unset (%s)', (value) => {
    expect(getTrustedProxies(value)).toBe(false);
  });

  it('accepts explicit IPv4/IPv6 addresses and subnets, removing duplicates', () => {
    expect(
      getTrustedProxies(' 127.0.0.1,::1/128,10.20.30.0/24,127.0.0.1 '),
    ).toEqual(['127.0.0.1', '::1/128', '10.20.30.0/24']);
  });

  it.each([
    true,
    1,
    null,
    'true',
    'false',
    '1',
    '*',
    'loopback',
    'proxy.example.test',
    ' ',
    '127.0.0.1,',
    ',127.0.0.1',
    '10.0.0.1:8080',
    '999.0.0.1',
    '0.0.0.0/0',
    '::/0',
    '127.0.0.1/33',
    '::1/129',
    '::1/-1',
    '127.0.0.1/',
    '127.0.0.1/24/1',
    '127.0.0.1/24abc',
    'fe80::1%eth0',
  ])(
    'rejects unsafe or invalid proxy setting %s without echoing it',
    (value) => {
      expect(() => getTrustedProxies(value)).toThrow(
        new Error(
          'TRUSTED_PROXY_CIDRS debe contener IP o CIDR explícitos y válidos.',
        ),
      );
    },
  );

  it('rejects invalid proxy configuration during runtime validation', () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://app@localhost/synthetic',
        DATABASE_IOT_URL: 'postgresql://ingest@localhost/synthetic',
        JWT_SECRET: 'synthetic-only',
        TRUSTED_PROXY_CIDRS: 'true',
      }),
    ).toThrow('TRUSTED_PROXY_CIDRS');
  });
});
