import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { MANIFEST } from './manifest.js';
import { config } from './config.js';

@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    const grpcAddress = `${config.serviceName}:${config.grpcPort}`;
    const col = this.connection.db!.collection('modules');
    await col.updateOne(
      { module_id: MANIFEST.module_id },
      {
        $set: {
          ...MANIFEST,
          grpc_address: grpcAddress,
          last_registered: new Date(),
        },
      },
      { upsert: true },
    );
    this.logger.log(`Registered module "${MANIFEST.module_id}" with gRPC at ${grpcAddress}`);
  }
}
