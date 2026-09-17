# Sign-in recognition and service-token cache review

Date: 17 September 2026. Scope: API application-token caching and mobile recognition of Microsoft sign-in before SQL-backed account/family checks. This review does not authorize infrastructure changes or establish a production deployment.

## Decision and security boundary

Implement the two optimizations without caching a user's permission to access a family:

1. `GET /v1/session` acknowledges only a correctly validated Entra access token. It returns the immutable token subject, `status=token_valid`, `accountAccess=pending`, and `familyAccess=pending`. It never resolves the directory admission service or database, sets a `PilotIdentity`, or returns family/profile/email data. Normal JWT signature, issuer, audience, expiry, tenant, client, scope and object-ID checks apply, as do the recovery gate, rate limits and no-store headers.
2. Directory admission's Graph application token uses MSAL's process-local cache with the configured credentials. The user explicitly approved reuse of the existing Entra registration, including `Admission__UseAccountDeletionCredentials=true`; no separate registration, consent or secret is required. The shared token retains its existing delete permissions. Current directory-user/enabled/email-uniqueness checks still run on each authoritative request. SQL account-deletion and family grant/history/version checks are unchanged.
3. The mobile controller distinguishes token recognition from authoritative `/v1/me` and snapshot results. Recognition alone cannot identify/restore another account's private workspace, enable family management, mark edits synchronized, or act as proof of membership. Cached offline behavior retains its existing same-account/grant protections.

An unexpired token can outlive directory disablement, app deletion or family removal. A successful session response is therefore intentionally not called an account-active or permission-valid response. The authoritative operation must still refuse revoked access, even after a successful session response.

## Findings and disposition

| Finding | Disposition |
| --- | --- |
| Authentication recognition was coupled to `/v1/me`, which needs SQL and can wait for a paused database. | Separate token-only endpoint and mobile pending-access state; keep `/v1/me` authoritative. |
| Every directory-admitted request acquired a new Graph application token. | Cache only the configured application's admission token, using MSAL; never cache user authorization results. |
| The live API reuses the deletion registration for admission. | The user approved caching with that existing registration and unchanged credentials/consent. Document the shared token's existing delete privileges and protect process/configuration/diagnostic access. |
| Credential-mode flags or different secrets do not attenuate an application's Graph permissions. | Remove the separate/shared-client-ID cache gate under the approved reuse decision. Existing credential resolution/validation remains unchanged; separate least-privileged admission is optional future hardening, not a cache requirement. |
| Asynchronous session, `/me`, logout and account-switch responses can arrive out of order. | Keep recognition separate and bind results to the active request/account generation. Pending acknowledgment must never override authoritative denial or clear data as if an empty family list were returned. |
| A transient Graph `identity_unavailable` response did not get the same quiet retry treatment as service connectivity errors. | Include transient 503 directory failures in bounded connectivity handling; never hide 401/403 as connectivity. |
| A session probe can fail after browser login has already saved credentials, before any account is recognized. | Track credential availability separately from recognition, keep refresh/sign-out available and retry authoritative verification in the background. Stored credentials alone never grant access. |
| Signing out during pending reauthentication could leave the prior account's cached workspace/outbox behind. | Retain the prior account binding and durably discard its workspace before removing credentials. An explicit different-account mismatch instead preserves the original private workspace. |
| Automatic verification during slow local startup could finish before an older cache restore, or retries could replace the original account binding. | Delay automatic verification until local bootstrap completes; keep the original account binding across foreground retries and repeated browser sign-in. A newly successful browser login clears an old authentication pause, never a new denial. |

## Cache controls

- The cached credential belongs to the backend application, not an individual user. One immutable tenant/client/Graph-scope binding is used per provider.
- MSAL handles its application cache in memory. There is no Redis resource, SQL cache, disk serialization or mobile exposure.
- Acquisitions are coordinated so concurrent requests can share one bounded acquisition. Cancelling one caller must not cancel another caller's work. Provider expiry is respected with a safety margin; expired/rejected tokens are not fallback credentials after an acquisition failure.
- A Graph 401 invalidates the rejected credential and permits one refresh/retry of the complete admission sequence, not indefinite retries. A late rejection of an older token must not discard a newer replacement. Fresh user and email checks are repeated after token replacement.
- Tokens, client secrets, raw identity responses and sensitive exception bodies must not enter logs or API responses. Process memory/dumps remain sensitive: memory-only does not mean an attacker with process access cannot steal a bearer token.
- With shared credentials, the cached Graph `.default` token includes existing read/write/delete application permissions; caching neither adds nor removes them. Admission still issues only read requests. A leaked token can exercise the granted permissions, so restrict API process, deployment, configuration, debugging and dump access as well as keeping secrets out of logs.
- Optional separate read and deletion registrations reduce a leaked read-token's privileges. Both credentials would still live in the API process; this is not complete process-level isolation and is not required for this rollout.

## Compatibility and operational limits

- Existing API clients continue to use `/v1/me`. New mobile clients treat an older API's `/v1/session` 404 as a compatibility fallback, not an empty account/family result.
- Shared credentials work with the new token cache without setting changes. The existing registration is `538d93ee-1d58-43cb-adcd-68e094200621` in customer tenant `deab2578-7cd3-4152-b5db-f430d6b638f8`. Keep `Admission__UseAccountDeletionCredentials=true`, omit both separate admission credential settings and retain the existing deletion credentials. No new registration, consent or secret is required.
- This update does not stop SQL pausing, keep it warm, change free limits, add a queue or eliminate SQL latency. Only the recognition request is SQL-independent. The existing cleanup worker may independently contact SQL, and JWT signing-key discovery can still require Entra network access.
- Account removal and deletion remain server-authoritative. Offline clients cannot learn a remote revocation until they reconnect; this change does not expand their existing offline access rules.
- Cache loss on restart is safe. Clearing the cache or rotating a client secret does not guarantee that a previously issued token is immediately invalid everywhere.

