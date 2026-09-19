ALTER TABLE `readingSessions` ADD `audioStatus` enum('stored','storage_unavailable','storage_rejected','not_captured') DEFAULT 'not_captured' NOT NULL;--> statement-breakpoint
-- Backfill. Until this migration the only writer that could leave audioStorageKey null was
-- the guided `sessions.save` path, which never sends audio at all; `sessions.processAndSave`
-- rejected the whole request when storage failed, so no existing null means "storage broke".
UPDATE `readingSessions` SET `audioStatus` = 'stored' WHERE `audioStorageKey` IS NOT NULL;
