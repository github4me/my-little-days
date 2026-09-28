# Security review — My Little Days

> Policy update, 22 September 2026: active members can now explicitly download confirmed family records as unencrypted JSON for backup/analysis; family-file import/restore remains unavailable. Historical statements about suppressing family exports below describe the audited version. SQLite OS-backup exclusion remains a separate safeguard; it cannot exclude or recall files saved/shared outside the app. See the [current export contract](FAMILY-API-CONTRACT.md#member-initiated-family-backup-client-implementation-22-september-2026). This update does not close the audit's native or operational acceptance gaps.

Date: **17 September 2026 (Australia/Sydney)**

Reviewed branch: `feature/family-invitations`

Reviewed commit: **`5032295a5ec8b2277e0c3168483b1fda6adee9c1`**

Scope: mobile/web client, family API, database/deletion flows, deployment workflows, infrastructure definitions and product disclosures.

This is a source review with bounded local verification, not a penetration-test certification or confirmation of the deployed Azure/Expo configuration. No production traffic, accounts or databases were exercised during the original audit. The audit itself changed only this report.

**Remediation follow-up:** implementation subsequently started at the user's request. The findings and original evidence below remain historical; consult [the remediation status and release checklist](SECURITY-REMEDIATION-2026-09-17.md) for candidate changes, required manual configuration and unresolved acceptance gates. In particular, SEC-03 is not closed by the new maintenance gate alone.

## Executive conclusion

The inspected implementation has meaningful protections against cross-family access and accidental data mixing. No concrete authentication bypass or unauthorized cross-family read/write was found in the inspected paths. That is not proof that no such vulnerability exists, particularly because SQL integration and native-device checks were not run in this audit.

**Do not treat a successful deployment or health check as production security acceptance.** The highest priorities are an anonymous-request denial-of-service flaw and the unresolved recovery process for preserving deletions, removals and administrator transfers after a database restore. Notification cleanup and on-device backup handling also need attention because this product stores sensitive family and child data.

The findings below distinguish demonstrated code behavior, conditional hardening gaps and operational evidence that remains missing. They are not evidence of an existing compromise.

| ID | Severity | Finding | Evidence status |
| --- | --- | --- | --- |
| SEC-01 | High | Anonymous requests can consume the allowance for all signed-in users | Reproduced with the real local HTTP pipeline |
| SEC-02 | Medium | Snapshot and cleanup work can grow excessively under a service-wide exclusive lock | Accepted record bounds reproduced; outage not load-tested |
| SEC-03 | High | Safe restore after deletion/revocation is not established | Explicitly open operational gate; live recovery evidence not inspected |
| SEC-04 | Medium | Cleanup failures can leave family notifications scheduled after detected revocation | Failure paths reproduced in memory |
| SEC-05 | Medium | iOS family cache has no explicit OS-backup exclusion | Source and installed dependency verified; signed IPA/backup untested |
| SEC-06 | Medium | Android avatar pipeline can preserve hidden photo metadata | Source/dependency evidence; real-device metadata availability varies |
| SEC-07 | Medium | Mutable third-party actions run in privileged deployment paths | Confirmed workflow configuration; upstream compromise required |
| SEC-08 | Medium | OTA updates lack separately managed, end-to-end publisher signatures | Configuration hardening gap; publishing compromise required |
| SEC-09 | Medium | Database-release firewall guard accepts broad existing IP ranges | Predicate bypass reproduced; live Azure rules uninspected |

Severity reflects impact and preconditions, not a CVSS calculation. SEC-06 concerns Android; an iOS GPS disclosure was **not** demonstrated. SEC-07 and SEC-08 are defense-in-depth findings, not unauthenticated exploits.

## Scope, trust boundaries and verification

The review covered the following boundaries:

- Personal offline records → reviewed family creation or explicit family joining.
- Entra sign-in → API identity admission → active family membership and role authorization.
- Server snapshots → identity/grant/history-bound device cache, pending edits and notifications.
- Removal, leaving, transfer and deletion → immediate server denial, device cleanup and eventual permanent deletion.
- GitHub source/artifacts → federated Azure deployment identities → API/SQL, plus Expo update delivery.
- Live database state → retained backups and disaster recovery.

Threats considered included unauthenticated callers, ordinary members accessing another family's data, removed members retaining access, compromised devices/backups, compromised publishing dependencies, and operators restoring stale authorization state.

### Checks performed during this review

| Check | Result and limitation |
| --- | --- |
| Client auth and controller tests (`node --test tests/family-auth.mjs tests/family-controller.mjs`) | **110 passed** |
| Reminder coordinator/plan, family extras/full-state and storage-activation tests | **35 passed**; command below |
| API tests with SQL explicitly disabled, existing restore assets | **103 passed, 64 SQL tests skipped, 0 failures**; command below |
| In-memory probes | Demonstrated SEC-01, SEC-04 and SEC-09; accepted one maximum-note record for SEC-02 |
| `npm audit --json` and `npm audit --omit=dev --json` | Each reported 12 moderate, 0 high/critical; one underlying advisory, discussed below |
| `.NET` transitive package vulnerability listing | No vulnerable packages reported across four projects, using existing restore assets |
| Limited tracked-file secret-pattern scan | 210 text files scanned, 17 binary/oversized files skipped; no matches for the selected private-key/GitHub-token/AWS-key/JWT-literal patterns |

Focused client command:

```powershell
node --import tsx --test src/familyReminderCoordinator.test.ts src/familyReminderPlan.test.ts src/familyExtras.test.ts src/familyFullState.test.ts src/storageActivation.test.ts
```

API command (SQL disabled deliberately; never substitute a production connection):

```powershell
$env:MSBuildEnableWorkloadResolver = 'false'
$env:FAMILY_TEST_SQL_CONNECTION = ''
dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --no-restore --logger 'console;verbosity=minimal'
```

Dependency command:

```powershell
dotnet list server/LittleDays.slnx package --vulnerable --include-transitive --no-restore --format json
```

The additional API probes used the compiled application/test assemblies, synthetic identities and the existing in-memory TestHost. No large dataset was created. The notification and firewall probes used injected dependencies/local predicates only. These ad-hoc probes were not committed as regression tests; their scenarios are specified below for implementation follow-up.

**Not verified here:** live Azure RBAC/firewalls/settings, GitHub environment approvals, actual Entra user-flow configuration, production Graph permissions/deletion, Expo account access, installed binary contents, iOS backup contents, native background notifications, SQL concurrency/integration, restore drills, full browser/device acceptance, secret history or every possible secret format. Passing old tests documented elsewhere is not fresh evidence for this audit. The deployed API and phone update may differ from the reviewed commit.

## Findings

### SEC-01 — Anonymous traffic starves authenticated users

**High · confirmed local behavior · no account required**

Evidence: [Program.cs:90–98](../server/LittleDays.FamilyApi/Program.cs#L90-L98) assigns every request to the same `pilot-global` fixed-window partition. [Program.cs:138–143](../server/LittleDays.FamilyApi/Program.cs#L138-L143) runs it before authorization. The default allowance is 120 requests per minute in [Configuration.cs:38](../server/LittleDays.FamilyApi/Configuration.cs#L38).

An anonymous request that eventually receives `401` still consumes the same allowance used by legitimate families. A caller needs no family ID or valid token. Exhausting that allowance blocks legitimate synchronization and other API operations on the affected instance. The health endpoint is exempt, so a green liveness check does not detect this denial of service.

**Bounded reproduction:** real local JWT validation, synthetic admitted identity, SQL disabled, allowance lowered to three for the test:

| Request, in order | Response |
| --- | --- |
| Authenticated `GET /v2/capabilities` | `200` |
| Anonymous `GET /v1/me` | `401` |
| Anonymous `GET /v1/me` | `401` |
| Same authenticated `GET /v2/capabilities` | `429`, `{"code":"rate_limited"}` |
| Anonymous `GET /health/live` | `200` |

**Recommendation:** separate unauthenticated/IP budgets from authenticated account budgets; retain a suitably sized aggregate emergency limit without letting anonymous requests exhaust the protected users' allocation. Configure trusted proxy handling before relying on client IP. Inspect any deployed perimeter protection rather than assuming it compensates for this behavior.

**Acceptance:** repeat this sequence against an isolated candidate and show that anonymous abuse is limited while a legitimate account can still read and write. Also verify that one authenticated account cannot consume another account's normal allowance. Alert on authorized-request failures/429s, not liveness alone.

### SEC-02 — Excessive snapshot and cleanup work affects unrelated families

**Medium · confirmed bounds/control flow · requires an admitted account and accumulated data**

Evidence:

- [FullDomainValidation.cs:14](../server/LittleDays.FamilyApi/FullDomainValidation.cs#L14) permits 100,000 records per collection; [line 84](../server/LittleDays.FamilyApi/FullDomainValidation.cs#L84) permits 10,000-character entry notes.
- [FullFamilyService.cs:95–103](../server/LittleDays.FamilyApi/FullFamilyService.cs#L95-L103) checks operation/record counts, not an aggregate family byte budget.
- [FullFamilyService.cs:161–188](../server/LittleDays.FamilyApi/FullFamilyService.cs#L161-L188) eagerly loads all current records and parses/clones their JSON.
- [FamilyService.cs:19–30](../server/LittleDays.FamilyApi/FamilyService.cs#L19-L30) holds one exclusive SQL application lock across families while this work runs.
- [Program.cs:198–202](../server/LittleDays.FamilyApi/Program.cs#L198-L202) constructs the full snapshot before comparing the conditional-request ETag.

The actual validator accepted a single synthetic record containing a 10,000-character ASCII note, serialized to **10,097 bytes**. The allowed counts therefore permit roughly a gigabyte of raw record JSON before response metadata; operation-ledger overhead reduces the attainable count slightly. The initial 32 MiB seed cap does not provide an aggregate limit for later incremental writes. This estimate demonstrates permissive bounds, **not** an observed gigabyte response or measured outage.

A malicious member, or sufficiently large legitimate history, can make their family's synchronization expensive. Unrelated families can wait on the common lock. Even an unchanged conditional snapshot pays the materialization cost, and phones also have to download, parse and persist full changed snapshots.

**Related cleanup accumulation:** [DeletionWorker.cs:28–38](../server/LittleDays.FamilyApi/DeletionWorker.cs#L28-L38) revisits every closed family and issues six cleanup deletes on every pass, including already-purged families, under the same lock. Creation only excludes an existing active membership ([FullFamilyService.cs:33](../server/LittleDays.FamilyApi/FullFamilyService.cs#L33)); sequential create/close cycles can accumulate this work. Its performance impact was not measured.

**Recommendation:** enforce aggregate storage/response budgets, paginate or incrementally synchronize records, and compare an authorized current revision before materializing an unchanged snapshot. Scope locking more narrowly while retaining atomic authorization, removal and one-family-per-account guarantees. Mark completed purges and process bounded pending batches; apply creation/storage abuse budgets beyond the active-family limit.

**Acceptance:** on an isolated database, test boundary-sized histories, repeat conditional reads and accumulate synthetic closed families. Measure memory, SQL lock duration, response size and another family's latency. Verify quota failures are explicit and do not strand pending data or prevent leaving/deletion. Preserve cross-family and revocation race tests when changing locks.

### SEC-03 — Restores can reintroduce revoked state without independent reconciliation

**High · operational readiness gap · conditional on restoring an older database**

Evidence: [Azure setup guide:133](AZURE-FAMILY-SETUP.md#L133) and [manual runbook:813–817](AZURE-MANUAL-SETUP-RUNBOOK.md#L813-L817) explicitly require outside-database deletion/revocation evidence and a restore drill. The runbook states that there is no independent recovery ledger or automated replay. [Bicep:78–83](../infra/bicep/resources.bicep#L78-L83) declares seven-day short-term SQL retention; that is not verification of live retention.

An old backup can contain family content, active memberships and administrator assignments that were subsequently deleted, removed or transferred. Rotating `Family__HistoryId` protects against stale queued operations; it does not reconstruct missing revocations or fix restored role assignments. Directory-deleted identities may still be rejected by identity admission, but that does not cover a removed member whose identity remains valid.

**Recommendation:** establish a restricted, complete, ordered recovery record outside the database being restored and a reviewed reconciliation process. An automated durable ledger is an option; a manual process must still prove completeness and reliability. Keep restored traffic closed until deletion, closure, membership and transfer decisions are reconciled. Do not infer safety from restoring successfully or changing the history ID.

**Acceptance:** perform the existing runbook's isolated drill with synthetic data: take a recovery point, remove a member, transfer an administrator, close a family and submit an account deletion, then restore to an isolated target. Reconcile events and prove old permissions/content cannot return before exposing traffic. Record actual backup/log/artifact retention and the responsible operator. No production restore was attempted in this review.

### SEC-04 — Reminder cleanup can stop before native notifications are cancelled

**Medium · reproduced failure paths · requires enabled reminders plus a local failure**

Evidence: [familyReminderCoordinator.ts:119–125](../src/family/familyReminderCoordinator.ts#L119-L125) persists the cleared preference before native cancellation. A failed local write prevents cancellation entirely. [Lines 46–49](../src/family/familyReminderCoordinator.ts#L46-L49) stop at the first failed cancellation, leaving later notifications and dismissal unattempted. The detected-revocation path calls this cleanup and catches errors at [useFamilyPilot.ts:369–372](../src/family/useFamilyPilot.ts#L369-L372).

The native schedule includes a family-supplied title and can repeat daily ([familyReminders.native.ts:87–101](../src/family/familyReminders.native.ts#L87-L101)). In-memory foreground suppression is correctly disabled, but it cannot by itself retract previously scheduled background OS notifications.

**Local probes:** failing `save(null)` left two notifications with no cancellation calls, while foreground delivery was denied. With a failing first cancellation, only `n1` was attempted; the second notification and dismissal were skipped. Actual background display on a phone was not tested.

**Recommendation:** attempt preference invalidation, every cancellation and presented-notification dismissal independently; aggregate failures and retain a durable cleanup-retry state. Retry before allowing delivery again. Do not let persistence failure prevent best-effort OS cleanup.

**Acceptance:** inject save/list/cancel/dismiss failures individually; show that independent cleanup actions still run and retry survives restart. On a disposable device/account, verify no old-family notification appears after successful cleanup. This is separate from the disclosed limitation that an offline phone cannot yet know it was removed.

### SEC-05 — Disabling export does not exclude family data from iOS backups

**Medium · code/configuration gap · requires access to a device backup**

Evidence: [pilotStorage.native.ts:17–19](../src/family/pilotStorage.native.ts#L17-L19) opens the default SQLite location and enables WAL; [lines 39–47](../src/family/pilotStorage.native.ts#L39-L47) persist family state as JSON. Installed `expo-sqlite/ios/SQLiteModule.swift:24–28` places the default database under `Documents/SQLite`. No explicit family-cache backup exclusion or application-level cache encryption was found.

Apple documents that Documents files are backed up by default and provides mechanisms to exclude data from backup. See [Apple's filesystem guidance](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html) and [backup guidance](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup).

Thus the UI's prohibition on family export does not establish the product's intended server-controlled backup boundary. Existing backups cannot be cleared by later removal/logout. This is **not** a claim that the files are remotely readable or that iOS sandboxing/file protection is absent. SecureStore tokens use a separate device-only policy.

**Recommendation:** explicitly exclude family cache, outbox, drafts and related SQLite WAL/SHM files from OS backups. Use an appropriate non-purgeable location with exclusion rather than risking unsynced work in an automatically purgeable cache. Consider account-scoped encryption/key disposal if stronger local forensic or crypto-erasure guarantees are required. Document residual screenshot/export/backup limitations accurately.

**Acceptance:** inspect the signed candidate's file attributes and perform an actual disposable-device backup/restore test. Verify no family payload is included and that pending writes remain safe during ordinary restarts. Do not extend this finding to Android: the inspected Android backup rules include shared preferences only, so they do not establish the same database-backup exposure. Verify the merged configuration in a signed Android build.

### SEC-06 — Android avatars can share metadata beyond the visible image

**Medium · Android-specific pipeline finding · source image must retain metadata**

Evidence: [avatar.ts:80–88](../src/avatar.ts#L80-L88) reads selected file bytes into a shared data URL. [extras.ts:132–165](../src/family/extras.ts#L132-L165) validates encoding/container but does not sanitize image metadata. In the installed Android image-picker implementation, `CropImageContract.kt:68` and `CompressionImageExporter.kt:38` copy EXIF; `ImagePickerConstants.kt:91–92` includes GPS tags.

Depending on the source/provider permissions, family members and the backend may receive device, capture-time or location metadata that the user did not intend to share with a baby avatar. **The current iOS edited/quality-0.7 path re-encodes through UIImage; an iOS GPS leak was not established.**

**Recommendation:** sanitize at the shared-upload boundary for both migrated and newly selected avatars: bounded decode, apply orientation, re-encode without EXIF/XMP, and validate the result. Do not rely on a particular picker/provider stripping metadata.

**Acceptance:** use synthetic JPEG/HEIC fixtures carrying fake GPS/device/date metadata. Verify shared bytes retain the intended visual appearance but no private metadata. Test Android and iOS separately before claiming equivalent protection.

### SEC-07 — Privileged deployment uses mutable action tags

**Medium · conditional supply-chain exposure**

Evidence: [deploy-family-pilot.yml:74–77](../.github/workflows/deploy-family-pilot.yml#L74-L77) and [lines 136–145](../.github/workflows/deploy-family-pilot.yml#L136-L145) use mutable tags for setup/download/login/deploy actions in jobs granted `id-token: write`. The artifact-producing [family-pilot-ci.yml](../.github/workflows/family-pilot-ci.yml) also contains tagged actions. Some other actions are already commit-pinned, but protection is inconsistent.

An upstream action compromise or malicious tag retargeting could run code with the approved job's federation capability or alter deployable artifacts. Protected environments help control when jobs run, but do not make a mutable action immutable. No upstream compromise was observed.

**Recommendation:** pin every action in the build, migration and deployment chain to reviewed full commit SHAs and maintain a reviewed update process. Preserve OIDC, least-privilege scoped identities and environment approvals. GitHub recommends full-length commit pinning for immutable action references: [secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

**Acceptance:** automated checks reject mutable third-party action refs in privileged/artifact-producing workflows. Independently inspect actual environment approvals, allowed refs and Azure federation/role scopes; repository declarations alone do not verify those settings.

### SEC-08 — OTA trust stops at the update-publishing platform

**Medium · defense-in-depth gap · requires publishing/delivery compromise**

Evidence: [app.json:77–79](../app.json#L77-L79) configures an EAS update URL without `codeSigningCertificate` or signing metadata. No alternate app configuration providing signing was found.

TLS and Expo's platform/account controls still apply. This is **not** arbitrary unauthenticated OTA injection. However, a compromised publisher or delivery path could supply JavaScript that runs with the app's access to family data and credentials. A native build produced from the inspected configuration would lack a separately managed publisher-signature check; installed binaries were not inspected.

**Recommendation:** evaluate EAS Update end-to-end signing with a verification certificate embedded in a new native runtime, and keep the corresponding private key separately protected from routine publishing credentials. Define rotation/recovery and preview/production publishing permissions. Merely adding signing configuration in an OTA cannot retrofit a native trust anchor into already installed binaries. See [Expo code-signing documentation](https://docs.expo.dev/eas-update/code-signing/).

**Acceptance:** a new signed candidate accepts an authorized update and rejects an unsigned/wrong-key one; demonstrate key-rotation recovery without accepting unintended updates. Actual installed binaries and Expo organization access were not inspected here.

### SEC-09 — SQL release preflight misses existing broad firewall ranges

**Medium · confirmed validation gap · requires prior configuration drift**

Evidence: [github-database.ps1:62–68](../infra/github-database.ps1#L62-L68) rejects rules beginning at `0.0.0.0` and stale `github-db-*` rules, but does not generally reject broad ranges. The stricter check in [deploy-pilot.ps1:240–247](../infra/deploy-pilot.ps1#L240-L247) is not called by normal API/database releases.

A locally evaluated rule named `legacy-range`, from `1.0.0.0` to `223.255.255.255`, passes both release predicates. The workflow can therefore proceed while the SQL network boundary is much broader than its intended temporary exact-runner-IP access. Entra SQL authentication is still required; this is not a database authentication bypass. No evidence was collected that Azure currently has such a rule.

**Recommendation:** validate every existing rule against an explicit approved exact-IP policy before migration, with documented narrowly scoped exceptions if needed. Retain cleanup limited to the current run's own rule; never delete unrelated rules automatically as a workaround.

**Acceptance:** reject broad ranges and unknown exceptions in fixture tests; accept approved exact IPs. Have an authorized operator compare actual Azure rules to that policy before the next release, without copying credentials into evidence.

**Subsequent operator decision (17 September):** the manually maintained GitHub
allowlist was declined to avoid duplicating Azure's IP configuration. The updated
helper retains checks for exact canonical public IPs, broad/all-Azure access,
duplicate names and stale runner rules, plus cleanup limited to its own run.
It accepts other existing exact-IP rules without separately approving each
address. The broad-range validation gap is addressed; detecting an unexpected
but valid single IP remains an operator responsibility, not an automated control.

## Product and family-flow review

The source and current user disclosures generally agree on these important boundaries:

| Flow | Reviewed behavior / security expectation | Remaining concern |
| --- | --- | --- |
| Offline use and sign-in | Offline records need no account; signing in alone does not upload personal history | Native cache/backup properties still require validation |
| Create a family | Review the complete local profile, records and extras; upload the owner's seed; clean personal/recovery copies only after verified durable activation | Large-history limits, SEC-02; most complete history should be the seed |
| Join a family | Explicit destructive-replacement consent; download and validate the family; do not merge/upload the joiner's personal data; cancel keeps it | Fault recovery needs two-device/native verification |
| Invitations | Verified mailbox identity, explicit accept/decline, expiry, no automatic join/email notification; five non-admin places include live pending invitations | Verify the real Entra flow remains email-OTP-only and matches admission assumptions |
| Other pending invitations | Creation/acceptance declines other pending invitations after upfront warning | Preserve this transactionally under retries/concurrency |
| Member/admin permissions | Member edits/deletes own records; admin can edit/delete any; API checks active family/grant before access | SQL race/integration tests skipped in this audit |
| Removal/leave/re-invitation | Server access ends; detected revocation clears cache/queues; contributions stay; re-invitation creates a new grant | SEC-03/04/05; offline detection is not instantaneous |
| Admin transfer | Nominee acceptance changes control atomically; former admin becomes a member, not author of everyone else's records | Restore must preserve the later transfer decision |
| Account deletion | Separate from leave; blocked while ownership prerequisites remain; access disabled, SQL cleanup and exact-account directory deletion processed; receipt tracks completion | Native/cloud deletion and recovery acceptance remain open |

Relevant implementation: [authentication configuration](../server/LittleDays.FamilyApi/Program.cs#L36-L84), [directory-backed admission](../server/LittleDays.FamilyApi/PublicIdentityAdmission.cs), [family authorization/service](../server/LittleDays.FamilyApi/FamilyService.cs), [full-record authorization](../server/LittleDays.FamilyApi/FullFamilyService.cs#L83-L120), [mobile lifecycle controller](../src/family/useFamilyPilot.ts), [privacy disclosure](../src/PrivacySupport.tsx#L99-L154).

### Controls worth preserving

- JWT signature, issuer, audience, expiry, tenant, mobile client and delegated-scope checks; directory-backed identity and uniqueness checks instead of trusting generic email claims.
- OAuth authorization-code flow with PKCE; callback state verification in the installed Expo implementation. Tokens and durable account/cache guards use `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- HTTPS-origin-constrained API requests, redirect rejection, no raw token/body exception logging, and no-store responses.
- Per-account/family/membership/history cache and queue binding; versioned writes, durable receipts, activation journals and fail-closed known-revocation handling.
- Server-side owner/author checks, new grants on re-invitation, and transactionally consistent removal/retry authorization.
- Family-mode backup/import suppression and no copying shared records back into personal offline storage.

### Product decisions and disclosures to keep explicit

1. **Offline access is a trade-off, not instant remote erasure.** Cache-first startup is compatible with the product, but a disconnected device cannot detect removal immediately. The current privacy wording correctly states reconnection is required. Do not replace it with an unconditional immediate-device-erasure promise. Legitimately captured screenshots or prior external copies cannot be recalled.
2. **Account deletion is more destructive than leaving.** [DeletionWorker.cs:45–54](../server/LittleDays.FamilyApi/DeletionWorker.cs#L45-L54) deletes records the user created **or last edited**, including records originally authored by someone else. [Current confirmation copy](../src/family/messages.ts#L876-L877) discloses this. It is not an observed authorization bypass, but an administrator editing another person's record can later cause its loss through account deletion. Reaffirm this integrity/privacy policy before broader release; changing attribution alone may not remove private content, so any redesign needs an explicit data-retention decision.
3. **Publish retention facts, not assumptions.** In-app privacy explains sharing and deletion, but this audit did not verify a published policy/App Store disclosure against actual backup, logs, account-deletion processing and processor retention. Reconcile these with the operational inventory before public release. Apple's [privacy guidelines](https://developer.apple.com/app-store/review/guidelines/#privacy) require clear retention/deletion explanations; this review is not a legal or App Review compliance determination.
4. **Historical pilot documents can mislead operators.** [FAMILY-SHARING-TECH-PLAN.md:3–23](FAMILY-SHARING-TECH-PLAN.md#L3-L23) still describes a closed synthetic-data pilot and deferred full sharing. Mark the document unambiguously historical and route readers to the current contract/runbook. Resource/file names containing `pilot` are not themselves security defects.

## Dependency triage

The 12 moderate npm entries stem from **one underlying advisory**, not 12 independently demonstrated app vulnerabilities: [GHSA-w5hq-g745-h8pq / CVE-2026-41907](https://github.com/advisories/GHSA-w5hq-g745-h8pq), affecting locked `uuid@7.0.3` through `xcode@3.0.1`. The inspected `xcode` call uses `uuid.v4()`; the advisory's described unsafe-buffer behavior concerns `v3`, `v5` and `v6` with supplied buffers. No reachable exploit was established in that usage.

Track an Expo-compatible dependency update and re-run audit/reachability checks. Do not apply an incompatible Expo downgrade merely to make `npm audit` quiet. The .NET check reported no known vulnerable packages for the current restore assets; neither result proves that all dependencies are secure.

## Recommended order and manual acceptance checklist

No remediation is included in this report. The following is the proposed work order, not authorization to change production.

1. **API engineer:** address SEC-01 first and add its cross-user starvation regression. Measure legitimate-family availability separately from `/health/live`.
2. **Service operator + API engineer:** resolve SEC-03's recovery evidence/process before any production restore; keep restored service closed until reconciliation is proven. Do not expand production exposure on the assumption this gate is already complete.
3. **Mobile engineer:** fix and fault-test SEC-04; establish and verify SEC-05's iOS backup boundary. Retain fast cache-first startup without claiming immediate offline revocation.
4. **API engineer:** bound snapshot/worker work under SEC-02 and preserve authorization/concurrency tests while reducing global serialization.
5. **Release engineer:** pin actions and tighten firewall validation (SEC-07/09); separately design and test signed OTA/native rollout (SEC-08). Verify actual GitHub/Azure/Expo permissions and alerts.
6. **Mobile/product:** sanitize avatar uploads before Android release (SEC-06); finalize deletion/retention disclosures and retire misleading pilot guidance.
7. **QA/operator:** complete the existing [manual acceptance gates](AZURE-MANUAL-SETUP-RUNBOOK.md#L805-L817) using disposable accounts and synthetic records only. Record candidate commit/update/runtime, phone/iOS versions, two-family isolation, rejected stale writes, removal, transfer, cancelled/successful join and deletion progress. Validate each platform's native behavior rather than inferring it from browser tests.

Store operational results in restricted records. Include pass/fail, expected/observed behavior and redacted configuration evidence, never bearer tokens, secrets, deletion-receipt tokens, real baby records or personal photos. Update this report's finding statuses only when the fix and its stated acceptance evidence exist; a commit, preview publication or healthy endpoint alone does not close a finding.
