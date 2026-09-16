# Family screens — iPhone UI review

This is a **UI-only demo**, not a connected family service. It reuses the real family screen and confirmation components with a separate, memory-only sample controller. No live controller is mounted by the demo. No sign-in, API calls, SQLite/SecureStore access or real baby data is involved in its actions.

## Review on iPhone

Install the dedicated `ui-preview` build, then open **More → Family invitation pilot → Preview screens — no login**. In Chinese: **我的 → 家庭邀请试点 → 界面预览（无需登录）**.

The default **First invitation** scenario reviews a fictional baby's complete sample history. Enter up to five different emails, tap **Review setup**, check the profile, record totals and recipients, then read the sharing explanation and confirm to simulate family creation. The member with the most complete baby history should create the family. No invitation is sent. Admin transfer includes data control, with unchanged record authorship.

Swipe the nine scenario buttons to review first invitation, signed-out, incoming invitations, admin, member, admin transfer, sole-admin family closure, removed-member and account-deletion screens. Expand sections, try forms and confirmation dialogs, and use **Reset samples** to start again. Every destructive confirmation is explicitly marked as simulated. Changing scenarios, leaving the demo or closing the app discards the sample session. Light/dark appearance and Chinese/English use the normal app preferences.

The demo changes only sample UI state. Do not use it to verify authentication, invitations, synchronization, deletion completion or offline persistence. It does not send invitation email or contact Azure. The rest of the app's offline features remain available and separate.

The normal native screen's first-invitation setup is **local-only**, even with the old pilot API configured. See [what is implemented and what remains](FAMILY-OWNER-ONBOARDING.md). Neither the demo nor the old API enables real-history migration.

## Build boundary

`eas.json` defines `ui-preview`, extending internal `preview`, with channel `ui-preview` and build-only `EXPO_PUBLIC_FAMILY_UI_DEMO=1`. Normal builds without that flag retain the live pilot entry and authorization requirements. Do not put this flag into a shared production EAS environment. No API or tenant configuration is required for UI review.

The current native version is 0.2.0, build 18. Older 0.1.1 installations need this new native build, not a 0.2.0 OTA. Ad hoc iPhone installation is restricted to devices included in its signing profile. Install over the existing app; **do not uninstall an app holding offline records** to solve an installation issue.

```powershell
# After local verification, refresh the profile to include registered iPhones.
eas build --platform ios --profile ui-preview --non-interactive --refresh-ad-hoc-provisioning-profile --no-wait
```

Local browser review uses a separate export:

```powershell
$env:EXPO_PUBLIC_FAMILY_UI_DEMO = '1'
npx expo export --platform web --clear --output-dir dist-ui-demo
Remove-Item Env:EXPO_PUBLIC_FAMILY_UI_DEMO
npm run test:family-demo-browser
```

Clear Metro's cache when switching the build flag; use `npx expo export --platform web --clear --output-dir dist-web` after removing it to return to the normal web build. The browser tests check the rendered UI and absence of service calls/storage changes. They are not an iPhone screenshot or native-device acceptance test. Sample screenshots are generated under ignored `dist-ui-demo/screenshots/`.

Sources: [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/), [runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/).
