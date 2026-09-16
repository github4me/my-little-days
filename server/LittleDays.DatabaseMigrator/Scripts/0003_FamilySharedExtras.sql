-- Additive capability only. No tables, rows, record versions, runtime grants or
-- historical migration scripts are replaced. DbUp runs this in its transaction.
ALTER TABLE dbo.FamilyRecords DROP CONSTRAINT CK_FamilyRecords_Collection;
ALTER TABLE dbo.FamilyRecords WITH CHECK ADD CONSTRAINT CK_FamilyRecords_Collection
    CHECK ([Collection] IN ('entry', 'care', 'extra'));

-- An avatar is bounded to 12 MiB decoded by the API (16 MiB base64). SQL stores
-- Unicode JSON, so allow 34 MiB including metadata for this singleton only.
-- Every other record keeps the original 128 KiB SQL bound.
ALTER TABLE dbo.FamilyRecords DROP CONSTRAINT CK_FamilyRecords_Json;
ALTER TABLE dbo.FamilyRecords WITH CHECK ADD CONSTRAINT CK_FamilyRecords_Json
    CHECK (ISJSON([RecordJson]) = 1 AND
        (DATALENGTH([RecordJson]) <= 131072 OR
            ([Collection] = 'extra' AND [Id] = 'avatar' AND
             COALESCE(JSON_VALUE([RecordJson], '$.kind'), '') = 'avatar' AND
             DATALENGTH([RecordJson]) <= 35651584)));
