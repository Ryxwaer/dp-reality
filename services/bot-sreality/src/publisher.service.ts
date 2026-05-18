import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { config } from './config.js';

const EXCHANGE_PROCESSED = 'notify.bot.processed';
const EXCHANGE_WELCOME = 'notify.bot.welcome';

@Injectable()
export class PublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublisherService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (err) {
      this.logger.warn('RabbitMQ not ready at startup, will retry on first publish', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }

  private async connect(): Promise<void> {
    const connection = await amqp.connect(config.rabbitmqUrl);
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_PROCESSED, 'fanout', { durable: true });
    await channel.assertExchange(EXCHANGE_WELCOME, 'fanout', { durable: true });
    this.connection = connection;
    this.channel = channel;
    this.logger.log('Connected to RabbitMQ');
  }

  private async publish(exchange: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.channel) await this.connect();
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ channel unavailable');
    channel.publish(exchange, '', Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async publishBotProcessed(input: { userId: string; botId: string; runId: string }): Promise<void> {
    await this.publish(EXCHANGE_PROCESSED, {
      user_id: input.userId,
      bot_id: input.botId,
      run_id: input.runId,
    });
  }

  async publishBotWelcome(input: {
    userId: string;
    configId: string;
    botId: string;
    sourceDisplayName: string;
    html: string;
  }): Promise<void> {
    await this.publish(EXCHANGE_WELCOME, {
      user_id: input.userId,
      config_id: input.configId,
      bot_id: input.botId,
      source_display_name: input.sourceDisplayName,
      html: input.html,
    });
  }
}
