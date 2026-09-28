using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LittleDays.FamilyApi.Migrations
{
    /// <inheritdoc />
    public partial class InvitationLifecycleV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Legacy share-link invitations must not silently become inbox invitations.
            migrationBuilder.Sql("UPDATE Invitations SET Status = N'revoked' WHERE Status = N'pending';");
            migrationBuilder.DropIndex(
                name: "IX_Invitations_FamilyId_RecipientUserId",
                table: "Invitations");

            migrationBuilder.DropIndex(
                name: "IX_Invitations_TokenHash",
                table: "Invitations");

            migrationBuilder.DropColumn(
                name: "TokenHash",
                table: "Invitations");

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Memberships",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "");
            migrationBuilder.Sql("""
                UPDATE m SET Status = CASE WHEN m.Active = 1 THEN N'active'
                    WHEN EXISTS (SELECT 1 FROM Operations o WHERE o.MembershipId = m.Id AND o.Action = 'leave') THEN N'left'
                    ELSE N'removed' END FROM Memberships m;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "RecipientUserId",
                table: "Invitations",
                type: "uniqueidentifier",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier");

            migrationBuilder.AddColumn<string>(
                name: "BabyBirthDate",
                table: "Families",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeleteOperationId",
                table: "Families",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeletedAt",
                table: "Families",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DeletedBy",
                table: "Families",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AccountDeletions",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OperationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RequestedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ReceiptHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountDeletions", x => x.UserId);
                });

            migrationBuilder.CreateTable(
                name: "OwnershipTransfers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FamilyId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FromUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ToUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    FromMembershipId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ToMembershipId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OwnershipTransfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OwnershipTransfers_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_FamilyId_Email",
                table: "Invitations",
                columns: new[] { "FamilyId", "Email" },
                unique: true,
                filter: "[Status] = N'pending'");

            migrationBuilder.CreateIndex(
                name: "IX_AccountDeletions_OperationId",
                table: "AccountDeletions",
                column: "OperationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OwnershipTransfers_FamilyId",
                table: "OwnershipTransfers",
                column: "FamilyId",
                unique: true,
                filter: "[Status] = N'pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Invitation v2 deletion barriers cannot be downgraded. Restore only through a reviewed procedure that replays deletions before enabling access.");
        }
    }
}
