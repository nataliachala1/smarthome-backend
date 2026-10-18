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
