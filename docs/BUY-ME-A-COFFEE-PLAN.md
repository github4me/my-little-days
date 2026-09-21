# Buy me a coffee — implementation plan

Status: **approved and implemented locally; Apple catalog, native archive and sandbox acceptance are not yet performed**.
Prepared: 20 September 2026. Repository baseline: `bc48826a7229f72a099714677c4e7b8860d499bd` on `feature/family-invitations`.

Implementation checkpoint, 20 September 2026:

- Pinned `expo-iap` 5.6.3 / OpenIAP Apple 3.4.0 after source-auditing exact StoreKit verification, unfinished transaction replay and exact transaction finishing. Re-audit before upgrading either package.
- Implemented an app-lifetime iOS coordinator, StoreKit-price product list, deliberate unselected purchase flow, automatic unfinished-transaction reconciliation, quiet cancellation, pending approval, uncertain-result protection and finish retry. No purchase data is linked to app login/family data or written to Azure/SQLite.
- Kept Android and web unsupported. The upstream config plugin is intentionally omitted because it always adds Android Billing configuration; `expo-iap` is explicitly excluded from Android autolinking while Apple autolinking remains enabled. This audited deviation from the generic setup guide requires clean native build acceptance.
- Added the standalone More entry, dedicated accessible screen, privacy wording and locale-keyed support catalog. Transaction logic is locale-independent and English is the explicit safety fallback. Shipping another language also requires extending the app-wide locale/picker and App Store product metadata; a support catalog alone is not a complete localization.
- Unit/type/config checks can validate source behavior, but cannot prove App Store product metadata, StoreKit sandbox behavior, signing, Watch/Widget archive preservation or TestFlight processing. Those remain the manual gates below.

## 1. Recommended scope

Add a quiet, optional **Buy me a coffee / 请我喝杯咖啡** entry under More. It opens a dedicated support screen with three one-time amounts. Payment uses Apple's native in-app purchase sheet, without requiring a My Little Days login.

Use repeatable **consumable** in-app purchases. This is developer support, not a subscription, charitable donation, physical coffee order, or purchase of app functionality. Apple permits in-app purchase tips for developers; consumable is the implementation choice for repeat support. See [App Review Guidelines 3.1.1](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase) and [purchase types](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-types).

V1 includes:

- iPhone and iPad; English and Simplified Chinese; System/Light/Night appearances.
- Three voluntary amounts, native payment confirmation, clear cancellation/pending/error states, and a thank-you after verified success.
- Recovery of unfinished purchases across navigation, account changes, and process restarts.
- A collapsed explanation/reference section below the purchase controls.

V1 excludes:

- Subscriptions, paid features, badges, balances, donor lists, cumulative-support totals, or family privileges.
- Pop-ups asking for money during feeding, sleep, care, onboarding, or notifications.
- BuyMeACoffee.com, Stripe, Apple Pay, external checkout, RevenueCat, or another payment service. “Buy me a coffee” is the feature's name, not an integration with that website. Regional external-payment exceptions are outside this plan.
- Purchases on Watch, widgets, Android, or web. Hide the entry on unsupported platforms; leave their existing features working.
- Azure API endpoints, Azure SQL migrations, Entra changes, server receipt storage, or account-linked payment histories.

