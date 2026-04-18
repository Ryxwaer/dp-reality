import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { config } from './config.js';
import { Listing, ListingSchema } from './listing.schema.js';
import { ScraperService } from './scraper.service.js';
import { RepositoryService } from './repository.service.js';
import { PublisherService } from './publisher.service.js';

@Module({
  imports: [
    MongooseModule.forRoot(config.mongodbUri),
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
  ],
  providers: [ScraperService, RepositoryService, PublisherService],
})
export class AppModule {}
