# My Little Days — project lessons and working memory

Last reviewed: **17 September 2026**, after the in-place SQL Basic conversion.

This retrospective records the project's observed failures, decisions and safeguards—not a new security audit or a claim that every device scenario passed. Durable rules live in [AGENTS.md](../AGENTS.md); current environment values and deployment evidence belong in the [manual runbook](AZURE-MANUAL-SETUP-RUNBOOK.md). Historical observations below must not be treated as today's live configuration without checking.

## Main conclusion

Most repeated failures happened at boundaries, not in the core recording logic: cloud configuration versus code assumptions, authentication versus authorization, local persistence versus server acknowledgement, and build/deploy success versus actual availability. The fastest reliable approach is to identify the failing boundary, verify its real inputs, change only that part, then test the user-visible outcome.

We should have established a clearer identity/configuration inventory, production terminology and end-to-end acceptance path earlier. Several rounds of user screenshots and manual Azure setup could have been avoided. The user's physical-phone testing exposed important gaps that browser tests and healthy endpoints did not cover.

## 1. Setup and deployment lessons

| What went wrong / evidence | Lesson and future action |
| --- | --- |
| Setup failed on lowercase `SQL_ADMIN_PRINCIPAL_TYPE=user`, existing-plan validation and runtime-catalogue parsing. | Publish exact accepted values. Validate actual Azure response shapes, including representation differences, instead of assuming one example response. Keep cost/target/security checks; fix incorrect parsing rather than bypassing them or resizing resources. |
| Role-assignment instructions left the user unsure which Azure screen/scope to use. App registration alone did not establish OIDC/RBAC/SQL access. | Every manual step must say **where**, tenant, resource/scope, exact field/value, expected result and verification. Separate application client ID, app-registration object ID, Enterprise application/service-principal ID and managed identity ID. |
| Infrastructure login failed with `AADSTS70025`; federation was missing on the deployment app. Other jobs needed their own environment bindings. | Verify the exact identity used by each job and actual issuer/subject/audience. This repository's observed GitHub subjects include immutable IDs; do not substitute an old generic example. Never log the token or introduce a client secret to avoid OIDC setup. |
| API deployment variables were blank because the correct environment/registration was not fully configured. | Verify repository **and environment** variable scope before dispatch. Hosting/deployment identities and customer-login identities belong to different tenants and serve different purposes. Keep a single authoritative inventory. |
| The manual workflow was not visible; later a pinned release failed with “Approval is stale.” | Check workflow discovery on the default branch separately from execution on the selected trusted branch. Pin the release SHA once. A moved branch requires a fresh reviewed run, not weakening stale-revision checks. Removing manual SHA typing does not remove immutable-release verification. |
| A successful package deployment was followed by liveness failure during roughly 2½ minutes of App Service startup. Setting changes also continued serving old responses before restart propagation. | Distinguish package uploaded, process started, correct revision active, maintenance state applied and end-to-end service working. Use bounded backoff and inspect the existing operation before restarting/redeploying. The recorded release window became five minutes; a continued failure still requires diagnosis. |
| `family-pilot`/`family-database` names sounded protected, but inspected environments lacked required reviewers. | A name, YAML environment reference or branch restriction is not a human approval gate. Inspect live protection settings and report the actual safeguards. Never assume a run will pause. |
| Production EAS `EXPO_PUBLIC_FAMILY_API_URL` began with `ttps://`; preview was correct. | Read back the **resolved target build environment** before upload, checking URL scheme, IDs/scope, project and demo `0`. Working preview does not validate production. Public configuration is embedded in the native build; correcting a variable does not repair an older installed binary. |

Evidence and recovery instructions: [runbook sections 2–14 and 23–24](AZURE-MANUAL-SETUP-RUNBOOK.md), [GitHub infrastructure](AZURE-GITHUB-INFRA.md), [database deployment](AZURE-DATABASE-DEPLOYMENT.md).

## 2. Authentication, responsiveness and UI lessons

### Diagnose each sign-in stage separately

The generic “action's result could not be confirmed” banner concealed multiple possible stages. Investigation confirmed **two separate server issues**: an incorrect Graph client ID (`700016`) and admission code that rejected the actual email-OTP identity shape (`creationType=null`, `federated`/`mail` plus its tenant-bound UPN). Successful browser sign-in and even working Graph credentials did not prove API admission worked.

