import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(AppModule);
}

bootstrap().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
});
