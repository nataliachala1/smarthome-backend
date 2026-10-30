# SQL034 — API de tarifas, presupuesto mensual y costo estimado

**Módulo:** `src/modules/energy` · **Rama:** `feat/sql34-prisma-energy-models` · **Base de datos:** changesets `smarthome-sql034-energy-tariff-budget-20261029` y `smarthome-sql034-energy-goal-optional-budget-20261029` de `smarthome-database`.

Esta API expone la configuración energética de un hogar: tarifa referencial COP/kWh con historial de vigencias, presupuesto y meta mensual de consumo, y un resumen mensual con el costo **estimado** a partir de las lecturas reales. Respeta los permisos que SQL034 implementa en PostgreSQL (funciones de autorización y RLS).

> El costo es una **estimación** basada en una tarifa referencial COP/kWh. No incluye impuestos, subsidios, contribuciones, cargos fijos ni reglas comerciales de la empresa prestadora: no equivale al valor de la factura.

---

## 1. Resumen de endpoints

Prefijo: `/api/v1/homes/:homeId/energy`. Todos requieren `Authorization: Bearer <accessToken>`.

| Método y ruta | Descripción | OWNER | MEMBER | GUEST |
|---|---|:---:|:---:|:---:|
| `GET /tariffs` | Historial de tarifas, de la vigencia más reciente a la más antigua | ✔ | ✔ (\*) | ✘ 403 |
| `GET /tariffs/current?at=YYYY-MM-DD` | Tarifa vigente en una fecha local | ✔ | ✔ (\*) | ✘ 403 |
| `POST /tariffs` | Registrar una nueva vigencia de tarifa | ✔ hogar activo | ✘ 403 | ✘ 403 |
| `GET /goals?month=YYYY-MM` | Presupuesto y meta del mes | ✔ | ✔ (\*) | ✘ 403 |
| `PUT /goals/:month` | Crear o reemplazar presupuesto y meta del mes | ✔ hogar activo | ✘ 403 | ✘ 403 |
| `GET /summary?month=YYYY-MM` | kWh del mes, costo estimado y avance | ✔ | ✔ (\*) | ✘ 403 |

(\*) MEMBER con membresía `ACTIVE`, en hogar activo y con permiso `view_consumption` efectivo.

No existen rutas para **editar ni borrar tarifas** (son históricas e inmutables: un cambio de precio es una nueva vigencia) ni para **borrar metas**. La base de datos tampoco concede esos permisos a la aplicación.

La documentación interactiva está en Swagger (`/api/docs`), etiqueta **energy**.

---

## 2. Convenciones

| Tema | Regla |
|---|---|
| **Decimales** | Se envían y se reciben como **texto** para no perder precisión: `"950.25"`, nunca `950.25`. Sin signo, sin notación científica, sin comas, sin espacios ni ceros a la izquierda. Siempre mayores que 0. |
| Precisión | Tarifa `NUMERIC(14,4)`: hasta 10 enteros y 4 decimales. Presupuesto `NUMERIC(14,2)`: hasta 12 enteros y 2 decimales. Meta kWh `NUMERIC(14,6)`: hasta 8 enteros y 6 decimales. Las respuestas siempre traen la escala completa (`"950.2500"`, `"120000.00"`, `"125.000000"`). |
| **Fechas** | `YYYY-MM-DD`, fecha real (se rechaza `2026-02-30`), sin hora, año 2000–2099. |
| **Meses** | `YYYY-MM`, mes `01`–`12`, año 2000–2099. En la base se guarda como el día 1 del mes. |
| **Zona horaria** | Calendario de `America/Bogota` (UTC−5 fijo). Un mes va desde el día 1 a las 00:00 en Bogotá (incluido) hasta el día 1 del mes siguiente a las 00:00 (excluido). |
| Valores por defecto | Sin `at`, se usa la fecha de hoy en Bogotá. Sin `month`, el mes actual en Bogotá. |
| `homeId` | UUID válido. |
| Campos extra | Cualquier campo o parámetro no documentado se rechaza con 400. |

El rango de años 2000–2099 es un límite técnico (evita valores que PostgreSQL o JavaScript no pueden representar). Se define en una sola constante: `src/modules/energy/application/utils/energy-month.ts`.

---

## 3. Permisos y seguridad

Cada operación pasa por tres capas:

