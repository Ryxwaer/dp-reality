import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Region, type RegionDocument } from './region.schema.js';

interface RegionHit {
  id: string;
  sreality_id: number;
  region_typ: string;
  name: string;
  label: string;
  lat: number;
  lon: number;
}

function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toHit(doc: Region): RegionHit {
  return {
    id: doc._id,
    sreality_id: doc.sreality_id,
    region_typ: doc.region_typ,
    name: doc.name,
    label: doc.label,
    lat: doc.center.coordinates[1],
    lon: doc.center.coordinates[0],
  };
}

@Controller('regions')
export class RegionsController {
  constructor(
    @InjectModel(Region.name) private readonly model: Model<RegionDocument>,
  ) {}

  @Get()
  async search(
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ hits: RegionHit[] }> {
    const needle = normalise(String(q ?? ''));
    if (needle.length < 2) return { hits: [] };
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '10', 10) || 10, 1), 30);

    const exact = await this.model
      .find({ name_normalised: needle })
      .limit(limit)
      .lean<Region[]>();
    if (exact.length >= limit) return { hits: exact.map(toHit) };

    const remaining = limit - exact.length;
    const seen = new Set(exact.map((r) => r._id));
    const prefix = await this.model
      .find({
        name_normalised: { $regex: '^' + escapeRegex(needle), $ne: needle },
        _id: { $nin: Array.from(seen) },
      })
      .limit(remaining)
      .lean<Region[]>();

    return { hits: [...exact, ...prefix].map(toHit) };
  }

  @Get(':typ/:id')
  async getOne(
    @Param('typ') typ: string,
    @Param('id') id: string,
  ): Promise<RegionHit> {
    const composite = `${typ}:${id}`;
    const doc = await this.model.findById(composite).lean<Region | null>();
    if (!doc) throw new NotFoundException(`unknown region ${composite}`);
    return toHit(doc);
  }
}
