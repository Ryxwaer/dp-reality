import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { config } from './config.js';
import { RepositoryService } from './repository.service.js';
import { PublisherService } from './publisher.service.js';

interface SrealityEstate {
  hash_id: number;
  name: string;
  locality: string;
  price: number;
  seo: { locality: string };
  labelsAll?: string[][];
}

interface ListingData {
  source: string;
  source_id: string;
  title: string;
  price?: number;
  price_type: string;
  property_type: string;
  disposition?: string;
  city?: string;
  locality_raw?: string;
  url: string;
  features: string[];
}

const CATEGORIES = [
  { main: 1, type: 1, priceType: 'sale', propertyType: 'apartment' },
  { main: 1, type: 2, priceType: 'rent', propertyType: 'apartment' },
  { main: 2, type: 1, priceType: 'sale', propertyType: 'house' },
  { main: 2, type: 2, priceType: 'rent', propertyType: 'house' },
] as const;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const MAX_CONSECUTIVE_FAILURES = 3;

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private consecutiveFailures = 0;

  constructor(
    private readonly repository: RepositoryService,
    private readonly publisher: PublisherService,
  ) {}

  onModuleInit(): void {
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (true) {
      await this.scrapeCycle();
      await new Promise((r) => setTimeout(r, config.scrapeIntervalMinutes * 60 * 1000));
    }
  }

  private async scrapeCycle(): Promise<void> {
    this.logger.log('Starting scrape cycle');
    try {
      const listings = await this.fetchAll();
      this.logger.log(`Fetched ${listings.length} listings`);
      const newCount = await this.repository.upsertListings(listings);
      if (newCount > 0) {
        await this.publisher.publishCompletion(newCount);
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
          'Consecutive failure threshold reached — exiting for Kubernetes restart',
        );
        process.exit(1);
      }
    }
  }

  private async fetchAll(): Promise<ListingData[]> {
    const all: ListingData[] = [];
    const seen = new Set<string>();

    for (const cat of CATEGORIES) {
      const estates = await this.fetchPage(cat.main, cat.type);
      for (const estate of estates) {
        const listing = this.parseEstate(estate, cat.priceType, cat.propertyType);
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
    try {
      const { data } = await axios.get<{
        _embedded?: { estates?: SrealityEstate[] };
      }>('https://www.sreality.cz/api/cs/v2/estates', {
        params: {
          category_main_cb: catMain,
          category_type_cb: catType,
          per_page: 60,
        },
        headers: HEADERS,
        timeout: 30_000,
      });
      return data?._embedded?.estates ?? [];
    } catch (err) {
      this.logger.warn(
        `Failed to fetch cat=${catMain}/${catType}, skipping: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private parseEstate(
    estate: SrealityEstate,
    priceType: string,
    propertyType: string,
  ): ListingData | null {
    const sourceId = String(estate.hash_id);
    if (!sourceId || sourceId === '0') return null;

    const disposition =
      estate.name.match(/\b(\d+\+(?:kk|\d+))\b/i)?.[1] ?? null;
    const locality = estate.locality ?? '';
    const localityParts = locality.split(',');
    const city =
      localityParts[localityParts.length - 1].trim().split(' - ')[0].trim() ||
      null;
    const labels = estate.labelsAll ?? [];
    const features = Array.isArray(labels[0]) ? [...labels[0]] : [];

    return {
      source: 'sreality',
      source_id: sourceId,
      title: estate.name,
      price: estate.price > 0 ? estate.price : undefined,
      price_type: priceType,
      property_type: propertyType,
      disposition: disposition ?? undefined,
      city: city ?? undefined,
      locality_raw: locality || undefined,
      url: this.buildUrl(estate, priceType, propertyType),
      features,
    };
  }

  private buildUrl(
    estate: SrealityEstate,
    priceType: string,
    propertyType: string,
  ): string {
    const saleRent = priceType === 'rent' ? 'pronajem' : 'prodej';
    const propSlug = propertyType === 'apartment' ? 'byt' : 'dum';
    const match = estate.name.match(/\b(\d+\+(?:kk|\d+))\b/i);
    const dispSlug = match
      ? match[1]
          .toLowerCase()
          .replace('+kk', '-plus-kk')
          .replace('+', '-plus-')
      : 'other';
    const locality = estate.seo?.locality ?? '';
    return locality && estate.hash_id
      ? `https://www.sreality.cz/detail/${saleRent}/${propSlug}/${dispSlug}/${locality}/${estate.hash_id}`
      : 'https://www.sreality.cz/';
  }
}
