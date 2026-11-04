import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
jest.mock(
  '../../../../infrastructure/database/prisma/prisma-rls.service',
  () => ({
    PrismaRlsService: class PrismaRlsService {},
  }),
);
import { ShellyPairingSessionService } from './shelly-pairing-session.service';

describe('ShellyPairingSessionService', () => {
  const now = new Date(Date.now() + 5 * 60_000);
  const sessionToken = 'x'.repeat(43);
  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
  const baseRow = {
    id_device_pairing_session: 'f4198c49-78c1-4ac4-9d6f-395b842f8dab',
    id_home: '6cbbdc67-5620-41f9-945c-71d190ee3d35',
    method: 'AP' as const,
    status: 'PENDING',
    manufacturer_device_id: null,
    model_code: null,
    firmware_version: null,
    identity_reported_at: null,
    expires_at: now,
    completed_device_id: null,
    failure_code: null,
    created_at: new Date(),
    token_hash: tokenHash,
  };

  function createService() {
    const tx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
      device: { create: jest.fn() },
    };
    const prismaRls = {
      withUserContext: jest.fn(
        (_userId: string, operation: (client: unknown) => Promise<unknown>) =>
          operation(tx),
      ),
    };
    return {
      service: new ShellyPairingSessionService(prismaRls as never),
      tx,
      prismaRls,
    };
  }

  it('creates an AP session without returning token hashes or credentials', async () => {
    const { service, tx } = createService();
    tx.$queryRaw.mockResolvedValueOnce([baseRow]);

    const response = await service.create('user-id', baseRow.id_home, {
      requestId: 'ada0c01e-72ee-42e6-9b4c-8cad3d590258',
      sessionToken,
      method: 'AP',
    });

    expect(response).toMatchObject({
      sessionId: baseRow.id_device_pairing_session,
      status: 'PENDING',
      method: 'AP',
    });
    expect(JSON.stringify(response)).not.toContain('token_hash');
    expect(JSON.stringify(response)).not.toContain('sessionToken');
  });

  it('creates a LAN session for a device already connected to the home Wi-Fi', async () => {
    const { service, tx } = createService();
    tx.$queryRaw.mockResolvedValueOnce([{ ...baseRow, method: 'LAN' }]);

    const response = await service.create('user-id', baseRow.id_home, {
      requestId: 'c6e33c66-e3af-4d8e-8492-ad1e7bc72d12',
      sessionToken,
      method: 'LAN',
    });

    expect(response).toMatchObject({ status: 'PENDING', method: 'LAN' });
    expect(tx.$queryRaw.mock.calls[0]).toContain('LAN');
  });

  it('returns the same session on an idempotent retry with the same token', async () => {
    const { service, tx } = createService();
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([baseRow]);

    const response = await service.create('user-id', baseRow.id_home, {
      requestId: 'ada0c01e-72ee-42e6-9b4c-8cad3d590258',
      sessionToken,
      method: 'AP',
    });

    expect(response.sessionId).toBe(baseRow.id_device_pairing_session);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects reuse of a request id with a different token', async () => {
    const { service, tx } = createService();
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([baseRow]);

    await expect(
      service.create('user-id', baseRow.id_home, {
        requestId: 'ada0c01e-72ee-42e6-9b4c-8cad3d590258',
        sessionToken: 'y'.repeat(43),
        method: 'AP',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an idempotency retry that changes LAN/AP method', async () => {
    const { service, tx } = createService();
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([baseRow]);

    await expect(
      service.create('user-id', baseRow.id_home, {
        requestId: 'ada0c01e-72ee-42e6-9b4c-8cad3d590258',
        sessionToken,
        method: 'LAN',
      }),
    ).rejects.toMatchObject({
      response: { code: 'PAIRING_IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('does not enable BLE before the native proof of concept is validated', async () => {
    const { service, tx } = createService();
    await expect(
      service.create('user-id', baseRow.id_home, {
        requestId: 'ada0c01e-72ee-42e6-9b4c-8cad3d590258',
        sessionToken,
        method: 'BLE',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a Shelly model other than the supported Gen4 model', async () => {
    const { service, prismaRls } = createService();
    await expect(
      service.reportIdentity(
        'user-id',
        baseRow.id_home,
        baseRow.id_device_pairing_session,
        sessionToken,
        {
          manufacturerDeviceId: 'shelly1pmg4-aabbccddeeff',
          modelCode: 'UNSUPPORTED',
          generation: 4,
        },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prismaRls.withUserContext).not.toHaveBeenCalled();
  });

  it('rejects a compatible model code reported with the wrong generation', async () => {
    const { service, prismaRls } = createService();
    await expect(
      service.reportIdentity(
        'user-id',
        baseRow.id_home,
        baseRow.id_device_pairing_session,
        sessionToken,
        {
          manufacturerDeviceId: 'shelly1pmg4-aabbccddeeff',
          modelCode: 'S4SW-001P16EU',
          generation: 3,
        },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prismaRls.withUserContext).not.toHaveBeenCalled();
  });

  it('does not register before the backend observes an authenticated MQTT connection', async () => {
    const { service, tx } = createService();
    const identified = {
      ...baseRow,
      status: 'DEVICE_IDENTIFIED',
      manufacturer_device_id: 'shelly1pmg4-aabbccddeeff',
      model_code: 'S4SW-001P16EU',
      identity_reported_at: new Date(),
    };
    const waiting = { ...identified, status: 'WAITING_FOR_MQTT' };
    tx.$queryRaw
      .mockResolvedValueOnce([identified])
      .mockResolvedValueOnce([identified])
      .mockResolvedValueOnce([waiting]);

    const response = await service.complete(
      'user-id',
      baseRow.id_home,
      baseRow.id_device_pairing_session,
      sessionToken,
      'Lámpara sala',
    );

    expect(response.status).toBe('WAITING_FOR_MQTT');
    expect(response.completion).toMatchObject({
      ready: false,
      code: 'PAIRING_MQTT_NOT_CONFIRMED',
    });
    expect(tx.device.create).not.toHaveBeenCalled();
  });

  it('registers and completes atomically only after a broker-verified state', async () => {
    const { service, tx } = createService();
    const connected = {
      ...baseRow,
      status: 'CONNECTED',
      manufacturer_device_id: 'shelly1pmg4-aabbccddeeff',
      model_code: 'S4SW-001P16EU',
      identity_reported_at: new Date(),
    };
    const completed = {
      ...connected,
      status: 'COMPLETED',
      completed_device_id: '3472dfb7-36e2-40b8-875e-422e586d5a0e',
    };
    tx.$queryRaw
      .mockResolvedValueOnce([connected])
      .mockResolvedValueOnce([connected])
      .mockResolvedValueOnce([connected])
      .mockResolvedValueOnce([{ completed: true }])
      .mockResolvedValueOnce([completed]);
    tx.device.create.mockResolvedValueOnce({
      id_device: completed.completed_device_id,
      id_home: baseRow.id_home,
      name: 'Lámpara sala',
      manufacturer_device_id: connected.manufacturer_device_id,
      transport_type: 'WIFI',
      messaging_protocol: 'MQTT',
    });

    const response = await service.complete(
      'user-id',
      baseRow.id_home,
      baseRow.id_device_pairing_session,
      sessionToken,
      'Lámpara sala',
    );

    expect(response.status).toBe('COMPLETED');
    expect(response.completion).toMatchObject({
      ready: true,
      deviceId: completed.completed_device_id,
    });
    expect(tx.device.create).toHaveBeenCalledTimes(1);
    const createCalls: unknown = tx.device.create.mock.calls;
    expect(createCalls).toMatchObject([
      [{ data: { connectivity_status: 'OFFLINE' } }],
    ]);
    expect(JSON.stringify(tx.$queryRaw.mock.calls)).toContain(
      'devices.fn_finish_verified_pairing',
    );
  });

  it('marks mobile-reported identity as unverified and cannot mark pairing complete', async () => {
    const { service, tx } = createService();
    tx.$queryRaw
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([{ claimed: true }])
      .mockResolvedValueOnce([
        {
          ...baseRow,
          status: 'DEVICE_IDENTIFIED',
          manufacturer_device_id: 'shelly1pmg4-aabbccddeeff',
          model_code: 'S4SW-001P16EU',
          identity_reported_at: new Date(),
        },
      ]);

    const response = await service.reportIdentity(
      'user-id',
      baseRow.id_home,
      baseRow.id_device_pairing_session,
      sessionToken,
      {
        manufacturerDeviceId: 'shelly1pmg4-aabbccddeeff',
        modelCode: 'S4SW-001P16EU',
        generation: 4,
        firmwareVersion: '2.0.1-beta1',
      },
    );

    expect(response.status).toBe('DEVICE_IDENTIFIED');
    expect(response.identity?.verification).toBe('MOBILE_REPORTED_UNVERIFIED');
    expect(response.completion).toBeNull();
  });

  it('rejects a different identity on an already identified session', async () => {
    const { service, tx } = createService();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        ...baseRow,
        status: 'DEVICE_IDENTIFIED',
        manufacturer_device_id: 'shelly1pmg4-aabbccddeeff',
        model_code: 'S4SW-001P16EU',
        identity_reported_at: new Date(),
      },
    ]);
    tx.$executeRaw.mockResolvedValueOnce(0);

    await expect(
      service.reportIdentity(
        'user-id',
        baseRow.id_home,
        baseRow.id_device_pairing_session,
        sessionToken,
        {
          manufacturerDeviceId: 'shelly1pmg4-112233445566',
          modelCode: 'S4SW-001P16EU',
          generation: 4,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a globally registered or concurrently claimed identity', async () => {
    const { service, tx } = createService();
    tx.$queryRaw
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([{ claimed: false }])
      .mockResolvedValueOnce([baseRow]);

    await expect(
      service.reportIdentity(
        'user-id',
        baseRow.id_home,
        baseRow.id_device_pairing_session,
        sessionToken,
        {
          manufacturerDeviceId: 'shelly1pmg4-aabbccddeeff',
          modelCode: 'S4SW-001P16EU',
          generation: 4,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
