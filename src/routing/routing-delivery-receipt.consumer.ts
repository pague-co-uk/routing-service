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
import { SmppDeliveryReceipt } from "./types/smpp-delivery-receipt.js";


@Injectable()
export class RoutingDeliveryReceiptConsumer
  implements
  OnModuleInit,
  OnModuleDestroy {
  private readonly logger =
    getComponentLogger(
      RoutingDeliveryReceiptConsumer.name,
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
      this.config.routing.deliveryReceiptQueue;

    this.logger.info(
      {
        queue,
      },
      "Routing delivery receipt consumer starting.",
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
      "Connecting routing delivery receipt consumer to RabbitMQ.",
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
        "Routing delivery receipt consumer connected to RabbitMQ.",
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
        "Routing delivery receipt consumer failed to connect to RabbitMQ.",
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
      "Binding routing delivery receipt consumer to queue.",
    );

    try {
      const consumer =
        await this.queue.subscribe<SmppDeliveryReceipt>(
          queue,

          async (receipt) => {
            if (!this.running) {
              this.logger.warn(
                {
                  queue,
                },
                "Delivery receipt received while consumer is stopping.",
              );

              return;
            }

            await this.handleDeliveryReceipt(
              receipt,
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
        "Successfully bound routing delivery receipt consumer to queue.",
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
        "Failed to bind routing delivery receipt consumer to queue.",
      );

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;

    const queue =
      this.config.routing.deliveryReceiptQueue;

    this.logger.info(
      {
        queue,
      },
      "Routing delivery receipt consumer stopping.",
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
      "Routing delivery receipt consumer stopped.",
    );
  }

  // =========================================================================
  // Delivery receipt handling
  // =========================================================================

  private async handleDeliveryReceipt(
    receipt: SmppDeliveryReceipt,
  ): Promise<void> {
    await withSpan(
      "RoutingDeliveryReceiptConsumer.handleDeliveryReceipt",
      async (span) => {
        span.setAttributes({
          "message.provider_message_id":
            receipt.providerMessageId,

          "routing.connector_id":
            receipt.connectorId,

          "routing.delivery_status":
            receipt.status,

          "routing.delivery_receipt_queue":
            this.config.routing
              .deliveryReceiptQueue,
        });

        this.logger.info(
          {
            queue:
              this.config.routing
                .deliveryReceiptQueue,

            connectorId:
              receipt.connectorId,

            providerMessageId:
              receipt.providerMessageId,

            status:
              receipt.status,

            errorCode:
              receipt.errorCode,
          },
          "SMPP delivery receipt received.",
        );

        try {
          await this.routing.processDeliveryReceipt(
            receipt,
          );

          this.logger.info(
            {
              queue:
                this.config.routing
                  .deliveryReceiptQueue,

              connectorId:
                receipt.connectorId,

              providerMessageId:
                receipt.providerMessageId,

              status:
                receipt.status,
            },
            "SMPP delivery receipt processed.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              queue:
                this.config.routing
                  .deliveryReceiptQueue,

              connectorId:
                receipt.connectorId,

              providerMessageId:
                receipt.providerMessageId,

              status:
                receipt.status,

              err:
                error,
            },
            "SMPP delivery receipt processing failed.",
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