import * as amqp from 'amqplib'
import { EXCHANGES, type NotifyBotProcessedEvent } from '../utils/events'
import { publish } from '../utils/inbox-bus'

const QUEUE = 'frontend.inbox.bot.processed'

let started = false

async function start(url: string, attempt = 0): Promise<void> {
  try {
    const connection = await amqp.connect(url)
    connection.on('error', err => console.error('[inbox-events] connection error:', err))
    connection.on('close', () => {
      console.warn('[inbox-events] connection closed, will retry in 5s')
      setTimeout(() => void start(url, 0), 5_000)
    })

    const channel = await connection.createChannel()
    await channel.assertExchange(EXCHANGES.notifyBotProcessed, 'fanout', { durable: true })
    const q = await channel.assertQueue(QUEUE, {
      durable: false,
      exclusive: false,
      autoDelete: true
    })
    await channel.bindQueue(q.queue, EXCHANGES.notifyBotProcessed, '')
    await channel.prefetch(50)
    await channel.consume(q.queue, (msg) => {
      if (!msg) return
      try {
        const evt = JSON.parse(msg.content.toString('utf8')) as NotifyBotProcessedEvent
        if (evt?.user_id && evt?.bot_id) {
          publish({
            user_id: evt.user_id,
            bot_id: evt.bot_id,
            run_id: evt.run_id ?? '',
            ts: Date.now()
          })
        }
        channel.ack(msg)
      } catch (err) {
        console.error('[inbox-events] parse failed, dropping:', err)
        channel.nack(msg, false, false)
      }
    })

    console.log('[inbox-events] consuming', EXCHANGES.notifyBotProcessed)
  } catch (err) {
    const wait = Math.min(30_000, 1_000 * Math.pow(2, attempt))
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[inbox-events] connect to ${url} failed (${reason}); retry in ${wait}ms`)
    setTimeout(() => void start(url, attempt + 1), wait)
  }
}

export default defineNitroPlugin(() => {
  if (started) return
  started = true
  const { rabbitmqUrl } = useRuntimeConfig()
  if (!rabbitmqUrl) {
    console.warn('[inbox-events] no NUXT_RABBITMQ_URL configured, SSE inbox will be silent')
    return
  }
  void start(rabbitmqUrl)
})
