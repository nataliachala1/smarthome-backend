# HU15 — CI y preparación de staging

Fecha: 2026-10-15. Rama `15-dev`, derivada de `09-dev` conforme al plan acordado.

## CI incorporada

`.github/workflows/ci.yml` ejecuta en push, pull request y ejecución manual para ramas `09-dev` a `16-dev`: instalación con lockfile, generación Prisma, ESLint sin autofix, pruebas unitarias, compilación y construcción de una imagen Docker. El chequeo ESLint omite solo `prettier/prettier`, porque el baseline contiene formato histórico inconsistente; no ejecuta autofix ni reescribe cientos de archivos. Los permisos del `GITHUB_TOKEN` quedan en solo lectura y las acciones externas usan SHA completos.

La imagen multietapa usa Node 24, no contiene `.env` ni artefactos locales, ejecuta como usuario `node`, desactiva Swagger por defecto y usa `/health/live` como healthcheck de proceso. La aplicación requiere `DATABASE_URL`, `DATABASE_IOT_URL` y `JWT_SECRET`; el contenedor no aplica migraciones.

## Staging

El flujo comprueba que el artefacto se construye, pero no publica imágenes ni se conecta a un entorno externo. No existe proveedor, hostname, dominio, método de despliegue ni secretos de staging confirmados en el repositorio. Por eso no se inventa un target ni se incorpora un despliegue no verificable.

Antes de habilitar staging: elegir proveedor y región; aprovisionar una base aislada y usuarios mínimos; configurar TLS, dominio, CORS y secretos fuera de Git; ejecutar las migraciones con el procedimiento aprobado; fijar la imagen por digest; restringir `/metrics` al scraper y mantener `METRICS_ENABLED=false` mientras no se configure; validar `/health/live`, `/health/ready`, MQTT y rollback de la aplicación. No usar la base productiva para ensayar.

El healthcheck Docker valida solo que el proceso responde. La plataforma debe usar `/health/ready` para comprobar PostgreSQL y decidir la admisión de tráfico. Los contenedores son efímeros; estado y secretos no deben guardarse en su filesystem.

## Ejecución local

```sh
docker build --tag smarthome-backend:local .
docker run --rm --env-file .env -p 3000:3000 smarthome-backend:local
```

La imagen se ejecuta como `node` sin privilegios. No montar el archivo `.env` dentro de la imagen ni publicar credenciales en argumentos guardados, logs o acciones.
