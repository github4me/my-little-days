# AI quota and connection recovery — 20 October 2026

## Live configuration

The existing production App Service `little-days-api-522fpstfbtds2` was updated
through Azure Portal and verified by 08:10 UTC / 19:10 Melbourne time:

- Added `SleepAi__MaxRequestsPerInstancePerDay=1000` to App settings, with the
  deployment-slot checkbox off. Saved value was read back as `1000` after Apply
  and Confirm completed.
- Retained the deployed `MaxConcurrentRequests=50` and
  `MaxRequestsPerAccountPerHour=30` defaults; neither has an environment override.
- Did not change the model/Fast mode, provider credentials, existing AU$50 budget
  safeguards, timeouts, capture/retention settings, database, hosting tier or
  instance count. No provider spending/retention dashboard was reopened.
- `/health/ready` returned HTTP 200 with `{"status":"ready"}` after the setting
  update. This is process readiness, not proof of a signed-in SQL operation or
  of provider capacity under 50 simultaneous requests.

The durable attempt store counts generation attempts across accounts in shared
SQL, including failed attempts; job polling does not reserve a provider attempt.
The daily boundary is midnight UTC (currently 11:00 Melbourne), not each phone's
midnight. The option name includes `PerInstance`, but this deployed SQL-backed
counter is shared. Raising the application ceiling is not a guarantee that the
provider or existing hosting can sustain 50 requests at once. No paid stress test
was performed. The checked-in default remains 200: the production override is
intentional and must be preserved during later configuration/deployment work.

Safe local proof: `work/ai-quota-1000-20261020.png` shows only the filtered,
non-secret quota row; no secret settings were revealed.

## App recovery changes

Two recoverable failures could leave AI controls missing after status refresh:

1. A refresh waiting on an earlier failed synchronization could return without
   making a new identity check when no local writes were queued.
2. A failed AI capability check could stay terminal even after account access
   recovered, because its availability key had not changed.

Explicit status refresh now makes the missing identity check and, only after
verified current-account recovery, rechecks AI availability. The sleep section
offers **Reconnect AI** when connection/availability recovery is needed.
Previously enabled, same-account/profile controls remain available offline,
including local Turn off AI. Reconnection has a disabled/busy state; Turn off AI
is not blocked by reconnection. A truly signed-out user has a visible sign-in
action outside the collapsed help section.

Only presentation of the same-scope consent choice is retained offline. Access
ports, authorization, forecasts and request payloads are not retained for use
without current permission. Logout, scope/profile changes and day expiry cannot
publish old forecasts. Reconnection resumes the durable job instead of buying
another generation; it is not a manual prediction refresh. No local prediction,
new consent semantics or authentication bypass was added.

## Acceptance and release scope

- `npm run verify`: 1,165 tests passed, zero failures/skips; strict TypeScript
  check passed. This includes session recovery, failed-sync refresh, denied
  capability retry, same-job resumption, offline opt-out and stale-response
  isolation regression cases.
- Isolated production web export used `EXPO_NO_DOTENV=1`, empty API/Entra
  configuration and demo off; browser fixtures block or replace network access.
- Full-App AI browser integration: four cases passed, including the real
  App/hook/storage with a synthetic durable-job access port. This is not native,
  authentication, SQL or real-provider acceptance.
- Isolated AI component browser suite: 72 cases passed, including English/light
  and Simplified Chinese/dark recovery controls at 320pt width, disabled recovery
  while pending, available opt-out, and control restoration without another
  enable action. Existing font-scale, animation and localization cases also pass.
- Exported-App browser navigation suite passed: existing local flows,
  calendar/history, dark/narrow layouts, bilingual family/account, live sleep and
  Today summaries, with local history preserved. All network access was synthetic.

The quota override is live. The app source change is **not yet in an installed
iPhone/Android build, TestFlight or the App Store**. No app build/upload, OTA,
Apple submission replacement or GitHub publication was performed in this task.
Physical-device reconnect/background/VoiceOver acceptance remains outstanding.

Follow-up24October: the frozen app fixes shipped to internal TestFlight0.2.5(78)
and were submitted for App Review; see the
[release receipt](AI-RECONNECT-RELEASE-0.2.5-78-2026-10-24.md).
Approval/public0.2.5 distribution and physical-device acceptance remain separate.