## Verification and rollout

Independent backend and mobile reviews found no remaining blockers after the recovery/race findings above were corrected. The subsequent user-approved shared-registration cache adjustment also passed a narrow independent backend review and a fresh full backend test run. No mobile behavior is changed by this credential-reuse decision; the mobile/browser/bundle results below were established in the preceding implementation pass and were not redundantly rerun for this backend-only adjustment.

Verified locally on 17 September 2026:

- Full API suite after the shared-registration adjustment: **219 passed**, none skipped, using a disposable local SQL test database, not Azure production. Coverage includes validated shared/same-ID/separate credentials using the actual MSAL cache, fresh disablement checks, static-mode isolation, expiry/rejection/concurrency/cancellation, strict session JWT checks, no directory/database dependency for recognition, and continued denial after family removal/account deletion.
- `npm run format` and `npm run verify`: passed, including TypeScript, unit/API-client tests, **156 controller tests**, **50 family UI tests**, authentication, native storage/notification guards and the remaining existing regression suites.
- Clean production-mode web export and `npm run test:browser`: passed. One intermediate run reused the preceding demo-mode Metro transform and failed the signed-out account assertion; rebuilding with `EXPO_PUBLIC_FAMILY_UI_DEMO=0` and `--clear` passed. Clear Metro when alternating demo and production modes during local validation; no application permission guard was weakened to make the test pass.
- Production-mode iOS JavaScript/Hermes export: passed. This is a bundle check, not native signing, installation or real-device acceptance.
- Clean demo-mode browser suite: all nine scenarios passed in English/Chinese, light/dark and narrow/mobile layouts, with no real API/authentication traffic or family persistence.

API source `76c045abea41614708639a49c322a879f6af897a` was deployed on 17 September 2026 through [release run 35186622914](https://github.com/github4me/my-little-days/actions/runs/35186622914). All five jobs passed: revision validation, mobile/browser verification, API/SQL verification (219 API tests and 58 migration-tool tests), DbUp/temporary-firewall cleanup and API deployment. No new migration was introduced. The API artifact's recorded source SHA matches the release; Azure OneDeploy ID is `9066d8ee-8275-4d09-a082-40a94b91ffc7`.

Post-release probes verified public liveness/readiness `200` and anonymous protected-endpoint rejection. Immediately after the workflow reported success, `/v1/session` still returned the old `404`; a bounded recheck at 05:45:33 UTC / 15:45:33 Sydney returned `401` with `Cache-Control: no-store`, without a manual restart or another deployment. Treat generic liveness as insufficient proof that a new route is serving: allow propagation, then verify the release-specific behavior. All 33 permanent exact-IP SQL firewall rules matched preflight after cleanup, including the retained operator rule; no temporary runner rule remained. AlwaysOn and .NET 10 were unchanged.

The signed iOS Expo preview is available as [build 31f2d2b5-15c7-4b31-b564-1e28eb8b3ccf](https://expo.dev/accounts/expo4chao/projects/little-days/builds/31f2d2b5-15c7-4b31-b564-1e28eb8b3ccf): version `0.2.1 (23)`, source `c19fa44283393031aa6a5f21a3ffbfcf6c3bf6a4`, profile/environment/channel `preview`, internal distribution, finished 17 September at 05:55:20 UTC / 15:55:20 Sydney. All five public connection/demo values were checked before submission; demo mode is `0`. The existing saved ad hoc profile lists both registered iPhones. No new credential or device registration was created, no OTA was published and nothing was submitted to TestFlight.

Native iPhone installation/acceptance and authenticated production sign-in/cache behavior remain unverified. No Azure registration/consent, secret or settings changes were required or performed for the approved reuse decision. The anonymous checks establish API rollout and authentication enforcement, not real-user or two-device acceptance. Follow runbook section 23.6 for installation without uninstalling the existing data-bearing app.

At the user's subsequent request, a separate store-signed `0.2.1 (24)` build, [13441500-1013-4a62-adca-c1a59bf629c6](https://expo.dev/accounts/expo4chao/projects/little-days/builds/13441500-1013-4a62-adca-c1a59bf629c6), was submitted through [47dd1fd4-87cb-48a0-be09-37affc530ab6](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/47dd1fd4-87cb-48a0-be09-37affc530ab6). Upload completed at 06:20:47 UTC on 17 September. Apple readback confirms `VALID` and internal `IN_BETA_TESTING`; external testing is `READY_FOR_BETA_SUBMISSION`, not approved or released. Before the build, the production EAS API URL's missing leading `h` was corrected to the existing approved `https://` API address and all five public values were verified. This correction changes the newly built mobile configuration, not Azure or existing installed binaries. See runbook section 23.7 for exact source/build provenance, notes-entry limitations, submission and remaining external-review steps. No public App Store release or native acceptance test was performed.

Follow [runbook section 23](AZURE-MANUAL-SETUP-RUNBOOK.md#23-graph-application-token-cache-and-sql-independent-sign-in-recognition) for the retained registration/settings, privileged-token safeguards, API/mobile release order, compatibility rollback and phone acceptance checks. No database migration, native dependency or new paid Azure resource is required by these changes. The current `updates.enabled=false` policy still requires a new native build for mobile delivery; an Expo OTA publication alone will not update those installed apps.

References: [MSAL application-token caching](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/web-apps-apis/client-credential-flows), [Graph least-privileged read permission](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0), [cache consistency and security limits](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside).
