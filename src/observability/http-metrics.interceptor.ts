import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, finalize } from 'rxjs';
import { MetricsService } from './metrics.service';

type RoutedRequest = Pick<Request, 'method'> & {
  route?: { path?: string };
};

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<RoutedRequest>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    const controller =
      context.getClass().name.replace(/Controller$/, '') || 'root';
    const handler = context.getHandler().name || 'handler';
    const route = `${controller}.${handler}`;

    return next.handle().pipe(
      finalize(() => {
        if (request.route?.path === 'metrics') return;
        const durationSeconds =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        this.metrics.observeRequest(
          request.method,
          route,
          response.statusCode || 500,
          durationSeconds,
        );
      }),
    );
  }
}
