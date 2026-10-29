# Sleep/feed synchronization latency — 29 October 2026

Owner reports “20 secs”, slow partner sleep/feed updates in foreground and
background, and approved safe API phase timing/targeted optimization plus
TestFlight. This is not authorization to change App Review or public release.

## Bounded implementation

With a verified matching account/family cache, a sleep/feed synchronization goes
directly to the scoped endpoint instead of first making another `/v1/me` read.
The endpoint still performs fresh directory admission and authoritative SQL
account/grant/family checks on every request. The same family/lifecycle locks,
stored-record quota, response limit and old-client200 JSON shape remain.

The scoped endpoint combines four authority reads into one parameterized query.
Its data reads are3 on a changed response,2 on an unchanged response (excluding
the unchanged two lock commands), rather than6. A strong opaque ETag binds
schema/account/family/grant/history/role/revision. Comparison happens only after
authorization and stored-family budget checks.304 never grants access.

The client keeps that tag only in memory against the exact current cache and
outbox references. Local changes, full refresh, account/session/authority changes
invalidate it. A304 racing a local edit is retried once unconditionally. An old
server without ETags remains compatible. A304 does not persist the history,
renew complete-cache/Watch authority, or refresh AI capabilities. Known sleep/feed
creates/updates/deletes and timer completions use the same scoped round; unrelated
work retains its general sync path and immutable request/receipt semantics.

No faster polling or push activation: the existing foreground interval/backoff
and background limitations remain. Manual refresh may still wait for an already
running sync. Reduced request/query counts do not prove the reported20-second
cause or establish a measured two-phone latency improvement.

## Diagnostics

Selected API operations log only fixed operation, status, counts and durations:
directory token/lookup/uniqueness, SQL command execution, global/family locks,
transaction, serialization and full response total. `Server-Timing` exposes only
fixed numeric metrics. SQL duration measures execution through reader-open,
not complete row materialization. Timed stages overlap and must not be summed.
The header total ends before headers; the server log total includes response
completion. No tokens, IDs, routes, SQL/parameters, exception text or record
payloads are added to these diagnostics. Existing AI capture settings are not
changed. Client phase logs also measure sync-lock wait, persistence and total.

## Verification/release gates

Use the immutable91 mobile tree753ed9fba8cebb67f658a74b38681b40902ad1aa plus
only reviewed API/controller/owned test overlays and staged app.json. Candidate
0.2.9(92) uses local EAS/Xcode production signing, direct Apple validation/upload,
signed Hermes/configuration/Phone/Watch/Widget/symbol inspection, then actual
processing/existing-group availability checks. No paid EAS cloud build or OTA.
Preserve review0.2.9(90), public0.2.8(87) and existing Apple metadata.

Backend starts at docs-only remote98f13550612da38b37aef13381d9be09bfb1c9cb
(runtime381024104a0735a8ba3bcbd09d71d077474f8130), named compatible code/tests/docs
only. Publish through GitHub plugin with an expected-head lease; dispatch the
existing Deploy family API and database workflow on feature/family-invitations,
database_bootstrapped=true/adopt_ef=false. Freeze the SHA through stale-revision
gates; require disposable real-SQL tests, immutable migration catalog and explicit
zero pending scripts. Preserve Azure resources/settings, quotas, identities,
credentials and operator-retained firewall rule. New diagnostics category is
enabled by code, without opening raw EF/HTTP logging.

At this checkpoint implementation/review/testing is in progress. Deployment,
signed artifact upload, tester availability and authenticated physical two-phone
acceptance are distinct pending steps, not completed promises. No real family
records are created/deleted as a production fixture.

At07:23UTC /18:23Melbourne, backend full API suite passes865/865,0fail/skips,
exit0, against an owned disposable local SQL fixture. Focused diagnostics,
conditional/auth/quota/scope matrix21/21 also passes. No migration/script,
schema, production test data or credential change. Independent client review
found a Watch-ledger reference mismatch blocking ETag installation; persist now
returns the actual reconciled committed state and two regression cases cover
Watch and delayed disk-write races. Client full frozen verification and native
release remain pending.

