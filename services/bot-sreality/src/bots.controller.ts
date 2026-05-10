import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RepositoryService } from './repository.service.js';
import { WelcomeService } from './welcome.service.js';
import type { SrealityBotConfig } from './bot-config.schema.js';

interface PostBody {
  // Forwarded for completeness so the welcome card can address the
  // user's bot by its dashboard name; the bot does not persist this —
  // the BFF stays the owner of users.bots[].name.
  bot_name?: string;
  config?: Partial<SrealityBotConfig>;
}

// Strip null/undefined keys before persisting. Mongoose stores `undefined`
// fields as BSON null on insert, and the matcher's "filter not set"
// branch checks for both — but we'd rather store missing keys as truly
// missing so future readers (mongosh, exports) don't trip over the
// distinction. Array/string fields are coerced to safe defaults.
function normalizeConfig(input: Partial<SrealityBotConfig> | undefined): SrealityBotConfig {
  const c = input ?? {};
  const out = {
    category_sub_cb: Array.isArray(c.category_sub_cb) ? c.category_sub_cb : [],
    title_keywords: Array.isArray(c.title_keywords) ? c.title_keywords.filter((k) => !!k) : [],
    labels_any: Array.isArray(c.labels_any) ? c.labels_any.filter((l) => !!l) : [],
  } as SrealityBotConfig;

  if (typeof c.category_main_cb === 'number') out.category_main_cb = c.category_main_cb;
  if (typeof c.category_type_cb === 'number') out.category_type_cb = c.category_type_cb;
  if (typeof c.price_min === 'number') out.price_min = c.price_min;
  if (typeof c.price_max === 'number') out.price_max = c.price_max;
  const city = c.city_contains?.trim();
  if (city) out.city_contains = city;

  return out;
}

// Bot-private configuration endpoints. Only the bot's own UI (loaded
// inside the BFF iframe via /modules/bot-sreality/* and reverse-proxied
// back here with `?user_id=...` injected from the authenticated session)
// calls these — the BFF orchestrator does NOT.
//
// Lifecycle mutations (pause / resume / delete) are no longer driven
// by HTTP or AMQP; the BFF writes this bot's `sreality_config`
// collection directly using the path it discovered through
// module_registry.config_collection.
@Controller('configs')
export class BotsController {
  private readonly logger = new Logger(BotsController.name);

  constructor(
    private readonly repository: RepositoryService,
    private readonly welcome: WelcomeService,
  ) {}

  @Get(':config_id')
  async get(
    @Param('config_id') configId: string,
    @Query('user_id') userId: string,
  ) {
    if (!userId) throw new NotFoundException('config not found');
    const doc = await this.repository.fetchConfig(configId);
    if (!doc) throw new NotFoundException('config not found');
    // Refuse to serve another user's config row even if the config_id
    // leaked. user_id here came from the proxy / session, not from the
    // client — so the comparison is authoritative.
    if (String(doc.user_id) !== userId) throw new NotFoundException('config not found');
    return {
      config_id: String((doc as unknown as { _id: unknown })._id),
      user_id: doc.user_id,
      active: doc.active,
      created_at: (doc.created_at as Date | undefined)?.toISOString?.() ?? doc.created_at,
      config: doc.config,
    };
  }

  // POST /configs/:config_id is upsert by design — used both to create
  // a new configuration row and to replace its `config` body on edit.
  // The welcome notification is fired here on insert (best-effort);
  // the bot's creation is what matters and must succeed even if the
  // welcome publish fails.
  @Post(':config_id')
  async post(
    @Param('config_id') configId: string,
    @Query('user_id') userId: string,
    @Body() body: PostBody,
  ) {
    if (!userId) throw new NotFoundException('config not found');
    const config = normalizeConfig(body.config);

    // Reject hijack attempts: a client cannot overwrite another user's
    // config row even if they guess the config_id, because `user_id`
    // here came from the proxy / session, not the body.
    const existing = await this.repository.fetchConfig(configId);
    if (existing && String(existing.user_id) !== userId) {
      throw new NotFoundException('config not found');
    }

    const result = await this.repository.upsertConfig({
      configId,
      userId,
      config,
    });

    if (result.created) {
      try {
        await this.welcome.emit({
          userId,
          configId,
          botName: body.bot_name?.trim() || 'Untitled bot',
          cfg: config,
        });
        await this.repository.markWelcomeSent(configId);
      } catch (err) {
        this.logger.warn(
          `welcome publish failed for config ${configId} (continuing): ${(err as Error).message}`,
        );
      }
    }

    return { ok: true, created: result.created, config_id: configId };
  }
}
