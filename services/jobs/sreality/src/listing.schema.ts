import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ListingDocument = HydratedDocument<Listing>;

@Schema({ collection: 'reality', timestamps: false, versionKey: false })
export class Listing {
  @Prop({ required: true }) source!: string;
  @Prop({ required: true }) source_id!: string;
  @Prop({ required: true }) title!: string;
  @Prop() price?: number;
  @Prop({ required: true }) price_type!: string;
  @Prop({ required: true }) property_type!: string;
  @Prop() disposition?: string;
  @Prop() city?: string;
  @Prop() locality_raw?: string;
  @Prop({ required: true }) url!: string;
  @Prop({ type: [String], default: [] }) features!: string[];
  @Prop() first_seen?: Date;
  @Prop() last_seen?: Date;
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

ListingSchema.index({ source: 1, source_id: 1 }, { unique: true });
ListingSchema.index({ city: 1 });
ListingSchema.index({ price: 1 });
ListingSchema.index({ first_seen: -1 });
