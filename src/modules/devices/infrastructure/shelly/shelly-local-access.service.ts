import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { shellyLocalEnabled } from '../../../../config/shelly-local';

@Injectable()
export class ShellyLocalAccessService {
  constructor(private readonly config: ConfigService) {}

  assertEnabled(): void {
    let enabled = false;
    try {
      enabled = shellyLocalEnabled(
        this.config.get<unknown>('SHELLY_LOCAL_ENABLED'),
        this.config.get<unknown>('NODE_ENV'),
      );
    } catch {
      // Fail closed even when a caller bypasses application startup validation.
    }
    if (!enabled) {
      throw new ForbiddenException({
        code: 'SHELLY_LOCAL_DISABLED',
        message:
          'El diagnóstico y aprovisionamiento local de Shelly están deshabilitados.',
      });
    }
  }
}

@Injectable()
export class ShellyLocalGuard implements CanActivate {
  constructor(private readonly localAccess: ShellyLocalAccessService) {}

  canActivate(): boolean {
    this.localAccess.assertEnabled();
    return true;
  }
}
