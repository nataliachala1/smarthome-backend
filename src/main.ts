import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { getCorsOrigins } from './config/runtime-config';
import { getTrustedProxies } from './config/trusted-proxies';
import { SecureIoAdapter } from './modules/realtime/secure-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigins = getCorsOrigins();
  app.useWebSocketAdapter(new SecureIoAdapter(app, corsOrigins));
  const swaggerSetting = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
  const swaggerEnabled =
    swaggerSetting === 'true' ||
    (!isProduction && swaggerSetting === undefined);

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.disable('x-powered-by');
  expressApp.set(
    'trust proxy',
    getTrustedProxies(process.env.TRUSTED_PROXY_CIDRS),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Pairing-Token'],
    exposedHeaders: ['Retry-After'],
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
