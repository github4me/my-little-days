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
