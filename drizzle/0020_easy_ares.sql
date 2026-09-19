CREATE TABLE `unrecordedReadingAttempts` (
	`id` varchar(26) NOT NULL,
	`schoolId` int NOT NULL,
	`childProfileId` int NOT NULL,
	`materialId` int,
	`storyTitle` varchar(180) NOT NULL,
	`reason` enum('save_rejected','request_failed','no_reading_evidence') NOT NULL,
	`detail` varchar(400),
	`durationSeconds` int,
	`acknowledgedByTeacherId` int,
	`acknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `unrecordedReadingAttempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `unrecordedReadingAttempts` ADD CONSTRAINT `unrecordedReadingAttempts_schoolId_schools_id_fk` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `unrecordedReadingAttempts` ADD CONSTRAINT `unrecordedReadingAttempts_childProfileId_childProfiles_id_fk` FOREIGN KEY (`childProfileId`) REFERENCES `childProfiles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `unrecordedReadingAttempts` ADD CONSTRAINT `unrecordedReadingAttempts_materialId_readingMaterials_id_fk` FOREIGN KEY (`materialId`) REFERENCES `readingMaterials`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `unrecordedReadingAttempts` ADD CONSTRAINT `unrecordedReadingAttempts_acknowledgedByTeacherId_users_id_fk` FOREIGN KEY (`acknowledgedByTeacherId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;