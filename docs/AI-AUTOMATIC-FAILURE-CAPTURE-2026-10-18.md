# Automatic failed AI output diagnostics

18 October 2026. Owner instruction: “对所有app启用失败采集，不用授权”.

Status: implementation and verification in progress; not yet activated in production.
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
Disposable SQL CI and deployment/catalog/health receipt are pending. No
live-family payload has been used as a fixture and no paid inference is triggered
by these checks.

Live payload readback is a separate acceptance step, not proved by health or
CI. The previous administrative SQL lookup was blocked by the local operator IP
firewall rule; access was not broadened. Inspect only unexpired diagnostics in
the current history epoch, without exporting raw payloads to source or logs.
