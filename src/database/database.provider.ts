import {
  Provider,
} from "@nestjs/common";

import {
  PrismaClient,
} from "@prisma/client";

import {
  DATABASE,
} from "./database.constants.js";

import {
  AppConfigService,
} from "../config/config.service.js";

export const databaseProvider:
  Provider = {
  provide: DATABASE,

  inject: [
    AppConfigService,
  ],

  useFactory: async (
    config: AppConfigService,
  ): Promise<PrismaClient> => {
    const client =
      new PrismaClient({
        datasources: {
          db: {
            url:
              config.databaseUrl,
          },
        },
      });

    await client.$connect();

    return client;
  },
};