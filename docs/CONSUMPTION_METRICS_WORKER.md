# Worker de mÃ©tricas de consumo â€” habilitaciÃ³n controlada

- La ingesta MQTT sigue usando `DATABASE_IOT_URL` y guarda lecturas de manera independiente.
- Los endpoints `/consumption`, `/consumption/summary` y `/consumption/daily` consultan lecturas crudas y funcionan aunque el worker estÃ© apagado.
- Este worker calcula agregados diarios usando una conexiÃ³n **diferente**, con rol de grupo `smarthome_worker` (NOBYPASSRLS).
- Variables de entorno **del backend**:
  - `CONSUMPTION_METRICS_WORKER_ENABLED=true`
  - `DATABASE_METRICS_URL=postgresql://<login-worker>:<secret>@<servidor>:5432/<base>`
- Provisionar el usuario LOGIN dedicado y su membresÃ­a en `smarthome_worker` mediante procedimiento seguro de infraestructura. No usar `smarthome_owner`, `smarthome_ingest_login`, credenciales de usuario web ni `BYPASSRLS`.
- Al iniciar, verifica `pg_has_role(current_user,'smarthome_worker','USAGE')`; rechaza roles o nombres de BD incorrectos.
- No establecer las dos variables hasta probar el usuario con PostgreSQL de desarrollo. Si falta el URL y el worker se activa, el backend falla al arrancar (a propÃ³sito).
- Comprueba la actualizaciÃ³n de `consumption.consumption_metric` con SQL de solo lectura en DEV; la ingesta y las APIs permanecen separadas.
- **Pendiente fuera de este incremento**: mover las alertas/anomalÃ­as al trabajador autorizado, asegurar deduplicaciÃ³n, y prueba fÃ­sica de relÃ© y realtime web/mÃ³vil antes de merge/despliegue.
