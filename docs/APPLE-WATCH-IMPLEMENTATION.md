# Apple Watch implementation and rollout

18 September 2026. Source implementation is present. The user subsequently approved
EAS building: combined iPhone/Watch **0.2.1 (31)** compiled and signed successfully
as build `24af9879-54a8-4044-998a-5ce4197536b2`. The Watch identifier/profile were
configured on the existing Apple team, reusing its distribution certificate.
See the [manual runbook](AZURE-MANUAL-SETUP-RUNBOOK.md) for release evidence. The API/database were subsequently
deployed in [the backend release](APPLE-WATCH-BACKEND-DEPLOYMENT.md); notification
delivery remains disabled. Build 31's TestFlight upload was rejected because its
Watch icon retained an alpha channel (90396/90717). The packaging now composites
the existing artwork onto its blue background and encodes RGB, with regression
checks for alpha, dimensions, artwork preservation and repeatable generation.
Replacement build 32 is tracked in the manual runbook. Existing installed iPhone
build 30 lacks the Watch changes; successful compilation is not Apple acceptance.

## Implemented

- Native SwiftUI companion: milk feeds (formula, expressed-milk bottles and
  breastfeeding), nappies and sleep. Pumping is excluded. Native lists, navigation,
  amount presets/Crown adjustment, semantic colours, English/Chinese and accessibility
  labels. The Watch shows the date of cached totals, not yesterday's totals as today.
- Immediate local timer state and protected persistent commands. Sleep shorter than
  60 seconds is cancelled as a likely mistap; exactly 60 seconds remains valid.
  A saved Watch command is distinguished from phone persistence and confirmed sharing.
- Native iPhone inbox survives JavaScript suspension. Stable IDs, atomic phone
  persistence plus receipts, dependency-aware timer completion, duplicate handling
  and explicit scope/generation binding preserve existing recording semantics.
- Account/family/history changes invalidate the Watch context. Unknown access pauses
  it. Family context expires no later than 24 hours after successful phone validation;
  reopening a cached screen cannot extend that lease. Family Watch writes require the
  server's timer-enforcement capability; older/off servers do not enable them.
- Optional **More → Family entry notifications** while a full family is available:
  milk feeds, nappies and sleep added by other members only. All the creator's devices
  are excluded. Existing care reminders remain separate. Preferences are per installation.
- Generic remote alerts contain no names, email addresses, baby details or record
  content. Opening an alert requires fresh authoritative access, not just cached
  sign-in. Apple decides whether to present a forwarded alert on iPhone or Watch.
- Default-off API registration, encrypted push tokens, bounded transactional event
  and delivery queues, catch-up summaries, retries, provider receipt checks, invalid
  token handling and removal/deletion cleanup. Migration 0006 adds indexes and
  schema verification without modifying migrations 0001–0005 or deleting old timers.

### Source map

| Component | Source |
| --- | --- |
| Native Watch app and protocol | `watch/WatchApp/`, `watch/Shared/`, `watch/Tests/` |
| Native phone receiver | `modules/watch-bridge/` |
| Reproducible target and EAS declaration | `plugins/with-watch-companion.js` |
| Phone command routing and receipts | `src/watchProtocol.ts`, `src/watchFamily.ts`, `src/useWatchCompanion.ts`, `App.tsx`, personal/family storage |
| Notification preferences and registration | `src/family/familyPush*`, `src/family/useFamilyPush.ts`, `src/family/FamilyPushSettings.tsx` |
| Sender, registration and schema | `server/LittleDays.FamilyApi/Push*.cs`, `server/LittleDays.DatabaseMigrator/Scripts/0006_FamilyPushAndTimerIndex.sql` |

## Boundaries to understand before testing

1. The Watch is a paired-phone companion, not an independent cellular client. It
   receives no Entra tokens. Sign-in, family changes and detailed editing stay on
   iPhone. Open Little Days on the phone to apply received commands; native receipt
   alone does not mean a record is saved in SQL. Background delivery is opportunistic.
2. Drain pending Watch commands **before** creating/joining a family. The phone blocks
   transitions when it knows its native inbox is nonempty. It cannot discover commands
   stranded on a disconnected Watch. Commands from an old context are quarantined,
   never merged into the new family. Do not uninstall either app to troubleshoot;
   there is no general-purpose export/recovery UI for quarantined Watch commands yet.
3. Registration expires after 24 hours and is renewed by an opted-in foreground phone
   app. Alerts stop if renewal does not occur; this is not an always-on independent
   Watch subscription. The registration lease and cached Watch context lease are
   separate. Check this product trade-off during acceptance.
