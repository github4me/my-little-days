# Sleep/feed-only Today refresh —29October2026

Owner request: “只更新睡眠，喂奶数据，fix and push to test mflight”.

## Scope

The existing native Today pull-to-refresh now calls `family.refreshSleepFeed()`.
It reads and reconciles only sleep/feed entries and sends only their eligible
queued record operations. It does not refresh diaper/growth/milestone/care/
extras/profile content, run family management actions, replay the legacy outbox,
or increment the AI capability revision. Existing automatic full-family sync
and record-driven AI estimation remain unchanged. Necessary current account,
grant/history/role and maintenance checks remain mandatory.

No new control/copy, privacy setting, AI quota/model, schema or migration is
introduced. Existing native RefreshControl/spinner and error presentation stay.
Native pull/VoiceOver/two-phone acceptance remains separate from mock tests.

## Additive backend contract

`GET /v2/families/{familyId}/sleep-feed-snapshot` returns exactly:

```text
{schemaVersion:1,familyId,userId,membershipId,historyId,role,revision,entries}
```

Entries retain the normal row version, attribution, timer ender and replacement
audit. The authorized family transaction filters live entry JSON types feed and
sleep in SQL; no other record bodies, profile, roster, invitations or extras
are returned/materialized. Existing record/response budgets remain. The endpoint
does not expire invitations, write records or change full-snapshot behavior.
It has no ETag and never represents a full cache or new access grant.

## Client integrity

`sleepFeedState.ts` validates the same account/family/grant/history/role and
typed entries, then reuses established timer/conflict reconciliation only for
the target queue. Other collections, local drafts/outboxes and queue ordering
remain intact. Partial reads do not advance the full snapshot revision or
Watch/full-cache verification time. The existing acknowledged revision floor
prevents delayed older complete snapshots from reversing a scoped update.

A local `QueuedRecord.recordType` marker retains sleep/feed DELETE scope when
another member has already removed that row; it is persisted/validated but is
never added to the immutable server request. First-delete-wins acknowledgments,
last-server-save-wins requests and timer follow-ups keep their existing IDs.
Invalid/late responses cannot import a different account or reactivate access.

## Verification before release

- Scoped domain suite:8 passed,0 failed/skipped.
- Backend focused disposable SQL suite:9 passed,0 failed/skipped; an additional
  existing full-response/write quota regression also passed. Synthetic
  data only, no production connection. Test-owned Docker container/network removed.
- Controller/navigation227/227 and frozen full npm verification1,222/1,222 pass.
- Independent integrity review found the omitted-delete scope gap; the local
  marker and regression tests resolve it. No other release blocker identified.
- Final assertion/gap review also caught a hidden extra-body read inside the
  existing budget helper. Only the new endpoint now skips full-response body
  accounting after the unchanged scalar stored-family check; scoped response
  limits remain. Intercepted SQL proves no other bodies load, and a dedicated
  over-storage case plus the existing full-response quota test pass. The private
  option defaults to the previous full behavior for all existing paths.
- Test-generation/API skills guided explicit scope/queue/authority/failure
  assertions. Static pairing analyzer unavailable (missing tree-sitter language
  pack); no dependency installation or line-coverage claim was made.

| Requirement | Evidence |
| --- | --- |
| “只更新睡眠，喂奶数据” | `sleep/feed refresh updates only its records and preserves other data and full-cache freshness`; `OwnerAndCaregiverReceiveOnlyLiveSleepFeedRecordsWithCurrentScopeAndOriginalVersions` |
| Preserve queued work and deletion semantics | `sleep/feed refresh acknowledges only scoped receipts and retains unrelated queued projections`; `sleep/feed refresh preserves pending deletion scope when the server has already removed its row` |
| Preserve timers and authority | `sleep/feed refresh promotes an accepted timer follow-up without reordering unrelated work`; `sleep/feed refresh rejects changed authority and never activates an incomplete cache`; `ScopedReadDeniesNonmembersRevokedGrantsDeletedAccountsAndLegacyFamilies` |
| Read-only/bounded backend | `ScopedReadLoadsNoOtherRecordBodiesAndDoesNotExpireInvitationsOrWriteData`; `SleepFeedRouteRequiresAuthenticationAndAdmissionBeforeAnyFamilyRead`; `SleepFeedRouteRetainsTheRestoreMaintenanceGate` |

