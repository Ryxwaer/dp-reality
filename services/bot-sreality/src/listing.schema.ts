import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

// GeoJSON Point in [lon, lat] order, indexed as 2dsphere for $geoWithin.
@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

@Schema({ collection: 'listings_sreality', timestamps: false, versionKey: false })
export class Listing {
  // sha256(key) — stable across republishes; changes only when `key` does.
  @Prop({ required: true, type: String }) _id!: string;
  @Prop({ required: true }) key!: string;

  // Analytics base schema
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

  // Sreality-specific tail
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
