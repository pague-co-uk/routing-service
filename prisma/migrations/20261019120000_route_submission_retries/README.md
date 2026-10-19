This incremental migration targets a database matching the current canonical
schema, including the existing `message_route_attempts` table. The checked-in
initial migration predates that table, so the existing migration history alone
does not reproduce the current schema on an empty database. Reconcile that
baseline separately before replaying migrations on a new database.

Existing routing attempts receive `scheduledAt = NULL`. Global uniqueness on
`(messageId, attemptNumber)` remains. The unique `(messageId, routeId)` index is
replaced with a non-unique index so every retry can have its own attempt record.
Per-route submission counts are derived from attempt history, not stored in a
separate counter. Routing must serialize retry decisions per message and create
the next attempt and its dispatch outbox event in the same transaction to avoid
concurrent scheduling from the same history.

Scheduling will use `scheduledAt` together with the dispatch outbox event's
`availableAt`; adding the field does not itself schedule retries.

Deploy the schema migration and regenerate consuming Prisma clients before
enabling retry scheduling. Existing attempt inserts remain compatible because
`scheduledAt` is nullable. Once multiple submissions exist for a route,
restoring the old unique constraint requires reconciling those rows first.