4. Offline opt-out is retained locally, but the server may send generic alerts until
   it confirms the change or the registration expires. Already accepted provider
   notifications cannot be recalled. An unresolved previous-account registration
   is not replayed with a new account: sign in to the original account to resolve
   it, rather than clearing SecureStore or manufacturing another binding.
5. Delivery is best effort. Retried provider calls may duplicate an alert after an
   ambiguous timeout; a ticket/receipt is not proof someone saw it. Old entry imports
   are summarized, normal retries/edits/owner seeding do not generate new alerts.
6. No HealthKit, pumping, complications, widgets, independent Watch authentication,
   new Entra registration or separate Azure queue service is included.

## Manual setup, in order

### 1. Native build proof on Mac

1. Record actual Watch model/watchOS, iPhone/iOS and Xcode version. The generated Watch
   target is **watchOS 9.4+**; confirm the real device and selected Xcode support it.
2. Work from the reviewed source revision in a clean checkout. Keep the existing app
   identifiers and install over the current application to preserve local records.
3. Run `npm ci`, `npm run verify` and `npm run test:watch-prebuild`. The latter performs
   two iOS prebuild passes and checks target embedding/idempotence. Windows reports
   **SKIP**, not a successful native build.
4. Run `swift test --package-path watch`. Then `npx expo prebuild --platform ios
   --no-install`, run `pod install` in `ios`, and open the generated Xcode workspace.
5. Confirm the phone target embeds `LittleDaysWatch.app`; verify the paired Watch
   destination and both signing profiles. Build and run, then test local recording,
   app termination, reconnect and duplicate delivery before family rollout.
6. Retain `com.littledays.babylog`. The companion identifier is
   `com.littledays.babylog.watchkitapp`. The plugin declares the Watch credential
   target to EAS before prebuild. Register/sign this extra identifier on the existing
   Apple team as required; do not create a separate App Store product or rename the
   phone app. Target and parent marketing/build versions must agree.

### 2. Apple and Expo push configuration

1. In **Apple Developer → Certificates, Identifiers & Profiles → Identifiers**, open
   `com.littledays.babylog` and verify **Push Notifications** capability. Confirm the
   resulting signed phone app contains the correct APNs entitlement.
2. In EAS credentials for the existing project, inspect/reuse a valid APNs key. Create
   one only if needed. The APNs key is **not** the App Store Connect submission key.
