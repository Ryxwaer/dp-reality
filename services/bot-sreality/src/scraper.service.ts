import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { config } from './config.js';
import { RepositoryService } from './repository.service.js';
import { CycleService } from './cycle.service.js';
import {
  SREALITY_CATEGORIES,
  SREALITY_HEADERS,
  parseEstate,
  type ListingData,
  type SrealityEstate,
} from './sreality-parser.js';

const MAX_CONSECUTIVE_FAILURES = 3;

export type { ListingData };

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private consecutiveFailures = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly repository: RepositoryService,
    private readonly cycle: CycleService,
  ) {}

  onModuleInit(): void {
    void this.loop();
  }

  async runOnce(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = this.scrapeCycle();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async loop(): Promise<void> {
    while (true) {
      await this.runOnce();
      await new Promise((r) => setTimeout(r, config.scrapeIntervalMinutes * 60 * 1000));
    }
  }

  private async scrapeCycle(): Promise<void> {
    this.logger.log('Starting scrape cycle');
    try {
      const runId = randomUUID();
      const listings = await this.fetchAll();
      this.logger.log(`Fetched ${listings.length} listings (run ${runId})`);
      const newListings = await this.repository.upsertListings(listings, runId);
      if (newListings.length > 0) {
        await this.cycle.matchAndNotify(newListings, runId);
      }
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      this.logger.error(
        `Scrape cycle failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive)`,
        err,
      );
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.logger.error(
          'Consecutive failure threshold reached — exiting for orchestrator restart',
        );
        process.exit(1);
      }
    }
  }

  private async fetchAll(): Promise<ListingData[]> {
    const all: ListingData[] = [];
    const seen = new Set<string>();

    for (const cat of SREALITY_CATEGORIES) {
      const estates = await this.fetchPage(cat.main, cat.type);
      for (const estate of estates) {
        const listing = parseEstate(estate, cat.priceType, cat.propertyType);
        if (listing && !seen.has(listing.source_id)) {
          seen.add(listing.source_id);
          all.push(listing);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return all;
  }

  private async fetchPage(
    catMain: number,
    catType: number,
  ): Promise<SrealityEstate[]> {
    const { data } = await axios.get<{
      _embedded?: { estates?: SrealityEstate[] };
    }>('https://www.sreality.cz/api/cs/v2/estates', {
      params: {
        category_main_cb: catMain,
        category_type_cb: catType,
        per_page: 60,
      },
      headers: SREALITY_HEADERS,
      timeout: 30_000,
    });
    return data?._embedded?.estates ?? [];
  }
}
