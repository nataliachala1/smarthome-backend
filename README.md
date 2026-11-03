# SmartHome Backend

API del proyecto SmartHome: autenticación y sesiones, hogares y roles, dispositivos, consumo, energía, notificaciones y eventos en tiempo real. Rama de integración: `dev`.

**Estado:** en desarrollo. La telemetría y el control en DEV están probados para un dispositivo Shelly conocido. El pairing LAN/AP de un Shelly desde cero **aún está pendiente**.

## Documentación oficial

La documentación técnica (seguridad, consumo, MQTT/Shelly e histórico) está en el repositorio documental:

- Índice del backend: <https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-docs/blob/main/backend/README.md>
- Registro de QA: <https://github.com/Kevin-Stiven-Lopez-Amaya404/smart-home-docs/blob/main/qa/backend/README.md>

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
| `npm run test:e2e` | Pruebas e2e (`test/jest-e2e.json`); algunas requieren PostgreSQL |
| `npm run build` | Compilación |
| `npm run start:prod` | Ejecuta la compilación (`dist/src/main.js`) |
| `npm run simulate:device` | Simulador de dispositivo MQTT (`scripts/simulate-device.js`) |

## API

Las rutas HTTP usan el prefijo `api/v1`. Swagger se publica en `/api/docs` cuando está habilitado: por defecto fuera de producción, o con `SWAGGER_ENABLED=true`. No asumir que está disponible públicamente en producción.

## Despliegue

- El CI (`CI and deploy dev`, en cada push a `dev`) valida el código y publica la imagen en GHCR.
- Dokploy se despliega manualmente mientras no se configure el webhook.
- Un workflow en verde **no prueba** que el despliegue se haya realizado.

## Advertencia sobre el control de dispositivos

`COMMAND_PUBLISHED` significa que la orden se publicó. **No** significa que se verificó físicamente el relé.

## Contribución

1. Crear la rama desde `dev`.
2. Abrir un PR hacia `dev`.
3. Antes del PR, pasar `npm run lint`, `npm test` y `npm run build`.
4. No incluir secretos, credenciales ni archivos `.env` reales.