At07:28UTC /18:28Melbourne, backend publication is confirmed at GitHub
`947c4108d4632630198b89d5d5781f775ac034e6`, tree
`996511af3b4102efc85bf428f8d15cdfb946f0d8`, exact12named paths. All compiled
baseline server sources were compared; unrelated local AI .http examples and
older dirty runbook sections were excluded. Source archive SHA256
`03ea046a7e6250a05d5649409b7826b5c022bebf3c8f67ec5218991f03bcce10`.
Plugin-created blobs/tree matched local Git objects; expected-head lease and
fresh ref readback passed. No CLI push or unrelated source publication.

[Deployment35](https://github.com/github4me/my-little-days/actions/runs/40835634106)
started07:28:18UTC on that exactSHA, existing-database flags true/false.
Fresh environment UI readbacks show selected trusted branch only, reviewers/
wait timers disabled, administrator bypass enabled; these were not modified or
described as human approval gates. Keep the branch pinned until gates complete.

Mobile92 frozen tree`3d0a341d23d542d1da897a51c34101b9b7f03397`,543files,
four reviewed overlays plus staged app.json only. Source archive SHA256
`a145b13f290e207f135c6dfe844c433301f7b6ed731bf41ed6f41e9ec9caefd2`.
At07:28:36UTC frozen full npm verification passes1,252/1,252,0fail/skips,exit0;
logSHA256`f3699d4c6d12ed42c98c4f8a3be557e8df263303326c0350aeaf67aa442c64a7`.
The final malformed-outgoing-ETag case rejects before token/fetch. Native local
archive is in progress; backend deployment/active revision and Apple availability
are not yet confirmed. No numerical coverage/mutation-survival claim is made.

| Requirement / preserved behavior | Concrete regression evidence |
| --- | --- |
| “20 secs” / “还是api速度慢了” — reduce duplicate work; actual latency still requires device measurement | `conditional family reads authenticate one GET and return a modified value with its strong validator`; `ConditionalReadCombinesAuthorityIntoOneQueryAndSkipsRecordBodiesWithoutWritingOn304` |
| “and my partnere app doesn't sync in time for the milking and sleep data” — scoped records/queues without false full freshness | `sleep/feed refresh replaces only its records and does not refresh AI or complete-cache authority`; `a nonempty reconciled Watch ledger retains the scoped validator and makes the next 304 side-effect free` |
| Preserve authority, local writes and ordering | `Http304HasNoBodyAndFreshGrantChecksPrecedeEntityTagComparison`; `a modified scoped response cannot arm a validator after a newer local state begins persisting`; `unsafe outgoing conditional validators fail before token acquisition or HTTP` |
| Record safe timing, including error/cancellation work | `FixedNumericTimingsUseMonotonicTimeAndDoNotSumOverlappingStages`; `CommandFailuresAndCancellationKeepOriginalOutcomesAndOnlyNumericDiagnostics` |

Independent assertion/gap review: Strong, no remaining confirmed P1/P2. New
assertions check exact values, forbidden side effects, exception/denial outcomes,
durable states and structural scope; no new assertion-free/trivial-only cases.
Static analyzer prerequisite remains absent; tests do not establish line coverage,
instant background synchronization or physical latency.

## Production backend result

Deployment35 and independent CI132/run40835507781 succeeded on exact947c4108.
Deployment API865 +migrator157 checks passed,0fail/skips. API artifact12880169973
ZIP SHA256`a2a5688eeddb91f0096e3a9ddfdfece64fbfdc26f5176b4b6052197fd77e17a4`
and embedded assembly SHA/revision/diagnostic symbols were checked independently.
Packaged appsettings SHA256
`a1b3989d62bd799450239c2bc11a455977433b8763c6fdeef107a282e5eb6e39`
matches prior381 exactly. Database artifact12880533251 SHA256
`eab1589505682ba74c8dd2b2dfdde7546ecb52946d0f2edef887ac05d55d4205`.

Catalog reported0pending scripts at07:34:33/38/46UTC; apply07:34:41 was a
no-op. Workflow-owned SQL firewall rule removed07:34:49; retained operator access
was untouched. OneDeploy`f341cf7b-3290-43a1-8008-248eb7ed5bc3`,status4/complete/
active, received07:35:32, started07:35:33 and completed07:35:48UTC. Run completed
SUCCESS07:35:57. No schema, app-setting, resource, identity, quota or retention drift.

At07:37:00UTC, healthy200/401 responses still lacked the new timing fingerprint;
package success alone was not treated as new-runtime readiness. One bounded,
serial retry at07:37:46UTC returned live/ready200 and scoped401/Bearer/no-store
with all nine expected fixed numeric timing metrics. New runtime activation is
therefore observed within startup propagation, without restart/redeploy/settings
changes. This anonymous check performs no SQL/Graph/user-data read: authenticated
production SQL, two-phone latency and background/foreground acceptance remain
unverified. Direct Azure log-sink access was unavailable without bypassing the
browser boundary, so no private runtime log query was attempted or claimed.

## Signed mobile result

Local production build92 completed07:37:07UTC. All543 frozen source files and
the three App Store-signed Phone/Watch/Widget targets match0.2.9(92), existing
bundle IDs/profiles/App Groups and12localizations. Exact production API/auth
values, demo0, coffee on and OTA off are verified in the actual signed Hermes
bundle. Production-JS AST/feature checks confirm direct scoped authority, ETag/
304 guards, unconditional post-write refresh and returning the reconciled
committed state. Recompiling that reviewed JavaScript matches signed Hermes
byte-for-byte. Existing collaboration/timer/AI/widget safeguards remain bundled.

IPA SHA256`a241df74c7c848ba22f1422301c8126020d2a8fc9232fc1db4ea2701bedb4250`;
signed HBC`c4ce8f2c4156fa5a1afe39e69a96f1f6da851aa2a9a10127901364ca883351ff`;
dSYM ZIP`edc3003f45e629f9b2d8ad7745e6ebd1b92ce37f97edb71274ae135cafd66d65`.
All Phone/Watch/Widget dSYM UUIDs match their signed executables. Native Swift
suites35Watch+21Widget pass. Existing Expo Doctor19/21 warnings remain the same
legacy splash/patch-version categories; no package upgrade was introduced.
Only this build's three validated temporary P12 copies were removed; EAS had
already removed its own temporary keychain/profiles, managed credentials unchanged.

Fresh Apple pre-upload readback07:39:12UTC preserves review90WAITING_FOR_REVIEW,
public87READY_FOR_SALE and AFTER_APPROVAL. Apple validation is in progress;
upload/processing/tester availability and physical two-phone acceptance are not
yet claimed. Source/inspection/feature/symbol/cleanup receipts are retained under
work/api-sync-release-20261029/ and artifacts/MyLittleDays-0.2.9-92.*.

Apple validation succeeded07:41:04UTC, exit0/no errors; a single upload succeeded
07:43:24UTC /18:43:24Melbourne, uploaderexit0, delivery
`3d5d4884-9ef6-46f1-8e95-f55a4b3ba766`. The uploaded IPA hash matches the inspected
artifact exactly. No duplicate upload, App Review replacement or public release.
Apple processing and actual existing internal-group availability remain pending
at this checkpoint; physical installation/latency acceptance is separate.

## Delivered

At07:47:08–10UTC /18:47:08–10Melbourne, Apple delivery COMPLETE with no errors/
warnings, build0.2.9(92)VALID/IN_BETA_TESTING. Build ID equals delivery
`3d5d4884-9ef6-46f1-8e95-f55a4b3ba766`. Both existing internal groups Team(Expo)
`9c537271-fd52-413a-887d-fe95079a0086` and Early Birds
`5110f712-26d2-4151-b516-797adc018528` are already attached. No new group,
external beta review, duplicate upload, App Review replacement or public release.
Fresh readback retains review0.2.9(90)WAITING_FOR_REVIEW and public0.2.8(87)
READY_FOR_SALE, unchanged build relationships/AFTER_APPROVAL.

Backend947c4108 and TestFlight92 are delivered. Tested and deployed are not the
same as device acceptance: both family members should install92 before comparing
sync behavior; the reported20-second cause/improvement and signed-in production
roundtrip have not been measured. Foreground automatic cadence/backoff, background
limitations and waiting behind an existing sync are unchanged. No claim of instant
cross-device/background sync is made. Fixed-phase telemetry is enabled; no new
private payload capture, retention, AI model/limit, paid resource or push change.
