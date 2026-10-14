-- Additive short-lived AI jobs. No FKs to grants/accounts: older API lifecycle
-- writers remain compatible. Every claim, publication and read rechecks access.
CREATE TABLE dbo.SleepAiJobs (
    UserId uniqueidentifier NOT NULL, Id uniqueidentifier NOT NULL,
    ConsentGeneration uniqueidentifier NOT NULL,
    FamilyId uniqueidentifier NULL, MembershipId uniqueidentifier NULL, HistoryId uniqueidentifier NULL,
    InputRevision varchar(64) NOT NULL, RequestHash varchar(64) NOT NULL, State varchar(12) NOT NULL,
    RequestNow datetimeoffset(7) NOT NULL, CreatedAt datetimeoffset(7) NOT NULL,
    UpdatedAt datetimeoffset(7) NOT NULL, ExpiresAt datetimeoffset(7) NOT NULL,
    RequestJson nvarchar(max) NULL, ResultJson nvarchar(max) NULL, ErrorCode varchar(40) NULL,
    LeaseId uniqueidentifier NULL, LeaseUntil datetimeoffset(7) NULL, Runs int NOT NULL,
    CONSTRAINT PK_SleepAiJobs PRIMARY KEY (UserId, Id),
    CONSTRAINT CK_SleepAiJobs_State CHECK (State IN ('queued','running','completed','failed','cancelled','expired')),
    CONSTRAINT CK_SleepAiJobs_Runs CHECK (Runs >= 0 AND Runs <= 2),
    CONSTRAINT CK_SleepAiJobs_Context CHECK ((FamilyId IS NULL AND MembershipId IS NULL AND HistoryId IS NULL) OR
        (FamilyId IS NOT NULL AND MembershipId IS NOT NULL AND HistoryId IS NOT NULL)),
    CONSTRAINT CK_SleepAiJobs_Request CHECK (RequestJson IS NULL OR (ISJSON(RequestJson) = 1 AND DATALENGTH(RequestJson) <= 393216)),
    CONSTRAINT CK_SleepAiJobs_Result CHECK (ResultJson IS NULL OR (ISJSON(ResultJson) = 1 AND DATALENGTH(ResultJson) <= 32768))
);
CREATE INDEX IX_SleepAiJobs_State_CreatedAt ON dbo.SleepAiJobs(State, CreatedAt);
CREATE INDEX IX_SleepAiJobs_ExpiresAt ON dbo.SleepAiJobs(ExpiresAt);
CREATE INDEX IX_SleepAiJobs_UserId_ConsentGeneration ON dbo.SleepAiJobs(UserId, ConsentGeneration);
CREATE INDEX IX_SleepAiJobs_MembershipId ON dbo.SleepAiJobs(MembershipId);

CREATE TABLE dbo.SleepAiRevocations (
    UserId uniqueidentifier NOT NULL, Kind varchar(8) NOT NULL, Id uniqueidentifier NOT NULL,
    ExpiresAt datetimeoffset(7) NOT NULL,
    CONSTRAINT PK_SleepAiRevocations PRIMARY KEY (UserId, Kind, Id),
    CONSTRAINT CK_SleepAiRevocations_Kind CHECK (Kind IN ('job','consent'))
);
CREATE INDEX IX_SleepAiRevocations_ExpiresAt ON dbo.SleepAiRevocations(ExpiresAt);

-- Minimal provider-attempt receipts contain no prompts, predictions or keys.
-- Shared by old synchronous requests and jobs; fixed UTC hour/day boundaries.
CREATE TABLE dbo.SleepAiAttempts (
    Id uniqueidentifier NOT NULL, UserId uniqueidentifier NOT NULL,
    StartedAt datetimeoffset(7) NOT NULL, LeaseUntil datetimeoffset(7) NULL,
    CONSTRAINT PK_SleepAiAttempts PRIMARY KEY (Id)
);
CREATE INDEX IX_SleepAiAttempts_UserId_StartedAt ON dbo.SleepAiAttempts(UserId, StartedAt);
CREATE INDEX IX_SleepAiAttempts_StartedAt ON dbo.SleepAiAttempts(StartedAt);
CREATE INDEX IX_SleepAiAttempts_LeaseUntil ON dbo.SleepAiAttempts(LeaseUntil);
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiJobs TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiRevocations TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiAttempts TO [family_pilot_runtime];
