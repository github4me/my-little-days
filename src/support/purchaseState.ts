import {
  SUPPORT_APP_BUNDLE_ID,
  SUPPORT_PRODUCT_IDS,
  isSupportProductId,
  type SupportProductId,
} from "./catalog";

export type SupportAvailability = "checking" | "available" | "unavailable";
export type SupportProductLoadStatus = "idle" | "loading" | "loaded" | "failed";

export interface SupportDisplayProduct {
  id: SupportProductId;
  displayPrice: string;
}

export type SupportPurchaseOutcome =
  | { status: "idle" }
  | { status: "pending"; productId: SupportProductId }
  | {
      status: "confirmed-finalizing";
      productId: SupportProductId;
      transactionId: string;
    }
  | {
      status: "succeeded";
      productId: SupportProductId;
      transactionId: string;
    }
  | { status: "cancelled" }
  | { status: "ambiguous-error" };

export type SupportOutcomeMessageKey =
  | "support.purchase.pending"
  | "support.purchase.finalizing"
  | "support.purchase.success"
  | "support.purchase.error.ambiguous";

export interface SupportPurchaseState {
  availability: SupportAvailability;
  productLoadStatus: SupportProductLoadStatus;
  products: readonly SupportDisplayProduct[];
  selectedProductId: SupportProductId | null;
  busyProductId: SupportProductId | null;
  outcome: SupportPurchaseOutcome;
}

export type SupportPurchaseAction =
  | { type: "availabilityChecking" }
  | { type: "availabilityAvailable" }
  | { type: "availabilityUnavailable" }
  | { type: "productsLoading" }
  | { type: "productsLoaded"; products: readonly SupportDisplayProduct[] }
  | { type: "productsFailed" }
  | { type: "productSelected"; productId: SupportProductId | null }
  | { type: "purchaseStarted"; productId: SupportProductId }
  | { type: "purchasePending"; productId: SupportProductId }
  | {
      type: "purchaseConfirmedFinalizing";
      productId: SupportProductId;
      transactionId: string;
    }
  | {
      type: "purchaseSucceeded";
      productId: SupportProductId;
      transactionId: string;
    }
  | { type: "purchaseCancelled" }
  | { type: "purchaseAmbiguousError" }
  | { type: "outcomeCleared" };

export function createInitialSupportPurchaseState(): SupportPurchaseState {
  return {
    availability: "checking",
    productLoadStatus: "idle",
    products: [],
    selectedProductId: null,
    busyProductId: null,
    outcome: { status: "idle" },
  };
}

export function normalizeSupportProducts(
  products: readonly SupportDisplayProduct[],
): readonly SupportDisplayProduct[] {
  const byId = new Map<SupportProductId, SupportDisplayProduct>();
  for (const product of products) {
    if (!isSupportProductId(product.id)) continue;
    const displayPrice = product.displayPrice.trim();
    if (!displayPrice || byId.has(product.id)) continue;
    byId.set(product.id, { id: product.id, displayPrice });
  }
  return SUPPORT_PRODUCT_IDS.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
}

function hasLoadedProduct(
  state: SupportPurchaseState,
  productId: SupportProductId,
) {
  return state.products.some((product) => product.id === productId);
}

export function reduceSupportPurchaseState(
  state: SupportPurchaseState,
  action: SupportPurchaseAction,
): SupportPurchaseState {
  switch (action.type) {
    case "availabilityChecking":
      return { ...state, availability: "checking" };
    case "availabilityAvailable":
      return { ...state, availability: "available" };
    case "availabilityUnavailable":
      return {
        ...createInitialSupportPurchaseState(),
        availability: "unavailable",
      };
    case "productsLoading":
      return {
        ...state,
        productLoadStatus: "loading",
      };
    case "productsLoaded": {
      const products = normalizeSupportProducts(action.products);
      const selectedProductId = products.some(
        (product) => product.id === state.selectedProductId,
      )
        ? state.selectedProductId
        : null;
      return {
        ...state,
        productLoadStatus: "loaded",
        products,
        selectedProductId,
      };
    }
    case "productsFailed":
      return {
        ...state,
        productLoadStatus: "failed",
        products: [],
        selectedProductId: null,
      };
    case "productSelected":
      if (
        state.busyProductId ||
        ["pending", "confirmed-finalizing", "ambiguous-error"].includes(
          state.outcome.status,
        ) ||
        (action.productId && !hasLoadedProduct(state, action.productId))
      ) {
        return state;
      }
      return {
        ...state,
        selectedProductId: action.productId,
        outcome: { status: "idle" },
      };
    case "purchaseStarted":
      if (
        state.availability !== "available" ||
        state.productLoadStatus !== "loaded" ||
        state.selectedProductId !== action.productId ||
        state.busyProductId ||
        !hasLoadedProduct(state, action.productId) ||
        ["pending", "confirmed-finalizing", "ambiguous-error"].includes(
          state.outcome.status,
        )
      ) {
        return state;
      }
      return {
        ...state,
        selectedProductId: action.productId,
        busyProductId: action.productId,
        outcome: { status: "idle" },
      };
    case "purchasePending":
      return {
        ...state,
        busyProductId: null,
        outcome: { status: "pending", productId: action.productId },
      };
    case "purchaseConfirmedFinalizing":
      return {
        ...state,
        busyProductId: action.productId,
        outcome: {
          status: "confirmed-finalizing",
          productId: action.productId,
          transactionId: action.transactionId,
        },
      };
    case "purchaseSucceeded":
      return {
        ...state,
        selectedProductId: null,
        busyProductId: null,
        outcome: {
          status: "succeeded",
          productId: action.productId,
          transactionId: action.transactionId,
        },
      };
    case "purchaseCancelled":
      return {
        ...state,
        busyProductId: null,
        outcome: { status: "cancelled" },
      };
    case "purchaseAmbiguousError":
      return {
        ...state,
        busyProductId: null,
        outcome: { status: "ambiguous-error" },
      };
    case "outcomeCleared":
      return {
        ...state,
        busyProductId: null,
        outcome: { status: "idle" },
      };
  }
}

