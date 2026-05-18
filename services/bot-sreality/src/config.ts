function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : Math.max(1, parsed);
}

export const config = {
  serviceId: process.env.SERVICE_ID ?? 'bot-sreality',
  displayName: process.env.DISPLAY_NAME ?? 'Sreality.cz',
  description:
    process.env.DESCRIPTION ??
    'Largest Czech real-estate portal (Seznam.cz). JSON API; updates every ~10 minutes.',
  category: process.env.CATEGORY ?? 'real-estate',
  baseUrl: process.env.BASE_URL ?? 'http://bot-sreality:8000',
  configureUrl: process.env.CONFIGURE_URL ?? '/configure',
  configCollection: process.env.CONFIG_COLLECTION ?? 'sreality_config',

  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dp-reality',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672/',
  scrapeIntervalMinutes: intEnv('SCRAPE_INTERVAL_MINUTES', 10),

  httpPort: intEnv('HTTP_PORT', 8000),
};
