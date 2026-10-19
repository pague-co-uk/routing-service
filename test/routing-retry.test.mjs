import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { RoutingRepository } from '../dist/repositories/routing.repository.js';
import { retryDelay } from '../dist/routing/retry/retry-policy.js';
import { configValidationSchema } from '../dist/config/config.validation.js';

const policy = { maxRetries: 3, initialDelayMs: 1000, multiplier: 2, maxDelayMs: 30000 };
const queues = { httpQueue: 'http', smppQueue: 'smpp' };
const route = (id, transport = 'HTTP', priority = 1) => ({
  id, clientId: 'client', mobileNetworkId: 'network', connectorId: `connector-${id}`,
  status: 'ACTIVE', priority, connector: { status: 'ACTIVE', transport },
});
const attempt = (number, routeId = 'a', status = 'PENDING') => ({
  id: `attempt-${number}`, messageId: 'message', routeId, connectorId: `connector-${routeId}`,
  attemptNumber: number, status, priority: 1,
});
const result = (row, status = 'FAILED') => ({
  messageId: row.messageId, attemptId: row.id, routeId: row.routeId,
  connectorId: row.connectorId, status, errorCode: 'REJECTED', errorMessage: 'Provider rejected submission',
});

// In-memory transactional adapter exercises repository decisions and rollback.
// Database locking/isolation must additionally be checked against MySQL before deployment.
function fixture({ attempts = [attempt(1)], routes = [route('a'), route('b', 'SMPP', 2)], messageStatus = 'ROUTED', events = [] } = {}) {
  let state = { attempts, routes, message: { id: 'message', clientId: 'client', currentStatus: messageStatus }, events, outbox: [] };
  let failOutbox = false;
  let locks = 0;
  const db = Object.create(PrismaClient.prototype);
  let pending = Promise.resolve();
  db.$transaction = callback => {
    const execute = async () => {
      const draft = structuredClone(state);
      const tx = {
        $queryRaw: async () => { locks++; return [{ id: 'message' }]; },
        message: {
          findUnique: async () => draft.message,
          update: async ({ data }) => Object.assign(draft.message, data),
        },
        messageRouteAttempt: {
          findMany: async () => draft.attempts,
          findFirst: async () => draft.attempts.at(-1) ?? null,
          findUnique: async ({ where }) => draft.attempts.find(row => row.id === where.id),
          update: async ({ where, data }) => Object.assign(draft.attempts.find(row => row.id === where.id), data),
          create: async ({ data }) => {
            assert.ok(!draft.attempts.some(row => row.attemptNumber === data.attemptNumber));
            const row = { id: `attempt-${data.attemptNumber}`, ...data };
            draft.attempts.push(row);
            return row;
          },
        },
        route: {
          findUnique: async ({ where }) => draft.routes.find(row => row.id === where.id),
          findMany: async () => draft.routes.filter(row => row.status === 'ACTIVE' && row.connector.status === 'ACTIVE'),
        },
        messageStatusEvent: {
          findFirst: async () => draft.events.filter(row => row.source === 'manual-retry' && row.status === 'QUEUED').at(-1) ?? null,
          create: async ({ data }) => { draft.events.push(data); return data; } },
        outboxEvent: { create: async ({ data }) => {
          if (failOutbox) throw new Error('Outbox unavailable');
          draft.outbox.push(data); return data;
        } },
      };
      const output = await callback(tx);
      state = draft;
      return output;
    };
    const operation = pending.then(execute);
    pending = operation.catch(() => {});
    return operation;
  };
  return {
    repository: new RoutingRepository(db),
    state: () => state,
    failOutbox: () => { failOutbox = true; },
    locks: () => locks,
  };
}

test('three same-route retries with exponential delays, then SMPP failover', async () => {
  const f = fixture();
  for (let retry = 1; retry <= 3; retry++) {
    const before = Date.now();
    const current = f.state().attempts.at(-1);
    const output = await f.repository.processSubmissionResult(result(current), policy, queues);
    assert.equal(output.nextAttempt.routeId, 'a');
    assert.equal(output.nextAttempt.attemptNumber, retry + 1);
    const event = f.state().outbox.at(-1);
    assert.equal(event.queueName, 'http');
    assert.equal(event.payload.attemptId, output.nextAttempt.id);
    assert.equal(+event.availableAt, +output.nextAttempt.scheduledAt);
    assert.ok(+event.availableAt >= before + 1000 * 2 ** (retry - 1));
    assert.equal(f.state().message.currentStatus, 'ROUTED');
    assert.ok(current);
  }
  const output = await f.repository.processSubmissionResult(result(f.state().attempts.at(-1)), policy, queues);
  assert.equal(output.nextAttempt.routeId, 'b');
  assert.equal(f.state().outbox.at(-1).queueName, 'smpp');
  assert.equal(f.state().attempts.filter(row => row.routeId === 'a').length, 4);
  assert.equal(f.state().events.some(row => row.status === 'FAILED'), false);
});

