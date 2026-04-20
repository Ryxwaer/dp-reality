import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

/**
 * GeoJSON Point — `coordinates` is stored in `[longitude, latitude]`
 * order as required by Mongo's `2dsphere` index and `$geoWithin` /
 * `$centerSphere` operators. This is the same order the notification
 * service's `specmatcher` emits when it compiles a `geo_within` filter.
 */
@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

/**
 * `sreality` collection: stores exactly the fields the sreality
 * public estates API exposes, unflattened. Modules translate search
 * URLs (`/hledani/byty?cena-do=…&region-id=…&vzdalenost=…`) into
 * matchers over these fields; nothing is normalised cross-source.
 *
 * Category codes (`category_main_cb`, `category_sub_cb`,
 * `category_type_cb`) are the raw integer codes sreality returns —
 * the module's URL parser owns the path-slug → code translation so
 * we never lose information at scrape time.
 */
@Schema({ collection: 'sreality', timestamps: false, versionKey: false })
export class Listing {
  @Prop({ required: true }) source_id!: string;
  @Prop({ required: true }) title!: string;
  @Prop() price?: number;
  @Prop({ required: true }) price_type!: 'sale' | 'rent';
  @Prop({ required: true }) property_type!: 'apartment' | 'house';
  @Prop() disposition?: string;

  @Prop() locality?: string;
  @Prop() city?: string;

  /**
   * GeoJSON Point. Present only when the sreality API returned
   * `gps: { lat, lon }` for this listing (effectively always on
   * modern data, but we stay nullable in case). The module's
   * `vzdalenost` parameter compiles to a `$geoWithin` over this
   * field when the listing's region is in the centroid table.
   */
  @Prop({ type: GeoPoint }) gps?: GeoPoint;

  @Prop() category_main_cb?: number;
  @Prop() category_sub_cb?: number;
  @Prop() category_type_cb?: number;

  /**
   * Flattened `labelsAll[0]` — the structural/amenity tags like
   * `after_reconstruction`, `brick`, `not_furnished`. `labelsAll[1]`
   * (neighbourhood amenities) intentionally excluded: very noisy,
   * and no module currently filters on them.
   */
  @Prop({ type: [String], default: [] }) labels!: string[];

  @Prop({ required: true }) url!: string;
  @Prop() first_seen?: Date;
  @Prop() last_seen?: Date;
  @Prop() run_id?: string;
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

ListingSchema.index({ source_id: 1 }, { unique: true });
ListingSchema.index({ price: 1 });
ListingSchema.index({ first_seen: -1 });
ListingSchema.index({ run_id: 1 });
ListingSchema.index({ category_main_cb: 1 });
ListingSchema.index({ category_sub_cb: 1 });
// 2dsphere is what `$geoWithin` / `$centerSphere` need. Cannot be a
// sparse compound — the dedicated geo index is correct here.
ListingSchema.index({ gps: '2dsphere' });
