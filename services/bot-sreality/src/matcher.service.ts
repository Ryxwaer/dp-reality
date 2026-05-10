import { Injectable } from '@nestjs/common';
import type { SrealityBotConfig } from './bot-config.schema.js';
import type { Listing } from './listing.schema.js';

// Treat both `undefined` and `null` as "filter not set". The Mongoose
// schema declares fields as optional (`?:`), but Mongoose coerces
// missing keys to `null` on read, and the URL parser also writes `null`
// when a query parameter wasn't present. Without this, `null !==
// undefined` would let the comparison block run and reject every
// listing because `listing.field !== null` is always true for real data.
function isUnset<T>(v: T | null | undefined): v is null | undefined {
  return v === undefined || v === null;
}

// Per-user matcher: native operations on Sreality fields. Owned entirely
// by this bot service; the dialect never leaves this codebase.
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
    if (cfg.city_contains) {
      const haystack = (listing.city ?? '').toLowerCase();
      if (!haystack.includes(cfg.city_contains.toLowerCase())) {
        return false;
      }
    }
    if (cfg.title_keywords && cfg.title_keywords.length > 0) {
      const haystack = (listing.title ?? '').toLowerCase();
      const ok = cfg.title_keywords.every((k) => haystack.includes(k.toLowerCase()));
      if (!ok) return false;
    }
    if (cfg.labels_any && cfg.labels_any.length > 0) {
      const labels = new Set(listing.labels ?? []);
      const ok = cfg.labels_any.some((l) => labels.has(l));
      if (!ok) return false;
    }
    return true;
  }
}
