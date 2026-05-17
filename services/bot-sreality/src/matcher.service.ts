import { Injectable } from '@nestjs/common';
import type { SrealityBotConfig } from './bot-config.schema.js';
import type { Listing } from './listing.schema.js';
import type { RegionPredicate } from './region-filter.js';

// Mongoose returns missing optional keys as `null`, while in-process
// callers may pass `undefined`. Treat both as "filter not configured".
function isUnset<T>(v: T | null | undefined): v is null | undefined {
  return v === undefined || v === null;
}

function intersects<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  const set = new Set(a);
  for (const x of b) if (set.has(x)) return true;
  return false;
}

function isSubset<T>(required: readonly T[], present: readonly T[] | undefined): boolean {
  if (!required.length) return true;
  if (!present?.length) return false;
  const set = new Set(present);
  for (const x of required) if (!set.has(x)) return false;
  return true;
}

@Injectable()
export class MatcherService {
  matches(
    cfg: SrealityBotConfig,
    listing: Listing,
    regionFilter: RegionPredicate | null = null,
  ): boolean {
    if (!isUnset(cfg.category_main_cb) && listing.category_main_cb !== cfg.category_main_cb) {
      return false;
    }
    if (!isUnset(cfg.category_type_cb) && listing.category_type_cb !== cfg.category_type_cb) {
      return false;
    }
    if (cfg.category_sub_cb && cfg.category_sub_cb.length > 0) {
      if (listing.category_sub_cb === undefined || !cfg.category_sub_cb.includes(listing.category_sub_cb)) {
        return false;
      }
    }
    if (!isUnset(cfg.price_min)) {
      if (isUnset(listing.price) || listing.price < cfg.price_min) return false;
    }
    if (!isUnset(cfg.price_max)) {
      if (isUnset(listing.price) || listing.price > cfg.price_max) return false;
    }

    // Single-valued enums: if the user picked any options for the
    // dimension, the listing must declare exactly one of them. Listings
    // missing the field (sreality didn't tag them) are dropped — we
    // can't prove inclusion either way, and notifying on an
    // unverifiable match is worse than missing it.
    if (cfg.ownership_in?.length) {
      if (!listing.ownership || !cfg.ownership_in.includes(listing.ownership)) return false;
    }
    if (cfg.building_type_in?.length) {
      if (!listing.building_type || !cfg.building_type_in.includes(listing.building_type)) return false;
    }
    if (cfg.furnished_in?.length) {
      if (!listing.furnished || !cfg.furnished_in.includes(listing.furnished)) return false;
    }

    // Multi-valued: condition is OR-of (any selected condition tag),
    // amenities is AND-of (every required amenity must be present).
    if (cfg.condition_in?.length) {
      if (!intersects(cfg.condition_in, listing.condition_set)) return false;
    }
    if (cfg.amenities_all?.length) {
      if (!isSubset(cfg.amenities_all, listing.amenity_set)) return false;
    }

    if (cfg.media_required?.length) {
      for (const flag of cfg.media_required) {
        if (flag === 'floor_plan' && !listing.has_floor_plan) return false;
        if (flag === 'video' && !listing.has_video) return false;
        if (flag === 'matterport' && !listing.has_matterport) return false;
      }
    }
    if (cfg.exclude_rk_exclusive && listing.exclusively_at_rk) return false;

    // A configured radius is meaningful only via a polygon-buffer
    // predicate built from the selected sreality_geo region(s) — see
    // CycleService. Listings without GPS are dropped: we cannot prove
    // they fall inside the shape and notifying on a location we
    // can't place would be a worse defect than missing them.
    if (regionFilter) {
      if (!listing.gps || !Array.isArray(listing.gps.coordinates)) return false;
      const [lon, lat] = listing.gps.coordinates;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
      if (!regionFilter(lon, lat)) return false;
    }
    return true;
  }
}
