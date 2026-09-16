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
| Startup, returning to foreground | Validated same-account cached history renders while background identity/snapshot checks run. Known expired, revoked, incompatible or unresolved activation state remains blocked. No new change needed. |
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
