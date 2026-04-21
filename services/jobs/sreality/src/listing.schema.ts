import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

// GeoJSON Point in [lon, lat] order for Mongo 2dsphere / $centerSphere.
@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

@Schema({ collection: 'sreality', timestamps: false, versionKey: false })
export class Listing {
  // Content-addressed _id: sha256 of `key`. Stable across republishes,
  // changes only when the key changes (e.g. price moves). Provided
  // explicitly on every upsert; Mongoose will NOT auto-generate one.
  @Prop({ required: true, type: String }) _id!: string;

  // Stable composite dedupe key. Sreality rotates `source_id` (their
  // `hash_id`) on republish — keying on `source_id` would insert a fresh
  // doc for the same physical listing every time. The key is derived from
  // fields that survive republishes, plus `price` so a price change DOES
  // produce a new doc and re-notify the user.
  // See parseEstate() in scraper.service.ts for the exact composition.
  @Prop({ required: true }) key!: string;

  // Latest `hash_id` we've seen for this listing. Rotates with republishes.
  @Prop({ required: true }) source_id!: string;
  @Prop({ required: true }) title!: string;
  @Prop() price?: number;
  @Prop({ required: true }) price_type!: 'sale' | 'rent';
  @Prop({ required: true }) property_type!: 'apartment' | 'house';
  @Prop() disposition?: string;

  @Prop() locality?: string;
  @Prop() city?: string;

  @Prop({ type: GeoPoint }) gps?: GeoPoint;

  @Prop() category_main_cb?: number;
  @Prop() category_sub_cb?: number;
  @Prop() category_type_cb?: number;

  @Prop({ type: [String], default: [] }) labels!: string[];

  @Prop({ required: true }) url!: string;
  @Prop() first_seen?: Date;
  @Prop() last_seen?: Date;
  @Prop() run_id?: string;
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

// `_id` is the unique key — already implicitly indexed by Mongo. We keep
// `key` indexed (non-unique) for human inspection / migrations / debugging.
ListingSchema.index({ key: 1 });
ListingSchema.index({ source_id: 1 });
ListingSchema.index({ price: 1 });
ListingSchema.index({ first_seen: -1 });
ListingSchema.index({ run_id: 1 });
ListingSchema.index({ category_main_cb: 1 });
ListingSchema.index({ category_sub_cb: 1 });
ListingSchema.index({ gps: '2dsphere' });
