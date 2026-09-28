import {
  Inject,
  Injectable,
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

export type ClientDlrStatus =
  | "SUCCESS"
  | "FAILED"
  | "UNKNOWN";

export interface ClientDlr {
  messageId: string;
  publicId: string;
  providerMessageId: string;

  status:
  | "SUCCESS"
  | "FAILED"
  | "UNKNOWN";

  sourceAddress?: string;
  destinationAddress?: string;

  sourceAddrTon?: number;
  sourceAddrNpi?: number;

  destinationAddrTon?: number;
  destinationAddrNpi?: number;

  submittedAt?: Date;
  completedAt?: Date;

  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class ClientDlrPublisher {
  private readonly logger =
    getComponentLogger(
      ClientDlrPublisher.name,
    );

  constructor(
    @Inject(QUEUE_CLIENT)
    private readonly queue:
      QueueClient,

    private readonly config:
      AppConfigService,
  ) { }

  async publish(
    event: ClientDlr,
  ): Promise<void> {
    await withSpan(
      "ClientDlrPublisher.publish",
      async (span) => {
        span.setAttributes({
          "message.id":
            event.messageId,

          "message.provider_message_id":
            event.providerMessageId,

          "delivery.status":
            event.status,

          "messaging.destination":
            this.config.routing
              .clientDlrExchange,
        });

        this.logger.info(
          {
            messageId:
              event.messageId,

            providerMessageId:
              event.providerMessageId,

            status:
              event.status,

            exchange:
              this.config.routing
                .clientDlrExchange,
          },
          "Publishing client delivery receipt to fanout exchange.",
        );

        try {
          await this.queue.publishToExchange(
            this.config.routing
              .clientDlrExchange,
            event,
          );

          this.logger.info(
            {
              messageId:
                event.messageId,

              providerMessageId:
                event.providerMessageId,

              status:
                event.status,

              exchange:
                this.config.routing
                  .clientDlrExchange,
            },
            "Client delivery receipt published to fanout exchange.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              messageId:
                event.messageId,

              providerMessageId:
                event.providerMessageId,

              status:
                event.status,

              exchange:
                this.config.routing
                  .clientDlrExchange,

              err:
                error,
            },
            "Failed to publish client delivery receipt to fanout exchange.",
          );

          throw error;
        }
      },
    );
  }
}