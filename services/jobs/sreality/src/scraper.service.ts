import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { config } from './config.js';
import { type Listing } from './listing.schema.js';
import { RepositoryService } from './repository.service.js';
import { PublisherService } from './publisher.service.js';

const MAX_CONSECUTIVE_FAILURES = 3;

interface SrealityEstate {
  hash_id: number;
  name: string;
  locality: string;
  price: number;
  seo: {
    locality: string;
    category_main_cb?: number;
    category_sub_cb?: number;
    category_type_cb?: number;
  };
  gps?: { lat: number; lon: number };
  labelsAll?: string[][];
}

type ListingData = Omit<Listing, 'first_seen' | 'last_seen' | 'run_id'>;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const CATEGORIES = [
  { main: 1, type: 1, priceType: 'sale', propertyType: 'apartment' },
  { main: 1, type: 2, priceType: 'rent', propertyType: 'apartment' },
  { main: 2, type: 1, priceType: 'sale', propertyType: 'house' },
  { main: 2, type: 2, priceType: 'rent', propertyType: 'house' },
] as const;

const APARTMENT_SLUGS: Record<number, string> = {
  2: '1+kk',
  3: '1+1',
  4: '2+kk',
  5: '2+1',
  6: '3+kk',
  7: '3+1',
  8: '4+kk',
  9: '4+1',
  10: '5+kk',
  11: '5+1',
  12: '6-a-vice',
  16: 'atypicky',
  47: 'pokoj',
};

const HOUSE_SLUGS: Record<number, string> = {
  33: 'chata',
  37: 'rodinny',
  39: 'vila',
  43: 'chalupa',
  44: 'zemedelska-usedlost',
  48: 'mobilni-dum',
  54: 'vicegeneracni-dum',
};

function buildUrl(
  estate: SrealityEstate,
  priceType: 'sale' | 'rent',
  propertyType: 'apartment' | 'house',
): string {
  const locality = estate.seo?.locality ?? '';
  if (!locality || !estate.hash_id) return 'https://www.sreality.cz/';

  const saleRent = priceType === 'rent' ? 'pronajem' : 'prodej';
  const propSlug = propertyType === 'apartment' ? 'byt' : 'dum';
  const subCb = estate.seo?.category_sub_cb;
  const table = propertyType === 'apartment' ? APARTMENT_SLUGS : HOUSE_SLUGS;
  const dispSlug =
    (subCb !== undefined && table[subCb]) ||
    (propertyType === 'apartment' ? 'atypicky' : 'rodinny');

  return `https://www.sreality.cz/detail/${saleRent}/${propSlug}/${dispSlug}/${locality}/${estate.hash_id}`;
}

function parseEstate(
  estate: SrealityEstate,
  priceType: 'sale' | 'rent',
  propertyType: 'apartment' | 'house',
): ListingData | null {
  const sourceId = String(estate.hash_id);
  if (!sourceId || sourceId === '0') return null;

  const disposition =
    estate.name.match(/\b(\d+\+(?:kk|\d+))\b/i)?.[1] ?? undefined;

  const locality = estate.locality ?? '';
  const localityParts = locality.split(',');
  const city =
    localityParts[localityParts.length - 1].trim().split(' - ')[0].trim() ||
    undefined;

  const labels = estate.labelsAll?.[0] ?? [];

  const gps =
    estate.gps && (estate.gps.lat !== 0 || estate.gps.lon !== 0)
      ? {
          type: 'Point' as const,
          coordinates: [estate.gps.lon, estate.gps.lat] as [number, number],
        }
      : undefined;

  const key = buildDedupeKey(estate, priceType, propertyType, sourceId);
  return {
    _id: createHash('sha256').update(key).digest('hex'),
    key,
    source_id: sourceId,
    title: estate.name,
    price: estate.price > 0 ? estate.price : undefined,
    price_type: priceType,
    property_type: propertyType,
    disposition,
    locality: locality || undefined,
    city,
    gps,
    category_main_cb: estate.seo?.category_main_cb,
    category_sub_cb: estate.seo?.category_sub_cb,
    category_type_cb: estate.seo?.category_type_cb,
    labels,
    url: buildUrl(estate, priceType, propertyType),
  };
}

// Stable composite key — see Listing schema for rationale. `seo.locality` is
// the URL slug Sreality assigns (street + district), which stays constant
// across republishes. We fall back to source_id when the slug is missing so
// we never collapse unrelated slug-less listings into one doc. Including
// `price` means a price change deliberately produces a new key → new doc →
// new notification.
function buildDedupeKey(
  estate: SrealityEstate,
  priceType: 'sale' | 'rent',
  propertyType: 'apartment' | 'house',
  sourceId: string,
): string {
  const slug = estate.seo?.locality || sourceId;
  const subCb = estate.seo?.category_sub_cb ?? 'x';
  const priceKey = estate.price > 0 ? String(estate.price) : 'ask';
  return `${priceType}|${propertyType}|${subCb}|${slug}|${priceKey}`;
}

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
      const runId = randomUUID();
      const listings = await this.fetchAll();
      this.logger.log(`Fetched ${listings.length} listings (run ${runId})`);
      const newCount = await this.repository.upsertListings(listings, runId);
      if (newCount > 0) {
        await this.publisher.publishCompletion(runId);
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
}
