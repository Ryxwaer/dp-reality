import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Listing, type ListingDocument } from './listing.schema.js';

type ListingData = Omit<Listing, 'first_seen' | 'last_seen' | 'run_id'>;

@Injectable()
export class RepositoryService {
  private readonly logger = new Logger(RepositoryService.name);

  constructor(
    @InjectModel(Listing.name) private readonly model: Model<ListingDocument>,
  ) {}

  // `runId` is stamped via $setOnInsert so truly new listings carry this run's
  // id, while repeat sightings retain the run_id from their first discovery.
  // The notification service keys off `run_id` to notify only on fresh inserts.
  async upsertListings(listings: ListingData[], runId: string): Promise<number> {
    if (!listings.length) return 0;

    const now = new Date();
    const ops = listings.map((l) => ({
      updateOne: {
        filter: { source_id: l.source_id },
        update: {
          $setOnInsert: { first_seen: now, run_id: runId },
          $set: { ...l, last_seen: now },
        },
        upsert: true,
      },
    }));

    const result = await this.model.bulkWrite(ops, { ordered: false });
    this.logger.log(
      `Upserted ${listings.length} listings — ${result.upsertedCount} new (run ${runId})`,
    );
    return result.upsertedCount;
  }
}
