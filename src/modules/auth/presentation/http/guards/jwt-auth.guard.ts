import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { AuthenticatedUser } from '../../../domain/types/authenticated-user.type';

import { UserRepository } from '../../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../../users/domain/entities/user-status.enum';

interface JwtPayload {
  sub: string;
  role: string;
  sv: number;
  iat?: number;
  exp?: number;
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context
        .switchToHttp()
        .getRequest<AuthenticatedRequest>();

    const token =
      this.extractTokenFromHeader(
        request,
      );

    if (!token) {
      throw new UnauthorizedException(
        'Token de autenticación requerido',
      );
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<JwtPayload>(
          token,
        );

      if (
        !payload.sub ||
        !payload.role ||
        payload.sv === undefined
      ) {
        throw new UnauthorizedException(
          'Token inválido',
        );
      }

      const user =
        await this.userRepository.findById(
          payload.sub,
        );

      if (!user) {
        throw new UnauthorizedException(
          'Usuario no encontrado',
        );
      }

      if (
        user.status !== UserStatus.ACTIVE
      ) {
        throw new UnauthorizedException(
          'La cuenta no está activa',
        );
      }

      if (
        user.sessionVersion !==
        payload.sv
      ) {
        throw new UnauthorizedException(
          'La sesión fue revocada',
        );
      }

      request.user = {
        userId:
          payload.sub,

        role:
          payload.role,
      };

      return true;
    } catch (error) {
      if (
        error instanceof
        UnauthorizedException
      ) {
        throw error;
      }

      throw new UnauthorizedException(
        'Token inválido o expirado',
      );
    }
  }

  private extractTokenFromHeader(
    request: Request,
  ): string | undefined {
    const authorization =
      request.headers.authorization;

    if (!authorization) {
      return undefined;
    }

    const [
      type,
      token,
    ] =
      authorization.split(' ');

    return type === 'Bearer'
      ? token
      : undefined;
  }
}