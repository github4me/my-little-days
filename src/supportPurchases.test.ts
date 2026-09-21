import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORT_APP_BUNDLE_ID,
  SUPPORT_PRODUCT_IDS,
  SUPPORT_PRODUCT_KIND,
  SUPPORT_PURCHASE_IS_REPEATABLE,
  SUPPORT_PURCHASE_PLATFORM,
  SUPPORT_TIERS,
} from "./support/catalog";
import {
  canStartSupportPurchase,
  createInitialSupportPurchaseState,
  reduceSupportPurchaseState,
  supportOutcomeMessageKey,
  validateSupportTransaction,
  type SupportDisplayProduct,
  type SupportPurchaseState,
  type SupportTransactionCandidate,
} from "./support/purchaseState";
import { createSupportTranslator } from "./support/messages";
import { resolveSupportMessageCatalog } from "./support/messages";
import {
  SupportPurchaseRequestGate,
  classifySupportStoreError,
  supportProductForStoreError,
  supportScreenStatus,
  supportTransactions,
} from "./support/purchaseCoordinator";

const products: readonly SupportDisplayProduct[] = [
  { id: SUPPORT_PRODUCT_IDS[0], displayPrice: "$2.99" },
  { id: SUPPORT_PRODUCT_IDS[1], displayPrice: "$4.99" },
  { id: SUPPORT_PRODUCT_IDS[2], displayPrice: "$9.99" },
];

function loadedState(): SupportPurchaseState {
  let state = createInitialSupportPurchaseState();
  state = reduceSupportPurchaseState(state, {
    type: "availabilityAvailable",
  });
  state = reduceSupportPurchaseState(state, { type: "productsLoading" });
  return reduceSupportPurchaseState(state, {
    type: "productsLoaded",
    products,
  });
}

test("support catalog is iOS-only, repeatable, consumable, and translation-key based", () => {
  assert.equal(SUPPORT_PURCHASE_PLATFORM, "ios");
  assert.equal(SUPPORT_PRODUCT_KIND, "consumable");
  assert.equal(SUPPORT_PURCHASE_IS_REPEATABLE, true);
  assert.deepEqual(SUPPORT_PRODUCT_IDS, [
    "com.littledays.babylog.tip.small",
    "com.littledays.babylog.tip.coffee",
    "com.littledays.babylog.tip.generous",
  ]);
  assert.deepEqual(
    SUPPORT_TIERS.map(({ id, labelKey }) => ({ id, labelKey })),
    [
      {
        id: SUPPORT_PRODUCT_IDS[0],
        labelKey: "support.product.small",
      },
      {
        id: SUPPORT_PRODUCT_IDS[1],
        labelKey: "support.product.coffee",
      },
      {
        id: SUPPORT_PRODUCT_IDS[2],
        labelKey: "support.product.generous",
      },
    ],
  );
  for (const tier of SUPPORT_TIERS) {
    assert.equal("displayPrice" in tier, false);
    assert.match(tier.descriptionKey, /^support\.product\..+\.description$/);
  }
});

test("transaction validation accepts only an exact supported purchase", () => {
  const valid: SupportTransactionCandidate = {
    sourceId: "transaction-1",
    transactionId: " transaction-1 ",
    productId: SUPPORT_PRODUCT_IDS[1],
    quantity: 1,
    purchaseState: "purchased",
    store: "apple",
    transactionDate: 1_779_315_200_000,
    hasSignedTransaction: true,
    revoked: false,
    appBundleId: SUPPORT_APP_BUNDLE_ID,
    environment: "Sandbox",
  };
  assert.deepEqual(validateSupportTransaction(valid), {
    valid: true,
    transaction: {
      transactionId: "transaction-1",
      productId: SUPPORT_PRODUCT_IDS[1],
      quantity: 1,
      purchaseState: "purchased",
      store: "apple",
      transactionDate: 1_779_315_200_000,
      environment: "Sandbox",
      appBundleId: SUPPORT_APP_BUNDLE_ID,
    },
  });

  const withoutOptionalBundle = { ...valid };
  delete withoutOptionalBundle.appBundleId;
  assert.equal(validateSupportTransaction(withoutOptionalBundle).valid, true);
});