1. **JWT** (`JwtAuthGuard`): sin token, token vencido, sesión revocada o cuenta inactiva → `401`.
2. **Autorización explícita en la base**, dentro de la misma transacción RLS (`PrismaRlsService.withUserContext`) y **antes** de tocar las tablas:
   - lectura → `consumption.fn_can_read_detail(id_home)`: OWNER (también en hogar desactivado, para consultar el historial) o MEMBER activo con `view_consumption` en hogar activo;
   - escritura → `homes.fn_can_manage_home(id_home)`: OWNER activo, con cuenta activa, de un hogar activo.
3. **RLS de PostgreSQL** sobre `config.home_energy_tariff`, `config.home_energy_goal` y `consumption.consumption`, como última barrera.

Otras reglas:

- El rol global del JWT (`user.role`) **no** reemplaza al rol de membresía del hogar.
- Los `403` son genéricos: no distinguen entre hogar inexistente y hogar sin permiso, para evitar enumeración.
- Las respuestas nunca incluyen SQL, nombres de roles técnicos ni trazas.
- **GUEST** no recibe tarifas, presupuestos, metas ni costos. Su respuesta en `GET /api/v1/homes/:homeId/consumption/summary` no cambia (solo `homeId`, `from`, `to` y `totalEnergyDeltaKwh`).
- Si se revoca la membresía (`REVOKED`, `LEFT`) o se quita `view_consumption` al MEMBER, pierde el acceso económico desde la siguiente solicitud.

La matriz completa está en [`ROLES_Y_PERMISOS.md`](./ROLES_Y_PERMISOS.md), sección "Configuración energética y costos (SQL034)".

---

## 4. Tarifas

### 4.1 `GET /tariffs` — Historial

**200**

```json
{
  "homeId": "20000000-0000-4000-8000-000000000001",
  "tariffs": [
    {
      "id": "8d5cbbe2-aa4d-4130-b623-a0da696dd53b",
      "homeId": "20000000-0000-4000-8000-000000000001",
      "unitPriceCopKwh": "1010.5000",
      "effectiveFrom": "2026-10-12",
      "createdAt": "2026-10-30T16:12:31.677Z"
    },
    {
      "id": "415f200b-c14f-4a72-b5e4-a8eda56a7665",
      "homeId": "20000000-0000-4000-8000-000000000001",
      "unitPriceCopKwh": "950.2500",
      "effectiveFrom": "2026-10-01",
      "createdAt": "2026-10-30T16:12:31.640Z"
    }
  ]
}
```

Sin tarifas registradas: `"tariffs": []`.

### 4.2 `GET /tariffs/current?at=YYYY-MM-DD` — Tarifa vigente

Devuelve la tarifa con la **mayor** `effectiveFrom` que sea **menor o igual** a `at`. Nunca devuelve una tarifa con vigencia futura.

**200** (`at=2026-10-15`)

```json
{
  "homeId": "20000000-0000-4000-8000-000000000001",
  "at": "2026-10-15",
  "tariff": {
    "id": "8d5cbbe2-aa4d-4130-b623-a0da696dd53b",
    "homeId": "20000000-0000-4000-8000-000000000001",
    "unitPriceCopKwh": "1010.5000",
    "effectiveFrom": "2026-10-12",
    "createdAt": "2026-10-30T16:12:31.677Z"
  }
}
```

**200** sin tarifa vigente en esa fecha (`at=2026-09-30`):

```json
{ "homeId": "20000000-0000-4000-8000-000000000001", "at": "2026-09-30", "tariff": null }
```

### 4.3 `POST /tariffs` — Registrar nueva vigencia

Solo OWNER de un hogar activo. Para cambiar el precio se registra una nueva fila con otra fecha de vigencia; las anteriores no se modifican. Se permiten fechas pasadas y futuras.

**Body**

```json
{ "unitPriceCopKwh": "950.25", "effectiveFrom": "2026-10-01" }
```

**201**

```json
{
  "id": "415f200b-c14f-4a72-b5e4-a8eda56a7665",
  "homeId": "20000000-0000-4000-8000-000000000001",
  "unitPriceCopKwh": "950.2500",
  "effectiveFrom": "2026-10-01",
  "createdAt": "2026-10-30T16:12:31.640Z"
}
```

**409** si ya existe una tarifa con la misma `effectiveFrom` en ese hogar (no se inserta nada). Hogares distintos pueden tener la misma fecha.

```json
{ "code": "ENERGY_TARIFF_DUPLICATE", "message": "Ya existe una tarifa con esa fecha de vigencia para este hogar" }
```

---

## 5. Presupuesto y meta mensual

### 5.1 `GET /goals?month=YYYY-MM`

