import {
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type Database =
  | PrismaClient
  | Prisma.TransactionClient;

export abstract class DatabaseRepository {
  protected constructor(
    protected readonly db: Database,
  ) { }

  protected async transaction<
    T,
  >(
    callback: (
      db: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    if (
      this.db instanceof PrismaClient
    ) {
      return this.db.$transaction(
        callback,
      );
    }

    return callback(this.db);
  }
}