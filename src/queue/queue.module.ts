import {
  Global,
  Module,
} from "@nestjs/common";

import {
  queueProvider,
} from "./queue.provider.js";

import { ConfigModule } from "@nestjs/config";
import {
  QUEUE_CLIENT,
} from "./constants/queue.constants.js";
import { AppConfigService } from "../config/config.service.js";

@Global()
@Module({
  providers: [
    queueProvider,AppConfigService
  ],

  exports: [
    QUEUE_CLIENT
  ],
  imports: [ConfigModule]
})
export class QueueModule { }