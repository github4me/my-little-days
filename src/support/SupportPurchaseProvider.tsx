import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import {
  SUPPORT_TIERS,
  isSupportProductId,
  type SupportProductId,
} from "./catalog";
import {
  canStartSupportPurchase,
  createInitialSupportPurchaseState,
  reduceSupportPurchaseState,
  validateSupportTransaction,
  type SupportPurchaseState,
} from "./purchaseState";
import {
  SupportPurchaseRequestGate,
  classifySupportStoreError,
  supportScreenStatus,
  supportProductForStoreError,
  supportTransactionKey,
  supportTransactions,
} from "./purchaseCoordinator";
import { SUPPORT_PURCHASES_ENABLED } from "./release";
import type {
  SupportPurchaseStore,
  SupportStoreError,
  SupportStoreTransaction,
} from "./storeTypes";
import type {
  SupportErrorReason,
  SupportProductRow,
  SupportScreenStatus,
} from "./SupportScreen";

type SupportPurchaseController = {
  visible: boolean;
  products: readonly SupportProductRow[];
  selectedProductId: SupportProductId | null;
  status: SupportScreenStatus;
  canPurchase: boolean;
  selectProduct: (productId: string) => void;
  purchase: () => Promise<void>;
  reloadProducts: () => Promise<void>;
};

const SupportPurchaseContext = createContext<SupportPurchaseController | null>(
  null,
);

const disabledSupportPurchases: SupportPurchaseController = {
  visible: false,
  products: [],
  selectedProductId: null,
  status: { kind: "unavailable" },
  canPurchase: false,
  selectProduct: () => {},
  purchase: async () => {},
  reloadProducts: async () => {},
};

function thrownStoreError(error: unknown): SupportStoreError {
  if (!error || typeof error !== "object") return { code: "unknown" };
  const candidate = error as { code?: unknown; productId?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "unknown",
    productId:
      typeof candidate.productId === "string" ? candidate.productId : null,
  };
}

export function SupportPurchaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!SUPPORT_PURCHASES_ENABLED) {
    return (
      <SupportPurchaseContext.Provider value={disabledSupportPurchases}>
        {children}
      </SupportPurchaseContext.Provider>
    );
  }
  return (
    <EnabledSupportPurchaseProvider>{children}</EnabledSupportPurchaseProvider>
  );
}

function EnabledSupportPurchaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [store] = useState<SupportPurchaseStore>(() => {
    // Do not evaluate the iOS adapter (or expo-iap) in a disabled release.
    const { createSupportPurchaseStore } =
      require("./store") as typeof import("./store");
    return createSupportPurchaseStore();
  });
  const [state, dispatch] = useReducer(
    reduceSupportPurchaseState,
    undefined,
    createInitialSupportPurchaseState,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  const connection = useRef<Promise<void> | null>(null);
  const reconciliation = useRef<Promise<void> | null>(null);
  const processing = useRef(new Set<string>());
  const completed = useRef(new Set<string>());
  const requestGate = useRef(new SupportPurchaseRequestGate()).current;
  const [errorReason, setErrorReason] = useState<SupportErrorReason | null>(
    null,
  );

  const processTransactionRef = useRef<
    (transaction: SupportStoreTransaction) => Promise<void>
  >(async () => {});
  const handleStoreErrorRef = useRef<
    (error: SupportStoreError, requestToken?: number) => void
  >(() => {});

  const processTransaction = useCallback(
    async (candidate: SupportStoreTransaction) => {
      // Ignore purchases owned by other current or future app features. They
      // must never be consumed by the support flow.
      if (!isSupportProductId(candidate.productId)) return;
      if (candidate.purchaseState === "pending") {
        const pendingKey = supportTransactionKey(candidate);
        const reportsCurrentTransaction =
          pendingKey != null &&
          requestGate.adoptRecoveryTransaction(candidate.productId, pendingKey);
        if (!mounted.current || !reportsCurrentTransaction) return;
        setErrorReason(null);
        dispatch({
          type: "purchasePending",
          productId: candidate.productId,
        });
        return;
      }
      const validation = validateSupportTransaction({
        sourceId: candidate.sourceId,
        transactionId: candidate.transactionId,
        productId: candidate.productId,
        quantity: candidate.quantity,
        purchaseState: candidate.purchaseState,
        store: candidate.store,
        transactionDate: candidate.transactionDate,
        hasSignedTransaction: candidate.hasSignedTransaction,
        revoked: candidate.revocationDate != null,
        appBundleId: candidate.appBundleId,
        environment: candidate.environment,
        isUpgraded: candidate.isUpgraded,
      });
      if (!validation.valid) {
        const invalidKey = supportTransactionKey(candidate);
        const reportsCurrentTransaction =
          invalidKey != null &&
          requestGate.adoptRecoveryTransaction(candidate.productId, invalidKey);
        if (!mounted.current || !reportsCurrentTransaction) return;
        setErrorReason("verification");
        dispatch({ type: "purchaseAmbiguousError" });
        return;
      }
      const { transaction } = validation;
      const transactionKey = supportTransactionKey(transaction);
      if (!transactionKey) return;
      if (completed.current.has(transactionKey)) return;
      if (processing.current.has(transactionKey)) return;
      const reportsCurrentTransaction = requestGate.adoptRecoveryTransaction(
        transaction.productId,
        transactionKey,
      );
      processing.current.add(transactionKey);
      if (mounted.current && reportsCurrentTransaction) {
        setErrorReason(null);
        dispatch({
          type: "purchaseConfirmedFinalizing",
          productId: transaction.productId,
          transactionId: transaction.transactionId,
        });
      }
      try {
        // expo-iap 5.6.3/OpenIAP Apple 3.4.0 checks StoreKit verification
        // before emitting this exact transaction. Finishing only that ID keeps
        // repeatable consumable support purchases correctly associated.
        await store.finishTransaction(transaction.transactionId);
        completed.current.add(transactionKey);
        const releasedCurrentTransaction =
          requestGate.releaseTransaction(transactionKey);
        if (!mounted.current) return;
        if (reportsCurrentTransaction || releasedCurrentTransaction) {
          dispatch({
            type: "purchaseSucceeded",
            productId: transaction.productId,
            transactionId: transaction.transactionId,
          });
        }
      } catch {
        // Leave the StoreKit transaction unfinished. Reconciliation retries the
        // same verified transaction; the user is explicitly told not to repay.
        if (
          mounted.current &&
          (reportsCurrentTransaction ||
            requestGate.ownsTransaction(transactionKey))
        ) {
          setErrorReason("processing");
        }
      } finally {
        processing.current.delete(transactionKey);
      }
    },
    [requestGate, store],
  );
  processTransactionRef.current = processTransaction;

  const handleStoreError = useCallback(
    (error: SupportStoreError, requestToken?: number) => {
      if (!mounted.current) return;
      const productId = supportProductForStoreError(
        error,
        requestGate.current(),
      );
      if (!productId) return;
      const disposition = classifySupportStoreError(error.code);
      if (disposition === "cancelled") {
        if (requestToken !== undefined) {
          requestGate.releaseRequest(requestToken);
        }
        setErrorReason(null);
        dispatch({ type: "purchaseCancelled" });
        return;
      }
      if (disposition === "pending") {
        if (requestToken !== undefined) {
          requestGate.markRequest(requestToken, "pending");
        } else {
          requestGate.markCurrent("pending");
        }
        setErrorReason(null);
        dispatch({ type: "purchasePending", productId });
        return;
      }
      if (disposition === "verification") {
        if (requestToken !== undefined) {
          requestGate.markRequest(requestToken, "uncertain");
        } else {
          requestGate.markCurrent("uncertain");
        }
        setErrorReason("verification");
        dispatch({ type: "purchaseAmbiguousError" });
        return;
      }
      if (disposition === "processing") {
        if (requestToken !== undefined) {
          requestGate.markRequest(requestToken, "uncertain");
        } else {
          requestGate.markCurrent("uncertain");
        }
        setErrorReason("processing");
        dispatch({ type: "purchaseAmbiguousError" });
        return;
      }
      if (disposition === "failed") {
        if (requestToken !== undefined) {
          requestGate.releaseRequest(requestToken);
        }
        setErrorReason("failed");
        dispatch({ type: "outcomeCleared" });
        return;
      }
      if (requestToken !== undefined) {
        requestGate.markRequest(requestToken, "uncertain");
      } else {
        requestGate.markCurrent("uncertain");
      }
      setErrorReason("uncertain");
      dispatch({ type: "purchaseAmbiguousError" });
    },
    [requestGate],
  );
  handleStoreErrorRef.current = handleStoreError;

  const ensureConnected = useCallback(async () => {
    if (!store.supported) {
      dispatch({ type: "availabilityUnavailable" });
      return;
    }
    if (!connection.current) {
      dispatch({ type: "availabilityChecking" });
      connection.current = store
        .start({
          onTransaction: (transaction) => {
            void processTransactionRef.current(transaction);
          },
          onError: (error) => handleStoreErrorRef.current(error),
        })
        .then(() => {
          if (mounted.current) dispatch({ type: "availabilityAvailable" });
        })
        .catch(() => {
          connection.current = null;
          if (mounted.current) dispatch({ type: "availabilityUnavailable" });
          throw new Error("support_store_connection_failed");
        });
    }
    await connection.current;
  }, [store]);

  const reconcile = useCallback(async () => {
    if (!store.supported || reconciliation.current) {
      await reconciliation.current;
      return;
    }
    reconciliation.current = (async () => {
      await ensureConnected();
      const unfinished = await store.getUnfinishedTransactions();
      const supportUnfinished = supportTransactions(unfinished);
      for (const transaction of supportUnfinished) {
        await processTransactionRef.current(transaction);
      }
      if (!mounted.current || supportUnfinished.length > 0) return;
      const current = stateRef.current;
      if (current.outcome.status === "ambiguous-error") {
        requestGate.releaseAfterEmptyReconciliation();
        setErrorReason(null);
        dispatch({ type: "outcomeCleared" });
      } else if (current.outcome.status === "confirmed-finalizing") {
        requestGate.releaseAfterEmptyReconciliation();
        dispatch({
          type: "purchaseSucceeded",
          productId: current.outcome.productId,
          transactionId: current.outcome.transactionId,
        });
      }
    })()
      .catch(() => {
        if (!mounted.current) return;
        const current = stateRef.current;
        if (current.outcome.status === "confirmed-finalizing") {
          setErrorReason("processing");
        }
      })
      .finally(() => {
        reconciliation.current = null;
      });
    await reconciliation.current;
  }, [ensureConnected, requestGate, store]);

  useEffect(() => {
    mounted.current = true;
    if (store.supported) {
      void ensureConnected()
        .then(reconcile)
        .catch(() => {});
    } else {
      dispatch({ type: "availabilityUnavailable" });
    }
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void reconcile();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      void store.stop();
    };
  }, [ensureConnected, reconcile, store]);

  const reloadProducts = useCallback(async () => {
    if (!store.supported) return;
    setErrorReason(null);
    dispatch({ type: "productsLoading" });
    try {
      await ensureConnected();
      await reconcile();
      const products = await store.getProducts(
        SUPPORT_TIERS.map((tier) => tier.id),
      );
      if (!mounted.current) return;
      const normalized = products.flatMap((product) =>
        isSupportProductId(product.productId)
          ? [{ id: product.productId, displayPrice: product.displayPrice }]
          : [],
      );
      if (normalized.length === 0) {
        dispatch({ type: "productsFailed" });
      } else {
        dispatch({ type: "productsLoaded", products: normalized });
      }
    } catch {
      if (mounted.current) dispatch({ type: "productsFailed" });
    }
  }, [ensureConnected, reconcile, store]);

  const selectProduct = useCallback(
    (productId: string) => {
      if (!isSupportProductId(productId)) return;
      if (requestGate.current()) return;
      setErrorReason(null);
      dispatch({ type: "productSelected", productId });
    },
    [requestGate],
  );

  const purchase = useCallback(async () => {
    const current = stateRef.current;
    if (!canStartSupportPurchase(current) || !current.selectedProductId) return;
    const productId = current.selectedProductId;
    const requestToken = requestGate.tryAcquire(productId);
    if (requestToken === null) return;
    setErrorReason(null);
    dispatch({ type: "purchaseStarted", productId });
    try {
      const transaction = await store.requestPurchase(productId);
      const transactionKey = transaction
        ? supportTransactionKey(transaction)
        : null;
      if (
        !transaction ||
        transaction.productId !== productId ||
        !transactionKey ||
        !requestGate.bindRequestTransaction(requestToken, transactionKey)
      ) {
        requestGate.markRequest(requestToken, "uncertain");
        setErrorReason("uncertain");
        dispatch({ type: "purchaseAmbiguousError" });
        return;
      }
      await processTransactionRef.current(transaction);
      if (
        completed.current.has(transactionKey) &&
        requestGate.releaseTransaction(transactionKey) &&
        mounted.current
      ) {
        dispatch({
          type: "purchaseSucceeded",
          productId,
          transactionId: transaction.transactionId.trim(),
        });
      }
    } catch (error) {
      const storeError = thrownStoreError(error);
      handleStoreErrorRef.current(
        {
          ...storeError,
          productId: storeError.productId ?? productId,
        },
        requestToken,
      );
    }
  }, [requestGate, store]);

  const products = useMemo<readonly SupportProductRow[]>(
    () =>
      SUPPORT_TIERS.map((tier) => {
        const storeProduct = state.products.find(
          (product) => product.id === tier.id,
        );
        return {
          id: tier.id,
          labelKey: tier.labelKey,
          displayPrice: storeProduct?.displayPrice ?? null,
          available: state.productLoadStatus === "loading" || !!storeProduct,
        };
      }),
    [state.productLoadStatus, state.products],
  );
  const value = useMemo<SupportPurchaseController>(
    () => ({
      visible: Platform.OS === "ios" && store.supported,
      products,
      selectedProductId: state.selectedProductId,
      status: supportScreenStatus(state, errorReason),
      canPurchase:
        canStartSupportPurchase(state) && requestGate.current() === null,
      selectProduct,
      purchase,
      reloadProducts,
    }),
    [
      errorReason,
      products,
      purchase,
      reloadProducts,
      selectProduct,
      state,
      store.supported,
    ],
  );
  return (
    <SupportPurchaseContext.Provider value={value}>
      {children}
    </SupportPurchaseContext.Provider>
  );
}

export function useSupportPurchases(): SupportPurchaseController {
  const value = useContext(SupportPurchaseContext);
  if (!value) {
    throw new Error(
      "useSupportPurchases must be used within SupportPurchaseProvider",
    );
  }
  return value;
}
