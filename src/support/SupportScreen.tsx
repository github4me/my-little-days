import React, { useContext, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import HelpDisclosure from "../HelpDisclosure";
import { Card, T, Theme, heading } from "../ui";
import type { SupportTranslate, SupportTranslationValues } from "./messages";

export type SupportProductRow = Readonly<{
  id: string;
  labelKey: string;
  /** A StoreKit-formatted price. Never supply a source-code fallback price. */
  displayPrice: string | null;
  available?: boolean;
}>;

export type SupportErrorReason =
  "failed" | "uncertain" | "verification" | "processing";

type StatusMessageOverride = {
  messageKey?: string;
  messageValues?: SupportTranslationValues;
};

export type SupportScreenStatus =
  | { kind: "ready" | "cancelled" }
  | ({
      kind: "loading" | "unavailable" | "purchasing" | "pending" | "success";
    } & StatusMessageOverride)
  | ({ kind: "error"; reason?: SupportErrorReason } & StatusMessageOverride);

export type SupportScreenProps = {
  products: readonly SupportProductRow[];
  selectedProductId: string | null;
  status: SupportScreenStatus;
  /** The coordinator remains authoritative about whether a new request is safe. */
  canPurchase: boolean;
  t: SupportTranslate;
  onBack: () => void;
  onSelectProduct: (productId: string) => void;
  onPurchase: () => void;
  onReloadProducts?: () => void;
  onOpenPurchaseHistory?: () => void;
  onOpenRefundHelp?: () => void;
};

function statusDefaultKey(status: SupportScreenStatus): string | null {
  switch (status.kind) {
    case "loading":
      return "support.status.loading";
    case "unavailable":
      return "support.status.unavailable";
    case "purchasing":
      return "support.status.purchasing";
    case "pending":
      return "support.status.pending";
    case "success":
      return "support.status.success";
    case "error":
      return status.reason === "uncertain"
        ? "support.status.uncertain"
        : status.reason === "verification"
          ? "support.status.verification"
          : status.reason === "processing"
            ? "support.status.processing"
            : "support.status.error";
    case "ready":
    case "cancelled":
      return null;
  }
}

function statusMessage(
  status: SupportScreenStatus,
  t: SupportTranslate,
): string | null {
  const key =
    "messageKey" in status && status.messageKey
      ? status.messageKey
      : statusDefaultKey(status);
  if (!key) return null;
  return t(key, "messageValues" in status ? status.messageValues : undefined);
}

function StatusNotice({
  status,
  t,
}: {
  status: SupportScreenStatus;
  t: SupportTranslate;
}) {
  const c = useContext(Theme);
  const message = statusMessage(status, t);
  if (!message) return null;

  const busy = status.kind === "loading" || status.kind === "purchasing";
  const error = status.kind === "error";
  const success = status.kind === "success";
  const pending = status.kind === "pending";
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      accessibilityLiveRegion={error ? "assertive" : "polite"}
      aria-live={error ? "assertive" : "polite"}
      style={[
        styles.statusNotice,
        {
          backgroundColor: success || pending ? c.soft : c.card,
          borderColor: error ? c.danger : c.line,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator accessible={false} color={c.primary} size="small" />
      ) : success || error || pending ? (
        <T
          raw
          accessibilityElementsHidden
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          style={{
            color: error ? c.danger : c.primary,
            fontSize: 17,
            lineHeight: 22,
            fontWeight: "700",
          }}
        >
          {success ? "✓" : error ? "!" : "…"}
        </T>
      ) : null}
      <T
        raw
        style={{
          flex: 1,
          color: error ? c.danger : success ? c.text : c.muted,
          fontSize: 15,
          lineHeight: 21,
          fontWeight: success ? "600" : "400",
        }}
      >
        {message}
      </T>
    </View>
  );
}

function useStatusAnnouncement(
  status: SupportScreenStatus,
  t: SupportTranslate,
) {
  const message = statusMessage(status, t);
  const previousMessage = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      previousMessage.current = message;
      return;
    }
    if (Platform.OS === "ios" && message && message !== previousMessage.current)
      AccessibilityInfo.announceForAccessibility(message);
    previousMessage.current = message;
  }, [message]);
}

function TextAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const c = useContext(Theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        { opacity: pressed ? 0.65 : 1 },
      ]}
    >
      <T raw style={{ color: c.primary, fontSize: 15, fontWeight: "600" }}>
        {label}
      </T>
    </Pressable>
  );
}

