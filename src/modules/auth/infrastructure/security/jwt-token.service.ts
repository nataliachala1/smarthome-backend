import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SignOptions } from 'jsonwebtoken';

import {
  AccessTokenPayload,
  TokenService,
} from '../../domain/ports/token-service.port';

@Injectable()
export class JwtTokenService implements TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async generateAccessToken(
    payload: AccessTokenPayload,
  ): Promise<string> {
    const expiresIn =
      this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m';

    return this.jwtService.signAsync(
      {
        sub: payload.userId,
        role: payload.globalRole,
      },
      {
        expiresIn: expiresIn as SignOptions['expiresIn'],
      },
    );
  }
}