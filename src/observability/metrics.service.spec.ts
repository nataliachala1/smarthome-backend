import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders bounded route labels, cumulative histogram buckets and process gauges', () => {
    const metrics = new MetricsService();
    metrics.observeRequest('GET', 'Health.ready', 200, 0.02);
    metrics.observeRequest('GET', 'Health.ready', 503, 0.8);
    metrics.observeRequest('GET', '/private/user/123?token=secret', 200, 0.01);

    const output = metrics.renderPrometheus();
    expect(output).toContain(
      'smarthome_http_requests_total{method="GET",route="Health.ready",status_class="2xx"} 1',
    );
    expect(output).toContain('route="unmatched"');
    expect(output).not.toContain('123');
    expect(output).not.toContain('secret');
    expect(output).toContain(
      'smarthome_http_request_duration_seconds_bucket{method="GET",route="Health.ready",status_class="2xx",le="0.05"} 1',
    );
    expect(output).toContain('smarthome_http_request_duration_seconds_count');
    expect(output).toContain('smarthome_process_uptime_seconds');
    expect(output).toContain('smarthome_nodejs_heap_used_bytes');
  });
});
