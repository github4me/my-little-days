-- Validate the adopted baseline before committing its journal or grants.
-- These statements return no records and are never logged by the migrator.
SELECT TOP (0) Id,BabyName,Revision,CreatedAt,BabyBirthDate,BabySex,SchemaVersion,ProfileVersion,DeletedAt,DeletedBy,DeleteOperationId FROM dbo.Families;
SELECT TOP (0) Id,FamilyId,UserId,Role,Email,DisplayName,Active,GrantedAt,EndedAt,Status FROM dbo.Memberships;
SELECT TOP (0) Id,FamilyId,RecipientUserId,Email,Status,CreatedAt,ExpiresAt,AcceptedMembershipId FROM dbo.Invitations;
SELECT TOP (0) FamilyId,Id,Start,[End],Amount,Note,RecordedBy,LastEditedBy,Deleted,Version FROM dbo.Feeds;
SELECT TOP (0) FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted,Version FROM dbo.FamilyRecords;
SELECT TOP (0) UserId,OperationId,FamilyId,MembershipId,HistoryId,Action,Fingerprint,ResultJson,CreatedAt FROM dbo.Operations;
SELECT TOP (0) Id,FamilyId,FromUserId,ToUserId,FromMembershipId,ToMembershipId,Status,CreatedAt FROM dbo.OwnershipTransfers;
SELECT TOP (0) UserId,OperationId,Status,RequestedAt,CompletedAt,ReceiptHash,PendingEmail FROM dbo.AccountDeletions;

IF (SELECT COUNT(*) FROM sys.columns WHERE system_type_id=189 AND
    ((object_id=OBJECT_ID(N'dbo.Families') AND name=N'ProfileVersion') OR
     (object_id=OBJECT_ID(N'dbo.Feeds') AND name=N'Version') OR
     (object_id=OBJECT_ID(N'dbo.FamilyRecords') AND name=N'Version'))) <> 3
    THROW 51002, 'Required concurrency columns differ from the baseline.', 1;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.Feeds') AND name=N'Amount'
    AND system_type_id=106 AND precision=7 AND scale=2 AND is_nullable=0)
    THROW 51003, 'Feed precision differs from the baseline.', 1;
IF (SELECT COUNT(*) FROM sys.indexes WHERE is_unique=1 AND is_disabled=0 AND
    ((object_id=OBJECT_ID(N'dbo.Memberships') AND name=N'IX_Memberships_UserId' AND has_filter=1) OR
     (object_id=OBJECT_ID(N'dbo.Invitations') AND name=N'IX_Invitations_FamilyId_Email' AND has_filter=1) OR
     (object_id=OBJECT_ID(N'dbo.OwnershipTransfers') AND name=N'IX_OwnershipTransfers_FamilyId' AND has_filter=1) OR
     (object_id=OBJECT_ID(N'dbo.AccountDeletions') AND name=N'IX_AccountDeletions_OperationId'))) <> 4
    THROW 51004, 'Required uniqueness indexes differ from the baseline.', 1;
IF (SELECT COUNT(*) FROM sys.foreign_keys WHERE referenced_object_id=OBJECT_ID(N'dbo.Families')
    AND is_disabled=0 AND is_not_trusted=0 AND delete_referential_action=0) <> 6
    THROW 51005, 'Required family relationships differ from the baseline.', 1;
IF (SELECT COUNT(*) FROM sys.check_constraints WHERE is_disabled=0 AND is_not_trusted=0 AND
    ((parent_object_id=OBJECT_ID(N'dbo.Feeds') AND name IN (N'CK_Feeds_Amount',N'CK_Feeds_Interval')) OR
     (parent_object_id=OBJECT_ID(N'dbo.FamilyRecords') AND name IN (N'CK_FamilyRecords_Collection',N'CK_FamilyRecords_Json')))) <> 4
    THROW 51006, 'Required data constraints differ from the baseline.', 1;
IF DATABASE_PRINCIPAL_ID(N'family_pilot_runtime') IS NULL
    THROW 51007, 'The SQL administrator must run the one-time identity bootstrap first.', 1;

-- No migration-journal, schema or permission-management access for API runtime.
GRANT SELECT,INSERT,UPDATE ON OBJECT::dbo.Families TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.Memberships TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.Invitations TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.Feeds TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.FamilyRecords TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.Operations TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.OwnershipTransfers TO [family_pilot_runtime];
GRANT SELECT,INSERT,UPDATE ON OBJECT::dbo.AccountDeletions TO [family_pilot_runtime];
