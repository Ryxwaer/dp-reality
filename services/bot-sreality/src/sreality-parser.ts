import { createHash } from 'node:crypto';
import {
  type Amenity,
  type BuildingType,
  type Condition,
  type Furnished,
  type Listing,
  type Ownership,
} from './listing.schema.js';

export interface SrealityEstate {
  hash_id: number;
  name: string;
  locality: string;
  price: number;
  seo: {
    locality: string;
    category_main_cb?: number;
    category_sub_cb?: number;
    category_type_cb?: number;
  };
  gps?: { lat: number; lon: number };
  labelsAll?: string[][];
  has_floor_plan?: boolean;
  has_video?: boolean;
  has_matterport_url?: boolean;
  exclusively_at_rk?: boolean;
}

export type ListingData = Omit<Listing, 'first_seen' | 'last_seen' | 'run_id'>;

export const SREALITY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

export const SREALITY_CATEGORIES = [
  { main: 1, type: 1, priceType: 'sale', propertyType: 'apartment' },
  { main: 1, type: 2, priceType: 'rent', propertyType: 'apartment' },
  { main: 2, type: 1, priceType: 'sale', propertyType: 'house' },
  { main: 2, type: 2, priceType: 'rent', propertyType: 'house' },
] as const;

const OWNERSHIP_TAGS = new Set<Ownership>(['personal', 'cooperative', 'state', 'collective']);
const BUILDING_TYPE_TAGS = new Set<BuildingType>([
  'brick', 'panel', 'wooden', 'mixed', 'skeletal', 'stone', 'assembled',
]);
const FURNISHED_TAGS = new Set<Furnished>([
  'furnished', 'not_furnished', 'partly_furnished',
]);
const CONDITION_TAGS = new Set<Condition>([
  'new_building', 'after_reconstruction', 'in_construction',
  'before_reconstruction', 'low_energy',
]);
const AMENITY_TAGS = new Set<Amenity>([
  'balcony', 'terrace', 'loggia', 'cellar', 'elevator',
  'parking_lots', 'garage', 'basin',
]);

interface DerivedLabels {
  ownership?: Ownership;
  building_type?: BuildingType;
  furnished?: Furnished;
  condition_set: Condition[];
  amenity_set: Amenity[];
}

// Project the heterogeneous `labelsAll[0]` tag bag into the typed
// fields the matcher uses. Single-valued taxonomies (ownership, type,
// furnished) are populated by the *first* matching tag — sreality's
// labelsAll is sorted with the canonical value first; later
// duplicates are noise.
function projectLabels(labels: string[]): DerivedLabels {
  const out: DerivedLabels = { condition_set: [], amenity_set: [] };
  const seenAmenities = new Set<Amenity>();
  const seenConditions = new Set<Condition>();
  for (const t of labels) {
    if (!out.ownership && OWNERSHIP_TAGS.has(t as Ownership)) {
      out.ownership = t as Ownership;
    } else if (!out.building_type && BUILDING_TYPE_TAGS.has(t as BuildingType)) {
      out.building_type = t as BuildingType;
    } else if (!out.furnished && FURNISHED_TAGS.has(t as Furnished)) {
      out.furnished = t as Furnished;
    } else if (CONDITION_TAGS.has(t as Condition) && !seenConditions.has(t as Condition)) {
      seenConditions.add(t as Condition);
      out.condition_set.push(t as Condition);
    } else if (AMENITY_TAGS.has(t as Amenity) && !seenAmenities.has(t as Amenity)) {
      seenAmenities.add(t as Amenity);
      out.amenity_set.push(t as Amenity);
    }
  }
  return out;
}

const APARTMENT_SLUGS: Record<number, string> = {
  2: '1+kk', 3: '1+1', 4: '2+kk', 5: '2+1', 6: '3+kk', 7: '3+1',
  8: '4+kk', 9: '4+1', 10: '5+kk', 11: '5+1', 12: '6-a-vice',
  16: 'atypicky', 47: 'pokoj',
};

const HOUSE_SLUGS: Record<number, string> = {
  33: 'chata', 37: 'rodinny', 39: 'vila', 43: 'chalupa',
  44: 'zemedelska-usedlost', 48: 'mobilni-dum', 54: 'vicegeneracni-dum',
};

