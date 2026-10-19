-- Support stable created-date ordering/filtering for platform and client lists.
CREATE INDEX `messages_createdAt_id_idx` ON `messages`(`createdAt`, `id`);
CREATE INDEX `messages_clientId_createdAt_id_idx` ON `messages`(`clientId`, `createdAt`, `id`);
