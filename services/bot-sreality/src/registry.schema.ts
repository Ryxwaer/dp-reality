import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ModuleRegistryDocument = HydratedDocument<ModuleRegistryEntry>;

@Schema({
  collection: 'module_registry',
  timestamps: false,
  versionKey: false,
  autoIndex: false,
})
export class ModuleRegistryEntry {
  @Prop({ required: true }) bot_id!: string;
  @Prop({ required: true }) display_name!: string;
  @Prop({ required: true }) description!: string;
  @Prop({ required: true }) base_url!: string;
  @Prop({ required: true, default: 'other' }) category!: string;
  @Prop({ required: true, default: '/configure' }) configure_url!: string;
  @Prop({ required: true }) config_collection!: string;
}

export const ModuleRegistrySchema = SchemaFactory.createForClass(ModuleRegistryEntry);
