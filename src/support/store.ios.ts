import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getPendingTransactionsIOS,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Product,
  type Purchase,
  type PurchaseIOS,
} from "expo-iap";
import type {
  SupportPurchaseStore,
  SupportStoreCallbacks,
  SupportStoreProduct,
  SupportStoreTransaction,
} from "./storeTypes";

function normalizedTransaction(
  purchase: Purchase,
): SupportStoreTransaction | null {
  const iosPurchase = purchase as PurchaseIOS;
  const transactionId = iosPurchase.transactionId || "";
  if (!transactionId) return null;
  return {
    sourceId: purchase.id,
    transactionId,
    productId: purchase.productId,
    quantity: purchase.quantity,
    purchaseState: purchase.purchaseState,
    store: purchase.store,
    transactionDate: purchase.transactionDate,
    hasSignedTransaction:
      typeof purchase.purchaseToken === "string" &&
      purchase.purchaseToken.length > 0,
    appBundleId: iosPurchase.appBundleIdIOS,
    environment: iosPurchase.environmentIOS,
    isUpgraded: iosPurchase.isUpgradedIOS,
    revocationDate: iosPurchase.revocationDateIOS,
  };
}

class IosSupportStore implements SupportPurchaseStore {
  readonly supported = true;
  private callbacks: SupportStoreCallbacks | null = null;
  private updateSubscription: { remove(): void } | null = null;
  private errorSubscription: { remove(): void } | null = null;
  private connected = false;
  private readonly purchases = new Map<string, Purchase>();

  async start(callbacks: SupportStoreCallbacks): Promise<void> {
    if (this.connected) {
      this.callbacks = callbacks;
      return;
    }
    this.callbacks = callbacks;
    // Register before connecting so an unfinished StoreKit transaction cannot
    // arrive between connection setup and listener registration.
    this.updateSubscription = purchaseUpdatedListener((purchase) => {
      const transaction = normalizedTransaction(purchase);
      if (!transaction) return;
      this.purchases.set(transaction.transactionId, purchase);
      this.callbacks?.onTransaction(transaction);
    });
    this.errorSubscription = purchaseErrorListener((error) => {
      this.callbacks?.onError({
        code: error.code ?? "unknown",
        productId: error.productId,
      });
    });
    try {
      const ready = await initConnection();
      if (!ready) throw new Error("support_store_connection_failed");
      this.connected = true;
    } catch (error) {
      this.removeListeners();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.callbacks = null;
    this.removeListeners();
    this.purchases.clear();
    if (!this.connected) return;
    this.connected = false;
    try {
      await endConnection();
    } catch {
      // Unmount must not surface a store-disconnect error to the user.
    }
  }

  async getProducts(
    productIds: readonly string[],
  ): Promise<SupportStoreProduct[]> {
    const products = await fetchProducts({
      skus: [...productIds],
      type: "in-app",
    });
    return ((products ?? []) as Product[]).map((product) => ({
      productId: product.id,
      displayPrice: product.displayPrice,
    }));
  }

  async requestPurchase(
    productId: string,
  ): Promise<SupportStoreTransaction | null> {
    const result = await requestPurchase({
      request: {
        apple: {
          sku: productId,
          quantity: 1,
          andDangerouslyFinishTransactionAutomatically: false,
        },
      },
      type: "in-app",
    });
    const purchase = Array.isArray(result)
      ? result.find((candidate) => candidate.productId === productId)
      : result;
    if (!purchase || purchase.productId !== productId) return null;
    return normalizedTransaction(purchase);
  }

  async getUnfinishedTransactions(): Promise<SupportStoreTransaction[]> {
    const purchases = await getPendingTransactionsIOS();
    const transactions: SupportStoreTransaction[] = [];
    for (const purchase of purchases) {
      const transaction = normalizedTransaction(purchase);
      if (!transaction) continue;
      this.purchases.set(transaction.transactionId, purchase);
      transactions.push(transaction);
    }
    return transactions;
  }

  async finishTransaction(transactionId: string): Promise<void> {
    let purchase = this.purchases.get(transactionId);
    if (!purchase) {
      const pending = await getPendingTransactionsIOS();
      purchase = pending.find(
        (candidate) => candidate.transactionId === transactionId,
      );
      if (purchase) this.purchases.set(transactionId, purchase);
    }
    if (!purchase) throw new Error("support_transaction_not_found");
    await finishTransaction({ purchase, isConsumable: true });
    this.purchases.delete(transactionId);
  }

  private removeListeners() {
    this.updateSubscription?.remove();
    this.errorSubscription?.remove();
    this.updateSubscription = null;
    this.errorSubscription = null;
  }
}

export function createSupportPurchaseStore(): SupportPurchaseStore {
  return new IosSupportStore();
}
