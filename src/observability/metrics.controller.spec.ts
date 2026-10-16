import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  const token = 'm'.repeat(40);
  let enabled: string | undefined;
  let configuredToken: string | undefined;
  let controller: MetricsController;
  let response: Pick<Response, 'setHeader' | 'status' | 'send'>;

  beforeEach(() => {
    enabled = 'true';
    configuredToken = token;
    const config = {
      get: (name: string) =>
        name === 'METRICS_ENABLED' ? enabled : configuredToken,
    } as ConfigService;
    controller = new MetricsController(config, new MetricsService());
    response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
  });

  function request(authorization?: string): Request {
    return {
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? authorization : undefined,
    } as Request;
  }

  it('hides metrics when the feature is disabled', () => {
    enabled = 'false';
    expect(() =>
      controller.getMetrics(request(`Bearer ${token}`), response as Response),
    ).toThrow(NotFoundException);
  });

  it.each([undefined, 'Basic abc', `Bearer ${'x'.repeat(40)}`])(
    'rejects missing or invalid authorization',
    (authorization) => {
      expect(() =>
        controller.getMetrics(request(authorization), response as Response),
      ).toThrow(UnauthorizedException);
    },
  );

  it('returns Prometheus text after validating the bearer token', () => {
    controller.getMetrics(request(`Bearer ${token}`), response as Response);

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/plain; version=0.0.4; charset=utf-8',
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining('# TYPE smarthome_http_requests_total counter'),
    );
  });

  it('normalizes the enabled flag and trims the configured secret', () => {
    enabled = ' TRUE ';
    configuredToken = ` ${token} `;
    controller.getMetrics(request(`Bearer ${token}`), response as Response);

    expect(response.status).toHaveBeenCalledWith(200);
  });
});
