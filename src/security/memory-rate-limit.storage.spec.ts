import { MemoryRateLimitStorage } from './memory-rate-limit.storage';

describe('bounded rate limit storage', () => {
  let now: number;
  let storage: MemoryRateLimitStorage;
  const hit = (key = 'client-a', name = 'default') =>
    storage.increment(key, 60_000, 2, 60_000, name);

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    storage = new MemoryRateLimitStorage();
  });
  afterEach(() => jest.restoreAllMocks());

  it('permits exactly the quota and blocks the next request', async () => {
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(await hit()).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(await hit()).toMatchObject({
      totalHits: 3,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
  });

  it('starts a fresh window exactly at expiry', async () => {
    await hit();
    now += 59_999;
    expect(await hit()).toMatchObject({ totalHits: 2, timeToExpire: 1 });
    now += 1;
    expect(await hit()).toMatchObject({
      totalHits: 1,
      isBlocked: false,
      timeToExpire: 60,
    });
  });

  it('does not extend a block on denied requests or lift it when the window ends', async () => {
    await hit();
    await hit();
    now += 50_000;
    await hit();
    now += 59_000;
    expect(await hit()).toMatchObject({
      isBlocked: true,
      timeToBlockExpire: 1,
    });
    now += 1_000;
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps another client window intact when a block expires', async () => {
    await hit();
    await hit();
    await hit();
    now += 30_000;
    await hit('client-b');
    now += 30_000;
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(await hit('client-b')).toMatchObject({
      totalHits: 2,
      isBlocked: false,
    });
    now += 30_000;
    expect(await hit('client-b')).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it('separates named policies even if they receive the same key', async () => {
    await hit();
    await hit();
    await hit();
    expect(await hit('client-a', 'another')).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it('rejects new counters at capacity without evicting active counters', async () => {
    storage = new MemoryRateLimitStorage(2);
    await hit();
    await hit('client-b');
    expect(await hit('client-c')).toMatchObject({
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(await hit()).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(await hit()).toMatchObject({ isBlocked: true });
  });

  it('reclaims expired counters and accepts new clients after saturation', async () => {
    storage = new MemoryRateLimitStorage(1);
    await hit();
    expect(await hit('client-b')).toMatchObject({ isBlocked: true });
    now += 60_000;
    expect(await hit('client-b')).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it('counts concurrent requests without exceeding the allowed quota', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => hit()));
    expect(results.filter((result) => !result.isBlocked)).toHaveLength(2);
  });
});
