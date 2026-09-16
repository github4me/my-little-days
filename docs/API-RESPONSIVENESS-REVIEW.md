# API responsiveness review — 17 September 2026

Scope: mobile actions that call or trigger the family API, their local UI updates,
and the synchronization/controller paths. This is a source and regression review,
not a production latency measurement. Existing security findings remain in
[the separate security review](SECURITY-REVIEW-2026-09-17.md).

## Outcome

Ordinary shared records already use a local-first outbox. Keep this design:
update the local projection immediately, persist it before sending, then sync in
the background. A local saving indicator is still appropriate until persistence
finishes; it must not imply that the server has accepted the change.

The following avoidable waits were corrected:

- **Feeding controls:** a pending start was excluded by the ordinary edit lock,
  hiding the running timer until an API response. Pending feeding timers now stay
  visible and can open the existing Stop/amount confirmation immediately.
  Confirming the actual amount updates the local projection without waiting for
  the server. Cancelling the dialog still leaves the timer running.
- **Safe timer completion:** when the start is already queued/in flight, persist
  a separate completion intent without changing the original request or ID. After
  its receipt and a fresh snapshot, send a versioned follow-up. The Stop dialog's
  captured content/version is checked to avoid overwriting a changed record.
  Local-write failures roll back; permission/history changes and remote edits
  retain the existing rejection/conflict behavior. Prior sleep improvements are
  preserved.
- **Duplicate reads:** idle sync previously downloaded the full family snapshot
  twice. It now downloads once. A sync that attempts a record write still checks
  grants before sending and downloads again afterward to reconcile the result
  or conflict.
- **Repeated refreshes:** callers waiting for an existing sync no longer start
  another empty round if it has already completed their work. Pending or accepted
  work and unresolved transitions still trigger the necessary follow-up refresh.
  A request from an obsolete session cannot schedule a new round after logout.
- **Logout:** cancel a background API transfer before waiting for it to finish,
  rather than waiting for the snapshot timeout. Still drain it, durably discard
  the workspace, and clean up credentials/cache/notifications in order. If the
  local discard fails, report that failure and renew the request controller so
  the still-signed-in session can refresh again. Cancellation does not undo a
  request that the server already committed; existing logout/discard semantics
  are unchanged.
- **Necessary waits:** profile Save, invitation creation, reauthentication and
  deletion-status checks show progress on the initiating button, rather than
  leaving only an unexplained disabled button. Existing modal progress remains.

## Reviewed operations and boundaries

| Operation | UI/network behavior retained or changed |
| --- | --- |
| Startup, returning to foreground | Validated same-account cached history renders while background identity/snapshot checks run. Returning to the app now quietly retries a transient interrupted sync before showing a connection warning; see the follow-up below. Known expired, revoked, incompatible or unresolved activation state remains blocked. |
| Feeding and sleep start/stop | Local projection first; durable timer follow-ups support stopping before the start is acknowledged. Feeding retains explicit amount confirmation. |
| Feeding, nappy, sleep, growth, milestone and care saves/deletes | Existing optimistic outbox is already independent of API response. Preserve local durability, permission checks and conflict handling. |
| Avatar, shared reminders, early-learning settings/check-ins | Already locally projected and queued. Keep pending same-record edit locks; allowing unrestricted re-edits would require additional versioned follow-up logic, not just moving an `await`. |
| Manual/background refresh | Keep cached data visible when allowed, coalesce redundant rounds, omit the second snapshot when no write was attempted. |
| Shared baby profile | Still server-confirmed with its existing durable management transition; clearer Save feedback. Replacing this with an optimistic profile outbox is a separate design change. |
| Login/reauthentication | Authentication and verified account identity must precede showing the signed-in account. Retain session isolation; clarify progress. |
| Create/join family | Retain reviewed upload/download, durable transition, seed/schema verification and local-data replacement order. Never show successful activation before confirmation. |
| Invite/decline/revoke, remove member, ownership transfer | Retain server-confirmed capacity, role and membership results. Do not optimistically grant/revoke access or claim an invitation was created. |
| Leave/dissolve family, delete account | Retain confirmations, durable intent/receipt, cleanup and verified outcome. A request timeout must not be displayed as success. |
| Logout | Abort the background API wait, but still finish the required local privacy cleanup before success. |
| Account deletion status | Keep receipt-bound server query and existing result validation; show inline progress. |
| Local-only preferences, backup and manual record forms | No family API wait to remove. Existing storage, validation and native permission work remains necessary. |

Relevant implementation: `App.tsx`, `src/family/useFamilyPilot.ts`,
`src/family/fullState.ts`, `src/family/pilotState.ts`, `src/Settings.tsx` and
`src/family/FamilyScreenView.tsx`. No API, database, Azure or authentication
configuration changes are required.

## Verification and device follow-up

