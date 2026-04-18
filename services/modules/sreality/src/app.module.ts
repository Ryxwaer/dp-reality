import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { config } from './config.js';
import { RegistryService } from './registry.service.js';

@Module({
  imports: [MongooseModule.forRoot(config.mongodbUri)],
  providers: [RegistryService],
})
export class AppModule {}
