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
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  QUEUE_CLIENT,
} from "./constants/queue.constants.js";

@Injectable()
export class QueueLifecycle
  implements
  OnModuleInit,
  OnModuleDestroy {
  private readonly logger =
    getComponentLogger(
      QueueLifecycle.name,
    );

  constructor(
    @Inject(QUEUE_CLIENT)
    private readonly queue:
      QueueClient,
  ) { }

  async onModuleInit(): Promise<void> {
    this.logger.info(
      {
        queueClientState:
          this.queue.currentState,
      },
      "Queue client starting.",
    );

    try {
      await this.queue.connect();

      this.logger.info(
        {
          queueClientState:
            this.queue.currentState,

          connected:
            this.queue.connected,
        },
        "Queue client connected.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          queueClientState:
            this.queue.currentState,

          err:
            error,
        },
        "Queue client failed to connect.",
      );

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info(
      {
        queueClientState:
          this.queue.currentState,
      },
      "Queue client stopping.",
    );

    try {
      await this.queue.close();

      this.logger.info(
        {
          queueClientState:
            this.queue.currentState,
        },
        "Queue client stopped.",
      );
    } catch (error) {
      recordException(error);

      this.logger.error(
        {
          queueClientState:
            this.queue.currentState,

          err:
            error,
        },
        "Queue client failed to stop cleanly.",
      );

      throw error;
    }
  }
}