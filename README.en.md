# My Little Days · 小日子

English | [简体中文](README.md)

An offline baby-care and growth tracker built with Expo, React Native, and TypeScript. The original local features record feeds, sleep, diaper changes, and measurements without an account or backend. The repository also contains a separate, controlled family invitation pilot that requires configured infrastructure and admitted accounts. The app supports English and Simplified Chinese, including a system-language option.

## Features

- **Installed iPhone name:** Chinese system-language preferences show “小日子”; English uses “My Little Days”, with English as the fallback for unmatched languages. This native setting requires a new installed build, not only a JavaScript update.

- **Baby profile:** name, birth date, sex, and an optional photo stored on the device. Tap the Home avatar to open the profile settings.
- **Feeding:** formula, expressed milk, and breastfeeding records; quick milk-volume choices and optional end times. Formula shortcuts adapt to the baby's age on the feed date when a birth date is set, without changing the entered amount; expressed milk and unknown ages keep the existing choices. These are recording shortcuts, not feeding targets ([sources and age bands](docs/FEED-AMOUNT-PRESETS.md)). Start a timer without an end time, then tap Stop on Home to confirm the session. Bottle feeds show the original amount and a wheel for adjusting the actual volume in 5 mL steps before saving; breastfeeding remains duration-only. The end time is captured at Stop, not confirmation; cancelling continues the feed. When adding an end time to a past feed, it initially defaults to 20 minutes after the start and can be edited.
- **Sleep:** start and stop a sleep session, add past sessions, and resume the timer display after reopening the app.
- **Diapers:** pee, poo, and mixed changes.
- **Growth:** weight, length, and head circumference, with bundled WHO reference curves for ages 0–24 months. View individual metrics or all three in different colors.
- **History:** select 7 days, 2 weeks, 1 month, 3 months, 6 months, or All. Charts and daily history follow the selected range; longer charts group days to stay readable. Today's details are expanded, earlier days are collapsed, and dates beyond the first seven recorded days can be expanded. Long daily lists and growth records show five entries initially. Editing and deletion are supported; deletion requires confirmation and has no undo.
- **Care:** record temperature, baths, washing, oral care, and nail care with dates, times, notes, and editable history. Temperature supports decimals and defaults to armpit measurement. The prefilled 36.8°C is an editable input, not a measured result; always enter the actual reading. Older care history can be expanded.
- **Calendar:** Records defaults to the unchanged Bar chart. A two-icon toggle sits beside the page title on the right, switching between Calendar and Bar chart without an extra row. In Calendar, Day, Week, and Today share a left-aligned row below. See feeds, nappies, and sleep together, jump to a date, filter by type, and tap an entry to view, edit, or delete with confirmation. Overlapping records remain separate; midnight-spanning sessions appear on each relevant day. More saves the default view immediately; existing saved preferences are retained and switching inside Records is temporary.
- **Version footer:** each page displays the app version and update revision to identify the current code release. An over-the-air update revision is not the native installer's build number.
- **Compact calendar filters:** All, Feed, Diaper, and Sleep icons share the Day/Week/Today row. When a narrow screen or larger text leaves insufficient space, one filter button opens labelled choices instead.
- **Early-learning activities:** parent-led play ideas with steps, safety notes, source links, and optional daily check-ins. Browse 0–1, 1–2, 2–3 months, then two-month groups up to under 25 months. Age-appropriate activities are selected by default when a valid birth date is set; otherwise nothing is selected. Manual choices are retained, and choosing outside the baby's calculated age range prompts a warning rather than blocking selection.
- **Reminders:** one-time, daily, and feeding reminders rescheduled from the latest saved feed start time; configurable silent notifications.
- **Preferences:** English, Simplified Chinese, or system language; Automatic, Light, and Dark themes. Automatic follows system appearance, while explicit choices are saved. Sections in More expand independently.
- **Privacy, support, and credits:** More has separate expandable Privacy & support and Credits sections. Credits thanks Trista from FPH and Mia, Violet, and Bill in her group for their suggestions and ideas, and the group's mums and dads for their support. More parents are welcome to join in. Activity guidance is for parents, not a screen-based course for babies or a developmental assessment.
- **Backups:** export and import validated JSON files. Imports replace the current records after confirmation rather than merging them.

## Family invitation pilot — implemented source, not deployed

Open **More → Family invitation pilot**. This is a separate test space for two checked accounts and fictional baby names and **completed bottle feeds**. It is not full family synchronization or a public beta. Existing profiles, feeds, sleep, diapers, growth, daily care, timers, learning, settings, photos, and backups are never migrated or uploaded.

