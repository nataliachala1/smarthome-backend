# Roles y permisos del hogar

`OWNER`, `MEMBER` y `GUEST` son roles asignados dentro de cada hogar. El rol define responsabilidades y permisos iniciales; el acceso efectivo de `MEMBER` y `GUEST` depende de los permisos concedidos. Consultar, controlar y administrar son acciones independientes: consultar no concede control, y controlar no concede lectura ni administración.

## Roles

### `OWNER` — Dueño del hogar

Administra el hogar y sus miembros, cursa invitaciones, vincula y administra los dispositivos Shelly, controla los dispositivos y consulta el consumo energético. Las capacidades de administración del hogar y sus dispositivos corresponden a `OWNER`.

### `MEMBER` — Miembro del hogar

Accede al hogar al que pertenece conforme a los permisos vigentes. Puede consultar la información y el consumo autorizados, y controlar únicamente los dispositivos para los que tenga permiso efectivo. No administra la propiedad del hogar, a sus propietarios, miembros ni invitaciones.

### `GUEST` — Invitado

Accede únicamente a la información autorizada. Puede consultar los dispositivos y controlarlos solo si se le concede ese permiso. No administra el hogar, su configuración, sus miembros ni sus invitaciones. En materia de energía, solo recibe el total del hogar y el período consultado; nunca lecturas, estadísticas o series por dispositivo.

## Permisos y herencia

Al crear una invitación se asigna la base correspondiente al rol:

| Rol | Consultar dispositivos | Consultar consumo | Controlar dispositivos |
| --- | --- | --- | --- |
| `MEMBER` | Sí | Sí, según los dispositivos autorizados | Sí |
| `GUEST` | Sí | Sí, solo total agregado del hogar y período | No |

`OWNER` puede cambiar los permisos de hogar de cada `MEMBER` o `GUEST`. También puede establecer excepciones para un dispositivo concreto. Cada excepción puede permitir, denegar o heredar el permiso del hogar. Una excepción por dispositivo prevalece sobre la base para ese dispositivo.

Permisos efectivos independientes:

- **Consultar dispositivos:** ver la información descriptiva y operativa del dispositivo autorizado.
- **Consultar consumo:** ver consumo detallado solo para `OWNER` o `MEMBER` autorizado. Para `GUEST`, la salida permanece agregada al hogar incluso si existe una excepción por dispositivo.
- **Controlar dispositivos:** emitir acciones de control sobre dispositivos autorizados. Este permiso no implica acceso a sus datos.
- **Administrar hogar o dispositivos:** reservado a `OWNER`; ningún permiso de consulta o control lo concede.

El permiso de consulta de un dispositivo y el permiso de consulta de su consumo son independientes. El permiso de control también es independiente de ambos.

## Gestión desde el backend

Solo `OWNER` puede leer o cambiar permisos de otras membresías:

- `GET/PUT /api/v1/homes/:homeId/members/:memberId/permissions`
- `GET/PUT /api/v1/homes/:homeId/members/:memberId/devices/:deviceId/permissions`

En permisos por dispositivo, enviar `null` hereda la base del hogar y omitir un campo conserva su excepción actual. Enviar los tres valores como `null` elimina la excepción del dispositivo.

## Límites conservados

- El cambio de permisos no concede propiedad ni administración del hogar.
- `GUEST` no recibe telemetría ni históricos energéticos individuales.
- Las invitaciones iniciales aplican valores base por rol; `OWNER` puede ajustarlos.
- La aplicación debe comprobar el permiso efectivo tanto en sus endpoints como en la base de datos.

## Configuración energética y costos (SQL034)

Tarifas COP/kWh, presupuesto mensual y meta de consumo son **datos económicos** del hogar. El backend (`src/modules/energy`) aplica esta matriz en tres capas: JWT, función SQL de autorización y RLS de PostgreSQL.

| Operación | `OWNER` | `MEMBER` | `GUEST` |
| --- | :---: | :---: | :---: |
| Consultar historial y tarifa vigente | Sí | Sí, con `view_consumption` efectivo | No |
| Registrar nueva tarifa (nueva vigencia) | Sí, hogar activo | No | No |
| Editar o borrar tarifas históricas | No | No | No |
| Consultar presupuesto y meta del mes | Sí | Sí, con `view_consumption` efectivo | No |
| Crear o reemplazar presupuesto y meta | Sí, hogar activo | No | No |
| Consultar resumen mensual de kWh y costo estimado | Sí | Sí, con `view_consumption` efectivo (\*) | No |
| Borrar presupuesto o meta | No | No | No |

Cómo se aplica:

1. **Autenticación:** todos los controladores de energía usan `JwtAuthGuard`; sin token válido o con sesión revocada responden `401`.
2. **Contexto RLS:** cada operación corre en `PrismaRlsService.withUserContext(userId, ...)`, que fija `app.current_user_id` solo dentro de la transacción. No se usa una conexión global ni roles con `BYPASSRLS`.
3. **Autorización explícita, en la misma transacción y antes de tocar las tablas:**
   - lectura: `consumption.fn_can_read_detail(id_home)` (OWNER; MEMBER activo con `view_consumption` en hogar activo);
   - escritura: `homes.fn_can_manage_home(id_home)` (OWNER activo, cuenta activa, hogar activo).
4. **RLS en PostgreSQL** repite las mismas reglas como última barrera; un rechazo (`42501`) se traduce a `403`.
5. Las respuestas `403` son genéricas (`ENERGY_READ_FORBIDDEN`, `ENERGY_MANAGE_FORBIDDEN`): no distinguen entre hogar inexistente y hogar sin permiso, para evitar enumeración. No se exponen errores SQL.
6. `GUEST` no obtiene tarifas, presupuestos, metas ni costos. El contrato existente de `GET /api/v1/homes/:homeId/consumption/summary` para `GUEST` no cambia.
7. El rol global del JWT (`user.role`) **no** sustituye al rol de membresía del hogar.

(\*) El resumen suma solo las lecturas que RLS permite ver al usuario. Por la regla de consumo de la release 018, un `MEMBER` solo ve lecturas de dispositivos **activos** sobre los que tiene `view_consumption`; el `OWNER` ve todas, incluidas las de dispositivos desactivados o eliminados. Por eso, para el mismo mes, el total de kWh y el costo estimado de un `MEMBER` pueden ser menores que los del `OWNER`.
