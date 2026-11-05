import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpRateLimitGuard } from './http-rate-limit.guard';
import { MemoryRateLimitStorage } from './memory-rate-limit.storage';
import { RATE_LIMITS } from './rate-limit.policy';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ...RATE_LIMITS.api }],
        storage: new MemoryRateLimitStorage(),
        skipIf: (context) => context.getType() !== 'http',
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: HttpRateLimitGuard }],
})
export class RateLimitModule {}
