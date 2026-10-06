import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error('COOKIE_SECURE debe ser un valor booleano.');
}

function getCorsOrigins(): string[] | false {
  const rawOrigins =
    process.env.CORS_ALLOWED_ORIGINS ?? process.env.FRONTEND_URL;

  if (!rawOrigins) {
    return process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173'];
  }

  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS debe incluir al menos un origen válido.',
    );
  }

  return origins;
}

function parseDatabaseUrl(name: string): URL {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} es requerida.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} debe ser una URL PostgreSQL válida.`);
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new Error(
      `${name} debe incluir protocolo, usuario, host y nombre de base de datos.`,
    );
  }

  return url;
}

function validateRuntimeConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production';

  const required = ['DATABASE_URL', 'DATABASE_IOT_URL', 'JWT_SECRET'];

  const missing = required.filter(
    (key) => !process.env[key] || !process.env[key]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno requeridas: ${missing.join(', ')}`,
    );
  }

  const applicationDatabaseUrl = parseDatabaseUrl('DATABASE_URL');
  const ingestDatabaseUrl = parseDatabaseUrl('DATABASE_IOT_URL');
  if (applicationDatabaseUrl.pathname !== ingestDatabaseUrl.pathname) {
    throw new Error(
      'DATABASE_URL y DATABASE_IOT_URL deben apuntar a la misma base de datos PostgreSQL.',
    );
  }

  if (
    isProduction &&
    !process.env.FRONTEND_URL?.trim() &&
    !process.env.CORS_ALLOWED_ORIGINS?.trim()
  ) {
    throw new Error(
      'FRONTEND_URL o CORS_ALLOWED_ORIGINS es requerida en producción.',
    );
  }

  const swaggerSetting = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (
    swaggerSetting !== undefined &&
    !['true', 'false'].includes(swaggerSetting)
  ) {
    throw new Error('SWAGGER_ENABLED debe ser true o false.');
  }

  const cookieSameSite = process.env.COOKIE_SAME_SITE?.trim().toLowerCase();
  if (
    cookieSameSite !== undefined &&
    !['lax', 'strict', 'none'].includes(cookieSameSite)
  ) {
    throw new Error('COOKIE_SAME_SITE debe ser lax, strict o none.');
  }

  const cookieSecure = parseBoolean(process.env.COOKIE_SECURE, isProduction);
  if (cookieSameSite === 'none' && !cookieSecure) {
    throw new Error(
      'COOKIE_SECURE debe ser true cuando COOKIE_SAME_SITE es none.',
    );
  }

  getCorsOrigins();
}

async function bootstrap() {
  validateRuntimeConfig();

  const app = await NestFactory.create(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigins = getCorsOrigins();
  const swaggerSetting = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
  const swaggerEnabled =
    swaggerSetting === 'true' ||
    (!isProduction && swaggerSetting === undefined);

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.disable('x-powered-by');
  app.use(cookieParser());

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Smart Home API')
      .setVersion('1')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          in: 'header',
        },
        'access-token',
      )
      .build();

    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
