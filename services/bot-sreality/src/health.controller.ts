import { Controller, Get } from '@nestjs/common';
import { config } from './config.js';

@Controller('healthz')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: config.serviceId };
  }
}
