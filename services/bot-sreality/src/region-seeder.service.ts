import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Model } from 'mongoose';
import { Region, type RegionDocument } from './region.schema.js';

const REGIONS_JSON_PATH = join(__dirname, '..', 'data', 'regions.json');

interface RegionPayload {
  _id: string;
  sreality_id: number;
  region_typ: string;
  name: string;
  name_normalised: string;
  label: string;
  parents: Region['parents'];
  center: Region['center'];
}

@Injectable()
export class RegionSeederService implements OnModuleInit {
  private readonly logger = new Logger(RegionSeederService.name);

  constructor(
    @InjectModel(Region.name) private readonly model: Model<RegionDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.model.estimatedDocumentCount();
    if (existing > 0) {
      this.logger.log(`sreality_geo already populated (${existing} rows), skipping seed`);
      return;
    }

    const raw = readFileSync(REGIONS_JSON_PATH, 'utf-8');
    const payload = JSON.parse(raw) as RegionPayload[];
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error(`regions.json at ${REGIONS_JSON_PATH} is empty or malformed`);
    }

    const ops = payload.map((r) => ({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: r },
        upsert: true,
      },
    }));
    const result = await this.model.bulkWrite(ops, { ordered: false });
    this.logger.log(
      `sreality_geo seeded: ${payload.length} payload rows, ${result.upsertedCount} inserted, ${result.modifiedCount} updated`,
    );
  }
}