**200** con configuración:

```json
{
  "homeId": "20000000-0000-4000-8000-000000000001",
  "month": "2026-10",
  "goal": {
    "id": "27e8ba87-8d11-42a7-936e-d1b15fc56b5d",
    "homeId": "20000000-0000-4000-8000-000000000001",
    "month": "2026-10",
    "monthlyBudgetCop": "120000.00",
    "targetKwh": "125.000000",
    "createdAt": "2026-10-30T16:12:31.836Z",
    "updatedAt": "2026-10-30T16:12:31.836Z"
  }
}
```

**200** sin configuración para ese mes (no es `404`):

```json
{ "homeId": "20000000-0000-4000-8000-000000000001", "month": "2026-11", "goal": null }
```

### 5.2 `PUT /goals/:month` — Crear o reemplazar

Solo OWNER de un hogar activo. **Reemplazo completo**: los dos campos son obligatorios en el JSON. `null` significa "no configurado"; **omitir** un campo es un error `400`. Se acepta solo presupuesto, solo meta o ambos; **no** ambos `null`.

Es **idempotente** sobre (hogar, mes): repetir el mismo `PUT` no crea filas nuevas y devuelve el mismo `id`. Solo se actualizan `monthlyBudgetCop` y `targetKwh`; el mes, el hogar y `createdAt` nunca cambian. `updatedAt` lo actualiza un trigger de la base. Si dos escrituras del mismo mes llegan a la vez, gana la última; si chocan en el mismo instante, una responde `409` y se debe reintentar.

**Body** (ambos):

```json
{ "monthlyBudgetCop": "120000.00", "targetKwh": "125" }
```

Solo meta: `{ "monthlyBudgetCop": null, "targetKwh": "125" }` · Solo presupuesto: `{ "monthlyBudgetCop": "120000", "targetKwh": null }`

**200**

```json
{
  "id": "27e8ba87-8d11-42a7-936e-d1b15fc56b5d",
  "homeId": "20000000-0000-4000-8000-000000000001",
  "month": "2026-10",
  "monthlyBudgetCop": "120000.00",
  "targetKwh": "125.000000",
  "createdAt": "2026-10-30T16:12:31.836Z",
  "updatedAt": "2026-10-30T16:12:31.836Z"
}
```

**400** si ambos son `null` (no se escribe nada):

```json
{ "code": "ENERGY_GOAL_VALUE_REQUIRED", "message": "Debe indicar el presupuesto mensual (COP), la meta de consumo (kWh) o ambos" }
```

---

## 6. Resumen mensual con costo estimado

### `GET /summary?month=YYYY-MM`

**Cálculo**

1. Período: el mes en `America/Bogota`, `[día 1 00:00, día 1 del mes siguiente 00:00)`.
2. Se suman `energy_delta_kwh` de las lecturas del período que el usuario puede ver según RLS (ver 6.1).
3. A **cada lectura** se le aplica la tarifa con mayor `effectiveFrom` ≤ **fecha local de esa lectura**. Si la tarifa cambia a mitad de mes, cada parte usa su precio; nunca se aplica la tarifa actual a todo el mes ni una tarifa futura.
4. Todo se calcula en `NUMERIC` exacto en PostgreSQL. Los redondeos y porcentajes usan aritmética decimal exacta con redondeo *half-up* (sin `Number` binario). Costos con 2 decimales, kWh con 6, porcentajes con 2.
5. Si alguna lectura con consumo distinto de 0 **no tiene tarifa** aplicable (por ejemplo, anterior a la primera vigencia): `costComplete: false`, `estimatedCostCop: null`, y se informan `unpricedReadings` y `partialCostCop`. **Un costo parcial nunca se presenta como total.**
6. `budgetUsagePercent = estimatedCostCop / monthlyBudgetCop × 100` (solo si hay presupuesto y el costo está completo). `targetUsagePercent = totalKwh / targetKwh × 100` (solo si hay meta). **No se recortan a 100 %**: superar el presupuesto o la meta da más de 100.
7. Mes sin lecturas: `totalKwh: "0.000000"`, `readingsCount: 0` y costo `"0.00"` con `costComplete: true`.
8. No se guardan importes calculados ni se modifican lecturas.

**200**

