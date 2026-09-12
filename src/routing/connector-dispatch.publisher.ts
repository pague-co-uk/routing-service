import {
  Inject,
  Injectable,
} from "@nestjs/common";

import {
  ConnectorTransport,
} from "@prisma/client";

import {
  AppConfigService,
} from "../config/config.service.js";

import type {
  QueueClient,
} from "@pague-co-uk/sms-gateway-queue-client";

import {
  getComponentLogger,
  recordException,
  withSpan,
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  QUEUE_CLIENT,
} from "../queue/constants/queue.constants.js";

import type {
  ConnectorDispatchMessage,
} from "./types/connector-dispatch-message.js";

@Injectable()
export class ConnectorDispatchPublisher {
  private readonly logger =
    getComponentLogger(
      ConnectorDispatchPublisher.name,
    );

  constructor(
    private readonly config:
      AppConfigService,

    @Inject(QUEUE_CLIENT)
    private readonly queue:
      QueueClient,
  ) { }

  async publish(
    message: ConnectorDispatchMessage,
    transport: ConnectorTransport,
  ): Promise<void> {
    const queueName =
      this.resolveQueue(
        transport,
      );

    await withSpan(
      "ConnectorDispatchPublisher.publish",
      async (span) => {
        span.setAttributes({
          "message.id":
            message.messageId,

          "message.attempt_id":
            message.attemptId,

          "message.route_id":
            message.routeId,

          "message.connector_id":
            message.connectorId,

          "connector.transport":
            transport,

          "connector.queue":
            queueName,
        });

        try {
          await this.queue.publish(
            queueName,
            message,
          );

          this.logger.info(
            {
              messageId:
                message.messageId,

              attemptId:
                message.attemptId,

              routeId:
                message.routeId,

              connectorId:
                message.connectorId,

              transport,

              queue:
                queueName,
            },
            "Connector dispatch published.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              messageId:
                message.messageId,

              attemptId:
                message.attemptId,

              routeId:
                message.routeId,

              connectorId:
                message.connectorId,

              transport,

              queue:
                queueName,

              err:
                error,
            },
            "Failed to publish connector dispatch.",
          );

          throw error;
        }
      },
    );
  }

  private resolveQueue(
    transport: ConnectorTransport,
  ): string {
    switch (transport) {
      case ConnectorTransport.HTTP:
        return this.config.routing.httpQueue;

      case ConnectorTransport.SMPP:
        return this.config.routing.smppQueue;

      default:
        throw new Error(
          `Unsupported connector transport: ${transport}`,
        );
    }
  }
}