import {
  Injectable,
} from "@nestjs/common";

import {
  getComponentLogger,
  recordException,
  withSpan,
} from "@pague-co-uk/sms-gateway-telemetry";

import {
  MessageRouteAttemptStatus,
} from "@prisma/client";

import {
  CountryRepository,
} from "../repositories/country.repository.js";

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
  ClientDlrPublisher,
} from "./client-dlr-event.publisher.js";

import type {
  RoutingResult,
} from "./types/routing-result.js";

import {
  SmppDeliveryReceipt,
} from "./types/smpp-delivery-receipt.js";

@Injectable()
export class RoutingService {
  private readonly logger =
    getComponentLogger(
      RoutingService.name,
    );

  constructor(
    private readonly repository:
      RoutingRepository,

    private readonly countryRepository:
      CountryRepository,

    private readonly dispatch:
      ConnectorDispatchPublisher,

    private readonly clientDlrPublisher:
      ClientDlrPublisher,
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

          this.logger.info(
            {
              messageId:
                message.messageId,
            },
            "Starting message routing.",
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

          this.logger.debug(
            {
              messageId:
                sms.id,

              clientId:
                sms.clientId,

              destination:
                sms.destination,
            },
            "Message retrieved for routing.",
          );

          // =================================================================
          // Resolve destination country
          // =================================================================

          this.logger.debug(
            {
              messageId:
                sms.id,

              destination:
                sms.destination,
            },
            "Resolving destination country.",
          );

          const country =
            await this.countryRepository
              .findCountryForDestination(
                sms.destination,
              );

          if (!country) {
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
              "Unable to determine destination country for message.",
            );

            return;
          }

          span.setAttributes({
            "routing.country_id":
              country.id,

            "routing.country_code":
              country.code,
          });

          this.logger.info(
            {
              messageId:
                sms.id,

              destination:
                sms.destination,

              countryId:
                country.id,

              countryCode:
                country.code,

              countryName:
                country.name,
            },
            "Destination country resolved.",
          );

          // =================================================================
          // Resolve destination MNO
          // =================================================================

          /*
           * Mobile-network resolution is performed by the repository using
           * the active networks for the resolved country and their
           * routingRegex configuration.
           *
           * RoutingService intentionally does not perform regex matching
           * itself. The repository returns the uniquely resolved network.
           */

          this.logger.debug(
            {
              messageId:
                sms.id,

              destination:
                sms.destination,

              countryId:
                country.id,

              countryCode:
                country.code,
            },
            "Resolving destination mobile network using routing regex.",
          );

          const network =
            await this.repository
              .findMobileNetworkForDestination(
                sms.destination,
                country.id,
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

                countryId:
                  country.id,

                countryCode:
                  country.code,
              },
              "Unable to determine mobile network from configured routing regex.",
            );

