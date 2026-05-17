import buffer from '@turf/buffer';
import union from '@turf/union';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import {
  feature,
  featureCollection,
  point,
  polygon as turfPolygon,
  multiPolygon as turfMultiPolygon,
} from '@turf/helpers';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { GeoGeometry } from './region.schema.js';

export type RegionPredicate = (lon: number, lat: number) => boolean;

export interface RegionInput {
  geometry: GeoGeometry | null | undefined;
  center: { coordinates: [number, number] };
}

// Build a `(lon, lat) -> bool` predicate for a config's selected
// regions. Each region's polygon (or, for polygon-less entries, its
// centre point) is buffered outward by `radiusKm`, the resulting
// shapes are unioned, and listings are then tested with a single
// point-in-polygon check. This mirrors bezrealitky.cz's polygonBuffer
// semantics so "Brno + 10 km" means "Brno's actual boundary expanded
// by 10 km" rather than "10 km circle around the centroid".
export function buildRegionFilter(
  regions: RegionInput[],
  radiusKm: number,
): RegionPredicate {
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new Error(`radius_km must be a non-negative number, got ${radiusKm}`);
  }
  const buffered: Feature<Polygon | MultiPolygon>[] = [];
  for (const r of regions) {
    const seed = featureFromRegion(r);
    if (!seed) continue;
    const buf = buffer(seed, radiusKm, { units: 'kilometers' });
    if (buf && (buf.geometry.type === 'Polygon' || buf.geometry.type === 'MultiPolygon')) {
      buffered.push(buf as Feature<Polygon | MultiPolygon>);
    }
  }
  if (buffered.length === 0) {
    return () => false;
  }
  const merged =
    buffered.length === 1
      ? buffered[0]
      : union(featureCollection(buffered)) ?? buffered[0];
  return (lon, lat) => booleanPointInPolygon(point([lon, lat]), merged);
}

function featureFromRegion(
  r: RegionInput,
): Feature<Polygon | MultiPolygon> | ReturnType<typeof point> | null {
  const g = r.geometry;
  if (g && g.type === 'Polygon') {
    return turfPolygon(g.coordinates);
  }
  if (g && g.type === 'MultiPolygon') {
    return turfMultiPolygon(g.coordinates);
  }
  const c = r.center?.coordinates;
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return point([c[0], c[1]]);
}

// Re-export `feature` so callers that build raw GeoJSON elsewhere can
// still wrap results uniformly without pulling @turf/helpers directly.
export { feature };
