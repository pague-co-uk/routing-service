import type {
  MessageRouteAttemptStatus,
} from "@prisma/client";

export interface RoutingResult {
  messageId: string;

  attemptId: string;

  routeId: string;

  connectorId: string;

  status:
  MessageRouteAttemptStatus;

  providerMessageId?:
  string;

  errorCode?:
  string;

  errorMessage?:
  string;
}