            return;
          }

          /*
           * At this point the repository has successfully resolved a
           * mobile network for the destination.
           *
           * Log the regex that belongs to the selected network so that the
           * routing decision can be correlated directly with the stored
           * numbering allocation configuration.
           */
          span.setAttributes({
            "routing.mobile_network_id":
              network.id,

            "routing.mobile_network_code":
              network.code,

            "routing.mobile_network_name":
              network.name,

            "routing.mobile_network_regex":
              network.routingRegex ??
              "",
          });

          this.logger.info(
            {
              messageId:
                sms.id,

              destination:
                sms.destination,

              countryId:
                country.id,

              countryCode:
                country.code,

              mobileNetworkId:
                network.id,

              mobileNetworkCode:
                network.code,

              mobileNetworkName:
                network.name,

              routingRegex:
                network.routingRegex,
            },
            "Destination mobile network resolved using routing regex.",
          );

          // =================================================================
          // Retrieve ordered routes
          // =================================================================

          const routes =
            await this.repository.findRoutes(
              sms.clientId,
              network.id,
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
                  network.id,

                mobileNetworkCode:
                  network.code,
              },
              "No active routes available for message.",
            );

            return;
          }

          this.logger.debug(
            {
              messageId:
                sms.id,

              clientId:
                sms.clientId,

              mobileNetworkId:
                network.id,

              mobileNetworkCode:
                network.code,

              routeCount:
                routes.length,

              routes:
                routes.map(
                  (candidate) => ({
                    routeId:
                      candidate.id,

                    connectorId:
                      candidate.connectorId,

                    priority:
                      candidate.priority,

                    transport:
                      candidate.connector.transport,
                  }),
                ),
            },
            "Active routes retrieved for resolved mobile network.",
          );

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
                  network.id,

                mobileNetworkCode:
                  network.code,

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

            "routing.transport":
              route.connector.transport,
          });

          // =================================================================
          // Dispatch to connector client
          // =================================================================

          /*
           * Routing Service only decides which transport client should
           * receive the message.
           *
           * The transport determines the queue:
           *
           *   HTTP -> HTTP connector queue
           *   SMPP -> SMPP connector queue
           *
           * The connectorId travels with the message so the receiving
           * client can load the connector and resolve its provider.
           */
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

            route.connector.transport,
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

              transport:
                route.connector.transport,

              priority:
                route.priority,

              attemptNumber,

              mobileNetworkId:
                network.id,

              mobileNetworkCode:
                network.code,
            },
            "Message routed to connector client.",
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

  // =========================================================================
  // Connector Result Processing
  // =========================================================================

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
         *   Provider definitively failed the attempt.
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

  // =========================================================================
  // Delivery Receipt Processing
  // =========================================================================

  async processDeliveryReceipt(
    receipt: SmppDeliveryReceipt,
  ): Promise<void> {
    await withSpan(
      "RoutingService.processDeliveryReceipt",
      async (span) => {
        try {
          span.setAttributes({
            "routing.connector_id":
              receipt.connectorId,

            "routing.provider_message_id":
              receipt.providerMessageId,

            "routing.delivery_status":
              receipt.status,
          });

          this.logger.info(
            {
              connectorId:
                receipt.connectorId,

              providerMessageId:
                receipt.providerMessageId,

              status:
                receipt.status,
            },
            "Processing delivery receipt.",
          );

          const attempt =
            await this.repository
              .findAttemptByProviderMessageId(
                receipt.connectorId,
                receipt.providerMessageId,
              );

          if (!attempt) {
            this.logger.warn(
              {
                connectorId:
                  receipt.connectorId,

                providerMessageId:
                  receipt.providerMessageId,
              },
              "No routing attempt found for delivery receipt.",
            );

            return;
          }

          span.setAttributes({
            "message.id":
              attempt.messageId,

            "routing.attempt_id":
              attempt.id,

            "routing.route_id":
              attempt.routeId,

            "routing.attempt_status":
              attempt.status,
          });

          /*
           * A delivery receipt is only meaningful for a message that the
           * provider previously accepted.
           */
          if (
            attempt.status !==
            MessageRouteAttemptStatus.SUBMITTED
          ) {
            this.logger.debug(
              {
                messageId:
                  attempt.messageId,

                attemptId:
                  attempt.id,

                providerMessageId:
                  receipt.providerMessageId,

                attemptStatus:
                  attempt.status,
              },
              "Ignoring delivery receipt for non-submitted routing attempt.",
            );

            return;
          }

          const outcome =
            await this.repository
              .applyDeliveryReceipt({
                attemptId:
                  attempt.id,

                status:
                  receipt.status,

                errorCode:
                  receipt.errorCode,

                errorMessage:
                  receipt.errorMessage,

                rawData:
                  receipt.rawData,
              });

          if (!outcome.attempt) {
            return;
          }

          // -------------------------------------------------------------------
          // Duplicate delivery receipt
          // -------------------------------------------------------------------

          /*
           * applyDeliveryReceipt() is the authoritative idempotency check.
           *
           * Do not publish another client DLR when the database rejected
           * this receipt because it had already been processed.
           */
          if (!outcome.applied) {
            this.logger.debug(
              {
                messageId:
                  attempt.messageId,

                attemptId:
                  attempt.id,

                providerMessageId:
                  receipt.providerMessageId,

                status:
                  receipt.status,
              },
              "Ignoring duplicate delivery receipt.",
            );

            return;
          }

          // -------------------------------------------------------------------
          // Publish client DLR
          // -------------------------------------------------------------------

          const clientDlrStatus =
            receipt.status === "DELIVERED"
              ? "SUCCESS"
              : "FAILED";

          await this.clientDlrPublisher.publish({
            messageId:
              attempt.messageId,

            providerMessageId:
              receipt.providerMessageId,

            status:
              clientDlrStatus,
          });

          // -------------------------------------------------------------------
          // Success
          // -------------------------------------------------------------------

          this.logger.info(
            {
              messageId:
                attempt.messageId,

              attemptId:
                attempt.id,

              connectorId:
                receipt.connectorId,

              providerMessageId:
                receipt.providerMessageId,

              status:
                receipt.status,
            },
            "Delivery receipt applied.",
          );
        } catch (error) {
          recordException(error);

          this.logger.error(
            {
              connectorId:
                receipt.connectorId,

              providerMessageId:
                receipt.providerMessageId,

              status:
                receipt.status,

              err:
                error,
            },
            "Delivery receipt processing failed.",
          );

          throw error;
        }
      },
    );
  }
}