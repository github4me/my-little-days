-- Fixed, allowlisted output field paths accompany the existing private failure
-- reason. Nullable keeps old rows and the previous API's inserts compatible.
-- No backfill: absent historical metadata must not be presented as captured.
ALTER TABLE dbo.SleepAiFailedOutputs ADD FailureFieldsJson nvarchar(1024) NULL;
