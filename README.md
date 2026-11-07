# SmartHome Backend

API del proyecto SmartHome: autenticación y sesiones, hogares y roles, dispositivos, consumo, energía, notificaciones y eventos en tiempo real. Rama de integración: `dev`.

**Estado:** en desarrollo. La telemetría y el control en DEV están probados para un dispositivo Shelly conocido. El pairing LAN/AP de un Shelly desde cero **aún está pendiente**.

## Documentación oficial

La documentación central del proyecto está en el repositorio [smart-home-doc](https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc):

- Índice general: <https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc/blob/main/docs/README.md>
- Arquitectura del backend: <https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc/blob/main/docs/10-arquitectura/backend/arquitectura.md>
- Contrato MQTT: <https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc/blob/main/docs/20-contratos/mqtt/contrato-mqtt.md>
- Informes históricos del backend: <https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc/blob/main/docs/99-archivo/backend/README.md>

Los detalles de implementación (seguridad HU09, MQTT con TLS, consumo, pairing Shelly, roles y permisos) están en [smart-home-doc: backend](https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc/tree/main/docs/10-arquitectura/backend).

## Stack

- NestJS, TypeScript y Node.js
- Prisma y PostgreSQL
- MQTT
- Socket.IO
- Integración opcional con flespi en DEV. No es el camino general aprobado.

## Requisitos

- Node.js 22 (la versión que usa el CI) y npm
- PostgreSQL
- Variables de entorno: ver [`.env.example`](.env.example). No subir valores reales al repositorio.

## Levantar el sistema completo

El sistema completo (PostgreSQL con migraciones y usuarios de prueba, Mailpit, backend y web) se levanta con un solo comando desde [smart-home-doc/deploy](https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-doc/tree/main/deploy). Usuarios de prueba (contraseña `SmartHome#2026`): `admin@example.com` (SYSTEM_ADMIN), `owner@example.com`, `member@example.com` y `guest@example.com`.

## Instalación y ejecución local

```bash
npm ci
npm run start:dev
```

`npm ci` ejecuta también `prisma generate`. El servicio no funcionará correctamente sin una base de datos PostgreSQL y credenciales provisionadas en las variables de entorno.

## Scripts

| Script | Uso |
|---|---|
| `npm run lint` | ESLint |
| `npm test` | Pruebas unitarias (Jest) |
| `npm run test:cov` | Pruebas unitarias con cobertura; falla por debajo del 70 % de líneas y sentencias |
| `npm run test:e2e` | Pruebas e2e (`test/jest-e2e.json`); algunas requieren PostgreSQL |
| `npm run build` | Compilación |
| `npm run start:prod` | Ejecuta la compilación (`dist/src/main.js`) |
| `npm run simulate:device` | Simulador de dispositivo MQTT (`scripts/simulate-device.js`) |

## API

Las rutas HTTP usan el prefijo `api/v1`. El rol global SYSTEM_ADMIN dispone de `GET /api/v1/admin/users` y `GET /api/v1/admin/audit-events`. Swagger se publica en `/api/docs` cuando está habilitado: por defecto fuera de producción, o con `SWAGGER_ENABLED=true`. No asumir que está disponible públicamente en producción.

## Despliegue

- El CI (`CI and deploy dev`, en cada push a `dev`) valida el código y publica la imagen en GHCR.
- Dokploy se despliega manualmente mientras no se configure el webhook.
- Un workflow en verde **no prueba** que el despliegue se haya realizado.

## Advertencia sobre el control de dispositivos

`COMMAND_PUBLISHED` significa que la orden se publicó. **No** significa que se verificó físicamente el relé.

## Uso de inteligencia artificial

Ver [AI_USAGE.md](AI_USAGE.md).

## Contribución

1. Crear la rama desde `dev`.
2. Abrir un PR hacia `dev`.
3. Antes del PR, pasar `npm run lint`, `npm test` y `npm run build`.
4. No incluir secretos, credenciales ni archivos `.env` reales.
