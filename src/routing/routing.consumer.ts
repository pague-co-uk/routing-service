import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import type {
  QueueClient,
} from "@pague-co-uk/sms-gateway-queue-client";

import {
  getComponentLogger,
  recordException,
  withSpan,
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  AppConfigService,
} from "../config/config.service.js";

import {
  QUEUE_CLIENT,
} from "../queue/constants/queue.constants.js";

import {
  RoutingService,
} from "./routing.service.js";

interface RoutingMessage {
  messageId: string;
}

@Injectable()
export class RoutingConsumer
  implements
  OnModuleInit,
  OnModuleDestroy {
  private readonly logger =
    getComponentLogger(
      RoutingConsumer.name,
    );

  private running = false;

  constructor(
    @Inject(QUEUE_CLIENT)
    private readonly queue:
      QueueClient,

    private readonly config:
      AppConfigService,

    private readonly routing:
      RoutingService,
  ) { }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async onModuleInit(): Promise<void> {
    this.running = true;

    const queue =
      this.config.routing.consumerQueue;

    this.logger.info(
      {
        queue,
      },
      "Routing consumer starting.",
    );

    // -----------------------------------------------------------------------
    // Connect to RabbitMQ
    // -----------------------------------------------------------------------

    this.logger.info(
      {
        queue,
        queueClientState:
          this.queue.currentState,
      },
      "Connecting routing consumer to RabbitMQ.",
    );

    try {
      await this.queue.connect();

      this.logger.info(
        {
          queue,
          queueClientState:
            this.queue.currentState,
          connected:
            this.queue.connected,
        },
        "Routing consumer connected to RabbitMQ.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          queue,
          queueClientState:
            this.queue.currentState,
          err:
            error,
        },
        "Routing consumer failed to connect to RabbitMQ.",
      );

      throw error;
    }

    // -----------------------------------------------------------------------
    // Subscribe / bind to queue
    // -----------------------------------------------------------------------

    this.logger.info(
      {
        queue,
        queueClientState:
          this.queue.currentState,
      },
      "Binding routing consumer to queue.",
    );

    try {
      const consumer =
        await this.queue.subscribe<RoutingMessage>(
          queue,
          async (message) => {
            if (!this.running) {
              this.logger.warn(
                {
                  queue,
                },
                "Routing message received while consumer is stopping.",
              );

              return;
            }

            await this.handleMessage(
              message,
            );
          },
          {
            noAck: false,
          },
        );

      this.logger.info(
        {
          queue,
          consumerTag:
            consumer.consumerTag,
          queueClientState:
            this.queue.currentState,
        },
        "Successfully bound routing consumer to queue.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          queue,
          queueClientState:
            this.queue.currentState,
          err:
            error,
        },
        "Failed to bind routing consumer to queue.",
      );

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;

    this.logger.info(
      {
        queue:
          this.config.routing.consumerQueue,
      },
      "Routing consumer stopping.",
    );

    try {
      await this.queue.close();

      this.logger.info(
        {
          queue:
            this.config.routing.consumerQueue,
        },
        "Routing consumer stopped.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          queue:
            this.config.routing.consumerQueue,
          err:
            error,
        },
        "Routing consumer failed to stop cleanly.",
      );

      throw error;
    }
  }

  // =========================================================================
  // Message handling
  // =========================================================================

  private async handleMessage(
    message: RoutingMessage,
  ): Promise<void> {
    await withSpan(
      "RoutingConsumer.handleMessage",
      async (span) => {
        span.setAttribute(
          "message.id",
          message.messageId,
        );

        span.setAttribute(
          "routing.consumer.queue",
          this.config.routing.consumerQueue,
        );

        this.logger.info(
          {
            queue:
              this.config.routing.consumerQueue,

            messageId:
              message.messageId,
          },
          "Routing message received.",
        );

        try {
          await this.routing.route(
            message,
          );

          this.logger.info(
            {
              queue:
                this.config.routing.consumerQueue,

              messageId:
                message.messageId,
            },
            "Routing message processed.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              queue:
                this.config.routing.consumerQueue,

              messageId:
                message.messageId,

              err:
                error,
            },
            "Routing message processing failed.",
          );

          /*
           * Do not swallow the error.
           *
           * The QueueClient must receive the rejected
           * handler promise so that the consumer semantics
           * can determine what happens to the RabbitMQ
           * delivery.
           */
          throw error;
        }
      },
    );
  }
}