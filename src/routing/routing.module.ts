import {
  Module,
} from "@nestjs/common";

import {
  RoutingRepository,
} from "../repositories/routing.repository.js";

import {
  ConnectorDispatchPublisher,
} from "./connector-dispatch.publisher.js";

import {
  RoutingConsumer,
} from "./routing.consumer.js";

import {
  RoutingDeliveryReceiptConsumer,
} from "./routing-delivery-receipt.consumer.js";

import {
  RoutingService,
} from "./routing.service.js";

import { ClientDlrPublisher } from "./client-dlr-event.publisher.js";
import {
  RoutingResultConsumer,
} from "./routing-result.consumer.js";

@Module({
  providers: [
    RoutingRepository,
    RoutingService,
    ConnectorDispatchPublisher,
    RoutingConsumer,
    RoutingResultConsumer,
    RoutingDeliveryReceiptConsumer,
    ClientDlrPublisher
  ],

  exports: [
    RoutingService,
  ],
})
export class RoutingModule { }