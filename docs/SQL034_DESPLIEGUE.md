# SQL034 — Integración y despliegue en DEV

**Backend:** rama `feat/sql34-prisma-energy-models` (PR #15 → `dev`) · **Base de datos:** `smarthome-database`, rama `dev` (SQL034 fusionado en el PR #14).

Este documento define **en qué orden** y **con qué comprobaciones** se despliega la API de energía SQL034 en DEV. La regla principal: **el backend no se fusiona a `dev` hasta confirmar que la BD DEV del VPS tiene SQL034**, porque al fusionar se despliega automáticamente.

---

## 1. Por qué importa el orden

- El backend usa las tablas `config.home_energy_tariff` y `config.home_energy_goal`, las funciones `consumption.fn_can_read_detail` / `homes.fn_can_manage_home` y las políticas RLS de SQL034. Si se despliega **sin** SQL034 en la base, todos los endpoints de energía fallan (500).
- Un push a `dev` del backend ejecuta `.github/workflows/ci-deploy.yml`: lint, tsc, test y build; publica la imagen en GHCR y, si existen los secretos `DOKPLOY_DEPLOY_WEBHOOK` y `DEPLOYMENT_HEALTH_URL`, **despliega en Dokploy**.
- En la base de datos, el job `deploy` de su workflow está deshabilitado (`if: ${{ false }}`): **que SQL034 esté fusionado en GitHub no significa que esté aplicado en el VPS.**
- Todo PR hacia `dev` se valida con **`.github/workflows/pr-validate-dev.yml`** ("PR validation (dev) - no deploy"): `npm ci`, lint, typecheck, pruebas unitarias, build y las pruebas aisladas de MQTT. **No** publica imágenes, **no** usa secretos ni webhooks, **no** despliega en Dokploy y **no** se conecta a bases de datos del VPS. El workflow `pr-shelly-mqtt-dev.yml` se conserva sin cambios para las ramas de Shelly/MQTT.

---

## 2. Orden de despliegue

| # | Paso | Responsable | Resultado esperado |
|---|---|---|---|
| 1 | **Respaldo** de la BD DEV del VPS | Responsable de BD | Respaldo verificado |
| 2 | Revisar SQL034 (`releases/034_energy_tariff_budget/`) y sus pruebas | Responsable de BD | Aprobado |
| 3 | Aplicar SQL034 en la BD DEV **de forma controlada** (Liquibase `update`) | Responsable de BD (con autorización) | 2 changesets aplicados |
| 4 | **Ejecutar `scripts/verify-sql034-dev.sql`** contra la BD DEV | Responsable de BD o líder | Veredicto **LISTO** (19 PASS) |
| 5 | Pasar el PR #15 a **Ready for review** y revisarlo | Desarrolladora / líder | Aprobado |
| 6 | **Merge** del PR #15 a `dev` | Líder | `ci-deploy.yml` en verde y despliegue en Dokploy |
| 7 | **Pruebas de humo** autenticadas OWNER / MEMBER / GUEST (sección 5) | Desarrolladora | Todas como se espera |
| 8 | Entregar el contrato HTTP al equipo móvil (`docs/SQL034_CONTRATO_MOVIL.md`) | Desarrolladora | Equipo móvil inicia la integración |

Si el paso 4 da **NO DESPLEGAR**, no se continúa: se corrige primero la base (pasos 1–3).

**No** se debe habilitar el `deploy` del workflow de la base, ni ejecutar Liquibase contra el VPS, sin respaldo, coordinación y autorización. Esta entrega de backend no aplica cambios en el VPS.

---

## 3. Validación del backend antes del merge

Ejecutado sobre la rama del PR #15, después de las correcciones de la revisión (P1–P4):

| Validación | Resultado |
|---|---|
| `npm run lint` | sin errores |
| `npx tsc --noEmit -p tsconfig.build.json` | sin errores |
| `npm test -- --runInBand` | 929 pruebas aprobadas, 9 omitidas, 0 FAIL |
| `npm run build` | sin errores |
| `test/mqtt-namespace-security.e2e-spec.ts` (aislada, sin broker) | 31/31 |
| `scripts/test-energy-access.ps1` (PostgreSQL real, 96 changesets, RLS, LOGIN no privilegiado) | 21/21 |
| CI del PR: `pr-validate-dev.yml` | en verde; el enlace a la ejecución del SHA final va en el PR |

Para repetirlo localmente: ver `docs/SQL034_ENERGY_API.md`, sección 9. La matriz de casos y las pruebas que los demuestran están en `docs/SQL034_EVIDENCIA_VALIDACION.md`.

### 3.1 Fallos E2E preexistentes (módulo de consumo)

`test/consumption-access-postgres.e2e-spec.ts` **no** forma parte de SQL034. Se ejecutó dos veces, cada una sobre una base PostgreSQL nueva con las mismas migraciones y la fixture oficial:

| Código probado | Resultado |
|---|---|
| `dev` antes de SQL034 (commit `1cbaca2`) | 5 fallos, 23 aprobadas, 28 en total |
| Rama del PR #15 | 5 fallos, 23 aprobadas, 28 en total |

Son **las mismas 5 pruebas** en ambos casos:

1. `preserves access to removed/inactive device histories for user 2`
2. `does not turn historical visibility into permission to control an inactive device`
3. `never combines a device from one home with authorization for another`
4. `returns known kWh/W totals, date filters and limits without foreign rows`
5. `limits positive direct reads and historical metadata to the authorized home`

Por eso se clasifican como **preexistentes** y no introducidas por este PR. Su causa es que las pruebas esperan que el MEMBER vea historiales de dispositivos desactivados o eliminados, y la release 018 de la base solo le muestra lecturas de dispositivos `ACTIVE`. Su corrección corresponde al módulo de consumo.

---

## 4. Verificación de SQL034 en la BD DEV del VPS (paso 4)

Script: **`scripts/verify-sql034-dev.sql`**. Es **de solo lectura**: corre en una transacción `READ ONLY` que se revierte y solo consulta el catálogo de PostgreSQL y `public.databasechangelog`. **No lee datos de negocio ni modifica nada.**

Comprueba 19 puntos:

1. Existe `public.databasechangelog` (Liquibase).
2. Changeset `smarthome-sql034-energy-tariff-budget-20261029` aplicado.
3. Changeset `smarthome-sql034-energy-goal-optional-budget-20261029` aplicado.
4. Existe la tabla `config.home_energy_tariff`.
5. Existe la tabla `config.home_energy_goal`.
6. `monthly_budget_cop` acepta `NULL`.
7. Existe el CHECK `ck_home_energy_goal_budget_or_target`.
8. Existen las restricciones de unicidad.
9. RLS activa en ambas tablas.
10. Existen las 5 políticas.
11. Existe el trigger de `updated_at`.
12. Existe el rol `smarthome_runtime_app`.
13. Permisos de `smarthome_runtime_app` sobre tarifas: SELECT/INSERT, sin UPDATE ni DELETE.
14. Permisos de `smarthome_runtime_app` sobre metas: UPDATE solo de presupuesto y meta, sin DELETE.
15. Existen las funciones de autorización.
16. El LOGIN del backend existe y puede iniciar sesión.
17. El LOGIN del backend no es superusuario ni tiene `BYPASSRLS`.
18. El LOGIN del backend es miembro de `smarthome_runtime_app`.
19. El LOGIN del backend no es dueño de las tablas de SQL034.

### Cómo ejecutarlo

`app_login` es el usuario del `DATABASE_URL` del backend en DEV (por defecto `smarthome_app_login`). Se ejecuta con un usuario que pueda leer `public.databasechangelog`, por ejemplo el migrador.

Desde el servidor, si PostgreSQL corre en Docker:

```bash
docker exec -i <contenedor_postgres> psql -X -U <usuario> -d smarthome -v app_login=smarthome_app_login < scripts/verify-sql034-dev.sql
```

Con `psql` y acceso de red a la base:

```bash
psql -X -h <host> -p <puerto> -U <usuario> -d smarthome -v app_login=smarthome_app_login -f scripts/verify-sql034-dev.sql
```

Desde Windows (PowerShell no admite `<`; se usa una tubería):

```powershell
Get-Content scripts\verify-sql034-dev.sql -Raw | docker exec -i <contenedor_postgres> psql -X -U <usuario> -d smarthome -v app_login=smarthome_app_login
```

Ensayo local con la base de `smarthome-database` levantada en Docker (contenedor `smarthome_db`, usuario `smarthome_owner`):

```powershell
Get-Content scripts\verify-sql034-dev.sql -Raw | docker exec -i smarthome_db psql -X -U smarthome_owner -d smarthome -v app_login=smarthome_app_login
```

### Resultado esperado

```text
  #  | Comprobacion                                                         | Resultado
-----+----------------------------------------------------------------------+-----------
   1 | Tabla public.databasechangelog de Liquibase existe                   | PASS
 ... | ...                                                                  | PASS
  19 | LOGIN del backend no es dueno de las tablas de SQL034                | PASS
  99 | VEREDICTO: la base tiene SQL034 y el LOGIN del backend es seguro...  | LISTO
```

Con cualquier `FAIL`, la última fila dice **NO DESPLEGAR** e indica cuántas comprobaciones fallaron.

El script se probó en tres escenarios:

| Escenario | Resultado |
|---|---|
| Base con SQL034 y LOGIN correcto | 19 PASS, veredicto **LISTO** |
| LOGIN inexistente | 4 FAIL, veredicto **NO DESPLEGAR** |
| Base sin SQL034 | 12 FAIL, veredicto **NO DESPLEGAR** |

No se deben copiar contraseñas ni cadenas de conexión en el PR, en la documentación ni en los mensajes.

---

## 5. Pruebas de humo después del despliegue (paso 7)

Con tres cuentas de prueba de un mismo hogar de DEV (OWNER, MEMBER con `view_consumption` y GUEST), obtener un `accessToken` de cada una con el login normal de la API. Luego, en PowerShell:

```powershell
$api = "https://<dominio-dev>/api/v1/homes/<homeId>/energy"
$owner  = @{ Authorization = "Bearer <token OWNER>" }
$member = @{ Authorization = "Bearer <token MEMBER>" }
$guest  = @{ Authorization = "Bearer <token GUEST>" }
```

| # | Prueba | Comando | Esperado |
|---|---|---|---|
| 1 | OWNER consulta tarifas | `Invoke-RestMethod "$api/tariffs" -Headers $owner` | 200 |
| 2 | OWNER consulta el resumen | `Invoke-RestMethod "$api/summary" -Headers $owner` | 200, `currency: COP` |
| 3 | MEMBER consulta el resumen | `Invoke-RestMethod "$api/summary" -Headers $member` | 200 |
| 4 | MEMBER intenta registrar una tarifa | `Invoke-RestMethod "$api/tariffs" -Method Post -Headers $member -ContentType 'application/json' -Body '{"unitPriceCopKwh":"1","effectiveFrom":"2026-11-01"}'` | 403 `ENERGY_MANAGE_FORBIDDEN` |
| 5 | GUEST consulta el resumen | `Invoke-RestMethod "$api/summary" -Headers $guest` | 403 `ENERGY_READ_FORBIDDEN` |
| 6 | Sin token | `Invoke-RestMethod "$api/tariffs"` | 401 |

Las pruebas 1–3 no modifican datos. Si se quiere probar una escritura del OWNER en DEV, usar un hogar de prueba: las tarifas no se pueden borrar.

`Invoke-RestMethod` lanza una excepción en las respuestas 4xx; el código aparece en el mensaje de error (`403`, `401`). Eso es lo esperado en las pruebas 4 a 6.

---

## 6. Reversión

- **Backend:** revertir el merge en `dev` (o volver a desplegar la imagen anterior de GHCR, etiquetada con el SHA previo). Las tablas de SQL034 no estorban al código anterior.
- **Base de datos:** **NO** ejecutar `liquibase rollback` de SQL034 en el VPS. Borraría las tablas y la configuración económica real (tarifas, presupuestos y metas).
- Documentar cualquier reversión en el PR.

---

## 7. Descripción del PR #15

El texto completo de la descripción del PR está en `docs/SQL034_EVIDENCIA_VALIDACION.md`, sección 4. Resume las funcionalidades, los endpoints, la referencia a SQL034/001 y SQL034/002, la evidencia del SHA final, los fallos E2E preexistentes y la dependencia de infraestructura: **no hacer merge hasta que `scripts/verify-sql034-dev.sql` dé 19 PASS y LISTO en PostgreSQL DEV**.