## Release plan and checkpoint

Backend: overlay only the three API files, new focused tests/.http and this
release documentation over trusted remote head219fd5c, publish with GitHub plugin
and expected-head lease. No unrelated dirty server/mobile changes. Dispatch
existing Deploy family API and database on feature/family-invitations with
database_bootstrapped=true, adopt_ef=false. Existing immutable scripts must remain
identical; require catalog verification and explicit zero pending scripts.

Azure target remains reticle.com.au tenant7b7e6e31-a778-4334-aee2-e969fa27fd0e,
subscription4768a858-f23f-4a39-bb64-eabc9c142627, my-little-days-pilot-rg,
little-days-api-522fpstfbtds2 / little-days-sql-522fpstfbtds2 / little-days-family.
Preserve all existing app settings, AI approvals/Fast/model/hour/day/concurrency
overrides, identities, paid Basic resource profile and retained operator IP rule.
Only workflow-owned temporary state may be cleaned. Generic health is not
signed-in scoped SQL acceptance; distinguish each checkpoint.

Mobile: planned0.2.9(91), immutable90 base tree34c11bec6574ceb9aae96e634b2c97ec224e7b8f,
ten named mobile overlays plus staged app.json only. Use local production archive,
inspect all Phone/Watch/Widget targets/configuration/Hermes/features/symbols,
direct Apple validation/upload once, then confirm processing/internal groups.
No paid cloud build, OTA, new group or App Review replacement. Preserve current
0.2.9(90) review and published0.2.8(87). If the marketing train closes before
upload, stop and recheck the allowed version instead of repeating a rejected IPA.

At this checkpoint backend publication/deployment and mobile freeze/build/upload/
processing/tester availability are pending; no public release or device acceptance
is claimed.

At04:24:40UTC /15:24:40Melbourne, the frozen mobile candidate passes
1,222/1,222 checks with0 failures/skips, exit0. Controller/navigation227/227
and scoped-domain8/8 are included, not extra counts. Source tree
`753ed9fba8cebb67f658a74b38681b40902ad1aa`,543files, exactly ten reviewed overlays
plus staged app.json. Source archive SHA256
`1879fdce147336ca0cdb039fa323d3ffe49003effbdf3c12728576e891a7efbf`;
verification log SHA256
`580b11a7a8aed7bb6780babc2725212fed9d247ad8e300380b316b207afc8683`.
Local production archive91 is starting; signed inspection/upload/availability
and backend deployment remain pending. Apple preflight confirms public87 and
review90 remain unchanged,0.2.9 train open.

At04:25UTC /15:25Melbourne, final backend isolated SQL run passes10/10 (nine
scoped cases plus the existing full quota regression),0fail/skips. API service
SHA256`4db53fdbba29cdb671de255ead2b780d34852fcc646dbace4305bd5f8d2543ea`;
focused test SHA256`8d3f2da61d9f86c5e8430d7ad4304ee4fd50551f346169ee934364012ec72230`.
Owned SQL container/network removed. Assertion/gap review verdict Strong, no
remaining confirmed blocker; no actual mutation/line-coverage claim.

