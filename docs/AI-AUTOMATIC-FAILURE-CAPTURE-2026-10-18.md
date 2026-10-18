# Automatic failed AI output diagnostics

18 October 2026. Owner instruction: “对所有app启用失败采集，不用授权”.

Status: deployed and activated in production, release completed 06:30:25 UTC
on 18 October 2026 (17:30 Melbourne).
This replaces the separate diagnostic opt-in introduced in the earlier backend
release. Initial AI enablement, sign-in and authoritative access checks remain
required. No additional diagnostic-consent popup or mobile upgrade is required
for clients using the current resumable AI job endpoint.

## Scope

- Apply the server diagnostic policy to newly enqueued resumable AI jobs,
  including requests from existing iOS/Android clients that omit the optional
  diagnostic-consent field. Preserve its serialized value for compatibility;
  do not manufacture a user consent record.
- Save only failed AI assistant output attempts and bounded error/timing
  metadata in the existing restricted SQL diagnostic table. Include a failed
  first attempt even if the second attempt succeeds. Do not retain successful
  output, input history or prompts for diagnostics, or put payloads in logs.
- Preserve seven-day eligibility, bounded hourly cleanup, turn-off/cancellation,
  account/family lifecycle, history-epoch and late-response isolation.
- Do not backfill old jobs with no diagnostic epoch, revive collection after
  lifecycle suppression, or reconstruct previously uncaptured failures.
- Historical synchronous prediction routes are outside the resumable-job
  diagnostic store; they lack its durable revocation identity. No silent
  conversion of those requests into stored jobs is included.
- Preserve model/Fast tier, concurrency 50, quotas 30/hour and 200/day, timeouts,
  polling, provider controls, paid tiers, credentials and prediction validation.

The already-applied script 0011 is immutable. New script
`0012_SleepAiAutomaticFailedOutputCapture.sql` updates the old opt-in-only
constraint to permit a server-assigned diagnostic epoch without asserting user
diagnostic consent. Apply and verify the schema before deploying the dependent
API; verify zero pending scripts afterwards.

## Disclosure and rollout

Public privacy/support additions were committed through the GitHub plugin to
`github4me/my-little-days-privacy`, `main`, commit
`5dca921343b082338828a7023167d9ea3ec1ddef`. Only the failure-retention paragraphs
and effective date changed, preserving the published one-tap/durable-task copy.
Pages run `39103593943` succeeded; both public URLs returned HTTP 200 with the
new resumable-task/no-extra-prompt/seven-day disclosure. Local generated pages contain
older unrelated copy and were not used to replace whole remote pages.

Use the current trusted `feature/family-invitations` head as the commit parent,
not the older dirty local HEAD. Publish only scoped backend, migration, tests
and operational documents through the GitHub plugin. Run disposable SQL CI and
the existing manual API/database workflow, with `database_bootstrapped=true`
and `adopt_ef=false`, freezing the release SHA.

Frozen candidate: `d3c592b67727a1ab489d8ee76e4fea0a37694748` (GitHub plugin
commit/ref update from trusted parent `36908b80ac406468fe3d6f57c324e7b27237cf53`).
Push CI `39103794262`; manual release `39103865059`, dispatched 06:23:29 UTC
with the inputs above. Both completed successfully; the branch remained frozen
through release. Immediately preceding dispatch, the GitHub settings UI confirmed both
`family-database` and `family-pilot` restrict deployment to
`feature/family-invitations`; required reviewers and wait timer were disabled,
administrator bypass enabled. These existing protections were observed, not
strengthened or weakened by this task.

Production targets remain the existing `reticle.com.au` tenant, subscription
`4768a858-f23f-4a39-bb64-eabc9c142627`, resource group
`my-little-days-pilot-rg`, API `little-days-api-522fpstfbtds2` and database
`little-days-family` on `little-days-sql-522fpstfbtds2`. No operator firewall
change is included. The release workflow owns and removes its temporary rule.

## Verification

Focused local API capture/worker/contracts tests: 62 passed, 0 failed, 0 skipped.
Focused migration tests: 15 passed, 0 failed, 6 SQL methods skipped because no
disposable SQL connection was configured. Independent assertion/gap review
checked server-epoch gating, legacy hash stability, lifecycle suppression and
trusted constraint drift; no blocking findings. Script 0011 is byte-unchanged.
Full local solution: API 521 passed / 0 failed / 140 skipped; migrator 28 passed /
0 failed / 36 skipped. SQL-dependent methods are intentionally not claimed as
executed locally. Command: `env -u FAMILY_TEST_SQL_CONNECTION
/Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx
--configuration Release --no-restore`, exit 0. The migrator summary was confirmed
with a clean project rerun using `--no-build --no-restore`.
Disposable SQL CI and deployment/catalog/health verification subsequently
completed below. No live-family payload was used as a fixture and no paid
inference was triggered by these checks.

