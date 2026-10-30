# SQL034 — Contrato HTTP para la app móvil

**Para:** equipo de la app móvil (Expo / React Native) · **API:** v1 · **Referencia completa:** [`SQL034_ENERGY_API.md`](./SQL034_ENERGY_API.md)

Este documento resume lo que la app necesita para construir las pantallas de **tarifa eléctrica**, **presupuesto y meta mensual** y **costo estimado del consumo**. El contrato es estable: rutas, campos y códigos de error no cambiarán sin aviso.

> Disponible en DEV cuando el backend se despliegue después de confirmar SQL034 en la base de datos (ver `SQL034_DESPLIEGUE.md`).

---

## 1. Lo esencial

- **Base:** `{API_URL}/api/v1/homes/{homeId}/energy`
- **Auth:** `Authorization: Bearer {accessToken}`, igual que el resto de la API. Ante un `401`, aplicar el flujo actual de refresh o login.
- **Decimales como texto:** todos los montos y kWh viajan como **string**: `"950.2500"`, `"120000.00"`, `"125.000000"`. **Enviar** también strings. No hacer cálculos de dinero con `number`; para mostrarlos, formatear (sección 6).
- **Fechas:** `YYYY-MM-DD` · **Meses:** `YYYY-MM` · años 2000–2099 · calendario de **Bogotá**.
- **El backend decide los permisos.** La app puede ocultar botones según el rol del usuario en el hogar, pero **siempre** debe manejar `403`.

---

## 2. Endpoints

| Pantalla / acción | Método y ruta | Quién | Respuesta |
|---|---|---|---|
| Historial de tarifas | `GET /tariffs` | OWNER, MEMBER autorizado | `TariffList` |
| Tarifa vigente (hoy o una fecha) | `GET /tariffs/current?at=YYYY-MM-DD` (`at` opcional) | OWNER, MEMBER autorizado | `CurrentTariff` |
| Registrar nueva tarifa | `POST /tariffs` | Solo OWNER | `201` `Tariff` |
| Ver presupuesto y meta de un mes | `GET /goals?month=YYYY-MM` (`month` opcional) | OWNER, MEMBER autorizado | `MonthGoal` |
| Guardar presupuesto y meta | `PUT /goals/{YYYY-MM}` | Solo OWNER | `200` `Goal` |
| Resumen de costo del mes | `GET /summary?month=YYYY-MM` (`month` opcional) | OWNER, MEMBER autorizado | `EnergySummary` |

"MEMBER autorizado" significa membresía activa, hogar activo y permiso **"ver consumo"**. **GUEST** recibe `403` en todos los endpoints de energía.

Sin `at` o `month`, el backend usa **hoy** o el **mes actual** en Bogotá.

---

## 3. Tipos TypeScript

