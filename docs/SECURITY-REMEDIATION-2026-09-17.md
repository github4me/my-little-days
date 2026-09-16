# Security remediation and release checklist — 17 September 2026

This follows [the source security review](SECURITY-REVIEW-2026-09-17.md).
Code implementation, deployment and operational/device acceptance are separate.
The preview connects to production family data; do not test destructive flows on
real families or restore a production database as a smoke test.

## Finding disposition

| Finding | Candidate change | Remaining acceptance |
| --- | --- | --- |
| SEC-01 | Isolated authenticated-account and anonymous rate budgets; authenticated users no longer share the anonymous allowance. | Deploy API; observe authenticated failures/429s separately from liveness. Limits remain per instance, not a DDoS perimeter. |
| SEC-02 | Aggregate payload/count budgets, bounded snapshot serialization, authorized conditional reads before materialization, per-family locking for ordinary operations, and bounded completed-purge tracking. | Apply DbUp 0004 before API deployment; review existing history sizes and monitor operational load. Isolated boundary/concurrency tests passed. No pagination contract change. |
| SEC-03 | Explicit `Recovery:Blocked` maintenance gate blocks all API data routes and pauses deletion processing; readiness reports blocked while liveness remains available. | **Not closed:** independent complete recovery evidence/replay and an isolated restore drill are still required. The gate does not automatically detect an old database or reconstruct missing decisions. No production restore is authorized. |
| SEC-04 | Durable notification-cleanup journal, independent cancellation/dismissal attempts, startup retry and fail-closed delivery. | Native notification acceptance on a disposable device, including restart and injected OS/storage failure. |
| SEC-05 | New iOS native module excludes persistent `Documents/SQLite` from OS backup on launch and verifies protection before family DB access. Covers existing databases and future WAL/SHM files without migration or purgeable storage. | New native binary required; inspect signed-device attributes and perform disposable backup/restore. Earlier backups cannot be recalled. |
| SEC-06 | Picked and migrated avatars pass bounded native decode/orientation/resize/re-encode plus metadata stripping. Original bytes never become a new shared upload. | New native image-manipulator dependency requires rebuild; synthetic metadata/orientation test on Android/iOS. Existing server photos are not silently rewritten. |
| SEC-07 | Every workflow action pinned to an official full commit SHA, including artifact tools; regression policy rejects mutable/unreviewed refs. | Review actual GitHub protections/permissions; review upstream changes before future pin updates. |
| SEC-08 | New native runtime disables remote OTA execution by default. Only a new signed native app build delivers code until an approved signed-OTA rollout. | Existing 0.2.0 installations must upgrade. Enabling signed OTA requires an eligible Expo plan, privately held key, new embedded certificate/runtime and device signature tests. No plan upgrade or key creation performed. |
| SEC-09 | Migration preflight rejects broad ranges, all-Azure access, noncanonical/non-public IPs, duplicate rule names and stale runner rules, before and after adding its own exact-IP rule. | The operator declined a manually maintained GitHub allowlist. Existing exact-IP rules are accepted without independent address approval; ownership/continued need remains an operator review responsibility. Unrelated rules are never automatically removed. |

The vulnerable `xcode` transitive `uuid` is narrowly overridden to patched
CommonJS-compatible `11.1.1`. Regression tests exercise xcode's PBX ID generation
and the advisory's buffer-boundary rejection. No Expo downgrade is used.
The obsolete pilot technical plan is explicitly marked historical. Existing
account-deletion attribution policy is retained, not silently redesigned.

## Required GitHub/Azure steps before deploying the API

1. In Azure Portal select subscription **Azure subscription 1**, resource group
   **my-little-days-pilot-rg**, SQL server **little-days-sql-522fpstfbtds2**.
   Open **Networking → Firewall rules**. Privately record each rule's name,
   start IP and end IP. Do not change or delete rules as part of inspection.
2. Open App Service **little-days-api-522fpstfbtds2 → Properties** and inspect its
   current and possible outbound IP addresses. The existing Bicep intentionally
   creates exact rules for `possibleOutboundIpAddresses`; compare against that
   reviewed scope, not only the smaller current subset. Review any operator rule
   separately with its purpose/expiry.
   Reject ranges and `0.0.0.0` (“Allow Azure services”), and investigate stale
   `github-db-*` rules. Do not approve the observed list blindly.
3. No new GitHub firewall variable is required. The updated helper reads live
   rules and automatically rejects unsafe rule shapes and stale runner access.
   If `FAMILY_DB_APPROVED_FIREWALL_RULES_JSON` was already added under
   **Settings → Environments → family-database → Environment variables**, it can
   be removed or left unused. The helper no longer reads it. Existing exact-IP
   app and operator rules are preserved; this is not automatic approval of their
   ownership or continued need. Do not broaden SQL access to bypass a failure.
4. Verify protected environments, reviewers, trusted branch and OIDC bindings
   from the existing runbook remain in place. The new action pins do not grant
   permissions or bypass approvals.
