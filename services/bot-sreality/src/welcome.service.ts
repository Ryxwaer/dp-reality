import { Injectable, Logger } from '@nestjs/common';
import { config } from './config.js';
import { MatcherService } from './matcher.service.js';
import { PublisherService } from './publisher.service.js';
import { RepositoryService } from './repository.service.js';
import type { SrealityBotConfig } from './bot-config.schema.js';

const APARTMENT_DISPO_LABELS: Record<number, string> = {
  2: '1+kk', 3: '1+1', 4: '2+kk', 5: '2+1', 6: '3+kk', 7: '3+1',
  8: '4+kk', 9: '4+1', 10: '5+kk', 11: '5+1', 12: '6+',
  16: 'atypical', 47: 'room',
};

const HOUSE_TYPE_LABELS: Record<number, string> = {
  33: 'cottage', 37: 'family house', 39: 'villa', 43: 'chalet',
  44: 'farm', 48: 'mobile home', 54: 'multi-generation',
};

function escHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPriceCzk(value: number | undefined): string {
  if (value === undefined || value === null) return '';
  return `${value.toLocaleString('cs-CZ').replace(/\u00A0/g, ' ')} CZK`;
}

function summariseFilter(cfg: SrealityBotConfig): string {
  const parts: string[] = [];

  const transaction =
    cfg.category_type_cb === 1 ? 'for sale'
    : cfg.category_type_cb === 2 ? 'for rent'
    : '';

  let property = 'listings';
  let dispoTable: Record<number, string> | null = null;
  if (cfg.category_main_cb === 1) {
    property = 'apartments';
    dispoTable = APARTMENT_DISPO_LABELS;
  } else if (cfg.category_main_cb === 2) {
    property = 'houses';
    dispoTable = HOUSE_TYPE_LABELS;
  }

  let dispoSummary = '';
  if (dispoTable && cfg.category_sub_cb?.length) {
    const labels = cfg.category_sub_cb
      .map((cb) => dispoTable![cb])
      .filter((l): l is string => !!l);
    if (labels.length > 0) {
      dispoSummary = ` (${labels.join(', ')})`;
    }
  }

  const head = transaction
    ? `${property.charAt(0).toUpperCase()}${property.slice(1)}${dispoSummary} ${transaction}`
    : `${property.charAt(0).toUpperCase()}${property.slice(1)}${dispoSummary}`;
  parts.push(head);

  if (cfg.price_min != null && cfg.price_max != null) {
    parts.push(`${formatPriceCzk(cfg.price_min)} – ${formatPriceCzk(cfg.price_max)}`);
  } else if (cfg.price_min != null) {
    parts.push(`from ${formatPriceCzk(cfg.price_min)}`);
  } else if (cfg.price_max != null) {
    parts.push(`up to ${formatPriceCzk(cfg.price_max)}`);
  }

  if (cfg.city_contains) parts.push(`in ${cfg.city_contains}`);
  if (cfg.title_keywords?.length) {
    parts.push('matching ' + cfg.title_keywords.map((k) => `"${k}"`).join(', '));
  }
  if (cfg.labels_any?.length) {
    parts.push('with labels ' + cfg.labels_any.map((l) => `"${l}"`).join(', '));
  }

  return parts.join(' \u00b7 ');
}

function renderWelcomeCard(input: {
  botName: string;
  matchingCount: number;
  cfg: SrealityBotConfig;
}): string {
  const name = escHtml(input.botName) || 'Untitled bot';
  const summary = escHtml(summariseFilter(input.cfg));
  const interval = config.scrapeIntervalMinutes;
  const countLine =
    input.matchingCount > 0
      ? `We're already tracking <strong>${input.matchingCount.toLocaleString('cs-CZ').replace(/\u00A0/g, ' ')}</strong> matching listings, and we'll email you the moment a new one appears.`
      : `We don't see any matching listings yet, but we'll keep watching and email you the moment a new one appears.`;

  return (
    '<div style="max-width:600px;margin:0 0 12px;padding:18px 20px;'
    + 'border:1px solid #e2e8f0;border-radius:12px;'
    + 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
    + 'background:#ffffff">'
    + '<div style="font-size:12px;color:#64748b;text-transform:uppercase;'
    + 'letter-spacing:0.04em;margin-bottom:6px">Sreality.cz \u00b7 Watchdog active</div>'
    + `<div style="font-size:18px;color:#0f172a;font-weight:600;margin-bottom:10px">Your bot "${name}" is now watching</div>`
    + `<p style="margin:0 0 12px;font-size:13px;color:#1e293b;line-height:1.5">${countLine}</p>`
    + '<div style="margin:14px 0;padding:10px 12px;background:#f8fafc;'
    + 'border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#475569">'
    + '<div style="font-weight:600;color:#0f172a;margin-bottom:4px">What you asked for</div>'
    + `<div>${summary}</div>`
    + '</div>'
    + '<p style="margin:8px 0 0;font-size:12px;color:#64748b;line-height:1.5">'
    + `We re-check Sreality.cz every ${interval}\u00a0minute${interval === 1 ? '' : 's'}. `
    + 'You can pause or remove this bot at any time from your dashboard.'
    + '</p>'
    + '</div>'
  );
}

@Injectable()
export class WelcomeService {
  private readonly logger = new Logger(WelcomeService.name);

  constructor(
    private readonly repository: RepositoryService,
    private readonly matcher: MatcherService,
    private readonly publisher: PublisherService,
  ) {}

  // Emit one notify.bot.welcome event for a freshly-created
  // configuration. The payload carries everything the email-notifier
  // needs (subject + pre-rendered HTML); no notifications row is
  // written. Fire-and-forget by design: the welcome email is a courtesy
  // and must not block configuration creation if RabbitMQ or Mongo is
  // briefly unavailable.
  async emit(input: {
    userId: string;
    configId: string;
    botName: string;
    cfg: SrealityBotConfig;
  }): Promise<void> {
    let matchingCount = 0;
    try {
      // Run the matcher in-process against the listings the scraper has
      // already stored — single-source the "is this a match?" decision
      // instead of duplicating it as a Mongo query.
      const all = await this.repository.fetchAllListings();
      for (const listing of all) {
        if (this.matcher.matches(input.cfg, listing)) matchingCount += 1;
      }
    } catch (err) {
      this.logger.warn(
        `welcome: matching count failed for config ${input.configId}: ${(err as Error).message}`,
      );
    }

    const html = renderWelcomeCard({
      botName: input.botName,
      matchingCount,
      cfg: input.cfg,
    });
    const subject = `Your bot "${input.botName || 'Untitled bot'}" is now watching ${config.displayName}`;

    try {
      await this.publisher.publishBotWelcome({
        userId: input.userId,
        configId: input.configId,
        botId: config.serviceId,
        subject,
        html,
      });
      this.logger.log(
        `welcome: published for config ${input.configId} (user ${input.userId}, ${matchingCount} matching listings)`,
      );
    } catch (err) {
      this.logger.warn(
        `welcome: publish failed for config ${input.configId}: ${(err as Error).message}`,
      );
    }
  }
}
