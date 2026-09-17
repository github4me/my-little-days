-- Keep the existing unique constraints and receipt keys. These narrow indexes
-- serve recipient/family queries and account erasure without indexing JSON/LOBs.
CREATE INDEX IX_Invitations_Email_Status_ExpiresAt ON dbo.Invitations(Email, Status, ExpiresAt)
    INCLUDE (FamilyId, CreatedAt);
CREATE INDEX IX_Invitations_FamilyId_CreatedAt ON dbo.Invitations(FamilyId, CreatedAt DESC);
CREATE INDEX IX_Invitations_RecipientUserId ON dbo.Invitations(RecipientUserId) INCLUDE (FamilyId);
CREATE INDEX IX_OwnershipTransfers_FamilyId_All ON dbo.OwnershipTransfers(FamilyId);
CREATE INDEX IX_OwnershipTransfers_FromUserId ON dbo.OwnershipTransfers(FromUserId) INCLUDE (FamilyId);
CREATE INDEX IX_OwnershipTransfers_ToUserId ON dbo.OwnershipTransfers(ToUserId) INCLUDE (FamilyId);
CREATE INDEX IX_Memberships_UserId_FamilyId ON dbo.Memberships(UserId, FamilyId);
-- FamilyId is already carried by the clustered keys of these record tables.
CREATE INDEX IX_Feeds_RecordedBy ON dbo.Feeds(RecordedBy);
CREATE INDEX IX_Feeds_LastEditedBy ON dbo.Feeds(LastEditedBy);
CREATE INDEX IX_FamilyRecords_RecordedBy ON dbo.FamilyRecords(RecordedBy);
CREATE INDEX IX_FamilyRecords_LastEditedBy ON dbo.FamilyRecords(LastEditedBy);
CREATE INDEX IX_Families_DeletedAt ON dbo.Families(DeletedAt) INCLUDE (PurgedAt)
    WHERE DeletedAt IS NOT NULL AND PurgedAt IS NULL
    WITH (DROP_EXISTING = ON);

-- An indexed counter avoids counting an ever-growing receipt history on every
-- write, while retaining all receipts and their existing idempotency keys.
-- Keep it separate from Families so bookkeeping does not change ProfileVersion.
CREATE TABLE dbo.FamilyOperationCounts (
    FamilyId uniqueidentifier NOT NULL,
    ReceiptCount bigint NOT NULL,
    CONSTRAINT PK_FamilyOperationCounts PRIMARY KEY (FamilyId),
    CONSTRAINT FK_FamilyOperationCounts_Families_FamilyId FOREIGN KEY (FamilyId)
        REFERENCES dbo.Families(Id) ON DELETE NO ACTION,
    CONSTRAINT CK_FamilyOperationCounts_ReceiptCount CHECK (ReceiptCount >= 0)
);

-- DbUp keeps this lock until the transaction also installs the trigger. Writers
-- cannot slip a receipt between the backfill and transactional maintenance.
INSERT dbo.FamilyOperationCounts(FamilyId, ReceiptCount)
SELECT FamilyId, COUNT_BIG(*) FROM dbo.Operations WITH (TABLOCKX, HOLDLOCK)
GROUP BY FamilyId;

-- Runtime reads counters; same-owner trigger chaining performs the writes.
GRANT SELECT ON OBJECT::dbo.FamilyOperationCounts TO [family_pilot_runtime];
GO
CREATE TRIGGER dbo.TR_Operations_MaintainFamilyOperationCounts
ON dbo.Operations
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @deltas TABLE (FamilyId uniqueidentifier NOT NULL PRIMARY KEY, Delta bigint NOT NULL);
    INSERT @deltas(FamilyId, Delta)
    SELECT FamilyId, SUM(Delta)
    FROM (
        SELECT FamilyId, COUNT_BIG(*) AS Delta FROM inserted GROUP BY FamilyId
        UNION ALL
        SELECT FamilyId, -COUNT_BIG(*) AS Delta FROM deleted GROUP BY FamilyId
    ) AS changes
    GROUP BY FamilyId
    HAVING SUM(Delta) <> 0;

    -- New families have no counter until their first receipt. Range locks prevent
    -- two concurrent first inserts from both creating the same counter row.
    INSERT dbo.FamilyOperationCounts(FamilyId, ReceiptCount)
    SELECT change.FamilyId, 0 FROM @deltas AS change
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.FamilyOperationCounts AS counter WITH (UPDLOCK, HOLDLOCK)
        WHERE counter.FamilyId = change.FamilyId
    );

    UPDATE counter SET ReceiptCount = counter.ReceiptCount + change.Delta
    FROM dbo.FamilyOperationCounts AS counter
    JOIN @deltas AS change ON change.FamilyId = counter.FamilyId;
END;
