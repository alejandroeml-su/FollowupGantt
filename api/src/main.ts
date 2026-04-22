import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Serve static frontend
  const publicPath = join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  // Prefix only for API routes
  app.setGlobalPrefix('api', {
    exclude: ['/', '/kanban', '/gantt', '/itil', '/dashboard', '/sprints', '/projects'],
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Enterprise Work Orchestration Platform running on port ${port}`);
}

bootstrap();

// For Vercel serverless compatibility
export default bootstrap;
