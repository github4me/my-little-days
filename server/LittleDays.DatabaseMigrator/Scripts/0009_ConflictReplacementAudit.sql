-- Additive fields keep the latest, directly-applied conflict replacement
-- visible on the record without changing existing record JSON or rowversions.
-- PreviousEntry is a bounded feed/sleep summary; notes and private payloads are
-- never copied into this audit envelope.
ALTER TABLE dbo.FamilyRecords ADD
    ConflictReplacedBy uniqueidentifier NULL,
    ConflictPreviousEditedBy uniqueidentifier NULL,
    ConflictReplacedAt datetimeoffset(7) NULL,
    ConflictPreviousJson nvarchar(1024) NULL;
GO

ALTER TABLE dbo.FamilyRecords ADD CONSTRAINT CK_FamilyRecords_ConflictReplacement CHECK (
    (ConflictReplacedBy IS NULL AND ConflictPreviousEditedBy IS NULL AND
     ConflictReplacedAt IS NULL AND ConflictPreviousJson IS NULL)
    OR
    (ConflictReplacedBy IS NOT NULL AND ConflictReplacedAt IS NOT NULL AND
     ConflictPreviousJson IS NOT NULL AND Collection = 'entry' AND
     ISJSON(ConflictPreviousJson) = 1 AND DATALENGTH(ConflictPreviousJson) <= 2048)
);
GO

CREATE INDEX IX_FamilyRecords_ConflictReplacedBy ON dbo.FamilyRecords(ConflictReplacedBy)
    WHERE ConflictReplacedBy IS NOT NULL;
GO

CREATE INDEX IX_FamilyRecords_ConflictPreviousEditedBy ON dbo.FamilyRecords(ConflictPreviousEditedBy)
    WHERE ConflictPreviousEditedBy IS NOT NULL;
