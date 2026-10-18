-- Automatic failed-output diagnostics use a server history epoch, not a
-- fabricated client opt-in. Existing null/null and explicit-consent rows remain
-- valid for the previous API during schema-first deployment. Do not backfill
-- jobs: a null epoch can also mean deliberate lifecycle suppression.
ALTER TABLE dbo.SleepAiJobs DROP CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent;
ALTER TABLE dbo.SleepAiJobs WITH CHECK ADD CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent CHECK
(
    DiagnosticsConsentVersion IS NULL OR
    (DiagnosticsConsentVersion IS NOT NULL AND DiagnosticsConsentVersion = 'sleep-ai-failed-output-v1'
        AND DiagnosticsHistoryEpoch IS NOT NULL)
);