test("transaction validation rejects malformed, unrelated, revoked, or wrong-app purchases", () => {
  const base: SupportTransactionCandidate = {
    sourceId: "transaction-1",
    transactionId: "transaction-1",
    productId: SUPPORT_PRODUCT_IDS[0],
    quantity: 1,
    purchaseState: "purchased",
    store: "apple",
    transactionDate: 1_779_315_200_000,
    hasSignedTransaction: true,
    revoked: false,
    appBundleId: SUPPORT_APP_BUNDLE_ID,
    environment: "Production",
  };
  const failures: [Partial<SupportTransactionCandidate>, string][] = [
    [{ transactionId: "   " }, "missing-transaction-id"],
    [{ productId: `${SUPPORT_PRODUCT_IDS[0]}.other` }, "unknown-product"],
    [{ quantity: 0 }, "invalid-quantity"],
    [{ quantity: 2 }, "invalid-quantity"],
    [{ quantity: "1" }, "invalid-quantity"],
    [{ purchaseState: "pending" }, "not-purchased"],
    [{ store: "google" }, "wrong-store"],
    [{ sourceId: "other-transaction" }, "transaction-id-mismatch"],
    [{ transactionDate: Number.NaN }, "invalid-date"],
    [{ transactionDate: 0 }, "invalid-date"],
    [{ hasSignedTransaction: false }, "missing-signed-transaction"],
    [{ revoked: true }, "revoked"],
    [{ revoked: "2026-09-20T00:00:00Z" }, "revoked"],
    [{ isUpgraded: true }, "upgraded"],
    [{ environment: "FutureStore" }, "unknown-environment"],
    [{ appBundleId: "" }, "wrong-app"],
    [{ appBundleId: "com.example.other" }, "wrong-app"],
  ];
  for (const [change, expectedReason] of failures) {
    assert.deepEqual(validateSupportTransaction({ ...base, ...change }), {
      valid: false,
      reason: expectedReason,
    });
  }
});

test("product loading normalizes price text, catalog order, and selection", () => {
  let state = loadedState();
  state = reduceSupportPurchaseState(state, {
    type: "productsLoaded",
    products: [
      { id: SUPPORT_PRODUCT_IDS[2], displayPrice: "  $9.99  " },
      { id: SUPPORT_PRODUCT_IDS[0], displayPrice: "$2.99" },
      { id: SUPPORT_PRODUCT_IDS[0], displayPrice: "$3.99" },
      { id: SUPPORT_PRODUCT_IDS[1], displayPrice: "  " },
    ],
  });
  assert.deepEqual(state.products, [
    { id: SUPPORT_PRODUCT_IDS[0], displayPrice: "$2.99" },
    { id: SUPPORT_PRODUCT_IDS[2], displayPrice: "$9.99" },
  ]);
  assert.equal(state.selectedProductId, null);

  const ignored = reduceSupportPurchaseState(state, {
    type: "productSelected",
    productId: SUPPORT_PRODUCT_IDS[1],
  });
  assert.equal(ignored, state);
  state = reduceSupportPurchaseState(state, {
    type: "productSelected",
    productId: SUPPORT_PRODUCT_IDS[2],
  });
  assert.equal(state.selectedProductId, SUPPORT_PRODUCT_IDS[2]);
  assert.equal(canStartSupportPurchase(state), true);
});

