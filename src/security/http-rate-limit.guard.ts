import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class HttpRateLimitGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The parent guard sets Retry-After before invoking this method.
    return Promise.reject(
      new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Demasiadas solicitudes. Intenta nuevamente más tarde.',
          retryAfterSeconds: detail.timeToBlockExpire,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  }
}
