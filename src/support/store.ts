import type { SupportPurchaseStore } from "./storeTypes";

class UnsupportedSupportStore implements SupportPurchaseStore {
  readonly supported = false;

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async getProducts(): Promise<[]> {
    return [];
  }

  async requestPurchase(): Promise<null> {
    throw new Error("support_store_unavailable");
  }

  async getUnfinishedTransactions(): Promise<[]> {
    return [];
  }

  async finishTransaction(): Promise<void> {
    throw new Error("support_store_unavailable");
  }
}

export function createSupportPurchaseStore(): SupportPurchaseStore {
  return new UnsupportedSupportStore();
}
