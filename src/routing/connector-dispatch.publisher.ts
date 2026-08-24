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
  QUEUE_CLIENT,
} from "../queue/constants/queue.constants.js";

import {
  getConnectorQueue,
} from "./connector-queue.js";

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
    @Inject(QUEUE_CLIENT)
    private readonly queue:
      QueueClient,
  ) { }

  async publish(
    message: ConnectorDispatchMessage,
    connectorCode: string,
  ): Promise<void> {
    const queueName =
      getConnectorQueue(
        connectorCode,
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

          "connector.code":
            connectorCode,

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

              connectorCode,

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

              connectorId:
                message.connectorId,

              connectorCode,

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
}