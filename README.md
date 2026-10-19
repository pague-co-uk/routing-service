<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
# routing-service

## Submission retries and durable dispatch

Routing owns same-route retries for both HTTP and SMPP. Connector clients continue
making one submission per dispatch and returning its outcome. `FAILED` (including
HTTP `DISCONNECTED`, normalized by routing) retries the current active route before
falling back to the next eligible route. `SUBMITTED` and `UNKNOWN` do not retry.
Delivery-receipt failures do not enter the submission retry policy.

Configure the routing-service environment:

```dotenv
ROUTING_RETRY_MAX_RETRIES=3
ROUTING_RETRY_INITIAL_DELAY_MS=1000
ROUTING_RETRY_MULTIPLIER=2
ROUTING_RETRY_MAX_DELAY_MS=30000
```

`maxRetries` counts retries after the initial submission; zero disables retries.
It accepts integers from 0 through 100. Delays grow as
`min(maxDelayMs, initialDelayMs * multiplier^(previousSubmissions - 1))`.
The multiplier must exceed 1. Delays must be positive integer milliseconds and the
maximum must be at least the initial delay. These defaults give 1s, 2s, and 4s.
This step implements service-wide policy; per-route policy overrides are deferred.

Each planned dispatch creates its own `MessageRouteAttempt`. The retry budget is
calculated from that message's history on the selected route, not a stored counter.
A message row lock serializes result handling and attempt allocation. Result
application, the next attempt, and its outbox event commit in one transaction.
Initial dispatch also uses this transaction/outbox pattern. A duplicate result
cannot create another retry. An inactive route/connector is skipped at scheduling
time. Already submitted, delivered, or expired messages are not scheduled again.
There is no message expiry timestamp in the current schema; this checks the
existing `EXPIRED` state rather than implementing a new expiry mechanism.

The message stays `ROUTED` while another submission is scheduled, and becomes
`FAILED` only when no eligible route remains. Earlier attempt failures remain in
history; their event details identify the failed attempt without marking the
whole message failed prematurely.

The existing outbox publisher must be running. Its `availableAt` check delivers
dispatches when due, subject to the polling interval. Its broker-publication retry
budget is independent of the submission retry budget. Outbox delivery and queue
redelivery remain at least once: these changes prevent duplicate scheduling from
results, but do not guarantee exactly-once submission to external providers.

### Database package prerequisite

The canonical schema and retry migration come from `sms-gateway-db`. The local
Prisma assets in this checkout were synchronized using that package's CLI:

```sh
node ../sms-gateway-db/bin/pague-db.js sync
npm exec --no -- prisma generate
```

For deployment, release and install the updated database package, synchronize its
Prisma assets, apply the reviewed migration, and regenerate clients before running
this version. The existing installed dependency version does not yet contain the
unreleased schema changes. No database migration was applied during development.
The package migration notes describe the existing incomplete migration baseline.

### Verification

```sh
npm run test:retry
```

The focused tests exercise real repository methods with a transactional in-memory
adapter, covering retry budgets, exponential delays, failover, deduplication,
outbox rollback, and message statuses. MySQL row-lock behavior and migration
execution still require integration validation against a migrated test database.

### Manual retry cycles

The API's failed-message retry endpoint queues the existing message again and
writes a `manual-retry` status event linked to its latest failed attempt. Routing
uses that audit boundary to start route selection and automatic retry counting
from a fresh cycle while preserving globally numbered attempts from every cycle.
Neither HTTP nor SMPP consumers change. Deploy the API and routing-service changes
together: an older routing-service excludes previously tried routes and cannot
restart exhausted messages correctly.
