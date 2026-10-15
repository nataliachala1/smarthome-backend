import { isIP } from 'node:net';

export function getTrustedProxies(value: unknown): string[] | false {
  if (value === undefined || value === '') return false;
  const error = () =>
    new Error(
      'TRUSTED_PROXY_CIDRS debe contener IP o CIDR explícitos y válidos.',
    );
  if (typeof value !== 'string') throw error();

  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address);
    if (!version || address.includes('%') || extra !== undefined) throw error();
    if (
      prefix !== undefined &&
      (!/^\d+$/.test(prefix) ||
        +prefix < 1 ||
        +prefix > (version === 4 ? 32 : 128))
    ) {
      throw error();
    }
  }
  return [...new Set(entries)];
}
