import {
  Injectable,
} from "@nestjs/common";

import {
  getComponentLogger,
  recordException,
  withSpan,
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  RoutingRepository,
} from "../repositories/routing.repository.js";

import {
  ConnectorDispatchPublisher,
} from "./connector-dispatch.publisher.js";

import type {
  RoutingMessage,
} from "./types/routing-message.js";

import {
  MessageRouteAttemptStatus,
} from "@prisma/client";
import { RoutingResult } from "./types/routing-result.js";

@Injectable()
export class RoutingService {
  private readonly logger =
    getComponentLogger(
      RoutingService.name,
    );

  constructor(
    private readonly repository:
      RoutingRepository,

    private readonly dispatch:
      ConnectorDispatchPublisher,
  ) { }

  // =========================================================================
  // Routing
  // =========================================================================

  async route(
    message: RoutingMessage,
  ): Promise<void> {
    await withSpan(
      "RoutingService.route",
      async (span) => {
        try {
          span.setAttribute(
            "message.id",
            message.messageId,
          );

          // =================================================================
          // Retrieve message
          // =================================================================

          const sms =
            await this.repository.findMessage(
              message.messageId,
            );

          if (!sms) {
            this.logger.error(
              {
                messageId:
                  message.messageId,
              },
              "Message not found.",
            );

            return;
          }

          span.setAttributes({
            "message.client_id":
              sms.clientId,

            "message.destination":
              sms.destination,
          });

          // =================================================================
          // Resolve destination MNO
          // =================================================================

          const network =
            await this.repository
              .findMobileNetworkForDestination(
                sms.destination,
              );

          if (!network) {
            await this.repository
              .markMessageFailed(
                sms.id,
              );

            this.logger.error(
              {
                messageId:
                  sms.id,

                destination:
                  sms.destination,
              },
              "Unable to determine mobile network for message.",
            );

            return;
          }

          span.setAttribute(
            "routing.mobile_network_id",
            network.mobileNetworkId,
          );

          // =================================================================
          // Retrieve ordered routes
          // =================================================================

          const routes =
            await this.repository.findRoutes(
              sms.clientId,
              network.mobileNetworkId,
            );

          if (
            routes.length === 0
          ) {
            await this.repository
              .markMessageFailed(
                sms.id,
              );

            this.logger.error(
              {
                messageId:
                  sms.id,

                clientId:
                  sms.clientId,

                mobileNetworkId:
                  network.mobileNetworkId,
              },
              "No active routes available for message.",
            );

            return;
          }

          // =================================================================
          // Inspect previous routing attempts
          // =================================================================

          const attempts =
            await this.repository.findAttempts(
              sms.id,
            );

          /*
           * Always determine the latest attempt by attemptNumber rather
           * than relying on the database result ordering.
           */
          const latestAttempt =
            attempts.reduce<
              typeof attempts[number] | undefined
            >(
              (
                latest,
                current,
              ) => {
                if (!latest) {
                  return current;
                }

                return current.attemptNumber >
                  latest.attemptNumber
                  ? current
                  : latest;
              },
              undefined,
            );

          // =================================================================
          // Protect against duplicate routing
          // =================================================================

          if (latestAttempt) {
            /*
             * A route is only eligible for failover after the previous
             * attempt has definitively FAILED.
             *
             * In particular, UNKNOWN must NOT fail over automatically.
             *
             * UNKNOWN means we cannot establish whether the provider
             * accepted the message. Sending the same SMS through another
             * provider could therefore create a duplicate delivery.
             */
            if (
              latestAttempt.status !==
              MessageRouteAttemptStatus.FAILED
            ) {
              span.setAttributes({
                "routing.attempt_id":
                  latestAttempt.id,

                "routing.attempt":
                  latestAttempt.attemptNumber,

                "routing.route_id":
                  latestAttempt.routeId,

                "routing.attempt_status":
                  latestAttempt.status,
              });

              this.logger.debug(
                {
                  messageId:
                    sms.id,

                  attemptId:
                    latestAttempt.id,

                  routeId:
                    latestAttempt.routeId,

                  connectorId:
                    latestAttempt.connectorId,

                  attemptNumber:
                    latestAttempt.attemptNumber,

                  status:
                    latestAttempt.status,
                },
                "Message already has an active or uncertain routing attempt. Waiting for its outcome.",
              );

              return;
            }

            this.logger.info(
              {
                messageId:
                  sms.id,

                attemptId:
                  latestAttempt.id,

                routeId:
                  latestAttempt.routeId,

                connectorId:
                  latestAttempt.connectorId,

                attemptNumber:
                  latestAttempt.attemptNumber,

                status:
                  latestAttempt.status,
              },
              "Previous routing attempt failed. Evaluating next route.",
            );
          }

          // =================================================================
          // Determine previously attempted routes
          // =================================================================

          const attemptedRouteIds =
            new Set(
              attempts.map(
                (attempt) =>
                  attempt.routeId,
              ),
            );

          /*
           * Routes are already returned in priority order by the repository.
           *
           * Select the first active route that has never been attempted.
           *
           * This means:
           *
           * Route 1 FAILED
           * Route 2 not attempted
           * Route 3 not attempted
           *
           * => Route 2
           */
          const route =
            routes.find(
              (candidate) =>
                !attemptedRouteIds.has(
                  candidate.id,
                ),
            );

          // =================================================================
          // All routes exhausted
          // =================================================================

          if (!route) {
            await this.repository
              .markMessageFailed(
                sms.id,
              );

            this.logger.error(
              {
                messageId:
                  sms.id,

                clientId:
                  sms.clientId,

                mobileNetworkId:
                  network.mobileNetworkId,

                attemptedRoutes:
                  attempts.length,
              },
              "All routes exhausted for message.",
            );

            return;
          }

          const attemptNumber =
            attempts.length + 1;

          // =================================================================
          // Create routing attempt
          // =================================================================

          /*
           * This operation must be atomic in the repository:
           *
           * 1. Create MessageRouteAttempt
           * 2. Move Message to ROUTED
           *
           * The unique constraint on:
           *
           *   [messageId, attemptNumber]
           *
           * provides an additional database-level guard against duplicate
           * attempt numbers.
           */
          const attempt =
            await this.repository
              .createAttemptAndMarkRouted({
                messageId:
                  sms.id,

                routeId:
                  route.id,

                connectorId:
                  route.connectorId,

                attemptNumber,

                priority:
                  route.priority,
              });

          span.setAttributes({
            "routing.attempt_id":
              attempt.id,

            "routing.route_id":
              route.id,

            "routing.connector_id":
              route.connectorId,

            "routing.priority":
              route.priority,

            "routing.attempt":
              attemptNumber,
          });

          // =================================================================
          // Dispatch to connector
          // =================================================================

          await this.dispatch.publish(
            {
              messageId:
                sms.id,

              attemptId:
                attempt.id,

              routeId:
                route.id,

              connectorId:
                route.connectorId,
            },

            route.connector.code,
          );

          // =================================================================
          // Success
          // =================================================================

          this.logger.info(
            {
              messageId:
                sms.id,

              attemptId:
                attempt.id,

              routeId:
                route.id,

              connectorId:
                route.connectorId,

              connector:
                route.connector.code,

              priority:
                route.priority,

              attemptNumber,
            },
            "Message routed to connector.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              messageId:
                message.messageId,

              err:
                error,
            },
            "Message routing failed.",
          );

          throw error;
        }
      },
    );
  }

  async processResult(
    result: RoutingResult,
  ): Promise<void> {
    await withSpan(
      "RoutingService.processResult",
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
        });

        this.logger.info(
          {
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
          "Processing connector result.",
        );

        const attempt =
          await this.repository.findAttempt(
            result.attemptId,
          );

        if (!attempt) {
          this.logger.error(
            {
              messageId:
                result.messageId,

              attemptId:
                result.attemptId,
            },
            "Routing attempt not found for connector result.",
          );

          return;
        }

        /*
         * The connector result must belong to the exact attempt
         * that Routing Service created.
         */
        if (
          attempt.messageId !==
          result.messageId ||
          attempt.routeId !==
          result.routeId ||
          attempt.connectorId !==
          result.connectorId
        ) {
          this.logger.error(
            {
              messageId:
                result.messageId,

              attemptId:
                result.attemptId,

              expectedRouteId:
                attempt.routeId,

              receivedRouteId:
                result.routeId,

              expectedConnectorId:
                attempt.connectorId,

              receivedConnectorId:
                result.connectorId,
            },
            "Connector result does not match routing attempt.",
          );

          return;
        }

        const outcome =
          await this.repository.applyAttemptResult(
            result,
          );

        if (!outcome.attempt) {
          return;
        }

        /*
         * Duplicate result.
         *
         * Most importantly, do NOT call route() again.
         */
        if (!outcome.applied) {
          this.logger.debug(
            {
              messageId:
                result.messageId,

              attemptId:
                result.attemptId,

              existingStatus:
                outcome.attempt.status,

              resultStatus:
                result.status,
            },
            "Ignoring duplicate connector result for finalized routing attempt.",
          );

          return;
        }

        this.logger.info(
          {
            messageId:
              result.messageId,

            attemptId:
              result.attemptId,

            status:
              result.status,

            providerMessageId:
              result.providerMessageId,
          },
          "Connector result applied to routing attempt.",
        );

        /*
         * Only a definitive FAILED result can trigger failover.
         *
         * SUBMITTED:
         *   Provider accepted the message.
         *
         * UNKNOWN:
         *   We cannot determine whether the provider accepted it.
         *
         * FAILED:
         *   Provider definitively rejected/failed the attempt.
         */
        if (
          result.status !==
          MessageRouteAttemptStatus.FAILED
        ) {
          return;
        }

        this.logger.warn(
          {
            messageId:
              result.messageId,

            attemptId:
              result.attemptId,
          },
          "Routing attempt failed. Evaluating next route.",
        );

        await this.route({
          messageId:
            result.messageId,
        });
      },
    );
  }
}