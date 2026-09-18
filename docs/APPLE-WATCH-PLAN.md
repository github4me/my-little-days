# Apple Watch support plan

Status: implementation added locally on 18 September 2026. This document records
the design and acceptance requirements; the inventory below describes the starting
point, not the current source tree. See [implementation and rollout](APPLE-WATCH-IMPLEMENTATION.md)
for implemented components, verification and remaining release gates. EAS combined
build 31 subsequently passed native compilation/signing with the new Watch profile;
its IPA contains the embedded Watch app. The API/database have since been deployed;
build 31 was rejected by Apple for an alpha channel in its Watch icon. The icon
packaging is fixed and replacement build 32 is running. TestFlight acceptance and
physical-device verification remain outstanding; see the
[manual runbook](AZURE-MANUAL-SETUP-RUNBOOK.md) for current release evidence.

## 1. Recommendation and scope

Build a native **SwiftUI companion Watch app** for quick milk-feed, nappy and
sleep recording. Keep the existing Expo iPhone app, Entra sign-in and Azure API.
The Watch saves commands locally first; the iPhone applies them through the
existing personal/family recording rules. Add opt-in remote notifications for
records added by other family members.

Scope confirmed by the user on 18 September 2026:

- Record milk feeds: formula, expressed-milk bottles and breastfeeding. Pumping
  is out of scope; expressed milk consumed by the baby is a feed, not a pumping
  session.
- Notifications cover milk feeds, nappies and sleep added by other family
  members only. Growth, milestones, daily care and other record types are excluded.

Recommended first release: paired-iPhone operation, not an independent cellular
Watch app. Sign-in, family creation/joining, invitations, account deletion,
backfilling and detailed editing remain on iPhone. No additional Entra app
registration is expected for this companion design; no access/refresh tokens go
to the Watch. Independent Watch networking would need a separate security design.

### First-release experience

| Area | Watch behaviour |
| --- | --- |
| Home | Cached baby context, current feed/sleep timer and three clear actions: Milk, Nappy, Sleep. Today's totals explicitly say “Today” and show zero when empty. Show when context was last updated. |
| Milk | Quick formula/expressed-milk recording with amount presets and Digital Crown adjustment; breastfeeding left/right/both timer. Bottle timer completion asks for actual consumed volume; breastfeeding does not invent a volume. |
| Nappy | Wet, dirty or mixed, using the captured current time. Confirm local persistence with brief feedback; prevent repeated taps from creating duplicate commands. |
| Sleep | Show sleeping/awake immediately, without waiting for the API. Calculate elapsed time from the stored start time, not a continuously running background timer. Preserve the existing cancellation rule for live sleeps shorter than 60 seconds; exactly 60 seconds is retained. Backfilled short sleeps remain valid on iPhone. |
| Family alerts | Opt-in notification when another member adds a milk-feed, nappy or sleep record. Open the relevant context only after access checks; do not add records as a side effect of tapping an alert. |

Use native watchOS navigation, semantic colours, readable text, SF Symbols and
short task-focused screens, not a reduced copy of the iPhone's five tabs. Support
Chinese/English, larger text and VoiceOver. Keep extended explanations on iPhone;
use actionable inline status only when needed. This follows Apple's
[watchOS design guidance](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos).

## 2. What we can reuse, and what is missing

Repository inspection found:

- `src/domain.ts`, `src/sleepTimer.ts` and `src/feedFinish.ts` already describe the
  requested record types, validation and timer completion behaviour.
- `App.tsx` owns personal persistence and routing to family writes;
  `src/family/fullState.ts` already preserves pending operations and timer
  follow-ups while an earlier write is in flight.
- `src/family/useFamilyPilot.ts` generates new operation IDs in its public write
  methods. Watch retries must not call those methods unchanged and create new IDs.
  Its synchronizer also relies on the React runtime/foreground lifecycle.
- `modules/family-storage-security/` demonstrates a local Expo native module and
  app-delegate subscriber. Reuse that integration pattern, not its responsibility,
  for a separate Watch bridge.
- There is no checked-in Watch target or native iOS project. A reproducible
  native-target build and signing proof must precede full Watch UI work.
- Existing Expo notifications are local reminders only. There is no remote device
  registration, server push sender or notification outbox.
- Personal-state validation limits running feed/sleep timers, but the inspected
  family write path does not establish the same global constraint. Resolve that
  concurrency gap before introducing another recording device.

