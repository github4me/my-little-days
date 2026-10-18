# Remaining-day AI predictions — 18 October 2026

## Requested behavior

AI predicts only the remainder of today: from the request's current time to the
next **local** midnight. Saved sleep is displayed from the app's authoritative
record store; AI must not repeat, correct or replace it. This removes the new
protocol's need for `recorded_sleep_missing`/exact history reproduction checks.

New clients use schema 3, with the existing `sleep-ai-v2` data-sharing consent
and durable-job consent. The backend retains schemas 1 and 2 for existing apps.
This is a local implementation checkpoint, **not a deployment or TestFlight
release**. Current public/test builds do not acquire these changes automatically.

## Model input and output

- Input history covers the **previous seven complete local calendar dates,
  excluding today**, plus today's records through request `now`. The cutoff is
  local midnight seven dates before today, not `now - 168 hours`. A sleep crossing
  the cutoff keeps its original start/end; it is not clipped into a fictitious
  sleep event. Existing record-size and duration limits remain.
- Exact age is computed in calendar days from the saved birthday. Only
  `ageDays`, not the birthday/name/photo/notes, is sent to the provider.
- The prompt first summarizes the seven-day historical baseline (night total
  and longest continuous sleep, day total/count, timing and wake intervals),
  excluding today's portion of crossing sleep. It then compares today's facts
  and makes modest adjustments to the common historical pattern. Exact age and
  the embedded reference supply context, not a mandatory schedule. Feed events
  do not prove wakefulness or sleepiness. See the [updated prompt brief](AI-SEVEN-DAY-PROMPT-2026-10-18.md).
- Previous AI estimates remain bounded untrusted context. Observed records
  outrank predictions. Manual overlaps can be interpreted by the model without
  changing the stored observations.
- Output contains only status and predicted sleep/settling periods. New sleep
  and settling must not start before the current minute; no sleep extends past
  next local midnight. A midnight endpoint is the output horizon, not a
  predicted instruction to wake the child.
- If sleep is already ongoing, AI may predict its remaining portion beginning
  at the current minute with no settling advice. The original start and elapsed
  recorded sleep still come exclusively from the database.
- An empty ready plan is allowed when no supported sleep remains before
  midnight. `insufficient_data` remains available when timing evidence is
  inadequate. No local forecasting or synthetic filler is introduced.

The retained age reference was rechecked on 18 October against
[WHO](https://www.who.int/news/item/24-04-2019-to-grow-up-healthy-children-need-to-sit-less-and-play-more)
and [Raising Children Network](https://raisingchildren.net.au/babies/sleep/understanding-sleep/tired-signs).
Their population sleep/tiredness ranges are contextual references, not validated
individual optimal times. No new numeric age table was invented. The runtime
model receives the embedded summary and no browsing tools.

Schema 3 now has a [dedicated strict output schema and verification report](AI-OUTPUT-SCHEMA-2026-10-18.md),
sent intact through Responses `text.format` on initial and retry requests.
The server still independently checks cross-field temporal rules; structural
constraints do not establish prediction accuracy.

## Compatibility and publication boundaries

Capabilities advertise the new remaining-day schema separately. An older server
must not be treated as supporting schema 3. New clients must not reuse/replay an
old whole-day job or cache as schema 3; cancellation/revocation and late-response
isolation remain intact. Database data, applied migrations, provider model/fast
tier, rate limits, timeouts, logging retention and credentials are unchanged.

The 24-hour clock, colours, buttons and loading animation are unchanged. Existing
help/privacy wording is aligned with the reduced history window and remaining-day
forecast. No new popup or confirmation is introduced.

## Verification

The commands below record the earlier remaining-day implementation checkpoint,
before the subsequent complete-calendar-day prompt update linked above. Fixtures and
browser replies were synthetic; no live provider request or production SQL query
was used. Synthetic tests establish contract/rendering behavior, not model accuracy.

- `npm run verify`: typecheck and all 14 configured suites passed, zero failures
  or skips. Final `npm run typecheck && npm test` after the assertion review:
  **688 passed, 0 failed, 0 skipped**.
- Focused client suites: **110 passed**. Ring composition: **11 passed**.
- Full .NET solution: API **615 passed, 141 SQL skipped**; migrator **29 passed,
  39 SQL skipped**, zero failures. `FAMILY_TEST_SQL_CONNECTION` was explicitly
  unset. Nonincremental Release build: **0 warnings, 0 errors**.
- AI component browser: **70 passed**; fresh-export full App: **4 passed**;
  privacy browser: **5 passed**; data-screen accessibility: **14 passed**.
- `git diff --check`: clean. Test workflow scratch files and the isolated web
  export are under `.git/testagent`, outside stageable source.

| Requirement | Exact test evidence |
| --- | --- |
| “AI只用返回从现在到未来00:00的预估” | `RemainingDayOmitsRecordedSleepWithoutChangingDatabaseEvidenceAndExpiresAtMidnight`; `AI remaining-day forecast is bounded by now to local midnight at minute precision` |
| “不用返回己记录的，以数据库的为主” | `remaining-day forecasts preserve database history without AI record echoes`; `full-app-future-only-ai-keeps-saved-records-and-durable-reconnect` |
| “AI推理主要依据现在至七天前的规律，和婴儿的岁数，和此岁数的特点” | Earlier rolling-window tests were superseded by `RemainingDayProviderUsesSevenCompleteDaysPlusTodayWithMinimizedEvidence` and the ordinary/DST calendar-week client cases in the updated prompt brief. |

The test-quality review strengthened independent count, current-minute, prior-plan
and legacy-job cancellation boundaries. It was a static assertion/gap review, not
an executed mutation test or a line/branch coverage measurement. The optional
source/test-pairing analyzer could not run because `tree-sitter-language-pack` is
not installed; no dependency was installed for it.

Still outstanding: production deployment, live-provider acceptance, signed-in
SQL-backed acceptance, physical iPhone upgrade/background testing, and a new
TestFlight build. The planned release order is recorded in the manual runbook;
none of those publishing steps occurred in this task.