Push CI API/SQL job `117605277779` completed the real disposable-SQL suite:
**661 API tests and 130 migrator tests passed, zero failed/skipped** (06:24 UTC).
Command: `dotnet test server/LittleDays.slnx --configuration Release`.

| Requirement | Evidence |
| --- | --- |
| “对所有app启用失败采集，不用授权” (current resumable clients, no extra diagnostic opt-in) | `AutomaticPolicyStoresBoundedFailedOutputsForLegacyClientWithoutExposingThemInPrediction`; `AutomaticPolicyStoresBoundedFailedOutputsForOptInClientWithoutExposingThemInPrediction` |
| Preserve actual client consent and replay identity | `LegacyClientAutomaticallyCapturesWithoutRetrofittingConsentOrChangingImmutableOperation` |
| Never revive pre-policy or lifecycle-suppressed jobs | `PrePolicyNullEpochJobCompletesWithoutCaptureOrRetroactiveConsent`; `AccountDeletionSuppressionSurvivesLeaseRecoveryWithoutCancellingOtherMembersPrediction` |
| Seven-day expiry and history isolation | `ExactSevenDayBoundaryDeletesDiagnosticsButNeverFamilyRecords`; `ClaimAfterHistoryRotationDoesNotRecaptureOldPersonalRequestUnderNewEpoch` |
| Schema-first compatibility, immutable prior scripts and verified no-op | `AutomaticCaptureUpgradePreservesPriorJobsAndOutputsAndHasVerifiedNoOp`; `AutomaticPolicyCatalogRejectsMissingUntrustedOrBroadenedCheck` |

The .NET testing skills guided explicit output/hash/expiry/lifecycle assertions
and independent gap review, rather than merely testing whether calls completed.

Release verification job `117605505890` independently repeated the same
**661 API / 130 migrator passes, zero failures/skips** before production SQL.
Push CI `39103794262` also completed its TypeScript/Watch/browser checks.

Actual release API artifact `12127262904` (`family-api-39103865059`, 30,351,406
bytes) is bound to the frozen SHA. Downloaded ZIP SHA-256
`149813bc40b70276313ddf47ed5d4f1a0477d461671f6cb3f75b4d67fef00a42` matches
GitHub's published digest. Packaged configuration preserves concurrency 50,
account/hour 30, daily 200, model `gpt-6-luna`, and metadata-only Information
logging for `SleepAiDiagnostics`. App-local Pkcs 10.0.13 (file version
10.0.1326.50504) is preserved; DLL SHA-256
`eff9ed505c194f0f5c9faef1a175459cd0560eeb4ad08890c7c0c0e1ff4d34c3` matches the
previous patched artifact. Provider source/timeouts/retry settings are unchanged;
artifact inspection does not independently prove the provider's runtime service
tier. No paid inference was made to remeasure it.

Production migration job `117606324433` succeeded:

- 06:29:00 UTC: exactly one pending script, `0012_SleepAiAutomaticFailedOutputCapture.sql`.
- 06:29:11 UTC: migration completed successfully.
- 06:29:16 UTC: post-apply catalog/journal verification returned `Pending database scripts: 0`.
- 06:29:19 UTC: this run's temporary exact runner-IP SQL firewall rule was removed.

API deploy job `117606496033` succeeded. OneDeploy
`314eadfc-fffe-4f6a-a8f4-b83c0794750a` installed the package; public liveness
passed at 06:30:22 UTC and all five release jobs completed successfully at
06:30:25 UTC. [Verified release](https://github.com/github4me/my-little-days/actions/runs/39103865059).

Independent sequential read-only checks at 06:31:29–30 UTC returned:

- `/health/live`: 200, `status: ok`.
- `/health/ready`: 200, `status: ready` (recovery gate, not a SQL probe).
- Unauthenticated `/v2/sleep-prediction-jobs/capabilities`: 401,
  `code: unauthorized`, preserving authentication.

Automatic capture is active prospectively for new resumable AI jobs from current
iOS/Android clients, without a mobile release or extra diagnostic consent.
No already-completed uncaptured failure was recovered. No device or real-family
failure was induced. Waiting for a naturally occurring eligible failure and
restricted SQL readback remains a separate production acceptance step.

Live payload readback is a separate acceptance step, not proved by health or
CI. The previous administrative SQL lookup was blocked by the local operator IP
firewall rule; access was not broadened. Inspect only unexpired diagnostics in
the current history epoch, without exporting raw payloads to source or logs.
