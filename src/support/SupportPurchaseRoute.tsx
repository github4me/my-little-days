import React, { useEffect, useMemo } from "react";
import { Alert, Linking } from "react-native";
import { useI18n } from "../i18n";
import SupportScreen from "./SupportScreen";
import { createSupportTranslator } from "./messages";
import { useSupportPurchases } from "./SupportPurchaseProvider";

const APPLE_PURCHASES_URL = "https://reportaproblem.apple.com/";

export default function SupportPurchaseRoute({
  onBack,
}: {
  onBack: () => void;
}) {
  const { locale } = useI18n();
  const t = useMemo(() => createSupportTranslator(locale), [locale]);
  const controller = useSupportPurchases();

  useEffect(() => {
    if (!controller.visible) onBack();
  }, [controller.visible, onBack]);

  useEffect(() => {
    if (controller.visible) void controller.reloadProducts();
  }, [controller.visible, controller.reloadProducts]);

  function openApplePurchases() {
    void Linking.openURL(APPLE_PURCHASES_URL).catch(() =>
      Alert.alert(t("support.link.errorTitle"), t("support.link.error")),
    );
  }

  // Also protect a stale route retained during development or state recovery.
  if (!controller.visible) return null;

  return (
    <SupportScreen
      products={controller.products}
      selectedProductId={controller.selectedProductId}
      status={controller.status}
      canPurchase={controller.canPurchase}
      t={t}
      onBack={onBack}
      onSelectProduct={controller.selectProduct}
      onPurchase={() => void controller.purchase()}
      onReloadProducts={() => void controller.reloadProducts()}
      onOpenPurchaseHistory={openApplePurchases}
      onOpenRefundHelp={openApplePurchases}
    />
  );
}
