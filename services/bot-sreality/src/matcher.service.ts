import { Injectable } from '@nestjs/common';
import type { SrealityBotConfig } from './bot-config.schema.js';
import type { Listing } from './listing.schema.js';

// Mongoose returns missing optional keys as `null`, while in-process
// callers may pass `undefined`. Treat both as "filter not configured".
function isUnset<T>(v: T | null | undefined): v is null | undefined {
  return v === undefined || v === null;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

@Injectable()
export class MatcherService {
  matches(cfg: SrealityBotConfig, listing: Listing): boolean {
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
      if (isUnset(listing.price) || listing.price < cfg.price_min) {
        return false;
      }
    }
    if (!isUnset(cfg.price_max)) {
      if (isUnset(listing.price) || listing.price > cfg.price_max) {
        return false;
      }
    }
    // Listings without GPS are dropped when a radius is configured: we
    // cannot prove they fall inside the circle, and notifying on a
    // location we can't place would be a worse defect than missing them.
    if (cfg.center && !isUnset(cfg.radius_km) && cfg.radius_km > 0) {
      if (!listing.gps || !Array.isArray(listing.gps.coordinates)) {
        return false;
      }
      const [lonL, latL] = listing.gps.coordinates;
      const [lonC, latC] = cfg.center.coordinates;
      if (
        !Number.isFinite(lonL) || !Number.isFinite(latL) ||
        !Number.isFinite(lonC) || !Number.isFinite(latC)
      ) {
        return false;
      }
      if (haversineKm(latL, lonL, latC, lonC) > cfg.radius_km) {
        return false;
      }
    }
    return true;
  }
}
