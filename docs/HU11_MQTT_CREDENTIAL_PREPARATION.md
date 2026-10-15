# HU11 — Preparación e inspección de credenciales MQTT

Fecha: 2026-10-15. Quinto incremento en `11-dev`, sobre backend `b5221db267032d8dec1762208ea49ef72da28d2f` y BD `06b0eab4c05e99a04386157161d7879360e31985`. Diff y resultados de pruebas presentados; commit/push de este incremento autorizados por el usuario el 2026-10-15.

## Resultado y alcance

El adaptador interno dispone ahora de `prepare(identityId, manufacturerDeviceId)` e `inspect(identityId, manufacturerDeviceId)`. Una preparación exitosa devuelve una contraseña final después de confirmar su instalación y observar el cliente deshabilitado con la política esperada. La inspección permite consultar esa política y el estado observado sin modificar el broker.

Son operaciones internas de infraestructura. No se incorporan al contenedor Nest, a un endpoint ni al flujo de alta. No autorizan una identidad por pertenencia al hogar o posesión del equipo; tampoco reservan identidad en PostgreSQL. Los métodos anteriores `provision` y `rotate` mantienen su comportamiento: crean un cliente habilitado y vuelven a habilitarlo después de rotar, respectivamente. Su coordinación con registro/baja sigue pendiente.

## Preparación

