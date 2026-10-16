# HU14 — Salud, métricas y operación

Fecha: 2026-10-15. Rama `14-dev`, derivada de `09-dev`. Este incremento añade métricas HTTP de proceso al backend; no cambia el contrato de salud existente ni la base de datos. El endpoint no se habilita hasta configurar conscientemente su secreto y la política de red del proxy.

## Contrato de salud

- `GET /health/live` indica que el proceso responde; no consulta PostgreSQL.
- `GET /health/ready` y `GET /health` conservan la comprobación PostgreSQL `SELECT 1` existente.
- MQTT se observa en los logs del subscriber; una pérdida del broker no hace fallar readiness porque el API puede seguir atendiendo solicitudes que no requieren MQTT.

## Métricas

`GET /metrics` responde con texto Prometheus solo cuando `METRICS_ENABLED=true` y se presenta `Authorization: Bearer <token>`. En otro caso devuelve 404 o 401. El token debe contener al menos 32 bytes. Manténgase fuera del código, logs y repositorios.

- `smarthome_http_requests_total`: contador por método, nombre estático de controlador/handler y clase de estado HTTP.
- `smarthome_http_request_duration_seconds`: histograma por las mismas etiquetas, con cubetas de 5 ms a 5 s y `+Inf`.
- `smarthome_process_uptime_seconds` y `smarthome_nodejs_heap_used_bytes`: gauges básicos del proceso.

Los valores son locales a cada proceso y se reinician con él. Las etiquetas no contienen URL, IP, usuario, hogar, dispositivo, query string ni excepción. No enviar cabeceras, tokens, payloads ni datos personales como etiquetas o logs de métricas.

## Scrape y alertas de ejemplo

Este fragmento es ilustrativo: el proxy de staging debe reenviar `Authorization` y permitir acceso a `/metrics` solo desde el scraper. El secreto se inyecta en la configuración del scraper, no se guarda en Git.

```yaml
scrape_configs:
  - job_name: smarthome-backend
    metrics_path: /metrics
    scrape_interval: 15s
    authorization:
      type: Bearer
      credentials_file: /run/secrets/smarthome-metrics-token
    static_configs:
      - targets: [backend:3000]
```

Reglas candidatas que deben ajustarse con tráfico de staging:

```yaml
groups:
  - name: smarthome-backend
    rules:
      - alert: SmartHomeBackendHigh5xxRate
        expr: sum(rate(smarthome_http_requests_total{status_class="5xx"}[5m])) / clamp_min(sum(rate(smarthome_http_requests_total[5m])), 0.001) > 0.05
        for: 10m
        labels:
          severity: warning
      - alert: SmartHomeBackendSlowP95
        expr: histogram_quantile(0.95, sum by (le) (rate(smarthome_http_request_duration_seconds_bucket[5m]))) > 1
        for: 10m
        labels:
          severity: warning
```

El repositorio no despliega Prometheus, Alertmanager, dashboards ni un proxy. La retención, agregación entre réplicas y enrutamiento de alertas pertenecen a la plataforma. No interpretar ausencia de series como cero: comprobar también disponibilidad del target y `/health/ready`.

## Validación de plataforma pendiente

Pruebas unitarias verifican que el endpoint se oculte cuando está apagado, rechace tokens inválidos, valide la configuración y exporte histogramas con etiquetas limitadas. En staging se debe probar el scrape autenticado, el rechazo desde redes no autorizadas y las alertas antes de habilitarlo. Esta implementación no añade trazas distribuidas ni envía métricas a un proveedor externo.
