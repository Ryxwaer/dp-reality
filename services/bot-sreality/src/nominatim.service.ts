import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { GeoGeometry } from './region.schema.js';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_LOOKUP = 'https://nominatim.openstreetmap.org/lookup';
const USER_AGENT =
  'dp-reality bot-sreality/1.0 (https://github.com/ryxwaer/dp-reality; sreality region resolver)';

// Sreality entity types → expected Nominatim administrative level. We
// use this as a soft preference when ranking candidates; if no exact
// match is returned, the first `boundary/administrative` relation wins.
const SREALITY_TO_ADMIN_LEVEL: Record<string, number[]> = {
  country: [2],
  region: [6],
  district: [7],
  municipality: [8],
  ward: [9, 10],
  quarter: [10, 9],
};

interface NominatimHit {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  class: string;
  type: string;
  display_name: string;
  geojson?: GeoGeometry;
  extratags?: Record<string, string>;
}

export interface ResolvedRegion {
  osm_id: number;
  geometry: GeoGeometry | null;
  lat: number;
  lon: number;
  display_name: string;
}

// Nominatim's usage policy is 1 req/sec absolute. We serialise all
// outbound calls through a single async chain so concurrent callers
// can't accidentally burst.
@Injectable()
export class NominatimService {
  private readonly logger = new Logger(NominatimService.name);
  private gate: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  private readonly minIntervalMs = 1100;

  async resolveByName(name: string, regionTyp: string): Promise<ResolvedRegion> {
    const hits = await this.search(name);
    const chosen = pickBestRelation(hits, regionTyp);
    if (!chosen) {
      throw new Error(
        `Nominatim has no administrative relation matching ${JSON.stringify(name)} (${regionTyp})`,
      );
    }
    return {
      osm_id: chosen.osm_id,
      geometry: normaliseGeometry(chosen.geojson),
      lat: parseFloat(chosen.lat),
      lon: parseFloat(chosen.lon),
      display_name: chosen.display_name,
    };
  }

  // Re-fetch a previously resolved record to refresh its polygon. Used
  // when an existing sreality_geo entry has an osm_id but no geometry
  // (e.g. node-only relations that later acquired a polygon upstream).
  async lookupByOsmId(osmId: number): Promise<ResolvedRegion> {
    const url = NOMINATIM_LOOKUP;
    const params = {
      osm_ids: `R${osmId}`,
      format: 'json',
      addressdetails: '1',
      polygon_geojson: '1',
      extratags: '1',
    } as const;
    const data = await this.get<NominatimHit[]>(url, params);
    const hit = data?.[0];
    if (!hit) {
      throw new Error(`Nominatim has no record for relation ${osmId}`);
    }
    return {
      osm_id: hit.osm_id,
      geometry: normaliseGeometry(hit.geojson),
      lat: parseFloat(hit.lat),
      lon: parseFloat(hit.lon),
      display_name: hit.display_name,
    };
  }

  private async search(name: string): Promise<NominatimHit[]> {
    const params = {
      q: name,
      countrycodes: 'cz',
      format: 'json',
      addressdetails: '1',
      polygon_geojson: '1',
      extratags: '1',
      limit: '10',
    } as const;
    return this.get<NominatimHit[]>(NOMINATIM_SEARCH, params);
  }

  private async get<T>(url: string, params: Record<string, string>): Promise<T> {
    return this.throttle(async () => {
      const { data } = await axios.get<T>(url, {
        params,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: 30_000,
      });
      return data;
    });
  }

  private throttle<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.gate.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastCallAt = Date.now();
      }
    });
    this.gate = next.catch(() => undefined);
    return next as Promise<T>;
  }
}

function pickBestRelation(hits: NominatimHit[], regionTyp: string): NominatimHit | null {
  const relations = hits.filter(
    (h) => h.osm_type === 'relation' && h.class === 'boundary' && h.type === 'administrative',
  );
  if (relations.length === 0) {
    // Streets and similar non-admin entries: any relation will do.
    const fallback = hits.find((h) => h.osm_type === 'relation');
    return fallback ?? null;
  }
  const expected = SREALITY_TO_ADMIN_LEVEL[regionTyp] ?? [];
  if (expected.length > 0) {
    for (const level of expected) {
      const match = relations.find(
        (h) => parseInt(h.extratags?.['admin_level'] ?? '', 10) === level,
      );
      if (match) return match;
    }
  }
  return relations[0];
}

function normaliseGeometry(g: GeoGeometry | undefined): GeoGeometry | null {
  if (!g) return null;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') return g;
  return null;
}
