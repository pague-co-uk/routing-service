import {
  Provider,
} from "@nestjs/common";

import {
  createQueueClient,
} from "@pague-co-uk/sms-gateway-queue-client";

import {
  getComponentLogger,
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  AppConfigService,
} from "../config/config.service.js";

import {
  QUEUE_CLIENT,
} from "./constants/queue.constants.js";

export const queueProvider: Provider = {
  provide: QUEUE_CLIENT,

  inject: [
    AppConfigService,
  ],

  useFactory: (
    config: AppConfigService,
  ) => {
    const logger =
      getComponentLogger(
        "QueueClient",
      );

    return createQueueClient({
      url:
        config.rabbitmq.url,

      connectionName:
        config.rabbitmq.connectionName,

      heartbeat:
        config.rabbitmq.heartbeat,

      reconnectDelay:
        config.rabbitmq.reconnectDelay,

      maxReconnectDelay:
        config.rabbitmq.maxReconnectDelay,

      maxReconnectAttempts:
        config.rabbitmq.maxReconnectAttempts,

      autoCreateQueues:
        config.rabbitmq.autoCreateQueues,

      autoRecover:
        config.rabbitmq.autoRecover,
    });
  },
};