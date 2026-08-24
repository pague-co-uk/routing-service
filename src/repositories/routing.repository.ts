import {
  Inject,
  Injectable,
} from "@nestjs/common";

import {
  MessageRouteAttemptStatus,
  MessageStatus,
  RouteStatus,
} from "@prisma/client";

import { DATABASE } from "../database/database.constants.js";

import {
  Database,
  DatabaseRepository,
} from "../database/database.repository.js";

@Injectable()
export class RoutingRepository
  extends DatabaseRepository {
  constructor(
    @Inject(DATABASE)
    db: Database,
  ) {
    super(db);
  }

  // =========================================================================
  // Mobile Network
  // =========================================================================

  async findMobileNetworkForDestination(
    destination: string,
  ) {
    const candidates: string[] = [];

    for (
      let length = destination.length;
      length > 0;
      length--
    ) {
      candidates.push(
        destination.slice(
          0,
          length,
        ),
      );
    }

    if (
      candidates.length === 0
    ) {
      return null;
    }

    const matches =
      await this.db.mobileNetworkPrefix.findMany({
        where: {
          prefix: {
            in: candidates,
          },

          enabled: true,
        },

        include: {
          mobileNetwork: true,
        },
      });

    if (
      matches.length === 0
    ) {
      return null;
    }

    return matches.reduce(
      (
        longest,
        current,
      ) =>
        current.prefix.length >
          longest.prefix.length
          ? current
          : longest,
    );
  }

  // =========================================================================
  // Routes
  // =========================================================================

  async findRoutes(
    clientId: string,
    mobileNetworkId: string,
  ) {
    return this.db.route.findMany({
      where: {
        clientId,

        mobileNetworkId,

        status:
          RouteStatus.ACTIVE,

        connector: {
          status: "ACTIVE",
        },
      },

      include: {
        connector: true,

        mobileNetwork: true,
      },

      orderBy: {
        priority: "asc",
      },
    });
  }

  // =========================================================================
  // Attempts
  // =========================================================================

  async findAttempts(
    messageId: string,
  ) {
    return this.db.messageRouteAttempt.findMany({
      where: {
        messageId,
      },

      orderBy: {
        attemptNumber: "asc",
      },
    });
  }

  async findAttempt(
    attemptId: string,
  ) {
    return this.db.messageRouteAttempt.findUnique({
      where: {
        id: attemptId,
      },
    });
  }

  async createAttempt(
    data: {
      messageId: string;
      routeId: string;
      connectorId: string;
      attemptNumber: number;
      priority: number;
    },
  ) {
    return this.db.messageRouteAttempt.create({
      data: {
        messageId:
          data.messageId,

        routeId:
          data.routeId,

        connectorId:
          data.connectorId,

        attemptNumber:
          data.attemptNumber,

        priority:
          data.priority,

        status:
          MessageRouteAttemptStatus.PENDING,

        startedAt:
          new Date(),
      },
    });
  }

  // =========================================================================
  // Attempt state
  // =========================================================================

  async markDispatched(
    attemptId: string,
  ) {
    return this.db.messageRouteAttempt.update({
      where: {
        id: attemptId,
      },

      data: {
        status:
          MessageRouteAttemptStatus.DISPATCHED,

        dispatchedAt:
          new Date(),
      },
    });
  }

  async markSubmitting(
    attemptId: string,
  ): Promise<void> {
    await this.db.messageRouteAttempt.update({
      where: {
        id: attemptId,
      },

      data: {
        status:
          MessageRouteAttemptStatus.SUBMITTING,
      },
    });
  }

  async markSubmitted(
    attemptId: string,
    providerMessageId?: string,
  ) {
    return this.db.messageRouteAttempt.update({
      where: {
        id: attemptId,
      },

      data: {
        status:
          MessageRouteAttemptStatus.SUBMITTED,

        submittedAt:
          new Date(),

        providerMessageId,
      },
    });
  }

  async markFailed(
    attemptId: string,
    errorCode:
      | string
      | undefined,
    errorMessage: string,
  ): Promise<void> {
    await this.db.messageRouteAttempt.update({
      where: {
        id: attemptId,
      },

      data: {
        status:
          MessageRouteAttemptStatus.FAILED,

        failedAt:
          new Date(),

        errorCode,

        errorMessage,
      },
    });
  }

  async markUnknown(
    attemptId: string,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.db.messageRouteAttempt.update({
      where: {
        id: attemptId,
      },

      data: {
        status:
          MessageRouteAttemptStatus.UNKNOWN,

        errorCode,

        errorMessage,
      },
    });
  }

  // =========================================================================
  // Apply connector result
  // =========================================================================

  async applyAttemptResult(
    data: {
      attemptId: string;
      status: MessageRouteAttemptStatus;
      providerMessageId?: string;
      errorCode?: string;
      errorMessage?: string;
    },
  ) {
    // =========================================================================
    // Validate result status
    // =========================================================================

    /*
     * Connector results are only allowed to produce terminal routing
     * outcomes.
     *
     * PENDING, DISPATCHED and SUBMITTING are internal lifecycle states
     * and must not be supplied as connector results.
     */
    if (
      data.status !==
      MessageRouteAttemptStatus.SUBMITTED &&
      data.status !==
      MessageRouteAttemptStatus.FAILED &&
      data.status !==
      MessageRouteAttemptStatus.UNKNOWN
    ) {
      throw new Error(
        `Invalid routing result status: ${data.status}`,
      );
    }

    // =========================================================================
    // Apply result atomically
    // =========================================================================

    return this.transaction(
      async (db) => {
        const attempt =
          await db.messageRouteAttempt.findUnique({
            where: {
              id: data.attemptId,
            },
          });

        // ---------------------------------------------------------------------
        // Attempt does not exist
        // ---------------------------------------------------------------------

        if (!attempt) {
          return {
            applied: false,
            attempt: null,
          };
        }

        // ---------------------------------------------------------------------
        // Protect terminal states
        // ---------------------------------------------------------------------

        /*
         * Connector results may be delivered more than once.
         *
         * Once an attempt has reached a terminal state, don't allow a
         * duplicate or late result to change it.
         */
        if (
          attempt.status ===
          MessageRouteAttemptStatus.SUBMITTED ||
          attempt.status ===
          MessageRouteAttemptStatus.FAILED ||
          attempt.status ===
          MessageRouteAttemptStatus.UNKNOWN
        ) {
          return {
            applied: false,
            attempt,
          };
        }

        // ---------------------------------------------------------------------
        // Update attempt
        // ---------------------------------------------------------------------

        const now =
          new Date();

        const updated =
          await db.messageRouteAttempt.update({
            where: {
              id: attempt.id,
            },

            data: {
              status:
                data.status,

              providerMessageId:
                data.providerMessageId,

              errorCode:
                data.errorCode,

              errorMessage:
                data.errorMessage,

              submittedAt:
                data.status ===
                  MessageRouteAttemptStatus.SUBMITTED
                  ? now
                  : undefined,

              failedAt:
                data.status ===
                  MessageRouteAttemptStatus.FAILED
                  ? now
                  : undefined,
            },
          });

        return {
          applied: true,
          attempt: updated,
        };
      },
    );
  }
  // =========================================================================
  // Message
  // =========================================================================

  async findMessage(
    messageId: string,
  ) {
    return this.db.message.findUnique({
      where: {
        id: messageId,
      },
    });
  }

  async markMessageRouted(
    messageId: string,
  ) {
    return this.db.message.update({
      where: {
        id: messageId,
      },

      data: {
        currentStatus:
          MessageStatus.ROUTED,
      },
    });
  }

  async markMessageFailed(
    messageId: string,
  ) {
    return this.db.message.update({
      where: {
        id: messageId,
      },

      data: {
        currentStatus:
          MessageStatus.FAILED,
      },
    });
  }

  // =========================================================================
  // Transaction
  // =========================================================================

  async createAttemptAndMarkRouted(
    data: {
      messageId: string;
      routeId: string;
      connectorId: string;
      attemptNumber: number;
      priority: number;
    },
  ) {
    return this.transaction(
      async (db) => {
        const attempt =
          await db.messageRouteAttempt.create({
            data: {
              messageId:
                data.messageId,

              routeId:
                data.routeId,

              connectorId:
                data.connectorId,

              attemptNumber:
                data.attemptNumber,

              priority:
                data.priority,

              status:
                MessageRouteAttemptStatus.PENDING,

              startedAt:
                new Date(),
            },
          });

        await db.message.update({
          where: {
            id: data.messageId,
          },

          data: {
            currentStatus:
              MessageStatus.ROUTED,
          },
        });

        return attempt;
      },
    );
  }
}