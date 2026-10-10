import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { createValidationPipe } from './validation.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // El formulario de prepago corre en otro origen y consume /payment/:id/summary desde el navegador.
  // `credentials` es lo que permite que viaje la cookie del refresh token; obliga a que
  // `origin` sea una URL concreta, nunca '*'.
  // La web pública del hotel (landing) es otro origen: consume /public/* sin credenciales.
  const allowedOrigins = [
    process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173',
    process.env.LANDING_BASE_URL,
  ].filter((origin): origin is string => Boolean(origin));
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(createValidationPipe());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
