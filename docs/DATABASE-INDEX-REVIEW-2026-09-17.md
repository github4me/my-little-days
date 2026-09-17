# Database design and index review — 17 September 2026

Implementation follow-up: the approved changes in migration `0005` and the API/migrator were deployed in [release 35172852363](https://github.com/github4me/my-little-days/actions/runs/35172852363). See [implementation, scaling limits and verified release evidence](DATABASE-SCALING-2026-09-17.md). The live evidence below remains the **pre-change** audit, not the post-release catalog.

## Conclusion and scope

**The indexes declared by migrations 0001–0004 are correctly applied to Azure SQL. The index design is not yet complete for invitation queries and account-deletion growth.** There is no observed missing deployment or disabled index to repair immediately. Use a new DbUp migration for approved improvements; do not edit an applied script or create indexes manually in production.

Reviewed the current API query patterns, EF model, frozen EF migrations, DbUp scripts and migration validation. Compared them with read-only metadata from `little-days-sql-522fpstfbtds2.database.windows.net / little-days-family`. The catalog snapshot was taken at **2026-09-17 01:38 UTC / 11:38 Australia/Sydney**. Estimated plans and a limited Query Store sample were also inspected. Backend/migrator source was unchanged from repository revision `649232233ea7f6575841b8f1aa96bbb282cef08f`.

No database schema/data, permissions, firewall rules or service settings were changed. No API mutations or load tests were run. No baby record bodies, names, email addresses, credentials or raw query plans are included in this report. Existing unrelated working-tree edits were preserved.

## Verified live

- All **four** DbUp journal entries exist; each SHA-256 matches the local script using the migrator's UTF-8 / LF normalization. No pending script exists in the reviewed source.
- All **19 indexes** exist with the expected ordered keys, uniqueness and filters: **8 application primary keys, 2 migration-journal primary keys and 9 secondary indexes**. None are disabled or hypothetical. No additional secondary indexes were present.
- All **6 foreign keys** are enabled/trusted and map each child table's `FamilyId` to `Families.Id`, with `NO_ACTION` delete behavior.
- All **4 CHECK constraints** are enabled/trusted and match the current collection/JSON size and legacy feed amount/interval rules.
- The three concurrency columns (`Families.ProfileVersion`, `FamilyRecords.Version`, `Feeds.Version`) are non-null SQL rowversion columns.
- Aggregate-only integrity checks found **zero** duplicate active memberships per user, active families without exactly one active owner, or accepted invitation references to a missing/mismatched membership.
- Query Store is `READ_WRITE`, capture mode `AUTO`. The missing-index DMV returned no suggestions; that does **not** prove the design is sufficient, especially with a very small current dataset.

The catalog contained only 126 shared records and 6 invitations at this checkpoint. This is not representative of a many-family production workload. No claim is made that the gaps below caused the earlier phone authentication delay.

### Secondary-index inventory

All keys below are ascending; none have explicit INCLUDE columns. SQL Server also carries the clustered key in nonclustered indexes where needed.

| Table | Index | Ordered keys | Uniqueness / filter |
| --- | --- | --- | --- |
| Families | `IX_Families_DeletedAt` | DeletedAt | `DeletedAt IS NOT NULL AND PurgedAt IS NULL` |
| Families | `IX_Families_DeletedBy_DeletedAt` | DeletedBy, DeletedAt | Nonunique, unfiltered |
| Memberships | `IX_Memberships_UserId` | UserId | Unique; `Active = 1` |
| Memberships | `IX_Memberships_FamilyId_UserId_Active` | FamilyId, UserId, Active | Nonunique, unfiltered |
| Invitations | `IX_Invitations_FamilyId_Email` | FamilyId, Email | Unique; `Status = N'pending'` |
| OwnershipTransfers | `IX_OwnershipTransfers_FamilyId` | FamilyId | Unique; `Status = N'pending'` |
| Operations | `IX_Operations_FamilyId` | FamilyId | Nonunique, unfiltered |
| AccountDeletions | `IX_AccountDeletions_OperationId` | OperationId | Unique, unfiltered |
| AccountDeletions | `IX_AccountDeletions_Status_RequestedAt` | Status, LastIdentityAttemptAt, RequestedAt | Nonunique, unfiltered |

Application clustered primary keys: `Families(Id)`, `Memberships(Id)`, `Invitations(Id)`, `OwnershipTransfers(Id)`, `AccountDeletions(UserId)`, `Feeds(FamilyId, Id)`, `FamilyRecords(FamilyId, Collection, IdHash)` and `Operations(UserId, OperationId)`. No redundant duplicate secondary indexes were found.

## Findings

### DBI-01 — P2: invitation inbox has no email-leading index

**Evidence:** `FamilyService.cs:54–60` matches pending invitations by email and expiry across families, then orders by creation time. The only invitation secondary index starts with `FamilyId`; it cannot seek directly to one recipient's inbox. The live catalog confirms there is no email-leading alternative. A simplified estimated SELECT using a synthetic email compiled to `PK_Invitations` scan plus sort. With only six invitations a scan can be an appropriate optimizer choice; the structural gap, not that small-table choice alone, is the finding.

**Impact:** sign-in/account refresh and invitation consent/decline work can scan invitations from unrelated families as the service grows. `Me` also runs the inbox query for an existing family member, then discards its result at line 62.

**Recommendation:** preserve the existing unique pending-invitation index and add a narrow recipient-leading pending index. A candidate is `(Email, ExpiresAt) INCLUDE (FamilyId, CreatedAt) WHERE Status = N'pending'`; measure the remaining newest-first sort and EF-generated plans on representative data before finalizing. Skip the inbox lookup when a verified active family already makes that inbox inapplicable. No product policy change is required.

### DBI-02 — P2: invitation history lacks an unfiltered family index

**Evidence:** `FullFamilyService.cs:179` and `FamilyService.cs:111–112` read every invitation status for one family, pending-first/newest-first, limited to 100 results. The pending-only unique index cannot cover access to accepted, declined, expired or revoked rows. A synthetic-family estimated SELECT used a clustered scan and sort. `DeletionWorker.cs:38–39` likewise deletes all invitation/ownership-transfer statuses for a family, while those tables only have pending-filtered family indexes.

**Impact:** a result limit of 100 does not prevent scanning global history. A family's refresh or eventual cleanup becomes dependent on other families' history size.

**Recommendation:** add an unfiltered `Invitations` index beginning with `FamilyId`, for example `(FamilyId, CreatedAt DESC)` with a small measured INCLUDE set. The pending-first `CASE` expression can still require a family-local sort; this candidate is not claimed to eliminate it. Evaluate an unfiltered `OwnershipTransfers(FamilyId)` index for cleanup at the same time. Do not replace filtered unique indexes that enforce current invitation/transfer rules.

### DBI-03 — P3: purge index works, but is not covering

**Evidence:** migration `0004_FamilyAvailabilityBounds.sql:5–6` filters on `PurgedAt IS NULL` but stores only `DeletedAt`. For the worker's `TOP(10) Id` query (`DeletionWorker.cs:27–28`), the live **estimated** plan used `IX_Families_DeletedAt` plus a clustered-key lookup to `PK_Families`; the same access pattern compiled with the index explicitly hinted. Therefore, the index is **not** demonstrated to be unused or broken on this Azure database.

**Recommendation:** add `INCLUDE(PurgedAt)` through a new migration and verify that the actual worker query becomes covering. Microsoft documents the importance of retaining the null-tested column in this type of filtered index. This is a narrow optimization, not an outage fix. [Microsoft filtered-index guidance](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/performance/filtered-index-with-column-is-null)

### DBI-04 — P2: deployment checks do not detect live index drift

**Evidence:** `0002_VerifyBaselineAndRuntimeGrants.sql:20–32` checks four unique index names, uniqueness and whether a filter exists, but not ordered key columns or the actual filter. It omits the other secondary index definitions. FK verification counts relationships instead of matching each column mapping. The script runs only once; `MigrationRunner.cs:77–89` subsequently validates journal names/checksums, not the current catalog.

**Impact:** a later accidental drop or same-name replacement with incorrect keys/filter can leave the migration check green. The explicit catalog audit in this review found no such drift, but that is not currently a release guarantee.

**Recommendation:** add a read-only, schema-version-aware verifier that runs on no-op checks and after migration, with tests for missing/disabled indexes, wrong key order, uniqueness, INCLUDE/filter differences and incorrect/untrusted constraints. Gate verification by applied schema version so legitimate pending upgrades are not blocked. Keep the applied scripts immutable.

### DBI-05 — P3: current model omits two deployed indexes

`PilotDatabase.cs` declares neither `Families(DeletedBy, DeletedAt)` nor `AccountDeletions(Status, LastIdentityAttemptAt, RequestedAt)`, although migration 0004 and Azure both contain them. Production and SQL fixtures use DbUp, so this is model/documentation consistency debt, not a missing live index. Align the current model when implementing the next index migration. Historical EF snapshots are intentionally frozen for adoption tests and should not be rewritten.

## Database design observations and growth risks

The family-first record primary keys correctly constrain normal record lookups, updates and snapshots to one family. The active-user filtered unique index enforces one active family per user; operation primary keys protect idempotency. Restrictive foreign keys, rowversion concurrency and separate deletion tombstones are appropriate foundations for access revocation and cleanup. Entity lifecycle consistency still relies on the service's transactions/application locks; there is no database constraint enforcing exactly one active owner or all status/role transitions. The aggregate checks above passed, so this is defense-in-depth work, not observed corrupt data.

Two performance concerns need more than an index:

1. **Account deletion scans global data while holding the lifecycle lock.** `DeletionWorker.cs:55–76` finds/deletes records by `RecordedBy OR LastEditedBy`, historical memberships by `UserId`, invitations by recipient/email, and transfers by participant. Matching unfiltered author/history indexes are absent. `FamilyService.cs:25–31` holds the global exclusive application lock during this work. Ten-job batching limits accounts, not rows belonging to one account. Before significant growth, test the author/recipient access paths with representative data, add only justified indexes, and design bounded deletion transactions that preserve immediate access revocation and recovery safety. Do not add every possible index without measuring the write/storage cost.

2. **Unchanged sync still performs payload work.** `FullFamilyService.cs:175–181,201–235` aggregates whole-family record sizes, processes JSON/extras (including avatars), and then reads the snapshot. Query Store plans 22/23 (queries 106/107) confirmed family-record aggregate **clustered index seeks**; the inspected small-data averages were about 0.25/0.40 ms, not evidence of a current slow query. An ordinary extra index cannot remove all LOB processing. The server supports conditional snapshots at `FullFamilyService.cs:92–101`, but `src/family/api.ts:109` does not send `If-None-Match`; `useFamilyPilot.ts` schedules idle refreshes around 30 seconds. Consider conditional requests first, then carefully maintained byte/count metadata if measurements justify it. Incoming invitations across different families are also uncapped and can cause per-family lookups during bulk decline.

The identity-deletion retry index matches `(Status, LastIdentityAttemptAt, RequestedAt)` ordering. The separate initial pending-job query orders only by `RequestedAt`; it may need a small status-partition sort. This is lower priority than global invitation/history and author scans and does not justify another index without workload evidence.

## Recommended next change and validation

This review does not authorize live index creation. If implementation is requested:

1. Add a new numbered DbUp migration (next currently available number: `0005`) for the agreed invitation indexes and covering purge index correction; evaluate transfer-history indexing. Preserve all existing unique constraints.
2. Align the current EF model and implement the repeatable schema/index verifier. Add tests for both clean installation and upgrade from 0004, plus wrong/dropped index definitions.
3. Test generated query plans on a **local/disposable** SQL database with many families, pending/expired invitations, long histories and deletion workloads. Check read savings, sort behavior, write overhead and concurrency. Do not generate synthetic records in the live database.
4. Deploy through the existing **Deploy family API and database** workflow after review. Index creation/rebuild may take locks and consume SQL capacity; choose an appropriate window. Do not alter old journals or run an ad hoc production migration.
5. Repeat the live catalog comparison, verify migration checksums, then compare representative Query Store durations/reads before and after. Perform normal signed-in phone refresh and sync checks; no Expo/TestFlight build is needed for index-only changes.

Azure Query Store `AUTO` capture was sparse, and some text-search matches were administrative metadata queries rather than application traffic; those were excluded from application performance conclusions. The simplified invitation/purge plans were compile-only (`SHOWPLAN_XML`), not actual workload traces. No production load benchmark, fragmentation maintenance, restore exercise or new test suite was run for this read-only review. [Microsoft Azure SQL performance guidance](https://learn.microsoft.com/en-us/azure/azure-sql/database/performance-guidance?view=azuresql) and [Query Store guidance](https://learn.microsoft.com/en-us/sql/relational-databases/performance/best-practice-with-the-query-store?view=sql-server-ver17) support validating proposed indexes against the workload rather than blindly applying suggestions.