function ProductOption({
  product,
  selected,
  loading,
  disabled,
  stacked,
  t,
  onSelect,
}: {
  product: SupportProductRow;
  selected: boolean;
  loading: boolean;
  disabled: boolean;
  stacked: boolean;
  t: SupportTranslate;
  onSelect: () => void;
}) {
  const c = useContext(Theme);
  const name = t(product.labelKey);
  const price = loading
    ? t("support.product.loading")
    : (product.displayPrice ?? t("support.product.unavailable"));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={t("support.product.accessibilityLabel", {
        name,
        price,
      })}
      accessibilityHint={disabled ? undefined : t("support.product.selectHint")}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={disabled ? undefined : onSelect}
      style={({ pressed }) => [
        styles.productOption,
        stacked && styles.productOptionStacked,
        {
          backgroundColor: selected ? c.soft : c.card,
          borderBottomColor: c.line,
          opacity: disabled ? 0.62 : pressed ? 0.72 : 1,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.radio,
          {
            borderColor: selected ? c.primary : c.controlLine,
            backgroundColor: c.card,
          },
        ]}
      >
        {selected ? (
          <View style={[styles.radioDot, { backgroundColor: c.primary }]} />
        ) : null}
      </View>
      <View style={[styles.productText, stacked && styles.productTextStacked]}>
        <T
          raw
          style={{
            flex: stacked ? undefined : 1,
            fontWeight: selected ? "700" : "500",
            color: selected ? c.text : c.muted,
          }}
        >
          {name}
        </T>
        <T
          raw
          style={{
            color: selected ? c.primary : c.muted,
            fontSize: 17,
            fontWeight: "600",
            textAlign: stacked ? "left" : "right",
          }}
        >
          {price}
        </T>
      </View>
    </Pressable>
  );
}

