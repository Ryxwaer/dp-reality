function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : Math.max(1, parsed);
}

// `serviceId` is what the bot service publishes as its `bot_id` in
// module_registry. It MUST match the compose service name and the k8s
// Service name so peers can reach it via the same DNS label as the URL
// slug (/modules/<bot_id>/* on the BFF).
export const config = {
  serviceId: process.env.SERVICE_ID ?? 'bot-sreality',
  displayName: process.env.DISPLAY_NAME ?? 'Sreality.cz',
  description:
    process.env.DESCRIPTION ??
    "Largest Czech real-estate portal (Seznam.cz). JSON API; updates every ~10 minutes.",
  // Marketplace grouping. Free-form slug; the BFF /store page groups
  // modules by this value and falls back to `other` for legacy rows.
  category: process.env.CATEGORY ?? 'real-estate',
  baseUrl: process.env.BASE_URL ?? 'http://bot-sreality:8000',
  // Path under baseUrl where this bot serves its iframe configuration
  // page. The BFF reads this from module_registry to assemble the
  // iframe src; nothing else needs to be hard-coded on the BFF side.
  configureUrl: process.env.CONFIGURE_URL ?? '/configure',
  // MongoDB collection this bot owns for per-configuration documents.
  // The BFF reads this from module_registry to perform direct lifecycle
  // writes (active flip on pause/resume, deleteOne on delete) without
  // needing any HTTP roundtrip to the bot.
  configCollection: process.env.CONFIG_COLLECTION ?? 'sreality_config',

  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dp-reality',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672/',
  scrapeIntervalMinutes: intEnv('SCRAPE_INTERVAL_MINUTES', 10),

  httpPort: intEnv('HTTP_PORT', 8000),
};
