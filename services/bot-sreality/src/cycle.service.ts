import { Injectable, Logger } from '@nestjs/common';
import { config } from './config.js';
import { MatcherService } from './matcher.service.js';
import { NotificationRendererService } from './notification-renderer.service.js';
import { PublisherService } from './publisher.service.js';
import { RepositoryService } from './repository.service.js';
import { RegionResolverService } from './region-resolver.service.js';
import { buildRegionFilter, type RegionPredicate } from './region-filter.js';
import type { Listing } from './listing.schema.js';
import type { SrealityBotConfig } from './bot-config.schema.js';

@Injectable()
export class CycleService {
  private readonly logger = new Logger(CycleService.name);

  constructor(
    private readonly repository: RepositoryService,
    private readonly matcher: MatcherService,
    private readonly renderer: NotificationRendererService,
    private readonly publisher: PublisherService,
    private readonly regionResolver: RegionResolverService,
  ) {}

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
      const regionFilter = await this.buildPredicateFor(cfg.config);
      for (const listing of newListings) {
        if (this.matcher.matches(cfg.config, listing, regionFilter)) {
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

  private async buildPredicateFor(
    cfg: SrealityBotConfig,
  ): Promise<RegionPredicate | null> {
    if (!cfg.region_id || cfg.radius_km == null || cfg.radius_km < 0) {
      return null;
    }
    const region = await this.regionResolver.findById(cfg.region_id);
    if (!region) {
      this.logger.warn(
        `Config references unknown region ${cfg.region_id}; skipping radius filter`,
      );
      return null;
    }
    return buildRegionFilter(
      [{ geometry: region.geometry, center: region.center }],
      cfg.radius_km,
    );
  }
}
