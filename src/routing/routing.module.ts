import {
  Module,
} from "@nestjs/common";

import {
  RoutingRepository,
} from "../repositories/routing.repository.js";

import { ConnectorDispatchPublisher } from "./connector-dispatch.publisher.js";
import { RoutingConsumer } from "./routing.consumer.js";
import {
  RoutingService,
} from "./routing.service.js";
import { RoutingResultConsumer } from "./routing-result.consumer.js";

@Module({
  providers: [
    RoutingRepository,
    RoutingService,
    ConnectorDispatchPublisher,
    RoutingConsumer,
    RoutingResultConsumer
  ],

  exports: [
    RoutingService,
  ],
})
export class RoutingModule { }