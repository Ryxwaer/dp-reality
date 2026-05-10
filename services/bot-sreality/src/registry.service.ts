import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from './config.js';
import { RepositoryService } from './repository.service.js';

// Self-registration is a one-time advertisement on boot. Once listed,
// the row stays put for the lifetime of the deployment — no heartbeat,
// no refresh loop, no unregistration on shutdown.
@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);

  constructor(private readonly repository: RepositoryService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.repository.upsertRegistry();
      this.logger.log(`Registered in module_registry as "${config.serviceId}"`);
    } catch (err) {
      this.logger.warn(
        `module_registry upsert failed: ${(err as Error).message}`,
      );
    }
  }
}
