# Roles y permisos del hogar

Esta definición describe responsabilidades funcionales. No prescribe tablas, endpoints ni un mecanismo técnico de autorización.

## Regla general

`OWNER`, `MEMBER` y `GUEST` son roles dentro de un hogar. El rol establece las responsabilidades máximas; para `MEMBER` y `GUEST`, el acceso efectivo a consultas y control depende de los permisos que se les hayan concedido. Ser miembro o invitado, por sí solo, no concede acceso a toda la información ni control sobre todos los dispositivos.

Administrar el hogar, consultar información y controlar dispositivos son acciones distintas. Un permiso para consultar no implica permiso para controlar; un permiso para controlar tampoco concede administración del hogar, de sus miembros o de sus dispositivos.

## Roles

### `OWNER` — Dueño del hogar

Es el usuario principal del hogar. Administra el hogar y sus miembros, cursa invitaciones y gestiona usuarios conforme a los permisos establecidos. Vincula y administra los dispositivos Shelly del hogar. Puede controlar esos dispositivos y consultar el consumo energético.

### `MEMBER` — Miembro del hogar

Accede al hogar al que pertenece según su membresía y los permisos concedidos. Puede consultar los dispositivos y la información de consumo que tenga autorizados, y controlar los dispositivos para los que tenga permiso de control. No administra la propiedad del hogar ni a sus propietarios. La administración de miembros e invitaciones corresponde al `OWNER` en el alcance definido.

### `GUEST` — Invitado

Accede únicamente al hogar y a la información autorizados. Puede consultar los dispositivos que se le permitan. No administra el hogar, sus miembros, las invitaciones ni la configuración. Puede controlar un dispositivo solo cuando tenga concedido el permiso correspondiente.

Para consumo, se conserva la definición aprobada del proyecto: `GUEST` recibe únicamente el total de energía del hogar y el período consultado; no recibe lecturas, estadísticas ni series de consumo por dispositivo. La autorización para consultar un dispositivo no amplía por sí sola este alcance de consumo.

## Separación de responsabilidades

| Acción | `OWNER` | `MEMBER` | `GUEST` |
| --- | --- | --- | --- |
| Administrar hogar, miembros e invitaciones | Sí, según sus responsabilidades de dueño | No | No |
| Vincular y administrar dispositivos Shelly | Sí | No | No |
| Consultar dispositivos | Sí | Solo según permisos concedidos | Solo según permisos concedidos |
| Consultar consumo | Sí | Solo el consumo autorizado | Solo el total energético del hogar y el período consultado |
| Controlar dispositivos | Sí | Solo dispositivos con permiso de control | Solo dispositivos con permiso de control |

La tabla no define cómo se asignan, almacenan o revocan los permisos.

## Aclaraciones pendientes de producto

- Precisar qué datos incluye “consultar un dispositivo” (por ejemplo, su presencia en la lista y la información descriptiva), sin confundirlo con lecturas energéticas por dispositivo, que no están incluidas para `GUEST`.
- Confirmar la granularidad con la que se conceden permisos de consulta y control. La definición exige que el permiso determine el acceso, pero no decide si se otorga por hogar, por dispositivo o de otra forma.
- Precisar qué opciones abarca “administrar el hogar” para `OWNER`; la definición conserva esa responsabilidad sin enumerar ajustes concretos.
- Mantener separado el acceso al listado de dispositivos, a datos de consumo y al control; conceder uno no concede implícitamente los otros.
