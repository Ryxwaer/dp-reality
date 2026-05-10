import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();
  await app.listen(config.httpPort, '0.0.0.0');
  Logger.log(
    `bot-sreality listening on http://0.0.0.0:${config.httpPort}`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
});