5. Run **Actions → Deploy family API and database → Run workflow**, select
   **feature/family-invitations**, and review the automatically selected commit.
   Confirm SQL bootstrap/migration review. Leave legacy adoption off for the
   existing DbUp-managed database.
   Before approving the new limits, have the operator inspect only aggregate
   record counts/serialized-size estimates on the existing service (no child
   payloads in logs). Bounded legacy histories above the new count cap remain
   readable, and growth is restricted; do not use a migration to delete history.
   A history already larger than the response-byte cap needs a reviewed recovery/
   pagination plan before rollout. Contact support rather than clearing phones.
6. Approve the database job only after reviewing additive migration
   `0004_FamilyAvailabilityBounds.sql`. It adds purge bookkeeping/indexing; it
   must run before the new API code. Do not edit an already-applied migration.
7. Confirm migration success and that the run's own `github-db-*` rule was
   removed, then approve the API deployment. Check `/health/live` and
   `/health/ready`, plus authorized synthetic read/write isolation. Readiness
   currently checks the recovery gate, not SQL/Graph connectivity; neither health
   endpoint alone is security acceptance.
8. Record deployed commit, migration journal result, redacted firewall review,
   identity/role checks and alert ownership. Never put access tokens, credentials,
   deletion receipts or actual child records in the evidence document.

## Restore safety — mandatory stop point

Do not perform or expose a restored database until independent deletion,
membership-removal, family-closure and ownership-transfer decisions can be fully
reconciled. The existing SQL backup alone cannot prove what happened afterward.

1. Use an isolated target and synthetic records for the drill; retain the live
   service and data unchanged. Obtain explicit authority before creating paid
   resources or restoring any database.
2. Stop/drain all target API requests and workers first; the gate does not abort
   already-running SQL or directory calls. Before any API/worker is connected to
   the restored target, set App Service
   **Settings → Environment variables → App settings** `Recovery__Blocked=true`.
   Keep target public traffic restricted independently. Save/restart the target
   service and verify `/health/ready` returns `503` with `recovery_blocked`.
   ALL `/v1` and `/v2` routes, including deletion-status lookup, must return the
   blocked response. The deletion worker must not call the identity directory.
3. Reconcile every post-recovery-point deletion/removal/closure/transfer from
   a complete restricted record outside the restored SQL database. Rotate the
   target `Family__HistoryId` only as part of this reviewed recovery procedure;
   this is necessary for stale writes but is not a replacement for reconciliation.
4. Independently check removed members/admins cannot regain access, deleted
   content/identities do not return, and stale mobile operations are rejected.
   Record actual retention of SQL backups, logs and CI artifacts and who approved
   reconciliation. A guessed retention period is not evidence.
5. Only an authorized operator with complete passing evidence may clear
   `Recovery__Blocked` and expose the reconciled target. If the external evidence
   is missing, incomplete or unordered, **keep it blocked**. Do not tick a box
   merely because the restore command succeeded.

The maintenance setting defaults to false so an ordinary upgrade does not shut
down the current live service. It is an operator safety control, not an independent
ledger or automatic restore detector. An external recovery ledger/storage design
and its access/retention setup remain a separate prerequisite for reliable restore.

The independent ledger must cover exact membership grants, accepted/cancelled
ownership transfers, invitation terminal states, family closure, account deletion
and exact affected record IDs (including ordinary record deletions). Replaying
only a deleted user's ID is insufficient: a restored record can have an older
last-editor attribution. A SQL-only asynchronous outbox cannot guarantee this,
because a restore can lose both the mutation and its unpublished event. Any
future implementation needs durable external prepare/commit evidence, stable
idempotency IDs and a rule that unresolved prepares keep recovery blocked. A
reviewed first-enable baseline/earliest supported restore point is mandatory;
new logging cannot reconstruct unrecorded historical decisions.

Availability residual: completed-family cleanup is now batched and marked, but
one account's lifetime cleanup still uses a global lifecycle transaction. Observe
its latency and queue depth before higher traffic; no production-scale load test
or claim of a per-account hard cleanup-time bound is made here.

## Preview/mobile rollout

