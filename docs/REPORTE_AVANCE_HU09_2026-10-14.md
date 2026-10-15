# Reporte de avance SmartHome — Backend y base de datos

**Fecha de corte:** 14 de octubre de 2026.

**Rama de trabajo:** `09-dev` en ambos repositorios.

**Estado:** primer incremento implementado, probado y publicado. HU09 continúa abierta.

Este reporte registra el trabajo realizado después de la autorización para construir y publicar avances mediante commits. Complementa el [Informe 01 de auditoría, con corte al 12/10/2026](INFORME_01_AUDITORIA_BACKEND_BD_2026-10-12.md); no sustituye su evidencia histórica ni constituye una certificación de producción.

## 1. Resultado del avance

El backend valida su configuración antes de crear los servicios de la aplicación. Rechaza configuraciones incompletas o incompatibles con las reglas de producción y comunica el nombre de la variable problemática sin mostrar su valor.

El repositorio de base de datos incorpora una auditoría SQL de solo lectura para revisar roles y condiciones de seguridad, junto con pruebas en PostgreSQL temporal. Este incremento no requiere cambios de esquema para integrarse con el backend.

| Área | Resultado | Estado |
|---|---|---|
| Configuración de arranque | Validación centralizada de entorno, conexiones, JWT, CORS, cookies, puerto y Swagger. | Implementado y probado. |
| Diagnóstico de permisos de BD | Nueve comprobaciones de roles, separación de accesos y RLS. | Implementado y probado con datos sintéticos. |
| Publicación | Avances enviados a `09-dev` en ambos repositorios. | Completado para este incremento. |
| Permisos de una instalación real | Falta ejecutar el diagnóstico con las conexiones efectivas. | Sin verificar. |
| Cierre de HU09 | Quedan pendientes configuración operativa, límites de solicitudes y seguridad de sesiones en tiempo real. | En curso. |

## 2. Cambios en el backend

Se agregó `src/config/runtime-config.ts` y se integró mediante `ConfigModule.forRoot({ validate })`. La validación se realiza después de combinar las variables del entorno y del archivo `.env`, antes de crear los servicios.

- Exige `DATABASE_URL`, `DATABASE_IOT_URL` y `JWT_SECRET` no vacíos.
- Valida el formato de las conexiones PostgreSQL y que ambas indiquen el mismo nombre de base de datos. Esto no demuestra que conecten a la misma instancia ni que sus usuarios tengan permisos adecuados.
- Admite únicamente `development`, `test` o `production` para `NODE_ENV`.
- En producción exige CORS explícito con HTTPS, cookies `Secure` y un secreto JWT de al menos 32 bytes. La longitud por sí sola no garantiza la calidad del secreto.
- Acepta orígenes CORS HTTP(S) exactos; rechaza credenciales, rutas adicionales, parámetros y fragmentos. Normaliza y elimina entradas repetidas.
- Conserva el origen local predeterminado en desarrollo y la compatibilidad con `FRONTEND_URL`.
- Comprueba puerto, configuración de Swagger y opciones de cookies, incluida la relación entre `SameSite=None` y `Secure`.
- Añade 42 casos de configuración y CORS a las pruebas unitarias.

Los cuatro archivos de código afectados son `src/config/runtime-config.ts`, `src/config/runtime-config.spec.ts`, `src/app.module.ts` y `src/main.ts`. Los cambios previos de cookies y health checks presentes en la rama remota se conservaron; no se atribuyen a este incremento.

## 3. Cambios en la base de datos

Se agregó `scripts/audit-runtime-roles.sql`. Ejecuta una transacción de solo lectura, consulta catálogos de PostgreSQL y termina con `ROLLBACK`. Devuelve un resultado `PASS` o `FAIL` para cada comprobación:

1. Existencia y validez del rol esperado de aplicación o ingesta.
2. Disponibilidad efectiva de los privilegios del rol esperado.
3. Ausencia de privilegios elevados en el usuario de conexión y el rol activo.
4. Ausencia de membresías en roles elevados, evaluada de forma conservadora.
5. Separación entre membresías de aplicación e ingesta.
6. Existencia de las ocho tablas protegidas y activación de RLS, la seguridad por fila.
7. Ausencia de membresía en los roles propietarios de esas tablas.
8. Ausencia de membresía en el rol propietario de la base de datos.
9. Ausencia de permiso de borrado físico sobre `devices.device`.

El diagnóstico revisa tanto `session_user` como `current_user`, para detectar una conexión administrativa aunque haya cambiado su rol activo mediante `SET ROLE`.

También se agregó `scripts/test-runtime-roles.ps1`, que crea un PostgreSQL 16 temporal con datos sintéticos, sin red ni puertos publicados y con almacenamiento en memoria. Al terminar elimina únicamente el contenedor creado para esa prueba.

**Límite del diagnóstico:** una fila `FAIL` no cambia automáticamente el código de salida de `psql`; cualquier integración automatizada debe revisar los resultados. Obtener todas las filas en `PASS` tampoco demuestra que las políticas RLS de negocio o el aislamiento entre hogares funcionen correctamente.

## 4. Validaciones realizadas

Los resultados siguientes corresponden a la ejecución del incremento de código del 14/10/2026. Para redactar este reporte se revisaron la documentación y el historial Git; no se volvieron a ejecutar las suites.