function PrimaryAction({
  label,
  hint,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  hint?: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const c = useContext(Theme);
  const unavailable = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={unavailable ? undefined : hint}
      accessibilityState={{ disabled: unavailable, busy }}
      aria-busy={busy}
      disabled={unavailable}
      onPress={unavailable ? undefined : onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        {
          backgroundColor: c.primary,
          opacity: unavailable ? 0.65 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator
          accessible={false}
          color={c.onPrimary}
          size="small"
        />
      ) : null}
      <T
        raw
        style={{
          color: c.onPrimary,
          flexShrink: 1,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </T>
    </Pressable>
  );
}

function purchaseActionLabel(
  status: SupportScreenStatus,
  selectedProduct: SupportProductRow | undefined,
  t: SupportTranslate,
): string {
  if (status.kind === "loading") return t("support.action.loading");
  if (status.kind === "unavailable") return t("support.action.unavailable");
  if (status.kind === "purchasing") return t("support.action.purchasing");
  if (status.kind === "pending") return t("support.action.pending");
  if (selectedProduct?.displayPrice)
    return t("support.action.support", {
      price: selectedProduct.displayPrice,
    });
  return t("support.action.select");
}

function blocksNewPurchase(status: SupportScreenStatus): boolean {
  if (
    status.kind === "loading" ||
    status.kind === "unavailable" ||
    status.kind === "purchasing" ||
    status.kind === "pending"
  )
    return true;
  return (
    status.kind === "error" &&
    status.reason !== undefined &&
    status.reason !== "failed"
  );
}

export default function SupportScreen({
  products,
  selectedProductId,
  status,
  canPurchase,
  t,
  onBack,
  onSelectProduct,
  onPurchase,
  onReloadProducts,
  onOpenPurchaseHistory,
  onOpenRefundHelp,
}: SupportScreenProps) {
  const c = useContext(Theme);
  useStatusAnnouncement(status, t);
  const { width, fontScale } = useWindowDimensions();
  const stackedRows = width < 360 || fontScale >= 1.6;
  const selectionLocked = blocksNewPurchase(status);
  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  );
  const selectedAvailable =
    selectedProduct?.displayPrice != null &&
    selectedProduct.available !== false;
  const purchaseDisabled =
    blocksNewPurchase(status) ||
    !canPurchase ||
    !selectedProduct ||
    !selectedAvailable;
  const actionLabel = purchaseActionLabel(status, selectedProduct, t);

  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("support.back")}
        onPress={onBack}
        style={({ pressed }) => [styles.back, { opacity: pressed ? 0.7 : 1 }]}
      >
        <T
          raw
          accessibilityElementsHidden
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          style={{ color: c.primary, fontSize: 22, lineHeight: 24 }}
        >
          ‹
        </T>
        <T raw style={{ color: c.primary, fontSize: 17, fontWeight: "600" }}>
          {t("support.back")}
        </T>
      </Pressable>

      <View style={styles.intro}>
        <T
          raw
          accessibilityRole="header"
          dynamicTypeRamp="title1"
          style={[heading, styles.title]}
        >
          {t("support.title")}
        </T>
        <T raw style={{ color: c.text, fontSize: 17, lineHeight: 24 }}>
          {t("support.intro")}
        </T>
        <T raw style={{ color: c.muted, fontSize: 15, lineHeight: 21 }}>
          {t("support.essential")}
        </T>
      </View>

      <StatusNotice status={status} t={t} />
      {status.kind === "unavailable" && onReloadProducts ? (
        <TextAction
          label={t("support.action.reload")}
          onPress={onReloadProducts}
        />
      ) : null}
      {(status.kind === "error" && status.reason !== "failed") ||
      (status.kind === "pending" &&
        "messageKey" in status &&
        status.messageKey === "support.status.processing") ? (
        onReloadProducts ? (
          <TextAction
            label={t("support.action.checkStatus")}
            onPress={onReloadProducts}
          />
        ) : null
      ) : null}

      {products.length > 0 ? (
        <View style={styles.optionsSection}>
          <T
            raw
            accessibilityRole="header"
            style={{ fontSize: 17, fontWeight: "700" }}
          >
            {t("support.options.title")}
          </T>
          <Card style={styles.optionsCard}>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("support.options.accessibilityLabel")}
            >
              {products.map((product, index) => {
                const available =
                  product.available !== false &&
                  (status.kind === "loading" || product.displayPrice != null);
                return (
                  <View
                    key={product.id}
                    style={
                      index === products.length - 1 ? styles.lastRow : null
                    }
                  >
                    <ProductOption
                      product={product}
                      selected={product.id === selectedProductId}
                      loading={status.kind === "loading"}
                      disabled={selectionLocked || !available}
                      stacked={stackedRows}
                      t={t}
                      onSelect={() => onSelectProduct(product.id)}
                    />
                  </View>
                );
              })}
            </View>
          </Card>
        </View>
      ) : null}

      <PrimaryAction
        label={actionLabel}
        hint={purchaseDisabled ? undefined : t("support.action.purchaseHint")}
        busy={status.kind === "purchasing"}
        disabled={purchaseDisabled}
        onPress={onPurchase}
      />

      <HelpDisclosure title={t("support.about.title")}>
        <T raw style={[styles.aboutText, { color: c.muted }]}>
          {t("support.about.oneTime")}
        </T>
        <T raw style={[styles.aboutText, { color: c.muted }]}>
          {t("support.about.appleBilling")}
        </T>
        <T raw style={[styles.aboutText, { color: c.muted }]}>
          {t("support.about.noBenefits")}
        </T>
        <View style={styles.aboutItem}>
          <T raw style={[styles.aboutText, { color: c.muted }]}>
            {t("support.about.history")}
          </T>
          {onOpenPurchaseHistory ? (
            <TextAction
              label={t("support.about.historyAction")}
              onPress={onOpenPurchaseHistory}
            />
          ) : null}
        </View>
        <View style={styles.aboutItem}>
          <T raw style={[styles.aboutText, { color: c.muted }]}>
            {t("support.about.refund")}
          </T>
          {onOpenRefundHelp ? (
            <TextAction
              label={t("support.about.refundAction")}
              onPress={onOpenRefundHelp}
            />
          ) : null}
        </View>
      </HelpDisclosure>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    gap: 18,
  },
  back: {
    alignSelf: "flex-start",
    minWidth: 44,
    minHeight: 44,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  intro: {
    gap: 7,
  },
  title: {
    fontSize: 28,
    lineHeight: 36,
  },
  statusNotice: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  textAction: {
    alignSelf: "flex-start",
    minWidth: 44,
    minHeight: 44,
    paddingVertical: 10,
    justifyContent: "center",
  },
  optionsSection: {
    gap: 10,
  },
  optionsCard: {
    padding: 0,
    gap: 0,
    overflow: "hidden",
    borderRadius: 18,
  },
  productOption: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  productOptionStacked: {
    alignItems: "flex-start",
  },
  lastRow: {
    marginBottom: -1,
  },
  radio: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  productText: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  productTextStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
  },
  primaryAction: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    minWidth: 44,
    minHeight: 50,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  aboutText: {
    fontSize: 15,
    lineHeight: 22,
  },
  aboutItem: {
    gap: 2,
  },
});
