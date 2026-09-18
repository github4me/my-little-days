# Apple Watch backend deployment — 18 September 2026

## Scope and preflight

Deploy the Watch-compatible API and additive DbUp migration `0006_FamilyPushAndTimerIndex.sql` using **Deploy family API and database**, from `feature/family-invitations`. This release does not publish mobile source, submit TestFlight, change infrastructure tiers or enable remote notifications.

Verified before release:

- Remote branch and local base: `44b351d99057ab64bc19bb6f13bba3c4a1ecf05d`.
- API/DbUp tests: 313 passed, zero failures/skips, using disposable local SQL databases.
- Live checksum/catalog verification passed for migrations 0001–0005; only 0006 is pending.
- Read-only active-timer scan found zero duplicate family/timer groups. No records were changed.
- SQL `little-days-family` remains Online, Basic/5 DTU/2 GiB. Backup retention remains seven days, differential interval 12 hours. This is configuration verification, not a restore drill.
- Existing SQL firewall rules, including the operator's retained IP, are unchanged.
- GitHub `family-database` and `family-pilot` restrict the release branch but currently have no required-reviewer gate. Do not assume dispatch pauses for approval.
- No `Push__*` or `Family__EnforceSingleActiveTimers` App Service overrides exist; shipped defaults are disabled.

## Release procedure

1. Commit/push only reviewed backend files through the GitHub plugin. Freeze the resulting release SHA; do not move the branch during migration approval/checks.
2. Open GitHub → Actions → **Deploy family API and database** → **Run workflow**. Select `feature/family-invitations`; confirm SQL bootstrap/migration review; leave legacy EF adoption disabled.
3. Require build/test success, then successful DbUp migration and cleanup, followed by API deployment. The workflow uses its built artifacts, not an independently rebuilt API.
4. Re-run the read-only DbUp pending check: require matching checksums/catalog and **zero** pending scripts. Confirm the four notification tables and timer index/runtime grants through the schema verifier.
5. Verify liveness after bounded startup backoff and the deployed revision. Liveness alone is not proof of authenticated family access.
6. Repeat the duplicate active-timer query after deployment. If duplicates exist, stop and ask the record owners; never auto-delete timers.
7. Once all writers use compatible code and duplicates are absent, set only `Family__EnforceSingleActiveTimers=true` in App Service → Environment variables → App settings. This globally prevents competing live feed/sleep timers and enables `watchRecordingEnabled` in fresh full-family snapshots. Wait for restart propagation.
8. Leave `Push__RegistrationEnabled`, `Push__EventCreationEnabled`, `Push__DeliveryEnabled` and `Push__AllowAllUsers` disabled. Before notification acceptance, configure the persistent 32-byte base64 token-encryption key, protected Expo sending token, project `a5210f78-8729-46d4-82a4-7d1d40d30ac6` and explicit consenting customer-account object-ID allowlist. Never put secrets in mobile variables, source or logs.
9. Install the combined iPhone/Watch build, open the signed-in phone app to refresh its authorized family snapshot, then test feed/nappy/sleep on paired hardware. Old iPhone builds remain compatible but do not gain a Watch companion.

## Rollback boundaries

Disable timer enforcement to withdraw family Watch capability on refresh if necessary; keep the additive schema. Do not rewrite migration history or remove user records. Push delivery remains separately disabled. A disconnected Watch cannot receive a configuration change instantly. Do not re-enable the legacy free-SQL-only infrastructure workflow.

## Execution evidence

Release execution and post-deployment results will be recorded here after the workflow completes. Physical Watch connectivity, notifications and TestFlight availability remain separate acceptance steps.