| Validación | Resultado | Alcance de la evidencia |
|---|---|---|
| Pruebas unitarias del backend | 47 pruebas aprobadas en 3 suites. | Incluyen los 42 casos nuevos de configuración y CORS. |
| Compilación NestJS | Aprobada. | El proyecto compila con el cliente Prisma generado. |
| TypeScript con `--noEmit` | Aprobado. | Comprobación de tipos. |
| ESLint | Aprobado en los 4 archivos de código modificados. | No acredita una ejecución global de lint. |
| Auditoría SQL en PostgreSQL 16 temporal | 6 escenarios aprobados. | Comprueba el diagnóstico sobre roles y tablas sintéticos. |
| Revisión de cambios y enlaces Markdown | Sin errores en las comprobaciones registradas. | Formato del diff y enlaces locales de la documentación del incremento. |

Los seis escenarios SQL fueron: conexión normal de aplicación, conexión normal de ingesta, rol elevado asumible, rol esperado incorrecto, administrador oculto tras `SET ROLE` y RLS deshabilitado. En los escenarios inseguros, aprobar la prueba significa detectar los fallos esperados.

La primera ejecución del contenedor detectó una carrera durante su inicialización. Se corrigió la espera para comprobar el servidor definitivo mediante TCP loopback y se repitieron los seis escenarios satisfactoriamente.

Estas pruebas no utilizaron credenciales reales ni una base de datos en uso. No se ejecutaron pruebas integrales de JWT y múltiples hogares, políticas RLS reales, MQTT, Shelly, push Android, carga, migraciones o despliegue.

## 5. Commits publicados

| Repositorio | Rama | Commit | Contenido |
|---|---|---|---|
| [Backend](https://github.com/nataliachala1/smarthome-backend/tree/09-dev) | `09-dev` | [7447822](https://github.com/nataliachala1/smarthome-backend/commit/7447822) | Validación de configuración de HU09 y pruebas unitarias. |
| Backend | `09-dev` | [dc1cbfc](https://github.com/nataliachala1/smarthome-backend/commit/dc1cbfc) | Informe de auditoría, documentación del incremento y exclusión del repositorio BD anidado. |
| [Base de datos](https://github.com/nataliachala1/smarthome-database/tree/09-dev) | `09-dev` | [f097a0a](https://github.com/nataliachala1/smarthome-database/commit/f097a0a) | Auditoría de roles, pruebas PostgreSQL aisladas y documentación. |

El backend partió de `8235727`, que ya existía en `origin/09-dev`. La rama `09-dev` de BD se creó desde `03-dev`, en `e18b2d0`. Los incrementos `7447822` y `f097a0a` son compatibles sin nuevos changesets.

Antes de redactar este documento, ambas ramas locales coincidían con sus referencias de seguimiento `origin/09-dev`, actualizadas por los pushes exitosos. El archivo local preexistente `revision-dispositivos.txt` de BD se mantuvo fuera de los commits.

## 6. Pendientes y siguiente trabajo

| Pendiente | Referencia | Evidencia necesaria para cerrarlo |
|---|---|---|
| Contrastar el estado instalado de BD | BD-01 / BD-03 | Historial Liquibase, checksums y camino incremental compatibles con la base existente. |
| Verificar permisos efectivos | BD-02 / BD-03 | Diagnóstico con los usuarios reales de aplicación e ingesta y pruebas de aislamiento. |
| Completar configuración operativa | BD-02 | Límites de solicitudes, correo y configuración efectiva del entorno objetivo. |
| Validar permisos por hogar y rol | BD-04 | Matriz acordada de OWNER, MEMBER y GUEST, con accesos permitidos y denegados. |
| Reforzar sesiones Socket.IO | BD-17 | Renovación, revocación, logout-all, pertenencia a rooms y rechazo de orígenes no autorizados; depende de BD-02 y BD-04. |
| MQTT cloud, credenciales y pairing | HU `10-dev` a `13-dev` | Infraestructura y contratos definidos, pruebas de integración y validación con el Shelly disponible. |
| Staging y operación | HU `14-dev` y `15-dev` | Entorno reproducible, migraciones verificadas, smoke tests y evidencia operativa. |

El siguiente incremento previsto dentro de HU09 es revisar e implementar los límites de solicitudes con sus pruebas. En paralelo debe concretarse la matriz de permisos necesaria para aceptar la revocación de sesiones y la entrega de eventos en tiempo real.

La HU permanece abierta. No se asigna un porcentaje de avance porque aún no se han validado todos sus criterios de aceptación.

## 7. Alcance operativo y documentos de soporte

Durante este avance se modificó código y documentación, se instalaron las dependencias del lockfile, se generó el cliente Prisma y se ejecutaron pruebas locales y PostgreSQL aislado. Los commits se publicaron en las ramas de trabajo.

No se aplicaron migraciones a bases en uso, no se reescribieron changesets y no se modificaron broker, Shelly ni servicios de producción. No hubo merge a `main` o `dev`, force push ni despliegue.

- [Detalle de implementación HU09 del backend](IMPLEMENTACION_HU09.md).
- [Auditoría inicial y backlog BD-01 a BD-20](INFORME_01_AUDITORIA_BACKEND_BD_2026-10-12.md).
- [Documentación de seguridad de BD correspondiente al commit publicado](https://github.com/nataliachala1/smarthome-database/blob/f097a0a/docs/HU09_SEGURIDAD_RUNTIME.md).

**Estado de entrega:** primer incremento disponible en GitHub con validaciones locales satisfactorias; cierre integral de HU09 y preparación para producción pendientes.
