# SQL034 — Evidencia de validación del PR #15

**Backend:** rama `feat/sql34-prisma-energy-models` (PR #15 → `dev`) · **Base de datos:** `smarthome-database`, `releases/034_energy_tariff_budget/` (SQL034/001 y SQL034/002).

Este documento reúne la matriz de casos que pidió la revisión del PR #15 y la prueba automatizada que demuestra cada uno. También contiene el texto de la descripción del PR (sección 4).

No contiene tokens, contraseñas, cadenas de conexión ni datos personales. Las pruebas usan la fixture sintética `db/scripts/consumption-access-fixture.sql` de `smarthome-database`.

---

## 1. Cómo se obtiene la evidencia

| Comando | Qué valida |
|---|---|
| `npm run lint` | estilo y reglas de ESLint |
| `npx tsc --noEmit -p tsconfig.build.json` | tipos |
| `npm test -- --runInBand` | pruebas unitarias y HTTP (Nest + supertest) |
| `npm run build` | compilación |
| `powershell -ExecutionPolicy Bypass -File scripts\test-energy-access.ps1` | integración con **PostgreSQL 16 real**: las 96 migraciones de `smarthome-database` (incluidas SQL034/001 y SQL034/002), la fixture oficial y un LOGIN **no privilegiado** (`consumption_app_test`: sin superusuario, sin `BYPASSRLS`, no dueño de tablas) |
| GitHub Actions `PR validation (dev) - no deploy` | `npm ci`, lint, typecheck, pruebas unitarias, build y pruebas aisladas de MQTT, sin despliegue |

En la tabla de la sección 2, **"PG real"** es `test/energy-access-postgres.e2e-spec.ts` (ejecutada por `scripts/test-energy-access.ps1`). Una prueba con mocks no reemplaza esa prueba: la matriz cita ambas cuando existen.

---

## 2. Matriz de casos

| Caso | Esperado | Evidencia |
|---|---|---|
| OWNER activo: consultar y crear tarifas | `200` / `201` | PG real: `T01/T09: OWNER registra tarifas...` y `tarifa vigente: la mayor vigencia <= fecha...` |
| OWNER activo: consultar y guardar meta mensual | `200` / `200` | PG real: `T11/T23: metas con presupuesto, solo kWh o ambos...` |
| MEMBER con `view_consumption`: consultas | `200` en lectura | PG real: `T02/T03: MEMBER autorizado consulta todo pero no puede registrar tarifas ni metas` |
| MEMBER: registrar tarifas o modificar metas | `403 ENERGY_MANAGE_FORBIDDEN` | PG real: `T02/T03` (misma prueba) |
| MEMBER sin `view_consumption` | `403 ENERGY_READ_FORBIDDEN` | PG real: `T05/T06: quitar view_consumption al MEMBER corta el acceso económico y restaurarlo lo devuelve` |
| GUEST: ver información económica | `403 ENERGY_READ_FORBIDDEN`, sin fuga de datos | PG real: `T04/T22: GUEST no recibe datos económicos...` (revisa que el cuerpo no tenga campos económicos) |
| Usuario sin sesión o sesión inválida | `401` | PG real: `T20: cuenta inactiva o sin token responde 401` |
| Hogar ajeno o membresía revocada | Acceso denegado | PG real: `T07/T08: usuario %s (sin membresía, PENDING, REVOKED, LEFT o creador anterior) recibe 403 sin datos`, `T07: al revocar la membresía...`, `T15: dos hogares con la misma fecha de tarifa son independientes...`, `RLS es la última barrera...` |
| Hogar desactivado | OWNER consulta, no escribe; MEMBER no consulta | PG real: `T19: hogar desactivado...` |
| Tarifa duplicada en la misma fecha | `409 ENERGY_TARIFF_DUPLICATE` | PG real: `T01/T09` · HTTP: `energy-validation.http.spec.ts` → `tarifa con la misma fecha de vigencia: 409 ENERGY_TARIFF_DUPLICATE` |
| Presupuesto y meta ambos `null` | `400 ENERGY_GOAL_VALUE_REQUIRED` | PG real: `T12: presupuesto y meta ambos null responde 400 y no modifica la meta guardada` · HTTP: `energy-validation.http.spec.ts` |
| `PUT` repetido con el mismo valor | Idempotente, sin duplicados | PG real: `T11/T23` (cuenta las filas del mes después de repetir el `PUT`) |
| Fecha local y mes en `America/Bogota` | Correcto en los bordes del mes | Unitarias: `bogota-date.spec.ts` (calendario de Bogotá y no UTC, cambio de mes, diciembre → enero) · PG real: `T16/T17/T24` (el mes va de `2026-10-01T05:00Z` a `2026-11-01T05:00Z`, medianoche de Bogotá) |
| Lectura sin tarifa vigente | `costComplete: false` y `estimatedCostCop: null` | Unitaria: `home-energy-summary.spec.ts` → `con lecturas sin tarifa: no presenta el costo parcial como total` · PG real: `T16/T17/T24` |
| Tarifas históricas | Cada lectura con la tarifa de su fecha, no la de hoy | PG real: `T16/T17/T24: costo por lectura con la tarifa de su fecha local...` (cambio de tarifa a mitad de mes) |
| La BD no permite editar ni borrar tarifas, ni borrar metas | Rechazo de PostgreSQL | PG real: `T10: la BD rechaza editar o borrar tarifas, borrar metas o cambiar su mes, incluso al OWNER` |
| Sin fuga de contexto entre solicitudes | `app.current_user_id` no se conserva | PG real: `T21: la misma conexión no conserva el contexto de un usuario para el siguiente` |
| LOGIN de prueba no privilegiado | Sin superusuario, `BYPASSRLS` ni propiedad de tablas | PG real: `usa un LOGIN real sin superusuario, BYPASSRLS ni pertenencia a roles elevados o dueños de tablas` |
| PostgreSQL `42501` en `GET` | `403 ENERGY_READ_FORBIDDEN` | **Nueva.** HTTP: `energy-rls-denial.http.spec.ts` (los 4 `GET`, cuerpo exacto `{code, message}` y sin detalles SQL) · Repositorios: `energy-repositories.security.spec.ts` y `prisma-home-energy-summary.repository.spec.ts` |
| PostgreSQL `42501` en `POST`/`PUT` | `403 ENERGY_MANAGE_FORBIDDEN` | **Nueva.** HTTP: `energy-rls-denial.http.spec.ts` (`POST /tariffs`, `PUT /goals/:month`) · Repositorios: `energy-repositories.security.spec.ts` |
| Traducción de errores de dominio a HTTP | `status` y `{code, message}` correctos | **Nueva.** `energy-http-error.spec.ts` (los 5 errores de dominio) |
| CI del PR | lint, tipos, pruebas y build en verde | GitHub Actions `PR validation (dev) - no deploy` (enlace en el PR) |

### Sobre la nueva prueba de `42501`

`energy-rls-denial.http.spec.ts` levanta los controladores reales con los casos de uso y repositorios Prisma reales. Solo simula `PrismaRlsService` para que PostgreSQL rechace con `42501` y un mensaje con detalles SQL (tabla, esquema y rol). Comprueba que:

- los `GET` responden `403` con `{"code":"ENERGY_READ_FORBIDDEN", ...}`;
- `POST` y `PUT` responden `403` con `{"code":"ENERGY_MANAGE_FORBIDDEN", ...}`;
- ninguna respuesta contiene `42501`, `permission denied`, nombres de tablas, esquemas, roles ni SQL.

Con el código anterior a la corrección, 4 de sus 6 pruebas fallaban (los `GET` respondían `ENERGY_MANAGE_FORBIDDEN`). Con la corrección pasan las 6. Los guards y las políticas RLS no se modificaron.

---

## 3. Resultados

| Validación | Resultado |
|---|---|
| lint | 0 errores |
| typecheck | 0 errores |
| Pruebas unitarias | 929 aprobadas, 9 omitidas, 0 fallos (78 suites) |
| build | OK |
| MQTT aislada (`test/mqtt-namespace-security.e2e-spec.ts`) | 31/31 |
| Integración PostgreSQL real (`test/energy-access-postgres.e2e-spec.ts`) | 21/21 |

El SHA exacto sobre el que se ejecutó y el enlace de GitHub Actions se publican como comentario en el PR (un documento no puede citar el SHA del commit que lo contiene).

### Fallos E2E preexistentes, separados de este PR

`test/consumption-access-postgres.e2e-spec.ts` (módulo de consumo) se ejecutó en `dev` antes de SQL034 (commit `1cbaca2`) y en la rama del PR, cada vez sobre una base nueva: **las mismas 5 pruebas fallan en ambos** (5 fallos, 23 aprobadas, 28 en total). El detalle está en `docs/SQL034_DESPLIEGUE.md`, sección 3.1. No los introduce este PR.

---

## 4. Descripción del PR #15

Texto para pegar en la descripción del PR:

```markdown
## SQL034 — Tarifas de energía, presupuesto y meta mensual, y costo estimado

Integra en el backend SQL034 de `smarthome-database` (`releases/034_energy_tariff_budget/`):
- **SQL034/001** `001_energy_tariff_budget.sql`: tablas `config.home_energy_tariff` y `config.home_energy_goal`, RLS, políticas y permisos.
- **SQL034/002** `002_energy_goal_optional_budget.sql`: `monthly_budget_cop` opcional (presupuesto o meta kWh, al menos uno).

Liquibase sigue siendo la fuente de verdad: este PR no incluye migraciones Prisma ni cambios en `smarthome-database`.

### Funcionalidades (todas implementadas)
- **Tarifas COP/kWh**: historial, tarifa vigente en una fecha y registro de nuevas vigencias. No hay edición ni borrado.
- **Presupuesto y meta mensual**: `PUT` idempotente con presupuesto, solo meta kWh o ambos.
- **Resumen mensual**: kWh y costo estimado, con la tarifa histórica de cada lectura según la fecha local de `America/Bogota`.
- **Reglas de acceso**: JWT + `PrismaRlsService.withUserContext` + `consumption.fn_can_read_detail` / `homes.fn_can_manage_home` + RLS.

### Endpoints (`/api/v1/homes/:homeId/energy`)

| Método y ruta | OWNER | MEMBER con `view_consumption` | GUEST |
|---|:---:|:---:|:---:|
| `GET /tariffs` | 200 | 200 | 403 `ENERGY_READ_FORBIDDEN` |
| `GET /tariffs/current?at=YYYY-MM-DD` | 200 | 200 | 403 `ENERGY_READ_FORBIDDEN` |
| `POST /tariffs` | 201 (hogar activo) | 403 `ENERGY_MANAGE_FORBIDDEN` | 403 `ENERGY_MANAGE_FORBIDDEN` |
| `GET /goals?month=YYYY-MM` | 200 | 200 | 403 `ENERGY_READ_FORBIDDEN` |
| `PUT /goals/:month` | 200 (hogar activo) | 403 `ENERGY_MANAGE_FORBIDDEN` | 403 `ENERGY_MANAGE_FORBIDDEN` |
| `GET /summary?month=YYYY-MM` | 200 | 200 | 403 `ENERGY_READ_FORBIDDEN` |

Sin token o con sesión inválida: 401. Tarifa duplicada: 409 `ENERGY_TARIFF_DUPLICATE`. Presupuesto y meta ambos `null`: 400 `ENERGY_GOAL_VALUE_REQUIRED`.

### Correcciones de la revisión
- **P1**: un rechazo `42501` de PostgreSQL en lecturas responde `ENERGY_READ_FORBIDDEN`; en `POST`/`PUT`, `ENERGY_MANAGE_FORBIDDEN`. Nuevas pruebas de repositorios y HTTP que validan el `code` y que no se filtran detalles SQL. Guards y RLS sin cambios.
- **P2**: nuevo workflow `.github/workflows/pr-validate-dev.yml` para todo PR hacia `dev`: `npm ci`, lint, typecheck, pruebas unitarias, build y MQTT aislada. Sin GHCR, secretos, webhooks, Dokploy ni VPS. `pr-shelly-mqtt-dev.yml` se conserva.
- **P3**: contrato móvil alineado con `EXPO_PUBLIC_API_URL` (termina en `/api/v1`) y el `ApiClient`, sin `/api/v1/api/v1`.
- **P4**: esta descripción y la matriz de evidencia.

### Validación (SHA final: ver comentario de evidencia)
- lint, typecheck y build: OK
- Pruebas unitarias: 929 aprobadas, 9 omitidas, 0 fallos
- Integración con PostgreSQL 16 real, 96 changesets, RLS y LOGIN no privilegiado: 21/21 (`scripts/test-energy-access.ps1`)
- CI `PR validation (dev) - no deploy`: en verde
- Matriz de casos: `docs/SQL034_EVIDENCIA_VALIDACION.md`

### Fallos E2E preexistentes (no introducidos por este PR)
`test/consumption-access-postgres.e2e-spec.ts` tiene **los mismos 5 fallos** en `dev` (`1cbaca2`, antes de SQL034) y en esta rama, sobre bases nuevas e idénticas. Esperan que el MEMBER vea historiales de dispositivos inactivos, algo que la release 018 ya no permite. Detalle: `docs/SQL034_DESPLIEGUE.md`, sección 3.1.

### Documentación
- `docs/SQL034_ENERGY_API.md`
- `docs/SQL034_CONTRATO_MOVIL.md`
- `docs/SQL034_DESPLIEGUE.md`
- `docs/ROLES_Y_PERMISOS.md`
- `docs/SQL034_EVIDENCIA_VALIDACION.md`

### ⚠️ Dependencia de infraestructura: NO HACER MERGE todavía
El merge a `dev` ejecuta `ci-deploy.yml` y puede desplegar en Dokploy. Los endpoints dependen de las tablas de SQL034.
**No fusionar** hasta que el equipo de BD/DevOps confirme respaldo, que SQL034/001 y SQL034/002 están aplicados en PostgreSQL DEV, y que `scripts/verify-sql034-dev.sql` (solo lectura) dé **19 PASS y LISTO**.
Este PR no ejecuta migraciones ni despliegues en el VPS.

### Límites conocidos
- El costo es una estimación con tarifa referencial; no es el valor de la factura.
- El MEMBER solo ve el consumo de dispositivos activos con permiso (release 018); su total puede ser menor que el del OWNER.
```

---

## 5. Comentario de evidencia del SHA final

Plantilla para publicar como comentario en el PR después del último push. Se reemplazan los valores entre `< >`:

```markdown
### Evidencia sobre el SHA final `<sha corto>`

| Validación | Resultado |
|---|---|
| CI `PR validation (dev) - no deploy` | ✅ <enlace a la ejecución de GitHub Actions> |
| lint / typecheck / build | ✅ 0 errores |
| Pruebas unitarias | ✅ 929 aprobadas, 9 omitidas, 0 fallos |
| Integración PostgreSQL real (`scripts/test-energy-access.ps1`) | ✅ 21/21 |
| `consumption-access-postgres` (preexistente) | 5 fallos, idénticos en `dev` `1cbaca2` |

Pendiente, a cargo de BD/DevOps: `verify-sql034-dev.sql` en PostgreSQL DEV → 19 PASS / LISTO. El PR sigue en Draft hasta entonces.
```
