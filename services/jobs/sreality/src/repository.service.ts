import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Listing, type ListingDocument } from './listing.schema.js';

type ListingData = Omit<Listing, 'first_seen' | 'last_seen'>;

@Injectable()
export class RepositoryService {
  private readonly logger = new Logger(RepositoryService.name);

  constructor(
    @InjectModel(Listing.name) private readonly model: Model<ListingDocument>,
  ) {}

  async upsertListings(listings: ListingData[]): Promise<number> {
    if (!listings.length) return 0;

    const now = new Date();
    const ops = listings.map((l) => ({
      updateOne: {
        filter: { source: l.source, source_id: l.source_id },
        update: {
          $setOnInsert: { first_seen: now },
          $set: { ...l, last_seen: now },
        },
        upsert: true,
      },
    }));

    const result = await this.model.bulkWrite(ops, { ordered: false });
    this.logger.log(
      `Upserted ${listings.length} listings — ${result.upsertedCount} new`,
    );
    return result.upsertedCount;
  }
}