`npm run verify` passes, including 108 controller and 41 family UI tests. New
regressions cover delayed feeding-start responses, actual-amount completion,
offline restart, stale dialog content, failed local saves, coalesced refreshes,
pre/post-write snapshots, stalled-request logout and recovery after a failed
discard. Bilingual UI tests cover progress labels through completion and failure.
An independent review found no new blocking issue in these changes.
The complete browser regression and Web/iOS JavaScript/Hermes exports also pass.
An iOS export is not a signed IPA or a real-device test.

Before release, use fictional records on two iPhones:

1. Slow or interrupt the network, start feeding, and immediately tap Stop. The
   timer must remain visible; the amount selector must open without an API wait.
   Confirm a different amount, restart, reconnect, and verify one completed record
   with the correct amount/time on both phones.
2. Change the same record on the other phone while the amount dialog is open.
   Confirm the older dialog cannot silently overwrite the newer record.
3. Start a slow refresh, add a different record, and confirm it appears locally
   without waiting. After reconnection, verify it is not lost or duplicated.
4. Log out during a slow snapshot download. Confirm local history/notifications
   are cleared as required and an eventual old response cannot restore them.
5. Exercise profile Save, invitation creation, reauthentication and deletion-status
   checking on slow networks; verify progress and errors are understandable and
   successful account/family outcomes are not shown before confirmation.

Native SQLite, iOS authentication, real network behavior and dual-device results
still require this device validation. No live API writes, deployment, commit,
push or Expo/TestFlight release were performed as part of this review.

## Follow-up: quiet foreground reconnection — 17 September 2026

The real controller harness reproduced an interrupted `/v1/me` request that
outlived backgrounding. Returning to the app joined that old request; its network
failure immediately changed the account to unverified, displayed a connection
warning and scheduled a 30-second first retry. This is a confirmed code path,
not proof of the precise network failure on the reported iPhone.

- Keep the guarded same-account cache visible while checking in the background.
  A transient interrupted check or first foreground reconnect gets one fresh,
  serial retry before the usual warning/backoff. Do not loop while backgrounded.
- Clear only an automatic sync connection warning when reconnection starts;
  explicit action errors, data conflicts and storage failures are not treated as
  connectivity noise. Cold-start cache validation is unchanged.
- Preserve the sync lock, durable operation IDs, and fresh grant/snapshot checks
  before sending queued records. No extra unversioned write or new invitation is
  created to retry a refresh.
- HTTP 401, known sign-in expiry, revoked access, account mismatch and invalid
  responses retain their existing immediate protection. A network check in
  progress is not a newly verified session. If identity checking fails transiently,
  notification delivery stays suspended until identity verification succeeds,
  even though the cached account presentation remains stable during the retry.

Verification: `npm run verify` passed (395 tests including 119 controller tests;
11 new resume regressions, plus TypeScript). The focused tests cover interrupted
and newly started reconnects, background-only failures, continued outage, cached
history and exactly-once queued submission, notification suspension across
renders, logout during retry, real 401/expiry/removal, and explicit invitation
errors. Independent source review found no remaining blocker in this change.
Web export and the complete browser regression also passed. The requested native
review release is prepared as iOS 0.2.1 / build 20 on the preview profile, with
unsigned OTA still disabled. Build completion and installation need separate
confirmation; no API, database or Azure deployment is part of this follow-up.

Release CI exposed an unrelated midnight fixture issue: the browser uses
Melbourne time, but the test calculated "tomorrow" in the Node runner's timezone.
Reproduced locally with `TZ=UTC`; at the reported time that did not advance the
browser's calendar day. The fixture now derives next midnight inside the browser.
This changes tests only, not the signed preview's application behavior.
After rebuilding the Web bundle for build 20, the complete browser regression
passed locally with the Node runner set to `TZ=UTC` as well.

[Native preview build 20](https://expo.dev/accounts/expo4chao/projects/little-days/builds/4ec5e7f4-454b-47d4-acc9-e53625c9d0ce)
uses application commit `2c2c57f94edb209397db31ff12028dcc461ade71` and the existing
two registered iPhones. The later timezone fixture/documentation commit does not
change the application. Confirm the build page says finished before installing;
install over the existing app rather than deleting its local data first.

Device follow-up (no Azure/GitHub configuration change is needed):

1. Install a build containing this follow-up over the existing app. This is a
   local source change until published; an older preview does not contain it.
2. Start a refresh, background/lock the phone, and return after both a short wait
   and several hours. With connectivity available, cached records should stay
   visible without an immediate offline flash. Verify a newly saved record is
   eventually shared once, not duplicated.
3. Repeat with the network unavailable. After the fresh reconnect attempt fails,
   the connection warning must appear and locally saved changes must remain.
4. Restore connectivity and return again. Verify successful recovery clears the
   automatic warning. An expired login or a member removed from another phone
   must still require login or remove family access as appropriate.
5. Log out during the retry. Confirm neither its eventual response nor reminder
   delivery restores the signed-out family. Native suspension, real token refresh
   and two-device behavior still need this physical-device check.
