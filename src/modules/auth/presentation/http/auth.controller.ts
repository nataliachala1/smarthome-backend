import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

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

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly activateAccountUseCase: ActivateAccountUseCase,
    private readonly loginUserUseCase: LoginUserUseCase,
    private readonly resendActivationUseCase: ResendActivationUseCase,
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
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

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<LoginUserOutput> {
    try {
      return await this.loginUserUseCase.execute(dto);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException(error.message);
      }

      if (error instanceof AccountNotActiveError) {
        throw new ForbiddenException(error.message);
      }

      if (error instanceof AccountLockedError) {
        throw new ForbiddenException(error.message);
      }

      throw error;
    }
  }
}