test("purchase reducer distinguishes pending, finalizing, success, and quiet cancellation", () => {
  let state = loadedState();
  state = reduceSupportPurchaseState(state, {
    type: "productSelected",
    productId: SUPPORT_PRODUCT_IDS[1],
  });
  state = reduceSupportPurchaseState(state, {
    type: "purchaseStarted",
    productId: SUPPORT_PRODUCT_IDS[1],
  });
  assert.equal(state.busyProductId, SUPPORT_PRODUCT_IDS[1]);
  assert.equal(canStartSupportPurchase(state), false);

  state = reduceSupportPurchaseState(state, {
    type: "purchasePending",
    productId: SUPPORT_PRODUCT_IDS[1],
  });
  assert.equal(state.outcome.status, "pending");
  assert.equal(
    supportOutcomeMessageKey(state.outcome),
    "support.purchase.pending",
  );
  assert.equal(canStartSupportPurchase(state), false);
  assert.equal(
    reduceSupportPurchaseState(state, {
      type: "purchaseStarted",
      productId: SUPPORT_PRODUCT_IDS[1],
    }),
    state,
    "a pending StoreKit transaction must not allow an accidental repayment",
  );

  state = reduceSupportPurchaseState(state, {
    type: "purchaseConfirmedFinalizing",
    productId: SUPPORT_PRODUCT_IDS[1],
    transactionId: "transaction-1",
  });
  assert.equal(state.outcome.status, "confirmed-finalizing");
  assert.equal(
    supportOutcomeMessageKey(state.outcome),
    "support.purchase.finalizing",
  );

  state = reduceSupportPurchaseState(state, {
    type: "purchaseSucceeded",
    productId: SUPPORT_PRODUCT_IDS[1],
    transactionId: "transaction-1",
  });
  assert.equal(state.outcome.status, "succeeded");
  assert.equal(
    supportOutcomeMessageKey(state.outcome),
    "support.purchase.success",
  );
  assert.equal(state.selectedProductId, null);
  assert.equal(canStartSupportPurchase(state), false);

  state = reduceSupportPurchaseState(state, {
    type: "productSelected",
    productId: SUPPORT_PRODUCT_IDS[1],
  });
  assert.equal(canStartSupportPurchase(state), true);

  state = reduceSupportPurchaseState(state, { type: "purchaseCancelled" });
  assert.equal(state.outcome.status, "cancelled");
  assert.equal(supportOutcomeMessageKey(state.outcome), null);
  assert.equal(canStartSupportPurchase(state), true);
});

test("ambiguous errors block repayment until reconciliation clears the outcome", () => {
  let state = loadedState();
  state = reduceSupportPurchaseState(state, {
    type: "productSelected",
    productId: SUPPORT_PRODUCT_IDS[0],
  });
  state = reduceSupportPurchaseState(state, {
    type: "purchaseAmbiguousError",
  });
  assert.equal(state.outcome.status, "ambiguous-error");
  assert.equal(
    supportOutcomeMessageKey(state.outcome),
    "support.purchase.error.ambiguous",
  );
  assert.equal(canStartSupportPurchase(state), false);

  const unchanged = reduceSupportPurchaseState(state, {
    type: "productSelected",
    productId: SUPPORT_PRODUCT_IDS[2],
  });
  assert.equal(unchanged, state);

  state = reduceSupportPurchaseState(state, { type: "outcomeCleared" });
  assert.equal(state.outcome.status, "idle");
  assert.equal(canStartSupportPurchase(state), true);
});

test("the synchronous request gate prevents two consumable requests before render", async () => {
  const gate = new SupportPurchaseRequestGate();
  let requestCount = 0;
  const tryRequest = async () => {
    if (gate.tryAcquire(SUPPORT_PRODUCT_IDS[1]) === null) return;
    requestCount += 1;
    await Promise.resolve();
  };
  await Promise.all([tryRequest(), tryRequest()]);
  assert.equal(requestCount, 1);
  assert.equal(gate.current(), SUPPORT_PRODUCT_IDS[1]);
});

test("transaction correlation cannot release a newer same-SKU request", () => {
  const gate = new SupportPurchaseRequestGate();
  const oldKey = "Sandbox:old";
  const newKey = "Sandbox:new";

  assert.equal(
    gate.adoptRecoveryTransaction(SUPPORT_PRODUCT_IDS[1], oldKey),
    true,
  );
  assert.equal(gate.releaseTransaction(oldKey), true);

  const requestToken = gate.tryAcquire(SUPPORT_PRODUCT_IDS[1]);
  assert.equal(typeof requestToken, "number");
  assert.equal(
    gate.adoptRecoveryTransaction(SUPPORT_PRODUCT_IDS[1], oldKey),
    false,
    "a duplicate old transaction must not take ownership of the new request",
  );
  assert.equal(gate.releaseTransaction(oldKey), false);
  assert.equal(gate.current(), SUPPORT_PRODUCT_IDS[1]);
  assert.equal(
    gate.bindRequestTransaction(requestToken as number, newKey),
    true,
  );
  assert.equal(gate.releaseTransaction(oldKey), false);
  assert.equal(gate.releaseTransaction(newKey), true);
  assert.equal(gate.current(), null);
});

