import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { config } from './config.js';
import { Listing, ListingSchema } from './listing.schema.js';
import { BotConfig, BotConfigSchema } from './bot-config.schema.js';
import { NotificationRow, NotificationSchema } from './notification.schema.js';
import { ModuleRegistryEntry, ModuleRegistrySchema } from './registry.schema.js';
import { ScraperService } from './scraper.service.js';
import { RepositoryService } from './repository.service.js';
import { PublisherService } from './publisher.service.js';
import { MatcherService } from './matcher.service.js';
import { NotificationRendererService } from './notification-renderer.service.js';
import { CycleService } from './cycle.service.js';
import { RegistryService } from './registry.service.js';
import { WelcomeService } from './welcome.service.js';
import { BotsController } from './bots.controller.js';
import { ConfigureController } from './configure.controller.js';
import { ParseUrlController } from './parse-url.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    MongooseModule.forRoot(config.mongodbUri),
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: BotConfig.name, schema: BotConfigSchema },
      { name: NotificationRow.name, schema: NotificationSchema },
      { name: ModuleRegistryEntry.name, schema: ModuleRegistrySchema },
    ]),
  ],
  providers: [
    RepositoryService,
    PublisherService,
    MatcherService,
    NotificationRendererService,
    CycleService,
    ScraperService,
    RegistryService,
    WelcomeService,
  ],
  controllers: [
    BotsController,
    ConfigureController,
    ParseUrlController,
    HealthController,
  ],
})
export class AppModule {}
