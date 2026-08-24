import {
  Global,
  Module,
} from "@nestjs/common";

import {
  DATABASE,
} from "./database.constants.js";

import { ConfigModule } from "@nestjs/config";
import {
  databaseProvider,
} from "./database.provider.js";
import { AppConfigService } from "../config/config.service.js";

@Global()
@Module({
  providers: [
    databaseProvider, AppConfigService
  ],
  imports: [ConfigModule],
  exports: [
    DATABASE,
  ],
})
export class DatabaseModule { }