Future sequence: hosted registration → authorization callback/token exchange → secure storage → token validation → directory admission → SQL account/family checks → local activation. Record only safe phase/status/duration information. Model real sanitized identity shapes in regression fixtures; retain issuer, tenant, enabled-account, uniqueness and scope checks. Do not recreate accounts, clear data, switch authentication methods or loosen validation based on a generic screenshot. See [the confirmed diagnosis](AZURE-MANUAL-SETUP-RUNBOOK.md#follow-up-actual-email-code-account-format-is-rejected-by-current-api).

Token recognition, current account access and family membership are distinct states. `/v1/session` recognizes a validated token without SQL; it does **not** grant family access. Cache the configured Graph application token, not a user's permission result. The approved reused registration retains its existing permissions, including deletion permissions; caching did not make that credential least-privileged. See [authentication/cache review](AUTHENTICATION-CACHE-REVIEW-2026-09-17.md).

### Fast UI must remain truthful and durable

- Sleep/feed controls were confusing when visible state waited for the API. Ordinary records should project locally, persist their intent, then synchronize. Show local failure, pending sync and server conflict honestly; never call a pending write synchronized.
- Stopping a timer while its start request is in flight needs a durable follow-up, not alteration of an already-sent request. Preserve operation IDs and version checks so retries cannot duplicate data or overwrite another member's edit.
- Foreground retry improvements initially missed cold-process startup. Test both, plus logout/account switching during each. Render permitted same-account cache first; use bounded quiet retries for temporary connectivity failures, without suppressing confirmed expiry/removal or real storage/conflict errors.
- A token-refresh timeout and HTTP timeout need separate budgets. Late results must not restore an obsolete account after logout. Do not retry non-idempotent management writes blindly after an ambiguous response.
- Create/join, invitations, removal, ownership transfer and deletion still require authoritative outcomes. “Move the UI update before the API” is not a blanket rule for changing permissions or replacing data.

See [responsiveness review and follow-ups](API-RESPONSIVENESS-REVIEW.md).

### Screenshots were functional evidence, not just styling feedback

Cancelled/expired messages persisted beside a signed-in account, dismissals returned after navigation, removed people inflated active-member counts, and old accepted invitations obscured later removal. The UI must distinguish **current state**, **historical event** and **current action error**. Dismissal belongs to the relevant notice lifecycle, not merely the mounted screen. History must remain unambiguous after re-invitation.

Phone screenshots also exposed keyboard-covered actions, clipped text and too many expanded sections. Verify the complete interaction with the iOS keyboard open, Chinese/English text, narrow screens, scrolling, confirmation dialogs and default collapse state. A browser layout pass does not establish native input/line-metric correctness.

Two CI failures reinforced this: calendar assertions ran before filter dismissal/layout settled, and a midnight fixture used Node's timezone while the browser used Melbourne time. Wait for an observable state, calculate dates in the environment under test and freeze clock/timezone when appropriate; do not add arbitrary sleeps or weaken assertions. Keep boundary tests for automatic end-time clamping to the current minute. Sources: commits `ee99788`, `9e7ce57`, `5032295`, `7c9e752` and [validation guidance](VALIDATION.md).

## 3. Product and privacy decisions to preserve

These were clarified through repeated review; do not reopen them accidentally through a UI or performance refactor.

- Offline use requires no account. Sign-in alone is not consent to upload local history.
- Creating a family seeds it from the reviewed creator's data, including supported avatar/reminder/early-learning extras. Recommend the member with the most complete history as creator. Local preferences and device notification permission are not shared family data.
- Joining requires explicit local-replacement consent, downloads the chosen family's history, and does **not** merge/upload the joiner's personal records. Cancel/failure must respect the existing durable activation/recovery procedure; do not erase first and hope the download succeeds.
- Invitations are checked in-app after verified sign-in; no invitation email or automatic joining. Five non-admin places include active members and valid pending invitations. Creating/accepting a family declines the other pending invitations after the agreed warning. An active member cannot create another group; a removed member can be invited again with a new grant.
- Leave/removal ends server access and retains contributions. Detected revocation clears the applicable local family workspace, queues and reminders; it must never copy another family's data into personal storage or a new family. A disconnected phone cannot detect removal instantly, and screenshots/prior external copies cannot be recalled.
- Transfer is confirmed by the nominee before ownership/administrator permissions change atomically. Record authorship is not rewritten merely because the admin changes.
- **Account deletion is not ordinary leaving.** Current documented cleanup includes records created or last edited by the user, potentially including someone else's original record. This is a known product-integrity/privacy decision requiring explicit review before changing or broadening release; do not promise it has the same retention semantics as removal. Ownership prerequisites remain enforced.

Authoritative detail: [API contract](FAMILY-API-CONTRACT.md), [owner onboarding](FAMILY-OWNER-ONBOARDING.md), [security review: product and family flow](SECURITY-REVIEW-2026-09-17.md#product-and-family-flow-review). These points are not a claim that every edge case has passed on two physical devices.

## 4. Security and database lessons

The security review found boundaries overlooked by functional tests: shared rate budgets, unbounded snapshot/cleanup work, failure-prone reminder cleanup, OS backup exposure despite disabled UI export, avatar metadata, mutable workflow actions, OTA trust and incomplete firewall validation. Controls need tests at the actual boundary, not just a disabled button or a reassuring label.

Preserve these distinctions:

- Implemented code, deployed code and native/operational acceptance are separate. [Remediation](SECURITY-REMEDIATION-2026-09-17.md) still calls out outstanding acceptance; do not relabel all findings “fixed” after a commit.
- Restoring a backup can resurrect deleted data, removed memberships or old ownership. A maintenance gate is necessary but is **not** an independent recovery ledger. Reconciliation and an isolated restore drill remain prerequisites to exposing restored data.
- Keep secrets/tokens, raw auth responses, child data and private operational snapshots out of chat, public logs, Git and build uploads. Collect metadata/aggregates only when they answer the question. Preserve the operator's explicitly retained SQL IP; clean up only the release's own temporary rule. The user declined a duplicated manual GitHub IP allowlist—valid single-IP ownership remains an operator responsibility.
- Current native releases disable OTA. An Expo “preview” request must not silently publish an ineffective OTA or re-enable unsigned updates; use the supported native build path until signed OTA is approved. Ad hoc preview and store-signed TestFlight binaries are not interchangeable. Upload, Apple processing, tester availability and installation are separate checkpoints.

Database review showed that a migration journal or an index name alone does not prove today's schema is correct. Check ordered keys, filters, INCLUDE columns, constraints, enabled state and the trigger contract against the applied migration version. Applied DbUp scripts are immutable; upgrades are additive and schema-first compatible with the old API still running. `--check` may succeed with pending scripts, so require **zero pending** when expecting a no-op.

Scale by access pattern: email inbox, family history and author/participant cleanup need measured indexes. Avoid counting all operation receipts on each write; the deployed transactional counter solves that path. Receipts are idempotency evidence, **not disposable cache**: no arbitrary TTL deletion for active families. Preserve transactional trigger maintenance and bounded cleanup. Indexes do not eliminate JSON/avatar transfer cost, global lifecycle contention or finite Basic capacity; a queue does not make those disappear. See [index review](DATABASE-INDEX-REVIEW-2026-09-17.md) and [deployed scaling changes](DATABASE-SCALING-2026-09-17.md).

## 5. Lessons from the SQL Basic conversion itself

The authorized conversion succeeded in place at **09:44 UTC on 17 September**; the API reopened around **09:50 UTC**. The same database became Basic/5 DTU/2 GiB, with auto-pause removed. Counts, migration hashes, index/trigger metadata, permissions, backup policy, firewall and identity checks matched. These are strong preservation checks, not a full payload checksum, load benchmark or restore test.

Preparation mistakes and corrections worth retaining:

1. The draft guard confused SKU name `GP_S_Gen5` plus capacity `2` with service objective `GP_S_Gen5_2`. Compare the correct property, not similar-looking strings.
2. The local CLI was 2.61.0 and lacked `--validation-level`; the documented newer-runner option could not be copied blindly. Check installed tools/help; normal provider validation was retained, not downgraded to template-only checking.
3. A blanket persisted-feature check rejected `TransparentDatabaseEncryption`. That DMV is not an Azure Basic support matrix. After checking support, allow the known supported feature and **keep encryption on**; never remove a safety feature to appease a guard.
4. What-if revealed that omitted differential-backup configuration appeared as a reset. Explicitly preserved the existing 12-hour interval and previewed again; the backup policy then showed `NoChange`.
5. A helper used unquoted `RowCount`, causing SQL syntax error 156. Corrected the helper, reran it and required a passing baseline; do not confuse a verification-tool bug with database corruption.
6. GitHub required private account re-verification before saving deployment guards. Handoff was necessary; a saved form value was not proof of a saved setting. Read back both repository and environment values.
7. SQL paused during the approval gap; the first read returned 40613 before resume. Earlier preflight results were not sufficient for the later maintenance window. Repeat critical checks after delays and before mutations.
8. API-setting saves and ARM completion were not immediate process readiness. Keep an explicit phase record and restore only maintenance introduced by this operation. Avoid repeated short health polling/restarts; use a bounded startup wait, one check in flight and progress updates.

What worked: explicit paid authorization, exact target/GUID checks, provider preview, immutable apply inputs, a drained writer-free SQL baseline, preserved identities/network/backup configuration, and post-change comparison before reopening. No new database, export/import, destructive initialization, family-history-ID change or phone rebuild was needed. See [migration procedure](AZURE-SQL-BASIC-MIGRATION.md) and [execution evidence](AZURE-MANUAL-SETUP-RUNBOOK.md#242-in-place-conversion-and-verification).

## 6. Compact playbook for future work

1. **Inspect:** read project instructions, relevant current contract/runbook, exact branch/SHA and dirty files. Preserve unrelated work. Resolve discoverable facts before asking the user; use `grilling` for a genuinely missing material choice.
2. **Classify:** identify UI-only, API-only, schema, configuration, native build or infrastructure work. State what needs release and what does not. Get separate approval for new recurring cost, wider access, data replacement/restoration or destructive testing.
3. **Check:** use the actual tenant/environment/tool version and sanitized real response shapes. Test failure, retry, cancellation, account-switch and clock boundaries—not only the happy path. Keep manual prerequisites in one linked runbook instead of scattering new setup instructions through chat.
4. **Release:** use the GitHub plugin for commits/pushes. Freeze the reviewed revision/configuration; avoid competing release/app-setting changes. Keep DbUp before its dependent API; use the correct EAS environment/distribution/runtime and exact build ID.
5. **Verify in layers:** build/tests → deployment result → correct live behavior → SQL/identity checks → authenticated phone read/write/sync → native security acceptance where relevant. Do not use `/health/live`, `/health/ready` or token-only `/v1/session` as proof that SQL-backed family operations work.
6. **Close honestly:** record UTC/local time, SHA/run/build, safe evidence, temporary cleanup and remaining device/operational gaps. Update the runbook and this lesson ledger when a new failure teaches something general. A failed run is not permission to erase data, weaken guards or broaden access.

## 7. Carry-forward items, not completed promises

- **Infrastructure drift:** live SQL is Basic, while the ordinary infrastructure path remains free-only. `FAMILY_INFRA_ENABLED=false` and environment `FAMILY_INFRA_APPLY_ENABLED=false` were verified after migration. Do not re-enable before the reviewed Basic-profile integration, paid-transition guards, tests and fresh preview. API/DbUp deployment is separate.
- **Branch promotion:** `feature/family-invitations` is the recorded trusted release branch; default branch is `master`. A future merge/release-branch change requires reviewing workflow discovery/triggers, trusted-branch variables, environment branch rules, OIDC bindings and stale-revision checks. A merge itself is not inherently forbidden, nor proof those settings migrate automatically.
- **Production acceptance:** preview uses real services/data. Complete two-phone acceptance, signed-device backup/notification/avatar checks, retention/disclosure review and independent restore evidence. Never run destructive smoke tests against a real family.
- **Capacity:** Basic removes SQL sleep, not hosting startup, network or authentication delays. Measure real workload latency/DTU/I/O/storage before claiming scalability or approving a higher paid tier. Sustained Basic load testing is still outstanding.
- **Policy:** explicitly revisit the documented account-deletion attribution trade-off before broader release; do not silently change it while simplifying copy.

This file and AGENTS.md are repository-backed memory for future project sessions, not a guarantee of personal/global memory outside this checkout. No credentials or private family records belong here.
