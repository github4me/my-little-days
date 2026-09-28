-- Additive, backward-compatible metadata only. Existing receipts and domain rows stay intact.
-- No FK to records/grants: legacy API deletion remains compatible. Every delivery
-- rechecks authoritative access; the bounded worker purges expired metadata.
CREATE TABLE dbo.PushInstallations (
    Id uniqueidentifier NOT NULL, UserId uniqueidentifier NOT NULL, FamilyId uniqueidentifier NOT NULL,
    MembershipId uniqueidentifier NOT NULL, HistoryId uniqueidentifier NOT NULL, ProjectId uniqueidentifier NOT NULL,
    Environment varchar(32) NOT NULL, SecretHash varchar(64) NOT NULL, TokenHash varchar(64) NULL,
    ProtectedToken varchar(1024) NOT NULL, Platform varchar(7) NOT NULL, Locale varchar(2) NOT NULL,
    Generation int NOT NULL, Enabled bit NOT NULL, CategoryMask int NOT NULL, ExpiresAt datetimeoffset NOT NULL,
    NextSendAt datetimeoffset NOT NULL, LastOperationId uniqueidentifier NOT NULL, LastRequestHash varchar(64) NOT NULL,
    CONSTRAINT PK_PushInstallations PRIMARY KEY (Id),
    CONSTRAINT CK_PushInstallations_Generation CHECK (Generation >= 0),
    CONSTRAINT CK_PushInstallations_CategoryMask CHECK (CategoryMask >= 0 AND CategoryMask <= 7)
);
CREATE TABLE dbo.FamilyNotificationEvents (
    Id uniqueidentifier NOT NULL, FamilyId uniqueidentifier NOT NULL, HistoryId uniqueidentifier NOT NULL,
    ActorUserId uniqueidentifier NOT NULL, OperationId uniqueidentifier NOT NULL, RecordIdHash varchar(64) NOT NULL,
    Category varchar(6) NOT NULL, CreatedAt datetimeoffset NOT NULL, ExpiresAt datetimeoffset NOT NULL,
    NotBeforeAt datetimeoffset NOT NULL, Cancelled bit NOT NULL,
    CONSTRAINT PK_FamilyNotificationEvents PRIMARY KEY (Id),
    CONSTRAINT CK_FamilyNotificationEvents_Category CHECK (Category IN ('feed', 'diaper', 'sleep'))
);
CREATE TABLE dbo.NotificationSummaryBuckets (
    Id uniqueidentifier NOT NULL, BucketKey varchar(64) NOT NULL, FamilyId uniqueidentifier NOT NULL,
    HistoryId uniqueidentifier NOT NULL, RecipientUserId uniqueidentifier NOT NULL, MembershipId uniqueidentifier NOT NULL,
    InstallationId uniqueidentifier NOT NULL, Generation int NOT NULL, IsSummary bit NOT NULL,
    WindowStart datetimeoffset NOT NULL, ExpiresAt datetimeoffset NOT NULL, DueAt datetimeoffset NOT NULL,
    State varchar(12) NOT NULL, Sealed bit NOT NULL, LeaseId uniqueidentifier NULL, LeaseUntil datetimeoffset NULL,
    Attempts int NOT NULL, ReceiptId varchar(128) NULL, LastError varchar(40) NOT NULL,
    CONSTRAINT PK_NotificationSummaryBuckets PRIMARY KEY (Id),
    CONSTRAINT CK_NotificationSummaryBuckets_State CHECK (State IN ('pending', 'leased', 'receipt', 'sent', 'cancelled', 'failed')),
    CONSTRAINT CK_NotificationSummaryBuckets_Attempts CHECK (Attempts >= 0)
);
CREATE TABLE dbo.PushDeliveries (
    EventId uniqueidentifier NOT NULL, BucketId uniqueidentifier NOT NULL, ExpiresAt datetimeoffset NOT NULL,
    CONSTRAINT PK_PushDeliveries PRIMARY KEY (EventId, BucketId)
);