test('duplicate concurrent results allocate only one next attempt', async () => {
  const f = fixture();
  const input = result(f.state().attempts[0]);
  const outputs = await Promise.all([
    f.repository.processSubmissionResult(input, policy, queues),
    f.repository.processSubmissionResult(input, policy, queues),
  ]);
  assert.equal(outputs.filter(row => row.applied).length, 1);
  assert.equal(f.state().attempts.length, 2);
  assert.equal(f.state().outbox.length, 1);
  assert.equal(f.locks(), 2);
});

test('outbox failure rolls back result and attempt creation', async () => {
  const f = fixture(); f.failOutbox();
  await assert.rejects(f.repository.processSubmissionResult(result(f.state().attempts[0]), policy, queues), /Outbox unavailable/);
  assert.equal(f.state().attempts.length, 1);
  assert.equal(f.state().attempts[0].status, 'PENDING');
  assert.equal(f.state().events.length, 0);
});

test('SUBMITTED and UNKNOWN schedule no further submissions', async () => {
  for (const status of ['SUBMITTED', 'UNKNOWN']) {
    const f = fixture();
    await f.repository.processSubmissionResult({ ...result(f.state().attempts[0], status), providerMessageId: 'provider-1' }, policy, queues);
    assert.equal(f.state().outbox.length, 0);
    assert.equal(f.state().attempts[0].status, status);
    assert.equal(f.state().message.currentStatus, status === 'SUBMITTED' ? 'SUBMITTED' : 'ROUTED');
  }
});

test('disabled retries fail over immediately, exhaustion marks message failed', async () => {
  const f = fixture();
  await f.repository.processSubmissionResult(result(f.state().attempts[0]), { ...policy, maxRetries: 0 }, queues);
  assert.equal(f.state().attempts.at(-1).routeId, 'b');
  await f.repository.processSubmissionResult(result(f.state().attempts.at(-1)), { ...policy, maxRetries: 0 }, queues);
  assert.equal(f.state().attempts.length, 2);
  assert.equal(f.state().message.currentStatus, 'FAILED');
  assert.equal(f.state().events.at(-1).status, 'FAILED');
});

test('disconnected HTTP outcome enters the shared failure policy', async () => {
  const f = fixture();
  await f.repository.processSubmissionResult(result(f.state().attempts[0], 'DISCONNECTED'), policy, queues);
  assert.equal(f.state().attempts[0].status, 'FAILED');
  assert.equal(f.state().attempts.at(-1).routeId, 'a');
});

test('inactive route fails over and finalized messages cannot be retried', async () => {
  const inactive = { ...route('a'), status: 'INACTIVE' };
  const f = fixture({ routes: [inactive, route('b', 'SMPP')] });
  await f.repository.processSubmissionResult(result(f.state().attempts[0]), policy, queues);
  assert.equal(f.state().attempts.at(-1).routeId, 'b');
  for (const status of ['EXPIRED', 'DELIVERED', 'SUBMITTED']) {
    const f = fixture({ messageStatus: status });
    await f.repository.processSubmissionResult(result(f.state().attempts[0]), policy, queues);
    assert.equal(f.state().outbox.length, 0);
  }
});

test('retry count comes from current-route history, not global attempt number', async () => {
  const f = fixture({ attempts: [attempt(1, 'b', 'FAILED'), attempt(2, 'a')] });
  const before = Date.now();
  await f.repository.processSubmissionResult(result(f.state().attempts.at(-1)), policy, queues);
  assert.ok(+f.state().outbox[0].availableAt < before + 2000);
  assert.equal(f.state().attempts.at(-1).attemptNumber, 3);
});

test('initial dispatch is persisted atomically and repeated routing is ignored', async () => {
  const f = fixture({ attempts: [], messageStatus: 'QUEUED' });
  const data = { messageId: 'message', routeId: 'a', connectorId: 'connector-a', priority: 1 };
  const first = await f.repository.createAttemptAndMarkRouted(data, queues);
  assert.equal(first.attemptNumber, 1);
  assert.equal(f.state().outbox.length, 1);
  assert.equal(await f.repository.createAttemptAndMarkRouted(data, queues), null);
  const g = fixture({ attempts: [] }); g.failOutbox();
  await assert.rejects(g.repository.createAttemptAndMarkRouted(data, queues), /Outbox unavailable/);
  assert.equal(g.state().attempts.length, 0);
});

test('invalid identities and non-terminal result statuses are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.repository.processSubmissionResult({ ...result(f.state().attempts[0]), routeId: 'wrong' }, policy, queues));
  await assert.rejects(f.repository.processSubmissionResult(result(f.state().attempts[0], 'PENDING'), policy, queues));
  assert.equal(f.state().outbox.length, 0);
});

