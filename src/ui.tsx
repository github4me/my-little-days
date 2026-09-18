import React, { createContext, useContext } from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  TextStyle,
  ViewStyle,
  KeyboardTypeOptions,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useI18n } from "./i18n";
import CareIcon from "./CareIcon";
import { light } from "./palette";
import { useAccessibilityPreferences } from "./accessibilityPreferences";
export { light, dark } from "./palette";
export const Theme = createContext(light);
export function T({
  children,
  style,
  raw = false,
  ...props
}: React.ComponentProps<typeof Text> & { raw?: boolean }) {
  const c = useContext(Theme);
  const { t } = useI18n();
  const { boldText } = useAccessibilityPreferences();
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const accessibleWeight =
    weight === "bold" || Number(weight) >= 600 ? weight : "600";
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={0}
      dynamicTypeRamp="body"
      {...props}
      style={[
        { color: c.text, fontSize: 17, lineHeight: 23 },
        style,
        boldText && { fontWeight: accessibleWeight },
      ]}
    >
      {typeof children === "string" && !raw ? t(children) : children}
    </Text>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const c = useContext(Theme);
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: 24,
          padding: 20,
          borderWidth: 1,
          borderColor: c.line,
          gap: 12,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const c = useContext(Theme);
  const { t } = useI18n();
  const unavailable = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      accessibilityState={{ disabled: unavailable, busy }}
      aria-busy={busy}
      disabled={unavailable}
      onPress={unavailable ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: secondary ? c.soft : c.primary,
          borderRadius: 16,
          paddingHorizontal: 18,
          paddingVertical: 12,
          minHeight: 48,
          minWidth: 44,
          maxWidth: "100%",
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          // Keep labels legible when unavailable; state is also exposed to AT.
          opacity: unavailable ? 0.65 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          accessible={false}
          color={secondary ? c.text : c.onPrimary}
          size="small"
        />
      ) : null}
      <T
        style={{
          color: secondary ? c.text : c.onPrimary,
          fontWeight: "600",
          flexShrink: 1,
          textAlign: "center",
        }}
      >
        {t(label)}
      </T>
    </Pressable>
  );
}
export function Chips({
  options,
  value,
  onChange,
  iconized = false,
  compact = false,
  disabled = false,
}: {
  options: { label: string; value: string; icon?: string }[];
  value: string;
  onChange: (v: string) => void;
  iconized?: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  const c = useContext(Theme);
  const { t } = useI18n();
  const { width, fontScale } = useWindowDimensions();
  // Add rows instead of truncating labels or shrinking Dynamic Type.
  const iconBasis =
    fontScale >= 2 ? "100%" : fontScale >= 1.3 || width < 360 ? "46%" : 0;
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap",
        flexShrink: 1,
      }}
    >
      {options.map((o) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(o.label)}
          accessibilityState={{ selected: value === o.value, disabled }}
          disabled={disabled}
          aria-selected={value === o.value}
          key={o.value}
          onPress={disabled ? undefined : () => onChange(o.value)}
          style={{
            flexGrow: iconized && !compact ? 1 : undefined,
            flexBasis: iconized && !compact ? iconBasis : undefined,
            flexShrink: 1,
            minWidth: 44,
            maxWidth: "100%",
            minHeight: iconized ? (compact ? 52 : 68) : 44,
            flexDirection: compact ? "row" : "column",
            gap: iconized ? (compact ? 5 : 2) : 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: iconized ? (compact ? 14 : 18) : 14,
            paddingHorizontal: iconized ? (compact ? 10 : 5) : 14,
            paddingVertical: 8,
            backgroundColor: value === o.value ? c.soft : c.card,
            borderWidth: value === o.value ? 2 : 1,
            borderColor: value === o.value ? c.primary : c.line,
            opacity: disabled ? 0.65 : 1,
          }}
        >
          {iconized && o.icon === "♧" ? (
            <CareIcon
              kind="diaper"
              size={compact ? 20 : 24}
              color={value === o.value ? c.primary : c.muted}
            />
          ) : iconized && o.icon ? (
            <T
              raw
              style={{
                color: value === o.value ? c.primary : c.muted,
                fontSize: compact ? 16 : 21,
                lineHeight: compact ? 20 : 24,
                fontWeight: "600",
              }}
            >
              {o.icon}
            </T>
          ) : null}
          <T
            dynamicTypeRamp={iconized ? "footnote" : "subheadline"}
            style={{
              color: value === o.value ? c.primary : c.muted,
              fontSize: iconized ? 13 : 15,
              lineHeight: iconized ? 18 : 21,
              flexShrink: 1,
              textAlign: "center",
              fontWeight: value === o.value ? "700" : "500",
            }}
          >
            {t(o.label)}
          </T>
        </Pressable>
      ))}
    </View>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = "default",
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  inputMode?: "decimal";
  maxLength?: number;
  editable?: boolean;
}) {
  const c = useContext(Theme);
  const { t } = useI18n();
  return (
    <View style={{ gap: 6 }}>
      <T
        raw
        dynamicTypeRamp="subheadline"
        style={{ color: c.muted, fontSize: 15 }}
      >
        {t(label)}
      </T>
      <TextInput
        accessibilityLabel={t(label)}
        accessibilityState={{ disabled: rest.editable === false }}
        allowFontScaling
        maxFontSizeMultiplier={0}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ? t(placeholder) : undefined}
        placeholderTextColor={c.muted}
        keyboardAppearance={c.isDark ? "dark" : "light"}
        selectionColor={c.primary}
        keyboardType={keyboardType}
        style={{
          borderWidth: 1,
          borderColor: c.controlLine,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 48,
          color: c.text,
          fontSize: 17,
          backgroundColor: c.input,
        }}
        {...rest}
      />
    </View>
  );
}
export const row: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};
export const heading: TextStyle = {
  fontSize: 23,
  lineHeight: 31,
  fontWeight: "700",
  letterSpacing: -0.5,
};