Mosquitto Dynamic Security 2.0.22 no procesa un campo `disabled` en `createClient`. Por eso la preparación usa dos contraseñas aleatorias distintas de 32 bytes: una temporal para crear el cliente y otra final, generada después de confirmar `disableClient`. El adaptador descarta la temporal sin entregarla al llamador de `prepare`. [Implementación oficial de clientes, versión 2.0.22](https://github.com/eclipse-mosquitto/mosquitto/blob/v2.0.22/plugins/dynamic-security/clients.c).

La secuencia comprobada es:

1. Validar UUID e identificador de fabricante con la política existente; consultar denegación por defecto para publicar, recibir y suscribirse.
2. Crear el rol con las ACL propias y el cliente con la contraseña temporal, client ID fijo y un único rol.
3. Enviar `disableClient` y esperar la respuesta administrativa correlacionada del broker.
4. Generar la contraseña final y confirmar `setClientPassword`, manteniendo el cliente deshabilitado.
5. Consultar nuevamente los defaults, el rol y, por último, el cliente. Exigir coincidencia exacta de política y estado `DISABLED`.
6. Devolver `{ identity, password, brokerState: 'DISABLED' }`.

El método no envía `enableClient`, no reintenta una escritura incierta y no borra recursos para hacer pasar un reintento. Cada comando usa los límites y correlación del transporte administrativo existente; no se añade un deadline global para toda la preparación.

El adaptador maneja la contraseña en memoria y entrega el secreto final al llamador; este incremento no lo almacena en SQL ni lo registra en logs. No se promete borrado seguro de memoria de JavaScript. La fixture real comprueba que el estado persistido del broker no contiene las contraseñas en claro capturadas por la prueba.

## Inspección estricta

`inspect` ejecuta únicamente `getDefaultACLAccess`, `getRole` y `getClient`. Valida:

- Denegación por defecto para `publishClientSend`, `publishClientReceive` y `subscribe`.
- Nombre del rol y conjunto exacto de ACL: tipo, topic, permiso y prioridad. El orden puede variar; reglas extra, ausentes, duplicadas, comodines ajenos a la política o coerciones de tipos se rechazan.
- Username y client ID esperados; un único rol con prioridad numérica `0`; ningún grupo.
- `disabled` booleano cuando esté presente. Mosquitto 2.0.22 omite el campo cuando está habilitado; campo ausente o `false` se interpreta como `ENABLED`, nunca como preparado. [Serialización oficial de clientes](https://github.com/eclipse-mosquitto/mosquitto/blob/v2.0.22/plugins/dynamic-security/clients.c).

Devuelve `{ identity, brokerState: 'ENABLED' | 'DISABLED' }`. `identity` se construye con la política local esperada; no se devuelven descripciones, campos inesperados ni payloads recibidos del broker. Los estados describen una observación del broker, no estados de pairing ni filas SQL.

Una discrepancia o estructura inválida produce `MQTT_IDENTITY_POLICY_MISMATCH`, sin valores del broker. Los defaults inseguros conservan `MQTT_ADMIN_UNSAFE_DEFAULT_ACL`; rechazo, desconexión o incertidumbre mantienen los códigos del transporte. Un rechazo administrativo no demuestra ausencia del cliente ni revocación exitosa. No se modifica el catálogo de errores SQL porque ningún trabajador persistente usa esta operación todavía.

## Fallos parciales y límites

| Situación | Resultado y trabajo pendiente |
| --- | --- |
| Se pierde la respuesta de creación | Puede existir un cliente habilitado con la contraseña temporal no entregada. `prepare` falla y no continúa; una inspección puede observarlo, pero no recuperar su contraseña. |
| Se pierde la respuesta después de aplicar disable o cambio de contraseña | No se entrega credencial ni se supone éxito. En las pruebas con la operación aplicada, una inspección nueva observa `DISABLED`. En una desconexión real hay que determinar qué operación llegó a ejecutarse. |
| Rol/cliente ya existente | El broker rechaza el duplicado. No se adopta, sobrescribe ni habilita automáticamente. Puede haber un rol huérfano si una operación previa quedó incompleta. |
| Un administrador habilita antes de la lectura final | La preparación rechaza `ENABLED` sin entregar contraseña; no compensa ni declara éxito. |
| Cambian client ID, roles, grupos, ACL o defaults | La inspección falla sin repararlos. Se requiere investigación/reconciliación autorizada. |

La creación y el disable son comandos separados: no hay creación atómica deshabilitada. Las tres consultas de inspección tampoco son una transacción ni un bloqueo; otro administrador puede cambiar el estado entre consultas o después de devolver el resultado. `getClient` no verifica la contraseña instalada, el firmware, la conexión física, la posesión ni la vinculación SQL. La instalación del secreto se confirma mediante la respuesta administrativa a `setClientPassword`.

Antes de conectar esto a un alta se necesita reserva persistente previa a cualquier escritura en el broker, autorización/posesión, entrega controlada del secreto, compensación durable y coordinación de activación/rotación con revocación. Encadenar `prepare` con el registro SQL actual no crea una transacción distribuida ni resuelve una baja concurrente. El contrato HU12 continúa pendiente de acuerdo con móvil.

## Coordinación con base de datos

Este incremento de BD es documental. No añade tablas, estados, funciones, permisos, auditoría ni cambios Prisma. Liquibase conserva los **64 changesets**; `mqtt_identity_event` mantiene el historial de registro/revocación del cuarto incremento. Preparar/inspeccionar el broker no genera eventos en ese historial. El trabajador de revocación mantiene sus nueve comprobaciones de seguridad y permanece desactivado por defecto.

El informe previo [HU11: historial transaccional](HU11_MQTT_IDENTITY_HISTORY.md) conserva la evidencia del cuarto incremento. La emisión integrada con BD, su auditoría de actores y la reconciliación siguen pendientes.

## Validación

- **306 pruebas unitarias** en 13 suites aprobadas; 51 casos nuevos de preparación, incertidumbre, validación de metadatos y salida sin datos del broker.
- TypeScript `--noEmit`, build Nest y ESLint de los cuatro archivos TypeScript afectados aprobados.
- **117 pruebas con PostgreSQL y broker TLS reales**: 76 de persistencia/runtime y 41 del broker; 13 casos nuevos de preparación/inspección.
- Rechazo de conexión con la identidad preparada bajo MQTT 5 y 3.1.1. La activación exclusiva de la fixture confirma el secreto final, invalida el temporal y conserva el aislamiento de topics.
- Pérdida de respuesta después de creación, disable y cambio de contraseña; rechazo de duplicados sin adopción; inspección de cliente habilitado sin desconectarlo; rechazo de alteraciones de client ID, roles, grupos, ACL y defaults. Rehabilitación antes de la lectura final rechazada sin entregar secreto.
- Liquibase desde cero, rollback vacío/reaplicación y upgrade **62 → 63 → 64** aprobados. Checksums anteriores, identidad/dispositivo y snapshots preservados; rollback de historial poblado rechazado.
- Contenedores y certificados propios retirados al terminar. Los patches previos de HU13 siguen pasando `git apply --reverse --check` en las copias originales de backend/BD. Diff completo de este incremento exportado y verificado por aplicación inversa antes del commit.

Comandos desde la copia de backend:

```powershell
npm.cmd test -- --runInBand
node ../../node_modules/typescript/bin/tsc --noEmit
npm.cmd run build
node ../../node_modules/eslint/bin/eslint.js src/modules/devices/infrastructure/messaging/identity/mosquitto-device-identity.admin.ts src/modules/devices/infrastructure/messaging/identity/mqtt-identity-snapshot.ts src/modules/devices/infrastructure/messaging/identity/mqtt-identity-preparation.spec.ts test/mqtt-identity-broker.e2e-spec.ts
node scripts/test-mqtt-revocation.cjs ../hu11-database
```

La suite usa PostgreSQL 16 y Mosquitto 2.0.22 nuevos en loopback, con credenciales aleatorias y certificados propios. MQTT tiene TLS real; PostgreSQL de prueba no usa TLS. Los casos de respuesta perdida descartan una respuesta después de aplicar el comando al broker real; no simulan todos los cortes de red posibles. La activación explícita de una credencial preparada se realiza únicamente en la fixture para comprobar contraseña y ACL. No constituye una API de activación del producto.

No se modificaron `.env`, cuentas/servicios existentes ni Shelly físico. Cloud, pairing físico, recuperación entre procesos y despliegue productivo siguen sin validar. Los cambios de HU13/HU16 requieren integración posterior.
