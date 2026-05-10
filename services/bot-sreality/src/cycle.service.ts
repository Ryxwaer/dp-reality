import { Injectable, Logger } from '@nestjs/common';
import { config } from './config.js';
import { MatcherService } from './matcher.service.js';
import { NotificationRendererService } from './notification-renderer.service.js';
import { PublisherService } from './publisher.service.js';
import { RepositoryService } from './repository.service.js';
import type { Listing } from './listing.schema.js';

@Injectable()
export class CycleService {
  private readonly logger = new Logger(CycleService.name);

  constructor(
    private readonly repository: RepositoryService,
    private readonly matcher: MatcherService,
    private readonly renderer: NotificationRendererService,
    private readonly publisher: PublisherService,
  ) {}

  // For each user's active configuration, evaluate the matcher against
  // the newly-inserted listings and append one notification row per
  // match. Then collapse to one event per user — the cycle (not any
  // single config) is what completed — and publish exactly one
  // notify.bot.processed per (user, bot, run) for which we appended at
  // least one row.
  async matchAndNotify(newListings: Listing[], runId: string): Promise<void> {
    if (!newListings.length) return;

    const configs = await this.repository.fetchActiveConfigs();
    if (!configs.length) return;

    type Bucket = { userId: string; configId: string; rows: ReturnType<NotificationRendererService['buildNotification']>[] };
    const buckets = new Map<string, Bucket>();

    for (const cfg of configs) {
      const key = `${cfg.user_id}|${String(cfg._id)}`;
      const bucket: Bucket = { userId: cfg.user_id, configId: String(cfg._id), rows: [] };
      for (const listing of newListings) {
        if (this.matcher.matches(cfg.config, listing)) {
          bucket.rows.push(
            this.renderer.buildNotification({
              userId: cfg.user_id,
              configId: String(cfg._id),
              listing,
            }),
          );
        }
      }
      if (bucket.rows.length > 0) buckets.set(key, bucket);
    }

    const usersWithInserts = new Set<string>();
    for (const bucket of buckets.values()) {
      const inserted = await this.repository.insertNotifications(bucket.rows);
      if (inserted > 0) usersWithInserts.add(bucket.userId);
    }

    for (const userId of usersWithInserts) {
      try {
        await this.publisher.publishBotProcessed({
          userId,
          botId: config.serviceId,
          runId,
        });
      } catch (err) {
        this.logger.warn(
          `publish notify.bot.processed failed (rows persisted): ${(err as Error).message}`,
        );
      }
    }
  }
}
