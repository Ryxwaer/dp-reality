import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Reads once at module load — the template is part of the build artefact
// in the Docker image and never changes at runtime. __dirname is the
// per-file directory under dist/ (commonjs build) so the template is
// resolved relative to the compiled controller, not the cwd.
const html = readFileSync(join(__dirname, 'templates', 'configure.html'), 'utf-8');

@Controller('configure')
export class ConfigureController {
  // The bot service owns its configuration UI. The same page works in
  // two contexts: (a) embedded as an iframe in the BFF dashboard at
  // /modules/<bot_id>/configure?config_id=...&user_id=..., and
  // (b) standalone at http://<bot-service>/configure?config_id=...&user_id=...
  // when an operator wants to configure the bot directly. The page
  // detects embedding client-side via window.parent and switches its
  // postMessage handlers accordingly.
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return html;
  }
}
