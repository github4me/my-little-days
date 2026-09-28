-- Schema-first compatibility: the already-running en/zh API continues to read
-- and write this column while the next API begins accepting canonical BCP-47
-- locale IDs. Existing registrations and push metadata remain unchanged.
ALTER TABLE dbo.PushInstallations ALTER COLUMN Locale varchar(16) NOT NULL;
