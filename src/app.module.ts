import {
  Module,
} from "@nestjs/common";

import {
  ConfigModule,
} from "./config/config.module.js";

import {
  DatabaseModule,
} from "./database/database.module.js";

import {
  QueueModule,
} from "./queue/queue.module.js";

import {
  RoutingModule,
} from "./routing/routing.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    QueueModule,
    RoutingModule,
  ],

  controllers: [],

  providers: [],
})
export class AppModule { }