- Native sign-in uses Entra External ID email one-time passcodes. Admins can store invitations before recipients register, without notifications. Checked recipients see an Accept/Decline inbox; invitations expire after 30 days. One active family per account; public verified onboarding remains gated.
- Members create test feeds and edit/delete their own; admins may change any record and manage invitations, membership and the pilot baby profile. Typing stays private until explicit Save durably queues it before networking.
- First server commit wins for a record version; independent overlapping records remain separate. Conflict review stays within the same account/family/grant/history. Leaving, removal and context changes purge old cache/drafts/queues; recovery cannot copy them to another family.
- Ownership transfers only when the nominated member accepts. Other members must be removed before family closure; an admin must close or transfer before account deletion. Ordinary departure retains contributions; account deletion runs separate SQL/directory cleanup with a secure device status receipt. Live Azure/Graph and configuration/backup cleanup remain release gates.
- Sign-out warns about unsent work, then clears this device's pilot cache, drafts, queue, and credentials after confirmation. Original local records remain. Pilot export/import and history migration are not included.

Follow the [Azure pilot setup guide](docs/AZURE-FAMILY-PILOT-SETUP.md) for the .NET 10 API, Azure SQL, customer identity tenant, and operator-verified account bindings. [Server instructions](server/README.md) cover running and testing. Unconfigured builds show setup as incomplete; production browser sign-in is disabled. Source and automated checks do not establish a working Azure deployment or two-iPhone validation. The [pilot contract](docs/FAMILY-PILOT-CONTRACT.md) defines this slice; the rest of the [family-sharing technical plan](docs/FAMILY-SHARING-TECH-PLAN.md) remains a roadmap.

The [Bicep deployment guide](docs/AZURE-BICEP-DEPLOYMENT.md) provisions a separate Web App, managed identity and free-offer-only Azure SQL database while reusing the existing Linux B1 plan, without Key Vault. The script defaults to local validation and requires preview/review and explicit deployment approval; identity registration, database initialization and API publication are separate. SQL pauses when its free allowance is exhausted, with no paid fallback. The existing cleanup worker's SQL polling still needs adjustment and live validation.

First-invitation setup now reviews the baby profile and feeding, nappy, sleep, growth, milestone and daily-care counts, then up to three family emails and explicit confirmation. In the signed-in native pilot it saves an account-scoped **local-only, not-sent setup**: no family creation or history upload; original records stay unchanged. Running timers block preparation and changed source data requires a new review. The full-history API and main-app sharing integration remain unimplemented; see [the mobile/Azure handoff](docs/FAMILY-OWNER-ONBOARDING.md).

For layout review without Azure or login, use the dedicated [iPhone UI preview](docs/FAMILY-UI-PREVIEW.md). Its nine sample scenarios reuse the real family screens, starting with **First invitation** and a complete fictional seed dataset; all actions are simulated in memory and reset on exit. The `ui-preview` build has its own update channel and does not bypass live authentication.

## Run locally

Use a Node.js version supported by `package.json` (`^22.13.0` or `>=24.3.0`).

```sh
git clone https://github.com/github4me/my-little-days.git
cd my-little-days
npm ci
npm start
```

For a browser preview:

```sh
npm run web
```

The browser stores original local data in localStorage, separate from the installed mobile app. The pilot page provides information but does not enable production account sign-in. Native reminders, photo storage, and file-sharing behavior need testing on a phone. Expo Go may preview the original local features when compatible with this SDK; pilot authentication requires a new signed native build. The mobile pilot uses its own SQLite database and account/family keyspace.

## iPhone builds and updates

The repository includes `preview` and `production` EAS build profiles. Preview uses internal distribution and the `preview` update channel; production uses the `production` channel and automatic build-number increments.

The current source version is **0.2.0**. Added authentication, browser-session and SecureStore dependencies plus the `mylittledays` URL scheme require a new native binary. The version bump separates its `appVersion` update runtime from older 0.1.1 installations: do not publish pilot JavaScript to that old runtime. No new IPA, TestFlight build, or OTA release was produced in this implementation. Configure the pilot's public environment values and complete two-phone validation before distribution.

With access to the Expo project and the required Apple signing credentials:

