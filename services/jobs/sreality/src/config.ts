function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : Math.max(1, parsed);
}

export const config = {
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/dp-reality',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672/',
  scrapeIntervalMinutes: intEnv('SCRAPE_INTERVAL_MINUTES', 10),
};
