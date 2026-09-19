-- Adds "discarded_by_policy" in reading order rather than at the end of the list. MySQL stores
-- an ENUM as an index into its value list, so inserting a member mid-list shifts the indexes of
-- the members after it and forces a table copy instead of an in-place add. The copy converts by
-- string, not by index, so the stored values are preserved; this was verified on MySQL 8.0.46
-- against a table holding one row of each existing status before the change.
ALTER TABLE `readingSessions` MODIFY COLUMN `audioStatus` enum('stored','discarded_by_policy','storage_unavailable','storage_rejected','not_captured') NOT NULL DEFAULT 'not_captured';