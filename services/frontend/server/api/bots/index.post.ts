import crypto from 'node:crypto';
import { getDb } from '../../utils/db';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, message: 'Valid email is required' });
  }

  const bot = body.bot;
  if (!bot?.name) {
    throw createError({ statusCode: 400, message: 'Bot name is required' });
  }

  const db = await getDb(event);
  const users = db.collection('users');

  const botDoc = {
    id: crypto.randomUUID(),
    name: bot.name,
    cities: bot.cities ?? [],
    property_types: bot.propertyTypes ?? [],
    price_types: bot.priceTypes ?? [],
    min_price: bot.minPrice ?? null,
    max_price: bot.maxPrice ?? null,
    dispositions: bot.dispositions ?? [],
    active: true,
    expires_at: null,
  };

  const result = await users.updateOne(
    { email },
    {
      $push: { bots: botDoc },
      $setOnInsert: {
        email,
        unsubscribe_token: crypto.randomUUID(),
        last_notified_at: null,
      },
    },
    { upsert: true },
  );

  return {
    botId: botDoc.id,
    created: result.upsertedCount > 0,
  };
});
