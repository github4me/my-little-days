-- Keep timer completion attribution separate from later record edits. Existing
-- records cannot be backfilled reliably, so they remain NULL. As with the
-- durable creator/editor columns, do not couple retained history to membership.
ALTER TABLE dbo.FamilyRecords ADD TimerEndedBy uniqueidentifier NULL;
CREATE INDEX IX_FamilyRecords_TimerEndedBy ON dbo.FamilyRecords(TimerEndedBy)
    WHERE TimerEndedBy IS NOT NULL;