```json
{
  "homeId": "20000000-0000-4000-8000-000000000001",
  "month": "2026-10",
  "timezone": "America/Bogota",
  "from": "2026-10-01T05:00:00.000Z",
  "to": "2026-11-01T05:00:00.000Z",
  "readingsCount": 4,
  "unpricedReadings": 0,
  "totalKwh": "1.300000",
  "costComplete": true,
  "estimatedCostCop": "1271.48",
  "partialCostCop": "1271.48",
  "monthlyBudgetCop": "120000.00",
  "targetKwh": "125.000000",
  "budgetUsagePercent": "1.06",
  "targetUsagePercent": "1.04",
  "currency": "COP"
}
```

En este ejemplo, las lecturas del 10 y 11 de octubre (0,1 + 0,2 + 0,4 kWh) usan la tarifa vigente desde el 1 de octubre (950,25), y la del 12 de octubre (0,6 kWh) usa la del 12 (1010,5): 665,175 + 606,3 = 1271,475 → **1271,48**.

**200** con lecturas sin tarifa (ejemplo con otras tarifas, extracto):

```json
{
  "readingsCount": 4,
  "unpricedReadings": 1,
  "totalKwh": "1.300000",
  "costComplete": false,
  "estimatedCostCop": null,
  "partialCostCop": "1800.00",
  "budgetUsagePercent": null
}
```

| Campo | Significado |
|---|---|
| `from`, `to` | Instantes UTC del inicio (incluido) y fin (excluido) del mes en Bogotá |
| `readingsCount` | Lecturas del período visibles para el usuario |
| `unpricedReadings` | Lecturas con consumo sin tarifa aplicable en su fecha local |
| `totalKwh` | kWh del mes |
| `costComplete` | `true` si todas las lecturas con consumo tienen tarifa |
| `estimatedCostCop` | Costo estimado; `null` si `costComplete` es `false` |
| `partialCostCop` | Costo de las lecturas que sí tienen tarifa |
| `monthlyBudgetCop`, `targetKwh` | Configuración del mes, o `null` |
| `budgetUsagePercent`, `targetUsagePercent` | Avance; `null` cuando no aplica |

### 6.1 Visibilidad del MEMBER

El resumen suma solo las lecturas que RLS permite ver al usuario. Por la regla de consumo de la release 018, un **MEMBER** solo ve lecturas de dispositivos **activos** sobre los que tiene `view_consumption`. El **OWNER** también ve las de dispositivos desactivados o eliminados. Por eso, para el mismo mes, el total y el costo de un MEMBER pueden ser **menores** que los del OWNER.

Ejemplo verificado con la fixture de pruebas: OWNER 1,3 kWh; MEMBER 0,3 kWh. Si se requiere que el MEMBER vea el total del hogar, hace falta un cambio en la base de datos, fuera del alcance de SQL034.

---

## 7. Errores

### 7.1 Errores de negocio (cuerpo `{ code, message }`)

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `ENERGY_GOAL_VALUE_REQUIRED` | `PUT /goals/:month` con presupuesto y meta ambos `null` |
| 403 | `ENERGY_READ_FORBIDDEN` | Lectura sin permiso: GUEST, sin membresía, membresía `PENDING`/`REVOKED`/`LEFT`, MEMBER sin `view_consumption`, MEMBER en hogar desactivado, o hogar inexistente |
| 403 | `ENERGY_MANAGE_FORBIDDEN` | Escritura por quien no es OWNER de un hogar activo |
| 409 | `ENERGY_TARIFF_DUPLICATE` | Tarifa con una `effectiveFrom` ya registrada en el hogar |
| 409 | `ENERGY_GOAL_CONCURRENT_WRITE` | Dos escrituras simultáneas del mismo mes; reintentar |

```json
{ "code": "ENERGY_READ_FORBIDDEN", "message": "Sin permisos para consultar la configuración energética de este hogar" }
```

```json
{ "code": "ENERGY_MANAGE_FORBIDDEN", "message": "Solo el propietario de un hogar activo puede modificar la configuración energética" }
```

### 7.2 Errores de validación (formato estándar de NestJS)

| Caso | Ejemplo de `message` |
|---|---|
| Body o query inválidos | lista de mensajes por campo |
| `homeId` no es UUID | `"Validation failed (uuid is expected)"` |
| Mes inválido en la ruta | `"month debe tener formato YYYY-MM, con año entre 2000 y 2099 y mes entre 01 y 12"` |

