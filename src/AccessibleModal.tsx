import React from "react";
import { Modal, View, type ModalProps } from "react-native";
import { useAccessibilityPreferences } from "./accessibilityPreferences";

/** Shared native modal boundary; individual dialogs retain their safe cancel guard. */
export default function AccessibleModal({
  children,
  animationType,
  onRequestClose,
  ...props
}: Omit<ModalProps, "onRequestClose"> & { onRequestClose?: () => void }) {
  const { reduceMotion } = useAccessibilityPreferences();
  return (
    <Modal
      {...props}
      animationType={reduceMotion ? "none" : animationType}
      onRequestClose={onRequestClose}
    >
      <View
        style={{ flex: 1 }}
        accessibilityViewIsModal
        onAccessibilityEscape={onRequestClose}
      >
        {children}
      </View>
    </Modal>
  );
}