test('exponential delay caps and policy validation', () => {
  assert.equal(retryDelay(policy, 1), 1000);
  assert.equal(retryDelay({ ...policy, multiplier: 3 }, 3), 9000);
  assert.equal(retryDelay(policy, 20), 30000);
  const base = { DATABASE_URL: 'mysql://test', RABBITMQ_URL: 'amqp://test', ROUTING_CONSUMER_QUEUE: 'queued', ROUTING_RESULT_QUEUE: 'results', ROUTING_HTTP_QUEUE: 'http', ROUTING_SMPP_QUEUE: 'smpp' };
  const retryError = input => configValidationSchema.validate({ ...base, ...input }, { allowUnknown: true }).error?.details.some(item => item.path[0].startsWith('ROUTING_RETRY'));
  assert.equal(retryError({}), undefined);
  for (const input of [
    { ROUTING_RETRY_MAX_RETRIES: -1 }, { ROUTING_RETRY_MAX_RETRIES: 1.5 },
    { ROUTING_RETRY_MULTIPLIER: 1 }, { ROUTING_RETRY_INITIAL_DELAY_MS: 0 },
    { ROUTING_RETRY_MAX_DELAY_MS: 500 },
  ]) assert.equal(retryError(input), true);
});

test('manual retry starts a fresh cycle without deleting history or reusing attempt IDs', async () => {
  const attempts = [attempt(1, 'a', 'FAILED'), attempt(2, 'a', 'FAILED'), attempt(3, 'b', 'FAILED')];
  const f = fixture({ attempts, messageStatus: 'QUEUED', events: [{ source: 'manual-retry', status: 'QUEUED', attemptId: 'attempt-3' }] });
  const data = { messageId: 'message', routeId: 'a', connectorId: 'connector-a', priority: 1 };
  const first = await f.repository.createAttemptAndMarkRouted(data, queues);
  assert.equal(first.attemptNumber, 4);
  assert.equal(f.state().attempts.length, 4);
  const before = Date.now();
  await f.repository.processSubmissionResult(result(first), policy, queues);
  assert.equal(f.state().attempts.at(-1).routeId, 'a');
  assert.equal(f.state().attempts.at(-1).attemptNumber, 5);
  assert.ok(+f.state().outbox.at(-1).availableAt < before + 2000);
  assert.equal(await f.repository.createAttemptAndMarkRouted(data, queues), null);
  assert.equal((await f.repository.processSubmissionResult(result(attempts[2]), policy, queues)).applied, false);
});
test('stale routing failure cannot overwrite a newly queued manual retry', async () => {
  const f = fixture({ attempts: [attempt(1, 'a', 'FAILED')], messageStatus: 'QUEUED' });
  f.state().message.updatedAt = new Date('2026-10-19T12:00:01Z');
  assert.equal(await f.repository.markMessageFailed('message', new Date('2026-10-19T12:00:00Z')), null);
  assert.equal(f.state().message.currentStatus, 'QUEUED');
});

test('logs distinguish exponential retries, failover, exhaustion and duplicate results', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const { default: ts } = await import('typescript');
  const logs = [];
  const logger = { info: (fields, message) => logs.push({ ...fields, message }), error() {}, warn() {}, debug() {} };
  const compiled = ts.transpileModule(fs.readFileSync('src/routing/routing.service.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const context = { exports: {}, require: name => {
    if (name === '@nestjs/common') return { Injectable: () => target => target };
    if (name === '@prisma/client') return { MessageRouteAttemptStatus: { FAILED: 'FAILED' } };
    if (name === '@pague-co-uk/sms-gateway-telemetry') return {
      getComponentLogger: () => logger, recordException() {},
      withSpan: async (_name, callback) => callback({ setAttribute() {}, setAttributes() {} }),
    };
    return {};
  } };
  vm.runInNewContext(compiled, context);
  const f = fixture();
  const service = new context.exports.RoutingService({
    findAttempt: async id => f.state().attempts.find(row => row.id === id),
    processSubmissionResult: (...args) => f.repository.processSubmissionResult(...args),
  }, {}, { retryPolicy: policy, routing: queues }, {});
  for (let submission = 1; submission <= 8; submission++) {
    await service.processResult(result(f.state().attempts.at(-1)));
  }
  const decisions = logs.filter(row => row.event?.startsWith('routing.submission.'));
  assert.deepEqual(decisions.map(row => row.event), [
    'routing.submission.retry', 'routing.submission.retry', 'routing.submission.retry',
    'routing.submission.failover', 'routing.submission.retry', 'routing.submission.retry',
    'routing.submission.retry', 'routing.submission.exhausted',
  ]);
  assert.deepEqual(decisions.slice(0, 3).map(row => row.delayMs), [1000, 2000, 4000]);
  assert.deepEqual(decisions.slice(0, 3).map(row => row.retryNumber), [1, 2, 3]);
  assert.ok(decisions.every(row => row.messageId === 'message'));
  assert.ok(decisions.slice(0, 3).every(row => row.nextAttemptId && row.scheduledAt && row.maxRetries === 3));
  await service.processResult(result(f.state().attempts.at(-1)));
  assert.equal(logs.at(-1).event, 'routing.submission.duplicate');
  fs.writeFileSync('/tmp/pague-retry-log-test.json', JSON.stringify(decisions, null, 2));
});
