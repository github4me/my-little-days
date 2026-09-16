-- Additive only: existing content and durable closure receipts are preserved.
-- Previously cleaned tombstones get one final idempotent pass before marking.
ALTER TABLE dbo.Families ADD PurgedAt datetimeoffset NULL;
GO
CREATE INDEX IX_Families_DeletedAt ON dbo.Families(DeletedAt)
    WHERE DeletedAt IS NOT NULL AND PurgedAt IS NULL;
CREATE INDEX IX_Families_DeletedBy_DeletedAt ON dbo.Families(DeletedBy, DeletedAt);
ALTER TABLE dbo.AccountDeletions ADD LastIdentityAttemptAt datetimeoffset NULL;
GO
CREATE INDEX IX_AccountDeletions_Status_RequestedAt ON dbo.AccountDeletions(Status, LastIdentityAttemptAt, RequestedAt);
