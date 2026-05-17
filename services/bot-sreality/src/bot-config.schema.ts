import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';
import type {
  Amenity,
  BuildingType,
  Condition,
  Furnished,
  MediaFlag,
  Ownership,
} from './listing.schema.js';

export type BotConfigDocument = HydratedDocument<BotConfig>;

@Schema({ _id: false })
class GeoPoint {
  @Prop({ required: true, enum: ['Point'], default: 'Point' }) type!: 'Point';
  @Prop({ type: [Number], required: true }) coordinates!: [number, number];
}

@Schema({ _id: false })
export class SrealityBotConfig {
  // 1 = byt (apartment), 2 = dum (house)
  @Prop() category_main_cb?: number;
  // 1 = sale, 2 = rent
  @Prop() category_type_cb?: number;
  @Prop({ type: [Number], default: [] }) category_sub_cb!: number[];
  @Prop() price_min?: number;
  @Prop() price_max?: number;
  // Geographic radius filter. All three of (region_id, center,
  // radius_km) are written together or not at all — the matcher treats
  // a partial geo triple as a configuration bug, not a wildcard.
  @Prop() region_id?: string;
  @Prop({ type: GeoPoint }) center?: GeoPoint;
  @Prop() radius_km?: number;
  @Prop() region_label?: string;

  // Optional structural filters derived from sreality's labelsAll[0]
  // taxonomy. Empty / undefined = "any". Semantics:
  //   *_in arrays  : listing.<field>     ∈ array     (single-valued)
  //   condition_in : listing.condition_set ∩ array ≠ ∅ (multi-valued)
  //   amenities_all: listing.amenity_set ⊇ array     (multi-valued ALL)
  //   media_required: every listed flag must be true on the listing
  //   exclude_rk_exclusive: drop listings flagged `exclusively_at_rk`
  @Prop({ type: [String], default: [] }) ownership_in!: Ownership[];
  @Prop({ type: [String], default: [] }) building_type_in!: BuildingType[];
  @Prop({ type: [String], default: [] }) condition_in!: Condition[];
  @Prop({ type: [String], default: [] }) furnished_in!: Furnished[];
  @Prop({ type: [String], default: [] }) amenities_all!: Amenity[];
  @Prop({ type: [String], default: [] }) media_required!: MediaFlag[];
  @Prop({ type: Boolean, default: false }) exclude_rk_exclusive!: boolean;
}
export const SrealityBotConfigSchema = SchemaFactory.createForClass(SrealityBotConfig);

@Schema({ collection: 'sreality_config', timestamps: false, versionKey: false })
export class BotConfig {
  @Prop({ required: true, type: String }) _id!: string;
  @Prop({ required: true }) user_id!: string;
  @Prop({ required: true, default: true }) active!: boolean;
  @Prop({ required: true, default: () => new Date() }) created_at!: Date;
  @Prop({ type: Date, default: null }) updated_at?: Date | null;
  @Prop({ type: Date, default: null }) welcome_sent_at?: Date | null;
  @Prop({ type: SrealityBotConfigSchema, default: () => ({}) }) config!: SrealityBotConfig;
}

export const BotConfigSchema = SchemaFactory.createForClass(BotConfig);
BotConfigSchema.index({ user_id: 1 });
BotConfigSchema.index({ active: 1 });
