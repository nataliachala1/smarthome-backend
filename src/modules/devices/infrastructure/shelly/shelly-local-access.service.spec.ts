jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { ForbiddenException } from '@nestjs/common';
import { ShellyLocalAccessService, ShellyLocalGuard } from './shelly-local-access.service';

describe('ShellyLocalAccessService', () => {
  function create(flag?: unknown, nodeEnv: unknown = 'development') {
    const config = {
      get: jest.fn((name: string) =>
        name === 'SHELLY_LOCAL_ENABLED' ? flag : nodeEnv,
      ),
    };
    const service = new ShellyLocalAccessService(config as never);
    return { config, service };
  }

  it.each([undefined, 'false', 'invalid', true])(
    'fails closed for disabled or malformed flag %p',
    (flag) => {
      const { service } = create(flag);
      expect(() => service.assertEnabled()).toThrow(ForbiddenException);
    },
  );

  it('blocks direct local access in production even if startup validation was bypassed', () => {
    const { service } = create('true', 'production');
    expect(() => service.assertEnabled()).toThrow(ForbiddenException);
  });

  it('allows explicitly enabled local development', () => {
    const { service } = create('true');
    expect(() => service.assertEnabled()).not.toThrow();
  });

  it('uses the same fail-closed policy through the route guard', () => {
    const { service } = create(undefined);
    const guard = new ShellyLocalGuard(service);
    expect(() => guard.canActivate()).toThrow(ForbiddenException);
  });
});
