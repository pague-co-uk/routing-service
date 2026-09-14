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
  providerMessageId: string;
  status: ClientDlrStatus;
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
              .clientDlrQueue,
        });

        this.logger.info(
          {
            messageId:
              event.messageId,

            providerMessageId:
              event.providerMessageId,

            status:
              event.status,

            queue:
              this.config.routing
                .clientDlrQueue,
          },
          "Publishing client delivery receipt.",
        );

        try {
          await this.queue.publish(
            this.config.routing
              .clientDlrQueue,
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

              queue:
                this.config.routing
                  .clientDlrQueue,
            },
            "Client delivery receipt published.",
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

              queue:
                this.config.routing
                  .clientDlrQueue,

              err:
                error,
            },
            "Failed to publish client delivery receipt.",
          );

          throw error;
        }
      },
    );
  }
}

