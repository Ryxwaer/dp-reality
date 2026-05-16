// Telemetry MUST be the first import: the OpenTelemetry SDK patches
// Node's module loader to wrap downstream packages, so any module
// loaded before this one would never be traced.
import './telemetry.js';

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
