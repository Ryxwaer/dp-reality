import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ModuleRegistryDocument = HydratedDocument<ModuleRegistryEntry>;

// The BFF owns the indexes on module_registry (unique on `bot_id`).
// We deliberately do NOT mark `bot_id` as `unique` here — that would
// make Mongoose auto-create a competing `bot_id_1` index whose name
// conflicts with the BFF's `bot_id_unique`. Uniqueness is still
// enforced server-side by the BFF-owned index.
@Schema({
  collection: 'module_registry',
  timestamps: false,
  versionKey: false,
  autoIndex: false
})
export class ModuleRegistryEntry {
  @Prop({ required: true }) bot_id!: string;
  @Prop({ required: true }) display_name!: string;
  @Prop({ required: true }) description!: string;
  @Prop({ required: true }) base_url!: string;
  @Prop({ required: true, default: 'other' }) category!: string;
  // Path under base_url where the bot serves its iframe configuration
  // page. Read by the BFF when assembling the iframe src.
  @Prop({ required: true, default: '/configure' }) configure_url!: string;
  // Mongo collection holding this bot's per-configuration documents.
  // Read by the BFF to perform direct lifecycle writes (active flip on
  // pause/resume, deleteOne on delete) without a roundtrip to the bot.
  @Prop({ required: true }) config_collection!: string;
}

export const ModuleRegistrySchema = SchemaFactory.createForClass(ModuleRegistryEntry);