-- Nonunique: preserve existing concurrent timers for explicit review. Enable the
-- transactional API guard only after all writers run the compatible API.
ALTER TABLE dbo.FamilyRecords ADD ActiveTimerKind AS (CONVERT(varchar(5), CASE WHEN Deleted = 0 AND Collection = 'entry' AND JSON_VALUE(RecordJson, '$.type') = 'sleep' AND JSON_VALUE(RecordJson, '$.end') IS NULL THEN 'sleep' WHEN Deleted = 0 AND Collection = 'entry' AND JSON_VALUE(RecordJson, '$.type') = 'feed' AND JSON_VALUE(RecordJson, '$.feedRunning') = 'true' THEN 'feed' ELSE NULL END)) PERSISTED;
CREATE UNIQUE INDEX IX_PushInstallations_ProjectId_Environment_TokenHash ON dbo.PushInstallations (ProjectId, Environment, TokenHash) WHERE TokenHash IS NOT NULL;
CREATE INDEX IX_PushInstallations_UserId_Enabled ON dbo.PushInstallations (UserId, Enabled);
CREATE INDEX IX_PushInstallations_FamilyId ON dbo.PushInstallations (FamilyId);
CREATE INDEX IX_PushInstallations_MembershipId ON dbo.PushInstallations (MembershipId);
CREATE INDEX IX_PushInstallations_ExpiresAt ON dbo.PushInstallations (ExpiresAt);
CREATE UNIQUE INDEX IX_FamilyNotificationEvents_HistoryId_ActorUserId_OperationId_Category ON dbo.FamilyNotificationEvents (HistoryId, ActorUserId, OperationId, Category);
CREATE INDEX IX_FamilyNotificationEvents_FamilyId_CreatedAt ON dbo.FamilyNotificationEvents (FamilyId, CreatedAt);
CREATE INDEX IX_FamilyNotificationEvents_FamilyId_RecordIdHash ON dbo.FamilyNotificationEvents (FamilyId, RecordIdHash);
CREATE INDEX IX_FamilyNotificationEvents_ActorUserId ON dbo.FamilyNotificationEvents (ActorUserId);
CREATE INDEX IX_FamilyNotificationEvents_ExpiresAt ON dbo.FamilyNotificationEvents (ExpiresAt);
CREATE INDEX IX_PushDeliveries_BucketId ON dbo.PushDeliveries (BucketId);
CREATE INDEX IX_PushDeliveries_ExpiresAt ON dbo.PushDeliveries (ExpiresAt);
CREATE UNIQUE INDEX IX_NotificationSummaryBuckets_BucketKey ON dbo.NotificationSummaryBuckets (BucketKey);
CREATE INDEX IX_NotificationSummaryBuckets_State_DueAt_Id ON dbo.NotificationSummaryBuckets (State, DueAt, Id);
CREATE INDEX IX_NotificationSummaryBuckets_State_LeaseUntil ON dbo.NotificationSummaryBuckets (State, LeaseUntil);
CREATE INDEX IX_NotificationSummaryBuckets_InstallationId_Generation ON dbo.NotificationSummaryBuckets (InstallationId, Generation);
CREATE INDEX IX_NotificationSummaryBuckets_MembershipId_State ON dbo.NotificationSummaryBuckets (MembershipId, State);
CREATE INDEX IX_NotificationSummaryBuckets_FamilyId_State ON dbo.NotificationSummaryBuckets (FamilyId, State);
CREATE INDEX IX_NotificationSummaryBuckets_RecipientUserId_State ON dbo.NotificationSummaryBuckets (RecipientUserId, State);
CREATE INDEX IX_NotificationSummaryBuckets_ExpiresAt ON dbo.NotificationSummaryBuckets (ExpiresAt);
CREATE INDEX IX_FamilyRecords_FamilyId_ActiveTimerKind ON dbo.FamilyRecords (FamilyId, ActiveTimerKind);
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.PushInstallations TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.FamilyNotificationEvents TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.NotificationSummaryBuckets TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.PushDeliveries TO [family_pilot_runtime];
