# My Little Days · 小日子

English | [简体中文](README.md)

An offline baby-care and growth tracker built with Expo, React Native, and TypeScript. Record feeds, sleep, diaper changes, and measurements without creating an account. The app supports English and Simplified Chinese, including a system-language option.

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

The browser stores its own data in localStorage, separate from the installed mobile app. Native reminders, photo storage, and file-sharing behavior need testing on a phone. For mobile development, use an Expo client compatible with this project's SDK or an appropriate signed build.

## iPhone builds and updates

The repository includes `preview` and `production` EAS build profiles. Preview uses internal distribution and the `preview` update channel; production uses the `production` channel and automatic build-number increments.

With access to the Expo project and the required Apple signing credentials:

```sh
npx eas-cli login
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

Install using the link provided by EAS. An installed build can run independently of the development computer. Keep the existing application identity when updating an installation containing records.

To publish a compatible JavaScript update to the preview channel:

```sh
npx eas-cli update --channel preview --environment preview --message "Describe the update"
```

Native dependency or configuration changes may require a new build. App Store distribution requires a production build, Apple credentials, and an App Store Connect app record; uploading a build is separate from submitting it for Apple's review. See [Expo's iOS submission guide](https://docs.expo.dev/submit/ios/).

## Data and privacy

Mobile records are stored locally in SQLite. The app does not provide accounts, family sharing, or cloud synchronization. Baby photos are copied into local app storage when selected. Notifications are scheduled locally.

The app uses Expo's update service to check for and download software updates. This can exchange technical metadata with that service; baby records and photos are not included in the app's update requests.

Backups are unencrypted JSON containing the baby profile, tracking entries, and daily-care records. They do not include the local avatar, theme/language preferences, reminder schedules, or activity selections/check-ins. Export a backup before uninstalling or changing phones. Files leave the app when you explicitly export/share them; selecting a cloud destination uses the service you choose.

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

`verify` runs TypeScript checking and unit tests. Browser regression tests exercise the web implementation. `npm run export:ios` exports the iOS JavaScript bundle; it does not compile or sign an IPA. SQLite persistence, notifications, photo selection, and file sharing also require device validation. See [validation notes](docs/VALIDATION.md) for the checklist and historical results.

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
- `src/*.test.ts`, `tests/browser.mjs` — unit and browser tests.

See [Repository Guidelines](AGENTS.md) for contributor conventions.

## Support and license

Contact [contact@reticle.com.au](mailto:contact@reticle.com.au).

Application source is licensed under [0BSD](LICENSE). Consult the [WHO source notes](docs/WHO-SOURCES.md) for the bundled reference data and applicable reuse considerations.
