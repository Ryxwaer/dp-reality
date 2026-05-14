import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Listing, type ListingDocument } from './listing.schema.js';
import { BotConfig, type BotConfigDocument } from './bot-config.schema.js';
import { NotificationRow } from './notification.schema.js';
import { ModuleRegistryEntry } from './registry.schema.js';
import { config } from './config.js';

type ListingData = Omit<Listing, 'first_seen' | 'last_seen' | 'run_id'>;

@Injectable()
export class RepositoryService {
  private readonly logger = new Logger(RepositoryService.name);

  constructor(
    @InjectModel(Listing.name) private readonly listingModel: Model<ListingDocument>,
    @InjectModel(BotConfig.name) private readonly configModel: Model<BotConfigDocument>,
    @InjectModel(NotificationRow.name) private readonly notificationModel: Model<NotificationRow>,
    @InjectModel(ModuleRegistryEntry.name) private readonly registryModel: Model<ModuleRegistryEntry>,
  ) {}

  // Upsert listings; return docs that were newly inserted (used by the
  // matcher loop). `runId` is stamped via $setOnInsert so re-sightings
  // keep their original run id.
  async upsertListings(listings: ListingData[], runId: string): Promise<Listing[]> {
    if (!listings.length) return [];

    const now = new Date();
    const ops = listings.map((l) => {
      const { _id, ...rest } = l;
      return {
        updateOne: {
          filter: { _id },
          update: {
            $setOnInsert: { _id, first_seen: now, run_id: runId },
            $set: { ...rest, last_seen: now },
          },
          upsert: true,
        },
      };
    });

    const result = await this.listingModel.bulkWrite(ops, { ordered: false });
    this.logger.log(
      `Upserted ${listings.length} listings — ${result.upsertedCount} new (run ${runId})`,
    );
    if (result.upsertedCount === 0) return [];

    const insertedIds = Object.values(result.upsertedIds ?? {}).map(String);
    if (!insertedIds.length) return [];

    return await this.listingModel.find({ _id: { $in: insertedIds } }).lean<Listing[]>();
  }

  async fetchActiveConfigs(): Promise<BotConfig[]> {
    return this.configModel.find({ active: true }).lean<BotConfig[]>();
  }

  async fetchConfig(configId: string): Promise<BotConfig | null> {
    return this.configModel.findById(configId).lean<BotConfig | null>();
  }

  /** Read every stored listing. Used once per configuration creation
   * to count how many listings already match the new filter, for the
   * welcome email. The matcher is run in-process so the same code
   * that flags a notification flags a "matching" count. */
  async fetchAllListings(): Promise<Listing[]> {
    return this.listingModel.find({}).lean<Listing[]>();
  }

  async upsertConfig(input: {
    configId: string;
    userId: string;
    config: BotConfig['config'];
  }): Promise<{ created: boolean }> {
    const now = new Date();
    const result = await this.configModel.updateOne(
      { _id: input.configId },
      {
        $setOnInsert: {
          _id: input.configId,
          user_id: input.userId,
          active: true,
          created_at: now,
        },
        $set: { config: input.config, updated_at: now },
      },
      { upsert: true },
    );
    return { created: !!result.upsertedId };
  }

  /** Audit-only stamp recorded after a successful welcome publish.
   * Nothing in the platform reads this back; useful only when poking
   * the collection directly to see whether a given user got welcomed. */
  async markWelcomeSent(configId: string): Promise<void> {
    await this.configModel.updateOne(
      { _id: configId },
      { $set: { welcome_sent_at: new Date() } },
    );
  }

  // Idempotent upsert keyed on (user_id, bot_id, source_ref). A second
  // matching configuration of the same user does NOT create a duplicate
  // row — it grows the existing row's `config_ids` array via $addToSet.
  // Returns the number of newly created rows (the others were already
  // present, possibly with a different subset of config_ids).
  async insertNotifications(
    rows: Array<{
      user_id: string;
      bot_id: string;
      config_id: string;
      source_ref: string;
      title: string;
      url: string;
      html: string;
    }>,
  ): Promise<number> {
    if (!rows.length) return 0;
    const now = new Date();
    const ops = rows.map((r) => ({
      updateOne: {
        filter: { user_id: r.user_id, bot_id: r.bot_id, source_ref: r.source_ref },
        update: {
          $setOnInsert: {
            user_id: r.user_id,
            bot_id: r.bot_id,
            source_ref: r.source_ref,
            title: r.title,
            url: r.url,
            html: r.html,
            created_at: now,
            unread: true,
            sent_at: null,
          },
          $addToSet: { config_ids: r.config_id },
        },
        upsert: true,
      },
    }));
    const result = await this.notificationModel.bulkWrite(ops, { ordered: false });
    return result.upsertedCount ?? 0;
  }

  // One-shot self-registration on boot. The platform contract treats
  // the registry as a published catalogue: once advertised, a service
  // stays listed. No heartbeat, no `last_seen`, no manifest of internal
  // scheduling state — those concerns live inside the bot service.
  // Keyed by `bot_id`, which doubles as the compose / k8s service name
  // and the URL slug under /modules/<bot_id>/* on the BFF.
  async upsertRegistry(): Promise<void> {
    await this.registryModel.updateOne(
      { bot_id: config.serviceId },
      {
        $set: {
          bot_id: config.serviceId,
          display_name: config.displayName,
          description: config.description,
          base_url: config.baseUrl,
          category: config.category,
          configure_url: config.configureUrl,
          config_collection: config.configCollection,
        },
      },
      { upsert: true },
    );
  }
}
