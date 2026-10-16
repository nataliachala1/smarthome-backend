import { Injectable } from '@nestjs/common';

type RequestKey = `${string}\u0000${string}\u0000${string}`;

interface RequestMetric {
  method: string;
  route: string;
  statusClass: string;
  count: number;
  durationSum: number;
  buckets: number[];
}

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

@Injectable()
export class MetricsService {
  private readonly requests = new Map<RequestKey, RequestMetric>();

  observeRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const normalizedMethod = /^[A-Z]{1,10}$/.test(method) ? method : 'OTHER';
    const normalizedRoute = /^[A-Za-z0-9_.:-]{1,120}$/.test(route)
      ? route
      : 'unmatched';
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    const key: RequestKey = `${normalizedMethod}\u0000${normalizedRoute}\u0000${statusClass}`;
    let metric = this.requests.get(key);
    if (!metric) {
      metric = {
        method: normalizedMethod,
        route: normalizedRoute,
        statusClass,
        count: 0,
        durationSum: 0,
        buckets: DURATION_BUCKETS.map(() => 0),
      };
      this.requests.set(key, metric);
    }
    metric.count += 1;
    metric.durationSum += Math.max(0, durationSeconds);
    DURATION_BUCKETS.forEach((bucket, index) => {
      if (durationSeconds <= bucket) metric.buckets[index] += 1;
    });
  }

  renderPrometheus(): string {
    const lines = [
      '# HELP smarthome_http_requests_total Completed HTTP requests.',
      '# TYPE smarthome_http_requests_total counter',
    ];
    for (const metric of this.requests.values()) {
      lines.push(
        `smarthome_http_requests_total{method="${metric.method}",route="${metric.route}",status_class="${metric.statusClass}"} ${metric.count}`,
      );
    }
    lines.push(
      '# HELP smarthome_http_request_duration_seconds HTTP request duration in seconds.',
      '# TYPE smarthome_http_request_duration_seconds histogram',
    );
    for (const metric of this.requests.values()) {
      DURATION_BUCKETS.forEach((bucket, index) => {
        lines.push(
          `smarthome_http_request_duration_seconds_bucket{method="${metric.method}",route="${metric.route}",status_class="${metric.statusClass}",le="${bucket}"} ${metric.buckets[index]}`,
        );
      });
      lines.push(
        `smarthome_http_request_duration_seconds_bucket{method="${metric.method}",route="${metric.route}",status_class="${metric.statusClass}",le="+Inf"} ${metric.count}`,
        `smarthome_http_request_duration_seconds_sum{method="${metric.method}",route="${metric.route}",status_class="${metric.statusClass}"} ${metric.durationSum}`,
        `smarthome_http_request_duration_seconds_count{method="${metric.method}",route="${metric.route}",status_class="${metric.statusClass}"} ${metric.count}`,
      );
    }
    lines.push(
      '# HELP smarthome_process_uptime_seconds Process uptime in seconds.',
      '# TYPE smarthome_process_uptime_seconds gauge',
      `smarthome_process_uptime_seconds ${process.uptime()}`,
      '# HELP smarthome_nodejs_heap_used_bytes Node.js heap used in bytes.',
      '# TYPE smarthome_nodejs_heap_used_bytes gauge',
      `smarthome_nodejs_heap_used_bytes ${process.memoryUsage().heapUsed}`,
      '',
    );
    return lines.join('\n');
  }
}
