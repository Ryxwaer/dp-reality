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

  // Upsert by `_id` = sha256(key). The key (and therefore the _id) is
  // stable across republishes but changes when price moves, so the same
  // physical listing dedupes silently while a price change inserts a new
  // doc and re-notifies the user.
  //
  // `runId` is stamped via $setOnInsert so truly new listings carry this
  // run's id while repeat sightings retain the run_id from their first
  // discovery — the notification service keys off `run_id` to notify only
  // on fresh inserts.
  //
  // `_id` lives in $setOnInsert because Mongo forbids touching the field
  // in $set on existing docs (it would no-op anyway, but Mongo errors).
  async upsertListings(listings: ListingData[], runId: string): Promise<number> {
    if (!listings.length) return 0;

    const now = new Date();
    const ops = listings.map((l) => {
      const { _id, ...rest } = l;
      return {
        updateOne: {
          filter: { _id },
          update: {
            $setOnInsert: { _id, first_seen: now, run_id: runId },
            $set: { ...rest, last_seen: now },
          },
          upsert: true,
        },
      };
    });

    const result = await this.model.bulkWrite(ops, { ordered: false });
    this.logger.log(
      `Upserted ${listings.length} listings — ${result.upsertedCount} new (run ${runId})`,
    );
    return result.upsertedCount;
  }
}