The app must remain equally usable whether someone supports it or not. There is no recurring infrastructure bill introduced by this design. Apple commissions still apply: under ordinary terms the standard rate is 30%, with 15% for eligible developers enrolled in the Small Business Program; actual proceeds depend on applicable agreements and taxes. Enrollment for this account has not been verified. See [Apple's terms](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/) and [Small Business Program](https://developer.apple.com/app-store/small-business-program/).

## 2. Proposed amounts and product catalog

These are **suggested Australian base prices, not approved or created products**. Confirm the available price points and other storefront prices in App Store Connect before creating them.

| Tier   | English / Chinese label | Suggested AU price | Proposed immutable product ID         |
| ------ | ----------------------- | ------------------ | ------------------------------------- |
| Small  | Small thanks / 小小心意 | A$2.99             | `com.littledays.babylog.tip.small`    |
| Medium | A coffee / 一杯咖啡     | A$4.99             | `com.littledays.babylog.tip.coffee`   |
| Large  | Big thanks / 多一份支持 | A$9.99             | `com.littledays.babylog.tip.generous` |

Each product is Consumable, quantity one per purchase. IDs do not contain currency or price, so later price changes do not require new IDs. Maintain one allowlist shared by product loading, purchase requests, and transaction processing.

Always display the price returned by StoreKit for the person's storefront. App language must not determine currency, and source code must not embed the proposed AUD prices as a fallback checkout price. Missing products stay unavailable; do not substitute one tier for another. See [Product.displayPrice](https://developer.apple.com/documentation/storekit/product/displayprice).

## 3. Screen and interaction design

Preserve the current tab order and use the existing settings navigation, typography, semantic colors, buttons, and accessibility conventions. This is a small addition, not a More redesign. Follow [Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout); recheck the [in-app purchase HIG](https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase) during implementation and native review.

### Placement

- A standalone navigation row near Privacy & support and Acknowledgements, before the final Delete account item.
- Not inside My account, not hidden behind sign-in, and not a sixth main tab.
- A small cup icon accompanies the text; the payment action itself always has a readable label and price.
- Opening the page never starts a purchase. Back to More remains available while loading or waiting for external approval.

### Screen outline

```text
Back to More
Buy me a coffee

Enjoying My Little Days? You can leave a little thanks.
Optional, one-time support. No subscription or feature unlocks.

○ Small thanks                         [store price]
○ A coffee                             [store price]
○ Big thanks                           [store price]

[ Support [selected store price] ]

About support                                      >
```

The three rows form a single-choice selection, initially unselected. Selecting a row changes only the selection; the separate Support button opens Apple's sheet. No “most popular” claims, default expensive amount, tipping reminders, or pressure to purchase.

Suggested Chinese introductory text: “如果小日子对你有帮助，可以留下一点心意。自愿、单次支持，不会订阅或解锁额外功能。” The success text is “谢谢你支持小日子。” / “Thank you for supporting My Little Days.”

The initially collapsed **About support / 关于支持** section explains repeatable single payments, Apple-managed billing, no paid benefits, and where to view Apple purchase history or request help with a refund. Use Apple's support path; do not promise refund eligibility. Keep the essential voluntary/one-time/no-unlocks sentence and any current error visible outside the collapsed section.

There is no Restore purchases button: this version creates no restorable entitlement. Recovery of unfinished transactions is automatic and different from restoring a paid feature. Do not claim consumable history can never be read: newer StoreKit can expose finished history with an opt-in, which V1 does not need. See [Apple's restore guidance](https://support.apple.com/en-us/108096) and [StoreKit updates](https://developer.apple.com/videos/play/wwdc2024/10061/).

### Accessibility and feedback

- At least 44 × 44-point row/action targets; selected state conveyed by check/radio state and accessibility metadata, not color alone.
- Dynamic Type, wrapping localized labels, large currency values, VoiceOver reading order, and iPad width constraints.
- Use the native payment sheet instead of recreating it. No extra app confirmation alert before the system confirmation.
- Show immediate local progress when opening checkout, but never show payment success optimistically.
- Keep thank-you feedback in the support screen; do not interrupt a feeding/sleep task when a delayed approval arrives. Announce relevant status accessibly when that page is visible.
- Reset the selection after completion. A second payment requires a fresh deliberate selection and Apple confirmation.

## 4. Technical recommendation and compatibility gate

Use **expo-iap behind a small iOS adapter**, rather than adding a hosted entitlement service or immediately maintaining custom StoreKit code. Expo lists expo-iap as an integration option; its current setup documentation covers Expo SDK 57 / React Native 0.86, matching this repository. It still needs a pinned-version audit and a real native build. See [Expo's IAP guide](https://docs.expo.dev/guides/in-app-purchases/) and [OpenIAP Expo setup](https://www.openiap.dev/docs/setup/expo).

Before implementation proceeds beyond a compatibility spike:

1. Resolve an actual released package version and its native dependencies. Inspect the release artifact, not only the latest documentation or a wildcard peer dependency. Pin the reviewed version in the lockfile.
2. Confirm the native implementation connects a purchase callback to the **verified result of that exact transaction**, including repeated purchases of the same SKU.
3. Confirm access to unfinished transactions, asynchronous updates, pending/cancelled results, and explicit finish control. Disable any premature automatic finishing.
4. Verify startup/reconnection behavior, deployment target, Expo config-plugin changes, the main app's In-App Purchase capability and EAS archive compatibility with the existing Watch and Widget targets. Check the existing explicit App ID rather than inventing an entitlement or automatically regenerating profiles.
5. Inspect optional services, network calls, privacy manifests and data collection; do not enable optional receipt-verification services or alternative stores.

Important pitfall: the documented [`isTransactionVerifiedIOS(sku)`](https://www.openiap.dev/docs/apis/ios/is-transaction-verified-ios) checks the latest transaction for a SKU. That alone does not prove a particular callback's transaction is verified when the same tip is purchased repeatedly. Require exact-transaction verification evidence from the locked native implementation; neither a JS callback, a decoded receipt, nor a non-empty transaction ID is sufficient.

StoreKit supports on-device verification; a new server is not required for this no-entitlement feature. Only a verified, allowed transaction can produce success or be completed. See [VerificationResult](https://developer.apple.com/documentation/storekit/verificationresult).

**Fallback:** if the audited package cannot meet these gates, stop and review a small native StoreKit 2 Expo module before substituting it. Existing native modules provide an integration pattern, but a custom bridge makes us responsible for updates, unfinished transactions, concurrency, verification, and platform maintenance. Do not silently expand to a paid backend service.

## 5. Purchase lifecycle and failure handling

Create one application-lifetime purchase coordinator, outside `Settings` and its account/family-dependent React key. Attach transaction/error listeners before initiating purchases, then initialize StoreKit and reconcile unfinished transactions asynchronously. A store outage must not block the app's initial baby-data render.

Product loading happens on entry to the support screen. Purchase completion and recovery continue independently of that screen. Foreground reconciliation reuses the same processing path, with one reconciliation in flight.

```text
Support page -> load products -> select amount -> native purchase sheet
                                                    |
               cancelled / pending / error <---------+
                                                    |
                     verified transaction <---------+
                              |
         same processor for callback, updates and unfinished replay
                              |
       validate exact transaction -> deduplicate -> process support
                              |
                  acknowledge support -> finish transaction
```

| State                             | User experience                                                                              | Processing rule                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Products loading                  | Short loading state; Back works                                                              | No purchase possible until a real product/price is available.                                                 |
| Store unavailable/restricted      | Explain unavailability; offer an appropriate retry or settings explanation                   | Do not send the person to app login or family refresh.                                                        |
| Opening payment sheet             | Button busy; suppress repeated taps                                                          | One outstanding request; never automatically retry a purchase request.                                        |
| Cancelled                         | Return calmly to selection                                                                   | No success, no alarming failure banner, no automatic retry.                                                   |
| Pending approval                  | “Waiting for approval. You can keep using the app.”                                          | Await later StoreKit updates; do not treat a timer or navigation as success/cancellation.                     |
| Outcome uncertain                 | “We couldn't confirm the result yet. Check your Apple purchase history before trying again.” | Reconcile first; do not claim they were not charged or prompt immediate repayment.                            |
| Unverified/unexpected transaction | Clear confirmation problem                                                                   | Do not thank, grant anything, or finish as valid; retain/reconcile safely and log only sanitized diagnostics. |
| Verified transaction              | Thank the person once in the current support flow                                            | Idempotent processing; no family/API round trip.                                                              |
| Processing or finish interrupted  | Explain if user action is needed; no request to pay again                                    | Retry processing/finishing the same transaction on recovery, not a new purchase.                              |

Use a serial per-transaction processor and in-memory request lock. A pending request is not a permanent application lock: keep the rest of the app usable, reconcile pending state, and provide status/help. During the compatibility spike, confirm what the wrapper can authoritatively report about unresolved approvals; do not create an indefinite lock based only on a stale local timestamp.

Recheck the product allowlist, transaction identity, verified result, quantity, environment, and revocation status where exposed on every delivered event. Do not trust a previous local journal entry as proof of a valid purchase. Deduplicate by transaction ID plus store environment, not SKU: two intentional purchases of the same SKU are two different transactions.

Finish only after verified support has been processed. If finishing fails, retry finishing that transaction without asking for another payment. Background suspension may delay handling until the next launch; do not promise execution while iOS has suspended the app. See Apple's [updates](https://developer.apple.com/documentation/storekit/transaction/updates), [unfinished](https://developer.apple.com/documentation/storekit/transaction/unfinished), [pending result](https://developer.apple.com/documentation/storekit/product/purchaseresult/pending), and [finish](<https://developer.apple.com/documentation/storekit/transaction/finish()>) documentation.

## 6. Local storage and privacy boundary

Repository-specific risk: `clearPersonalForFamilyActivation()` deletes most keys in the existing `app_data` table; family mode also prevents normal personal-data writes. `Settings` remounts when family context changes. Neither is a safe home for purchase recovery.

**Default: no custom persistent journal.** StoreKit's unfinished transactions are the durable recovery source. Use in-memory transaction deduplication and serialize processing; there is no paid entitlement or balance to persist. After an interruption, verify and finish the same transaction when Apple redelivers it. Do not add a database solely to guarantee a thank-you message can never repeat after a crash.

Only if the adapter audit demonstrates a concrete durable-processing requirement should implementation propose a tiny isolated journal using the existing SQLite dependency. Candidate file: `little-days-purchases.db`, separate from the baby's `app_data` table. The existing native security module sets **backup exclusion**, not an explicit `NSFileProtection` class: verify the actual protection class as a separate native check. If a journal is adopted, check database/WAL/SHM backup exclusion and protection before use. This would be an on-device detail, not an Azure migration.

For that contingency only, minimum fields would be environment, transaction ID, product ID, processing/finish state and timestamp, with a unique environment/transaction key. Reverify on replay; prune only safely completed markers, never discard unresolved work by age. This is not an accounting ledger or a promise of exactly-once visual feedback after every possible crash. Document the reason, retention policy and native validation before adding it.

- Do not persist cards, Apple account details, full receipts/JWS payloads, family IDs, baby data, or Entra tokens for this feature.
- Do not attach `appAccountToken` or associate a tip with the logged-in family user; app sign-in and Apple billing are separate identities.
- Keep StoreKit recovery independent of app sign-out, family join/leave and account deletion. If retained markers become necessary, keep them minimal, unlinked to the deleted app account, and covered by a documented cleanup policy.
- Exclude payment markers from family synchronization and user baby-data exports. Reinstallation is not a supported support-history restore workflow.
- Never log purchase tokens/raw receipts. Do not add analytics just to count tips. Use App Store Connect financial reports for revenue, not local client counters. See [Apple's financial-data guidance](https://developer.apple.com/documentation/storekit/transaction/price).
- Update Privacy & support wording and audit App Store privacy declarations against the actual chosen SDK; do not assume no privacy changes merely because there is no new backend.

## 7. Implemented source changes and remaining release work

Keep the new behavior in a small `src/support/` feature boundary; consolidate helpers if they do not justify separate files.

| Area                                                                     | Implemented source / remaining work                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.tsx`                                                                | Add `support` to settings navigation, route titles/announcements, Back behavior; mount the coordinator above account-dependent screen remounts.                                                                                                       |
| `src/Settings.tsx`                                                       | Add the standalone support entry with callback; keep account deletion last and preserve existing settings order.                                                                                                                                      |
| `src/support/SupportScreen.tsx`                                          | Product selection, native checkout trigger, localized states and collapsed support information; reuse `T`, `Button` and semantic palette.                                                                                                             |
| `src/support/catalog.ts` and `purchaseState.ts`                          | SKU allowlist, typed results and pure state transitions, independent of baby records.                                                                                                                                                                 |
| `src/support/store.ios.ts`, `store.ts` and `storeTypes.ts`               | Adapt the audited expo-iap API; unsupported Android/web implementation does not import native payment code.                                                                                                                                           |
| `src/support/SupportPurchaseProvider.tsx` and `SupportPurchaseRoute.tsx` | App-lifetime controller and route integration; listeners, reconciliation, deduplication and serialized requests.                                                                                                                                      |
| `src/support/messages.ts`                                                | Feature-local locale catalogs and interpolation, with English fallback and no language branching in transaction logic.                                                                                                                                |
| `src/support/purchaseStorage.ios.ts` plus fallback, contingency only     | Omit by default; add only after documenting a concrete recovery need beyond StoreKit unfinished transactions. No changes to family schemas.                                                                                                           |
| `src/i18n.tsx`, `src/PrivacySupport.tsx`                                 | English/Chinese strings and accurate payment/privacy/help text.                                                                                                                                                                                       |
| `package.json`, lockfile, `app.json`                                     | `expo-iap` is pinned; Android autolinking excludes it and the audited generic plugin remains absent. Watch/Widget plugins and OTA-disabled settings are preserved.                                                                                    |
| `eas.json`                                                               | No source change was made. Resolve and record the production environment before a native build; do not promote preview/demo values.                                                                                                                   |
| Root-level `src/supportPurchases.test.ts` etc.                           | Tests must match the current `src/*.test.ts` discovery; do not silently put all coverage in an unexecuted nested folder.                                                                                                                              |
| Rendered purchase-flow automation                                        | No fake StoreKit adapter was added to the production graph and no dedicated mock-store browser suite was added. Pure transaction/state tests and existing rendered regressions run in current CI; native sandbox/device acceptance remains mandatory. |
| `docs/VALIDATION.md` and operational runbook                             | Record native acceptance evidence and manual Apple configuration without secrets.                                                                                                                                                                     |

No edits are planned to the API, SQL schema, family permissions, timer operations, Watch purchase UI, or widget storage. Ordinary regression checks still cover those integrations.

## 8. Implementation phases and acceptance gates

Source phases B and the client portion of C are complete locally. Phase A's clean native archive gate, App Store configuration in C, and all Phase D sandbox/device/TestFlight gates remain outstanding; local source checks do not satisfy them.

### Phase A — decisions and compatibility, 0.5–1 day

- Approve V1 scope, names, three base-price points, and the More placement.
- Publish and verify the pre-feature Git tag before changing product code. `pre-buy-me-a-coffee-2026-09-20` currently exists **locally only**, pointing to the baseline above; remote publication remains outstanding.
- Review the current branch checks and unrelated worktree changes. Keep implementation commits scoped; use the GitHub plugin for publishing.
- `expo-iap` is pinned and its exact transaction verification/recovery path has source and deterministic test evidence. A clean EAS iOS archive with every existing target remains required. Do not add financial credentials to source.
- Confirm App Store category and Paid Apps Agreement status. If Kids Category requirements apply, purchase opportunities and external help links need an appropriate parental gate; parent-facing subject matter alone does not establish the category. See [Apple's Kids Category rules](https://developer.apple.com/app-store/review/guidelines/#kids-category).

Exit: written evidence that the chosen native adapter meets the requirements, plus a confirmed product/configuration checklist. A library verification gap is a design checkpoint, not a reason to skip verification.

### Phase B — purchase core, 1–1.5 days

- Implement catalog, adapter, app-lifetime coordinator and state handling; default to StoreKit-backed recovery without a custom journal.
- Cover event replay, repeat SKU purchases, cancellation/pending, double taps, store failure, and process interruption with deterministic tests.
- Demonstrate that sign-in/family changes do not erase pending processing and no Azure dependency exists.

Exit: no purchase-success state can occur from an unverified, wrong-product, cancelled, pending or merely initiated request.

### Phase C — UI and configuration, 0.5–1 day

- Add the bilingual support screen and More row using existing controls and appearances.
- Add accurate help and privacy wording; connect accessibility status and focus behavior.
- Prepare approved App Store products, localizations, review screenshots and notes following the runbook. Account Holder completes private agreement/tax/bank tasks.

Exit: UI review in both languages and appearances, no pressure prompts, correct displayed storefront prices, and no changes to core record flows.

### Phase D — validation and release candidate, 1–1.5 days

- Run `npm run verify`, production web/iOS exports and existing browser/Apple-guidance coverage. Pure purchase state/transaction tests are included; no dedicated fake-store rendered suite exists, so do not use browser results as payment acceptance.
- Verify native purchase behavior on devices, not just mocked TypeScript paths. Use Xcode StoreKit Testing if a Mac is available, otherwise EAS/TestFlight sandbox for real integration; some injected error cases still need controlled adapter/native tests.
- Freeze one release SHA/configuration and build a store-distribution IPA containing main app, Watch and Widget.
- Upload to TestFlight, wait for processing, assign the intended testers, and collect the acceptance results below.

Exit: functional TestFlight acceptance documented. Public App Store release and real-money smoke testing require a separate go-ahead.

Budget approximately **3–5 engineering days**, with a compatibility contingency. Phase ranges overlap and are planning estimates, not guarantees. Apple agreement/banking setup, review queues and device access are additional elapsed time; a custom native fallback requires re-estimation. This planning task authorizes none of those external changes.

## 9. Test matrix

| Area                    | Required checks                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transaction correctness | Verified success; invalid verification; unexpected product; repeated same-SKU purchases with distinct IDs; duplicate callbacks; quantity/environment handling.                                         |
| Interrupted operations  | Kill/relaunch before callback, after processing, and before finish; finish error; foreground replay; no automatic new charge request. Add local-write-failure coverage only if a journal is justified. |
| Pending/cancelled       | System-sheet cancellation; Ask to Buy/deferred result using supported test tooling; delayed approval; app closed or screen changed; no false success or endless full-screen spinner.                   |
| Store availability      | Offline product query, partially missing catalog, restricted purchases, storefront/language mismatch, price changes and unavailable product.                                                           |
| Account isolation       | Signed out, signed in, and disposable family joins/leaves during processing; app account changes never bind a tip to someone else's family. Never delete real accounts/data to test.                   |
| Core performance        | Store outage does not delay Today, milk/sleep buttons, local persistence or family sync; listener initialization does not gate startup.                                                                |
| Accessibility/layout    | Chinese/English, light/dark, small iPhone/iPad, accessibility font sizes, VoiceOver, reduced motion; selection and busy states not color-only.                                                         |
| Native packaging        | Existing Watch app and Today widget still embedded, signed and usable; new plugin does not break app groups or extensions.                                                                             |
| Release isolation       | Mock payment adapter absent from release; demo flag off; sandbox transactions not treated as production revenue; no financial payload in logs.                                                         |

Windows/browser success cannot prove StoreKit or Swift behavior. Record JS/CI, native compilation, device sandbox, App Review, and production acceptance as separate results.

## 10. Apple / EAS setup and release sequence

Detailed operator instructions are in the [support-IAP runbook section](AZURE-MANUAL-SETUP-RUNBOOK.md#buy-me-a-coffee-iap-setup-client-implemented-apple-steps-not-executed).

1. Account Holder confirms active Paid Apps Agreement and completes required banking/tax details privately.
2. In App Store Connect app `6809826484` / bundle `com.littledays.babylog`, create the three approved consumable products and complete metadata, availability, price points and review information. Product IDs are permanent; do not create tentative alternatives casually.
3. Configure suitable sandbox tests. App Store product metadata can take time to propagate; verify identifiers, agreements and availability before diagnosing missing products as a client defect.
4. Recheck current EAS environment and `EXPO_PUBLIC_FAMILY_*` / Entra values; `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Preview connects to production family data unless separately verified. **StoreKit sandbox does not make the family backend a sandbox.**
5. Build with `production` store distribution, a fresh build number and reviewed native configuration. At planning time source is app `0.2.1`, build `37`; inspect actual App Store/EAS state before choosing the next version/build. Do not hardcode an assumed next build number.
6. Submit the exact build to TestFlight and verify upload, Apple processing, tester availability and device acceptance separately. Existing ad hoc preview builds and Expo Go cannot establish this integration. Native IAP needs a new binary; OTA updates are currently disabled. See [Expo IAP requirements](https://docs.expo.dev/guides/in-app-purchases/).
7. For public release, attach the first consumable-type IAP submission to a new app version and submit the products and app for review together. TestFlight upload is not production IAP approval. See [Apple's submission rules](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase).

TestFlight purchases use Apple's sandbox and do not charge testers or become production purchases. A real-money validation would be a separately authorized, intentional purchase after public availability. See [Apple's testing overview](https://developer.apple.com/in-app-purchase/).

## 11. Rollback and operational limits

- Before release, stop promotion if verification, pending recovery, native compatibility or privacy checks fail; keep the existing app working unchanged.
- For planned discontinuation, follow Apple's notice procedure: announce and stop merchandising at least 31 days beforehand, end promotions and notify Apple. The guidance does not explicitly exempt pure tips, so confirm applicability with Apple rather than assuming an exemption. For an urgent issue that prevents sufficient notice, contact Apple and retain transaction recovery. See [IAP availability guidance](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-availability-for-in-app-purchases).
- Apple describes availability changes as effective immediately, but they do not cancel existing unfinished transactions or repair installed code. Ship a corrected binary when code needs changing; removal from sale is not a substitute for transaction recovery.
- A corrective build may hide new support entry points while retaining recovery/finish handling for existing unfinished transactions. Do not blindly remove all payment processing or delete its journal.
- Keep OTA disabled, preserve family data and avoid unnecessary Azure deployment. No server or family-database rollback is needed for this feature.
- No automatic refunds, retries that initiate another payment, real purchases, or public release actions are authorized by this plan.

## 12. Approval checkpoint

Recommended approval package: iPhone/iPad only; voluntary consumable tips with no benefits; A$2.99/A$4.99/A$9.99 suggested base tiers; dedicated More screen; expo-iap subject to the verification gate; no new backend.

Before implementation, confirm or revise those product choices. Before external setup/release, resolve the remote baseline tag, actual Paid Apps Agreement/category state, exact library compatibility and selected storefront prices. None of these account states has been assumed complete.
