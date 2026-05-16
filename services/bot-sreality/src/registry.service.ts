import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from './config.js';
import { RepositoryService } from './repository.service.js';

@Injectable()
export class RegistryService implements OnModuleInit {
  private readonly logger = new Logger(RegistryService.name);

  constructor(private readonly repository: RepositoryService) {}

  async onModuleInit(): Promise<void> {
    await this.repository.upsertRegistry();
    this.logger.log(`Registered in module_registry as "${config.serviceId}"`);
  }
}
