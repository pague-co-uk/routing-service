import {
  Inject,
  Injectable,
} from "@nestjs/common";

import {
  ConnectorTransport,
  Prisma,
  MessageRouteAttemptStatus,
  MessageStatus,
  RouteStatus,
} from "@prisma/client";

import { DATABASE } from "../database/database.constants.js";

import {
  Database,
  DatabaseRepository,
} from "../database/database.repository.js";

import { retryDelay, type RetryPolicy } from "../routing/retry/retry-policy.js";
import type { RoutingResult } from "../routing/types/routing-result.js";

interface DispatchQueues { httpQueue: string; smppQueue: string; }

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
    countryId: string,
  ) {
    const networks =
      await this.db.mobileNetwork.findMany({
        where: {
          countryId,

          status:
            "ACTIVE",

          routingRegex: {
            not: null,
          },
        },
      });

    const matches =
      networks.filter(
        (network) => {
          if (
            !network.routingRegex
          ) {
            return false;
          }

          /*
           * Routing regexes are always evaluated from the beginning of the
           * destination number.
           *
           * If the configured expression already starts with "^", preserve
           * it. Otherwise anchor it here.
           */
          const pattern =
            network.routingRegex.startsWith(
              "^",
            )
              ? network.routingRegex
              : `^${network.routingRegex}`;

          try {
            return new RegExp(
              pattern,
            ).test(destination);
          } catch {
            throw new Error(
              `Invalid routing regex configured for mobile network ${network.id}: ${network.routingRegex}`,
            );
          }
        },
      );

    // -----------------------------------------------------------------------
    // No match
    // -----------------------------------------------------------------------

    if (
      matches.length === 0
    ) {
      return null;
    }

    // -----------------------------------------------------------------------
    // Multiple matches
    // -----------------------------------------------------------------------

    /*
     * A destination must resolve to exactly one allocated mobile network.
     *
     * Multiple matches indicate a configuration error. We deliberately do
     * not use priority here because mobile-network matching is based on
     * numbering allocation, not route failover priority.
     */

    if (
      matches.length > 1
    ) {
      throw new Error(
        `Multiple mobile networks matched destination ${destination}: ${matches
          .map(
            (network) =>
              network.code,
          )
          .join(", ")}`,
      );
    }

    // -----------------------------------------------------------------------
    // Single match
    // -----------------------------------------------------------------------

    return matches[0];
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

  private async currentCycleAttempts(messageId: string, attempts: Awaited<ReturnType<RoutingRepository["findAttempts"]>>) {
    const manualRetry = await this.db.messageStatusEvent.findFirst({
      where: { messageId, source: "manual-retry", status: "QUEUED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const boundary = manualRetry?.attemptId ? attempts.find(item => item.id === manualRetry.attemptId)?.attemptNumber : 0;
    if (manualRetry?.attemptId && boundary === undefined) throw new Error("Manual retry history is inconsistent.");
    return attempts.filter(item => item.attemptNumber > (boundary ?? 0));
  }

  async findRoutingCycleAttempts(messageId: string) {
    return this.currentCycleAttempts(messageId, await this.findAttempts(messageId));
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

  async findAttemptByProviderMessageId(
    connectorId: string,
    providerMessageId: string,
  ) {
    return this.db.messageRouteAttempt.findFirst({
      where: {
        connectorId,
        providerMessageId,
      }, include: {
        message: {
          include: {
            senderId: true
          }
        }
      }
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
    finalFailure = true,
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

              completedAt: now,

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

        // ---------------------------------------------------------------------
        // Update message status and create status event
        // ---------------------------------------------------------------------

        /*
         * MessageRouteAttemptStatus and MessageStatus are separate enums.
         *
         * The routing attempt records the connector lifecycle while the
         * message records the overall message lifecycle.
         */

        // Connector accepted/submitted the message to the provider.
        //
        // This does NOT mean the handset has received the message.
        //
        // A later delivery receipt must transition the message to DELIVERED.

        if (
          data.status ===
          MessageRouteAttemptStatus.SUBMITTED
        ) {
          await db.message.update({
            where: {
              id: attempt.messageId,
            },

            data: {
              currentStatus:
                MessageStatus.SUBMITTED,

              submittedAt:
                now,
            },
          });

          await db.messageStatusEvent.create({
            data: {
              messageId:
                attempt.messageId,

              attemptId:
                attempt.id,

              status:
                MessageStatus.SUBMITTED,

              source:
                "routing",

              description:
                "Message submitted to provider.",

              rawData:
                data.providerMessageId
                  ? {
                    providerMessageId:
                      data.providerMessageId,
                  }
                  : undefined,

              createdAt:
                now,
            },
          });
        }

        // Connector definitively rejected/failed the message.

        if (
          data.status ===
          MessageRouteAttemptStatus.FAILED
        ) {
          if (finalFailure) {
            await db.message.update({
              where: { id: attempt.messageId },
              data: { currentStatus: MessageStatus.FAILED },
            });
          }

          await db.messageStatusEvent.create({
            data: {
              messageId:
                attempt.messageId,

              attemptId:
                attempt.id,

              status:
                finalFailure ? MessageStatus.FAILED : MessageStatus.ROUTED,

              source:
                "routing",

              description:
                data.errorMessage ??
                "Message submission to provider failed.",

              rawData: {
                attemptStatus: "FAILED",
                errorCode: data.errorCode ?? null,
                finalFailure,
              },

              createdAt:
                now,
            },
          });
        }

        /*
         * UNKNOWN does not immediately change the overall message status.
         *
         * The provider outcome is unresolved and should remain subject
         * to the expiry/timeout mechanism.
         */

        return {
          applied: true,
          attempt: updated,
        };
      },
    );
  }

  async applyDeliveryReceipt(
    data: {
      attemptId: string;
      status:
      | "DELIVERED"
      | "FAILED";
      errorCode?: string;
      errorMessage?: string;
      rawData?: {
        sourceAddress?: string;
        destinationAddress?: string;
        shortMessage?: string;
      };
    },
  ) {
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
        // Only submitted attempts can receive a DLR
        // ---------------------------------------------------------------------

        if (
          attempt.status !==
          MessageRouteAttemptStatus.SUBMITTED
        ) {
          return {
            applied: false,
            attempt,
          };
        }

        const now =
          new Date();

        // ---------------------------------------------------------------------
        // Update routing attempt
        // ---------------------------------------------------------------------

        const updated =
          await db.messageRouteAttempt.update({
            where: {
              id: attempt.id,
            },

            data: {
              status:
                data.status ===
                  "DELIVERED"
                  ? MessageRouteAttemptStatus.SUBMITTED
                  : MessageRouteAttemptStatus.FAILED,

              errorCode:
                data.errorCode,

              errorMessage:
                data.errorMessage,

              failedAt:
                data.status ===
                  "FAILED"
                  ? now
                  : undefined,
            },
          });

        // ---------------------------------------------------------------------
        // Update message
        // ---------------------------------------------------------------------

        const messageStatus =
          data.status ===
            "DELIVERED"
            ? MessageStatus.DELIVERED
            : MessageStatus.FAILED;

        await db.message.update({
          where: {
            id: attempt.messageId,
          },

          data: {
            currentStatus:
              messageStatus,
          },
        });

        // ---------------------------------------------------------------------
        // Create status event
        // ---------------------------------------------------------------------

        await db.messageStatusEvent.create({
          data: {
            messageId:
              attempt.messageId,

            attemptId:
              attempt.id,

            status:
              messageStatus,

            source:
              "smpp",

            description:
              data.status ===
                "DELIVERED"
                ? "Message delivered to handset."
                : data.errorMessage ??
                "Message delivery failed.",

            rawData:
              data.rawData
                ? {
                  sourceAddress:
                    data.rawData
                      .sourceAddress,

                  destinationAddress:
                    data.rawData
                      .destinationAddress,

                  shortMessage:
                    data.rawData
                      .shortMessage,
                }
                : undefined,

            createdAt:
              now,
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

  async markMessageFailed(
    messageId: string,
    expectedUpdatedAt?: Date,
  ) {
    return this.transaction(
      async (db) => {
        await this.lockMessage(db, messageId);
        const messageState = await db.message.findUnique({ where: { id: messageId } });
        if (expectedUpdatedAt && messageState && +messageState.updatedAt !== +expectedUpdatedAt) return null;
        const latest = await db.messageRouteAttempt.findFirst({
          where: { messageId }, orderBy: { attemptNumber: "desc" },
        });
        if (!messageState || ["SUBMITTED", "DELIVERED", "EXPIRED", "FAILED"].includes(messageState.currentStatus) ||
            (latest && latest.status !== "FAILED")) return null;

        const now =
          new Date();

        const message =
          await db.message.update({
            where: {
              id: messageId,
            },

            data: {
              currentStatus:
                MessageStatus.FAILED,
            },
          });

        await db.messageStatusEvent.create({
          data: {
            messageId,

            status:
              MessageStatus.FAILED,

            source:
              "routing",

            description:
              "Message routing failed.",

            createdAt:
              now,
          },
        });

        return message;
      },
    );
  }

  // =========================================================================
  // Transaction
  // =========================================================================

  private async lockMessage(db: Prisma.TransactionClient, messageId: string) {
    await db.$queryRaw`SELECT id FROM messages WHERE id = ${messageId} FOR UPDATE`;
  }

  private queueFor(transport: ConnectorTransport, queues: DispatchQueues): string {
    if (transport === ConnectorTransport.HTTP) return queues.httpQueue;
    if (transport === ConnectorTransport.SMPP) return queues.smppQueue;
    throw new Error(`Unsupported connector transport: ${transport}`);
  }

  private async enqueueAttempt(
    db: Prisma.TransactionClient,
    data: { messageId: string; routeId: string; connectorId: string; attemptNumber: number; priority: number },
    queueName: string,
    scheduledAt: Date,
  ) {
    const attempt = await db.messageRouteAttempt.create({
      data: { ...data, status: "PENDING", scheduledAt },
    });
    await db.message.update({
      where: { id: data.messageId },
      data: { currentStatus: "ROUTED" },
    });
    await db.messageStatusEvent.create({
      data: {
        messageId: data.messageId, attemptId: attempt.id, status: "ROUTED",
        source: "routing", description: "Message scheduled for connector submission.",
        rawData: { scheduledAt: scheduledAt.toISOString() },
      },
    });
    await db.outboxEvent.create({
      data: {
        eventType: "CONNECTOR_DISPATCH", aggregateType: "MESSAGE_ROUTE_ATTEMPT",
        aggregateId: attempt.id, queueName, availableAt: scheduledAt,
        payload: {
          messageId: data.messageId, attemptId: attempt.id,
          routeId: data.routeId, connectorId: data.connectorId,
        },
      },
    });
    return attempt;
  }

  async createAttemptAndMarkRouted(
    data: { messageId: string; routeId: string; connectorId: string; priority: number },
    queues: DispatchQueues,
  ) {
    return this.transaction(async db => {
      await this.lockMessage(db, data.messageId);
      const repository = new RoutingRepository(db);
      const message = await repository.findMessage(data.messageId);
      if (!message || ["SUBMITTED", "DELIVERED", "EXPIRED"].includes(message.currentStatus)) return null;
      const attempts = await repository.findAttempts(data.messageId);
      const latest = attempts.at(-1);
      if (latest && latest.status !== "FAILED") return null;
      const cycleAttempts = await repository.currentCycleAttempts(data.messageId, attempts);
      if (cycleAttempts.some(attempt => attempt.routeId === data.routeId)) return null;
      const route = await db.route.findUnique({ where: { id: data.routeId }, include: { connector: true } });
      if (!route || route.status !== "ACTIVE" || route.connector.status !== "ACTIVE" ||
          route.clientId !== message.clientId || route.connectorId !== data.connectorId) return null;
      return this.enqueueAttempt(db, {
        ...data, priority: route.priority, attemptNumber: (latest?.attemptNumber ?? 0) + 1,
      }, this.queueFor(route.connector.transport, queues), new Date());
    });
  }

  async processSubmissionResult(result: RoutingResult, policy: RetryPolicy, queues: DispatchQueues) {
    return this.transaction(async db => {
      await this.lockMessage(db, result.messageId);
      const repository = new RoutingRepository(db);
      const attempts = await repository.findAttempts(result.messageId);
      const attempt = attempts.find(item => item.id === result.attemptId);
      if (!attempt || attempt.routeId !== result.routeId || attempt.connectorId !== result.connectorId) {
        throw new Error("Connector result does not match routing attempt.");
      }
      // Serializing on the message protects both result deduplication and retry allocation.
      if (["SUBMITTED", "FAILED", "UNKNOWN"].includes(attempt.status) || attempts.at(-1)?.id !== attempt.id) {
        return { applied: false, nextAttempt: null, decision: "duplicate" };
      }
      const message = await repository.findMessage(result.messageId);
      if (!message || ["SUBMITTED", "DELIVERED", "EXPIRED"].includes(message.currentStatus)) {
        return { applied: false, nextAttempt: null, decision: "ignored" };
      }
      const status = result.status === "DISCONNECTED" ? "FAILED" : result.status;
      if (!["SUBMITTED", "FAILED", "UNKNOWN"].includes(status)) throw new Error(`Invalid routing result status: ${status}`);

      let next: Awaited<ReturnType<typeof repository.findRoutes>>[number] | undefined;
      let scheduledAt = new Date();
      let decision = status === "FAILED" ? "exhausted" : status.toLowerCase();
      let retryNumber: number | undefined;
      let delayMs = 0;
      if (status === "FAILED") {
        const route = await db.route.findUnique({ where: { id: attempt.routeId } });
        if (!route) throw new Error("Routing attempt route no longer exists.");
        const routes = await repository.findRoutes(message.clientId, route.mobileNetworkId);
        const cycleAttempts = await repository.currentCycleAttempts(result.messageId, attempts);
        const previousSubmissions = cycleAttempts.filter(item => item.routeId === attempt.routeId).length;
        const current = routes.find(item => item.id === attempt.routeId);
        if (current && previousSubmissions <= policy.maxRetries) {
          next = current;
          retryNumber = previousSubmissions;
          delayMs = retryDelay(policy, previousSubmissions);
          scheduledAt = new Date(Date.now() + delayMs);
          decision = "retry";
        } else {
          const tried = new Set(cycleAttempts.map(item => item.routeId));
          next = routes.find(item => !tried.has(item.id));
          if (next) decision = "failover";
        }
      }
      await repository.applyAttemptResult({ ...result, status }, !next);
      const nextAttempt = next ? await this.enqueueAttempt(db, {
        messageId: result.messageId, routeId: next.id, connectorId: next.connectorId,
        priority: next.priority, attemptNumber: attempt.attemptNumber + 1,
      }, this.queueFor(next.connector.transport, queues), scheduledAt) : null;
      return { applied: true, nextAttempt, decision, retryNumber, delayMs };
    });
  }
}
