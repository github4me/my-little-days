import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { T } from "./ui";
import { t } from "./i18n";
import type { light } from "./palette";

export const appTabs = [
  { key: "today", label: "今天" },
  { key: "records", label: "记录" },
  { key: "growth", label: "成长" },
  { key: "play", label: "照护" },
  { key: "settings", label: "我的" },
] as const;
export type AppTab = (typeof appTabs)[number]["key"];

// Announce only an explicit route change. Refreshes, clock ticks, opening a
// keyboard and returning from a sheet must not move VoiceOver's current focus.
export function useNavigationAnnouncement(
  route: string,
  title: string,
  modalOpen: boolean,
) {
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    if (
      Platform.OS === "web" ||
      modalOpen ||
      TextInput.State.currentlyFocusedInput()
    )
      return;
    AccessibilityInfo.announceForAccessibility(title);
  }, [route, title, modalOpen]);
}

const paths: Record<AppTab, string> = {
  today: "M3 11.5 12 4l9 7.5M5.5 10v10h5v-6h3v6h5V10",
  records: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  growth: "M4 4v16h16M7 15l4-5 4 2 5-7",
  play: "M12 20S3 14.8 3 8.5C3 3.7 9 2.7 12 7c3-4.3 9-3.3 9 1.5C21 14.8 12 20 12 20Z",
  settings: "M4 6h2M10 6h10M4 12h2M10 12h10M4 18h2M10 18h10",
};

export function AppTabBar({
  tab,
  colors,
  onSelect,
}: {
  tab: AppTab;
  colors: typeof light;
  onSelect: (next: AppTab) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
        flexDirection: "row",
        paddingVertical: 7,
      }}
    >
      {appTabs.map(({ key, label }) => {
        const selected = tab === key;
        const color = selected ? colors.primary : colors.muted;
        return (
          <Pressable
            key={key}
            nativeID={`tab-${key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            aria-selected={selected}
            accessibilityLabel={t(label)}
            accessibilityShowsLargeContentViewer={Platform.OS === "ios"}
            accessibilityLargeContentTitle={t(label)}
            {...(Platform.OS === "web"
              ? {
                  tabIndex: selected ? (0 as const) : (-1 as const),
                  "aria-controls": selected ? `screen-${key}` : undefined,
                  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                    const current = appTabs.findIndex(
                      (item) => item.key === key,
                    );
                    const next =
                      event.key === "ArrowRight"
                        ? (current + 1) % appTabs.length
                        : event.key === "ArrowLeft"
                          ? (current - 1 + appTabs.length) % appTabs.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? appTabs.length - 1
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    const destination = event.currentTarget
                      .closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLElement>('[role="tab"]')[next];
                    onSelect(appTabs[next].key);
                    destination?.focus();
                  },
                }
              : {})}
            onPress={() => onSelect(key)}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              minHeight: 49,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 2,
              paddingVertical: 2,
              gap: 3,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Svg
              width={25}
              height={25}
              viewBox="0 0 24 24"
              accessible={false}
              aria-hidden
            >
              <Path
                d={paths[key]}
                fill="none"
                stroke={color}
                strokeWidth={selected ? 2.4 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <T
              // Like the native tab bar, retain all destinations at large type
              // sizes; iOS exposes the full label with its Large Content Viewer.
              maxFontSizeMultiplier={Platform.OS === "ios" ? 1.3 : undefined}
              style={{
                fontSize: 11,
                lineHeight: 15,
                color,
                fontWeight: selected ? "700" : "400",
                textAlign: "center",
                flexShrink: 1,
                width: "100%",
              }}
            >
              {label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
