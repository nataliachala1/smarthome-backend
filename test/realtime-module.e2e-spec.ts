import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../src/modules/auth/auth.module';
import { RealtimeModule } from '../src/modules/realtime/realtime.module';
import { RealtimeEventsService } from '../src/modules/realtime/realtime-events.service';
import { RealtimeSessionService } from '../src/modules/realtime/realtime-session.service';
import { UserRepository } from '../src/modules/users/domain/repositories/user.repository';
import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';

jest.mock('../src/infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

@Module({
  imports: [JwtModule.register({ secret: 'synthetic-module-test' })],
  providers: [{ provide: UserRepository, useValue: {} }],
  exports: [UserRepository, JwtModule],
})
class FixtureAuthModule {}

@Global()
@Module({
  providers: [{ provide: PrismaRlsService, useValue: {} }],
  exports: [PrismaRlsService],
})
class FixtureDatabaseModule {}

it('resolves the real RealtimeModule with the exported auth and database contracts', async () => {
  const module = await Test.createTestingModule({
    imports: [FixtureDatabaseModule, RealtimeModule],
  })
    .overrideModule(AuthModule)
    .useModule(FixtureAuthModule)
    .compile();
  try {
    expect(module.get(RealtimeEventsService)).toBeInstanceOf(
      RealtimeEventsService,
    );
    expect(module.get(RealtimeSessionService)).toBeInstanceOf(
      RealtimeSessionService,
    );
  } finally {
    await module.close();
  }
});
