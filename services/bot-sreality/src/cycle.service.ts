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

  // Evaluate every active configuration against the freshly inserted
  // listings and publish exactly one notify.bot.processed per (user,
  // bot, run) for which at least one new notification row was inserted.
  async matchAndNotify(newListings: Listing[], runId: string): Promise<void> {
    if (!newListings.length) return;

    const configs = await this.repository.fetchActiveConfigs();
    if (!configs.length) return;

    type Bucket = { userId: string; rows: ReturnType<NotificationRendererService['buildNotification']>[] };
    const buckets = new Map<string, Bucket>();

    for (const cfg of configs) {
      const userId = cfg.user_id;
      let bucket = buckets.get(userId);
      if (!bucket) {
        bucket = { userId, rows: [] };
        buckets.set(userId, bucket);
      }
      for (const listing of newListings) {
        if (this.matcher.matches(cfg.config, listing)) {
          bucket.rows.push(
            this.renderer.buildNotification({
              userId,
              botId: config.serviceId,
              configId: String(cfg._id),
              listing,
            }),
          );
        }
      }
    }

    const usersWithInserts = new Set<string>();
    for (const bucket of buckets.values()) {
      if (!bucket.rows.length) continue;
      const inserted = await this.repository.insertNotifications(bucket.rows);
      if (inserted > 0) usersWithInserts.add(bucket.userId);
    }

    for (const userId of usersWithInserts) {
      await this.publisher.publishBotProcessed({
        userId,
        botId: config.serviceId,
        runId,
      });
    }
  }
}