3. Use Expo project `a5210f78-8729-46d4-82a4-7d1d40d30ac6` (`expo4chao/little-days`).
   Configure Expo's enhanced push security/access token using the current
   [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
   and [sending guidance](https://docs.expo.dev/push-notifications/sending-notifications/).
4. Store the sending access token only in restricted server configuration. Never put
   it, the token-encryption key or Apple private keys in `EXPO_PUBLIC_*`, GitHub logs,
   screenshots, source control or mobile bundles.

### 3. Database and API, with features off

1. Review additive `0006_FamilyPushAndTimerIndex.sql`, schema verifier, runtime grants
   and API together. Confirm production restore/backup readiness and the existing
   migration identity. No new blanket SQL role assignment is needed.
2. After source is committed/pushed and CI passes, open **GitHub → Actions → Deploy
   family API and database → Run workflow**. Select the configured trusted branch
   (currently `feature/family-invitations`), confirm existing SQL bootstrap/review,
   leave legacy EF adoption off, and review the protected environment approval.
3. Allow the existing flow to build/test, migrate and then deploy the matching API.
   Verify the migration journal/checksum and schema/index verification succeeded.
   Do not edit old migration checksums or manually run a partial schema script.
4. Keep the SQL **Basic** tier and existing App Service. Do not enable the paused
   free-SQL-only infrastructure workflow or apply unrelated Bicep changes.
5. Verify all push flags and the timer-enforcement flag remain false while completing
   native/credential readiness. Existing phone recording must continue normally.

### 4. Azure configuration and isolated acceptance

In **Azure Portal → App Services → little-days-api-522fpstfbtds2 → Settings →
Environment variables → App settings**, configure the following (labels can vary
slightly by portal version). Save/apply deliberately; settings may restart the app.

| Setting | Initial value |
| --- | --- |
| `Push__RegistrationEnabled` | `false` |
| `Push__EventCreationEnabled` | `false` |
| `Push__DeliveryEnabled` | `false` |
| `Push__ProjectId` | `a5210f78-8729-46d4-82a4-7d1d40d30ac6` |
| `Push__Environment` | `production` — preview uses the same production services |
| `Push__TokenEncryptionKey` | Secret: base64 encoding of 32 cryptographically random bytes |
| `Push__AccessToken` | Secret: Expo enhanced push security sending access token |
| `Push__AllowedUserIds__0`, `Push__AllowedUserIds__1` | Object IDs of two consenting disposable **customer** accounts |
| `Push__AllowAllUsers` | `false` for isolated acceptance |
| `Push__MaxInstallationsPerAccount` | `5` |
| `Family__EnforceSingleActiveTimers` | `false` until the next checks pass |

Keep one persistent encryption key across restarts/replicas. Replacing it makes old
encrypted tokens unreadable; do not rotate it casually. Generate/store it through
an approved secret-management process without printing it to CI logs. No Key Vault
resource is required by this implementation. Do not use infrastructure-admin,
migrator or app-registration IDs for the customer-account allowlist.

1. Confirm migration 0006 is applied and **all** API writers run compatible code.
2. As an authorized SQL operator, review this **read-only** query:

   ```sql
   SELECT FamilyId, ActiveTimerKind, COUNT_BIG(*) AS ActiveTimers
   FROM dbo.FamilyRecords
   WHERE ActiveTimerKind IS NOT NULL
   GROUP BY FamilyId, ActiveTimerKind
   HAVING COUNT_BIG(*) > 1;
   ```

   Resolve legitimate existing timers in consultation with their owners; do not
   delete rows as an automatic cleanup. Then enable `Family__EnforceSingleActiveTimers`.
   Verify fresh family snapshots advertise Watch recording readiness. This flag
   affects family writers globally, not just notification-cohort accounts.
3. Set the explicit notification cohort **before** enabling registration, then enable
   event creation and finally delivery. Empty/missing cohort must not mean everyone;
   broader rollout requires explicit `Push__AllowAllUsers=true` after acceptance.
4. Verify App Service availability/background worker operation. Check existing
   **Always On** configuration for reliable hosting; it does not make phone/Watch
   background execution guaranteed. Do not resize the shared B1 plan without review.
5. On a signed native phone build, sign in to a disposable family, open **More →
   Family entry notifications**, enable the desired categories and grant OS permission.
   Check the iPhone Watch app's notification mirroring settings. Test with phone
   locked/unlocked and Focus enabled/disabled; Apple may alert only one device.

### 5. Acceptance and release

Use disposable families only. Verify two members/two devices, each milk type, nappy
types, sleep cancellation at 59/60 seconds, phone/Watch restart, offline recording,
late ACKs, concurrent timers, membership removal, account change, expired context,
new history, denied notification permission, opt-out while offline, token rotation
and provider rejection. Repeat on small/large Watch layouts with VoiceOver/larger text.

After approval, create a **new combined native EAS build**, not OTA. Verify clean
prebuild, signed target embedding, version alignment and install over the existing
app. Submit the exact store build to TestFlight, verify Apple processing and intended
tester availability separately. Record source SHA, migration/API revision, build and
submission IDs and actual physical-device results. Follow existing runbook signing
and TestFlight instructions; no release was triggered by implementing this feature.

## Rollback and recovery

- Stop new alerts with `Push__DeliveryEnabled=false`; disable event creation and new
  registration as needed. Keep secrets/bindings and additive tables, do not truncate
  queues/domain receipts or undo DbUp history. Already accepted alerts cannot be recalled.
- Keep the compatible schema/API while returning to the previous mobile build if
  needed. Setting timer enforcement false disables family Watch capability on refresh;
  disconnected Watch caches are bounded by their lease, not immediately reachable.
- Before restore, set `Recovery__Blocked=true`, drain/stop workers and follow the
  existing restore procedure. Reconcile history IDs, revocations and installation
  bindings before reopening. Never replay stale queues into a restored family.

## Verification record

- TypeScript/unit/controller/UI/native-adapter and plugin tests: `npm run verify` passed.
- Web export and full existing browser regression passed. iOS JavaScript bundle
  export passed. Metro needed `--max-workers 1` in this Windows environment after
  its default worker count exhausted memory; this was not an application runtime failure.
- API/DbUp tests: **313 passed** (246 API + 67 DbUp, zero failures/skips) against
  disposable local SQL databases with a fake push provider. No production SQL or
  real recipients were used.
- **Cloud native build verified afterward:** EAS build 31 completed on 18 September;
  native generation, compilation and signing passed. Final IPA inspection confirmed
  the embedded Watch executable and provisioning profile.
- **Not verified:** standalone Swift protocol test execution, physical Watch
  installation/connectivity, APNs delivery and TestFlight acceptance.
  Windows has no local Xcode/Swift toolchain; EAS supplied the cloud build toolchain.
