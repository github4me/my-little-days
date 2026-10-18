# Remaining-day AI release — backend and TestFlight 77

Owner authorized “部署并push to testflight” and “try again”. Backend deployed;
**TestFlight0.2.4(77) VALID/IN_BETA_TESTING at13:06 UTC,19 October00:06 Melbourne.**
This operation targets the existing production API and TestFlight, app6809826484,
bundle `com.littledays.babylog`, Apple team `A9974KXQ4G`.

## Reviewed inputs

Backend parent `bffcc9137e151796bef802623b0acddd30499e7a`; 13 scoped files published
through the GitHub plugin as `3e79a3d80b62cd440e16bfee0fbbb92db584c790`.
Tree `578bd38489da5b4c17260f13ad8835d1e216d5c9`; no migration or settings changes.
The endpoint description was also corrected to seven complete prior local dates,
not rolling168h. Installed v1/v2 clients retain their existing behavior.

[Deploy family API and database #30](https://github.com/github4me/my-little-days/actions/runs/39128756633)
was dispatched from the frozen trusted branch `feature/family-invitations`, with
`database_bootstrapped=true`, `adopt_ef=false`. Immediately prior, family-pilot and
family-database each restricted deployments to this branch, reviewers/timer off,
administrator bypass on. Existing variables matched the documented tenant,
subscription, API and SQL targets. No protection or resource configuration changed.

Mobile predecessor is frozen76, tree `cf8c702655bf23f0477f236fdc1a2a6f23a6050c`.
Candidate **0.2.4 (77)** tree `be594e3ad473a8f5927743a1f0edbb276675556a` contains
537 files, with18 scoped client/test overlays plus app.json's staged build76
(incremented locally to77). Package/dependency/native source and unrelated dirty
checkout changes are excluded. Source TGZ SHA-256:
`6031ab2cbef26867c2a2d07f123cf8b5a9f235744f722a86264dd36ab3b176ff`.

Expo account/project/environment and five public production values were freshly
read back using existing managed credentials. Destination is production/store,
runtime0.2.4, OTAoff. Apple readback12:41 UTC showed76 VALID/IN_BETA_TESTING and77
absent. Existing internal groups are Team (Expo) and Early Birds. Build runs only
on this Mac with EAS24.8.0 and Xcode26.5; no EAS cloud build was started.

## Verification completed so far

- Frozen backend local: API641 passed/141 SQL skipped; migrator29/39 skipped,
  zero failures. Initial temp-path run hit a pre-existing assertion checking the
  word `private` in exception text: the macOS `/private/var/...` source path was
  the matching substring. Rebuilt with compiler PathMap to `/release-source`;
  complete rerun passed. No auth source/test/guard was changed or skipped.
- Actual release CI SQL job117679386531: **API782 passed, migrator137 passed,
  zero failures/skips**, including real disposable SQL.
- Actual release API artifact12137406057 ZIP SHA-256
  `8c8ebb8825d10c0f8f7739e47060b7f23ec9c67cafceebb8c748a363e33906f4`
  matches GitHub. Its DLL includes the frozen SHA, schema3 resource, seven-day-first
  prompt and minute-boundary text; DLL SHA-256
  `c43b70080d768e235bcdeafca6b719ca256c241b2df67ab1844f5f6220ecd968`.
  Packaged model/limits remain gpt-6-luna, concurrency50, account/hour30, daily200.
  Packaged defaults are not evidence of live override values.
- Frozen mobile `npm run verify`:1,160 passed across14 suites, zero failures/skips,
  plus typecheck. Fresh component browser70, full-App browser4 and privacy browser5
  passed; networks intercepted and records synthetic.

## Production backend completed

All five release jobs succeeded. Migration job117680414176 verified zero pending
scripts before and after the no-op; final catalog check12:53:16 UTC, own temporary
SQL firewall removed12:53:18. The retained operator rule was not targeted.
API job117680605534 deployed OneDeploy `e0df83c4-173b-422d-a874-c43ecff1e943`;
workflow liveness passed12:55:39 UTC. Independent sequential HTTP checks12:56:05
returned live200/ok, ready200/ready, AI jobs capabilities401/unauthorized, all
no-store. The branch remained at the frozen release SHA through deployment.
Ready is a recovery gate, not proof of signed-in runtime SQL/provider access.

## Signed mobile artifact completed

Local build completed12:56:18 UTC. IPA SHA-256:
`adb8a860727cbc0736bd13fab42effbb459aa298b51df1166a9aad4a8bf2cff8`.
Phone/Watch/Widget all0.2.4(77), original Store profiles, no debug entitlement,
12 locales, expected app groups, production identity/API values, demooff,
coffeeon, runtime0.2.4 and OTAoff verified. All459 packaged files match the537-file
freeze after documented EAS transformations/exclusions. Watch35 and Widget10
native model tests passed. dSYM UUIDs match all three archived/exported executables;
symbols ZIP SHA-256 `77034ac28b4fb1a839d4e1f39385240120463cab7785ace7ad107863747ee04e`.

The actual production Metro AI module contains schema3/minute/end-bound guards;
recompiling its logged Hermes input reproduces the signed bytecode exactly,
SHA-256 `04aa4e4ff6cba936f2185eb6124a797d1c4499ea335e1473cb3d38df3db92bc0`.
The first inspection required canonicalizing `/var` and `/private/var` before
comparing the compiler input path; source/binary and guards were unchanged.
Operation-owned temporary keychain, three profiles and three p12 copies were
cleaned; managed signing credentials and release artifacts remain.

Inherited Expo Doctor2 failed checks/patch recommendations and npm audit warnings
remain maintenance debt from76. No dependency graph was changed for this release;
no blanket upgrades or warning suppression was performed.

## Apple upload completed

Apple validation succeeded13:00:07 UTC with no errors. One upload completed
13:02:18 UTC /00:02 on19 October Melbourne, with no errors; delivery
`93de67a9-6f84-44c0-8307-95d251c62c13`,17,342,957 bytes. Final readback13:06:04 UTC
confirms delivery COMPLETE with no errors/warnings and build77 VALID/IN_BETA_TESTING.
Both existing internal groups Team (Expo) and Early Birds have access; no
tester/group changes were required. External state is READY_FOR_BETA_SUBMISSION;
external beta review was not submitted. No App Store review submission or public release is
part of this request; public0.2.3(75) remains READY_FOR_SALE on the same build ID.

## Public documentation

Existing data-sharing categories already cover seven prior complete local dates,
today, ageDays and previous estimates. Updated only four paragraphs across the
public support/privacy pages, identifying TestFlight0.2.4(77)'s remaining-day
output, retaining older0.2.3 behavior, and correcting24-hour clock availability
from build75 onward. No new consent category, recipient or storage policy.
GitHub plugin commit `facc9b39894ee14d8769974075b074679caf2855` in
`github4me/my-little-days-privacy`, main/docs Pages publication. Live readback at
13:04:02 UTC returned200 for both pages and the exact new versioned wording.

MyPhone is unavailable. Physical iPhone/Watch/widget acceptance and real-family
provider inference are not established by CI or upload. No uninstall, history
reset, live user-record request, provider retention or spending-dashboard change
was performed.

Retained operation evidence: `work/ai-remaining-release-20261018/`; signed artifacts
and frozen source archives remain under `artifacts/`.
