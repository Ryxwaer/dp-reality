import * as amqp from 'amqplib'

/**
 * Lazy, single-connection RabbitMQ client for the Nuxt server. The first
 * publish triggers a connect; subsequent publishes reuse the same channel.
 * On error the cached channel is dropped and the next publish reconnects.
 *
 * Publishing is fire-and-forget from the callers' point of view: we surface
 * errors through the returned Promise, but request handlers decide whether
 * to await them. A broker outage should never block user-visible actions.
 */

let connectionPromise: Promise<amqp.ChannelModel> | null = null
let channelPromise: Promise<amqp.Channel> | null = null

function resetOnError(err: unknown, source: string): void {
  console.error(`[rabbitmq] ${source} failure, dropping cached channel:`, err)
  connectionPromise = null
  channelPromise = null
}

async function getConnection(): Promise<amqp.ChannelModel> {
  if (!connectionPromise) {
    const { rabbitmqUrl } = useRuntimeConfig()
    if (!rabbitmqUrl) {
      throw new Error('RabbitMQ URL is not configured (NUXT_RABBITMQ_URL).')
    }
    connectionPromise = amqp.connect(rabbitmqUrl)
      .then((conn) => {
        conn.on('error', err => resetOnError(err, 'connection error'))
        conn.on('close', () => resetOnError(new Error('connection closed'), 'connection close'))
        return conn
      })
      .catch((err) => {
        connectionPromise = null
        throw err
      })
  }
  return connectionPromise
}

async function getChannel(): Promise<amqp.Channel> {
  if (!channelPromise) {
    channelPromise = getConnection()
      .then(conn => conn.createChannel())
      .then((ch) => {
        ch.on('error', err => resetOnError(err, 'channel error'))
        ch.on('close', () => {
          channelPromise = null
        })
        return ch
      })
      .catch((err) => {
        channelPromise = null
        throw err
      })
  }
  return channelPromise
}

/**
 * Publish a JSON payload to a fanout exchange, asserting the exchange as
 * `durable` first. Messages are published as persistent.
 */
export async function publishFanout<T>(
  exchange: string,
  payload: T
): Promise<void> {
  const channel = await getChannel()
  await channel.assertExchange(exchange, 'fanout', { durable: true })
  const ok = channel.publish(
    exchange,
    '',
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: 'application/json' }
  )
  if (!ok) {
    await new Promise<void>(resolve => channel.once('drain', () => resolve()))
  }
}
