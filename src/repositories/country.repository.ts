import {
  Inject,
  Injectable,
} from "@nestjs/common";

import { DATABASE } from "../database/database.constants.js";

import {
  Database,
  DatabaseRepository,
} from "../database/database.repository.js";

@Injectable()
export class CountryRepository
  extends DatabaseRepository {
  constructor(
    @Inject(DATABASE)
    db: Database,
  ) {
    super(db);
  }

  // =========================================================================
  // Country
  // =========================================================================

  async findById(
    id: string,
  ) {
    return this.db.country.findUnique({
      where: {
        id,
      },
    });
  }

  async findByCode(
    code: string,
  ) {
    return this.db.country.findUnique({
      where: {
        code,
      },
    });
  }

  // =========================================================================
  // Country Calling Code
  // =========================================================================

  async findCountryForDestination(
    destination: string,
  ) {
    /*
     * Calling codes vary in length and some are shared by multiple
     * countries/geographical areas.
     *
     * We therefore resolve the longest matching calling code rather than
     * assuming that the first few digits uniquely identify a country.
     */

    const callingCodes =
      await this.db.countryCallingCode.findMany({
        include: {
          country: true,
        },
      });

    const matches =
      callingCodes
        .filter(
          (entry) =>
            destination.startsWith(
              entry.callingCode,
            ),
        )
        .sort(
          (a, b) =>
            b.callingCode.length -
            a.callingCode.length,
        );

    if (
      matches.length === 0
    ) {
      return null;
    }

    return matches[0].country;
  }
}