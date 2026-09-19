-- Stage 1a: school tenancy.
-- The school is the data controller, so every tenant-scoped row hangs off one and erasing a
-- school is a single delete per table (ON DELETE cascade).
--
-- The column is added nullable, backfilled, and only then made NOT NULL. Adding it NOT NULL
-- directly would let MySQL fill existing rows with the implicit default 0, which no school
-- row has, and the foreign key would then fail on a populated database.
--
-- `users`.`schoolId` stays nullable on purpose: a break-glass support account has no standing
-- school membership, and a null school yields no tenant scope.
CREATE TABLE `schools` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schools_id` PRIMARY KEY(`id`),
	CONSTRAINT `schools_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
-- Exactly one school, so existing data and the demo keep working. Its name is taken from the
-- earliest existing `schoolBranding` row so the seeded school matches what the demo already
-- shows; `schools`.`name` is authoritative from here on.
INSERT INTO `schools` (`name`, `slug`)
SELECT COALESCE((SELECT `schoolName` FROM `schoolBranding` ORDER BY `id` LIMIT 1), 'Reader Leader School'), 'seed-school';
--> statement-breakpoint
-- 1. Add the column nullable.
ALTER TABLE `childProfiles` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `classEnrollments` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `educatorApprovedIrishVariants` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `familyLinks` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `homePracticeChecklists` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `learnerReadingSettings` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `materialAssignments` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `parentReminders` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `quizAttempts` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `readerClasses` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `readingExercises` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `readingMaterialDetails` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `readingMaterials` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `readingSessions` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `schoolBranding` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `sessionComments` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `teacherTermPresets` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `schoolId` int;--> statement-breakpoint
ALTER TABLE `weeklyReadingGoals` ADD `schoolId` int;--> statement-breakpoint
-- 2. Backfill every existing row onto the seeded school.
UPDATE `childProfiles` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `classEnrollments` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `educatorApprovedIrishVariants` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `familyLinks` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `homePracticeChecklists` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `learnerReadingSettings` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `materialAssignments` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `parentReminders` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `provisionalMatchReviews` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `quizAttempts` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `readerClasses` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `readingExercises` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `readingMaterialDetails` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `readingMaterials` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `readingSessions` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `schoolBranding` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `sessionComments` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `teacherTermPresets` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `users` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
UPDATE `weeklyReadingGoals` SET `schoolId` = (SELECT `id` FROM `schools` WHERE `slug` = 'seed-school') WHERE `schoolId` IS NULL;--> statement-breakpoint
-- 3. Close the column off. `users` is deliberately absent: see the header.
ALTER TABLE `childProfiles` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `classEnrollments` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `educatorApprovedIrishVariants` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `familyLinks` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `homePracticeChecklists` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `learnerReadingSettings` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `materialAssignments` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `parentReminders` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `quizAttempts` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `readerClasses` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `readingExercises` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `readingMaterialDetails` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `readingMaterials` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `readingSessions` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `schoolBranding` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `sessionComments` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `teacherTermPresets` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `weeklyReadingGoals` MODIFY `schoolId` int NOT NULL;--> statement-breakpoint
-- 4. Foreign keys last, once every row points at a real school.
ALTER TABLE `childProfiles` ADD CONSTRAINT `childProfiles_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `classEnrollments` ADD CONSTRAINT `classEnrollments_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `educatorApprovedIrishVariants` ADD CONSTRAINT `educatorApprovedIrishVariants_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `familyLinks` ADD CONSTRAINT `familyLinks_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `homePracticeChecklists` ADD CONSTRAINT `homePracticeChecklists_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `learnerReadingSettings` ADD CONSTRAINT `learnerReadingSettings_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `materialAssignments` ADD CONSTRAINT `materialAssignments_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `parentReminders` ADD CONSTRAINT `parentReminders_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `provisionalMatchReviews` ADD CONSTRAINT `provisionalMatchReviews_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quizAttempts` ADD CONSTRAINT `quizAttempts_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `readerClasses` ADD CONSTRAINT `readerClasses_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `readingExercises` ADD CONSTRAINT `readingExercises_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `readingMaterialDetails` ADD CONSTRAINT `readingMaterialDetails_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `readingMaterials` ADD CONSTRAINT `readingMaterials_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `readingSessions` ADD CONSTRAINT `readingSessions_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `schoolBranding` ADD CONSTRAINT `schoolBranding_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessionComments` ADD CONSTRAINT `sessionComments_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `teacherTermPresets` ADD CONSTRAINT `teacherTermPresets_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weeklyReadingGoals` ADD CONSTRAINT `weeklyReadingGoals_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;