```ts
/** Decimal exacto enviado como texto. Ej.: "950.2500". */
export type DecimalString = string;
/** 'YYYY-MM-DD' */
export type LocalDate = string;
/** 'YYYY-MM' */
export type Month = string;
/** ISO 8601 UTC, ej. '2026-10-30T16:12:31.640Z' */
export type IsoDateTime = string;

export interface Tariff {
  id: string;
  homeId: string;
  unitPriceCopKwh: DecimalString; // 4 decimales
  effectiveFrom: LocalDate;
  createdAt: IsoDateTime;
}

export interface TariffList {
  homeId: string;
  tariffs: Tariff[]; // de la vigencia más reciente a la más antigua; [] si no hay
}

export interface CurrentTariff {
  homeId: string;
  at: LocalDate;
  tariff: Tariff | null; // null: no hay tarifa vigente en esa fecha
}

export interface CreateTariffRequest {
  unitPriceCopKwh: DecimalString; // > 0, máx. 10 enteros y 4 decimales
  effectiveFrom: LocalDate;
}

export interface Goal {
  id: string;
  homeId: string;
  month: Month;
  monthlyBudgetCop: DecimalString | null; // 2 decimales
  targetKwh: DecimalString | null; // 6 decimales
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MonthGoal {
  homeId: string;
  month: Month;
  goal: Goal | null; // null: el mes no está configurado
}

/** PUT = reemplazo completo: enviar SIEMPRE los dos campos (null = no configurado). */
export interface UpsertGoalRequest {
  monthlyBudgetCop: DecimalString | null; // > 0, máx. 2 decimales
  targetKwh: DecimalString | null; // > 0, máx. 6 decimales
  // No pueden ser ambos null.
}

export interface EnergySummary {
  homeId: string;
  month: Month;
  timezone: 'America/Bogota';
  from: IsoDateTime; // inicio del mes en Bogotá
  to: IsoDateTime; // inicio del mes siguiente en Bogotá (excluido)
  readingsCount: number;
  unpricedReadings: number; // lecturas con consumo sin tarifa aplicable
  totalKwh: DecimalString; // 6 decimales
  costComplete: boolean;
  estimatedCostCop: DecimalString | null; // null si costComplete === false
  partialCostCop: DecimalString; // costo de lo que sí tiene tarifa
  monthlyBudgetCop: DecimalString | null;
  targetKwh: DecimalString | null;
  budgetUsagePercent: DecimalString | null; // puede ser > 100
  targetUsagePercent: DecimalString | null; // puede ser > 100
  currency: 'COP';
}

/** Errores de negocio de energía. */
export interface EnergyApiError {
  code:
    | 'ENERGY_READ_FORBIDDEN'
    | 'ENERGY_MANAGE_FORBIDDEN'
    | 'ENERGY_TARIFF_DUPLICATE'
    | 'ENERGY_GOAL_VALUE_REQUIRED'
    | 'ENERGY_GOAL_CONCURRENT_WRITE';
  message: string;
}

/** Errores de validación (formato estándar de NestJS). */
export interface ValidationApiError {
  statusCode: 400;
  error: 'Bad Request';
  message: string | string[];
}
```

---

## 4. Ejemplos de llamadas

```ts
const base = `${API_URL}/api/v1/homes/${homeId}/energy`;
const headers = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
};

// Resumen del mes actual
const summary: EnergySummary = await fetch(`${base}/summary`, { headers }).then((r) => r.json());

// Registrar tarifa (solo OWNER)
await fetch(`${base}/tariffs`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ unitPriceCopKwh: '950.25', effectiveFrom: '2026-11-01' } satisfies CreateTariffRequest),
});

// Guardar solo la meta de kWh de noviembre (solo OWNER)
await fetch(`${base}/goals/2026-11`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ monthlyBudgetCop: null, targetKwh: '125' } satisfies UpsertGoalRequest),
});
```

Respuesta real de `GET /summary?month=2026-10`:

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

Más ejemplos de cada endpoint en `SQL034_ENERGY_API.md`.

---

## 5. Comportamiento esperado en las pantallas

### Permisos

| Rol en el hogar | Qué mostrar |
|---|---|
| **OWNER** | Todo: tarifas (con botón **Agregar tarifa**), presupuesto y meta (con **Editar**) y costo |
| **MEMBER** con "ver consumo" | Lo mismo, **solo lectura**: sin Agregar ni Editar |
| **MEMBER** sin "ver consumo" | Ocultar la sección de costos (el backend responde `403`) |
| **GUEST** | No mostrar la sección de costos. Su resumen de consumo actual (`/consumption/summary`) no cambia |

Si un `GET` de energía responde `403` (`ENERGY_READ_FORBIDDEN`), ocultar la sección **sin** mostrar error: el usuario simplemente no tiene acceso. Un `403` (`ENERGY_MANAGE_FORBIDDEN`) en `POST` o `PUT` indica que el botón no debía estar visible: refrescar el rol del usuario en el hogar.

### Tarifas
- Una tarifa **no se edita ni se borra**. "Cambiar la tarifa" = **Agregar tarifa** con una nueva fecha de vigencia (puede ser pasada o futura).
- `tariff: null` en la tarifa vigente → mostrar *"Aún no hay tarifa registrada"* y, al OWNER, invitar a registrarla.
- `409 ENERGY_TARIFF_DUPLICATE` → *"Ya existe una tarifa con esa fecha. Elige otra fecha de vigencia."*

