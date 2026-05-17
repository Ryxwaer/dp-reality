import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type RegionDocument = HydratedDocument<Region>;

export type Polygon = { type: 'Polygon'; coordinates: number[][][] };
export type MultiPolygon = { type: 'MultiPolygon'; coordinates: number[][][][] };
export type GeoGeometry = Polygon | MultiPolygon;

@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

@Schema({ _id: false })
class RegionParents {
  @Prop() municipality?: string;
  @Prop() district?: string;
  @Prop() region?: string;
  @Prop() country?: string;
}

// Bot-private vocabulary of Sreality regions (kraj, okres, obec,
// městská část, čtvrť, ulice). Seeded once at boot from the bundled
// `regions.json`. Sreality scopes its numeric ID space by entity type,
// so the document `_id` is a `<region_typ>:<sreality_id>` composite.
//
// `osm_id` and `geometry` are populated lazily on first selection: when
// a user picks a region in the configure UI we resolve it against
// Nominatim, store the OSM relation id and the GeoJSON polygon, and
// reuse it from then on. This mirrors the polygonBuffer semantics that
// bezrealitky.cz (and bot-bezrealitky) use for radius matching, so a
// query like "Jihomoravský kraj + 10 km" actually means "kraj polygon
// expanded outward by 10 km" instead of a 10 km circle around the
// (often-meaningless) sreality centroid.
@Schema({ collection: 'sreality_geo', timestamps: false, versionKey: false })
export class Region {
  @Prop({ required: true, type: String }) _id!: string;
  @Prop({ required: true }) sreality_id!: number;
  @Prop({ required: true }) region_typ!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) name_normalised!: string;
  @Prop({ required: true }) label!: string;
  @Prop({ type: RegionParents, default: () => ({}) }) parents!: RegionParents;
  @Prop({ type: GeoPoint, required: true }) center!: GeoPoint;
  @Prop({ type: Number }) osm_id?: number;
  @Prop({ type: Object }) geometry?: GeoGeometry;
}

export const RegionSchema = SchemaFactory.createForClass(Region);
RegionSchema.index({ name_normalised: 1 });
RegionSchema.index({ region_typ: 1, name_normalised: 1 });
RegionSchema.index({ sreality_id: 1, region_typ: 1 });
RegionSchema.index({ osm_id: 1 }, { sparse: true });
