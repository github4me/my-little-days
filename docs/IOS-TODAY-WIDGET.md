# Today widget

## Plan and design

Add a read-only WidgetKit extension, not a web view or a background API client.
Reuse the phone's authorized local summary and existing companion lifecycle.
Offer small (three compact rows) and medium (three aligned columns) Home Screen
widgets. The whole surface opens Today via `mylittledays://today`.

Statistics match Today: recorded milk in mL, nappy changes, and recorded sleep
duration. Zero means a known empty total; missing/expired/different-day snapshots
show an invitation to open the app, never yesterday's values labeled Today.
Ongoing sleep contributes only up to the snapshot time, matching the phone at
that instant; a widget snapshot is not a continuously running sleep timer.

### Direction contract

- **Thesis:** one glance answers how today is going; no forms, charts or controls.
- **Own-world:** inherit Little Days' quiet blue accent, system typography and
  semantic foreground/background; respect light, dark, tinted and StandBy modes.
- **Story:** read Today, scan three labeled quantities, tap anywhere for details.
- **First viewport:** Today and a date above the totals; a subdued snapshot time
  below. Small uses rows; medium uses columns. SF Symbols supplement words.
- **Form:** a precisely scoped native extension of the existing product; no
  visual-world redesign or generated raster assets.
- **Finish:** regression tests, native build/signing and TestFlight processing
  are separate gates. Simulator/device visual checks remain explicit until run.

## Data, privacy and refresh

- No network calls, SQL, tokens, record bodies, baby names/photos or member IDs
  in the widget. Only aggregates, date/time, legacy language, optional canonical
  locale and an opaque scope digest enter the App Group snapshot. Old version 1
  files without the canonical locale still decode. The body mirrors the selected
  app locale; system-owned gallery name and description follow the system language.
- Reuse the companion's authorized workspace, expiry and invalidation boundary,
  even on an iPhone with no paired Watch. Startup suspends old content until
  local identity restoration; logout/removal/switching clears it on the same
  serialized native queue. Family access is never extended by widget refresh.
- Store atomically with file protection, exclude the snapshot from backup, and
  mark statistics privacy-sensitive. System-rendered snapshots are controlled
  by iOS: clearing storage requests a reload, not guaranteed instant erasure.
- Reload on meaningful local changes; throttle unchanged snapshot heartbeats.
  Stable leases use a 15-minute heartbeat; a sliding personal lease is republished
  after a five-minute expiry change. Sleep refresh compares the displayed tenth
  of an hour, not every second of an ongoing timer.
  Precompute timeline entries for local midnight and access expiry. After a date
  or time-zone change, open the app to recompute; never show old totals as today.
- The widget represents the phone's local projection, including saved changes
  awaiting sync, not a promise that all other devices have synchronized. Family
  changes appear after phone sync. iOS schedules refreshes; no real-time promise.
- Cold/warm widget links go to Today. Existing record-editor sheets are retained
  so a link cannot silently discard an unfinished record.

## Delivery and acceptance

1. Add the WidgetKit target and App Group through a reproducible Expo plugin.
2. Verify aggregation/change triggers, link routing, target embedding,
   credentials declarations and lifecycle clearing.
3. Push the reviewed revision using the GitHub plugin; run CI.
4. Configure Apple signing for the new extension and App Group (see runbook).
5. Build production iOS, inspect phone/Watch/widget versions and entitlements,
   submit that exact build, and verify Apple processing and tester availability.
6. On iPhone/iPad, test small/medium, all 12 locales, light/dark/tinted,
   Dynamic Type/VoiceOver, empty data, milk/nappy/sleep edits, midnight,
   offline use, logout/family switch and cold/warm taps. Never use destructive
   account tests on a real family. Windows cannot run the iOS Simulator.

References: [Apple widget HIG](https://developer.apple.com/design/human-interface-guidelines/widgets),
[WidgetKit extension](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension),
[Widget refresh](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date),
[Expo extensions](https://docs.expo.dev/build-reference/app-extensions/).

## Implementation verification — 18 September 2026

- `npm run verify`: passed, including widget generation/link tests and family
  controller coverage for read access while Watch writes are disabled.
- `npm run export:web` and `npm run test:browser`: passed. Existing local/family
  flows, bilingual layouts and live sleep/Today totals retained.
- Independent review found and verified fixes for unstable per-render publication,
  unintended dependence on the Watch-write feature flag, and widget cleanup errors
  blocking Watch revocation. Rendering/deduplication now share sleep rounding.
- TypeScript excludes local `work/` release copies and generated exports; the
  previous broad scan exhausted memory by following duplicated staged sources.
- Windows cannot compile Swift or render WidgetKit. Swift model tests are wired to
  the macOS EAS post-install hook; native build and device visual acceptance remain
  separate, unverified gates until their release results are recorded.
