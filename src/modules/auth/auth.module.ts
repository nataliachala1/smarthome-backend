import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './presentation/http/auth.controller';

import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { ActivateAccountUseCase } from './application/use-cases/activate-account.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { ResendActivationUseCase } from './application/use-cases/resend-activation.use-case';

import { PasswordHasher } from './domain/ports/password-hasher.port';
import { SecureToken } from './domain/ports/secure-token.port';
import { EmailSender } from './domain/ports/email-sender.port';
import { TokenService } from './domain/ports/token-service.port';

import { RecoveryTokenRepository } from './domain/repositories/recovery-token.repository';
import { AccountActivationRepository } from './domain/repositories/account-activation.repository';

import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher';
import { NodeSecureToken } from './infrastructure/security/node-secure-token';
import { JwtTokenService } from './infrastructure/security/jwt-token.service';

import { GmailEmailSender } from './infrastructure/email/gmail-email-sender';

import { PrismaRecoveryTokenRepository } from './infrastructure/persistence/prisma-recovery-token.repository';

import { PrismaAccountActivationRepository } from './infrastructure/persistence/prisma-account-activation.repository';

import { JwtAuthGuard } from './presentation/http/guards/jwt-auth.guard';
import { RolesGuard } from './presentation/http/guards/roles.guard';
import { UsersModule } from '../users/users.module';

import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';

import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { RefreshTokenRepository } from './domain/repositories/refresh-token.repository';

import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';

import { LogoutUseCase } from './application/use-cases/logout.use-case';

import { LogoutAllUseCase } from './application/use-cases/logout-all.use-case';
import { RequestReactivationUseCase } from './application/use-cases/request-reactivation.use-case';

import { ReactivateAccountUseCase } from './application/use-cases/reactivate-account.use-case';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => UsersModule),

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],

  controllers: [
    AuthController,
  ],

  providers: [
    RegisterUserUseCase,
    ActivateAccountUseCase,
    ResendActivationUseCase,
    LoginUserUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    ChangePasswordUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    LogoutAllUseCase,
    RequestReactivationUseCase,
    ReactivateAccountUseCase,
    RolesGuard,
    JwtAuthGuard,

    {
      provide: PasswordHasher,
      useClass: Argon2PasswordHasher,
    },

    {
      provide: SecureToken,
      useClass: NodeSecureToken,
    },

    {
      provide: EmailSender,
      useClass: GmailEmailSender,
    },

    {
      provide: TokenService,
      useClass: JwtTokenService,
    },

    {
      provide: RecoveryTokenRepository,
      useClass: PrismaRecoveryTokenRepository,
    },

    {
      provide: AccountActivationRepository,
      useClass: PrismaAccountActivationRepository,
    },
    {
      provide:
        RefreshTokenRepository,
      useClass:
        PrismaRefreshTokenRepository,
    },
  ],

  exports: [
    JwtAuthGuard,
    JwtModule,
    RolesGuard,
    UsersModule,
  ],
})
export class AuthModule {}