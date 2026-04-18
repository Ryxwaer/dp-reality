import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from './app.module.js';
import { startGrpcServer } from './grpc.server.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const connection = app.get<Connection>(getConnectionToken());
  if (!connection.db) {
    throw new Error('MongoDB connection not established');
  }
  startGrpcServer(() => connection.db);
}

bootstrap().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
});
