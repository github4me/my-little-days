import React, { useContext } from "react";
import { Pressable } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Theme } from "./ui";

export default function RecordActionButton({
  action,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  onPress,
}: {
  action: "edit" | "delete";
  accessibilityLabel: string;
  accessibilityHint: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = useContext(Theme);
  const color = action === "delete" ? c.danger : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed && !disabled ? c.soft : "transparent",
        opacity: disabled ? 0.38 : pressed ? 0.68 : 1,
      })}
    >
      <Svg
        width={21}
        height={21}
        viewBox="0 0 24 24"
        accessible={false}
        focusable={false}
      >
        {action === "edit" ? (
          <>
            <Path
              d="M4 20l4.4-1.1L19 8.3a2.1 2.1 0 0 0 0-3l-.3-.3a2.1 2.1 0 0 0-3 0L5.1 15.6 4 20Z"
              fill="none"
              stroke={color}
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="m14.5 6.2 3.3 3.3"
              fill="none"
              stroke={color}
              strokeWidth={1.9}
              strokeLinecap="round"
            />
          </>
        ) : (
          <Path
            d="M4 6h16M9 6V4h6v2M7 6l1 14h8l1-14M10 10v6M14 10v6"
            fill="none"
            stroke={color}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
    </Pressable>
  );
}