Backend source frozen over exact remote parent219fd5c, tree
`014b848f156ba2b90e85749458cbafc147833ba2`, seven explicitly named paths.
Source archive SHA256`4cd2654d435abb1bd6c74ef30a800c2500f8c49651438145060c79cdfabd3daa`.
GitHub plugin blob hashes/tree matched local objects; commit
`381024104a0735a8ba3bcbd09d71d077474f8130` was published with an expected-head
lease and independent ref readback. No CLI push or unrelated dirty source.
At04:28:13UTC /15:28:13Melbourne, deployment
[run40817919318/#34](https://github.com/github4me/my-little-days/actions/runs/40817919318)
started on that exact SHA with database_bootstrapped=true,adopt_ef=false.
Migration scripts are identical to parent; migration/deploy/readiness outcome
is still pending. Keep the branch pinned until every stale-revision gate ends.

At04:35UTC /15:35Melbourne, local build91 completed successfully. The signed
Phone/Watch/Widget targets all carry0.2.9(91), production provisioning and the
same App Group/profile identities. All543 frozen files were checked against
the immutable tree; signed Hermes bytecode matches recompilation of the reviewed
production JavaScript, including the scoped Today callback. Native model tests
pass35Watch+21Widget. Existing Expo Doctor19/21 warnings are identical to90
(legacy splash property and12 patch-version mismatches), not a new category.
IPA SHA256`e23c081446df85fc47f4edafad67352fb5ba9531683af3cc7f5d4dee9a6183ac`;
dSYM SHA256`fa4c5826092547a889f7cdfcfc786bea9a1895eeb06601a492b504d346ee17fe`;
signed HBC SHA256`ae9c98304f17f5722e6ac1e169cffc604e5b61d939ef53ea224bf62752aa6828`.
Only this build's three temporary distribution-certificate copies were removed;
managed credentials were unchanged. A fresh Apple read still shows review90
WAITING_FOR_REVIEW and public87 READY_FOR_SALE. Apple validation/upload and
TestFlight availability remain pending.

Deployment34's independent browser flows passed on the unchanged3810241 tree.
The separate pushCI130 browser job failed the existing quick-amount same-row
assertion at tests/browser.mjs:345 (one sequential bounding-box y differed;
no product or test change/rerun was made to bypass it). Deployment verification
passed718 TypeScript/unit checks plus API854 and migrator157, all zero failures/
skips. Migration catalog checks explicitly reported0pending scripts and a no-op;
the workflow-owned temporary SQL firewall rule was removed. API deployment and
post-deploy readiness are still pending at this checkpoint.

## Deployed backend

Deployment34 completed SUCCESS on all five jobs, exact3810241. API artifact
12872939480 ZIP SHA256
`a873d45d3d1825e87d89f6428ff66f71139a67d95839c074f3b1ca3078da0b1e`
was independently streamed and checked (30,379,254bytes); assembly informational
version contains the full release SHA and the new scoped symbol. Packaged
appsettings.json is byte-identical to the prior deployedb965493 artifact.
Database artifact12872954322 SHA256
`0fa72e031c331048b984a3a20ba44732308015b350a1b925532d71e2cfd180f9`.
Migration reported0pending at04:34:03,04:34:07,04:34:16UTC; the no-op and temporary
firewall cleanup completed. OneDeploy884edd66-f9f3-4adc-a5c9-6943a7787167
status4/active completed04:35:15UTC.

Do not equate that package status or health200 with route readiness: initial
anonymous auth checks returned503 and the new route404 while the old/new
containers overlapped. Read-only runtime logs showed new container startup at
04:35:49 and Oryx launching the API at04:36:25. Within the existing five-minute
startup window, fresh direct uncached checks at04:38:29–30 returned401 from both
capabilities and the new scoped route, with Bearer and no-store headers. No
restart, settings change or guard relaxation was needed. The overlap is observed;
the underlying old-request exception was not logged and is not claimed diagnosed.
Live/ready200 and mounted authenticated routing are verified; signed-in production
SQL/real-device refresh remain an explicit acceptance gap. No real family fixture,
private record query or paid AI call was used.

## Apple delivery

Direct Apple validation succeeded04:37:19UTC, followed by one successful upload
at04:39:38UTC /15:39:38Melbourne, uploader exit0, delivery
`e223b42a-7b2c-4404-b12e-e88ce4eb24d3`. Uploaded IPA SHA matches the inspected
artifact. Processing/internal tester availability is pending; no duplicate
upload, App Review replacement or public release is authorized by this task.

At04:43:40UTC /15:43:40Melbourne Apple confirms delivery COMPLETE, no errors or
warnings, build0.2.9(91) VALID / IN_BETA_TESTING. Build ID equals delivery
`e223b42a-7b2c-4404-b12e-e88ce4eb24d3`. Existing internal groups Team(Expo)
(`9c537271-fd52-413a-887d-fe95079a0086`) and Early Birds
(`5110f712-26d2-4151-b516-797adc018528`) are already attached; no new group or
external beta review was created. The existing0.2.9(90) review remains
WAITING_FOR_REVIEW and published0.2.8(87) remains READY_FOR_SALE, both with
unchanged build relationships/release type. This task is TestFlight-only.

Delivered: scoped client91 plus additive production API3810241. Automated
verification/signing/deployment/processing/internal availability are confirmed.
Outstanding: real signed-in family/SQL queued-write roundtrip and native Today
pull/offline/foreground/VoiceOver acceptance. No physical installation or
WidgetKit/Watch user acceptance is claimed by the release receipts.
