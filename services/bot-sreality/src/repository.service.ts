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

  async insertNotifications(
    rows: Array<Omit<NotificationRow, 'created_at' | 'unread' | 'sent_at'> & {
      created_at?: Date;
      unread?: boolean;
      sent_at?: Date | null;
    }>,
  ): Promise<number> {
    if (!rows.length) return 0;
    const filled = rows.map((r) => ({
      created_at: r.created_at ?? new Date(),
      unread: r.unread ?? true,
      sent_at: r.sent_at ?? null,
      ...r,
    }));
    try {
      const inserted = await this.notificationModel.insertMany(filled, { ordered: false });
      return inserted.length;
    } catch (err) {
      // The (user_id, config_id, source_ref) unique index makes re-runs
      // idempotent. With `ordered: false`, Mongoose surfaces dup-key
      // failures in a few different shapes depending on whether SOME
      // or ALL docs collided. We accept all of them as "no-op for the
      // dup'd rows" and only re-throw on genuinely unexpected errors.
      const e = err as {
        code?: number;
        message?: string;
        name?: string;
        insertedDocs?: unknown[];
        writeErrors?: Array<{ code?: number; err?: { code?: number } }>;
        result?: { insertedCount?: number; nInserted?: number };
      };
      const writeErrors = e.writeErrors ?? [];
      const nonDup = writeErrors.filter((w) => {
        const code = w.code ?? w.err?.code;
        return code !== 11000;
      });
      const isAllDup =
        e.code === 11000
        || (typeof e.message === 'string' && e.message.includes('E11000'));
      if (nonDup.length === 0 && (writeErrors.length > 0 || isAllDup)) {
        const inserted =
          e.insertedDocs?.length
          ?? e.result?.insertedCount
          ?? e.result?.nInserted
          ?? 0;
        if (writeErrors.length > 0 || inserted === 0) {
          this.logger.debug(
            `insertNotifications: ${writeErrors.length || rows.length} dup row(s) ignored, ${inserted} inserted`,
          );
        }
        return inserted;
      }
      throw err;
    }
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
