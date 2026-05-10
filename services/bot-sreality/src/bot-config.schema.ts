import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type BotConfigDocument = HydratedDocument<BotConfig>;

// Per-bot configuration shape. Stored shape is whatever the bot service
// chose; nothing else in the platform interprets the inner `config`.
@Schema({ _id: false })
export class SrealityBotConfig {
  @Prop() category_main_cb?: number; // 1 = byt, 2 = dum
  @Prop() category_type_cb?: number; // 1 = sale, 2 = rent
  @Prop({ type: [Number], default: [] }) category_sub_cb!: number[];
  @Prop() price_min?: number;
  @Prop() price_max?: number;
  @Prop() city_contains?: string;
  @Prop({ type: [String], default: [] }) title_keywords!: string[];
  @Prop({ type: [String], default: [] }) labels_any!: string[];
}
export const SrealityBotConfigSchema = SchemaFactory.createForClass(SrealityBotConfig);

@Schema({ collection: 'sreality_config', timestamps: false, versionKey: false })
export class BotConfig {
  // _id is the BFF-minted per-configuration identifier (12-byte hex
  // string). Provided on every write; matches users.bots[].config_id.
  @Prop({ required: true, type: String }) _id!: string;

  @Prop({ required: true }) user_id!: string;
  // The BFF flips this directly when the user pauses/resumes a bot;
  // the matcher loop reads it to skip stopped configs.
  @Prop({ required: true, default: true }) active!: boolean;
  @Prop({ required: true, default: () => new Date() }) created_at!: Date;
  // Bumped by the bot on every POST upsert. Pure debug aid.
  @Prop({ type: Date, default: null }) updated_at?: Date | null;
  // Stamped after a successful notify.bot.welcome publish. Audit-only;
  // nothing reads it back. Useful when investigating "did this bot
  // ever welcome that user?" from mongosh.
  @Prop({ type: Date, default: null }) welcome_sent_at?: Date | null;

  @Prop({ type: SrealityBotConfigSchema, default: () => ({}) }) config!: SrealityBotConfig;
}

export const BotConfigSchema = SchemaFactory.createForClass(BotConfig);
BotConfigSchema.index({ user_id: 1 });
BotConfigSchema.index({ active: 1 });
