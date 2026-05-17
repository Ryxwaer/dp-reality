import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Region, type RegionDocument } from './region.schema.js';
import { NominatimService } from './nominatim.service.js';

// `street` entries are streets, not areas — Nominatim returns them as
// `way`s with no usable polygon. We don't even try; the matcher falls
// back to centre+radius for them.
const TYPES_WITHOUT_POLYGON = new Set(['street']);

@Injectable()
export class RegionResolverService {
  private readonly logger = new Logger(RegionResolverService.name);

  constructor(
    @InjectModel(Region.name) private readonly regions: Model<RegionDocument>,
    private readonly nominatim: NominatimService,
  ) {}

  // Make sure the sreality_geo entry for `regionId` carries a polygon
  // (or has been deliberately marked as polygon-less). Called from
  // BotsController and ParseUrlController so that any config we accept
  // either matches with a real polygon-buffer or transparently degrades
  // to centre+radius for the handful of types where that's correct.
  async ensureResolved(regionId: string): Promise<RegionDocument> {
    const doc = await this.regions.findById(regionId).exec();
    if (!doc) {
      throw new Error(`Region ${regionId} not found in sreality_geo`);
    }
    if (doc.geometry || TYPES_WITHOUT_POLYGON.has(doc.region_typ)) {
      return doc;
    }
    return this.resolveAndStore(doc);
  }

  private async resolveAndStore(doc: RegionDocument): Promise<RegionDocument> {
    this.logger.log(
      `Resolving polygon for ${doc._id} (${doc.name}) via Nominatim`,
    );
    const resolved = await this.nominatim.resolveByName(doc.name, doc.region_typ);
    const update: Record<string, unknown> = { osm_id: resolved.osm_id };
    if (resolved.geometry) {
      update.geometry = resolved.geometry;
    }
    await this.regions.updateOne({ _id: doc._id }, { $set: update }).exec();
    const refreshed = await this.regions.findById(doc._id).exec();
    if (!refreshed) {
      throw new Error(`Region ${doc._id} disappeared mid-resolve`);
    }
    if (!refreshed.geometry) {
      this.logger.warn(
        `Nominatim returned no polygon for ${doc._id} (${doc.name}); ` +
          `matcher will fall back to centre+radius for this region`,
      );
    }
    return refreshed;
  }

  // Used by CycleService to load the records referenced by a config's
  // `region_id`. Polygons are returned when present; callers must
  // tolerate their absence and fall back to centre+radius.
  async findById(regionId: string): Promise<RegionDocument | null> {
    return this.regions.findById(regionId).exec();
  }
}
