-- Frozen SQL generated from the three historical EF migrations (10.0.12).
-- DbUp now owns deployment. Do not edit an applied script; add a new numbered script.
IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE TABLE [Families] (
        [Id] uniqueidentifier NOT NULL,
        [BabyName] nvarchar(60) NOT NULL,
        [Revision] bigint NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Families] PRIMARY KEY ([Id])
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE TABLE [Feeds] (
        [FamilyId] uniqueidentifier NOT NULL,
        [Id] uniqueidentifier NOT NULL,
        [Start] datetimeoffset NOT NULL,
        [End] datetimeoffset NOT NULL,
        [Amount] decimal(7,2) NOT NULL,
        [Note] nvarchar(500) NOT NULL,
        [RecordedBy] uniqueidentifier NOT NULL,
        [LastEditedBy] uniqueidentifier NOT NULL,
        [Deleted] bit NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Feeds] PRIMARY KEY ([FamilyId], [Id]),
        CONSTRAINT [CK_Feeds_Amount] CHECK ([Amount] >= 0 AND [Amount] <= 2000),
        CONSTRAINT [CK_Feeds_Interval] CHECK ([End] >= [Start]),
        CONSTRAINT [FK_Feeds_Families_FamilyId] FOREIGN KEY ([FamilyId]) REFERENCES [Families] ([Id]) ON DELETE NO ACTION
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE TABLE [Invitations] (
        [Id] uniqueidentifier NOT NULL,
        [FamilyId] uniqueidentifier NOT NULL,
        [RecipientUserId] uniqueidentifier NOT NULL,
        [Email] nvarchar(254) NOT NULL,
        [TokenHash] varchar(64) NOT NULL,
        [Status] nvarchar(10) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [AcceptedMembershipId] uniqueidentifier NULL,
        CONSTRAINT [PK_Invitations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Invitations_Families_FamilyId] FOREIGN KEY ([FamilyId]) REFERENCES [Families] ([Id]) ON DELETE NO ACTION
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE TABLE [Memberships] (
        [Id] uniqueidentifier NOT NULL,
        [FamilyId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Role] nvarchar(10) NOT NULL,
        [Email] nvarchar(254) NOT NULL,
        [DisplayName] nvarchar(80) NOT NULL,
        [Active] bit NOT NULL,
        [GrantedAt] datetimeoffset NOT NULL,
        [EndedAt] datetimeoffset NULL,
        CONSTRAINT [PK_Memberships] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Memberships_Families_FamilyId] FOREIGN KEY ([FamilyId]) REFERENCES [Families] ([Id]) ON DELETE NO ACTION
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE TABLE [Operations] (
        [UserId] uniqueidentifier NOT NULL,
        [OperationId] uniqueidentifier NOT NULL,
        [FamilyId] uniqueidentifier NOT NULL,
        [MembershipId] uniqueidentifier NOT NULL,
        [HistoryId] uniqueidentifier NOT NULL,
        [Action] varchar(40) NOT NULL,
        [Fingerprint] varchar(64) NOT NULL,
        [ResultJson] nvarchar(2048) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_Operations] PRIMARY KEY ([UserId], [OperationId]),
        CONSTRAINT [FK_Operations_Families_FamilyId] FOREIGN KEY ([FamilyId]) REFERENCES [Families] ([Id]) ON DELETE NO ACTION
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Invitations_FamilyId_RecipientUserId] ON [Invitations] ([FamilyId], [RecipientUserId]) WHERE [Status] = N''pending''');
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Invitations_TokenHash] ON [Invitations] ([TokenHash]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE INDEX [IX_Memberships_FamilyId_UserId_Active] ON [Memberships] ([FamilyId], [UserId], [Active]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Memberships_UserId] ON [Memberships] ([UserId]) WHERE [Active] = 1');
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    CREATE INDEX [IX_Operations_FamilyId] ON [Operations] ([FamilyId]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260913173137_InitialPilot'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260913173137_InitialPilot', N'10.0.12');
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    UPDATE Invitations SET Status = N'revoked' WHERE Status = N'pending';
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    DROP INDEX [IX_Invitations_FamilyId_RecipientUserId] ON [Invitations];
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    DROP INDEX [IX_Invitations_TokenHash] ON [Invitations];
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    DECLARE @var nvarchar(max);
    SELECT @var = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Invitations]') AND [c].[name] = N'TokenHash');
    IF @var IS NOT NULL EXEC(N'ALTER TABLE [Invitations] DROP CONSTRAINT ' + @var + ';');
    ALTER TABLE [Invitations] DROP COLUMN [TokenHash];
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    ALTER TABLE [Memberships] ADD [Status] nvarchar(10) NOT NULL DEFAULT N'';
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    UPDATE m SET Status = CASE WHEN m.Active = 1 THEN N'active'
        WHEN EXISTS (SELECT 1 FROM Operations o WHERE o.MembershipId = m.Id AND o.Action = 'leave') THEN N'left'
        ELSE N'removed' END FROM Memberships m;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    DECLARE @var1 nvarchar(max);
    SELECT @var1 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Invitations]') AND [c].[name] = N'RecipientUserId');
    IF @var1 IS NOT NULL EXEC(N'ALTER TABLE [Invitations] DROP CONSTRAINT ' + @var1 + ';');
    ALTER TABLE [Invitations] ALTER COLUMN [RecipientUserId] uniqueidentifier NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    ALTER TABLE [Families] ADD [BabyBirthDate] nvarchar(10) NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    ALTER TABLE [Families] ADD [DeleteOperationId] uniqueidentifier NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    ALTER TABLE [Families] ADD [DeletedAt] datetimeoffset NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    ALTER TABLE [Families] ADD [DeletedBy] uniqueidentifier NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    CREATE TABLE [AccountDeletions] (
        [UserId] uniqueidentifier NOT NULL,
        [OperationId] uniqueidentifier NOT NULL,
        [Status] nvarchar(32) NOT NULL,
        [RequestedAt] datetimeoffset NOT NULL,
        [CompletedAt] datetimeoffset NULL,
        [ReceiptHash] varchar(64) NOT NULL,
        CONSTRAINT [PK_AccountDeletions] PRIMARY KEY ([UserId])
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    CREATE TABLE [OwnershipTransfers] (
        [Id] uniqueidentifier NOT NULL,
        [FamilyId] uniqueidentifier NOT NULL,
        [FromUserId] uniqueidentifier NOT NULL,
        [ToUserId] uniqueidentifier NOT NULL,
        [FromMembershipId] uniqueidentifier NOT NULL,
        [ToMembershipId] uniqueidentifier NOT NULL,
        [Status] nvarchar(10) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        CONSTRAINT [PK_OwnershipTransfers] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OwnershipTransfers_Families_FamilyId] FOREIGN KEY ([FamilyId]) REFERENCES [Families] ([Id]) ON DELETE NO ACTION
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Invitations_FamilyId_Email] ON [Invitations] ([FamilyId], [Email]) WHERE [Status] = N''pending''');
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    CREATE UNIQUE INDEX [IX_AccountDeletions_OperationId] ON [AccountDeletions] ([OperationId]);
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_OwnershipTransfers_FamilyId] ON [OwnershipTransfers] ([FamilyId]) WHERE [Status] = N''pending''');
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260914032522_InvitationLifecycleV2'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260914032522_InvitationLifecycleV2', N'10.0.12');
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    DECLARE @var2 nvarchar(max);
    SELECT @var2 = QUOTENAME([d].[name])
    FROM [sys].[default_constraints] [d]
    INNER JOIN [sys].[columns] [c] ON [d].[parent_column_id] = [c].[column_id] AND [d].[parent_object_id] = [c].[object_id]
    WHERE ([d].[parent_object_id] = OBJECT_ID(N'[Families]') AND [c].[name] = N'BabyName');
    IF @var2 IS NOT NULL EXEC(N'ALTER TABLE [Families] DROP CONSTRAINT ' + @var2 + ';');
    ALTER TABLE [Families] ALTER COLUMN [BabyName] nvarchar(100) NOT NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    ALTER TABLE [Families] ADD [BabySex] nvarchar(11) NOT NULL DEFAULT N'unspecified';
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    ALTER TABLE [Families] ADD [ProfileVersion] rowversion NOT NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    ALTER TABLE [Families] ADD [SchemaVersion] int NOT NULL DEFAULT 1;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    ALTER TABLE [AccountDeletions] ADD [PendingEmail] nvarchar(254) NULL;
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    CREATE TABLE [FamilyRecords] (
        [FamilyId] uniqueidentifier NOT NULL,
        [Collection] varchar(5) NOT NULL,
        [IdHash] varchar(64) NOT NULL,
        [Id] nvarchar(128) NOT NULL,
        [RecordJson] nvarchar(max) NOT NULL,
        [RecordedBy] uniqueidentifier NOT NULL,
        [LastEditedBy] uniqueidentifier NOT NULL,
        [Deleted] bit NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_FamilyRecords] PRIMARY KEY ([FamilyId], [Collection], [IdHash]),
        CONSTRAINT [CK_FamilyRecords_Collection] CHECK ([Collection] IN ('entry', 'care')),
        CONSTRAINT [CK_FamilyRecords_Json] CHECK (ISJSON([RecordJson]) = 1 AND DATALENGTH([RecordJson]) <= 131072),
        CONSTRAINT [FK_FamilyRecords_Families_FamilyId] FOREIGN KEY ([FamilyId]) REFERENCES [Families] ([Id]) ON DELETE NO ACTION
    );
END;
GO

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20260915091021_FullDomainFamiliesV2'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20260915091021_FullDomainFamiliesV2', N'10.0.12');
END;
GO
