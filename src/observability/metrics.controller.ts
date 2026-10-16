import {
  Controller,
  Get,
  NotFoundException,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  getMetrics(@Req() request: Request, @Res() response: Response): void {
    if (
      this.config.get<string>('METRICS_ENABLED')?.trim().toLowerCase() !==
      'true'
    ) {
      throw new NotFoundException();
    }
    const configuredToken =
      this.config.get<string>('METRICS_BEARER_TOKEN')?.trim() ?? '';
    const authorization = request.header('authorization') ?? '';
    const match = /^Bearer (.+)$/i.exec(authorization);
    const suppliedToken = match?.[1] ?? '';
    const expected = Buffer.from(configuredToken);
    const supplied = Buffer.from(suppliedToken);
    if (
      !match ||
      expected.length < 32 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException();
    }

    response.setHeader(
      'Content-Type',
      'text/plain; version=0.0.4; charset=utf-8',
    );
    response.status(200).send(this.metrics.renderPrometheus());
  }
}
