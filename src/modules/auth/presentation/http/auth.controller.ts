import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
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

import {
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

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

import {
  Get,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../domain/types/authenticated-user.type';

import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly activateAccountUseCase: ActivateAccountUseCase,
    private readonly loginUserUseCase: LoginUserUseCase,
    private readonly resendActivationUseCase: ResendActivationUseCase,
  ) {}

    @Get('me')
  @UseGuards(JwtAuthGuard)
  me(
    @CurrentUser() user: AuthenticatedUser,
  ): AuthenticatedUser {
    return user;
  }

  @Post('register')
  async register(
    @Body() dto: RegisterUserDto,
  ): Promise<RegisterUserOutput> {
    try {
      return await this.registerUserUseCase.execute(dto);
    } catch (error) {
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

  @Post('login')
  async login(
    @Body() dto: LoginDto,
  ): Promise<LoginUserOutput> {
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
