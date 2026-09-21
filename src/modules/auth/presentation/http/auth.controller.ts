import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Patch,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import type { Request, Response } from 'express';
import { ApiBearerAuth } from '@nestjs/swagger';

import { RegisterUserDto } from '../../application/dto/register-user.dto';
import { ActivateAccountDto } from '../../application/dto/activate-account.dto';

import {
  RegisterUserOutput,
  RegisterUserUseCase,
} from '../../application/use-cases/register-user.use-case';

import {
  ActivateAccountOutput,
  ActivateAccountUseCase,
} from '../../application/use-cases/activate-account.use-case';

import { EmailAlreadyExistsError } from '../../domain/errors/email-already-exists.error';
import { InvalidActivationTokenError } from '../../domain/errors/invalid-activation-token.error';

import { LoginDto } from '../../application/dto/login.dto';

import {
  LoginUserOutput,
  LoginUserUseCase,
} from '../../application/use-cases/login-user.use-case';

import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';
import { AccountNotActiveError } from '../../domain/errors/account-not-active.error';
import { AccountLockedError } from '../../domain/errors/account-locked.error';

import { ResendActivationDto } from '../../application/dto/resend-activation.dto';
import {
  ResendActivationOutput,
  ResendActivationUseCase,
} from '../../application/use-cases/resend-activation.use-case';

import { ForgotPasswordDto } from '../../application/dto/forgot-password.dto';
import { ResetPasswordDto } from '../../application/dto/reset-password.dto';

import {
  ForgotPasswordOutput,
  ForgotPasswordUseCase,
} from '../../application/use-cases/forgot-password.use-case';

import {
  ResetPasswordOutput,
  ResetPasswordUseCase,
} from '../../application/use-cases/reset-password.use-case';

import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';
import { InvalidPasswordResetTokenError } from '../../domain/errors/invalid-password-reset-token.error';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../domain/types/authenticated-user.type';

import { ChangePasswordDto } from '../../application/dto/change-password.dto';

import {
  ChangePasswordOutput,
  ChangePasswordUseCase,
} from '../../application/use-cases/change-password.use-case';

import { InvalidCurrentPasswordError } from '../../domain/errors/invalid-current-password.error';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';

import { InvalidRefreshTokenError } from '../../domain/errors/invalid-refresh-token.error';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case';

import { LogoutAllUseCase } from '../../application/use-cases/logout-all.use-case';
import { RequestReactivationDto } from '../../application/dto/request-reactivation.dto';

import { ReactivateAccountDto } from '../../application/dto/reactivate-account.dto';

import {
  RequestReactivationUseCase,
  RequestReactivationOutput,
} from '../../application/use-cases/request-reactivation.use-case';

import {
  ReactivateAccountUseCase,
  ReactivateAccountOutput,
} from '../../application/use-cases/reactivate-account.use-case';


