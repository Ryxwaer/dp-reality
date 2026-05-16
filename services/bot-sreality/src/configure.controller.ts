import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, 'templates', 'configure.html'), 'utf-8');

@Controller('configure')
export class ConfigureController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return html;
  }
}
