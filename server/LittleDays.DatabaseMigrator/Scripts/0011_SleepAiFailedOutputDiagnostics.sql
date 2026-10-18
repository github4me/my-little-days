-- Explicitly consented failed-output diagnostics; no input history or prompts.
-- Nullable additions keep the previous API's inserts compatible and deny capture
-- for existing jobs. Ordinary jobs retain their existing midnight expiry.
ALTER TABLE dbo.SleepAiJobs ADD DiagnosticsConsentVersion varchar(40) NULL,
    DiagnosticsHistoryEpoch uniqueidentifier NULL;
ALTER TABLE dbo.SleepAiJobs ADD CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent CHECK
    ((DiagnosticsConsentVersion IS NULL AND DiagnosticsHistoryEpoch IS NULL) OR
     (DiagnosticsConsentVersion IS NOT NULL AND DiagnosticsConsentVersion = 'sleep-ai-failed-output-v1' AND DiagnosticsHistoryEpoch IS NOT NULL));

-- No parent-job FK: a later consent revocation must still find diagnostics after
-- the shorter-lived parent has been removed. Scope and expiry are self-contained.
CREATE TABLE dbo.SleepAiFailedOutputs (
    UserId uniqueidentifier NOT NULL, JobId uniqueidentifier NOT NULL,
    Run int NOT NULL, Attempt int NOT NULL, ConsentGeneration uniqueidentifier NOT NULL,
    FamilyId uniqueidentifier NULL, MembershipId uniqueidentifier NULL,
    HistoryEpoch uniqueidentifier NOT NULL, Reason varchar(64) NOT NULL,
    PeriodIndex int NULL, ResponseText nvarchar(max) NULL,
    OriginalLength int NOT NULL, Truncated bit NOT NULL,
    OccurredAt datetimeoffset(7) NOT NULL, ExpiresAt datetimeoffset(7) NOT NULL,
    DurationMs float NOT NULL, Model varchar(100) NOT NULL,
    CONSTRAINT PK_SleepAiFailedOutputs PRIMARY KEY (UserId, JobId, Run, Attempt),
    CONSTRAINT CK_SleepAiFailedOutputs_Attempt CHECK (Run IN (1,2) AND Attempt IN (1,2)),
    CONSTRAINT CK_SleepAiFailedOutputs_Context CHECK
        ((FamilyId IS NULL AND MembershipId IS NULL) OR (FamilyId IS NOT NULL AND MembershipId IS NOT NULL)),
    CONSTRAINT CK_SleepAiFailedOutputs_Bounds CHECK
        (OriginalLength >= 0 AND (PeriodIndex IS NULL OR PeriodIndex >= 0) AND DurationMs >= 0 AND
         LEN(Reason) >= 1 AND LEN(Model) >= 1 AND
         (ResponseText IS NULL OR DATALENGTH(ResponseText) <= 32768)),
    CONSTRAINT CK_SleepAiFailedOutputs_Length CHECK
        ((ResponseText IS NULL AND OriginalLength = 0 AND Truncated = 0) OR
         (ResponseText IS NOT NULL AND
          ((Truncated = 0 AND OriginalLength = DATALENGTH(ResponseText) / 2) OR
           (Truncated = 1 AND OriginalLength > DATALENGTH(ResponseText) / 2)))),
    CONSTRAINT CK_SleepAiFailedOutputs_Retention CHECK (ExpiresAt = DATEADD(day, 7, OccurredAt))
);
CREATE INDEX IX_SleepAiFailedOutputs_ExpiresAt ON dbo.SleepAiFailedOutputs(ExpiresAt);
CREATE INDEX IX_SleepAiFailedOutputs_UserId_ConsentGeneration ON dbo.SleepAiFailedOutputs(UserId, ConsentGeneration);
CREATE INDEX IX_SleepAiFailedOutputs_FamilyId ON dbo.SleepAiFailedOutputs(FamilyId);
CREATE INDEX IX_SleepAiFailedOutputs_MembershipId ON dbo.SleepAiFailedOutputs(MembershipId);
CREATE INDEX IX_SleepAiFailedOutputs_HistoryEpoch ON dbo.SleepAiFailedOutputs(HistoryEpoch);
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiFailedOutputs TO [family_pilot_runtime];