### Presupuesto y meta
- El formulario permite **presupuesto**, **meta kWh** o **ambos**, pero no ambos vacíos. Validarlo en la app antes de enviar.
- Enviar **siempre los dos campos**: el que quede vacío va como `null`. No omitirlo.
- `goal: null` → *"Sin presupuesto ni meta para este mes"*.
- `409 ENERGY_GOAL_CONCURRENT_WRITE` → reintentar una vez automáticamente.

### Costo estimado (resumen)
- Mostrar siempre la leyenda **"Costo estimado"**: es una aproximación con la tarifa referencial y **no** es el valor de la factura.
- Si `costComplete === false`: no mostrar `estimatedCostCop` (viene `null`). Mostrar algo como *"Hay {unpricedReadings} lecturas sin tarifa registrada para su fecha; el costo está incompleto (parcial: {partialCostCop})"* y, al OWNER, sugerir registrar una tarifa con una fecha anterior.
- Las barras de avance (`budgetUsagePercent`, `targetUsagePercent`) **pueden pasar de 100**: mostrar el exceso (por ejemplo, en rojo), no recortarlo.
- `budgetUsagePercent: null` → no hay presupuesto, o el costo está incompleto. `targetUsagePercent: null` → no hay meta.
- Un MEMBER puede ver un total **menor** que el del OWNER, porque solo ve el consumo de los dispositivos activos que tiene permitidos. Es el comportamiento esperado.

---

## 6. Formato de valores en la app

Los valores llegan como texto exacto. Para **mostrarlos** se pueden convertir solo en el momento de formatear:

```ts
const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const kwh = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

cop.format(Number(summary.estimatedCostCop)); // "$ 1.271"
kwh.format(Number(summary.totalKwh)); // "1,3"
```

Para **enviar**, convertir lo que el usuario escribe a texto con punto decimal: `"950.25"`, no `"950,25"` ni `950.25`. Validar en la app: mayor que 0, hasta 4 decimales en la tarifa, 2 en el presupuesto y 6 en la meta.

Mes y fecha actuales en Bogotá (para preseleccionar en los formularios):

```ts
const hoyBogota = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date()); // 'YYYY-MM-DD'
const mesBogota = hoyBogota.slice(0, 7); // 'YYYY-MM'
```

---

## 7. Errores y mensajes sugeridos

| HTTP | Identificación | Mensaje sugerido / acción |
|---|---|---|
| 400 | `ENERGY_GOAL_VALUE_REQUIRED` | "Indica el presupuesto, la meta de kWh o ambos." |
| 400 | `message` como lista (validación) | "Revisa los valores ingresados." Los textos de `message` indican qué campo falló |
| 401 | `statusCode: 401` | Refrescar sesión o volver al login |
| 403 | `ENERGY_READ_FORBIDDEN` | Ocultar la sección de costos |
| 403 | `ENERGY_MANAGE_FORBIDDEN` | "Solo el propietario del hogar puede cambiar esta configuración." |
| 409 | `ENERGY_TARIFF_DUPLICATE` | "Ya existe una tarifa con esa fecha de vigencia." |
| 409 | `ENERGY_GOAL_CONCURRENT_WRITE` | Reintentar una vez |
| 5xx | — | "No pudimos cargar la información. Intenta de nuevo." |

---

## 8. Checklist de integración móvil

- [ ] Tipos de la sección 3 agregados a la app.
- [ ] Sección de costos visible solo si el `GET` responde 200; oculta ante 403.
- [ ] Botones **Agregar tarifa** y **Editar presupuesto/meta** solo para OWNER.
- [ ] Decimales enviados como texto con punto; nunca como `number`.
- [ ] `PUT` de metas siempre con los dos campos; validación de "ambos vacíos" en la app.
- [ ] Leyenda **"Costo estimado"** y manejo de `costComplete: false`.
- [ ] Barras de avance que permiten superar 100 %.
- [ ] Manejo de 401, 403, 409 y 400 según la sección 7.
- [ ] Probado en DEV con cuentas OWNER, MEMBER y GUEST.
