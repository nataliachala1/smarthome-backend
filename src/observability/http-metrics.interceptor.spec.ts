import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsService } from './metrics.service';

describe('HttpMetricsInterceptor', () => {
  it('records static controller and handler labels, never the request URL', () => {
    const metrics = new MetricsService();
    const interceptor = new HttpMetricsInterceptor(metrics);
    const request = {
      method: 'GET',
      url: '/users/secret-id?access_token=secret',
      route: { path: '/:id' },
    };
    const response = { statusCode: 200 };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getClass: () => ({ name: 'UserController' }),
      getHandler: () => ({ name: 'getById' }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of('ok') } as CallHandler;

    interceptor.intercept(context, next).subscribe();

    const output = metrics.renderPrometheus();
    expect(output).toContain('route="User.getById"');
    expect(output).not.toContain('secret-id');
    expect(output).not.toContain('access_token');
  });
});
