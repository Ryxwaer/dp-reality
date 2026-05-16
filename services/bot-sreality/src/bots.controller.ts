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
  bot_name?: string;
  config?: Partial<SrealityBotConfig>;
}

function normalizeConfig(input: Partial<SrealityBotConfig> | undefined): SrealityBotConfig {
  const c = input ?? {};
  const out = {
    category_sub_cb: Array.isArray(c.category_sub_cb) ? c.category_sub_cb : [],
  } as SrealityBotConfig;

  if (typeof c.category_main_cb === 'number') out.category_main_cb = c.category_main_cb;
  if (typeof c.category_type_cb === 'number') out.category_type_cb = c.category_type_cb;
  if (typeof c.price_min === 'number') out.price_min = c.price_min;
  if (typeof c.price_max === 'number') out.price_max = c.price_max;

  // All-or-nothing on the geo set. Persisting only part of it would
  // leave the matcher with a half-disabled filter at runtime.
  const radius =
    typeof c.radius_km === 'number' && Number.isFinite(c.radius_km) && c.radius_km > 0
      ? c.radius_km
      : null;
  const coords = c.center?.coordinates;
  const hasGoodCenter =
    Array.isArray(coords) &&
    coords.length === 2 &&
    Number.isFinite(coords[0]) &&
    Number.isFinite(coords[1]);
  const regionId = c.region_id?.trim();
  if (radius !== null && hasGoodCenter && regionId) {
    out.region_id = regionId;
    out.center = { type: 'Point', coordinates: [coords[0], coords[1]] };
    out.radius_km = radius;
    const label = c.region_label?.trim();
    if (label) out.region_label = label;
  }

  return out;
}

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
    if (String(doc.user_id) !== userId) throw new NotFoundException('config not found');
    return {
      config_id: String((doc as unknown as { _id: unknown })._id),
      user_id: doc.user_id,
      active: doc.active,
      created_at: (doc.created_at as Date | undefined)?.toISOString?.() ?? doc.created_at,
      config: doc.config,
    };
  }

  @Post(':config_id')
  async post(
    @Param('config_id') configId: string,
    @Query('user_id') userId: string,
    @Body() body: PostBody,
  ) {
    if (!userId) throw new NotFoundException('config not found');
    const config = normalizeConfig(body.config);

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
      // Welcome publish is best-effort: a transient broker hiccup must
      // not roll back the configuration the user just saved.
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