function buildUrl(
  estate: SrealityEstate,
  priceType: 'sale' | 'rent',
  propertyType: 'apartment' | 'house',
): string {
  const saleRent = priceType === 'rent' ? 'pronajem' : 'prodej';
  const propSlug = propertyType === 'apartment' ? 'byt' : 'dum';
  const subCb = estate.seo?.category_sub_cb;
  const table = propertyType === 'apartment' ? APARTMENT_SLUGS : HOUSE_SLUGS;
  const dispSlug =
    (subCb !== undefined && table[subCb]) ||
    (propertyType === 'apartment' ? 'atypicky' : 'rodinny');
  return `https://www.sreality.cz/detail/${saleRent}/${propSlug}/${dispSlug}/${estate.seo.locality}/${estate.hash_id}`;
}

// Stable composite key. `seo.locality` is the URL slug Sreality assigns
// (street + district), constant across republishes. Including `price`
// means a price change deliberately produces a new key → new doc → new
// notification.
function buildDedupeKey(
  estate: SrealityEstate,
  priceType: 'sale' | 'rent',
  propertyType: 'apartment' | 'house',
  sourceId: string,
): string {
  const slug = estate.seo?.locality || sourceId;
  const subCb = estate.seo?.category_sub_cb ?? 'x';
  const priceKey = estate.price > 0 ? String(estate.price) : 'ask';
  return `${priceType}|${propertyType}|${subCb}|${slug}|${priceKey}`;
}

export function parseEstate(
  estate: SrealityEstate,
  priceType: 'sale' | 'rent',
  propertyType: 'apartment' | 'house',
): ListingData | null {
  const sourceId = String(estate.hash_id);
  if (!sourceId || sourceId === '0') return null;
  if (!estate.seo?.locality) return null;

  // Sreality returns GPS for every active estate. A missing or zero
  // coordinate pair therefore signals a malformed payload, not a
  // routine miss — fail loud instead of silently dropping the listing.
  if (
    !estate.gps ||
    !Number.isFinite(estate.gps.lat) ||
    !Number.isFinite(estate.gps.lon) ||
    (estate.gps.lat === 0 && estate.gps.lon === 0)
  ) {
    throw new Error(
      `estate ${sourceId} has no usable GPS (lat=${estate.gps?.lat}, lon=${estate.gps?.lon})`,
    );
  }
  const gps = {
    type: 'Point' as const,
    coordinates: [estate.gps.lon, estate.gps.lat] as [number, number],
  };

  const disposition =
    estate.name.match(/\b(\d+\+(?:kk|\d+))\b/i)?.[1] ?? undefined;

  const locality = estate.locality ?? '';
  const localityParts = locality.split(',');
  const lastSegment = localityParts[localityParts.length - 1].trim();
  const cityWithDistrict = lastSegment.split(' - ');
  const city = cityWithDistrict[0].trim() || undefined;
  const district = cityWithDistrict[1]?.trim() || undefined;

  const labels = estate.labelsAll?.[0] ?? [];
  const derived = projectLabels(labels);

  const key = buildDedupeKey(estate, priceType, propertyType, sourceId);
  return {
    _id: createHash('sha256').update(key).digest('hex'),
    key,
    title: estate.name,
    property_type: propertyType,
    disposition,
    price: estate.price > 0 ? estate.price : undefined,
    price_type: priceType,
    city,
    district,
    source_url: buildUrl(estate, priceType, propertyType),
    source_id: sourceId,
    locality: locality || undefined,
    gps,
    category_main_cb: estate.seo?.category_main_cb,
    category_sub_cb: estate.seo?.category_sub_cb,
    category_type_cb: estate.seo?.category_type_cb,
    labels,
    ownership: derived.ownership,
    building_type: derived.building_type,
    furnished: derived.furnished,
    condition_set: derived.condition_set,
    amenity_set: derived.amenity_set,
    has_floor_plan: !!estate.has_floor_plan,
    has_video: !!estate.has_video,
    has_matterport: !!estate.has_matterport_url,
    exclusively_at_rk: !!estate.exclusively_at_rk,
  };
}
