-- Additive, inactive by default. Existing job inserts keep a null capture epoch.
ALTER TABLE dbo.SleepAiJobs ADD ExchangeHistoryEpoch uniqueidentifier NULL;
GO
CREATE TABLE dbo.SleepAiExchanges (
    UserId uniqueidentifier NOT NULL, JobId uniqueidentifier NOT NULL,
    Run int NOT NULL, Attempt int NOT NULL, ConsentGeneration uniqueidentifier NOT NULL,
    FamilyId uniqueidentifier NULL, MembershipId uniqueidentifier NULL, HistoryEpoch uniqueidentifier NOT NULL,
    SchemaVersion int NOT NULL, StartedAt datetimeoffset(7) NOT NULL,
    FinishedAt datetimeoffset(7) NULL, ExpiresAt datetimeoffset(7) NOT NULL,
    RequestBody nvarchar(max) NOT NULL, ResponseBody nvarchar(max) NULL,
    RequestBytes bigint NOT NULL, ResponseBytes bigint NOT NULL,
    RequestTruncated bit NOT NULL, ResponseTruncated bit NOT NULL,
    HttpStatus int NULL, ProviderRequestId varchar(200) NULL, Outcome varchar(32) NOT NULL, DurationMs float NOT NULL,
    CONSTRAINT PK_SleepAiExchanges PRIMARY KEY (UserId, JobId, Run, Attempt),
    CONSTRAINT CK_SleepAiExchanges_Attempt CHECK (Run IN (1,2) AND Attempt IN (1,2)),
    CONSTRAINT CK_SleepAiExchanges_Context CHECK ((FamilyId IS NULL AND MembershipId IS NULL) OR (FamilyId IS NOT NULL AND MembershipId IS NOT NULL)),
    CONSTRAINT CK_SleepAiExchanges_Bounds CHECK (SchemaVersion IN (1,2,3) AND RequestBytes >= -1 AND ResponseBytes >= -1 AND DurationMs >= 0 AND DATALENGTH(RequestBody) <= 2097152 AND (ResponseBody IS NULL OR DATALENGTH(ResponseBody) <= 2097152) AND (HttpStatus IS NULL OR HttpStatus BETWEEN 100 AND 599)),
    CONSTRAINT CK_SleepAiExchanges_Outcome CHECK (Outcome IN ('dispatching','response_received','http_error','transport_error','cancelled','response_read_failed')),
    CONSTRAINT CK_SleepAiExchanges_Retention CHECK (ExpiresAt = DATEADD(day,7,StartedAt))
);
CREATE INDEX IX_SleepAiExchanges_ExpiresAt ON dbo.SleepAiExchanges(ExpiresAt);
CREATE INDEX IX_SleepAiExchanges_UserId_ConsentGeneration ON dbo.SleepAiExchanges(UserId, ConsentGeneration);
CREATE INDEX IX_SleepAiExchanges_FamilyId ON dbo.SleepAiExchanges(FamilyId);
CREATE INDEX IX_SleepAiExchanges_MembershipId ON dbo.SleepAiExchanges(MembershipId);
CREATE INDEX IX_SleepAiExchanges_HistoryEpoch ON dbo.SleepAiExchanges(HistoryEpoch);
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiExchanges TO [family_pilot_runtime];
