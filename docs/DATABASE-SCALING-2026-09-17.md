# Database indexes and operation-history scaling — 17 September 2026

Status: **implemented locally; not deployed**. This follows [the database review](DATABASE-INDEX-REVIEW-2026-09-17.md). The API and DbUp migrator change together; no mobile, Expo, TestFlight, Bicep, Entra or resource-name change is needed.

## What changes

New immutable migration: `server/LittleDays.DatabaseMigrator/Scripts/0005_QueryIndexesAndOperationCounts.sql`. Previously applied scripts `0001`–`0004` remain unchanged.

| Access path | Change |
| --- | --- |
| Invitation inbox and email-based account erasure | `(Email, Status, ExpiresAt) INCLUDE (FamilyId, CreatedAt)`; unfiltered so one index also covers historical email lookup |
| Family invitation history and cleanup | `(FamilyId, CreatedAt DESC)` |
| Recipient-based invitation cleanup | `(RecipientUserId) INCLUDE (FamilyId)` |
| Transfer history and participant cleanup | Unfiltered `(FamilyId)`, plus `(FromUserId)` and `(ToUserId)`, each including `FamilyId` |
| Historical memberships for account cleanup | `(UserId, FamilyId)` |
| Authored/edited records for account cleanup | Separate `RecordedBy` and `LastEditedBy` indexes on both `Feeds` and `FamilyRecords`; their clustered keys already carry `FamilyId` |
| Closed-family purge selection | Retain the existing filter/key and include `PurgedAt`, avoiding the extra clustered-key lookup in the tested plan |

These are 11 added secondary indexes and one revised covering index. Existing filtered unique indexes still enforce one active membership, one pending invitation per family/email and one pending ownership transfer. No JSON, image, note or receipt-result payload is added to index INCLUDE columns. The current EF model now matches these indexes and the two previously omitted `0004` indexes.

Family history can still require a family-local pending-first sort. Indexes improve access paths, not every sort or the cost of returning large payloads. Each additional index also consumes storage and adds write maintenance.

## Operations: avoid history-size work on each write

`Operations` is a durable idempotency journal. Deleting old receipts from active families could let an old mobile retry execute twice. This change **does not add TTL deletion, discard receipts or rebuild the existing receipt primary key**.

- Keep clustered `(UserId, OperationId)` for exact retry lookup and account erasure, and `IX_Operations_FamilyId` for family erasure.
- Introduce `FamilyOperationCounts`: one small row per family that has or previously had receipts, with a `bigint` count, family primary/foreign key and nonnegative CHECK. Zero-count rows are retained; a family with no receipt/counter reads as zero.
- Ordinary capacity checks read this one indexed scalar instead of `COUNT(*)` over the family's whole receipt history. Existing operation IDs, fingerprints and replay validation remain unchanged.
- A set-based SQL trigger maintains counts in the **same transaction** as receipt insert/update/delete, including multirow changes, rollback and cleanup. Range locks protect concurrent first receipts. The counter is separate from `Families`, so bookkeeping does not change `ProfileVersion`.
- The runtime receives SELECT only on the counter table. The same-owner trigger performs its writes; the app is not given counter-editing or schema permissions.
- Closed-family and deleted-account receipt cleanup commits batches of at most **1,000 rows** and releases application locks between them. Durable closure/deletion state continues denying access and retries throughout cleanup. Cancellation/crash leaves the job pending; it resumes without deleting receipts outside the closed family or deleted account's scope. An account's deletion intentionally spans that user's receipts across all families.

The current `Pilot__MaxOperationsPerFamily` default remains **100,000 retained receipts per family**. Its configured maximum remains 1,000,000. This safety policy is not silently raised; an exact replay is still allowed at the limit, but new capacity-checked operations are rejected. Many families may together have far more rows. The counter avoids repeated linear counting, but does not make SQL storage, writes, indexes or backups cost-free.

### Bulk tools and maintenance

