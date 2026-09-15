using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LittleDays.FamilyApi.Migrations
{
    /// <inheritdoc />
    public partial class FullDomainFamiliesV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "BabyName",
                table: "Families",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(60)",
                oldMaxLength: 60);

            migrationBuilder.AddColumn<string>(
                name: "BabySex",
                table: "Families",
                type: "nvarchar(11)",
                maxLength: 11,
                nullable: false,
                defaultValue: "unspecified");

            migrationBuilder.AddColumn<byte[]>(
                name: "ProfileVersion",
                table: "Families",
                type: "rowversion",
                rowVersion: true,
                nullable: false,
                defaultValue: new byte[0]);

            migrationBuilder.AddColumn<int>(
                name: "SchemaVersion",
                table: "Families",
                type: "int",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<string>(
                name: "PendingEmail",
                table: "AccountDeletions",
                type: "nvarchar(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FamilyRecords",
                columns: table => new
                {
                    FamilyId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Collection = table.Column<string>(type: "varchar(5)", unicode: false, maxLength: 5, nullable: false),
                    IdHash = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Id = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    RecordJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    RecordedBy = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    LastEditedBy = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Deleted = table.Column<bool>(type: "bit", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FamilyRecords", x => new { x.FamilyId, x.Collection, x.IdHash });
                    table.CheckConstraint("CK_FamilyRecords_Collection", "[Collection] IN ('entry', 'care')");
                    table.CheckConstraint("CK_FamilyRecords_Json", "ISJSON([RecordJson]) = 1 AND DATALENGTH([RecordJson]) <= 131072");
                    table.ForeignKey(
                        name: "FK_FamilyRecords_Families_FamilyId",
                        column: x => x.FamilyId,
                        principalTable: "Families",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FamilyRecords");

            migrationBuilder.DropColumn(
                name: "BabySex",
                table: "Families");

            migrationBuilder.DropColumn(
                name: "ProfileVersion",
                table: "Families");

            migrationBuilder.DropColumn(
                name: "SchemaVersion",
                table: "Families");

            migrationBuilder.DropColumn(
                name: "PendingEmail",
                table: "AccountDeletions");

            migrationBuilder.AlterColumn<string>(
                name: "BabyName",
                table: "Families",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);
        }
    }
}
