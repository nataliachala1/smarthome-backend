import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { AuthenticatedUser } from '../../../domain/types/authenticated-user.type';

interface JwtPayload {
  sub: string;
  role: string;
  iat?: number;
  exp?: number;
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token =
      this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException(
        'Token de autenticación requerido',
      );
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<JwtPayload>(token);

      request.user = {
        userId: payload.sub,
        role: payload.role,
      };

      return true;
    } catch {
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

    const [type, token] =
      authorization.split(' ');

    return type === 'Bearer'
      ? token
      : undefined;
  }
}