import { Controller, Get, Query } from '@nestjs/common';
import { SrealityLocationService, type SrealityRegionHit } from './sreality-location.service.js';

interface SuggestResponse {
  hits: SrealityRegionHit[];
}

// Bot-private autocomplete endpoint used by the Center field on
// configure.html. Thin proxy in front of Sreality's own suggest API —
// kept here (instead of being called by the configure page directly)
// so we don't paint cross-origin requests to sreality.cz from inside
// the BFF iframe, and so the Sreality dialect never leaks into the
// platform-wide HTTP contract.
@Controller('suggest')
export class SuggestController {
  constructor(private readonly location: SrealityLocationService) {}

  @Get()
  async suggest(@Query('q') q?: string): Promise<SuggestResponse> {
    const hits = await this.location.suggest(String(q ?? ''));
    return { hits };
  }
}
