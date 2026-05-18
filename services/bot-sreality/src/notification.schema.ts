import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<NotificationRow>;

@Schema({ collection: 'notifications', timestamps: false, versionKey: false })
export class NotificationRow {
  @Prop({ required: true }) user_id!: string;
  @Prop({ required: true }) bot_id!: string;
  @Prop({ type: [String], default: [] }) config_ids!: string[];
  @Prop({ required: true }) source_ref!: string;
  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) url!: string;
  @Prop({ required: true }) html!: string;
  @Prop({ required: true, default: () => new Date() }) created_at!: Date;
  @Prop({ required: true, default: true }) unread!: boolean;
  @Prop({ default: null, type: Date }) sent_at!: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(NotificationRow);
NotificationSchema.index(
  { user_id: 1, bot_id: 1, source_ref: 1 },
  { unique: true, name: 'user_bot_source_unique' },
);
NotificationSchema.index({ user_id: 1, created_at: -1 }, { name: 'user_recent' });
