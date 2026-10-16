# HU 09-dev · production-config-and-hardening

Actualización transversal: [HU16, permisos de consumo y prueba del historial completo](HU16_CONSUMPTION_ACCESS.md). Se comprobó en una BD desechable la ausencia de objetos de sesión en los changesets originales y se agregó un puente incremental; su necesidad en una instalación existente requiere contraste del estado aplicado.

## Baseline coordinado (BD-01)

Inicio de implementación autorizado por la responsable el 14/10/2026. Se autorizan avances pequeños con commit y push a las ramas de trabajo. No se autorizaron cambios sobre una base en uso, broker, Shelly ni despliegues.

| Repositorio | Rama de trabajo | Commit de partida |
|---|---|---|
| `nataliachala1/smarthome-backend` | `09-dev`, existente en remoto | `8235727`, configuración/cookies/health previos |
| `nataliachala1/smarthome-database` | `09-dev`, desde `03-dev` | `e18b2d0`, snapshot local previamente versionado |

Las referencias de ambos remotos se actualizaron antes de trabajar. Se conservan el informe de auditoría y el archivo de revisión sin seguimiento del repositorio de BD; este último no se incluye en commits. El repositorio de BD anidado tampoco se agrega al Git del backend.

El [Informe 01](INFORME_01_AUDITORIA_BACKEND_BD_2026-10-12.md) conserva su fecha de corte y su baseline auditado (`08-dev`). La posterior inspección del remoto descubrió el avance existente de `09-dev`: el informe histórico no se presenta como auditoría de este nuevo código.

Baseline de fuentes identificado. Historial Liquibase realmente aplicado, checksums y roles de conexiones instaladas siguen **SIN VERIFICAR**. El snapshot de BD y su diferencia con `dev` requieren contraste antes de ejecutar una actualización; no se reescriben migraciones.

Avances verificados compatibles:

| Repositorio | Commit | Resultado |
|---|---|---|
| Backend | `7447822` | Validador de configuración, pruebas y enlace al arranque NestJS. |
| BD | `f097a0a` | Auditoría de roles de solo lectura y seis escenarios PostgreSQL aislados. |

Ambos avances pertenecen a `09-dev`. No hay dependencia de changesets nuevos ni actualización del esquema para integrar este par de commits.

## Primer incremento de BD-02

- Validación central mediante `ConfigModule.forRoot({ validate })`, después de combinar entorno y `.env` y antes de crear los servicios.
- Configuración obligatoria de conexiones PostgreSQL y JWT; nombres de BD coincidentes. Esto no prueba que dos hosts correspondan a la misma instancia ni que el LOGIN tenga permisos seguros.
- En producción: origen CORS HTTPS explícito, cookies Secure obligatorias y JWT de al menos 32 bytes. La longitud no acredita entropía: usar un secreto aleatorio custodiado fuera del repositorio.
- CORS admite solo orígenes HTTP(S) exactos, sin rutas, credenciales, parámetros ni fragmentos. Se normaliza `/` final y se deduplican entradas. Desarrollo conserva el origen local predeterminado y la compatibilidad con `FRONTEND_URL`.
- `NODE_ENV` se limita a `development`, `test` y `production`; puerto y opciones de cookie/Swagger se validan sin mostrar valores de configuración en errores.
- La BD aporta en paralelo una auditoría SQL de solo lectura de roles/RLS. No se necesita changeset nuevo para esta validación, porque reutiliza los roles existentes.

Validación del incremento: 47 pruebas unitarias aprobadas, compilación NestJS y TypeScript sin errores, y ESLint aprobado en los cuatro archivos de código modificados. Los seis escenarios SQL pasaron en PostgreSQL 16 temporal: aplicación, ingesta, rol privilegiado asumible, rol esperado incorrecto, administrador oculto tras `SET ROLE` y RLS deshabilitado. La primera ejecución detectó una carrera durante la inicialización del contenedor; se corrigió la espera para comprobar el servidor definitivo por loopback y se repitieron los seis casos satisfactoriamente.

Ninguna prueba usa credenciales reales, una base en uso, broker o Shelly. La prueba SQL valida el diagnóstico de catálogos con fixtures; no certifica las políticas o usuarios de una instalación real.

## Segundo incremento de BD-02: límites de solicitudes

Se incorporó protección HTTP por IP y método del controlador, con cuotas específicas para autenticación, respuesta `429` con código estable y tiempo de reintento, configuración explícita de proxies y almacenamiento acotado por proceso. Detalle, contrato para clientes y límites operativos en [HU09 — límites de solicitudes](HU09_RATE_LIMITING.md).

Validación acumulada: 82 pruebas unitarias y 17 pruebas HTTP aisladas aprobadas; compilación, TypeScript y ESLint de los archivos cambiados aprobados. Los casos de uso, Prisma y el guard JWT se sustituyen en la suite HTTP; estos resultados no certifican autenticación ni RLS reales. El incremento continúa siendo compatible con BD `f097a0a` y no requiere changesets.

## Límites y siguientes avances

Cuarto incremento: [logout individual y familias de sesión](HU09_SESSION_FAMILIES.md). Access tokens con `sid` obligatorio, familia activa verificada en HTTP/realtime, logout por familia y rotación transaccional coordinada con revocación. Evidencia: 82 pruebas unitarias, 68 casos de regresión aislada y 17 con Prisma/PostgreSQL reales; usuario y permisos de hogar del flujo integrado siguen siendo fixtures. No requiere cambios de esquema.

Tercer incremento: [seguridad de sesiones y eventos Socket.IO](HU09_REALTIME_SECURITY.md). Se valida la cuenta y versión de sesión al conectar y antes de entregar eventos, se desconectan sockets por expiración y `logout-all` local, se restringen orígenes y se comprueba la membresía para detalles de hogar. La evidencia incluye 49 casos nuevos de realtime/concurrencia/integración de módulo, con repositorios sustituidos; no cierra las dependencias reales de BD-03/BD-04.

BD-02 no se declara cerrado: faltan privilegios instalados, correo y configuración efectiva del despliegue. Los límites HTTP ya tienen evidencia local; faltan validación detrás del proxy real y protección compartida si se usan múltiples instancias. BD-17 dispone de controles de sesión/origen/permisos y revocación individual, pero sigue pendiente de validación integral, clientes, WSS y operación distribuida. MQTT/TLS y pairing corresponden a las HU siguientes y necesitan las decisiones y pruebas indicadas en el informe.

Cada incremento registra HU/BD-ID, diff, validación y commits compatibles. La autorización de commit/push no autoriza migraciones operativas ni intervención física. No se hace merge a `main`/`dev`, force-push ni despliegue automático.

Referencia del mecanismo de validación: [documentación oficial de NestJS](https://docs.nestjs.com/techniques/configuration#custom-validate-function).
