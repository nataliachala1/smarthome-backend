import {
  MqttRevocationDatabaseUnsafeError,
  MqttRevocationLoop,
  RevocationLoopEvent,
  RevocationRunResult,
} from './mqtt-revocation.loop';

describe('revocation polling and shutdown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('does not overlap slow work, and waits until it settles before shutting down', async () => {
    let done!: (value: RevocationRunResult) => void;
    const run = jest.fn<Promise<RevocationRunResult>, []>(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const report = jest.fn<void, [RevocationLoopEvent]>();
    const loop = new MqttRevocationLoop(run, 1000, report);
    loop.start();
    loop.start();
    await jest.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    done('REVOKED');
    await stopping;
    await jest.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(loop.status()).toEqual({
      running: false,
      lastEvent: 'REVOKED',
      completed: 1,
    });
  });
  it('schedules the next poll after completion and tolerates idle', async () => {
    const run = jest
      .fn<Promise<RevocationRunResult>, []>()
      .mockResolvedValue('IDLE');
    const loop = new MqttRevocationLoop(run, 1000, () => {});
    loop.start();
    await jest.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await loop.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
  it.each([
    new Error('postgres://private:secret@db'),
    new MqttRevocationDatabaseUnsafeError(),
  ])('redacts a failed cycle and continues polling', async (failure) => {
    const run = jest
      .fn<Promise<RevocationRunResult>, []>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue('IDLE');
    const report = jest.fn<void, [RevocationLoopEvent]>();
    const loop = new MqttRevocationLoop(run, 1000, report);
    loop.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith(
      failure instanceof MqttRevocationDatabaseUnsafeError
        ? 'MQTT_REVOCATION_DATABASE_UNSAFE'
        : 'MQTT_REVOCATION_RUNTIME_UNAVAILABLE',
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
  it('stops before the first timer and cannot be restarted accidentally', async () => {
    const run = jest
      .fn<Promise<RevocationRunResult>, []>()
      .mockResolvedValue('IDLE');
    const loop = new MqttRevocationLoop(run, 1000, () => {});
    loop.start();
    await loop.stop();
    loop.start();
    await jest.advanceTimersByTimeAsync(10000);
    expect(run).not.toHaveBeenCalled();
  });
  it('contains logger failures without losing the loop', async () => {
    const run = jest
      .fn<Promise<RevocationRunResult>, []>()
      .mockResolvedValue('RETRY_SCHEDULED');
    const loop = new MqttRevocationLoop(run, 1000, () => {
      throw new Error('logger failed');
    });
    loop.start();
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
});