```sh
npx eas-cli login
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

Install using the link provided by EAS. An installed build can run independently of the development computer. Keep the existing application identity when updating an installation containing records.

After installing and validating the new native pilot runtime, a subsequent compatible JavaScript update can use the matching preview environment and channel:

```sh
npx eas-cli update --channel preview --environment preview --message "Describe the update"
```

Further native dependency or configuration changes may require another build. Public or external TestFlight distribution remains gated on privacy, account/family deletion, reviewer access, retention, and live device checks. App Store distribution requires a production build, Apple credentials, and an App Store Connect app record; uploading a build is separate from submitting it for Apple's review. See [Expo's iOS submission guide](https://docs.expo.dev/submit/ios/).

## Data and privacy

Original mobile records remain local in SQLite and require no account. Signing in to the pilot does not upload or synchronize them. The separate pilot stores an account/family cache, private drafts, and a durable queue; after service configuration, explicit family/invitation commands and saved test feeds are sent to its API. It does not share existing timers, notifications, charts, photos, or history backups. Baby photos are copied into local app storage when selected. Notifications remain local.

The app uses Expo's update service to check for and download software updates. This can exchange technical metadata with that service; baby records and photos are not included in the app's update requests.

Backups are unencrypted JSON containing the original local baby profile, tracking entries, and daily-care records. They do not include the local avatar, theme/language preferences, reminder schedules, activity selections/check-ins, or separate pilot data and credentials. Export a local backup before uninstalling or changing phones. Backup files leave the app when you explicitly export/share them; selecting a cloud destination uses the service you choose.

## Time and growth calculations

Records use timestamps with time-zone information. Display and daily summaries use the device's current time zone; changing that zone can change which day a record belongs to. Sleep totals split sessions across days and merge overlapping intervals to avoid counting the same time twice.

WHO curves show trends, not diagnoses or exact percentile calculations. They do not extrapolate beyond 24 months or adjust for prematurity. Milk-volume shortcuts are input conveniences, not feeding recommendations. See [WHO sources and methodology](docs/WHO-SOURCES.md).

## Development checks

```sh
npm run verify
npm run export:web
npx playwright install chromium
npm run test:browser
```

`verify` runs TypeScript checking, local-domain and pilot unit tests, `test:family-controller`, and bilingual permission/confirmation checks in `test:family-ui`. These exercise the real controller and screen with deterministic identity, HTTP, SQLite and native-control boundaries, not live authentication or the device database. Browser regression exercises the web implementation. `npm run export:ios` exports the iOS JavaScript bundle; it does not compile or sign an IPA.

With .NET 10, run `dotnet test server/LittleDays.FamilyApi.Tests`. SQL tests run only when `FAMILY_TEST_SQL_CONNECTION` points to a disposable SQL Server `master` connection; never use the pilot or production database. See [server instructions](server/README.md). Azure managed identity, live Entra login, SQLite persistence, notifications, photos, file sharing, and two-iPhone offline/conflict/removal behavior remain device/infrastructure checks. See [validation notes](docs/VALIDATION.md).

## Project layout

- `App.tsx` — navigation, home screen, and growth history.
- `src/Records.tsx` — care charts, daily summaries, and expandable history.
- `src/EntryEditor.tsx` — record forms and date/time inputs.
- `src/Settings.tsx` — profile, language, theme, reminders, and backups.
- `src/PrivacySupport.tsx` — in-app privacy information and support contact.
- `src/PlayLearning.tsx`, `src/learning.ts` — activity selection, age groups, and check-ins.
- `src/DailyCare.tsx`, `src/care.ts` — care history and temperature input validation.
- `src/recordRange.ts` — date ranges and chart grouping.
- `src/domain.ts` — data validation and summary calculations.
- `src/storage.ts`, `src/backup.ts`, `src/reminders.ts` — native persistence, backups, and notifications; `.web.ts` files provide browser variants.
- `src/growth.ts`, `assets/who/` — bundled growth references.
- `src/family/` — separate pilot UI, authentication, wire contracts, cache, drafts, and durable queue.
- `server/LittleDays.FamilyApi/`, `server/LittleDays.FamilyApi.Tests/` — .NET 10 API, EF SQL migrations, and backend tests.
- `infra/`, `.github/workflows/` — setup templates, SQL permissions, CI, and manual deployment through a protected environment. Merges do not deploy.
- `src/*.test.ts`, `tests/family-controller.mjs`, `tests/browser.mjs` — unit, pilot controller, and browser tests.

See [Repository Guidelines](AGENTS.md) for contributor conventions.

## Support and license

Contact [contact@reticle.com.au](mailto:contact@reticle.com.au).

Application source is licensed under [0BSD](LICENSE). Consult the [WHO source notes](docs/WHO-SOURCES.md) for the bundled reference data and applicable reuse considerations.
