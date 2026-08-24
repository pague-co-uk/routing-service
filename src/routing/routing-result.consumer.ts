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

import type {
  RoutingResult,
} from "./types/routing-result.js";

@Injectable()
export class RoutingResultConsumer
  implements
  OnModuleInit,
  OnModuleDestroy {
  private readonly logger =
    getComponentLogger(
      RoutingResultConsumer.name,
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
      this.config.routing.resultQueue;

    this.logger.info(
      {
        queue,
      },
      "Routing result consumer starting.",
    );

    // -----------------------------------------------------------------------
    // Connect to RabbitMQ
    // -----------------------------------------------------------------------

    try {
      this.logger.info(
        {
          queue,

          queueClientState:
            this.queue.currentState,
        },
        "Connecting routing result consumer to RabbitMQ.",
      );

      await this.queue.connect();

      this.logger.info(
        {
          queue,

          queueClientState:
            this.queue.currentState,

          connected:
            this.queue.connected,
        },
        "Routing result consumer connected to RabbitMQ.",
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
        "Routing result consumer failed to connect to RabbitMQ.",
      );

      throw error;
    }

    // -----------------------------------------------------------------------
    // Subscribe
    // -----------------------------------------------------------------------

    try {
      const consumer =
        await this.queue.subscribe<RoutingResult>(
          queue,

          async (result) => {
            if (!this.running) {
              this.logger.warn(
                {
                  queue,
                },
                "Routing result received while consumer is stopping.",
              );

              return;
            }

            await this.handleResult(
              result,
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
        "Successfully bound routing result consumer to queue.",
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
        "Failed to bind routing result consumer to queue.",
      );

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;

    const queue =
      this.config.routing.resultQueue;

    this.logger.info(
      {
        queue,
      },
      "Routing result consumer stopping.",
    );

    /*
     * The QueueClient is shared infrastructure.
     *
     * Do not close it here unless this module owns it.
     */
    this.logger.info(
      {
        queue,
      },
      "Routing result consumer stopped.",
    );
  }

  // =========================================================================
  // Result handling
  // =========================================================================

  private async handleResult(
    result: RoutingResult,
  ): Promise<void> {
    await withSpan(
      "RoutingResultConsumer.handleResult",
      async (span) => {
        span.setAttributes({
          "message.id":
            result.messageId,

          "routing.attempt_id":
            result.attemptId,

          "routing.route_id":
            result.routeId,

          "routing.connector_id":
            result.connectorId,

          "routing.result_status":
            result.status,

          "routing.result_queue":
            this.config.routing.resultQueue,
        });

        this.logger.info(
          {
            queue:
              this.config.routing.resultQueue,

            messageId:
              result.messageId,

            attemptId:
              result.attemptId,

            routeId:
              result.routeId,

            connectorId:
              result.connectorId,

            status:
              result.status,
          },
          "Routing result received.",
        );

        try {
          await this.routing.processResult(
            result,
          );

          this.logger.info(
            {
              queue:
                this.config.routing.resultQueue,

              messageId:
                result.messageId,

              attemptId:
                result.attemptId,

              status:
                result.status,
            },
            "Routing result processed.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              queue:
                this.config.routing.resultQueue,

              messageId:
                result.messageId,

              attemptId:
                result.attemptId,

              status:
                result.status,

              err:
                error,
            },
            "Routing result processing failed.",
          );

          /*
           * Do not swallow the error.
           *
           * QueueClient receives the rejected handler promise
           * and therefore retains control over acknowledgement
           * semantics.
           */
          throw error;
        }
      },
    );
  }
}