@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly activateAccountUseCase: ActivateAccountUseCase,
    private readonly loginUserUseCase: LoginUserUseCase,
    private readonly resendActivationUseCase: ResendActivationUseCase,
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly logoutAllUseCase: LogoutAllUseCase,
    private readonly requestReactivationUseCase: RequestReactivationUseCase,
    private readonly reactivateAccountUseCase: ReactivateAccountUseCase,
  ) {}

  @Get('me')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Post('register')
  async register(@Body() dto: RegisterUserDto): Promise<RegisterUserOutput> {
    try {
      return await this.registerUserUseCase.execute(dto);
    } catch (error) {
      if (error instanceof PasswordsDoNotMatchError) {
        throw new BadRequestException(error.message);
      }

      if (error instanceof EmailAlreadyExistsError) {
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  @Post('activate')
  async activate(
    @Body() dto: ActivateAccountDto,
  ): Promise<ActivateAccountOutput> {
    try {
      return await this.activateAccountUseCase.execute(dto);
    } catch (error) {
      if (error instanceof InvalidActivationTokenError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  @Post('resend-activation')
  async resendActivation(
    @Body() dto: ResendActivationDto,
  ): Promise<ResendActivationOutput> {
    return this.resendActivationUseCase.execute(dto);
  }

  @Post('forgot-password')
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordOutput> {
    return this.forgotPasswordUseCase.execute(dto);
  }

  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<ResetPasswordOutput> {
    try {
      return await this.resetPasswordUseCase.execute(dto);
    } catch (error) {
      if (error instanceof PasswordsDoNotMatchError) {
        throw new BadRequestException(error.message);
      }

      if (error instanceof InvalidPasswordResetTokenError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  @Patch('change-password')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordOutput> {
    try {
      return await this.changePasswordUseCase.execute({
        userId: user.userId,
        currentPassword: dto.currentPassword,
        newPassword: dto.newPassword,
        newPasswordConfirmation: dto.newPasswordConfirmation,
      });
    } catch (error) {
      if (error instanceof PasswordsDoNotMatchError) {
        throw new BadRequestException(error.message);
      }

      if (error instanceof InvalidCurrentPasswordError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  @Post('login')
  async login(
    @Body()
    dto: LoginDto,

    @Res({
      passthrough: true,
    })
    response: Response,
  ) {
    try {
      const result =
        await this.loginUserUseCase.execute(
          dto,
        );

      response.cookie(
        'refresh_token',
        result.refreshToken,
        {
          httpOnly: true,

          secure:
            process.env.NODE_ENV ===
            'production',

          sameSite: 'lax',

          path:
            '/api/v1/auth',

          expires:
            result.refreshTokenExpiresAt,
        },
      );

      /*
      * Nunca enviamos el refresh token
      * dentro del JSON.
      */
      const {
        refreshToken: _refreshToken,

        refreshTokenExpiresAt:
          _refreshTokenExpiresAt,

        ...publicResult
      } = result;

      return publicResult;
    } catch (error) {
      if (
        error instanceof
        InvalidCredentialsError
      ) {
        throw new UnauthorizedException(
          error.message,
        );
      }

      if (
        error instanceof
        AccountNotActiveError
      ) {
        throw new ForbiddenException(
          error.message,
        );
      }

      if (
        error instanceof
        AccountLockedError
      ) {
        throw new ForbiddenException(
          error.message,
        );
      }

      throw error;
    }
  }
  @Post('refresh')
  async refresh(
    @Req()
    request: Request,

    @Res({
      passthrough: true,
    })
    response: Response,
  ) {
    const refreshToken =
      request.cookies?.refresh_token;

    if (
      !refreshToken ||
      typeof refreshToken !== 'string'
    ) {
      throw new UnauthorizedException(
        'Refresh token requerido',
      );
    }

    try {
      const result =
        await this.refreshSessionUseCase.execute(
          refreshToken,
        );

      response.cookie(
        'refresh_token',
        result.refreshToken,
        {
          httpOnly: true,

          secure:
            process.env.NODE_ENV ===
            'production',

          sameSite: 'lax',

          path:
            '/api/v1/auth',

          expires:
            result.refreshTokenExpiresAt,
        },
      );

      return {
        accessToken:
          result.accessToken,

        tokenType:
          result.tokenType,
      };
    } catch (error) {
      if (
        error instanceof
        InvalidRefreshTokenError
      ) {
        response.clearCookie(
          'refresh_token',
          {
            httpOnly: true,

            secure:
              process.env.NODE_ENV ===
              'production',

            sameSite:
              'lax',

            path:
              '/api/v1/auth',
          },
        );

        throw new UnauthorizedException(
          error.message,
        );
      }

      throw error;
    }
  }
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req()
    request: Request,

    @Res({
      passthrough: true,
    })
    response: Response,
  ) {
    const refreshToken =
      typeof request.cookies?.refresh_token ===
      'string'
        ? request.cookies.refresh_token
        : undefined;

    await this.logoutUseCase.execute(
      refreshToken,
    );

    response.clearCookie(
      'refresh_token',
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          'production',

        sameSite:
          'lax',

        path:
          '/api/v1/auth',
      },
    );

    return {
      message:
        'Sesión cerrada correctamente',
    };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @CurrentUser()
    user: AuthenticatedUser,

    @Res({
      passthrough: true,
    })
    response: Response,
  ) {
    await this.logoutAllUseCase.execute(
      user.userId,
    );

    response.clearCookie(
      'refresh_token',
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          'production',

        sameSite:
          'lax',

        path:
          '/api/v1/auth',
      },
    );

    return {
      message:
        'Todas las sesiones fueron cerradas correctamente',
    };
  }

  @Post('request-reactivation')
  async requestReactivation(
    @Body()
    dto: RequestReactivationDto,
  ): Promise<RequestReactivationOutput> {
    return this.requestReactivationUseCase.execute(
      dto,
    );
  }

  @Post('reactivate')
  async reactivate(
    @Body()
    dto: ReactivateAccountDto,
  ): Promise<ReactivateAccountOutput> {
    try {
      return await this.reactivateAccountUseCase.execute(
        dto,
      );
    } catch (error) {
      if (
        error instanceof
        InvalidActivationTokenError
      ) {
        throw new BadRequestException(
          error.message,
        );
      }

      throw error;
    }
  }
}
