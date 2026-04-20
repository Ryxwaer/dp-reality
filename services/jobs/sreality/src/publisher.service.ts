import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { config } from './config.js';

const EXCHANGE = 'scrape.completed';

@Injectable()
export class PublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublisherService.name);
  private model: amqp.ChannelModel | null = null;
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
    await this.model?.close();
  }

  private async connect(): Promise<void> {
    const model = await amqp.connect(config.rabbitmqUrl);
    const channel = await model.createChannel();
    await channel.assertExchange(EXCHANGE, 'fanout', { durable: true });
    this.model = model;
    this.channel = channel;
    this.logger.log('Connected to RabbitMQ');
  }

  async publishCompletion(runId: string): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }
    const channel = this.channel;
    if (!channel) {
      throw new Error('RabbitMQ channel unavailable after reconnect attempt');
    }
    const payload = JSON.stringify({
      run_id: runId,
      source: 'sreality',
      collection: 'sreality',
    });
    channel.publish(EXCHANGE, '', Buffer.from(payload), {
      persistent: true,
    });
    this.logger.debug(`Published scrape.completed run=${runId}`);
  }
}
