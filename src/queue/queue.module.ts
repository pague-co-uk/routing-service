import {
  Global,
  Module,
} from "@nestjs/common";

import {
  queueProvider,
} from "./queue.provider.js";

import {
  QueueLifecycle,
} from "./queue.lifecycle.js";

@Global()
@Module({
  providers: [
    queueProvider,
    QueueLifecycle,
  ],

  exports: [
    queueProvider,
  ],
})
export class QueueModule { }