test("global StoreKit errors are scoped and conservatively classified", () => {
  const active = SUPPORT_PRODUCT_IDS[1];
  assert.equal(
    supportProductForStoreError({ code: "unknown" }, active),
    active,
  );
  assert.equal(
    supportProductForStoreError(
      { code: "unknown", productId: "com.example.other" },
      active,
    ),
    null,
  );
  assert.equal(
    supportProductForStoreError(
      { code: "unknown", productId: SUPPORT_PRODUCT_IDS[0] },
      active,
    ),
    null,
  );
  assert.equal(
    supportProductForStoreError(
      { code: "unknown", productId: SUPPORT_PRODUCT_IDS[0] },
      null,
    ),
    SUPPORT_PRODUCT_IDS[0],
  );
  assert.equal(supportProductForStoreError({ code: "unknown" }, null), null);

  assert.equal(classifySupportStoreError("user-cancelled"), "cancelled");
  assert.equal(classifySupportStoreError("deferred-payment"), "pending");
  assert.equal(
    classifySupportStoreError("transaction-validation-failed"),
    "verification",
  );
  assert.equal(
    classifySupportStoreError("purchase-verification-finish-failed"),
    "processing",
  );
  assert.equal(classifySupportStoreError("sku-not-found"), "failed");
  for (const code of [
    "network-error",
    "remote-error",
    "service-error",
    "purchase-error",
    "purchase-verification-finished",
    "unknown",
  ]) {
    assert.equal(classifySupportStoreError(code), "ambiguous", code);
  }
});

test("reconciliation ignores unfinished purchases owned by other features", () => {
  assert.deepEqual(
    supportTransactions([
      { productId: "com.example.future", id: "other" },
      { productId: SUPPORT_PRODUCT_IDS[0], id: "support" },
    ]),
    [{ productId: SUPPORT_PRODUCT_IDS[0], id: "support" }],
  );
});

test("transaction outcome remains visible when product loading later fails", () => {
  let pending = loadedState();
  pending = reduceSupportPurchaseState(pending, {
    type: "purchasePending",
    productId: SUPPORT_PRODUCT_IDS[0],
  });
  pending = reduceSupportPurchaseState(pending, { type: "productsFailed" });
  assert.deepEqual(supportScreenStatus(pending, null), { kind: "pending" });

  let uncertain = loadedState();
  uncertain = reduceSupportPurchaseState(uncertain, {
    type: "purchaseAmbiguousError",
  });
  uncertain = reduceSupportPurchaseState(uncertain, {
    type: "productsFailed",
  });
  assert.deepEqual(supportScreenStatus(uncertain, "uncertain"), {
    kind: "error",
    reason: "uncertain",
  });
});

test("support translations accept later locales with an English fallback", () => {
  const future = createSupportTranslator("fr-FR", {
    "support.title": "Un café",
  });
  assert.equal(future("support.title"), "Un café");
  assert.equal(future("support.action.select"), "Choose an amount");
  assert.equal(
    createSupportTranslator("zh-Hans")("support.action.select"),
    "请先选择金额",
  );

  const futureCatalogs = {
    "en-US": { "support.title": "English" },
    "zh-CN": { "support.title": "简体" },
    "zh-TW": { "support.title": "繁體" },
  };
  assert.equal(
    resolveSupportMessageCatalog("ZH_cn", futureCatalogs)["support.title"],
    "简体",
  );
  assert.equal(
    resolveSupportMessageCatalog("zh-Hant-TW", futureCatalogs)["support.title"],
    "繁體",
  );
  assert.equal(
    resolveSupportMessageCatalog("zh-Hant", {
      "en-US": futureCatalogs["en-US"],
      "zh-CN": futureCatalogs["zh-CN"],
    })["support.title"],
    "English",
  );
});
