import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

export type Ownership = 'personal' | 'cooperative' | 'state' | 'collective';
export type BuildingType = 'brick' | 'panel' | 'wooden' | 'mixed' | 'skeletal' | 'stone' | 'assembled';
export type Furnished = 'furnished' | 'not_furnished' | 'partly_furnished';
export type Condition =
  | 'new_building'
  | 'after_reconstruction'
  | 'in_construction'
  | 'before_reconstruction'
  | 'low_energy';
export type Amenity =
  | 'balcony'
  | 'terrace'
  | 'loggia'
  | 'cellar'
  | 'elevator'
  | 'parking_lots'
  | 'garage'
  | 'basin';
export type MediaFlag = 'floor_plan' | 'video' | 'matterport';

@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

@Schema({ collection: 'listings_sreality', timestamps: false, versionKey: false })
export class Listing {
  @Prop({ required: true, type: String }) _id!: string;
  @Prop({ required: true }) key!: string;

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

  @Prop({ required: true }) source_id!: string;
  @Prop() locality?: string;
  @Prop({ type: GeoPoint }) gps?: GeoPoint;
  @Prop() category_main_cb?: number;
  @Prop() category_sub_cb?: number;
  @Prop() category_type_cb?: number;

  @Prop({ type: [String], default: [] }) labels!: string[];

  @Prop({ type: String }) ownership?: Ownership;
  @Prop({ type: String }) building_type?: BuildingType;
  @Prop({ type: String }) furnished?: Furnished;
  @Prop({ type: [String], default: [] }) condition_set!: Condition[];
  @Prop({ type: [String], default: [] }) amenity_set!: Amenity[];
  @Prop({ type: Boolean, default: false }) has_floor_plan!: boolean;
  @Prop({ type: Boolean, default: false }) has_video!: boolean;
  @Prop({ type: Boolean, default: false }) has_matterport!: boolean;
  @Prop({ type: Boolean, default: false }) exclusively_at_rk!: boolean;
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
