import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

// GeoJSON Point in [lon, lat] order for Mongo 2dsphere / $centerSphere.
@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

// listings_sreality contains the analytics base schema fields required
// by the platform contract (title, property_type, disposition, price,
// price_type, city, district, source_url, first_seen, last_seen, run_id)
// plus a Sreality-specific tail (key, source_id, locality, gps,
// category_*_cb, labels). The tail is opaque to other services.
@Schema({ collection: 'listings_sreality', timestamps: false, versionKey: false })
export class Listing {
  // Content-addressed _id: sha256 of `key`. Stable across republishes,
  // changes only when the key changes (e.g. price moves). Provided
  // explicitly on every upsert.
  @Prop({ required: true, type: String }) _id!: string;

  // Stable composite dedupe key. See parseEstate() in scraper.service.ts
  // for the exact composition.
  @Prop({ required: true }) key!: string;

  // ---- Analytics base schema ----
  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) property_type!: 'apartment' | 'house';
  @Prop() disposition?: string;
  @Prop() price?: number;
  @Prop({ required: true }) price_type!: 'sale' | 'rent';
  @Prop() city?: string;
  @Prop() district?: string;
  @Prop({ required: true }) source_url!: string;
  @Prop() first_seen?: Date;
  @Prop() last_seen?: Date;
  @Prop() run_id?: string;

  // ---- Sreality-specific tail ----
  @Prop({ required: true }) source_id!: string;
  @Prop() locality?: string;
  @Prop({ type: GeoPoint }) gps?: GeoPoint;
  @Prop() category_main_cb?: number;
  @Prop() category_sub_cb?: number;
  @Prop() category_type_cb?: number;
  @Prop({ type: [String], default: [] }) labels!: string[];
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

ListingSchema.index({ key: 1 });
ListingSchema.index({ source_id: 1 });
ListingSchema.index({ price: 1 });
ListingSchema.index({ first_seen: -1 });
ListingSchema.index({ run_id: 1 });
ListingSchema.index({ category_main_cb: 1 });
ListingSchema.index({ category_sub_cb: 1 });
ListingSchema.index({ gps: '2dsphere' });
