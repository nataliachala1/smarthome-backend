# HU09 / BD-02 — Límites de solicitudes HTTP

**Fecha:** 14/10/2026. **Rama:** `09-dev`. **Estado:** segundo incremento implementado y probado localmente; HU09 continúa abierta.

El backend ahora rechaza solicitudes que exceden la cuota antes de ejecutar el controlador y sus casos de uso. El cliente recibe HTTP `429`, el código estable `RATE_LIMIT_EXCEEDED` y el tiempo de espera. Las solicitudes permitidas conservan su contrato anterior.

## Política aplicada

Cada contador corresponde a la IP reconocida por Express y al método del controlador. Cambiar correo, parámetros de consulta o identificadores de una ruta no crea otro contador para ese método. Rutas atendidas por métodos distintos tienen cuotas independientes; agotar login no agota logout.

| Operación | Solicitudes permitidas por ventana de 60 segundos |
|---|---:|
| Rutas HTTP de controladores sin regla específica | 120 |
| `POST /api/v1/auth/login` | 10 |
| `POST /api/v1/auth/register` | 5 |
| `POST /api/v1/auth/resend-activation` | 5 |
| `POST /api/v1/auth/forgot-password` | 5 |
| `POST /api/v1/auth/request-reactivation` | 5 |
| `POST /api/v1/auth/activate` | 10 |
| `POST /api/v1/auth/reactivate` | 10 |
| `POST /api/v1/auth/reset-password` | 10 |
| `POST /api/v1/auth/refresh` | 30 |
| `PATCH /api/v1/auth/change-password` | 5 |
| `GET /health/live` | Exento; no consulta BD. |

Las cuotas están versionadas en `src/security/rate-limit.policy.ts`. Son valores iniciales que deben contrastarse con el uso real, especialmente cuando varios usuarios comparten una IP. No hay un límite agregado entre todas las rutas.

La ventana comienza con la primera solicitud contabilizada. La primera solicitud que supera la cuota inicia un bloqueo de 60 segundos. Las solicitudes rechazadas durante ese bloqueo no lo prolongan. Los intentos con credenciales incorrectas y los cuerpos que posteriormente fallan la validación también consumen cuota. `/health/ready` y `/health` conservan la cuota general para limitar sus consultas de BD.

Ejemplo de respuesta al superar el límite:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{
  "statusCode": 429,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Demasiadas solicitudes. Intenta nuevamente más tarde.",
  "retryAfterSeconds": 60
}
```

Web y móvil pueden traducir el mensaje a partir de `code` y esperar `retryAfterSeconds` antes de reintentar. CORS expone `Retry-After` al navegador. El bloqueo no revela correo, IP, tokens ni claves internas del contador.

## Proxies y dirección del cliente

`TRUSTED_PROXY_CIDRS` vacío o ausente desactiva la confianza en encabezados reenviados. En una conexión directa, enviar o cambiar `X-Forwarded-For` no altera la cuota.

Para un despliegue detrás de un proxy se deben registrar únicamente sus IP o CIDR efectivos, separados por comas. Se validan IPv4, IPv6 y sus prefijos; se rechazan comodines, booleanos, cantidades de saltos, nombres de host, listas incompletas y prefijos `/0`. La validación se ejecuta durante el arranque y no muestra los valores recibidos en sus errores.

La lista definitiva depende de la topología del despliegue. Un proxy de confianza debe sanear `X-Forwarded-For`, `X-Forwarded-Host` y `X-Forwarded-Proto`; permitir un rango no demuestra que ese rango esté controlado. Express recorre la cadena hasta el primer salto no confiable. Si un proxy real queda fuera de la lista, sus clientes compartirán la cuota de la IP del proxy. Esta configuración debe probarse en staging. Véase [Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies/).

## Almacenamiento y alcance

Se reutilizan el módulo, los decoradores y el guard de `@nestjs/throttler` ya instalados. `MemoryRateLimitStorage` implementa su interfaz con ventanas fijas, contadores independientes y un máximo de 10.000 claves por proceso. No crea temporizadores por solicitud; limpia entradas vencidas al recibir tráfico, con barridos separados por al menos 60 segundos.

Al alcanzar la capacidad rechaza nuevos contadores con `429`, sin expulsar contadores activos para permitir que se evada el bloqueo. El tiempo de reintento en ese caso indica el próximo barrido; si continúa la saturación puede volver a rechazar. Los contadores existentes continúan bajo su propia cuota.

Los contadores se pierden al reiniciar el proceso y no se comparten entre réplicas. Antes de aceptar un despliegue con varias instancias se necesita almacenamiento compartido o una protección equivalente verificada en la entrada. Nest admite proveedores de almacenamiento mediante `ThrottlerStorage`: [documentación oficial](https://docs.nestjs.com/security/rate-limiting#storages).

Este incremento protege rutas HTTP atendidas por controladores. No aplica cuotas a eventos Socket.IO, al middleware de Swagger ni al broker MQTT. Tampoco sustituye protección de red contra ataques distribuidos. La política es por IP individual; no agrupa subredes IPv6. La rotación de direcciones y las cuotas compartidas por usuarios detrás de NAT requieren evaluación operativa adicional.

## Pruebas y compatibilidad

Resultados de este incremento:

| Comprobación | Resultado |
|---|---|
| Suite unitaria del backend | 82 pruebas aprobadas en 5 suites; incluye 27 casos nuevos de proxy y 8 de almacenamiento. |
| HTTP aislado de rate limiting | 17 pruebas aprobadas. |
| Compilación NestJS y TypeScript | Aprobados. |
| ESLint | Aprobado en los archivos TypeScript modificados o añadidos. |

Las pruebas HTTP levantan una aplicación temporal en loopback con controladores reales, validación de DTO, guard y almacenamiento reales. Sustituyen los casos de uso, Prisma y el guard JWT; no certifican autenticación real ni aislamiento entre hogares. Comprueban las cuotas de los nueve endpoints POST sensibles, los cuerpos inválidos de cambio de contraseña, login exitoso sin refresh token en el JSON, aislamiento entre clientes, encabezados falsificados, vencimiento de bloqueo, logout y health.

La revisión del controlador también eliminó imports y variables sin uso, tipó la cookie recibida como `unknown` antes de validarla y explicitó los campos públicos del resultado de login. Su respuesta y cookie están cubiertas por la prueba HTTP de regresión.

Comandos reproducibles, sin requerir servicios externos:

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/rate-limit.e2e-spec.ts
npm.cmd run build
.\node_modules\.bin\tsc.cmd --noEmit
```

La ejecución HTTP se limita al archivo indicado. No se ejecutaron las demás suites E2E ni pruebas contra una instalación real. No se añadieron dependencias ni se modificó el lockfile.

**Base de datos compatible:** `smarthome-database`, `09-dev`, commit funcional `f097a0a`. No se requieren tablas, grants ni changesets nuevos; las cuotas se evalúan antes de los casos de uso. Las seis pruebas PostgreSQL del primer incremento no se repitieron porque este cambio no modifica SQL. La validación de roles y RLS instalados continúa pendiente.

**Pendientes de HU09:** verificación de configuración de proxy y cuotas en staging, decisión de almacenamiento para múltiples instancias, correo, permisos de runtime y revalidación/revocación de sesiones Socket.IO (BD-17, dependiente de la matriz de permisos BD-04). No se realizaron despliegues ni intervenciones en broker o Shelly.
