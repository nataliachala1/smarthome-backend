import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

import { SecureToken } from '../../domain/ports/secure-token.port';

@Injectable()
export class NodeSecureToken implements SecureToken {
  generate(): string {
    return randomBytes(32).toString('hex');
  }

  hash(token: string): string {
    return createHash('sha256')
      .update(token)
      .digest('hex');
  }
}