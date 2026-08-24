import {
  Global,
  Module,
} from "@nestjs/common";

import {
  ConfigModule as NestConfigModule,
} from "@nestjs/config";

import configuration from "./configuration.js";
import {
  configValidationSchema,
} from "./config.validation.js";
import {
  AppConfigService,
} from "./config.service.js";

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,

      load: [
        configuration,
      ],

      validationSchema:
        configValidationSchema,

      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
  ],

  providers: [
    AppConfigService,
  ],

  exports: [
    AppConfigService,
  ],
})
export class ConfigModule {}