```json
{
  "message": [
    "unitPriceCopKwh debe ser un decimal positivo en texto con máximo 10 enteros y 4 decimales",
    "effectiveFrom debe ser una fecha real"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

Otros mensajes posibles: `"effectiveFrom debe tener formato YYYY-MM-DD, con año entre 2000 y 2099"`, `"monthlyBudgetCop debe ser un decimal positivo en texto con máximo 12 enteros y 2 decimales"` (también cuando se omite el campo), `"targetKwh debe ser un decimal positivo en texto con máximo 8 enteros y 6 decimales"` y `"property x should not exist"` (campo extra).

### 7.3 Autenticación (`401`)

```json
{ "message": "Token de autenticación requerido", "error": "Unauthorized", "statusCode": 401 }
```

Otros mensajes: `"Token inválido"`, `"Token expirado"`, `"La sesión fue revocada"`, `"La cuenta no está activa"`.

---

## 8. Arquitectura del módulo

```text
src/modules/energy/
  energy.module.ts
  domain/
    entities/            home-energy-tariff, home-energy-goal (regla presupuesto o meta), home-energy-summary (reglas del resumen)
    services/            decimal-math (aritmética decimal exacta)
    repositories/        puertos abstractos: tarifas, metas, resumen
    errors/              errores de dominio
  application/
    dto/                 entrada (validación) y respuestas (Swagger)
    use-cases/           6 casos de uso
    utils/               fechas de Bogotá y rango de meses
    validators/          decimal positivo en texto
    energy-http-error.ts errores de dominio → HTTP
  infrastructure/persistence/
    energy-access.ts     fn_can_read_detail / fn_can_manage_home
    prisma-*.repository.ts  implementaciones con withUserContext
  presentation/
    controllers/         tarifas, metas, resumen
    pipes/               mes de la ruta
```

Los modelos Prisma `home_energy_tariff` y `home_energy_goal` están en `prisma/schema.prisma`. **Liquibase es la fuente de verdad del esquema**: no se usan `prisma migrate` ni `db push`.

---

## 9. Pruebas

| Tipo | Archivos | Cómo ejecutarlas |
|---|---|---|
| Unitarias (dominio, DTO, casos de uso, repositorios con BD simulada, HTTP de validación, seguridad) | `src/modules/energy/**/*.spec.ts` | `npm test -- --runInBand` |
| Integración con PostgreSQL real, todas las migraciones, RLS activa y LOGIN no privilegiado (21 casos: T01–T12, T15–T17, T19–T24) | `test/energy-access-postgres.e2e-spec.ts` | `powershell -ExecutionPolicy Bypass -File scripts\test-energy-access.ps1` (requiere Docker y `smarthome-database` en rama `dev`) |

El script de integración crea un PostgreSQL desechable en Docker, aplica Liquibase, carga `scripts/consumption-access-fixture.sql`, ejecuta las pruebas y elimina el contenedor. **Nunca** se conecta a la base local de desarrollo ni a la del VPS.

---

## 10. Despliegue y dependencias

Procedimiento completo, script de verificación de la BD DEV (`scripts/verify-sql034-dev.sql`) y pruebas de humo en [`SQL034_DESPLIEGUE.md`](./SQL034_DESPLIEGUE.md). Contrato resumido para la app en [`SQL034_CONTRATO_MOVIL.md`](./SQL034_CONTRATO_MOVIL.md).

1. **Antes de desplegar este backend**, confirmar que la base **DEV del VPS** (la de `DATABASE_URL`) tiene aplicados los dos changesets de SQL034 y la columna `monthly_budget_cop` acepta `null`. Haber fusionado SQL034 en GitHub no lo garantiza: el `deploy` del workflow de la base está deshabilitado.
2. Orden recomendado: respaldo de la BD DEV → aplicación controlada de SQL034 → verificación SQL → merge y despliegue del backend → pruebas autenticadas OWNER/MEMBER/GUEST → integración con la app móvil.
3. `DATABASE_URL` debe usar un LOGIN miembro de `smarthome_runtime_app`, sin superusuario ni `BYPASSRLS`.
4. **Reversión:** se revierte el código del backend; **no** ejecutar `liquibase rollback` de SQL034 en el VPS, porque borraría la configuración económica real.

---

## 11. Límites conocidos

- Costo **estimado** con tarifa referencial; no es el valor de la factura.
- Fechas y meses admitidos: años 2000–2099.
- El total y el costo del MEMBER pueden ser menores que los del OWNER (ver 6.1).
- La prueba existente `test/consumption-access-postgres.e2e-spec.ts` tiene 5 fallos que ya existían en `dev` antes de SQL034. Esperan que el MEMBER vea historiales de dispositivos desactivados o eliminados, algo que la release 018 ya no permite. Corresponde al módulo de consumo.
