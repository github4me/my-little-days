import React, { createContext, useContext } from "react";
import {
  Text,
  View,
  Pressable,
  TextInput,
  TextStyle,
  ViewStyle,
  KeyboardTypeOptions,
} from "react-native";
import { useI18n } from "./i18n";
import CareIcon from "./CareIcon";
import { light, dark } from "./palette";
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
  return (
    <Text
      {...props}
      style={[{ color: c.text, fontSize: 15, lineHeight: 23 }, style]}
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
  style,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = useContext(Theme);
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: secondary ? c.soft : c.primary,
          borderRadius: 16,
          paddingHorizontal: 18,
          minHeight: 48,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <T
        style={{
          color: secondary ? c.text : c.onPrimary,
          fontWeight: "600",
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
}: {
  options: { label: string; value: string; icon?: string }[];
  value: string;
  onChange: (v: string) => void;
  iconized?: boolean;
  compact?: boolean;
}) {
  const c = useContext(Theme);
  const { t } = useI18n();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        flexWrap: iconized ? "nowrap" : "wrap",
      }}
    >
      {options.map((o) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(o.label)}
          accessibilityState={{ selected: value === o.value }}
          aria-selected={value === o.value}
          key={o.value}
          onPress={() => onChange(o.value)}
          style={{
            flex: iconized && !compact ? 1 : undefined,
            minWidth: iconized && !compact ? 0 : undefined,
            minHeight: iconized ? (compact ? 52 : 68) : 44,
            flexDirection: compact ? "row" : "column",
            gap: iconized ? (compact ? 5 : 2) : 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: iconized ? (compact ? 14 : 18) : 14,
            paddingHorizontal: iconized ? (compact ? 10 : 5) : 14,
            paddingVertical: iconized && !compact ? 6 : undefined,
            backgroundColor: value === o.value ? c.soft : c.card,
            borderWidth: 1,
            borderColor: value === o.value ? c.primary : c.line,
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
            numberOfLines={1}
            style={{
              color: value === o.value ? c.primary : c.muted,
              fontSize: iconized ? (compact ? 12 : 11) : 13,
              lineHeight: iconized ? (compact ? 16 : 15) : undefined,
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
      <T raw style={{ color: c.muted, fontSize: 13 }}>
        {t(label)}
      </T>
      <TextInput
        accessibilityLabel={t(label)}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ? t(placeholder) : undefined}
        placeholderTextColor={c.muted}
        keyboardAppearance={c === dark ? "dark" : "light"}
        selectionColor={c.primary}
        keyboardType={keyboardType}
        style={{
          borderWidth: 1,
          borderColor: c.controlLine,
          borderRadius: 14,
          padding: 14,
          color: c.text,
          fontSize: 16,
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
