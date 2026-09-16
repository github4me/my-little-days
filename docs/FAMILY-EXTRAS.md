# Family photo, reminders and play sharing

Implemented locally for the next release. This document is not evidence of a GitHub, Azure, Expo or TestFlight deployment; record those results separately after an authorized release.

## Agreed behavior

- The family creator should be the member with the most complete baby history. Creation uploads the reviewed history, current baby avatar, reminder rules, all play check-ins and activity selection.
- Joining does not upload or preserve the joiner's personal records. Validate and durably save the downloaded family snapshot before clearing/replacing personal data. No recoverable personal backup is created.
- Invite capacity is five other people, excluding the administrator. Active members and distinct live pending invitations reserve places.
- Shared reminder rules are visible to the family. Notifications remain opt-in on each phone; downloading a rule never grants notification permission or enables delivery. Expired one-time reminders do not restart.
- Avatar and activity selection are family-wide settings managed by the administrator. Members can add reminders and check-ins, and edit/delete their own contributions; the administrator can manage all contributions.
- Leaving, removal and logout clear family content and local family notifications. Offline devices cannot learn remote removals until reconnecting; no family data is restored to the personal database.

## Compatibility and storage

Use the existing family-record JSON store with collection `extra`. Add `extrasSchemaVersion: 1` to capabilities, new creation seeds and full snapshots. Extra kinds: `avatar`, `play-selection`, `play-checkin`, `reminder`, `reminder-settings`. Keep schema-v2 ordinary record contracts and old operation/seed fingerprints compatible. New activation must confirm extras support before any local cleanup.

The photo scope is the current baby avatar, not the device photo library. Upload actual validated JPEG, PNG, HEIC or WebP bytes, never a device path or arbitrary remote URL. The existing 12 MiB decoded avatar limit is retained. Medical history remains limited to 10 MiB; the complete creation seed allows 32 MiB to accommodate the photo and extras. This simple implementation carries the avatar in family snapshots, so large photos increase traffic and local cache size.

The append-only DbUp migration `0003_FamilySharedExtras.sql` expands the existing record-type/JSON constraints. It adds no table, copies no family history, and does not replace existing records or their versions. No new Azure resource, storage account, secret or app registration is required. Deploy the database before the API, then the mobile update. Existing completed activation receipts and older record-operation fingerprints remain compatible.

## Capture and activation

1. **Create:** read the personal history, app-owned avatar file, all stored play-check-in days, play selections, saved reminder settings and scheduled/automatic reminder rules. The review includes extra-category counts and an avatar preview. Legacy activity favorites are used only when a modern selection is absent; deliberately cleared selections remain cleared.
2. **Confirm:** recheck the reviewed source immediately before first dispatch with personal/reminder writes blocked and drained. A changed or unreadable source stops creation before cleanup and requires a new review. An uncertain network result is resolved using the same durable activation operation, not a second creation.
3. **Join:** do not upload the recipient's personal extras. Require an extras-capable server, validate the downloaded family snapshot, and durably save it before clearing/replacing the recipient's original local data. Cancelling before confirmation does not erase data.
4. **Use:** display and edit extras only through the family cache and versioned family-operation queue. Nothing is written back into personal storage. Owner-only settings cannot be edited by a member; member-authored reminders/check-ins follow the same author/administrator rules as other shared records.

This describes explicit create/join activation. It does not add a new per-device destructive migration when an already joined account signs in on another phone. The existing second-phone policy remains unchanged.

## Reminder behavior and legacy records

- Downloading shared reminder rules does not schedule notifications or ask for OS permission. In **More → Reminders**, each member explicitly chooses **Enable on this phone**. Disabling affects that phone only and does not delete the family rules.
- One-time reminders retain the original absolute deadline. Past deadlines remain in shared records but are not rescheduled. Daily reminders use each phone's local time. After-feed reminders use the latest family feed, without duplicating a saved automatic rule and its derived native notification.
- Device opt-in is scoped to the account/family/membership/history origin. It is separate from personal settings. Logout, leaving/removal and switching origin cancel family notifications and prevent old in-flight scheduling from restoring them. Remote removal cannot be learned while a device remains offline; test reconnection explicitly.
- An older iOS one-time notification may not contain its original creation/deadline metadata. Creation then stops with a legacy-reminder warning instead of guessing a new time or silently dropping it. Return to personal **More → Reminders**, review the affected old reminders, and explicitly cancel/recreate those you want to keep. Use their intended due time, then start a fresh family review. Never clear all app data to work around this warning.
- An unrecognized older reminder configuration also stops capture. Review/recreate that rule in the app; do not invent settings from its display label. Unreadable photos or invalid extra records similarly stop activation before cleanup.

## Release and acceptance

Follow the detailed [Azure manual setup runbook](AZURE-MANUAL-SETUP-RUNBOOK.md#family-photos-reminders-and-play-release-and-phone-acceptance) for migration, API deployment and phone checks. The database/API workflow and mobile publication remain separate actions.

`npm run verify` includes the pure extras, capture, permissions, family lifecycle, shared Play and shared reminder UI checks. SQL-backed API and DbUp tests cover the new constraints, authorization, immutable extra kind, concurrent updates and old-operation compatibility. Browser flows and an iOS JavaScript export check bundling/UI regressions; neither verifies actual iPhone image decoding, SQLite activation or notification delivery. Those require the two-phone acceptance steps in the runbook.

Local verification on 16 September 2026: `npm run verify` passed, including the hidden daily-reminder interval regression. The SQL-backed solution tests passed all 177 tests (166 API and 11 migrator), with none skipped. Normal and family-demo browser suites passed. The normal browser suite initially hit the existing post-resize calendar alignment assertion, then passed on retry without a calendar implementation change; that intermittent failure is not claimed to be a fixed calendar defect. The demo bundle initially reused a Metro transform with demo mode disabled; a clean export (`--clear`) restored the intended flag and its browser suite passed. None of these checks deployed cloud resources or exercised real iPhone notifications.