## 3. Recording and synchronization design

### Transport and persistence

The recording path is:

**Watch durable outbox → native iPhone inbox → existing app recording service →
family API when applicable.**

1. The Watch creates a stable command UUID and record UUID, captures timestamps,
   saves the command durably, and updates the screen immediately. A failed local
   save must visibly fail/revert; never display “saved” for an in-memory-only write.
2. Use WatchConnectivity for delivery. Immediate messaging is an optimization when
   reachable; queued background transfer is the fallback. Use application context
   only for replaceable summaries, never as the sole write queue. Apple's APIs
   distinguish immediate messaging, background transfers and latest-state context.
   [WatchConnectivity reference](https://developer.apple.com/documentation/watchconnectivity/wcsession).
3. Activate a native iPhone receiver at app launch. It validates the envelope and
   persists a protected inbox entry **before** acknowledging receipt. Do not depend
   on a React component being mounted, or write directly into the application's
   whole-state database from a native callback.
4. Extract a shared entry-command service from the existing UI-owned write paths.
   When the app runtime can execute, drain the inbox through the same validation,
   local persistence, family permissions and outbox reducers as phone actions.
5. Commit ingestion/dedup metadata atomically with the local record or family queue
   change. If native inbox and application storage are separate, retain the inbox
   command until that application transaction succeeds. Crash recovery must replay
   the same ID, not manufacture another record or operation.
6. Return durable acknowledgements and reconcile them after reconnect. The Watch
   keeps unacknowledged work; bounded storage must reject further saves clearly
   when full instead of evicting unsynced commands.

Keep these states separate internally and in detail/status UI:

| State | What it proves |
| --- | --- |
| Saved on Watch | The Watch has a durable local command. |
| Received by iPhone | The native inbox has a durable copy; it may not yet be an app record. |
| Saved on iPhone / waiting to share | Application persistence succeeded; family work may still be queued. Personal recording ends here. |
| Shared | The server accepted the matching family operation. A later snapshot supplies authoritative record versions. |

Do not expose four noisy banners during normal use; show a compact pending marker
and details when requested. No startup API wait and no immediate “offline” warning
just because background validation has begun.

**Important limit:** native delivery can occur without the React UI, but that does
not guarantee the JavaScript writer or cloud sync will run while the phone app is
terminated. Version one must preserve the command and, if necessary, say “Open
Little Days on iPhone to finish syncing.” No guaranteed instant cloud write with
the phone unavailable. Test physical-device background behaviour before promising
anything stronger.

### Ordering, validation and access

- Version the wire protocol and cap payload sizes. Bind each command to its
  original API/tenant, account, family, membership grant and history ID, or to a
  durable personal-workspace generation. Include pairing/session generation,
  command ID, record ID, payload fingerprint and expected record version.
- Version phone-to-Watch snapshots and invalidations with monotonic context
  generations and snapshot sequences/revisions. Persist invalidation as a
  generation tombstone, not just a cleared screen. Reject older snapshots and
  acknowledgements, and overlay still-pending Watch commands on accepted snapshots
  so an old running-timer snapshot cannot undo a local stop or restore revoked data.
- Never reinterpret old commands under the phone's current account or family.
  Freeze/drain or explicitly resolve pending Watch work before family creation,
  joining, logout or workspace replacement. A disconnected old Watch must not
  upload personal records into a newly joined family.
- Start/stop commands retain dependencies and captured times. Do not mutate an
  already-sent operation. Reuse the existing follow-up/receipt/snapshot mechanism
  to obtain the correct base version before sending a stop/update.
- Preserve birth-date validation, future-time rules, current-minute handling,
  bottle amounts and record ownership. A caregiver cannot stop/edit another
  caregiver's record; an administrator retains current broader permissions.
- Enforce one active feed and one active sleep per family/baby with an indexed,
  transactional server guard. Test simultaneous phone/Watch/member starts. Surface
  conflicts without silently deleting another person's timer. Detect and resolve
  any existing duplicate timers explicitly before enabling the constraint.
- Cancelling a live sleep under 60 seconds must leave no completed sleep record;
  if its start already reached the server, use the existing cancellation path.
  Do not apply that rule to feeding or manual backfill.
- Use protected, backup-excluded storage for Watch cache, outbox and native inbox.
  Existing iPhone SQLite protection does not automatically protect new locations.
  Keep only the minimum recent context; do not copy photos, notes or full history.
- On confirmed logout, removal, deletion or changed history, invalidate the old
  context, queued work and Watch display. A disconnected Watch cannot learn
  revocation instantly: define a bounded cached-context lifetime and require phone
  revalidation after it, with no fallback into personal mode. Resolve the exact
  expiry/recovery policy during protocol design before implementation is accepted.

App Groups are not a shared database between two physical devices. Watch/phone
communication uses WatchConnectivity; a future Watch widget may separately need
an on-device shared container.

## 4. Notifications for records added by others

### Delivery choice and product rules

Use **Azure API → durable notification outbox → Expo Push Service → APNs →
iPhone/paired Watch** initially. This reuses the app's Expo integration and avoids
a new Azure queue/notification service for the first release. Reassess hosting and
cost if measured demand outgrows it; capacity has not been benchmarked.

Apple normally routes a forwarded notification to either the unlocked active
iPhone or the worn/unlocked Watch, not both. Background/silent iPhone pushes are
not forwarded to the Watch. Use visible, privacy-safe notifications and document
that OS routing, permissions and Focus affect presentation. Direct independent
Watch pushes are outside this first release.
[Apple notification forwarding](https://developer.apple.com/documentation/watchos-apps/taking-advantage-of-notification-forwarding).

Proposed notification rules, to be verified in product acceptance:

1. Separate opt-in from existing care-reminder settings. Allow category selection
   within the confirmed milk-feed/nappy/sleep scope and per-device disabling.
   Default off until consent; respect OS settings. On
   disabling/changing categories, cancel affected pending deliveries and advance
   the preference generation. Turning alerts back on must not revive old events.
2. Generate an event only after an eligible new record is committed. Derive the
   actor from authenticated server identity and exclude **all of that actor's
   devices**, including entries submitted through their Watch.
3. No alerts for initial family seed/import, downloads, receipt replay, ordinary
   edits/deletes, settings, avatars or reminder configuration. Family joining must
   not generate a burst of historical-entry alerts.
4. A running feed/sleep creates a record; stopping it is an update. The default is
   one new-record/start alert, not another alert on every timer update. Persist a
   live-sleep delivery's `NotBeforeAt` no earlier than both start + 60 seconds and
   commit + 60 seconds, allowing dependent cancellation commands time to arrive;
   recheck cancellation/record state before sending. This cannot suppress a cancel
   the server has not received yet. “Baby woke up”/completed-duration alerts are a
   separate possible enhancement, not implied by generic update notifications.
5. For late/offline arrivals and backdated entries, aggregate rather than flooding
   the user. Proposed defaults: age is measured from captured entry/start time;
   records older than 15 minutes use one generic catch-up summary per recipient,
   family and installation in a five-minute window. Persist and atomically claim
   summary buckets; arrivals after a bucket is sealed defer to the next window.
   Bound recovery sending so overdue buckets do not become a burst. Expiry is
   measured separately: stop attempting delivery 24 hours after server commit.
   These are tunable proposed policies, not current behaviour or delivery promises.
6. Default lock-screen copy is generic, e.g. “Family records updated.” No baby
   name, email, measurements, note or record JSON in the push. Payloads contain
   only minimal opaque routing identifiers. Fetch details only after current
   authorization when opened; stale/removed access leads to a safe explanation.

Do not treat a push as authorization or as the authoritative data change. Do not
rely on JavaScript's foreground notification handler to protect background OS
notifications. Add an explicit remote-family category to `src/reminders.ts`;
today's unrecognized payloads are classified as personal notifications.

### Backend, indexes and failure handling

Insert events/deliveries in the successful create branch of
`FullFamilyService.ApplyFullRecord`, in the same transaction as the record,
revision and operation receipt. The existing replay check runs before mutation;
`CreateFullFamily` seed import must remain outside this notification path.

Proposed additive schema:

| Table | Purpose and required indexes |
| --- | --- |
| PushInstallations | Authenticated account/device binding, project/app environment, protected token, binding and preference generations, opt-in/categories and expiry. Unique scoped token hash; active-account and expiry indexes. |
| FamilyNotificationEvents | Minimal event metadata, history/family, actor, source operation/record and expiry. Unique `(HistoryId, ActorUserId, OperationId, EventKind)` key, matching account-scoped operation identity; family/time and source-record indexes. |
| PushDeliveries | Recipient membership grant, installation/binding/preference generations, attempts, due/not-before time, optional summary bucket, lease and provider receipt. Unique event/recipient/installation/generations key; indexed pending due-work and lease-expiry scans, plus revocation/cleanup indexes. |
| NotificationSummaryBuckets | Durable aggregation and provider-send claim. Unique history/family/recipient grant/installation/binding/preference/window key; indexed due-work and expiry. Link constituent deliveries so cancellation or expiry removes them without resurrecting an old summary. |

Capture eligible grants and installations at commit; newly joined members or a
newly opted-in phone do not receive old queued history. Device registration must
authenticate the account, enforce installation limits and secure binding/rotation;
possession of a push token or caller-supplied user ID is not proof of ownership.
Use a per-installation secret/challenge and generation checks to prevent another
account stealing an existing binding. Finalize that protocol in security review.

Use a separate bounded `.NET BackgroundService` with an after-commit wake-up signal,
startup recovery and indexed fallback polling with idle backoff. The SQL outbox,
not the in-memory signal, guarantees recovery. Claim small leased batches across
instances and call Expo **outside** SQL transactions/lifecycle locks. Add retry
backoff/jitter, expiry, provider-error handling and delivery diagnostics without
logging tokens or private record data.

Before each send, recheck current history/recovery gate, live family, exact active
recipient grant, deletion status, record availability, device binding, preference
generation, current category selection and opt-in.
Invalidate queued deliveries in the same lifecycle transactions as removal,
leaving, family closure and deletion. Account deletion removes records created or
last edited by that account; cancellation must cover both. A new invitation/grant
must not revive old notifications.

Track provider tickets and receipts separately. Disable permanently invalid tokens
only if their generation still matches. Old unregister requests or delivery
receipts must not disable a newer binding. A database restore must keep the sender
blocked until old history, bindings and revocations are reconciled.

Expo/provider acceptance is not proof that the person saw an alert; retries can
produce duplicate display. Stable event IDs help deduplication but cannot promise
exactly-once OS delivery. Already-submitted pushes cannot be recalled, including
after offline logout or a concurrent removal; generic content limits this exposure.
[Expo delivery semantics](https://docs.expo.dev/push-notifications/faq/).

Expire notification metadata on a bounded retention schedule; do **not** apply
notification TTLs to existing domain operation receipts. Monitor queue age,
failures, SQL DTU/I/O/storage and batch sizes. No scans of all records or JSON
payloads per notification. Keep the existing SQL Basic database; do not re-enable
the paused free-only infrastructure deployment to add this feature.

## 5. Implementation sequence and exit criteria

| Phase | Work | Exit criterion |
| --- | --- | --- |
| 0. Build feasibility | Choose supported Watch/iOS versions from actual devices. Add an empty SwiftUI companion target through a reproducible config plugin, embed it in the iPhone build and establish target signing. | EAS creates a correctly signed combined build; a physical Watch installs it and exchanges a test message. Stop and resolve build integration before feature UI. |
| 1. Durable command foundation | Extract shared entry commands, controlled stable IDs, native inbox, Watch outbox, context binding and acknowledgements. Add protocol versioning and active-timer concurrency protection. | Duplicate/reordered/crashed deliveries create one intended record; account/family changes never reroute pending work. Existing iPhone flows remain compatible. |
| 2. Watch recording | Native home, milk/nappy/sleep flows, cached timers, compact pending status, error recovery, accessibility and both languages. | All three actions work offline locally; reconnection converges correctly, with no API-gated UI. |
| 3. Family push | Add device preferences/registration, immutable DbUp migration, transactional events, sender, receipts and authorized notification opening. | Another member receives an eligible alert; the actor does not. Imports/retries are silent; revocation and invalid-token tests pass. |
| 4. Integrated acceptance | Physical phone/Watch lifecycle, two-account family tests, privacy, battery, concurrency and recovery verification. | Required cases below pass; known OS limitations are documented rather than hidden. |
| 5. Controlled release | Additive schema first, compatible API with new features off, signed iPhone+Watch TestFlight build, then gated acceptance-cohort activation followed by wider opt-in availability. | Exact build and deployment revisions recorded; tester availability and physical acceptance verified separately. |

Expo documents config-plugin/extra-target credential support, but its CNG extension
support is experimental and does not prove this repository's Watch target works.
Phase 0 must establish that. Keep native source outside generated output and verify
clean prebuild regeneration. Do not hand-edit generated Xcode files as the only
implementation. [Expo multi-target guidance](https://docs.expo.dev/build-reference/app-extensions/).

Likely change locations (proposed, not already implemented):

- `watch/`, a target-generation config plugin, `modules/watch-bridge/`, and
  `src/watch/` for SwiftUI, native transport and TypeScript ingestion.
- `App.tsx`, `src/domain.ts`, `src/family/useFamilyPilot.ts`, persistence and
  `src/family/fullState.ts` for shared command execution without changing rules.
- `src/reminders.ts` and a separate family-push module/settings section.
- API contracts, `FullFamilyService.cs`, `PilotDatabase.cs`, lifecycle cleanup,
  `RecoveryGate.cs`, configuration and a new notification worker.
- New migration(s) after current `0005`, runtime grants and `SchemaVerifier.cs`;
  never rewrite existing DbUp scripts. Contract/protocol/native/server tests and
  release documentation accompany each phase.

### Required acceptance cases

- Sleep 59,999/60,000 ms boundaries; backfill exception; actual bottle volume;
  captured stop time; current-minute/future-time limits; midnight/DST/timezone and
  device-clock changes; no duplicate timers after concurrent starts.
- Duplicate, reordered and delayed commands; start/stop before start receipt;
  crash at every persistence/ack boundary; storage full; queue limit; app upgrade;
  old protocol handling without silently discarding work.
- Phone foreground/background/terminated, Watch termination/reboot, Bluetooth and
  Wi-Fi loss, reconnect and watch switching. Verify the “open iPhone” limitation.
- Logout, account switch, personal-to-family transition, removal/reinvitation with
  a new grant, history restore, account deletion and stale row versions while
  commands/notifications are in flight. Use disposable accounts/data only.
- Local stop followed by an older running-timer snapshot; invalidation followed by
  an older authorized snapshot; re-pair/account change followed by old acknowledgements.
- Notification opt-out/denied permission, own-account exclusion, bulk-import and
  out-of-scope record suppression, offline-backlog suppression, token rotation,
  provider failure, worker restart,
  lease recovery, concurrent summary claims, expired events, off-to-on preference
  changes and tapping after access removal.
- Physical Watch delivery with phone locked/unlocked, Focus and notification
  mirroring; both languages, small/large supported Watch sizes, larger text and
  VoiceOver. Browser/simulator results do not establish these native behaviours.
- Existing iPhone typecheck/unit/browser and API/SQL suites remain green. Add Swift
  tests and cross-language protocol fixtures; do not regress fast cached startup.

## 6. Manual prerequisites, rollout and rollback

The step-by-step owner checklist is in
[manual runbook section 31](AZURE-MANUAL-SETUP-RUNBOOK.md#31-planned-apple-watch-support-prerequisites).
It is a planned checklist, not evidence that any setup has happened.

The recording and notification categories above are confirmed. Before implementation
starts, confirm the target Watch model/watchOS plus available Mac/Xcode. Before release, resolve the
cached-context expiry policy, build/signing proof and notification semantics.

Keep old iPhone clients working throughout additive migrations and API deployment.
Use separate server gates for registration, event creation and delivery, plus
Watch command capability/version negotiation. First enable registration/events/
delivery only for the explicitly isolated acceptance cohort, then extend
availability to intended consenting users after acceptance. Do not enable pushes
against all production users merely because a schema migration succeeded. Preview
currently uses production data; acceptance must use explicitly isolated test accounts.

Rollback disables new feature admission/delivery and uses a known-good compatible
app/API. Keep durable pending commands visible and recoverable in their original
context; do not drop new tables, erase outboxes, or replay them under another
account. Paused notifications expire normally; they are not replayed en masse
when re-enabled. Document the exact rollback flags and safe queue handling during
implementation. OTA is disabled, so native Watch changes require new signed builds.

Deferred: independent cellular operation/direct Watch authentication, direct Watch
APNs registration, pumping inventory, complications/Smart Stack widgets, HealthKit,
family management on Watch, and detailed history/backfill editing on Watch.

Planning validation: repository read-only inspections and separate native-sync and
server-notification reviews, plus Apple/Expo documentation. No native build,
physical-device test, push delivery or live Azure capacity check was run.
