export type SupportStoreProduct = {
  productId: string;
  displayPrice: string;
};

export type SupportStoreTransaction = {
  sourceId: string;
  transactionId: string;
  productId: string;
  quantity: number;
  purchaseState: "pending" | "purchased" | "unknown";
  store: string;
  transactionDate: number;
  hasSignedTransaction: boolean;
  appBundleId?: string | null;
  environment?: string | null;
  isUpgraded?: boolean | null;
  revocationDate?: number | null;
};

export type SupportStoreError = {
  code: string;
  productId?: string | null;
};

export type SupportStoreCallbacks = {
  onTransaction: (transaction: SupportStoreTransaction) => void;
  onError: (error: SupportStoreError) => void;
};

export interface SupportPurchaseStore {
  readonly supported: boolean;
  start(callbacks: SupportStoreCallbacks): Promise<void>;
  stop(): Promise<void>;
  getProducts(productIds: readonly string[]): Promise<SupportStoreProduct[]>;
  requestPurchase(productId: string): Promise<SupportStoreTransaction | null>;
  getUnfinishedTransactions(): Promise<SupportStoreTransaction[]>;
  finishTransaction(transactionId: string): Promise<void>;
}