export function canStartSupportPurchase(state: SupportPurchaseState) {
  if (
    state.availability !== "available" ||
    state.productLoadStatus !== "loaded" ||
    !state.selectedProductId ||
    state.busyProductId ||
    !hasLoadedProduct(state, state.selectedProductId)
  ) {
    return false;
  }
  return !["pending", "confirmed-finalizing", "ambiguous-error"].includes(
    state.outcome.status,
  );
}

export function supportOutcomeMessageKey(
  outcome: SupportPurchaseOutcome,
): SupportOutcomeMessageKey | null {
  switch (outcome.status) {
    case "pending":
      return "support.purchase.pending";
    case "confirmed-finalizing":
      return "support.purchase.finalizing";
    case "succeeded":
      return "support.purchase.success";
    case "ambiguous-error":
      return "support.purchase.error.ambiguous";
    case "idle":
    case "cancelled":
      return null;
  }
}

export interface SupportTransactionCandidate {
  sourceId?: unknown;
  transactionId?: unknown;
  productId?: unknown;
  quantity?: unknown;
  purchaseState?: unknown;
  store?: unknown;
  transactionDate?: unknown;
  hasSignedTransaction?: unknown;
  revoked?: unknown;
  appBundleId?: unknown;
  environment?: unknown;
  isUpgraded?: unknown;
}

export interface ValidatedSupportTransaction {
  transactionId: string;
  productId: SupportProductId;
  quantity: 1;
  purchaseState: "purchased";
  store: "apple";
  transactionDate: number;
  environment?: "Sandbox" | "Production" | "Xcode";
  appBundleId?: typeof SUPPORT_APP_BUNDLE_ID;
}

export type SupportTransactionValidationFailure =
  | "missing-transaction-id"
  | "unknown-product"
  | "invalid-quantity"
  | "not-purchased"
  | "wrong-store"
  | "transaction-id-mismatch"
  | "invalid-date"
  | "missing-signed-transaction"
  | "revoked"
  | "upgraded"
  | "unknown-environment"
  | "wrong-app";

export type SupportTransactionValidation =
  | { valid: true; transaction: ValidatedSupportTransaction }
  | { valid: false; reason: SupportTransactionValidationFailure };

export function validateSupportTransaction(
  candidate: SupportTransactionCandidate,
): SupportTransactionValidation {
  if (
    typeof candidate.transactionId !== "string" ||
    !candidate.transactionId.trim()
  ) {
    return { valid: false, reason: "missing-transaction-id" };
  }
  if (!isSupportProductId(candidate.productId)) {
    return { valid: false, reason: "unknown-product" };
  }
  if (candidate.quantity !== 1) {
    return { valid: false, reason: "invalid-quantity" };
  }
  if (candidate.purchaseState !== "purchased") {
    return { valid: false, reason: "not-purchased" };
  }
  if (candidate.store !== "apple") {
    return { valid: false, reason: "wrong-store" };
  }
  if (candidate.sourceId !== candidate.transactionId.trim()) {
    return { valid: false, reason: "transaction-id-mismatch" };
  }
  if (
    typeof candidate.transactionDate !== "number" ||
    !Number.isFinite(candidate.transactionDate) ||
    candidate.transactionDate <= 0
  ) {
    return { valid: false, reason: "invalid-date" };
  }
  if (candidate.hasSignedTransaction !== true) {
    return { valid: false, reason: "missing-signed-transaction" };
  }
  if (Boolean(candidate.revoked)) {
    return { valid: false, reason: "revoked" };
  }
  if (candidate.isUpgraded === true) {
    return { valid: false, reason: "upgraded" };
  }
  if (
    candidate.environment !== undefined &&
    candidate.environment !== null &&
    candidate.environment !== "Sandbox" &&
    candidate.environment !== "Production" &&
    candidate.environment !== "Xcode"
  ) {
    return { valid: false, reason: "unknown-environment" };
  }
  if (
    candidate.appBundleId !== undefined &&
    candidate.appBundleId !== null &&
    candidate.appBundleId !== SUPPORT_APP_BUNDLE_ID
  ) {
    return { valid: false, reason: "wrong-app" };
  }

  return {
    valid: true,
    transaction: {
      transactionId: candidate.transactionId.trim(),
      productId: candidate.productId,
      quantity: 1,
      purchaseState: "purchased",
      store: "apple",
      transactionDate: candidate.transactionDate,
      ...(candidate.environment === "Sandbox" ||
      candidate.environment === "Production" ||
      candidate.environment === "Xcode"
        ? { environment: candidate.environment }
        : {}),
      ...(candidate.appBundleId === SUPPORT_APP_BUNDLE_ID
        ? { appBundleId: SUPPORT_APP_BUNDLE_ID }
        : {}),
    },
  };
}
