-- Stage 2: stable session identifiers.
--
-- readingSessions.id and its child rows move from int AUTO_INCREMENT to a 26-character ULID
-- generated where the reading happens (shared/sessionId.ts), so a session knows its own
-- identity before it reaches a server and two capture points cannot collide.
--
-- The generated migration for this change was `MODIFY COLUMN id varchar(26)` on each table,
-- children first. That is unsafe twice over. It alters the child columns while the foreign
-- keys still pin them to an int parent, and — worse — if it completes, MySQL coerces int 7
-- to the string '7'. That is a valid varchar(26), the children coerce identically so the
-- foreign keys still agree, and the result is a migration that reports success and leaves
-- every id a decimal string that is not a ULID. Same class of silent, schema-shaped failure
-- as ADD COLUMN ... NOT NULL filling with an implicit default.
--
-- So: add the new columns beside the old, derive real ULIDs from data already in the row,
-- propagate them to the children by join, and only then swap the keys over.
--
-- Existing rows get a genuine ULID, not a placeholder: the 10-character time prefix is the
-- Crockford base32 encoding of the row's own createdAt, so sessionIdTime() on a backfilled id
-- returns when the session was actually saved, and the 16-character suffix encodes the old
-- integer id, so ids stay unique and the old key can still be recovered from an audit log.
--> statement-breakpoint
-- 1. Release the foreign keys so the parent key type can change.
ALTER TABLE `provisionalMatchReviews` DROP FOREIGN KEY `provisionalMatchReviews_sessionId_readingSessions_id_fk`;--> statement-breakpoint
ALTER TABLE `sessionComments` DROP FOREIGN KEY `sessionComments_sessionId_readingSessions_id_fk`;--> statement-breakpoint
-- 2. New identifier columns alongside the old ones.
ALTER TABLE `readingSessions` ADD `ulid` varchar(26);--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` ADD `ulid` varchar(26);--> statement-breakpoint
ALTER TABLE `sessionComments` ADD `ulid` varchar(26);--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` ADD `ulidSessionId` varchar(26);--> statement-breakpoint
ALTER TABLE `sessionComments` ADD `ulidSessionId` varchar(26);--> statement-breakpoint
-- 3. Derive a real ULID for every existing session from its own createdAt and id.
UPDATE `readingSessions` SET `ulid` = CONCAT(CONCAT(
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 9)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 8)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 7)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 6)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 5)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 4)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 3)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 2)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 1)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 0)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z')
    ), CONCAT(
      ELT(1 + MOD(FLOOR(`id` / POW(32, 15)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 14)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 13)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 12)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 11)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 10)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 9)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 8)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 7)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 6)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 5)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 4)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 3)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 2)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 1)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 0)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z')
    ));--> statement-breakpoint
-- 4. Carry the new session identity to the child rows before the join column changes.
UPDATE `provisionalMatchReviews` AS c JOIN `readingSessions` AS s ON c.`sessionId` = s.`id` SET c.`ulidSessionId` = s.`ulid`;--> statement-breakpoint
UPDATE `provisionalMatchReviews` SET `ulid` = CONCAT(CONCAT(
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 9)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 8)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 7)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 6)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 5)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 4)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 3)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 2)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 1)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 0)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z')
    ), CONCAT(
      ELT(1 + MOD(FLOOR(`id` / POW(32, 15)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 14)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 13)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 12)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 11)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 10)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 9)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 8)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 7)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 6)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 5)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 4)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 3)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 2)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 1)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 0)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z')
    ));--> statement-breakpoint
UPDATE `sessionComments` AS c JOIN `readingSessions` AS s ON c.`sessionId` = s.`id` SET c.`ulidSessionId` = s.`ulid`;--> statement-breakpoint
UPDATE `sessionComments` SET `ulid` = CONCAT(CONCAT(
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 9)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 8)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 7)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 6)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 5)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 4)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 3)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 2)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 1)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR((UNIX_TIMESTAMP(`createdAt`) * 1000) / POW(32, 0)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z')
    ), CONCAT(
      ELT(1 + MOD(FLOOR(`id` / POW(32, 15)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 14)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 13)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 12)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 11)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 10)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 9)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 8)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 7)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 6)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 5)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 4)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 3)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 2)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 1)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z'),
      ELT(1 + MOD(FLOOR(`id` / POW(32, 0)), 32), '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','V','W','X','Y','Z')
    ));--> statement-breakpoint
-- 5. Swap the keys. AUTO_INCREMENT has to go before the primary key can be dropped:
--    MySQL requires an auto column to be a key, and refuses DROP PRIMARY KEY otherwise.
ALTER TABLE `readingSessions` MODIFY `id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `readingSessions` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `readingSessions` DROP COLUMN `id`;--> statement-breakpoint
ALTER TABLE `readingSessions` CHANGE `ulid` `id` varchar(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `readingSessions` ADD PRIMARY KEY (`id`);--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` MODIFY `id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` DROP COLUMN `id`;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` CHANGE `ulid` `id` varchar(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` ADD PRIMARY KEY (`id`);--> statement-breakpoint
ALTER TABLE `sessionComments` MODIFY `id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `sessionComments` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `sessionComments` DROP COLUMN `id`;--> statement-breakpoint
ALTER TABLE `sessionComments` CHANGE `ulid` `id` varchar(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessionComments` ADD PRIMARY KEY (`id`);--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` DROP COLUMN `sessionId`;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` CHANGE `ulidSessionId` `sessionId` varchar(26) NOT NULL;--> statement-breakpoint
ALTER TABLE `sessionComments` DROP COLUMN `sessionId`;--> statement-breakpoint
ALTER TABLE `sessionComments` CHANGE `ulidSessionId` `sessionId` varchar(26) NOT NULL;--> statement-breakpoint
-- 6. Re-establish the foreign keys, now varchar to varchar.
ALTER TABLE `provisionalMatchReviews` ADD CONSTRAINT `provisionalMatchReviews_sessionId_readingSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `readingSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessionComments` ADD CONSTRAINT `sessionComments_sessionId_readingSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `readingSessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 7. The device's clock, kept beside the server's rather than replacing it. Existing rows
--    have no device reading, so capturedAt stays NULL and the server time stays authoritative.
ALTER TABLE `readingSessions` ADD `capturedAt` timestamp;--> statement-breakpoint
ALTER TABLE `readingSessions` ADD `capturedAtSource` enum('device','server') DEFAULT 'server' NOT NULL;