Normal SQL DML, EF inserts and EF set-based deletes fire the trigger. A future `SqlBulkCopy` importer must explicitly use `SqlBulkCopyOptions.FireTriggers`; otherwise it can leave counters stale. Do not disable the trigger, directly edit counters, truncate receipts or use partition switching as a shortcut. Any future bulk/archive/rebuild tool needs a reviewed transactional reconciliation design and tests first. [Microsoft's multirow trigger guidance](https://learn.microsoft.com/en-us/sql/relational-databases/triggers/create-dml-triggers-to-handle-multiple-rows-of-data?view=sql-server-ver17)

The new EF mapping disables direct SQL OUTPUT for this trigger-bearing table. Compatibility tests also cover the previous API model's single and batched receipt inserts, because that API remains running during the schema-first release. [EF SQL Server trigger guidance](https://learn.microsoft.com/en-sg/ef/core/providers/sql-server/misc)

## Other query and verification changes

- `/me` does not query an inbox it will discard when the account already has an active family.
- Creating a family or accepting an invitation loads other affected families in batches of 256, not one query per family. Consent, automatic declines and revision updates still commit atomically under the existing lifecycle lock. The batch size bounds each family lookup's result and parameter count with a large cross-family inbox; it is not a claim that EF's existing large-collection translation is broken.
- Every DbUp pending/no-op check validates the approved catalog for the **currently applied version**. Each new script is checked before its journal entry, inside the same transaction. Drift or failed verification rolls back the pending migration transaction; the migrator does not silently repair unknown changes.
- Verification checks ordered index keys/directions, uniqueness, clustering, INCLUDE columns, filters, enabled state, exact foreign-key mappings/actions, trusted CHECK definitions and the expected enabled insert/update/delete trigger body. It also verifies critical non-null rowversions, feed decimal precision, and counter GUID/bigint columns. It preserves parentheses and literal contents when comparing SQL expressions. Tests cover clean installs, historical EF adoption and upgrades from each prior DbUp stage.
- Keep the schema verifier's version contract in sync with every future migration. Azure automatic index creation or an operator's additional index on a managed table is not silently approved. Investigate catalog drift and incorporate an intentional change into a reviewed migration/verifier update; do not delete journal entries or relax checks to make a release green.

## Step-by-step deployment when approved

1. **Source/review:** review `0005`, the matching API and migrator changes, and local/CI results. Commit/push the reviewed files through the GitHub plugin to the current trusted release branch. This implementation task has not performed that release.
2. **Azure portal → SQL database → Backups / Monitoring:** confirm the existing database's recovery capability and available storage/compute. Choose a quiet window. New indexes need build space; the receipt backfill holds `TABLOCKX` until the DbUp transaction installs the trigger and commits. It deliberately blocks receipt writes during that one-time window so counts cannot miss a concurrent write. Duration depends on live rows and service capacity; this is not a zero-downtime guarantee.
3. **GitHub → Actions → Deploy family API and database → Run workflow:** select the trusted branch (currently `feature/family-invitations`). Confirm **SQL identities and runtime role are bootstrapped; I reviewed this release's SQL changes**. Leave **Adopt a reviewed existing database with legacy EF history** unchecked. No bootstrap rerun, new identity, secret, firewall list or app setting is needed.
4. **Review before dispatch:** the last observed `family-database` and `family-pilot` environments had no required reviewers. Do not assume the run will pause for approval. Check their current protection settings and complete review before starting. If reviewers have since been configured, approve the appropriate database/API gate when ready. Do not change these settings merely to run this migration.
5. **Watch CI and database job:** CI must include real disposable SQL tests, not skipped SQL tests. The helper first runs the non-mutating pending/catalog check. On the known `0004` database the pending script should be `0005_QueryIndexesAndOperationCounts.sql`. DbUp applies it once, verifies the resulting catalog before journaling, and the helper removes its exact temporary runner-IP rule. Database failure or firewall-cleanup failure must block API deployment.
6. **API deployment:** allow the same workflow to deploy the matching API only after SQL succeeds. The new API needs `FamilyOperationCounts`, so do not deploy its package first. If migration succeeds but API deployment fails, retain the successful migration and fix/retry the compatible release. Do not drop the counter table/trigger or rewrite applied scripts to roll back.
7. **Verify without changing family data:** check `/health/live`, then signed-in account/family refresh on an existing phone. Exercise an ordinary intended record save and sync during the next normal use; do not seed synthetic load into Azure or remove real people to test cleanup. A 200 liveness response alone does not verify SQL, identity or sync.
8. **SQL check if needed:** using the already configured SQL admin connection to `little-days-family`, read `SELECT ScriptName, Sha256, AppliedAt FROM dbo.DatabaseMigrations ORDER BY ScriptName;`. Expect the new `0005` row, not a reset journal. A repeat migrator `--check` must report no pending scripts and pass the catalog checks. It does not recalculate every family's counts; a full aggregate reconciliation is an optional reviewed maintenance check, not a new every-startup scan.
9. **Monitoring:** compare real application Query Store reads/durations, SQL CPU/log/storage and worker failures after release. Do not publish record bodies or raw personal query parameters in logs. Record the release SHA/run link, migration result and signed-in checks in the manual runbook. No Expo publication or new iPhone build is required for these backend-only changes.

If a migration SQL command exceeds the migrator's existing five-minute execution timeout on a future large database, stop and investigate the actual failing statement, blocking and resource headroom. This is a per-command timeout, not a five-minute upper bound for the whole transaction; the workflow also has its own job timeout. Do not blindly retry repeatedly or simply remove transaction protection. Design a separate staged/backfilled release before a dataset grows beyond this migration approach.

## Verification and remaining limits

Verification on 17 September 2026:

- `dotnet test server/LittleDays.slnx --configuration Release --no-restore` and the final rebuilt-API/full-solution rerun passed against disposable **local SQL Server**, with **193 API tests + 58 migrator tests**, zero failures/skips. Fixtures create/remove only their own generated test databases; Azure was not used.
- Backfill preserved **103,000 receipts** (100,000 in one family) and profile versions. Tests cover transactional multirow count changes/rollback, concurrent first inserts, existing bootstrap/runtime permissions and schema-first old-API inserts.
- Plan checks over 1,000 synthetic families, 10,000 invitations and 10,000 compact JSON records selected the new inbox/history/author/recipient indexes; the purge plan no longer required the clustered-key lookup. These are controlled estimated-plan checks, not measured Azure latency improvements.
- API checks cover consent/revision atomicity, a 257-family inbox, exact retries at capacity, interrupted receipt cleanup, between-batch lock release and account cleanup with 2,201 historical families/emails. The latter also verifies the current provider's large-collection translation; no unproven parameter-overflow fix was added.
- `npm run verify` passed TypeScript and the existing app/helper/controller/UI/native-security mock suites. Browser, native-device and live Azure load testing were not run for this backend-only change.

Synthetic test data is local only; this is not an Azure production load benchmark. After deployment, compare actual Query Store and resource metrics before claiming production performance gains.

Still intentionally unchanged:

- Non-receipt content cleanup remains a lifecycle transaction. The new author/participant indexes avoid unrelated-table access where the optimizer uses them, but a single account with many records across many families can still need substantial cleanup work. Only the Operations purge is row-batched in this change.
- Full snapshots, avatars/JSON size aggregation and the mobile client's unused conditional snapshot support still need a separately measured sync optimization. Adding another index cannot eliminate all payload work.
- Incoming invitations across families remain uncapped by product policy. Batching removes the N+1 family lookup and bounds individual queries, not all memory/transaction work for an exceptionally large inbox.
- No partitioning, automated index rebuild job, compression policy, retention-policy change or SQL tier resize is introduced without workload evidence and separate review.
