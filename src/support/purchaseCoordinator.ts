import { isSupportProductId, type SupportProductId } from "./catalog";
import type { SupportPurchaseState } from "./purchaseState";
import type { SupportStoreError } from "./storeTypes";
import type { SupportErrorReason, SupportScreenStatus } from "./SupportScreen";

export type SupportStoreErrorDisposition =
  | "cancelled"
  | "pending"
  | "failed"
  | "verification"
  | "processing"
  | "ambiguous";

/**
 * Synchronous guard for a repeatable consumable purchase request. React state
 * updates are intentionally not used as the mutex because a second press can
 * arrive before the reducer has rendered its busy state.
 */
export class SupportPurchaseRequestGate {
  private nextToken = 1;
  private active:
    | {
        token: number;
        kind: "request" | "recovery";
        productId: SupportProductId;
        transactionKey: string | null;
        phase: "requesting" | "pending" | "uncertain" | "transaction";
      }
    | undefined;

  current(): SupportProductId | null {
    return this.active?.productId ?? null;
  }

  tryAcquire(productId: SupportProductId): number | null {
    if (this.active) return null;
    const token = this.nextToken++;
    this.active = {
      token,
      kind: "request",
      productId,
      transactionKey: null,
      phase: "requesting",
    };
    return token;
  }

  bindRequestTransaction(token: number, transactionKey: string): boolean {
    if (
      !this.active ||
      this.active.kind !== "request" ||
      this.active.token !== token
    ) {
      return false;
    }
    this.active.transactionKey = transactionKey;
    this.active.phase = "transaction";
    return true;
  }

  adoptRecoveryTransaction(
    productId: SupportProductId,
    transactionKey: string,
  ): boolean {
    if (!this.active) {
      this.active = {
        token: this.nextToken++,
        kind: "recovery",
        productId,
        transactionKey,
        phase: "transaction",
      };
    }
    return this.active.transactionKey === transactionKey;
  }

  ownsTransaction(transactionKey: string): boolean {
    return this.active?.transactionKey === transactionKey;
  }

  markRequest(token: number, phase: "pending" | "uncertain"): boolean {
    if (
      !this.active ||
      this.active.kind !== "request" ||
      this.active.token !== token
    ) {
      return false;
    }
    this.active.phase = phase;
    return true;
  }

  markCurrent(phase: "pending" | "uncertain"): void {
    if (this.active) this.active.phase = phase;
  }

  releaseRequest(token: number): boolean {
    if (
      !this.active ||
      this.active.kind !== "request" ||
      this.active.token !== token
    ) {
      return false;
    }
    this.active = undefined;
    return true;
  }

  releaseTransaction(transactionKey: string): boolean {
    if (!this.active || this.active.transactionKey !== transactionKey) {
      return false;
    }
    this.active = undefined;
    return true;
  }

  releaseAfterEmptyReconciliation(): boolean {
    if (
      !this.active ||
      (this.active.kind === "request" &&
        this.active.phase !== "uncertain" &&
        this.active.phase !== "transaction")
    ) {
      return false;
    }
    this.active = undefined;
    return true;
  }
}

/**
 * Purchase error events are global to expo-iap. An explicitly unrelated SKU is
 * ignored; an event without a SKU belongs here only while this feature owns an
 * in-flight request.
 */
export function supportProductForStoreError(
  error: SupportStoreError,
  activeProductId: SupportProductId | null,
): SupportProductId | null {
  const explicitProductId = error.productId?.trim();
  if (explicitProductId) {
    if (!isSupportProductId(explicitProductId)) return null;
    if (activeProductId && activeProductId !== explicitProductId) return null;
    return explicitProductId;
  }
  return activeProductId;
}

/**
 * Cancellation and request/configuration preflight failures are safe to unlock.
 * Store, transport and unknown failures are reconciled with StoreKit before
 * another payment can be requested because they may arrive after acceptance.
 */
export function classifySupportStoreError(
  code: string,
): SupportStoreErrorDisposition {
  if (code === "user-cancelled") return "cancelled";
  if (code === "pending" || code === "deferred-payment") return "pending";
  if (
    code === "transaction-validation-failed" ||
    code === "purchase-verification-failed"
  ) {
    return "verification";
  }
  if (code === "purchase-verification-finish-failed") return "processing";
  if (
    code === "activity-unavailable" ||
    code === "developer-error" ||
    code === "empty-sku-list" ||
    code === "feature-not-supported" ||
    code === "iap-not-available" ||
    code === "init-connection" ||
    code === "item-not-owned" ||
    code === "item-unavailable" ||
    code === "not-prepared" ||
    code === "query-product" ||
    code === "sku-not-found" ||
    code === "sku-offer-mismatch"
  ) {
    return "failed";
  }
  return "ambiguous";
}

export function supportTransactions<T extends { productId: string }>(
  transactions: readonly T[],
): T[] {
  return transactions.filter((transaction) =>
    isSupportProductId(transaction.productId),
  );
}

export function supportTransactionKey(transaction: {
  transactionId: string;
  environment?: string | null;
}): string | null {
  const transactionId = transaction.transactionId.trim();
  if (!transactionId) return null;
  const environment = transaction.environment?.trim() || "unknown";
  return `${environment}:${transactionId}`;
}

/** Transaction truth stays visible even when a later catalog refresh fails. */
export function supportScreenStatus(
  state: SupportPurchaseState,
  errorReason: SupportErrorReason | null,
): SupportScreenStatus {
  if (state.busyProductId && state.outcome.status === "idle") {
    return { kind: "purchasing" };
  }
  switch (state.outcome.status) {
    case "pending":
      return { kind: "pending" };
    case "confirmed-finalizing":
      return {
        kind: "pending",
        messageKey: "support.status.processing",
      };
    case "succeeded":
      return { kind: "success" };
    case "ambiguous-error":
      return { kind: "error", reason: errorReason ?? "uncertain" };
    case "cancelled":
    case "idle":
      break;
  }
  if (state.availability === "checking") return { kind: "loading" };
  if (
    state.availability === "unavailable" ||
    state.productLoadStatus === "failed"
  ) {
    return { kind: "unavailable" };
  }
  if (
    state.productLoadStatus === "idle" ||
    state.productLoadStatus === "loading"
  ) {
    return { kind: "loading" };
  }
  if (errorReason) return { kind: "error", reason: errorReason };
  return { kind: state.outcome.status === "cancelled" ? "cancelled" : "ready" };
}
