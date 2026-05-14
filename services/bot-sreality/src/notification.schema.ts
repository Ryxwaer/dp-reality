import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<NotificationRow>;

// Shared `notifications` collection — multiple bot services append to
// it. The (user_id, bot_id, source_ref) unique index collapses two
// configurations of the same user/bot matching the same listing into a
// single row; `config_ids[]` records which of the user's configs
// flagged it.
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
