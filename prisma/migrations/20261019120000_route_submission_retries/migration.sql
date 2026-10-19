-- Existing attempts retain their timestamps and receive no scheduled time.
ALTER TABLE `message_route_attempts`
    ADD COLUMN `scheduledAt` DATETIME(3) NULL;

-- Create the replacement index before dropping the old one so the messageId
-- foreign key retains a supporting index throughout the migration.
-- A non-unique composite index supports counting attempts for a message/route.
CREATE INDEX `message_route_attempts_messageId_routeId_idx`
    ON `message_route_attempts`(`messageId`, `routeId`);

-- The historical table-creation migration did not create this unique index,
-- but some databases acquired it from a later schema synchronization. Drop it
-- only when present so both shadow replay and existing databases are supported.
SET @pague_drop_route_unique = (
    SELECT IF(COUNT(*) > 0,
        'DROP INDEX `message_route_attempts_messageId_routeId_key` ON `message_route_attempts`',
        'SELECT 1')
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'message_route_attempts'
      AND index_name = 'message_route_attempts_messageId_routeId_key'
);
PREPARE pague_drop_route_unique_statement FROM @pague_drop_route_unique;
EXECUTE pague_drop_route_unique_statement;
DEALLOCATE PREPARE pague_drop_route_unique_statement;