1. Install a new iOS preview binary for version **0.2.1**, build **19 or later**, runtime
   **0.2.1**, using the existing preview environment and registered phones.
   The latest verified build is **21** ([installation](https://expo.dev/accounts/expo4chao/projects/little-days/builds/4277a9b9-8ece-47cc-a495-a79f4fd00c39)); it includes the security changes and later authentication recovery fixes. Do not downgrade to build 19.
   Publishing JavaScript to the old 0.2.0 runtime cannot add the backup module or
   image-manipulator dependency. Do not uninstall the data-bearing old app first.
2. The candidate has `updates.enabled=false`: preview means an internal native
   build, not an unsigned OTA. Existing 0.2.0 apps are not retroactively protected
   by this setting; upgrade the installed binary. This does not submit TestFlight.
3. Verify the new backup attributes on a disposable iPhone and perform an actual
   backup/restore check. The whole SQLite directory is excluded, including personal
   offline records; manual personal export remains available. Unsynced family work
   remains in persistent storage for normal restarts, but is not an OS backup.
4. Test notification cleanup on leave/logout/removal, including a restart after a
   partial cancellation failure. Personal notifications must not be cancelled by
   family cleanup. A disconnected device still cannot know a new remote removal.
5. Use a synthetic EXIF-orientation/GPS image on Android and iOS, both freshly
   picked and migrated from personal mode. Verify upright rendering and no hidden
   source metadata in newly shared bytes. Old shared photos require a separate
   authorized replacement if their metadata must be removed.
6. Repeat the [two-phone API responsiveness checks](API-RESPONSIVENESS-REVIEW.md)
   and the existing family create/join/conflict/deletion acceptance checklist.

### Optional future signed OTA

[Expo requires Production or Enterprise for EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/).
No subscription upgrade is assumed. After approving that route:

1. Have the release owner generate a signing key **outside the repository** using
   Expo's `expo-updates codesigning:generate`. Store its encrypted backup/access
   policy separately from normal Expo publishing credentials. Never upload the
   private key into EAS build sources, GitHub source or this chat.
2. Commit only the public verification certificate. Configure
   `updates.codeSigningCertificate` and `updates.codeSigningMetadata`
   (`keyid`, `alg: rsa-v1_5-sha256`), then explicitly re-enable updates.
3. Assign a new runtime version and build/install a new signed native candidate.
   Merely adding a certificate to JavaScript cannot change an installed binary's
   trust anchor. Publish using `eas update --private-key-path <private path>`.
4. In an isolated preview, prove an authorized update loads and unsigned/wrong-key
   updates do not; then test key rotation/recovery with another new runtime.
   Only afterward approve production-channel publishing. Loss of the key requires
   a new native build; never disable verification as an emergency shortcut.

Apple's [backup-exclusion guidance](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup)
supports the directory attribute; source/VM tests are not a substitute for the
signed-device checks above.

## Backend deployment preflight — 17 September 2026 (Sydney)

Read-only Azure/GitHub inspection found 33 exact-IP server firewall rules: 32
match the App Service possible outbound set provisioned by Bicep, and one is an
operator-style client rule. After considering removal, the operator explicitly
chose to retain that exact client-IP rule for SQL administration. The live set
was rechecked unchanged on 17 September; no rule was removed or broadened.
The operator subsequently declined the duplicate GitHub IP-list requirement.
The updated helper accepts all 33 existing exact-IP rules without such a list,
while still rejecting broad access and stale runner rules. No automatic expiry
was requested; review continued need before each release and whenever the
operator's network address changes.
No broad ranges, all-Azure rule or stale `github-db-*` rule were present at this
inspection. The operator address is intentionally not committed to this public
document. Recheck live rules before deployment; this is not approval of an
unexplained rule or proof of database-level firewall/RBAC settings.

The latest successful GitHub API/database release found was
[35066678308](https://github.com/github4me/my-little-days/actions/runs/35066678308),
commit `7cf0dab71ad3ed3a8668d26c573d893e5ec0d73b`, before the security release.
No new deployment or cloud change was performed during this preflight. Next:
publish/use the updated workflow without the IP-list requirement, review
aggregate history sizes and migration 0004, then start the reviewed workflow.
Do not rerun Bicep, rotate `Family__HistoryId`, or enable `Recovery__Blocked` for
this ordinary in-place upgrade. SEC-03 remains open for any future restore.

## Release evidence — 17 September 2026 (Sydney)

- Code committed/pushed with the GitHub plugin on `feature/family-invitations`:
  [`9c2fef26266bb332e8f8d7741f25e3f4a46ea34d`](https://github.com/github4me/my-little-days/commit/9c2fef26266bb332e8f8d7741f25e3f4a46ea34d).
  The remote tree matched the tested local index. Earlier sleep/recording-response
  changes are included; unrelated local `work/` and verification output folders
  were not committed or uploaded to EAS.
- Local verification: 384 mobile unit/controller/UI/native-adapter tests;
  183 API + 11 DbUp tests against generated disposable local SQL databases,
  all passed with no SQL skips; browser regression and Web/iOS Hermes exports
  passed. Eighteen action/workflow policy tests passed. npm and .NET dependency
  reports found no known vulnerable packages in the checked dependency set.
- [EAS iOS preview build](https://expo.dev/accounts/expo4chao/projects/little-days/builds/4b6dc6c8-4c8a-438d-bce5-8d1b00cca534)
  **FINISHED** at `2026-09-16T18:05:22.831Z` (17 September in Sydney).
  Build ID `4b6dc6c8-4c8a-438d-bce5-8d1b00cca534`, source commit above,
  version **0.2.1**, build **19**, internal distribution, preview environment,
  existing two registered iPhones. Native logs include successful packaging of
  `FamilyStorageSecurity`; the image-manipulator native dependency is included.
- Expo Doctor reported non-blocking existing splash-schema and available SDK
  patch-version warnings. They did not fail the native build and were not
  suppressed; they remain a separate maintenance follow-up.
- No OTA was published, no TestFlight submission was made, and no production
  API/SQL migration or Azure settings change was performed. This is a successful
  signed build, **not** physical-device backup/notification/orientation acceptance
  or proof that SEC-03 is closed. Follow the manual prerequisites above before
  releasing the backend, and keep restored service traffic closed without
  independent reconciliation evidence.
